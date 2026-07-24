import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { getClientAddress, isUnsafeCrossOriginRequest, takeRateLimit } from "./lib/security.server";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

// Three resized chat photos fit below this cap. Keep the ceiling tight because
// mutation bodies are buffered once for reliable byte-count enforcement.
const MAX_MUTATION_BODY_BYTES = 16 * 1024 * 1024;
const MAX_BUFFERING_MUTATIONS = 8;
const MAX_BUFFERING_MUTATIONS_PER_ADDRESS = 3;

let bufferingMutations = 0;
const bufferingMutationsByAddress = new Map<string, number>();

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

function preventClientDataCaching(request: Request, response: Response): Response {
  const pathname = new URL(request.url).pathname;
  const isStaticAsset =
    request.method === "GET" &&
    (pathname.startsWith("/assets/") ||
      pathname.startsWith("/icons/") ||
      /\.(?:css|js|woff2?|png|jpe?g|svg|ico|webp)$/.test(pathname));
  if (isStaticAsset) return response;

  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store, private");
  headers.set("Pragma", "no-cache");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function applySecurityHeaders(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
    ].join("; "),
  );
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set(
    "Permissions-Policy",
    "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
  );
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Permitted-Cross-Domain-Policies", "none");

  if (process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function securityRejection(request: Request): Response | null {
  if (isUnsafeCrossOriginRequest(request)) {
    return new Response("Cross-origin request blocked", { status: 403 });
  }

  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method.toUpperCase())) {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_MUTATION_BODY_BYTES) {
      return new Response("Request is too large", { status: 413 });
    }

    const address = getClientAddress(request);
    const limit = takeRateLimit(`mutation:${address}`, 180, 60_000);
    if (!limit.allowed) {
      return new Response("Too many requests", {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      });
    }
  }

  return null;
}

function claimMutationBufferSlot(request: Request): (() => void) | null {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method.toUpperCase()) || !request.body) {
    return () => undefined;
  }
  const address = getClientAddress(request);
  const addressCount = bufferingMutationsByAddress.get(address) ?? 0;
  if (
    bufferingMutations >= MAX_BUFFERING_MUTATIONS ||
    addressCount >= MAX_BUFFERING_MUTATIONS_PER_ADDRESS
  ) {
    return null;
  }
  bufferingMutations += 1;
  bufferingMutationsByAddress.set(address, addressCount + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    bufferingMutations = Math.max(0, bufferingMutations - 1);
    const current = bufferingMutationsByAddress.get(address) ?? 1;
    if (current <= 1) bufferingMutationsByAddress.delete(address);
    else bufferingMutationsByAddress.set(address, current - 1);
  };
}

export async function bufferBoundedMutationBody(
  request: Request,
  maxBytes = MAX_MUTATION_BODY_BYTES,
): Promise<Request | Response> {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method.toUpperCase()) || !request.body) {
    return request;
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("Request body limit exceeded");
        return new Response("Request is too large", { status: 413 });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request, { body });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    let releaseMutationSlot: (() => void) | null = null;
    try {
      const rejected = securityRejection(request);
      if (rejected) return applySecurityHeaders(request, rejected);

      releaseMutationSlot = claimMutationBufferSlot(request);
      if (!releaseMutationSlot) {
        return applySecurityHeaders(
          request,
          new Response("Too many requests are being uploaded", {
            status: 429,
            headers: { "Retry-After": "2" },
          }),
        );
      }
      const boundedRequest = await bufferBoundedMutationBody(request);
      if (boundedRequest instanceof Response) {
        return applySecurityHeaders(request, boundedRequest);
      }
      const handler = await getServerEntry();
      const response = await handler.fetch(boundedRequest, env, ctx);
      const normalized = await normalizeCatastrophicSsrResponse(response);
      return applySecurityHeaders(request, preventClientDataCaching(request, normalized));
    } catch (error) {
      console.error(error);
      return applySecurityHeaders(
        request,
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    } finally {
      releaseMutationSlot?.();
    }
  },
};
