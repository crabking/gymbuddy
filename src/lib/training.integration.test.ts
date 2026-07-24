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

const hasDatabase = Boolean(process.env.DATABASE_URL);

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
      week_template: ["Upper A", "Lower A", "Upper B", "Lower B"].map((title) => ({
        title,
        exercises: [{ name: `${title} lift`, sets: 3, rep_range: "8", start_weight_kg: 50 }],
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
      (exercise) => exercise.name === "Upper A lift",
    )?.target_weight_kg;
    if (beforeAdjustment == null) throw new Error("Missing bench target");
    const adjustmentKey = `adjust-bench-${userId}`;
    await expect(
      adjustProgramExercise(userId, {
        exercise: "Upper A lift",
        from_week: 1,
        delta_kg: 5,
        set_weight_kg: null,
        source_key: adjustmentKey,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      adjustProgramExercise(userId, {
        exercise: "Upper A lift",
        from_week: 1,
        delta_kg: 5,
        set_weight_kg: null,
        source_key: adjustmentKey,
      }),
    ).resolves.toMatchObject({ ok: true, idempotent_replay: true });
    await expect(
      adjustProgramExercise(userId, {
        exercise: "Upper A lift",
        from_week: 1,
        delta_kg: 10,
        set_weight_kg: null,
        source_key: adjustmentKey,
      }),
    ).resolves.toMatchObject({ ok: false, error: "idempotency_key_reused" });
    const afterAdjustment = await getActiveProgram(userId, "2030-02-04");
    expect(
      afterAdjustment?.days[0]?.exercises.find((exercise) => exercise.name === "Upper A lift")
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
