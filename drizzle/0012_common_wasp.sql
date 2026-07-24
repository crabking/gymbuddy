CREATE TABLE "chat_runs" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"message_key" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"metric_key" text NOT NULL,
	"label" text NOT NULL,
	"value" double precision NOT NULL,
	"unit" text NOT NULL,
	"recorded_date" date NOT NULL,
	"timezone" text,
	"notes" text,
	"source_key" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "measurements_key_check" CHECK ("measurements"."metric_key" ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
	CONSTRAINT "measurements_value_check" CHECK ("measurements"."value" BETWEEN -1000000 AND 1000000),
	CONSTRAINT "measurements_label_length_check" CHECK (length("measurements"."label") BETWEEN 1 AND 100),
	CONSTRAINT "measurements_unit_length_check" CHECK (length("measurements"."unit") BETWEEN 1 AND 40)
);
--> statement-breakpoint
CREATE TABLE "memory_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"message_key" text NOT NULL,
	"data_epoch" integer NOT NULL,
	"transcript" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "memory_jobs_status_check" CHECK ("memory_jobs"."status" IN ('pending', 'processing', 'completed', 'discarded')),
	CONSTRAINT "memory_jobs_attempts_check" CHECK ("memory_jobs"."attempts" >= 0 AND "memory_jobs"."attempts" <= 10),
	CONSTRAINT "memory_jobs_transcript_length_check" CHECK (length("memory_jobs"."transcript") BETWEEN 1 AND 20000)
);
--> statement-breakpoint
DROP INDEX "program_exercises_day_idx";--> statement-breakpoint
ALTER TABLE "meal_logs" ADD COLUMN "logged_date" date;--> statement-breakpoint
ALTER TABLE "meal_logs" ADD COLUMN "timezone" text;--> statement-breakpoint
UPDATE "meal_logs"
SET
	"logged_date" = ("logged_at" AT TIME ZONE 'UTC')::date,
	"timezone" = 'UTC'
WHERE "logged_date" IS NULL;--> statement-breakpoint
ALTER TABLE "meal_logs" ALTER COLUMN "logged_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "meal_logs" ADD COLUMN "source_key" text;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "content_key" text;--> statement-breakpoint
UPDATE "memories"
SET
	"topic" = CASE
		WHEN "topic" IN ('Preference', 'Goal', 'Injury', 'Achievement', 'Event', 'Personal')
			THEN "topic"
		ELSE 'Personal'
	END,
	"content" = CASE
		WHEN trim("content") = '' THEN '[Legacy memory was empty]'
		ELSE left(trim("content"), 500)
	END;--> statement-breakpoint
WITH ranked AS (
	SELECT
		"id",
		lower(regexp_replace(trim("content"), '\s+', ' ', 'g')) AS normalized,
		row_number() OVER (
			PARTITION BY "user_id", lower(regexp_replace(trim("content"), '\s+', ' ', 'g'))
			ORDER BY "created_at", "id"
		) AS duplicate_number
	FROM "memories"
)
UPDATE "memories" m
SET "content_key" = CASE
	WHEN ranked.duplicate_number = 1 THEN ranked.normalized
	ELSE ranked.normalized || ':' || m."id"::text
END
FROM ranked
WHERE ranked."id" = m."id";--> statement-breakpoint
ALTER TABLE "memories" ALTER COLUMN "content_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "data_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "archive_reason" text;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "source_key" text;--> statement-breakpoint
ALTER TABLE "session_sets" ADD COLUMN "target_weight_kg" double precision;--> statement-breakpoint
ALTER TABLE "weight_logs" ADD COLUMN "logged_date" date;--> statement-breakpoint
ALTER TABLE "weight_logs" ADD COLUMN "timezone" text;--> statement-breakpoint
UPDATE "weight_logs"
SET
	"logged_date" = ("logged_at" AT TIME ZONE 'UTC')::date,
	"timezone" = 'UTC'
WHERE "logged_date" IS NULL;--> statement-breakpoint
ALTER TABLE "weight_logs" ALTER COLUMN "logged_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "weight_logs" ADD COLUMN "source_key" text;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "source_key" text;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "duration_minutes" integer;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "end_reason" text;--> statement-breakpoint
UPDATE "session_sets"
SET "target_weight_kg" = "weight_kg"
WHERE
	"target_weight_kg" IS NULL
	AND "weight_kg" BETWEEN 0 AND 1000;--> statement-breakpoint
