import { createServerFn } from "@tanstack/react-start";
import { requireAuth, requireIdentity } from "@/lib/auth-middleware";
import { COACH_IDS } from "@/lib/coaches";
import { z } from "zod";

// Server-only db modules are imported dynamically inside handlers so `pg` never
// reaches the client bundle. Access control (previously Postgres RLS) is now
// enforced here: every query filters by context.userId.

/* -------------------- profile & messages -------------------- */

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireIdentity])
  .handler(async ({ context }) => {
    const { eq } = await import("drizzle-orm");
    const { getDb } = await import("@/db/db.server");
    const { profiles } = await import("@/db/schema");
    const db = getDb();
    const [row] = await db.select().from(profiles).where(eq(profiles.id, context.userId)).limit(1);
    if (row) return row;
    // Ensure a profile exists (replaces the old on-signup trigger).
    const [created] = await db
      .insert(profiles)
      .values({ id: context.userId })
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    const [existing] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, context.userId))
      .limit(1);
    return existing ?? null;
  });

export const getChatMessages = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { eq, asc } = await import("drizzle-orm");
    const { getDb } = await import("@/db/db.server");
    const { chatMessages } = await import("@/db/schema");
    const rows = await getDb()
      .select({ id: chatMessages.id, role: chatMessages.role, parts: chatMessages.parts })
      .from(chatMessages)
      .where(eq(chatMessages.user_id, context.userId))
      .orderBy(asc(chatMessages.created_at));
    return rows.map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant" | "system",
      parts: m.parts as Array<{ type: string; text?: string }>,
    }));
  });

export const getMemories = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { listMemories } = await import("@/lib/memory.server");
    return listMemories(context.userId);
  });

export const removeMemory = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { deleteMemory } = await import("@/lib/memory.server");
    await deleteMemory(context.userId, data.id);
    return { ok: true };
  });

export const getWorkspaceFiles = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { eq, asc } = await import("drizzle-orm");
    const { getDb } = await import("@/db/db.server");
    const { workspaceFiles } = await import("@/db/schema");
    const rows = await getDb()
      .select({
        path: workspaceFiles.path,
        content: workspaceFiles.content,
        updated_at: workspaceFiles.updated_at,
      })
      .from(workspaceFiles)
      .where(eq(workspaceFiles.user_id, context.userId))
      .orderBy(asc(workspaceFiles.path));
    return rows.map((file) => ({
      path: file.path,
      content: file.content,
      updated_at: file.updated_at,
      summary: (file.content ?? "").split("\n")[0]?.trim() ?? "",
    }));
  });

/* -------------------- onboarding & profile updates -------------------- */

const OnboardingSchema = z
  .object({
    expected_data_epoch: z.number().int().min(0),
    display_name: z.string().min(1).max(80),
    goal: z.string().min(1).max(1_000),
    experience: z.enum(["beginner", "intermediate", "advanced"]),
    days_per_week: z.number().int().min(1).max(7),
    session_minutes: z.number().int().min(15).max(240),
    equipment: z.string().min(1).max(500),
    injuries: z.string().max(500).optional().default(""),
    height_cm: z.number().min(100).max(260),
    weight_kg: z.number().min(30).max(300),
    age: z.number().int().min(18).max(100),
    sex: z.enum(["male", "female", "other"]),
    preferred_language: z.enum(["en", "sv"]),
    activity_level: z.enum(["sedentary", "moderate", "high"]),
    recent_training_baseline: z.string().min(1).max(4000),
    diet_style: z.string().min(1).max(100),
    daily_calorie_target: z.number().int().min(1000).max(6000).optional().nullable(),
  })
  .strict();

export const saveOnboarding = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((input: unknown) => OnboardingSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { eq } = await import("drizzle-orm");
    const { getDb } = await import("@/db/db.server");
    const { profiles } = await import("@/db/schema");
    const { requireExpectedDataEpoch } = await import("@/lib/account-epoch.server");
    await getDb().transaction(async (tx) => {
      await requireExpectedDataEpoch(tx, context.userId, data.expected_data_epoch);
      await tx
        .update(profiles)
        .set({
          display_name: data.display_name,
          goal: data.goal,
          experience: data.experience,
          days_per_week: data.days_per_week,
          session_minutes: data.session_minutes,
          equipment: data.equipment,
          injuries: data.injuries || null,
          height_cm: data.height_cm,
          weight_kg: data.weight_kg,
          age: data.age,
          sex: data.sex,
          preferred_language: data.preferred_language,
          activity_level: data.activity_level,
          recent_training_baseline: data.recent_training_baseline,
          diet_style: data.diet_style,
          daily_calorie_target: data.daily_calorie_target ?? null,
          onboarding_completed: true,
        })
        .where(eq(profiles.id, context.userId));
    });
    const { recordAnalyticsEventSafe } = await import("@/lib/analytics.server");
    await recordAnalyticsEventSafe({
      eventName: "onboarding_completed",
      actorUserId: context.userId,
      source: "server",
      idempotencyKey: `onboarding:${context.userId}:${data.expected_data_epoch}`,
    });
    return { ok: true };
  });

