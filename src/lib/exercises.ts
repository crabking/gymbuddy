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
  exercise("leg-press", "Leg Press", "Benpress", "machine", ["leg press"]),
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
  exercise("hip-thrust", "Hip Thrust", "Höftlyft med skivstång", "barbell", [
    "hip thrust",
    "barbell hip thrust",
  ]),
  exercise("glute-bridge", "Glute Bridge", "Höftlyft", "bodyweight", [
    "glute bridge",
    "bodyweight glute bridge",
  ]),
  exercise("lying-leg-curl", "Lying Leg Curl", "Liggande lårcurl", "machine", [
    "lying leg curl",
    "leg curl",
    "prone leg curl",
  ]),
  exercise("seated-leg-curl", "Seated Leg Curl", "Sittande lårcurl", "machine", [
    "seated leg curl",
  ]),
  exercise("standing-calf-raise", "Standing Calf Raise", "Stående vadpress", "machine", [
    "standing calf raise",
    "standing calf raises",
  ]),
  exercise("seated-calf-raise", "Seated Calf Raise", "Sittande vadpress", "machine", [
    "seated calf raise",
    "seated calf raises",
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
  exercise("machine-chest-press", "Machine Chest Press", "Bröstpress i maskin", "machine", [
    "machine chest press",
    "chest press machine",
  ]),
  exercise("cable-fly", "Cable Fly", "Kabelflyes", "cable", [
    "cable fly",
    "cable flye",
    "cable flyes",
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
  exercise("lateral-raise", "Lateral Raise", "Sidolyft", "dumbbell", [
    "lateral raise",
    "lateral raises",
    "dumbbell lateral raise",
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
  exercise("pull-up", "Pull-up", "Räckhäv", "bodyweight", [
    "pull-up",
    "pull up",
    "pullups",
    "pull-ups",
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
  exercise("triceps-pushdown", "Triceps Pushdown", "Tricepspress i kabel", "cable", [
    "cable tricep pushdown",
    "triceps rope pushdown",
    "triceps pushdown",
    "rope pushdown",
  ]),
  exercise("skullcrusher", "Skullcrusher", "Liggande tricepsextension", "barbell", [
    "skullcrusher",
    "skull crusher",
    "lying ez-bar skullcrusher",
  ]),
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
  exercise("dead-bug", "Dead Bug", "Dead bug", "bodyweight", ["dead bug"]),
  exercise("ab-wheel-rollout", "Ab Wheel Rollout", "Maghjulsrullning", "mixed", [
    "ab wheel rollout",
    "ab-wheel rollout",
    "ab wheel",
  ]),
] as const satisfies readonly ExerciseDefinition[];

export const EXERCISE_IDS = EXERCISE_CATALOG.map((item) => item.id) as [string, ...string[]];

export type ExerciseId = (typeof EXERCISE_CATALOG)[number]["id"];

const EXERCISE_FAMILIES: readonly (readonly ExerciseId[])[] = [
  [
    "back-squat",
    "front-squat",
    "goblet-squat",
    "bodyweight-squat",
    "hack-squat",
    "leg-press",
    "bulgarian-split-squat",
    "walking-lunge",
    "reverse-lunge",
    "leg-extension",
  ],
  [
    "conventional-deadlift",
    "sumo-deadlift",
    "romanian-deadlift",
    "hip-thrust",
    "glute-bridge",
    "lying-leg-curl",
    "seated-leg-curl",
  ],
  ["standing-calf-raise", "seated-calf-raise"],
  [
    "bench-press",
    "dumbbell-bench-press",
    "feet-up-bench-press",
    "close-grip-bench-press",
    "incline-barbell-press",
    "incline-dumbbell-press",
    "machine-chest-press",
    "cable-fly",
    "push-up",
  ],
  [
    "overhead-press",
    "seated-dumbbell-shoulder-press",
    "lateral-raise",
    "rear-delt-fly",
    "face-pull",
  ],
  [
    "barbell-row",
    "one-arm-dumbbell-row",
    "chest-supported-row",
    "machine-row",
    "seated-cable-row",
    "face-pull",
  ],
  ["lat-pulldown", "pull-up", "assisted-pull-up", "weighted-pull-up"],
  ["barbell-curl", "dumbbell-curl", "hammer-curl", "incline-dumbbell-curl", "ez-bar-curl"],
  ["triceps-pushdown", "skullcrusher", "overhead-triceps-extension", "close-grip-bench-press"],
  ["hanging-leg-raise", "cable-crunch", "plank", "dead-bug", "ab-wheel-rollout"],
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
