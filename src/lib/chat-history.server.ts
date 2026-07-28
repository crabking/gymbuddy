import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { generateText, type UIMessage } from "ai";
import { getDb } from "@/db/db.server";
import { analyticsEvents, chatMessages, chatRuns, memoryJobs } from "@/db/schema";
import { recordAnalyticsEventSafe } from "@/lib/analytics.server";
import { recordAiUsageSafe } from "@/lib/analytics.server";
import { getChatModel } from "@/lib/ai-provider.server";
import { captureAndRenewChatLease, renewChatLease, type ChatLease } from "@/lib/chat-run.server";

const COMPACT_AT_MESSAGES = 100;
const ROLLING_MESSAGES = 10;
const SUMMARY_INPUT_CHARS = 48_000;
const SUMMARY_HEAD_CHARS = 8_000;
const SUMMARY_TIMEOUT_MS = 30_000;
export const ROLLING_SUMMARY_PREFIX = "Earlier conversation summary (automatic rolling context):";

function textOnly(message: UIMessage): UIMessage | null {
  const parts = message.parts.flatMap((part) =>
    part.type === "text" && part.text.trim() ? [{ type: "text" as const, text: part.text }] : [],
  );
  return parts.length > 0 ? { ...message, parts } : null;
}

function stableUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(
    17,
    20,
  )}-${hex.slice(20, 32)}`;
}

function stableMessageId(userId: string, messageKey: string, role: "user" | "assistant"): string {
  return stableUuid(`${userId}:${role}:${messageKey}`);
}

function sameParts(left: unknown, right: unknown) {
  return isDeepStrictEqual(left, right);
}

function partsText(parts: UIMessage["parts"]) {
  return parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
}

function memoryTranscript(
  userParts: UIMessage["parts"],
  assistantParts: UIMessage["parts"],
): string | null {
  const userText = partsText(userParts);
  if (
    !userText ||
    userText === "__begin__" ||
    userText.startsWith("__ui_event__") ||
    userText === "[An image was uploaded for this turn and was not retained.]"
  ) {
    return null;
  }
  const assistantText = partsText(assistantParts);
  if (!assistantText) return null;
  return `USER: ${userText}\nASSISTANT: ${assistantText}`.slice(0, 20_000);
}

export async function loadCanonicalChatHistory(userId: string): Promise<UIMessage[]> {
  const rows = await getDb()
    .select({ id: chatMessages.id, role: chatMessages.role, parts: chatMessages.parts })
    .from(chatMessages)
    .where(eq(chatMessages.user_id, userId))
    .orderBy(asc(chatMessages.created_at), asc(chatMessages.id));
  return rows.map((row) => ({
    id: row.id,
    role: row.role as UIMessage["role"],
    parts: row.parts as UIMessage["parts"],
  }));
}

export async function appendCanonicalUserMessage(
  userId: string,
  messageKey: string,
  message: UIMessage,
): Promise<{ inserted: boolean; id: string }> {
  const clean = textOnly({ ...message, role: "user" });
  if (!clean) throw new Error("A chat turn must contain text.");
  const id = stableMessageId(userId, messageKey, "user");
  const rows = await getDb()
    .insert(chatMessages)
    .values({ id, user_id: userId, role: "user", parts: clean.parts })
    .onConflictDoNothing()
    .returning({ id: chatMessages.id });
  if (rows.length === 0) {
    const [existing] = await getDb()
      .select({ parts: chatMessages.parts })
      .from(chatMessages)
      .where(eq(chatMessages.id, id))
      .limit(1);
    if (!existing || !sameParts(existing.parts, clean.parts)) {
      throw new Error("message_id_conflict");
    }
  }
  await recordAnalyticsEventSafe({
    eventName: "chat_user_message",
    actorUserId: userId,
    source: "server",
    idempotencyKey: `chat:user:${id}`,
  });
  return { inserted: rows.length > 0, id };
}

export async function appendCanonicalAssistantMessage(
  userId: string,
  messageKey: string,
  message: UIMessage,
): Promise<{ inserted: boolean; id: string } | null> {
  const clean = textOnly({ ...message, role: "assistant" });
  if (!clean) return null;
  const id = stableMessageId(userId, messageKey, "assistant");
  const rows = await getDb()
    .insert(chatMessages)
    .values({ id, user_id: userId, role: "assistant", parts: clean.parts })
    .onConflictDoNothing()
    .returning({ id: chatMessages.id });
  if (rows.length === 0) {
    const [existing] = await getDb()
      .select({ parts: chatMessages.parts })
      .from(chatMessages)
      .where(eq(chatMessages.id, id))
      .limit(1);
    if (!existing || !sameParts(existing.parts, clean.parts)) {
      throw new Error("assistant_message_conflict");
    }
  }
  await recordAnalyticsEventSafe({
    eventName: "chat_assistant_message",
    actorUserId: userId,
    source: "server",
    idempotencyKey: `chat:assistant:${id}`,
  });
  return { inserted: rows.length > 0, id };
}

/**
 * Persist the visible assistant reply and its durable memory-outbox item in one
 * transaction. A retry can also repair a previously missing outbox row without
 * duplicating either record.
 */
export async function persistCanonicalAssistantAndMemoryJob(
  userId: string,
  dataEpoch: number,
  messageKey: string,
  message: UIMessage,
) {
  const clean = textOnly({ ...message, role: "assistant" });
  if (!clean) return { inserted: false, queued: false };
  const userMessageId = stableMessageId(userId, messageKey, "user");
  const assistantMessageId = stableMessageId(userId, messageKey, "assistant");
  return getDb().transaction(async (tx) => {
    const inserted = await tx
      .insert(chatMessages)
      .values({
        id: assistantMessageId,
        user_id: userId,
        role: "assistant",
        parts: clean.parts,
      })
      .onConflictDoNothing()
      .returning({ id: chatMessages.id });
    const turn = await tx
      .select({ id: chatMessages.id, role: chatMessages.role, parts: chatMessages.parts })
      .from(chatMessages)
      .where(inArray(chatMessages.id, [userMessageId, assistantMessageId]));
    const user = turn.find((entry) => entry.id === userMessageId);
    const assistant = turn.find((entry) => entry.id === assistantMessageId);
    if (!user || !assistant) throw new Error("canonical_turn_incomplete");
    if (!sameParts(assistant.parts, clean.parts)) {
      throw new Error("assistant_message_conflict");
    }
    await tx
      .insert(analyticsEvents)
      .values({
        event_name: "chat_assistant_message",
        actor_user_id: userId,
        source: "server",
        idempotency_key: `chat:assistant:${assistantMessageId}`,
      })
      .onConflictDoNothing();
    const transcript = memoryTranscript(
      user.parts as UIMessage["parts"],
      assistant.parts as UIMessage["parts"],
    );
    if (!transcript) {
      return { inserted: inserted.length > 0, queued: false };
    }
    const queued = await tx
      .insert(memoryJobs)
      .values({
        user_id: userId,
        message_key: messageKey,
        data_epoch: dataEpoch,
        transcript,
      })
      .onConflictDoNothing()
      .returning({ id: memoryJobs.id });
    return { inserted: inserted.length > 0, queued: queued.length > 0 };
  });
}

/** Repair the memory outbox for an already-persisted canonical turn. */
export async function ensureCanonicalTurnMemoryJob(
  userId: string,
  dataEpoch: number,
  messageKey: string,
) {
  const userMessageId = stableMessageId(userId, messageKey, "user");
  const assistantMessageId = stableMessageId(userId, messageKey, "assistant");
  return getDb().transaction(async (tx) => {
    const turn = await tx
      .select({ id: chatMessages.id, parts: chatMessages.parts })
      .from(chatMessages)
      .where(inArray(chatMessages.id, [userMessageId, assistantMessageId]));
    const user = turn.find((entry) => entry.id === userMessageId);
    const assistant = turn.find((entry) => entry.id === assistantMessageId);
    if (!user || !assistant) return { queued: false };
    const transcript = memoryTranscript(
      user.parts as UIMessage["parts"],
      assistant.parts as UIMessage["parts"],
    );
    if (!transcript) return { queued: false };
    const queued = await tx
      .insert(memoryJobs)
      .values({
        user_id: userId,
        message_key: messageKey,
        data_epoch: dataEpoch,
        transcript,
      })
      .onConflictDoNothing()
      .returning({ id: memoryJobs.id });
    return { queued: queued.length > 0 };
  });
}

export async function getCanonicalTurnState(userId: string, messageKey: string) {
  const userIdForTurn = stableMessageId(userId, messageKey, "user");
  const assistantIdForTurn = stableMessageId(userId, messageKey, "assistant");
  const rows = await getDb()
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(eq(chatMessages.user_id, userId));
  const ids = new Set(rows.map((row) => row.id));
  return {
    userPersisted: ids.has(userIdForTurn),
    assistantPersisted: ids.has(assistantIdForTurn),
  };
}

function isSummary(message: UIMessage) {
  return (
    message.role === "user" &&
    message.parts.some(
      (part) => part.type === "text" && part.text.startsWith(ROLLING_SUMMARY_PREFIX),
    )
  );
}

function boundedTranscript(messages: UIMessage[]) {
  const omission = "\n\n[Older detail omitted to keep rolling compaction bounded.]\n\n";
  const tailLimit = SUMMARY_INPUT_CHARS - SUMMARY_HEAD_CHARS - omission.length;
  let head = "";
  let tail = "";
  let totalLength = 0;

  const append = (chunk: string) => {
    if (!chunk) return;
    totalLength += chunk.length;
    let remainder = chunk;
    if (head.length < SUMMARY_HEAD_CHARS) {
      const take = Math.min(SUMMARY_HEAD_CHARS - head.length, remainder.length);
      head += remainder.slice(0, take);
      remainder = remainder.slice(take);
    }
    if (remainder.length >= tailLimit) {
      tail = remainder.slice(-tailLimit);
    } else if (remainder) {
      tail = `${tail}${remainder}`.slice(-tailLimit);
    }
  };

  for (const message of messages) {
    const textParts = message.parts.flatMap((part) =>
      part.type === "text" && part.text.trim() ? [part.text.trim()] : [],
    );
    if (textParts.length === 0) continue;
    append(`${message.role.toUpperCase()}: `);
    textParts.forEach((text, index) => {
      if (index > 0) append("\n");
      append(text);
    });
    append("\n\n");
  }

  const source = `${head}${tail}`.trim();
  if (totalLength <= SUMMARY_INPUT_CHARS) return source;
  return `${head.trimEnd()}${omission}${tail.trimStart()}`;
}

async function summarize(userId: string, messages: UIMessage[]) {
  const source = boundedTranscript(messages);
  if (!source) return "No meaningful earlier context.";

  const usageRequestId = randomUUID();
  const usageStartedAt = Date.now();
  const controller = new AbortController();
  let rejectOnTimeout: ((error: Error) => void) | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    rejectOnTimeout = reject;
  });
  const timeout = setTimeout(() => {
    controller.abort();
    rejectOnTimeout?.(new Error("rolling_summary_timeout"));
  }, SUMMARY_TIMEOUT_MS);
  try {
    const generation = generateText({
      model: getChatModel(),
      maxOutputTokens: 500,
      abortSignal: controller.signal,
      system: `Compress an older fitness-coaching conversation into a rough, compact
