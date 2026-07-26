import { and, eq, gte, lte, asc } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import { mealLogs, profiles } from "@/db/schema";
import {
  addLocalDays,
  assertIsoDate,
  localDateInTimeZone,
  normalizeTimeZone,
} from "@/lib/local-date";
import type { AppLanguage } from "@/lib/exercises";
import {
  NUTRIENT_KEYS,
  TRACKED_NUTRIENTS,
  emptyNutrientTotals,
  type FoodNutrientEstimates,
  type NutrientKey,
} from "@/lib/nutrients";

export type MealIngredient = {
  name: string;
  amount: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  nutrients?: FoodNutrientEstimates;
  estimate_confidence?: "high" | "medium" | "low";
};

export type NutritionToday = {
  date: string;
  target_calories: number | null;
  target_protein_g: number | null;
  target_carbs_g: number | null;
  target_fat_g: number | null;
  /** Exact only when at least one meal exists and every entry has this value. */
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  known_totals: {
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
  };
  unknown_meals: {
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
  };
  nutrient_totals: Record<NutrientKey, number>;
  nutrient_known_ingredients: Record<NutrientKey, number>;
  nutrient_unknown_ingredients: Record<NutrientKey, number>;
  meal_count: number;
  meals: Array<{
    description: string;
    calories: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
    ingredients: MealIngredient[];
    logged_at: string;
  }>;
  week_days: Array<{
    date: string;
    calories: number | null;
    known_calories: number;
    protein_g: number | null;
    known_protein_g: number;
    carbs_g: number | null;
    known_carbs_g: number;
    fat_g: number | null;
    known_fat_g: number;
    meal_count: number;
    unknown_calorie_meals: number;
    unknown_macro_meals: number;
  }>;
  trend_summary: {
    period_start: string;
    period_end: string;
    calendar_days: 14;
    logged_days: number;
    meal_count: number;
    complete_calorie_days: number;
    complete_macro_days: number;
    average_calories: number | null;
    average_protein_g: number | null;
    average_carbs_g: number | null;
    average_fat_g: number | null;
    average_nutrients: Record<NutrientKey, number | null>;
    nutrient_complete_days: Record<NutrientKey, number>;
  };
};

type Nutrient = "calories" | "protein_g" | "carbs_g" | "fat_g";

export type LogMealInput = {
  description: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  ingredients?: MealIngredient[];
  logged_date: string;
  timezone?: string | null;
  source_key?: string | null;
};

function validateNullableNumber(
  value: number | null,
  minimum: number,
  maximum: number,
  field: string,
) {
  if (value != null && (!Number.isFinite(value) || value < minimum || value > maximum)) {
    throw new Error(`Invalid meal ${field}`);
  }
}

const roundOne = (value: number) => Math.round(value * 10) / 10;
const roundNutrient = (value: number) => Math.round(value * 1000) / 1000;

function normalizeNutrientEstimates(
  input: FoodNutrientEstimates | null | undefined,
): FoodNutrientEstimates {
  const normalized: FoodNutrientEstimates = {};
  for (const key of NUTRIENT_KEYS) {
    const value = input?.[key];
    if (value == null) {
      if (input && key in input) normalized[key] = null;
      continue;
    }
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000) {
      throw new Error(`Invalid meal ingredient nutrient: ${key}`);
    }
    normalized[key] = roundNutrient(value);
  }
  return normalized;
}