const ProfilePatchSchema = z
  .object({
    expected_data_epoch: z.number().int().min(0),
    display_name: z.string().trim().min(1).max(80).optional(),
    goal: z.string().trim().min(1).max(500).optional(),
    experience: z.enum(["beginner", "intermediate", "advanced"]).optional(),
    days_per_week: z.number().int().min(1).max(7).nullable().optional(),
    session_minutes: z.number().int().min(15).max(240).nullable().optional(),
    equipment: z.string().trim().min(1).max(500).optional(),
    injuries: z.string().max(500).nullable().optional(),
    height_cm: z.number().min(100).max(260).nullable().optional(),
    weight_kg: z.number().min(25).max(400).nullable().optional(),
    age: z.number().int().min(18).max(120).nullable().optional(),
    sex: z.enum(["male", "female", "other"]).optional(),
    preferred_language: z.enum(["en", "sv"]).nullable().optional(),
    activity_level: z.enum(["sedentary", "moderate", "high"]).nullable().optional(),
    recent_training_baseline: z.string().max(4000).nullable().optional(),
    diet_style: z.string().trim().min(1).max(100).optional(),
    daily_calorie_target: z.number().int().min(1000).max(6000).nullable().optional(),
    schedule_note: z.string().max(2000).nullable().optional(),
    meal_preferences: z.string().max(2000).nullable().optional(),
    timezone: z.string().trim().min(1).max(64).nullable().optional(),
  })
  .strict();

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((input: unknown) => ProfilePatchSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { expected_data_epoch: expectedDataEpoch, ...profileFields } = data;
    const patch = Object.fromEntries(
      Object.entries(profileFields).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(patch).length === 0) return { ok: true };
    const { eq } = await import("drizzle-orm");
    const { getDb } = await import("@/db/db.server");
    const { profiles } = await import("@/db/schema");
    const { requireExpectedDataEpoch } = await import("@/lib/account-epoch.server");
    await getDb().transaction(async (tx) => {
      await requireExpectedDataEpoch(tx, context.userId, expectedDataEpoch);
      await tx.update(profiles).set(patch).where(eq(profiles.id, context.userId));
    });
    return { ok: true };
  });

/* -------------------- live modules (session + nutrition) -------------------- */

export const getActiveWorkoutSession = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { getActiveSession } = await import("@/lib/workout-session.server");
    return getActiveSession(context.userId);
  });

export const getWorkoutSessionReviewContext = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .validator((input: unknown) => z.object({ session_id: z.string().uuid() }).strict().parse(input))
  .handler(async ({ data, context }) => {
    const { getSessionReviewContext } = await import("@/lib/workout-session.server");
    return getSessionReviewContext(context.userId, data.session_id);
  });

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Invalid date");

