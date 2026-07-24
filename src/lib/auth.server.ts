import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import { users, sessions, type User } from "@/db/schema";

export const SESSION_COOKIE = "gb_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const REFRESH_THRESHOLD_MS = 1000 * 60 * 60 * 24 * 15; // extend when <15 days left
const ABSOLUTE_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 90;
const SCRYPT_KEYLEN = 64;
export const DUMMY_PASSWORD_HASH = hashPassword(randomBytes(32).toString("base64url"));

// --- Password hashing (Node scrypt, no native deps) ---

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hashHex] = stored.split(":");
  if (
    scheme !== "scrypt" ||
    !/^[a-f0-9]{32}$/i.test(salt ?? "") ||
    !new RegExp(`^[a-f0-9]{${SCRYPT_KEYLEN * 2}}$`, "i").test(hashHex ?? "")
  ) {
    return false;
  }
  const expected = Buffer.from(hashHex, "hex");
  try {
    const actual = scryptSync(password, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// --- Session tokens ---

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const id = sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const db = getDb();
  await db.delete(sessions).where(lt(sessions.expires_at, new Date()));
  await db.insert(sessions).values({ id, user_id: userId, expires_at: expiresAt });
  return { token, expiresAt };
}

export async function validateSessionToken(token: string | undefined | null): Promise<User | null> {
  if (!token) return null;
  const id = sha256(token);
  const db = getDb();
  const [row] = await db
    .select({
      user: users,
      expiresAt: sessions.expires_at,
      createdAt: sessions.created_at,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.user_id))
    .where(eq(sessions.id, id))
    .limit(1);
  if (!row) return null;

  const expires = row.expiresAt.getTime();
  const createdAt = new Date(row.createdAt).getTime();
  const absoluteExpiry = createdAt + ABSOLUTE_SESSION_TTL_MS;
  if (Date.now() >= expires || Date.now() >= absoluteExpiry) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  // Sliding expiration: extend if close to expiry.
  if (expires - Date.now() < REFRESH_THRESHOLD_MS) {
    const refreshedExpiry = Math.min(Date.now() + SESSION_TTL_MS, absoluteExpiry);
    await db
      .update(sessions)
      .set({ expires_at: new Date(refreshedExpiry) })
      .where(eq(sessions.id, id));
  }
  return row.user;
}

export async function invalidateSession(token: string | undefined | null): Promise<void> {
  if (!token) return;
  await getDb()
    .delete(sessions)
    .where(eq(sessions.id, sha256(token)));
}

// --- Request helpers ---

/** Read+validate the session straight from a raw Request's Cookie header. */
export async function getUserFromRequest(request: Request): Promise<User | null> {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  const token = parseCookie(cookie, SESSION_COOKIE);
  return validateSessionToken(token);
}

function parseCookie(header: string, name: string): string | undefined {
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Cookie options for the session cookie. */
export function sessionCookieOptions(maxAgeMs: number = SESSION_TTL_MS) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(maxAgeMs / 1000),
    priority: "high" as const,
  };
}
