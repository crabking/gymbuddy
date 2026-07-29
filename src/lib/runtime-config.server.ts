import { aiCostRatesFromEnvironment } from "@/lib/analytics";

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
  const betterAuth = auth === "better-auth";
  const stripeBilling = billing === "stripe";
  const publicSignups = process.env.PUBLIC_SIGNUPS_ENABLED === "true";
  const frontendPublicSignups = process.env.VITE_PUBLIC_SIGNUPS_ENABLED === "true";
  const emailDelivery = process.env.EMAIL_DELIVERY_ENABLED === "true";
  const frontendEmailDelivery = process.env.VITE_EMAIL_DELIVERY_ENABLED === "true";
  const analyticsEmails = (process.env.ANALYTICS_ADMIN_EMAILS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const analyticsRetention = Number(process.env.ANALYTICS_RETENTION_DAYS || "760");
  const analyticsTimezone = process.env.ANALYTICS_TIMEZONE?.trim() || "Europe/Stockholm";
  let validAnalyticsTimezone = true;
  try {
    new Intl.DateTimeFormat("en", { timeZone: analyticsTimezone }).format(new Date());
  } catch {
    validAnalyticsTimezone = false;
  }
  const checks = {
    environment: environment !== "invalid",
    database: Boolean(process.env.DATABASE_URL?.trim()),
    ai_key: Boolean(process.env.AI_API_KEY?.trim()),
    public_origin: !productionLike || isHttpsUrl(process.env.PUBLIC_ORIGIN),
    trusted_proxy: !productionLike || process.env.TRUST_PROXY_HEADERS === "true",
    legal_identity:
      environment !== "production" ||
      Boolean(process.env.LEGAL_OPERATOR_NAME?.trim() && process.env.LEGAL_CONTACT_EMAIL?.trim()),
    auth_provider: auth === "local" || betterAuth,
    auth_frontend_match: frontendAuth === auth,
    managed_auth: !productionLike || betterAuth,
    better_auth_secret:
      !betterAuth || Boolean((process.env.BETTER_AUTH_SECRET?.trim().length || 0) >= 32),
    email_delivery_match: emailDelivery === frontendEmailDelivery,
    auth_email:
      !emailDelivery ||
      Boolean(betterAuth && process.env.SMTP_HOST?.trim() && process.env.SMTP_FROM?.trim()),
    signup_mode_match: publicSignups === frontendPublicSignups,
    public_signup_prerequisites:
      !publicSignups ||
      Boolean(
        betterAuth &&
        emailDelivery &&
        process.env.SMTP_HOST?.trim() &&
        process.env.SMTP_FROM?.trim() &&
        (!productionLike ||
          (process.env.LEGAL_OPERATOR_NAME?.trim() && process.env.LEGAL_CONTACT_EMAIL?.trim())),
      ),
    billing_provider: billing === "disabled" || stripeBilling,
    billing_auth_match: !stripeBilling || betterAuth,
    stripe_configuration:
      !stripeBilling ||
      Boolean(
        process.env.STRIPE_SECRET_KEY?.trim() &&
        process.env.STRIPE_WEBHOOK_SECRET?.trim() &&
        process.env.STRIPE_MONTHLY_PRICE_ID?.trim() &&
        process.env.STRIPE_ANNUAL_PRICE_ID?.trim(),
      ),
    stripe_tax:
      !stripeBilling ||
      (process.env.STRIPE_AUTOMATIC_TAX === "true" &&
        process.env.STRIPE_EU_TAX_CONFIGURED === "true"),
    stripe_portal: !stripeBilling || process.env.STRIPE_CUSTOMER_PORTAL_CONFIGURED === "true",
    analytics_hash_secret:
      !productionLike || Boolean((process.env.ANALYTICS_HASH_SECRET?.trim().length || 0) >= 32),
    analytics_admin_allowlist:
      !productionLike ||
      Boolean(
        analyticsEmails.length > 0 &&
        analyticsEmails.every((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)),
      ),
    analytics_ai_costs: !productionLike || Boolean(aiCostRatesFromEnvironment(process.env)),
    analytics_retention:
      Number.isInteger(analyticsRetention) &&
      analyticsRetention >= 30 &&
      analyticsRetention <= 3650,
    analytics_timezone: validAnalyticsTimezone,
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
