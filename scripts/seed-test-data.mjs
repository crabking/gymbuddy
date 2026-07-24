// Seeds a fully-populated TEST account for E2E verification:
//   test@gymbuddy.local / test1234
// - onboarded profile
// - structured 16-week program (4x/week) started 3 weeks ago
// - ~3 weeks of completed sessions with realistic per-set logs + durations
// - a couple of skipped days
// - 21 days of meals (3-4/day) and bodyweight logs
// Usage: node --env-file=.env scripts/seed-test-data.mjs
import { Pool } from "pg";
import { randomBytes, scryptSync } from "node:crypto";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = (text, params) => pool.query(text, params);

const pad2 = (n) => String(n).padStart(2, "0");
const dstr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const addDays = (base, n) => {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
};
const round25 = (kg) => Math.round(kg / 2.5) * 2.5;

function hashPassword(pw) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
}

// --- 1. user + profile ---
const email = "test@gymbuddy.local";
const { rows: urows } = await q(
  `INSERT INTO users (email, password_hash) VALUES ($1,$2)
   ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash RETURNING id`,
  [email, hashPassword("test1234")],
);
const uid = urows[0].id;

// wipe previous test data for idempotency
for (const t of ["workout_sessions", "meal_logs", "weight_logs", "workout_logs", "chat_messages", "workspace_files", "programs"]) {
  await q(`DELETE FROM ${t} WHERE user_id=$1`, [uid]);
}

await q(
  `INSERT INTO profiles (id, display_name, goal, experience, days_per_week, session_minutes,
     equipment, height_cm, weight_kg, age, sex, diet_style, daily_calorie_target,
     schedule_note, meal_preferences, onboarding_completed)
   VALUES ($1,'Testy','hypertrophy + strength','intermediate',4,60,'full_gym',181,84,29,'male',
     'omnivore',2600,'Mon/Tue/Thu/Fri evenings','high protein, loves chicken + rice, no fish',true)
   ON CONFLICT (id) DO UPDATE SET display_name='Testy', goal='hypertrophy + strength',
     experience='intermediate', days_per_week=4, session_minutes=60, equipment='full_gym',
     height_cm=181, weight_kg=84, age=29, sex='male', diet_style='omnivore',
     daily_calorie_target=2600, onboarding_completed=true`,
  [uid],
);

// --- 2. structured program: 16 weeks, 4x/week (PHUL), started 3 weeks ago (Monday) ---
const now = new Date();
const thisMonday = addDays(now, -((now.getDay() + 6) % 7));
const start = addDays(thisMonday, -21); // 3 full weeks ago
const WEEKS = 16;
const OFFSETS = [0, 1, 3, 4]; // Mon Tue Thu Fri
const DELOADS = [5, 10, 15];

const template = [
  {
    title: "Upper Power", focus: "Heavy pressing + pulling",
    ex: [
      ["Bench press", 4, "4–6", 80, 2.5],
      ["Barbell row", 4, "4–6", 75, 2.5],
      ["Overhead press", 3, "6–8", 50, 2.5],
      ["Lat pulldown", 3, "8–10", 65, 2.5],
      ["Barbell curl", 3, "8–10", 30, 2.5],
    ],
  },
  {
    title: "Lower Power", focus: "Heavy squat + hinge",
    ex: [
      ["Back squat", 4, "4–6", 110, 5],
      ["Deadlift", 3, "3–5", 140, 5],
      ["Leg press", 3, "10–12", 180, 5],
      ["Lying leg curl", 3, "8–10", 45, 2.5],
      ["Standing calf raise", 4, "8–12", 90, 5],
    ],
  },
  {
    title: "Upper Hypertrophy", focus: "Pump work, upper body",
    ex: [
      ["Incline dumbbell press", 4, "8–12", 30, 2.5],
      ["Cable row", 4, "8–12", 60, 2.5],
      ["Lateral raises", 4, "12–15", 10, 2.5],
      ["Triceps pushdown", 3, "10–12", 35, 2.5],
      ["Hammer curl", 3, "10–12", 14, 2],
    ],
  },
  {
    title: "Lower Hypertrophy", focus: "Volume legs + glutes",
    ex: [
      ["Front squat", 4, "8–10", 70, 2.5],
      ["Romanian deadlift", 4, "8–10", 90, 5],
      ["Bulgarian split squat", 3, "10–12", 20, 2.5],
      ["Seated leg curl", 3, "12–15", 40, 2.5],
      ["Seated calf raise", 4, "12–15", 50, 2.5],
    ],
  },
];

