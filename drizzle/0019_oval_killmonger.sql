CREATE TABLE "exercise_catalog" (
	"id" text PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_sv" text NOT NULL,
	"equipment" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"image_path" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_catalog_id_check" CHECK ("exercise_catalog"."id" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "exercise_catalog_equipment_check" CHECK ("exercise_catalog"."equipment" IN ('barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'mixed')),
	CONSTRAINT "exercise_catalog_image_check" CHECK (length("exercise_catalog"."image_path") BETWEEN 1 AND 500)
);
--> statement-breakpoint
INSERT INTO "exercise_catalog" ("id", "name_en", "name_sv", "equipment", "image_path") VALUES
	('back-squat', 'Back Squat', 'Knäböj med skivstång', 'barbell', '/exercise-guides/back-squat.webp'),
	('front-squat', 'Front Squat', 'Frontböj', 'barbell', '/exercise-guides/front-squat.webp'),
	('goblet-squat', 'Goblet Squat', 'Goblet squat', 'dumbbell', '/exercise-guides/goblet-squat.webp'),
	('bodyweight-squat', 'Bodyweight Squat', 'Knäböj med kroppsvikt', 'bodyweight', '/exercise-guides/bodyweight-squat.webp'),
	('hack-squat', 'Hack Squat', 'Hack squat', 'machine', '/exercise-guides/hack-squat.webp'),
	('leg-press', 'Leg Press', 'Benpress', 'machine', '/exercise-guides/leg-press.webp'),
	('bulgarian-split-squat', 'Bulgarian Split Squat', 'Bulgariska utfall', 'dumbbell', '/exercise-guides/bulgarian-split-squat.webp'),
	('walking-lunge', 'Walking Lunge', 'Gående utfall', 'dumbbell', '/exercise-guides/walking-lunge.webp'),
	('reverse-lunge', 'Reverse Lunge', 'Bakåtutfall', 'dumbbell', '/exercise-guides/reverse-lunge.webp'),
	('leg-extension', 'Leg Extension', 'Benspark', 'machine', '/exercise-guides/leg-extension.webp'),
	('conventional-deadlift', 'Deadlift', 'Marklyft', 'barbell', '/exercise-guides/conventional-deadlift.webp'),
	('sumo-deadlift', 'Sumo Deadlift', 'Sumomarklyft', 'barbell', '/exercise-guides/sumo-deadlift.webp'),
	('romanian-deadlift', 'Romanian Deadlift', 'Rumänska marklyft', 'barbell', '/exercise-guides/romanian-deadlift.webp'),
	('hip-thrust', 'Hip Thrust', 'Höftlyft med skivstång', 'barbell', '/exercise-guides/hip-thrust.webp'),
	('glute-bridge', 'Glute Bridge', 'Höftlyft', 'bodyweight', '/exercise-guides/glute-bridge.webp'),
	('lying-leg-curl', 'Lying Leg Curl', 'Liggande lårcurl', 'machine', '/exercise-guides/lying-leg-curl.webp'),
	('seated-leg-curl', 'Seated Leg Curl', 'Sittande lårcurl', 'machine', '/exercise-guides/seated-leg-curl.webp'),
	('standing-calf-raise', 'Standing Calf Raise', 'Stående vadpress', 'machine', '/exercise-guides/standing-calf-raise.webp'),
	('seated-calf-raise', 'Seated Calf Raise', 'Sittande vadpress', 'machine', '/exercise-guides/seated-calf-raise.webp'),
	('bench-press', 'Bench Press', 'Bänkpress', 'barbell', '/exercise-guides/bench-press.webp'),
	('dumbbell-bench-press', 'Dumbbell Bench Press', 'Hantelpress', 'dumbbell', '/exercise-guides/dumbbell-bench-press.webp'),
	('feet-up-bench-press', 'Feet-up Bench Press', 'Bänkpress med fötterna upp', 'barbell', '/exercise-guides/feet-up-bench-press.webp'),
	('close-grip-bench-press', 'Close-grip Bench Press', 'Smal bänkpress', 'barbell', '/exercise-guides/close-grip-bench-press.webp'),
	('incline-barbell-press', 'Incline Barbell Press', 'Lutande bänkpress', 'barbell', '/exercise-guides/incline-barbell-press.webp'),
	('incline-dumbbell-press', 'Incline Dumbbell Press', 'Lutande hantelpress', 'dumbbell', '/exercise-guides/incline-dumbbell-press.webp'),
	('machine-chest-press', 'Machine Chest Press', 'Bröstpress i maskin', 'machine', '/exercise-guides/machine-chest-press.webp'),
	('cable-fly', 'Cable Fly', 'Kabelflyes', 'cable', '/exercise-guides/cable-fly.webp'),
	('push-up', 'Push-up', 'Armhävning', 'bodyweight', '/exercise-guides/push-up.webp'),
	('overhead-press', 'Overhead Press', 'Militärpress', 'barbell', '/exercise-guides/overhead-press.webp'),
	('seated-dumbbell-shoulder-press', 'Seated Dumbbell Shoulder Press', 'Sittande hantelpress för axlar', 'dumbbell', '/exercise-guides/seated-dumbbell-shoulder-press.webp'),
	('lateral-raise', 'Lateral Raise', 'Sidolyft', 'dumbbell', '/exercise-guides/lateral-raise.webp'),
	('rear-delt-fly', 'Rear Delt Fly', 'Omvända flyes', 'dumbbell', '/exercise-guides/rear-delt-fly.webp'),
	('barbell-row', 'Barbell Row', 'Skivstångsrodd', 'barbell', '/exercise-guides/barbell-row.webp'),
	('one-arm-dumbbell-row', 'One-arm Dumbbell Row', 'Enarms hantelrodd', 'dumbbell', '/exercise-guides/one-arm-dumbbell-row.webp'),
	('chest-supported-row', 'Chest-supported Row', 'Bröststödd rodd', 'machine', '/exercise-guides/chest-supported-row.webp'),
	('machine-row', 'Machine Row', 'Maskinrodd', 'machine', '/exercise-guides/machine-row.webp'),
	('seated-cable-row', 'Seated Cable Row', 'Sittande kabelrodd', 'cable', '/exercise-guides/seated-cable-row.webp'),
	('lat-pulldown', 'Lat Pulldown', 'Latsdrag', 'cable', '/exercise-guides/lat-pulldown.webp'),
	('pull-up', 'Pull-up', 'Räckhäv', 'bodyweight', '/exercise-guides/pull-up.webp'),
	('assisted-pull-up', 'Assisted Pull-up', 'Assisterad räckhäv', 'machine', '/exercise-guides/assisted-pull-up.webp'),
	('weighted-pull-up', 'Weighted Pull-up', 'Viktad räckhäv', 'mixed', '/exercise-guides/weighted-pull-up.webp'),
	('face-pull', 'Face Pull', 'Face pull', 'cable', '/exercise-guides/face-pull.webp'),
	('barbell-curl', 'Barbell Curl', 'Skivstångscurl', 'barbell', '/exercise-guides/barbell-curl.webp'),
	('dumbbell-curl', 'Dumbbell Curl', 'Hantelcurl', 'dumbbell', '/exercise-guides/dumbbell-curl.webp'),
	('hammer-curl', 'Hammer Curl', 'Hammarcurl', 'dumbbell', '/exercise-guides/hammer-curl.webp'),
	('incline-dumbbell-curl', 'Incline Dumbbell Curl', 'Lutande hantelcurl', 'dumbbell', '/exercise-guides/incline-dumbbell-curl.webp'),
	('ez-bar-curl', 'EZ-bar Curl', 'EZ-stångscurl', 'barbell', '/exercise-guides/ez-bar-curl.webp'),
	('triceps-pushdown', 'Triceps Pushdown', 'Tricepspress i kabel', 'cable', '/exercise-guides/triceps-pushdown.webp'),
	('skullcrusher', 'Skullcrusher', 'Liggande tricepsextension', 'barbell', '/exercise-guides/skullcrusher.webp'),
	('overhead-triceps-extension', 'Overhead Triceps Extension', 'Tricepsextension över huvudet', 'dumbbell', '/exercise-guides/overhead-triceps-extension.webp'),
	('hanging-leg-raise', 'Hanging Leg Raise', 'Hängande benlyft', 'bodyweight', '/exercise-guides/hanging-leg-raise.webp'),
	('cable-crunch', 'Cable Crunch', 'Kabelcrunch', 'cable', '/exercise-guides/cable-crunch.webp'),
	('plank', 'Plank', 'Plankan', 'bodyweight', '/exercise-guides/plank.webp'),
	('dead-bug', 'Dead Bug', 'Dead bug', 'bodyweight', '/exercise-guides/dead-bug.webp'),
	('ab-wheel-rollout', 'Ab Wheel Rollout', 'Maghjulsrullning', 'mixed', '/exercise-guides/ab-wheel-rollout.webp');
