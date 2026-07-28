import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  doublePrecision,
  boolean,
  timestamp,
  date,
  jsonb,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { FoodNutrientEstimates } from "../lib/nutrients";

// Column *property* names are snake_case to match the app's existing shapes
// (e.g. profile.display_name, insert({ user_id, parts })), so query objects and
// selected rows line up with the code with no field renaming.

// ISO-string timestamps (matches the previous Supabase behavior and serializes
// cleanly across the server-function boundary).
const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date().toISOString());

// --- Application identity + authentication ---
//
// `users` is the stable COACH application identity referenced by all training
// data. Better Auth owns the separate `auth_*` tables below and deliberately
// reuses the same UUID, so switching authentication never changes ownership of
// a person's programs, chat, nutrition, or workout history.

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  // Retained while the rollback-safe local provider exists. The migration
  // also copies this hash into auth_accounts for uninterrupted sign-in.
  password_hash: text("password_hash"),
  policy_bundle_version: text("policy_bundle_version"),
  policy_accepted_at: timestamp("policy_accepted_at", {
    withTimezone: true,
    mode: "string",
  }),
  created_at: createdAt(),
});

/** Legacy local sessions kept for rollback and local-only test fixtures. */
export const sessions = pgTable(
  "sessions",
  {
    // SHA-256 hash of the session token (the raw token lives only in the cookie).
    id: text("id").primaryKey(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires_at: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    created_at: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.user_id), index("sessions_expiry_idx").on(t.expires_at)],
);

export const authUsers = pgTable(
  "auth_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    role: text("role").notNull().default("user"),
    banned: boolean("banned").notNull().default(false),
    banReason: text("ban_reason"),
    banExpires: timestamp("ban_expires", { withTimezone: true, mode: "date" }),
    twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
    stripeCustomerId: text("stripe_customer_id").unique(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("auth_users_role_idx").on(t.role),
    check("auth_users_role_check", sql`${t.role} IN ('user', 'admin')`),
  ],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    impersonatedBy: uuid("impersonated_by"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("auth_sessions_user_idx").on(t.userId),
    index("auth_sessions_expiry_idx").on(t.expiresAt),
  ],
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("auth_accounts_provider_account_idx").on(t.providerId, t.accountId),
    index("auth_accounts_user_idx").on(t.userId),
  ],
);

export const authVerifications = pgTable(
  "auth_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("auth_verifications_identifier_idx").on(t.identifier)],
);

export const authTwoFactors = pgTable(
  "auth_two_factors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    verified: boolean("verified").notNull().default(true),
    failedVerificationCount: integer("failed_verification_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    index("auth_two_factors_secret_idx").on(t.secret),
    index("auth_two_factors_user_idx").on(t.userId),
  ],
);

export const authRateLimits = pgTable(
  "auth_rate_limits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull().unique(),
    count: integer("count").notNull(),
    lastRequest: bigint("last_request", { mode: "number" }).notNull(),
  },
  (t) => [index("auth_rate_limits_last_request_idx").on(t.lastRequest)],
);

/** Better Auth Stripe subscription mirror. Verified webhooks are authoritative. */
export const billingSubscriptions = pgTable(
  "billing_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    plan: text("plan").notNull(),
    referenceId: uuid("reference_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id").unique(),
    status: text("status").notNull().default("incomplete"),
    periodStart: timestamp("period_start", { withTimezone: true, mode: "date" }),
    periodEnd: timestamp("period_end", { withTimezone: true, mode: "date" }),
    trialStart: timestamp("trial_start", { withTimezone: true, mode: "date" }),
    trialEnd: timestamp("trial_end", { withTimezone: true, mode: "date" }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    cancelAt: timestamp("cancel_at", { withTimezone: true, mode: "date" }),
    canceledAt: timestamp("canceled_at", { withTimezone: true, mode: "date" }),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
    seats: integer("seats"),
    billingInterval: text("billing_interval"),
    stripeScheduleId: text("stripe_schedule_id"),
  },
  (t) => [
    index("billing_subscriptions_reference_status_idx").on(t.referenceId, t.status),
    index("billing_subscriptions_customer_idx").on(t.stripeCustomerId),
  ],
);