export const startTodayWorkoutSession = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((input: unknown) =>
    z
      .object({
        date: IsoDateSchema,
        request_id: z.string().uuid(),
        expected_data_epoch: z.number().int().min(0),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const serverToday = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const requested = new Date(`${data.date}T00:00:00.000Z`);
    if (Math.abs(requested.getTime() - serverToday.getTime()) > 86_400_000) {
      return {
        ok: false as const,
        error: "invalid_local_date",
        coach_note: "Refresh the app before starting this workout.",
      };
    }
    const { startSession } = await import("@/lib/workout-session.server");
    return startSession(context.userId, {
      date: data.date,
      source_key: `ui-start:${data.request_id}`,
      start_next_now: true,
      expected_data_epoch: data.expected_data_epoch,
    });
  });

export const skipNextWorkoutSession = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((input: unknown) =>
    z
      .object({
        client_date: IsoDateSchema,
        program_day_id: z.string().uuid(),
        program_day_date: IsoDateSchema,
        reason: z.string().trim().min(1).max(500).nullable(),
        request_id: z.string().uuid(),
        expected_program_revision: z.number().int().min(0),
        expected_data_epoch: z.number().int().min(0),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const serverToday = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const requested = new Date(`${data.client_date}T00:00:00.000Z`);
    if (Math.abs(requested.getTime() - serverToday.getTime()) > 86_400_000) {
      return {
        ok: false as const,
        error: "invalid_local_date",
        coach_note: "Refresh the app before skipping this workout.",
      };
    }
    const { getNextProgramDay, resolveProgramDay } = await import("@/lib/program.server");
    const next = await getNextProgramDay(context.userId, data.client_date);
    if (
      !next ||
      next.id !== data.program_day_id ||
      next.date !== data.program_day_date ||
      next.status !== "planned"
    ) {
      return {
        ok: false as const,
        error: "workout_changed",
        coach_note: "The next workout changed on another device. Refresh and review it first.",
      };
    }
    const result = await resolveProgramDay(context.userId, {
      date: data.program_day_date,
      day_id: data.program_day_id,
      status: "skipped",
      reason: data.reason ?? "No reason provided by user.",
      source_key: `ui-skip:${data.request_id}`,
      auto_recover_progression: true,
      expected_program_revision: data.expected_program_revision,
      expected_data_epoch: data.expected_data_epoch,
    });
    if (!result.ok) {
      return {
        ...result,
        coach_note:
          result.error === "program_revision_conflict"
            ? "The program changed on another device. Refresh and review it before skipping."
            : "That workout could not be skipped safely. Refresh and try again.",
      };
    }
    return result;
  });

export const completeActiveSession = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((input: unknown) =>
    z
      .object({
        session_id: z.string().uuid(),
        expected_data_epoch: z.number().int().min(0),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { completeSession } = await import("@/lib/workout-session.server");
    return completeSession(context.userId, {
      session_id: data.session_id,
      expected_data_epoch: data.expected_data_epoch,
    });
  });

const WorkoutReviewSchema = z
  .object({
    session_id: z.string().uuid(),
    difficulty: z.number().int().min(1).max(5),
    energy: z.number().int().min(1).max(5),
    discomfort: z.number().int().min(1).max(5),
    note: z.string().trim().max(1000).nullable().optional(),
    expected_data_epoch: z.number().int().min(0),
  })
  .strict();

export const submitPostWorkoutReview = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((input: unknown) => WorkoutReviewSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { submitWorkoutReview } = await import("@/lib/adaptive-training.server");
    return submitWorkoutReview(context.userId, data);
  });

export const getPendingAdaptation = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { getPendingAdaptation: readPendingAdaptation } =
      await import("@/lib/adaptive-training.server");
    return readPendingAdaptation(context.userId);
  });

const AdaptationDecisionSchema = z
  .object({
    proposal_id: z.string().uuid(),
    option_id: z.string().trim().min(1).max(100),
    expected_program_revision: z.number().int().min(0),
    expected_data_epoch: z.number().int().min(0),
  })
  .strict();

export const decidePostWorkoutAdaptation = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((input: unknown) => AdaptationDecisionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { decideAdaptation } = await import("@/lib/adaptive-training.server");
    return decideAdaptation(context.userId, data);
  });

export const getProgramAdaptationHistory = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((input: unknown) =>
    z
      .object({
        program_id: z.string().uuid().nullable().optional(),
        limit: z.number().int().min(1).max(50).optional().default(20),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { getAdaptationHistory } = await import("@/lib/adaptive-training.server");
    return getAdaptationHistory(context.userId, {
      programId: data.program_id ?? null,
      limit: data.limit,
    });
  });

const LocalContextSchema = z
  .object({
    date: IsoDateSchema,
    timezone: z.string().trim().min(1).max(64),
  })
  .strict();

export const getNutritionToday = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((input: unknown) => LocalContextSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { getNutrition } = await import("@/lib/nutrition.server");
    return getNutrition(context.userId, data.date, data.timezone);
  });

