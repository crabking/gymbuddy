import { describe, expect, it } from "vitest";
import { setupStatus, type SetupProgressProfile } from "@/lib/setup-progress";

const completeBasics: SetupProgressProfile = {
  display_name: "Jay",
  goal: "hypertrophy + strength",
  experience: "intermediate",
  equipment: "full_gym",
  injuries: "None",
  age: 29,
  height_cm: 178,
  weight_kg: 82,
  sex: "male",
};

describe("onboarding setup progress", () => {
  it("does not mistake an equipment note for a completed schedule", () => {
    const status = setupStatus({
      ...completeBasics,
      schedule_note: "No hack squat or Smith machine.",
    });

    expect(status.profile).toBe(true);
    expect(status.schedule).toBe(false);
  });

  it("keeps basics open until limitations have been answered", () => {
    const status = setupStatus({
      ...completeBasics,
      injuries: null,
    });

    expect(status.profile).toBe(false);
  });

  it("completes schedule only when frequency, duration, and note are durable", () => {
    const status = setupStatus({
      ...completeBasics,
      days_per_week: 4,
      session_minutes: 60,
      schedule_note: "Rolling four-session schedule.",
    });

    expect(status.schedule).toBe(true);
  });
});
