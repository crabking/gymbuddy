import { createHash } from "node:crypto";
import { eq, lte, sql } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import { rateLimitBuckets as dbRateLimitBuckets } from "@/db/schema";

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
  const trustProxy =
    process.env.TRUST_PROXY_HEADERS === "true" || process.env.TRUST_PROXY_HEADERS === "1";
  if (!trustProxy) return "untrusted-proxy";

  // Coolify/Traefik owns X-Real-IP. Prefer that single value over client
  // supplied forwarding chains. If only X-Forwarded-For is available, the
  // right-most address is the hop appended by the trusted edge proxy.
  const forwarded = request.headers.get("x-forwarded-for");
  const direct = request.headers.get("x-real-ip") ?? forwarded?.split(",").at(-1);
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

/**
 * Cross-replica fixed-window limiter for expensive or abuse-sensitive routes.
 * Only a SHA-256 digest of the supplied key is persisted.
 */
export async function takeDistributedRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000_000) {
    throw new Error("Invalid rate-limit threshold");
  }
  if (!Number.isFinite(windowMs) || windowMs < 1_000 || windowMs > 31 * 24 * 60 * 60_000) {
    throw new Error("Invalid rate-limit window");
  }

  const keyHash = privateRateLimitKey(`distributed:${key}`);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + windowMs).toISOString();
  const result = await getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"rate-limit:" + keyHash}, 0))`,
    );
    await tx.delete(dbRateLimitBuckets).where(lte(dbRateLimitBuckets.expires_at, nowIso));
    const [current] = await tx
      .select({
        count: dbRateLimitBuckets.count,
        expires_at: dbRateLimitBuckets.expires_at,
      })
      .from(dbRateLimitBuckets)
      .where(eq(dbRateLimitBuckets.key_hash, keyHash))
      .limit(1);
    if (!current) {
      await tx.insert(dbRateLimitBuckets).values({
        key_hash: keyHash,
        window_start: nowIso,
        expires_at: expiresAt,
        count: 1,
      });
      return { count: 1, expiresAt };
    }
    const [updated] = await tx
      .update(dbRateLimitBuckets)
      .set({ count: sql`${dbRateLimitBuckets.count} + 1` })
      .where(eq(dbRateLimitBuckets.key_hash, keyHash))
      .returning({
        count: dbRateLimitBuckets.count,
        expires_at: dbRateLimitBuckets.expires_at,
      });
    return {
      count: updated?.count ?? current.count + 1,
      expiresAt: updated?.expires_at ?? current.expires_at,
    };
  });

  return {
    allowed: result.count <= limit,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((new Date(result.expiresAt).getTime() - Date.now()) / 1_000),
    ),
  };
}

export async function resetDistributedRateLimit(key: string): Promise<void> {
  const keyHash = privateRateLimitKey(`distributed:${key}`);
  await getDb().delete(dbRateLimitBuckets).where(eq(dbRateLimitBuckets.key_hash, keyHash));
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
  let allowedOrigin = requestUrl.origin;
  const configuredOrigin = process.env.PUBLIC_ORIGIN?.trim();
  if (configuredOrigin) {
    try {
      allowedOrigin = new URL(configuredOrigin).origin;
    } catch {
      console.error("Invalid PUBLIC_ORIGIN; rejecting unsafe request.");
      return true;
    }
  }

  if (originUrl.origin.toLowerCase() !== allowedOrigin.toLowerCase()) return true;
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
