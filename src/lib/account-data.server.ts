import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import {
  adaptationProposals,
  authSessions,
  authUsers,
  billingSubscriptions,
  chatMessages,
  chatRuns,
  mealLogs,
  measurements,
  memories,
  memoryJobs,
  plans,
  policyConsents,
  profiles,
  programDays,
  programExercises,
  programOperations,
  programs,
  sessionExercises,
  sessionSets,
  users,
  weightLogs,
  workoutReviews,
  workoutSessions,
  workspaceFiles,
} from "@/db/schema";
import { CURRENT_POLICY_BUNDLE_VERSION } from "@/lib/policies";

export async function exportAccountData(userId: string) {
  const db = getDb();
  const [
    accountRows,
    profileRows,
    planRows,
    messageRows,
    chatRunRows,
    memoryRows,
    memoryJobRows,
    mealRows,
    programRows,
    operationRows,
    weightRows,
    sessionRows,
    reviewRows,
    proposalRows,
    measurementRows,
    workspaceRows,
    consentRows,
    authAccountRows,
    authSessionRows,
    billingSubscriptionRows,
  ] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        created_at: users.created_at,
      })
      .from(users)
      .where(eq(users.id, userId)),
    db.select().from(profiles).where(eq(profiles.id, userId)),
    db.select().from(plans).where(eq(plans.user_id, userId)),
    db.select().from(chatMessages).where(eq(chatMessages.user_id, userId)),
    db.select().from(chatRuns).where(eq(chatRuns.user_id, userId)),
    db.select().from(memories).where(eq(memories.user_id, userId)),
    db.select().from(memoryJobs).where(eq(memoryJobs.user_id, userId)),
    db.select().from(mealLogs).where(eq(mealLogs.user_id, userId)),
    db.select().from(programs).where(eq(programs.user_id, userId)),
    db.select().from(programOperations).where(eq(programOperations.user_id, userId)),
    db.select().from(weightLogs).where(eq(weightLogs.user_id, userId)),
    db.select().from(workoutSessions).where(eq(workoutSessions.user_id, userId)),
    db.select().from(workoutReviews).where(eq(workoutReviews.user_id, userId)),
    db.select().from(adaptationProposals).where(eq(adaptationProposals.user_id, userId)),
    db.select().from(measurements).where(eq(measurements.user_id, userId)),
    db.select().from(workspaceFiles).where(eq(workspaceFiles.user_id, userId)),
    db.select().from(policyConsents).where(eq(policyConsents.user_id, userId)),
    db
      .select({
        email_verified: authUsers.emailVerified,
        two_factor_enabled: authUsers.twoFactorEnabled,
        role: authUsers.role,
        created_at: authUsers.createdAt,
        updated_at: authUsers.updatedAt,
      })
      .from(authUsers)
      .where(eq(authUsers.id, userId)),
    db
      .select({
        id: authSessions.id,
        expires_at: authSessions.expiresAt,
        ip_address: authSessions.ipAddress,
        user_agent: authSessions.userAgent,
        created_at: authSessions.createdAt,
        updated_at: authSessions.updatedAt,
      })
      .from(authSessions)
      .where(eq(authSessions.userId, userId)),
    db.select().from(billingSubscriptions).where(eq(billingSubscriptions.referenceId, userId)),
  ]);

  const programIds = programRows.map((row) => row.id);
  const programDayRows = programIds.length
    ? await db.select().from(programDays).where(inArray(programDays.program_id, programIds))
    : [];
  const programDayIds = programDayRows.map((row) => row.id);
  const programExerciseRows = programDayIds.length
    ? await db
        .select()
        .from(programExercises)
        .where(inArray(programExercises.program_day_id, programDayIds))
    : [];
  const sessionIds = sessionRows.map((row) => row.id);
  const sessionExerciseRows = sessionIds.length
    ? await db
        .select()
        .from(sessionExercises)
        .where(inArray(sessionExercises.session_id, sessionIds))
    : [];
  const sessionExerciseIds = sessionExerciseRows.map((row) => row.id);
  const sessionSetRows = sessionExerciseIds.length
    ? await db
        .select()
        .from(sessionSets)
        .where(inArray(sessionSets.session_exercise_id, sessionExerciseIds))
    : [];

  return {
    format: "coach-account-export",
    format_version: 1,
    generated_at: new Date().toISOString(),
    current_policy_bundle: CURRENT_POLICY_BUNDLE_VERSION,
    account: accountRows[0]
      ? {
          ...accountRows[0],
          authentication: authAccountRows[0]
            ? { provider: "better-auth", ...authAccountRows[0] }
            : { provider: "local" },
        }
      : null,
    profile: profileRows[0] ?? null,
    authentication_sessions: authSessionRows,
    policy_consents: consentRows,
    chat_messages: messageRows,
    chat_runs: chatRunRows,
    memories: memoryRows,
    pending_memory_jobs: memoryJobRows,
    workspace_files: workspaceRows,
    legacy_plans: planRows,
    programs: programRows,
    program_days: programDayRows,
    program_exercises: programExerciseRows,
    program_operations: operationRows,
    workout_sessions: sessionRows,
    session_exercises: sessionExerciseRows,
    session_sets: sessionSetRows,
    workout_reviews: reviewRows,
    adaptation_proposals: proposalRows,
    meals: mealRows,
    weight_logs: weightRows,
    measurements: measurementRows,
    billing_subscriptions: billingSubscriptionRows,
    billing_note:
      "Payment methods, card details, invoices, and tax records are held by Stripe and are not copied into COACH.",
    photo_files: [],
    photo_note:
      "COACH does not retain uploaded photo files. Images are sent to the configured AI provider for the active request only.",
  };
}
