import { and, eq, asc, desc, gte, sql } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import { workoutSessions, sessionExercises, sessionSets, programDays } from "@/db/schema";
import { getTodayProgramDay, markProgramDay } from "@/lib/program.server";

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export type SessionSet = {
  id: string;
  set_index: number;
  target_reps: string | null;
  weight_kg: number | null;
  reps: number | null;
  completed: boolean;
  completed_at: string | null;
};
export type SessionExercise = {
  id: string;
  position: number;
  name: string;
  target: string | null;
  completed: boolean;
  completed_at: string | null;
  sets: SessionSet[];
};
export type ActiveSession = {
  id: string;
  session_date: string;
  title: string;
  status: string;
  started_at: string;
  program_day_id: string | null;
  exercises: SessionExercise[];
  done: number;
  total: number;
  next: SessionExercise | null;
} | null;

export async function getActiveSession(userId: string): Promise<ActiveSession> {
  const db = getDb();
  const [session] = await db
    .select()
    .from(workoutSessions)
    .where(and(eq(workoutSessions.user_id, userId), eq(workoutSessions.status, "active")))
    .orderBy(sql`${workoutSessions.created_at} desc`)
    .limit(1);
  if (!session) return null;

  const rows = await db
    .select()
    .from(sessionExercises)
    .where(eq(sessionExercises.session_id, session.id))
    .orderBy(asc(sessionExercises.position));

  const exIds = rows.map((r) => r.id);
  const allSets = exIds.length
    ? await db
        .select()
        .from(sessionSets)
        .where(sql`${sessionSets.session_exercise_id} in ${exIds}`)
        .orderBy(asc(sessionSets.set_index))
    : [];
  const setsByEx = new Map<string, SessionSet[]>();
  for (const s of allSets) {
    const list = setsByEx.get(s.session_exercise_id) ?? [];
    list.push({
      id: s.id,
      set_index: s.set_index,
      target_reps: s.target_reps,
      weight_kg: s.weight_kg,
      reps: s.reps,
      completed: s.completed,
      completed_at: s.completed_at,
    });
    setsByEx.set(s.session_exercise_id, list);
  }

  const exercises: SessionExercise[] = rows.map((r) => ({
    id: r.id,
    position: r.position,
    name: r.name,
    target: r.target,
    completed: r.completed,
    completed_at: r.completed_at,
    sets: setsByEx.get(r.id) ?? [],
  }));
  const done = exercises.filter((e) => e.completed).length;
  return {
    id: session.id,
    session_date: session.session_date,
    title: session.title,
    status: session.status,
    started_at: session.created_at,
    program_day_id: session.program_day_id,
    exercises,
    done,
    total: exercises.length,
    next: exercises.find((e) => !e.completed) ?? null,
  };
}

/** Sessions completed on a given date. */
async function completedSessionsOn(userId: string, date: string) {
  const db = getDb();
  return db
    .select({ id: workoutSessions.id, title: workoutSessions.title })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.user_id, userId),
        eq(workoutSessions.session_date, date),
        eq(workoutSessions.status, "completed"),
      ),
    );
}

export type StartResult =
  | { ok: true; session: ActiveSession }
  | { ok: false; error: string; coach_note: string };

/**
 * Start a session with realism guardrails:
 * - One session per calendar day unless the program schedules more (or an
 *   explicit override_reason is given).
 * - If today has a program day, exercises default to it (with per-set targets).
 */
