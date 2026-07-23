import { and, eq, asc, lt, inArray } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import { programs, programDays, programExercises } from "@/db/schema";

// Structured, fully-dated training programs. The whole program (every week, day,
// exercise, and target weight) is materialized up front; the coach adjusts
// future weeks as reality unfolds.

/** Training-day offsets within a week, by days/week. */
const WEEK_OFFSETS: Record<number, number[]> = {
  1: [0],
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 4, 5],
  6: [0, 1, 2, 3, 4, 5],
  7: [0, 1, 2, 3, 4, 5, 6],
};

const round25 = (kg: number) => Math.round(kg / 2.5) * 2.5;
const addDays = (dateStr: string, days: number) => {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export type WeekTemplateDay = {
  title: string;
  focus?: string | null;
  exercises: Array<{
    name: string;
    sets: number;
    rep_range: string;
    start_weight_kg?: number | null;
    increment_kg?: number | null;
    increment_every_weeks?: number | null;
    notes?: string | null;
  }>;
};

export type GenerateProgramInput = {
  name: string;
  goal: string;
  experience: string;
  start_date: string;
  weeks: number;
  session_minutes: number;
  deload_weeks: number[];
  progression_rules: string;
  why: string;
  week_template: WeekTemplateDay[];
};

export async function generateProgram(userId: string, input: GenerateProgramInput) {
  const db = getDb();
  const daysPerWeek = input.week_template.length;
  const offsets = WEEK_OFFSETS[Math.min(7, Math.max(1, daysPerWeek))];

  // Archive any existing active program.
  await db
    .update(programs)
    .set({ status: "archived" })
    .where(and(eq(programs.user_id, userId), eq(programs.status, "active")));

  const lastDayOffset = 7 * (input.weeks - 1) + offsets[offsets.length - 1];
  const endDate = addDays(input.start_date, lastDayOffset);

  const [program] = await db
    .insert(programs)
    .values({
      user_id: userId,
      name: input.name,
      goal: input.goal,
      experience: input.experience,
      start_date: input.start_date,
      end_date: endDate,
      weeks: input.weeks,
      days_per_week: daysPerWeek,
      session_minutes: input.session_minutes,
      deload_weeks: input.deload_weeks,
      progression_rules: input.progression_rules,
      why: input.why,
    })
    .returning();

  // Materialize every dated day + exercise with progression applied.
  let trainingWeeksSeen = 0; // non-deload weeks completed before current week
  for (let w = 1; w <= input.weeks; w++) {
    const isDeload = input.deload_weeks.includes(w);
    for (let dIdx = 0; dIdx < daysPerWeek; dIdx++) {
      const t = input.week_template[dIdx];
      const date = addDays(input.start_date, 7 * (w - 1) + offsets[dIdx]);
      const [day] = await db
        .insert(programDays)
        .values({
          program_id: program.id,
          week: w,
          day_index: dIdx + 1,
          date,
          title: t.title,
          focus: t.focus ?? null,
          is_deload: isDeload,
        })
        .returning({ id: programDays.id });

      const rows = t.exercises.map((ex, pos) => {
        let weight: number | null = null;
        if (ex.start_weight_kg != null) {
          const every = Math.max(1, ex.increment_every_weeks ?? 2);
          const steps = Math.floor(trainingWeeksSeen / every);
          const raw = ex.start_weight_kg + steps * (ex.increment_kg ?? 2.5);
          weight = round25(isDeload ? raw * 0.9 : raw);
        }
        return {
          program_day_id: day.id,
          position: pos,
          name: ex.name,
          sets: isDeload ? Math.max(2, Math.ceil(ex.sets * 0.6)) : ex.sets,
          rep_range: ex.rep_range,
          target_weight_kg: weight,
          notes: ex.notes ?? null,
        };
      });
      if (rows.length) await db.insert(programExercises).values(rows);
    }
    if (!isDeloadWeek(input.deload_weeks, w)) trainingWeeksSeen++;
  }

  return { program_id: program.id, name: program.name, start_date: input.start_date, end_date: endDate };
}

function isDeloadWeek(deloads: number[], w: number) {
  return deloads.includes(w);
}

/** Lazily mark past planned days as skipped (called on reads). */
export async function autoSkipPast(userId: string, today: string) {
  const db = getDb();
  const active = await getActiveProgramRow(userId);
  if (!active) return;
  await db
    .update(programDays)
    .set({ status: "skipped" })
    .where(
      and(
        eq(programDays.program_id, active.id),
        eq(programDays.status, "planned"),
        lt(programDays.date, today),
      ),
    );
}

async function getActiveProgramRow(userId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(programs)
    .where(and(eq(programs.user_id, userId), eq(programs.status, "active")))
    .limit(1);
  return row ?? null;
}

export async function getActiveProgram(userId: string, today?: string) {
  if (today) await autoSkipPast(userId, today);
  const db = getDb();
  const program = await getActiveProgramRow(userId);
  if (!program) return null;
  const days = await db
    .select()
    .from(programDays)
    .where(eq(programDays.program_id, program.id))
    .orderBy(asc(programDays.date));
  const dayIds = days.map((d) => d.id);
  const exercises = dayIds.length
    ? await db
        .select()
        .from(programExercises)
        .where(inArray(programExercises.program_day_id, dayIds))
        .orderBy(asc(programExercises.position))
    : [];
  const byDay = new Map<string, typeof exercises>();
  for (const ex of exercises) {
    const list = byDay.get(ex.program_day_id) ?? [];
    list.push(ex);
    byDay.set(ex.program_day_id, list);
  }
  return {
    ...program,
    deload_weeks: (program.deload_weeks as number[]) ?? [],
    days: days.map((d) => ({ ...d, exercises: byDay.get(d.id) ?? [] })),
  };
}

/** Today's (or next upcoming) program day with exercises. */
export async function getTodayProgramDay(userId: string, today: string) {
  await autoSkipPast(userId, today);
  const db = getDb();
  const program = await getActiveProgramRow(userId);
  if (!program) return null;
  const [day] = await db
    .select()
    .from(programDays)
    .where(and(eq(programDays.program_id, program.id), eq(programDays.date, today)))
    .limit(1);
  if (!day) return null;
  const exercises = await db
    .select()
    .from(programExercises)
    .where(eq(programExercises.program_day_id, day.id))
    .orderBy(asc(programExercises.position));
  return { ...day, program_name: program.name, exercises };
}

/** Next planned day on/after today (for "next session" surfaces). */
export async function getNextProgramDay(userId: string, today: string) {
  await autoSkipPast(userId, today);
  const db = getDb();
  const program = await getActiveProgramRow(userId);
  if (!program) return null;
  const days = await db
    .select()
    .from(programDays)
    .where(and(eq(programDays.program_id, program.id), eq(programDays.status, "planned")))
    .orderBy(asc(programDays.date))
    .limit(1);
  const day = days[0];
  if (!day) return null;
  const exercises = await db
    .select()
    .from(programExercises)
    .where(eq(programExercises.program_day_id, day.id))
    .orderBy(asc(programExercises.position));
  return { ...day, program_name: program.name, exercises };
}

export async function markProgramDay(
  userId: string,
  dayId: string,
  status: "completed" | "skipped" | "planned",
  sessionId?: string | null,
) {
  const db = getDb();
  const program = await getActiveProgramRow(userId);
  if (!program) return { ok: false as const, error: "no_active_program" };
  await db
    .update(programDays)
    .set({ status, ...(sessionId !== undefined ? { session_id: sessionId } : {}) })
    .where(and(eq(programDays.id, dayId), eq(programDays.program_id, program.id)));
  return { ok: true as const };
}

/** Adjust target weights for an exercise from a given week onward (coach tool). */
export async function adjustProgramExercise(
  userId: string,
  opts: { exercise: string; from_week: number; delta_kg?: number | null; set_weight_kg?: number | null },
) {
  const db = getDb();
  const program = await getActiveProgramRow(userId);
  if (!program) return { ok: false as const, error: "no_active_program" };
  const days = await db
    .select({ id: programDays.id, week: programDays.week })
    .from(programDays)
    .where(eq(programDays.program_id, program.id));
  const targetDayIds = days.filter((d) => d.week >= opts.from_week).map((d) => d.id);
  if (!targetDayIds.length) return { ok: false as const, error: "no_matching_weeks" };

  const rows = await db
    .select()
    .from(programExercises)
    .where(inArray(programExercises.program_day_id, targetDayIds));
  const needle = opts.exercise.trim().toLowerCase();
  const matches = rows.filter((r) => r.name.toLowerCase().includes(needle));
  if (!matches.length) return { ok: false as const, error: "exercise_not_found" };

  for (const m of matches) {
    const next =
      opts.set_weight_kg != null
        ? opts.set_weight_kg
        : m.target_weight_kg != null
          ? m.target_weight_kg + (opts.delta_kg ?? 0)
          : null;
    await db
      .update(programExercises)
      .set({ target_weight_kg: next != null ? round25(next) : null })
      .where(eq(programExercises.id, m.id));
  }
  return { ok: true as const, updated: matches.length };
}

/** Compact program summary for the coach context. */
export function summarizeProgram(
  p: Awaited<ReturnType<typeof getActiveProgram>>,
  today: string,
): string {
  if (!p) return "(no structured program yet — build one with generate_program)";
  const done = p.days.filter((d) => d.status === "completed").length;
  const skipped = p.days.filter((d) => d.status === "skipped").length;
  const upcoming = p.days.filter((d) => d.status === "planned").slice(0, 3);
  const up = upcoming
    .map((d) => `  - ${d.date} (wk ${d.week}) ${d.title}${d.is_deload ? " [deload]" : ""}`)
    .join("\n");
  return `"${p.name}" — ${p.weeks} wks, ${p.days_per_week}x/wk, ${p.start_date} → ${p.end_date}
Progress: ${done} done, ${skipped} skipped, ${p.days.length - done - skipped} remaining (today: ${today})
Next up:
${up || "  (none — program finished)"}`;
}
