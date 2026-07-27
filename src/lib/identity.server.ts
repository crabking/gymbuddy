import { eq } from "drizzle-orm";
import { getRequest } from "@tanstack/react-start/server";
import { getDb } from "@/db/db.server";
import { profiles, users, type User } from "@/db/schema";
import { authProvider } from "@/lib/auth-config.server";
import { getUserFromRequest } from "@/lib/auth.server";

async function getBetterAuthAppUser(request: Request): Promise<User | null> {
  const { auth } = await import("@/lib/better-auth.server");
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) return null;

  const db = getDb();
  const [existing] = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
  if (existing) {
    if (existing.email !== session.user.email.toLowerCase()) {
      const [updated] = await db
        .update(users)
        .set({ email: session.user.email.toLowerCase() })
        .where(eq(users.id, existing.id))
        .returning();
      return updated ?? existing;
    }
    return existing;
  }

  // Self-heal a signup whose post-create hook was interrupted. The auth UUID
  // remains the application UUID, so no training ownership can drift.
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(users)
      .values({ id: session.user.id, email: session.user.email.toLowerCase() })
      .onConflictDoNothing()
      .returning();
    await tx
      .insert(profiles)
      .values({ id: session.user.id, display_name: session.user.name?.trim() || null })
      .onConflictDoNothing({ target: profiles.id });
    if (created) return created;
    const [repaired] = await tx.select().from(users).where(eq(users.id, session.user.id)).limit(1);
    if (!repaired) throw new Error("Could not provision COACH identity");
    return repaired;
  });
}

export async function getAuthenticatedUser(request: Request = getRequest()): Promise<User | null> {
  return authProvider() === "better-auth"
    ? getBetterAuthAppUser(request)
    : getUserFromRequest(request);
}
