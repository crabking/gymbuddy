import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

async function authenticatedContext() {
  const { getAuthenticatedUser } = await import("./identity.server");
  const user = await getAuthenticatedUser(getRequest());
  if (!user) throw new Error("Unauthorized");
  return { userId: user.id, user };
}

/**
 * Identity-only middleware for the consent screen and account privacy tools.
 * Do not use this for ordinary product features.
 */
export const requireIdentity = createMiddleware({ type: "function" }).server(async ({ next }) => {
  return next({ context: await authenticatedContext() });
});

/**
 * Normal product guard. A valid login is insufficient until the account has
 * accepted the current versioned privacy, terms, and health disclosures.
 */
export const requireAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const context = await authenticatedContext();
  const { hasCurrentPolicyBundle } = await import("./policies");
  if (!hasCurrentPolicyBundle(context.user)) throw new Error("Consent required");
  return next({ context });
});
