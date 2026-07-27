CREATE TABLE "billing_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"clerk_user_id" text,
	"status" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"charge_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_payments_status_check" CHECK ("billing_payments"."status" IN ('pending', 'paid', 'failed')),
	CONSTRAINT "billing_payments_amount_check" CHECK ("billing_payments"."amount_minor" >= 0),
	CONSTRAINT "billing_payments_currency_check" CHECK ("billing_payments"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "billing_payments_charge_type_check" CHECK ("billing_payments"."charge_type" IN ('checkout', 'recurring'))
);
--> statement-breakpoint
CREATE TABLE "billing_subscriptions" (
	"clerk_subscription_item_id" text PRIMARY KEY NOT NULL,
	"clerk_subscription_id" text,
	"user_id" uuid,
	"clerk_user_id" text,
	"plan_id" text,
	"plan_slug" text,
	"status" text NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_subscriptions_status_check" CHECK ("billing_subscriptions"."status" IN ('abandoned', 'active', 'canceled', 'ended', 'expired', 'incomplete', 'past_due', 'upcoming'))
);
--> statement-breakpoint
CREATE TABLE "clerk_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"entity_id" text,
	"payload_sha256" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clerk_events_id_check" CHECK (length("clerk_events"."id") BETWEEN 1 AND 255),
	CONSTRAINT "clerk_events_type_check" CHECK (length("clerk_events"."event_type") BETWEEN 1 AND 100),
	CONSTRAINT "clerk_events_hash_check" CHECK ("clerk_events"."payload_sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auth_provider" text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "clerk_user_id" text;--> statement-breakpoint
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_payments_user_created_idx" ON "billing_payments" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "billing_subscriptions_user_status_idx" ON "billing_subscriptions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "billing_subscriptions_clerk_user_idx" ON "billing_subscriptions" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX "clerk_events_type_processed_idx" ON "clerk_events" USING btree ("event_type","processed_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_clerk_user_id_unique" UNIQUE("clerk_user_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_auth_provider_check" CHECK ("users"."auth_provider" IN ('local', 'clerk'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_clerk_identity_check" CHECK (("users"."auth_provider" = 'local') OR ("users"."clerk_user_id" IS NOT NULL AND length("users"."clerk_user_id") BETWEEN 5 AND 255));