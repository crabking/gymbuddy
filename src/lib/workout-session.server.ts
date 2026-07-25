import { createHash } from "node:crypto";
import { and, eq, asc, desc, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import {
  exerciseCatalog,
  workoutSessions,
  sessionExercises,
  sessionSets,
  programDays,
  programExercises,
  programOperations,
  programs,
} from "@/db/schema";
import {
  exerciseName,
  findExercise,
  getExercise,
  type AppLanguage,
  type ExerciseId,
} from "@/lib/exercises";
import {
  acquireAccountMutationLock,
  requireExpectedDataEpoch,
  type AccountMutationTransaction,
} from "@/lib/account-epoch.server";
import { addIsoDays, getSessionCompletionIssues } from "@/lib/training-logic";

async function lockWorkoutMutation(
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

export type SessionSet = {
  id: string;
  set_index: number;
  target_reps: string | null;
  target_weight_kg: number | null;
  weight_kg: number | null;
  reps: number | null;
  completed: boolean;
  completed_at: string | null;
  revision: number;
};
export type SessionExercise = {
  id: string;
  position: number;
  exercise_id: string | null;
  name: string;
  name_en: string;
  name_sv: string;
  image_path: string | null;
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

  const rawRows = await db
    .select({
      exercise: sessionExercises,
      catalog_name_en: exerciseCatalog.name_en,
      catalog_name_sv: exerciseCatalog.name_sv,
      image_path: exerciseCatalog.image_path,
    })
    .from(sessionExercises)
    .leftJoin(exerciseCatalog, eq(exerciseCatalog.id, sessionExercises.exercise_id))
    .where(eq(sessionExercises.session_id, session.id))
    .orderBy(asc(sessionExercises.position));
  const rows = rawRows.map((row) => ({
    ...row.exercise,
    name_en: row.catalog_name_en ?? row.exercise.name,
    name_sv: row.catalog_name_sv ?? row.exercise.name,
    image_path: row.image_path,
  }));

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
      target_weight_kg: s.target_weight_kg,
      weight_kg: s.weight_kg,
      reps: s.reps,
      completed: s.completed,
      completed_at: s.completed_at,
      revision: s.revision,
    });
    setsByEx.set(s.session_exercise_id, list);
  }

  const exercises: SessionExercise[] = rows.map((r) => ({
    id: r.id,
    position: r.position,
    exercise_id: r.exercise_id,
    name: r.name,
    name_en: r.name_en,
    name_sv: r.name_sv,
    image_path: r.image_path,
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

export type StartResult =
  | { ok: true; session: ActiveSession; resumed: boolean; idempotent_replay?: boolean }
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
    programDayId?: string | null;
    program_day_id?: string | null;
    source_key?: string | null;
    title?: string | null;
    exercises?: Array<{
      exercise_id?: ExerciseId | string | null;
      name?: string | null;
      target?: string | null;
      sets?: number | null;
      rep_range?: string | null;
      weight_kg?: number | null;
    }>;
    override_reason?: string | null;
    expected_data_epoch?: number;
  },
): Promise<StartResult> {
  try {
    addIsoDays(opts.date, 0);
  } catch {
    return {
      ok: false,
      error: "invalid_session_date",
      coach_note: "The workout date is invalid. Refresh the app and try again.",
    };
  }
  const db = getDb();
  const date = opts.date;
  const sourceKey = opts.source_key?.trim() || null;
  if (opts.source_key != null && (!opts.source_key.trim() || opts.source_key.length > 200)) {
    return {
      ok: false,
      error: "invalid_source_key",
      coach_note: "The workout request identifier is invalid.",
    };
  }
  if (opts.title != null && opts.title.trim().length > 160) {
    return {
      ok: false,
      error: "invalid_session_title",
      coach_note: "The workout title is too long.",
    };
  }
  const requestedProgramDayId = opts.programDayId ?? opts.program_day_id ?? null;
  const validationError = validateAdHocExercises(opts.exercises);
  if (validationError) {
    return { ok: false, error: validationError, coach_note: "The workout details are invalid." };
  }
  const payloadHash = operationPayloadHash("start_session", {
    date,
    program_day_id: requestedProgramDayId,
    title: opts.title?.trim() || null,
    exercises:
      opts.exercises?.map((exercise) => {
        const canonical = resolveSessionExercise(exercise);
        return {
          exercise_id: canonical.id,
          name: canonical.name_en,
          target: exercise.target?.trim() || null,
          sets: exercise.sets ?? null,
          rep_range: exercise.rep_range?.trim() || null,
          weight_kg: exercise.weight_kg ?? null,
        };
      }) ?? null,
    override_reason: opts.override_reason?.trim() || null,
  });

  const created = await db.transaction(async (tx) => {
    await lockWorkoutMutation(tx, userId, opts.expected_data_epoch);
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
        if (prior.operation !== "start_session" || prior.payload_hash !== payloadHash) {
          return {
            ok: false as const,
            error: "idempotency_key_reused",
            coach_note:
              "That workout-start request was already used with different details. Refresh before trying again.",
          };
        }
        const stored = prior.result as { session_id?: unknown; resumed?: unknown };
        if (typeof stored.session_id !== "string" || typeof stored.resumed !== "boolean") {
          return {
            ok: false as const,
            error: "idempotency_state_unverifiable",
            coach_note: "The saved workout-start result is invalid. Refresh before trying again.",
          };
        }
        return {
          ok: true as const,
          resumed: true,
          sessionId: stored.session_id,
          idempotentReplay: true,
        };
      }
      const [legacySession] = await tx
        .select({ id: workoutSessions.id })
        .from(workoutSessions)
        .where(and(eq(workoutSessions.user_id, userId), eq(workoutSessions.source_key, sourceKey)))
        .limit(1);
      if (legacySession) {
        return {
          ok: false as const,
          error: "idempotency_state_unverifiable",
          coach_note:
            "That workout-start request predates replay verification. Refresh before trying again.",
        };
      }
    }

    const finishStart = async (sessionId: string, resumed: boolean) => {
      if (sourceKey) {
        await tx.insert(programOperations).values({
          user_id: userId,
          source_key: sourceKey,
          operation: "start_session",
          payload_hash: payloadHash,
          result: { session_id: sessionId, resumed },
        });
      }
      return {
        ok: true as const,
        resumed,
        sessionId,
        idempotentReplay: false,
      };
    };

    const [active] = await tx
      .select()
      .from(workoutSessions)
      .where(and(eq(workoutSessions.user_id, userId), eq(workoutSessions.status, "active")))
      .orderBy(desc(workoutSessions.created_at))
      .limit(1);
    if (active) {
      if (!requestedProgramDayId || requestedProgramDayId === active.program_day_id) {
        return finishStart(active.id, true);
      }
      return {
        ok: false as const,
        error: "active_session_conflict",
        coach_note: `A workout ("${active.title}") is already in progress. Resume or explicitly finish it before starting another one.`,
      };
    }

    const [activeProgram] = await tx
      .select({ id: programs.id, name: programs.name })
      .from(programs)
      .where(and(eq(programs.user_id, userId), eq(programs.status, "active")))
      .limit(1);

    let programDay: typeof programDays.$inferSelect | null = null;
    if (activeProgram) {
      const dayConditions = [
        eq(programDays.program_id, activeProgram.id),
        eq(programDays.status, "planned"),
      ];
      if (requestedProgramDayId) {
        dayConditions.push(eq(programDays.id, requestedProgramDayId));
      } else {
        dayConditions.push(lte(programDays.date, date));
      }
      const [day] = await tx
        .select()
        .from(programDays)
        .where(and(...dayConditions))
        .orderBy(asc(programDays.date))
        .limit(1);
      if (requestedProgramDayId && !day) {
        return {
          ok: false as const,
          error: "program_day_not_available",
          coach_note:
            "That scheduled workout is no longer available. Refresh the program before starting.",
        };
      }
      programDay = day ?? null;
    } else if (requestedProgramDayId) {
      return {
        ok: false as const,
        error: "no_active_program",
        coach_note: "There is no active program containing that workout.",
      };
    }

    const doneToday = await tx
      .select({ id: workoutSessions.id, title: workoutSessions.title })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.user_id, userId),
          eq(workoutSessions.session_date, date),
          eq(workoutSessions.status, "completed"),
        ),
      );
    if (doneToday.length >= 1 && !opts.override_reason) {
      return {
        ok: false as const,
        error: "daily_limit",
        coach_note: `The user ALREADY completed "${doneToday[0]?.title}" today (${date}). One session per day unless the program says otherwise — recovery is where growth happens. Do NOT start another session.`,
      };
    }

    let list =
      opts.exercises?.map((exercise) => {
        const canonical = resolveSessionExercise(exercise);
        return { ...exercise, exercise_id: canonical.id, name: canonical.name_en };
      }) ?? [];
    let title = opts.title?.trim() || "Workout";
    if (programDay) {
      const plannedExercises = await tx
        .select()
        .from(programExercises)
        .where(eq(programExercises.program_day_id, programDay.id))
        .orderBy(asc(programExercises.position));
      if (!plannedExercises.length) {
        return {
          ok: false as const,
          error: "program_day_has_no_exercises",
          coach_note:
            "This scheduled workout has no exercises. Repair the program before training.",
        };
      }
      const unresolvedExercise = plannedExercises.find(
        (exercise) => !getExercise(exercise.exercise_id) && !findExercise(exercise.name),
      );
      if (unresolvedExercise) {
        return {
          ok: false as const,
          error: "program_exercise_not_in_catalog",
          coach_note:
            "This workout contains an unsupported legacy exercise. Replace it before training.",
        };
      }
      list = plannedExercises.map((exercise) => ({
        exercise_id: (getExercise(exercise.exercise_id) ?? findExercise(exercise.name))!.id,
        name: (getExercise(exercise.exercise_id) ?? findExercise(exercise.name))!.name_en,
        target: `${exercise.sets}×${exercise.rep_range}${exercise.target_weight_kg != null ? ` @ ${exercise.target_weight_kg}kg` : ""}`,
        sets: exercise.sets,
        rep_range: exercise.rep_range,
        weight_kg: exercise.target_weight_kg,
      }));
      title = `${programDay.title}${programDay.is_deload ? " (deload)" : ""}`;
    } else if (!list.length) {
      return {
        ok: false as const,
        error: "no_exercises",
        coach_note: "There is no due scheduled workout and no ad-hoc exercise list was supplied.",
      };
    }

    const [session] = await tx
      .insert(workoutSessions)
      .values({
        user_id: userId,
        session_date: date,
        title,
        program_day_id: programDay?.id ?? null,
        source_key: sourceKey,
      })
      .returning();
    if (!session) throw new Error("Failed to create workout session");

    for (let index = 0; index < list.length; index++) {
      const exercise = list[index];
      const numberOfSets = exercise.sets ?? 3;
      const [row] = await tx
        .insert(sessionExercises)
        .values({
          session_id: session.id,
          position: index,
          exercise_id: exercise.exercise_id,
          name: exercise.name.trim(),
          target: exercise.target?.trim() || null,
          planned_set_count: numberOfSets,
        })
        .returning({ id: sessionExercises.id });
      if (!row) throw new Error("Failed to create session exercise");
      await tx.insert(sessionSets).values(
        Array.from({ length: numberOfSets }, (_, setIndex) => ({
          session_exercise_id: row.id,
          set_index: setIndex + 1,
          target_reps: exercise.rep_range ?? null,
          target_weight_kg: exercise.weight_kg ?? null,
          weight_kg: null,
        })),
      );
    }
    return finishStart(session.id, false);
  });

  if (!created.ok) return created;
  return {
    ok: true,
    session: await getSessionById(userId, created.sessionId),
    resumed: created.resumed,
    idempotent_replay: created.idempotentReplay,
  };
}

