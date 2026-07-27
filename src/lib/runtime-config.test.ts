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
});
