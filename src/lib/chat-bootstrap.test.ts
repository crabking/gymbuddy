import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  isInternalChatMessage,
  shouldAutoKickoffCoach,
  userFacingChatMessages,
} from "@/lib/chat-bootstrap";

function message(id: string, role: "user" | "assistant", text: string): UIMessage {
  return { id, role, parts: [{ type: "text", text }] };
}

describe("chat bootstrap", () => {
  it("retries post-onboarding setup when only an orphaned kickoff marker was persisted", () => {
    const messages = [message("kickoff", "user", "__begin__")];
    expect(
      shouldAutoKickoffCoach({
        messages,
        inOnboarding: false,
        buildIncomplete: true,
        status: "ready",
      }),
    ).toBe(true);
  });

  it("starts onboarding with a real coach turn", () => {
    expect(
      shouldAutoKickoffCoach({
        messages: [],
        inOnboarding: true,
        buildIncomplete: true,
        status: "ready",
      }),
    ).toBe(true);
  });

  it("does not start another setup turn when visible conversation exists", () => {
    const messages = [
      message("kickoff", "user", "__begin__"),
      message("reply", "assistant", "Let's get started."),
    ];
    expect(
      shouldAutoKickoffCoach({
        messages,
        inOnboarding: true,
        buildIncomplete: true,
        status: "ready",
      }),
    ).toBe(false);
  });

  it("filters kickoff and UI-event markers from the visible transcript", () => {
    const visible = message("reply", "assistant", "Ready.");
    const messages = [
      message("kickoff", "user", "__begin__"),
      message("event", "user", "__ui_event__ opened settings"),
      visible,
    ];
    expect(isInternalChatMessage(messages[0])).toBe(true);
    expect(userFacingChatMessages(messages)).toEqual([visible]);
  });
});