function validateAdHocExercises(
  exercises:
    | Array<{
        exercise_id?: ExerciseId | string | null;
        name?: string | null;
        target?: string | null;
        sets?: number | null;
        rep_range?: string | null;
        weight_kg?: number | null;
      }>
    | undefined,
) {
  if (!exercises) return null;
  if (exercises.length < 1 || exercises.length > 30) return "invalid_exercise_count";
  for (const exercise of exercises) {
    try {
      resolveSessionExercise(exercise);
    } catch {
      return "exercise_not_in_catalog";
    }
    if (
      exercise.sets != null &&
      (!Number.isInteger(exercise.sets) || exercise.sets < 1 || exercise.sets > 30)
    ) {
      return "invalid_exercise_sets";
    }
    if (exercise.target != null && exercise.target.length > 160) return "invalid_exercise_target";
    if (exercise.rep_range != null && exercise.rep_range.length > 80) {
      return "invalid_rep_range";
    }
    if (
      exercise.weight_kg != null &&
      (!Number.isFinite(exercise.weight_kg) || exercise.weight_kg < 0 || exercise.weight_kg > 1_000)
    ) {
      return "invalid_exercise_weight";
    }
  }
  return null;
}

function resolveSessionExercise(
  exercise: NonNullable<Parameters<typeof validateAdHocExercises>[0]>[number],
) {
  const canonical =
    getExercise(exercise.exercise_id) ??
    findExercise(exercise.name) ??
    findExercise(exercise.exercise_id);
  if (!canonical) throw new Error("exercise_not_in_catalog");
  return canonical;
}

