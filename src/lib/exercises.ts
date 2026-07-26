export type AppLanguage = "en" | "sv";

export type ExerciseEquipment =
  "barbell" | "dumbbell" | "machine" | "cable" | "bodyweight" | "mixed";

export type ExerciseDefinition = {
  id: string;
  name_en: string;
  name_sv: string;
  equipment: ExerciseEquipment;
  aliases: readonly string[];
  image_path: string;
};

const exercise = (
  id: string,
  name_en: string,
  name_sv: string,
  equipment: ExerciseEquipment,
  aliases: readonly string[] = [],
): ExerciseDefinition => ({
  id,
  name_en,
  name_sv,
  equipment,
  aliases,
  image_path: `/exercise-guides/${id}.webp`,
});

/**
 * The complete exercise vocabulary available to program generation.
 *
 * Keeping this finite is intentional: every selectable exercise has a
 * bilingual name, one database identity, and one replaceable movement guide.
 * The coach may adjust sets, reps, load, tempo, and notes, but must select the
 * movement itself from this catalog.
 */
export const EXERCISE_CATALOG = [
  exercise("back-squat", "Back Squat", "Knäböj med skivstång", "barbell", [
    "squat",
    "back squat",
    "barbell back squat",
    "back squats",
  ]),
  exercise(
    "high-bar-back-squat",
    "High-Bar Back Squat",
    "Knäböj med hög stångplacering",
    "barbell",
    ["high-bar back squat", "high bar back squat", "high bar squat"],
  ),
  exercise("front-squat", "Front Squat", "Frontböj", "barbell", ["front squat", "front squats"]),
  exercise("goblet-squat", "Goblet Squat", "Goblet squat", "dumbbell", [
    "goblet squat",
    "dumbbell goblet squat",
  ]),
  exercise("bodyweight-squat", "Bodyweight Squat", "Knäböj med kroppsvikt", "bodyweight", [
    "bodyweight squat",
    "air squat",
  ]),
  exercise("hack-squat", "Hack Squat", "Hack squat", "machine", [
    "hack squat",
    "machine hack squat",
  ]),
  exercise("smith-machine-squat", "Smith-Machine Squat", "Knäböj i Smithmaskin", "machine", [
    "smith-machine squat",
    "smith machine squat",
    "smith squat",
  ]),
  exercise("leg-press", "Leg Press", "Benpress", "machine", ["leg press"]),
  exercise("single-leg-leg-press", "Single-Leg Leg Press", "Enbenspress", "machine", [
    "single-leg leg press",
    "single leg leg press",
    "one-leg leg press",
  ]),
  exercise("single-leg-squat", "Single-Leg Squat", "Enbensknäböj", "bodyweight", [
    "single-leg squat",
    "single leg squat",
    "pistol squat",
  ]),
  exercise("step-up", "Step-Up", "Uppsteg", "dumbbell", [
    "step-up",
    "step up",
    "dumbbell step-up",
    "weighted step-up",
  ]),
  exercise("bulgarian-split-squat", "Bulgarian Split Squat", "Bulgariska utfall", "dumbbell", [
    "bulgarian split squat",
    "rear foot elevated split squat",
  ]),
  exercise("walking-lunge", "Walking Lunge", "Gående utfall", "dumbbell", [
    "walking lunge",
    "walking lunges",
  ]),
  exercise("reverse-lunge", "Reverse Lunge", "Bakåtutfall", "dumbbell", [
    "reverse lunge",
    "reverse lunges",
  ]),
  exercise("leg-extension", "Leg Extension", "Benspark", "machine", [
    "leg extension",
    "leg extensions",
  ]),
  exercise("conventional-deadlift", "Deadlift", "Marklyft", "barbell", [
    "deadlift",
    "conventional deadlift",
  ]),
  exercise("sumo-deadlift", "Sumo Deadlift", "Sumomarklyft", "barbell", ["sumo deadlift"]),
  exercise("romanian-deadlift", "Romanian Deadlift", "Rumänska marklyft", "barbell", [
    "romanian deadlift",
    "romanian deadlifts",
    "rdl",
  ]),
  exercise(
    "dumbbell-romanian-deadlift",
    "Dumbbell Romanian Deadlift",
    "Rumänska marklyft med hantlar",
    "dumbbell",
    ["dumbbell romanian deadlift", "dumbbell rdl", "db rdl"],
  ),
  exercise(
    "single-leg-romanian-deadlift",
    "Single-Leg Romanian Deadlift",
    "Enbens rumänska marklyft",
    "dumbbell",
    ["single-leg romanian deadlift", "single leg romanian deadlift", "single-leg rdl"],
  ),
  exercise("hip-thrust", "Hip Thrust", "Höftlyft med skivstång", "barbell", [
    "hip thrust",
    "barbell hip thrust",
  ]),
  exercise("machine-hip-thrust", "Machine Hip Thrust", "Hip thrust i maskin", "machine", [
    "machine hip thrust",
    "hip thrust machine",
  ]),
  exercise(
    "smith-machine-hip-thrust",
    "Smith-Machine Hip Thrust",
    "Hip thrust i Smithmaskin",
    "machine",
    ["smith-machine hip thrust", "smith machine hip thrust", "smith hip thrust"],
  ),
  exercise("glute-bridge", "Glute Bridge", "Höftlyft", "bodyweight", [
    "glute bridge",
    "bodyweight glute bridge",
  ]),
  exercise("back-extension-machine", "Back Extension Machine", "Ryggresning i maskin", "machine", [
    "back extension machine",
    "machine back extension",
    "back raise machine",
  ]),
  exercise("cable-glute-kickback", "Cable Glute Kickback", "Bakåtspark i kabel", "cable", [
    "cable glute kickback",
    "cable kickback",
    "ankle strap kickback",
  ]),
  exercise("seated-hip-abduction", "Seated Hip Abduction", "Sittande höftabduktion", "machine", [
    "seated hip abduction",
    "hip abduction machine",
    "abductor machine",
  ]),
  exercise("seated-hip-adduction", "Seated Hip Adduction", "Sittande höftadduktion", "machine", [
    "seated hip adduction",
    "hip adduction machine",
    "adductor machine",
  ]),
  exercise("lying-leg-curl", "Lying Leg Curl", "Liggande lårcurl", "machine", [
    "lying leg curl",
    "leg curl",
    "prone leg curl",
  ]),
  exercise("seated-leg-curl", "Seated Leg Curl", "Sittande lårcurl", "machine", [
    "seated leg curl",
  ]),
  exercise("nordic-hamstring-curl", "Nordic Hamstring Curl", "Nordisk lårcurl", "bodyweight", [
    "nordic hamstring curl",
    "nordic curl",
    "nordic hamstring",
  ]),
  exercise("standing-calf-raise", "Standing Calf Raise", "Stående vadpress", "machine", [
    "standing calf raise",
    "standing calf raises",
  ]),
  exercise("seated-calf-raise", "Seated Calf Raise", "Sittande vadpress", "machine", [
    "seated calf raise",
    "seated calf raises",
  ]),
  exercise("leg-press-calf-raise", "Leg-Press Calf Raise", "Vadpress i benpress", "machine", [
    "leg-press calf raise",
    "leg press calf raise",
    "calf press on leg press",
  ]),
  exercise("bench-press", "Bench Press", "Bänkpress", "barbell", [
    "bench",
    "bench press",
    "barbell bench press",
  ]),
  exercise("dumbbell-bench-press", "Dumbbell Bench Press", "Hantelpress", "dumbbell", [
    "dumbbell bench press",
    "flat dumbbell press",
    "dumbbell chest press",
  ]),
  exercise("feet-up-bench-press", "Feet-up Bench Press", "Bänkpress med fötterna upp", "barbell", [
    "feet-up bench press",
    "feet up bench press",
  ]),
  exercise("close-grip-bench-press", "Close-grip Bench Press", "Smal bänkpress", "barbell", [
    "close-grip bench",
    "close grip bench",
    "close-grip bench press",
  ]),
  exercise("incline-barbell-press", "Incline Barbell Press", "Lutande bänkpress", "barbell", [
    "incline barbell press",
    "incline bench press",
    "incline barbell bench press",
  ]),
  exercise("incline-dumbbell-press", "Incline Dumbbell Press", "Lutande hantelpress", "dumbbell", [
    "incline dumbbell press",
    "incline dumbbell bench press",
    "incline db press",
  ]),
  exercise(
    "smith-machine-incline-press",
    "Smith-Machine Incline Press",
    "Lutande bänkpress i Smithmaskin",
    "machine",
    ["smith-machine incline press", "smith machine incline press", "smith incline press"],
  ),
  exercise("machine-chest-press", "Machine Chest Press", "Bröstpress i maskin", "machine", [
    "machine chest press",
    "chest press machine",
  ]),
  exercise("pec-deck", "Pec Deck", "Pec deck", "machine", [
    "pec deck",
    "pec deck fly",
    "machine chest fly",
  ]),
  exercise("cable-fly", "Cable Fly", "Kabelflyes", "cable", [
    "cable fly",
    "cable flye",
    "cable flyes",
  ]),
  exercise(
    "high-to-low-cable-fly",
    "High-to-Low Cable Fly",
    "Kabelflyes uppifrån och ned",
    "cable",
    ["high-to-low cable fly", "high to low cable fly", "decline cable fly"],
  ),
  exercise("weighted-chest-dip", "Weighted Chest Dip", "Viktad bröstdip", "mixed", [
    "weighted chest dip",
    "weighted dip",
    "chest dip",
  ]),
  exercise("push-up", "Push-up", "Armhävning", "bodyweight", [
    "push-up",
    "push up",
    "pushups",
    "push-ups",
  ]),
  exercise("overhead-press", "Overhead Press", "Militärpress", "barbell", [
    "overhead press",
    "barbell overhead press",
    "military press",
  ]),
  exercise(
    "seated-dumbbell-shoulder-press",
    "Seated Dumbbell Shoulder Press",
    "Sittande hantelpress för axlar",
    "dumbbell",
    ["seated dumbbell shoulder press", "seated db shoulder press"],
  ),
  exercise("arnold-press", "Arnold Press", "Arnoldpress", "dumbbell", [
    "arnold press",
    "seated arnold press",
  ]),
  exercise("machine-shoulder-press", "Machine Shoulder Press", "Axelpress i maskin", "machine", [
    "machine shoulder press",
    "shoulder press machine",
  ]),
  exercise("lateral-raise", "Lateral Raise", "Sidolyft", "dumbbell", [
    "lateral raise",
    "lateral raises",
    "dumbbell lateral raise",
  ]),
  exercise("cable-lateral-raise", "Cable Lateral Raise", "Sidolyft i kabel", "cable", [
    "cable lateral raise",
    "single-arm cable lateral raise",
  ]),
  exercise("rear-delt-fly", "Rear Delt Fly", "Omvända flyes", "dumbbell", [
    "rear delt fly",
    "rear delt flye",
    "reverse fly",
    "reverse flye",
  ]),
  exercise("barbell-row", "Barbell Row", "Skivstångsrodd", "barbell", [
    "barbell row",
    "bent-over barbell row",
  ]),
  exercise("t-bar-row", "T-Bar Row", "T-stångsrodd", "mixed", [
    "t-bar row",
    "t bar row",
    "landmine t-bar row",
  ]),
  exercise("one-arm-dumbbell-row", "One-arm Dumbbell Row", "Enarms hantelrodd", "dumbbell", [
    "one-arm dumbbell row",
    "one arm dumbbell row",
    "single-arm dumbbell row",
  ]),
  exercise("chest-supported-row", "Chest-supported Row", "Bröststödd rodd", "machine", [
    "chest-supported row",
    "chest supported row",
    "chest-supported machine row",
  ]),
  exercise("machine-row", "Machine Row", "Maskinrodd", "machine", [
    "machine row",
    "plate-loaded row",
  ]),
  exercise("seated-cable-row", "Seated Cable Row", "Sittande kabelrodd", "cable", [
    "seated cable row",
    "cable row",
  ]),
  exercise("lat-pulldown", "Lat Pulldown", "Latsdrag", "cable", ["lat pulldown", "lat pull-down"]),
  exercise("single-arm-lat-pulldown", "Single-Arm Lat Pulldown", "Enarms latsdrag", "cable", [
    "single-arm lat pulldown",
    "single arm lat pulldown",
    "one-arm lat pulldown",
  ]),
  exercise(
    "straight-arm-cable-pulldown",
    "Straight-Arm Cable Pulldown",
    "Rakarmsdrag i kabel",
    "cable",
    ["straight-arm cable pulldown", "straight arm pulldown", "cable pullover"],
  ),
  exercise("pull-up", "Pull-up", "Räckhäv", "bodyweight", [
    "pull-up",
    "pull up",
    "pullups",
    "pull-ups",
  ]),
  exercise("chin-up", "Chin-Up", "Chin-up", "bodyweight", [
    "chin-up",
    "chin up",
    "chinups",
    "chin-ups",
  ]),
  exercise("assisted-pull-up", "Assisted Pull-up", "Assisterad räckhäv", "machine", [
    "assisted pull-up",
    "assisted pull up",
  ]),
  exercise("weighted-pull-up", "Weighted Pull-up", "Viktad räckhäv", "mixed", [
    "weighted pull-up",
    "weighted pull up",
  ]),
  exercise("face-pull", "Face Pull", "Face pull", "cable", ["face pull", "face pulls"]),
  exercise("barbell-curl", "Barbell Curl", "Skivstångscurl", "barbell", [
    "barbell curl",
    "straight bar curl",
  ]),
  exercise("dumbbell-curl", "Dumbbell Curl", "Hantelcurl", "dumbbell", [
    "bicep curl",
    "biceps curl",
    "dumbbell bicep curl",
    "dumbbell curl",
  ]),
  exercise("hammer-curl", "Hammer Curl", "Hammarcurl", "dumbbell", ["hammer curl", "hammer curls"]),
  exercise("incline-dumbbell-curl", "Incline Dumbbell Curl", "Lutande hantelcurl", "dumbbell", [
    "incline dumbbell curl",
    "incline db curl",
  ]),
  exercise("ez-bar-curl", "EZ-bar Curl", "EZ-stångscurl", "barbell", [
    "ez-bar bicep curl",
    "ez-bar curl",
    "ez bar curl",
  ]),
  exercise("seated-dumbbell-curl", "Seated Dumbbell Curl", "Sittande hantelcurl", "dumbbell", [
    "seated dumbbell curl",
    "seated db curl",
    "seated bicep curl",
  ]),
  exercise("seated-ez-bar-curl", "Seated EZ-Bar Curl", "Sittande EZ-stångscurl", "barbell", [
    "seated ez-bar curl",
    "seated ez bar curl",
  ]),
  exercise("ez-bar-preacher-curl", "EZ-Bar Preacher Curl", "Preachercurl med EZ-stång", "barbell", [
    "ez-bar preacher curl",
    "ez bar preacher curl",
    "preacher curl",
  ]),
  exercise("cable-curl", "Cable Curl", "Kabelcurl", "cable", ["cable curl", "standing cable curl"]),
  exercise("bayesian-cable-curl", "Bayesian Cable Curl", "Bayesian kabelcurl", "cable", [
    "bayesian cable curl",
    "bayesian curl",
  ]),
  exercise("triceps-pushdown", "Rope Triceps Pushdown", "Tricepspress med rep", "cable", [
    "cable tricep pushdown",
    "triceps rope pushdown",
    "triceps pushdown",
    "rope pushdown",
  ]),
  exercise(
    "skullcrusher",
    "Lying EZ-Bar Skullcrusher",
    "Liggande tricepsextension med EZ-stång",
    "barbell",
    ["skullcrusher", "skull crusher", "lying ez-bar skullcrusher", "ez-bar skullcrusher"],
  ),
  exercise(
    "lying-dumbbell-skullcrusher",
    "Lying Dumbbell Skullcrusher",
    "Liggande tricepsextension med hantlar",
    "dumbbell",
    ["lying dumbbell skullcrusher", "dumbbell skullcrusher", "dumbbell skull crusher"],
  ),
  exercise(
    "cable-overhead-rope-extension",
    "Cable Overhead Rope Extension",
    "Tricepsextension över huvudet med rep",
    "cable",
    ["cable overhead rope extension", "overhead rope extension", "rope overhead extension"],
  ),
  exercise(
    "single-arm-cable-pushdown",
    "Single-Arm Cable Pushdown",
    "Enarms tricepspress i kabel",
    "cable",
    ["single-arm cable pushdown", "single arm cable pushdown", "one-arm triceps pushdown"],
  ),
  exercise(
    "overhead-triceps-extension",
    "Overhead Triceps Extension",
    "Tricepsextension över huvudet",
    "dumbbell",
    ["overhead triceps extension", "dumbbell overhead triceps extension"],
  ),
  exercise("hanging-leg-raise", "Hanging Leg Raise", "Hängande benlyft", "bodyweight", [
    "hanging leg raise",
    "hanging leg raises",
  ]),
  exercise("cable-crunch", "Cable Crunch", "Kabelcrunch", "cable", [
    "cable crunch",
    "kneeling cable crunch",
  ]),
  exercise("plank", "Plank", "Plankan", "bodyweight", ["plank", "front plank"]),
  exercise("side-plank", "Side Plank", "Sidoplanka", "bodyweight", ["side plank", "side bridge"]),
  exercise("reverse-crunch", "Reverse Crunch", "Omvänd crunch", "bodyweight", [
    "reverse crunch",
    "reverse crunches",
  ]),
  exercise("pallof-press", "Pallof Press", "Pallofpress", "cable", [
    "pallof press",
    "cable pallof press",
  ]),
  exercise("dead-bug", "Dead Bug", "Dead bug", "bodyweight", ["dead bug"]),
  exercise("ab-wheel-rollout", "Ab Wheel Rollout", "Maghjulsrullning", "mixed", [
    "ab wheel rollout",
    "ab-wheel rollout",
    "ab wheel",
  ]),
  exercise("power-clean", "Power Clean", "Styrkevändning", "barbell", [
    "power clean",
    "power cleans",
  ]),
  exercise("kettlebell-swing", "Kettlebell Swing", "Kettlebellsving", "mixed", [
    "kettlebell swing",
    "kb swing",
  ]),
  exercise("sled-push", "Sled Push", "Slädpress", "mixed", ["sled push", "prowler push"]),
  exercise("farmers-carry", "Farmer's Carry", "Farmers walk", "mixed", [
    "farmer's carry",
    "farmers carry",
    "farmer walk",
    "farmers walk",
  ]),
] as const satisfies readonly ExerciseDefinition[];