--> statement-breakpoint
ALTER TABLE "program_exercises" ADD COLUMN "exercise_id" text;--> statement-breakpoint
ALTER TABLE "session_exercises" ADD COLUMN "exercise_id" text;--> statement-breakpoint
UPDATE "program_exercises"
SET "exercise_id" = CASE lower(trim("name"))
	WHEN 'back squat' THEN 'back-squat'
	WHEN 'barbell curl' THEN 'barbell-curl'
	WHEN 'barbell row' THEN 'barbell-row'
	WHEN 'bench press' THEN 'bench-press'
	WHEN 'bench' THEN 'bench-press'
	WHEN 'bicep curl' THEN 'dumbbell-curl'
	WHEN 'dumbbell bicep curl' THEN 'dumbbell-curl'
	WHEN 'bulgarian split squat' THEN 'bulgarian-split-squat'
	WHEN 'cable row' THEN 'seated-cable-row'
	WHEN 'seated cable row' THEN 'seated-cable-row'
	WHEN 'cable tricep pushdown' THEN 'triceps-pushdown'
	WHEN 'triceps rope pushdown' THEN 'triceps-pushdown'
	WHEN 'triceps pushdown' THEN 'triceps-pushdown'
	WHEN 'chest-supported machine row' THEN 'chest-supported-row'
	WHEN 'deadlift' THEN 'conventional-deadlift'
	WHEN 'ez-bar bicep curl' THEN 'ez-bar-curl'
	WHEN 'face pull' THEN 'face-pull'
	WHEN 'feet-up bench press' THEN 'feet-up-bench-press'
	WHEN 'front squat' THEN 'front-squat'
	WHEN 'hammer curl' THEN 'hammer-curl'
	WHEN 'hanging leg raise' THEN 'hanging-leg-raise'
	WHEN 'hip thrust' THEN 'hip-thrust'
	WHEN 'incline barbell press' THEN 'incline-barbell-press'
	WHEN 'incline db curl' THEN 'incline-dumbbell-curl'
	WHEN 'incline dumbbell press' THEN 'incline-dumbbell-press'
	WHEN 'incline dumbbell bench press' THEN 'incline-dumbbell-press'
	WHEN 'lat pulldown' THEN 'lat-pulldown'
	WHEN 'lateral raise' THEN 'lateral-raise'
	WHEN 'lateral raises' THEN 'lateral-raise'
	WHEN 'leg curl' THEN 'lying-leg-curl'
	WHEN 'lying leg curl' THEN 'lying-leg-curl'
	WHEN 'leg extension' THEN 'leg-extension'
	WHEN 'leg press' THEN 'leg-press'
	WHEN 'lying ez-bar skullcrusher' THEN 'skullcrusher'
	WHEN 'skullcrusher' THEN 'skullcrusher'
	WHEN 'machine row' THEN 'machine-row'
	WHEN 'overhead press' THEN 'overhead-press'
	WHEN 'romanian deadlift' THEN 'romanian-deadlift'
	WHEN 'seated calf raise' THEN 'seated-calf-raise'
	WHEN 'seated db shoulder press' THEN 'seated-dumbbell-shoulder-press'
	WHEN 'seated dumbbell shoulder press' THEN 'seated-dumbbell-shoulder-press'
	WHEN 'seated leg curl' THEN 'seated-leg-curl'
	WHEN 'standing calf raise' THEN 'standing-calf-raise'
	WHEN 'walking lunge' THEN 'walking-lunge'
	WHEN 'weighted pull-up' THEN 'weighted-pull-up'
	ELSE NULL
