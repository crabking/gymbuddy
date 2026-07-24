import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "@/lib/auth-middleware";
import { z } from "zod";

// Server-only db modules are imported dynamically inside handlers so `pg` never
// reaches the client bundle. Access control (previously Postgres RLS) is now
// enforced here: every query filters by context.userId.

/* -------------------- profile & messages -------------------- */

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireAuth])
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

const OnboardingSchema = z.object({
  display_name: z.string().min(1).max(80),
  goal: z.string().min(1),
  experience: z.string().min(1),
  days_per_week: z.number().int().min(1).max(7),
  session_minutes: z.number().int().min(15).max(240),
  equipment: z.string().min(1),
  injuries: z.string().max(500).optional().default(""),
  height_cm: z.number().min(100).max(260),
  weight_kg: z.number().min(30).max(300),
  age: z.number().int().min(13).max(100),
  sex: z.string().min(1),
  diet_style: z.string().min(1),
  daily_calorie_target: z.number().int().min(1000).max(6000).optional().nullable(),
});

export const saveOnboarding = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) => OnboardingSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { eq } = await import("drizzle-orm");
    const { getDb } = await import("@/db/db.server");
    const { profiles } = await import("@/db/schema");
    await getDb()
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
        diet_style: data.diet_style,
        daily_calorie_target: data.daily_calorie_target ?? null,
        onboarding_completed: true,
      })
      .where(eq(profiles.id, context.userId));
    return { ok: true };
  });

const ProfilePatchSchema = z.object({
  display_name: z.string().max(80).optional(),
  goal: z.string().optional(),
  experience: z.string().optional(),
  days_per_week: z.number().int().min(1).max(7).nullable().optional(),
  session_minutes: z.number().int().min(15).max(240).nullable().optional(),
  equipment: z.string().optional(),
  injuries: z.string().max(500).nullable().optional(),
  height_cm: z.number().nullable().optional(),
  weight_kg: z.number().nullable().optional(),
  age: z.number().int().nullable().optional(),
  sex: z.string().optional(),
  diet_style: z.string().optional(),
  daily_calorie_target: z.number().int().nullable().optional(),
  schedule_note: z.string().max(2000).nullable().optional(),
  music_service: z.string().max(50).nullable().optional(),
  meal_preferences: z.string().max(2000).nullable().optional(),
  memory_notes: z.string().max(4000).nullable().optional(),
});

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) => ProfilePatchSchema.parse(input))
  .handler(async ({ data, context }) => {
    const patch = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    if (Object.keys(patch).length === 0) return { ok: true };
    const { eq } = await import("drizzle-orm");
    const { getDb } = await import("@/db/db.server");
    const { profiles } = await import("@/db/schema");
    await getDb().update(profiles).set(patch).where(eq(profiles.id, context.userId));
    return { ok: true };
  });

/* -------------------- live modules (session + nutrition) -------------------- */

export const getActiveWorkoutSession = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { getActiveSession } = await import("@/lib/workout-session.server");
    return getActiveSession(context.userId);
  });

export const toggleSessionExercise = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z.object({ exercise: z.string(), done: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { markExerciseDone } = await import("@/lib/workout-session.server");
    const r = await markExerciseDone(context.userId, data.exercise, data.done);
    return r.session;
  });

export const completeActiveSession = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { completeSession } = await import("@/lib/workout-session.server");
    return completeSession(context.userId);
  });

export const getNutritionToday = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { getNutrition } = await import("@/lib/nutrition.server");
    return getNutrition(context.userId);
  });

export const getTodayTrainingInfo = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z.object({ date: z.string().nullable(), weekday: z.string().nullable() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    // Structured program first; fall back to the markdown schedule.
    const { getTodayProgramDay, getNextProgramDay } = await import("@/lib/program.server");
    const today = data.date ?? new Date().toISOString().slice(0, 10);
    const todayDay = await getTodayProgramDay(context.userId, today);
    if (todayDay && todayDay.status === "planned") {
      return { label: `${todayDay.title}${todayDay.is_deload ? " (deload)" : ""}`, detail: "today" };
    }
    const next = await getNextProgramDay(context.userId, today);
    if (next) {
      return {
        label: `${next.title}${next.is_deload ? " (deload)" : ""}`,
        detail: next.date === today ? "today" : next.date,
      };
    }
    const { getTodayTraining } = await import("@/lib/schedule.server");
    return getTodayTraining(context.userId, data);
  });

export const getProgramFull = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) => z.object({ date: z.string().nullable() }).parse(input))
  .handler(async ({ data, context }) => {
    const { getActiveProgram } = await import("@/lib/program.server");
    return getActiveProgram(context.userId, data.date ?? undefined);
  });

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { getDashboardData } = await import("@/lib/dashboard.server");
    return getDashboardData(context.userId);
  });

export const toggleSessionSet = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        set_id: z.string(),
        completed: z.boolean(),
        weight_kg: z.number().nullable().optional(),
        reps: z.number().int().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { markSetDone } = await import("@/lib/workout-session.server");
    const r = await markSetDone(context.userId, data.set_id, {
      completed: data.completed,
      weight_kg: data.weight_kg,
      reps: data.reps,
    });
    return r.session;
  });

export const seedDemoDashboard = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { seedDemoData } = await import("@/lib/demo-data.server");
    return seedDemoData(context.userId);
  });

export const logWeight = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z.object({ weight_kg: z.number().min(25).max(400) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { eq } = await import("drizzle-orm");
    const { getDb } = await import("@/db/db.server");
    const { weightLogs, profiles } = await import("@/db/schema");
    const db = getDb();
    await db.insert(weightLogs).values({ user_id: context.userId, weight_kg: data.weight_kg });
    await db.update(profiles).set({ weight_kg: data.weight_kg }).where(eq(profiles.id, context.userId));
    return { ok: true };
  });

export const resetWorkspace = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { wipe } = await import("@/lib/workspace.server");
    await wipe(context.userId);
    return { ok: true };
  });

export const resetOnboarding = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { eq } = await import("drizzle-orm");
    const { getDb } = await import("@/db/db.server");
    const { profiles, chatMessages, workoutLogs, mealLogs, plans, workspaceFiles, workoutSessions } =
      await import("@/db/schema");
    const db = getDb();
    const userId = context.userId;
    await db
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
        schedule_note: null,
        music_service: null,
        meal_preferences: null,
        memory_notes: null,
      })
      .where(eq(profiles.id, userId));
    await db.delete(chatMessages).where(eq(chatMessages.user_id, userId));
    await db.delete(workoutLogs).where(eq(workoutLogs.user_id, userId));
    await db.delete(mealLogs).where(eq(mealLogs.user_id, userId));
    await db.delete(plans).where(eq(plans.user_id, userId));
    await db.delete(workspaceFiles).where(eq(workspaceFiles.user_id, userId));
    await db.delete(workoutSessions).where(eq(workoutSessions.user_id, userId));
    return { ok: true };
  });