export const EXERCISE_IDS = EXERCISE_CATALOG.map((item) => item.id) as [string, ...string[]];

export type ExerciseId = (typeof EXERCISE_CATALOG)[number]["id"];

const EXERCISE_FAMILIES: readonly (readonly ExerciseId[])[] = [
  [
    "back-squat",
    "high-bar-back-squat",
    "front-squat",
    "goblet-squat",
    "bodyweight-squat",
    "hack-squat",
    "smith-machine-squat",
    "leg-press",
    "single-leg-leg-press",
    "single-leg-squat",
    "step-up",
    "bulgarian-split-squat",
    "walking-lunge",
    "reverse-lunge",
    "leg-extension",
  ],
  [
    "conventional-deadlift",
    "sumo-deadlift",
    "romanian-deadlift",
    "dumbbell-romanian-deadlift",
    "single-leg-romanian-deadlift",
    "hip-thrust",
    "machine-hip-thrust",
    "smith-machine-hip-thrust",
    "glute-bridge",
    "back-extension-machine",
    "cable-glute-kickback",
    "seated-hip-abduction",
    "seated-hip-adduction",
    "lying-leg-curl",
    "seated-leg-curl",
    "nordic-hamstring-curl",
  ],
  ["standing-calf-raise", "seated-calf-raise", "leg-press-calf-raise"],
  [
    "bench-press",
    "dumbbell-bench-press",
    "feet-up-bench-press",
    "close-grip-bench-press",
    "incline-barbell-press",
    "incline-dumbbell-press",
    "smith-machine-incline-press",
    "machine-chest-press",
    "pec-deck",
    "cable-fly",
    "high-to-low-cable-fly",
    "weighted-chest-dip",
    "push-up",
  ],
  [
    "overhead-press",
    "seated-dumbbell-shoulder-press",
    "arnold-press",
    "machine-shoulder-press",
    "lateral-raise",
    "cable-lateral-raise",
    "rear-delt-fly",
    "face-pull",
  ],
  [
    "barbell-row",
    "t-bar-row",
    "one-arm-dumbbell-row",
    "chest-supported-row",
    "machine-row",
    "seated-cable-row",
    "face-pull",
  ],
  [
    "lat-pulldown",
    "single-arm-lat-pulldown",
    "straight-arm-cable-pulldown",
    "pull-up",
    "chin-up",
    "assisted-pull-up",
    "weighted-pull-up",
  ],
  [
    "barbell-curl",
    "dumbbell-curl",
    "hammer-curl",
    "incline-dumbbell-curl",
    "ez-bar-curl",
    "seated-dumbbell-curl",
    "seated-ez-bar-curl",
    "ez-bar-preacher-curl",
    "cable-curl",
    "bayesian-cable-curl",
  ],
  [
    "triceps-pushdown",
    "skullcrusher",
    "lying-dumbbell-skullcrusher",
    "cable-overhead-rope-extension",
    "single-arm-cable-pushdown",
    "overhead-triceps-extension",
    "close-grip-bench-press",
  ],
  [
    "hanging-leg-raise",
    "cable-crunch",
    "plank",
    "side-plank",
    "reverse-crunch",
    "pallof-press",
    "dead-bug",
    "ab-wheel-rollout",
  ],
  ["power-clean", "kettlebell-swing", "sled-push", "farmers-carry"],
];