UPDATE "session_exercises" se
SET "notes" = concat_ws(
	E'\n',
	nullif(se."notes", ''),
	'Legacy set data outside supported ranges was retained as incomplete rather than counted as performance.'
)
WHERE EXISTS (
	SELECT 1
	FROM "session_sets" ss
	WHERE
		ss."session_exercise_id" = se."id"
		AND (
			ss."reps" IS NULL
			OR NOT (ss."reps" BETWEEN 1 AND 1000)
			OR (ss."weight_kg" IS NOT NULL AND NOT (ss."weight_kg" BETWEEN 0 AND 1000))
			OR (ss."completed" AND ss."completed_at" IS NULL)
		)
);--> statement-breakpoint
UPDATE "session_sets"
SET
	"weight_kg" = CASE
		WHEN "reps" BETWEEN 1 AND 1000 AND ("weight_kg" IS NULL OR "weight_kg" BETWEEN 0 AND 1000)
			THEN "weight_kg"
		ELSE NULL
	END,
	"reps" = CASE WHEN "reps" BETWEEN 1 AND 1000 THEN "reps" ELSE NULL END,
	"completed" = (
		"completed"
		AND "reps" BETWEEN 1 AND 1000
		AND "completed_at" IS NOT NULL
	),
	"completed_at" = CASE
		WHEN "completed" AND "reps" BETWEEN 1 AND 1000 AND "completed_at" IS NOT NULL
			THEN "completed_at"
		ELSE NULL
	END;--> statement-breakpoint
UPDATE "session_sets"
SET "target_weight_kg" = NULL
WHERE "target_weight_kg" IS NOT NULL AND NOT ("target_weight_kg" BETWEEN 0 AND 1000);--> statement-breakpoint

-- Preserve the legacy workout log stream as structured, immutable sessions
-- before removing the obsolete split-brain table. Invalid/missing actuals are
-- retained in notes and never turned into fabricated performance metrics.
CREATE TEMP TABLE "legacy_workout_session_map" (
	"user_id" uuid NOT NULL,
	"session_date" text NOT NULL,
	"session_id" uuid PRIMARY KEY
) ON COMMIT DROP;--> statement-breakpoint
INSERT INTO "legacy_workout_session_map" ("user_id", "session_date", "session_id")
SELECT grouped."user_id", grouped."session_date", gen_random_uuid()
FROM (
	SELECT DISTINCT
		"user_id",
		(("logged_at" AT TIME ZONE 'UTC')::date)::text AS "session_date"
	FROM "workout_logs"
) grouped;--> statement-breakpoint
INSERT INTO "workout_sessions" (
	"id",
	"user_id",
	"session_date",
	"title",
	"status",
	"created_at",
	"completed_at",
	"end_reason"
)
SELECT
	m."session_id",
	m."user_id",
	m."session_date",
	'Migrated workout log',
	CASE
		WHEN bool_and(coalesce(w."reps" BETWEEN 1 AND 1000, false)) THEN 'completed'
		ELSE 'abandoned'
	END,
	min(w."logged_at"),
	CASE
		WHEN bool_and(coalesce(w."reps" BETWEEN 1 AND 1000, false)) THEN max(w."logged_at")
		ELSE NULL
	END,
	'legacy_migration'
FROM "legacy_workout_session_map" m
JOIN "workout_logs" w
	ON w."user_id" = m."user_id"
	AND (w."logged_at" AT TIME ZONE 'UTC')::date::text = m."session_date"
GROUP BY m."session_id", m."user_id", m."session_date";--> statement-breakpoint
CREATE TEMP TABLE "legacy_workout_exercise_map" (
	"log_id" uuid PRIMARY KEY,
	"exercise_id" uuid NOT NULL,
	"session_id" uuid NOT NULL
) ON COMMIT DROP;--> statement-breakpoint
INSERT INTO "legacy_workout_exercise_map" ("log_id", "exercise_id", "session_id")
SELECT w."id", gen_random_uuid(), m."session_id"
FROM "workout_logs" w
JOIN "legacy_workout_session_map" m
	ON m."user_id" = w."user_id"
	AND m."session_date" = (w."logged_at" AT TIME ZONE 'UTC')::date::text;--> statement-breakpoint
