import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import { profiles, users } from "@/db/schema";
import {
  generateProgram,
  getActiveProgram,
  getCurrentProgram,
  resolveProgramDay,
} from "@/lib/program.server";
import {
  completeSession,
  getActiveSession,
  getWorkoutHistory,
  markExerciseDone,
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
          exercises: [{ name: "Squat", sets: 2, rep_range: "5", start_weight_kg: 80 }],
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
    const first = await startSession(userId, { date: "2030-01-07" });
    expect(first.ok && first.resumed).toBe(false);
    if (!first.ok || !first.session) throw new Error("Workout did not start");

    const exercise = first.session.exercises[0];
    await markExerciseDone(userId, exercise.name, true, [
      { weight_kg: 80, reps: 5 },
      { weight_kg: 80, reps: 5 },
    ]);

    const retries = await Promise.all(
      Array.from({ length: 6 }, () => startSession(userId, { date: "2030-01-07" })),
    );
    expect(retries.every((result) => result.ok && result.resumed)).toBe(true);
    const sessionIds = retries
      .filter((result) => result.ok && result.session)
      .map((result) => (result.ok ? result.session?.id : null));
    expect(new Set(sessionIds)).toEqual(new Set([first.session.id]));

    const resumedSession = await getActiveSession(userId);
    if (!resumedSession) throw new Error("Workout did not resume");
    expect(resumedSession.exercises[0].sets.map((set) => [set.weight_kg, set.reps])).toEqual([
      [80, 5],
      [80, 5],
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
    ]);
    const completions = await Promise.all([
      completeSession(userId, {
        planned_minutes: 60,
        override_reason: "Integration test simulates a completed offline workout.",
      }),
      completeSession(userId, {
        planned_minutes: 60,
        override_reason: "Integration test checks duplicate completion protection.",
      }),
    ]);
    expect(completions.filter((result) => result.ok)).toHaveLength(1);
    expect(completions.find((result) => result.ok)).toMatchObject({
      ok: true,
      cycle_completed: false,
    });

    const history = await getWorkoutHistory(userId, {
      programId: active.program_day_id
        ? ((await getActiveProgram(userId, "2030-01-07"))?.id ?? null)
        : null,
    });
    expect(history[0].exercises[0].sets.map((set) => [set.weight_kg, set.reps])).toEqual([
      [82.5, 5],
      [82.5, 5],
    ]);

    const resolved = await resolveProgramDay(userId, {
      date: "2030-01-10",
      status: "skipped",
      reason: "Planned recovery day in the integration scenario.",
    });
    expect(resolved).toMatchObject({ ok: true, cycle_completed: true });
    expect(await getActiveProgram(userId, "2030-01-10")).toBeNull();
    expect((await getCurrentProgram(userId, "2030-01-10"))?.status).toBe("completed");
  });

  it("starts a new 16-week cycle without deleting the previous cycle history", async () => {
    await generateProgram(userId, {
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
    });

    const active = await getActiveProgram(userId, "2030-02-04");
    expect(active?.status).toBe("active");
    expect(active?.days).toHaveLength(64);
    expect(active?.days.at(-1)?.week).toBe(16);

    const allHistory = await getWorkoutHistory(userId, { limit: 400 });
    expect(allHistory.some((session) => session.title === "Day A")).toBe(true);
  });
});