handoff for the same coach. Preserve decisions, what was discussed, current plans,
unfinished threads, user corrections, and facts needed to understand the next messages.
Do not invent anything. Do not repeat greetings or filler. Keep it below 350 words.
This is conversation context, not permanent memory. Return only the summary.`,
      prompt: source,
    });
    const result = await Promise.race([generation, timedOut]);
    await recordAiUsageSafe({
      requestId: usageRequestId,
      userId,
      purpose: "chat_compaction",
      succeeded: true,
      startedAt: usageStartedAt,
      usage: {
        inputTokens: result.usage.inputTokens,
        cacheReadTokens: result.usage.inputTokenDetails.cacheReadTokens,
        cacheWriteTokens: result.usage.inputTokenDetails.cacheWriteTokens,
        outputTokens: result.usage.outputTokens,
        reasoningTokens: result.usage.outputTokenDetails.reasoningTokens,
        totalTokens: result.usage.totalTokens,
      },
    });
    return result.text.trim() || "No meaningful earlier context.";
  } catch (error) {
    await recordAiUsageSafe({
      requestId: usageRequestId,
      userId,
      purpose: "chat_compaction",
      succeeded: false,
      startedAt: usageStartedAt,
      errorCode: error instanceof Error ? error.message : "unknown",
    });
    console.error("Rolling chat summary failed", error);
    return source.slice(-12_000);
  } finally {
    clearTimeout(timeout);
  }
}

type CompactionMessage = UIMessage & { createdAt: string };

export type ChatCompactionOptions = {
  /** Injectable for deterministic race tests; production uses the bounded LLM call. */
  summaryGenerator?: (messages: UIMessage[]) => Promise<string>;
};

class StaleCompactionSnapshotError extends Error {
  constructor() {
    super("stale_chat_compaction_snapshot");
  }
}

async function loadCompactionSnapshot(userId: string): Promise<CompactionMessage[]> {
  const rows = await getDb()
    .select({
      id: chatMessages.id,
      role: chatMessages.role,
      parts: chatMessages.parts,
      created_at: chatMessages.created_at,
    })
    .from(chatMessages)
    .where(eq(chatMessages.user_id, userId))
    .orderBy(asc(chatMessages.created_at), asc(chatMessages.id));
  return rows.flatMap((row) => {
    const clean = textOnly({
      id: row.id,
      role: row.role as UIMessage["role"],
      parts: row.parts as UIMessage["parts"],
    });
    return clean ? [{ ...clean, createdAt: row.created_at }] : [];
  });
}

/**
 * Replace only the exact snapshot rows summarized by this invocation. Messages
 * appended while the model is summarizing are never selected for deletion.
 */
export async function compactCanonicalChatHistory(
  userId: string,
  options: ChatCompactionOptions = {},
) {
  const lease = await captureAndRenewChatLease(userId);
  const snapshot = await loadCompactionSnapshot(userId);
  const previousSummaries = snapshot.filter(isSummary);
  const conversation = snapshot.filter((message) => !isSummary(message));
  if (conversation.length < COMPACT_AT_MESSAGES) {
    return { compacted: false, reason: "below_threshold" as const };
  }

  const compactable = conversation.slice(0, -ROLLING_MESSAGES);
  const targets = [...previousSummaries, ...compactable];
  if (targets.length === 0) {
    return { compacted: false, reason: "nothing_to_compact" as const };
  }

  const summaryInput = [...previousSummaries, ...compactable];
  const generatedSummary = await (options.summaryGenerator
    ? options.summaryGenerator(summaryInput)
    : summarize(userId, summaryInput));
  const summaryText = generatedSummary.trim().slice(0, 12_000) || "No meaningful earlier context.";

  // The bounded model call should finish well inside the lease window. If it
  // did not, never continue under a lease now owned by another request.
  if (lease && !(await renewChatLease(lease))) {
    return { compacted: false, reason: "lease_lost" as const };
  }

  const targetIds = targets.map((message) => message.id);
  const freshnessCutoff = targets.reduce(
    (latest, message) => (message.createdAt > latest ? message.createdAt : latest),
    targets[0]!.createdAt,
  );
  const summaryCreatedAt = targets.reduce(
    (earliest, message) => (message.createdAt < earliest ? message.createdAt : earliest),
    targets[0]!.createdAt,
  );
  const summaryId = randomUUID();

  try {
    await getDb().transaction(async (tx) => {
      // Serialize reset/release/acquire with the compaction commit.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"chat:" + userId}, 0))`);
      if (lease) {
        const [owned] = await tx
          .select({ request_id: chatRuns.request_id })
          .from(chatRuns)
          .where(
            and(
              eq(chatRuns.user_id, userId),
              eq(chatRuns.request_id, lease.requestId),
              eq(chatRuns.message_key, lease.messageKey),
              gt(chatRuns.expires_at, new Date()),
            ),
          )
          .limit(1);
        if (!owned) throw new StaleCompactionSnapshotError();
      }

      const deleted = await tx
        .delete(chatMessages)
        .where(
          and(
            eq(chatMessages.user_id, userId),
            inArray(chatMessages.id, targetIds),
            lte(chatMessages.created_at, freshnessCutoff),
          ),
        )
        .returning({ id: chatMessages.id });
      if (deleted.length !== targetIds.length) {
        throw new StaleCompactionSnapshotError();
      }

      await tx.insert(chatMessages).values({
        id: summaryId,
        user_id: userId,
        role: "user",
        parts: [
          {
            type: "text",
            text: `${ROLLING_SUMMARY_PREFIX}\n${summaryText}`,
          },
        ],
        created_at: summaryCreatedAt,
      });
    });
  } catch (error) {
    if (error instanceof StaleCompactionSnapshotError) {
      return { compacted: false, reason: "stale_snapshot" as const };
    }
    throw error;
  }

  return { compacted: true, compactedMessages: compactable.length };
}

/**
 * Compatibility wrapper for non-chat callers. The API route uses append-only
 * canonical writes so a stale client can never replace server history.
 */
export async function persistRollingChatHistory(userId: string, messages: UIMessage[]) {
  const sanitized = messages.flatMap((message) => {
    const clean = textOnly(message);
    return clean ? [clean] : [];
  });
  const createdAt = Date.now();
  if (sanitized.length > 0) {
    await getDb()
      .insert(chatMessages)
      .values(
        sanitized.map((message, index) => ({
          id: stableUuid(
            `${userId}:legacy:${message.id || index}:${message.role}:${JSON.stringify(message.parts)}`,
          ),
          user_id: userId,
          role: message.role,
          parts: message.parts,
          created_at: new Date(createdAt + index).toISOString(),
        })),
      )
      .onConflictDoNothing();
  }
  await compactCanonicalChatHistory(userId);
}