INSERT INTO "session_exercises" (
	"id",
	"session_id",
	"position",
	"name",
	"completed",
	"completed_at",
	"notes"
)
SELECT
	em."exercise_id",
	em."session_id",
	(row_number() OVER (
		PARTITION BY em."session_id"
		ORDER BY w."logged_at", w."id"
	) - 1)::integer,
	left(w."exercise", 200),
	coalesce(w."reps" BETWEEN 1 AND 1000, false),
	CASE WHEN w."reps" BETWEEN 1 AND 1000 THEN w."logged_at" ELSE NULL END,
	nullif(
		concat_ws(
			E'\n',
			nullif(w."notes", ''),
			CASE WHEN w."rpe" IS NOT NULL THEN 'Legacy RPE: ' || w."rpe"::text END,
			CASE
				WHEN w."weight_kg" IS NOT NULL AND NOT (w."weight_kg" BETWEEN 0 AND 1000)
				THEN 'Legacy weight outside supported range: ' || w."weight_kg"::text
			END,
			CASE
				WHEN w."reps" IS NULL OR NOT (w."reps" BETWEEN 1 AND 1000)
				THEN 'Legacy reps missing or outside supported range'
			END
		),
		''
	)
FROM "workout_logs" w
JOIN "legacy_workout_exercise_map" em ON em."log_id" = w."id";--> statement-breakpoint
INSERT INTO "session_sets" (
	"session_exercise_id",
	"set_index",
	"weight_kg",
	"reps",
	"completed",
	"completed_at"
)
SELECT
	em."exercise_id",
	1,
	CASE WHEN w."weight_kg" BETWEEN 0 AND 1000 THEN w."weight_kg" ELSE NULL END,
	CASE WHEN w."reps" BETWEEN 1 AND 1000 THEN w."reps" ELSE NULL END,
	coalesce(w."reps" BETWEEN 1 AND 1000, false),
	CASE WHEN w."reps" BETWEEN 1 AND 1000 THEN w."logged_at" ELSE NULL END
FROM "workout_logs" w
JOIN "legacy_workout_exercise_map" em ON em."log_id" = w."id";--> statement-breakpoint
ALTER TABLE "workout_logs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "workout_logs" CASCADE;--> statement-breakpoint
ALTER TABLE "workspace_files" ADD COLUMN "size_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_files" ADD COLUMN "summary" text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE "workspace_files"
SET
	"size_bytes" = octet_length("content"),
	"summary" = left(split_part("content", E'\n', 1), 160);--> statement-breakpoint

-- Split an oversized legacy workspace document into deterministic hidden
-- chunks. This preserves every character while bringing each active row under
-- the new one-megabyte bound.
INSERT INTO "workspace_files" (
	"user_id",
	"path",
	"content",
	"size_bytes",
	"summary",
	"created_at",
	"updated_at"
)
SELECT
	file."user_id",
	'.legacy-overflow/' || file."id"::text || '/' || (chunk."number" - 1)::text,
	substring(file."content" FROM ((chunk."number" - 1) * 250000 + 1) FOR 250000),
	octet_length(
		substring(file."content" FROM ((chunk."number" - 1) * 250000 + 1) FOR 250000)
	),
	'Continuation chunk ' || (chunk."number" - 1)::text || ' of legacy file ' || file."path",
	file."created_at",
	file."updated_at"
FROM "workspace_files" file
CROSS JOIN LATERAL generate_series(
	2,
	ceil(char_length(file."content") / 250000.0)::integer
) AS chunk("number")
WHERE file."size_bytes" > 1000000;--> statement-breakpoint
UPDATE "workspace_files"
SET
	"content" = left("content", 250000),
	"size_bytes" = octet_length(left("content", 250000)),
	"summary" = left('Legacy oversized file split into .legacy-overflow chunks: ' || "path", 160)
WHERE "size_bytes" > 1000000;--> statement-breakpoint