async function getSessionById(userId: string, sessionId: string): Promise<ActiveSession> {
  const db = getDb();
  const [session] = await db
    .select()
    .from(workoutSessions)
    .where(and(eq(workoutSessions.id, sessionId), eq(workoutSessions.user_id, userId)))
    .limit(1);
  if (!session) return null;
  const rawRows = await db
    .select({
      exercise: sessionExercises,
      catalog_name_en: exerciseCatalog.name_en,
      catalog_name_sv: exerciseCatalog.name_sv,
      image_path: exerciseCatalog.image_path,
    })
    .from(sessionExercises)
    .leftJoin(exerciseCatalog, eq(exerciseCatalog.id, sessionExercises.exercise_id))
    .where(eq(sessionExercises.session_id, session.id))
    .orderBy(asc(sessionExercises.position));
  const rows = rawRows.map((row) => ({
    ...row.exercise,
    name_en: row.catalog_name_en ?? row.exercise.name,
    name_sv: row.catalog_name_sv ?? row.exercise.name,
    image_path: row.image_path,
  }));
  const exIds = rows.map((row) => row.id);
  const allSets = exIds.length
    ? await db
        .select()
        .from(sessionSets)
        .where(inArray(sessionSets.session_exercise_id, exIds))
        .orderBy(asc(sessionSets.set_index))
    : [];
  const setsByExercise = new Map<string, SessionSet[]>();
  for (const set of allSets) {
    const list = setsByExercise.get(set.session_exercise_id) ?? [];
    list.push({
      id: set.id,
      set_index: set.set_index,
      target_reps: set.target_reps,
      target_weight_kg: set.target_weight_kg,
      weight_kg: set.weight_kg,
      reps: set.reps,
      completed: set.completed,
      completed_at: set.completed_at,
      revision: set.revision,
    });
    setsByExercise.set(set.session_exercise_id, list);
  }
  const exercises = rows.map((row) => ({
    id: row.id,
    position: row.position,
    exercise_id: row.exercise_id,
    name: row.name,
    name_en: row.name_en,
    name_sv: row.name_sv,
    image_path: row.image_path,
    target: row.target,
    completed: row.completed,
    completed_at: row.completed_at,
    sets: setsByExercise.get(row.id) ?? [],
  }));
  return {
    id: session.id,
    session_date: session.session_date,
    title: session.title,
    status: session.status,
    started_at: session.created_at,
    program_day_id: session.program_day_id,
    exercises,
    done: exercises.filter((exercise) => exercise.completed).length,
    total: exercises.length,
    next: exercises.find((exercise) => !exercise.completed) ?? null,
  };
}