const byId = new Map(EXERCISE_CATALOG.map((item) => [item.id, item]));

function normalizedName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const byAlias = new Map<string, ExerciseDefinition>();
for (const item of EXERCISE_CATALOG) {
  for (const candidate of [item.id, item.name_en, item.name_sv, ...item.aliases]) {
    const key = normalizedName(candidate);
    const existing = byAlias.get(key);
    if (existing && existing.id !== item.id) {
      throw new Error(`Duplicate exercise alias "${candidate}" for ${existing.id} and ${item.id}`);
    }
    byAlias.set(key, item);
  }
}

export function getExercise(id: string | null | undefined) {
  return id ? (byId.get(id) ?? null) : null;
}

export function findExercise(value: string | null | undefined) {
  return value ? (byAlias.get(normalizedName(value)) ?? null) : null;
}

export function exerciseSubstitutions(id: ExerciseId | string, limit = 3) {
  const source = getExercise(id);
  if (!source) return [];
  const family = EXERCISE_FAMILIES.find((ids) => ids.includes(source.id as ExerciseId));
  if (!family) return [];

  return family
    .filter((candidateId) => candidateId !== source.id)
    .map((candidateId) => getExercise(candidateId))
    .filter((candidate): candidate is ExerciseDefinition => candidate != null)
    .sort(
      (a, b) => Number(b.equipment === source.equipment) - Number(a.equipment === source.equipment),
    )
    .slice(0, Math.max(0, limit));
}

