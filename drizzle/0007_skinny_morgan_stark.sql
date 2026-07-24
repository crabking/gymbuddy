INSERT INTO "memories" ("user_id", "topic", "content")
SELECT "id", 'Personal', trim("memory_notes")
FROM "profiles"
WHERE "memory_notes" IS NOT NULL AND trim("memory_notes") <> '';
--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "memory_notes";
