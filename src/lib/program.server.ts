import { and, eq, asc, desc, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import { programs, programDays, programExercises, workoutSessions } from "@/db/schema";
import {
  addIsoDays,
  assessProgramLifecycle,
  calculateProgramDates,
  calculateTargetWeight,
  trainingDayOffsets,
} from "@/lib/training-logic";

// Structured, fully-dated training programs. The whole program (every week, day,
// exercise, and target weight) is materialized up front; the coach adjusts
// future weeks as reality unfolds.

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
  const offsets = trainingDayOffsets(daysPerWeek);
  const dates = calculateProgramDates(input.start_date, input.weeks, daysPerWeek);
  const endDate = dates.at(-1);
  if (!endDate) throw new Error("A program must contain at least one training day");

  return db.transaction(async (tx) => {
    // Serialize program creation per user. A retry can never leave two active
    // cycles or archive the old one without finishing the replacement.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"program:" + userId}))`);
    await tx
      .update(programs)
      .set({ status: "archived" })
      .where(and(eq(programs.user_id, userId), eq(programs.status, "active")));

    const [program] = await tx
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
    if (!program) throw new Error("Failed to create program");

    let trainingWeeksSeen = 0;
    for (let week = 1; week <= input.weeks; week++) {
      const isDeload = input.deload_weeks.includes(week);
      for (let dayIndex = 0; dayIndex < daysPerWeek; dayIndex++) {
        const template = input.week_template[dayIndex];
        const date = addIsoDays(input.start_date, 7 * (week - 1) + offsets[dayIndex]);
        const [day] = await tx
          .insert(programDays)
          .values({
            program_id: program.id,
            week,
            day_index: dayIndex + 1,
            date,
            title: template.title,
            focus: template.focus ?? null,
            is_deload: isDeload,
          })
          .returning({ id: programDays.id });
        if (!day) throw new Error("Failed to create program day");

        const rows = template.exercises.map((exercise, position) => ({
          program_day_id: day.id,
          position,
          name: exercise.name,
          sets: isDeload ? Math.max(2, Math.ceil(exercise.sets * 0.6)) : exercise.sets,
          rep_range: exercise.rep_range,
          target_weight_kg: calculateTargetWeight({
            startWeightKg: exercise.start_weight_kg ?? null,
            incrementKg: exercise.increment_kg ?? 2.5,
            incrementEveryWeeks: exercise.increment_every_weeks ?? 2,
            completedTrainingWeeks: trainingWeeksSeen,
            isDeload,
          }),
          notes: exercise.notes ?? null,
        }));
        if (rows.length) await tx.insert(programExercises).values(rows);
      }
      if (!isDeloadWeek(input.deload_weeks, week)) trainingWeeksSeen++;
    }

    return {
      program_id: program.id,
      name: program.name,
      start_date: input.start_date,
      end_date: endDate,
    };
  });
}

function isDeloadWeek(deloads: number[], w: number) {
  return deloads.includes(w);
}

/**
 * Repair completed-session links and close a cycle only when every workout has
 * an explicit outcome. Reading a program never silently marks workouts skipped.
 */
