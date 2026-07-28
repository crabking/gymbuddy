CREATE TABLE "ai_usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"user_id" uuid,
	"purpose" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_microusd" bigint,
	"duration_ms" integer NOT NULL,
	"error_code" text,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_usage_events_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "ai_usage_events_purpose_check" CHECK ("ai_usage_events"."purpose" IN ('coach_chat', 'chat_compaction', 'memory_extraction')),
	CONSTRAINT "ai_usage_events_status_check" CHECK ("ai_usage_events"."status" IN ('succeeded', 'failed')),
	CONSTRAINT "ai_usage_events_provider_length_check" CHECK (length("ai_usage_events"."provider") BETWEEN 1 AND 40),
	CONSTRAINT "ai_usage_events_model_length_check" CHECK (length("ai_usage_events"."model") BETWEEN 1 AND 160),
	CONSTRAINT "ai_usage_events_token_check" CHECK ("ai_usage_events"."input_tokens" >= 0 AND "ai_usage_events"."cache_read_tokens" >= 0 AND "ai_usage_events"."cache_write_tokens" >= 0 AND "ai_usage_events"."output_tokens" >= 0 AND "ai_usage_events"."reasoning_tokens" >= 0 AND "ai_usage_events"."total_tokens" >= 0),
	CONSTRAINT "ai_usage_events_cost_check" CHECK ("ai_usage_events"."estimated_cost_microusd" IS NULL OR "ai_usage_events"."estimated_cost_microusd" >= 0),
	CONSTRAINT "ai_usage_events_duration_check" CHECK ("ai_usage_events"."duration_ms" BETWEEN 0 AND 3600000),
	CONSTRAINT "ai_usage_events_error_check" CHECK ("ai_usage_events"."error_code" IS NULL OR length("ai_usage_events"."error_code") BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_name" text NOT NULL,
	"actor_user_id" uuid,
	"visitor_hash" text,
	"route" text,
	"source" text NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_events_name_check" CHECK ("analytics_events"."event_name" IN ('page_view', 'signup_started', 'signup_completed', 'login_completed', 'onboarding_completed', 'checkout_started', 'checkout_completed', 'subscription_activated', 'subscription_cancelled', 'payment_succeeded', 'payment_failed', 'payment_refunded', 'chat_user_message', 'chat_assistant_message')),
	CONSTRAINT "analytics_events_source_check" CHECK ("analytics_events"."source" IN ('web', 'server', 'stripe')),
	CONSTRAINT "analytics_events_visitor_hash_check" CHECK ("analytics_events"."visitor_hash" IS NULL OR "analytics_events"."visitor_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "analytics_events_route_check" CHECK ("analytics_events"."route" IS NULL OR (length("analytics_events"."route") BETWEEN 1 AND 160 AND "analytics_events"."route" ~ '^/[a-zA-Z0-9_./-]*$')),
	CONSTRAINT "analytics_events_properties_check" CHECK (jsonb_typeof("analytics_events"."properties") = 'object' AND pg_column_size("analytics_events"."properties") <= 4096),
	CONSTRAINT "analytics_events_idempotency_length_check" CHECK ("analytics_events"."idempotency_key" IS NULL OR length("analytics_events"."idempotency_key") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "billing_ledger" (
	"event_id" text PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_ledger_kind_check" CHECK ("billing_ledger"."kind" IN ('payment_succeeded', 'payment_failed', 'payment_refunded')),
	CONSTRAINT "billing_ledger_amount_check" CHECK ("billing_ledger"."amount_minor" >= 0),
	CONSTRAINT "billing_ledger_currency_check" CHECK ("billing_ledger"."currency" ~ '^[a-z]{3}$'),
	CONSTRAINT "billing_ledger_event_id_check" CHECK (length("billing_ledger"."event_id") BETWEEN 1 AND 255)
);
--> statement-breakpoint
ALTER TABLE "program_days" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
UPDATE "program_days" AS pd
SET "resolved_at" = LEAST(COALESCE(
	(
		SELECT ws."completed_at"
		FROM "workout_sessions" AS ws
		WHERE ws."program_day_id" = pd."id"
		  AND ws."status" = 'completed'
		ORDER BY ws."completed_at" DESC NULLS LAST
		LIMIT 1
	),
	(pd."date"::date)::timestamp with time zone,
	now()
), now())
WHERE pd."status" IN ('completed', 'skipped');--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_ledger" ADD CONSTRAINT "billing_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_events_completed_idx" ON "ai_usage_events" USING btree ("completed_at");--> statement-breakpoint
CREATE INDEX "ai_usage_events_user_completed_idx" ON "ai_usage_events" USING btree ("user_id","completed_at");--> statement-breakpoint
CREATE INDEX "ai_usage_events_model_completed_idx" ON "ai_usage_events" USING btree ("model","completed_at");--> statement-breakpoint
CREATE INDEX "analytics_events_name_time_idx" ON "analytics_events" USING btree ("event_name","occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_events_actor_time_idx" ON "analytics_events" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_events_visitor_time_idx" ON "analytics_events" USING btree ("visitor_hash","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_events_idempotency_idx" ON "analytics_events" USING btree ("idempotency_key") WHERE "analytics_events"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "billing_ledger_occurred_idx" ON "billing_ledger" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "billing_ledger_user_occurred_idx" ON "billing_ledger" USING btree ("user_id","occurred_at");--> statement-breakpoint
ALTER TABLE "program_days" ADD CONSTRAINT "program_days_resolution_time_check" CHECK (("program_days"."status" = 'planned' AND "program_days"."resolved_at" IS NULL) OR ("program_days"."status" IN ('completed', 'skipped') AND "program_days"."resolved_at" IS NOT NULL));
