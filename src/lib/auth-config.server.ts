import type { AuthProvider } from "./auth-config";

export type BillingProvider = "disabled" | "clerk";

export function authProvider(): AuthProvider {
  return process.env.AUTH_PROVIDER?.trim().toLowerCase() === "clerk" ? "clerk" : "local";
}

export function billingProvider(): BillingProvider {
  return process.env.BILLING_PROVIDER?.trim().toLowerCase() === "clerk" ? "clerk" : "disabled";
}

export function clerkServerConfigured() {
  return Boolean(
    process.env.CLERK_SECRET_KEY?.trim() &&
    process.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() &&
    process.env.CLERK_WEBHOOK_SIGNING_SECRET?.trim(),
  );
}

export function clerkBillingEnabled() {
  return authProvider() === "clerk" && billingProvider() === "clerk";
}
