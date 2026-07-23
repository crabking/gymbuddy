import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import { workspaceFiles, workoutSessions } from "@/db/schema";

// Derives "which training day is today" from the saved schedule + session
// history, so both the header and the coach are locked into the same reality.

export type TodayTraining = { label: string; detail: string | null };

export async function getTodayTraining(
  userId: string,
  opts?: { date?: string | null; weekday?: string | null },
): Promise<TodayTraining | null> {
  const db = getDb();

  // An active session always wins.
  const [active] = await db
    .select()
    .from(workoutSessions)
    .where(and(eq(workoutSessions.user_id, userId), eq(workoutSessions.status, "active")))
    .limit(1);
  if (active) return { label: active.title, detail: "in progress" };

  const [sched] = await db
    .select({ content: workspaceFiles.content })
    .from(workspaceFiles)
    .where(and(eq(workspaceFiles.user_id, userId), eq(workspaceFiles.path, "schedule/current.md")))
    .limit(1);
  if (!sched?.content) return null;

  // Parse "- **<label>** — <focus> (…)" lines.
  const entries = sched.content
    .split("\n")
    .map((l) => l.match(/^-\s*\*\*(.+?)\*\*\s*—\s*(.+)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ label: m[1].trim(), focus: m[2].trim() }));
  if (!entries.length) return null;

  const now = new Date();
  const date = opts?.date || now.toISOString().slice(0, 10);
  const weekday =
    opts?.weekday || ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][now.getDay()];

  const rolling = entries.some((e) => /^day\s*\d+/i.test(e.label));
  if (!rolling) {
    // Weekday mode: match today's weekday against the labels.
    const key = weekday.toLowerCase().slice(0, 3);
    const hit = entries.find((e) => e.label.toLowerCase().slice(0, 3) === key);
    if (!hit || /rest/i.test(hit.focus)) return { label: "Rest day", detail: weekday };
    return { label: hit.focus, detail: weekday };
  }

  // Rolling mode: next day = completed sessions since Monday.
  const d = new Date(`${date}T00:00:00`);
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const mondayStr = monday.toISOString().slice(0, 10);
  const done = await db
    .select({ id: workoutSessions.id })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.user_id, userId),
        eq(workoutSessions.status, "completed"),
        gte(workoutSessions.session_date, mondayStr),
      ),
    );
  const trainingDays = entries.filter((e) => /^day\s*\d+/i.test(e.label));
  const idx = done.length;
  if (idx >= trainingDays.length) {
    return { label: "Rest / recovery", detail: `${idx}/${trainingDays.length} sessions done this week` };
  }
  const next = trainingDays[idx];
  return {
    label: `${next.label} — ${next.focus}`,
    detail: `${idx}/${trainingDays.length} sessions done this week`,
  };
}
