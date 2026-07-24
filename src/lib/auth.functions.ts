import { createServerFn } from "@tanstack/react-start";
import { setCookie, deleteCookie, getCookie, getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

// Server-only modules that pull in `pg` are imported dynamically inside the
// handlers so they never reach the client bundle.

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  coach_gender: z.enum(["male", "female"]).optional(),
});

export const login = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => LoginSchema.parse(input))
  .handler(async ({ data }) => {
    const { eq } = await import("drizzle-orm");
    const { getDb } = await import("@/db/db.server");
    const { users, profiles } = await import("@/db/schema");
    const { verifyPassword, createSession, sessionCookieOptions, SESSION_COOKIE } =
      await import("./auth.server");

    const [user] = await getDb()
      .select()
      .from(users)
      .where(eq(users.email, data.email.trim().toLowerCase()))
      .limit(1);

    if (!user || !verifyPassword(data.password, user.password_hash)) {
      throw new Error("Invalid email or password");
    }

    if (data.coach_gender) {
      await getDb()
        .insert(profiles)
        .values({ id: user.id, coach_gender: data.coach_gender })
        .onConflictDoUpdate({
          target: profiles.id,
          set: { coach_gender: data.coach_gender },
        });
    }

    const { token } = await createSession(user.id);
    setCookie(SESSION_COOKIE, token, sessionCookieOptions());
    return { ok: true };
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const { invalidateSession, SESSION_COOKIE, sessionCookieOptions } =
    await import("./auth.server");
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
