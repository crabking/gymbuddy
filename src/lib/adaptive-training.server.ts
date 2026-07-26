import { and, asc, desc, eq, gt, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import {
  adaptationProposals,
  profiles,
  programDays,
  programExercises,
  programs,
  sessionExercises,
  sessionSets,
  workoutReviews,
  workoutSessions,
} from "@/db/schema";
import {
  requireExpectedDataEpoch,
  type AccountMutationTransaction,
} from "@/lib/account-epoch.server";
import {
  analyzeWorkoutAdaptation,
  type AdaptationAction,
  type AdaptationOption,
  type ExerciseExposure,
  type WorkoutReviewAnswers,
} from "@/lib/adaptive-training";
import { getCoach, isCoachId } from "@/lib/coaches";
import { exerciseSubstitutions, getExercise } from "@/lib/exercises";
import { addLocalDays } from "@/lib/local-date";
import { shiftWeekdayIndices } from "@/lib/training-logic";

type ReviewInput = WorkoutReviewAnswers & {
  session_id: string;
  expected_data_epoch: number;
};

type DecisionInput = {
  proposal_id: string;
  option_id: string | "keep";
  expected_program_revision: number;
  expected_data_epoch: number;
};

type SubstitutionProposalInput = {
  exercise_id: string;
  replacement_exercise_ids: string[];
  clarification: string;
  expected_program_revision: number;
  expected_data_epoch: number;
};

function sameReview(row: typeof workoutReviews.$inferSelect, input: ReviewInput) {
  return (
    row.difficulty === input.difficulty &&
    row.energy === input.energy &&
    row.discomfort === input.discomfort &&
    row.note === (input.note?.trim() || null)
  );
}

function normalizeOptions(value: unknown): AdaptationOption[] {
  if (!Array.isArray(value)) throw new Error("invalid_adaptation_options");
  const options = value as AdaptationOption[];
  if (options.length < 1 || options.length > 2) throw new Error("invalid_adaptation_options");
  for (const option of options) {
    if (
      !option ||
      typeof option.id !== "string" ||
      !option.id ||
      !Array.isArray(option.actions) ||
      !option.actions.length
    ) {
      throw new Error("invalid_adaptation_options");
    }
  }
  return options;
}

function setsByExercise<T extends { session_exercise_id: string }>(rows: T[]) {
  const result = new Map<string, T[]>();
  for (const row of rows) {
    const list = result.get(row.session_exercise_id) ?? [];
    list.push(row);
    result.set(row.session_exercise_id, list);
  }
  return result;
}

async function buildAnalysisInput(
  tx: AccountMutationTransaction,
  input: {
    userId: string;
    coachId: string;
    review: WorkoutReviewAnswers;
    sessionId: string;
    sessionDate: string;
    programId: string;
    programDayId: string;
  },
) {
  const currentExercises = await tx
    .select()
    .from(sessionExercises)
    .where(eq(sessionExercises.session_id, input.sessionId))
    .orderBy(asc(sessionExercises.position));
  const currentSets = currentExercises.length
    ? await tx
        .select()
        .from(sessionSets)
        .where(
          inArray(
            sessionSets.session_exercise_id,
            currentExercises.map((exercise) => exercise.id),
          ),
        )
        .orderBy(asc(sessionSets.set_index))
    : [];
  const plannedRows = await tx
    .select()
    .from(programExercises)
    .where(eq(programExercises.program_day_id, input.programDayId))
    .orderBy(asc(programExercises.position));
  const currentSetMap = setsByExercise(currentSets);
  const current: ExerciseExposure[] = currentExercises.flatMap((exercise) => {
    const planned = plannedRows.find(
      (row) =>
        row.position === exercise.position ||
        (row.exercise_id != null && row.exercise_id === exercise.exercise_id),
    );
    if (!exercise.exercise_id) return [];
    return [
      {
        exercise_id: exercise.exercise_id,
        name: exercise.name,
        planned_sets: exercise.planned_set_count,
        target_weight_kg:
          currentSetMap.get(exercise.id)?.find((set) => set.target_weight_kg != null)
            ?.target_weight_kg ?? null,
        progression_step_kg: planned?.progression_step_kg ?? null,
        sets: (currentSetMap.get(exercise.id) ?? []).map((set) => ({
          target_reps: set.target_reps,
          target_weight_kg: set.target_weight_kg,
          weight_kg: set.weight_kg,
          reps: set.reps,
          completed: set.completed,
        })),
      },
    ];
  });

  const priorSessions = await tx
    .select({ id: workoutSessions.id, program_day_id: workoutSessions.program_day_id })
    .from(workoutSessions)
    .innerJoin(programDays, eq(programDays.id, workoutSessions.program_day_id))
    .where(
      and(
        eq(workoutSessions.user_id, input.userId),
        eq(workoutSessions.status, "completed"),
        eq(programDays.program_id, input.programId),
        sql`${workoutSessions.id} <> ${input.sessionId}`,
      ),
    )
    .orderBy(desc(workoutSessions.completed_at), desc(workoutSessions.id))
    .limit(12);
  const priorSessionIds = priorSessions.map((session) => session.id);
  const priorExercises = priorSessionIds.length
    ? await tx
        .select()
        .from(sessionExercises)
        .where(inArray(sessionExercises.session_id, priorSessionIds))
        .orderBy(desc(sessionExercises.completed_at), asc(sessionExercises.position))
    : [];
  const priorSets = priorExercises.length
    ? await tx
        .select()
        .from(sessionSets)
        .where(
          inArray(
            sessionSets.session_exercise_id,
            priorExercises.map((exercise) => exercise.id),
          ),
        )
        .orderBy(asc(sessionSets.set_index))
    : [];
  const priorSetMap = setsByExercise(priorSets);
  const previousByExercise: Record<string, ExerciseExposure[]> = {};
  for (const exercise of priorExercises) {
    if (!exercise.exercise_id) continue;
    const list = previousByExercise[exercise.exercise_id] ?? [];
    list.push({
      exercise_id: exercise.exercise_id,
      name: exercise.name,
      planned_sets: exercise.planned_set_count,
      target_weight_kg:
        priorSetMap.get(exercise.id)?.find((set) => set.target_weight_kg != null)
          ?.target_weight_kg ?? null,
      progression_step_kg:
        current.find((item) => item.exercise_id === exercise.exercise_id)?.progression_step_kg ??
        null,
      sets: (priorSetMap.get(exercise.id) ?? []).map((set) => ({
        target_reps: set.target_reps,
        target_weight_kg: set.target_weight_kg,
        weight_kg: set.weight_kg,
        reps: set.reps,
        completed: set.completed,
      })),
    });
    previousByExercise[exercise.exercise_id] = list;
  }

  const previousReviews = await tx
    .select({
      difficulty: workoutReviews.difficulty,
      energy: workoutReviews.energy,
      discomfort: workoutReviews.discomfort,
      note: workoutReviews.note,
    })
    .from(workoutReviews)
    .where(
      and(
        eq(workoutReviews.user_id, input.userId),
        sql`${workoutReviews.session_id} <> ${input.sessionId}`,
      ),
    )
    .orderBy(desc(workoutReviews.created_at))
    .limit(3);
  const [nextDay] = await tx
    .select({ date: programDays.date, week: programDays.week })
    .from(programDays)
    .where(
      and(
        eq(programDays.program_id, input.programId),
        eq(programDays.status, "planned"),
        gt(programDays.date, input.sessionDate),
      ),
    )
    .orderBy(asc(programDays.date), asc(programDays.day_index))
    .limit(1);

  return {
    coach_id: isCoachId(input.coachId) ? input.coachId : getCoach(null).id,
    review: input.review,
    current,
    previous_by_exercise: previousByExercise,
    previous_reviews: previousReviews,
    next_planned_date: nextDay?.date ?? null,
    next_planned_week: nextDay?.week ?? null,
  };
}

export async function submitWorkoutReview(userId: string, input: ReviewInput) {
  const note = input.note?.replace(/\s+/g, " ").trim() || null;
  const db = getDb();
  return db.transaction(async (tx) => {
    await requireExpectedDataEpoch(tx, userId, input.expected_data_epoch);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"program:" + userId}, 0))`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"workout:" + userId}, 0))`,
    );
    const [session] = await tx
      .select()
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.id, input.session_id),
          eq(workoutSessions.user_id, userId),
          eq(workoutSessions.status, "completed"),
        ),
      )
      .limit(1);
    if (!session) return { ok: false as const, error: "completed_session_not_found" };

    const [existing] = await tx
      .select()
      .from(workoutReviews)
      .where(eq(workoutReviews.session_id, session.id))
      .limit(1);
    if (existing) {
      if (!sameReview(existing, { ...input, note })) {
        return { ok: false as const, error: "workout_review_already_submitted" };
      }
      const [proposal] = await tx
        .select()
        .from(adaptationProposals)
        .where(eq(adaptationProposals.review_id, existing.id))
        .limit(1);
      return {
        ok: true as const,
        review_id: existing.id,
        proposal: proposal ? publicProposal(proposal) : null,
        idempotent_replay: true,
      };
    }

    const [review] = await tx
      .insert(workoutReviews)
      .values({
        user_id: userId,
        session_id: session.id,
        data_epoch: input.expected_data_epoch,
        difficulty: input.difficulty,
        energy: input.energy,
        discomfort: input.discomfort,
        note,
      })
      .returning();
    if (!review) throw new Error("workout_review_not_saved");

    if (!session.program_day_id) {
      return {
        ok: true as const,
        review_id: review.id,
        proposal: null,
        requires_follow_up: input.discomfort >= 4,
        idempotent_replay: false,
      };
    }
    const [linked] = await tx
      .select({
        program_id: programs.id,
        program_status: programs.status,
        program_revision: programs.revision,
        coach_id: profiles.coach_id,
      })
      .from(programDays)
      .innerJoin(programs, eq(programs.id, programDays.program_id))
      .innerJoin(profiles, eq(profiles.id, programs.user_id))
      .where(
        and(
          eq(programDays.id, session.program_day_id),
          eq(programs.user_id, userId),
          eq(profiles.id, userId),
        ),
      )
      .limit(1);
    if (!linked || linked.program_status !== "active") {
      return {
        ok: true as const,
        review_id: review.id,
        proposal: null,
        requires_follow_up: input.discomfort >= 4,
        idempotent_replay: false,
      };
    }

    await tx
      .update(adaptationProposals)
      .set({ status: "stale", decided_at: new Date().toISOString() })
      .where(
        and(eq(adaptationProposals.user_id, userId), eq(adaptationProposals.status, "pending")),
      );
    const analysis = await buildAnalysisInput(tx, {
      userId,
      coachId: linked.coach_id,
      review: {
        difficulty: review.difficulty,
        energy: review.energy,
        discomfort: review.discomfort,
        note: review.note,
      },
      sessionId: session.id,
      sessionDate: session.session_date,
      programId: linked.program_id,
      programDayId: session.program_day_id,
    });
    const recommendation = analyzeWorkoutAdaptation(analysis);
    if (!recommendation?.options.length) {
      return {
        ok: true as const,
        review_id: review.id,
        proposal: null,
        requires_follow_up: recommendation?.requires_follow_up ?? false,
        idempotent_replay: false,
      };
    }

    const [proposal] = await tx
      .insert(adaptationProposals)
      .values({
        user_id: userId,
        review_id: review.id,
        program_id: linked.program_id,
        program_revision: linked.program_revision,
        data_epoch: input.expected_data_epoch,
        coach_id: linked.coach_id,
        rationale_en: recommendation.rationale_en,
        rationale_sv: recommendation.rationale_sv,
        options: recommendation.options,
      })
      .returning();
    if (!proposal) throw new Error("adaptation_proposal_not_saved");
    return {
      ok: true as const,
      review_id: review.id,
      proposal: publicProposal(proposal),
      requires_follow_up: recommendation.requires_follow_up,
      idempotent_replay: false,
    };
  });
}

