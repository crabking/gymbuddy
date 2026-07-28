import { createFileRoute } from "@tanstack/react-router";
import { clientAnalyticsEventSchema } from "@/lib/analytics";
import { recordClientAnalyticsEvent, visitorHashForRequest } from "@/lib/analytics.server";
import { getAuthenticatedUser } from "@/lib/identity.server";
import {
  isUnsafeCrossOriginRequest,
  readJsonBody,
  takeDistributedRateLimit,
} from "@/lib/security.server";

const responseHeaders = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
};

export const Route = createFileRoute("/api/analytics")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (isUnsafeCrossOriginRequest(request)) {
          return Response.json({ error: "Forbidden" }, { status: 403, headers: responseHeaders });
        }
        const visitorHash = visitorHashForRequest(request);
        const limit = await takeDistributedRateLimit(`analytics:${visitorHash}`, 600, 5 * 60_000);
        if (!limit.allowed) {
          return Response.json(
            { error: "Too many events" },
            {
              status: 429,
              headers: {
                ...responseHeaders,
                "Retry-After": String(limit.retryAfterSeconds),
              },
            },
          );
        }
        try {
          const event = clientAnalyticsEventSchema.parse(await readJsonBody(request, 4_096));
          const user = await getAuthenticatedUser(request);
          await recordClientAnalyticsEvent(request, user?.id ?? null, event);
          return new Response(null, { status: 204, headers: responseHeaders });
        } catch (error) {
          const status =
            error && typeof error === "object" && "status" in error
              ? Number((error as { status?: unknown }).status) || 400
              : 400;
          return Response.json(
            { error: "Invalid analytics event" },
            { status, headers: responseHeaders },
          );
        }
      },
    },
  },
});
