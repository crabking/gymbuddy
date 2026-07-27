import { afterEach, describe, expect, it } from "vitest";
import { stripeCheckoutEnabled, stripePriceId } from "./stripe.server";

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

function configureStripe() {
  process.env.BILLING_PROVIDER = "stripe";
  process.env.STRIPE_SECRET_KEY = "sk_test_example";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_example";
  process.env.STRIPE_MONTHLY_PRICE_ID = "price_month";
  process.env.STRIPE_ANNUAL_PRICE_ID = "price_year";
  process.env.STRIPE_AUTOMATIC_TAX = "true";
  process.env.STRIPE_EU_TAX_CONFIGURED = "true";
  process.env.STRIPE_CUSTOMER_PORTAL_CONFIGURED = "true";
}

describe("Stripe launch gate", () => {
  it("stays disabled until tax, webhook, and portal prerequisites are complete", () => {
    configureStripe();
    expect(stripeCheckoutEnabled()).toBe(true);
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(stripeCheckoutEnabled()).toBe(false);
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_example";
    process.env.STRIPE_EU_TAX_CONFIGURED = "false";
    expect(stripeCheckoutEnabled()).toBe(false);
  });

  it("requires both subscription intervals", () => {
    configureStripe();
    expect(stripePriceId("monthly")).toBe("price_month");
    expect(stripePriceId("annual")).toBe("price_year");
    delete process.env.STRIPE_ANNUAL_PRICE_ID;
    expect(stripeCheckoutEnabled()).toBe(false);
  });
});