-- Bodyweights outside the supported physiological range cannot remain in the
-- bodyweight trend. Preserve their exact value as an explicitly labelled
-- custom legacy measurement, then remove them from the bodyweight stream.
INSERT INTO "measurements" (
	"user_id",
	"metric_key",
	"label",
	"value",
	"unit",
	"recorded_date",
	"timezone",
	"notes",
	"source_key",
	"recorded_at"
)
SELECT
	"user_id",
	'legacy_invalid_body_weight',
	'Legacy invalid bodyweight',
	"weight_kg",
	'kg',
	"logged_date",
	coalesce("timezone", 'UTC'),
	'Excluded from bodyweight analytics because it was outside 25–400 kg.',
	'legacy-invalid-weight:' || "id"::text,
	"logged_at"
FROM "weight_logs"
WHERE
	NOT ("weight_kg" BETWEEN 25 AND 400)
	AND "weight_kg" BETWEEN -1000000 AND 1000000;--> statement-breakpoint
DELETE FROM "weight_logs"
WHERE
	NOT ("weight_kg" BETWEEN 25 AND 400)
	AND "weight_kg" BETWEEN -1000000 AND 1000000;--> statement-breakpoint

-- Normalize legacy values that older application versions did not bound.
-- Values that cannot be interpreted safely are made unknown, never clamped
-- into plausible-looking performance or nutrition.
UPDATE "meal_logs"
SET
	"description" = CASE
		WHEN trim("description") = '' THEN '[Legacy meal description unavailable]'
		ELSE left(trim("description"), 2000)
	END,
	"calories" = CASE WHEN "calories" BETWEEN 0 AND 10000 THEN "calories" ELSE NULL END,
	"protein_g" = CASE WHEN "protein_g" BETWEEN 0 AND 1000 THEN "protein_g" ELSE NULL END,
	"carbs_g" = CASE WHEN "carbs_g" BETWEEN 0 AND 2000 THEN "carbs_g" ELSE NULL END,
	"fat_g" = CASE WHEN "fat_g" BETWEEN 0 AND 1000 THEN "fat_g" ELSE NULL END;--> statement-breakpoint
UPDATE "profiles"
SET
	"days_per_week" = CASE WHEN "days_per_week" BETWEEN 1 AND 7 THEN "days_per_week" ELSE NULL END,
	"session_minutes" = CASE WHEN "session_minutes" BETWEEN 15 AND 360 THEN "session_minutes" ELSE NULL END,
	"height_cm" = CASE WHEN "height_cm" BETWEEN 100 AND 260 THEN "height_cm" ELSE NULL END,
	"weight_kg" = CASE WHEN "weight_kg" BETWEEN 25 AND 400 THEN "weight_kg" ELSE NULL END,
	"age" = CASE WHEN "age" BETWEEN 13 AND 120 THEN "age" ELSE NULL END,
	"daily_calorie_target" = CASE
		WHEN "daily_calorie_target" BETWEEN 800 AND 10000 THEN "daily_calorie_target"
		ELSE NULL
	END,
	"preferred_language" = CASE
		WHEN "preferred_language" IN ('en', 'sv') THEN "preferred_language"
		ELSE NULL
	END,
	"activity_level" = CASE
		WHEN "activity_level" IN ('sedentary', 'moderate', 'high') THEN "activity_level"
		ELSE NULL
	END,
	"coach_gender" = CASE WHEN "coach_gender" IN ('male', 'female') THEN "coach_gender" ELSE 'male' END,
	"coach_id" = CASE
		WHEN "coach_id" IN ('eli', 'rex', 'brutus', 'maya', 'reya', 'nova') THEN "coach_id"
		WHEN "coach_gender" = 'female' THEN 'reya'
		ELSE 'rex'
	END;--> statement-breakpoint
