import { and, count, desc, eq, gte, lte, asc, inArray } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import {
  workoutSessions,
  sessionExercises,
  sessionSets,
  mealLogs,
  weightLogs,
  profiles,
  measurements,
} from "@/db/schema";
import {
  addLocalDays,
  assertIsoDate,
  localDateInTimeZone,
  normalizeTimeZone,
} from "@/lib/local-date";
import { getWorkoutHistory } from "@/lib/workout-session.server";

// Aggregates powering the Dashboard tab: strength per lift, weekly volume,
// bodyweight trend, calorie adherence, and session history.

/** Epley estimated 1RM. */
const e1rm = (weight: number, reps: number) => Math.round(weight * (1 + reps / 30) * 10) / 10;
const MAX_E1RM_REPS = 12;

export type DashboardHistoryCursor = {
  session_date: string;
  created_at: string;
  id: string;
};

function exactTotal(known: number, unknown: number, entries: number) {
  return entries > 0 && unknown === 0 ? known : null;
}

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;

export async function getDashboardHistoryPage(
  userId: string,
  options: { limit?: number; before?: DashboardHistoryCursor | null } = {},
) {
  const requestedLimit = options.limit ?? 50;
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
    throw new Error("Invalid dashboard history limit");
  }
  const rows = await getWorkoutHistory(userId, {
    limit: requestedLimit + 1,
    before: options.before,
  });
  const hasMore = rows.length > requestedLimit;
  const pageRows = rows.slice(0, requestedLimit);
  const history = pageRows.map((session) => ({
    id: session.id,
    date: session.session_date,
    title: session.title,
    status: session.status,
    program_day_id: session.program_day_id,
    duration_min:
      session.duration_minutes ??
      (session.completed_at
        ? Math.max(
            0,
            Math.min(
              1440,
              Math.round(
                (new Date(session.completed_at).getTime() -
                  new Date(session.created_at).getTime()) /
                  60000,
              ),
            ),
          )
        : null),
    exercises: session.exercises.map((exercise) => ({
      name: exercise.name,
      completed:
        exercise.completed &&
        exercise.sets.length > 0 &&
        exercise.sets.every((set) => set.completed && set.reps != null),
    })),
  }));
  const tail = pageRows.at(-1);
  return {
    history,
    has_more: hasMore,
    next_cursor:
      hasMore && tail
        ? {
            session_date: tail.session_date,
            created_at: tail.created_at,
            id: tail.id,
          }
        : null,
  };
}