const endDate = dstr(addDays(start, 7 * (WEEKS - 1) + OFFSETS[OFFSETS.length - 1]));
const { rows: prows } = await q(
  `INSERT INTO programs (user_id, name, goal, experience, start_date, end_date, weeks,
     days_per_week, session_minutes, status, deload_weeks, progression_rules, why)
   VALUES ($1,'PHUL — 16 weeks','hypertrophy + strength','intermediate',$2,$3,$4,4,60,'active',
     $5,'+2.5kg upper / +5kg lower every 2 training weeks when top of rep range is hit; deloads at 60% volume, -10% load.',
     'Power + hypertrophy split matches the dual goal; 4 days fits the schedule; proven template for intermediates.')
   RETURNING id`,
  [uid, dstr(start), endDate, WEEKS, JSON.stringify(DELOADS)],
);
const programId = prows[0].id;

let trainingWeeksSeen = 0;
const dayIds = []; // {id, date, week, di, title}
for (let w = 1; w <= WEEKS; w++) {
  const isDeload = DELOADS.includes(w);
  for (let di = 0; di < 4; di++) {
    const t = template[di];
    const date = dstr(addDays(start, 7 * (w - 1) + OFFSETS[di]));
    const { rows: drows } = await q(
      `INSERT INTO program_days (program_id, week, day_index, date, title, focus, is_deload)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [programId, w, di + 1, date, t.title, t.focus, isDeload],
    );
    const dayId = drows[0].id;
    dayIds.push({ id: dayId, date, week: w, di, title: t.title, isDeload });
    for (let p = 0; p < t.ex.length; p++) {
      const [name, sets, reps, startW, inc] = t.ex[p];
      const steps = Math.floor(trainingWeeksSeen / 2);
      const raw = startW + steps * inc;
      const weight = round25(isDeload ? raw * 0.9 : raw);
      await q(
        `INSERT INTO program_exercises (program_day_id, position, name, sets, rep_range, target_weight_kg)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [dayId, p, name, isDeload ? Math.max(2, Math.ceil(sets * 0.6)) : sets, reps, weight],
      );
    }
  }
  if (!DELOADS.includes(w)) trainingWeeksSeen++;
}

// --- 3. past 3 weeks: complete most days with realistic sessions + sets ---
const today = dstr(now);
const past = dayIds.filter((d) => d.date < today);
const skipEvery = 6; // skip ~every 6th past day
let completedCount = 0;
for (let i = 0; i < past.length; i++) {
  const day = past[i];
  if ((i + 1) % skipEvery === 0) {
    await q(`UPDATE program_days SET status='skipped' WHERE id=$1`, [day.id]);
    continue;
  }
  const { rows: exRows } = await q(
    `SELECT * FROM program_exercises WHERE program_day_id=$1 ORDER BY position`,
    [day.id],
  );
  // Session 17:30 local, duration 52-72 min
  const startTs = new Date(`${day.date}T17:30:00`);
  const durMin = 52 + Math.floor(Math.random() * 20);
  const endTs = new Date(startTs.getTime() + durMin * 60000);
  const { rows: srows } = await q(
    `INSERT INTO workout_sessions (user_id, session_date, title, status, program_day_id, created_at, completed_at)
     VALUES ($1,$2,$3,'completed',$4,$5,$6) RETURNING id`,
    [uid, day.date, day.title + (day.isDeload ? " (deload)" : ""), day.id, startTs.toISOString(), endTs.toISOString()],
  );
  const sessionId = srows[0].id;
  await q(`UPDATE program_days SET status='completed', session_id=$1 WHERE id=$2`, [sessionId, day.id]);

  let setTime = startTs.getTime() + 5 * 60000;
  for (let p = 0; p < exRows.length; p++) {
    const ex = exRows[p];
    const exDone = new Date(setTime + ex.sets * 3.2 * 60000);
    const { rows: serows } = await q(
      `INSERT INTO session_exercises (session_id, position, name, target, completed, completed_at)
       VALUES ($1,$2,$3,$4,true,$5) RETURNING id`,
      [sessionId, p, ex.name, `${ex.sets}×${ex.rep_range} @ ${ex.target_weight_kg}kg`, exDone.toISOString()],
    );
    const seId = serows[0].id;
    const [lo, hi] = ex.rep_range.split("–").map((x) => parseInt(x, 10));
    for (let s = 1; s <= ex.sets; s++) {
      setTime += (2.6 + Math.random() * 1.4) * 60000;
      const reps = Math.max(lo || 5, Math.min(hi || 8, (lo || 5) + Math.floor(Math.random() * ((hi || 8) - (lo || 5) + 1))));
      // occasional small PR wobble ±2.5
      const wobble = Math.random() < 0.15 ? 2.5 : 0;
      await q(
        `INSERT INTO session_sets (session_exercise_id, set_index, target_reps, weight_kg, reps, completed, completed_at)
         VALUES ($1,$2,$3,$4,$5,true,$6)`,
        [seId, s, ex.rep_range, (ex.target_weight_kg ?? 0) + wobble, reps, new Date(setTime).toISOString()],
      );
    }
  }
  completedCount++;
}