function normalizeIngredients(input: MealIngredient[] | undefined): MealIngredient[] {
  if (!input?.length) return [];
  if (input.length > 30) throw new Error("Too many meal ingredients");
  return input.map((ingredient) => {
    const name = ingredient.name.replace(/\s+/g, " ").trim();
    const amount = ingredient.amount.replace(/\s+/g, " ").trim();
    if (!name || name.length > 160 || !amount || amount.length > 100) {
      throw new Error("Invalid meal ingredient");
    }
    validateNullableNumber(ingredient.calories, 0, 10_000, "ingredient calories");
    validateNullableNumber(ingredient.protein_g, 0, 1_000, "ingredient protein");
    validateNullableNumber(ingredient.carbs_g, 0, 2_000, "ingredient carbs");
    validateNullableNumber(ingredient.fat_g, 0, 1_000, "ingredient fat");
    if (!Number.isInteger(ingredient.calories)) {
      throw new Error("Invalid meal ingredient calories");
    }
    return {
      name,
      amount,
      calories: ingredient.calories,
      protein_g: roundOne(ingredient.protein_g),
      carbs_g: roundOne(ingredient.carbs_g),
      fat_g: roundOne(ingredient.fat_g),
      nutrients: normalizeNutrientEstimates(ingredient.nutrients),
      estimate_confidence:
        ingredient.estimate_confidence === "high" ||
        ingredient.estimate_confidence === "medium" ||
        ingredient.estimate_confidence === "low"
          ? ingredient.estimate_confidence
          : "low",
    };
  });
}

export function ingredientNutritionTotals(ingredients: MealIngredient[]) {
  return {
    calories: ingredients.reduce((total, ingredient) => total + ingredient.calories, 0),
    protein_g: roundOne(ingredients.reduce((total, ingredient) => total + ingredient.protein_g, 0)),
    carbs_g: roundOne(ingredients.reduce((total, ingredient) => total + ingredient.carbs_g, 0)),
    fat_g: roundOne(ingredients.reduce((total, ingredient) => total + ingredient.fat_g, 0)),
  };
}

export function ingredientNutrientTotals(ingredients: MealIngredient[]) {
  const totals = emptyNutrientTotals();
  const known = emptyNutrientTotals();
  const unknown = emptyNutrientTotals();
  for (const ingredient of ingredients) {
    for (const key of NUTRIENT_KEYS) {
      const value = ingredient.nutrients?.[key];
      if (value == null) {
        unknown[key] += 1;
      } else {
        totals[key] = roundNutrient(totals[key] + value);
        known[key] += 1;
      }
    }
  }
  return { totals, known, unknown };
}

function aggregateMealNutrients(
  meals: Array<{
    ingredients: MealIngredient[];
  }>,
) {
  const ingredients = meals.flatMap((meal) =>
    meal.ingredients.length
      ? meal.ingredients
      : [
          {
            name: "Unknown meal",
            amount: "Unknown",
            calories: 0,
            protein_g: 0,
            carbs_g: 0,
            fat_g: 0,
          },
        ],
  );
  return ingredientNutrientTotals(ingredients);
}

/**
 * Insert one durable meal. A retry with the same source key is accepted only
 * when every persisted field is identical; a stochastic re-estimate can never
 * silently turn into a second or rewritten meal.
 */
export async function logMeal(userId: string, input: LogMealInput) {
  const description = input.description.replace(/\s+/g, " ").trim();
  if (!description || description.length > 2_000) {
    throw new Error("Invalid meal description");
  }
  const ingredients = normalizeIngredients(input.ingredients);
  const ingredientTotals = ingredients.length ? ingredientNutritionTotals(ingredients) : null;
  const calories = ingredientTotals?.calories ?? input.calories;
  const proteinG = ingredientTotals?.protein_g ?? input.protein_g;
  const carbsG = ingredientTotals?.carbs_g ?? input.carbs_g;
  const fatG = ingredientTotals?.fat_g ?? input.fat_g;
  validateNullableNumber(calories, 0, 10_000, "calories");
  if (calories != null && !Number.isInteger(calories)) {
    throw new Error("Invalid meal calories");
  }
  validateNullableNumber(proteinG, 0, 1_000, "protein");
  validateNullableNumber(carbsG, 0, 2_000, "carbs");
  validateNullableNumber(fatG, 0, 1_000, "fat");
  const loggedDate = assertIsoDate(input.logged_date);
  const timezone = input.timezone?.trim() || null;
  if (timezone && timezone.length > 64) throw new Error("Invalid meal timezone");
  const sourceKey = input.source_key?.trim() || null;
  if (input.source_key != null && (!sourceKey || input.source_key.length > 200)) {
    throw new Error("Invalid meal source key");
  }
  const values = {
    user_id: userId,
    description,
    calories,
    protein_g: proteinG,
    carbs_g: carbsG,
    fat_g: fatG,
    ingredients,
    logged_date: loggedDate,
    timezone,
    source_key: sourceKey,
  };
  const db = getDb();
  const [inserted] = await db.insert(mealLogs).values(values).onConflictDoNothing().returning();
  if (inserted) return { ...inserted, idempotent: false };
  if (!sourceKey) throw new Error("Meal could not be saved");

  const [existing] = await db
    .select()
    .from(mealLogs)
    .where(and(eq(mealLogs.user_id, userId), eq(mealLogs.source_key, sourceKey)))
    .limit(1);
  if (!existing) throw new Error("Meal idempotency state could not be verified");
  if (
    existing.description !== values.description ||
    existing.calories !== values.calories ||
    existing.protein_g !== values.protein_g ||
    existing.carbs_g !== values.carbs_g ||
    existing.fat_g !== values.fat_g ||
    JSON.stringify(normalizeIngredients(existing.ingredients)) !==
      JSON.stringify(values.ingredients) ||
    existing.logged_date !== values.logged_date ||
    existing.timezone !== values.timezone
  ) {
    throw new Error("Meal source key conflicts with different data");
  }
  return { ...existing, idempotent: true };
}

