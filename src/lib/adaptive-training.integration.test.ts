import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import { profiles, users } from "@/db/schema";
import {
  decideAdaptation,
  getAdaptationHistory,
  getPendingAdaptation,
  proposeAdaptationSubstitution,
  submitWorkoutReview,
} from "@/lib/adaptive-training.server";
import { adjustProgramExercise, generateProgram, getActiveProgram } from "@/lib/program.server";
import {
  completeSession,
  getActiveSession,
  markSetDone,
  startSession,
} from "@/lib/workout-session.server";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const createdUsers: string[] = [];

async function createUser(coachId = "rex") {
  const userId = randomUUID();
  createdUsers.push(userId);
  await getDb()
    .insert(users)
    .values({
      id: userId,
      email: `adaptive-${userId}@example.invalid`,
      password_hash: "not-a-real-login",
    });
  await getDb().insert(profiles).values({
    id: userId,
    display_name: "Adaptive Test",
    coach_id: coachId,
    onboarding_completed: true,
    data_epoch: 0,
  });
  await generateProgram(userId, {
    name: "Adaptive Cycle",
    goal: "strength",
    experience: "intermediate",
    start_date: "2040-01-02",
    weeks: 3,
    session_minutes: 45,
    schedule_mode: "rolling",
    weekday_indices: [],
    deload_weeks: [],
    progression_rules: "Add one 2.5 kg step after successful exposure.",
    why: "Adaptive engine integration coverage.",
    week_template: [
      {
        title: "Full Body",
        exercises: [
          {
            exercise_id: "bench-press",
            sets: 2,
            rep_range: "6–8",
            start_weight_kg: 60,
            increment_kg: 2.5,
            increment_every_weeks: 1,
          },
        ],
      },
    ],
  });
  return userId;
}

async function completePlannedWorkout(userId: string, date: string, actualReps = 8) {
  const started = await startSession(userId, {
    date,
    source_key: `adaptive-start:${userId}:${date}`,
    expected_data_epoch: 0,
  });
  if (!started.ok || !started.session) throw new Error("workout_not_started");
  let session = await getActiveSession(userId);
  if (!session) throw new Error("active_session_missing");
  for (const set of session.exercises.flatMap((exercise) => exercise.sets)) {
    const saved = await markSetDone(userId, set.id, {
      completed: true,
      weight_kg: set.target_weight_kg,
      reps: actualReps,
      expected_revision: set.revision,
      expected_data_epoch: 0,
    });
    if (!saved.ok || !saved.session) throw new Error("workout_set_not_saved");
    session = saved.session;
  }
  const completed = await completeSession(userId, {
    session_id: session.id,
    planned_minutes: 45,
    override_reason: "Integration test records a completed offline workout.",
    expected_data_epoch: 0,
  });
  expect(completed.ok).toBe(true);
  return session.id;
}

async function submitReview(
  userId: string,
  sessionId: string,
  values = { difficulty: 3, energy: 4, discomfort: 1 },
) {
  return submitWorkoutReview(userId, {
    session_id: sessionId,
    ...values,
    note: null,
    expected_data_epoch: 0,
  });
}

afterEach(async () => {
  while (createdUsers.length) {
    const userId = createdUsers.pop();
    if (userId) await getDb().delete(users).where(eq(users.id, userId));
  }
});