END;
--> statement-breakpoint
UPDATE "session_exercises"
SET "exercise_id" = CASE lower(trim("name"))
	WHEN 'back squat' THEN 'back-squat'
	WHEN 'barbell curl' THEN 'barbell-curl'
	WHEN 'barbell row' THEN 'barbell-row'
	WHEN 'bench press' THEN 'bench-press'
	WHEN 'bench' THEN 'bench-press'
	WHEN 'bicep curl' THEN 'dumbbell-curl'
	WHEN 'dumbbell bicep curl' THEN 'dumbbell-curl'
	WHEN 'bulgarian split squat' THEN 'bulgarian-split-squat'
	WHEN 'cable row' THEN 'seated-cable-row'
	WHEN 'seated cable row' THEN 'seated-cable-row'
	WHEN 'cable tricep pushdown' THEN 'triceps-pushdown'
	WHEN 'triceps rope pushdown' THEN 'triceps-pushdown'
	WHEN 'triceps pushdown' THEN 'triceps-pushdown'
	WHEN 'chest-supported machine row' THEN 'chest-supported-row'
	WHEN 'deadlift' THEN 'conventional-deadlift'
	WHEN 'ez-bar bicep curl' THEN 'ez-bar-curl'
	WHEN 'face pull' THEN 'face-pull'
	WHEN 'feet-up bench press' THEN 'feet-up-bench-press'
	WHEN 'front squat' THEN 'front-squat'
	WHEN 'hammer curl' THEN 'hammer-curl'
	WHEN 'hanging leg raise' THEN 'hanging-leg-raise'
	WHEN 'hip thrust' THEN 'hip-thrust'
	WHEN 'incline barbell press' THEN 'incline-barbell-press'
	WHEN 'incline db curl' THEN 'incline-dumbbell-curl'
	WHEN 'incline dumbbell press' THEN 'incline-dumbbell-press'
	WHEN 'incline dumbbell bench press' THEN 'incline-dumbbell-press'
	WHEN 'lat pulldown' THEN 'lat-pulldown'
	WHEN 'lateral raise' THEN 'lateral-raise'
	WHEN 'lateral raises' THEN 'lateral-raise'
	WHEN 'leg curl' THEN 'lying-leg-curl'
	WHEN 'lying leg curl' THEN 'lying-leg-curl'
	WHEN 'leg extension' THEN 'leg-extension'
	WHEN 'leg press' THEN 'leg-press'
	WHEN 'lying ez-bar skullcrusher' THEN 'skullcrusher'
	WHEN 'skullcrusher' THEN 'skullcrusher'
	WHEN 'machine row' THEN 'machine-row'
	WHEN 'overhead press' THEN 'overhead-press'
	WHEN 'romanian deadlift' THEN 'romanian-deadlift'
	WHEN 'seated calf raise' THEN 'seated-calf-raise'
	WHEN 'seated db shoulder press' THEN 'seated-dumbbell-shoulder-press'
	WHEN 'seated dumbbell shoulder press' THEN 'seated-dumbbell-shoulder-press'
	WHEN 'seated leg curl' THEN 'seated-leg-curl'
	WHEN 'standing calf raise' THEN 'standing-calf-raise'
	WHEN 'walking lunge' THEN 'walking-lunge'
	WHEN 'weighted pull-up' THEN 'weighted-pull-up'
	ELSE NULL
END;
--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_catalog_name_en_idx" ON "exercise_catalog" USING btree ("name_en");--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_catalog_name_sv_idx" ON "exercise_catalog" USING btree ("name_sv");--> statement-breakpoint
ALTER TABLE "program_exercises" ADD CONSTRAINT "program_exercises_exercise_id_exercise_catalog_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercise_catalog"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_exercises" ADD CONSTRAINT "session_exercises_exercise_id_exercise_catalog_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercise_catalog"("id") ON DELETE restrict ON UPDATE no action;
