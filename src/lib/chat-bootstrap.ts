import type { UIMessage } from "ai";

function messageText(message: UIMessage) {
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("")
    .trim();
}

export function isInternalChatMessage(message: UIMessage) {
  if (message.role !== "user") return false;
  const text = messageText(message);
  return text === "__begin__" || text.startsWith("__ui_event__");
}

export function userFacingChatMessages(messages: UIMessage[]) {
  return messages.filter((message) => !isInternalChatMessage(message));
}

export function retryableUnansweredUserMessage(messages: UIMessage[], status: string) {
  if (status !== "ready") return null;
  const latest = userFacingChatMessages(messages).at(-1);
  if (!latest || latest.role !== "user") return null;
  const text = messageText(latest);
  if (!text || text === "[An image was uploaded for this turn and was not retained.]") {
    return null;
  }
  return { id: latest.id, text };
}

export function shouldAutoKickoffCoach({
  messages,
  inOnboarding,
  buildIncomplete,
  status,
}: {
  messages: UIMessage[];
  inOnboarding: boolean;
  buildIncomplete: boolean;
  status: string;
}) {
  return (
    (inOnboarding || buildIncomplete) &&
    status === "ready" &&
    userFacingChatMessages(messages).length === 0
  );
}
