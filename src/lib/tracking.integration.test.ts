import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import {
  mealLogs,
  measurements,
  profiles,
  sessionExercises,
  sessionSets,
  users,
  workoutSessions,
} from "@/db/schema";
import { getDashboardData, getDashboardHistoryPage } from "@/lib/dashboard.server";
import { localDateInTimeZone } from "@/lib/local-date";
import { logMeasurement, summarizeMeasurements } from "@/lib/measurement.server";
import { getNutrition } from "@/lib/nutrition.server";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const suite = describe.runIf(databaseAvailable);

suite("long-term tracking invariants", () => {
  const db = databaseAvailable ? getDb() : null;
  let userId = "";
  const today = localDateInTimeZone("Europe/Stockholm");

  beforeAll(async () => {
    const [user] = await db!
      .insert(users)
      .values({
        email: `tracking-${crypto.randomUUID()}@test.invalid`,
        password_hash: "test-only",
      })
      .returning({ id: users.id });
    userId = user.id;
    await db!.insert(profiles).values({
      id: userId,
      weight_kg: 80,
      daily_calorie_target: 2500,
      daily_protein_target_g: 180,
      daily_carbs_target_g: 300,
      daily_fat_target_g: 70,
    });
  });

  afterAll(async () => {
    if (userId) await db!.delete(users).where(eq(users.id, userId));
  });

  it("uses the explicit phone-local day instead of the UTC timestamp", async () => {
    const stockholmDay = "2030-07-25";
    await db!.insert(mealLogs).values({
      user_id: userId,
      description: "Late local dinner",
      calories: 650,
      protein_g: 45,
      carbs_g: 70,
      fat_g: 20,
      logged_date: stockholmDay,
      timezone: "Europe/Stockholm",
      // 22:30 UTC is already the next phone-local day in Stockholm in July.
      logged_at: "2030-07-24T22:30:00.000Z",
    });
    const nutrition = await getNutrition(userId, stockholmDay, "Europe/Stockholm");
    expect(nutrition.date).toBe(stockholmDay);
    expect(nutrition.calories).toBe(650);
    expect(nutrition).toMatchObject({
      target_protein_g: 180,
      target_carbs_g: 300,
      target_fat_g: 70,
    });
    expect(nutrition.meals.map((meal) => meal.description)).toContain("Late local dinner");
    expect(nutrition.week_days).toHaveLength(14);
    expect(nutrition.trend_summary).toMatchObject({
      calendar_days: 14,
      logged_days: 1,
      meal_count: 1,
      complete_calorie_days: 1,
      average_calories: 650,
      average_protein_g: 45,
    });
  });

  it("keeps unknown nutrition distinct from consumed zero", async () => {
    const stockholmDay = "2030-07-25";
    await db!.insert(mealLogs).values({
      user_id: userId,
      description: "Meal awaiting photo estimate",
      calories: null,
      protein_g: null,
      carbs_g: null,
      fat_g: null,
      logged_date: stockholmDay,
      timezone: "Europe/Stockholm",
    });
    const nutrition = await getNutrition(userId, stockholmDay, "Europe/Stockholm");
    expect(nutrition).toMatchObject({
      calories: null,
      known_totals: { calories: 650 },
      unknown_meals: { calories: 1 },
      meal_count: 2,
    });
    expect(nutrition.week_days.at(-1)).toMatchObject({
      date: stockholmDay,
      calories: null,
      known_calories: 650,
      meal_count: 2,
      unknown_calorie_meals: 1,
    });
    expect(nutrition.week_days[0]).toMatchObject({
      calories: null,
      known_calories: 0,
      meal_count: 0,
    });
    expect(nutrition.trend_summary).toMatchObject({
      logged_days: 1,
      meal_count: 2,
      complete_calorie_days: 0,
      average_calories: null,
    });
  });

  it("does not manufacture performance from prescribed targets", async () => {
    const [session] = await db!
      .insert(workoutSessions)
      .values({
        user_id: userId,
        session_date: today,
        title: "Unfinished target test",
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .returning({ id: workoutSessions.id });
    const [exercise] = await db!
      .insert(sessionExercises)
      .values({
        session_id: session.id,
        position: 0,
        name: "Squat",
        target: "3x5 @ 100kg",
        completed: false,
      })
      .returning({ id: sessionExercises.id });
    await db!.insert(sessionSets).values({
      session_exercise_id: exercise.id,
      set_index: 1,
      target_reps: "5",
      target_weight_kg: 100,
      weight_kg: null,
      reps: null,
      completed: false,
    });
    const completedAt = new Date().toISOString();
    const [highRepSession] = await db!
      .insert(workoutSessions)
      .values({
        user_id: userId,
        session_date: today,
        title: "Exact high-rep conditioning",
        status: "completed",
        completed_at: completedAt,
      })
      .returning({ id: workoutSessions.id });
    const [highRepExercise] = await db!
      .insert(sessionExercises)
      .values({
        session_id: highRepSession.id,
        position: 0,
        name: "Sled press",
        completed: true,
        completed_at: completedAt,
      })
      .returning({ id: sessionExercises.id });
    await db!.insert(sessionSets).values({
      session_exercise_id: highRepExercise.id,
      set_index: 1,
      weight_kg: 100,
      reps: 100,
      completed: true,
      completed_at: completedAt,
    });

    const dashboard = await getDashboardData(userId, 30, today, "Europe/Stockholm");
    expect(dashboard.strengthByLift).toEqual([]);
    expect(dashboard.weeklyVolume).toEqual([expect.objectContaining({ sets: 1, tonnage: 10_000 })]);
    expect(dashboard.stats.incomplete_completed_sessions).toBe(1);

    const firstPage = await getDashboardHistoryPage(userId, { limit: 1 });
    expect(firstPage.history).toHaveLength(1);
    expect(firstPage.has_more).toBe(true);
    expect(firstPage.next_cursor).not.toBeNull();
    const secondPage = await getDashboardHistoryPage(userId, {
      limit: 1,
      before: firstPage.next_cursor,
    });
    expect(secondPage.history).toHaveLength(1);
    expect(secondPage.history[0].id).not.toBe(firstPage.history[0].id);
  });

  it("makes coach-defined measurements idempotent by source operation", async () => {
    const input = {
      metric_key: "resting_heart_rate",
      label: "Resting heart rate",
      value: 58,
      unit: "bpm",
      recorded_date: today,
      timezone: "Europe/Stockholm",
      source_key: "tracking-test-heart-rate",
    };
    const first = await logMeasurement(userId, input);
    const replay = await logMeasurement(userId, input);
    expect(first.id).toBe(replay.id);
    expect(first.idempotent).toBe(false);
    expect(replay.idempotent).toBe(true);
    await expect(
      logMeasurement(userId, {
        ...input,
        value: 59,
      }),
    ).rejects.toThrow("source key conflicts with different data");
    await expect(
      logMeasurement(userId, {
        ...input,
        unit: "beats/min",
        source_key: "tracking-test-heart-rate-unit-conflict",
      }),
    ).rejects.toThrow("already means");
    await expect(
      logMeasurement(userId, {
        ...input,
        source_key: "x".repeat(201),
      }),
    ).rejects.toThrow("Invalid measurement source key");

    const dashboard = await getDashboardData(userId, 30, today, "Europe/Stockholm");
    expect(dashboard.customMeasurements).toEqual([
      expect.objectContaining({
        metric_key: "resting_heart_rate",
        unit: "bpm",
        points: [expect.objectContaining({ value: 58, date: today })],
      }),
    ]);
  });

  it("summarizes the latest row per metric before applying the prompt limit", async () => {
    await db!.insert(measurements).values(
      Array.from({ length: 501 }, (_, index) => ({
        user_id: userId,
        metric_key: "a_daily_steps",
        label: "Daily steps",
        value: index,
        unit: "steps",
        recorded_date: today,
      })),
    );
    await db!.insert(measurements).values({
      user_id: userId,
      metric_key: "z_sleep_hours",
      label: "Sleep",
      value: 8,
      unit: "hours",
      recorded_date: today,
    });
    const summary = await summarizeMeasurements(userId);
    expect(summary).toContain("Daily steps");
    expect(summary).toContain("Sleep");
    expect(summary).toContain("Resting heart rate");
  });
});
