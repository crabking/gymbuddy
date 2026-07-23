import { and, eq, gte, asc } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import { mealLogs, profiles } from "@/db/schema";

export type NutritionToday = {
  date: string;
  target_calories: number | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  meals: Array<{
    description: string;
    calories: number | null;
    protein_g: number | null;
    logged_at: string;
  }>;
  week_days: Array<{ date: string; calories: number }>;
};

const n = (v: number | null | undefined) => v ?? 0;

export async function getNutrition(userId: string): Promise<NutritionToday> {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const weekAgoIso = new Date(Date.now() - 7 * 86400000).toISOString();

  const [profile] = await db
    .select({ target: profiles.daily_calorie_target })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  const rows = await db
    .select()
    .from(mealLogs)
    .where(and(eq(mealLogs.user_id, userId), gte(mealLogs.logged_at, weekAgoIso)))
    .orderBy(asc(mealLogs.logged_at));

  const todays = rows.filter((r) => (r.logged_at ?? "").slice(0, 10) === today);
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const d = (r.logged_at ?? "").slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + n(r.calories));
  }

  return {
    date: today,
    target_calories: profile?.target ?? null,
    calories: todays.reduce((s, r) => s + n(r.calories), 0),
    protein_g: todays.reduce((s, r) => s + n(r.protein_g), 0),
    carbs_g: todays.reduce((s, r) => s + n(r.carbs_g), 0),
    fat_g: todays.reduce((s, r) => s + n(r.fat_g), 0),
    meals: todays.map((r) => ({
      description: r.description,
      calories: r.calories,
      protein_g: r.protein_g,
      logged_at: r.logged_at,
    })),
    week_days: [...byDay.entries()].map(([date, calories]) => ({ date, calories })),
  };
}

/** Compact summary for injecting into the agent context. */
export function summarizeNutrition(x: NutritionToday): string {
  const cal = x.target_calories
    ? `${Math.round(x.calories)} / ${x.target_calories} kcal (${Math.max(
        0,
        x.target_calories - Math.round(x.calories),
      )} left)`
    : `${Math.round(x.calories)} kcal (no target set)`;
  const macros = `P${Math.round(x.protein_g)} C${Math.round(x.carbs_g)} F${Math.round(x.fat_g)}`;
  const meals = x.meals.length
    ? x.meals.map((m) => `  - ${m.description}${m.calories ? ` (${m.calories} kcal)` : ""}`).join("\n")
    : "  (nothing logged yet today)";
  const week = x.week_days.length
    ? x.week_days.map((d) => `${d.date.slice(5)}:${Math.round(d.calories)}`).join(", ")
    : "no data";
  return `Today ${cal}, ${macros}, ${x.meals.length} meal(s):\n${meals}\nThis week (kcal/day): ${week}`;
}
