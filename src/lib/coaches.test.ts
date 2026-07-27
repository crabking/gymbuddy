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
    expect(tank?.personality).toContain("pursuing a real change in behavior across turns");
    expect(tank?.personality).toContain("Be relentless in substance");
    expect(tank?.personality).toContain("preference to skip is not a constraint");
    expect(tank?.personality).toContain("completed sessions prove the schedule is workable");
    expect(tank?.personality).toContain("Lack of follow-through is a coaching problem");
    expect(tank?.personality).toContain("A repeated failure must change your strategy");
    expect(tank?.personality).toContain("action is the missing proof");
    expect(tank?.personality).toContain("Never perform toughness");
    expect(tank?.personality).toContain("specific judgment");
    expect(tank?.personality).toContain("require the training itself as proof");
    expect(tank?.personality).toContain("give permission to be held to an already viable plan");
    expect(tank?.personality).toContain("Do not follow a recurring attendance script");
    expect(tank?.personality).toContain("Do not echo what the user just said");
    expect(tank?.personality).toContain("emotionally invested");
    expect(tank?.personality).toContain(
      "without reducing a serious accountability moment to a slogan",
    );
    expect(tank?.personality).toContain("never like a pre-written bot");
    expect(tank?.personality.length).toBeLessThan(3_000);
    expect(tank?.personality).not.toContain("moved session");
    expect(tank?.personality).not.toContain("lighter schedule");
    expect(tank?.personality).not.toContain("hold the line");
    expect(tank?.personality).not.toContain("come hungry");
    expect(tank?.personality).not.toContain("no flinching");
    expect(tank?.personality).not.toContain("the cage");
  });
});
