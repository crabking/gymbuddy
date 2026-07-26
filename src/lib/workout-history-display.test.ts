import { describe, expect, it } from "vitest";
import { describeWorkoutHistoryProgress } from "@/lib/workout-history-display";

describe("workout history display", () => {
  it("shows performed sets for an honestly completed partial workout", () => {
    expect(
      describeWorkoutHistoryProgress({
        status: "completed",
        end_reason: "completed_partial: Gym closed after two working sets",
        exercises: [
          {
            completed: false,
            completed_sets: 2,
            total_sets: 3,
          },
          {
            completed: false,
            completed_sets: 0,
            total_sets: 2,
          },
        ],
      }),
    ).toEqual({
      outcome: "partial",
      completed: 2,
      total: 5,
      unit: "sets",
    });
  });

  it("keeps exercise progress for a normally completed workout", () => {
    expect(
      describeWorkoutHistoryProgress({
        status: "completed",
        end_reason: "completed",
        exercises: [
          { completed: true, completed_sets: 1, total_sets: 1 },
          { completed: false, completed_sets: 0, total_sets: 1 },
        ],
      }),
    ).toEqual({
      outcome: "completed",
      completed: 1,
      total: 2,
      unit: "exercises",
    });
  });
});
