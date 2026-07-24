import {
  pgTable,
  uuid,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// Column *property* names are snake_case to match the app's existing shapes
// (e.g. profile.display_name, insert({ user_id, parts })), so query objects and
// selected rows line up with the code with no field renaming.

// ISO-string timestamps (matches the previous Supabase behavior and serializes
// cleanly across the server-function boundary).
const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date().toISOString());

// --- Auth (replaces Supabase Auth) ---

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  password_hash: text("password_hash").notNull(),
  created_at: createdAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    // SHA-256 hash of the session token (the raw token lives only in the cookie).
    id: text("id").primaryKey(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires_at: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    created_at: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.user_id)],
);

// --- App data (ported from the Supabase schema) ---

export const profiles = pgTable("profiles", {
  id: uuid("id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  display_name: text("display_name"),
  goal: text("goal"),
  experience: text("experience"),
  days_per_week: integer("days_per_week"),
  session_minutes: integer("session_minutes"),
  equipment: text("equipment"),
  injuries: text("injuries"),
  height_cm: doublePrecision("height_cm"),
  weight_kg: doublePrecision("weight_kg"),
  age: integer("age"),
  sex: text("sex"),
  diet_style: text("diet_style"),
  daily_calorie_target: integer("daily_calorie_target"),
  active_plan_id: uuid("active_plan_id"),
  schedule_note: text("schedule_note"),
  meal_preferences: text("meal_preferences"),
  coach_gender: text("coach_gender").notNull().default("male"),
  coach_id: text("coach_id").notNull().default("rex"),
  onboarding_completed: boolean("onboarding_completed").notNull().default(false),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    plan_type: text("plan_type"),
    difficulty: text("difficulty"),
    days_per_week: integer("days_per_week"),
    structure: jsonb("structure").notNull(),
    is_candidate: boolean("is_candidate").notNull().default(false),
    created_at: createdAt(),
  },
  (t) => [index("plans_user_idx").on(t.user_id)],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    parts: jsonb("parts").notNull(),
    created_at: createdAt(),
  },
  (t) => [index("chat_messages_user_created_idx").on(t.user_id, t.created_at)],
);

export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    content: text("content").notNull(),
    created_at: createdAt(),
  },
  (t) => [index("memories_user_created_idx").on(t.user_id, t.created_at)],
);

export const workoutLogs = pgTable(
  "workout_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    exercise: text("exercise").notNull(),
    weight_kg: doublePrecision("weight_kg"),
    reps: integer("reps"),
    rpe: doublePrecision("rpe"),
    notes: text("notes"),
    logged_at: timestamp("logged_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("workout_logs_user_logged_idx").on(t.user_id, t.logged_at)],
);

export const mealLogs = pgTable(
  "meal_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    calories: integer("calories"),
    protein_g: doublePrecision("protein_g"),
    carbs_g: doublePrecision("carbs_g"),
    fat_g: doublePrecision("fat_g"),
    logged_at: timestamp("logged_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("meal_logs_user_logged_idx").on(t.user_id, t.logged_at)],
);

// --- Structured training programs (full dated 16-week engine) ---

export const programs = pgTable(
  "programs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    goal: text("goal"),
    experience: text("experience"),
    start_date: text("start_date").notNull(), // YYYY-MM-DD
    end_date: text("end_date").notNull(),
    weeks: integer("weeks").notNull(),
    days_per_week: integer("days_per_week").notNull(),
    session_minutes: integer("session_minutes"),
    status: text("status").notNull().default("active"), // active | completed | archived
    deload_weeks: jsonb("deload_weeks").notNull().default([]),
    progression_rules: text("progression_rules"),
    why: text("why"),
    created_at: createdAt(),
  },
  (t) => [index("programs_user_idx").on(t.user_id, t.status)],
);

export const programDays = pgTable(
  "program_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    program_id: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    week: integer("week").notNull(), // 1-based
    day_index: integer("day_index").notNull(), // 1-based within the week
    date: text("date").notNull(), // YYYY-MM-DD — real calendar date
    title: text("title").notNull(), // e.g. "Upper Power"
    focus: text("focus"),
    is_deload: boolean("is_deload").notNull().default(false),
    status: text("status").notNull().default("planned"), // planned | completed | skipped
    session_id: uuid("session_id"), // linked live session when run
  },
  (t) => [
    index("program_days_program_idx").on(t.program_id, t.date),
    index("program_days_date_idx").on(t.date),
  ],
);

export const programExercises = pgTable(
  "program_exercises",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    program_day_id: uuid("program_day_id")
      .notNull()
      .references(() => programDays.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    name: text("name").notNull(),
    sets: integer("sets").notNull(),
    rep_range: text("rep_range").notNull(), // e.g. "6–8"
    target_weight_kg: doublePrecision("target_weight_kg"),
    notes: text("notes"),
  },
  (t) => [index("program_exercises_day_idx").on(t.program_day_id, t.position)],
);

// Per-set logging inside a live session (actual weight × reps performed).
export const sessionSets = pgTable(
  "session_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    session_exercise_id: uuid("session_exercise_id")
      .notNull()
      .references(() => sessionExercises.id, { onDelete: "cascade" }),
    set_index: integer("set_index").notNull(), // 1-based
    target_reps: text("target_reps"), // e.g. "6–8"
    weight_kg: doublePrecision("weight_kg"),
    reps: integer("reps"),
    completed: boolean("completed").notNull().default(false),
    completed_at: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [index("session_sets_exercise_idx").on(t.session_exercise_id, t.set_index)],
);

// Bodyweight history.
export const weightLogs = pgTable(
  "weight_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weight_kg: doublePrecision("weight_kg").notNull(),
    logged_at: timestamp("logged_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("weight_logs_user_idx").on(t.user_id, t.logged_at)],
);

// Live workout sessions — the coach's real-time "today's workout" engine.
export const workoutSessions = pgTable(
  "workout_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    session_date: text("session_date").notNull(), // YYYY-MM-DD (user-local day)
    title: text("title").notNull(),
    status: text("status").notNull().default("active"), // active | completed | abandoned
    program_day_id: uuid("program_day_id"), // linked program day (dated engine)
    created_at: createdAt(),
    completed_at: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [index("workout_sessions_user_idx").on(t.user_id, t.session_date)],
);

export const sessionExercises = pgTable(
  "session_exercises",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    session_id: uuid("session_id")
      .notNull()
      .references(() => workoutSessions.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    name: text("name").notNull(),
    target: text("target"), // e.g. "4×6–8 @ 60kg"
    completed: boolean("completed").notNull().default(false),
    completed_at: timestamp("completed_at", { withTimezone: true, mode: "string" }),
    notes: text("notes"),
  },
  (t) => [index("session_exercises_session_idx").on(t.session_id, t.position)],
);

export const workspaceFiles = pgTable(
  "workspace_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    content: text("content").notNull().default(""),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (t) => [uniqueIndex("workspace_files_user_path_idx").on(t.user_id, t.path)],
);

export type Profile = typeof profiles.$inferSelect;
export type User = typeof users.$inferSelect;
