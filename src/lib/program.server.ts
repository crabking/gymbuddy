import { createHash } from "node:crypto";
import { and, eq, asc, desc, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import {
  exerciseCatalog,
  programDays,
  programExercises,
  programOperations,
  programs,
  sessionExercises,
  sessionSets,
  workoutSessions,
} from "@/db/schema";
import { findExercise, getExercise, type AppLanguage, type ExerciseId } from "@/lib/exercises";
import { summarizeAttendancePattern } from "@/lib/attendance";
import {
  acquireAccountMutationLock,
  requireExpectedDataEpoch,
  type AccountMutationTransaction,
} from "@/lib/account-epoch.server";
import {
  addIsoDays,
  assessProgramLifecycle,
  beginnerCalibrationPrescription,
  calculateProgramDatesForSchedule,
  calculateTargetWeight,
  isoWeekdayIndex,
  shiftWeekdayIndices,
  type ProgramScheduleMode,
} from "@/lib/training-logic";

// Structured, fully-dated training programs. The whole program (every week, day,
// exercise, and target weight) is materialized up front; the coach adjusts
// future weeks as reality unfolds.

async function lockProgramMutation(
  tx: AccountMutationTransaction,
  userId: string,
  expectedDataEpoch?: number,
) {
  if (expectedDataEpoch === undefined) {
    await acquireAccountMutationLock(tx, userId);
    return;
  }
  await requireExpectedDataEpoch(tx, userId, expectedDataEpoch);
}

function operationPayloadHash(operation: string, payload: Record<string, unknown>) {
  return createHash("sha256")
    .update(JSON.stringify({ operation, ...payload }))
    .digest("hex");
}

function validOperationSourceKey(value: string | null | undefined): value is string {
  return !!value?.trim() && value.length <= 200;
}

export type WeekTemplateDay = {
  title: string;
  focus?: string | null;
  exercises: Array<{
    exercise_id?: ExerciseId | string | null;
    /** Legacy/tool compatibility; resolved to a canonical exercise identity. */
    name?: string | null;
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
  schedule_mode?: ProgramScheduleMode;
  weekday_indices?: number[];
  deload_weeks: number[];
  progression_rules: string;
  why: string;
  week_template: WeekTemplateDay[];
  replace_active_reason?: string | null;
  source_key?: string | null;
  expected_data_epoch?: number;
  /** Used only to reject total-system load for weighted bodyweight movements. */
  athlete_bodyweight_kg?: number | null;
  beginner_calibration?: {
    enabled: boolean;
    sex: "male" | "female" | "other";
  };
};

export type GenerateProgramResult = {
  program_id: string;
  name: string;
  start_date: string;
  end_date: string;
  idempotent_replay: boolean;
};

export async function generateProgram(
  userId: string,
  input: GenerateProgramInput,
): Promise<GenerateProgramResult> {
  validateProgramInput(input);
  const db = getDb();
  const sourceKey = input.source_key?.trim() || null;
  const daysPerWeek = input.week_template.length;
  const scheduleMode = input.schedule_mode ?? "rolling";
  const weekdayIndices = scheduleMode === "weekday" ? (input.weekday_indices ?? []) : [];
  const normalizedWeekTemplate = input.week_template.map((day) => ({
    ...day,
    exercises: day.exercises.map((exercise) =>
      normalizeProgramExercise(
        exercise,
        input.beginner_calibration,
        input.athlete_bodyweight_kg ?? null,
      ),
    ),
  }));
  const dates = calculateProgramDatesForSchedule({
    startDate: input.start_date,
    weeks: input.weeks,
    daysPerWeek,
    mode: scheduleMode,
    weekdayIndices,
  });
  const endDate = dates.at(-1);
  if (!endDate) throw new Error("A program must contain at least one training day");
  const payloadHash = operationPayloadHash("generate_program", {
    name: input.name.trim(),
    goal: input.goal.trim(),
    experience: input.experience.trim(),
    start_date: input.start_date,
    weeks: input.weeks,
    session_minutes: input.session_minutes,
    schedule_mode: scheduleMode,
    weekday_indices: weekdayIndices,
    beginner_calibration: input.beginner_calibration ?? null,
    athlete_bodyweight_kg: input.athlete_bodyweight_kg ?? null,
    deload_weeks: input.deload_weeks,
    progression_rules: input.progression_rules.trim(),
    why: input.why.trim(),
    replace_active_reason: input.replace_active_reason?.trim() || null,
    week_template: normalizedWeekTemplate.map((day) => ({
      title: day.title.trim(),
      focus: day.focus?.trim() || null,
      exercises: day.exercises.map((exercise) => {
        const canonical = resolveProgramExercise(exercise);
        return {
          exercise_id: canonical.id,
          name: canonical.name_en,
          sets: exercise.sets,
          rep_range: exercise.rep_range.trim(),
          start_weight_kg: exercise.start_weight_kg ?? null,
          increment_kg: exercise.increment_kg ?? null,
          increment_every_weeks: exercise.increment_every_weeks ?? null,
          notes: exercise.notes?.trim() || null,
        };
      }),
    })),
  });

  return db.transaction(async (tx) => {
    await lockProgramMutation(tx, userId, input.expected_data_epoch);
    // Serialize program creation per user. A retry can never leave two active
    // cycles or archive the old one without finishing the replacement.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"program:" + userId}, 0))`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"workout:" + userId}, 0))`,
    );

    if (sourceKey) {
      const [prior] = await tx
        .select({
          operation: programOperations.operation,
          payload_hash: programOperations.payload_hash,
          result: programOperations.result,
        })
        .from(programOperations)
        .where(
          and(eq(programOperations.user_id, userId), eq(programOperations.source_key, sourceKey)),
        )
        .limit(1);
      if (prior) {
        if (prior.operation !== "generate_program" || prior.payload_hash !== payloadHash) {
          throw new Error("idempotency_key_reused");
        }
        return {
          ...(prior.result as GenerateProgramResult),
          idempotent_replay: true,
        };
      }
      const [legacyProgram] = await tx
        .select({ id: programs.id })
        .from(programs)
        .where(and(eq(programs.user_id, userId), eq(programs.source_key, sourceKey)))
        .limit(1);
      if (legacyProgram) throw new Error("idempotency_state_unverifiable");
    }

    const [activeWorkout] = await tx
      .select({ id: workoutSessions.id })
      .from(workoutSessions)
      .where(and(eq(workoutSessions.user_id, userId), eq(workoutSessions.status, "active")))
      .limit(1);
    if (activeWorkout) {
      throw new Error("active_workout_in_progress");
    }

    const [activeProgram] = await tx
      .select({ id: programs.id, name: programs.name })
      .from(programs)
      .where(and(eq(programs.user_id, userId), eq(programs.status, "active")))
      .limit(1);
    if (activeProgram && !input.replace_active_reason?.trim()) {
      throw new Error("active_program_requires_confirmed_replacement");
    }

    await tx
      .update(programs)
      .set({
        status: "archived",
        archived_at: new Date().toISOString(),
        archive_reason: input.replace_active_reason?.trim() || "Replaced by a confirmed new cycle",
      })
      .where(and(eq(programs.user_id, userId), eq(programs.status, "active")));

    const [program] = await tx
      .insert(programs)
      .values({
        user_id: userId,
        name: input.name.trim(),
        goal: input.goal.trim(),
        experience: input.experience.trim(),
        start_date: input.start_date,
        end_date: endDate,
        weeks: input.weeks,
        days_per_week: daysPerWeek,
        schedule_mode: scheduleMode,
        weekday_indices: weekdayIndices,
        session_minutes: input.session_minutes,
        deload_weeks: input.deload_weeks,
        progression_rules: input.progression_rules.trim(),
        why: input.why.trim(),
        source_key: sourceKey,
      })
      .returning();
    if (!program) throw new Error("Failed to create program");

    let trainingWeeksSeen = 0;
    for (let week = 1; week <= input.weeks; week++) {
      const isDeload = input.deload_weeks.includes(week);
      for (let dayIndex = 0; dayIndex < daysPerWeek; dayIndex++) {
        const date = dates[(week - 1) * daysPerWeek + dayIndex];
        if (!date) throw new Error("Failed to calculate program day");
        const templateIndex =
          scheduleMode === "weekday" ? weekdayIndices.indexOf(isoWeekdayIndex(date)) : dayIndex;
        const template = normalizedWeekTemplate[templateIndex];
        if (!template) throw new Error("Failed to match program template to scheduled weekday");
        const [day] = await tx
          .insert(programDays)
          .values({
            program_id: program.id,
            week,
            day_index: templateIndex + 1,
            date,
            title: template.title.trim(),
            focus: template.focus?.trim() || null,
            is_deload: isDeload,
          })
          .returning({ id: programDays.id });
        if (!day) throw new Error("Failed to create program day");

        const rows = template.exercises.map((exercise, position) => {
          const canonical = resolveProgramExercise(exercise);
          return {
            program_day_id: day.id,
            position,
            exercise_id: canonical.id,
            name: canonical.name_en,
            sets: isDeload ? Math.max(1, Math.ceil(exercise.sets * 0.6)) : exercise.sets,
            rep_range: exercise.rep_range.trim(),
            target_weight_kg: calculateTargetWeight({
              startWeightKg: exercise.start_weight_kg ?? null,
              incrementKg: exercise.increment_kg ?? 2.5,
              incrementEveryWeeks: exercise.increment_every_weeks ?? 2,
              completedTrainingWeeks: trainingWeeksSeen,
              isDeload,
            }),
            progression_step_kg:
              exercise.start_weight_kg == null ? null : (exercise.increment_kg ?? 2.5),
            notes: exercise.notes?.trim() || null,
          };
        });
        if (rows.length) await tx.insert(programExercises).values(rows);
      }
      if (!isDeloadWeek(input.deload_weeks, week)) trainingWeeksSeen++;
    }

    const result: GenerateProgramResult = {
      program_id: program.id,
      name: program.name,
      start_date: input.start_date,
      end_date: endDate,
      idempotent_replay: false,
    };
    if (sourceKey) {
      await tx.insert(programOperations).values({
        user_id: userId,
        source_key: sourceKey,
        operation: "generate_program",
        payload_hash: payloadHash,
        result,
      });
    }
    return result;
  });
}

function isDeloadWeek(deloads: number[], w: number) {
  return deloads.includes(w);
}

function resolveProgramExercise(exercise: WeekTemplateDay["exercises"][number]) {
  const canonical =
    getExercise(exercise.exercise_id) ??
    findExercise(exercise.name) ??
    findExercise(exercise.exercise_id);
  if (!canonical) throw new Error("exercise_not_in_catalog");
  return canonical;
}

function normalizeProgramExercise(
  exercise: WeekTemplateDay["exercises"][number],
  calibration: GenerateProgramInput["beginner_calibration"],
  athleteBodyweightKg: number | null,
): WeekTemplateDay["exercises"][number] {
  const canonical = resolveProgramExercise(exercise);
  // Bodyweight movements progress through cleaner reps, tempo, range of
  // motion, or reduced assistance. Added load is represented by a distinct
  // weighted catalog exercise, never by silently turning a pull-up, push-up,
  // or plank prescription into a kilogram target.
  if (canonical.equipment === "bodyweight") {
    return {
      ...exercise,
      start_weight_kg: null,
      increment_kg: null,
      increment_every_weeks: null,
    };
  }
  if (
    athleteBodyweightKg != null &&
    ["weighted-pull-up", "weighted-chest-dip"].includes(canonical.id) &&
    exercise.start_weight_kg != null &&
    exercise.start_weight_kg >= athleteBodyweightKg
  ) {
    throw new Error("weighted_bodyweight_load_must_be_external");
  }
  if (!calibration?.enabled) return exercise;
  const bodyweightSquat =
    calibration.sex !== "male" &&
    ["back-squat", "high-bar-back-squat", "front-squat"].includes(canonical.id)
      ? getExercise("bodyweight-squat")
      : null;
  const safe = beginnerCalibrationPrescription({
    sex: calibration.sex,
    equipment: bodyweightSquat?.equipment ?? canonical.equipment,
  });
  return {
    ...exercise,
    ...(bodyweightSquat ? { exercise_id: bodyweightSquat.id, name: bodyweightSquat.name_en } : {}),
    start_weight_kg: safe.startWeightKg,
    increment_kg: safe.incrementKg,
    increment_every_weeks: 1,
    notes: [safe.note, exercise.notes?.trim()].filter(Boolean).join(" "),
  };
}

function validateProgramInput(input: GenerateProgramInput) {
  if (!input.name.trim() || input.name.length > 160) throw new Error("invalid_program_name");
  if (!input.goal.trim() || input.goal.length > 2_000) throw new Error("invalid_program_goal");
  if (!input.experience.trim() || input.experience.length > 80) {
    throw new Error("invalid_program_experience");
  }
  if (
    !Number.isInteger(input.session_minutes) ||
    input.session_minutes < 15 ||
    input.session_minutes > 240
  ) {
    throw new Error("invalid_session_minutes");
  }
  if (!input.progression_rules.trim() || input.progression_rules.length > 8_000) {
    throw new Error("invalid_progression_rules");
  }
  if (!input.why.trim() || input.why.length > 8_000) throw new Error("invalid_program_rationale");
  if (input.source_key != null && (!input.source_key.trim() || input.source_key.length > 200)) {
    throw new Error("invalid_program_source_key");
  }
  if (
    input.replace_active_reason != null &&
    (!input.replace_active_reason.trim() || input.replace_active_reason.length > 1_000)
  ) {
    throw new Error("invalid_replacement_reason");
  }
  const uniqueDeloads = new Set(input.deload_weeks);
  if (
    uniqueDeloads.size !== input.deload_weeks.length ||
    input.deload_weeks.some((week) => !Number.isInteger(week) || week < 1 || week > input.weeks)
  ) {
    throw new Error("invalid_deload_weeks");
  }
  if (input.week_template.length < 1 || input.week_template.length > 7) {
    throw new Error("invalid_week_template");
  }
  const scheduleMode = input.schedule_mode ?? "rolling";
  if (scheduleMode !== "rolling" && scheduleMode !== "weekday") {
    throw new Error("invalid_schedule_mode");
  }
  const weekdayIndices = input.weekday_indices ?? [];
  if (
    scheduleMode === "rolling"
      ? weekdayIndices.length > 0
      : new Set(weekdayIndices).size !== input.week_template.length ||
        weekdayIndices.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
  ) {
    throw new Error("invalid_weekday_schedule");
  }
  for (const day of input.week_template) {
    if (!day.title.trim() || day.title.length > 160) throw new Error("invalid_day_title");
    if (day.focus && day.focus.length > 1_000) throw new Error("invalid_day_focus");
    if (day.exercises.length < 1 || day.exercises.length > 30) {
      throw new Error("invalid_exercise_count");
    }
    for (const exercise of day.exercises) {
      resolveProgramExercise(exercise);
      if (!Number.isInteger(exercise.sets) || exercise.sets < 1 || exercise.sets > 30) {
        throw new Error("invalid_exercise_sets");
      }
      if (!exercise.rep_range.trim() || exercise.rep_range.length > 80) {
        throw new Error("invalid_rep_range");
      }
      for (const value of [exercise.start_weight_kg, exercise.increment_kg]) {
        if (value != null && (!Number.isFinite(value) || value < 0 || value > 1_000)) {
          throw new Error("invalid_exercise_weight");
        }
      }
      if (
        exercise.increment_every_weeks != null &&
        (!Number.isInteger(exercise.increment_every_weeks) ||
          exercise.increment_every_weeks < 1 ||
          exercise.increment_every_weeks > 52)
      ) {
        throw new Error("invalid_progression_interval");
      }
      if (exercise.notes && exercise.notes.length > 2_000) {
        throw new Error("invalid_exercise_notes");
      }
    }
  }
}

/**
 * Repair completed-session links and close a cycle only when every workout has
 * an explicit outcome. Reading a program never silently marks workouts skipped.
 */
export async function reconcileProgramLifecycle(userId: string, today: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    await lockProgramMutation(tx, userId);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"program:" + userId}, 0))`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"workout:" + userId}, 0))`,
    );
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
        AND EXISTS (
          SELECT 1
          FROM session_exercises se
          WHERE se.session_id = ws.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM session_exercises se
          LEFT JOIN session_sets ss ON ss.session_exercise_id = se.id
          WHERE se.session_id = ws.id
            AND (
              NOT se.completed
              OR ss.id IS NULL
              OR NOT ss.completed
              OR ss.reps IS NULL
            )
        )
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
  const exerciseRows = dayIds.length
    ? await db
        .select({
          exercise: programExercises,
          catalog_name_en: exerciseCatalog.name_en,
          catalog_name_sv: exerciseCatalog.name_sv,
          image_path: exerciseCatalog.image_path,
        })
        .from(programExercises)
        .leftJoin(exerciseCatalog, eq(exerciseCatalog.id, programExercises.exercise_id))
        .where(inArray(programExercises.program_day_id, dayIds))
        .orderBy(asc(programExercises.position))
    : [];
  const exercises = exerciseRows.map((row) => ({
    ...row.exercise,
    name_en: row.catalog_name_en ?? row.exercise.name,
    name_sv: row.catalog_name_sv ?? row.exercise.name,
    image_path: row.image_path,
  }));
  const byDay = new Map<string, typeof exercises>();
  for (const ex of exercises) {
    const list = byDay.get(ex.program_day_id) ?? [];
    list.push(ex);
    byDay.set(ex.program_day_id, list);
  }
  return {
    ...program,
    deload_weeks: (program.deload_weeks as number[]) ?? [],
    weekday_indices: (program.weekday_indices as number[]) ?? [],
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
    .select({
      exercise: programExercises,
      catalog_name_en: exerciseCatalog.name_en,
      catalog_name_sv: exerciseCatalog.name_sv,
      image_path: exerciseCatalog.image_path,
    })
    .from(programExercises)
    .leftJoin(exerciseCatalog, eq(exerciseCatalog.id, programExercises.exercise_id))
    .where(eq(programExercises.program_day_id, day.id))
    .orderBy(asc(programExercises.position));
  return {
    ...day,
    program_name: program.name,
    program_revision: program.revision,
    schedule_mode: program.schedule_mode,
    exercises: exercises.map((row) => ({
      ...row.exercise,
      name_en: row.catalog_name_en ?? row.exercise.name,
      name_sv: row.catalog_name_sv ?? row.exercise.name,
      image_path: row.image_path,
    })),
  };
}

