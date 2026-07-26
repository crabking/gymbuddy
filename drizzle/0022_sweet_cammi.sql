CREATE TABLE "adaptation_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"program_revision" integer NOT NULL,
	"data_epoch" integer NOT NULL,
	"coach_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"rationale_en" text NOT NULL,
	"rationale_sv" text NOT NULL,
	"options" jsonb NOT NULL,
	"selected_option_id" text,
	"applied_changes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "adaptation_proposals_revision_check" CHECK ("adaptation_proposals"."program_revision" >= 0),
	CONSTRAINT "adaptation_proposals_epoch_check" CHECK ("adaptation_proposals"."data_epoch" >= 0),
	CONSTRAINT "adaptation_proposals_coach_check" CHECK ("adaptation_proposals"."coach_id" IN ('eli', 'rex', 'brutus', 'maya', 'reya', 'nova')),
	CONSTRAINT "adaptation_proposals_status_check" CHECK ("adaptation_proposals"."status" IN ('pending', 'applied', 'kept', 'stale')),
	CONSTRAINT "adaptation_proposals_options_check" CHECK (jsonb_typeof("adaptation_proposals"."options") = 'array' AND jsonb_array_length("adaptation_proposals"."options") BETWEEN 1 AND 2),
	CONSTRAINT "adaptation_proposals_decision_check" CHECK (("adaptation_proposals"."status" = 'pending' AND "adaptation_proposals"."decided_at" IS NULL AND "adaptation_proposals"."selected_option_id" IS NULL) OR ("adaptation_proposals"."status" = 'kept' AND "adaptation_proposals"."decided_at" IS NOT NULL AND "adaptation_proposals"."selected_option_id" IS NULL) OR ("adaptation_proposals"."status" IN ('applied', 'stale') AND "adaptation_proposals"."decided_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "workout_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"data_epoch" integer NOT NULL,
	"difficulty" integer NOT NULL,
	"energy" integer NOT NULL,
	"discomfort" integer NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workout_reviews_epoch_check" CHECK ("workout_reviews"."data_epoch" >= 0),
	CONSTRAINT "workout_reviews_difficulty_check" CHECK ("workout_reviews"."difficulty" BETWEEN 1 AND 5),
	CONSTRAINT "workout_reviews_energy_check" CHECK ("workout_reviews"."energy" BETWEEN 1 AND 5),
	CONSTRAINT "workout_reviews_discomfort_check" CHECK ("workout_reviews"."discomfort" BETWEEN 1 AND 5),
	CONSTRAINT "workout_reviews_note_length_check" CHECK ("workout_reviews"."note" IS NULL OR length("workout_reviews"."note") BETWEEN 1 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "program_exercises" ADD COLUMN "progression_step_kg" double precision;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH "inferred_steps" AS (
	SELECT
		"current_exercise"."id",
		min(abs("other_exercise"."target_weight_kg" - "current_exercise"."target_weight_kg")) AS "step"
	FROM "program_exercises" AS "current_exercise"
	INNER JOIN "program_days" AS "current_day"
		ON "current_day"."id" = "current_exercise"."program_day_id"
	INNER JOIN "program_days" AS "other_day"
		ON "other_day"."program_id" = "current_day"."program_id"
	INNER JOIN "program_exercises" AS "other_exercise"
		ON "other_exercise"."program_day_id" = "other_day"."id"
		AND "other_exercise"."exercise_id" = "current_exercise"."exercise_id"
	WHERE "current_exercise"."target_weight_kg" IS NOT NULL
		AND "other_exercise"."target_weight_kg" IS NOT NULL
		AND "other_exercise"."target_weight_kg" <> "current_exercise"."target_weight_kg"
	GROUP BY "current_exercise"."id"
)
UPDATE "program_exercises"
SET "progression_step_kg" = "inferred_steps"."step"
FROM "inferred_steps"
WHERE "program_exercises"."id" = "inferred_steps"."id"
	AND "inferred_steps"."step" BETWEEN 0 AND 100;--> statement-breakpoint
ALTER TABLE "adaptation_proposals" ADD CONSTRAINT "adaptation_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adaptation_proposals" ADD CONSTRAINT "adaptation_proposals_review_id_workout_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."workout_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adaptation_proposals" ADD CONSTRAINT "adaptation_proposals_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_reviews" ADD CONSTRAINT "workout_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_reviews" ADD CONSTRAINT "workout_reviews_session_id_workout_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "adaptation_proposals_review_idx" ON "adaptation_proposals" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "adaptation_proposals_user_status_idx" ON "adaptation_proposals" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "adaptation_proposals_program_idx" ON "adaptation_proposals" USING btree ("program_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workout_reviews_session_idx" ON "workout_reviews" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "workout_reviews_user_created_idx" ON "workout_reviews" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "program_exercises" ADD CONSTRAINT "program_exercises_progression_step_check" CHECK ("program_exercises"."progression_step_kg" IS NULL OR "program_exercises"."progression_step_kg" BETWEEN 0 AND 100);--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_revision_check" CHECK ("programs"."revision" >= 0);
