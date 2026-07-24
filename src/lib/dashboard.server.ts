import { and, eq, gte, asc, inArray } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import {
  workoutSessions,
  sessionExercises,
  sessionSets,
  mealLogs,
  weightLogs,
  profiles,
} from "@/db/schema";

// Aggregates powering the Dashboard tab: strength per lift, weekly volume,
// bodyweight trend, calorie adherence, and session history.

const n = (v: number | null | undefined) => v ?? 0;

/** Epley estimated 1RM. */
const e1rm = (weight: number, reps: number) => Math.round(weight * (1 + reps / 30) * 10) / 10;

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;

export async function getDashboardData(userId: string, days = 400) {
  const db = getDb();
  const sinceDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const sinceIso = new Date(Date.now() - days * 86400000).toISOString();

  // --- Sessions (completed + others) in window ---
  const sessions = await db
    .select()
    .from(workoutSessions)
    .where(and(eq(workoutSessions.user_id, userId), gte(workoutSessions.session_date, sinceDate)))
    .orderBy(asc(workoutSessions.session_date));

  const sessionIds = sessions.map((s) => s.id);
  const exercises = sessionIds.length
    ? await db
        .select()
        .from(sessionExercises)
        .where(inArray(sessionExercises.session_id, sessionIds))
    : [];
  const exerciseIds = exercises.map((e) => e.id);
  const sets = exerciseIds.length
    ? await db
        .select()
        .from(sessionSets)
        .where(inArray(sessionSets.session_exercise_id, exerciseIds))
        .orderBy(asc(sessionSets.set_index))
    : [];

  const exById = new Map(exercises.map((e) => [e.id, e]));
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  // --- Strength per lift: best completed set per exercise per date ---
  type LiftPoint = { date: string; top_weight_kg: number; e1rm: number };
  const strength = new Map<string, LiftPoint[]>();
  for (const set of sets) {
    if (!set.completed || set.weight_kg == null) continue;
    const ex = exById.get(set.session_exercise_id);
    if (!ex) continue;
    const session = sessionById.get(ex.session_id);
    if (!session || session.status !== "completed") continue;
    const reps = set.reps ?? 5;
    const key = ex.name.trim();
    const list = strength.get(key) ?? [];
    const existing = list.find((p) => p.date === session.session_date);
    const est = e1rm(set.weight_kg, reps);
    if (existing) {
      existing.top_weight_kg = Math.max(existing.top_weight_kg, set.weight_kg);
      existing.e1rm = Math.max(existing.e1rm, est);
    } else {
      list.push({ date: session.session_date, top_weight_kg: set.weight_kg, e1rm: est });
      strength.set(key, list);
    }
  }
  // Keep lifts with at least 2 datapoints first, sorted by datapoint count.
  const strengthByLift = [...strength.entries()]
    .map(([name, points]) => ({
      name,
      points: points.sort((a, b) => a.date.localeCompare(b.date)),
    }))
    .sort((a, b) => b.points.length - a.points.length);

  // --- Weekly volume: completed sets + tonnage per ISO week ---
  // NOTE: format locally — toISOString() shifts across UTC midnight.
  const localStr = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const weekKey = (dateStr: string) => {
    const d = new Date(`${dateStr}T00:00:00`);
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return localStr(monday);
  };
  const volume = new Map<string, { sets: number; tonnage: number }>();
  for (const set of sets) {
    if (!set.completed) continue;
    const ex = exById.get(set.session_exercise_id);
    const session = ex ? sessionById.get(ex.session_id) : null;
    if (!session || session.status !== "completed") continue;
    const wk = weekKey(session.session_date);
    const cur = volume.get(wk) ?? { sets: 0, tonnage: 0 };
    cur.sets += 1;
    cur.tonnage += n(set.weight_kg) * n(set.reps ?? 5);
    volume.set(wk, cur);
  }
  const weeklyVolume = [...volume.entries()]
    .map(([week, v]) => ({ week, sets: v.sets, tonnage: Math.round(v.tonnage) }))
    .sort((a, b) => a.week.localeCompare(b.week));

  // --- Bodyweight trend ---
  const weights = await db
    .select()
    .from(weightLogs)
    .where(and(eq(weightLogs.user_id, userId), gte(weightLogs.logged_at, sinceIso)))
    .orderBy(asc(weightLogs.logged_at));
  const bodyweight = weights.map((w) => ({
    date: w.logged_at.slice(0, 10),
    weight_kg: w.weight_kg,
  }));

  // --- Calories per day vs target ---
  const [profile] = await db
    .select({ target: profiles.daily_calorie_target })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  const meals = await db
    .select()
    .from(mealLogs)
    .where(and(eq(mealLogs.user_id, userId), gte(mealLogs.logged_at, sinceIso)))
    .orderBy(asc(mealLogs.logged_at));
  const calByDay = new Map<string, { calories: number; protein_g: number }>();
  for (const m of meals) {
    const d = (m.logged_at ?? "").slice(0, 10);
    const cur = calByDay.get(d) ?? { calories: 0, protein_g: 0 };
    cur.calories += n(m.calories);
    cur.protein_g += n(m.protein_g);
    calByDay.set(d, cur);
  }
  const calories = [...calByDay.entries()]
    .map(([date, v]) => ({
      date,
      calories: Math.round(v.calories),
      protein_g: Math.round(v.protein_g),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // --- Session history + stats ---
  const history = sessions
    .map((s) => ({
      id: s.id,
      date: s.session_date,
      title: s.title,
      status: s.status,
      duration_min:
        s.completed_at && s.created_at
          ? Math.round(
              (new Date(s.completed_at).getTime() - new Date(s.created_at).getTime()) / 60000,
            )
          : null,
      exercises: exercises
        .filter((e) => e.session_id === s.id)
        .map((e) => ({ name: e.name, completed: e.completed })),
    }))
    .reverse();

  const completed = sessions.filter((s) => s.status === "completed").length;
  // Streak: consecutive weeks (ending this week) with >= 1 completed session.
  let streakWeeks = 0;
  {
    const weeksWithSession = new Set(
      sessions.filter((s) => s.status === "completed").map((s) => weekKey(s.session_date)),
    );
    let cursor = weekKey(localStr(new Date()));
    // The current week doesn't break the streak while it's still in progress.
    if (!weeksWithSession.has(cursor)) {
      const d = new Date(`${cursor}T00:00:00`);
      d.setDate(d.getDate() - 7);
      cursor = localStr(d);
    }
    while (weeksWithSession.has(cursor)) {
      streakWeeks++;
      const d = new Date(`${cursor}T00:00:00`);
      d.setDate(d.getDate() - 7);
      cursor = localStr(d);
    }
  }

  return {
    stats: {
      sessions_completed: completed,
      streak_weeks: streakWeeks,
      current_weight_kg: bodyweight.length ? bodyweight[bodyweight.length - 1].weight_kg : null,
      calorie_target: profile?.target ?? null,
    },
    strengthByLift,
    weeklyVolume,
    bodyweight,
    calories,
    history,
  };
}
