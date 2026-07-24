import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import { profiles, users, workoutSessions, workspaceFiles } from "@/db/schema";
import { resetUserWorkspace, switchUserCoach } from "@/lib/coach-switch.server";
import { getActiveSession, markSetDone, startSession } from "@/lib/workout-session.server";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabase).sequential("account epoch mutation isolation", () => {
  const userId = randomUUID();

  beforeAll(async () => {
    const db = getDb();
    await db.insert(users).values({
      id: userId,
      email: `account-epoch-${userId}@example.invalid`,
      password_hash: "not-a-real-login",
    });
    await db.insert(profiles).values({
      id: userId,
      coach_id: "rex",
      coach_gender: "male",
      onboarding_completed: true,
    });
  });

  afterAll(async () => {
    await getDb().delete(users).where(eq(users.id, userId));
  });

  it("never leaves an old-epoch workout behind when start races a coach switch", async () => {
    const staleStart = startSession(userId, {
      date: "2035-01-08",
      title: "Old coach workout",
      exercises: [{ name: "Squat", sets: 1, rep_range: "5", weight_kg: 80 }],
      override_reason: "Account epoch race integration test.",
      source_key: `epoch-start-${userId}`,
      expected_data_epoch: 0,
    });
    const coachSwitch = switchUserCoach(userId, "maya");

    const [startOutcome, switchOutcome] = await Promise.allSettled([staleStart, coachSwitch]);
    expect(switchOutcome).toMatchObject({ status: "fulfilled", value: { changed: true } });
    if (startOutcome.status === "rejected") {
      expect(startOutcome.reason).toMatchObject({ message: "data_epoch_conflict" });
    }

    const [profile] = await getDb()
      .select({ coach_id: profiles.coach_id, data_epoch: profiles.data_epoch })
      .from(profiles)
      .where(eq(profiles.id, userId));
    expect(profile).toEqual({ coach_id: "maya", data_epoch: 1 });
    await expect(
      getDb().select().from(workoutSessions).where(eq(workoutSessions.user_id, userId)),
    ).resolves.toHaveLength(0);
  });

  it("rejects a stale set save and stale workspace reset after another coach switch", async () => {
    const started = await startSession(userId, {
      date: "2035-01-09",
      title: "Current coach workout",
      exercises: [{ name: "Bench press", sets: 1, rep_range: "5", weight_kg: 60 }],
      override_reason: "Account epoch race integration test.",
      source_key: `epoch-current-start-${userId}`,
      expected_data_epoch: 1,
    });
    if (!started.ok || !started.session) throw new Error("Current-epoch workout did not start");
    const set = started.session.exercises[0]?.sets[0];
    if (!set) throw new Error("Workout set was not materialized");

    const staleSetSave = markSetDone(userId, set.id, {
      completed: true,
      weight_kg: 60,
      reps: 5,
      expected_revision: set.revision,
      expected_data_epoch: 1,
    });
    const coachSwitch = switchUserCoach(userId, "nova");
    const [setOutcome, switchOutcome] = await Promise.allSettled([staleSetSave, coachSwitch]);
    expect(switchOutcome).toMatchObject({ status: "fulfilled", value: { changed: true } });
    if (setOutcome.status === "rejected") {
      expect(setOutcome.reason).toMatchObject({ message: "data_epoch_conflict" });
    }
    await expect(getActiveSession(userId)).resolves.toBeNull();

    await getDb().insert(workspaceFiles).values({
      user_id: userId,
      path: "notes/new-coach.md",
      content: "belongs to nova",
      size_bytes: 15,
      summary: "belongs to nova",
    });
    await expect(resetUserWorkspace(userId, 1)).rejects.toThrow("data_epoch_conflict");
    await expect(
      getDb().select().from(workspaceFiles).where(eq(workspaceFiles.user_id, userId)),
    ).resolves.toHaveLength(1);

    await expect(resetUserWorkspace(userId, 2)).resolves.toMatchObject({ changed: true });
    const [profile] = await getDb()
      .select({ data_epoch: profiles.data_epoch })
      .from(profiles)
      .where(eq(profiles.id, userId));
    expect(profile.data_epoch).toBe(3);
  });
});
