import type { AuthProvider } from "./auth-config";

export type BillingProvider = "disabled" | "stripe";

export function authProvider(): AuthProvider {
  return process.env.AUTH_PROVIDER?.trim().toLowerCase() === "better-auth"
    ? "better-auth"
    : "local";
}

export function billingProvider(): BillingProvider {
  return process.env.BILLING_PROVIDER?.trim().toLowerCase() === "stripe" ? "stripe" : "disabled";
}

export function emailDeliveryEnabled() {
  return process.env.EMAIL_DELIVERY_ENABLED === "true";
}