/** Oldest unresolved day. Overdue work remains authoritative until resolved. */
export async function getNextProgramDay(userId: string, today: string) {
  await reconcileProgramLifecycle(userId, today);
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
  const exerciseRows = await db
    .select({
      exercise: programExercises,
      catalog_name_en: exerciseCatalog.name_en,
      catalog_name_sv: exerciseCatalog.name_sv,
      image_path: exerciseCatalog.image_path,
    })
    .from(programExercises)
    .leftJoin(exerciseCatalog, eq(exerciseCatalog.id, programExercises.exercise_id))
    .where(eq(programExercises.program_day_id, day.id))
    .orderBy(asc(programExercises.position));
  return {
    ...day,
    program_name: program.name,
    program_revision: program.revision,
    schedule_mode: program.schedule_mode,
    exercises: exerciseRows.map((row) => ({
      ...row.exercise,
      name_en: row.catalog_name_en ?? row.exercise.name,
      name_sv: row.catalog_name_sv ?? row.exercise.name,
      image_path: row.image_path,
    })),
  };
}

export async function markProgramDay(
  userId: string,
  dayId: string,
  status: "completed" | "skipped" | "planned",
  sessionId?: string | null,
  resolutionNote?: string | null,
  expectedDataEpoch?: number,
) {
  if (status !== "completed" && (!resolutionNote?.trim() || resolutionNote.trim().length > 500)) {
    return { ok: false as const, error: "resolution_reason_required" };
  }
  const db = getDb();
  return db.transaction(async (tx) => {
    await lockProgramMutation(tx, userId, expectedDataEpoch);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"program:" + userId}, 0))`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"workout:" + userId}, 0))`,
    );
    const [program] = await tx
      .select()
      .from(programs)
      .where(and(eq(programs.user_id, userId), eq(programs.status, "active")))
      .limit(1);
    if (!program) return { ok: false as const, error: "no_active_program" };

    if (status !== "completed") {
      const linkedSessions = await tx
        .select({ id: workoutSessions.id, status: workoutSessions.status })
        .from(workoutSessions)
        .where(and(eq(workoutSessions.user_id, userId), eq(workoutSessions.program_day_id, dayId)));
      if (linkedSessions.some((session) => session.status === "active")) {
        return { ok: false as const, error: "program_day_has_active_session" };
      }
      if (linkedSessions.some((session) => session.status === "completed")) {
        return { ok: false as const, error: "program_day_has_completed_session" };
      }
    }

    if (status === "completed") {
      if (!sessionId) return { ok: false as const, error: "completed_day_requires_session" };
      const [ownedCompletedSession] = await tx
        .select({ id: workoutSessions.id })
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.id, sessionId),
            eq(workoutSessions.user_id, userId),
            eq(workoutSessions.program_day_id, dayId),
            eq(workoutSessions.status, "completed"),
            sql`EXISTS (
              SELECT 1 FROM session_exercises se
              WHERE se.session_id = ${workoutSessions.id}
            )`,
            sql`NOT EXISTS (
              SELECT 1
              FROM session_exercises se
              LEFT JOIN session_sets ss ON ss.session_exercise_id = se.id
              WHERE se.session_id = ${workoutSessions.id}
                AND (
                  NOT se.completed
                  OR ss.id IS NULL
                  OR NOT ss.completed
                  OR ss.reps IS NULL
                )
            )`,
          ),
        )
        .limit(1);
      if (!ownedCompletedSession) {
        return { ok: false as const, error: "completed_session_not_found" };
      }
    }

    const [updated] = await tx
      .update(programDays)
      .set({
        status,
        ...(sessionId !== undefined ? { session_id: sessionId } : {}),
        resolution_note:
          status === "completed"
            ? null
            : resolutionNote !== undefined
              ? (resolutionNote?.trim() ?? null)
              : null,
      })
      .where(and(eq(programDays.id, dayId), eq(programDays.program_id, program.id)))
      .returning({ id: programDays.id });
    if (!updated) return { ok: false as const, error: "program_day_not_found" };
    await tx
      .update(programs)
      .set({ revision: sql`${programs.revision} + 1` })
      .where(eq(programs.id, program.id));

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
  opts: {
    date: string;
    day_id?: string;
    status: "skipped" | "planned";
    reason: string;
    source_key: string;
    auto_recover_progression?: boolean;
    expected_program_revision?: number;
    expected_data_epoch?: number;
  },
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) {
    return { ok: false as const, error: "invalid_program_day_date" };
  }
  try {
    addIsoDays(opts.date, 0);
  } catch {
    return { ok: false as const, error: "invalid_program_day_date" };
  }
  const reason = opts.reason.trim();
  if (!reason || reason.length > 500) {
    return { ok: false as const, error: "invalid_resolution_reason" };
  }
  if (!validOperationSourceKey(opts.source_key)) {
    return { ok: false as const, error: "invalid_source_key" };
  }
  const sourceKey = opts.source_key.trim();
  const payloadHash = operationPayloadHash("resolve_day", {
    date: opts.date,
    day_id: opts.day_id ?? null,
    status: opts.status,
    reason,
    auto_recover_progression: opts.auto_recover_progression === true,
  });
  const db = getDb();
  return db.transaction(async (tx) => {
    await lockProgramMutation(tx, userId, opts.expected_data_epoch);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"program:" + userId}, 0))`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"workout:" + userId}, 0))`,
    );
    const [prior] = await tx
      .select({
        operation: programOperations.operation,
        payload_hash: programOperations.payload_hash,
        result: programOperations.result,
      })
      .from(programOperations)
      .where(
        and(eq(programOperations.user_id, userId), eq(programOperations.source_key, sourceKey)),
      )
      .limit(1);
    if (prior) {
      if (prior.operation !== "resolve_day" || prior.payload_hash !== payloadHash) {
        return { ok: false as const, error: "idempotency_key_reused" };
      }
      return {
        ...(prior.result as Record<string, unknown>),
        idempotent_replay: true,
      };
    }
    const finish = async <T extends Record<string, unknown>>(result: T) => {
      await tx.insert(programOperations).values({
        user_id: userId,
        source_key: sourceKey,
        operation: "resolve_day",
        payload_hash: payloadHash,
        result,
      });
      return result;
    };
    let [program] = await tx
      .select()
      .from(programs)
      .where(and(eq(programs.user_id, userId), eq(programs.status, "active")))
      .orderBy(desc(programs.created_at), desc(programs.id))
      .limit(1);
    let reactivatingLatestCompletedCycle = false;
    if (!program && opts.status === "planned") {
      // A correction can arrive immediately after skipping the final planned
      // day closed the cycle. Only inspect the single most recently completed
      // cycle; never search history by date and accidentally reopen an older
      // cycle that happens to contain the same calendar day.
      [program] = await tx
        .select()
        .from(programs)
        .where(and(eq(programs.user_id, userId), eq(programs.status, "completed")))
        .orderBy(
          sql`${programs.completed_at} DESC NULLS LAST`,
          desc(programs.created_at),
          desc(programs.id),
        )
        .limit(1);
      reactivatingLatestCompletedCycle = Boolean(program);
    }
    if (!program) return finish({ ok: false as const, error: "no_active_program" });
    if (
      opts.expected_program_revision != null &&
      program.revision !== opts.expected_program_revision
    ) {
      return finish({
        ok: false as const,
        error: "program_revision_conflict",
        expected_revision: opts.expected_program_revision,
        current_revision: program.revision,
      });
    }
    const [day] = await tx
      .select({
        id: programDays.id,
        week: programDays.week,
        day_index: programDays.day_index,
        title: programDays.title,
        status: programDays.status,
      })
      .from(programDays)
      .where(
        and(
          eq(programDays.program_id, program.id),
          eq(programDays.date, opts.date),
          ...(opts.day_id ? [eq(programDays.id, opts.day_id)] : []),
        ),
      )
      .limit(1);
    if (!day) return finish({ ok: false as const, error: "program_day_not_found" });
    if (day.status === "completed") {
      return finish({ ok: false as const, error: "completed_day_is_immutable" });
    }
    if (reactivatingLatestCompletedCycle && day.status !== "skipped") {
      return finish({ ok: false as const, error: "program_day_not_reopenable" });
    }
    const linkedSessions = await tx
      .select({ status: workoutSessions.status })
      .from(workoutSessions)
      .where(and(eq(workoutSessions.user_id, userId), eq(workoutSessions.program_day_id, day.id)));
    if (linkedSessions.some((session) => session.status === "active")) {
      return finish({ ok: false as const, error: "program_day_has_active_session" });
    }
    if (linkedSessions.some((session) => session.status === "completed")) {
      return finish({ ok: false as const, error: "program_day_has_completed_session" });
    }
    await tx
      .update(programDays)
      .set({ status: opts.status, session_id: null, resolution_note: reason })
      .where(eq(programDays.id, day.id));

    const recoveryChanges: Array<{
      program_day_id: string;
      date: string;
      exercise_id: string | null;
      exercise_name: string;
      before_kg: number;
      after_kg: number;
      progression_step_kg: number;
    }> = [];
    if (opts.status === "skipped" && opts.auto_recover_progression) {
      const futurePrescriptions = await tx
        .select({
          id: programExercises.id,
          program_day_id: programDays.id,
          date: programDays.date,
          exercise_id: programExercises.exercise_id,
          exercise_name: programExercises.name,
          target_weight_kg: programExercises.target_weight_kg,
          progression_step_kg: programExercises.progression_step_kg,
        })
        .from(programExercises)
        .innerJoin(programDays, eq(programDays.id, programExercises.program_day_id))
        .where(
          and(
            eq(programDays.program_id, program.id),
            eq(programDays.status, "planned"),
            eq(programDays.day_index, day.day_index),
            sql`${programDays.date} > ${opts.date}`,
            sql`${programExercises.target_weight_kg} IS NOT NULL`,
            sql`${programExercises.progression_step_kg} > 0`,
          ),
        )
        .orderBy(asc(programDays.date), asc(programExercises.position));

      for (const prescription of futurePrescriptions) {
        const before = prescription.target_weight_kg;
        const step = prescription.progression_step_kg;
        if (before == null || step == null || step <= 0) continue;
        const after = Math.max(0, Math.round((before - step) * 100) / 100);
        if (after === before) continue;
        await tx
          .update(programExercises)
          .set({ target_weight_kg: after })
          .where(eq(programExercises.id, prescription.id));
        recoveryChanges.push({
          program_day_id: prescription.program_day_id,
          date: prescription.date,
          exercise_id: prescription.exercise_id,
          exercise_name: prescription.exercise_name,
          before_kg: before,
          after_kg: after,
          progression_step_kg: step,
        });
      }
    }

    await tx
      .update(programs)
      .set({ revision: sql`${programs.revision} + 1` })
      .where(eq(programs.id, program.id));
    const statuses = await tx
      .select({ status: programDays.status })
      .from(programDays)
      .where(eq(programDays.program_id, program.id));
    const cycleCompleted = statuses.length > 0 && statuses.every((row) => row.status !== "planned");
    if (cycleCompleted) {
      await tx
        .update(programs)
        .set({ status: "completed", completed_at: new Date().toISOString() })
        .where(and(eq(programs.id, program.id), eq(programs.status, "active")));
    } else if (reactivatingLatestCompletedCycle) {
      const [reactivated] = await tx
        .update(programs)
        .set({ status: "active", completed_at: null })
        .where(and(eq(programs.id, program.id), eq(programs.status, "completed")))
        .returning({ id: programs.id });
      if (!reactivated) {
        throw new Error("program_reactivation_conflict");
      }
    }
    return finish({
      ok: true as const,
      cycle_completed: cycleCompleted,
      program_name: program.name,
      date: opts.date,
      title: day.title,
      status: opts.status,
      reason,
      recovery:
        opts.status === "skipped" && opts.auto_recover_progression
          ? {
              kind: recoveryChanges.length > 0 ? ("hold_progression" as const) : ("none" as const),
              scope: "matching_weekly_session" as const,
              day_index: day.day_index,
              affected_days: new Set(recoveryChanges.map((change) => change.program_day_id)).size,
              affected_exercises: recoveryChanges.length,
              changes: recoveryChanges,
            }
          : null,
    });
  });
}