function publicProposal(row: typeof adaptationProposals.$inferSelect) {
  return {
    id: row.id,
    program_id: row.program_id,
    program_revision: row.program_revision,
    coach_id: row.coach_id,
    status: row.status,
    rationale_en: row.rationale_en,
    rationale_sv: row.rationale_sv,
    options: normalizeOptions(row.options),
    selected_option_id: row.selected_option_id,
    created_at: row.created_at,
    decided_at: row.decided_at,
  };
}

export async function getPendingAdaptation(userId: string) {
  const [row] = await getDb()
    .select({
      proposal: adaptationProposals,
      current_revision: programs.revision,
      program_status: programs.status,
      current_epoch: profiles.data_epoch,
    })
    .from(adaptationProposals)
    .innerJoin(programs, eq(programs.id, adaptationProposals.program_id))
    .innerJoin(profiles, eq(profiles.id, adaptationProposals.user_id))
    .where(and(eq(adaptationProposals.user_id, userId), eq(adaptationProposals.status, "pending")))
    .orderBy(desc(adaptationProposals.created_at))
    .limit(1);
  if (
    !row ||
    row.program_status !== "active" ||
    row.current_revision !== row.proposal.program_revision ||
    row.current_epoch !== row.proposal.data_epoch
  ) {
    return null;
  }
  return publicProposal(row.proposal);
}