export async function startSession(
  userId: string,
  opts: {
    date: string;
    title?: string | null;
    exercises?: Array<{ name: string; target?: string | null; sets?: number | null; rep_range?: string | null; weight_kg?: number | null }>;
    override_reason?: string | null;
  },
): Promise<StartResult> {
  const db = getDb();
  const date = opts.date;

  // Guardrail: sessions already done today vs. what the program allows.
  const doneToday = await completedSessionsOn(userId, date);
  const programDay = await getTodayProgramDay(userId, date);
  const allowedToday = programDay ? 1 : 1; // multi-session days would raise this
  if (doneToday.length >= allowedToday && !opts.override_reason) {
    return {
      ok: false,
      error: "daily_limit",
      coach_note: `The user ALREADY completed "${doneToday[0]?.title}" today (${date}). One session per day unless the program says otherwise — recovery is where growth happens. Do NOT start another session; tell them to rest, eat, and come back for the next scheduled day. Only override if they give a real reason (e.g. the program truly has two sessions today).`,
    };
  }
  if (programDay && programDay.status === "completed" && !opts.override_reason) {
    return {
      ok: false,
      error: "day_already_completed",
      coach_note: `Today's program day (${programDay.title}) is already completed. No second run — recovery matters.`,
    };
  }

  // Only one active session at a time.
  await db
    .update(workoutSessions)
    .set({ status: "abandoned" })
    .where(and(eq(workoutSessions.user_id, userId), eq(workoutSessions.status, "active")));

  // Exercise list: explicit > program day.
  const list =
    opts.exercises && opts.exercises.length
      ? opts.exercises
      : (programDay?.exercises ?? []).map((ex) => ({
          name: ex.name,
          target: `${ex.sets}×${ex.rep_range}${ex.target_weight_kg ? ` @ ${ex.target_weight_kg}kg` : ""}`,
          sets: ex.sets,
          rep_range: ex.rep_range,
          weight_kg: ex.target_weight_kg,
        }));
  if (!list.length) {
    return {
      ok: false,
      error: "no_exercises",
      coach_note: "No program day today and no exercises given. Either pick the next program day or build an ad-hoc list with the user first.",
    };
  }

  const title =
    opts.title || (programDay ? `${programDay.title}${programDay.is_deload ? " (deload)" : ""}` : "Workout");

  const [session] = await db
    .insert(workoutSessions)
    .values({
      user_id: userId,
      session_date: date,
      title,
      program_day_id: programDay?.id ?? null,
    })
    .returning();

  for (let i = 0; i < list.length; i++) {
    const ex = list[i];
    const [row] = await db
      .insert(sessionExercises)
      .values({
        session_id: session.id,
        position: i,
        name: ex.name,
        target: ex.target ?? null,
      })
      .returning({ id: sessionExercises.id });
    const nSets = ex.sets ?? 3;
    await db.insert(sessionSets).values(
      Array.from({ length: nSets }, (_, k) => ({
        session_exercise_id: row.id,
        set_index: k + 1,
        target_reps: ex.rep_range ?? null,
        weight_kg: ex.weight_kg ?? null,
      })),
    );
  }

  return { ok: true, session: await getActiveSession(userId) };
}

export async function markExerciseDone(
  userId: string,
  match: string,
  done = true,
): Promise<{ ok: boolean; error?: string; marked?: string; pace_warning?: string; session: ActiveSession }> {
  const current = await getActiveSession(userId);
  if (!current) return { ok: false, error: "no_active_session", session: null };

  const needle = match.trim().toLowerCase();
  const target =
    current.exercises.find((e) => e.name.toLowerCase() === needle) ??
    current.exercises.find((e) => e.name.toLowerCase().includes(needle)) ??
    current.exercises.find((e) => needle.includes(e.name.toLowerCase()));
  if (!target) return { ok: false, error: "exercise_not_found", session: current };

  const now = new Date().toISOString();
  const db = getDb();
  await db
    .update(sessionExercises)
    .set({ completed: done, completed_at: done ? now : null })
    .where(eq(sessionExercises.id, target.id));
  // Cascade to its sets.
  await db
    .update(sessionSets)
    .set({ completed: done, completed_at: done ? now : null })
    .where(eq(sessionSets.session_exercise_id, target.id));

  // Pace realism: how fast are exercises being checked off?
  const session = await getActiveSession(userId);
  let pace_warning: string | undefined;
  if (done && session) {
    const stamps = session.exercises
      .filter((e) => e.completed && e.completed_at)
      .map((e) => new Date(e.completed_at as string).getTime())
      .sort((a, b) => a - b);
    const started = new Date(session.started_at).getTime();
    const elapsedMin = (Date.now() - started) / 60000;
    const doneCount = stamps.length;
    // A real working exercise takes ~5+ minutes (sets + rest).
    if (doneCount >= 2 && elapsedMin < doneCount * 3) {
      pace_warning = `IMPLAUSIBLE PACE: ${doneCount} exercises marked done in ${elapsedMin.toFixed(1)} min of session time. A real session can't move this fast — challenge the user about what's actually happening instead of hyping.`;
    }
  }

  return { ok: true, marked: target.name, pace_warning, session };
}

/** Toggle/log a single set (per-set logging). Auto-completes the parent exercise
 * when all its sets are done. */
