import { describe, expect, it } from "vitest";
import { workoutSetDefaults } from "@/lib/workout-set-defaults";

describe("workout set defaults", () => {
  it("uses the prescribed weight and conservative rep target for one-tap completion", () => {
    expect(
      workoutSetDefaults({
        target_reps: "8–10",
        target_weight_kg: 20,
        reps: null,
        weight_kg: null,
      }),
    ).toEqual({ weight: "20", reps: "8" });
  });

  it("preserves actual values when the user changed the prescription", () => {
    expect(
      workoutSetDefaults({
        target_reps: "8–10",
        target_weight_kg: 20,
        reps: 9,
        weight_kg: 22.5,
      }),
    ).toEqual({ weight: "22.5", reps: "9" });
  });

  it("does not invent weight for bodyweight movements", () => {
    expect(
      workoutSetDefaults({
        target_reps: "12",
        target_weight_kg: null,
        reps: null,
        weight_kg: null,
      }),
    ).toEqual({ weight: "", reps: "12" });
  });
});
