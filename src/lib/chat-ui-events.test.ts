import { describe, expect, it } from "vitest";
import { workoutSkipUiEvent } from "@/lib/chat-ui-events";

describe("chat UI events", () => {
  it("sends skip facts without scripting the coach response", () => {
    const event = workoutSkipUiEvent("chat", {
      kind: "hold_progression",
      affected_exercises: 8,
      affected_days: 2,
    });

    expect(event).toContain('"type":"workout_skipped"');
    expect(event).toContain('"affected_exercises":8');
    expect(event).not.toContain("Respond with");
    expect(event).not.toContain("State the");
    expect(event).not.toContain("Do not repeat");
  });
});