describe.runIf(hasDatabase).sequential("adaptive progression database integration", () => {
  it("waits for two successes, applies future changes atomically, and replays safely", async () => {
    const userId = await createUser("rex");
    const firstSession = await completePlannedWorkout(userId, "2040-01-02");
    const first = await submitReview(userId, firstSession);
    expect(first).toMatchObject({ ok: true, proposal: null });

    const secondSession = await completePlannedWorkout(userId, "2040-01-09");
    const second = await submitReview(userId, secondSession);
    expect(second.ok).toBe(true);
    if (!second.ok || !second.proposal) throw new Error("proposal_missing");
    expect(second.proposal.options[0]?.id).toBe("progress");

    const before = await getActiveProgram(userId, "2040-01-09");
    const completedTargets = before?.days
      .filter((day) => day.status === "completed")
      .flatMap((day) => day.exercises.map((exercise) => exercise.target_weight_kg));
    const nextBefore = before?.days.find((day) => day.status === "planned")?.exercises[0]
      ?.target_weight_kg;

    const applied = await decideAdaptation(userId, {
      proposal_id: second.proposal.id,
      option_id: "progress",
      expected_program_revision: second.proposal.program_revision,
      expected_data_epoch: 0,
    });
    expect(applied).toMatchObject({ ok: true, status: "applied", program_revision: 1 });
    const replay = await decideAdaptation(userId, {
      proposal_id: second.proposal.id,
      option_id: "progress",
      expected_program_revision: second.proposal.program_revision,
      expected_data_epoch: 0,
    });
    expect(replay).toMatchObject({ ok: true, idempotent_replay: true });

    const after = await getActiveProgram(userId, "2040-01-09");
    expect(
      after?.days
        .filter((day) => day.status === "completed")
        .flatMap((day) => day.exercises.map((exercise) => exercise.target_weight_kg)),
    ).toEqual(completedTargets);
    expect(
      after?.days.find((day) => day.status === "planned")?.exercises[0]?.target_weight_kg,
    ).toBe((nextBefore ?? 0) + 2.5);
    expect(await getPendingAdaptation(userId)).toBeNull();
    expect(await getAdaptationHistory(userId, { programId: after?.id })).toHaveLength(1);
  });

  it("keeps the program unchanged when the user rejects the proposal", async () => {
    const userId = await createUser("eli");
    await submitReview(userId, await completePlannedWorkout(userId, "2040-01-02"));
    const result = await submitReview(userId, await completePlannedWorkout(userId, "2040-01-09"));
    if (!result.ok || !result.proposal) throw new Error("proposal_missing");
    const before = await getActiveProgram(userId, "2040-01-09");
    await expect(
      decideAdaptation(userId, {
        proposal_id: result.proposal.id,
        option_id: "keep",
        expected_program_revision: result.proposal.program_revision,
        expected_data_epoch: 0,
      }),
    ).resolves.toMatchObject({ ok: true, status: "kept", program_revision: 0 });
    const after = await getActiveProgram(userId, "2040-01-09");
    expect(after?.revision).toBe(before?.revision);
    expect(after?.days).toEqual(before?.days);
  });

  it("marks a proposal stale after another program mutation and isolates accounts", async () => {
    const owner = await createUser("reya");
    const stranger = await createUser("maya");
    await submitReview(owner, await completePlannedWorkout(owner, "2040-01-02"));
    const result = await submitReview(owner, await completePlannedWorkout(owner, "2040-01-09"));
    if (!result.ok || !result.proposal) throw new Error("proposal_missing");
    expect(await getPendingAdaptation(stranger)).toBeNull();
    await expect(
      decideAdaptation(stranger, {
        proposal_id: result.proposal.id,
        option_id: "progress",
        expected_program_revision: result.proposal.program_revision,
        expected_data_epoch: 0,
      }),
    ).resolves.toMatchObject({ ok: false, error: "adaptation_not_found" });

    await adjustProgramExercise(owner, {
      exercise: "bench-press",
      from_week: 3,
      delta_kg: 2.5,
      source_key: `manual-change:${owner}`,
      expected_data_epoch: 0,
    });
    await expect(
      decideAdaptation(owner, {
        proposal_id: result.proposal.id,
        option_id: "progress",
        expected_program_revision: result.proposal.program_revision,
        expected_data_epoch: 0,
      }),
    ).resolves.toMatchObject({ ok: false, error: "adaptation_stale" });
    expect((await getAdaptationHistory(owner))[0]?.status).toBe("stale");
  });

  it("offers and applies a bounded deload after repeated poor recovery", async () => {
    const userId = await createUser("nova");
    await submitReview(userId, await completePlannedWorkout(userId, "2040-01-02", 6), {
      difficulty: 4,
      energy: 2,
      discomfort: 1,
    });
    const result = await submitReview(
      userId,
      await completePlannedWorkout(userId, "2040-01-09", 6),
      { difficulty: 4, energy: 2, discomfort: 1 },
    );
    if (!result.ok || !result.proposal) throw new Error("proposal_missing");
    expect(result.proposal.options.map((option) => option.id)).toContain("deload");
    await expect(
      decideAdaptation(userId, {
        proposal_id: result.proposal.id,
        option_id: "deload",
        expected_program_revision: result.proposal.program_revision,
        expected_data_epoch: 0,
      }),
    ).resolves.toMatchObject({ ok: true, status: "applied" });
    const program = await getActiveProgram(userId, "2040-01-09");
    const remaining = program?.days.find((day) => day.status === "planned");
    expect(remaining?.is_deload).toBe(true);
    expect(remaining?.exercises[0]).toMatchObject({ sets: 1, target_weight_kg: 57.5 });
  });

  it("stores high-pain feedback without generating an unsafe progression", async () => {
    const userId = await createUser("brutus");
    const result = await submitReview(userId, await completePlannedWorkout(userId, "2040-01-02"), {
      difficulty: 2,
      energy: 5,
      discomfort: 5,
    });
    expect(result).toMatchObject({ ok: true, requires_follow_up: true });
    if (!result.ok) throw new Error("review_failed");
    expect(result.proposal?.options.every((option) => option.id !== "progress") ?? true).toBe(true);
  });

  it("requires clarification and one-tap approval for a catalog substitution", async () => {
    const userId = await createUser("maya");
    const result = await submitReview(userId, await completePlannedWorkout(userId, "2040-01-02"), {
      difficulty: 3,
      energy: 4,
      discomfort: 3,
    });
    if (!result.ok || !result.proposal) throw new Error("pain_proposal_missing");

    const proposed = await proposeAdaptationSubstitution(userId, {
      exercise_id: "bench-press",
      replacement_exercise_ids: ["dumbbell-bench-press"],
      clarification: "Sharp shoulder discomfort during the bottom portion of bench press.",
      expected_program_revision: result.proposal.program_revision,
      expected_data_epoch: 0,
    });
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    expect(proposed).toMatchObject({
      ok: true,
      proposal: {
        options: [
          {
            id: "substitute:dumbbell-bench-press",
            actions: [
              {
                type: "exercise_adjustment",
                exercise_id: "bench-press",
                replacement_exercise_id: "dumbbell-bench-press",
              },
            ],
          },
        ],
      },
    });
    if (!proposed.ok) throw new Error("substitution_not_proposed");
    await expect(
      decideAdaptation(userId, {
        proposal_id: proposed.proposal.id,
        option_id: "substitute:dumbbell-bench-press",
        expected_program_revision: proposed.proposal.program_revision,
        expected_data_epoch: 0,
      }),
    ).resolves.toMatchObject({ ok: true, status: "applied" });
    const program = await getActiveProgram(userId, "2040-01-03");
    expect(
      program?.days
        .filter((day) => day.status === "planned")
        .every((day) => day.exercises[0]?.exercise_id === "dumbbell-bench-press"),
    ).toBe(true);
  });
});
