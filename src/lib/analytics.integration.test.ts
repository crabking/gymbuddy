import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import { aiUsageEvents, analyticsEvents, authUsers, billingLedger, users } from "@/db/schema";
import {
  getBusinessAnalyticsSnapshot,
  recordAiUsage,
  recordAnalyticsEvent,
} from "@/lib/analytics.server";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const cleanupUsers: string[] = [];
const cleanupKeys: string[] = [];
const cleanupRequests: string[] = [];
const cleanupBilling: string[] = [];

afterEach(async () => {
  if (!hasDatabase) return;
  const db = getDb();
  if (cleanupBilling.length) {
    await db.delete(billingLedger).where(inArray(billingLedger.event_id, cleanupBilling.splice(0)));
  }
  if (cleanupRequests.length) {
    await db
      .delete(aiUsageEvents)
      .where(inArray(aiUsageEvents.request_id, cleanupRequests.splice(0)));
  }
  if (cleanupKeys.length) {
    await db
      .delete(analyticsEvents)
      .where(inArray(analyticsEvents.idempotency_key, cleanupKeys.splice(0)));
  }
  while (cleanupUsers.length) {
    const userId = cleanupUsers.pop();
    if (!userId) continue;
    await db.delete(authUsers).where(eq(authUsers.id, userId));
    await db.delete(users).where(eq(users.id, userId));
  }
});

describe.runIf(hasDatabase).sequential("business analytics database integration", () => {
  it("deduplicates events, aggregates costs/revenue, and detaches deleted accounts", async () => {
    const db = getDb();
    const userId = randomUUID();
    cleanupUsers.push(userId);
    await db.insert(users).values({
      id: userId,
      email: `analytics-${userId}@example.invalid`,
      password_hash: "test-only",
    });
    await db.insert(authUsers).values({
      id: userId,
      email: `analytics-${userId}@example.invalid`,
      name: "Analytics Test",
      emailVerified: true,
    });

    const pageKey = `analytics-test:${randomUUID()}`;
    const signupKey = `analytics-test:${randomUUID()}`;
    cleanupKeys.push(pageKey, signupKey);
    await recordAnalyticsEvent({
      eventName: "page_view",
      visitorHash: "a".repeat(64),
      route: "/",
      source: "web",
      idempotencyKey: pageKey,
    });
    await recordAnalyticsEvent({
      eventName: "page_view",
      visitorHash: "a".repeat(64),
      route: "/",
      source: "web",
      idempotencyKey: pageKey,
    });
    await recordAnalyticsEvent({
      eventName: "signup_started",
      actorUserId: userId,
      visitorHash: "a".repeat(64),
      route: "/auth",
      source: "web",
      idempotencyKey: signupKey,
    });

    const requestId = randomUUID();
    cleanupRequests.push(requestId);
    const previousRates = {
      input: process.env.AI_COST_INPUT_USD_PER_MILLION,
      output: process.env.AI_COST_OUTPUT_USD_PER_MILLION,
    };
    process.env.AI_COST_INPUT_USD_PER_MILLION = "3";
    process.env.AI_COST_OUTPUT_USD_PER_MILLION = "15";
    try {
      await recordAiUsage({
        requestId,
        userId,
        purpose: "coach_chat",
        usage: { inputTokens: 1_000, outputTokens: 100, totalTokens: 1_100 },
        succeeded: true,
        startedAt: Date.now() - 50,
      });
    } finally {
      if (previousRates.input === undefined) delete process.env.AI_COST_INPUT_USD_PER_MILLION;
      else process.env.AI_COST_INPUT_USD_PER_MILLION = previousRates.input;
      if (previousRates.output === undefined) delete process.env.AI_COST_OUTPUT_USD_PER_MILLION;
      else process.env.AI_COST_OUTPUT_USD_PER_MILLION = previousRates.output;
    }

    const billingEvent = `evt_analytics_${randomUUID()}`;
    cleanupBilling.push(billingEvent);
    await db.insert(billingLedger).values({
      event_id: billingEvent,
      user_id: userId,
      kind: "payment_succeeded",
      amount_minor: 1299,
      currency: "eur",
      occurred_at: new Date().toISOString(),
    });

    const snapshot = await getBusinessAnalyticsSnapshot(7);
    expect(snapshot.funnel.page_views).toBeGreaterThanOrEqual(1);
    expect(snapshot.funnel.signup_started).toBeGreaterThanOrEqual(1);
    expect(snapshot.ai.calls).toBeGreaterThanOrEqual(1);
    expect(snapshot.ai.estimated_cost_usd).toBeGreaterThanOrEqual(0.0045);
    expect(
      snapshot.business.revenue.find((row) => row.currency === "eur")?.net_amount_minor,
    ).toBeGreaterThanOrEqual(1299);

    const pageRows = await db
      .select()
      .from(analyticsEvents)
      .where(eq(analyticsEvents.idempotency_key, pageKey));
    expect(pageRows).toHaveLength(1);
    expect(JSON.stringify(pageRows[0])).not.toContain("test-only");

    await db.delete(users).where(eq(users.id, userId));
    const [detachedEvent] = await db
      .select({ actor: analyticsEvents.actor_user_id })
      .from(analyticsEvents)
      .where(eq(analyticsEvents.idempotency_key, signupKey));
    const [detachedAi] = await db
      .select({ actor: aiUsageEvents.user_id })
      .from(aiUsageEvents)
      .where(eq(aiUsageEvents.request_id, requestId));
    const [detachedPayment] = await db
      .select({ actor: billingLedger.user_id })
      .from(billingLedger)
      .where(eq(billingLedger.event_id, billingEvent));
    expect(detachedEvent?.actor).toBeNull();
    expect(detachedAi?.actor).toBeNull();
    expect(detachedPayment?.actor).toBeNull();
  });
});
