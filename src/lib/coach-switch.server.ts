import { eq } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import {
  chatMessages,
  mealLogs,
  plans,
  profiles,
  programs,
  weightLogs,
  workoutLogs,
  workoutSessions,
  workspaceFiles,
} from "@/db/schema";
import { getCoach, type CoachId } from "@/lib/coaches";

/**
 * Switch coaches without signing the user out. A different coach starts with a
 * completely clean coaching profile so no memories, plans, or logs cross over.
 */
export async function switchUserCoach(userId: string, coachId: CoachId) {
  const db = getDb();
  const coach = getCoach(coachId);
  const [profile] = await db
    .select({ coach_id: profiles.coach_id })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  if (!profile) {
    await db
      .insert(profiles)
      .values({ id: userId, coach_id: coach.id, coach_gender: coach.gender });
    return { changed: true };
  }

  if (profile.coach_id === coach.id) return { changed: false };

  await db.transaction(async (tx) => {
    await tx.delete(chatMessages).where(eq(chatMessages.user_id, userId));
    await tx.delete(workoutLogs).where(eq(workoutLogs.user_id, userId));
    await tx.delete(mealLogs).where(eq(mealLogs.user_id, userId));
    await tx.delete(weightLogs).where(eq(weightLogs.user_id, userId));
    await tx.delete(workoutSessions).where(eq(workoutSessions.user_id, userId));
    await tx.delete(programs).where(eq(programs.user_id, userId));
    await tx.delete(plans).where(eq(plans.user_id, userId));
    await tx.delete(workspaceFiles).where(eq(workspaceFiles.user_id, userId));
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
        diet_style: null,
        daily_calorie_target: null,
        active_plan_id: null,
        schedule_note: null,
        meal_preferences: null,
        memory_notes: null,
        coach_gender: coach.gender,
        coach_id: coach.id,
      })
      .where(eq(profiles.id, userId));
  });

  return { changed: true };
}
