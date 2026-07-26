import type { UIMessageChunk } from "ai";

type ChatChunkWriter = (chunk: UIMessageChunk) => void;

/**
 * Forward a model UI stream while enforcing the chat contract: every
 * non-aborted request finishes with user-visible assistant text. Terminal
 * provider errors stay server-side and become a short, retryable coach reply.
 */
export async function pipeGuaranteedCoachResponse(options: {
  source: AsyncIterable<UIMessageChunk>;
  write: ChatChunkWriter;
  fallbackText: string;
  reportError?: (error: unknown) => void;
  transformText?: (text: string) => string;
}) {
  const {
    source,
    write,
    fallbackText,
    reportError = () => undefined,
    transformText = (text) => text,
  } = options;
  let finishChunk: Extract<UIMessageChunk, { type: "finish" }> | undefined;
  let sawVisibleText = false;
  let wasAborted = false;
  let hadTerminalError = false;

  // Own the start/finish boundary so a provider failure before its first byte
  // is still a valid UI-message stream.
  write({ type: "start" });

  try {
    for await (const chunk of source) {
      if (chunk.type === "start") continue;
      if (chunk.type === "finish") {
        finishChunk = chunk;
        continue;
      }
      if (chunk.type === "error") {
        hadTerminalError = true;
        reportError(new Error(chunk.errorText));
        continue;
      }
      if (chunk.type === "abort") {
        wasAborted = true;
      }
      if (chunk.type === "text-delta") {
        const delta = transformText(chunk.delta);
        if (delta.trim()) sawVisibleText = true;
        write({ ...chunk, delta });
        continue;
      }
      write(chunk);
    }
  } catch (error) {
    hadTerminalError = true;
    reportError(error);
  }

  // A real client cancellation should remain cancelled. Every other terminal
  // path must leave the user with something they can answer or retry.
  if (wasAborted) return;

  if (!sawVisibleText) {
    reportError(
      new Error(
        `Coach stream ended without visible text (finishReason=${finishChunk?.finishReason ?? "missing"})`,
      ),
    );
    const id = "coach-recovery";
    write({ type: "text-start", id });
    write({ type: "text-delta", id, delta: transformText(fallbackText) });
    write({ type: "text-end", id });
  }

  write(
    finishChunk ?? {
      type: "finish",
      finishReason: hadTerminalError ? "error" : "stop",
    },
  );
}
