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
    !inOnboarding &&
    buildIncomplete &&
    status === "ready" &&
    userFacingChatMessages(messages).length === 0
  );
}