/** Privacy-minimal receipt ledger; raw Stripe payloads are never persisted. */
export const stripeEvents = pgTable(
  "stripe_events",
  {
    id: text("id").primaryKey(),
    event_type: text("event_type").notNull(),
    entity_id: text("entity_id"),
    payload_sha256: text("payload_sha256").notNull(),
    received_at: timestamp("received_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    processed_at: timestamp("processed_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("stripe_events_type_processed_idx").on(t.event_type, t.processed_at),
    check("stripe_events_id_check", sql`length(${t.id}) BETWEEN 1 AND 255`),
    check("stripe_events_type_check", sql`length(${t.event_type}) BETWEEN 1 AND 100`),
    check("stripe_events_hash_check", sql`${t.payload_sha256} ~ '^[a-f0-9]{64}$'`),
  ],
);

/**
 * Privacy-minimal product and acquisition events. This deliberately stores no
 * chat text, meal descriptions, measurements, IP addresses, or user agents.
 * visitor_hash is an HMAC generated on the server from request metadata.
 */
export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    event_name: text("event_name").notNull(),
    actor_user_id: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    visitor_hash: text("visitor_hash"),
    route: text("route"),
    source: text("source").notNull(),
    properties: jsonb("properties").notNull().default({}),
    idempotency_key: text("idempotency_key"),
    occurred_at: timestamp("occurred_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("analytics_events_name_time_idx").on(t.event_name, t.occurred_at),
    index("analytics_events_actor_time_idx").on(t.actor_user_id, t.occurred_at),
    index("analytics_events_visitor_time_idx").on(t.visitor_hash, t.occurred_at),
    uniqueIndex("analytics_events_idempotency_idx")
      .on(t.idempotency_key)
      .where(sql`${t.idempotency_key} IS NOT NULL`),
    check(
      "analytics_events_name_check",
      sql`${t.event_name} IN ('page_view', 'signup_started', 'signup_completed', 'login_completed', 'onboarding_completed', 'checkout_started', 'checkout_completed', 'subscription_activated', 'subscription_cancelled', 'payment_succeeded', 'payment_failed', 'payment_refunded', 'chat_user_message', 'chat_assistant_message')`,
    ),
    check("analytics_events_source_check", sql`${t.source} IN ('web', 'server', 'stripe')`),
    check(
      "analytics_events_visitor_hash_check",
      sql`${t.visitor_hash} IS NULL OR ${t.visitor_hash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "analytics_events_route_check",
      sql`${t.route} IS NULL OR (length(${t.route}) BETWEEN 1 AND 160 AND ${t.route} ~ '^/[a-zA-Z0-9_./-]*$')`,
    ),
    check(
      "analytics_events_properties_check",
      sql`jsonb_typeof(${t.properties}) = 'object' AND pg_column_size(${t.properties}) <= 4096`,
    ),
    check(
      "analytics_events_idempotency_length_check",
      sql`${t.idempotency_key} IS NULL OR length(${t.idempotency_key}) BETWEEN 1 AND 200`,
    ),
  ],
);

/**
 * One row per model request. Token counts and configured price estimates are
 * retained; prompts, responses, tool inputs, and provider secrets never are.
 */
export const aiUsageEvents = pgTable(
  "ai_usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    request_id: uuid("request_id").notNull().unique(),
    user_id: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    purpose: text("purpose").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    status: text("status").notNull(),
    input_tokens: integer("input_tokens").notNull().default(0),
    cache_read_tokens: integer("cache_read_tokens").notNull().default(0),
    cache_write_tokens: integer("cache_write_tokens").notNull().default(0),
    output_tokens: integer("output_tokens").notNull().default(0),
    reasoning_tokens: integer("reasoning_tokens").notNull().default(0),
    total_tokens: integer("total_tokens").notNull().default(0),
    estimated_cost_microusd: bigint("estimated_cost_microusd", { mode: "number" }),
    duration_ms: integer("duration_ms").notNull(),
    error_code: text("error_code"),
    started_at: timestamp("started_at", { withTimezone: true, mode: "string" }).notNull(),
    completed_at: timestamp("completed_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [
    index("ai_usage_events_completed_idx").on(t.completed_at),
    index("ai_usage_events_user_completed_idx").on(t.user_id, t.completed_at),
    index("ai_usage_events_model_completed_idx").on(t.model, t.completed_at),
    check(
      "ai_usage_events_purpose_check",
      sql`${t.purpose} IN ('coach_chat', 'chat_compaction', 'memory_extraction')`,
    ),
    check("ai_usage_events_status_check", sql`${t.status} IN ('succeeded', 'failed')`),
    check("ai_usage_events_provider_length_check", sql`length(${t.provider}) BETWEEN 1 AND 40`),
    check("ai_usage_events_model_length_check", sql`length(${t.model}) BETWEEN 1 AND 160`),
    check(
      "ai_usage_events_token_check",
      sql`${t.input_tokens} >= 0 AND ${t.cache_read_tokens} >= 0 AND ${t.cache_write_tokens} >= 0 AND ${t.output_tokens} >= 0 AND ${t.reasoning_tokens} >= 0 AND ${t.total_tokens} >= 0`,
    ),
    check(
      "ai_usage_events_cost_check",
      sql`${t.estimated_cost_microusd} IS NULL OR ${t.estimated_cost_microusd} >= 0`,
    ),
    check("ai_usage_events_duration_check", sql`${t.duration_ms} BETWEEN 0 AND 3600000`),
    check(
      "ai_usage_events_error_check",
      sql`${t.error_code} IS NULL OR length(${t.error_code}) BETWEEN 1 AND 80`,
    ),
  ],
);

/**
 * Verified Stripe financial events, sufficient for revenue/refund reporting
 * without copying card, invoice-address, tax-ID, or customer email data.
 */
export const billingLedger = pgTable(
  "billing_ledger",
  {
    event_id: text("event_id").primaryKey(),
    user_id: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    amount_minor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    occurred_at: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
    received_at: timestamp("received_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("billing_ledger_occurred_idx").on(t.occurred_at),
    index("billing_ledger_user_occurred_idx").on(t.user_id, t.occurred_at),
    check(
      "billing_ledger_kind_check",
      sql`${t.kind} IN ('payment_succeeded', 'payment_failed', 'payment_refunded')`,
    ),
    check("billing_ledger_amount_check", sql`${t.amount_minor} >= 0`),
    check("billing_ledger_currency_check", sql`${t.currency} ~ '^[a-z]{3}$'`),
    check("billing_ledger_event_id_check", sql`length(${t.event_id}) BETWEEN 1 AND 255`),
  ],
);

/**
 * Append-only evidence of each policy acknowledgement. The bundle marker on
 * users is the fast authorization check; these rows preserve the exact
 * document/version/language the account accepted.
 */
export const policyConsents = pgTable(
  "policy_consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    document: text("document").notNull(),
    version: text("version").notNull(),
    locale: text("locale").notNull(),
    source: text("source").notNull().default("web"),
    user_agent_hash: text("user_agent_hash"),
    granted_at: timestamp("granted_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("policy_consents_user_document_version_idx").on(t.user_id, t.document, t.version),
    index("policy_consents_user_granted_idx").on(t.user_id, t.granted_at),
    check(
      "policy_consents_document_check",
      sql`${t.document} IN ('terms', 'privacy_notice', 'health_data', 'health_safety', 'adult_attestation')`,
    ),
    check("policy_consents_locale_check", sql`${t.locale} IN ('en', 'sv')`),
    check("policy_consents_source_check", sql`${t.source} IN ('web', 'android')`),
    check("policy_consents_version_check", sql`length(${t.version}) BETWEEN 1 AND 64`),
    check(
      "policy_consents_user_agent_hash_check",
      sql`${t.user_agent_hash} IS NULL OR ${t.user_agent_hash} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);

/**
 * One database may belong to exactly one runtime environment. Startup refuses
 * to continue if a deployment is accidentally pointed at another
 * environment's database.
 */
export const deploymentMetadata = pgTable(
  "deployment_metadata",
  {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (t) => [
    check("deployment_metadata_key_check", sql`length(${t.key}) BETWEEN 1 AND 64`),
    check("deployment_metadata_value_check", sql`length(${t.value}) BETWEEN 1 AND 256`),
  ],
);

/** Cross-replica fixed-window buckets for login/chat abuse protection. */
export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    key_hash: text("key_hash").primaryKey(),
    window_start: timestamp("window_start", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    expires_at: timestamp("expires_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    count: integer("count").notNull().default(1),
  },
  (t) => [
    index("rate_limit_buckets_expiry_idx").on(t.expires_at),
    check("rate_limit_buckets_count_check", sql`${t.count} BETWEEN 1 AND 1000000`),
  ],
);

// --- App data (ported from the Supabase schema) ---

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    display_name: text("display_name"),
    goal: text("goal"),
    experience: text("experience"),
    days_per_week: integer("days_per_week"),
    session_minutes: integer("session_minutes"),
    equipment: text("equipment"),
    injuries: text("injuries"),
    height_cm: doublePrecision("height_cm"),
    weight_kg: doublePrecision("weight_kg"),
    age: integer("age"),
    sex: text("sex"),
    preferred_language: text("preferred_language"),
    activity_level: text("activity_level"),
    recent_training_baseline: text("recent_training_baseline"),
    diet_style: text("diet_style"),
    daily_calorie_target: integer("daily_calorie_target"),
    active_plan_id: uuid("active_plan_id"),
    schedule_note: text("schedule_note"),
    meal_preferences: text("meal_preferences"),
    daily_protein_target_g: doublePrecision("daily_protein_target_g"),
    daily_carbs_target_g: doublePrecision("daily_carbs_target_g"),
    daily_fat_target_g: doublePrecision("daily_fat_target_g"),
    timezone: text("timezone"),
    coach_gender: text("coach_gender").notNull().default("male"),
    coach_id: text("coach_id").notNull().default("rex"),
    onboarding_completed: boolean("onboarding_completed").notNull().default(false),
    data_epoch: integer("data_epoch").notNull().default(0),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (t) => [
    check(
      "profiles_days_per_week_check",
      sql`${t.days_per_week} IS NULL OR ${t.days_per_week} BETWEEN 1 AND 7`,
    ),
    check(
      "profiles_session_minutes_check",
      sql`${t.session_minutes} IS NULL OR ${t.session_minutes} BETWEEN 15 AND 360`,
    ),
    check(
      "profiles_height_check",
      sql`${t.height_cm} IS NULL OR ${t.height_cm} BETWEEN 100 AND 260`,
    ),
    check(
      "profiles_weight_check",
      sql`${t.weight_kg} IS NULL OR ${t.weight_kg} BETWEEN 25 AND 400`,
    ),
    check("profiles_age_check", sql`${t.age} IS NULL OR ${t.age} BETWEEN 18 AND 120`),
    check(
      "profiles_calorie_target_check",
      sql`${t.daily_calorie_target} IS NULL OR ${t.daily_calorie_target} BETWEEN 800 AND 10000`,
    ),
    check(
      "profiles_protein_target_check",
      sql`${t.daily_protein_target_g} IS NULL OR ${t.daily_protein_target_g} BETWEEN 0 AND 1000`,
    ),
    check(
      "profiles_carbs_target_check",
      sql`${t.daily_carbs_target_g} IS NULL OR ${t.daily_carbs_target_g} BETWEEN 0 AND 2000`,
    ),
    check(
      "profiles_fat_target_check",
      sql`${t.daily_fat_target_g} IS NULL OR ${t.daily_fat_target_g} BETWEEN 0 AND 1000`,
    ),
    check(
      "profiles_language_check",
      sql`${t.preferred_language} IS NULL OR ${t.preferred_language} IN ('en', 'sv')`,
    ),
    check(
      "profiles_activity_check",
      sql`${t.activity_level} IS NULL OR ${t.activity_level} IN ('sedentary', 'moderate', 'high')`,
    ),
    check("profiles_coach_gender_check", sql`${t.coach_gender} IN ('male', 'female')`),
    check(
      "profiles_coach_id_check",
      sql`${t.coach_id} IN ('eli', 'rex', 'brutus', 'maya', 'reya', 'nova')`,
    ),
    check("profiles_data_epoch_check", sql`${t.data_epoch} >= 0`),
  ],
);

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    plan_type: text("plan_type"),
    difficulty: text("difficulty"),
    days_per_week: integer("days_per_week"),
    structure: jsonb("structure").notNull(),
    is_candidate: boolean("is_candidate").notNull().default(false),
    created_at: createdAt(),
  },
  (t) => [index("plans_user_idx").on(t.user_id)],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    parts: jsonb("parts").notNull(),
    created_at: createdAt(),
  },
  (t) => [
    index("chat_messages_user_created_idx").on(t.user_id, t.created_at),
    check("chat_messages_role_check", sql`${t.role} IN ('user', 'assistant', 'system')`),
  ],
);