// --- 4. meals: 21 days, 3-4/day around 2600 kcal target ---
const MEALS = [
  ["Oats + whey + banana", 540, 42, 74, 9],
  ["Chicken rice bowl", 690, 56, 82, 14],
  ["Greek yogurt + berries + honey", 320, 28, 38, 6],
  ["Beef pasta bolognese", 780, 48, 88, 24],
  ["Protein shake + peanut butter toast", 430, 38, 34, 15],
  ["Salmon-free turkey wrap", 520, 44, 48, 16],
  ["Rice cakes + cottage cheese", 260, 24, 30, 4],
  ["Steak, potatoes & veg", 740, 52, 64, 28],
];
for (let d = 21; d >= 1; d--) {
  const date = addDays(now, -d);
  const nMeals = 3 + (d % 2);
  for (let m = 0; m < nMeals; m++) {
    const meal = MEALS[(d + m * 3) % MEALS.length];
    const ts = new Date(date);
    ts.setHours(8 + m * 4, 15 + ((d * 7) % 40), 0, 0);
    await q(
      `INSERT INTO meal_logs (user_id, description, calories, protein_g, carbs_g, fat_g, logged_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [uid, meal[0], meal[1], meal[2], meal[3], meal[4], ts.toISOString()],
    );
  }
}

// --- 5. bodyweight: every ~2 days, slight recomposition trend 85.2 -> 84.0 ---
for (let d = 21; d >= 0; d -= 2) {
  const date = addDays(now, -d);
  date.setHours(7, 30, 0, 0);
  const w = 85.2 - (21 - d) * 0.055 + (Math.random() * 0.4 - 0.2);
  await q(`INSERT INTO weight_logs (user_id, weight_kg, logged_at) VALUES ($1,$2,$3)`, [
    uid,
    Math.round(w * 10) / 10,
    date.toISOString(),
  ]);
}

const { rows: counts } = await q(
  `SELECT
     (SELECT count(*) FROM program_days pd JOIN programs p ON p.id=pd.program_id WHERE p.user_id=$1) AS days,
     (SELECT count(*) FROM workout_sessions WHERE user_id=$1 AND status='completed') AS sessions,
     (SELECT count(*) FROM meal_logs WHERE user_id=$1) AS meals,
     (SELECT count(*) FROM weight_logs WHERE user_id=$1) AS weights`,
  [uid],
);
console.log(`Seeded ${email} (${uid})`);
console.log(`  program days: ${counts[0].days}, completed sessions: ${counts[0].sessions} (${completedCount} new), meals: ${counts[0].meals}, weights: ${counts[0].weights}`);
await pool.end();
