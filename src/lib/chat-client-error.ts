export type ChatTransportErrorKind = "already_processed" | "message_id_conflict";

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return "";
  const record = error as Record<string, unknown>;
  return typeof record.message === "string" ? record.message : "";
}

/**
 * The chat transport exposes non-2xx response bodies as Error.message.
 * Keep these two 409 outcomes separate: one is a successful durable reply
 * whose stream was lost, while the other must never be resubmitted.
 */
export function classifyChatTransportError(error: unknown): ChatTransportErrorKind | null {
  const message = errorMessage(error).trim();
  if (/^this message was already processed\.?$/i.test(message)) return "already_processed";
  if (
    /^message identifier was reused with different content\.?$/i.test(message) ||
    /^message_id_conflict$/i.test(message)
  ) {
    return "message_id_conflict";
  }
  return null;
}