/**
 * One durable in-flight chat lease per account. This prevents two phones/tabs
 * from racing full-history persistence or mutating the same coaching state at
 * the same time. Expired rows are safely reclaimable after a crashed request.
 */
export const chatRuns = pgTable(
  "chat_runs",
  {
    user_id: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    request_id: uuid("request_id").notNull(),
    message_key: text("message_key").notNull(),
    expires_at: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    created_at: createdAt(),
  },
  (t) => [index("chat_runs_expiry_idx").on(t.expires_at)],
);

export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    content: text("content").notNull(),
    content_key: text("content_key").notNull(),
    created_at: createdAt(),
  },
  (t) => [
    index("memories_user_created_idx").on(t.user_id, t.created_at),
    uniqueIndex("memories_user_content_key_idx").on(t.user_id, t.content_key),
    check(
      "memories_topic_check",
      sql`${t.topic} IN ('Preference', 'Goal', 'Injury', 'Achievement', 'Event', 'Personal')`,
    ),
    check("memories_content_length_check", sql`length(${t.content}) BETWEEN 1 AND 500`),
  ],
);

/**
 * Durable memory-extraction outbox. The visible reply only needs to enqueue a
 * job; a crash or deploy cannot silently lose the memory candidate.
 */
export const memoryJobs = pgTable(
  "memory_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    message_key: text("message_key").notNull(),
    data_epoch: integer("data_epoch").notNull(),
    transcript: text("transcript").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    last_error: text("last_error"),
    available_at: timestamp("available_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    created_at: createdAt(),
    completed_at: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [
    uniqueIndex("memory_jobs_user_message_idx").on(t.user_id, t.message_key),
    index("memory_jobs_pending_idx").on(t.user_id, t.status, t.available_at),
    check(
      "memory_jobs_status_check",
      sql`${t.status} IN ('pending', 'processing', 'completed', 'discarded')`,
    ),
    check("memory_jobs_attempts_check", sql`${t.attempts} >= 0 AND ${t.attempts} <= 10`),
    check("memory_jobs_transcript_length_check", sql`length(${t.transcript}) BETWEEN 1 AND 20000`),
  ],
);

export const mealLogs = pgTable(
  "meal_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    calories: integer("calories"),
    protein_g: doublePrecision("protein_g"),
    carbs_g: doublePrecision("carbs_g"),
    fat_g: doublePrecision("fat_g"),
    ingredients: jsonb("ingredients")
      .$type<
        Array<{
          name: string;
          amount: string;
          calories: number;
          protein_g: number;
          carbs_g: number;
          fat_g: number;
          nutrients?: FoodNutrientEstimates;
          estimate_confidence?: "high" | "medium" | "low";
        }>
      >()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // A calendar day belongs to the user, not the database server. Every
    // writer must supply the phone-local date explicitly.
    logged_date: date("logged_date", { mode: "string" }).notNull(),
    timezone: text("timezone"),
    source_key: text("source_key"),
    logged_at: timestamp("logged_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("meal_logs_user_logged_idx").on(t.user_id, t.logged_at),
    index("meal_logs_user_date_idx").on(t.user_id, t.logged_date),
    uniqueIndex("meal_logs_user_source_idx")
      .on(t.user_id, t.source_key)
      .where(sql`${t.source_key} IS NOT NULL`),
    check(
      "meal_logs_source_length_check",
      sql`${t.source_key} IS NULL OR length(${t.source_key}) BETWEEN 1 AND 200`,
    ),
    check(
      "meal_logs_calories_check",
      sql`${t.calories} IS NULL OR ${t.calories} BETWEEN 0 AND 10000`,
    ),
    check(
      "meal_logs_protein_check",
      sql`${t.protein_g} IS NULL OR ${t.protein_g} BETWEEN 0 AND 1000`,
    ),
    check("meal_logs_carbs_check", sql`${t.carbs_g} IS NULL OR ${t.carbs_g} BETWEEN 0 AND 2000`),
    check("meal_logs_fat_check", sql`${t.fat_g} IS NULL OR ${t.fat_g} BETWEEN 0 AND 1000`),
    check("meal_logs_ingredients_check", sql`jsonb_typeof(${t.ingredients}) = 'array'`),
    check("meal_logs_description_length_check", sql`length(${t.description}) BETWEEN 1 AND 2000`),
  ],
);

// --- Structured training programs (full dated 16-week engine) ---

export const programs = pgTable(
  "programs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    goal: text("goal"),
    experience: text("experience"),
    start_date: text("start_date").notNull(), // YYYY-MM-DD
    end_date: text("end_date").notNull(),
    weeks: integer("weeks").notNull(),
    days_per_week: integer("days_per_week").notNull(),
    schedule_mode: text("schedule_mode").notNull().default("rolling"),
    weekday_indices: jsonb("weekday_indices").notNull().default([]),
    session_minutes: integer("session_minutes"),
    status: text("status").notNull().default("active"), // active | completed | archived
    // Incremented by every prescription/schedule mutation. Adaptation
    // proposals bind to this value so a stale card can never overwrite a
    // newer coach or cross-device change.
    revision: integer("revision").notNull().default(0),
    deload_weeks: jsonb("deload_weeks").notNull().default([]),
    progression_rules: text("progression_rules"),
    why: text("why"),
    created_at: createdAt(),
    completed_at: timestamp("completed_at", { withTimezone: true, mode: "string" }),
    archived_at: timestamp("archived_at", { withTimezone: true, mode: "string" }),
    archive_reason: text("archive_reason"),
    source_key: text("source_key"),
  },
  (t) => [
    index("programs_user_idx").on(t.user_id, t.status),
    uniqueIndex("programs_one_active_user_idx")
      .on(t.user_id)
      .where(sql`${t.status} = 'active'`),
    uniqueIndex("programs_user_source_idx")
      .on(t.user_id, t.source_key)
      .where(sql`${t.source_key} IS NOT NULL`),
    check("programs_status_check", sql`${t.status} IN ('active', 'completed', 'archived')`),
    check("programs_weeks_check", sql`${t.weeks} BETWEEN 1 AND 104`),
    check("programs_days_per_week_check", sql`${t.days_per_week} BETWEEN 1 AND 7`),
    check("programs_revision_check", sql`${t.revision} >= 0`),
    check("programs_schedule_mode_check", sql`${t.schedule_mode} IN ('rolling', 'weekday')`),
    check(
      "programs_weekday_indices_check",
      sql`jsonb_typeof(${t.weekday_indices}) = 'array' AND jsonb_array_length(${t.weekday_indices}) BETWEEN 0 AND 7`,
    ),
    check(
      "programs_dates_check",
      sql`${t.start_date} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND (${t.start_date}::date)::text = ${t.start_date} AND ${t.end_date} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND (${t.end_date}::date)::text = ${t.end_date} AND ${t.end_date} >= ${t.start_date}`,
    ),
    check(
      "programs_source_length_check",
      sql`${t.source_key} IS NULL OR length(${t.source_key}) BETWEEN 1 AND 200`,
    ),
    check(
      "programs_completion_time_check",
      sql`(${t.status} = 'completed' AND ${t.completed_at} IS NOT NULL) OR (${t.status} = 'active' AND ${t.completed_at} IS NULL) OR ${t.status} = 'archived'`,
    ),
  ],
);

