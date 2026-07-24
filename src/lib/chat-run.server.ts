import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import { chatRuns } from "@/db/schema";

const CHAT_LEASE_MS = 5 * 60_000;

export type ChatLease = {
  userId: string;
  requestId: string;
  messageKey: string;
};

async function lockUserChat(
  tx: Pick<ReturnType<typeof getDb>, "execute">,
  userId: string,
): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"chat:" + userId}, 0))`);
}

/**
 * Stable across a browser retry but private to this account when persisted.
 * UI message ids are preferred; the bounded fallback never hashes image bytes.
 */
export function chatMessageKey(message: {
  id?: string;
  parts: Array<Record<string, unknown>>;
}): string {
  if (message.id?.trim()) {
    return createHash("sha256").update(`id:${message.id.trim()}`).digest("hex");
  }

  const safeParts = message.parts.map((part) => ({
    type: typeof part.type === "string" ? part.type : "",
    text: typeof part.text === "string" ? part.text : "",
    mediaType: typeof part.mediaType === "string" ? part.mediaType : "",
    // The data URL itself can be many megabytes. Its length and tail are enough
    // to make an accidental retry stable without retaining the photo.
    url: typeof part.url === "string" ? `${part.url.length}:${part.url.slice(-128)}` : "",
  }));
  return createHash("sha256").update(JSON.stringify(safeParts)).digest("hex");
}

export function sourceKey(messageKey: string, operation: string): string {
  return createHash("sha256").update(`${messageKey}:${operation}`).digest("hex");
}

/**
 * Acquire one cross-process chat lease per user. The advisory lock also
 * serializes this operation with coach switching and full-account resets.
 */
export async function acquireChatLease(
  userId: string,
  messageKey: string,
): Promise<ChatLease | null> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await lockUserChat(tx, userId);
    const now = new Date();
    await tx
      .delete(chatRuns)
      .where(and(eq(chatRuns.user_id, userId), lte(chatRuns.expires_at, now)));
    const [existing] = await tx
      .select({ request_id: chatRuns.request_id })
      .from(chatRuns)
      .where(eq(chatRuns.user_id, userId))
      .limit(1);
    if (existing) return null;

    const requestId = randomUUID();
    await tx.insert(chatRuns).values({
      user_id: userId,
      request_id: requestId,
      message_key: messageKey,
      expires_at: new Date(Date.now() + CHAT_LEASE_MS),
    });
    return { userId, requestId, messageKey };
  });
}

/**
 * Extend a lease only when the caller still owns the live row. Long-running
 * model work must renew before doing follow-up persistence so an expired run
 * can never operate under a replacement request's lease.
 */
export async function renewChatLease(lease: ChatLease): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    await lockUserChat(tx, lease.userId);
    const now = new Date();
    const renewed = await tx
      .update(chatRuns)
      .set({ expires_at: new Date(now.getTime() + CHAT_LEASE_MS) })
      .where(
        and(
          eq(chatRuns.user_id, lease.userId),
          eq(chatRuns.request_id, lease.requestId),
          eq(chatRuns.message_key, lease.messageKey),
          gt(chatRuns.expires_at, now),
        ),
      )
      .returning({ request_id: chatRuns.request_id });
    return renewed.length === 1;
  });
}

/**
 * Capture and renew the currently active lease. This is used by server-side
 * maintenance that runs inside a chat completion callback where the lease
 * object itself is not part of the callback signature.
 */
export async function captureAndRenewChatLease(userId: string): Promise<ChatLease | null> {
  return getDb().transaction(async (tx) => {
    await lockUserChat(tx, userId);
    const now = new Date();
    const [current] = await tx
      .select({
        request_id: chatRuns.request_id,
        message_key: chatRuns.message_key,
      })
      .from(chatRuns)
      .where(and(eq(chatRuns.user_id, userId), gt(chatRuns.expires_at, now)))
      .limit(1);
    if (!current) return null;

    const renewed = await tx
      .update(chatRuns)
      .set({ expires_at: new Date(now.getTime() + CHAT_LEASE_MS) })
      .where(
        and(
          eq(chatRuns.user_id, userId),
          eq(chatRuns.request_id, current.request_id),
          eq(chatRuns.message_key, current.message_key),
          gt(chatRuns.expires_at, now),
        ),
      )
      .returning({ request_id: chatRuns.request_id });
    if (renewed.length !== 1) return null;
    return {
      userId,
      requestId: current.request_id,
      messageKey: current.message_key,
    };
  });
}

export async function releaseChatLease(lease: ChatLease): Promise<void> {
  await getDb().transaction(async (tx) => {
    await lockUserChat(tx, lease.userId);
    await tx
      .delete(chatRuns)
      .where(
        and(
          eq(chatRuns.user_id, lease.userId),
          eq(chatRuns.request_id, lease.requestId),
          eq(chatRuns.message_key, lease.messageKey),
        ),
      );
  });
}
