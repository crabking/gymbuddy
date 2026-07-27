CREATE TABLE "deployment_metadata" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployment_metadata_key_check" CHECK (length("deployment_metadata"."key") BETWEEN 1 AND 64),
	CONSTRAINT "deployment_metadata_value_check" CHECK (length("deployment_metadata"."value") BETWEEN 1 AND 256)
);
--> statement-breakpoint
CREATE TABLE "policy_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document" text NOT NULL,
	"version" text NOT NULL,
	"locale" text NOT NULL,
	"source" text DEFAULT 'web' NOT NULL,
	"user_agent_hash" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_consents_document_check" CHECK ("policy_consents"."document" IN ('terms', 'privacy_notice', 'health_data', 'health_safety', 'adult_attestation')),
	CONSTRAINT "policy_consents_locale_check" CHECK ("policy_consents"."locale" IN ('en', 'sv')),
	CONSTRAINT "policy_consents_source_check" CHECK ("policy_consents"."source" IN ('web', 'android')),
	CONSTRAINT "policy_consents_version_check" CHECK (length("policy_consents"."version") BETWEEN 1 AND 64),
	CONSTRAINT "policy_consents_user_agent_hash_check" CHECK ("policy_consents"."user_agent_hash" IS NULL OR "policy_consents"."user_agent_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "profiles" DROP CONSTRAINT "profiles_age_check";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "policy_bundle_version" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "policy_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "policy_consents" ADD CONSTRAINT "policy_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "policy_consents_user_document_version_idx" ON "policy_consents" USING btree ("user_id","document","version");--> statement-breakpoint
CREATE INDEX "policy_consents_user_granted_idx" ON "policy_consents" USING btree ("user_id","granted_at");--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_age_check" CHECK ("profiles"."age" IS NULL OR "profiles"."age" BETWEEN 18 AND 120);