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
const dayTemplates = [
  {
    title: "Day 1 — Squat (heavy lower)",
    focus: "High-bar squat strength and quad size",
    exerciseId: "high-bar-back-squat",
    exercise: "High-Bar Back Squat",
    sets: 4,
    reps: "4–6",
    startWeight: 170,
  },
  {
    title: "Day 2 — Bench (upper push)",
    focus: "Bench strength and chest, shoulder, and triceps size",
    exerciseId: "bench-press",
    exercise: "Bench Press",
    sets: 4,
    reps: "4–6",
    startWeight: 145,
  },
  {
    title: "Day 3 — Deadlift (heavy lower)",
    focus: "Deadlift strength and posterior-chain size",
    exerciseId: "conventional-deadlift",
    exercise: "Deadlift",
    sets: 3,
    reps: "3–5",
    startWeight: 200,
  },
  {
    title: "Day 4 — Pull + arms",
    focus: "Back thickness, width, and arm size",
    exerciseId: "barbell-row",
    exercise: "Barbell Row",
    sets: 4,
    reps: "6–8",
    startWeight: 90,
  },
];

async function completeSupportingDays(client, targetWeek) {
  const userResult = await client.query("SELECT id FROM users WHERE email = $1", [email]);
  const existingUserId = userResult.rows[0]?.id;
  if (!existingUserId) throw new Error("Seed the Tank skip scenario before preparing a week");

  // Move the full calendar out of the way first so the unique program/date
  // constraint cannot collide while the simulated "current week" changes.
  await client.query(
    `UPDATE program_days pd
     SET date = (pd.date::date + 1000)::text
     FROM programs p
     WHERE p.id = pd.program_id
       AND p.user_id = $1
       AND p.status = 'active'`,
    [existingUserId],
  );
  await client.query(
    `UPDATE program_days pd
     SET date = $2::date
       + ((pd.week - $3) * 7)
       + CASE pd.day_index
           WHEN 1 THEN -3
           WHEN 2 THEN 0
           WHEN 3 THEN -2
           WHEN 4 THEN -1
         END
     FROM programs p
     WHERE p.id = pd.program_id
       AND p.user_id = $1
       AND p.status = 'active'`,
    [existingUserId, localToday, targetWeek],
  );

  const daysResult = await client.query(
    `SELECT pd.id, pd.date, pd.title
     FROM program_days pd
     JOIN programs p ON p.id = pd.program_id
     WHERE p.user_id = $1
       AND p.status = 'active'
       AND pd.week = $2
       AND pd.day_index <> 2
       AND pd.status = 'planned'
     ORDER BY pd.day_index`,
    [existingUserId, targetWeek],
  );

  for (const day of daysResult.rows) {
    const sessionId = randomUUID();
    await client.query(
      `INSERT INTO workout_sessions (
         id, user_id, session_date, title, status, program_day_id,
         source_key, duration_minutes, end_reason, completed_at
       ) VALUES ($1, $2, $3, $4, 'completed', $5, $6, 60, 'Completed in local attendance simulation.', now())`,
      [
        sessionId,
        existingUserId,
        day.date,
        day.title,
        day.id,
        `dev-tank-attendance:w${targetWeek}:${day.id}`,
      ],
    );
    await client.query(
      "UPDATE program_days SET status = 'completed', session_id = $1 WHERE id = $2",
      [sessionId, day.id],
    );
  }

  await client.query(
    `UPDATE programs
     SET revision = revision + 1
     WHERE user_id = $1 AND status = 'active'`,
    [existingUserId],
  );
  return daysResult.rowCount;
}

const client = new pg.Client({ connectionString });
await client.connect();
const prepareWeekArg = process.argv.find((arg) => arg.startsWith("--prepare-week="));
if (prepareWeekArg) {
  const targetWeek = Number.parseInt(prepareWeekArg.split("=")[1] ?? "", 10);
  if (![1, 2, 3].includes(targetWeek)) throw new Error("prepare week must be 1, 2, or 3");
  try {
    await client.query("BEGIN");
    const completed = await completeSupportingDays(client, targetWeek);
    await client.query("COMMIT");
    console.log(JSON.stringify({ email, targetWeek, completed }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
} else if (process.argv.includes("--inspect")) {
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
      'advanced', 4, 60, 'Full commercial gym', 'None', 182, 96, 31, 'male',
      'en', 'moderate', 'Experienced powerlifter: bench 155 kg, squat 205 kg, deadlift 235 kg.',
      'omnivore', 3000, 'Four sessions each week: squat, bench, deadlift, then pull and arms.',
      'High-protein whole foods', 210, 340, 90, 'Europe/Stockholm', 'male',
      'brutus', true
    )`,
      [userId],
    );

    const files = [
      [
        "schedule/current.md",
        "# Schedule\nFour sessions each week: squat, bench, deadlift, then pull and arms.",
        "Four-session powerbuilding schedule.",
      ],
      [
        "plans/current.md",
        "# Program\nA four-day powerbuilding block built around a 180 kg bench goal while maintaining squat and deadlift strength.",
        "Four-day powerbuilding block.",
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
      $1, $2, 'Road to 180 — Four-Day Powerbuilding',
      'Bench press 180 kg while maintaining squat and deadlift strength', 'advanced', $3, $4, 3, 4, 'rolling', '[]'::jsonb,
      60, 'active', 0, '[]'::jsonb,
      'Progress only from completed training. Never compensate for missed work with unsafe jumps.',
      'Build the bench while preserving the full powerlifting base.',
      'dev-tank-skip-e2e'
    )`,
      [programId, userId, addDays(localToday, -14), addDays(localToday, 6)],
    );

    for (let week = 1; week <= 3; week += 1) {
      for (let dayIndex = 1; dayIndex <= dayTemplates.length; dayIndex += 1) {
        const template = dayTemplates[dayIndex - 1];
        const dayId = randomUUID();
        await client.query(
          `INSERT INTO program_days (
          id, program_id, week, day_index, date, title, focus, is_deload, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, false, 'planned')`,
          [
            dayId,
            programId,
            week,
            dayIndex,
            addDays(localToday, (week - 1) * 7 + [-3, 0, -2, -1][dayIndex - 1]),
            template.title,
            template.focus,
          ],
        );
        await client.query(
          `INSERT INTO program_exercises (
          program_day_id, position, exercise_id, name, sets, rep_range,
          target_weight_kg, progression_step_kg, notes
        ) VALUES ($1, 0, $2, $3, $4, $5, $6, 2.5, 'Primary working movement.')`,
          [
            dayId,
            template.exerciseId,
            template.exercise,
            template.sets,
            template.reps,
            template.startWeight + (week - 1) * 2.5,
          ],
        );
      }
    }
    await completeSupportingDays(client, 1);
    await client.query("COMMIT");
    console.log(JSON.stringify({ email, password, localToday }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}