export async function markExerciseDone(
  userId: string,
  match: string,
  done = true,
  performedSets?: Array<{ weight_kg?: number | null; reps: number }>,
  opts: { source_key?: string | null; expected_data_epoch?: number } = {},
): Promise<{
  ok: boolean;
  error?: string;
  marked?: string;
  pace_warning?: string;
  session: ActiveSession;
  idempotent_replay?: boolean;
}> {
  const needle = match.trim().toLowerCase();
  if (!needle || needle.length > 160) {
    return { ok: false, error: "invalid_exercise", session: await getActiveSession(userId) };
  }
  const sourceKey = opts.source_key?.trim() || null;
  if (opts.source_key != null && (!sourceKey || opts.source_key.length > 200)) {
    return { ok: false, error: "invalid_source_key", session: await getActiveSession(userId) };
  }
  const canonical = getExercise(match) ?? findExercise(match);
  const payloadHash = operationPayloadHash("mark_exercise", {
    exercise: canonical?.id ?? needle,
    done,
    performed_sets:
      performedSets?.map((set) => ({
        weight_kg: set.weight_kg ?? null,
        reps: set.reps,
      })) ?? null,
  });
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    await lockWorkoutMutation(tx, userId, opts.expected_data_epoch);
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
        if (prior.operation !== "mark_exercise" || prior.payload_hash !== payloadHash) {
          return {
            ok: false as const,
            error: "idempotency_key_reused",
            sessionId: null,
            idempotentReplay: false,
          };
        }
        const stored = prior.result as {
          ok?: unknown;
          error?: unknown;
          target_name?: unknown;
          session_id?: unknown;
        };
        if (
          typeof stored.ok !== "boolean" ||
          (stored.error != null && typeof stored.error !== "string") ||
          (stored.target_name != null && typeof stored.target_name !== "string") ||
          (stored.session_id != null && typeof stored.session_id !== "string")
        ) {
          return {
            ok: false as const,
            error: "idempotency_state_unverifiable",
            sessionId: null,
            idempotentReplay: false,
          };
        }
        return {
          ok: stored.ok,
          ...(typeof stored.error === "string" ? { error: stored.error } : {}),
          ...(typeof stored.target_name === "string" ? { targetName: stored.target_name } : {}),
          sessionId: typeof stored.session_id === "string" ? stored.session_id : null,
          idempotentReplay: true,
        };
      }
    }

    const finishMark = async (value: {
      ok: boolean;
      error?: string;
      targetName?: string;
      sessionId: string | null;
    }) => {
      if (sourceKey) {
        await tx.insert(programOperations).values({
          user_id: userId,
          source_key: sourceKey,
          operation: "mark_exercise",
          payload_hash: payloadHash,
          result: {
            ok: value.ok,
            error: value.error ?? null,
            target_name: value.targetName ?? null,
            session_id: value.sessionId,
          },
        });
      }
      return { ...value, idempotentReplay: false };
    };

    const [active] = await tx
      .select()
      .from(workoutSessions)
      .where(and(eq(workoutSessions.user_id, userId), eq(workoutSessions.status, "active")))
      .limit(1);
    if (!active) {
      return finishMark({ ok: false, error: "no_active_session", sessionId: null });
    }
    const exercises = await tx
      .select()
      .from(sessionExercises)
      .where(eq(sessionExercises.session_id, active.id))
      .orderBy(asc(sessionExercises.position));
    const exact = canonical
      ? exercises.find(
          (exercise) =>
            exercise.exercise_id === canonical.id ||
            findExercise(exercise.name)?.id === canonical.id,
        )
      : exercises.find((exercise) => exercise.name.trim().toLowerCase() === needle);
    const partial = exact
      ? [exact]
      : exercises.filter((exercise) => exercise.name.trim().toLowerCase().includes(needle));
    if (!partial.length) {
      return finishMark({
        ok: false,
        error: "exercise_not_found",
        sessionId: active.id,
      });
    }
    if (partial.length > 1) {
      return finishMark({
        ok: false,
        error: "exercise_ambiguous",
        sessionId: active.id,
      });
    }
    const target = partial[0];
    const sets = await tx
      .select()
      .from(sessionSets)
      .where(eq(sessionSets.session_exercise_id, target.id))
      .orderBy(asc(sessionSets.set_index));
    const now = new Date().toISOString();

    if (done) {
      if (!sets.length) {
        return finishMark({
          ok: false,
          error: "exercise_has_no_sets",
          sessionId: active.id,
        });
      }
      if (!performedSets || performedSets.length < 1 || performedSets.length > 30) {
        return finishMark({
          ok: false,
          error: "performed_sets_required",
          sessionId: active.id,
        });
      }
      const invalid = performedSets.find((actual) => !isValidActualSet(actual));
      if (invalid) {
        return finishMark({
          ok: false,
          error: "invalid_performed_set",
          sessionId: active.id,
        });
      }

      for (let index = 0; index < performedSets.length; index++) {
        const actual = performedSets[index];
        const existingSet = sets[index];
        if (!existingSet) {
          await tx.insert(sessionSets).values({
            session_exercise_id: target.id,
            set_index: index + 1,
            target_reps: null,
            target_weight_kg: null,
            weight_kg: actual.weight_kg ?? null,
            reps: actual.reps,
            completed: true,
            completed_at: now,
          });
          continue;
        }
        if (
          existingSet.completed &&
          existingSet.weight_kg === (actual.weight_kg ?? null) &&
          existingSet.reps === actual.reps
        ) {
          continue;
        }
        await tx
          .update(sessionSets)
          .set({
            completed: true,
            completed_at: now,
            weight_kg: actual.weight_kg ?? null,
            reps: actual.reps,
            revision: sql`${sessionSets.revision} + 1`,
          })
          .where(eq(sessionSets.id, existingSet.id));
      }

      // `performedSets` is a complete replacement, not an append-only patch.
      // Preserve every planned row (and its targets), but clear stale actuals
      // from planned rows omitted by the correction. Appended extra-set rows
      // have no planning identity and are removed when omitted.
      if (performedSets.length < target.planned_set_count) {
        await tx
          .update(sessionSets)
          .set({
            completed: false,
            completed_at: null,
            weight_kg: null,
            reps: null,
            revision: sql`${sessionSets.revision} + 1`,
          })
          .where(
            and(
              eq(sessionSets.session_exercise_id, target.id),
              sql`${sessionSets.set_index} > ${performedSets.length}`,
              sql`${sessionSets.set_index} <= ${target.planned_set_count}`,
              sql`(
                ${sessionSets.completed}
                OR ${sessionSets.completed_at} IS NOT NULL
                OR ${sessionSets.weight_kg} IS NOT NULL
                OR ${sessionSets.reps} IS NOT NULL
              )`,
            ),
          );
      }
      await tx
        .delete(sessionSets)
        .where(
          and(
            eq(sessionSets.session_exercise_id, target.id),
            sql`${sessionSets.set_index} > ${Math.max(
              target.planned_set_count,
              performedSets.length,
            )}`,
          ),
        );

      const refreshedSets = await tx
        .select({ set_index: sessionSets.set_index, completed: sessionSets.completed })
        .from(sessionSets)
        .where(eq(sessionSets.session_exercise_id, target.id));
      const completedIndexes = new Set(
        refreshedSets.filter((set) => set.completed).map((set) => set.set_index),
      );
      const allPlannedSetsDone =
        performedSets.length >= target.planned_set_count &&
        Array.from({ length: target.planned_set_count }, (_, index) => index + 1).every(
          (setIndex) => completedIndexes.has(setIndex),
        );
      const allDone =
        allPlannedSetsDone &&
        refreshedSets.length > 0 &&
        refreshedSets.every((set) => set.completed);
      await tx
        .update(sessionExercises)
        .set({ completed: allDone, completed_at: allDone ? now : null })
        .where(eq(sessionExercises.id, target.id));
    } else {
      await tx
        .update(sessionExercises)
        .set({ completed: false, completed_at: null })
        .where(eq(sessionExercises.id, target.id));
      await tx
        .update(sessionSets)
        .set({
          completed: false,
          completed_at: null,
          revision: sql`${sessionSets.revision} + 1`,
        })
        .where(
          and(eq(sessionSets.session_exercise_id, target.id), eq(sessionSets.completed, true)),
        );
    }
    return finishMark({
      ok: true,
      targetName: target.name,
      sessionId: active.id,
    });
  });

  const session = result.sessionId ? await getSessionById(userId, result.sessionId) : null;
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      session,
      idempotent_replay: result.idempotentReplay,
    };
  }

  // Pace realism: how fast are exercises being checked off?
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

  return {
    ok: true,
    marked: result.targetName,
    pace_warning,
    session,
    idempotent_replay: result.idempotentReplay,
  };
}

