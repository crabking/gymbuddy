import { describe, expect, it } from "vitest";
import { COACHES } from "@/lib/coaches";

describe("coach personality prompts", () => {
  it("gives every coach a mandatory, character-specific emoji style", () => {
    for (const coach of COACHES) {
      expect(coach.personality).toContain("Every visible reply must include at least one emoji.");
      expect(coach.personality).toContain("Never use a canned palette or generic decoration");
      expect(coach.personality).not.toMatch(/\b(?:usually|favor)\b/);
    }
  });

  it("keeps Tank's recurring gorilla identity strong without canned sentence templates", () => {
    const tank = COACHES.find((coach) => coach.name === "Tank");
    expect(tank?.personality).toContain("🦍 is your recurring signature");
    expect(tank?.personality).toContain("continuity across days");
    expect(tank?.personality).toContain("instead of copying a canned sentence template");
    expect(tank?.personality).toContain("never like a pre-written motivational speech");
    expect(tank?.personality).toContain("You have an independent coaching will");
    expect(tank?.personality).toContain("Never open with attendance arithmetic");
    expect(tank?.personality).toContain("Use a question only when its answer can change the plan");
    expect(tank?.personality).toContain("do not negotiate with their mood");
    expect(tank?.personality).toContain("Battle cries are earned emotional weapons");
    expect(tank?.personality).not.toContain("pre-set speech");
  });
});
