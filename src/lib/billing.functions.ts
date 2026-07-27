import { createServerFn } from "@tanstack/react-start";
import { desc, eq } from "drizzle-orm";
import { requireIdentity } from "@/lib/auth-middleware";

export const getBillingState = createServerFn({ method: "GET" })
  .middleware([requireIdentity])
  .handler(async ({ context }) => {
    const { billingProvider } = await import("@/lib/auth-config.server");
    const { getDb } = await import("@/db/db.server");
    const { authUsers, billingSubscriptions } = await import("@/db/schema");
    const { getStripePlanSummaries, stripeCheckoutEnabled } = await import("@/lib/stripe.server");
    const db = getDb();
    const [subscriptions, authRows] = await Promise.all([
      db
        .select()
        .from(billingSubscriptions)
        .where(eq(billingSubscriptions.referenceId, context.userId))
        .orderBy(desc(billingSubscriptions.periodEnd)),
      db
        .select({ stripeCustomerId: authUsers.stripeCustomerId })
        .from(authUsers)
        .where(eq(authUsers.id, context.userId))
        .limit(1),
    ]);
    const configured = stripeCheckoutEnabled();
    let plans: Awaited<ReturnType<typeof getStripePlanSummaries>> = [];
    let temporarilyUnavailable = false;
    if (configured) {
      try {
        plans = await getStripePlanSummaries();
      } catch {
        temporarilyUnavailable = true;
      }
    }
    return {
      enabled: configured && !temporarilyUnavailable,
      configured,
      temporarily_unavailable: temporarilyUnavailable,
      provider: billingProvider(),
      has_customer: Boolean(authRows[0]?.stripeCustomerId),
      plans,
      subscriptions,
      billing_records_note:
        "Payment methods, invoices, and tax records remain in Stripe and are available through the secure billing portal.",
    };
  });