function isValidActualSet(actual: { weight_kg?: number | null; reps: number }) {
  if (!Number.isInteger(actual.reps) || actual.reps < 1 || actual.reps > 1_000) return false;
  if (!Object.prototype.hasOwnProperty.call(actual, "weight_kg")) return false;
  return (
    actual.weight_kg == null ||
    (Number.isFinite(actual.weight_kg) && actual.weight_kg >= 0 && actual.weight_kg <= 1_000)
  );
}

/** Toggle/log a single set (per-set logging). Auto-completes the parent exercise
 * when all its sets are done. */
export async function markSetDone(
  userId: string,
  setId: string,
  opts: {
    completed: boolean;
    weight_kg?: number | null;
    reps?: number | null;
    expected_revision: number;
    expected_data_epoch?: number;
  },
): Promise<{
  ok: boolean;
  error?: string;
  session: ActiveSession;
  latest_set?: SessionSet | null;
}> {
  if (!Number.isInteger(opts.expected_revision) || opts.expected_revision < 0) {
    return {
      ok: false,
      error: "invalid_set_revision",
      session: await getActiveSession(userId),
    };
  }
  if (
    (opts.weight_kg !== undefined &&
      opts.weight_kg !== null &&
      (!Number.isFinite(opts.weight_kg) || opts.weight_kg < 0 || opts.weight_kg > 1_000)) ||
    (opts.reps !== undefined &&
      opts.reps !== null &&
      (!Number.isInteger(opts.reps) || opts.reps < 1 || opts.reps > 1_000))
  ) {
    return {
      ok: false,
      error: "invalid_actual_set_data",
      session: await getActiveSession(userId),
    };
  }
  if (
    opts.completed &&
    (!isValidActualSet({
      weight_kg: opts.weight_kg,
      reps: opts.reps as number,
    }) ||
      opts.weight_kg === undefined ||
      opts.reps === undefined ||
      opts.reps === null)
  ) {
    return {
      ok: false,
      error: "actual_set_data_required",
      session: await getActiveSession(userId),
    };
  }

  const db = getDb();
  const result = await db.transaction(async (tx) => {
    await lockWorkoutMutation(tx, userId, opts.expected_data_epoch);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"program:" + userId}, 0))`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"workout:" + userId}, 0))`,
    );
    const [owned] = await tx
      .select({
        set_id: sessionSets.id,
        set_completed: sessionSets.completed,
        set_weight_kg: sessionSets.weight_kg,
        set_reps: sessionSets.reps,
        set_revision: sessionSets.revision,
        exercise_id: sessionExercises.id,
        session_id: workoutSessions.id,
      })
      .from(sessionSets)
      .innerJoin(sessionExercises, eq(sessionExercises.id, sessionSets.session_exercise_id))
      .innerJoin(workoutSessions, eq(workoutSessions.id, sessionExercises.session_id))
      .where(
        and(
          eq(sessionSets.id, setId),
          eq(workoutSessions.user_id, userId),
          eq(workoutSessions.status, "active"),
        ),
      )
      .limit(1);
    if (!owned) return { ok: false as const, error: "set_not_found", sessionId: null };
    if (
      owned.set_completed === opts.completed &&
      (opts.weight_kg === undefined || owned.set_weight_kg === opts.weight_kg) &&
      (opts.reps === undefined || owned.set_reps === opts.reps)
    ) {
      return { ok: true as const, sessionId: owned.session_id };
    }
    if (owned.set_revision !== opts.expected_revision) {
      return {
        ok: false as const,
        error: "set_revision_conflict",
        sessionId: owned.session_id,
        setId: owned.set_id,
      };
    }
    const now = new Date().toISOString();
    const [updated] = await tx
      .update(sessionSets)
      .set({
        completed: opts.completed,
        completed_at: opts.completed ? now : null,
        ...(opts.weight_kg !== undefined ? { weight_kg: opts.weight_kg } : {}),
        ...(opts.reps !== undefined ? { reps: opts.reps } : {}),
        revision: sql`${sessionSets.revision} + 1`,
      })
      .where(
        and(eq(sessionSets.id, owned.set_id), eq(sessionSets.revision, opts.expected_revision)),
      )
      .returning({ id: sessionSets.id });
    if (!updated) {
      return {
        ok: false as const,
        error: "set_revision_conflict",
        sessionId: owned.session_id,
        setId: owned.set_id,
      };
    }
    const siblingSets = await tx
      .select({ completed: sessionSets.completed })
      .from(sessionSets)
      .where(eq(sessionSets.session_exercise_id, owned.exercise_id));
    const allDone = siblingSets.length > 0 && siblingSets.every((set) => set.completed);
    await tx
      .update(sessionExercises)
      .set({ completed: allDone, completed_at: allDone ? now : null })
      .where(eq(sessionExercises.id, owned.exercise_id));
    return { ok: true as const, sessionId: owned.session_id };
  });
  const session = result.sessionId
    ? await getSessionById(userId, result.sessionId)
    : await getActiveSession(userId);
  if (!result.ok) {
    const latestSet =
      result.setId && session
        ? (session.exercises
            .flatMap((exercise) => exercise.sets)
            .find((set) => set.id === result.setId) ?? null)
        : undefined;
    return { ok: false, error: result.error, session, latest_set: latestSet };
  }
  return { ok: true, session };
}

export type CompleteResult =
  | {
      ok: true;
      duration_min: number;
      cycle_completed: boolean;
      program_name: string | null;
      idempotent_replay?: boolean;
    }
  | { ok: false; error: string; coach_note: string };

