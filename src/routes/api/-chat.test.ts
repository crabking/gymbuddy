import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  hasConfirmationQuote,
  markExerciseSourceOperation,
  parseIncomingUserMessage,
  parseClientLocalHeader,
  selectDueProgramDay,
  unwrapToolInputContent,
} from "@/routes/api/chat";

function userMessage(text: string): UIMessage {
  return {
    id: "message",
    role: "user",
    parts: [{ type: "text", text }],
  };
}

describe("chat mutation confirmation", () => {
  it("accepts only a normalized verbatim quote from the newest user text", () => {
    const message = userMessage("Yes — shift the plan by seven days.");
    expect(hasConfirmationQuote(message, "SHIFT   the plan by seven days.")).toBe(true);
    expect(hasConfirmationQuote(message, "shift the plan by fourteen days")).toBe(false);
    expect(hasConfirmationQuote(message, " ")).toBe(false);
  });
});

describe("chat tool-call repair", () => {
  it("unwraps only the known provider content wrapper", () => {
    expect(unwrapToolInputContent('{"content":{"weeks":16,"name":"Upper/Lower"}}')).toBe(
      '{"weeks":16,"name":"Upper/Lower"}',
    );
    expect(unwrapToolInputContent('{"weeks":16}')).toBeNull();
    expect(unwrapToolInputContent('{"content":[] }')).toBeNull();
    expect(unwrapToolInputContent("not json")).toBeNull();
  });
});

describe("chat request parsing", () => {
  it("accepts the standard DefaultChatTransport envelope", () => {
    const message = parseIncomingUserMessage({
      id: "coach",
      messages: [
        {
          id: "message-1",
          role: "user",
          parts: [{ type: "text", text: "Terry" }],
        },
      ],
      trigger: "submit-message",
      messageId: "message-1",
    });

    expect(message).toMatchObject({
      id: "message-1",
      role: "user",
      parts: [{ type: "text", text: "Terry" }],
    });
  });

  it("still rejects unexpected request fields", () => {
    expect(
      parseIncomingUserMessage({
        messages: [
          {
            id: "message-1",
            role: "user",
            parts: [{ type: "text", text: "Terry" }],
          },
        ],
        unexpected: true,
      }),
    ).toBeNull();
  });
});

describe("exercise mutation source keys", () => {
  it("keeps retries stable per exercise without colliding across one coach turn", () => {
    expect(markExerciseSourceOperation("  Bench   Press ")).toBe(
      markExerciseSourceOperation("bench press"),
    );
    expect(markExerciseSourceOperation("Bench Press")).not.toBe(
      markExerciseSourceOperation("Back Squat"),
    );
  });
});

describe("due program-day selection", () => {
  const days = [
    { id: "oldest", date: "2026-07-20", status: "planned" },
    { id: "newer", date: "2026-07-22", status: "planned" },
    { id: "today", date: "2026-07-24", status: "planned" },
  ];

  it("prefers an exact planned day, then the oldest overdue make-up day", () => {
    expect(selectDueProgramDay(days, "2026-07-24")?.id).toBe("today");
    expect(selectDueProgramDay(days.slice(0, 2), "2026-07-24")?.id).toBe("oldest");
  });

  it("returns rest only when no planned day is due", () => {
    expect(
      selectDueProgramDay(
        [
          { id: "done", date: "2026-07-24", status: "completed" },
          { id: "future", date: "2026-07-25", status: "planned" },
        ],
        "2026-07-24",
      ),
    ).toBeNull();
  });
});

describe("phone-local header parsing", () => {
  it("accepts real calendar dates and IANA zones", () => {
    expect(parseClientLocalHeader("2026-07-24|Friday|20:15|Europe/Stockholm|+02:00")).toEqual({
      date: "2026-07-24",
      weekday: "Friday",
      time: "20:15",
      timezone: "Europe/Stockholm",
      offset: "+02:00",
    });
  });

  it("drops impossible dates and fake time zones", () => {
    expect(parseClientLocalHeader("2026-99-99|Friday|25:61|Europe/Fake_City|+99:00")).toEqual({
      date: undefined,
      weekday: "Friday",
      time: undefined,
      timezone: undefined,
      offset: undefined,
    });
  });
});
