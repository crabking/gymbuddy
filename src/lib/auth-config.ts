export type AuthProvider = "local" | "clerk";

const frontendProvider = import.meta.env.VITE_AUTH_PROVIDER?.trim().toLowerCase();

/** Client-safe switch. Both values are public and intentionally build-time. */
export const clerkFrontendEnabled =
  frontendProvider === "clerk" && Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim());

export const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() || undefined;

export const publicSignupsEnabled =
  import.meta.env.VITE_PUBLIC_SIGNUPS_ENABLED?.trim().toLowerCase() === "true";