async function reviseActiveSessionExercise(
  tx: AccountMutationTransaction,
  opts: {
    userId: string;
    programId: string;
    canonicalExerciseId: string | null;
    exerciseNeedle: string;
    fromWeek: number;
    replacement: NonNullable<ReturnType<typeof getExercise>> | null;
    weightOperation: boolean;
    deltaKg: number | null;
    setWeightKg: number | null;
    clearWeight: boolean;
    sets: number | null;
    repRange: string | null;
    notes: string | null | undefined;
  },
): Promise<boolean> {
  const [active] = await tx
    .select({ id: workoutSessions.id, program_day_id: workoutSessions.program_day_id })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.user_id, opts.userId), eq(workoutSessions.status, "active")))
    .limit(1);
  if (!active?.program_day_id) return false;
  const [ownedDay] = await tx
    .select({ id: programDays.id, week: programDays.week })
    .from(programDays)
    .where(
      and(eq(programDays.id, active.program_day_id), eq(programDays.program_id, opts.programId)),
    )
    .limit(1);
  if (!ownedDay) return false;
  if (ownedDay.week < opts.fromWeek) return false;

  const activeExercises = await tx
    .select()
    .from(sessionExercises)
    .where(eq(sessionExercises.session_id, active.id))
    .orderBy(asc(sessionExercises.position));
  const activeExercise = activeExercises.find((exercise) => {
    if (opts.canonicalExerciseId && exercise.exercise_id === opts.canonicalExerciseId) return true;
    const resolved = getExercise(exercise.exercise_id) ?? findExercise(exercise.name);
    if (opts.canonicalExerciseId && resolved?.id === opts.canonicalExerciseId) return true;
    return exercise.name.trim().toLowerCase() === opts.exerciseNeedle;
  });
  if (!activeExercise || activeExercise.completed) return false;

  const existingSets = await tx
    .select()
    .from(sessionSets)
    .where(eq(sessionSets.session_exercise_id, activeExercise.id))
    .orderBy(asc(sessionSets.set_index));
  const completedSets = existingSets.filter((set) => set.completed);
  const currentTargetWeight =
    existingSets.find((set) => !set.completed)?.target_weight_kg ??
    existingSets[0]?.target_weight_kg ??
    null;
  const nextWeight = opts.weightOperation
    ? opts.clearWeight
      ? null
      : opts.setWeightKg != null
        ? opts.setWeightKg
        : currentTargetWeight == null
          ? null
          : calculateTargetWeight({
              startWeightKg: currentTargetWeight + (opts.deltaKg ?? 0),
              incrementKg: 0,
              incrementEveryWeeks: 1,
              completedTrainingWeeks: 0,
              isDeload: false,
            })
    : currentTargetWeight;
  const requestedSetCount = opts.sets ?? activeExercise.planned_set_count;
  const nextSetCount =
    opts.replacement && completedSets.length > 0
      ? requestedSetCount
      : Math.max(completedSets.length, requestedSetCount);
  const nextRepRange =
    opts.repRange ?? existingSets.find((set) => !set.completed)?.target_reps ?? null;
  const targetText = `${nextSetCount}×${nextRepRange ?? "reps"}${nextWeight != null ? ` @ ${nextWeight}kg` : ""}`;

  if (opts.replacement && completedSets.length > 0) {
    await tx
      .delete(sessionSets)
      .where(
        and(
          eq(sessionSets.session_exercise_id, activeExercise.id),
          eq(sessionSets.completed, false),
        ),
      );
    await tx
      .update(sessionExercises)
      .set({
        planned_set_count: completedSets.length,
        completed: true,
        completed_at: new Date().toISOString(),
      })
      .where(eq(sessionExercises.id, activeExercise.id));
    const maxPosition =
      activeExercises.reduce((highest, exercise) => Math.max(highest, exercise.position), -1) + 1;
    const [replacementRow] = await tx
      .insert(sessionExercises)
      .values({
        session_id: active.id,
        position: maxPosition,
        exercise_id: opts.replacement.id,
        name: opts.replacement.name_en,
        target: targetText,
        planned_set_count: nextSetCount,
        notes: opts.notes?.trim() || null,
      })
      .returning({ id: sessionExercises.id });
    if (!replacementRow) throw new Error("Failed to add replacement exercise");
    await tx.insert(sessionSets).values(
      Array.from({ length: nextSetCount }, (_, index) => ({
        session_exercise_id: replacementRow.id,
        set_index: index + 1,
        target_reps: nextRepRange,
        target_weight_kg: nextWeight,
      })),
    );
    return true;
  }

  await tx
    .update(sessionExercises)
    .set({
      ...(opts.replacement
        ? { exercise_id: opts.replacement.id, name: opts.replacement.name_en }
        : {}),
      target: targetText,
      planned_set_count: nextSetCount,
      ...(opts.notes !== undefined ? { notes: opts.notes?.trim() || null } : {}),
    })
    .where(eq(sessionExercises.id, activeExercise.id));
  await tx
    .delete(sessionSets)
    .where(
      and(eq(sessionSets.session_exercise_id, activeExercise.id), eq(sessionSets.completed, false)),
    );
  const completedIndices = new Set(completedSets.map((set) => set.set_index));
  const pendingRows = Array.from({ length: nextSetCount }, (_, index) => index + 1)
    .filter((setIndex) => !completedIndices.has(setIndex))
    .map((setIndex) => ({
      session_exercise_id: activeExercise.id,
      set_index: setIndex,
      target_reps: nextRepRange,
      target_weight_kg: nextWeight,
    }));
  if (pendingRows.length) await tx.insert(sessionSets).values(pendingRows);
  return true;
}

