UPDATE "workout_sessions" ws
SET "program_day_id" = NULL
WHERE "program_day_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "program_days" pd WHERE pd."id" = ws."program_day_id"
  );--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_program_day_id_program_days_id_fk" FOREIGN KEY ("program_day_id") REFERENCES "public"."program_days"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workout_sessions_program_day_idx" ON "workout_sessions" USING btree ("program_day_id");--> statement-breakpoint
ALTER TABLE "program_days" ADD CONSTRAINT "program_days_status_check" CHECK ("program_days"."status" IN ('planned', 'completed', 'skipped'));--> statement-breakpoint
ALTER TABLE "program_days" ADD CONSTRAINT "program_days_week_check" CHECK ("program_days"."week" > 0);--> statement-breakpoint
ALTER TABLE "program_days" ADD CONSTRAINT "program_days_day_index_check" CHECK ("program_days"."day_index" BETWEEN 1 AND 7);--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_status_check" CHECK ("programs"."status" IN ('active', 'completed', 'archived'));--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_weeks_check" CHECK ("programs"."weeks" BETWEEN 1 AND 104);--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_days_per_week_check" CHECK ("programs"."days_per_week" BETWEEN 1 AND 7);--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_status_check" CHECK ("workout_sessions"."status" IN ('active', 'completed', 'abandoned'));
