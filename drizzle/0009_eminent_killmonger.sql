WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS rn
  FROM programs
  WHERE status = 'active'
)
UPDATE programs
SET status = 'archived'
FROM ranked
WHERE programs.id = ranked.id AND ranked.rn > 1;--> statement-breakpoint
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS rn
  FROM workout_sessions
  WHERE status = 'active'
)
UPDATE workout_sessions
SET status = 'abandoned'
FROM ranked
WHERE workout_sessions.id = ranked.id AND ranked.rn > 1;--> statement-breakpoint
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY program_day_id
      ORDER BY completed_at DESC NULLS LAST, created_at DESC, id DESC
    ) AS rn
  FROM workout_sessions
  WHERE status = 'completed' AND program_day_id IS NOT NULL
)
UPDATE workout_sessions
SET status = 'abandoned'
FROM ranked
WHERE workout_sessions.id = ranked.id AND ranked.rn > 1;--> statement-breakpoint
DROP INDEX "program_days_program_idx";--> statement-breakpoint
DROP INDEX "session_exercises_session_idx";--> statement-breakpoint
DROP INDEX "session_sets_exercise_idx";--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "programs"
SET "completed_at" = "created_at"
WHERE "status" = 'completed' AND "completed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "program_days_program_date_idx" ON "program_days" USING btree ("program_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "programs_one_active_user_idx" ON "programs" USING btree ("user_id") WHERE "programs"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "session_exercises_session_position_idx" ON "session_exercises" USING btree ("session_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "session_sets_exercise_set_idx" ON "session_sets" USING btree ("session_exercise_id","set_index");--> statement-breakpoint
CREATE UNIQUE INDEX "workout_sessions_one_active_user_idx" ON "workout_sessions" USING btree ("user_id") WHERE "workout_sessions"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "workout_sessions_one_completed_program_day_idx" ON "workout_sessions" USING btree ("program_day_id") WHERE "workout_sessions"."status" = 'completed' AND "workout_sessions"."program_day_id" IS NOT NULL;
