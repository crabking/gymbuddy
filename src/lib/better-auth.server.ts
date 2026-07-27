import { createHash } from "node:crypto";
import { stripe } from "@better-auth/stripe";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth";
import { admin, twoFactor } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/db.server";
import { profiles, stripeEvents, users } from "@/db/schema";
import { authLinkEmail } from "@/lib/email.server";
import { hashPasswordAsync, verifyPassword } from "@/lib/auth.server";
import { getStripe, stripeCheckoutEnabled, stripePriceId } from "@/lib/stripe.server";

const localDevelopmentSecret =
  "coach-local-development-only-secret-change-before-any-public-environment";

function secret() {
  const configured = process.env.BETTER_AUTH_SECRET?.trim();
  if (configured) return configured;
  if (!process.env.APP_ENV || process.env.APP_ENV === "local") return localDevelopmentSecret;
  throw new Error("Missing BETTER_AUTH_SECRET");
}

function publicOrigin() {
  return process.env.PUBLIC_ORIGIN?.trim().replace(/\/+$/, "") || "http://localhost:8080";
}

function trustedOrigins() {
  const origins = new Set([new URL(publicOrigin()).origin]);
  for (const value of (process.env.AUTH_TRUSTED_ORIGINS || "").split(",")) {
    const configured = value.trim();
    if (!configured) continue;
    const parsed = new URL(configured);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("AUTH_TRUSTED_ORIGINS accepts only HTTP(S) origins");
    }
    origins.add(parsed.origin);
  }
  return [...origins];
}

function publicSignupsEnabled() {
  return process.env.PUBLIC_SIGNUPS_ENABLED === "true";
}

async function ensureAppUser(authUser: { id: string; email: string; name?: string | null }) {
  await getDb().transaction(async (tx) => {
    await tx
      .insert(users)
      .values({ id: authUser.id, email: authUser.email.toLowerCase() })
      .onConflictDoUpdate({
        target: users.id,
        set: { email: authUser.email.toLowerCase() },
      });
    await tx
      .insert(profiles)
      .values({ id: authUser.id, display_name: authUser.name?.trim() || null })
      .onConflictDoNothing({ target: profiles.id });
    if (authUser.name?.trim()) {
      await tx
        .update(profiles)
        .set({ display_name: authUser.name.trim() })
        .where(eq(profiles.id, authUser.id));
    }
  });
}

async function cancelBillingBeforeDelete(user: { id: string; stripeCustomerId?: string | null }) {
  if (!user.stripeCustomerId) return;
  if (!process.env.STRIPE_SECRET_KEY?.trim()) {
    throw new APIError("BAD_REQUEST", {
      message:
        "This subscribed account needs administrator-assisted deletion because Stripe is unavailable",
    });
  }
  const stripeClient = getStripe();
  for await (const subscription of stripeClient.subscriptions.list({
    customer: user.stripeCustomerId,
    status: "all",
  })) {
    if (["canceled", "incomplete_expired"].includes(subscription.status)) continue;
    await stripeClient.subscriptions.cancel(subscription.id);
  }
  try {
    await stripeClient.customers.del(user.stripeCustomerId);
  } catch (error) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "resource_missing"
    )) {
      throw error;
    }
  }
}

function stripePlugin() {
  if (!stripeCheckoutEnabled()) return null;
  const monthly = stripePriceId("monthly");
  const annual = stripePriceId("annual");
  if (!monthly || !annual) return null;
  return stripe({
    stripeClient: getStripe(),
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET!.trim(),
    createCustomerOnSignUp: false,
    subscription: {
      enabled: true,
      requireEmailVerification: true,
      plans: [
        {
          name: "coach",
          priceId: monthly,
          annualDiscountPriceId: annual,
        },
      ],
      authorizeReference: async ({ user, referenceId }) => user.id === referenceId,
      getCheckoutSessionParams: async () => ({
        params: {
          automatic_tax: { enabled: true },
          tax_id_collection: { enabled: true },
          billing_address_collection: "required",
          customer_update: { address: "auto", name: "auto" },
          allow_promotion_codes: true,
        },
      }),
    },
    schema: {
      user: { modelName: "authUsers" },
      subscription: { modelName: "billingSubscriptions" },
    },
    onEvent: async (event) => {
      const object = event.data.object as { id?: string };
      await getDb()
        .insert(stripeEvents)
        .values({
          id: event.id,
          event_type: event.type,
          entity_id: object.id ?? null,
          payload_sha256: createHash("sha256").update(JSON.stringify(event)).digest("hex"),
        })
        .onConflictDoNothing({ target: stripeEvents.id });
    },
  });
}