/**
 * Converts a clarified pain/discomfort follow-up into catalog-constrained,
 * one-tap substitution choices. This only rewrites a pending proposal; it
 * never changes the program itself.
 */
export async function proposeAdaptationSubstitution(
  userId: string,
  input: SubstitutionProposalInput,
) {
  const replacementIds = [...new Set(input.replacement_exercise_ids)].slice(0, 2);
  const clarification = input.clarification.replace(/\s+/g, " ").trim();
  if (!clarification || clarification.length > 500) {
    return { ok: false as const, error: "invalid_clarification" };
  }
  if (!replacementIds.length) {
    return { ok: false as const, error: "no_substitution_options" };
  }

  return getDb().transaction(async (tx) => {
    await requireExpectedDataEpoch(tx, userId, input.expected_data_epoch);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"program:" + userId}, 0))`,
    );
    const [row] = await tx
      .select({
        proposal: adaptationProposals,
        review: workoutReviews,
        session: workoutSessions,
        program: programs,
      })
      .from(adaptationProposals)
      .innerJoin(workoutReviews, eq(workoutReviews.id, adaptationProposals.review_id))
      .innerJoin(workoutSessions, eq(workoutSessions.id, workoutReviews.session_id))
      .innerJoin(programs, eq(programs.id, adaptationProposals.program_id))
      .where(
        and(
          eq(adaptationProposals.user_id, userId),
          eq(adaptationProposals.status, "pending"),
          eq(programs.user_id, userId),
        ),
      )
      .orderBy(desc(adaptationProposals.created_at))
      .limit(1);
    if (!row) return { ok: false as const, error: "pending_adaptation_not_found" };
    if (
      row.program.status !== "active" ||
      row.program.revision !== row.proposal.program_revision ||
      row.program.revision !== input.expected_program_revision
    ) {
      await tx
        .update(adaptationProposals)
        .set({ status: "stale", decided_at: new Date().toISOString() })
        .where(eq(adaptationProposals.id, row.proposal.id));
      return { ok: false as const, error: "adaptation_stale" };
    }
    if (row.review.discomfort < 3) {
      return { ok: false as const, error: "substitution_requires_discomfort_follow_up" };
    }
    const [performed] = await tx
      .select({ id: sessionExercises.id })
      .from(sessionExercises)
      .where(
        and(
          eq(sessionExercises.session_id, row.session.id),
          eq(sessionExercises.exercise_id, input.exercise_id),
        ),
      )
      .limit(1);
    if (!performed) {
      return { ok: false as const, error: "reviewed_exercise_not_found" };
    }

    const allowed = new Set(exerciseSubstitutions(input.exercise_id, 100).map((item) => item.id));
    const replacements = replacementIds.map((id) => getExercise(id));
    if (replacements.some((replacement) => !replacement || !allowed.has(replacement.id))) {
      return { ok: false as const, error: "unsafe_substitution_option" };
    }
    const [nextExposure] = await tx
      .select({ date: programDays.date })
      .from(programDays)
      .innerJoin(programExercises, eq(programExercises.program_day_id, programDays.id))
      .where(
        and(
          eq(programDays.program_id, row.program.id),
          eq(programDays.status, "planned"),
          eq(programExercises.exercise_id, input.exercise_id),
        ),
      )
      .orderBy(asc(programDays.date))
      .limit(1);
    if (!nextExposure) {
      return { ok: false as const, error: "exercise_not_found_in_future_program" };
    }

    const options: AdaptationOption[] = replacements.map((replacement) => {
      if (!replacement) throw new Error("replacement_exercise_not_found");
      return {
        id: `substitute:${replacement.id}`,
        title_en: `Switch to ${replacement.name_en}`,
        title_sv: `Byt till ${replacement.name_sv}`,
        summary_en: `Replace future ${getExercise(input.exercise_id)?.name_en ?? input.exercise_id} sessions with ${replacement.name_en}.`,
        summary_sv: `Byt framtida pass med ${getExercise(input.exercise_id)?.name_sv ?? input.exercise_id} till ${replacement.name_sv}.`,
        actions: [
          {
            type: "exercise_adjustment",
            exercise_id: input.exercise_id,
            replacement_exercise_id: replacement.id,
            from_date: nextExposure.date,
          },
        ],
      };
    });
    const [updated] = await tx
      .update(adaptationProposals)
      .set({
        rationale_en: `The discomfort was clarified before offering a substitution: ${clarification}`,
        rationale_sv: `Obehaget förtydligades innan ett övningsbyte föreslogs: ${clarification}`,
        options,
      })
      .where(
        and(eq(adaptationProposals.id, row.proposal.id), eq(adaptationProposals.status, "pending")),
      )
      .returning();
    if (!updated) throw new Error("adaptation_proposal_update_conflict");
    return { ok: true as const, proposal: publicProposal(updated) };
  });
}

function roundedLoad(value: number) {
  return Math.max(0, Math.round(value / 2.5) * 2.5);
}

async function applyExerciseAction(
  tx: AccountMutationTransaction,
  programId: string,
  action: Extract<AdaptationAction, { type: "exercise_adjustment" }>,
) {
  const replacement = action.replacement_exercise_id
    ? getExercise(action.replacement_exercise_id)
    : null;
  if (action.replacement_exercise_id && !replacement) {
    throw new Error("replacement_exercise_not_found");
  }
  const days = await tx
    .select({ id: programDays.id, date: programDays.date, week: programDays.week })
    .from(programDays)
    .where(
      and(
        eq(programDays.program_id, programId),
        eq(programDays.status, "planned"),
        gte(programDays.date, action.from_date),
      ),
    );
  if (!days.length) throw new Error("no_matching_future_workouts");
  const rows = await tx
    .select()
    .from(programExercises)
    .where(
      and(
        inArray(
          programExercises.program_day_id,
          days.map((day) => day.id),
        ),
        eq(programExercises.exercise_id, action.exercise_id),
      ),
    );
  if (!rows.length) throw new Error("exercise_not_found_in_future_program");
  const changes = [];
  for (const row of rows) {
    const nextWeight =
      action.delta_kg == null
        ? replacement
          ? null
          : row.target_weight_kg
        : row.target_weight_kg == null
          ? null
          : roundedLoad(row.target_weight_kg + action.delta_kg);
    const nextSets =
      action.sets_delta == null
        ? row.sets
        : Math.max(1, Math.min(30, row.sets + action.sets_delta));
    const nextRepRange = action.rep_range ?? row.rep_range;
    await tx
      .update(programExercises)
      .set({
        target_weight_kg: nextWeight,
        sets: nextSets,
        rep_range: nextRepRange,
        ...(replacement
          ? {
              exercise_id: replacement.id,
              name: replacement.name_en,
              progression_step_kg: null,
            }
          : {}),
      })
      .where(eq(programExercises.id, row.id));
    changes.push({
      type: action.type,
      row_id: row.id,
      exercise_id: row.exercise_id,
      before: {
        target_weight_kg: row.target_weight_kg,
        sets: row.sets,
        rep_range: row.rep_range,
      },
      after: {
        exercise_id: replacement?.id ?? row.exercise_id,
        target_weight_kg: nextWeight,
        sets: nextSets,
        rep_range: nextRepRange,
      },
    });
  }
  return changes;
}

async function applyScheduleAction(
  tx: AccountMutationTransaction,
  program: typeof programs.$inferSelect,
  action: Extract<AdaptationAction, { type: "schedule_shift" }>,
) {
  const days = await tx
    .select({ id: programDays.id, date: programDays.date })
    .from(programDays)
    .where(
      and(
        eq(programDays.program_id, program.id),
        eq(programDays.status, "planned"),
        gte(programDays.date, action.from_date),
      ),
    )
    .orderBy(desc(programDays.date));
  if (!days.length) throw new Error("no_days_to_shift");
  const movingIds = new Set(days.map((day) => day.id));
  const targetDates = new Set(days.map((day) => addLocalDays(day.date, action.days)));
  const reserved = await tx
    .select({ id: programDays.id, date: programDays.date })
    .from(programDays)
    .where(eq(programDays.program_id, program.id));
  if (reserved.some((day) => !movingIds.has(day.id) && targetDates.has(day.date))) {
    throw new Error("schedule_shift_collision");
  }
  const changes = [];
  for (const day of days) {
    const nextDate = addLocalDays(day.date, action.days);
    await tx
      .update(programDays)
      .set({
        date: nextDate,
        resolution_note: "Adaptive recovery: shifted +1 day after workout check-in.",
      })
      .where(eq(programDays.id, day.id));
    changes.push({ type: action.type, day_id: day.id, before: day.date, after: nextDate });
  }
  const allDates = await tx
    .select({ date: programDays.date })
    .from(programDays)
    .where(eq(programDays.program_id, program.id))
    .orderBy(asc(programDays.date));
  await tx
    .update(programs)
    .set({
      start_date: allDates[0]?.date ?? program.start_date,
      end_date: allDates.at(-1)?.date ?? program.end_date,
      weekday_indices:
        program.schedule_mode === "weekday"
          ? shiftWeekdayIndices((program.weekday_indices as number[]) ?? [], action.days)
          : [],
    })
    .where(eq(programs.id, program.id));
  return changes;
}

async function applyDeloadAction(
  tx: AccountMutationTransaction,
  program: typeof programs.$inferSelect,
  action: Extract<AdaptationAction, { type: "deload_week" }>,
) {
  const days = await tx
    .select({ id: programDays.id })
    .from(programDays)
    .where(
      and(
        eq(programDays.program_id, program.id),
        eq(programDays.week, action.week),
        eq(programDays.status, "planned"),
      ),
    );
  if (!days.length) throw new Error("no_unresolved_deload_week");
  const dayIds = days.map((day) => day.id);
  await tx
    .update(programDays)
    .set({ is_deload: true, resolution_note: "Adaptive recovery week." })
    .where(inArray(programDays.id, dayIds));
  const rows = await tx
    .select()
    .from(programExercises)
    .where(inArray(programExercises.program_day_id, dayIds));
  const changes = [];
  for (const row of rows) {
    const nextWeight =
      row.target_weight_kg == null ? null : roundedLoad(row.target_weight_kg * action.load_factor);
    const nextSets = Math.max(1, row.sets - action.set_reduction);
    await tx
      .update(programExercises)
      .set({ target_weight_kg: nextWeight, sets: nextSets })
      .where(eq(programExercises.id, row.id));
    changes.push({
      type: action.type,
      row_id: row.id,
      before: { target_weight_kg: row.target_weight_kg, sets: row.sets },
      after: { target_weight_kg: nextWeight, sets: nextSets },
    });
  }
  const deloadWeeks = [...new Set([...(program.deload_weeks as number[]), action.week])].sort(
    (a, b) => a - b,
  );
  await tx.update(programs).set({ deload_weeks: deloadWeeks }).where(eq(programs.id, program.id));
  return changes;
}

export async function decideAdaptation(userId: string, input: DecisionInput) {
  const db = getDb();
  return db.transaction(async (tx) => {
    await requireExpectedDataEpoch(tx, userId, input.expected_data_epoch);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"program:" + userId}, 0))`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"workout:" + userId}, 0))`,
    );
    const [row] = await tx
      .select({ proposal: adaptationProposals, program: programs })
      .from(adaptationProposals)
      .innerJoin(programs, eq(programs.id, adaptationProposals.program_id))
      .where(
        and(
          eq(adaptationProposals.id, input.proposal_id),
          eq(adaptationProposals.user_id, userId),
          eq(programs.user_id, userId),
        ),
      )
      .limit(1);
    if (!row) return { ok: false as const, error: "adaptation_not_found" };
    if (row.proposal.status !== "pending") {
      const sameDecision =
        (row.proposal.status === "kept" && input.option_id === "keep") ||
        (row.proposal.status === "applied" && row.proposal.selected_option_id === input.option_id);
      return sameDecision
        ? {
            ok: true as const,
            status: row.proposal.status,
            program_revision: row.program.revision,
            idempotent_replay: true,
          }
        : { ok: false as const, error: "adaptation_already_decided" };
    }
    if (
      row.program.status !== "active" ||
      row.program.revision !== row.proposal.program_revision ||
      row.program.revision !== input.expected_program_revision
    ) {
      await tx
        .update(adaptationProposals)
        .set({ status: "stale", decided_at: new Date().toISOString() })
        .where(eq(adaptationProposals.id, row.proposal.id));
      return { ok: false as const, error: "adaptation_stale" };
    }
    const [activeSession] = await tx
      .select({ id: workoutSessions.id })
      .from(workoutSessions)
      .where(and(eq(workoutSessions.user_id, userId), eq(workoutSessions.status, "active")))
      .limit(1);
    if (activeSession) return { ok: false as const, error: "active_workout_in_progress" };

    const decidedAt = new Date().toISOString();
    if (input.option_id === "keep") {
      await tx
        .update(adaptationProposals)
        .set({ status: "kept", decided_at: decidedAt })
        .where(
          and(
            eq(adaptationProposals.id, row.proposal.id),
            eq(adaptationProposals.status, "pending"),
          ),
        );
      return {
        ok: true as const,
        status: "kept" as const,
        program_revision: row.program.revision,
        idempotent_replay: false,
      };
    }

    const option = normalizeOptions(row.proposal.options).find(
      (candidate) => candidate.id === input.option_id,
    );
    if (!option) return { ok: false as const, error: "adaptation_option_not_found" };
    const changes: unknown[] = [];
    for (const action of option.actions) {
      if (action.type === "exercise_adjustment") {
        changes.push(...(await applyExerciseAction(tx, row.program.id, action)));
      } else if (action.type === "schedule_shift") {
        changes.push(...(await applyScheduleAction(tx, row.program, action)));
      } else if (action.type === "deload_week") {
        changes.push(...(await applyDeloadAction(tx, row.program, action)));
      } else {
        throw new Error("unsupported_adaptation_action");
      }
    }
    const [updatedProgram] = await tx
      .update(programs)
      .set({ revision: sql`${programs.revision} + 1` })
      .where(and(eq(programs.id, row.program.id), eq(programs.revision, row.program.revision)))
      .returning({ revision: programs.revision });
    if (!updatedProgram) throw new Error("adaptation_program_revision_conflict");
    await tx
      .update(adaptationProposals)
      .set({
        status: "applied",
        selected_option_id: option.id,
        applied_changes: changes,
        decided_at: decidedAt,
      })
      .where(
        and(eq(adaptationProposals.id, row.proposal.id), eq(adaptationProposals.status, "pending")),
      );
    return {
      ok: true as const,
      status: "applied" as const,
      selected_option_id: option.id,
      program_revision: updatedProgram.revision,
      changes: changes.length,
      idempotent_replay: false,
    };
  });
}

export async function getAdaptationHistory(
  userId: string,
  options: { programId?: string | null; limit?: number } = {},
) {
  const limit = Math.max(1, Math.min(50, Math.trunc(options.limit ?? 20)));
  const predicates = [
    eq(adaptationProposals.user_id, userId),
    sql`${adaptationProposals.status} <> 'pending'`,
  ];
  if (options.programId) predicates.push(eq(adaptationProposals.program_id, options.programId));
  const rows = await getDb()
    .select({
      proposal: adaptationProposals,
      review: workoutReviews,
      session_title: workoutSessions.title,
      session_date: workoutSessions.session_date,
    })
    .from(adaptationProposals)
    .innerJoin(workoutReviews, eq(workoutReviews.id, adaptationProposals.review_id))
    .innerJoin(workoutSessions, eq(workoutSessions.id, workoutReviews.session_id))
    .where(and(...predicates))
    .orderBy(desc(adaptationProposals.created_at))
    .limit(limit);
  return rows.map((row) => ({
    ...publicProposal(row.proposal),
    review: {
      difficulty: row.review.difficulty,
      energy: row.review.energy,
      discomfort: row.review.discomfort,
      note: row.review.note,
    },
    session_title: row.session_title,
    session_date: row.session_date,
  }));
}

export async function getLatestAdaptationContext(userId: string) {
  const [row] = await getDb()
    .select({
      review: workoutReviews,
      session_title: workoutSessions.title,
      session_date: workoutSessions.session_date,
      proposal: adaptationProposals,
    })
    .from(workoutReviews)
    .innerJoin(workoutSessions, eq(workoutSessions.id, workoutReviews.session_id))
    .leftJoin(adaptationProposals, eq(adaptationProposals.review_id, workoutReviews.id))
    .where(eq(workoutReviews.user_id, userId))
    .orderBy(desc(workoutReviews.created_at))
    .limit(1);
  if (!row) return null;
  return {
    session_title: row.session_title,
    session_date: row.session_date,
    review: {
      difficulty: row.review.difficulty,
      energy: row.review.energy,
      discomfort: row.review.discomfort,
      note: row.review.note,
    },
    proposal: row.proposal ? publicProposal(row.proposal) : null,
  };
}

export function summarizeAdaptationForCoach(
  context: Awaited<ReturnType<typeof getLatestAdaptationContext>>,
  language: "en" | "sv",
) {
  if (!context) return language === "sv" ? "(ingen träningskontroll)" : "(no workout check-in)";
  const proposal = context.proposal;
  const options = proposal
    ? proposal.options
        .map((option) => `- ${language === "sv" ? option.title_sv : option.title_en}`)
        .join("\n")
    : language === "sv"
      ? "(ingen säker programändring föreslås ännu)"
      : "(no safe program change is proposed yet)";
  return `${context.session_date} — ${context.session_title}
Difficulty ${context.review.difficulty}/5 · Energy ${context.review.energy}/5 · Pain/discomfort ${context.review.discomfort}/5
Optional note: ${context.review.note ?? "(none)"}
Proposal status: ${proposal?.status ?? "none"}
Safe options:
${options}`;
}
