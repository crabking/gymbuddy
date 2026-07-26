import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import { profiles, users } from "@/db/schema";
import {
  adjustProgramExercise,
  generateProgram,
  getActiveProgram,
  getCurrentProgram,
  resolveProgramDay,
  shiftProgramSchedule,
} from "@/lib/program.server";
import {
  completeSession,
  getActiveSession,
  getWorkoutHistory,
  markExerciseDone,
  markSetDone,
  startSession,
} from "@/lib/workout-session.server";
import { calculateTargetWeight } from "@/lib/training-logic";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabase).sequential("production-sized program generation", () => {
  const userId = randomUUID();
  const template = [
    {
      title: "Upper A",
      exercises: [
        ["bench-press", 4, "6-8", 70],
        ["barbell-row", 4, "8-10", 65],
        ["incline-dumbbell-press", 3, "8-12", 24],
        ["lat-pulldown", 3, "8-12", 55],
        ["lateral-raise", 3, "12-15", 8],
        ["triceps-pushdown", 3, "10-15", 25],
      ],
    },
    {
      title: "Lower A",
      exercises: [
        ["back-squat", 4, "6-8", 90],
        ["romanian-deadlift", 3, "8-10", 80],
        ["leg-press", 3, "10-12", 140],
        ["seated-leg-curl", 3, "10-15", 45],
        ["standing-calf-raise", 4, "10-15", 60],
        ["cable-crunch", 3, "10-15", 30],
      ],
    },
    {
      title: "Upper B",
      exercises: [
        ["overhead-press", 4, "6-8", 45],
        // Deliberately send bogus kilogram progression for a bodyweight
        // movement. The server boundary must discard it.
        ["pull-up", 4, "6-10", 0],
        ["chest-supported-row", 3, "8-12", 50],
        ["cable-fly", 3, "10-15", 20],
        ["barbell-curl", 3, "8-12", 30],
        ["skullcrusher", 3, "8-12", 25],
      ],
    },
    {
      title: "Lower B",
      exercises: [
        ["conventional-deadlift", 3, "4-6", 110],
        ["front-squat", 3, "6-10", 65],
        ["hip-thrust", 4, "8-12", 100],
        ["leg-extension", 3, "10-15", 50],
        ["seated-calf-raise", 4, "10-15", 45],
        ["hanging-leg-raise", 3, "8-15", null],
      ],
    },
  ].map((day) => ({
    title: day.title,
    focus: null,
    exercises: day.exercises.map(([exercise_id, sets, rep_range, start_weight_kg]) => ({
      exercise_id: exercise_id as string,
      sets: sets as number,
      rep_range: rep_range as string,
      start_weight_kg: start_weight_kg as number | null,
      increment_kg: start_weight_kg == null ? null : 2.5,
      increment_every_weeks: start_weight_kg == null ? null : 2,
      notes: null,
    })),
  }));

  beforeAll(async () => {
    const db = getDb();
    await db.insert(users).values({
      id: userId,
      email: `program-size-test-${userId}@example.invalid`,
      password_hash: "not-a-real-login",
    });
    await db.insert(profiles).values({
      id: userId,
      display_name: "Program Size Test",
      session_minutes: 60,
      onboarding_completed: true,
    });
  });

  afterAll(async () => {
    await getDb().delete(users).where(eq(users.id, userId));
  });

  it("rejects total-system weight for externally loaded bodyweight movements", async () => {
    await expect(
      generateProgram(userId, {
        name: "Invalid Weighted Pull-Up Convention",
        goal: "Verify external-load validation",
        experience: "advanced",
        start_date: "2031-01-06",
        weeks: 2,
        session_minutes: 60,
        deload_weeks: [],
        progression_rules: "Progress only the added load.",
        why: "A weighted pull-up target stores plates on the belt, not bodyweight plus plates.",
        athlete_bodyweight_kg: 80,
        source_key: `weighted-pull-up-convention-${userId}`,
        week_template: [
          {
            title: "Pull",
            exercises: [
              {
                exercise_id: "weighted-pull-up",
                sets: 3,
                rep_range: "5",
                start_weight_kg: 90,
                increment_kg: 2.5,
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow("weighted_bodyweight_load_must_be_external");
  });

  for (const weeks of [8, 12, 16]) {
    it(`materializes and activates a realistic ${weeks}-week program`, async () => {
      await generateProgram(userId, {
        name: `${weeks}-Week Upper Lower`,
        goal: "hypertrophy and strength",
        experience: "intermediate",
        start_date: "2032-01-05",
        weeks,
        session_minutes: 60,
        deload_weeks: weeks === 8 ? [5] : weeks === 12 ? [5, 10] : [5, 10, 15],
        progression_rules: "Add 2.5 kg every two completed training weeks.",
        why: "Production-sized generation regression coverage.",
        replace_active_reason: weeks === 8 ? null : `Confirmed switch to ${weeks} weeks`,
        source_key: `program-size-${weeks}-${userId}`,
        week_template: template,
      });

      const program = await getActiveProgram(userId, "2032-01-05");
      expect(program).toMatchObject({
        name: `${weeks}-Week Upper Lower`,
        weeks,
        days_per_week: 4,
        status: "active",
      });
      expect(program?.days).toHaveLength(weeks * 4);
      expect(program?.days.every((day) => day.exercises.length === 6)).toBe(true);
      const pullUps = program?.days
        .flatMap((day) => day.exercises)
        .filter((exercise) => exercise.exercise_id === "pull-up");
      expect(pullUps).toHaveLength(weeks);
      expect(
        pullUps?.every(
          (exercise) => exercise.target_weight_kg === null && exercise.progression_step_kg === null,
        ),
      ).toBe(true);
    });
  }

  it("rebases a future load while preserving its progression and deload curve", async () => {
    const sourceKey = `program-rebase-${userId}`;
    await expect(
      adjustProgramExercise(userId, {
        exercise: "bench-press",
        from_week: 1,
        rebase_weight_kg: 80,
        increment_every_weeks: 2,
        source_key: sourceKey,
      }),
    ).resolves.toMatchObject({ ok: true, updated: 16 });
    await expect(
      adjustProgramExercise(userId, {
        exercise: "bench-press",
        from_week: 1,
        rebase_weight_kg: 80,
        increment_every_weeks: 2,
        source_key: sourceKey,
      }),
    ).resolves.toMatchObject({ ok: true, updated: 16, idempotent_replay: true });

    const program = await getActiveProgram(userId, "2032-01-05");
    const benchDays =
      program?.days.filter((day) =>
        day.exercises.some((exercise) => exercise.exercise_id === "bench-press"),
      ) ?? [];
    let completedTrainingWeeks = 0;
    const expected = benchDays.map((day) => {
      const target = calculateTargetWeight({
        startWeightKg: 80,
        incrementKg: 2.5,
        incrementEveryWeeks: 2,
        completedTrainingWeeks,
        isDeload: day.is_deload,
      });
      if (!day.is_deload) completedTrainingWeeks += 1;
      return target;
    });
    const actual = benchDays.map(
      (day) =>
        day.exercises.find((exercise) => exercise.exercise_id === "bench-press")?.target_weight_kg,
    );
    expect(actual).toEqual(expected);
    expect(new Set(actual).size).toBeGreaterThan(2);
    expect(actual[0]).toBe(80);
    expect(actual.at(-1)).toBeGreaterThan(80);
  });
});

describe.runIf(hasDatabase).sequential("honest partial workout completion", () => {
  const userId = randomUUID();

  beforeAll(async () => {
    const db = getDb();
    await db.insert(users).values({
      id: userId,
      email: `partial-workout-${userId}@example.invalid`,
      password_hash: "not-a-real-login",
    });
    await db.insert(profiles).values({
      id: userId,
      display_name: "Partial Workout Test",
      session_minutes: 60,
      onboarding_completed: true,
    });
    await generateProgram(userId, {
      name: "Partial Workout Cycle",
      goal: "Verify exact performed volume",
      experience: "intermediate",
      start_date: "2037-01-05",
      weeks: 1,
      session_minutes: 60,
      deload_weeks: [],
      progression_rules: "Only progress from performed work.",
      why: "Regression coverage for ending a workout after two of three sets.",
      source_key: `partial-workout-program-${userId}`,
      week_template: [
        {
          title: "Day 1 — Upper",
          focus: "Bench practice",
          exercises: [
            {
              exercise_id: "bench-press",
              sets: 3,
              rep_range: "5",
              start_weight_kg: 60,
              increment_kg: 2.5,
              increment_every_weeks: 1,
            },
          ],
        },
      ],
    });
  });

  afterAll(async () => {
    await getDb().delete(users).where(eq(users.id, userId));
  });

  it("preserves two performed sets and closes without inventing the third", async () => {
    const program = await getActiveProgram(userId, "2037-01-05");
    const day = program?.days[0];
    if (!day) throw new Error("partial_program_day_missing");
    const started = await startSession(userId, {
      date: day.date,
      programDayId: day.id,
      source_key: `partial-workout-start-${userId}`,
    });
    if (!started.ok || !started.session) throw new Error("partial_workout_start_failed");
    const [first, second, third] = started.session.exercises[0].sets;
    for (const set of [first, second]) {
      if (!set) throw new Error("partial_workout_set_missing");
      const marked = await markSetDone(userId, set.id, {
        completed: true,
        weight_kg: 60,
        reps: 5,
        expected_revision: set.revision,
      });
      expect(marked).toMatchObject({ ok: true });
    }

    await expect(
      completeSession(userId, {
        planned_minutes: 60,
        override_reason: "The performed work was logged after training offline.",
        session_id: started.session.id,
      }),
    ).resolves.toMatchObject({ ok: false, error: "incomplete_workout" });

    const completed = await completeSession(userId, {
      planned_minutes: 60,
      override_reason: "The performed work was logged after training offline.",
      actual_duration_minutes: 35,
      partial_reason: "The third set caused form to break down, so the user stopped.",
      session_id: started.session.id,
    });
    expect(completed).toMatchObject({
      ok: true,
      partial: true,
      cycle_completed: true,
      duration_min: 35,
    });

    const history = await getWorkoutHistory(userId, { limit: 5 });
    expect(history[0]).toMatchObject({
      status: "completed",
      duration_minutes: 35,
      end_reason:
        "completed_partial: The third set caused form to break down, so the user stopped.",
    });
    expect(history[0].exercises[0].sets).toEqual([
      expect.objectContaining({ completed: true, weight_kg: 60, reps: 5 }),
      expect.objectContaining({ completed: true, weight_kg: 60, reps: 5 }),
      expect.objectContaining({
        id: third?.id,
        completed: false,
        weight_kg: null,
        reps: null,
      }),
    ]);
  });
});

describe.runIf(hasDatabase).sequential("training lifecycle database integration", () => {
  const userId = randomUUID();

  beforeAll(async () => {
    const db = getDb();
    await db.insert(users).values({
      id: userId,
      email: `training-test-${userId}@example.invalid`,
      password_hash: "not-a-real-login",
    });
    await db.insert(profiles).values({
      id: userId,
      display_name: "Training Test",
      session_minutes: 60,
      onboarding_completed: true,
    });
  });

  afterAll(async () => {
    await getDb().delete(users).where(eq(users.id, userId));
  });

  it("atomically materializes a complete dated program", async () => {
    await generateProgram(userId, {
      name: "Integration Cycle",
      goal: "strength",
      experience: "intermediate",
      start_date: "2030-01-07",
      weeks: 1,
      session_minutes: 60,
      deload_weeks: [],
      progression_rules: "Add 2.5 kg when all sets are completed.",
      why: "Integration coverage.",
      week_template: [
        {
          title: "Day A",
          exercises: [{ name: "Squat", sets: 3, rep_range: "5", start_weight_kg: 80 }],
        },
        {
          title: "Day B",
          exercises: [{ name: "Bench", sets: 2, rep_range: "5", start_weight_kg: 60 }],
        },
      ],
    });

    const program = await getActiveProgram(userId, "2030-01-07");
    expect(program?.status).toBe("active");
    expect(program?.days).toHaveLength(2);
    expect(program?.days.map((day) => day.date)).toEqual(["2030-01-07", "2030-01-10"]);
  });

  it("resumes the same workout without losing saved sets", async () => {
    const program = await getActiveProgram(userId, "2030-01-08");
    const firstProgramDay = program?.days[0];
    const secondProgramDay = program?.days[1];
    if (!firstProgramDay || !secondProgramDay) throw new Error("Missing program days");
    const initialStarts = await Promise.all(
      Array.from({ length: 6 }, () =>
        startSession(userId, {
          date: "2030-01-08",
          programDayId: firstProgramDay.id,
          source_key: `ui-start-race-${userId}`,
        }),
      ),
    );
    expect(initialStarts.every((result) => result.ok)).toBe(true);
    expect(initialStarts.filter((result) => result.ok && !result.resumed)).toHaveLength(1);
    const first = initialStarts.find((result) => result.ok && !result.resumed);
    if (!first?.ok || !first.session) throw new Error("Workout did not start");
    expect(first.session.session_date).toBe("2030-01-08");
    expect(first.session.program_day_id).toBe(firstProgramDay.id);
    expect(first.session.exercises[0].sets[0]).toMatchObject({
      target_weight_kg: 80,
      weight_kg: null,
      reps: null,
    });
    expect(
      await startSession(userId, {
        date: "2030-01-09",
        programDayId: firstProgramDay.id,
        source_key: `ui-start-race-${userId}`,
      }),
    ).toMatchObject({ ok: false, error: "idempotency_key_reused" });
    await expect(
      generateProgram(userId, {
        name: "Must not replace an active workout",
        goal: "strength",
        experience: "intermediate",
        start_date: "2030-03-01",
        weeks: 2,
        session_minutes: 60,
        deload_weeks: [],
        progression_rules: "Keep progressing.",
        why: "Race-safety test.",
        replace_active_reason: "The user explicitly requested a new cycle.",
        source_key: `blocked-active-workout-${userId}`,
        week_template: [
          {
            title: "Blocked",
            exercises: [{ name: "Squat", sets: 2, rep_range: "5" }],
          },
        ],
      }),
    ).rejects.toThrow("active_workout_in_progress");

    const exercise = first.session.exercises[0];
    expect(await markExerciseDone(userId, exercise.name, true)).toMatchObject({
      ok: false,
      error: "performed_sets_required",
    });
    const partialSource = `mark-squat-partial-${userId}`;
    const partialResult = await markExerciseDone(
      userId,
      exercise.name,
      true,
      [{ weight_kg: 80, reps: 5 }],
      { source_key: partialSource },
    );
    expect(partialResult).toMatchObject({
      ok: true,
      idempotent_replay: false,
      session: {
        exercises: [
          {
            completed: false,
            sets: [
              { completed: true, weight_kg: 80, reps: 5 },
              { completed: false },
              { completed: false },
            ],
          },
        ],
      },
    });
    expect(
      await markExerciseDone(userId, exercise.name, true, [{ weight_kg: 80, reps: 5 }], {
        source_key: partialSource,
      }),
    ).toMatchObject({ ok: true, idempotent_replay: true });
    expect(
      await markExerciseDone(userId, exercise.name, true, [{ weight_kg: 80, reps: 6 }], {
        source_key: partialSource,
      }),
    ).toMatchObject({ ok: false, error: "idempotency_key_reused" });

    const finished = await markExerciseDone(
      userId,
      exercise.name,
      true,
      [
        { weight_kg: 80, reps: 5 },
        { weight_kg: 80, reps: 5 },
        { weight_kg: 80, reps: 5 },
        { weight_kg: 77.5, reps: 8 },
      ],
      { source_key: `mark-squat-full-${userId}` },
    );
    expect(finished).toMatchObject({ ok: true, session: { done: 1 } });
    expect(finished.session?.exercises[0].sets).toHaveLength(4);

    const correctionSource = `mark-squat-correction-${userId}`;
    const corrected = await markExerciseDone(
      userId,
      exercise.name,
      true,
      [
        { weight_kg: 80, reps: 5 },
        { weight_kg: 80, reps: 5 },
      ],
      { source_key: correctionSource },
    );
    expect(corrected).toMatchObject({
      ok: true,
      idempotent_replay: false,
      session: {
        done: 0,
        exercises: [
          {
            completed: false,
            sets: [
              { set_index: 1, completed: true, weight_kg: 80, reps: 5 },
              { set_index: 2, completed: true, weight_kg: 80, reps: 5 },
              {
                set_index: 3,
                target_reps: "5",
                target_weight_kg: 80,
                completed: false,
                weight_kg: null,
                reps: null,
              },
            ],
          },
        ],
      },
    });
    expect(corrected.session?.exercises[0].sets).toHaveLength(3);
    expect(
      await markExerciseDone(
        userId,
        exercise.name,
        true,
        [
          { weight_kg: 80, reps: 5 },
          { weight_kg: 80, reps: 5 },
        ],
        { source_key: correctionSource },
      ),
    ).toMatchObject({ ok: true, idempotent_replay: true });
    expect(
      await markExerciseDone(
        userId,
        exercise.name,
        true,
        [
          { weight_kg: 80, reps: 5 },
          { weight_kg: 80, reps: 5 },
          { weight_kg: 80, reps: 5 },
        ],
        { source_key: correctionSource },
      ),
    ).toMatchObject({ ok: false, error: "idempotency_key_reused" });

    const restored = await markExerciseDone(
      userId,
      exercise.name,
      true,
      [
        { weight_kg: 80, reps: 5 },
        { weight_kg: 80, reps: 5 },
        { weight_kg: 80, reps: 5 },
        { weight_kg: 77.5, reps: 8 },
      ],
      { source_key: `mark-squat-restored-${userId}` },
    );
    expect(restored).toMatchObject({ ok: true, session: { done: 1 } });
    expect(restored.session?.exercises[0].sets).toHaveLength(4);
    expect(restored.session?.exercises[0].sets[3]).toMatchObject({
      set_index: 4,
      target_reps: null,
      target_weight_kg: null,
      completed: true,
      weight_kg: 77.5,
      reps: 8,
    });

    const retries = await Promise.all(
      Array.from({ length: 6 }, () =>
        startSession(userId, {
          date: "2030-01-08",
          programDayId: firstProgramDay.id,
        }),
      ),
    );
    expect(retries.every((result) => result.ok && result.resumed)).toBe(true);
    const sessionIds = retries
      .filter((result) => result.ok && result.session)
      .map((result) => (result.ok ? result.session?.id : null));
    expect(new Set(sessionIds)).toEqual(new Set([first.session.id]));

    const conflict = await startSession(userId, {
      date: "2030-01-08",
      programDayId: secondProgramDay.id,
    });
    expect(conflict).toMatchObject({ ok: false, error: "active_session_conflict" });

    const resumedSession = await getActiveSession(userId);
    if (!resumedSession) throw new Error("Workout did not resume");
    expect(resumedSession.exercises[0].sets.map((set) => [set.weight_kg, set.reps])).toEqual([
      [80, 5],
      [80, 5],
      [80, 5],
      [77.5, 8],
    ]);
  });

  it("refuses incomplete sessions and closes the cycle only after every day is resolved", async () => {
    const active = await getActiveSession(userId);
    if (!active) throw new Error("Missing active workout");

    expect(
      await resolveProgramDay(userId, {
        date: "2030-01-07",
        status: "skipped",
        reason: "This must be refused while the session is active.",
        source_key: `resolve-active-refusal-${userId}`,
      }),
    ).toMatchObject({ ok: false, error: "program_day_has_active_session" });

    await markExerciseDone(userId, active.exercises[0].name, false);
    const refused = await completeSession(userId, {
      planned_minutes: 60,
      override_reason: null,
    });
    expect(refused).toMatchObject({ ok: false, error: "incomplete_workout" });

    await markExerciseDone(userId, active.exercises[0].name, true, [
      { weight_kg: 82.5, reps: 5 },
      { weight_kg: 82.5, reps: 5 },
      { weight_kg: 82.5, reps: 5 },
      { weight_kg: 80, reps: 8 },
    ]);
    const completions = await Promise.all([
      completeSession(userId, {
        planned_minutes: 60,
        override_reason: "Integration test simulates a completed offline workout.",
        session_id: active.id,
      }),
      completeSession(userId, {
        planned_minutes: 60,
        override_reason: "Integration test checks duplicate completion protection.",
        session_id: active.id,
      }),
    ]);
    expect(completions.filter((result) => result.ok)).toHaveLength(2);
    expect(completions.find((result) => result.ok && !result.idempotent_replay)).toMatchObject({
      ok: true,
      cycle_completed: false,
    });
    expect(completions.filter((result) => result.ok && result.idempotent_replay)).toHaveLength(1);

    const history = await getWorkoutHistory(userId, {
      programId: active.program_day_id
        ? ((await getActiveProgram(userId, "2030-01-07"))?.id ?? null)
        : null,
    });
    expect(history[0].exercises[0].sets.map((set) => [set.weight_kg, set.reps])).toEqual([
      [82.5, 5],
      [82.5, 5],
      [82.5, 5],
      [80, 8],
    ]);

    const activeProgram = await getActiveProgram(userId, "2030-01-12");
    const secondDay = activeProgram?.days.find((day) => day.date === "2030-01-10");
    if (!secondDay) throw new Error("Missing second program day");
    const makeup = await startSession(userId, {
      date: "2030-01-12",
      programDayId: secondDay.id,
    });
    if (!makeup.ok || !makeup.session) throw new Error("Make-up workout did not start");
    expect(makeup.session.session_date).toBe("2030-01-12");
    expect(makeup.session.program_day_id).toBe(secondDay.id);
    const makeupSets = makeup.session.exercises[0].sets;
    const draftSave = await markSetDone(userId, makeupSets[0].id, {
      completed: false,
      weight_kg: 60,
      reps: 4,
      expected_revision: makeupSets[0].revision,
    });
    expect(draftSave).toMatchObject({ ok: true });
    const draftedSet = draftSave.session?.exercises
      .flatMap((exercise) => exercise.sets)
      .find((set) => set.id === makeupSets[0].id);
    expect(draftedSet).toMatchObject({
      completed: false,
      weight_kg: 60,
      reps: 4,
      revision: makeupSets[0].revision + 1,
    });
    if (!draftedSet) throw new Error("Draft set was not returned");
    const competingSetWrites = await Promise.all([
      markSetDone(userId, makeupSets[0].id, {
        completed: true,
        weight_kg: 60,
        reps: 5,
        expected_revision: draftedSet.revision,
      }),
      markSetDone(userId, makeupSets[0].id, {
        completed: true,
        weight_kg: 60,
        reps: 6,
        expected_revision: draftedSet.revision,
      }),
    ]);
    expect(competingSetWrites.filter((result) => result.ok)).toHaveLength(1);
    const staleWrite = competingSetWrites.find((result) => !result.ok);
    expect(staleWrite).toMatchObject({
      ok: false,
      error: "set_revision_conflict",
      latest_set: { revision: draftedSet.revision + 1 },
    });
    const [, racedCompletion] = await Promise.all([
      markSetDone(userId, makeupSets[1].id, {
        completed: true,
        weight_kg: 60,
        reps: 5,
        expected_revision: makeupSets[1].revision,
      }),
      completeSession(userId, {
        planned_minutes: 60,
        override_reason: "Integration test races the final set with completion.",
        session_id: makeup.session.id,
      }),
    ]);
    const resolved = racedCompletion.ok
      ? racedCompletion
      : await completeSession(userId, {
          planned_minutes: 60,
          override_reason: "Integration test completes a make-up workout.",
          session_id: makeup.session.id,
        });
    expect(resolved).toMatchObject({ ok: true, cycle_completed: true });
    expect(await getActiveProgram(userId, "2030-01-10")).toBeNull();
    expect((await getCurrentProgram(userId, "2030-01-10"))?.status).toBe("completed");
  });

  it("reactivates only the latest completed cycle when its skipped final day is corrected", async () => {
    const created = await generateProgram(userId, {
      name: "Correction Cycle",
      goal: "strength",
      experience: "intermediate",
      start_date: "2030-01-21",
      weeks: 1,
      session_minutes: 60,
      deload_weeks: [],
      progression_rules: "Resume safely after a mistaken skip.",
      why: "Exercise completed-cycle correction.",
      source_key: `correction-cycle-${userId}`,
      week_template: [
        {
          title: "Correction Day",
          exercises: [{ name: "Deadlift", sets: 2, rep_range: "5", start_weight_kg: 100 }],
        },
      ],
    });
    const skipSource = `skip-correction-day-${userId}`;
    await expect(
      resolveProgramDay(userId, {
        date: "2030-01-21",
        status: "skipped",
        reason: "The user initially confirmed this day was skipped.",
        source_key: skipSource,
      }),
    ).resolves.toMatchObject({ ok: true, cycle_completed: true, status: "skipped" });
    expect(await getActiveProgram(userId, "2030-01-21")).toBeNull();

    await expect(
      resolveProgramDay(userId, {
        date: "2030-01-07",
        status: "planned",
        reason: "An old cycle must never be selected by date.",
        source_key: `old-cycle-reopen-${userId}`,
      }),
    ).resolves.toMatchObject({ ok: false, error: "program_day_not_found" });

    const reopenSource = `reopen-correction-day-${userId}`;
    const reopened = await resolveProgramDay(userId, {
      date: "2030-01-21",
      status: "planned",
      reason: "The user corrected the mistaken skip.",
      source_key: reopenSource,
    });
    expect(reopened).toMatchObject({
      ok: true,
      cycle_completed: false,
      status: "planned",
    });
    expect((await getActiveProgram(userId, "2030-01-21"))?.id).toBe(created.program_id);
    await expect(
      resolveProgramDay(userId, {
        date: "2030-01-21",
        status: "planned",
        reason: "The user corrected the mistaken skip.",
        source_key: reopenSource,
      }),
    ).resolves.toMatchObject({ ok: true, idempotent_replay: true });
    await expect(
      resolveProgramDay(userId, {
        date: "2030-01-21",
        status: "planned",
        reason: "A different payload cannot reuse the key.",
        source_key: reopenSource,
      }),
    ).resolves.toMatchObject({ ok: false, error: "idempotency_key_reused" });
    await expect(
      resolveProgramDay(userId, {
        date: "2030-01-21",
        status: "skipped",
        reason: "The user confirmed the final outcome after correction.",
        source_key: `reskip-correction-day-${userId}`,
      }),
    ).resolves.toMatchObject({ ok: true, cycle_completed: true });
  });

  it("starts a new 16-week cycle without deleting the previous cycle history", async () => {
    const fullCycleInput = {
      name: "Full 16 Week Cycle",
      goal: "hypertrophy",
      experience: "intermediate",
      start_date: "2030-02-04",
      weeks: 16,
      session_minutes: 60,
      deload_weeks: [5, 10, 15],
      progression_rules: "Progress after successful training weeks.",
      why: "Exercise the full production-sized cycle.",
      week_template: [
        { title: "Upper A", exercise_id: "bench-press", name: "Bench Press" },
        { title: "Lower A", exercise_id: "back-squat", name: "Back Squat" },
        { title: "Upper B", exercise_id: "barbell-row", name: "Barbell Row" },
        { title: "Lower B", exercise_id: "romanian-deadlift", name: "Romanian Deadlift" },
      ].map(({ title, exercise_id, name }) => ({
        title,
        exercises: [{ exercise_id, name, sets: 3, rep_range: "8", start_weight_kg: 50 }],
      })),
      source_key: `full-cycle-${userId}`,
    };
    const created = await generateProgram(userId, fullCycleInput);
    const replay = await generateProgram(userId, fullCycleInput);
    expect(replay).toMatchObject({
      program_id: created.program_id,
      idempotent_replay: true,
    });
    await expect(
      generateProgram(userId, {
        ...fullCycleInput,
        name: "Different payload with reused key",
      }),
    ).rejects.toThrow("idempotency_key_reused");

    const active = await getActiveProgram(userId, "2030-02-04");
    expect(active?.status).toBe("active");
    expect(active?.days).toHaveLength(64);
    expect(active?.days.at(-1)?.week).toBe(16);

    const allHistory = await getWorkoutHistory(userId, { limit: 400 });
    expect(allHistory.some((session) => session.title === "Day A")).toBe(true);
    expect(allHistory.find((session) => session.title === "Day A")?.program_day?.program_name).toBe(
      "Integration Cycle",
    );

    const firstPlannedId = active?.days[0]?.id;
    const shifted = await shiftProgramSchedule(userId, {
      from_date: "2030-02-04",
      days: 7,
      reason: "Integration-test travel week.",
      source_key: `shift-travel-${userId}`,
    });
    expect(shifted).toMatchObject({ ok: true, shifted: 64 });
    await expect(
      shiftProgramSchedule(userId, {
        from_date: "2030-02-04",
        days: 7,
        reason: "Integration-test travel week.",
        source_key: `shift-travel-${userId}`,
      }),
    ).resolves.toMatchObject({ ok: true, shifted: 64, idempotent_replay: true });
    await expect(
      shiftProgramSchedule(userId, {
        from_date: "2030-02-04",
        days: 14,
        reason: "Integration-test travel week.",
        source_key: `shift-travel-${userId}`,
      }),
    ).resolves.toMatchObject({ ok: false, error: "idempotency_key_reused" });
    const shiftedProgram = await getActiveProgram(userId, "2030-02-04");
    expect(shiftedProgram?.days[0]).toMatchObject({
      id: firstPlannedId,
      date: "2030-02-11",
    });
    const beforeAdjustment = shiftedProgram?.days[0]?.exercises.find(
      (exercise) => exercise.exercise_id === "bench-press",
    )?.target_weight_kg;
    if (beforeAdjustment == null) throw new Error("Missing bench target");
    const adjustmentKey = `adjust-bench-${userId}`;
    await expect(
      adjustProgramExercise(userId, {
        exercise: "bench-press",
        from_week: 1,
        delta_kg: 5,
        set_weight_kg: null,
        source_key: adjustmentKey,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      adjustProgramExercise(userId, {
        exercise: "bench-press",
        from_week: 1,
        delta_kg: 5,
        set_weight_kg: null,
        source_key: adjustmentKey,
      }),
    ).resolves.toMatchObject({ ok: true, idempotent_replay: true });
    await expect(
      adjustProgramExercise(userId, {
        exercise: "bench-press",
        from_week: 1,
        delta_kg: 10,
        set_weight_kg: null,
        source_key: adjustmentKey,
      }),
    ).resolves.toMatchObject({ ok: false, error: "idempotency_key_reused" });
    const afterAdjustment = await getActiveProgram(userId, "2030-02-04");
    expect(
      afterAdjustment?.days[0]?.exercises.find((exercise) => exercise.exercise_id === "bench-press")
        ?.target_weight_kg,
    ).toBe(beforeAdjustment + 5);
    const resolutionKey = `resolve-shifted-day-${userId}`;
    await expect(
      resolveProgramDay(userId, {
        date: "2030-02-11",
        status: "skipped",
        reason: "Integration-test confirmed skip.",
        source_key: resolutionKey,
      }),
    ).resolves.toMatchObject({ ok: true, status: "skipped" });
    await expect(
      resolveProgramDay(userId, {
        date: "2030-02-11",
        status: "skipped",
        reason: "Integration-test confirmed skip.",
        source_key: resolutionKey,
      }),
    ).resolves.toMatchObject({ ok: true, status: "skipped", idempotent_replay: true });
    await expect(
      resolveProgramDay(userId, {
        date: "2030-02-11",
        status: "planned",
        reason: "Integration-test confirmed skip.",
        source_key: resolutionKey,
      }),
    ).resolves.toMatchObject({ ok: false, error: "idempotency_key_reused" });
    await expect(
      generateProgram(userId, {
        ...fullCycleInput,
        source_key: `unconfirmed-replacement-${userId}`,
      }),
    ).rejects.toThrow("active_program_requires_confirmed_replacement");
  });
});

describe.runIf(hasDatabase).sequential("adaptive beginner program integration", () => {
  const userId = randomUUID();

  beforeAll(async () => {
    const db = getDb();
    await db.insert(users).values({
      id: userId,
      email: `beginner-adaptation-${userId}@example.invalid`,
      password_hash: "not-a-real-login",
    });
    await db.insert(profiles).values({
      id: userId,
      display_name: "Beginner Adaptation Test",
      experience: "beginner",
      sex: "male",
      onboarding_completed: true,
    });
  });

  afterAll(async () => {
    await getDb().delete(users).where(eq(users.id, userId));
  });

  it("calibrates safely, starts today, and rewrites all unresolved weeks", async () => {
    await generateProgram(userId, {
      name: "Beginner Rolling Cycle",
      goal: "general strength",
      experience: "beginner",
      start_date: "2035-01-10",
      weeks: 2,
      session_minutes: 45,
      schedule_mode: "rolling",
      weekday_indices: [],
      deload_weeks: [],
      progression_rules: "Progress only after successful first-set calibration.",
      why: "Verify safe live adaptation.",
      beginner_calibration: { enabled: true, sex: "male" },
      week_template: [
        {
          title: "Day 1",
          exercises: [
            {
              exercise_id: "back-squat",
              sets: 3,
              rep_range: "5",
              start_weight_kg: 80,
              increment_kg: 5,
            },
            {
              exercise_id: "leg-press",
              sets: 2,
              rep_range: "8",
              start_weight_kg: 120,
              increment_kg: 10,
            },
          ],
        },
        {
          title: "Day 2",
          exercises: [
            {
              exercise_id: "bench-press",
              sets: 3,
              rep_range: "5",
              start_weight_kg: 60,
              increment_kg: 2.5,
            },
          ],
        },
      ],
    });

    const before = await getActiveProgram(userId, "2035-01-05");
    expect(
      before?.days
        .flatMap((day) => day.exercises)
        .filter((exercise) => exercise.exercise_id === "back-squat")
        .map((exercise) => exercise.target_weight_kg),
    ).toEqual([20, 20]);
    expect(
      before?.days
        .flatMap((day) => day.exercises)
        .filter((exercise) => exercise.exercise_id === "leg-press")
        .map((exercise) => exercise.target_weight_kg),
    ).toEqual([null, null]);

    const started = await startSession(userId, {
      date: "2035-01-05",
      start_next_now: true,
      source_key: `beginner-start-now-${userId}`,
    });
    expect(started).toMatchObject({ ok: true, resumed: false });
    if (!started.ok || !started.session) throw new Error("Beginner workout did not start");
    expect(started.session.session_date).toBe("2035-01-05");
    expect(started.session.exercises[0]?.sets[0]?.target_weight_kg).toBe(20);
    expect((await getActiveProgram(userId, "2035-01-05"))?.days.map((day) => day.date)).toEqual([
      "2035-01-05",
      "2035-01-08",
      "2035-01-12",
      "2035-01-15",
    ]);

    await expect(
      adjustProgramExercise(userId, {
        exercise: "back-squat",
        from_week: 1,
        replacement_exercise: "bodyweight-squat",
        source_key: `beginner-swap-${userId}`,
      }),
    ).resolves.toMatchObject({ ok: true, updated: 2, active_session_updated: true });

    const active = await getActiveSession(userId);
    expect(active?.exercises[0]).toMatchObject({
      exercise_id: "bodyweight-squat",
    });
    expect(active?.exercises[0]?.sets.every((set) => set.target_weight_kg === null)).toBe(true);
    const after = await getActiveProgram(userId, "2035-01-05");
    expect(
      after?.days
        .flatMap((day) => day.exercises)
        .filter((exercise) => exercise.exercise_id === "bodyweight-squat"),
    ).toHaveLength(2);
    expect(
      after?.days
        .flatMap((day) => day.exercises)
        .filter((exercise) => exercise.exercise_id === "bodyweight-squat")
        .every(
          (exercise) => exercise.target_weight_kg === null && exercise.progression_step_kg === null,
        ),
    ).toBe(true);
    expect(
      after?.days
        .flatMap((day) => day.exercises)
        .some((exercise) => exercise.exercise_id === "back-squat"),
    ).toBe(false);
  });
});

describe.runIf(hasDatabase).sequential("confirmed attendance skip integration", () => {
  const userId = randomUUID();

  beforeAll(async () => {
    const db = getDb();
    await db.insert(users).values({
      id: userId,
      email: `attendance-skip-${userId}@example.invalid`,
      password_hash: "not-a-real-login",
    });
    await db.insert(profiles).values({
      id: userId,
      display_name: "Attendance Test",
      coach_id: "brutus",
      experience: "advanced",
      onboarding_completed: true,
    });
    await generateProgram(userId, {
      name: "Three Week Attendance Test",
      goal: "powerlifting total",
      experience: "advanced",
      start_date: "2035-01-01",
      weeks: 3,
      session_minutes: 60,
      deload_weeks: [],
      progression_rules: "Only progress completed work.",
      why: "Verify confirmed skip persistence and pattern context.",
      source_key: `attendance-program-${userId}`,
      week_template: [
        {
          title: "Day 1 — Upper",
          exercises: [
            {
              exercise_id: "bench-press",
              sets: 3,
              rep_range: "5",
              start_weight_kg: 80,
              increment_kg: 2.5,
              increment_every_weeks: 1,
            },
          ],
        },
      ],
    });
  });

  afterAll(async () => {
    await getDb().delete(users).where(eq(users.id, userId));
  });

  it("requires the exact next day and current revision, then records three weekly reasons", async () => {
    const initial = await getActiveProgram(userId, "2035-01-01");
    if (!initial) throw new Error("attendance_program_missing");
    const first = initial.days[0]!;

    await expect(
      resolveProgramDay(userId, {
        date: first.date,
        day_id: randomUUID(),
        status: "skipped",
        reason: "Wrong stale card.",
        source_key: `attendance-wrong-day-${userId}`,
        expected_program_revision: initial.revision,
      }),
    ).resolves.toMatchObject({ ok: false, error: "program_day_not_found" });

    await expect(
      resolveProgramDay(userId, {
        date: first.date,
        day_id: first.id,
        status: "skipped",
        reason: "Work ran late.",
        source_key: `attendance-skip-1-${userId}`,
        auto_recover_progression: true,
        expected_program_revision: initial.revision,
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "skipped",
      reason: "Work ran late.",
      recovery: {
        kind: "hold_progression",
        affected_days: 2,
        affected_exercises: 2,
      },
    });

    const afterFirst = await getActiveProgram(userId, "2035-01-08");
    if (!afterFirst) throw new Error("attendance_program_closed_early");
    expect(
      afterFirst.days
        .filter((day) => day.status === "planned")
        .map((day) => day.exercises[0]?.target_weight_kg),
    ).toEqual([80, 82.5]);
    const second = afterFirst.days.find((day) => day.status === "planned")!;
    await expect(
      resolveProgramDay(userId, {
        date: second.date,
        day_id: second.id,
        status: "skipped",
        reason: "Did not feel like training.",
        source_key: `attendance-stale-revision-${userId}`,
        expected_program_revision: initial.revision,
      }),
    ).resolves.toMatchObject({ ok: false, error: "program_revision_conflict" });
    await expect(
      resolveProgramDay(userId, {
        date: second.date,
        day_id: second.id,
        status: "skipped",
        reason: "Did not feel like training.",
        source_key: `attendance-skip-2-${userId}`,
        auto_recover_progression: true,
        expected_program_revision: afterFirst.revision,
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "skipped",
      recovery: {
        kind: "hold_progression",
        affected_days: 1,
        affected_exercises: 1,
      },
    });

    const afterSecond = await getActiveProgram(userId, "2035-01-15");
    if (!afterSecond) throw new Error("attendance_program_closed_early");
    expect(
      afterSecond.days.find((day) => day.status === "planned")?.exercises[0]?.target_weight_kg,
    ).toBe(80);
    const third = afterSecond.days.find((day) => day.status === "planned")!;
    await expect(
      resolveProgramDay(userId, {
        date: third.date,
        day_id: third.id,
        status: "skipped",
        reason: "Work again.",
        source_key: `attendance-skip-3-${userId}`,
        auto_recover_progression: true,
        expected_program_revision: afterSecond.revision,
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "skipped",
      cycle_completed: true,
      recovery: { kind: "none", affected_days: 0, affected_exercises: 0 },
    });

    const finished = await getCurrentProgram(userId, "2035-01-15");
    expect(finished?.days.map((day) => day.resolution_note)).toEqual([
      "Work ran late.",
      "Did not feel like training.",
      "Work again.",
    ]);
  });
});

describe.runIf(hasDatabase).sequential("multi-day attendance recovery integration", () => {
  const userId = randomUUID();

  beforeAll(async () => {
    const db = getDb();
    await db.insert(users).values({
      id: userId,
      email: `attendance-scope-${userId}@example.invalid`,
      password_hash: "not-a-real-login",
    });
    await db.insert(profiles).values({
      id: userId,
      display_name: "Attendance Scope Test",
      coach_id: "brutus",
      experience: "advanced",
      onboarding_completed: true,
    });
    await generateProgram(userId, {
      name: "Four Day Attendance Scope Test",
      goal: "powerlifting total",
      experience: "advanced",
      start_date: "2036-01-01",
      weeks: 2,
      session_minutes: 60,
      deload_weeks: [],
      progression_rules: "Progress each weekly training slot independently.",
      why: "Verify one missed session never rolls back unrelated training days.",
      source_key: `attendance-scope-program-${userId}`,
      week_template: [
        {
          title: "Day 1 — Squat",
          exercises: [
            {
              exercise_id: "back-squat",
              sets: 3,
              rep_range: "5",
              start_weight_kg: 100,
              increment_kg: 2.5,
              increment_every_weeks: 1,
            },
          ],
        },
        {
          title: "Day 2 — Bench",
          exercises: [
            {
              exercise_id: "bench-press",
              sets: 3,
              rep_range: "5",
              start_weight_kg: 80,
              increment_kg: 2.5,
              increment_every_weeks: 1,
            },
          ],
        },
        {
          title: "Day 3 — Deadlift",
          exercises: [
            {
              exercise_id: "deadlift",
              sets: 3,
              rep_range: "5",
              start_weight_kg: 140,
              increment_kg: 5,
              increment_every_weeks: 1,
            },
          ],
        },
        {
          title: "Day 4 — Press",
          exercises: [
            {
              exercise_id: "overhead-press",
              sets: 3,
              rep_range: "5",
              start_weight_kg: 50,
              increment_kg: 2.5,
              increment_every_weeks: 1,
            },
          ],
        },
      ],
    });
  });

  afterAll(async () => {
    await getDb().delete(users).where(eq(users.id, userId));
  });

  it("holds only the matching weekly training slot after one of four sessions is skipped", async () => {
    const initial = await getActiveProgram(userId, "2036-01-01");
    if (!initial) throw new Error("attendance_scope_program_missing");
    const skipped = initial.days.find((day) => day.week === 1 && day.day_index === 2);
    if (!skipped) throw new Error("attendance_scope_day_missing");

    await expect(
      resolveProgramDay(userId, {
        date: skipped.date,
        day_id: skipped.id,
        status: "skipped",
        reason: "One isolated scheduling miss.",
        source_key: `attendance-scope-skip-${userId}`,
        auto_recover_progression: true,
        expected_program_revision: initial.revision,
      }),
    ).resolves.toMatchObject({
      ok: true,
      recovery: {
        kind: "hold_progression",
        scope: "matching_weekly_session",
        day_index: 2,
        affected_days: 1,
        affected_exercises: 1,
      },
    });

    const after = await getActiveProgram(userId, "2036-01-02");
    if (!after) throw new Error("attendance_scope_program_closed");
    const weekTwoLoads = Object.fromEntries(
      after.days
        .filter((day) => day.week === 2)
        .map((day) => [day.day_index, day.exercises[0]?.target_weight_kg]),
    );
    expect(weekTwoLoads).toEqual({
      1: 102.5,
      2: 80,
      3: 145,
      4: 52.5,
    });
  });
});
