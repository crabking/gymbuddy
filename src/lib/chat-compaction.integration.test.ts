import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import { chatMessages, profiles, users } from "@/db/schema";
import {
  appendCanonicalUserMessage,
  compactCanonicalChatHistory,
  ROLLING_SUMMARY_PREFIX,
} from "@/lib/chat-history.server";
import { acquireChatLease, releaseChatLease, type ChatLease } from "@/lib/chat-run.server";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const suite = describe.runIf(databaseAvailable);

suite("rolling chat compaction", () => {
  const db = databaseAvailable ? getDb() : null;
  let userId = "";
  let lease: ChatLease | null = null;

  beforeAll(async () => {
    const [user] = await db!
      .insert(users)
      .values({
        email: `chat-compaction-${crypto.randomUUID()}@test.invalid`,
        password_hash: "test-only",
      })
      .returning({ id: users.id });
    userId = user.id;
    await db!.insert(profiles).values({
      id: userId,
      coach_id: "rex",
      coach_gender: "male",
      onboarding_completed: true,
    });
  });

  afterAll(async () => {
    if (lease) await releaseChatLease(lease);
    if (userId) await db!.delete(users).where(eq(users.id, userId));
  });

  it("does not lose a turn appended while summary generation is delayed", async () => {
    const oldIds = Array.from({ length: 100 }, () => crypto.randomUUID());
    const firstCreatedAt = Date.now() - 60_000;
    await db!.insert(chatMessages).values(
      oldIds.map((id, index) => ({
        id,
        user_id: userId,
        role: index % 2 === 0 ? "user" : "assistant",
        parts: [{ type: "text", text: `old-message-${index}` }],
        created_at: new Date(firstCreatedAt + index).toISOString(),
      })),
    );

    lease = await acquireChatLease(userId, "compaction-race");
    expect(lease).not.toBeNull();

    let announceSummaryStarted!: () => void;
    const summaryStarted = new Promise<void>((resolve) => {
      announceSummaryStarted = resolve;
    });
    let finishSummary!: (summary: string) => void;
    const delayedSummary = new Promise<string>((resolve) => {
      finishSummary = resolve;
    });

    const compacting = compactCanonicalChatHistory(userId, {
      summaryGenerator: async (messages) => {
        expect(messages).toHaveLength(90);
        announceSummaryStarted();
        return delayedSummary;
      },
    });

    await summaryStarted;
    const appended = await appendCanonicalUserMessage(userId, "concurrent-new-turn", {
      id: "newer-client-turn",
      role: "user",
      parts: [{ type: "text", text: "This arrived while compaction was summarizing." }],
    });
    finishSummary("The older conversation was compacted safely.");

    await expect(compacting).resolves.toMatchObject({
      compacted: true,
      compactedMessages: 90,
    });

    const rows = await db!
      .select({
        id: chatMessages.id,
        parts: chatMessages.parts,
      })
      .from(chatMessages)
      .where(eq(chatMessages.user_id, userId))
      .orderBy(asc(chatMessages.created_at), asc(chatMessages.id));
    const remainingIds = new Set(rows.map((row) => row.id));
    expect(rows).toHaveLength(12);
    expect(remainingIds.has(appended.id)).toBe(true);
    expect(oldIds.slice(0, 90).every((id) => !remainingIds.has(id))).toBe(true);
    expect(oldIds.slice(-10).every((id) => remainingIds.has(id))).toBe(true);
    expect(
      rows.filter((row) =>
        (row.parts as Array<{ type?: string; text?: string }>).some(
          (part) => part.type === "text" && part.text?.startsWith(ROLLING_SUMMARY_PREFIX),
        ),
      ),
    ).toHaveLength(1);

    await releaseChatLease(lease!);
    lease = null;
  });
});