export const getTodayTrainingInfo = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((input: unknown) =>
    z
      .object({
        date: IsoDateSchema,
        weekday: z.enum([
          "Sunday",
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
        ]),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // Structured program first; fall back to the markdown schedule.
    const { getTodayProgramDay, getNextProgramDay } = await import("@/lib/program.server");
    const today = data.date;
    const todayDay = await getTodayProgramDay(context.userId, today);
    if (todayDay && todayDay.status === "planned") {
      return {
        label: `${todayDay.title}${todayDay.is_deload ? " (deload)" : ""}`,
        detail: "today",
        has_program: true,
        program_day_id: todayDay.id,
        program_day_date: todayDay.date,
        day_index: todayDay.day_index,
        week: todayDay.week,
        program_revision: todayDay.program_revision,
      };
    }
    const next = await getNextProgramDay(context.userId, today);
    if (next) {
      return {
        label: `${next.title}${next.is_deload ? " (deload)" : ""}`,
        detail:
          next.date === today
            ? "today"
            : next.schedule_mode === "rolling"
              ? `Day ${next.day_index}`
              : next.date,
        has_program: true,
        program_day_id: next.id,
        program_day_date: next.date,
        day_index: next.day_index,
        week: next.week,
        program_revision: next.program_revision,
      };
    }
    const { getTodayTraining } = await import("@/lib/schedule.server");
    const scheduled = await getTodayTraining(context.userId, data);
    return { ...scheduled, has_program: false };
  });

export const getProgramFull = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((input: unknown) => z.object({ date: IsoDateSchema }).strict().parse(input))
  .handler(async ({ data, context }) => {
    const { getCurrentProgram } = await import("@/lib/program.server");
    return getCurrentProgram(context.userId, data.date);
  });

export const getDashboard = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((input: unknown) => LocalContextSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { getDashboardData } = await import("@/lib/dashboard.server");
    return getDashboardData(context.userId, 400, data.date, data.timezone);
  });

const DashboardHistorySchema = z
  .object({
    limit: z.number().int().min(1).max(100),
    before: z
      .object({
        session_date: IsoDateSchema,
        created_at: z.string().datetime({ offset: true }),
        id: z.string().uuid(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const getDashboardHistory = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((input: unknown) => DashboardHistorySchema.parse(input))
  .handler(async ({ data, context }) => {
    const { getDashboardHistoryPage } = await import("@/lib/dashboard.server");
    return getDashboardHistoryPage(context.userId, data);
  });

export const toggleSessionSet = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((input: unknown) =>
    z
      .object({
        set_id: z.string().uuid(),
        expected_data_epoch: z.number().int().min(0),
        expected_revision: z.number().int().min(0),
        completed: z.boolean(),
        weight_kg: z.number().min(0).max(1000).nullable().optional(),
        reps: z.number().int().min(1).max(1000).nullable().optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { markSetDone } = await import("@/lib/workout-session.server");
    return markSetDone(context.userId, data.set_id, {
      expected_revision: data.expected_revision,
      expected_data_epoch: data.expected_data_epoch,
      completed: data.completed,
      weight_kg: data.weight_kg,
      reps: data.reps,
    });
  });

export const logWeight = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((input: unknown) =>
    z
      .object({
        weight_kg: z.number().min(25).max(400),
        local_date: IsoDateSchema,
        timezone: z.string().trim().min(1).max(64),
        expected_data_epoch: z.number().int().min(0),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { eq } = await import("drizzle-orm");
    const { getDb } = await import("@/db/db.server");
    const { weightLogs, profiles } = await import("@/db/schema");
    const { requireExpectedDataEpoch } = await import("@/lib/account-epoch.server");
    const db = getDb();
    const loggedDate = data.local_date;
    await db.transaction(async (tx) => {
      await requireExpectedDataEpoch(tx, context.userId, data.expected_data_epoch);
      await tx
        .insert(weightLogs)
        .values({
          user_id: context.userId,
          weight_kg: data.weight_kg,
          logged_date: loggedDate,
          timezone: data.timezone ?? null,
          source_key: `ui-weight:${loggedDate}:${data.weight_kg}`,
        })
        .onConflictDoNothing();
      await tx
        .update(profiles)
        .set({
          weight_kg: data.weight_kg,
          ...(data.timezone ? { timezone: data.timezone } : {}),
        })
        .where(eq(profiles.id, context.userId));
    });
    return { ok: true };
  });

export const resetWorkspace = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((input: unknown) =>
    z
      .object({ expected_data_epoch: z.number().int().min(0) })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { resetUserWorkspace } = await import("@/lib/coach-switch.server");
    return {
      ok: true,
      ...(await resetUserWorkspace(context.userId, data.expected_data_epoch)),
    };
  });

const SwitchCoachSchema = z
  .object({
    coach_id: z.enum(COACH_IDS),
  })
  .strict();

export const switchCoach = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((input: unknown) => SwitchCoachSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { switchUserCoach } = await import("@/lib/coach-switch.server");
    return {
      ok: true,
      ...(await switchUserCoach(context.userId, data.coach_id)),
    };
  });

export const resetOnboarding = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { resetUserOnboarding } = await import("@/lib/coach-switch.server");
    await resetUserOnboarding(context.userId);
    return { ok: true };
  });