const KNEE_DOMINANT_EXERCISES = new Set<ExerciseId>([
  "back-squat",
  "high-bar-back-squat",
  "front-squat",
  "goblet-squat",
  "bodyweight-squat",
  "hack-squat",
  "smith-machine-squat",
  "leg-press",
  "single-leg-leg-press",
  "single-leg-squat",
  "step-up",
  "bulgarian-split-squat",
  "walking-lunge",
  "reverse-lunge",
  "leg-extension",
]);

/**
 * These are not medical prescriptions. They are catalog-grounded candidates
 * that avoid the deep knee-flexion/loaded knee-extension pattern shared by
 * squats, lunges, presses, and step-ups. The coach must still trial them
 * conservatively, stop on pain, and recommend clinical assessment when pain
 * is sharp, severe, or repeated.
 */
const KNEE_SPARING_CANDIDATES: readonly ExerciseId[] = [
  "cable-glute-kickback",
  "glute-bridge",
  "dumbbell-romanian-deadlift",
  "single-leg-romanian-deadlift",
  "hip-thrust",
  "back-extension-machine",
  "seated-hip-abduction",
];

/**
 * Equipment failures need a varied shortlist, not eight near-identical
 * machines. Round-robin across equipment types while keeping the closest
 * same-equipment alternative first, so the coach can offer real choices that
 * are guaranteed to exist in the canonical catalog.
 */
