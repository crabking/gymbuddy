import { describe, expect, it } from "vitest";
import { compactWorkoutLabel } from "@/lib/workout-label";

describe("compactWorkoutLabel", () => {
  it("removes duplicated day prefixes and trailing detail", () => {
    expect(compactWorkoutLabel(1, "Day 1 — Squat (heavy lower)")).toBe("Day 1 — Squat");
  });

  it("keeps a concise workout title", () => {
    expect(compactWorkoutLabel(3, "Upper Strength")).toBe("Day 3 — Upper Strength");
  });

  it("uses the selected app language", () => {
    expect(compactWorkoutLabel(2, "Dag 2 - Överkropp (styrka)", "sv")).toBe("Dag 2 — Överkropp");
  });
});
