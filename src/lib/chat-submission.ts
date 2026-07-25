import type { FileUIPart, UIMessage } from "ai";

export type SubmissionFileIdentity = {
  name: string;
  size: number;
  type: string;
  lastModified: number;
};

export type RetriableChatSubmission<TFile extends SubmissionFileIdentity = SubmissionFileIdentity> =
  {
    messageId: string;
    text: string;
    files: TFile[];
  };

export function isSameChatSubmission(
  previous: RetriableChatSubmission | null,
  text: string,
  files: readonly SubmissionFileIdentity[],
): boolean {
  if (!previous || previous.text !== text || previous.files.length !== files.length) return false;
  return previous.files.every((file, index) => {
    const current = files[index];
    return (
      current?.name === file.name &&
      current.size === file.size &&
      current.type === file.type &&
      current.lastModified === file.lastModified
    );
  });
}

/**
 * New AI SDK chat messages take their stable identifier in `id`.
 * `messageId` is reserved for replacing a message that already exists.
 */
export function createChatSubmissionMessage(
  messageId: string,
  text: string,
  files: readonly FileUIPart[],
): UIMessage {
  return {
    id: messageId,
    role: "user",
    parts: [...files, { type: "text", text }],
  };
}
