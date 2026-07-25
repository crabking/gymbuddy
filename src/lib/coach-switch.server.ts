import { and, eq, lte, sql } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import {
  chatMessages,
  chatRuns,
  mealLogs,
  measurements,
  memories,
  memoryJobs,
  plans,
  profiles,
  programOperations,
  programs,
  sessions,
  weightLogs,
  workoutSessions,
  workspaceFiles,
} from "@/db/schema";
import { acquireAccountMutationLock, requireExpectedDataEpoch } from "@/lib/account-epoch.server";
import { getCoach, type CoachId } from "@/lib/coaches";

type ResetOptions = {
  coachId: CoachId;
  invalidateSessions: boolean;
  force: boolean;
};

/**
 * Reset and coach switching share one lock order with chat/program/workout
 * mutations. An active streamed response must finish (or expire) first, so it
 * cannot recreate state after the reset. The epoch invalidates delayed jobs.
 */
async function resetUserCoachingState(userId: string, options: ResetOptions) {
  const db = getDb();
  const coach = getCoach(options.coachId);

  return db.transaction(async (tx) => {
    await acquireAccountMutationLock(tx, userId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"chat:" + userId}, 0))`);
    const now = new Date();
    await tx
      .delete(chatRuns)
      .where(and(eq(chatRuns.user_id, userId), lte(chatRuns.expires_at, now)));
    const [profile] = await tx
      .select({
        coach_id: profiles.coach_id,
        preferred_language: profiles.preferred_language,
      })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    if (!options.force && profile?.coach_id === coach.id) return { changed: false };

    const [activeChat] = await tx
      .select({ request_id: chatRuns.request_id })
      .from(chatRuns)
      .where(eq(chatRuns.user_id, userId))
      .limit(1);
    if (activeChat) throw new Error("chat_in_progress");

    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"program:" + userId}, 0))`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"workout:" + userId}, 0))`,
    );

    if (!profile) {
      await tx
        .insert(profiles)
        .values({ id: userId, coach_id: coach.id, coach_gender: coach.gender });
      return { changed: true };
    }
    await tx.delete(chatMessages).where(eq(chatMessages.user_id, userId));
    await tx.delete(mealLogs).where(eq(mealLogs.user_id, userId));
    await tx.delete(weightLogs).where(eq(weightLogs.user_id, userId));
    await tx.delete(measurements).where(eq(measurements.user_id, userId));
    await tx.delete(workoutSessions).where(eq(workoutSessions.user_id, userId));
    await tx.delete(programOperations).where(eq(programOperations.user_id, userId));
    await tx.delete(programs).where(eq(programs.user_id, userId));
    await tx.delete(plans).where(eq(plans.user_id, userId));
    await tx.delete(memories).where(eq(memories.user_id, userId));
    await tx.delete(memoryJobs).where(eq(memoryJobs.user_id, userId));
    await tx.delete(workspaceFiles).where(eq(workspaceFiles.user_id, userId));
    await tx.delete(chatRuns).where(eq(chatRuns.user_id, userId));
    if (options.invalidateSessions) {
      await tx.delete(sessions).where(eq(sessions.user_id, userId));
    }
    await tx
      .update(profiles)
      .set({
        onboarding_completed: false,
        display_name: null,
        goal: null,
        experience: null,
        days_per_week: null,
        session_minutes: null,
        equipment: null,
        injuries: null,
        height_cm: null,
        weight_kg: null,
        age: null,
        sex: null,
        // Language is an app preference, not coach-owned training state.
        preferred_language: profile.preferred_language,
        activity_level: null,
        recent_training_baseline: null,
        diet_style: null,
        daily_calorie_target: null,
        active_plan_id: null,
        schedule_note: null,
        meal_preferences: null,
        timezone: null,
        coach_gender: coach.gender,
        coach_id: coach.id,
        data_epoch: sql`${profiles.data_epoch} + 1`,
      })
      .where(eq(profiles.id, userId));

    return { changed: true };
  });
}

/**
 * Switch coaches without signing the user out. A different coach starts with a
 * completely clean coaching profile so no memories, plans, or logs cross over.
 */
export async function switchUserCoach(userId: string, coachId: CoachId) {
  return resetUserCoachingState(userId, {
    coachId,
    invalidateSessions: false,
    force: false,
  });
}

/** Full account coaching reset; every login session is revoked atomically. */
export async function resetUserOnboarding(userId: string) {
  return resetUserCoachingState(userId, {
    coachId: "rex",
    invalidateSessions: true,
    force: true,
  });
}

/** Clear only the private workspace without allowing an in-flight chat to recreate it. */
export async function resetUserWorkspace(userId: string, expectedDataEpoch: number) {
  const db = getDb();
  return db.transaction(async (tx) => {
    await requireExpectedDataEpoch(tx, userId, expectedDataEpoch);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"chat:" + userId}, 0))`);
    const now = new Date();
    await tx
      .delete(chatRuns)
      .where(and(eq(chatRuns.user_id, userId), lte(chatRuns.expires_at, now)));
    const [activeChat] = await tx
      .select({ request_id: chatRuns.request_id })
      .from(chatRuns)
      .where(eq(chatRuns.user_id, userId))
      .limit(1);
    if (activeChat) throw new Error("chat_in_progress");

    await tx.delete(workspaceFiles).where(eq(workspaceFiles.user_id, userId));
    await tx
      .update(profiles)
      .set({ data_epoch: sql`${profiles.data_epoch} + 1` })
      .where(eq(profiles.id, userId));
    return { changed: true };
  });
}
