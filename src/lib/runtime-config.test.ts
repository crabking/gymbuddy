import { afterEach, describe, expect, it } from "vitest";
import { readinessConfiguration, runtimeEnvironment } from "./runtime-config.server";

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

describe("runtime configuration", () => {
  it("rejects unknown environments", () => {
    process.env.APP_ENV = "prod-ish";
    expect(runtimeEnvironment()).toBe("invalid");
  });

  it("requires a legal identity in production", () => {
    process.env.APP_ENV = "production";
    process.env.DATABASE_URL = "postgres://example";
    process.env.AI_API_KEY = "test";
    process.env.PUBLIC_ORIGIN = "https://coach.example";
    process.env.TRUST_PROXY_HEADERS = "true";
    delete process.env.LEGAL_OPERATOR_NAME;
    delete process.env.LEGAL_CONTACT_EMAIL;
    expect(readinessConfiguration().checks.legal_identity).toBe(false);
  });

  it("keeps public sign-up disabled by default", () => {
    delete process.env.PUBLIC_SIGNUPS_ENABLED;
    expect(readinessConfiguration().checks.public_signup_disabled).toBe(true);
  });

  it("requires every Clerk server key and matching frontend mode", () => {
    process.env.AUTH_PROVIDER = "clerk";
    process.env.VITE_AUTH_PROVIDER = "clerk";
    process.env.VITE_CLERK_PUBLISHABLE_KEY = "pk_test_example";
    process.env.CLERK_SECRET_KEY = "sk_test_example";
    delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    expect(readinessConfiguration().checks.clerk_keys).toBe(false);

    process.env.CLERK_WEBHOOK_SIGNING_SECRET = "whsec_example";
    expect(readinessConfiguration().checks.clerk_keys).toBe(true);
    process.env.VITE_AUTH_PROVIDER = "local";
    expect(readinessConfiguration().checks.auth_frontend_match).toBe(false);
  });

  it("keeps Clerk Billing behind an explicit limitations acknowledgement", () => {
    process.env.AUTH_PROVIDER = "clerk";
    process.env.VITE_AUTH_PROVIDER = "clerk";
    process.env.BILLING_PROVIDER = "clerk";
    delete process.env.CLERK_BILLING_LIMITATIONS_ACKNOWLEDGED;
    expect(readinessConfiguration().checks.billing_live_acknowledged).toBe(false);
    process.env.CLERK_BILLING_LIMITATIONS_ACKNOWLEDGED = "true";
    expect(readinessConfiguration().checks.billing_live_acknowledged).toBe(true);
  });
});
