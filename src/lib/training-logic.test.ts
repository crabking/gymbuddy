import { describe, expect, it } from "vitest";
import {
  addIsoDays,
  assessProgramLifecycle,
  beginnerCalibrationPrescription,
  calculateProgramDates,
  calculateProgramDatesForSchedule,
  calculateTargetWeight,
  getSessionCompletionIssues,
  shiftWeekdayIndices,
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

  it("keeps rolling programs as Day 1..N without requiring weekdays", () => {
    expect(
      calculateProgramDatesForSchedule({
        startDate: "2026-07-25",
        weeks: 2,
        daysPerWeek: 3,
        mode: "rolling",
      }),
    ).toEqual(["2026-07-25", "2026-07-27", "2026-07-29", "2026-08-01", "2026-08-03", "2026-08-05"]);
  });

  it("honors explicitly fixed Monday, Wednesday, and Saturday schedules", () => {
    expect(
      calculateProgramDatesForSchedule({
        startDate: "2026-07-20",
        weeks: 2,
        daysPerWeek: 3,
        mode: "weekday",
        weekdayIndices: [1, 3, 6],
      }),
    ).toEqual(["2026-07-20", "2026-07-22", "2026-07-25", "2026-07-27", "2026-07-29", "2026-08-01"]);
  });

  it("shifts fixed weekday metadata both earlier and later", () => {
    expect(shiftWeekdayIndices([1, 3, 6], -2)).toEqual([6, 1, 4]);
    expect(shiftWeekdayIndices([1, 3, 6], 2)).toEqual([3, 5, 1]);
  });
});

describe("absolute beginner calibration", () => {
  it("caps a male barbell start at the empty 20 kg bar", () => {
    expect(beginnerCalibrationPrescription({ sex: "male", equipment: "barbell" })).toMatchObject({
      startWeightKg: 20,
      incrementKg: 0,
    });
  });

  it("does not force a standard bar or invented machine load for other beginners", () => {
    expect(
      beginnerCalibrationPrescription({ sex: "female", equipment: "barbell" }).startWeightKg,
    ).toBeNull();
    expect(
      beginnerCalibrationPrescription({ sex: "male", equipment: "machine" }).startWeightKg,
    ).toBeNull();
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
    ).toBe(95);
  });

  it("never lets a slow progression erase the deload reduction", () => {
    const priorTrainingWeek = calculateTargetWeight({
      startWeightKg: 22.5,
      incrementKg: 2.5,
      incrementEveryWeeks: 2,
      completedTrainingWeeks: 5,
      isDeload: false,
    });
    const deloadWeek = calculateTargetWeight({
      startWeightKg: 22.5,
      incrementKg: 2.5,
      incrementEveryWeeks: 2,
      completedTrainingWeeks: 6,
      isDeload: true,
    });
    expect(priorTrainingWeek).toBe(27.5);
    expect(deloadWeek).toBe(25);
    expect(deloadWeek).toBeLessThan(priorTrainingWeek!);
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
      {
        name: "Squat",
        completed: true,
        sets: [
          { completed: true, reps: 5 },
          { completed: false, reps: null },
        ],
      },
      { name: "Row", completed: false, sets: [] },
    ]);

    expect(issues).toEqual(["Squat still has unfinished sets.", "Row is not complete."]);
  });

  it("accepts a fully completed workout", () => {
    expect(
      getSessionCompletionIssues([
        {
          name: "Squat",
          completed: true,
          sets: [
            { completed: true, reps: 5 },
            { completed: true, reps: 5 },
          ],
        },
      ]),
    ).toEqual([]);
  });

  it("rejects a checked set whose actual reps were never captured", () => {
    expect(
      getSessionCompletionIssues([
        { name: "Squat", completed: true, sets: [{ completed: true, reps: null }] },
      ]),
    ).toEqual(["Squat has completed sets without actual reps."]);
  });
});
