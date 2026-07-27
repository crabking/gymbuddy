import { createServerFn } from "@tanstack/react-start";
import { deleteCookie, getCookie } from "@tanstack/react-start/server";
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
    if (authProvider() === "clerk") {
      if (!context.user.clerk_user_id) throw new Error("Clerk account is not linked");
      const { clerkClient } = await import("@clerk/tanstack-react-start/server");
      // Clerk revokes the external identity first. If the local delete fails,
      // the verified user.deleted webhook completes the same cascading delete.
      await clerkClient().users.deleteUser(context.user.clerk_user_id);
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
