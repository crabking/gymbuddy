import { describe, expect, it, vi } from "vitest";
import type { UIMessageChunk } from "ai";
import { pipeGuaranteedCoachResponse } from "@/lib/chat-stream-guard";

async function* chunks(values: UIMessageChunk[], failure?: Error) {
  for (const value of values) yield value;
  if (failure) throw failure;
}

async function guard(values: UIMessageChunk[], failure?: Error) {
  const output: UIMessageChunk[] = [];
  const reportError = vi.fn();
  await pipeGuaranteedCoachResponse({
    source: chunks(values, failure),
    write: (chunk) => output.push(chunk),
    fallbackText: "I could not finish that step. Ask me to retry.",
    reportError,
  });
  return { output, reportError };
}

describe("guaranteed coach response stream", () => {
  it("keeps a normal visible model reply unchanged", async () => {
    const { output, reportError } = await guard([
      { type: "start" },
      { type: "text-start", id: "model-text" },
      { type: "text-delta", id: "model-text", delta: "Still here." },
      { type: "text-end", id: "model-text" },
      { type: "finish", finishReason: "stop" },
    ]);

    expect(output).toEqual([
      { type: "start" },
      { type: "text-start", id: "model-text" },
      { type: "text-delta", id: "model-text", delta: "Still here." },
      { type: "text-end", id: "model-text" },
      { type: "finish", finishReason: "stop" },
    ]);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("turns a terminal provider error into visible retryable text", async () => {
    const { output, reportError } = await guard([
      { type: "start" },
      { type: "error", errorText: "provider timed out" },
      { type: "finish", finishReason: "error" },
    ]);

    expect(output).not.toContainEqual(expect.objectContaining({ type: "error" }));
    expect(output).toContainEqual({
      type: "text-delta",
      id: "coach-recovery",
      delta: "I could not finish that step. Ask me to retry.",
    });
    expect(output.at(-1)).toEqual({ type: "finish", finishReason: "error" });
    expect(reportError).toHaveBeenCalledTimes(2);
  });

  it("also recovers when the provider stream throws before finishing", async () => {
    const { output, reportError } = await guard(
      [{ type: "start" }],
      new Error("connection dropped"),
    );

    expect(output.some((chunk) => chunk.type === "text-delta")).toBe(true);
    expect(output.at(-1)).toEqual({ type: "finish", finishReason: "error" });
    expect(reportError).toHaveBeenCalledTimes(2);
  });

  it("reports the finish reason when an output limit cuts off a tool-only turn", async () => {
    const { output, reportError } = await guard([
      { type: "start" },
      { type: "finish", finishReason: "length" },
    ]);

    expect(output.some((chunk) => chunk.type === "text-delta")).toBe(true);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("finishReason=length"),
      }),
    );
  });

  it("does not manufacture a reply after a real client abort", async () => {
    const { output } = await guard([
      { type: "start" },
      { type: "abort", reason: "client disconnected" },
    ]);

    expect(output).toEqual([{ type: "start" }, { type: "abort", reason: "client disconnected" }]);
  });
});
