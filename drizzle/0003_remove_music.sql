UPDATE "profiles"
SET "onboarding_completed" = true
WHERE "onboarding_completed" = false
  AND "goal" IS NOT NULL
  AND "experience" IS NOT NULL
  AND "days_per_week" IS NOT NULL
  AND "schedule_note" IS NOT NULL
  AND "meal_preferences" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "music_service";
