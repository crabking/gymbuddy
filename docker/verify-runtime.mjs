const environment = (
  process.env.APP_ENV || (process.env.NODE_ENV === "production" ? "production" : "local")
)
  .trim()
  .toLowerCase();
const productionLike = environment === "staging" || environment === "production";
const auth = (process.env.AUTH_PROVIDER || "local").trim().toLowerCase();
const frontendAuth = (process.env.VITE_AUTH_PROVIDER || "local").trim().toLowerCase();
const billing = (process.env.BILLING_PROVIDER || "disabled").trim().toLowerCase();
const publicSignups = process.env.PUBLIC_SIGNUPS_ENABLED === "true";
const frontendPublicSignups = process.env.VITE_PUBLIC_SIGNUPS_ENABLED === "true";

const errors = [];
const requireValue = (name) => {
  if (!process.env[name]?.trim()) errors.push(`Missing ${name}`);
};

if (!["local", "staging", "production"].includes(environment)) {
  errors.push("APP_ENV must be local, staging, or production");
}
requireValue("DATABASE_URL");
requireValue("AI_API_KEY");

if (!["local", "better-auth"].includes(auth)) errors.push("Invalid AUTH_PROVIDER");
if (frontendAuth !== auth) errors.push("VITE_AUTH_PROVIDER must match AUTH_PROVIDER");
if (publicSignups !== frontendPublicSignups) {
  errors.push("VITE_PUBLIC_SIGNUPS_ENABLED must match PUBLIC_SIGNUPS_ENABLED");
}

if (productionLike) {
  try {
    if (new URL(process.env.PUBLIC_ORIGIN || "").protocol !== "https:") {
      errors.push("PUBLIC_ORIGIN must be canonical HTTPS");
    }
  } catch {
    errors.push("PUBLIC_ORIGIN must be canonical HTTPS");
  }
  if (process.env.TRUST_PROXY_HEADERS !== "true") {
    errors.push("TRUST_PROXY_HEADERS must be true behind Coolify");
  }
  if (auth !== "better-auth") errors.push("Public environments require Better Auth");
}

if (auth === "better-auth") {
  if ((process.env.BETTER_AUTH_SECRET?.trim().length || 0) < 32) {
    errors.push("BETTER_AUTH_SECRET must contain at least 32 characters");
  }
  requireValue("SMTP_HOST");
  requireValue("SMTP_FROM");
}

if (environment === "production" || (productionLike && publicSignups)) {
  requireValue("LEGAL_OPERATOR_NAME");
  requireValue("LEGAL_CONTACT_EMAIL");
}

if (!["disabled", "stripe"].includes(billing)) errors.push("Invalid BILLING_PROVIDER");
if (billing === "stripe") {
  if (auth !== "better-auth") errors.push("Stripe billing requires Better Auth");
  for (const name of [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_MONTHLY_PRICE_ID",
    "STRIPE_ANNUAL_PRICE_ID",
  ]) {
    requireValue(name);
  }
  if (process.env.STRIPE_AUTOMATIC_TAX !== "true") {
    errors.push("STRIPE_AUTOMATIC_TAX must be true");
  }
  if (process.env.STRIPE_EU_TAX_CONFIGURED !== "true") {
    errors.push("STRIPE_EU_TAX_CONFIGURED must be true");
  }
  if (process.env.STRIPE_CUSTOMER_PORTAL_CONFIGURED !== "true") {
    errors.push("STRIPE_CUSTOMER_PORTAL_CONFIGURED must be true");
  }
}

if (errors.length) {
  console.error(`[runtime] invalid configuration:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

console.log(`[runtime] configuration verified for ${environment}`);
