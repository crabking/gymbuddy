import { eq } from "drizzle-orm";
import { generateText, type UIMessage } from "ai";
import { getDb } from "@/db/db.server";
import { chatMessages } from "@/db/schema";
import { getChatModel } from "@/lib/ai-provider.server";

const COMPACT_AT_MESSAGES = 100;
const ROLLING_MESSAGES = 10;
export const ROLLING_SUMMARY_PREFIX = "Earlier conversation summary (automatic rolling context):";

function textOnly(message: UIMessage): UIMessage | null {
  const parts = message.parts.flatMap((part) =>
    part.type === "text" && part.text.trim() ? [{ type: "text" as const, text: part.text }] : [],
  );
  return parts.length > 0 ? { ...message, parts } : null;
}

function isSummary(message: UIMessage) {
  return (
    message.role === "user" &&
    message.parts.some(
      (part) => part.type === "text" && part.text.startsWith(ROLLING_SUMMARY_PREFIX),
    )
  );
}

function transcript(messages: UIMessage[]) {
  return messages
    .map((message) => {
      const text = message.parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n")
        .trim();
      return text ? `${message.role.toUpperCase()}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

async function summarize(messages: UIMessage[]) {
  const source = transcript(messages);
  if (!source) return "No meaningful earlier context.";

  try {
    const result = await generateText({
      model: getChatModel(),
      maxOutputTokens: 500,
      system: `Compress an older fitness-coaching conversation into a rough, compact
handoff for the same coach. Preserve decisions, what was discussed, current plans,
unfinished threads, user corrections, and facts needed to understand the next messages.
Do not invent anything. Do not repeat greetings or filler. Keep it below 350 words.
This is conversation context, not permanent memory. Return only the summary.`,
      prompt: source,
    });
    return result.text.trim() || "No meaningful earlier context.";
  } catch (error) {
    console.error("Rolling chat summary failed", error);
    return source.slice(-12_000);
  }
}

export async function persistRollingChatHistory(userId: string, messages: UIMessage[]) {
  const sanitized = messages.flatMap((message) => {
    const clean = textOnly(message);
    return clean ? [clean] : [];
  });
  const previousSummary = sanitized.find(isSummary);
  const conversation = sanitized.filter((message) => !isSummary(message));
  let retained: UIMessage[];

  if (conversation.length >= COMPACT_AT_MESSAGES) {
    const recent = conversation.slice(-ROLLING_MESSAGES);
    const compactable = conversation.slice(0, -ROLLING_MESSAGES);
    const summaryText = await summarize([
      ...(previousSummary ? [previousSummary] : []),
      ...compactable,
    ]);
    retained = [
      {
        id: crypto.randomUUID(),
        role: "user",
        parts: [
          {
            type: "text",
            text: `${ROLLING_SUMMARY_PREFIX}\n${summaryText}`,
          },
        ],
      },
      ...recent,
    ];
  } else {
    retained = [...(previousSummary ? [previousSummary] : []), ...conversation];
  }

  const createdAt = Date.now();
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(chatMessages).where(eq(chatMessages.user_id, userId));
    if (retained.length === 0) return;
    await tx.insert(chatMessages).values(
      retained.map((message, index) => ({
        user_id: userId,
        role: message.role,
        parts: message.parts,
        created_at: new Date(createdAt + index).toISOString(),
      })),
    );
  });
}
