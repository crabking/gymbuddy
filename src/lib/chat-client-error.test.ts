import { describe, expect, it } from "vitest";
import { classifyChatTransportError } from "@/lib/chat-client-error";

describe("chat transport error recovery", () => {
  it("recognizes a durable reply that only needs canonical history recovery", () => {
    expect(classifyChatTransportError(new Error("This message was already processed."))).toBe(
      "already_processed",
    );
  });

  it("keeps message identifier conflicts non-retryable", () => {
    expect(
      classifyChatTransportError(
        new Error("Message identifier was reused with different content."),
      ),
    ).toBe("message_id_conflict");
    expect(classifyChatTransportError(new Error("message_id_conflict"))).toBe(
      "message_id_conflict",
    );
  });

  it("does not misclassify ordinary transport failures", () => {
    expect(classifyChatTransportError(new Error("Network unavailable"))).toBeNull();
    expect(classifyChatTransportError(null)).toBeNull();
  });
});
