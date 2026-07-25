import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import {
  chatMessages,
  measurements,
  memoryJobs,
  profiles,
  sessions,
  users,
  workspaceFiles,
} from "@/db/schema";
import {
  appendCanonicalAssistantMessage,
  appendCanonicalUserMessage,
  ensureCanonicalTurnMemoryJob,
  loadCanonicalChatHistory,
  persistCanonicalAssistantAndMemoryJob,
} from "@/lib/chat-history.server";
import { acquireChatLease, releaseChatLease, type ChatLease } from "@/lib/chat-run.server";
import { resetUserWorkspace, switchUserCoach } from "@/lib/coach-switch.server";
import { processPendingMemoryJob } from "@/lib/memory.server";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const suite = describe.runIf(databaseAvailable);

suite("chat/reset concurrency invariants", () => {
  const db = databaseAvailable ? getDb() : null;
  let userId = "";
  let outstandingLease: ChatLease | null = null;

  beforeAll(async () => {
    const [user] = await db!
      .insert(users)
      .values({
        email: `chat-state-${crypto.randomUUID()}@test.invalid`,
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
    if (outstandingLease) await releaseChatLease(outstandingLease);
    if (userId) await db!.delete(users).where(eq(users.id, userId));
  });

  it("serializes chat leases and refuses a workspace reset during a stream", async () => {
    outstandingLease = await acquireChatLease(userId, "turn-one");
    expect(outstandingLease).not.toBeNull();
    await expect(acquireChatLease(userId, "turn-two")).resolves.toBeNull();
    await expect(resetUserWorkspace(userId, 0)).rejects.toThrow("chat_in_progress");

    await releaseChatLease(outstandingLease!);
    outstandingLease = null;
    await db!.insert(workspaceFiles).values({
      user_id: userId,
      path: "notes/test.md",
      content: "temporary",
      size_bytes: 9,
      summary: "temporary",
    });
    await expect(resetUserWorkspace(userId, 0)).resolves.toMatchObject({ changed: true });
    await expect(
      db!.select().from(workspaceFiles).where(eq(workspaceFiles.user_id, userId)),
    ).resolves.toHaveLength(0);
    const [profile] = await db!
      .select({ data_epoch: profiles.data_epoch })
      .from(profiles)
      .where(eq(profiles.id, userId));
    expect(profile.data_epoch).toBe(1);
  });

  it("persists each canonical turn once and ignores a retried message", async () => {
    const message = {
      id: "client-turn",
      role: "user" as const,
      parts: [{ type: "text" as const, text: "Remember this turn." }],
    };
    await expect(appendCanonicalUserMessage(userId, "stable-turn", message)).resolves.toMatchObject(
      { inserted: true },
    );
    await expect(appendCanonicalUserMessage(userId, "stable-turn", message)).resolves.toMatchObject(
      { inserted: false },
    );
    await expect(
      appendCanonicalUserMessage(userId, "stable-turn", {
        ...message,
        parts: [{ type: "text", text: "Different content with a reused id." }],
      }),
    ).rejects.toThrow("message_id_conflict");
    await appendCanonicalAssistantMessage(userId, "stable-turn", {
      id: "assistant-turn",
      role: "assistant",
      parts: [{ type: "text", text: "Stored once." }],
    });
    await expect(
      appendCanonicalAssistantMessage(userId, "stable-turn", {
        id: "assistant-turn-retry",
        role: "assistant",
        parts: [{ type: "text", text: "Duplicate." }],
      }),
    ).rejects.toThrow("assistant_message_conflict");
    const history = await loadCanonicalChatHistory(userId);
    expect(history).toHaveLength(2);
    expect(history.map((entry) => entry.parts[0])).toEqual([
      { type: "text", text: "Remember this turn." },
      { type: "text", text: "Stored once." },
    ]);
  });

  it("commits the assistant reply and memory outbox atomically and repairs a missing job", async () => {
    const turnKey = "atomic-memory-turn";
    await appendCanonicalUserMessage(userId, turnKey, {
      id: "atomic-user",
      role: "user",
      parts: [{ type: "text", text: "I prefer short morning workouts." }],
    });
    const assistant = {
      id: "atomic-assistant",
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: "I will keep that in mind." }],
    };
    await expect(
      persistCanonicalAssistantAndMemoryJob(userId, 1, turnKey, assistant),
    ).resolves.toMatchObject({ inserted: true, queued: true });
    await expect(
      persistCanonicalAssistantAndMemoryJob(userId, 1, turnKey, assistant),
    ).resolves.toMatchObject({ inserted: false, queued: false });
    await expect(
      db!.select().from(memoryJobs).where(eq(memoryJobs.user_id, userId)),
    ).resolves.toHaveLength(1);

    await db!.delete(memoryJobs).where(eq(memoryJobs.user_id, userId));
    await expect(ensureCanonicalTurnMemoryJob(userId, 1, turnKey)).resolves.toMatchObject({
      queued: true,
    });
    await expect(
      db!.select().from(memoryJobs).where(eq(memoryJobs.user_id, userId)),
    ).resolves.toHaveLength(1);
  });

  it("removes duplicated transcript payload from terminal memory jobs", async () => {
    await db!.delete(memoryJobs).where(eq(memoryJobs.user_id, userId));
    const [job] = await db!
      .insert(memoryJobs)
      .values({
        user_id: userId,
        message_key: "exhausted-memory-job",
        data_epoch: 1,
        transcript: "x".repeat(10_000),
        status: "processing",
        attempts: 5,
        available_at: new Date(Date.now() - 60_000).toISOString(),
      })
      .returning({ id: memoryJobs.id });
    await expect(processPendingMemoryJob(userId)).resolves.toEqual({ processed: false });
    const [terminal] = await db!
      .select({
        status: memoryJobs.status,
        transcript: memoryJobs.transcript,
      })
      .from(memoryJobs)
      .where(eq(memoryJobs.id, job.id));
    expect(terminal).toEqual({ status: "discarded", transcript: "[processed]" });
  });

  it("switches coaches atomically, clears coach state, and keeps the login session", async () => {
    await db!.update(profiles).set({ preferred_language: "sv" }).where(eq(profiles.id, userId));
    await db!.insert(measurements).values({
      user_id: userId,
      metric_key: "waist",
      label: "Waist",
      value: 90,
      unit: "cm",
      recorded_date: "2026-07-24",
    });
    await db!.insert(workspaceFiles).values({
      user_id: userId,
      path: "notes/coach.md",
      content: "old coach",
      size_bytes: 9,
      summary: "old coach",
    });
    const sessionId = crypto.randomUUID().replaceAll("-", "").padEnd(64, "0");
    await db!.insert(sessions).values({
      id: sessionId,
      user_id: userId,
      expires_at: new Date(Date.now() + 60_000),
    });

    await expect(switchUserCoach(userId, "maya")).resolves.toMatchObject({
      changed: true,
    });
    const [profile] = await db!.select().from(profiles).where(eq(profiles.id, userId));
    expect(profile).toMatchObject({
      coach_id: "maya",
      coach_gender: "female",
      preferred_language: "sv",
      onboarding_completed: false,
      data_epoch: 2,
    });
    await expect(
      db!.select().from(chatMessages).where(eq(chatMessages.user_id, userId)),
    ).resolves.toHaveLength(0);
    await expect(
      db!.select().from(measurements).where(eq(measurements.user_id, userId)),
    ).resolves.toHaveLength(0);
    await expect(
      db!.select().from(workspaceFiles).where(eq(workspaceFiles.user_id, userId)),
    ).resolves.toHaveLength(0);
    await expect(
      db!.select().from(sessions).where(eq(sessions.user_id, userId)),
    ).resolves.toHaveLength(1);

    await db!.insert(workspaceFiles).values({
      user_id: userId,
      path: "notes/same-coach.md",
      content: "keep",
      size_bytes: 4,
      summary: "keep",
    });
    await expect(switchUserCoach(userId, "maya")).resolves.toMatchObject({
      changed: false,
    });
    await expect(
      db!.select().from(workspaceFiles).where(eq(workspaceFiles.user_id, userId)),
    ).resolves.toHaveLength(1);
  });
});
