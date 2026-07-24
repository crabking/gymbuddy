CREATE TABLE "rate_limit_buckets" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "rate_limit_buckets_count_check" CHECK ("rate_limit_buckets"."count" BETWEEN 1 AND 1000000)
);
--> statement-breakpoint
CREATE INDEX "rate_limit_buckets_expiry_idx" ON "rate_limit_buckets" USING btree ("expires_at");