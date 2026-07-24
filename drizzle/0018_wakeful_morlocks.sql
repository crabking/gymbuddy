ALTER TABLE "session_exercises" ADD COLUMN "planned_set_count" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
UPDATE "session_exercises" AS se
SET "planned_set_count" = pe."sets"
FROM "workout_sessions" AS ws, "program_exercises" AS pe
WHERE se."session_id" = ws."id"
  AND ws."program_day_id" = pe."program_day_id"
  AND se."position" = pe."position"
  AND pe."sets" BETWEEN 1 AND 30;--> statement-breakpoint
UPDATE "session_exercises" AS se
SET "planned_set_count" = counts."set_count"
FROM (
  SELECT ss."session_exercise_id", LEAST(30, GREATEST(1, count(*)::integer)) AS "set_count"
  FROM "session_sets" AS ss
  GROUP BY ss."session_exercise_id"
) AS counts
WHERE se."id" = counts."session_exercise_id"
  AND NOT EXISTS (
    SELECT 1
    FROM "workout_sessions" AS ws
    JOIN "program_exercises" AS pe
      ON pe."program_day_id" = ws."program_day_id"
     AND pe."position" = se."position"
    WHERE ws."id" = se."session_id"
  );--> statement-breakpoint
ALTER TABLE "session_exercises" ADD CONSTRAINT "session_exercises_planned_set_count_check" CHECK ("session_exercises"."planned_set_count" BETWEEN 1 AND 30);
