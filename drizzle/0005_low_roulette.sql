ALTER TABLE "profiles" ADD COLUMN "coach_id" text DEFAULT 'rex' NOT NULL;
UPDATE "profiles"
SET "coach_id" = CASE
  WHEN "coach_gender" = 'female' THEN 'reya'
  ELSE 'rex'
END;