/**
 * Canonical bilingual movement library. Program/session rows reference this
 * stable identity while image_path stays independently replaceable.
 */
export const exerciseCatalog = pgTable(
  "exercise_catalog",
  {
    id: text("id").primaryKey(),
    name_en: text("name_en").notNull(),
    name_sv: text("name_sv").notNull(),
    equipment: text("equipment").notNull(),
    aliases: jsonb("aliases").notNull().default([]),
    image_path: text("image_path").notNull(),
    updated_at: updatedAt(),
  },
  (t) => [
    uniqueIndex("exercise_catalog_name_en_idx").on(t.name_en),
    uniqueIndex("exercise_catalog_name_sv_idx").on(t.name_sv),
    check("exercise_catalog_id_check", sql`${t.id} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`),
    check(
      "exercise_catalog_equipment_check",
      sql`${t.equipment} IN ('barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'mixed')`,
    ),
    check("exercise_catalog_image_check", sql`length(${t.image_path}) BETWEEN 1 AND 500`),
  ],
);

/** Idempotency ledger for replay-sensitive program mutations. */
export const programOperations = pgTable(
  "program_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source_key: text("source_key").notNull(),
    operation: text("operation").notNull(),
    payload_hash: text("payload_hash").notNull(),
    result: jsonb("result").notNull(),
    created_at: createdAt(),
  },
  (t) => [
    uniqueIndex("program_operations_user_source_idx").on(t.user_id, t.source_key),
    index("program_operations_user_created_idx").on(t.user_id, t.created_at),
    check(
      "program_operations_operation_check",
      sql`${t.operation} IN ('generate_program', 'adjust_program', 'resolve_day', 'shift_schedule', 'start_session', 'mark_exercise')`,
    ),
    check("program_operations_source_length_check", sql`length(${t.source_key}) BETWEEN 1 AND 200`),
    check("program_operations_payload_hash_check", sql`${t.payload_hash} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const programDays = pgTable(
  "program_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    program_id: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    week: integer("week").notNull(), // 1-based
    day_index: integer("day_index").notNull(), // 1-based within the week
    date: text("date").notNull(), // YYYY-MM-DD — real calendar date
    title: text("title").notNull(), // e.g. "Upper Power"
    focus: text("focus"),
    is_deload: boolean("is_deload").notNull().default(false),
    status: text("status").notNull().default("planned"), // planned | completed | skipped
    session_id: uuid("session_id"), // linked live session when run
    resolution_note: text("resolution_note"),
    resolved_at: timestamp("resolved_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [
    uniqueIndex("program_days_program_date_idx").on(t.program_id, t.date),
    uniqueIndex("program_days_program_week_day_idx").on(t.program_id, t.week, t.day_index),
    index("program_days_date_idx").on(t.date),
    check("program_days_status_check", sql`${t.status} IN ('planned', 'completed', 'skipped')`),
    check("program_days_week_check", sql`${t.week} > 0`),
    check("program_days_day_index_check", sql`${t.day_index} BETWEEN 1 AND 7`),
    check(
      "program_days_date_check",
      sql`${t.date} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND (${t.date}::date)::text = ${t.date}`,
    ),
    check(
      "program_days_completed_session_check",
      sql`${t.status} <> 'completed' OR ${t.session_id} IS NOT NULL`,
    ),
    check(
      "program_days_resolution_time_check",
      sql`(${t.status} = 'planned' AND ${t.resolved_at} IS NULL) OR (${t.status} IN ('completed', 'skipped') AND ${t.resolved_at} IS NOT NULL)`,
    ),
  ],
);

export const programExercises = pgTable(
  "program_exercises",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    program_day_id: uuid("program_day_id")
      .notNull()
      .references(() => programDays.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    exercise_id: text("exercise_id").references(() => exerciseCatalog.id, {
      onDelete: "restrict",
    }),
    name: text("name").notNull(),
    sets: integer("sets").notNull(),
    rep_range: text("rep_range").notNull(), // e.g. "6–8"
    target_weight_kg: doublePrecision("target_weight_kg"),
    // Retained from the generator so the adaptive engine advances or rolls
    // back the plan's own progression step instead of inventing a load.
    progression_step_kg: doublePrecision("progression_step_kg"),
    notes: text("notes"),
  },
  (t) => [
    uniqueIndex("program_exercises_day_position_idx").on(t.program_day_id, t.position),
    check("program_exercises_position_check", sql`${t.position} >= 0`),
    check("program_exercises_sets_check", sql`${t.sets} BETWEEN 1 AND 30`),
    check(
      "program_exercises_target_weight_check",
      sql`${t.target_weight_kg} IS NULL OR ${t.target_weight_kg} BETWEEN 0 AND 1000`,
    ),
    check(
      "program_exercises_progression_step_check",
      sql`${t.progression_step_kg} IS NULL OR ${t.progression_step_kg} BETWEEN 0 AND 100`,
    ),
  ],
);

// Per-set logging inside a live session (actual weight × reps performed).
export const sessionSets = pgTable(
  "session_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    session_exercise_id: uuid("session_exercise_id")
      .notNull()
      .references(() => sessionExercises.id, { onDelete: "cascade" }),
    set_index: integer("set_index").notNull(), // 1-based
    target_reps: text("target_reps"), // e.g. "6–8"
    target_weight_kg: doublePrecision("target_weight_kg"),
    weight_kg: doublePrecision("weight_kg"),
    reps: integer("reps"),
    completed: boolean("completed").notNull().default(false),
    completed_at: timestamp("completed_at", { withTimezone: true, mode: "string" }),
    // Optimistic concurrency token for edits arriving from multiple devices.
    revision: integer("revision").notNull().default(0),
  },
  (t) => [
    uniqueIndex("session_sets_exercise_set_idx").on(t.session_exercise_id, t.set_index),
    check("session_sets_index_check", sql`${t.set_index} BETWEEN 1 AND 30`),
    check(
      "session_sets_target_weight_check",
      sql`${t.target_weight_kg} IS NULL OR ${t.target_weight_kg} BETWEEN 0 AND 1000`,
    ),
    check(
      "session_sets_weight_check",
      sql`${t.weight_kg} IS NULL OR ${t.weight_kg} BETWEEN 0 AND 1000`,
    ),
    check("session_sets_reps_check", sql`${t.reps} IS NULL OR ${t.reps} BETWEEN 1 AND 1000`),
    check(
      "session_sets_completed_values_check",
      sql`NOT ${t.completed} OR (${t.reps} IS NOT NULL AND ${t.completed_at} IS NOT NULL)`,
    ),
    check("session_sets_revision_check", sql`${t.revision} >= 0`),
  ],
);

// Bodyweight history.
export const weightLogs = pgTable(
  "weight_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weight_kg: doublePrecision("weight_kg").notNull(),
    // Never infer this from the database's UTC clock.
    logged_date: date("logged_date", { mode: "string" }).notNull(),
    timezone: text("timezone"),
    source_key: text("source_key"),
    logged_at: timestamp("logged_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("weight_logs_user_idx").on(t.user_id, t.logged_at),
    index("weight_logs_user_date_idx").on(t.user_id, t.logged_date),
    uniqueIndex("weight_logs_user_source_idx")
      .on(t.user_id, t.source_key)
      .where(sql`${t.source_key} IS NOT NULL`),
    check(
      "weight_logs_source_length_check",
      sql`${t.source_key} IS NULL OR length(${t.source_key}) BETWEEN 1 AND 200`,
    ),
    check("weight_logs_value_check", sql`${t.weight_kg} BETWEEN 25 AND 400`),
  ],
);

// Live workout sessions — the coach's real-time "today's workout" engine.
export const workoutSessions = pgTable(
  "workout_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    session_date: text("session_date").notNull(), // YYYY-MM-DD (user-local day)
    title: text("title").notNull(),
    status: text("status").notNull().default("active"), // active | completed | abandoned
    program_day_id: uuid("program_day_id").references(() => programDays.id, {
      onDelete: "set null",
    }), // linked program day (dated engine)
    source_key: text("source_key"),
    duration_minutes: integer("duration_minutes"),
    end_reason: text("end_reason"),
    created_at: createdAt(),
    completed_at: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [
    index("workout_sessions_user_idx").on(t.user_id, t.session_date),
    index("workout_sessions_program_day_idx").on(t.program_day_id),
    uniqueIndex("workout_sessions_one_active_user_idx")
      .on(t.user_id)
      .where(sql`${t.status} = 'active'`),
    uniqueIndex("workout_sessions_one_completed_program_day_idx")
      .on(t.program_day_id)
      .where(sql`${t.status} = 'completed' AND ${t.program_day_id} IS NOT NULL`),
    uniqueIndex("workout_sessions_user_source_idx")
      .on(t.user_id, t.source_key)
      .where(sql`${t.source_key} IS NOT NULL`),
    check(
      "workout_sessions_status_check",
      sql`${t.status} IN ('active', 'completed', 'abandoned')`,
    ),
    check(
      "workout_sessions_date_check",
      sql`${t.session_date} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND (${t.session_date}::date)::text = ${t.session_date}`,
    ),
    check(
      "workout_sessions_duration_check",
      sql`${t.duration_minutes} IS NULL OR ${t.duration_minutes} BETWEEN 0 AND 1440`,
    ),
    check(
      "workout_sessions_source_length_check",
      sql`${t.source_key} IS NULL OR length(${t.source_key}) BETWEEN 1 AND 200`,
    ),
    check(
      "workout_sessions_completion_time_check",
      sql`${t.status} <> 'completed' OR ${t.completed_at} IS NOT NULL`,
    ),
  ],
);

export const sessionExercises = pgTable(
  "session_exercises",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    session_id: uuid("session_id")
      .notNull()
      .references(() => workoutSessions.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    exercise_id: text("exercise_id").references(() => exerciseCatalog.id, {
      onDelete: "restrict",
    }),
    name: text("name").notNull(),
    target: text("target"), // e.g. "4×6–8 @ 60kg"
    // Immutable number of rows copied from the workout plan. Rows with a
    // larger set_index are real, user-reported extra sets and may be removed
    // by a later complete-list correction without touching the plan.
    planned_set_count: integer("planned_set_count").notNull().default(3),
    completed: boolean("completed").notNull().default(false),
    completed_at: timestamp("completed_at", { withTimezone: true, mode: "string" }),
    notes: text("notes"),
  },
  (t) => [
    uniqueIndex("session_exercises_session_position_idx").on(t.session_id, t.position),
    check("session_exercises_position_check", sql`${t.position} >= 0`),
    check(
      "session_exercises_planned_set_count_check",
      sql`${t.planned_set_count} BETWEEN 1 AND 30`,
    ),
    check("session_exercises_name_length_check", sql`length(${t.name}) BETWEEN 1 AND 200`),
    check(
      "session_exercises_completion_time_check",
      sql`NOT ${t.completed} OR ${t.completed_at} IS NOT NULL`,
    ),
  ],
);

/** Optional three-tap recovery check-in for one completed workout. */
export const workoutReviews = pgTable(
  "workout_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    session_id: uuid("session_id")
      .notNull()
      .references(() => workoutSessions.id, { onDelete: "cascade" }),
    data_epoch: integer("data_epoch").notNull(),
    difficulty: integer("difficulty").notNull(),
    energy: integer("energy").notNull(),
    discomfort: integer("discomfort").notNull(),
    note: text("note"),
    created_at: createdAt(),
  },
  (t) => [
    uniqueIndex("workout_reviews_session_idx").on(t.session_id),
    index("workout_reviews_user_created_idx").on(t.user_id, t.created_at),
    check("workout_reviews_epoch_check", sql`${t.data_epoch} >= 0`),
    check("workout_reviews_difficulty_check", sql`${t.difficulty} BETWEEN 1 AND 5`),
    check("workout_reviews_energy_check", sql`${t.energy} BETWEEN 1 AND 5`),
    check("workout_reviews_discomfort_check", sql`${t.discomfort} BETWEEN 1 AND 5`),
    check(
      "workout_reviews_note_length_check",
      sql`${t.note} IS NULL OR length(${t.note}) BETWEEN 1 AND 1000`,
    ),
  ],
);

/**
 * Durable, non-mutating recommendation. The options are server-generated
 * action bundles; accepting one applies the whole bundle transactionally.
 */
export const adaptationProposals = pgTable(
  "adaptation_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    review_id: uuid("review_id")
      .notNull()
      .references(() => workoutReviews.id, { onDelete: "cascade" }),
    program_id: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    program_revision: integer("program_revision").notNull(),
    data_epoch: integer("data_epoch").notNull(),
    coach_id: text("coach_id").notNull(),
    status: text("status").notNull().default("pending"),
    rationale_en: text("rationale_en").notNull(),
    rationale_sv: text("rationale_sv").notNull(),
    options: jsonb("options").notNull(),
    selected_option_id: text("selected_option_id"),
    applied_changes: jsonb("applied_changes"),
    created_at: createdAt(),
    decided_at: timestamp("decided_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [
    uniqueIndex("adaptation_proposals_review_idx").on(t.review_id),
    index("adaptation_proposals_user_status_idx").on(t.user_id, t.status, t.created_at),
    index("adaptation_proposals_program_idx").on(t.program_id, t.created_at),
    check("adaptation_proposals_revision_check", sql`${t.program_revision} >= 0`),
    check("adaptation_proposals_epoch_check", sql`${t.data_epoch} >= 0`),
    check(
      "adaptation_proposals_coach_check",
      sql`${t.coach_id} IN ('eli', 'rex', 'brutus', 'maya', 'reya', 'nova')`,
    ),
    check(
      "adaptation_proposals_status_check",
      sql`${t.status} IN ('pending', 'applied', 'kept', 'stale')`,
    ),
    check(
      "adaptation_proposals_options_check",
      sql`jsonb_typeof(${t.options}) = 'array' AND jsonb_array_length(${t.options}) BETWEEN 1 AND 2`,
    ),
    check(
      "adaptation_proposals_decision_check",
      sql`(${t.status} = 'pending' AND ${t.decided_at} IS NULL AND ${t.selected_option_id} IS NULL) OR (${t.status} = 'kept' AND ${t.decided_at} IS NOT NULL AND ${t.selected_option_id} IS NULL) OR (${t.status} IN ('applied', 'stale') AND ${t.decided_at} IS NOT NULL)`,
    ),
  ],
);

/** Generic coach-defined measurements (heart rate, waist, sleep, habits, etc.). */
export const measurements = pgTable(
  "measurements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    metric_key: text("metric_key").notNull(),
    label: text("label").notNull(),
    value: doublePrecision("value").notNull(),
    unit: text("unit").notNull(),
    // Required from the client/coach local-date context.
    recorded_date: date("recorded_date", { mode: "string" }).notNull(),
    timezone: text("timezone"),
    notes: text("notes"),
    source_key: text("source_key"),
    recorded_at: timestamp("recorded_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("measurements_user_metric_date_idx").on(t.user_id, t.metric_key, t.recorded_date),
    uniqueIndex("measurements_user_source_idx")
      .on(t.user_id, t.source_key)
      .where(sql`${t.source_key} IS NOT NULL`),
    check("measurements_key_check", sql`${t.metric_key} ~ '^[a-z0-9][a-z0-9_-]{0,63}$'`),
    check("measurements_value_check", sql`${t.value} BETWEEN -1000000 AND 1000000`),
    check("measurements_label_length_check", sql`length(${t.label}) BETWEEN 1 AND 100`),
    check("measurements_unit_length_check", sql`length(${t.unit}) BETWEEN 1 AND 40`),
    check(
      "measurements_source_length_check",
      sql`${t.source_key} IS NULL OR length(${t.source_key}) BETWEEN 1 AND 200`,
    ),
  ],
);

export const workspaceFiles = pgTable(
  "workspace_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    content: text("content").notNull().default(""),
    size_bytes: integer("size_bytes").notNull().default(0),
    summary: text("summary").notNull().default(""),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (t) => [
    uniqueIndex("workspace_files_user_path_idx").on(t.user_id, t.path),
    check("workspace_files_size_check", sql`${t.size_bytes} BETWEEN 0 AND 1000000`),
  ],
);

export type Profile = typeof profiles.$inferSelect;
export type User = typeof users.$inferSelect;
