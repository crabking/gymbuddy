import Stripe from "stripe";
import { billingProvider } from "@/lib/auth-config.server";

export const STRIPE_PLAN_KEYS = ["monthly", "annual"] as const;
export type StripePlanKey = (typeof STRIPE_PLAN_KEYS)[number];

let client: Stripe | null = null;
let planCache:
  | {
      expiresAt: number;
      plans: Array<{
        key: StripePlanKey;
        amount_minor: number;
        currency: string;
        interval: string;
        interval_count: number;
      }>;
    }
  | undefined;

export function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) throw new Error("Stripe is not configured");
  client ??= new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 20_000 });
  return client;
}

export function stripePriceId(plan: StripePlanKey) {
  const value =
    plan === "monthly" ? process.env.STRIPE_MONTHLY_PRICE_ID : process.env.STRIPE_ANNUAL_PRICE_ID;
  return value?.trim() || null;
}

export function stripeCheckoutEnabled() {
  return Boolean(
    billingProvider() === "stripe" &&
    process.env.STRIPE_SECRET_KEY?.trim() &&
    process.env.STRIPE_WEBHOOK_SECRET?.trim() &&
    stripePriceId("monthly") &&
    stripePriceId("annual") &&
    process.env.STRIPE_AUTOMATIC_TAX === "true" &&
    process.env.STRIPE_EU_TAX_CONFIGURED === "true" &&
    process.env.STRIPE_CUSTOMER_PORTAL_CONFIGURED === "true",
  );
}

export async function getStripePlanSummaries() {
  if (planCache && planCache.expiresAt > Date.now()) return planCache.plans;
  const stripe = getStripe();
  const configured = STRIPE_PLAN_KEYS.flatMap((key) => {
    const priceId = stripePriceId(key);
    return priceId ? [{ key, priceId }] : [];
  });
  const plans = await Promise.all(
    configured.map(async ({ key, priceId }) => {
      const price = await stripe.prices.retrieve(priceId);
      if (
        !price.active ||
        price.type !== "recurring" ||
        !price.recurring ||
        price.unit_amount == null
      ) {
        throw new Error(`Stripe ${key} price must be an active fixed recurring price`);
      }
      return {
        key,
        amount_minor: price.unit_amount,
        currency: price.currency.toUpperCase(),
        interval: price.recurring.interval,
        interval_count: price.recurring.interval_count,
      };
    }),
  );
  planCache = { expiresAt: Date.now() + 5 * 60_000, plans };
  return plans;
}