/** Complete with duration realism: a planned session can't be done in minutes. */
export async function completeSession(
  userId: string,
  opts?: {
    planned_minutes?: number | null;
    override_reason?: string | null;
    session_id?: string | null;
    expected_data_epoch?: number;
  },
): Promise<CompleteResult> {
  const planned = opts?.planned_minutes ?? 60;
  if (!Number.isFinite(planned) || planned < 15 || planned > 240) {
    return {
      ok: false,
      error: "invalid_planned_minutes",
      coach_note: "The planned workout duration is invalid.",
    };
  }
  const overrideReason = opts?.override_reason?.trim() || null;
  if (overrideReason && overrideReason.length > 1_000) {
    return {
      ok: false,
      error: "invalid_override_reason",
      coach_note: "The completion explanation is too long.",
    };
  }

  const db = getDb();
  return db.transaction(async (tx) => {
    await lockWorkoutMutation(tx, userId, opts?.expected_data_epoch);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"program:" + userId}, 0))`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"workout:" + userId}, 0))`,
    );
    const requestedConditions = [
      eq(workoutSessions.user_id, userId),
      opts?.session_id
        ? eq(workoutSessions.id, opts.session_id)
        : eq(workoutSessions.status, "active"),
    ];
    const [current] = await tx
      .select()
      .from(workoutSessions)
      .where(and(...requestedConditions))
      .orderBy(desc(workoutSessions.created_at))
      .limit(1);
    if (!current) {
      return {
        ok: false as const,
        error: "no_active_session",
        coach_note: "There is no active session to complete.",
      };
    }
    if (current.status === "completed") {
      const [linkedProgram] = current.program_day_id
        ? await tx
            .select({ name: programs.name, status: programs.status })
            .from(programDays)
            .innerJoin(programs, eq(programs.id, programDays.program_id))
            .where(and(eq(programDays.id, current.program_day_id), eq(programs.user_id, userId)))
            .limit(1)
        : [];
      return {
        ok: true as const,
        duration_min:
          current.duration_minutes ??
          Math.max(
            0,
            Math.round(
              ((current.completed_at ? new Date(current.completed_at).getTime() : Date.now()) -
                new Date(current.created_at).getTime()) /
                60000,
            ),
          ),
        cycle_completed: linkedProgram?.status === "completed",
        program_name: linkedProgram?.name ?? null,
        idempotent_replay: true,
      };
    }
    if (current.status !== "active") {
      return {
        ok: false as const,
        error: "session_already_closed",
        coach_note: "This workout is no longer active.",
      };
    }

    const exerciseRows = await tx
      .select()
      .from(sessionExercises)
      .where(eq(sessionExercises.session_id, current.id))
      .orderBy(asc(sessionExercises.position));
    const setRows = exerciseRows.length
      ? await tx
          .select()
          .from(sessionSets)
          .where(
            inArray(
              sessionSets.session_exercise_id,
              exerciseRows.map((row) => row.id),
            ),
          )
          .orderBy(asc(sessionSets.set_index))
      : [];
    const setsByExercise = new Map<string, typeof setRows>();
    for (const set of setRows) {
      const list = setsByExercise.get(set.session_exercise_id) ?? [];
      list.push(set);
      setsByExercise.set(set.session_exercise_id, list);
    }
    const completionIssues = getSessionCompletionIssues(
      exerciseRows.map((exercise) => ({
        name: exercise.name,
        completed: exercise.completed,
        sets: setsByExercise.get(exercise.id) ?? [],
      })),
    );
    if (completionIssues.length) {
      return {
        ok: false as const,
        error: "incomplete_workout",
        coach_note: `The workout is not complete: ${completionIssues.join(" ")} Every performed set needs its actual reps before closing it.`,
      };
    }

    const elapsedMin = (Date.now() - new Date(current.created_at).getTime()) / 60000;
    const minimum = Math.max(10, planned * 0.25);
    if (elapsedMin < minimum && !overrideReason) {
      return {
        ok: false as const,
        error: "implausible_duration",
        coach_note: `The session has only been running ${elapsedMin.toFixed(1)} minutes — a ~${planned} min workout can't be done that fast. Ask what actually happened before overriding.`,
      };
    }

    let cycleCompleted = false;
    let programName: string | null = null;
    if (current.program_day_id) {
      const [linked] = await tx
        .select({
          day_id: programDays.id,
          day_status: programDays.status,
          program_id: programs.id,
          program_name: programs.name,
        })
        .from(programDays)
        .innerJoin(programs, eq(programs.id, programDays.program_id))
        .where(
          and(
            eq(programDays.id, current.program_day_id),
            eq(programs.user_id, userId),
            eq(programs.status, "active"),
          ),
        )
        .limit(1);
      if (!linked || linked.day_status !== "planned") {
        return {
          ok: false as const,
          error: "program_day_not_available",
          coach_note:
            "The scheduled program day changed while this workout was active. Nothing was closed; refresh and repair the program first.",
        };
      }
      await tx
        .update(programDays)
        .set({ status: "completed", session_id: current.id, resolution_note: null })
        .where(and(eq(programDays.id, linked.day_id), eq(programDays.status, "planned")));
      const statuses = await tx
        .select({ status: programDays.status })
        .from(programDays)
        .where(eq(programDays.program_id, linked.program_id));
      cycleCompleted = statuses.length > 0 && statuses.every((day) => day.status !== "planned");
      if (cycleCompleted) {
        await tx
          .update(programs)
          .set({ status: "completed", completed_at: new Date().toISOString() })
          .where(and(eq(programs.id, linked.program_id), eq(programs.status, "active")));
      }
      programName = linked.program_name;
    }

    const completedAt = new Date().toISOString();
    const durationMinutes = Math.min(1_440, Math.max(0, Math.round(elapsedMin)));
    const [updated] = await tx
      .update(workoutSessions)
      .set({
        status: "completed",
        completed_at: completedAt,
        duration_minutes: durationMinutes,
        end_reason: overrideReason ? `completed_override: ${overrideReason}` : "completed",
      })
      .where(
        and(
          eq(workoutSessions.id, current.id),
          eq(workoutSessions.user_id, userId),
          eq(workoutSessions.status, "active"),
        ),
      )
      .returning({ id: workoutSessions.id });
    if (!updated) {
      return {
        ok: false as const,
        error: "session_already_closed",
        coach_note: "This workout was already closed on another request or device.",
      };
    }
    return {
      ok: true as const,
      duration_min: durationMinutes,
      cycle_completed: cycleCompleted,
      program_name: programName,
      idempotent_replay: false,
    };
  });
}

