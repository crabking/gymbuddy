import { z } from "zod";

export const analyticsEventNames = [
  "page_view",
  "signup_started",
  "signup_completed",
  "login_completed",
  "onboarding_completed",
  "checkout_started",
  "checkout_completed",
  "subscription_activated",
  "subscription_cancelled",
  "payment_succeeded",
  "payment_failed",
  "payment_refunded",
  "chat_user_message",
  "chat_assistant_message",
] as const;

export type AnalyticsEventName = (typeof analyticsEventNames)[number];
export type ClientAnalyticsEventName = "page_view" | "signup_started" | "checkout_started";

const campaignValue = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9._~ -]+$/);
const referrerHost = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[a-zA-Z0-9.-]+$/);

export const clientAnalyticsEventSchema = z
  .object({
    event_id: z.uuid(),
    event_name: z.enum(["page_view", "signup_started", "checkout_started"]),
    route: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(/^\/[a-zA-Z0-9_./-]*$/),
    properties: z
      .object({
        locale: z.enum(["en", "sv"]).optional(),
        interval: z.enum(["monthly", "annual"]).optional(),
        referrer_host: referrerHost.optional(),
        utm_source: campaignValue.optional(),
        utm_medium: campaignValue.optional(),
        utm_campaign: campaignValue.optional(),
      })
      .strict()
      .default({}),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.event_name === "checkout_started" && !value.properties.interval) {
      context.addIssue({
        code: "custom",
        path: ["properties", "interval"],
        message: "Checkout interval is required",
      });
    }
    if (value.event_name !== "checkout_started" && value.properties.interval) {
      context.addIssue({
        code: "custom",
        path: ["properties", "interval"],
        message: "Interval is accepted only for checkout events",
      });
    }
  });

export type ClientAnalyticsEvent = z.infer<typeof clientAnalyticsEventSchema>;

export type AiTokenUsage = {
  inputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
};

export type AiCostRates = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheReadUsdPerMillion: number;
  cacheWriteUsdPerMillion: number;
};

function validRate(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1_000_000 ? parsed : null;
}

export function aiCostRatesFromEnvironment(
  environment: Record<string, string | undefined>,
): AiCostRates | null {
  const input = validRate(environment.AI_COST_INPUT_USD_PER_MILLION);
  const output = validRate(environment.AI_COST_OUTPUT_USD_PER_MILLION);
  if (input === null || output === null) return null;
  return {
    inputUsdPerMillion: input,
    outputUsdPerMillion: output,
    cacheReadUsdPerMillion: validRate(environment.AI_COST_CACHE_READ_USD_PER_MILLION) ?? input,
    cacheWriteUsdPerMillion: validRate(environment.AI_COST_CACHE_WRITE_USD_PER_MILLION) ?? input,
  };
}

function nonNegativeInteger(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? -1) >= 0 ? Math.round(value ?? 0) : 0;
}

export function normalizeAiUsage(usage: AiTokenUsage | null | undefined) {
  const inputTokens = nonNegativeInteger(usage?.inputTokens);
  const cacheReadTokens = nonNegativeInteger(usage?.cacheReadTokens);
  const cacheWriteTokens = nonNegativeInteger(usage?.cacheWriteTokens);
  const outputTokens = nonNegativeInteger(usage?.outputTokens);
  const reasoningTokens = nonNegativeInteger(usage?.reasoningTokens);
  const totalTokens = nonNegativeInteger(usage?.totalTokens ?? inputTokens + outputTokens);
  return {
    inputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
  };
}

/**
 * Rates are USD per one million tokens. Multiplying tokens by that rate yields
 * micro-USD directly, avoiding floating-point currency amounts in storage.
 */
export function estimateAiCostMicrousd(
  usage: AiTokenUsage | null | undefined,
  rates: AiCostRates | null,
): number | null {
  if (!rates) return null;
  const normalized = normalizeAiUsage(usage);
  const uncachedInput = Math.max(
    0,
    normalized.inputTokens - normalized.cacheReadTokens - normalized.cacheWriteTokens,
  );
  return Math.max(
    0,
    Math.round(
      uncachedInput * rates.inputUsdPerMillion +
        normalized.cacheReadTokens * rates.cacheReadUsdPerMillion +
        normalized.cacheWriteTokens * rates.cacheWriteUsdPerMillion +
        normalized.outputTokens * rates.outputUsdPerMillion,
    ),
  );
}

export function safeAnalyticsRoute(value: string): string {
  try {
    const route = new URL(value, "https://coach.invalid").pathname;
    return /^\/[a-zA-Z0-9_./-]*$/.test(route) && route.length <= 160 ? route : "/";
  } catch {
    return "/";
  }
}
