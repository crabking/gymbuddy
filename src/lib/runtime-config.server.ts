export type RuntimeEnvironment = "local" | "staging" | "production";

export function runtimeEnvironment(): RuntimeEnvironment | "invalid" {
  const value = (
    process.env.APP_ENV || (process.env.NODE_ENV === "production" ? "production" : "local")
  )
    .trim()
    .toLowerCase();
  return value === "local" || value === "staging" || value === "production" ? value : "invalid";
}

export function readinessConfiguration() {
  const environment = runtimeEnvironment();
  const productionLike = environment === "staging" || environment === "production";
  const auth = process.env.AUTH_PROVIDER?.trim().toLowerCase() || "local";
  const frontendAuth = process.env.VITE_AUTH_PROVIDER?.trim().toLowerCase() || "local";
  const billing = process.env.BILLING_PROVIDER?.trim().toLowerCase() || "disabled";
  const clerkAuth = auth === "clerk";
  const clerkBilling = billing === "clerk";
  const checks = {
    environment: environment !== "invalid",
    database: Boolean(process.env.DATABASE_URL?.trim()),
    ai_key: Boolean(process.env.AI_API_KEY?.trim()),
    public_origin: !productionLike || isHttpsUrl(process.env.PUBLIC_ORIGIN),
    trusted_proxy: !productionLike || process.env.TRUST_PROXY_HEADERS === "true",
    legal_identity:
      environment !== "production" ||
      Boolean(process.env.LEGAL_OPERATOR_NAME?.trim() && process.env.LEGAL_CONTACT_EMAIL?.trim()),
    public_signup_disabled: process.env.PUBLIC_SIGNUPS_ENABLED !== "true",
    auth_provider: auth === "local" || auth === "clerk",
    auth_frontend_match: frontendAuth === auth,
    clerk_keys:
      !clerkAuth ||
      Boolean(
        process.env.CLERK_SECRET_KEY?.trim() &&
        process.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() &&
        process.env.CLERK_WEBHOOK_SIGNING_SECRET?.trim(),
      ),
    billing_provider: billing === "disabled" || billing === "clerk",
    billing_auth_match: !clerkBilling || clerkAuth,
    billing_live_acknowledged:
      !clerkBilling || process.env.CLERK_BILLING_LIMITATIONS_ACKNOWLEDGED === "true",
  };
  return {
    environment,
    checks,
    ready: Object.values(checks).every(Boolean),
  };
}

function isHttpsUrl(value: string | undefined) {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