/** Explicitly close an active workout without pretending it was completed. */
export async function abandonSession(
  userId: string,
  opts: { reason: string; session_id?: string | null; expected_data_epoch?: number },
) {
  const reason = opts.reason.trim();
  if (!reason || reason.length > 1_000) {
    return { ok: false as const, error: "invalid_abandon_reason" };
  }
  const db = getDb();
  return db.transaction(async (tx) => {
    await lockWorkoutMutation(tx, userId, opts.expected_data_epoch);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"program:" + userId}, 0))`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"workout:" + userId}, 0))`,
    );
    const conditions = [eq(workoutSessions.user_id, userId), eq(workoutSessions.status, "active")];
    if (opts.session_id) conditions.push(eq(workoutSessions.id, opts.session_id));
    const [session] = await tx
      .select()
      .from(workoutSessions)
      .where(and(...conditions))
      .limit(1);
    if (!session) return { ok: false as const, error: "no_active_session" };
    const elapsedMinutes = Math.min(
      1_440,
      Math.max(0, Math.round((Date.now() - new Date(session.created_at).getTime()) / 60_000)),
    );
    const now = new Date().toISOString();
    await tx
      .update(workoutSessions)
      .set({
        status: "abandoned",
        completed_at: now,
        duration_minutes: elapsedMinutes,
        end_reason: reason,
      })
      .where(
        and(
          eq(workoutSessions.id, session.id),
          eq(workoutSessions.user_id, userId),
          eq(workoutSessions.status, "active"),
        ),
      );
    return {
      ok: true as const,
      session_id: session.id,
      program_day_id: session.program_day_id,
      duration_min: elapsedMinutes,
    };
  });
}

export type WorkoutHistoryOptions = {
  programId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  limit?: number;
  before?: { session_date: string; created_at: string; id: string } | null;
};

/** Durable, account-scoped workout history with every exercise and set. */
export async function getWorkoutHistory(userId: string, opts: WorkoutHistoryOptions = {}) {
  const db = getDb();
  const conditions = [eq(workoutSessions.user_id, userId)];
  for (const date of [opts.dateFrom, opts.dateTo, opts.before?.session_date]) {
    if (date) {
      try {
        addIsoDays(date, 0);
      } catch {
        throw new Error("invalid_history_date");
      }
    }
  }
  if (opts.dateFrom) conditions.push(gte(workoutSessions.session_date, opts.dateFrom));
  if (opts.dateTo) conditions.push(lte(workoutSessions.session_date, opts.dateTo));
  if (opts.before) {
    if (
      !Number.isFinite(new Date(opts.before.created_at).getTime()) ||
      !/^[0-9a-f-]{36}$/i.test(opts.before.id)
    ) {
      throw new Error("invalid_history_cursor");
    }
    conditions.push(
      sql`(${workoutSessions.session_date}, ${workoutSessions.created_at}, ${workoutSessions.id}) < (${opts.before.session_date}, ${opts.before.created_at}::timestamptz, ${opts.before.id}::uuid)`,
    );
  }

  type HistoryDay = {
    id: string;
    week: number;
    day_index: number;
    program_id: string;
    program_name: string;
    program_status: string;
    program_start_date: string;
    program_end_date: string;
  };
  let dayRows: HistoryDay[] = [];
  if (opts.programId) {
    const [ownedProgram] = await db
      .select()
      .from(programs)
      .where(and(eq(programs.id, opts.programId), eq(programs.user_id, userId)))
      .limit(1);
    if (!ownedProgram) return [];
    dayRows = await db
      .select({
        id: programDays.id,
        week: programDays.week,
        day_index: programDays.day_index,
        program_id: programDays.program_id,
        program_name: programs.name,
        program_status: programs.status,
        program_start_date: programs.start_date,
        program_end_date: programs.end_date,
      })
      .from(programDays)
      .innerJoin(programs, eq(programs.id, programDays.program_id))
      .where(and(eq(programDays.program_id, opts.programId), eq(programs.user_id, userId)));
    if (!dayRows.length) return [];
    conditions.push(
      inArray(
        workoutSessions.program_day_id,
        dayRows.map((day) => day.id),
      ),
    );
  }

  const sessionRows = await db
    .select()
    .from(workoutSessions)
    .where(and(...conditions))
    .orderBy(
      desc(workoutSessions.session_date),
      desc(workoutSessions.created_at),
      desc(workoutSessions.id),
    )
    .limit(Math.min(400, Math.max(1, opts.limit ?? 120)));
  if (!sessionRows.length) return [];

  if (!opts.programId) {
    const linkedDayIds = sessionRows
      .map((session) => session.program_day_id)
      .filter((id): id is string => Boolean(id));
    if (linkedDayIds.length) {
      dayRows = await db
        .select({
          id: programDays.id,
          week: programDays.week,
          day_index: programDays.day_index,
          program_id: programDays.program_id,
          program_name: programs.name,
          program_status: programs.status,
          program_start_date: programs.start_date,
          program_end_date: programs.end_date,
        })
        .from(programDays)
        .innerJoin(programs, eq(programs.id, programDays.program_id))
        .where(and(inArray(programDays.id, linkedDayIds), eq(programs.user_id, userId)));
    }
  }

  const exerciseRows = await db
    .select()
    .from(sessionExercises)
    .where(
      inArray(
        sessionExercises.session_id,
        sessionRows.map((session) => session.id),
      ),
    )
    .orderBy(asc(sessionExercises.position));
  const setRows = exerciseRows.length
    ? await db
        .select()
        .from(sessionSets)
        .where(
          inArray(
            sessionSets.session_exercise_id,
            exerciseRows.map((exercise) => exercise.id),
          ),
        )
        .orderBy(asc(sessionSets.set_index))
    : [];

  const setsByExercise = new Map<string, typeof setRows>();
  for (const set of setRows) {
    const list = setsByExercise.get(set.session_exercise_id) ?? [];
    list.push(set);
    setsByExercise.set(set.session_exercise_id, list);
  }
  const exercisesBySession = new Map<
    string,
    Array<(typeof exerciseRows)[number] & { sets: typeof setRows }>
  >();
  for (const exercise of exerciseRows) {
    const list = exercisesBySession.get(exercise.session_id) ?? [];
    list.push({ ...exercise, sets: setsByExercise.get(exercise.id) ?? [] });
    exercisesBySession.set(exercise.session_id, list);
  }
  const dayById = new Map(dayRows.map((day) => [day.id, day]));

  return sessionRows.map((session) => ({
    ...session,
    program_day: session.program_day_id ? (dayById.get(session.program_day_id) ?? null) : null,
    exercises: exercisesBySession.get(session.id) ?? [],
  }));
}

