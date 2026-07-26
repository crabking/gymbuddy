import { describe, expect, it } from "vitest";
import { workoutSkipUiEvent } from "@/lib/chat-ui-events";

describe("chat UI events", () => {
  it("sends skip facts without scripting the coach response", () => {
    const event = workoutSkipUiEvent("chat");

    expect(event).toContain('"type":"workout_skipped"');
    expect(event).toContain('"source":"chat"');
    expect(event).not.toContain("recovery");
    expect(event).not.toContain("affected_exercises");
    expect(event).not.toContain("Respond with");
    expect(event).not.toContain("State the");
    expect(event).not.toContain("Do not repeat");
  });
});
