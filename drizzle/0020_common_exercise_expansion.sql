UPDATE "exercise_catalog"
SET
	"name_en" = 'Lying EZ-Bar Skullcrusher',
	"name_sv" = 'Liggande tricepsextension med EZ-stång',
	"aliases" = '["skullcrusher","skull crusher","lying ez-bar skullcrusher","ez-bar skullcrusher"]'::jsonb,
	"updated_at" = now()
WHERE "id" = 'skullcrusher';
--> statement-breakpoint
UPDATE "exercise_catalog"
SET
	"name_en" = 'Rope Triceps Pushdown',
	"name_sv" = 'Tricepspress med rep',
	"aliases" = '["cable tricep pushdown","triceps rope pushdown","triceps pushdown","rope pushdown"]'::jsonb,
	"updated_at" = now()
WHERE "id" = 'triceps-pushdown';
--> statement-breakpoint
INSERT INTO "exercise_catalog" (
	"id",
	"name_en",
	"name_sv",
	"equipment",
	"aliases",
	"image_path"
) VALUES
	('high-bar-back-squat', 'High-Bar Back Squat', 'Knäböj med hög stångplacering', 'barbell', '["high-bar back squat","high bar back squat","high bar squat"]'::jsonb, '/exercise-guides/high-bar-back-squat.webp'),
	('smith-machine-squat', 'Smith-Machine Squat', 'Knäböj i Smithmaskin', 'machine', '["smith-machine squat","smith machine squat","smith squat"]'::jsonb, '/exercise-guides/smith-machine-squat.webp'),
	('single-leg-leg-press', 'Single-Leg Leg Press', 'Enbenspress', 'machine', '["single-leg leg press","single leg leg press","one-leg leg press"]'::jsonb, '/exercise-guides/single-leg-leg-press.webp'),
	('single-leg-squat', 'Single-Leg Squat', 'Enbensknäböj', 'bodyweight', '["single-leg squat","single leg squat","pistol squat"]'::jsonb, '/exercise-guides/single-leg-squat.webp'),
	('step-up', 'Step-Up', 'Uppsteg', 'dumbbell', '["step-up","step up","dumbbell step-up","weighted step-up"]'::jsonb, '/exercise-guides/step-up.webp'),
	('dumbbell-romanian-deadlift', 'Dumbbell Romanian Deadlift', 'Rumänska marklyft med hantlar', 'dumbbell', '["dumbbell romanian deadlift","dumbbell rdl","db rdl"]'::jsonb, '/exercise-guides/dumbbell-romanian-deadlift.webp'),
	('single-leg-romanian-deadlift', 'Single-Leg Romanian Deadlift', 'Enbens rumänska marklyft', 'dumbbell', '["single-leg romanian deadlift","single leg romanian deadlift","single-leg rdl"]'::jsonb, '/exercise-guides/single-leg-romanian-deadlift.webp'),
	('machine-hip-thrust', 'Machine Hip Thrust', 'Hip thrust i maskin', 'machine', '["machine hip thrust","hip thrust machine"]'::jsonb, '/exercise-guides/machine-hip-thrust.webp'),
	('smith-machine-hip-thrust', 'Smith-Machine Hip Thrust', 'Hip thrust i Smithmaskin', 'machine', '["smith-machine hip thrust","smith machine hip thrust","smith hip thrust"]'::jsonb, '/exercise-guides/smith-machine-hip-thrust.webp'),
	('back-extension-machine', 'Back Extension Machine', 'Ryggresning i maskin', 'machine', '["back extension machine","machine back extension","back raise machine"]'::jsonb, '/exercise-guides/back-extension-machine.webp'),
	('cable-glute-kickback', 'Cable Glute Kickback', 'Bakåtspark i kabel', 'cable', '["cable glute kickback","cable kickback","ankle strap kickback"]'::jsonb, '/exercise-guides/cable-glute-kickback.webp'),
	('seated-hip-abduction', 'Seated Hip Abduction', 'Sittande höftabduktion', 'machine', '["seated hip abduction","hip abduction machine","abductor machine"]'::jsonb, '/exercise-guides/seated-hip-abduction.webp'),
	('seated-hip-adduction', 'Seated Hip Adduction', 'Sittande höftadduktion', 'machine', '["seated hip adduction","hip adduction machine","adductor machine"]'::jsonb, '/exercise-guides/seated-hip-adduction.webp'),
	('nordic-hamstring-curl', 'Nordic Hamstring Curl', 'Nordisk lårcurl', 'bodyweight', '["nordic hamstring curl","nordic curl","nordic hamstring"]'::jsonb, '/exercise-guides/nordic-hamstring-curl.webp'),
	('leg-press-calf-raise', 'Leg-Press Calf Raise', 'Vadpress i benpress', 'machine', '["leg-press calf raise","leg press calf raise","calf press on leg press"]'::jsonb, '/exercise-guides/leg-press-calf-raise.webp'),
	('smith-machine-incline-press', 'Smith-Machine Incline Press', 'Lutande bänkpress i Smithmaskin', 'machine', '["smith-machine incline press","smith machine incline press","smith incline press"]'::jsonb, '/exercise-guides/smith-machine-incline-press.webp'),
	('pec-deck', 'Pec Deck', 'Pec deck', 'machine', '["pec deck","pec deck fly","machine chest fly"]'::jsonb, '/exercise-guides/pec-deck.webp'),
	('high-to-low-cable-fly', 'High-to-Low Cable Fly', 'Kabelflyes uppifrån och ned', 'cable', '["high-to-low cable fly","high to low cable fly","decline cable fly"]'::jsonb, '/exercise-guides/high-to-low-cable-fly.webp'),
	('weighted-chest-dip', 'Weighted Chest Dip', 'Viktad bröstdip', 'mixed', '["weighted chest dip","weighted dip","chest dip"]'::jsonb, '/exercise-guides/weighted-chest-dip.webp'),
	('arnold-press', 'Arnold Press', 'Arnoldpress', 'dumbbell', '["arnold press","seated arnold press"]'::jsonb, '/exercise-guides/arnold-press.webp'),
	('machine-shoulder-press', 'Machine Shoulder Press', 'Axelpress i maskin', 'machine', '["machine shoulder press","shoulder press machine"]'::jsonb, '/exercise-guides/machine-shoulder-press.webp'),
	('cable-lateral-raise', 'Cable Lateral Raise', 'Sidolyft i kabel', 'cable', '["cable lateral raise","single-arm cable lateral raise"]'::jsonb, '/exercise-guides/cable-lateral-raise.webp'),
	('t-bar-row', 'T-Bar Row', 'T-stångsrodd', 'mixed', '["t-bar row","t bar row","landmine t-bar row"]'::jsonb, '/exercise-guides/t-bar-row.webp'),
	('single-arm-lat-pulldown', 'Single-Arm Lat Pulldown', 'Enarms latsdrag', 'cable', '["single-arm lat pulldown","single arm lat pulldown","one-arm lat pulldown"]'::jsonb, '/exercise-guides/single-arm-lat-pulldown.webp'),
	('straight-arm-cable-pulldown', 'Straight-Arm Cable Pulldown', 'Rakarmsdrag i kabel', 'cable', '["straight-arm cable pulldown","straight arm pulldown","cable pullover"]'::jsonb, '/exercise-guides/straight-arm-cable-pulldown.webp'),
	('chin-up', 'Chin-Up', 'Chin-up', 'bodyweight', '["chin-up","chin up","chinups","chin-ups"]'::jsonb, '/exercise-guides/chin-up.webp'),
	('seated-dumbbell-curl', 'Seated Dumbbell Curl', 'Sittande hantelcurl', 'dumbbell', '["seated dumbbell curl","seated db curl","seated bicep curl"]'::jsonb, '/exercise-guides/seated-dumbbell-curl.webp'),
	('seated-ez-bar-curl', 'Seated EZ-Bar Curl', 'Sittande EZ-stångscurl', 'barbell', '["seated ez-bar curl","seated ez bar curl"]'::jsonb, '/exercise-guides/seated-ez-bar-curl.webp'),
	('ez-bar-preacher-curl', 'EZ-Bar Preacher Curl', 'Preachercurl med EZ-stång', 'barbell', '["ez-bar preacher curl","ez bar preacher curl","preacher curl"]'::jsonb, '/exercise-guides/ez-bar-preacher-curl.webp'),
	('cable-curl', 'Cable Curl', 'Kabelcurl', 'cable', '["cable curl","standing cable curl"]'::jsonb, '/exercise-guides/cable-curl.webp'),
	('bayesian-cable-curl', 'Bayesian Cable Curl', 'Bayesian kabelcurl', 'cable', '["bayesian cable curl","bayesian curl"]'::jsonb, '/exercise-guides/bayesian-cable-curl.webp'),
	('lying-dumbbell-skullcrusher', 'Lying Dumbbell Skullcrusher', 'Liggande tricepsextension med hantlar', 'dumbbell', '["lying dumbbell skullcrusher","dumbbell skullcrusher","dumbbell skull crusher"]'::jsonb, '/exercise-guides/lying-dumbbell-skullcrusher.webp'),
	('cable-overhead-rope-extension', 'Cable Overhead Rope Extension', 'Tricepsextension över huvudet med rep', 'cable', '["cable overhead rope extension","overhead rope extension","rope overhead extension"]'::jsonb, '/exercise-guides/cable-overhead-rope-extension.webp'),
	('single-arm-cable-pushdown', 'Single-Arm Cable Pushdown', 'Enarms tricepspress i kabel', 'cable', '["single-arm cable pushdown","single arm cable pushdown","one-arm triceps pushdown"]'::jsonb, '/exercise-guides/single-arm-cable-pushdown.webp'),
	('side-plank', 'Side Plank', 'Sidoplanka', 'bodyweight', '["side plank","side bridge"]'::jsonb, '/exercise-guides/side-plank.webp'),
	('reverse-crunch', 'Reverse Crunch', 'Omvänd crunch', 'bodyweight', '["reverse crunch","reverse crunches"]'::jsonb, '/exercise-guides/reverse-crunch.webp'),
	('pallof-press', 'Pallof Press', 'Pallofpress', 'cable', '["pallof press","cable pallof press"]'::jsonb, '/exercise-guides/pallof-press.webp'),
	('power-clean', 'Power Clean', 'Styrkevändning', 'barbell', '["power clean","power cleans"]'::jsonb, '/exercise-guides/power-clean.webp'),
	('kettlebell-swing', 'Kettlebell Swing', 'Kettlebellsving', 'mixed', '["kettlebell swing","kb swing"]'::jsonb, '/exercise-guides/kettlebell-swing.webp'),
	('sled-push', 'Sled Push', 'Slädpress', 'mixed', '["sled push","prowler push"]'::jsonb, '/exercise-guides/sled-push.webp'),
	('farmers-carry', 'Farmer''s Carry', 'Farmers walk', 'mixed', '["farmer''s carry","farmers carry","farmer walk","farmers walk"]'::jsonb, '/exercise-guides/farmers-carry.webp');