/** Compact enough for every prompt, with exact recent sets and full-cycle totals. */
export function summarizeWorkoutHistory(
  rows: Awaited<ReturnType<typeof getWorkoutHistory>>,
  language: AppLanguage = "en",
) {
  const completed = rows.filter((session) => session.status === "completed");
  if (!completed.length) {
    return language === "sv"
      ? "(inga slutförda träningspass sparade för den här programperioden)"
      : "(no completed workouts recorded for this cycle)";
  }

  const aggregate = new Map<
    string,
    { name: string; sets: number; best_weight_kg: number | null; latest: string | null }
  >();
  for (const session of [...completed].reverse()) {
    for (const exercise of session.exercises) {
      const displayName = exerciseName(exercise.exercise_id, language, exercise.name);
      const key = exercise.exercise_id ?? exercise.name.trim().toLowerCase();
      const current = aggregate.get(key) ?? {
        name: displayName,
        sets: 0,
        best_weight_kg: null,
        latest: null,
      };
      const doneSets = exercise.sets.filter((set) => set.completed);
      current.sets += doneSets.length;
      for (const set of doneSets) {
        if (set.weight_kg != null) {
          current.best_weight_kg = Math.max(current.best_weight_kg ?? 0, set.weight_kg);
        }
      }
      if (doneSets.length) {
        current.latest = doneSets
          .map((set) => `${set.weight_kg != null ? `${set.weight_kg}kg` : "BW"}×${set.reps}`)
          .join(", ");
      }
      aggregate.set(key, current);
    }
  }

  const recent = completed
    .slice(0, 8)
    .map((session) => {
      const week = session.program_day
        ? `${language === "sv" ? "V" : "W"}${session.program_day.week}${
            language === "sv" ? "D" : "D"
          }${session.program_day.day_index}`
        : language === "sv"
          ? "fristående"
          : "ad-hoc";
      const work = session.exercises
        .map((exercise) => {
          const sets = exercise.sets
            .filter((set) => set.completed)
            .map((set) => `${set.weight_kg != null ? `${set.weight_kg}kg` : "BW"}×${set.reps}`)
            .join("/");
          return `${exerciseName(exercise.exercise_id, language, exercise.name)} ${
            sets || (language === "sv" ? "(endast slutfört)" : "(completion only)")
          }`;
        })
        .join("; ");
      return `  - ${session.session_date} ${week} ${session.title}: ${work}`;
    })
    .join("\n");
  const totals = [...aggregate.values()]
    .slice(0, 20)
    .map((exercise) =>
      language === "sv"
        ? `  - ${exercise.name}: ${exercise.sets} set, bäst ${
            exercise.best_weight_kg != null ? `${exercise.best_weight_kg}kg` : "kroppsvikt"
          }, senast ${exercise.latest ?? "saknas"}`
        : `  - ${exercise.name}: ${exercise.sets} sets, best ${
            exercise.best_weight_kg != null ? `${exercise.best_weight_kg}kg` : "bodyweight"
          }, latest ${exercise.latest ?? "n/a"}`,
    )
    .join("\n");

  if (language === "sv") {
    return `Slutförda pass i programperioden: ${completed.length}
Senaste exakta prestationer:
${recent}
Totalt per övning i programperioden:
${totals}`;
  }
  return `Cycle workouts completed: ${completed.length}
Recent exact performance:
${recent}
Full-cycle lift totals:
${totals}`;
}

/** Recent session history (for coach context + dashboard). */
export function recentSessionCutoff(localToday: string, days = 7) {
  addIsoDays(localToday, 0);
  if (!Number.isInteger(days) || days < 1 || days > 3_650) {
    throw new Error("invalid_recent_session_window");
  }
  return addIsoDays(localToday, -(days - 1));
}

export async function getRecentSessions(userId: string, days: number, localToday: string) {
  const db = getDb();
  const since = recentSessionCutoff(localToday, days);
  const rows = await db
    .select()
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.user_id, userId),
        gte(workoutSessions.session_date, since),
        lte(workoutSessions.session_date, localToday),
      ),
    )
    .orderBy(desc(workoutSessions.created_at));
  return rows.map((r) => ({
    date: r.session_date,
    title: r.title,
    status: r.status,
    duration_min:
      r.duration_minutes ??
      (r.completed_at && r.created_at
        ? Math.round(
            (new Date(r.completed_at).getTime() - new Date(r.created_at).getTime()) / 60000,
          )
        : null),
  }));
}

/** Compact live-session summary for the agent context (with pace signal). */
export function summarizeSession(s: ActiveSession, language: AppLanguage = "en"): string {
  if (!s) {
    return language === "sv" ? "(inget aktivt träningspass)" : "(no active workout session)";
  }
  const startedMin = Math.round((Date.now() - new Date(s.started_at).getTime()) / 60000);
  const lines = s.exercises
    .map(
      (e) =>
        `  ${e.completed ? "[x]" : "[ ]"} ${
          language === "sv" ? e.name_sv : e.name_en
        }${e.target ? ` — ${e.target}` : ""}`,
    )
    .join("\n");
  if (language === "sv") {
    return `Aktivt pass "${s.title}" — pågått i ${startedMin} min, ${s.done}/${s.total} klara\n${lines}`;
  }
  return `Active session "${s.title}" — running ${startedMin} min, ${s.done}/${s.total} done\n${lines}`;
}

/** History summary line for coach context. */
export function summarizeRecentSessions(
  rows: Awaited<ReturnType<typeof getRecentSessions>>,
  language: AppLanguage = "en",
): string {
  if (!rows.length) {
    return language === "sv"
      ? "(inga träningspass de senaste 7 dagarna)"
      : "(no sessions in the last 7 days)";
  }
  const status = (value: string) => {
    if (language !== "sv") return value;
    if (value === "completed") return "slutfört";
    if (value === "skipped") return "överhoppat";
    if (value === "active") return "aktivt";
    return value;
  };
  return rows
    .map(
      (r) =>
        `  - ${r.date}: ${r.title} — ${status(r.status)}${
          r.duration_min != null ? ` (${r.duration_min} min)` : ""
        }`,
    )
    .join("\n");
}
