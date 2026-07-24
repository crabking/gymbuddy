import { getDb } from "@/db/db.server";
import { workoutSessions, sessionExercises, sessionSets, mealLogs, weightLogs } from "@/db/schema";

// Seeds ~3 weeks of realistic demo data (completed sessions with per-set logs,
// meals, bodyweight) for a user so the dashboard has something to show.
// Standalone sessions — the structured program (if any) is left untouched.

const pad2 = (n: number) => String(n).padStart(2, "0");
const dstr = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const addDays = (base: Date, n: number) => {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
};

const TEMPLATE = [
  {
    title: "Upper Power",
    ex: [
      ["Bench press", 4, "4–6", 80],
      ["Barbell row", 4, "4–6", 75],
      ["Overhead press", 3, "6–8", 50],
      ["Lat pulldown", 3, "8–10", 65],
    ],
  },
  {
    title: "Lower Power",
    ex: [
      ["Back squat", 4, "4–6", 110],
      ["Deadlift", 3, "3–5", 140],
      ["Leg press", 3, "10–12", 180],
      ["Lying leg curl", 3, "8–10", 45],
    ],
  },
  {
    title: "Upper Hypertrophy",
    ex: [
      ["Incline dumbbell press", 4, "8–12", 30],
      ["Cable row", 4, "8–12", 60],
      ["Lateral raises", 4, "12–15", 10],
      ["Triceps pushdown", 3, "10–12", 35],
    ],
  },
  {
    title: "Lower Hypertrophy",
    ex: [
      ["Front squat", 4, "8–10", 70],
      ["Romanian deadlift", 4, "8–10", 90],
      ["Bulgarian split squat", 3, "10–12", 20],
      ["Seated calf raise", 4, "12–15", 50],
    ],
  },
] as const;

const MEALS: Array<[string, number, number, number, number]> = [
  ["Oats + whey + banana", 540, 42, 74, 9],
  ["Chicken rice bowl", 690, 56, 82, 14],
  ["Greek yogurt + berries", 320, 28, 38, 6],
  ["Beef pasta bolognese", 780, 48, 88, 24],
  ["Protein shake + PB toast", 430, 38, 34, 15],
  ["Turkey wrap", 520, 44, 48, 16],
  ["Steak, potatoes & veg", 740, 52, 64, 28],
];

export async function seedDemoData(userId: string) {
  const db = getDb();
  const now = new Date();
  const OFFS = [0, 1, 3, 4]; // Mon Tue Thu Fri within each week
  const monday = addDays(now, -((now.getDay() + 6) % 7));

  let sessions = 0;
  // 3 full past weeks of sessions (skip one day per week for realism)
  for (let w = 3; w >= 1; w--) {
    for (let di = 0; di < 4; di++) {
      const day = addDays(monday, -7 * w + OFFS[di]);
      if (dstr(day) >= dstr(now)) continue;
      const t = TEMPLATE[di];
      const skipped = w === 2 && di === 3; // one skipped session in week -2
      const startTs = new Date(day);
      startTs.setHours(17, 30, 0, 0);
      const durMin = 52 + Math.floor(Math.random() * 20);
      const endTs = new Date(startTs.getTime() + durMin * 60000);
      const [session] = await db
        .insert(workoutSessions)
        .values({
          user_id: userId,
          session_date: dstr(day),
          title: t.title,
          status: skipped ? "abandoned" : "completed",
          created_at: startTs.toISOString(),
          completed_at: skipped ? null : endTs.toISOString(),
        })
        .returning({ id: workoutSessions.id });
      if (skipped) continue;
      sessions++;

      let setTime = startTs.getTime() + 5 * 60000;
      for (let p = 0; p < t.ex.length; p++) {
        const [name, nSets, repRange, baseW] = t.ex[p];
        // Simple progression across the 3 weeks: +2.5kg per week
        const weight = baseW + (3 - w) * 2.5;
        const [se] = await db
          .insert(sessionExercises)
          .values({
            session_id: session.id,
            position: p,
            name,
            target: `${nSets}×${repRange} @ ${weight}kg`,
            completed: true,
            completed_at: new Date(setTime + nSets * 3 * 60000).toISOString(),
          })
          .returning({ id: sessionExercises.id });
        const [lo, hi] = String(repRange)
          .split("–")
          .map((x) => parseInt(x, 10));
        for (let s = 1; s <= nSets; s++) {
          setTime += (2.5 + Math.random() * 1.5) * 60000;
          const reps = Math.max(lo || 5, Math.min(hi || 10, (lo || 5) + Math.floor(Math.random() * 4)));
          await db.insert(sessionSets).values({
            session_exercise_id: se.id,
            set_index: s,
            target_reps: String(repRange),
            weight_kg: weight,
            reps,
            completed: true,
            completed_at: new Date(setTime).toISOString(),
          });
        }
      }
    }
  }

  // 21 days of meals (3-4/day)
  let meals = 0;
  for (let d = 21; d >= 1; d--) {
    const date = addDays(now, -d);
    const nMeals = 3 + (d % 2);
    for (let m = 0; m < nMeals; m++) {
      const meal = MEALS[(d + m * 3) % MEALS.length];
      const ts = new Date(date);
      ts.setHours(8 + m * 4, 15 + ((d * 7) % 40), 0, 0);
      await db.insert(mealLogs).values({
        user_id: userId,
        description: meal[0],
        calories: meal[1],
        protein_g: meal[2],
        carbs_g: meal[3],
        fat_g: meal[4],
        logged_at: ts.toISOString(),
      });
      meals++;
    }
  }

  // Bodyweight every 2 days, slight downward trend
  let weights = 0;
  for (let d = 21; d >= 0; d -= 2) {
    const date = addDays(now, -d);
    date.setHours(7, 30, 0, 0);
    const w = 85.2 - (21 - d) * 0.055 + (Math.random() * 0.4 - 0.2);
    await db.insert(weightLogs).values({
      user_id: userId,
      weight_kg: Math.round(w * 10) / 10,
      logged_at: date.toISOString(),
    });
    weights++;
  }

  return { ok: true as const, sessions, meals, weights };
}
