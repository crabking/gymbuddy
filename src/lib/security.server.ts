import { createHash } from "node:crypto";

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const rateLimitBuckets = new Map<string, RateLimitBucket>();
const MAX_RATE_LIMIT_BUCKETS = 10_000;

export class RequestBodyError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RequestBodyError";
  }
}

export function getClientAddress(request: Request): string {
  const direct =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0];
  const address = direct?.trim();
  return address && address.length <= 128 ? address : "unknown";
}

export function privateRateLimitKey(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

export function takeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  let bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    rateLimitBuckets.set(key, bucket);
  }

  bucket.count += 1;
  pruneRateLimitBuckets(now);

  return {
    allowed: bucket.count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

export function resetRateLimit(key: string): void {
  rateLimitBuckets.delete(key);
}

function pruneRateLimitBuckets(now: number): void {
  if (rateLimitBuckets.size <= MAX_RATE_LIMIT_BUCKETS) return;

  for (const [key, bucket] of rateLimitBuckets) {
    if (bucket.resetAt <= now) rateLimitBuckets.delete(key);
  }

  while (rateLimitBuckets.size > MAX_RATE_LIMIT_BUCKETS) {
    const oldestKey = rateLimitBuckets.keys().next().value as string | undefined;
    if (!oldestKey) break;
    rateLimitBuckets.delete(oldestKey);
  }
}

export function isUnsafeCrossOriginRequest(request: Request): boolean {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method.toUpperCase())) {
    return false;
  }

  if (request.headers.get("sec-fetch-site") === "cross-site") return true;

  const origin = request.headers.get("origin");
  if (!origin) return false;

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return true;
  }

  const requestUrl = new URL(request.url);
  const allowedHosts = new Set(
    [
      requestUrl.host,
      request.headers.get("host"),
      request.headers.get("x-forwarded-host")?.split(",")[0],
    ]
      .map((value) => value?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value)),
  );

  if (!allowedHosts.has(originUrl.host.toLowerCase())) return true;
  if (process.env.NODE_ENV === "production" && originUrl.protocol !== "https:") return true;
  return false;
}

export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(contentType)) {
    throw new RequestBodyError(415, "Content-Type must be application/json");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (!Number.isFinite(declaredBytes) || declaredBytes < 0) {
      throw new RequestBodyError(400, "Invalid Content-Length");
    }
    if (declaredBytes > maxBytes) {
      throw new RequestBodyError(413, "Request is too large");
    }
  }

  if (!request.body) throw new RequestBodyError(400, "Missing request body");

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        throw new RequestBodyError(413, "Request is too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError(400, "Invalid request encoding");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RequestBodyError(400, "Invalid JSON");
  }
}
