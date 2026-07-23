import { and, eq, asc, sql } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import { workoutSessions, sessionExercises } from "@/db/schema";

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export type SessionExercise = {
  id: string;
  position: number;
  name: string;
  target: string | null;
  completed: boolean;
};
export type ActiveSession = {
  id: string;
  session_date: string;
  title: string;
  status: string;
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

  const exercises: SessionExercise[] = rows.map((r) => ({
    id: r.id,
    position: r.position,
    name: r.name,
    target: r.target,
    completed: r.completed,
  }));
  const done = exercises.filter((e) => e.completed).length;
  return {
    id: session.id,
    session_date: session.session_date,
    title: session.title,
    status: session.status,
    exercises,
    done,
    total: exercises.length,
    next: exercises.find((e) => !e.completed) ?? null,
  };
}

export async function startSession(
  userId: string,
  title: string,
  exercises: Array<{ name: string; target?: string | null }>,
): Promise<ActiveSession> {
  const db = getDb();
  // Only one active session at a time.
  await db
    .update(workoutSessions)
    .set({ status: "abandoned" })
    .where(and(eq(workoutSessions.user_id, userId), eq(workoutSessions.status, "active")));

  const [session] = await db
    .insert(workoutSessions)
    .values({ user_id: userId, session_date: todayStr(), title })
    .returning();

  if (exercises.length) {
    await db.insert(sessionExercises).values(
      exercises.map((e, i) => ({
        session_id: session.id,
        position: i,
        name: e.name,
        target: e.target ?? null,
      })),
    );
  }
  return getActiveSession(userId);
}

export async function markExerciseDone(
  userId: string,
  match: string,
  done = true,
): Promise<{ ok: boolean; error?: string; marked?: string; session: ActiveSession }> {
  const current = await getActiveSession(userId);
  if (!current) return { ok: false, error: "no_active_session", session: null };

  const needle = match.trim().toLowerCase();
  const target =
    current.exercises.find((e) => e.name.toLowerCase() === needle) ??
    current.exercises.find((e) => e.name.toLowerCase().includes(needle)) ??
    current.exercises.find((e) => needle.includes(e.name.toLowerCase()));
  if (!target) return { ok: false, error: "exercise_not_found", session: current };

  await getDb()
    .update(sessionExercises)
    .set({ completed: done, completed_at: done ? new Date().toISOString() : null })
    .where(eq(sessionExercises.id, target.id));

  return { ok: true, marked: target.name, session: await getActiveSession(userId) };
}

export async function completeSession(
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  const current = await getActiveSession(userId);
  if (!current) return { ok: false, error: "no_active_session" };
  await getDb()
    .update(workoutSessions)
    .set({ status: "completed", completed_at: new Date().toISOString() })
    .where(eq(workoutSessions.id, current.id));
  return { ok: true };
}

/** Compact one-line-per-exercise summary for injecting into the agent context. */
export function summarizeSession(s: ActiveSession): string {
  if (!s) return "(no active workout session)";
  const lines = s.exercises
    .map((e) => `  ${e.completed ? "[x]" : "[ ]"} ${e.name}${e.target ? ` — ${e.target}` : ""}`)
    .join("\n");
  return `Active session "${s.title}" (${s.done}/${s.total} done)\n${lines}`;
}