export function exerciseSubstitutionsForReason(
  id: ExerciseId | string,
  reason: string,
  limit = 8,
  excludedExerciseIds: readonly string[] = [],
) {
  const source = getExercise(id);
  if (!source) return [];
  const excluded = new Set(excludedExerciseIds);
  const normalizedReason = normalizedName(reason);
  const describesKneePain =
    /\b(knee|knees|patella|kneecap|knasmarta|kna)\b/.test(normalizedReason) &&
    /\b(pain|painful|hurt|hurts|sharp|ache|injury|discomfort|smarta|ont|skarp)\b/.test(
      normalizedReason,
    );
  if (describesKneePain && KNEE_DOMINANT_EXERCISES.has(source.id as ExerciseId)) {
    return KNEE_SPARING_CANDIDATES.filter(
      (candidateId) => candidateId !== source.id && !excluded.has(candidateId),
    )
      .map((candidateId) => getExercise(candidateId))
      .filter((candidate): candidate is ExerciseDefinition => candidate != null)
      .slice(0, Math.max(0, limit));
  }

  const all = exerciseSubstitutions(id, EXERCISE_CATALOG.length);
  if (!reason.trim().toLowerCase().startsWith("no_equipment:")) {
    return all.filter((candidate) => !excluded.has(candidate.id)).slice(0, Math.max(0, limit));
  }
  const buckets = new Map<string, ExerciseDefinition[]>();
  for (const candidate of all.filter((item) => !excluded.has(item.id))) {
    const bucket = buckets.get(candidate.equipment) ?? [];
    bucket.push(candidate);
    buckets.set(candidate.equipment, bucket);
  }
  const equipmentOrder = [
    ...(source?.equipment && buckets.has(source.equipment) ? [source.equipment] : []),
    ...[...buckets.keys()].filter((equipment) => equipment !== source?.equipment),
  ];
  const result: ExerciseDefinition[] = [];
  for (let index = 0; result.length < limit; index++) {
    let added = false;
    for (const equipment of equipmentOrder) {
      const candidate = buckets.get(equipment)?.[index];
      if (!candidate) continue;
      result.push(candidate);
      added = true;
      if (result.length >= limit) break;
    }
    if (!added) break;
  }
  return result;
}

export function exerciseName(
  exerciseId: string | null | undefined,
  language: AppLanguage,
  fallback?: string | null,
) {
  const item = getExercise(exerciseId) ?? findExercise(fallback);
  return item ? (language === "sv" ? item.name_sv : item.name_en) : (fallback ?? "");
}

export function exerciseCatalogForPrompt(language: AppLanguage) {
  return EXERCISE_CATALOG.map(
    (item) => `${item.id} = ${language === "sv" ? item.name_sv : item.name_en} (${item.equipment})`,
  ).join("\n");
}
