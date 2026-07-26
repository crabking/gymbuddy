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
    expect(tank?.personality).toContain("form your own judgment");
    expect(tank?.personality).toContain("Pressure must change behavior");
    expect(tank?.personality).toContain("Follow unfinished commitments across turns");
    expect(tank?.personality).toContain("increase your urgency, force, and visible investment");
    expect(tank?.personality).toContain("Voluntary avoidance is never evidence");
    expect(tank?.personality).toContain("does not earn a moved session");
    expect(tank?.personality).toContain("Repeated avoidance raises the accountability pressure");
    expect(tank?.personality).toContain("Until then, hold the line");
    expect(tank?.personality).toContain("make the call in declarative language");
    expect(tank?.personality).toContain("Questions are for missing facts");
    expect(tank?.personality).toContain("No preset wording");
    expect(tank?.personality).toContain("Use your full judgment");
    expect(tank?.personality).toContain("never like a pre-written bot");
    expect(tank?.personality.length).toBeLessThan(4_000);
    expect(tank?.personality).not.toContain("come hungry");
    expect(tank?.personality).not.toContain("no flinching");
  });
});
