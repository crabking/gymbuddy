import type { QueryClient } from "@tanstack/react-query";

let redirectingToAuth = false;

export function isUnauthorizedError(error: unknown): boolean {
  if (error instanceof Response) return error.status === 401;
  if (!error || typeof error !== "object") return false;

  const record = error as Record<string, unknown>;
  const status = record.status ?? record.statusCode;
  if (status === 401) return true;

  const message =
    typeof record.message === "string"
      ? record.message
      : error instanceof Error
        ? error.message
        : "";
  return /\bunauthori[sz]ed\b|\bstatus(?:Code)?\D*401\b/i.test(message);
}

/**
 * Account data is deliberately memory-only. Clear it before a hard auth
 * navigation so another account can never inherit the previous user's cache.
 */
export async function hardNavigateToAuth(queryClient: QueryClient): Promise<void> {
  if (typeof window === "undefined" || redirectingToAuth) return;
  redirectingToAuth = true;
  try {
    await queryClient.cancelQueries();
  } finally {
    queryClient.clear();
    window.location.replace("/auth");
  }
}

export async function clearAccountCache(queryClient: QueryClient): Promise<void> {
  await queryClient.cancelQueries();
  queryClient.clear();
}
