ALTER TABLE "meal_logs" ADD COLUMN "ingredients" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "daily_protein_target_g" double precision;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "daily_carbs_target_g" double precision;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "daily_fat_target_g" double precision;--> statement-breakpoint
ALTER TABLE "meal_logs" ADD CONSTRAINT "meal_logs_ingredients_check" CHECK (jsonb_typeof("meal_logs"."ingredients") = 'array');--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_protein_target_check" CHECK ("profiles"."daily_protein_target_g" IS NULL OR "profiles"."daily_protein_target_g" BETWEEN 0 AND 1000);--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_carbs_target_check" CHECK ("profiles"."daily_carbs_target_g" IS NULL OR "profiles"."daily_carbs_target_g" BETWEEN 0 AND 2000);--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_fat_target_check" CHECK ("profiles"."daily_fat_target_g" IS NULL OR "profiles"."daily_fat_target_g" BETWEEN 0 AND 1000);