/** Adjust or replace an exercise from a given week onward, including an active session. */
export async function adjustProgramExercise(
  userId: string,
  opts: {
    exercise: string;
    from_week: number;
    delta_kg?: number | null;
    set_weight_kg?: number | null;
    clear_weight?: boolean;
    replacement_exercise?: string | null;
    sets?: number | null;
    rep_range?: string | null;
    notes?: string | null;
    source_key: string;
    expected_data_epoch?: number;
  },
) {
  const needle = opts.exercise.trim().toLowerCase();
  if (!needle || needle.length > 160) {
    return { ok: false as const, error: "invalid_exercise" };
  }
  if (!Number.isInteger(opts.from_week) || opts.from_week < 1 || opts.from_week > 104) {
    return { ok: false as const, error: "invalid_from_week" };
  }
  const weightOperations = [
    opts.delta_kg != null,
    opts.set_weight_kg != null,
    opts.clear_weight === true,
  ].filter(Boolean).length;
  if (weightOperations > 1) {
    return { ok: false as const, error: "choose_one_weight_adjustment" };
  }
  if (
    weightOperations === 0 &&
    opts.replacement_exercise == null &&
    opts.sets == null &&
    opts.rep_range == null &&
    opts.notes === undefined
  ) {
    return { ok: false as const, error: "no_adjustment_requested" };
  }
  for (const value of [opts.delta_kg, opts.set_weight_kg]) {
    if (value != null && (!Number.isFinite(value) || value < -1_000 || value > 1_000)) {
      return { ok: false as const, error: "invalid_weight_adjustment" };
    }
  }
  if (!validOperationSourceKey(opts.source_key)) {
    return { ok: false as const, error: "invalid_source_key" };
  }
  if (opts.sets != null && (!Number.isInteger(opts.sets) || opts.sets < 1 || opts.sets > 30)) {
    return { ok: false as const, error: "invalid_exercise_sets" };
  }
  if (opts.rep_range != null && (!opts.rep_range.trim() || opts.rep_range.trim().length > 80)) {
    return { ok: false as const, error: "invalid_rep_range" };
  }
  if (opts.notes != null && opts.notes.trim().length > 2_000) {
    return { ok: false as const, error: "invalid_exercise_notes" };
  }
  const canonical = getExercise(opts.exercise) ?? findExercise(opts.exercise);
  const replacement =
    opts.replacement_exercise == null
      ? null
      : (getExercise(opts.replacement_exercise) ?? findExercise(opts.replacement_exercise));
  if (opts.replacement_exercise != null && !replacement) {
    return { ok: false as const, error: "replacement_exercise_not_found" };
  }
  const sourceKey = opts.source_key.trim();
  const payloadHash = operationPayloadHash("adjust_program", {
    exercise: canonical?.id ?? needle,
    from_week: opts.from_week,
    delta_kg: opts.delta_kg ?? null,
    set_weight_kg: opts.set_weight_kg ?? null,
    clear_weight: opts.clear_weight === true,
    replacement_exercise: replacement?.id ?? null,
    sets: opts.sets ?? null,
    rep_range: opts.rep_range?.trim() ?? null,
    notes: opts.notes === undefined ? "__unchanged__" : (opts.notes?.trim() ?? null),
  });
  const db = getDb();
  return db.transaction(async (tx) => {
    await lockProgramMutation(tx, userId, opts.expected_data_epoch);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"program:" + userId}, 0))`,
    );
    const [prior] = await tx
      .select({
        operation: programOperations.operation,
        payload_hash: programOperations.payload_hash,
        result: programOperations.result,
      })
      .from(programOperations)
      .where(
        and(eq(programOperations.user_id, userId), eq(programOperations.source_key, sourceKey)),
      )
      .limit(1);
    if (prior) {
      if (prior.operation !== "adjust_program" || prior.payload_hash !== payloadHash) {
        return { ok: false as const, error: "idempotency_key_reused" };
      }
      return {
        ...(prior.result as Record<string, unknown>),
        idempotent_replay: true,
      };
    }
    const finish = async <T extends Record<string, unknown>>(result: T) => {
      await tx.insert(programOperations).values({
        user_id: userId,
        source_key: sourceKey,
        operation: "adjust_program",
        payload_hash: payloadHash,
        result,
      });
      return result;
    };
    const [program] = await tx
      .select()
      .from(programs)
      .where(and(eq(programs.user_id, userId), eq(programs.status, "active")))
      .limit(1);
    if (!program) return finish({ ok: false as const, error: "no_active_program" });
    const days = await tx
      .select({ id: programDays.id })
      .from(programDays)
      .where(
        and(
          eq(programDays.program_id, program.id),
          eq(programDays.status, "planned"),
          sql`${programDays.week} >= ${opts.from_week}`,
        ),
      );
    if (!days.length) return finish({ ok: false as const, error: "no_matching_weeks" });
    const rows = await tx
      .select()
      .from(programExercises)
      .where(
        inArray(
          programExercises.program_day_id,
          days.map((day) => day.id),
        ),
      );
    let matches = canonical
      ? rows.filter(
          (row) => row.exercise_id === canonical.id || findExercise(row.name)?.id === canonical.id,
        )
      : [];
    if (!canonical) {
      const names = [...new Set(rows.map((row) => row.name.trim().toLowerCase()))];
      const exactName = names.find((name) => name === needle);
      const candidateNames = exactName
        ? [exactName]
        : names.filter((name) => name.includes(needle));
      if (candidateNames.length > 1) {
        return finish({
          ok: false as const,
          error: "exercise_ambiguous",
          candidates: candidateNames.slice(0, 10),
        });
      }
      matches = candidateNames.length
        ? rows.filter((row) => row.name.trim().toLowerCase() === candidateNames[0])
        : [];
    }
    if (!matches.length) {
      return finish({ ok: false as const, error: "exercise_not_found" });
    }
    for (const match of matches) {
      const raw =
        opts.clear_weight === true
          ? null
          : opts.set_weight_kg != null
            ? opts.set_weight_kg
            : match.target_weight_kg != null
              ? match.target_weight_kg + (opts.delta_kg ?? 0)
              : null;
      const next =
        weightOperations === 0
          ? replacement
            ? null
            : match.target_weight_kg
          : raw == null
            ? null
            : calculateTargetWeight({
                startWeightKg: raw,
                incrementKg: 0,
                incrementEveryWeeks: 1,
                completedTrainingWeeks: 0,
                isDeload: false,
              });
      await tx
        .update(programExercises)
        .set({
          ...(weightOperations > 0 || replacement ? { target_weight_kg: next } : {}),
          ...(opts.clear_weight === true || replacement?.equipment === "bodyweight"
            ? { progression_step_kg: null }
            : {}),
          ...(replacement ? { exercise_id: replacement.id, name: replacement.name_en } : {}),
          ...(opts.sets != null ? { sets: opts.sets } : {}),
          ...(opts.rep_range != null ? { rep_range: opts.rep_range.trim() } : {}),
          ...(opts.notes !== undefined ? { notes: opts.notes?.trim() || null } : {}),
        })
        .where(eq(programExercises.id, match.id));
    }
    const activeSessionUpdated = await reviseActiveSessionExercise(tx, {
      userId,
      programId: program.id,
      canonicalExerciseId: canonical?.id ?? null,
      exerciseNeedle: needle,
      fromWeek: opts.from_week,
      replacement,
      weightOperation: weightOperations > 0 || replacement != null,
      deltaKg: opts.delta_kg ?? null,
      setWeightKg: opts.set_weight_kg ?? null,
      clearWeight: opts.clear_weight === true || (replacement != null && weightOperations === 0),
      sets: opts.sets ?? null,
      repRange: opts.rep_range?.trim() ?? null,
      notes: opts.notes,
    });
    const [updatedProgram] = await tx
      .update(programs)
      .set({ revision: sql`${programs.revision} + 1` })
      .where(eq(programs.id, program.id))
      .returning({ revision: programs.revision });
    return finish({
      ok: true as const,
      updated: matches.length,
      active_session_updated: activeSessionUpdated,
      program_revision: updatedProgram?.revision ?? program.revision + 1,
    });
  });
}

/**
 * Shift every unresolved day on/after a date while preserving completed
 * history and stable day IDs. Useful for illness, travel, or rolling schedules.
 */
export async function shiftProgramSchedule(
  userId: string,
  opts: {
    from_date: string;
    days: number;
    reason: string;
    source_key: string;
    expected_data_epoch?: number;
  },
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.from_date)) {
    return { ok: false as const, error: "invalid_shift_date" };
  }
  try {
    addIsoDays(opts.from_date, 0);
  } catch {
    return { ok: false as const, error: "invalid_shift_date" };
  }
  if (!Number.isInteger(opts.days) || opts.days === 0 || opts.days < -365 || opts.days > 365) {
    return { ok: false as const, error: "invalid_shift_days" };
  }
  const reason = opts.reason.trim();
  if (!reason || reason.length > 500) {
    return { ok: false as const, error: "invalid_shift_reason" };
  }
  if (!validOperationSourceKey(opts.source_key)) {
    return { ok: false as const, error: "invalid_source_key" };
  }
  const sourceKey = opts.source_key.trim();
  const payloadHash = operationPayloadHash("shift_schedule", {
    from_date: opts.from_date,
    days: opts.days,
    reason,
  });
  const db = getDb();
  return db.transaction(async (tx) => {
    await lockProgramMutation(tx, userId, opts.expected_data_epoch);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"program:" + userId}, 0))`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"workout:" + userId}, 0))`,
    );
    const [prior] = await tx
      .select({
        operation: programOperations.operation,
        payload_hash: programOperations.payload_hash,
        result: programOperations.result,
      })
      .from(programOperations)
      .where(
        and(eq(programOperations.user_id, userId), eq(programOperations.source_key, sourceKey)),
      )
      .limit(1);
    if (prior) {
      if (prior.operation !== "shift_schedule" || prior.payload_hash !== payloadHash) {
        return { ok: false as const, error: "idempotency_key_reused" };
      }
      return {
        ...(prior.result as Record<string, unknown>),
        idempotent_replay: true,
      };
    }
    const finish = async <T extends Record<string, unknown>>(result: T) => {
      await tx.insert(programOperations).values({
        user_id: userId,
        source_key: sourceKey,
        operation: "shift_schedule",
        payload_hash: payloadHash,
        result,
      });
      return result;
    };
    const [program] = await tx
      .select()
      .from(programs)
      .where(and(eq(programs.user_id, userId), eq(programs.status, "active")))
      .limit(1);
    if (!program) return finish({ ok: false as const, error: "no_active_program" });
    const [activeSession] = await tx
      .select({ id: workoutSessions.id })
      .from(workoutSessions)
      .where(and(eq(workoutSessions.user_id, userId), eq(workoutSessions.status, "active")))
      .limit(1);
    if (activeSession) {
      return finish({ ok: false as const, error: "active_workout_in_progress" });
    }
    const days = await tx
      .select({ id: programDays.id, date: programDays.date })
      .from(programDays)
      .where(
        and(
          eq(programDays.program_id, program.id),
          eq(programDays.status, "planned"),
          sql`${programDays.date} >= ${opts.from_date}`,
        ),
      )
      .orderBy(opts.days > 0 ? desc(programDays.date) : asc(programDays.date));
    if (!days.length) return finish({ ok: false as const, error: "no_days_to_shift" });
    const movingIds = new Set(days.map((day) => day.id));
    const targetDates = new Set(days.map((day) => addIsoDays(day.date, opts.days)));
    const reserved = await tx
      .select({ id: programDays.id, date: programDays.date })
      .from(programDays)
      .where(eq(programDays.program_id, program.id));
    if (reserved.some((day) => !movingIds.has(day.id) && targetDates.has(day.date))) {
      return finish({ ok: false as const, error: "schedule_shift_collision" });
    }
    // Descending order avoids transient collisions with the program/date unique index.
    for (const day of days) {
      await tx
        .update(programDays)
        .set({
          date: addIsoDays(day.date, opts.days),
          resolution_note: `Schedule shifted ${opts.days > 0 ? "+" : ""}${opts.days} day(s): ${reason}`,
        })
        .where(eq(programDays.id, day.id));
    }
    const [latest] = await tx
      .select({ date: programDays.date })
      .from(programDays)
      .where(eq(programDays.program_id, program.id))
      .orderBy(desc(programDays.date))
      .limit(1);
    const [earliest] = await tx
      .select({ date: programDays.date })
      .from(programDays)
      .where(eq(programDays.program_id, program.id))
      .orderBy(asc(programDays.date))
      .limit(1);
    if (latest && earliest) {
      await tx
        .update(programs)
        .set({
          start_date: earliest.date,
          end_date: latest.date,
          revision: sql`${programs.revision} + 1`,
          weekday_indices:
            program.schedule_mode === "weekday"
              ? shiftWeekdayIndices((program.weekday_indices as number[]) ?? [], opts.days)
              : [],
        })
        .where(eq(programs.id, program.id));
    }
    return finish({
      ok: true as const,
      shifted: days.length,
      days: opts.days,
      new_start_date: earliest?.date ?? program.start_date,
      new_end_date: latest?.date ?? program.end_date,
    });
  });
}

export async function listProgramCycles(userId: string, limit = 20) {
  const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
  return getDb()
    .select()
    .from(programs)
    .where(eq(programs.user_id, userId))
    .orderBy(desc(programs.created_at))
    .limit(safeLimit);
}

/** Compact program summary for the coach context. */
export function summarizeProgram(
  p: Awaited<ReturnType<typeof getCurrentProgram>>,
  today: string,
  language: AppLanguage = "en",
): string {
  if (!p) {
    return language === "sv"
      ? "(inget strukturerat program ännu — bygg ett med generate_program)"
      : "(no structured program yet — build one with generate_program)";
  }
  const done = p.days.filter((d) => d.status === "completed").length;
  const skipped = p.days.filter((d) => d.status === "skipped").length;
  const overdue = p.days.filter((d) => d.status === "planned" && d.date < today);
  const upcoming = p.days.filter((d) => d.status === "planned" && d.date >= today).slice(0, 3);
  const skippedDetails = p.days
    .filter((d) => d.status === "skipped")
    .slice(-5)
    .map(
      (d) =>
        `  - ${d.date}, ${language === "sv" ? "v" : "wk"} ${d.week} ${
          language === "sv" ? "Dag" : "Day"
        } ${d.day_index} ${d.title} — ${
          d.resolution_note ||
          (language === "sv" ? "ingen orsak angiven av användaren" : "no reason provided by user")
        }`,
    )
    .join("\n");
  const overdueDetails = overdue
    .slice(0, 5)
    .map(
      (d) =>
        `  - ${d.date}, ${language === "sv" ? "v" : "wk"} ${d.week} ${
          language === "sv" ? "Dag" : "Day"
        } ${d.day_index} ${d.title}`,
    )
    .join("\n");
  const rolling = p.schedule_mode === "rolling";
  const up = upcoming
    .map(
      (d) =>
        `  - ${
          rolling ? `${language === "sv" ? "Dag" : "Day"} ${d.day_index}` : d.date
        } (${language === "sv" ? "v" : "wk"} ${d.week}) ${d.title}${
          d.is_deload ? (language === "sv" ? " [återhämtning]" : " [deload]") : ""
        }`,
    )
    .join("\n");
  if (p.status === "completed") {
    if (language === "sv") {
      return `"${p.name}" — SLUTFÖRT (${done} pass, ${skipped} överhoppade)${
        rolling ? "" : `, ${p.start_date} → ${p.end_date}`
      }.
