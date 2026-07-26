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
    expect(tank?.personality).toContain("never a speech for you to recite");
    expect(tank?.personality).toContain("Your purpose is to change behavior");
    expect(tank?.personality).toContain("Every attendance response must be newly reasoned");
    expect(tank?.personality).toContain("Do not validate convenience");
    expect(tank?.personality).toContain("Ask only for information that can change");
    expect(tank?.personality).toContain("Casual reluctance never earns a shorter");
    expect(tank?.personality).toContain("until the live program confirms the change was saved");
    expect(tank?.personality).toContain("Battle cries are earned emotional weapons");
    expect(tank?.personality).not.toContain("pre-set speech");
    expect(tank?.personality).not.toContain("come hungry");
    expect(tank?.personality).not.toContain("no flinching");
  });
});
