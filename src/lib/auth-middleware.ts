import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

// Guards server functions: resolves the session cookie to a user and puts
// { userId, user } on the context. Throws Unauthorized if there's no valid
// session. Replaces per-request RLS — every query must filter by context.userId.
export const requireAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { getUserFromRequest } = await import("./auth.server");
  const user = await getUserFromRequest(getRequest());
  if (!user) throw new Error("Unauthorized");
  return next({ context: { userId: user.id, user } });
});
