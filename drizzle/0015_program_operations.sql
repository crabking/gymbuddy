CREATE TABLE "program_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"operation" text NOT NULL,
	"payload_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "program_operations_operation_check" CHECK ("program_operations"."operation" IN ('generate_program', 'adjust_program', 'resolve_day', 'shift_schedule')),
	CONSTRAINT "program_operations_source_length_check" CHECK (length("program_operations"."source_key") BETWEEN 1 AND 200),
	CONSTRAINT "program_operations_payload_hash_check" CHECK ("program_operations"."payload_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "program_operations" ADD CONSTRAINT "program_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "program_operations_user_source_idx" ON "program_operations" USING btree ("user_id","source_key");--> statement-breakpoint
CREATE INDEX "program_operations_user_created_idx" ON "program_operations" USING btree ("user_id","created_at");
