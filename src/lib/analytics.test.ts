import { describe, expect, it } from "vitest";
import {
  aiCostRatesFromEnvironment,
  clientAnalyticsEventSchema,
  estimateAiCostMicrousd,
  normalizeAiUsage,
  safeAnalyticsRoute,
} from "@/lib/analytics";
import { analyticsAdminAccess } from "@/lib/analytics.server";

describe("privacy-minimal analytics", () => {
  it("accepts only the public events and allowlisted properties", () => {
    const valid = {
      event_id: "f6f5bed0-d487-49c4-b846-d217e901459c",
      event_name: "page_view",
      route: "/coaches",
      properties: { locale: "en", utm_source: "launch" },
    };
    expect(clientAnalyticsEventSchema.parse(valid)).toEqual(valid);
    expect(() =>
      clientAnalyticsEventSchema.parse({
        ...valid,
        properties: { chat_text: "sensitive" },
      }),
    ).toThrow();
    expect(() =>
      clientAnalyticsEventSchema.parse({
        ...valid,
        event_name: "payment_succeeded",
      }),
    ).toThrow();
  });

  it("requires an interval only for checkout starts", () => {
    const base = {
      event_id: "133746fc-acbb-4614-bb27-58e9b31bd755",
      route: "/billing",
    };
    expect(() =>
      clientAnalyticsEventSchema.parse({
        ...base,
        event_name: "checkout_started",
        properties: {},
      }),
    ).toThrow();
    expect(
      clientAnalyticsEventSchema.parse({
        ...base,
        event_name: "checkout_started",
        properties: { interval: "annual" },
      }).properties.interval,
    ).toBe("annual");
  });

  it("removes query strings and rejects unsafe routes", () => {
    expect(safeAnalyticsRoute("https://coach.example/chat?token=secret")).toBe("/chat");
    expect(safeAnalyticsRoute("/chat<script>")).toBe("/");
  });

  it("normalizes malformed provider usage without inventing negative counts", () => {
    expect(
      normalizeAiUsage({
        inputTokens: -5,
        outputTokens: 12.4,
        totalTokens: Number.NaN,
      }),
    ).toEqual({
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 12,
      reasoningTokens: 0,
      totalTokens: 0,
    });
  });

  it("prices uncached and cached tokens in integer micro-USD", () => {
    const rates = aiCostRatesFromEnvironment({
      AI_COST_INPUT_USD_PER_MILLION: "3",
      AI_COST_OUTPUT_USD_PER_MILLION: "15",
      AI_COST_CACHE_READ_USD_PER_MILLION: "0.3",
      AI_COST_CACHE_WRITE_USD_PER_MILLION: "3.75",
    });
    expect(
      estimateAiCostMicrousd(
        {
          inputTokens: 1_000,
          cacheReadTokens: 400,
          cacheWriteTokens: 100,
          outputTokens: 200,
        },
        rates,
      ),
    ).toBe(4_995);
    expect(estimateAiCostMicrousd({ inputTokens: 10 }, null)).toBeNull();
    expect(
      aiCostRatesFromEnvironment({
        AI_COST_INPUT_USD_PER_MILLION: "",
        AI_COST_OUTPUT_USD_PER_MILLION: "15",
      }),
    ).toBeNull();
  });
});

describe("analytics administrator boundary", () => {
  const allowed = {
    role: "admin",
    email: "owner@example.com",
    banned: false,
    twoFactorEnabled: true,
    environment: "production",
    allowedEmails: ["owner@example.com"],
  };

  it("requires role, allowlist, and production MFA", () => {
    expect(analyticsAdminAccess(allowed)).toEqual({ allowed: true, reason: null });
    expect(analyticsAdminAccess({ ...allowed, role: "user" }).allowed).toBe(false);
    expect(analyticsAdminAccess({ ...allowed, email: "other@example.com" }).allowed).toBe(false);
    expect(analyticsAdminAccess({ ...allowed, twoFactorEnabled: false }).reason).toBe(
      "mfa_required",
    );
    expect(analyticsAdminAccess({ ...allowed, allowedEmails: [] }).reason).toBe(
      "allowlist_missing",
    );
  });

  it("allows local admins without requiring a production allowlist or MFA", () => {
    expect(
      analyticsAdminAccess({
        ...allowed,
        environment: "local",
        allowedEmails: [],
        twoFactorEnabled: false,
      }).allowed,
    ).toBe(true);
  });
});
