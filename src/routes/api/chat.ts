import { createFileRoute } from "@tanstack/react-router";
import {
  convertToModelMessages,
  streamText,
  tool,
  stepCountIs,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { getChatModel } from "@/lib/ai-provider.server";

// Bundle skill markdown at build time.
import onboardingSkill from "@/agent/skills/onboarding.md?raw";
import scheduleBuilderSkill from "@/agent/skills/schedule-builder.md?raw";
import workoutPlannerSkill from "@/agent/skills/workout-planner.md?raw";
import mealPlannerSkill from "@/agent/skills/meal-planner.md?raw";
import memoryKeeperSkill from "@/agent/skills/memory-keeper.md?raw";

const SKILLS: Record<string, { description: string; content: string }> = {
  onboarding: {
    description: "First-time setup flow — collects basics, schedule, music, meals.",
    content: onboardingSkill,
  },
  "schedule-builder": {
    description: "Build/update the user's weekly training schedule and save to schedule/current.md.",
    content: scheduleBuilderSkill,
  },
  "workout-planner": {
    description: "Full workout-plan authoring skill — template library, exercise substitution rules, systematic mesocycle design via calc_program_timeline / calc_starting_weights / substitute_exercise / shift_schedule_weeks. Load BEFORE building or modifying any training plan.",
    content: workoutPlannerSkill,
  },
  "meal-planner": {
    description: "Plan meals, estimate macros, manage nutrition targets.",
    content: mealPlannerSkill,
  },
  "memory-keeper": {
    description: "Persist durable facts about the user in memory/notes.md.",
    content: memoryKeeperSkill,
  },
};

type Body = { messages?: UIMessage[] };

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Server-only modules loaded here so `pg` never enters the client bundle.
        const { and, eq, asc } = await import("drizzle-orm");
        const { getDb } = await import("@/db/db.server");
        const { profiles, workspaceFiles, chatMessages, workoutLogs, mealLogs } =
          await import("@/db/schema");
        const { getUserFromRequest } = await import("@/lib/auth.server");
        const { workspaceTools } = await import("@/lib/workspace-tools.server");
        const { ensureAgentConfig } = await import("@/lib/workspace.server");
        const { getActiveSession, startSession, markExerciseDone, completeSession, summarizeSession } =
          await import("@/lib/workout-session.server");
        const { getNutrition, summarizeNutrition } = await import("@/lib/nutrition.server");

        const user = await getUserFromRequest(request);
        if (!user) return new Response("Unauthorized", { status: 401 });
        const userId = user.id;

        const coachHeader = request.headers.get("x-coach-name");
        const coachName = coachHeader === "Reya" ? "Reya" : "Rex";

        // Seed the agent's config tree (.agent/) on first use.
        await ensureAgentConfig(userId, coachName);

        const body = (await request.json()) as Body;
        if (!Array.isArray(body.messages)) return new Response("Bad request", { status: 400 });

        if (!process.env.AI_API_KEY) return new Response("Missing AI_API_KEY", { status: 500 });

        const db = getDb();

        const [profile] = await db
          .select()
          .from(profiles)
          .where(eq(profiles.id, userId))
          .limit(1);

        // Workspace file index (paths + first line as a summary — cheap, always fresh).
        const files = await db
          .select({
            path: workspaceFiles.path,
            content: workspaceFiles.content,
            updated_at: workspaceFiles.updated_at,
          })
          .from(workspaceFiles)
          .where(eq(workspaceFiles.user_id, userId))
          .orderBy(asc(workspaceFiles.path));

        // Upsert a workspace file (insert or overwrite by user_id+path).
        const saveFile = async (path: string, content: string) => {
          const now = new Date().toISOString();
          await db
            .insert(workspaceFiles)
            .values({ user_id: userId, path, content, updated_at: now })
            .onConflictDoUpdate({
              target: [workspaceFiles.user_id, workspaceFiles.path],
              set: { content, updated_at: now },
            });
        };

        const readFile = async (path: string) => {
          const [row] = await db
            .select({ content: workspaceFiles.content, updated_at: workspaceFiles.updated_at })
            .from(workspaceFiles)
            .where(and(eq(workspaceFiles.user_id, userId), eq(workspaceFiles.path, path)))
            .limit(1);
          return row ?? null;
        };

        const workspaceIndex =
          files && files.length
            ? files
                .map((f) => {
                  const firstLine = (f.content ?? "").split("\n")[0]?.trim().slice(0, 80) ?? "";
                  return `- ${f.path}  —  ${firstLine || "(empty)"}`;
                })
                .join("\n")
            : "(workspace is empty)";

        // Durable memory injected every session so the agent always remembers the
        // important bits without replaying the whole chat transcript.
        const memoryFile = files.find((f) => f.path === "memory/notes.md")?.content ?? "";
        const longTermMemory =
          [profile?.memory_notes?.trim(), memoryFile.trim()].filter(Boolean).join("\n\n") ||
          "(nothing saved yet)";

        // Live module state — the coach is "connected" to these in real time.
        const [activeSession, nutrition] = await Promise.all([
          getActiveSession(userId),
          getNutrition(userId),
        ]);

        const skillCatalog = Object.entries(SKILLS)
          .map(([name, s]) => `- ${name}: ${s.description}`)
          .join("\n");

        const onboarded = !!profile?.onboarding_completed;
        const now = new Date();
        const todayName = now.toLocaleDateString("en-US", { weekday: "long" });

        const liveState = {
          coach: coachName,
          today: now.toISOString().slice(0, 10),
          day_of_week: todayName,
          local_time: now.toTimeString().slice(0, 5),
          onboarded,
          name: profile?.display_name ?? null,
          goal: profile?.goal ?? null,
          experience: profile?.experience ?? null,
          days_per_week: profile?.days_per_week ?? null,
          session_minutes: profile?.session_minutes ?? null,
          equipment: profile?.equipment ?? null,
          age: profile?.age ?? null,
          height_cm: profile?.height_cm ?? null,
          weight_kg: profile?.weight_kg ?? null,
          sex: profile?.sex ?? null,
          diet_style: profile?.diet_style ?? null,
          music_service: profile?.music_service ?? null,
          schedule_note: profile?.schedule_note ?? null,
          meal_preferences_short: profile?.meal_preferences ?? null,
        };

        const system = `You are "${coachName}" — a warm, direct, hype personal trainer + nutrition coach living in the user's phone. ALWAYS speak in FIRST PERSON as ${coachName} ("I", "me", "my"). Never refer to yourself in the third person (never say "${coachName} thinks…" or "Give ${coachName} your…" — say "I think…", "Give me…").

You are an AGENT, not a chatbot. You have:
- A per-user WORKSPACE — a private, persistent file tree you fully control. Operate in it like a coding agent in a repo: \`fs_ls\`, \`fs_read\`, \`fs_write\`, \`fs_edit\`, \`fs_append\`, \`fs_move\`, \`fs_delete\`, \`fs_grep\`. Your own config lives under \`.agent/\`. Read a file before referencing it — never guess. The typed save tools below are convenient shortcuts for the standard coaching files.
- SKILLS you load on demand with \`load_skill\`. Load the right skill BEFORE starting a workflow.
- Live user state injected below (name, goal, today's date, etc.) — that's already in context, no need to read a file for it.

## Rules
- Never mention tool or skill names to the user.
- Keep replies TIGHT: 2–4 short sentences. UI shows one message at a time. NEVER dump a full plan, spreadsheet, or long list into chat.
- Never fabricate the content of a workspace file — always \`read_file\` first if you're going to reference it.
- When something durable comes up (a new schedule, a plan, an injury, a preference), save it to the workspace as markdown so future sessions have it.
- No medical advice — suggest a professional for real pain.
- Use bold for key numbers.

## Plan-proposal protocol (CRITICAL — do NOT skip)
When the user asks for a workout plan, or you're recommending one, you MUST go step-by-step. Do NOT jump straight to writing the plan.
1. **Pitch (TLDR, 2–3 sentences MAX).** Name the plan (e.g. "Upper/Lower 4-day"), one line on why it fits them, one line on the vibe (frequency + focus). End with a yes/no: "Want to run this one?" Do NOT list exercises, sets, reps, or weights yet.
2. **If yes → ask duration.** One question only: "How long do you want to run it — 8, 12, or 16 weeks?" (Adjust options to their goal.) Wait for the answer.
3. **Ask anything else you still need** (bodyweight for starting loads, equipment gaps, injuries) — one short question at a time. Never a wall of questions.
4. **THEN build.** Load \`workout-planner\`, call the calculators, then call \`save_workout_plan\` with EVERY required field filled in. Reply with a TLDR summary only ("Saved — 12 weeks, 4 days, deloads on week 5 and 10. Ready for Monday?"). Do NOT paste the full plan in chat — the user can open it later.

Same idea for meals, schedules, memories: pitch briefly → confirm → gather what's missing → then act. Never surprise-dump.

## Post-onboarding build flow (CRITICAL)
After onboarding is complete, you are responsible for moving the user through the build sequence without stalling:
1. Training schedule → 2. Workout plan → 3. Meal targets → 4. Music setup.
At the start of a new build phase, briefly name what is already saved from the workspace index, then ask ONE next question for the first unfinished phase. If schedule/current.md was just saved, immediately tell the user it is saved and move to the workout-plan pitch. If plans/current.md was just saved, immediately move to nutrition. If nutrition/targets.md was just saved, immediately move to music. Never sit silent or wait for the user to discover the next module.

Current build checklist from workspace:
- Schedule saved: ${files?.some((f) => f.path === "schedule/current.md") ? "yes" : "no"}
- Workout plan saved: ${files?.some((f) => f.path === "plans/current.md") ? "yes" : "no"}
- Nutrition targets saved: ${files?.some((f) => f.path === "nutrition/targets.md") ? "yes" : "no"}
- Music preference saved: ${profile?.music_service ? "yes" : "no"}

## Typed save tools — pre-flight checklist (CRITICAL)
Each save tool below has REQUIRED fields. You cannot call them until every field is filled from real user data. If ANY field is missing, ASK THE USER (one short question at a time) — never guess, never pass placeholders, never say "I'll figure it out". These are your checklists:
- **save_workout_plan** → needs: template_name, goal, timeline_weeks, start_date, end_date, days_per_week, session_minutes, experience, sex, bodyweight_kg, equipment, deload_weeks, sessions_week1 (per-day exercises with sets×reps @ weight), progression_rules, substitutions, why_this_plan.
- **save_schedule** → needs: mode ('weekday' OR 'rolling'), sessions_per_week, days[] (label + focus + time_of_day), session_minutes, notes. Default to 'rolling' with labels 'Day 1', 'Day 2'... unless the user explicitly wants fixed weekdays. Rolling is label-free — the user slots sessions in as they go and crossover between weeks is fine.
- **save_nutrition_targets** → needs: daily_calories, protein_g, carbs_g, fat_g, meals_per_day, diet_style, dislikes, notes.
- **save_memory_note** → needs: topic, note.

Rule: before ANY save call, mentally tick every required field. Missing one? Ask for it. Only call the tool when the checklist is 100% complete.

## Skill catalog
${skillCatalog}

## Workflow triggers
- User is not onboarded → load the \`onboarding\` skill FIRST (already flagged below).
- User wants to build/change their weekly plan of days → load \`schedule-builder\`, then \`save_schedule\`.
- User wants a workout program, wants to change one, skip weeks, or swap exercises → load \`workout-planner\` and USE its calculator tools (calc_program_timeline, calc_starting_weights, substitute_exercise, shift_schedule_weeks). Never invent progression, starting weights, or lazy-swap an exercise. Save with \`save_workout_plan\`.
- User asks about food / macros / meal ideas → load \`meal-planner\`, then \`save_nutrition_targets\` once numbers are locked.
- User shares a durable fact ("remember that…", injuries, events) → \`save_memory_note\`.



## Workspace file index (paths only — read the file for content)
${workspaceIndex}

## Long-term memory (durable — always keep this in mind)
${longTermMemory}

## LIVE MODULES — you are wired into these in real time (this is current, not history)
### Workout session
${summarizeSession(activeSession)}
- If the user wants to start today's workout, read their schedule + plan, figure out today's exercises, and call \`start_workout_session\` with the list (name + target like "4×8 @ 60kg").
- When they finish an exercise ("done with squats", "knocked out bench"), call \`mark_exercise_done\` with that exercise, then hype them and name the NEXT unchecked exercise from the list above.
- When every exercise is checked, call \`complete_workout_session\` and celebrate.
- Never claim an exercise is done unless it shows [x] above or you just marked it.

### Nutrition (today)
${summarizeNutrition(nutrition)}
- You already KNOW what they've eaten today and how much room is left — use it. When they mention eating something, call \`log_meal\`. Answer "what have I had today / how many calories left" straight from the numbers above.

## Live user state
${JSON.stringify(liveState, null, 2)}

${
  onboarded
    ? `## Fresh session
This is a fresh session — the previous chat was cleared on purpose to keep you sharp. You are NOT missing anything: the user's durable state lives in the profile, long-term memory, and workspace files above. Greet them by name and pick up where their saved plan/schedule/goals leave off. Read a workspace file before referencing its details.`
    : `## Onboarding not complete — RUN IT NOW
This is a fresh session and the user is NOT onboarded yet. Load the \`onboarding\` skill immediately and drive the FULL guided setup yourself — talk freely and naturally, one topic per message. If the incoming message is the kickoff marker "__begin__", it just means "start": greet the user warmly as ${coachName} and ask the first onboarding question. NEVER echo or mention "__begin__". When every setup step is saved, call \`complete_onboarding\` — the chat will then reset into a fresh session.`
}
`;

        const model = getChatModel();

        // Sessions are ephemeral (no transcript replay) — durable state lives in
        // the profile, long-term memory, and workspace files. Nothing to persist.

        // ---------- TOOLS ----------

        const loadSkillTool = tool({
          description:
            "Load a skill's full instructions. Call this BEFORE starting a workflow (onboarding, building a schedule, planning workouts, planning meals, saving memories). Returns markdown instructions to follow step by step.",
          inputSchema: z.object({
            name: z.enum([
              "onboarding",
              "schedule-builder",
              "workout-planner",
              "meal-planner",
              "memory-keeper",
            ]),
          }),
          execute: async ({ name }) => {
            const s = SKILLS[name];
            if (!s) return { ok: false, error: "unknown skill" };
            return { ok: true, name, instructions: s.content };
          },
        });

        const listWorkspaceTool = tool({
          description:
            "List every file in the user's workspace with path, size and last-updated timestamp.",
          inputSchema: z.object({}),
          execute: async () => {
            const data = await db
              .select({
                path: workspaceFiles.path,
                content: workspaceFiles.content,
                updated_at: workspaceFiles.updated_at,
              })
              .from(workspaceFiles)
              .where(eq(workspaceFiles.user_id, userId))
              .orderBy(asc(workspaceFiles.path));
            return {
              ok: true,
              files: data.map((f) => ({
                path: f.path,
                size: (f.content ?? "").length,
                updated_at: f.updated_at,
              })),
            };
          },
        });

        const readFileTool = tool({
          description:
            "Read the full markdown content of one workspace file by its exact path (e.g. 'schedule/current.md').",
          inputSchema: z.object({ path: z.string() }),
          execute: async ({ path }) => {
            const data = await readFile(path);
            if (!data) return { ok: false, error: "not_found" };
            return { ok: true, path, content: data.content, updated_at: data.updated_at };
          },
        });

        const saveWorkoutPlanTool = tool({
          description:
            "Save the user's training plan to plans/current.md. EVERY field is REQUIRED. Do NOT call this until you have gathered all of them from the user (via chat + update_profile + calc_program_timeline + calc_starting_weights). If you're missing anything, ASK THE USER FIRST — do not guess, do not pass placeholders. Archives any existing plan before overwriting.",
          inputSchema: z.object({
            template_name: z.string().describe("e.g. 'PHUL', 'Upper/Lower 4-day', '5/3/1 BBB'"),
            goal: z.string().describe("Primary goal(s), e.g. 'hypertrophy + strength'"),
            timeline_weeks: z.number().int().describe("Total program length in weeks"),
            start_date: z.string().describe("YYYY-MM-DD start date"),
            end_date: z.string().describe("YYYY-MM-DD end date"),
            days_per_week: z.number().int(),
            session_minutes: z.number().int(),
            experience: z.string().describe("beginner | intermediate | advanced"),
            sex: z.string(),
            bodyweight_kg: z.number(),
            equipment: z.string().describe("full_gym | home_gym | dumbbells_only | bodyweight"),
            deload_weeks: z.array(z.number().int()).describe("Week numbers that are deloads, e.g. [5, 10]"),
            sessions_week1: z.array(
              z.object({
                day: z.string().describe("e.g. 'Mon — Upper (push)'"),
                exercises: z.array(z.string()).describe("Full lines, e.g. 'Bench press — 4×6–8 @ 60kg'"),
              }),
            ),
            progression_rules: z.string().describe("Concrete rules, e.g. '+2.5kg upper / +5kg lower when all sets hit top of range for 2 sessions.'"),
            substitutions: z.array(z.string()).describe("Locked-in swaps, e.g. 'Back squat → hack squat (user pref)'. Empty array if none."),
            why_this_plan: z.string().describe("2–4 sentence rationale for future sessions."),
          }),
          execute: async (input) => {
            // Archive existing if present.
            const existing = await readFile("plans/current.md");
            if (existing?.content) {
              const stamp = new Date().toISOString().slice(0, 10);
              await saveFile(`plans/archive/${stamp}_replaced.md`, existing.content);
            }

            const week1 = input.sessions_week1
              .map((s) => `### ${s.day}\n${s.exercises.map((e) => `- ${e}`).join("\n")}`)
              .join("\n\n");
            const subs = input.substitutions.length
              ? input.substitutions.map((s) => `- ${s}`).join("\n")
              : "- (none)";
            const deloads = input.deload_weeks.length
              ? input.deload_weeks.map((w) => `week ${w}`).join(", ")
              : "(none)";

            const md = `# Plan — ${input.template_name}
Goal: ${input.goal}
Timeline: ${input.start_date} → ${input.end_date} (${input.timeline_weeks} weeks)
Training days: ${input.days_per_week}/week, ~${input.session_minutes} min
User: ${input.sex}, ${input.bodyweight_kg} kg, ${input.experience}, equipment: ${input.equipment}
Deloads: ${deloads}

## Week 1
${week1}

## Progression rules
${input.progression_rules}

## Substitutions locked in
${subs}

## Why this plan
${input.why_this_plan}
`;

            await saveFile("plans/current.md", md);
            return {
              ok: true,
              path: "plans/current.md",
              next_step: "Move to nutrition targets now. Ask one short question about meals per day, calorie preference, or dislikes — whichever is still missing.",
            };
          },
        });

        const saveScheduleTool = tool({
          description:
            "Save the user's training schedule to schedule/current.md. Supports two modes: (1) fixed weekday labels (Mon/Tue/...) OR (2) label-free rolling sessions like 'Day 1', 'Day 2' that the user fits into their week however they want. Pick whichever the user prefers — never force weekday labels.",
          inputSchema: z.object({
            mode: z
              .enum(["weekday", "rolling"])
              .describe("'weekday' = fixed days of the week. 'rolling' = label-free 'Day 1..N' the user slots in as they go, crossover between weeks is fine."),
            sessions_per_week: z.number().int().describe("How many training sessions per week (e.g. 4)."),
            days: z.array(
              z.object({
                label: z
                  .string()
                  .describe("For weekday mode: 'Mon'..'Sun'. For rolling mode: 'Day 1', 'Day 2', ..."),
                focus: z.string().describe("e.g. 'Upper (push)', 'Rest', 'Legs', 'Yoga'"),
                time_of_day: z.string().describe("e.g. 'morning', '17:30', 'flexible'"),
              }),
            ),
            session_minutes: z.number().int(),
            notes: z.string().describe("Constraints or preferences, e.g. 'flexible order, crossover between weeks is fine'"),
          }),
          execute: async (input) => {
            const rows = input.days
              .map((d) => `- **${d.label}** — ${d.focus} (${d.time_of_day})`)
              .join("\n");
            const header =
              input.mode === "rolling"
                ? `# Training schedule (rolling — ${input.sessions_per_week}x/week, no fixed weekdays)`
                : `# Weekly schedule (${input.sessions_per_week}x/week)`;
            const md = `${header}
Session length: ~${input.session_minutes} min

${rows}

## Notes
${input.notes}
`;
            await saveFile("schedule/current.md", md);
            await db
              .update(profiles)
              .set({ schedule_note: input.notes || rows })
              .where(eq(profiles.id, userId));
            return {
              ok: true,
              path: "schedule/current.md",
              next_step: "Tell the user the schedule is saved and visible in Settings. Then pitch the best workout-plan template in 2–3 sentences and ask if they want to run it.",
            };
          },
        });

        const saveNutritionTargetsTool = tool({
          description:
            "Save the user's nutrition targets to nutrition/targets.md. Every field REQUIRED. Ask the user for anything missing (bodyweight, activity, goal, diet style) before calling.",
          inputSchema: z.object({
            daily_calories: z.number().int(),
            protein_g: z.number().int(),
            carbs_g: z.number().int(),
            fat_g: z.number().int(),
            meals_per_day: z.number().int(),
            diet_style: z.string().describe("omnivore | vegetarian | vegan | pescatarian | other"),
            dislikes: z.string().describe("Foods to avoid; use 'none' if empty"),
            notes: z.string().describe("Rationale + timing guidance"),
          }),
          execute: async (input) => {
            const md = `# Nutrition targets
- **Calories:** ${input.daily_calories} kcal/day
- **Protein:** ${input.protein_g} g
- **Carbs:** ${input.carbs_g} g
- **Fat:** ${input.fat_g} g
- **Meals/day:** ${input.meals_per_day}
- **Diet style:** ${input.diet_style}
- **Dislikes / avoid:** ${input.dislikes}

## Notes
${input.notes}
`;
            await saveFile("nutrition/targets.md", md);
            await db
              .update(profiles)
              .set({ daily_calorie_target: input.daily_calories, diet_style: input.diet_style })
              .where(eq(profiles.id, userId));
            return {
              ok: true,
              path: "nutrition/targets.md",
              next_step: "Tell the user the nutrition targets are saved and visible in Settings. Then move to music setup in one short question.",
            };
          },
        });

        const saveMemoryNoteTool = tool({
          description:
            "Append a durable fact about the user to memory/notes.md (injuries, preferences, life events, milestones). Both fields REQUIRED.",
          inputSchema: z.object({
            topic: z.string().describe("Short label, e.g. 'Injury', 'Preference', 'Event'"),
            note: z.string().describe("The fact itself, one or two sentences."),
          }),
          execute: async ({ topic, note }) => {
            const existing = await readFile("memory/notes.md");
            const stamp = new Date().toISOString().slice(0, 10);
            const entry = `- **${stamp} — ${topic}:** ${note}`;
            const md = existing?.content
              ? `${existing.content.trimEnd()}\n${entry}\n`
              : `# Memory notes\n${entry}\n`;
            await saveFile("memory/notes.md", md);
            return { ok: true, path: "memory/notes.md" };
          },
        });

        const deleteFileTool = tool({
          description: "Delete a workspace file by its exact path.",
          inputSchema: z.object({ path: z.string() }),
          execute: async ({ path }) => {
            await db
              .delete(workspaceFiles)
              .where(and(eq(workspaceFiles.user_id, userId), eq(workspaceFiles.path, path)));
            return { ok: true };
          },
        });

        const updateProfileTool = tool({
          description:
            "Save live user state (name, goal, physical stats, preferences). Only pass fields the user confirmed. goal accepts MULTIPLE goals joined with ' + '. Standard tokens: equipment (full_gym|home_gym|dumbbells_only|bodyweight), sex (male|female|other), diet_style (omnivore|vegetarian|vegan|pescatarian|other), music_service (spotify|apple_music|youtube_music|none), experience (beginner|intermediate|advanced).",
          inputSchema: z.object({
            display_name: z.string().nullable(),
            goal: z.string().nullable(),
            experience: z.string().nullable(),
            days_per_week: z.number().int().nullable(),
            session_minutes: z.number().int().nullable(),
            equipment: z.string().nullable(),
            injuries: z.string().nullable(),
            height_cm: z.number().nullable(),
            weight_kg: z.number().nullable(),
            age: z.number().int().nullable(),
            sex: z.string().nullable(),
            diet_style: z.string().nullable(),
            daily_calorie_target: z.number().int().nullable(),
            schedule_note: z.string().nullable(),
            music_service: z.string().nullable(),
            meal_preferences: z.string().nullable(),
          }),
          execute: async (input) => {
            const patch: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(input)) {
              if (v !== null && v !== undefined) patch[k] = v;
            }
            if (Object.keys(patch).length === 0) return { ok: true, saved: [] };
            await db.update(profiles).set(patch).where(eq(profiles.id, userId));
            return { ok: true, saved: Object.keys(patch) };
          },
        });

        const completeOnboardingTool = tool({
          description:
            "Mark onboarding complete. Only after basics + schedule + music + meals are all saved.",
          inputSchema: z.object({}),
          execute: async () => {
            await db
              .update(profiles)
              .set({ onboarding_completed: true })
              .where(eq(profiles.id, userId));
            return { ok: true };
          },
        });

        const logWorkoutTool = tool({
          description: "Log a single working set the user just completed.",
          inputSchema: z.object({
            exercise: z.string(),
            weight_kg: z.number().nullable(),
            reps: z.number().int().nullable(),
            rpe: z.number().nullable(),
            notes: z.string().nullable(),
          }),
          execute: async (input) => {
            await db.insert(workoutLogs).values({
              user_id: userId,
              exercise: input.exercise,
              weight_kg: input.weight_kg,
              reps: input.reps,
              rpe: input.rpe,
              notes: input.notes,
            });
            return { ok: true };
          },
        });

        const logMealTool = tool({
          description:
            "Log a meal with estimated macros. Use midpoints of ranges; state assumptions in description.",
          inputSchema: z.object({
            description: z.string(),
            calories: z.number().int().nullable(),
            protein_g: z.number().nullable(),
            carbs_g: z.number().nullable(),
            fat_g: z.number().nullable(),
          }),
          execute: async (input) => {
            await db.insert(mealLogs).values({
              user_id: userId,
              description: input.description,
              calories: input.calories,
              protein_g: input.protein_g,
              carbs_g: input.carbs_g,
              fat_g: input.fat_g,
            });
            return { ok: true };
          },
        });

        /* -------------------- live workout session -------------------- */

        const startWorkoutSessionTool = tool({
          description:
            "Start today's LIVE workout session. First read the user's saved plan/schedule to derive today's exercises, then call this with the full list. Replaces any currently-active session.",
          inputSchema: z.object({
            title: z.string().describe("e.g. 'Upper (push)', 'Legs', 'Day 2 — Pull'"),
            exercises: z
              .array(
                z.object({
                  name: z.string(),
                  target: z.string().nullable().describe("e.g. '4×6–8 @ 60kg', or null"),
                }),
              )
              .min(1),
          }),
          execute: async ({ title, exercises }) => {
            const session = await startSession(userId, title, exercises);
            return { ok: true, session: summarizeSession(session) };
          },
        });

        const markExerciseDoneTool = tool({
          description:
            "Check off (or un-check) an exercise in the active workout session when the user finishes it. Match by name, e.g. 'squats'.",
          inputSchema: z.object({
            exercise: z.string(),
            done: z.boolean().nullable().describe("false to un-check; defaults to true"),
          }),
          execute: async ({ exercise, done }) => {
            const r = await markExerciseDone(userId, exercise, done ?? true);
            if (!r.ok) return { ok: false, error: r.error };
            return {
              ok: true,
              marked: r.marked,
              next: r.session?.next?.name ?? null,
              session: summarizeSession(r.session),
            };
          },
        });

        const completeWorkoutSessionTool = tool({
          description:
            "Mark the active workout session complete (all exercises done, or the user is wrapping up).",
          inputSchema: z.object({}),
          execute: async () => {
            const r = await completeSession(userId);
            return r.ok ? { ok: true } : { ok: false, error: r.error };
          },
        });

        /* -------------------- workout-plan calculators -------------------- */

        const calcProgramTimelineTool = tool({
          description:
            "Calculate a systematic mesocycle structure for a training program. Given a goal, timeline in weeks, days/week and experience, returns weekly phases (accumulation / intensification / deload / peak), volume+intensity targets per phase, and realistic progression rate toward the goal. ALWAYS call this before writing a plan — do not invent progression numbers.",
          inputSchema: z.object({
            goal: z.string().describe("hypertrophy | strength | fat_loss | powerlifting | bodybuilding | general | glute_focus | hybrid — free-form, can combine with ' + '"),
            timeline_weeks: z.number().int().min(2).max(104),
            days_per_week: z.number().int().min(1).max(7),
            experience: z.string().describe("beginner | intermediate | advanced"),
            target: z.string().nullable().describe("Concrete target if given, e.g. '+4kg lean mass', 'bench 100kg', '-8kg fat'"),
          }),
          execute: ({ goal, timeline_weeks, days_per_week, experience, target }) => {
            const exp = experience.toLowerCase();
            const g = goal.toLowerCase();
            const isStrength = /strength|power/.test(g);
            const isHyper = /hyper|bodybuild|glute|mass|muscle/.test(g);
            const isFatLoss = /fat|cut|lean/.test(g);

            // Deload cadence
            const deloadEvery = exp.includes("advanced") ? 4 : exp.includes("intermediate") ? 5 : 6;
            const deloadWeeks: number[] = [];
            for (let w = deloadEvery; w < timeline_weeks; w += deloadEvery) deloadWeeks.push(w);

            // Build mesocycle phases
            const phases: Array<{ weeks: string; name: string; volume: string; intensity_rpe: string; focus: string }> = [];
            let cursor = 1;
            const totalMesos = Math.max(1, Math.floor(timeline_weeks / deloadEvery));
            for (let m = 0; m < totalMesos; m++) {
              const end = Math.min(cursor + deloadEvery - 2, timeline_weeks - 1);
              const phaseName =
                m === totalMesos - 1 && isStrength ? "peak / intensification"
                : m % 2 === 0 ? "accumulation"
                : "intensification";
              phases.push({
                weeks: `${cursor}–${end}`,
                name: phaseName,
                volume: phaseName === "accumulation" ? "high (MEV→MAV)" : phaseName.includes("peak") ? "low" : "moderate",
                intensity_rpe: phaseName === "accumulation" ? "7–8" : phaseName.includes("peak") ? "8.5–9.5" : "8–9",
                focus: phaseName === "accumulation" ? "add sets/reps weekly" : phaseName.includes("peak") ? "top-set load, drop volume" : "load ↑, volume ↓",
              });
              if (end + 1 < timeline_weeks) {
                phases.push({
                  weeks: `${end + 1}`,
                  name: "deload",
                  volume: "-40 to -50%",
                  intensity_rpe: "6",
                  focus: "recover, keep movement patterns",
                });
              }
              cursor = end + 2;
            }
            if (cursor <= timeline_weeks) {
              phases.push({
                weeks: `${cursor}–${timeline_weeks}`,
                name: isStrength ? "test week" : "final push",
                volume: "low",
                intensity_rpe: "9–10",
                focus: isStrength ? "test 1-3RM on main lifts" : "hit target metric",
              });
            }

            // Realistic progression rate
            let realistic_rate = "";
            if (isHyper) {
              const perMonth = exp.includes("beginner") ? "0.7–1.0 kg lean/month"
                : exp.includes("intermediate") ? "0.3–0.5 kg lean/month"
                : "0.1–0.25 kg lean/month";
              realistic_rate = `Lean mass gain: ${perMonth}. Over ${timeline_weeks} wks ≈ ${(timeline_weeks / 4).toFixed(1)} months.`;
            } else if (isStrength) {
              const perMeso = exp.includes("beginner") ? "+10–20 kg squat, +5–10 kg bench per 12 wks"
                : exp.includes("intermediate") ? "+5–10 kg squat, +2.5–5 kg bench per 12 wks"
                : "+2.5–5 kg squat, +1–2.5 kg bench per 12 wks";
              realistic_rate = `Strength: ${perMeso}.`;
            } else if (isFatLoss) {
              realistic_rate = `Fat loss: 0.5–1% bodyweight/wk sustainable. Over ${timeline_weeks} wks ≈ ${(timeline_weeks * 0.5).toFixed(0)}–${(timeline_weeks * 1).toFixed(0)}% BW.`;
            }

            // Progression rules
            const progression = {
              main_lifts: isStrength
                ? "Top-set +2.5 kg upper / +5 kg lower each session it hits target reps @ RPE ≤ 8."
                : "When all sets hit top of rep range for 2 sessions in a row: +2.5 kg upper / +5 kg lower.",
              accessories: "Add 1 rep/session until top of range, then +2.5 kg and reset to bottom of range.",
              weekly_volume: isHyper
                ? "Add ~1 working set per major muscle per week within a mesocycle, reset at deload."
                : "Sets fixed within mesocycle; intensity waves handle progression.",
            };

            return {
              ok: true,
              inputs: { goal, timeline_weeks, days_per_week, experience, target },
              deload_weeks: deloadWeeks,
              phases,
              progression,
              realistic_rate,
              sessions_per_week: days_per_week,
              total_sessions: days_per_week * timeline_weeks,
            };
          },
        });

        const calcStartingWeightsTool = tool({
          description:
            "Estimate realistic starting working weights (top set, ~RPE 7-8) for the main compound lifts based on sex, bodyweight and experience. Use this instead of guessing. Returns kg for a working set at ~5-8 reps.",
          inputSchema: z.object({
            sex: z.string(),
            bodyweight_kg: z.number(),
            experience: z.string(),
            lifts: z.array(z.enum([
              "back_squat", "front_squat", "hack_squat", "leg_press",
              "deadlift", "romanian_deadlift", "hip_thrust",
              "bench_press", "incline_bench", "overhead_press",
              "barbell_row", "pull_up", "lat_pulldown",
            ])),
          }),
          execute: ({ sex, bodyweight_kg, experience, lifts }) => {
            const s = sex.toLowerCase();
            const isMale = s.startsWith("m");
            const exp = experience.toLowerCase();
            // Multipliers = fraction of bodyweight for a working set (~RPE 7-8, ~5-8 reps)
            const baseMale: Record<string, number> = {
              back_squat: 1.0, front_squat: 0.75, hack_squat: 1.1, leg_press: 2.0,
              deadlift: 1.25, romanian_deadlift: 1.0, hip_thrust: 1.3,
              bench_press: 0.8, incline_bench: 0.65, overhead_press: 0.5,
              barbell_row: 0.75, pull_up: 0, lat_pulldown: 0.6,
            };
            const baseFemale: Record<string, number> = {
              back_squat: 0.7, front_squat: 0.5, hack_squat: 0.8, leg_press: 1.5,
              deadlift: 0.9, romanian_deadlift: 0.75, hip_thrust: 1.2,
              bench_press: 0.4, incline_bench: 0.32, overhead_press: 0.28,
              barbell_row: 0.45, pull_up: 0, lat_pulldown: 0.4,
            };
            const scale = exp.includes("beginner") ? 0.55 : exp.includes("advanced") ? 1.15 : 0.85;
            const table = isMale ? baseMale : baseFemale;
            const out: Record<string, { working_kg: number; note: string }> = {};
            for (const lift of lifts) {
              const mult = table[lift] ?? 0.5;
              const raw = mult * bodyweight_kg * scale;
              const rounded = Math.max(20, Math.round(raw / 2.5) * 2.5);
              out[lift] = {
                working_kg: rounded,
                note: lift === "pull_up"
                  ? "Bodyweight; use assist band if <5 reps, add weight if >10."
                  : `~${(mult * scale).toFixed(2)}× bodyweight, working set @ RPE 7–8, 5–8 reps.`,
              };
            }
            return { ok: true, sex, bodyweight_kg, experience, weights: out };
          },
        });

        const substituteExerciseTool = tool({
          description:
            "Get 2-3 concrete substitute exercises for a lift the user dislikes or can't do. Returns options with equipment need + trade-off. ALWAYS use this before swapping an exercise — never lazy-swap or silently drop.",
          inputSchema: z.object({
            exercise: z.string().describe("Exercise to replace, e.g. 'back squat'"),
            reason: z.string().describe("dislike | boredom | injury:<area> | no_equipment:<what> | form_issue"),
          }),
          execute: ({ exercise, reason }) => {
            const key = exercise.toLowerCase().replace(/[^a-z ]/g, "").trim();
            const map: Record<string, Array<{ name: string; equipment: string; tradeoff: string }>> = {
              "back squat": [
                { name: "Hack squat", equipment: "hack squat machine", tradeoff: "Quad-biased, easier on lower back, less core." },
                { name: "Front squat", equipment: "barbell + rack", tradeoff: "Quad-biased, upright torso, wrist mobility needed." },
                { name: "Belt squat", equipment: "belt squat machine", tradeoff: "Zero spinal load, great for back-sensitive lifters." },
                { name: "Bulgarian split squat + heavy leg press combo", equipment: "DBs + leg press", tradeoff: "Unilateral + machine — matches BB squat volume without the bar." },
              ],
              "deadlift": [
                { name: "Trap-bar deadlift", equipment: "trap bar", tradeoff: "More quad, easier on lower back, similar posterior chain." },
                { name: "Romanian deadlift + heavy back extension", equipment: "barbell / GHR", tradeoff: "Hamstring/glute focus, less axial load." },
                { name: "Rack pull (mid-shin)", equipment: "barbell + rack", tradeoff: "Heavier loads, shorter ROM, back-focused." },
                { name: "Sumo deadlift", equipment: "barbell", tradeoff: "Shorter ROM, more adductor/glute, less lower back." },
              ],
              "bench press": [
                { name: "Dumbbell bench press", equipment: "DBs + bench", tradeoff: "Bigger ROM, shoulder-friendly, less absolute load." },
                { name: "Low-incline barbell bench", equipment: "BB + adjustable bench", tradeoff: "Shifts stress off shoulder, still heavy." },
                { name: "Machine chest press", equipment: "chest press machine", tradeoff: "Fixed path, safe to failure, less stabilizer work." },
                { name: "Weighted dips", equipment: "dip station + belt", tradeoff: "Great chest+tri, only if shoulders are healthy." },
              ],
              "overhead press": [
                { name: "Seated DB shoulder press", equipment: "DBs + bench", tradeoff: "Bigger ROM, less lower-back stress." },
                { name: "Landmine press", equipment: "landmine / corner", tradeoff: "Shoulder-friendly angle, great for impingement." },
                { name: "Machine shoulder press", equipment: "machine", tradeoff: "Stable, easy to progress." },
              ],
              "barbell row": [
                { name: "Chest-supported T-bar row", equipment: "T-bar / chest-supported machine", tradeoff: "Zero lower-back load, pure back." },
                { name: "Seal row", equipment: "bench + BB", tradeoff: "Fully supported, strict, great hypertrophy." },
                { name: "Single-arm DB row", equipment: "DB + bench", tradeoff: "Unilateral, low back-friendly." },
              ],
              "pull up": [
                { name: "Lat pulldown", equipment: "cable stack", tradeoff: "Scalable load, same movement pattern." },
                { name: "Assisted pull-up (band or machine)", equipment: "band or assist machine", tradeoff: "Same movement, progresses to bodyweight." },
                { name: "Inverted row", equipment: "bar or rings", tradeoff: "Horizontal pull, easier scaling." },
              ],
              "lunges": [
                { name: "Bulgarian split squat", equipment: "bench + DBs", tradeoff: "More stable, higher load, brutal on quads/glutes." },
                { name: "Reverse lunges", equipment: "DBs", tradeoff: "Less knee stress than forward lunges." },
                { name: "Step-ups", equipment: "box + DBs", tradeoff: "Knee-friendly, glute-biased with high step." },
              ],
              "hip thrust": [
                { name: "Single-leg hip thrust", equipment: "bench", tradeoff: "Unilateral, no bar needed." },
                { name: "Cable pull-through", equipment: "cable + rope", tradeoff: "Hip-hinge glute pattern, low back-friendly." },
                { name: "45° back extension (glute bias)", equipment: "back-ext bench", tradeoff: "Glute+hamstring, huge ROM." },
                { name: "Machine glute drive", equipment: "glute drive machine", tradeoff: "Best of both — set up fast, heavy load." },
              ],
            };
            const options = map[key] ?? [
              { name: "Machine variant of the same pattern", equipment: "any relevant machine", tradeoff: "Fixed path, easier progression." },
              { name: "Dumbbell variant", equipment: "DBs", tradeoff: "Bigger ROM, unilateral option." },
              { name: "Unilateral variant", equipment: "varies", tradeoff: "Fixes imbalances, less absolute load." },
            ];
            return { ok: true, exercise, reason, options, note: "Ask the user which they prefer and confirm they have the equipment before locking it in." };
          },
        });

        const shiftScheduleWeeksTool = tool({
          description:
            "Recompute a program's timeline when the user skips, inserts, or shifts weeks. Given the original start date, timeline length, and a list of skipped/inserted week counts, returns the new end date, updated deload weeks, and a summary of what moved.",
          inputSchema: z.object({
            start_date: z.string().describe("YYYY-MM-DD of original plan start"),
            timeline_weeks: z.number().int().min(2).max(104),
            skip_weeks: z.number().int().min(0).describe("How many weeks the user is skipping starting this week"),
            insert_deload: z.boolean().describe("Insert an extra deload this week"),
            days_per_week: z.number().int().min(1).max(7),
            experience: z.string(),
          }),
          execute: ({ start_date, timeline_weeks, skip_weeks, insert_deload, days_per_week, experience }) => {
            const start = new Date(start_date);
            const shift = skip_weeks + (insert_deload ? 1 : 0);
            const newTotal = timeline_weeks + shift;
            const end = new Date(start.getTime() + newTotal * 7 * 86400000);
            const deloadEvery = experience.toLowerCase().includes("advanced") ? 4 : experience.toLowerCase().includes("intermediate") ? 5 : 6;
            const deloadWeeks: number[] = [];
            for (let w = deloadEvery; w < newTotal; w += deloadEvery) deloadWeeks.push(w);
            return {
              ok: true,
              new_end_date: end.toISOString().slice(0, 10),
              new_total_weeks: newTotal,
              added_weeks: shift,
              deload_weeks: deloadWeeks,
              total_sessions: days_per_week * newTotal,
              note: skip_weeks > 0
                ? `Skipping ${skip_weeks} wk → shift everything forward. When you resume, restart at RPE −1 for the first week to re-acclimate.`
                : insert_deload
                ? "Extra deload added — treat this week as -40% volume, RPE 6."
                : "No change.",
            };
          },
        });

        const result = streamText({
          model,
          system,
          messages: await convertToModelMessages(body.messages),
          tools: {
            ...workspaceTools(userId),
            load_skill: loadSkillTool,
            list_workspace: listWorkspaceTool,
            read_file: readFileTool,
            save_workout_plan: saveWorkoutPlanTool,
            save_schedule: saveScheduleTool,
            save_nutrition_targets: saveNutritionTargetsTool,
            save_memory_note: saveMemoryNoteTool,
            delete_file: deleteFileTool,
            update_profile: updateProfileTool,
            complete_onboarding: completeOnboardingTool,
            log_workout: logWorkoutTool,
            log_meal: logMealTool,
            start_workout_session: startWorkoutSessionTool,
            mark_exercise_done: markExerciseDoneTool,
            complete_workout_session: completeWorkoutSessionTool,
            calc_program_timeline: calcProgramTimelineTool,
            calc_starting_weights: calcStartingWeightsTool,
            substitute_exercise: substituteExerciseTool,
            shift_schedule_weeks: shiftScheduleWeeksTool,
          },

          stopWhen: stepCountIs(50),
        });

        return result.toUIMessageStreamResponse({
          originalMessages: body.messages,
        });
      },
    },
  },
});
