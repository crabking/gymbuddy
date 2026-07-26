import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const hostname = new URL(connectionString).hostname.toLowerCase();
if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
  throw new Error("Refusing to seed the Tank attendance scenario outside the local database");
}

const email = "codex-tank-8week-e2e@example.invalid";
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

const templates = [
  {
    title: "Day 1 — Squat Strength",
    focus: "Competition squat and quad strength",
    exercises: [
      ["high-bar-back-squat", "High-Bar Back Squat", 5, "3–5", 170, 2.5],
      ["leg-press", "Leg Press", 4, "8–10", 220, 5],
      ["leg-extension", "Leg Extension", 3, "10–12", 70, 2.5],
      ["standing-calf-raise", "Standing Calf Raise", 4, "8–12", 90, 2.5],
    ],
  },
  {
    title: "Day 2 — Bench Strength",
    focus: "Paused bench and upper-back support",
    exercises: [
      ["bench-press", "Bench Press", 5, "3–5", 145, 2.5],
      ["barbell-row", "Barbell Row", 4, "6–8", 90, 2.5],
      ["incline-dumbbell-press", "Incline Dumbbell Press", 3, "8–10", 42.5, 2.5],
      ["triceps-pushdown", "Triceps Pushdown", 3, "10–12", 35, 2.5],
    ],
  },
  {
    title: "Day 3 — Deadlift Strength",
    focus: "Competition deadlift and posterior chain",
    exercises: [
      ["conventional-deadlift", "Deadlift", 4, "3–5", 210, 5],
      ["romanian-deadlift", "Romanian Deadlift", 3, "6–8", 130, 2.5],
      ["lat-pulldown", "Lat Pulldown", 4, "8–10", 80, 2.5],
      ["seated-leg-curl", "Seated Leg Curl", 3, "10–12", 65, 2.5],
    ],
  },
  {
    title: "Day 4 — Upper Volume",
    focus: "Pressing volume, delts, and arms",
    exercises: [
      ["overhead-press", "Overhead Press", 4, "5–7", 70, 2.5],
      ["chest-supported-row", "Chest-Supported Row", 4, "8–10", 75, 2.5],
      ["lateral-raise", "Dumbbell Lateral Raise", 4, "12–15", 12.5, 2.5],
      ["barbell-curl", "Barbell Curl", 3, "8–10", 35, 2.5],
    ],
  },
];
const weekOffsets = [0, 1, 3, 5];

