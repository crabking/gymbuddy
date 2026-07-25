import { createServerFn } from "@tanstack/react-start";
import { setCookie, deleteCookie, getCookie, getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { COACH_IDS } from "@/lib/coaches";

// Server-only modules that pull in `pg` are imported dynamically inside the
// handlers so they never reach the client bundle.

const LoginSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(1024),
    coach_id: z.enum(COACH_IDS).optional(),
    preferred_language: z.enum(["en", "sv"]).optional(),
  })
  .strict();

export const login = createServerFn({ method: "POST" })
  .validator((input: unknown) => LoginSchema.parse(input))
  .handler(async ({ data }) => {
    const request = getRequest();
    const {
      getClientAddress,
      privateRateLimitKey,
      resetDistributedRateLimit,
      takeDistributedRateLimit,
    } = await import("./security.server");
    const normalizedEmail = data.email.toLowerCase();
    const address = getClientAddress(request);
    const emailLimitKey = `login-email:${privateRateLimitKey(normalizedEmail)}`;
    const [ipLimit, emailLimit] = await Promise.all([
      takeDistributedRateLimit(`login-ip:${address}`, 15, 15 * 60_000),
      takeDistributedRateLimit(emailLimitKey, 10, 15 * 60_000),
    ]);
    if (!ipLimit.allowed || !emailLimit.allowed) {
      throw new Error("Too many login attempts. Please wait and try again.");
    }

    const { eq } = await import("drizzle-orm");
    const { getDb } = await import("@/db/db.server");
    const { profiles, users } = await import("@/db/schema");
    const {
      verifyPassword,
      createSession,
      invalidateSession,
      sessionCookieOptions,
      SESSION_COOKIE,
      DUMMY_PASSWORD_HASH,
    } = await import("./auth.server");

    const db = getDb();
    const [user] = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);

    const passwordIsValid = await verifyPassword(
      data.password,
      user?.password_hash ?? DUMMY_PASSWORD_HASH,
    );
    if (!user || !passwordIsValid) {
      throw new Error("Invalid email or password");
    }

    if (data.coach_id) {
      const { switchUserCoach } = await import("./coach-switch.server");
      await switchUserCoach(user.id, data.coach_id);
    }
    if (data.preferred_language) {
      await db
        .insert(profiles)
        .values({ id: user.id, preferred_language: data.preferred_language })
        .onConflictDoUpdate({
          target: profiles.id,
          set: { preferred_language: data.preferred_language },
        });
    }

    await invalidateSession(getCookie(SESSION_COOKIE));
    const { token } = await createSession(user.id);
    setCookie(SESSION_COOKIE, token, sessionCookieOptions());
    await resetDistributedRateLimit(emailLimitKey);
    return { ok: true };
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const { invalidateSession, SESSION_COOKIE, sessionCookieOptions } = await import("./auth.server");
  const token = getCookie(SESSION_COOKIE);
  await invalidateSession(token);
  deleteCookie(SESSION_COOKIE, sessionCookieOptions());
  return { ok: true };
});

export const getCurrentUser = createServerFn({ method: "GET" }).handler(async () => {
  const { getUserFromRequest } = await import("./auth.server");
  const user = await getUserFromRequest(getRequest());
  return user ? { id: user.id, email: user.email } : null;
});