export async function reconcileProgramLifecycle(userId: string, today: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"program:" + userId}))`);
    const [active] = await tx
      .select()
      .from(programs)
      .where(and(eq(programs.user_id, userId), eq(programs.status, "active")))
      .orderBy(desc(programs.created_at))
      .limit(1);
    if (!active) return null;

    // Self-heal if a process stopped between completing a workout and linking
    // the program day.
    await tx.execute(sql`
      UPDATE program_days pd
      SET status = 'completed', session_id = ws.id
      FROM workout_sessions ws
      WHERE pd.program_id = ${active.id}
        AND ws.program_day_id = pd.id
        AND ws.user_id = ${userId}
        AND ws.status = 'completed'
        AND (pd.status <> 'completed' OR pd.session_id IS DISTINCT FROM ws.id)
    `);

    const dayRows = await tx
      .select({ status: programDays.status })
      .from(programDays)
      .where(eq(programDays.program_id, active.id));
    const lifecycle = assessProgramLifecycle({
      statuses: dayRows.map((day) => day.status as "planned" | "completed" | "skipped"),
      today,
      endDate: active.end_date,
    });
    if (lifecycle.state === "completed") {
      await tx
        .update(programs)
        .set({ status: "completed", completed_at: new Date().toISOString() })
        .where(and(eq(programs.id, active.id), eq(programs.status, "active")));
    }
    return { ...lifecycle, program_id: active.id };
  });
}

async function getActiveProgramRow(userId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(programs)
    .where(and(eq(programs.user_id, userId), eq(programs.status, "active")))
    .orderBy(desc(programs.created_at))
    .limit(1);
  return row ?? null;
}

async function hydrateProgram(program: typeof programs.$inferSelect | null) {
  if (!program) return null;
  const db = getDb();
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

export async function getActiveProgram(userId: string, today?: string) {
  if (today) await reconcileProgramLifecycle(userId, today);
  return hydrateProgram(await getActiveProgramRow(userId));
}

/** Active cycle, or the most recently completed cycle for history/display. */
export async function getCurrentProgram(userId: string, today?: string) {
  if (today) await reconcileProgramLifecycle(userId, today);
  const db = getDb();
  const active = await getActiveProgramRow(userId);
  if (active) return hydrateProgram(active);
  const [latest] = await db
    .select()
    .from(programs)
    .where(and(eq(programs.user_id, userId), eq(programs.status, "completed")))
    .orderBy(desc(programs.completed_at), desc(programs.created_at))
    .limit(1);
  return hydrateProgram(latest ?? null);
}

/** Today's (or next upcoming) program day with exercises. */
export async function getTodayProgramDay(userId: string, today: string) {
  await reconcileProgramLifecycle(userId, today);
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
  await reconcileProgramLifecycle(userId, today);
  const db = getDb();
  const program = await getActiveProgramRow(userId);
  if (!program) return null;
  const days = await db
    .select()
    .from(programDays)
    .where(
      and(
        eq(programDays.program_id, program.id),
        eq(programDays.status, "planned"),
        gte(programDays.date, today),
      ),
    )
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
  resolutionNote?: string | null,
) {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"program:" + userId}))`);
    const [program] = await tx
      .select()
      .from(programs)
      .where(and(eq(programs.user_id, userId), eq(programs.status, "active")))
      .limit(1);
    if (!program) return { ok: false as const, error: "no_active_program" };

    if (status === "skipped") {
      const [activeSession] = await tx
        .select({ id: workoutSessions.id })
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.user_id, userId),
            eq(workoutSessions.program_day_id, dayId),
            eq(workoutSessions.status, "active"),
          ),
        )
        .limit(1);
      if (activeSession) {
        return { ok: false as const, error: "program_day_has_active_session" };
      }
    }

    const [updated] = await tx
      .update(programDays)
      .set({
        status,
        ...(sessionId !== undefined ? { session_id: sessionId } : {}),
        ...(resolutionNote !== undefined ? { resolution_note: resolutionNote } : {}),
      })
      .where(and(eq(programDays.id, dayId), eq(programDays.program_id, program.id)))
      .returning({ id: programDays.id });
    if (!updated) return { ok: false as const, error: "program_day_not_found" };

    const statuses = await tx
      .select({ status: programDays.status })
      .from(programDays)
      .where(eq(programDays.program_id, program.id));
    const cycleCompleted = statuses.length > 0 && statuses.every((day) => day.status !== "planned");
    if (cycleCompleted) {
      await tx
        .update(programs)
        .set({ status: "completed", completed_at: new Date().toISOString() })
        .where(eq(programs.id, program.id));
    }
    return { ok: true as const, cycle_completed: cycleCompleted, program_name: program.name };
  });
}

export async function resolveProgramDay(
  userId: string,
  opts: { date: string; status: "skipped" | "planned"; reason: string },
) {
  const db = getDb();
  const program = await getActiveProgramRow(userId);
  if (!program) return { ok: false as const, error: "no_active_program" };
  const [day] = await db
    .select({ id: programDays.id, title: programDays.title, status: programDays.status })
    .from(programDays)
    .where(and(eq(programDays.program_id, program.id), eq(programDays.date, opts.date)))
    .limit(1);
  if (!day) return { ok: false as const, error: "program_day_not_found" };
  if (day.status === "completed") {
    return { ok: false as const, error: "completed_day_is_immutable" };
  }
  const result = await markProgramDay(userId, day.id, opts.status, undefined, opts.reason);
  return {
    ...result,
    date: opts.date,
    title: day.title,
    status: opts.status,
    reason: opts.reason,
  };
}

/** Adjust target weights for an exercise from a given week onward (coach tool). */
export async function adjustProgramExercise(
  userId: string,
  opts: {
    exercise: string;
    from_week: number;
    delta_kg?: number | null;
    set_weight_kg?: number | null;
  },
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
      .set({
        target_weight_kg:
          next != null
            ? calculateTargetWeight({
                startWeightKg: next,
                incrementKg: 0,
                incrementEveryWeeks: 1,
                completedTrainingWeeks: 0,
                isDeload: false,
              })
            : null,
      })
      .where(eq(programExercises.id, m.id));
  }
  return { ok: true as const, updated: matches.length };
}

/** Compact program summary for the coach context. */
export function summarizeProgram(
  p: Awaited<ReturnType<typeof getCurrentProgram>>,
  today: string,
): string {
  if (!p) return "(no structured program yet — build one with generate_program)";
  const done = p.days.filter((d) => d.status === "completed").length;
  const skipped = p.days.filter((d) => d.status === "skipped").length;
  const overdue = p.days.filter((d) => d.status === "planned" && d.date < today);
  const upcoming = p.days.filter((d) => d.status === "planned" && d.date >= today).slice(0, 3);
  const up = upcoming
    .map((d) => `  - ${d.date} (wk ${d.week}) ${d.title}${d.is_deload ? " [deload]" : ""}`)
    .join("\n");
  if (p.status === "completed") {
    return `"${p.name}" — COMPLETED (${done} workouts, ${skipped} skipped), ${p.start_date} → ${p.end_date}.
The cycle is closed and preserved. Review the results, then offer to build the next program cycle.`;
  }
  return `"${p.name}" — ACTIVE, ${p.weeks} wks, ${p.days_per_week}x/wk, ${p.start_date} → ${p.end_date}
Progress: ${done} done, ${skipped} skipped, ${p.days.length - done - skipped} remaining (today: ${today})
Overdue workouts needing an explicit completed/skipped decision: ${overdue.length}
Next up:
${up || "  (none scheduled — review overdue workouts or close the cycle)"}`;
}
