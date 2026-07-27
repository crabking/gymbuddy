import { createServerFn } from "@tanstack/react-start";
import { deleteCookie, getCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireIdentity } from "@/lib/auth-middleware";

const DeleteAccountSchema = z
  .object({
    password: z.string().min(1).max(1_024),
    confirmation: z.literal("DELETE"),
  })
  .strict();

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireIdentity])
  .validator((input: unknown) => DeleteAccountSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { eq } = await import("drizzle-orm");
    const { getDb } = await import("@/db/db.server");
    const { users } = await import("@/db/schema");
    const { SESSION_COOKIE, invalidateSession, sessionCookieOptions, verifyPassword } =
      await import("@/lib/auth.server");
    const valid = await verifyPassword(data.password, context.user.password_hash);
    if (!valid) throw new Error("Invalid password");

    const token = getCookie(SESSION_COOKIE);
    await getDb().delete(users).where(eq(users.id, context.userId));
    await invalidateSession(token);
    deleteCookie(SESSION_COOKIE, sessionCookieOptions());
    return { ok: true };
  });