export async function getDashboardData(
  userId: string,
  days = 400,
  requestedDate?: string,
  requestedTimeZone?: string | null,
) {
  const db = getDb();
  const boundedDays = Math.max(7, Math.min(Math.trunc(days), 3650));
  const timeZone = normalizeTimeZone(requestedTimeZone) ?? "UTC";
  const today = requestedDate ? assertIsoDate(requestedDate) : localDateInTimeZone(timeZone);
  const sinceDate = addLocalDays(today, -(boundedDays - 1));

  // --- Sessions (completed + others) in window ---
  const sessions = await db
    .select()
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.user_id, userId),
        gte(workoutSessions.session_date, sinceDate),
        lte(workoutSessions.session_date, today),
      ),
    )
    .orderBy(
      asc(workoutSessions.session_date),
      asc(workoutSessions.created_at),
      asc(workoutSessions.id),
    );

  const sessionIds = sessions.map((s) => s.id);
  const exercises = sessionIds.length
    ? await db
        .select()
        .from(sessionExercises)
        .where(inArray(sessionExercises.session_id, sessionIds))
        .orderBy(
          asc(sessionExercises.session_id),
          asc(sessionExercises.position),
          asc(sessionExercises.id),
        )
    : [];
  const exerciseIds = exercises.map((e) => e.id);
  const sets = exerciseIds.length
    ? await db
        .select()
        .from(sessionSets)
        .where(inArray(sessionSets.session_exercise_id, exerciseIds))
        .orderBy(
          asc(sessionSets.session_exercise_id),
          asc(sessionSets.set_index),
          asc(sessionSets.id),
        )
    : [];

  const exById = new Map(exercises.map((e) => [e.id, e]));
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  // --- Strength per lift: best completed set per exercise per date ---
  type LiftPoint = { date: string; top_weight_kg: number; e1rm: number };
  const strength = new Map<string, LiftPoint[]>();
  for (const set of sets) {
    if (!set.completed || set.weight_kg == null || set.reps == null) continue;
    const ex = exById.get(set.session_exercise_id);
    if (!ex) continue;
    const session = sessionById.get(ex.session_id);
    if (!session || session.status !== "completed") continue;
    const reps = set.reps;
    // Epley is a low-rep strength estimate, not a general-purpose formula.
    // High-rep conditioning sets remain in exact history/volume but must not
    // manufacture a fantastical "1RM".
    if (set.weight_kg <= 0 || reps > MAX_E1RM_REPS) continue;
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
    if (set.weight_kg != null && set.reps != null) {
      cur.tonnage += set.weight_kg * set.reps;
    }
    volume.set(wk, cur);
  }
  const weeklyVolume = [...volume.entries()]
    .map(([week, v]) => ({ week, sets: v.sets, tonnage: Math.round(v.tonnage) }))
    .sort((a, b) => a.week.localeCompare(b.week));

  // --- Bodyweight trend ---
  const weights = await db
    .select()
    .from(weightLogs)
    .where(
      and(
        eq(weightLogs.user_id, userId),
        gte(weightLogs.logged_date, sinceDate),
        lte(weightLogs.logged_date, today),
      ),
    )
    .orderBy(asc(weightLogs.logged_date), asc(weightLogs.logged_at), asc(weightLogs.id));
  const bodyweight = weights.map((w) => ({
    date: w.logged_date,
    weight_kg: w.weight_kg,
  }));

  // --- Calories per day vs target ---
  const [profile] = await db
    .select({
      target: profiles.daily_calorie_target,
      current_weight_kg: profiles.weight_kg,
      data_epoch: profiles.data_epoch,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  const meals = await db
    .select()
    .from(mealLogs)
    .where(
      and(
        eq(mealLogs.user_id, userId),
        gte(mealLogs.logged_date, sinceDate),
        lte(mealLogs.logged_date, today),
      ),
    )
    .orderBy(asc(mealLogs.logged_at));
  const calByDay = new Map<
    string,
    {
      known_calories: number;
      known_protein_g: number;
      unknown_calorie_meals: number;
      unknown_protein_meals: number;
      meal_count: number;
    }
  >();
  for (const m of meals) {
    const d = m.logged_date;
    const cur = calByDay.get(d) ?? {
      known_calories: 0,
      known_protein_g: 0,
      unknown_calorie_meals: 0,
      unknown_protein_meals: 0,
      meal_count: 0,
    };
    cur.meal_count += 1;
    if (m.calories == null) cur.unknown_calorie_meals += 1;
    else cur.known_calories += m.calories;
    if (m.protein_g == null) cur.unknown_protein_meals += 1;
    else cur.known_protein_g += m.protein_g;
    calByDay.set(d, cur);
  }
  const calories = [...calByDay.entries()]
    .map(([date, v]) => ({
      date,
      calories:
        exactTotal(v.known_calories, v.unknown_calorie_meals, v.meal_count) == null
          ? null
          : Math.round(v.known_calories),
      known_calories: Math.round(v.known_calories),
      protein_g:
        exactTotal(v.known_protein_g, v.unknown_protein_meals, v.meal_count) == null
          ? null
          : Math.round(v.known_protein_g),
      known_protein_g: Math.round(v.known_protein_g),
      meal_count: v.meal_count,
      unknown_calorie_meals: v.unknown_calorie_meals,
      unknown_protein_meals: v.unknown_protein_meals,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // --- Coach-defined measurements (heart rate, waist, sleep, habits, etc.) ---
  const measurementRows = await db
    .select()
    .from(measurements)
    .where(
      and(
        eq(measurements.user_id, userId),
        gte(measurements.recorded_date, sinceDate),
        lte(measurements.recorded_date, today),
      ),
    )
    .orderBy(asc(measurements.recorded_date), asc(measurements.recorded_at));
  const measurementMap = new Map<
    string,
    {
      metric_key: string;
      label: string;
      unit: string;
      points: Array<{ date: string; value: number; notes: string | null }>;
    }
  >();
  for (const row of measurementRows) {
    const series = measurementMap.get(row.metric_key) ?? {
      metric_key: row.metric_key,
      label: row.label,
      unit: row.unit,
      points: [],
    };
    series.points.push({
      date: row.recorded_date,
      value: row.value,
      notes: row.notes,
    });
    measurementMap.set(row.metric_key, series);
  }
  const customMeasurements = [...measurementMap.values()];

  // --- Session history + stats ---
  const setsByExercise = new Map<string, typeof sets>();
  for (const set of sets) {
    const list = setsByExercise.get(set.session_exercise_id) ?? [];
    list.push(set);
    setsByExercise.set(set.session_exercise_id, list);
  }
  const windowHistory = sessions.map((s) => ({
    id: s.id,
    date: s.session_date,
    title: s.title,
    status: s.status,
    program_day_id: s.program_day_id,
    duration_min:
      s.duration_minutes ??
      (s.completed_at && s.created_at
        ? Math.max(
            0,
            Math.min(
              1440,
              Math.round(
                (new Date(s.completed_at).getTime() - new Date(s.created_at).getTime()) / 60000,
              ),
            ),
          )
        : null),
    exercises: exercises
      .filter((e) => e.session_id === s.id)
      .map((e) => ({
        name: e.name,
        completed:
          e.completed &&
          (setsByExercise.get(e.id)?.length ?? 0) > 0 &&
          (setsByExercise.get(e.id) ?? []).every((set) => set.completed && set.reps != null),
      })),
  }));
  const initialHistory = await getDashboardHistoryPage(userId, { limit: 50 });
  const [lifetimeCompleted] = await db
    .select({ value: count() })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.user_id, userId), eq(workoutSessions.status, "completed")));
  const incompleteCompletedSessions = windowHistory.filter(
    (session) =>
      session.status === "completed" &&
      (session.exercises.length === 0 || session.exercises.some((exercise) => !exercise.completed)),
  ).length;
  // Streak: consecutive weeks (ending this week) with >= 1 completed session.
  let streakWeeks = 0;
  {
    const weeksWithSession = new Set(
      sessions.filter((s) => s.status === "completed").map((s) => weekKey(s.session_date)),
    );
    let cursor = weekKey(today);
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
    data_epoch: profile?.data_epoch ?? 0,
    stats: {
      sessions_completed: lifetimeCompleted?.value ?? 0,
      streak_weeks: streakWeeks,
      current_weight_kg: profile?.current_weight_kg ?? null,
      calorie_target: profile?.target ?? null,
      incomplete_completed_sessions: incompleteCompletedSessions,
    },
    strengthByLift,
    weeklyVolume,
    bodyweight,
    calories,
    customMeasurements,
    history: initialHistory.history,
    history_has_more: initialHistory.has_more,
    history_next_cursor: initialHistory.next_cursor,
    window: { from: sinceDate, to: today, days: boundedDays },
  };
}
