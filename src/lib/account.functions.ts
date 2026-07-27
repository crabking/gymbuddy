import { createServerFn } from "@tanstack/react-start";
import { deleteCookie, getCookie, getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireIdentity } from "@/lib/auth-middleware";

const DeleteAccountSchema = z
  .object({
    password: z.string().max(1_024).optional(),
    confirmation: z.literal("DELETE"),
  })
  .strict();

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireIdentity])
  .validator((input: unknown) => DeleteAccountSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { authProvider } = await import("@/lib/auth-config.server");
    const { eq } = await import("drizzle-orm");
    const { getDb } = await import("@/db/db.server");
    const { users } = await import("@/db/schema");
    const { SESSION_COOKIE, invalidateSession, sessionCookieOptions, verifyPassword } =
      await import("@/lib/auth.server");
    if (authProvider() === "better-auth") {
      if (!data.password) throw new Error("Password is required");
      const { auth } = await import("@/lib/better-auth.server");
      await auth.api.deleteUser({
        body: { password: data.password },
        headers: getRequest().headers,
      });
      return { ok: true };
    } else {
      const valid =
        Boolean(data.password) &&
        Boolean(context.user.password_hash) &&
        (await verifyPassword(data.password!, context.user.password_hash!));
      if (!valid) throw new Error("Invalid password");
    }

    const token = getCookie(SESSION_COOKIE);
    await getDb().delete(users).where(eq(users.id, context.userId));
    await invalidateSession(token);
    deleteCookie(SESSION_COOKIE, sessionCookieOptions());
    return { ok: true };
  });
