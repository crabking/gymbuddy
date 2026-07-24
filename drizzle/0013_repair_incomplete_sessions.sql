-- Earlier versions allowed an exercise checkbox to mark a workout complete
-- without performed reps. Keep every row, but correct lifecycle status rather
-- than inventing performance data.
CREATE TEMP TABLE "invalid_completed_sessions" ON COMMIT DROP AS
SELECT DISTINCT
	ws."id" AS "session_id",
	ws."program_day_id",
	pd."program_id",
	ws."user_id"
FROM "workout_sessions" ws
LEFT JOIN "session_exercises" se ON se."session_id" = ws."id"
LEFT JOIN "session_sets" ss ON ss."session_exercise_id" = se."id"
LEFT JOIN "program_days" pd ON pd."id" = ws."program_day_id"
WHERE ws."status" = 'completed'
GROUP BY ws."id", ws."program_day_id", pd."program_id", ws."user_id"
HAVING
	count(se."id") = 0
	OR bool_or(
		NOT coalesce(se."completed", false)
		OR NOT coalesce(ss."completed", false)
		OR ss."reps" IS NULL
	);
--> statement-breakpoint
UPDATE "workout_sessions" ws
SET
	"status" = 'abandoned',
	"end_reason" = 'legacy_incomplete_completion'
FROM "invalid_completed_sessions" bad
WHERE ws."id" = bad."session_id";
--> statement-breakpoint
UPDATE "program_days" pd
SET
	"status" = 'planned',
	"session_id" = NULL,
	"resolution_note" = concat_ws(
		' ',
		nullif(pd."resolution_note", ''),
		'Restored for completion: an older app version closed this workout without performed set data.'
	)
FROM "invalid_completed_sessions" bad
WHERE pd."id" = bad."program_day_id";
--> statement-breakpoint

-- Decide each affected cycle exactly once. A single UPDATE that reactivated
-- every completed cycle could violate programs_one_active_user_idx because all
-- rows observe the same pre-update snapshot. Keep an already-active cycle;
-- otherwise reopen only the newest affected completed cycle for that account.
CREATE TEMP TABLE "legacy_program_repair_decisions" ON COMMIT DROP AS
SELECT DISTINCT
	p."id" AS "program_id",
	p."user_id",
	p."status",
	'archive'::text AS "decision"
FROM "invalid_completed_sessions" bad
JOIN "programs" p ON p."id" = bad."program_id";--> statement-breakpoint
UPDATE "legacy_program_repair_decisions"
SET "decision" = 'reactivate'
WHERE "status" = 'active';--> statement-breakpoint
WITH ranked_candidates AS (
	SELECT
		decision."program_id",
		row_number() OVER (
			PARTITION BY decision."user_id"
			ORDER BY p."created_at" DESC, p."id" DESC
		) AS "candidate_rank"
	FROM "legacy_program_repair_decisions" decision
	JOIN "programs" p ON p."id" = decision."program_id"
	WHERE
		decision."status" = 'completed'
		AND NOT EXISTS (
			SELECT 1
			FROM "programs" active_program
			WHERE
				active_program."user_id" = decision."user_id"
				AND active_program."status" = 'active'
		)
)
UPDATE "legacy_program_repair_decisions" decision
SET "decision" = 'reactivate'
FROM ranked_candidates candidate
WHERE
	decision."program_id" = candidate."program_id"
	AND candidate."candidate_rank" = 1;--> statement-breakpoint
UPDATE "programs" p
SET
	"status" = 'active',
	"completed_at" = NULL
FROM "legacy_program_repair_decisions" decision
WHERE
	p."id" = decision."program_id"
	AND decision."decision" = 'reactivate';--> statement-breakpoint
UPDATE "programs" p
SET
	"status" = 'archived',
	"archived_at" = coalesce(p."archived_at", now()),
	"archive_reason" = concat_ws(
		' ',
		nullif(p."archive_reason", ''),
		'Legacy incomplete workout found; this older cycle was superseded instead of being falsely reopened.'
	)
FROM "legacy_program_repair_decisions" decision
WHERE
	p."id" = decision."program_id"
	AND decision."decision" = 'archive';--> statement-breakpoint
UPDATE "program_days" pd
SET
	"status" = 'skipped',
	"session_id" = NULL,
	"resolution_note" = concat_ws(
		' ',
		nullif(pd."resolution_note", ''),
		'Cycle archived during legacy repair; this day is intentionally unresolved and was not counted as completed.'
	)
FROM "invalid_completed_sessions" bad
JOIN "legacy_program_repair_decisions" decision
	ON decision."program_id" = bad."program_id"
WHERE
	pd."id" = bad."program_day_id"
	AND decision."decision" = 'archive';
