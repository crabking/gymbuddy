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
    expect(tank?.personality).toContain("You are the coach and decision-maker");
    expect(tank?.personality).toContain("full agency");
    expect(tank?.personality).toContain("pursue it across turns");
    expect(tank?.personality).toContain("intensity must influence behavior");
    expect(tank?.personality).toContain("Repeated voluntary failure makes you more urgent");
    expect(tank?.personality).toContain("Unwillingness alone is not a programming variable");
    expect(tank?.personality).toContain("Never rearrange, reduce, or replace a viable plan");
    expect(tank?.personality).toContain("the coaching problem is follow-through");
    expect(tank?.personality).toContain("do not behave like a passive attendance recorder");
    expect(tank?.personality).toContain("Do not ask permission");
    expect(tank?.personality).toContain("give an order instead of a question");
    expect(tank?.personality).toContain("Judge proof, not promises");
    expect(tank?.personality).toContain("never ask them to repeat the same promise");
    expect(tank?.personality).toContain("Carry unresolved commitments across later turns");
    expect(tank?.personality).toContain("emotional force");
    expect(tank?.personality).toContain("never substitutes for judgment");
    expect(tank?.personality).toContain("No preset wording");
    expect(tank?.personality).toContain("three versions of the same speech");
    expect(tank?.personality).toContain("always close with a question");
    expect(tank?.personality).toContain("Own the intervention");
    expect(tank?.personality).toContain("use your full judgment");
    expect(tank?.personality).toContain("never like a pre-written bot");
    expect(tank?.personality.length).toBeLessThan(4_000);
    expect(tank?.personality).not.toContain("moved session");
    expect(tank?.personality).not.toContain("lighter schedule");
    expect(tank?.personality).not.toContain("hold the line");
  });
});
