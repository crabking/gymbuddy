import { describe, expect, it } from "vitest";
import { summarizeSession, type ActiveSession } from "@/lib/workout-session.server";

describe("live workout coach summary", () => {
  it("includes exact completed set values and ignores untouched defaults", () => {
    const session: NonNullable<ActiveSession> = {
      id: "session-1",
      session_date: "2026-07-26",
      title: "Day 1",
      status: "active",
      started_at: new Date().toISOString(),
      program_day_id: "day-1",
      done: 0,
      total: 1,
      next: null,
      exercises: [
        {
          id: "exercise-1",
          position: 0,
          exercise_id: "bench-press",
          name: "Bench Press",
          name_en: "Bench Press",
          name_sv: "Bänkpress",
          image_path: null,
          target: "4×5-6 @ 70kg",
          completed: false,
          completed_at: null,
          sets: [
            {
              id: "set-1",
              set_index: 1,
              target_reps: "5-6",
              target_weight_kg: 70,
              weight_kg: 75,
              reps: 5,
              completed: true,
              completed_at: new Date().toISOString(),
              revision: 1,
            },
            {
              id: "set-2",
              set_index: 2,
              target_reps: "5-6",
              target_weight_kg: 70,
              weight_kg: 70,
              reps: 5,
              completed: false,
              completed_at: null,
              revision: 0,
            },
          ],
        },
      ],
    };

    const summary = summarizeSession(session);

    expect(summary).toContain("logged 1/2: S1 75kg×5");
    expect(summary).not.toContain("S2 70kg×5");
  });

  it("does not invent a load for a completed bodyweight set", () => {
    const session: NonNullable<ActiveSession> = {
      id: "session-2",
      session_date: "2026-07-26",
      title: "Day 1",
      status: "active",
      started_at: new Date().toISOString(),
      program_day_id: "day-1",
      done: 0,
      total: 1,
      next: null,
      exercises: [
        {
          id: "exercise-2",
          position: 0,
          exercise_id: "plank",
          name: "Plank",
          name_en: "Plank",
          name_sv: "Planka",
          image_path: null,
          target: "3×30 sec",
          completed: false,
          completed_at: null,
          sets: [
            {
              id: "set-1",
              set_index: 1,
              target_reps: "30 sec",
              target_weight_kg: null,
              weight_kg: null,
              reps: 30,
              completed: true,
              completed_at: new Date().toISOString(),
              revision: 1,
            },
          ],
        },
      ],
    };

    expect(summarizeSession(session)).toContain("S1 30 reps");
    expect(summarizeSession(session)).not.toContain("0kg");
  });
});
