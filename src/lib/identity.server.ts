import { eq, sql } from "drizzle-orm";
import type { User as ClerkUser } from "@clerk/backend";
import { auth, clerkClient } from "@clerk/tanstack-react-start/server";
import { getRequest } from "@tanstack/react-start/server";
import { getDb } from "@/db/db.server";
import { billingPayments, billingSubscriptions, profiles, users, type User } from "@/db/schema";
import { authProvider } from "@/lib/auth-config.server";
import { getUserFromRequest } from "@/lib/auth.server";

export type ClerkIdentity = {
  id: string;
  email: string;
  emailVerified: boolean;
  externalId: string | null;
  displayName: string | null;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function displayName(firstName: string | null, lastName: string | null) {
  const value = [firstName, lastName].filter(Boolean).join(" ").trim();
  return value || null;
}

export function normalizeClerkUser(user: ClerkUser): ClerkIdentity {
  const primary =
    user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId) ??
    user.emailAddresses[0];
  if (!primary?.emailAddress) throw new Error("Clerk account needs an email address");
  return {
    id: user.id,
    email: normalizeEmail(primary.emailAddress),
    emailVerified: primary.verification?.status === "verified",
    externalId: user.externalId,
    displayName: displayName(user.firstName, user.lastName),
  };
}

/**
 * Map Clerk identity to the app's stable UUID. A verified matching email claims
 * an existing invited account, preserving all historical training data.
 */
export async function provisionClerkIdentity(identity: ClerkIdentity): Promise<User> {
  if (!identity.emailVerified) throw new Error("Verify your email before using COACH");
  const email = normalizeEmail(identity.email);
  const externalUuid =
    identity.externalId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      identity.externalId,
    )
      ? identity.externalId
      : null;

  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"clerk:" + identity.id}, 0))`,
    );

    const [linkedByClerk] = await tx
      .select()
      .from(users)
      .where(eq(users.clerk_user_id, identity.id))
      .limit(1);
    const [linkedByExternalId] =
      !linkedByClerk && externalUuid
        ? await tx.select().from(users).where(eq(users.id, externalUuid)).limit(1)
        : [];
    const [linkedByEmail] =
      !linkedByClerk && !linkedByExternalId
        ? await tx.select().from(users).where(eq(users.email, email)).limit(1)
        : [];
    const existing = linkedByClerk ?? linkedByExternalId ?? linkedByEmail;

    if (existing?.clerk_user_id && existing.clerk_user_id !== identity.id) {
      throw new Error("This COACH account is already linked to another Clerk identity");
    }

    if (existing && existing.email !== email) {
      const [emailOwner] = await tx.select().from(users).where(eq(users.email, email)).limit(1);
      if (emailOwner && emailOwner.id !== existing.id) {
        throw new Error("This email is already linked to another COACH account");
      }
    }

    let user: User;
    if (existing) {
      const [updated] = await tx
        .update(users)
        .set({
          clerk_user_id: identity.id,
          auth_provider: "clerk",
          email,
        })
        .where(eq(users.id, existing.id))
        .returning();
      if (!updated) throw new Error("Could not link Clerk account");
      user = updated;
    } else {
      const [created] = await tx
        .insert(users)
        .values({
          email,
          password_hash: null,
          auth_provider: "clerk",
          clerk_user_id: identity.id,
        })
        .returning();
      if (!created) throw new Error("Could not provision Clerk account");
      user = created;
    }

    await tx
      .insert(profiles)
      .values({ id: user.id, display_name: identity.displayName })
      .onConflictDoNothing({ target: profiles.id });
    // Billing events can arrive before user.created or the first authenticated
    // request. Repair those privacy-minimal mirrors as part of provisioning so
    // entitlements never depend on webhook delivery order.
    await tx
      .update(billingSubscriptions)
      .set({ user_id: user.id })
      .where(eq(billingSubscriptions.clerk_user_id, identity.id));
    await tx
      .update(billingPayments)
      .set({ user_id: user.id })
      .where(eq(billingPayments.clerk_user_id, identity.id));
    return user;
  });
}

export async function getClerkAppUser(): Promise<User | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const db = getDb();
  const [existing] = await db.select().from(users).where(eq(users.clerk_user_id, userId)).limit(1);
  if (existing) return existing;

  const clerkUser = await clerkClient().users.getUser(userId);
  const user = await provisionClerkIdentity(normalizeClerkUser(clerkUser));
  if (!clerkUser.externalId) {
    // The local row is already durable; this reverse pointer is a repair aid,
    // so a transient Clerk API failure must not block the user's session.
    void clerkClient()
      .users.updateUser(userId, { externalId: user.id })
      .catch((error) => {
        console.error("Could not attach app UUID to Clerk user", error);
      });
  }
  return user;
}

export async function getAuthenticatedUser(request: Request = getRequest()): Promise<User | null> {
  return authProvider() === "clerk" ? getClerkAppUser() : getUserFromRequest(request);
}
