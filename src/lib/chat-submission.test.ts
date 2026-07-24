import { describe, expect, it } from "vitest";
import { isSameChatSubmission, type RetriableChatSubmission } from "@/lib/chat-submission";

const photo = {
  name: "meal.webp",
  size: 1_024,
  type: "image/webp",
  lastModified: 123,
};

describe("chat retry identity", () => {
  const failed: RetriableChatSubmission = {
    messageId: "stable-client-message-id",
    text: "Log this meal",
    files: [photo],
  };

  it("reuses the failed turn only for the exact restored draft", () => {
    expect(isSameChatSubmission(failed, "Log this meal", [{ ...photo }])).toBe(true);
    expect(isSameChatSubmission(failed, "Log this meal please", [{ ...photo }])).toBe(false);
    expect(isSameChatSubmission(failed, "Log this meal", [{ ...photo, size: 2_048 }])).toBe(false);
  });
});
