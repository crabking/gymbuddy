export type AuthProvider = "local" | "better-auth";

const frontendProvider = import.meta.env.VITE_AUTH_PROVIDER?.trim().toLowerCase();

/** Client-safe switch. Both values are public and intentionally build-time. */
export const betterAuthFrontendEnabled = frontendProvider === "better-auth";

export const publicSignupsEnabled =
  import.meta.env.VITE_PUBLIC_SIGNUPS_ENABLED?.trim().toLowerCase() === "true";
