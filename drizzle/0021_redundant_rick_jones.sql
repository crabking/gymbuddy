ALTER TABLE "programs" ADD COLUMN "schedule_mode" text DEFAULT 'rolling' NOT NULL;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "weekday_indices" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_schedule_mode_check" CHECK ("programs"."schedule_mode" IN ('rolling', 'weekday'));--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_weekday_indices_check" CHECK (jsonb_typeof("programs"."weekday_indices") = 'array' AND jsonb_array_length("programs"."weekday_indices") BETWEEN 0 AND 7);