Sparade orsaker till överhoppade pass:
${skippedDetails || "  (inga)"}
${summarizeAttendancePattern(p.days, language)}
Programperioden är stängd och sparad. Granska resultaten och erbjud sedan nästa programperiod.`;
    }
    return `"${p.name}" — COMPLETED (${done} workouts, ${skipped} skipped)${
      rolling ? "" : `, ${p.start_date} → ${p.end_date}`
    }.
Recorded skip reasons:
${skippedDetails || "  (none)"}
${summarizeAttendancePattern(p.days, language)}
The cycle is closed and preserved. Review the results, then offer to build the next program cycle.`;
  }
  if (language === "sv") {
    return `"${p.name}" — AKTIVT, ${p.weeks} veckor, ${p.days_per_week} ggr/vecka${
      rolling ? ", rullande Dag 1..N" : `, ${p.start_date} → ${p.end_date}`
    }
Förlopp: ${done} klara, ${skipped} överhoppade, ${p.days.length - done - skipped} återstår (i dag: ${today})
Försenade pass som kräver ett uttryckligt beslut om slutfört/överhoppat: ${overdue.length}
${overdueDetails || "  (inga)"}
Sparade orsaker till överhoppade pass:
${skippedDetails || "  (inga)"}
${summarizeAttendancePattern(p.days, language)}
Närmast:
${up || "  (inget schemalagt — granska försenade pass eller avsluta programperioden)"}`;
  }
  return `"${p.name}" — ACTIVE, ${p.weeks} wks, ${p.days_per_week}x/wk${
    rolling ? ", rolling Day 1..N" : `, ${p.start_date} → ${p.end_date}`
  }
Progress: ${done} done, ${skipped} skipped, ${p.days.length - done - skipped} remaining (today: ${today})
Overdue workouts needing an explicit completed/skipped decision: ${overdue.length}
${overdueDetails || "  (none)"}
Recorded skip reasons:
${skippedDetails || "  (none)"}
${summarizeAttendancePattern(p.days, language)}
Next up:
${up || "  (none scheduled — review overdue workouts or close the cycle)"}`;
}