function aggregateNutrient(
  rows: Array<{
    calories: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
  }>,
  nutrient: Nutrient,
) {
  const known = rows.reduce((total, row) => total + (row[nutrient] ?? 0), 0);
  const unknown = rows.filter((row) => row[nutrient] == null).length;
  return {
    exact: rows.length > 0 && unknown === 0 ? known : null,
    known,
    unknown,
  };
}

export function deriveMacroTargets(calories: number | null, weightKg: number | null) {
  if (!calories) {
    return { protein_g: null, carbs_g: null, fat_g: null };
  }
  const proteinG = Math.min(
    weightKg ? Math.round(weightKg * 1.8) : Math.round((calories * 0.3) / 4),
    Math.floor((calories * 0.35) / 4),
  );
  const fatG = Math.min(
    weightKg ? Math.round(weightKg * 0.8) : Math.round((calories * 0.25) / 9),
    Math.floor((calories * 0.3) / 9),
  );
  return {
    protein_g: proteinG,
    carbs_g: Math.max(50, Math.round((calories - proteinG * 4 - fatG * 9) / 4)),
    fat_g: fatG,
  };
}

export async function getNutrition(
  userId: string,
  requestedDate?: string,
  requestedTimeZone?: string | null,
): Promise<NutritionToday> {
  const db = getDb();
  const timeZone = normalizeTimeZone(requestedTimeZone) ?? "UTC";
  const today = requestedDate ? assertIsoDate(requestedDate) : localDateInTimeZone(timeZone);
  const historyStart = addLocalDays(today, -13);

  const [profile] = await db
    .select({
      target: profiles.daily_calorie_target,
      target_protein_g: profiles.daily_protein_target_g,
      target_carbs_g: profiles.daily_carbs_target_g,
      target_fat_g: profiles.daily_fat_target_g,
      weight_kg: profiles.weight_kg,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  const rows = await db
    .select()
    .from(mealLogs)
    .where(
      and(
        eq(mealLogs.user_id, userId),
        gte(mealLogs.logged_date, historyStart),
        lte(mealLogs.logged_date, today),
      ),
    )
    .orderBy(asc(mealLogs.logged_at));

  const todays = rows.filter((r) => r.logged_date === today);
  const todayCalories = aggregateNutrient(todays, "calories");
  const todayProtein = aggregateNutrient(todays, "protein_g");
  const todayCarbs = aggregateNutrient(todays, "carbs_g");
  const todayFat = aggregateNutrient(todays, "fat_g");
  const todayNutrients = aggregateMealNutrients(todays);
  const fallbackTargets = deriveMacroTargets(profile?.target ?? null, profile?.weight_kg ?? null);
  const byDay = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byDay.get(r.logged_date) ?? [];
    list.push(r);
    byDay.set(r.logged_date, list);
  }
  const historyDays = Array.from({ length: 14 }, (_, index) => {
    const date = addLocalDays(historyStart, index);
    const dayRows = byDay.get(date) ?? [];
    const dayCalories = aggregateNutrient(dayRows, "calories");
    const dayProtein = aggregateNutrient(dayRows, "protein_g");
    const dayCarbs = aggregateNutrient(dayRows, "carbs_g");
    const dayFat = aggregateNutrient(dayRows, "fat_g");
    return {
      date,
      calories: dayCalories.exact,
      known_calories: dayCalories.known,
      protein_g: dayProtein.exact,
      known_protein_g: dayProtein.known,
      carbs_g: dayCarbs.exact,
      known_carbs_g: dayCarbs.known,
      fat_g: dayFat.exact,
      known_fat_g: dayFat.known,
      meal_count: dayRows.length,
      unknown_calorie_meals: dayCalories.unknown,
      unknown_macro_meals: Math.max(dayProtein.unknown, dayCarbs.unknown, dayFat.unknown),
    };
  });
  const loggedDays = historyDays.filter((day) => day.meal_count > 0);
  const averageExactDays = (values: Array<number | null>) => {
    const complete = values.filter((value): value is number => value != null);
    return complete.length
      ? roundOne(complete.reduce((sum, value) => sum + value, 0) / complete.length)
      : null;
  };
  const averageNutrients = Object.fromEntries(
    NUTRIENT_KEYS.map((key) => {
      const completeValues = Array.from({ length: 14 }, (_, index) => {
        const date = addLocalDays(historyStart, index);
        const dayRows = byDay.get(date) ?? [];
        if (!dayRows.length) return null;
        const nutrient = aggregateMealNutrients(dayRows);
        return nutrient.unknown[key] === 0 && nutrient.known[key] > 0 ? nutrient.totals[key] : null;
      }).filter((value): value is number => value != null);
      return [
        key,
        completeValues.length
          ? roundNutrient(
              completeValues.reduce((sum, value) => sum + value, 0) / completeValues.length,
            )
          : null,
      ];
    }),
  ) as Record<NutrientKey, number | null>;
  const nutrientCompleteDays = Object.fromEntries(
    NUTRIENT_KEYS.map((key) => {
      const completeDays = Array.from({ length: 14 }, (_, index) => {
        const date = addLocalDays(historyStart, index);
        const dayRows = byDay.get(date) ?? [];
        if (!dayRows.length) return false;
        const nutrient = aggregateMealNutrients(dayRows);
        return nutrient.unknown[key] === 0 && nutrient.known[key] > 0;
      }).filter(Boolean).length;
      return [key, completeDays];
    }),
  ) as Record<NutrientKey, number>;

  return {
    date: today,
    target_calories: profile?.target ?? null,
    target_protein_g: profile?.target_protein_g ?? fallbackTargets.protein_g,
    target_carbs_g: profile?.target_carbs_g ?? fallbackTargets.carbs_g,
    target_fat_g: profile?.target_fat_g ?? fallbackTargets.fat_g,
    calories: todayCalories.exact,
    protein_g: todayProtein.exact,
    carbs_g: todayCarbs.exact,
    fat_g: todayFat.exact,
    known_totals: {
      calories: todayCalories.known,
      protein_g: todayProtein.known,
      carbs_g: todayCarbs.known,
      fat_g: todayFat.known,
    },
    unknown_meals: {
      calories: todayCalories.unknown,
      protein_g: todayProtein.unknown,
      carbs_g: todayCarbs.unknown,
      fat_g: todayFat.unknown,
    },
    nutrient_totals: todayNutrients.totals,
    nutrient_known_ingredients: todayNutrients.known,
    nutrient_unknown_ingredients: todayNutrients.unknown,
    meal_count: todays.length,
    meals: todays.map((r) => ({
      description: r.description,
      calories: r.calories,
      protein_g: r.protein_g,
      carbs_g: r.carbs_g,
      fat_g: r.fat_g,
      ingredients: r.ingredients,
      logged_at: r.logged_at,
    })),
    week_days: historyDays,
    trend_summary: {
      period_start: historyStart,
      period_end: today,
      calendar_days: 14,
      logged_days: loggedDays.length,
      meal_count: rows.length,
      complete_calorie_days: loggedDays.filter((day) => day.calories != null).length,
      complete_macro_days: loggedDays.filter(
        (day) => day.protein_g != null && day.carbs_g != null && day.fat_g != null,
      ).length,
      average_calories: averageExactDays(loggedDays.map((day) => day.calories)),
      average_protein_g: averageExactDays(loggedDays.map((day) => day.protein_g)),
      average_carbs_g: averageExactDays(loggedDays.map((day) => day.carbs_g)),
      average_fat_g: averageExactDays(loggedDays.map((day) => day.fat_g)),
      average_nutrients: averageNutrients,
      nutrient_complete_days: nutrientCompleteDays,
    },
  };
}

/** Compact summary for injecting into the agent context. */
export function summarizeNutrition(x: NutritionToday, language: AppLanguage = "en"): string {
  const knownCalories = Math.round(x.known_totals.calories);
  const cal =
    x.meal_count === 0
      ? language === "sv"
        ? "inga måltider loggade"
        : "no meals logged"
      : x.calories == null
        ? language === "sv"
          ? `minst ${knownCalories} kcal loggade; ${x.unknown_meals.calories} måltid(er) saknar kaloriuppskattning${
              x.target_calories ? ` (mål ${x.target_calories})` : ""
            }`
          : `at least ${knownCalories} kcal logged; ${x.unknown_meals.calories} meal(s) have no calorie estimate${
              x.target_calories ? ` (target ${x.target_calories})` : ""
            }`
        : x.target_calories
          ? x.calories <= x.target_calories
            ? `${Math.round(x.calories)} / ${x.target_calories} kcal (${Math.round(
                x.target_calories - x.calories,
              )} ${language === "sv" ? "kvar" : "left"})`
            : `${Math.round(x.calories)} / ${x.target_calories} kcal (${Math.round(
                x.calories - x.target_calories,
              )} ${language === "sv" ? "över" : "over"})`
          : `${Math.round(x.calories)} kcal (${
              language === "sv" ? "inget mål angivet" : "no target set"
            })`;
  const macro = (
    label: string,
    exact: number | null,
    known: number,
    unknown: number,
    target: number | null,
  ) => {
    const value =
      exact == null
        ? `≥${Math.round(known)}g (${unknown || (language === "sv" ? "inga" : "no")} ${
            language === "sv" ? "okända" : "unknown"
          })`
        : `${Math.round(exact)}g`;
    return `${label} ${value}${target ? ` / ${Math.round(target)}g` : ""}`;
  };
  const macros = [
    macro(
      "protein",
      x.protein_g,
      x.known_totals.protein_g,
      x.unknown_meals.protein_g,
      x.target_protein_g,
    ),
    macro(
      language === "sv" ? "kolhydrater" : "carbs",
      x.carbs_g,
      x.known_totals.carbs_g,
      x.unknown_meals.carbs_g,
      x.target_carbs_g,
    ),
    macro(
      language === "sv" ? "fett" : "fat",
      x.fat_g,
      x.known_totals.fat_g,
      x.unknown_meals.fat_g,
      x.target_fat_g,
    ),
  ].join(" · ");
  const meals = x.meals.length
    ? x.meals
        .map(
          (m) =>
            `  - ${m.description}${
              m.calories != null
                ? ` (${m.calories} kcal; ${Math.round(m.protein_g ?? 0)}g protein, ${Math.round(
                    m.carbs_g ?? 0,
                  )}g ${language === "sv" ? "kolhydrater" : "carbs"}, ${Math.round(
                    m.fat_g ?? 0,
                  )}g ${language === "sv" ? "fett" : "fat"})`
                : language === "sv"
                  ? " (kalorier okända)"
                  : " (calories unknown)"
            }${
              m.ingredients.length
                ? ` [${language === "sv" ? "ingredienser" : "ingredients"}: ${m.ingredients
                    .map((ingredient) => `${ingredient.name} ${ingredient.amount}`)
                    .join(", ")}]`
                : ""
            }`,
        )
        .join("\n")
    : language === "sv"
      ? "  (inget loggat ännu i dag)"
      : "  (nothing logged yet today)";
  const week = x.week_days.length
    ? x.week_days
        .map((d) => {
          if (d.meal_count === 0) return `${d.date.slice(5)}:—`;
          const calorieValue =
            d.calories == null ? `${Math.round(d.known_calories)}+?` : Math.round(d.calories);
          return `${d.date.slice(5)}:${calorieValue} kcal/P${Math.round(
            d.protein_g ?? d.known_protein_g,
          )}/C${Math.round(d.carbs_g ?? d.known_carbs_g)}/F${Math.round(d.fat_g ?? d.known_fat_g)}`;
        })
        .join(", ")
    : language === "sv"
      ? "inga data"
      : "no data";
  const nutrientSummary = TRACKED_NUTRIENTS.filter(
    (nutrient) => x.nutrient_known_ingredients[nutrient.key] > 0,
  )
    .map((nutrient) => {
      const value = x.nutrient_totals[nutrient.key];
      const target = nutrient.dailyValue
        ? `/${nutrient.dailyValue}${nutrient.unit}`
        : nutrient.unit;
      const unknown = x.nutrient_unknown_ingredients[nutrient.key];
      return `${language === "sv" ? nutrient.sv : nutrient.en} ${value}${target}${
        unknown ? ` (+${unknown} unknown)` : ""
      }`;
    })
    .join(", ");
  const micros =
    nutrientSummary ||
    (language === "sv" ? "inga mikronäringsuppskattningar ännu" : "no micronutrient estimates yet");
  const trend = x.trend_summary;
  const trendMacro = [
    trend.average_calories == null ? "kcal unknown" : `${Math.round(trend.average_calories)} kcal`,
    trend.average_protein_g == null
      ? "protein unknown"
      : `${Math.round(trend.average_protein_g)}g protein`,
    trend.average_carbs_g == null
      ? `${language === "sv" ? "kolhydrater" : "carbs"} unknown`
      : `${Math.round(trend.average_carbs_g)}g ${language === "sv" ? "kolhydrater" : "carbs"}`,
    trend.average_fat_g == null
      ? `${language === "sv" ? "fett" : "fat"} unknown`
      : `${Math.round(trend.average_fat_g)}g ${language === "sv" ? "fett" : "fat"}`,
  ].join(", ");
  const trendNutrientKeys: NutrientKey[] = [
    "fiber_g",
    "saturated_fat_g",
    "sodium_mg",
    "potassium_mg",
    "calcium_mg",
    "iron_mg",
    "magnesium_mg",
    "zinc_mg",
    "vitamin_a_mcg",
    "vitamin_c_mg",
    "vitamin_d_mcg",
    "vitamin_b12_mcg",
  ];
  const trendMicros = trendNutrientKeys
    .map((key) => {
      const value = trend.average_nutrients[key];
      if (value == null) return null;
      const nutrient = TRACKED_NUTRIENTS.find((item) => item.key === key)!;
      return `${language === "sv" ? nutrient.sv : nutrient.en} ${value}${nutrient.unit}${
        nutrient.dailyValue ? `/${nutrient.dailyValue}${nutrient.unit}` : ""
      } (${trend.nutrient_complete_days[key]} complete days)`;
    })
    .filter((value): value is string => value != null)
    .join(", ");
  if (language === "sv") {
    return `I dag: ${cal}, ${macros}, ${x.meals.length} måltid(er):\n${meals}\nUppskattade mikronäringsämnen: ${micros}\nExakt 14-dagarstrend ${trend.period_start}–${trend.period_end}: ${trend.logged_days}/14 dagar loggade, ${trend.meal_count} måltider, genomsnitt per komplett loggad dag ${trendMacro}. Genomsnittliga viktiga näringsämnen: ${trendMicros || "otillräckliga kompletta data"}.\nAlla 14 dagarna (kcal och makron/dag): ${week}`;
  }
  return `Today ${cal}, ${macros}, ${x.meals.length} meal(s):\n${meals}\nEstimated micronutrients: ${micros}\nExact 14-day trend ${trend.period_start}–${trend.period_end}: ${trend.logged_days}/14 days logged, ${trend.meal_count} meals, average per complete logged day ${trendMacro}. Average key nutrients: ${trendMicros || "insufficient complete data"}.\nAll 14 days (kcal and macros/day): ${week}`;
}