UPDATE "program_exercises"
SET
	"notes" = concat_ws(
		E'\n',
		nullif("notes", ''),
		CASE
			WHEN NOT ("sets" BETWEEN 1 AND 30)
				THEN 'Legacy planned set count was outside 1–30 and was reset to a single review-required set.'
		END,
		CASE
			WHEN "target_weight_kg" IS NOT NULL AND NOT ("target_weight_kg" BETWEEN 0 AND 1000)
				THEN 'Legacy target weight was outside supported range and was cleared.'
		END
	),
	"sets" = CASE WHEN "sets" BETWEEN 1 AND 30 THEN "sets" ELSE 1 END,
	"target_weight_kg" = CASE
		WHEN "target_weight_kg" BETWEEN 0 AND 1000 THEN "target_weight_kg"
		ELSE NULL
	END;--> statement-breakpoint
UPDATE "session_exercises"
SET "name" = CASE
	WHEN trim("name") = '' THEN '[Legacy exercise name unavailable]'
	ELSE left(trim("name"), 200)
END;--> statement-breakpoint

-- Re-number order columns instead of deleting colliding rows. Preflight the
-- hard cardinality limits first so a dirty database fails with a precise,
-- recoverable diagnosis rather than halfway through index creation.
DO $migration_preflight$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "weight_logs"
		WHERE NOT ("weight_kg" BETWEEN 25 AND 400)
	) THEN
		RAISE EXCEPTION '0012 preflight: a legacy bodyweight is not safely representable as a measurement';
	END IF;
	IF EXISTS (
		SELECT 1
		FROM "program_days"
		GROUP BY "program_id", "week"
		HAVING count(*) > 7
	) THEN
		RAISE EXCEPTION '0012 preflight: a program week contains more than seven days';
	END IF;
	IF EXISTS (
		SELECT 1
		FROM "session_sets"
		GROUP BY "session_exercise_id"
		HAVING count(*) > 30
	) THEN
		RAISE EXCEPTION '0012 preflight: an exercise contains more than thirty session sets';
	END IF;
	IF EXISTS (
		SELECT 1 FROM "chat_messages"
		WHERE "role" NOT IN ('user', 'assistant', 'system')
	) THEN
		RAISE EXCEPTION '0012 preflight: unsupported legacy chat role';
	END IF;
	IF EXISTS (
		SELECT 1 FROM "program_days"
		WHERE CASE
			WHEN "date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
				THEN to_char(to_date("date", 'YYYY-MM-DD'), 'YYYY-MM-DD') <> "date"
			ELSE true
		END
	) THEN
		RAISE EXCEPTION '0012 preflight: invalid program calendar date';
	END IF;
	IF EXISTS (
		SELECT 1 FROM "programs"
		WHERE CASE
			WHEN
				"start_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
				AND "end_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
			THEN
				to_char(to_date("start_date", 'YYYY-MM-DD'), 'YYYY-MM-DD') <> "start_date"
				OR to_char(to_date("end_date", 'YYYY-MM-DD'), 'YYYY-MM-DD') <> "end_date"
				OR "end_date" < "start_date"
			ELSE true
		END
	) THEN
		RAISE EXCEPTION '0012 preflight: invalid program start/end date';
	END IF;
	IF EXISTS (
		SELECT 1 FROM "workout_sessions"
		WHERE CASE
			WHEN "session_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
				THEN to_char(to_date("session_date", 'YYYY-MM-DD'), 'YYYY-MM-DD') <> "session_date"
			ELSE true
		END
	) THEN
		RAISE EXCEPTION '0012 preflight: invalid workout session date';
	END IF;