export async function markSetDone(
  userId: string,
  setId: string,
  opts: { completed: boolean; weight_kg?: number | null; reps?: number | null },
): Promise<{ ok: boolean; error?: string; session: ActiveSession }> {
  const current = await getActiveSession(userId);
  if (!current) return { ok: false, error: "no_active_session", session: null };
  const parent = current.exercises.find((e) => e.sets.some((s) => s.id === setId));
  if (!parent) return { ok: false, error: "set_not_found", session: current };

  const db = getDb();
  await db
    .update(sessionSets)
    .set({
      completed: opts.completed,
      completed_at: opts.completed ? new Date().toISOString() : null,
      ...(opts.weight_kg !== undefined ? { weight_kg: opts.weight_kg } : {}),
      ...(opts.reps !== undefined ? { reps: opts.reps } : {}),
    })
    .where(eq(sessionSets.id, setId));

  // Sync the parent exercise's completed flag with its sets.
  const refreshed = await getActiveSession(userId);
  const p = refreshed?.exercises.find((e) => e.id === parent.id);
  if (p) {
    const allDone = p.sets.length > 0 && p.sets.every((s) => s.completed);
    if (allDone !== p.completed) {
      await db
        .update(sessionExercises)
        .set({ completed: allDone, completed_at: allDone ? new Date().toISOString() : null })
        .where(eq(sessionExercises.id, p.id));
    }
  }
  return { ok: true, session: await getActiveSession(userId) };
}

export type CompleteResult =
  | { ok: true; duration_min: number }
  | { ok: false; error: string; coach_note: string };

/** Complete with duration realism: a planned session can't be done in minutes. */
export async function completeSession(
  userId: string,
  opts?: { planned_minutes?: number | null; override_reason?: string | null },
): Promise<CompleteResult> {
  const current = await getActiveSession(userId);
  if (!current)
    return { ok: false, error: "no_active_session", coach_note: "There is no active session to complete." };

  const elapsedMin = (Date.now() - new Date(current.started_at).getTime()) / 60000;
  const planned = opts?.planned_minutes ?? 60;
  const minimum = Math.max(10, planned * 0.25);
  if (elapsedMin < minimum && !opts?.override_reason) {
    return {
      ok: false,
      error: "implausible_duration",
      coach_note: `The session has only been running ${elapsedMin.toFixed(1)} minutes — a ~${planned} min workout can't be done that fast. Do NOT accept it. Ask what's going on (did they actually train earlier offline? are they just tapping boxes?). Only complete with an override if they give a real explanation.`,
    };
  }

  const db = getDb();
  await db
    .update(workoutSessions)
    .set({ status: "completed", completed_at: new Date().toISOString() })
    .where(eq(workoutSessions.id, current.id));
  if (current.program_day_id) {
    await markProgramDay(userId, current.program_day_id, "completed", current.id);
  }
  return { ok: true, duration_min: Math.round(elapsedMin) };
}

/** Recent session history (for coach context + dashboard). */
export async function getRecentSessions(userId: string, days = 7) {
  const db = getDb();
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const rows = await db
    .select()
    .from(workoutSessions)
    .where(and(eq(workoutSessions.user_id, userId), gte(workoutSessions.session_date, since)))
    .orderBy(desc(workoutSessions.created_at));
  return rows.map((r) => ({
    date: r.session_date,
    title: r.title,
    status: r.status,
    duration_min:
      r.completed_at && r.created_at
        ? Math.round((new Date(r.completed_at).getTime() - new Date(r.created_at).getTime()) / 60000)
        : null,
  }));
}

/** Compact live-session summary for the agent context (with pace signal). */
export function summarizeSession(s: ActiveSession): string {
  if (!s) return "(no active workout session)";
  const startedMin = Math.round((Date.now() - new Date(s.started_at).getTime()) / 60000);
  const lines = s.exercises
    .map((e) => `  ${e.completed ? "[x]" : "[ ]"} ${e.name}${e.target ? ` — ${e.target}` : ""}`)
    .join("\n");
  return `Active session "${s.title}" — running ${startedMin} min, ${s.done}/${s.total} done\n${lines}`;
}

/** History summary line for coach context. */
export function summarizeRecentSessions(rows: Awaited<ReturnType<typeof getRecentSessions>>): string {
  if (!rows.length) return "(no sessions in the last 7 days)";
  return rows
    .map(
      (r) =>
        `  - ${r.date}: ${r.title} — ${r.status}${r.duration_min != null ? ` (${r.duration_min} min)` : ""}`,
    )
    .join("\n");
}
