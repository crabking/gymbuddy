CREATE TABLE "program_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"week" integer NOT NULL,
	"day_index" integer NOT NULL,
	"date" text NOT NULL,
	"title" text NOT NULL,
	"focus" text,
	"is_deload" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"session_id" uuid
);
--> statement-breakpoint
CREATE TABLE "program_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_day_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"sets" integer NOT NULL,
	"rep_range" text NOT NULL,
	"target_weight_kg" double precision,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"goal" text,
	"experience" text,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"weeks" integer NOT NULL,
	"days_per_week" integer NOT NULL,
	"session_minutes" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"deload_weeks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"progression_rules" text,
	"why" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_exercise_id" uuid NOT NULL,
	"set_index" integer NOT NULL,
	"target_reps" text,
	"weight_kg" double precision,
	"reps" integer,
	"completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "weight_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"weight_kg" double precision NOT NULL,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "program_day_id" uuid;--> statement-breakpoint
ALTER TABLE "program_days" ADD CONSTRAINT "program_days_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_exercises" ADD CONSTRAINT "program_exercises_program_day_id_program_days_id_fk" FOREIGN KEY ("program_day_id") REFERENCES "public"."program_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_sets" ADD CONSTRAINT "session_sets_session_exercise_id_session_exercises_id_fk" FOREIGN KEY ("session_exercise_id") REFERENCES "public"."session_exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_logs" ADD CONSTRAINT "weight_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "program_days_program_idx" ON "program_days" USING btree ("program_id","date");--> statement-breakpoint
CREATE INDEX "program_days_date_idx" ON "program_days" USING btree ("date");--> statement-breakpoint
CREATE INDEX "program_exercises_day_idx" ON "program_exercises" USING btree ("program_day_id","position");--> statement-breakpoint
CREATE INDEX "programs_user_idx" ON "programs" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "session_sets_exercise_idx" ON "session_sets" USING btree ("session_exercise_id","set_index");--> statement-breakpoint
CREATE INDEX "weight_logs_user_idx" ON "weight_logs" USING btree ("user_id","logged_at");