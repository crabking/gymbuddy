import { describe, expect, it } from "vitest";
import {
  addIsoDays,
  assessProgramLifecycle,
  calculateProgramDates,
  calculateTargetWeight,
  getSessionCompletionIssues,
  trainingDayOffsets,
} from "./training-logic";

describe("program calendar", () => {
  it("materializes all 64 workouts in a 16-week four-day program", () => {
    const dates = calculateProgramDates("2026-01-05", 16, 4);

    expect(dates).toHaveLength(64);
    expect(new Set(dates).size).toBe(64);
    expect(dates[0]).toBe("2026-01-05");
    expect(dates.at(-1)).toBe("2026-04-24");
  });

  it("uses stable UTC date math across leap days and daylight-saving changes", () => {
    expect(addIsoDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addIsoDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(addIsoDays("2026-03-28", 2)).toBe("2026-03-30");
  });

  it("rejects impossible dates and invalid weekly frequencies", () => {
    expect(() => addIsoDays("2026-02-30", 1)).toThrow("Invalid ISO date");
    expect(() => trainingDayOffsets(0)).toThrow();
    expect(() => trainingDayOffsets(8)).toThrow();
  });
});

describe("program progression", () => {
  it("progresses only after the configured number of training weeks", () => {
    expect(
      calculateTargetWeight({
        startWeightKg: 60,
        incrementKg: 2.5,
        incrementEveryWeeks: 2,
        completedTrainingWeeks: 1,
        isDeload: false,
      }),
    ).toBe(60);
    expect(
      calculateTargetWeight({
        startWeightKg: 60,
        incrementKg: 2.5,
        incrementEveryWeeks: 2,
        completedTrainingWeeks: 2,
        isDeload: false,
      }),
    ).toBe(62.5);
  });

  it("applies deload weight reduction and normalizes to 2.5 kg", () => {
    expect(
      calculateTargetWeight({
        startWeightKg: 100,
        incrementKg: 5,
        incrementEveryWeeks: 1,
        completedTrainingWeeks: 2,
        isDeload: true,
      }),
    ).toBe(100);
  });

  it("keeps bodyweight movements without a fabricated load", () => {
    expect(
      calculateTargetWeight({
        startWeightKg: null,
        incrementKg: 2.5,
        incrementEveryWeeks: 2,
        completedTrainingWeeks: 10,
        isDeload: false,
      }),
    ).toBeNull();
  });
});

describe("program lifecycle", () => {
  it("finishes only when every workout has an explicit outcome", () => {
    expect(
      assessProgramLifecycle({
        statuses: ["completed", "completed", "skipped"],
        today: "2026-04-24",
        endDate: "2026-04-24",
      }).state,
    ).toBe("completed");
  });

  it("does not silently discard overdue workouts", () => {
    const result = assessProgramLifecycle({
      statuses: ["completed", "planned", "skipped"],
      today: "2026-04-25",
      endDate: "2026-04-24",
    });

    expect(result.state).toBe("needs_review");
    expect(result.planned).toBe(1);
  });

  it("keeps a current cycle active while planned workouts remain", () => {
    expect(
      assessProgramLifecycle({
        statuses: ["completed", "planned"],
        today: "2026-04-20",
        endDate: "2026-04-24",
      }).state,
    ).toBe("active");
  });
});

describe("session completion guard", () => {
  it("refuses a workout with unfinished exercises or sets", () => {
    const issues = getSessionCompletionIssues([
      { name: "Squat", completed: true, sets: [{ completed: true }, { completed: false }] },
      { name: "Row", completed: false, sets: [] },
    ]);

    expect(issues).toEqual(["Squat still has unfinished sets.", "Row is not complete."]);
  });

  it("accepts a fully completed workout", () => {
    expect(
      getSessionCompletionIssues([
        { name: "Squat", completed: true, sets: [{ completed: true }, { completed: true }] },
      ]),
    ).toEqual([]);
  });
});
