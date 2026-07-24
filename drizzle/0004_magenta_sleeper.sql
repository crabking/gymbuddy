ALTER TABLE "profiles" ADD COLUMN "coach_gender" text DEFAULT 'male' NOT NULL;
--> statement-breakpoint
UPDATE "profiles" AS "profile"
SET "coach_gender" = 'female'
WHERE EXISTS (
  SELECT 1
  FROM "workspace_files" AS "file"
  WHERE "file"."user_id" = "profile"."id"
    AND "file"."path" = '.agent/config.json'
    AND "file"."content" ~ '"coach"\s*:\s*"Reya"'
);
--> statement-breakpoint
UPDATE "chat_messages"
SET "parts" = COALESCE(
  (
    SELECT jsonb_agg("part")
    FROM jsonb_array_elements("chat_messages"."parts") AS "part"
    WHERE "part" ->> 'type' = 'text'
      AND btrim(COALESCE("part" ->> 'text', '')) <> ''
  ),
  '[]'::jsonb
);
--> statement-breakpoint
DELETE FROM "chat_messages"
WHERE jsonb_array_length("parts") = 0;