const optionalStripePlugin = stripePlugin();
const configuredAdminIds = (process.env.ADMIN_USER_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const passwordMutationPaths = new Set([
  "/sign-up/email",
  "/reset-password",
  "/change-password",
  "/set-password",
  "/admin/create-user",
]);

export const auth = betterAuth({
  appName: "COACH",
  secret: secret(),
  baseURL: publicOrigin(),
  trustedOrigins: trustedOrigins(),
  database: drizzleAdapter(getDb(), {
    provider: "pg",
    schema,
  }),
  advanced: {
    database: { generateId: "uuid" },
    useSecureCookies: publicOrigin().startsWith("https://"),
    ipAddress:
      process.env.TRUST_PROXY_HEADERS === "true"
        ? { ipAddressHeaders: ["x-real-ip"] }
        : { disableIpTracking: true },
  },
  rateLimit: {
    enabled: process.env.NODE_ENV === "production" || process.env.AUTH_RATE_LIMIT_LOCAL === "true",
    storage: "database",
    modelName: "authRateLimits",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60 * 15, max: 3 },
      "/request-password-reset": { window: 60 * 15, max: 3 },
    },
  },
  user: {
    modelName: "authUsers",
    changeEmail: {
      enabled: true,
      sendChangeEmailVerification: async ({ newEmail, url }: { newEmail: string; url: string }) => {
        await authLinkEmail({ kind: "change-email", to: newEmail, url });
      },
    },
    deleteUser: {
      enabled: true,
      beforeDelete: cancelBillingBeforeDelete,
    },
  },
  session: {
    modelName: "authSessions",
    expiresIn: 60 * 60 * 24 * 7,
    disableSessionRefresh: true,
    freshAge: 60 * 10,
  },
  account: { modelName: "authAccounts" },
  verification: { modelName: "authVerifications" },
  emailAndPassword: {
    enabled: true,
    disableSignUp: !publicSignupsEnabled(),
    requireEmailVerification: true,
    // Existing private-beta accounts include shorter passwords. Sign-in keeps
    // those hashes usable, while the request hook below enforces 10+ characters
    // for every newly created or changed password.
    minPasswordLength: 1,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    password: {
      hash: hashPasswordAsync,
      verify: async ({ hash, password }) => verifyPassword(password, hash),
    },
    sendResetPassword: async ({ user, url }) => {
      await authLinkEmail({ kind: "reset", to: user.email, url });
    },
    customSyntheticUser: ({ coreFields, additionalFields, id }) => ({
      ...coreFields,
      role: "user",
      banned: false,
      banReason: null,
      banExpires: null,
      twoFactorEnabled: false,
      stripeCustomerId: null,
      ...additionalFields,
      id,
    }),
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60,
    sendVerificationEmail: async ({ user, url }) => {
      await authLinkEmail({ kind: "verify", to: user.email, url });
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (!passwordMutationPaths.has(ctx.path)) return;
      const body = ctx.body as { password?: unknown; newPassword?: unknown } | undefined;
      const password =
        typeof body?.newPassword === "string"
          ? body.newPassword
          : typeof body?.password === "string"
            ? body.password
            : "";
      if (password.length < 10) {
        throw new APIError("BAD_REQUEST", {
          message: "New passwords must contain at least 10 characters",
        });
      }
    }),
  },
  databaseHooks: {
    user: {
      create: {
        after: ensureAppUser,
      },
      update: {
        after: ensureAppUser,
      },
      delete: {
        after: async (authUser) => {
          await getDb().delete(users).where(eq(users.id, authUser.id));
        },
      },
    },
  },
  plugins: [
    admin({
      defaultRole: "user",
      adminRoles: ["admin"],
      ...(configuredAdminIds.length ? { adminUserIds: configuredAdminIds } : {}),
      impersonationSessionDuration: 60 * 30,
      schema: {
        user: { modelName: "authUsers" },
        session: { modelName: "authSessions" },
      },
    }),
    twoFactor({
      issuer: "COACH",
      twoFactorTable: "authTwoFactors",
      twoFactorCookieMaxAge: 60 * 10,
      trustDeviceMaxAge: 60 * 60 * 24 * 30,
      schema: {
        user: { modelName: "authUsers" },
        twoFactor: { modelName: "authTwoFactors" },
      },
    }),
    ...(optionalStripePlugin ? [optionalStripePlugin] : []),
    tanstackStartCookies(),
  ],
});
