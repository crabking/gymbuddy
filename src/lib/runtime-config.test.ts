import { afterEach, describe, expect, it } from "vitest";
import { readinessConfiguration, runtimeEnvironment } from "./runtime-config.server";

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

function configureBetterAuth() {
  process.env.AUTH_PROVIDER = "better-auth";
  process.env.VITE_AUTH_PROVIDER = "better-auth";
  process.env.BETTER_AUTH_SECRET = "a".repeat(32);
  process.env.SMTP_HOST = "smtp.example.test";
  process.env.SMTP_FROM = "COACH <coach@example.test>";
  process.env.PUBLIC_SIGNUPS_ENABLED = "false";
  process.env.VITE_PUBLIC_SIGNUPS_ENABLED = "false";
}

describe("runtime configuration", () => {
  it("rejects unknown environments", () => {
    process.env.APP_ENV = "prod-ish";
    expect(runtimeEnvironment()).toBe("invalid");
  });

  it("requires a legal identity and Better Auth in production", () => {
    process.env.APP_ENV = "production";
    process.env.DATABASE_URL = "postgres://example";
    process.env.AI_API_KEY = "test";
    process.env.PUBLIC_ORIGIN = "https://coach.example";
    process.env.TRUST_PROXY_HEADERS = "true";
    process.env.AUTH_PROVIDER = "local";
    process.env.VITE_AUTH_PROVIDER = "local";
    process.env.PUBLIC_SIGNUPS_ENABLED = "false";
    process.env.VITE_PUBLIC_SIGNUPS_ENABLED = "false";
    delete process.env.LEGAL_OPERATOR_NAME;
    delete process.env.LEGAL_CONTACT_EMAIL;
    const checks = readinessConfiguration().checks;
    expect(checks.legal_identity).toBe(false);
    expect(checks.managed_auth).toBe(false);
  });

  it("requires a strong secret, SMTP, and matching frontend mode", () => {
    configureBetterAuth();
    delete process.env.SMTP_HOST;
    expect(readinessConfiguration().checks.auth_email).toBe(false);
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.BETTER_AUTH_SECRET = "too-short";
    expect(readinessConfiguration().checks.better_auth_secret).toBe(false);
    process.env.BETTER_AUTH_SECRET = "a".repeat(32);
    process.env.VITE_AUTH_PROVIDER = "local";
    expect(readinessConfiguration().checks.auth_frontend_match).toBe(false);
  });

  it("does not allow the server and browser sign-up switches to disagree", () => {
    configureBetterAuth();
    process.env.PUBLIC_SIGNUPS_ENABLED = "true";
    expect(readinessConfiguration().checks.signup_mode_match).toBe(false);
    process.env.VITE_PUBLIC_SIGNUPS_ENABLED = "true";
    expect(readinessConfiguration().checks.signup_mode_match).toBe(true);
  });

  it("requires complete Stripe, tax, and portal configuration", () => {
    configureBetterAuth();
    process.env.BILLING_PROVIDER = "stripe";
    process.env.STRIPE_SECRET_KEY = "sk_test_example";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_example";
    process.env.STRIPE_MONTHLY_PRICE_ID = "price_monthly";
    delete process.env.STRIPE_ANNUAL_PRICE_ID;
    expect(readinessConfiguration().checks.stripe_configuration).toBe(false);

    process.env.STRIPE_ANNUAL_PRICE_ID = "price_annual";
    process.env.STRIPE_AUTOMATIC_TAX = "true";
    process.env.STRIPE_EU_TAX_CONFIGURED = "true";
    process.env.STRIPE_CUSTOMER_PORTAL_CONFIGURED = "true";
    const checks = readinessConfiguration().checks;
    expect(checks.stripe_configuration).toBe(true);
    expect(checks.stripe_tax).toBe(true);
    expect(checks.stripe_portal).toBe(true);
    expect(checks.billing_auth_match).toBe(true);
  });
});
