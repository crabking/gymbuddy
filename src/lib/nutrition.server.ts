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

export type NutritionToday = {
  date: string;
  target_calories: number | null;
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
  meal_count: number;
  meals: Array<{
    description: string;
    calories: number | null;
    protein_g: number | null;
    logged_at: string;
  }>;
  week_days: Array<{
    date: string;
    calories: number | null;
    known_calories: number;
    meal_count: number;
    unknown_calorie_meals: number;
  }>;
};

type Nutrient = "calories" | "protein_g" | "carbs_g" | "fat_g";

export type LogMealInput = {
  description: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
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
  validateNullableNumber(input.calories, 0, 10_000, "calories");
  if (input.calories != null && !Number.isInteger(input.calories)) {
    throw new Error("Invalid meal calories");
  }
  validateNullableNumber(input.protein_g, 0, 1_000, "protein");
  validateNullableNumber(input.carbs_g, 0, 2_000, "carbs");
  validateNullableNumber(input.fat_g, 0, 1_000, "fat");
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
    calories: input.calories,
    protein_g: input.protein_g,
    carbs_g: input.carbs_g,
    fat_g: input.fat_g,
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

export async function getNutrition(
  userId: string,
  requestedDate?: string,
  requestedTimeZone?: string | null,
): Promise<NutritionToday> {
  const db = getDb();
  const timeZone = normalizeTimeZone(requestedTimeZone) ?? "UTC";
  const today = requestedDate ? assertIsoDate(requestedDate) : localDateInTimeZone(timeZone);
  const weekStart = addLocalDays(today, -6);

  const [profile] = await db
    .select({ target: profiles.daily_calorie_target })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  const rows = await db
    .select()
    .from(mealLogs)
    .where(
      and(
        eq(mealLogs.user_id, userId),
        gte(mealLogs.logged_date, weekStart),
        lte(mealLogs.logged_date, today),
      ),
    )
    .orderBy(asc(mealLogs.logged_at));

  const todays = rows.filter((r) => r.logged_date === today);
  const todayCalories = aggregateNutrient(todays, "calories");
  const todayProtein = aggregateNutrient(todays, "protein_g");
  const todayCarbs = aggregateNutrient(todays, "carbs_g");
  const todayFat = aggregateNutrient(todays, "fat_g");
  const byDay = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byDay.get(r.logged_date) ?? [];
    list.push(r);
    byDay.set(r.logged_date, list);
  }

  return {
    date: today,
    target_calories: profile?.target ?? null,
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
    meal_count: todays.length,
    meals: todays.map((r) => ({
      description: r.description,
      calories: r.calories,
      protein_g: r.protein_g,
      logged_at: r.logged_at,
    })),
    week_days: Array.from({ length: 7 }, (_, index) => {
      const date = addLocalDays(weekStart, index);
      const dayRows = byDay.get(date) ?? [];
      const dayCalories = aggregateNutrient(dayRows, "calories");
      return {
        date,
        calories: dayCalories.exact,
        known_calories: dayCalories.known,
        meal_count: dayRows.length,
        unknown_calorie_meals: dayCalories.unknown,
      };
    }),
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
  const macro = (label: string, exact: number | null, known: number, unknown: number) =>
    exact == null
      ? `${label}≥${Math.round(known)} (${unknown || (language === "sv" ? "inga" : "no")} ${
          language === "sv" ? "okända" : "unknown"
        })`
      : `${label}${Math.round(exact)}`;
  const macros = [
    macro("P", x.protein_g, x.known_totals.protein_g, x.unknown_meals.protein_g),
    macro("C", x.carbs_g, x.known_totals.carbs_g, x.unknown_meals.carbs_g),
    macro("F", x.fat_g, x.known_totals.fat_g, x.unknown_meals.fat_g),
  ].join(" ");
  const meals = x.meals.length
    ? x.meals
        .map(
          (m) =>
            `  - ${m.description}${
              m.calories != null
                ? ` (${m.calories} kcal)`
                : language === "sv"
                  ? " (kalorier okända)"
                  : " (calories unknown)"
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
          if (d.calories == null) return `${d.date.slice(5)}:${Math.round(d.known_calories)}+?`;
          return `${d.date.slice(5)}:${Math.round(d.calories)}`;
        })
        .join(", ")
    : language === "sv"
      ? "inga data"
      : "no data";
  if (language === "sv") {
    return `I dag: ${cal}, ${macros}, ${x.meals.length} måltid(er):\n${meals}\nDen här veckan (kcal/dag): ${week}`;
  }
  return `Today ${cal}, ${macros}, ${x.meals.length} meal(s):\n${meals}\nThis week (kcal/day): ${week}`;
}