END
$migration_preflight$;--> statement-breakpoint
WITH ranked AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "program_id", "week"
			ORDER BY "date", "day_index", "id"
		) AS "next_day_index"
	FROM "program_days"
)
UPDATE "program_days" day
SET "day_index" = ranked."next_day_index"
FROM ranked
WHERE day."id" = ranked."id";--> statement-breakpoint
WITH ranked AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "program_day_id"
			ORDER BY "position", "id"
		) - 1 AS "next_position"
	FROM "program_exercises"
)
UPDATE "program_exercises" exercise
SET "position" = ranked."next_position"
FROM ranked
WHERE exercise."id" = ranked."id";--> statement-breakpoint
WITH ranked AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "session_id"
			ORDER BY "position", "id"
		) - 1 AS "next_position"
	FROM "session_exercises"
)
UPDATE "session_exercises" exercise
SET "position" = ranked."next_position"
FROM ranked
WHERE exercise."id" = ranked."id";--> statement-breakpoint
WITH ranked AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "session_exercise_id"
			ORDER BY "set_index", "id"
		) AS "next_set_index"
	FROM "session_sets"
)
UPDATE "session_sets" session_set
SET "set_index" = ranked."next_set_index"
FROM ranked
WHERE session_set."id" = ranked."id";--> statement-breakpoint
ALTER TABLE "chat_runs" ADD CONSTRAINT "chat_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_jobs" ADD CONSTRAINT "memory_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_runs_expiry_idx" ON "chat_runs" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "measurements_user_metric_date_idx" ON "measurements" USING btree ("user_id","metric_key","recorded_date");--> statement-breakpoint
CREATE UNIQUE INDEX "measurements_user_source_idx" ON "measurements" USING btree ("user_id","source_key") WHERE "measurements"."source_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_jobs_user_message_idx" ON "memory_jobs" USING btree ("user_id","message_key");--> statement-breakpoint
CREATE INDEX "memory_jobs_pending_idx" ON "memory_jobs" USING btree ("user_id","status","available_at");--> statement-breakpoint
CREATE INDEX "meal_logs_user_date_idx" ON "meal_logs" USING btree ("user_id","logged_date");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_logs_user_source_idx" ON "meal_logs" USING btree ("user_id","source_key") WHERE "meal_logs"."source_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "memories_user_content_key_idx" ON "memories" USING btree ("user_id","content_key");--> statement-breakpoint
CREATE UNIQUE INDEX "program_days_program_week_day_idx" ON "program_days" USING btree ("program_id","week","day_index");--> statement-breakpoint
CREATE UNIQUE INDEX "program_exercises_day_position_idx" ON "program_exercises" USING btree ("program_day_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "programs_user_source_idx" ON "programs" USING btree ("user_id","source_key") WHERE "programs"."source_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "weight_logs_user_date_idx" ON "weight_logs" USING btree ("user_id","logged_date");--> statement-breakpoint
CREATE UNIQUE INDEX "weight_logs_user_source_idx" ON "weight_logs" USING btree ("user_id","source_key") WHERE "weight_logs"."source_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workout_sessions_user_source_idx" ON "workout_sessions" USING btree ("user_id","source_key") WHERE "workout_sessions"."source_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_role_check" CHECK ("chat_messages"."role" IN ('user', 'assistant', 'system'));--> statement-breakpoint
ALTER TABLE "meal_logs" ADD CONSTRAINT "meal_logs_calories_check" CHECK ("meal_logs"."calories" IS NULL OR "meal_logs"."calories" BETWEEN 0 AND 10000);--> statement-breakpoint
ALTER TABLE "meal_logs" ADD CONSTRAINT "meal_logs_protein_check" CHECK ("meal_logs"."protein_g" IS NULL OR "meal_logs"."protein_g" BETWEEN 0 AND 1000);--> statement-breakpoint
ALTER TABLE "meal_logs" ADD CONSTRAINT "meal_logs_carbs_check" CHECK ("meal_logs"."carbs_g" IS NULL OR "meal_logs"."carbs_g" BETWEEN 0 AND 2000);--> statement-breakpoint
ALTER TABLE "meal_logs" ADD CONSTRAINT "meal_logs_fat_check" CHECK ("meal_logs"."fat_g" IS NULL OR "meal_logs"."fat_g" BETWEEN 0 AND 1000);--> statement-breakpoint
ALTER TABLE "meal_logs" ADD CONSTRAINT "meal_logs_description_length_check" CHECK (length("meal_logs"."description") BETWEEN 1 AND 2000);--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_topic_check" CHECK ("memories"."topic" IN ('Preference', 'Goal', 'Injury', 'Achievement', 'Event', 'Personal'));--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_content_length_check" CHECK (length("memories"."content") BETWEEN 1 AND 500);--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_days_per_week_check" CHECK ("profiles"."days_per_week" IS NULL OR "profiles"."days_per_week" BETWEEN 1 AND 7);--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_session_minutes_check" CHECK ("profiles"."session_minutes" IS NULL OR "profiles"."session_minutes" BETWEEN 15 AND 360);--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_height_check" CHECK ("profiles"."height_cm" IS NULL OR "profiles"."height_cm" BETWEEN 100 AND 260);--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_weight_check" CHECK ("profiles"."weight_kg" IS NULL OR "profiles"."weight_kg" BETWEEN 25 AND 400);--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_age_check" CHECK ("profiles"."age" IS NULL OR "profiles"."age" BETWEEN 13 AND 120);--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_calorie_target_check" CHECK ("profiles"."daily_calorie_target" IS NULL OR "profiles"."daily_calorie_target" BETWEEN 800 AND 10000);--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_language_check" CHECK ("profiles"."preferred_language" IS NULL OR "profiles"."preferred_language" IN ('en', 'sv'));--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_activity_check" CHECK ("profiles"."activity_level" IS NULL OR "profiles"."activity_level" IN ('sedentary', 'moderate', 'high'));--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_coach_gender_check" CHECK ("profiles"."coach_gender" IN ('male', 'female'));--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_coach_id_check" CHECK ("profiles"."coach_id" IN ('eli', 'rex', 'brutus', 'maya', 'reya', 'nova'));--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_data_epoch_check" CHECK ("profiles"."data_epoch" >= 0);--> statement-breakpoint
ALTER TABLE "program_days" ADD CONSTRAINT "program_days_date_check" CHECK ("program_days"."date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');--> statement-breakpoint
ALTER TABLE "program_exercises" ADD CONSTRAINT "program_exercises_position_check" CHECK ("program_exercises"."position" >= 0);--> statement-breakpoint
ALTER TABLE "program_exercises" ADD CONSTRAINT "program_exercises_sets_check" CHECK ("program_exercises"."sets" BETWEEN 1 AND 30);--> statement-breakpoint
ALTER TABLE "program_exercises" ADD CONSTRAINT "program_exercises_target_weight_check" CHECK ("program_exercises"."target_weight_kg" IS NULL OR "program_exercises"."target_weight_kg" BETWEEN 0 AND 1000);--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_dates_check" CHECK ("programs"."start_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND "programs"."end_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND "programs"."end_date" >= "programs"."start_date");--> statement-breakpoint
ALTER TABLE "session_exercises" ADD CONSTRAINT "session_exercises_position_check" CHECK ("session_exercises"."position" >= 0);--> statement-breakpoint
ALTER TABLE "session_exercises" ADD CONSTRAINT "session_exercises_name_length_check" CHECK (length("session_exercises"."name") BETWEEN 1 AND 200);--> statement-breakpoint
ALTER TABLE "session_sets" ADD CONSTRAINT "session_sets_index_check" CHECK ("session_sets"."set_index" BETWEEN 1 AND 30);--> statement-breakpoint
ALTER TABLE "session_sets" ADD CONSTRAINT "session_sets_target_weight_check" CHECK ("session_sets"."target_weight_kg" IS NULL OR "session_sets"."target_weight_kg" BETWEEN 0 AND 1000);--> statement-breakpoint
ALTER TABLE "session_sets" ADD CONSTRAINT "session_sets_weight_check" CHECK ("session_sets"."weight_kg" IS NULL OR "session_sets"."weight_kg" BETWEEN 0 AND 1000);--> statement-breakpoint
ALTER TABLE "session_sets" ADD CONSTRAINT "session_sets_reps_check" CHECK ("session_sets"."reps" IS NULL OR "session_sets"."reps" BETWEEN 1 AND 1000);--> statement-breakpoint
ALTER TABLE "session_sets" ADD CONSTRAINT "session_sets_completed_values_check" CHECK (NOT "session_sets"."completed" OR ("session_sets"."reps" IS NOT NULL AND "session_sets"."completed_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "weight_logs" ADD CONSTRAINT "weight_logs_value_check" CHECK ("weight_logs"."weight_kg" BETWEEN 25 AND 400);--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_date_check" CHECK ("workout_sessions"."session_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_duration_check" CHECK ("workout_sessions"."duration_minutes" IS NULL OR "workout_sessions"."duration_minutes" BETWEEN 0 AND 1440);--> statement-breakpoint
ALTER TABLE "workspace_files" ADD CONSTRAINT "workspace_files_size_check" CHECK ("workspace_files"."size_bytes" BETWEEN 0 AND 1000000);
