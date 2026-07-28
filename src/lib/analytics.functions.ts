import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAnalyticsAdmin } from "@/lib/auth-middleware";

const rangeSchema = z
  .object({
    range_days: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(365)]),
  })
  .strict();

export const getAdminAnalytics = createServerFn({ method: "GET" })
  .middleware([requireAnalyticsAdmin])
  .validator((input: unknown) => rangeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { takeRateLimit } = await import("@/lib/security.server");
    const limit = takeRateLimit(`admin-analytics:${context.userId}`, 120, 60_000);
    if (!limit.allowed) throw new Error("Analytics query rate limit exceeded");
    const { getBusinessAnalyticsSnapshot } = await import("@/lib/analytics.server");
    return getBusinessAnalyticsSnapshot(data.range_days);
  });
