import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const hostname = new URL(connectionString).hostname.toLowerCase();
if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
  throw new Error("Refusing to seed the Tank skip scenario outside the local database");
}

const email = "codex-tank-skip-e2e@example.invalid";
const password = "tanktest123";
const salt = randomBytes(16).toString("hex");
const passwordHash = `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
const userId = randomUUID();
const programId = randomUUID();
const localToday = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const addDays = (date, days) => {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const client = new pg.Client({ connectionString });
await client.connect();
if (process.argv.includes("--inspect")) {
  try {
    const operations = await client.query(
      `SELECT po.result
       FROM program_operations po
       JOIN users u ON u.id = po.user_id
       WHERE u.email = $1 AND po.operation = 'resolve_day'
       ORDER BY po.created_at`,
      [email],
    );
    console.log(
      JSON.stringify(
        operations.rows.map((row) => row.result),
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
} else {
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM users WHERE email = $1", [email]);
    await client.query("INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)", [
      userId,
      email,
      passwordHash,
    ]);
    await client.query(
      `INSERT INTO profiles (
      id, display_name, goal, experience, days_per_week, session_minutes,
      equipment, injuries, height_cm, weight_kg, age, sex, preferred_language,
      activity_level, recent_training_baseline, diet_style, daily_calorie_target,
      schedule_note, meal_preferences, daily_protein_target_g,
      daily_carbs_target_g, daily_fat_target_g, timezone, coach_gender,
      coach_id, onboarding_completed
    ) VALUES (
      $1, 'Mike', 'Bench press 180 kg while building a stronger powerlifting total',
      'advanced', 1, 60, 'Full commercial gym', 'None', 182, 96, 31, 'male',
      'en', 'moderate', 'Experienced powerlifter: bench 155 kg, squat 205 kg, deadlift 235 kg.',
      'omnivore', 3000, 'One upper-strength workout each week for this focused UI test.',
      'High-protein whole foods', 210, 340, 90, 'Europe/Stockholm', 'male',
      'brutus', true
    )`,
      [userId],
    );

    const files = [
      [
        "schedule/current.md",
        "# Schedule\nOne focused upper-strength workout each program week.",
        "One focused upper-strength workout each program week.",
      ],
      [
        "plans/current.md",
        "# Program\nThree-week attendance accountability test for a 180 kg bench goal.",
        "Three-week attendance accountability test.",
      ],
      [
        "nutrition/targets.md",
        "# Nutrition\n3000 kcal; 210g protein; 340g carbs; 90g fat.",
        "3000 kcal and full macro targets.",
      ],
    ];
    for (const [path, content, summary] of files) {
      await client.query(
        `INSERT INTO workspace_files (user_id, path, content, size_bytes, summary)
       VALUES ($1, $2, $3, $4, $5)`,
        [userId, path, content, Buffer.byteLength(content), summary],
      );
    }

    await client.query(
      `INSERT INTO programs (
      id, user_id, name, goal, experience, start_date, end_date, weeks,
      days_per_week, schedule_mode, weekday_indices, session_minutes, status,
      revision, deload_weeks, progression_rules, why, source_key
    ) VALUES (
      $1, $2, 'Three-Week 180 Bench Accountability Block',
      'Bench press 180 kg', 'advanced', $3, $4, 3, 1, 'weekday', '[]'::jsonb,
      60, 'active', 0, '[]'::jsonb,
      'Progress only from completed training. Never compensate for missed work with unsafe jumps.',
      'Test whether Tank detects and coaches a repeated weekly skip pattern.',
      'dev-tank-skip-e2e'
    )`,
      [programId, userId, localToday, addDays(localToday, 14)],
    );

    for (let week = 1; week <= 3; week += 1) {
      const dayId = randomUUID();
      await client.query(
        `INSERT INTO program_days (
        id, program_id, week, day_index, date, title, focus, is_deload, status
      ) VALUES (
        $1, $2, $3, 1, $4, 'Day 1 — Upper Strength',
        'Bench strength and upper-back support', false, 'planned'
      )`,
        [dayId, programId, week, addDays(localToday, (week - 1) * 7)],
      );
      await client.query(
        `INSERT INTO program_exercises (
        program_day_id, position, exercise_id, name, sets, rep_range,
        target_weight_kg, progression_step_kg, notes
      ) VALUES
        ($1, 0, 'bench-press', 'Bench Press', 4, '4–6', $2, 2.5, 'Powerlifting pause.'),
        ($1, 1, 'barbell-row', 'Barbell Row', 4, '6–8', $3, 2.5, 'Strict torso.'),
        ($1, 2, 'triceps-pushdown', 'Triceps Pushdown', 3, '10–12', $4, 2.5, 'Controlled lockout.')`,
        [dayId, 145 + (week - 1) * 2.5, 90 + (week - 1) * 2.5, 35 + (week - 1) * 2.5],
      );
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({ email, password, localToday }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}
