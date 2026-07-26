import { describe, expect, it } from "vitest";
import {
  analyzeWorkoutAdaptation,
  coachAdaptationIntensity,
  parseRepRange,
  type AdaptationAnalysisInput,
  type ExerciseExposure,
} from "@/lib/adaptive-training";

function exposure(
  overrides: Partial<ExerciseExposure> & Pick<ExerciseExposure, "exercise_id">,
): ExerciseExposure {
  return {
    exercise_id: overrides.exercise_id,
    name: overrides.name ?? "Bench Press",
    planned_sets: overrides.planned_sets ?? 3,
    target_weight_kg: overrides.target_weight_kg === undefined ? 60 : overrides.target_weight_kg,
    progression_step_kg:
      overrides.progression_step_kg === undefined ? 2.5 : overrides.progression_step_kg,
    sets:
      overrides.sets ??
      Array.from({ length: overrides.planned_sets ?? 3 }, () => ({
        target_reps: "6–8",
        target_weight_kg:
          overrides.target_weight_kg === undefined ? 60 : overrides.target_weight_kg,
        weight_kg: overrides.target_weight_kg === undefined ? 60 : overrides.target_weight_kg,
        reps: 8,
        completed: true,
      })),
  };
}

function input(overrides: Partial<AdaptationAnalysisInput> = {}): AdaptationAnalysisInput {
  const current = exposure({ exercise_id: "bench-press" });
  return {
    coach_id: "rex",
    review: { difficulty: 3, energy: 4, discomfort: 1 },
    current: [current],
    previous_by_exercise: {
      "bench-press": [exposure({ exercise_id: "bench-press" })],
    },
    previous_reviews: [],
    next_planned_date: "2035-02-03",
    next_planned_week: 2,
    ...overrides,
  };
}

describe("adaptive training analysis", () => {
  it("parses fixed and ranged rep targets", () => {
    expect(parseRepRange("8")).toEqual({ low: 8, high: 8 });
    expect(parseRepRange("6–10")).toEqual({ low: 6, high: 10 });
    expect(parseRepRange("12-8 reps")).toEqual({ low: 8, high: 12 });
    expect(parseRepRange("easy")).toBeNull();
  });

  it("keeps personality influence bounded to gentle, balanced, and demanding", () => {
    expect(coachAdaptationIntensity("eli")).toBe(0);
    expect(coachAdaptationIntensity("maya")).toBe(0);
    expect(coachAdaptationIntensity("rex")).toBe(1);
    expect(coachAdaptationIntensity("reya")).toBe(1);
    expect(coachAdaptationIntensity("brutus")).toBe(2);
    expect(coachAdaptationIntensity("nova")).toBe(2);
  });

  it("requires two comparable successful exposures before progressing", () => {
    expect(
      analyzeWorkoutAdaptation(
        input({
          previous_by_exercise: {},
        }),
      ),
    ).toBeNull();
    const result = analyzeWorkoutAdaptation(input());
    expect(result?.options[0]).toMatchObject({
      id: "progress",
      actions: [
        {
          type: "exercise_adjustment",
          exercise_id: "bench-press",
          delta_kg: 2.5,
        },
      ],
    });
  });

  it("never progresses through high pain and requires a follow-up", () => {
    const result = analyzeWorkoutAdaptation(
      input({ review: { difficulty: 2, energy: 5, discomfort: 5 } }),
    );
    expect(result?.requires_follow_up).toBe(true);
    expect(result?.options.every((option) => option.id !== "progress")).toBe(true);
    expect(result?.options[0]?.id).toBe("rest-day");
  });

  it("requires clarification for moderate discomfort before changing an exercise", () => {
    const result = analyzeWorkoutAdaptation(
      input({ review: { difficulty: 3, energy: 4, discomfort: 3 } }),
    );
    expect(result?.requires_follow_up).toBe(true);
    expect(result?.options.map((option) => option.id)).toEqual(["rest-day"]);
  });

  it("uses reps instead of inventing kilograms for bodyweight movements", () => {
    const bodyweight = exposure({
      exercise_id: "push-up",
      name: "Push-Up",
      target_weight_kg: null,
      progression_step_kg: null,
      sets: Array.from({ length: 3 }, () => ({
        target_reps: "10–12",
        target_weight_kg: null,
        weight_kg: null,
        reps: 12,
        completed: true,
      })),
    });
    const result = analyzeWorkoutAdaptation(
      input({
        current: [bodyweight],
        previous_by_exercise: { "push-up": [bodyweight] },
      }),
    );
    expect(result?.options[0]?.actions[0]).toEqual({
      type: "exercise_adjustment",
      exercise_id: "push-up",
      from_date: "2035-02-03",
      rep_range: "11–13",
    });
  });

  it("requires two failed exposures before rolling back one planned step", () => {
    const failed = exposure({
      exercise_id: "bench-press",
      sets: Array.from({ length: 3 }, () => ({
        target_reps: "6–8",
        target_weight_kg: 60,
        weight_kg: 60,
        reps: 4,
        completed: true,
      })),
    });
    const result = analyzeWorkoutAdaptation(
      input({
        review: { difficulty: 5, energy: 3, discomfort: 1 },
        current: [failed],
        previous_by_exercise: { "bench-press": [failed] },
      }),
    );
    expect(result?.options.some((option) => option.id === "reduce")).toBe(true);
    expect(
      result?.options
        .find((option) => option.id === "reduce")
        ?.actions.some(
          (action) => action.type === "exercise_adjustment" && action.delta_kg === -2.5,
        ),
    ).toBe(true);
  });

  it("offers a deload and recovery shift after repeated poor recovery", () => {
    const result = analyzeWorkoutAdaptation(
      input({
        review: { difficulty: 4, energy: 2, discomfort: 1 },
        previous_reviews: [{ difficulty: 4, energy: 2, discomfort: 1 }],
      }),
    );
    expect(result?.options.map((option) => option.id)).toEqual(["deload", "rest-day"]);
  });
});
