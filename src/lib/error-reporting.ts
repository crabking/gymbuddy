// Client-side error reporter for React error boundaries.
//
// Currently logs to the console. Swap the body for your own telemetry sink
// (Sentry, PostHog, a custom endpoint, etc.) if you want centralized error
// tracking once self-hosted.
export function reportError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;

  // Loaders and server fns commonly throw a raw Response; String(it) is the
  // opaque "[object Response]", so pull out the status and URL instead.
  const message =
    error instanceof Response
      ? `Response ${error.status}${error.url ? ` at ${error.url}` : ""}`
      : error instanceof Error
        ? error.message
        : String(error);

  console.error("[app error]", message, {
    route: window.location.pathname,
    ...context,
    stack: error instanceof Error ? error.stack : undefined,
  });
}
