import { createServerFn } from "@tanstack/react-start";
import { desc, eq } from "drizzle-orm";
import { requireIdentity } from "@/lib/auth-middleware";

export const getBillingState = createServerFn({ method: "GET" })
  .middleware([requireIdentity])
  .handler(async ({ context }) => {
    const { billingProvider, clerkBillingEnabled } = await import("./auth-config.server");
    if (!clerkBillingEnabled()) {
      return {
        enabled: false as const,
        provider: billingProvider(),
        subscriptions: [],
        payments: [],
      };
    }
    const { getDb } = await import("@/db/db.server");
    const { billingPayments, billingSubscriptions } = await import("@/db/schema");
    const [subscriptions, payments] = await Promise.all([
      getDb()
        .select()
        .from(billingSubscriptions)
        .where(eq(billingSubscriptions.user_id, context.userId))
        .orderBy(desc(billingSubscriptions.updated_at)),
      getDb()
        .select()
        .from(billingPayments)
        .where(eq(billingPayments.user_id, context.userId))
        .orderBy(desc(billingPayments.occurred_at))
        .limit(25),
    ]);
    return { enabled: true as const, provider: "clerk" as const, subscriptions, payments };
  });
