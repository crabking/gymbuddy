import { createHmac, randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { eq, lt, sql } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import {
  aiUsageEvents,
  analyticsEvents,
  authUsers,
  billingLedger,
  stripeEvents,
} from "@/db/schema";
import {
  aiCostRatesFromEnvironment,
  estimateAiCostMicrousd,
  normalizeAiUsage,
  type AiTokenUsage,
  type AnalyticsEventName,
  type ClientAnalyticsEvent,
} from "@/lib/analytics";
import { getAiProviderMetadata } from "@/lib/ai-provider.server";
import { getClientAddress } from "@/lib/security.server";

export type AiUsagePurpose = "coach_chat" | "chat_compaction" | "memory_extraction";

type AnalyticsProperties = Record<string, string | number | boolean | null | undefined>;

let lastAnalyticsPruneAt = 0;

function environmentName() {
  return process.env.APP_ENV?.trim().toLowerCase() || "local";
}

function analyticsSecret() {
  const configured = process.env.ANALYTICS_HASH_SECRET?.trim();
  if (configured) return configured;
  const authSecret = process.env.BETTER_AUTH_SECRET?.trim();
  if (authSecret) return authSecret;
  if (environmentName() === "local") return "coach-local-analytics-only-secret";
  throw new Error("Missing ANALYTICS_HASH_SECRET");
}

function analyticsRetentionDays() {
  const value = Number(process.env.ANALYTICS_RETENTION_DAYS || "760");
  return Number.isInteger(value) && value >= 30 && value <= 3650 ? value : 760;
}

async function maybePruneAnalytics() {
  const now = Date.now();
  if (now - lastAnalyticsPruneAt < 24 * 60 * 60_000) return;
  lastAnalyticsPruneAt = now;
  const cutoff = new Date(now - analyticsRetentionDays() * 24 * 60 * 60_000).toISOString();
  try {
    await Promise.all([
      getDb().delete(analyticsEvents).where(lt(analyticsEvents.occurred_at, cutoff)),
      getDb().delete(aiUsageEvents).where(lt(aiUsageEvents.completed_at, cutoff)),
    ]);
  } catch (error) {
    lastAnalyticsPruneAt = 0;
    console.error("Analytics retention cleanup failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

export function visitorHashForRequest(request: Request): string {
  const address = getClientAddress(request);
  const userAgent = (request.headers.get("user-agent") || "unknown").slice(0, 500);
  return createHmac("sha256", analyticsSecret()).update(`${address}\n${userAgent}`).digest("hex");
}

function cleanProperties(properties: AnalyticsProperties | undefined) {
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(properties || {})) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(key) || value === undefined) continue;
    if (typeof value === "string") clean[key] = value.slice(0, 160);
    else if (typeof value === "number" && Number.isFinite(value)) clean[key] = value;
    else if (typeof value === "boolean" || value === null) clean[key] = value;
  }
  return clean;
}

export async function recordAnalyticsEvent(input: {
  eventName: AnalyticsEventName;
  actorUserId?: string | null;
  visitorHash?: string | null;
  route?: string | null;
  source: "web" | "server" | "stripe";
  properties?: AnalyticsProperties;
  idempotencyKey?: string | null;
  occurredAt?: string;
}) {
  await getDb()
    .insert(analyticsEvents)
    .values({
      event_name: input.eventName,
      actor_user_id: input.actorUserId || null,
      visitor_hash: input.visitorHash || null,
      route: input.route || null,
      source: input.source,
      properties: cleanProperties(input.properties),
      idempotency_key: input.idempotencyKey || null,
      occurred_at: input.occurredAt,
    })
    .onConflictDoNothing();
  await maybePruneAnalytics();
}

export async function recordAnalyticsEventSafe(input: Parameters<typeof recordAnalyticsEvent>[0]) {
  try {
    await recordAnalyticsEvent(input);
  } catch (error) {
    console.error("Analytics event persistence failed", {
      eventName: input.eventName,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

export async function recordClientAnalyticsEvent(
  request: Request,
  userId: string | null,
  event: ClientAnalyticsEvent,
) {
  await recordAnalyticsEvent({
    eventName: event.event_name,
    actorUserId: userId,
    visitorHash: visitorHashForRequest(request),
    route: event.route,
    source: "web",
    properties: event.properties,
    idempotencyKey: `web:${event.event_id}`,
  });
}

export function analyticsAdminAccess(input: {
  role: string | null;
  email: string;
  banned: boolean;
  twoFactorEnabled: boolean;
  environment: string;
  allowedEmails: string[];
}) {
  if (input.role !== "admin" || input.banned) return { allowed: false, reason: "not_admin" };
  const publicEnvironment = input.environment === "staging" || input.environment === "production";
  if (publicEnvironment && input.allowedEmails.length === 0) {
    return { allowed: false, reason: "allowlist_missing" };
  }
  if (
    input.allowedEmails.length > 0 &&
    !input.allowedEmails.includes(input.email.trim().toLowerCase())
  ) {
    return { allowed: false, reason: "not_allowlisted" };
  }
  if (input.environment === "production" && !input.twoFactorEnabled) {
    return { allowed: false, reason: "mfa_required" };
  }
  return { allowed: true, reason: null };
}

export async function requireAnalyticsAdminUser(userId: string) {
  const [user] = await getDb()
    .select({
      id: authUsers.id,
      email: authUsers.email,
      role: authUsers.role,
      banned: authUsers.banned,
      twoFactorEnabled: authUsers.twoFactorEnabled,
    })
    .from(authUsers)
    .where(eq(authUsers.id, userId))
    .limit(1);
  if (!user) throw new Error("Analytics access denied");
  const allowedEmails = (process.env.ANALYTICS_ADMIN_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const decision = analyticsAdminAccess({
    role: user.role,
    email: user.email,
    banned: user.banned,
    twoFactorEnabled: user.twoFactorEnabled,
    environment: environmentName(),
    allowedEmails,
  });
  if (!decision.allowed) throw new Error("Analytics access denied");
  return user;
}

export async function recordAiUsage(input: {
  requestId?: string;
  userId: string | null;
  purpose: AiUsagePurpose;
  usage?: AiTokenUsage | null;
  succeeded: boolean;
  startedAt: number;
  errorCode?: string | null;
}) {
  const completedAt = Date.now();
  const usage = normalizeAiUsage(input.usage);
  const model = getAiProviderMetadata();
  await getDb()
    .insert(aiUsageEvents)
    .values({
      request_id: input.requestId || randomUUID(),
      user_id: input.userId,
      purpose: input.purpose,
      provider: model.provider,
      model: model.model,
      status: input.succeeded ? "succeeded" : "failed",
      input_tokens: usage.inputTokens,
      cache_read_tokens: usage.cacheReadTokens,
      cache_write_tokens: usage.cacheWriteTokens,
      output_tokens: usage.outputTokens,
      reasoning_tokens: usage.reasoningTokens,
      total_tokens: usage.totalTokens,
      estimated_cost_microusd: estimateAiCostMicrousd(
        usage,
        aiCostRatesFromEnvironment(process.env),
      ),
      duration_ms: Math.max(0, Math.min(3_600_000, completedAt - input.startedAt)),
      error_code: input.errorCode?.slice(0, 80) || null,
      started_at: new Date(input.startedAt).toISOString(),
      completed_at: new Date(completedAt).toISOString(),
    })
    .onConflictDoNothing({ target: aiUsageEvents.request_id });
  await maybePruneAnalytics();
}

export async function recordAiUsageSafe(input: Parameters<typeof recordAiUsage>[0]) {
  try {
    await recordAiUsage(input);
  } catch (error) {
    console.error("AI usage persistence failed", {
      purpose: input.purpose,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

function stripeId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

async function userIdForStripeCustomer(customerId: string | null) {
  if (!customerId) return null;
  const [user] = await getDb()
    .select({ id: authUsers.id })
    .from(authUsers)
    .where(eq(authUsers.stripeCustomerId, customerId))
    .limit(1);
  return user?.id ?? null;
}

function integerAmount(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function currencyCode(value: unknown): string {
  return typeof value === "string" && /^[a-zA-Z]{3}$/.test(value) ? value.toLowerCase() : "usd";
}

export async function recordStripeBusinessEvent(event: Stripe.Event) {
  const object = event.data.object as unknown as Record<string, unknown>;
  const customerId = stripeId(object.customer);
  const userId = await userIdForStripeCustomer(customerId);
  const occurredAt = new Date(event.created * 1_000).toISOString();
  const eventRows: Array<{
    name: AnalyticsEventName;
    properties?: AnalyticsProperties;
  }> = [];
  let ledger: {
    kind: "payment_succeeded" | "payment_failed" | "payment_refunded";
    amount: number;
    currency: string;
  } | null = null;

  if (event.type === "checkout.session.completed") {
    eventRows.push({
      name: "checkout_completed",
      properties: { mode: typeof object.mode === "string" ? object.mode : null },
    });
  } else if (event.type === "customer.subscription.created") {
    if (object.status === "active" || object.status === "trialing") {
      eventRows.push({
        name: "subscription_activated",
        properties: { status: String(object.status) },
      });
    }
  } else if (event.type === "customer.subscription.updated") {
    const previous = event.data.previous_attributes as Record<string, unknown> | undefined;
    if (
      previous?.status !== object.status &&
      (object.status === "active" || object.status === "trialing")
    ) {
      eventRows.push({
        name: "subscription_activated",
        properties: { status: String(object.status) },
      });
    }
    if (
      previous?.status !== object.status &&
      (object.status === "canceled" || object.status === "unpaid")
    ) {
      eventRows.push({
        name: "subscription_cancelled",
        properties: { status: String(object.status) },
      });
    }
  } else if (event.type === "customer.subscription.deleted") {
    eventRows.push({
      name: "subscription_cancelled",
      properties: { status: "canceled" },
    });
  } else if (event.type === "invoice.paid") {
    ledger = {
      kind: "payment_succeeded",
      amount: integerAmount(object.amount_paid),
      currency: currencyCode(object.currency),
    };
    eventRows.push({ name: "payment_succeeded", properties: { currency: ledger.currency } });
  } else if (event.type === "invoice.payment_failed") {
    ledger = {
      kind: "payment_failed",
      amount: integerAmount(object.amount_due),
      currency: currencyCode(object.currency),
    };
    eventRows.push({ name: "payment_failed", properties: { currency: ledger.currency } });
  } else if (event.type === "charge.refunded") {
    const previous = event.data.previous_attributes as Record<string, unknown> | undefined;
    const currentRefunded = integerAmount(object.amount_refunded);
    const previousRefunded = integerAmount(previous?.amount_refunded);
    ledger = {
      kind: "payment_refunded",
      amount: Math.max(0, currentRefunded - previousRefunded),
      currency: currencyCode(object.currency),
    };
    eventRows.push({ name: "payment_refunded", properties: { currency: ledger.currency } });
  }

  await getDb().transaction(async (tx) => {
    await tx
      .insert(stripeEvents)
      .values({
        id: event.id,
        event_type: event.type,
        entity_id: typeof object.id === "string" ? object.id : null,
        payload_sha256: createHmac("sha256", analyticsSecret())
          .update(JSON.stringify(event))
          .digest("hex"),
      })
      .onConflictDoNothing({ target: stripeEvents.id });
    for (const row of eventRows) {
      await tx
        .insert(analyticsEvents)
        .values({
          event_name: row.name,
          actor_user_id: userId,
          source: "stripe",
          properties: cleanProperties(row.properties),
          idempotency_key: `stripe:${event.id}:${row.name}`,
          occurred_at: occurredAt,
        })
        .onConflictDoNothing();
    }
    if (ledger) {
      await tx
        .insert(billingLedger)
        .values({
          event_id: event.id,
          user_id: userId,
          kind: ledger.kind,
          amount_minor: ledger.amount,
          currency: ledger.currency,
          occurred_at: occurredAt,
        })
        .onConflictDoNothing({ target: billingLedger.event_id });
    }
  });
}

type QueryRows = Array<Record<string, unknown>>;

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoValue(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && !Number.isNaN(new Date(value).getTime())) {
    return new Date(value).toISOString();
  }
  return null;
}

function businessTimeZone() {
  const configured = process.env.ANALYTICS_TIMEZONE?.trim() || "Europe/Stockholm";
  try {
    new Intl.DateTimeFormat("en", { timeZone: configured }).format(new Date());
    return configured;
  } catch {
    return "UTC";
  }
}

function localDateKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export async function getBusinessAnalyticsSnapshot(rangeDays: 7 | 30 | 90 | 365) {
  const db = getDb();
  const timezone = businessTimeZone();
  const now = new Date();
  const from = new Date(now.getTime() - rangeDays * 24 * 60 * 60_000).toISOString();
  const to = now.toISOString();
  const rows = async (query: ReturnType<typeof sql>) =>
    ((await db.execute(query)).rows || []) as QueryRows;

  const [
    funnelRows,
    registrationRows,
    subscriptionRows,
    productRows,
    aiRows,
    revenueRows,
    dailyEventRows,
    dailyRegistrationRows,
    dailyAiRows,
    dailyWorkoutRows,
    dailyProgramRows,
    dailyTrackingRows,
    recentRegistrationRows,
    payerRows,
    activityRows,
  ] = await Promise.all([
    rows(sql`
      SELECT
        count(*) FILTER (WHERE event_name = 'page_view') AS page_views,
        count(DISTINCT visitor_hash) FILTER (WHERE event_name = 'page_view') AS visitors,
        count(*) FILTER (WHERE event_name = 'signup_started') AS signup_started,
        count(*) FILTER (WHERE event_name = 'onboarding_completed') AS onboarding_completed,
        count(*) FILTER (WHERE event_name = 'checkout_started') AS checkout_started,
        count(*) FILTER (WHERE event_name = 'checkout_completed') AS checkout_completed,
        count(*) FILTER (WHERE event_name = 'chat_user_message') AS user_messages,
        count(*) FILTER (WHERE event_name = 'chat_assistant_message') AS assistant_messages
      FROM analytics_events
      WHERE occurred_at BETWEEN ${from} AND ${to}
    `),
    rows(sql`
      SELECT
        count(*) AS registrations,
        count(*) FILTER (WHERE email_verified) AS verified_registrations
      FROM auth_users
      WHERE created_at BETWEEN ${from} AND ${to}
    `),
    rows(sql`
      SELECT
        count(*) FILTER (WHERE status IN ('active', 'trialing', 'past_due')) AS active_subscriptions,
        count(DISTINCT reference_id) FILTER (WHERE status IN ('active', 'trialing', 'past_due')) AS active_payers
      FROM billing_subscriptions
    `),
    rows(sql`
      SELECT
        (SELECT count(*) FROM workout_sessions WHERE created_at BETWEEN ${from} AND ${to}) AS workouts_started,
        (SELECT count(*) FROM workout_sessions WHERE status = 'completed' AND completed_at BETWEEN ${from} AND ${to}) AS workouts_completed,
        (SELECT count(*) FROM program_days WHERE status = 'skipped' AND resolved_at BETWEEN ${from} AND ${to}) AS workouts_skipped,
        (SELECT count(*) FROM programs WHERE created_at BETWEEN ${from} AND ${to}) AS programs_created,
        (SELECT count(*) FROM programs WHERE status = 'completed' AND completed_at BETWEEN ${from} AND ${to}) AS programs_completed,
        (SELECT count(*) FROM meal_logs WHERE logged_at BETWEEN ${from} AND ${to}) AS meals_logged,
        (SELECT count(*) FROM weight_logs WHERE logged_at BETWEEN ${from} AND ${to}) AS weights_logged,
        (SELECT count(*) FROM measurements WHERE recorded_at BETWEEN ${from} AND ${to}) AS measurements_logged,
        (
          SELECT count(DISTINCT user_id)
          FROM (
            SELECT actor_user_id AS user_id FROM analytics_events WHERE occurred_at BETWEEN ${from} AND ${to}
            UNION ALL SELECT user_id FROM workout_sessions WHERE created_at BETWEEN ${from} AND ${to}
            UNION ALL SELECT user_id FROM meal_logs WHERE logged_at BETWEEN ${from} AND ${to}
            UNION ALL SELECT user_id FROM weight_logs WHERE logged_at BETWEEN ${from} AND ${to}
            UNION ALL SELECT user_id FROM measurements WHERE recorded_at BETWEEN ${from} AND ${to}
          ) activity
          WHERE user_id IS NOT NULL
        ) AS active_users
    `),
    rows(sql`
      SELECT
        count(*) AS calls,
        count(*) FILTER (WHERE status = 'failed') AS failed_calls,
        coalesce(sum(input_tokens), 0) AS input_tokens,
        coalesce(sum(output_tokens), 0) AS output_tokens,
        coalesce(sum(total_tokens), 0) AS total_tokens,
        coalesce(sum(estimated_cost_microusd), 0) AS cost_microusd,
        count(*) FILTER (WHERE estimated_cost_microusd IS NULL) AS unpriced_calls
      FROM ai_usage_events
      WHERE completed_at BETWEEN ${from} AND ${to}
    `),
    rows(sql`
      SELECT
        currency,
        count(*) FILTER (WHERE kind = 'payment_succeeded') AS successful_payments,
        count(*) FILTER (WHERE kind = 'payment_failed') AS failed_payments,
        count(*) FILTER (WHERE kind = 'payment_refunded') AS refunds,
        coalesce(sum(CASE WHEN kind = 'payment_succeeded' THEN amount_minor WHEN kind = 'payment_refunded' THEN -amount_minor ELSE 0 END), 0) AS net_amount_minor
      FROM billing_ledger
      WHERE occurred_at BETWEEN ${from} AND ${to}
      GROUP BY currency
      ORDER BY currency
    `),
    rows(sql`
      SELECT
        to_char(occurred_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day,
        count(*) FILTER (WHERE event_name = 'page_view') AS views,
        count(*) FILTER (WHERE event_name = 'signup_started') AS signup_started,
        count(*) FILTER (WHERE event_name = 'checkout_started') AS checkout_started,
        count(*) FILTER (WHERE event_name = 'checkout_completed') AS checkout_completed,
        count(*) FILTER (WHERE event_name = 'chat_user_message') AS messages
      FROM analytics_events
      WHERE occurred_at BETWEEN ${from} AND ${to}
      GROUP BY day
      ORDER BY day
    `),
    rows(sql`
      SELECT to_char(created_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day, count(*) AS registrations
      FROM auth_users
      WHERE created_at BETWEEN ${from} AND ${to}
      GROUP BY day
      ORDER BY day
    `),
    rows(sql`
      SELECT
        to_char(completed_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day,
        count(*) AS ai_calls,
        coalesce(sum(estimated_cost_microusd), 0) AS cost_microusd
      FROM ai_usage_events
      WHERE completed_at BETWEEN ${from} AND ${to}
      GROUP BY day
      ORDER BY day
    `),
    rows(sql`
      SELECT
        to_char(coalesce(completed_at, created_at) AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day,
        count(*) FILTER (WHERE status = 'completed') AS workouts_completed
      FROM workout_sessions
      WHERE coalesce(completed_at, created_at) BETWEEN ${from} AND ${to}
      GROUP BY day
      ORDER BY day
    `),
    rows(sql`
      SELECT
        to_char(coalesce(completed_at, created_at) AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day,
        count(*) FILTER (WHERE status = 'completed') AS programs_completed
      FROM programs
      WHERE coalesce(completed_at, created_at) BETWEEN ${from} AND ${to}
      GROUP BY day
      ORDER BY day
    `),
    rows(sql`
      SELECT day, sum(meals) AS meals, sum(tracking) AS tracking
      FROM (
        SELECT to_char(logged_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day, count(*) AS meals, 0 AS tracking
        FROM meal_logs WHERE logged_at BETWEEN ${from} AND ${to} GROUP BY day
        UNION ALL
        SELECT to_char(logged_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day, 0 AS meals, count(*) AS tracking
        FROM weight_logs WHERE logged_at BETWEEN ${from} AND ${to} GROUP BY day
        UNION ALL
        SELECT to_char(recorded_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day, 0 AS meals, count(*) AS tracking
        FROM measurements WHERE recorded_at BETWEEN ${from} AND ${to} GROUP BY day
      ) totals
      GROUP BY day
      ORDER BY day
    `),
    rows(sql`
      SELECT id, email, name, email_verified, created_at
      FROM auth_users
      ORDER BY created_at DESC
      LIMIT 20
    `),
    rows(sql`
      SELECT
        au.id,
        au.email,
        au.name,
        bs.plan,
        bs.status,
        bs.billing_interval,
        bs.period_end,
        bs.cancel_at_period_end
      FROM billing_subscriptions bs
      JOIN auth_users au ON au.id = bs.reference_id
      WHERE bs.status IN ('active', 'trialing', 'past_due')
      ORDER BY bs.period_end DESC NULLS LAST
      LIMIT 50
    `),
    rows(sql`
      SELECT occurred_at, event_type, actor_email, detail
      FROM (
        SELECT ae.occurred_at, ae.event_name AS event_type, au.email AS actor_email, ae.route AS detail
        FROM analytics_events ae
        LEFT JOIN auth_users au ON au.id = ae.actor_user_id
        WHERE ae.occurred_at BETWEEN ${from} AND ${to} AND ae.event_name <> 'page_view'
        UNION ALL
        SELECT ws.completed_at, 'workout_completed', au.email, ws.title
        FROM workout_sessions ws JOIN auth_users au ON au.id = ws.user_id
        WHERE ws.status = 'completed' AND ws.completed_at BETWEEN ${from} AND ${to}
        UNION ALL
        SELECT pd.resolved_at, 'workout_skipped', au.email, pd.title
        FROM program_days pd
        JOIN programs p ON p.id = pd.program_id
        JOIN auth_users au ON au.id = p.user_id
        WHERE pd.status = 'skipped' AND pd.resolved_at BETWEEN ${from} AND ${to}
        UNION ALL
        SELECT p.created_at, 'program_created', au.email, p.name
        FROM programs p JOIN auth_users au ON au.id = p.user_id
        WHERE p.created_at BETWEEN ${from} AND ${to}
        UNION ALL
        SELECT ml.logged_at, 'meal_logged', au.email, NULL
        FROM meal_logs ml JOIN auth_users au ON au.id = ml.user_id
        WHERE ml.logged_at BETWEEN ${from} AND ${to}
        UNION ALL
        SELECT wl.logged_at, 'weight_logged', au.email, NULL
        FROM weight_logs wl JOIN auth_users au ON au.id = wl.user_id
        WHERE wl.logged_at BETWEEN ${from} AND ${to}
        UNION ALL
        SELECT m.recorded_at, 'measurement_logged', au.email, m.label
        FROM measurements m JOIN auth_users au ON au.id = m.user_id
        WHERE m.recorded_at BETWEEN ${from} AND ${to}
      ) activity
      WHERE occurred_at IS NOT NULL
      ORDER BY occurred_at DESC
      LIMIT 80
    `),
  ]);

  const funnel = funnelRows[0] || {};
  const registrations = registrationRows[0] || {};
  const subscriptions = subscriptionRows[0] || {};
  const product = productRows[0] || {};
  const ai = aiRows[0] || {};
  const daily = new Map<
    string,
    {
      date: string;
      views: number;
      registrations: number;
      signup_started: number;
      checkout_started: number;
      checkout_completed: number;
      messages: number;
      ai_calls: number;
      ai_cost_usd: number;
      workouts_completed: number;
      programs_completed: number;
      meals: number;
      tracking: number;
    }
  >();
  for (let offset = rangeDays - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getTime() - offset * 24 * 60 * 60_000);
    const key = localDateKey(date, timezone);
    daily.set(key, {
      date: key,
      views: 0,
      registrations: 0,
      signup_started: 0,
      checkout_started: 0,
      checkout_completed: 0,
      messages: 0,
      ai_calls: 0,
      ai_cost_usd: 0,
      workouts_completed: 0,
      programs_completed: 0,
      meals: 0,
      tracking: 0,
    });
  }
  const applyRows = (
    input: QueryRows,
    apply: (point: NonNullable<ReturnType<typeof daily.get>>, row: Record<string, unknown>) => void,
  ) => {
    for (const row of input) {
      const point = daily.get(String(row.day));
      if (point) apply(point, row);
    }
  };
  applyRows(dailyEventRows, (point, row) => {
    point.views = numberValue(row.views);
    point.signup_started = numberValue(row.signup_started);
    point.checkout_started = numberValue(row.checkout_started);
    point.checkout_completed = numberValue(row.checkout_completed);
    point.messages = numberValue(row.messages);
  });
  applyRows(dailyRegistrationRows, (point, row) => {
    point.registrations = numberValue(row.registrations);
  });
  applyRows(dailyAiRows, (point, row) => {
    point.ai_calls = numberValue(row.ai_calls);
    point.ai_cost_usd = numberValue(row.cost_microusd) / 1_000_000;
  });
  applyRows(dailyWorkoutRows, (point, row) => {
    point.workouts_completed = numberValue(row.workouts_completed);
  });
  applyRows(dailyProgramRows, (point, row) => {
    point.programs_completed = numberValue(row.programs_completed);
  });
  applyRows(dailyTrackingRows, (point, row) => {
    point.meals = numberValue(row.meals);
    point.tracking = numberValue(row.tracking);
  });

  return {
    range_days: rangeDays,
    timezone,
    generated_at: now.toISOString(),
    funnel: {
      page_views: numberValue(funnel.page_views),
      visitors: numberValue(funnel.visitors),
      signup_started: numberValue(funnel.signup_started),
      registrations: numberValue(registrations.registrations),
      verified_registrations: numberValue(registrations.verified_registrations),
      onboarding_completed: numberValue(funnel.onboarding_completed),
      checkout_started: numberValue(funnel.checkout_started),
      checkout_completed: numberValue(funnel.checkout_completed),
      active_payers: numberValue(subscriptions.active_payers),
    },
    business: {
      active_subscriptions: numberValue(subscriptions.active_subscriptions),
      active_users: numberValue(product.active_users),
      revenue: revenueRows.map((row) => ({
        currency: String(row.currency),
        successful_payments: numberValue(row.successful_payments),
        failed_payments: numberValue(row.failed_payments),
        refunds: numberValue(row.refunds),
        net_amount_minor: numberValue(row.net_amount_minor),
      })),
    },
    product: {
      user_messages: numberValue(funnel.user_messages),
      assistant_messages: numberValue(funnel.assistant_messages),
      workouts_started: numberValue(product.workouts_started),
      workouts_completed: numberValue(product.workouts_completed),
      workouts_skipped: numberValue(product.workouts_skipped),
      programs_created: numberValue(product.programs_created),
      programs_completed: numberValue(product.programs_completed),
      meals_logged: numberValue(product.meals_logged),
      weights_logged: numberValue(product.weights_logged),
      measurements_logged: numberValue(product.measurements_logged),
    },
    ai: {
      calls: numberValue(ai.calls),
      failed_calls: numberValue(ai.failed_calls),
      input_tokens: numberValue(ai.input_tokens),
      output_tokens: numberValue(ai.output_tokens),
      total_tokens: numberValue(ai.total_tokens),
      estimated_cost_usd: numberValue(ai.cost_microusd) / 1_000_000,
      unpriced_calls: numberValue(ai.unpriced_calls),
    },
    daily: [...daily.values()],
    recent_registrations: recentRegistrationRows.map((row) => ({
      id: String(row.id),
      email: String(row.email),
      name: String(row.name),
      email_verified: Boolean(row.email_verified),
      created_at: isoValue(row.created_at),
    })),
    active_subscribers: payerRows.map((row) => ({
      id: String(row.id),
      email: String(row.email),
      name: String(row.name),
      plan: String(row.plan),
      status: String(row.status),
      billing_interval: row.billing_interval ? String(row.billing_interval) : null,
      period_end: isoValue(row.period_end),
      cancel_at_period_end: Boolean(row.cancel_at_period_end),
    })),
    recent_activity: activityRows.map((row) => ({
      occurred_at: isoValue(row.occurred_at),
      event_type: String(row.event_type),
      actor_email: row.actor_email ? String(row.actor_email) : null,
      detail: row.detail ? String(row.detail).slice(0, 160) : null,
    })),
  };
}
