import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/* -------------------- profile & messages -------------------- */

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("*")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

export const getChatMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("chat_messages")
      .select("id, role, parts, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((m) => ({
      id: m.id as string,
      role: m.role as "user" | "assistant" | "system",
      parts: m.parts as Array<{ type: string; text?: string }>,
    }));
  });

export const getWorkspaceFiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("workspace_files")
      .select("path, content, updated_at")
      .eq("user_id", context.userId)
      .order("path");
    if (error) throw new Error(error.message);
    return (data ?? []).map((file) => ({
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
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => OnboardingSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({
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
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
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
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ProfilePatchSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update(data)
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const resetOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await context.supabase
      .from("profiles")
      .update({
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
      .eq("id", context.userId);
    await context.supabase.from("chat_messages").delete().eq("user_id", context.userId);
    await context.supabase.from("workout_logs").delete().eq("user_id", context.userId);
    await context.supabase.from("meal_logs").delete().eq("user_id", context.userId);
    await context.supabase.from("plans").delete().eq("user_id", context.userId);
    await context.supabase.from("workspace_files").delete().eq("user_id", context.userId);
    return { ok: true };
  });