const client = new pg.Client({ connectionString });
await client.connect();
const advanceArgument = process.argv.find((argument) => argument.startsWith("--advance-to-week="));
if (advanceArgument) {
  const targetWeek = Number(advanceArgument.split("=")[1]);
  if (!Number.isInteger(targetWeek) || targetWeek < 2 || targetWeek > 8) {
    throw new Error("advance target must be an integer week between 2 and 8");
  }
  try {
    await client.query("BEGIN");
    const days = await client.query(
      `SELECT pd.id, pd.week, pd.day_index, pd.date, pd.title, p.user_id
       FROM program_days pd
       JOIN programs p ON p.id = pd.program_id
       JOIN users u ON u.id = p.user_id
       WHERE u.email = $1
         AND pd.status = 'planned'
         AND (pd.week < $2 OR (pd.week = $2 AND pd.day_index < 2))
       ORDER BY pd.week, pd.day_index`,
      [email, targetWeek],
    );
    for (const day of days.rows) {
      const sessionId = randomUUID();
      await client.query(
        `INSERT INTO workout_sessions (
          id, user_id, session_date, title, status, program_day_id,
          source_key, duration_minutes, end_reason, completed_at
        ) VALUES ($1, $2, $3, $4, 'completed', $5, $6, 74, 'completed', now())`,
        [
          sessionId,
          day.user_id,
          day.date,
          day.title,
          day.id,
          `dev-tank-8week-advance-w${day.week}-d${day.day_index}`,
        ],
      );
      await client.query(
        `UPDATE program_days
         SET status = 'completed', session_id = $1
         WHERE id = $2`,
        [sessionId, day.id],
      );
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({ advanced_to_week: targetWeek, completed_days: days.rowCount }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
} else if (process.argv.includes("--inspect")) {
  try {
    const operation = await client.query(
      `SELECT po.result
       FROM program_operations po
       JOIN users u ON u.id = po.user_id
       WHERE u.email = $1 AND po.operation = 'resolve_day'
       ORDER BY po.created_at`,
      [email],
    );
    const attendance = await client.query(
      `SELECT pd.week, pd.day_index, pd.date, pd.title, pd.status, pd.resolution_note
       FROM program_days pd
       JOIN programs p ON p.id = pd.program_id
       JOIN users u ON u.id = p.user_id
       WHERE u.email = $1 AND pd.week <= 3
       ORDER BY pd.week, pd.day_index`,
      [email],
    );
    const weekFourLoads = await client.query(
      `SELECT pd.day_index, pe.name, pe.target_weight_kg
       FROM program_exercises pe
       JOIN program_days pd ON pd.id = pe.program_day_id
       JOIN programs p ON p.id = pd.program_id
       JOIN users u ON u.id = p.user_id
       WHERE u.email = $1 AND pd.week = 4
       ORDER BY pd.day_index, pe.position`,
      [email],
    );
    console.log(
      JSON.stringify(
        {
          operations: operation.rows.map((row) => row.result),
          first_three_weeks_attendance: attendance.rows,
          week_four_loads: weekFourLoads.rows,
        },
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
        $1, 'Mike', 'Build toward a 180 kg bench, 220 kg squat, and 260 kg deadlift',
        'advanced', 4, 75, 'Full commercial gym', 'None', 182, 96, 31, 'male',
        'en', 'moderate', 'Advanced powerlifter: bench 155 kg, squat 205 kg, deadlift 235 kg.',
        'omnivore', 3200, 'Four sessions per week across an eight-week strength block.',
        'High-protein whole foods', 220, 360, 95, 'Europe/Stockholm', 'male',
        'brutus', true
      )`,
      [userId],
    );
    for (const [path, content, summary] of [
      [
        "schedule/current.md",
        "# Weekly schedule\nFour 75-minute sessions per week in program order.",
        "Four 75-minute sessions per week.",
      ],
      [
        "nutrition/targets.md",
        "# Nutrition targets\n3200 kcal; 220g protein; 360g carbohydrates; 95g fat.",
        "3200 kcal with full macro targets.",
      ],
    ]) {
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
        $1, $2, 'Eight-Week Powerlifting Build',
        'Bench 180 kg, squat 220 kg, deadlift 260 kg', 'advanced', $3, $4,
        8, 4, 'weekday', '[0,1,3,5]'::jsonb, 75, 'active', 0, '[4]'::jsonb,
        'Progress each weekly training slot only after the work supporting it is completed.',
        'A realistic four-day powerlifting block with an independent progression path per day.',
        'dev-tank-8week-attendance-e2e'
      )`,
      [programId, userId, localToday, addDays(localToday, 54)],
    );

    for (let week = 1; week <= 8; week += 1) {
      for (let dayIndex = 1; dayIndex <= 4; dayIndex += 1) {
        const template = templates[dayIndex - 1];
        const dayId = randomUUID();
        const isDeload = week === 4;
        await client.query(
          `INSERT INTO program_days (
            id, program_id, week, day_index, date, title, focus, is_deload, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            dayId,
            programId,
            week,
            dayIndex,
            addDays(localToday, (week - 1) * 7 + weekOffsets[dayIndex - 1]),
            template.title,
            template.focus,
            isDeload,
            "planned",
          ],
        );
        for (let position = 0; position < template.exercises.length; position += 1) {
          const [exerciseId, name, sets, reps, startingWeight, step] = template.exercises[position];
          const trainingWeeks = week - 1 - (week > 4 ? 1 : 0);
          const targetWeight = isDeload
            ? Math.round(startingWeight * 0.8 * 2) / 2
            : startingWeight + Math.max(0, trainingWeeks) * step;
          await client.query(
            `INSERT INTO program_exercises (
              program_day_id, position, exercise_id, name, sets, rep_range,
              target_weight_kg, progression_step_kg, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              dayId,
              position,
              exerciseId,
              name,
              sets,
              reps,
              targetWeight,
              step,
              "Use competition-quality technique and record every working set.",
            ],
          );
        }
        if (week === 1 && dayIndex === 1) {
          const sessionId = randomUUID();
          await client.query(
            `INSERT INTO workout_sessions (
              id, user_id, session_date, title, status, program_day_id,
              source_key, duration_minutes, end_reason, completed_at
            ) VALUES ($1, $2, $3, $4, 'completed', $5, $6, 72, 'completed', now())`,
            [
              sessionId,
              userId,
              addDays(localToday, weekOffsets[dayIndex - 1]),
              template.title,
              dayId,
              "dev-tank-8week-completed-day-1",
            ],
          );
          await client.query(
            `UPDATE program_days
             SET status = 'completed', session_id = $1
             WHERE id = $2`,
            [sessionId, dayId],
          );
        }
      }
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
