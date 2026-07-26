import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/db.server";
import { profiles, users, weightLogs } from "@/db/schema";
import {
  decideAdaptation,
  getAdaptationHistory,
  submitWorkoutReview,
} from "@/lib/adaptive-training.server";
import { getCoach, type CoachId } from "@/lib/coaches";
import { getDashboardData } from "@/lib/dashboard.server";
import { addLocalDays } from "@/lib/local-date";
import { getMeasurements, logMeasurement } from "@/lib/measurement.server";
import { getNutrition, logMeal } from "@/lib/nutrition.server";
import {
  adjustProgramExercise,
  generateProgram,
  getCurrentProgram,
  resolveProgramDay,
  summarizeProgram,
  type WeekTemplateDay,
} from "@/lib/program.server";
import {
  abandonSession,
  completeSession,
  getActiveSession,
  getRecentSessions,
  getWorkoutHistory,
  markSetDone,
  startSession,
  summarizeRecentSessions,
  summarizeWorkoutHistory,
} from "@/lib/workout-session.server";
import { workoutSetDefaults } from "@/lib/workout-set-defaults";

function isLocalDatabase(value: string | undefined) {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

const hasLocalDatabase = isLocalDatabase(process.env.DATABASE_URL);
const createdUsers: string[] = [];

type Scenario = {
  id: string;
  coachId: CoachId;
  experience: "beginner" | "intermediate" | "advanced";
  daysPerWeek: number;
  template: WeekTemplateDay[];
  skipOrdinal: number;
  abandonAndRetryOrdinal: number;
  abandonAndSkipOrdinal: number;
  adjustedSetOrdinal: number;
  partialOrdinal: number;
};

const scenarios: Scenario[] = [
  {
    id: "eli-beginner",
    coachId: "eli",
    experience: "beginner",
    daysPerWeek: 2,
    skipOrdinal: 3,
    abandonAndRetryOrdinal: 5,
    abandonAndSkipOrdinal: 11,
    adjustedSetOrdinal: 2,
    partialOrdinal: 16,
    template: [
      {
        title: "Day 1 — Full Body Foundations",
        focus: "Technique and confidence",
        exercises: [
          {
            exercise_id: "goblet-squat",
            sets: 2,
            rep_range: "8–10",
            start_weight_kg: 10,
            increment_kg: 2,
            increment_every_weeks: 1,
          },
          {
            exercise_id: "bench-press",
            sets: 2,
            rep_range: "5–8",
            start_weight_kg: 20,
            increment_kg: 2.5,
            increment_every_weeks: 1,
          },
        ],
      },
      {
        title: "Day 2 — Full Body Practice",
        focus: "Repeatable basics",
        exercises: [
          {
            exercise_id: "goblet-squat",
            sets: 2,
            rep_range: "8–10",
            start_weight_kg: 10,
            increment_kg: 2,
            increment_every_weeks: 1,
          },
          {
            exercise_id: "lat-pulldown",
            sets: 2,
            rep_range: "8–10",
            start_weight_kg: 20,
            increment_kg: 2.5,
            increment_every_weeks: 1,
          },
          {
            exercise_id: "hack-squat",
            sets: 3,
            rep_range: "8–10",
            start_weight_kg: 30,
            increment_kg: 5,
            increment_every_weeks: 1,
          },
        ],
      },
    ],
  },
  {
    id: "nova-intermediate",
    coachId: "reya",
    experience: "intermediate",
    daysPerWeek: 3,
    skipOrdinal: 4,
    abandonAndRetryOrdinal: 8,
    abandonAndSkipOrdinal: 17,
    adjustedSetOrdinal: 3,
    partialOrdinal: 23,
    template: [
      {
        title: "Day 1 — Upper Strength",
        focus: "Press and pull",
        exercises: [
          {
            exercise_id: "bench-press",
            sets: 3,
            rep_range: "6–8",
            start_weight_kg: 45,
            increment_kg: 2.5,
            increment_every_weeks: 1,
          },
          {
            exercise_id: "barbell-row",
            sets: 3,
            rep_range: "6–8",
            start_weight_kg: 40,
            increment_kg: 2.5,
            increment_every_weeks: 1,
          },
        ],
      },
      {
        title: "Day 2 — Lower Strength",
        focus: "Squat pattern",
        exercises: [
          {
            exercise_id: "high-bar-back-squat",
            sets: 3,
            rep_range: "6–8",
            start_weight_kg: 50,
            increment_kg: 5,
            increment_every_weeks: 1,
          },
          {
            exercise_id: "romanian-deadlift",
            sets: 3,
            rep_range: "8–10",
            start_weight_kg: 45,
            increment_kg: 5,
            increment_every_weeks: 1,
          },
          {
            exercise_id: "hack-squat",
            sets: 3,
            rep_range: "8–10",
            start_weight_kg: 60,
            increment_kg: 5,
            increment_every_weeks: 1,
          },
        ],
      },
      {
        title: "Day 3 — Athletic Full Body",
        focus: "Quality volume",
        exercises: [
          {
            exercise_id: "bench-press",
            sets: 3,
            rep_range: "6–8",
            start_weight_kg: 45,
            increment_kg: 2.5,
            increment_every_weeks: 1,
          },
          {
            exercise_id: "lat-pulldown",
            sets: 3,
            rep_range: "8–10",
            start_weight_kg: 35,
            increment_kg: 2.5,
            increment_every_weeks: 1,
          },
        ],
      },
    ],
  },
  {
    id: "athena-advanced",
    coachId: "nova",
    experience: "advanced",
    daysPerWeek: 4,
    skipOrdinal: 6,
    abandonAndRetryOrdinal: 10,
    abandonAndSkipOrdinal: 25,
    adjustedSetOrdinal: 4,
    partialOrdinal: 32,
    template: [
      {
        title: "Day 1 — Upper Power",
        focus: "Heavy pressing",
        exercises: [
          {
            exercise_id: "bench-press",
            sets: 3,
            rep_range: "4–6",
            start_weight_kg: 80,
            increment_kg: 2.5,
            increment_every_weeks: 1,
          },
          {
            exercise_id: "weighted-pull-up",
            sets: 3,
            rep_range: "4–6",
            start_weight_kg: null,
            increment_kg: null,
            increment_every_weeks: 1,
          },
        ],
      },
      {
        title: "Day 2 — Lower Power",
        focus: "Squat strength",
        exercises: [
          {
            exercise_id: "high-bar-back-squat",
            sets: 3,
            rep_range: "4–6",
            start_weight_kg: 100,
            increment_kg: 5,
            increment_every_weeks: 1,
          },
          {
            exercise_id: "romanian-deadlift",
            sets: 3,
            rep_range: "6–8",
            start_weight_kg: 90,
            increment_kg: 5,
            increment_every_weeks: 1,
          },
        ],
      },
      {
        title: "Day 3 — Upper Volume",
        focus: "Hypertrophy",
        exercises: [
          {
            exercise_id: "bench-press",
            sets: 3,
            rep_range: "6–8",
            start_weight_kg: 75,
            increment_kg: 2.5,
            increment_every_weeks: 1,
          },
          {
            exercise_id: "barbell-row",
            sets: 3,
            rep_range: "6–8",
            start_weight_kg: 75,
            increment_kg: 2.5,
            increment_every_weeks: 1,
          },
        ],
      },
      {
        title: "Day 4 — Lower Volume",
        focus: "Posterior chain",
        exercises: [
          {
            exercise_id: "high-bar-back-squat",
            sets: 3,
            rep_range: "6–8",
            start_weight_kg: 90,
            increment_kg: 5,
            increment_every_weeks: 1,
          },
          {
            exercise_id: "machine-hip-thrust",
            sets: 3,
            rep_range: "8–10",
            start_weight_kg: 80,
            increment_kg: 5,
            increment_every_weeks: 1,
          },
          {
            exercise_id: "hack-squat",
            sets: 3,
            rep_range: "8–10",
            start_weight_kg: 100,
            increment_kg: 5,
            increment_every_weeks: 1,
          },
        ],
      },
    ],
  },
];

function cloneTemplate(template: WeekTemplateDay[]) {
  return template.map((day) => ({
    ...day,
    exercises: day.exercises.map((exercise) => ({ ...exercise })),
  }));
}

const eliScenario = scenarios.find((scenario) => scenario.coachId === "eli")!;
const novaScenario = scenarios.find((scenario) => scenario.coachId === "reya")!;
const athenaScenario = scenarios.find((scenario) => scenario.coachId === "nova")!;
scenarios.push(
  {
    ...eliScenario,
    id: "maya-beginner",
    coachId: "maya",
    skipOrdinal: 4,
    abandonAndRetryOrdinal: 7,
    abandonAndSkipOrdinal: 15,
    adjustedSetOrdinal: 3,
    partialOrdinal: 18,
    template: cloneTemplate(eliScenario.template),
  },
  {
    ...novaScenario,
    id: "ct-intermediate",
    coachId: "rex",
    skipOrdinal: 5,
    abandonAndRetryOrdinal: 9,
    abandonAndSkipOrdinal: 20,
    adjustedSetOrdinal: 4,
    partialOrdinal: 26,
    template: cloneTemplate(novaScenario.template),
  },
  {
    ...athenaScenario,
    id: "tank-advanced",
    coachId: "brutus",
    skipOrdinal: 7,
    abandonAndRetryOrdinal: 12,
    abandonAndSkipOrdinal: 29,
    adjustedSetOrdinal: 5,
    partialOrdinal: 36,
    template: cloneTemplate(athenaScenario.template),
  },
);

async function createScenarioUser(scenario: Scenario) {
  const userId = randomUUID();
  const coach = getCoach(scenario.coachId);
  createdUsers.push(userId);
  await getDb()
    .insert(users)
    .values({
      id: userId,
      email: `endurance-${scenario.id}-${userId}@example.invalid`,
      password_hash: "not-a-real-login",
    });
  await getDb()
    .insert(profiles)
    .values({
      id: userId,
      display_name: `Endurance ${scenario.id}`,
      coach_id: scenario.coachId,
      coach_gender: coach.gender,
      experience: scenario.experience,
      days_per_week: scenario.daysPerWeek,
      session_minutes: 60,
      goal: "Build strength and muscle while staying consistent.",
      equipment: "Commercial gym without a hack-squat or Smith machine.",
      injuries: "None reported.",
      height_cm: coach.gender === "male" ? 181 : 168,
      weight_kg: coach.gender === "male" ? 84 : 68,
      age: 31,
      sex: coach.gender,
      activity_level: "moderate",
      recent_training_baseline: "Several recent workouts with exact working sets supplied.",
      daily_calorie_target: coach.gender === "male" ? 2_650 : 2_150,
      daily_protein_target_g: coach.gender === "male" ? 180 : 140,
      daily_carbs_target_g: coach.gender === "male" ? 310 : 250,
      daily_fat_target_g: coach.gender === "male" ? 75 : 65,
      preferred_language: "en",
      timezone: "Europe/Stockholm",
      onboarding_completed: true,
      data_epoch: 0,
    });
  await generateProgram(userId, {
    name: `${scenario.id} Twelve Week Cycle`,
    goal: scenario.experience === "beginner" ? "general fitness" : "strength and muscle",
    experience: scenario.experience,
    start_date: "2044-01-04",
    weeks: 12,
    session_minutes: 60,
    schedule_mode: "rolling",
    weekday_indices: [],
    deload_weeks: [5, 10],
    progression_rules: "Use actual performance and two comparable exposures before progressing.",
    why: "Accelerated local endurance coverage.",
    week_template: scenario.template,
  });
  const smith = await adjustProgramExercise(userId, {
    exercise: "hack-squat",
    from_week: 1,
    replacement_exercise: "smith-machine-squat",
    notes: "Hack squat unavailable; first proposed replacement.",
    source_key: `endurance-substitute-smith:${scenario.id}`,
    expected_data_epoch: 0,
  });
  if (!smith.ok) throw new Error(`smith_substitution_failed:${smith.error}`);
  const legPress = await adjustProgramExercise(userId, {
    exercise: "smith-machine-squat",
    from_week: 1,
    replacement_exercise: "leg-press",
    notes: "Smith machine also unavailable; user chose leg press.",
    source_key: `endurance-substitute-leg-press:${scenario.id}`,
    expected_data_epoch: 0,
  });
  if (!legPress.ok) throw new Error(`leg_press_substitution_failed:${legPress.error}`);
  return userId;
}

async function completeWithSets(
  userId: string,
  date: string,
  programDayId: string,
  ordinal: number,
  adjustedSetOrdinal: number,
  partialOrdinal: number,
) {
  const started = await startSession(userId, {
    date,
    program_day_id: programDayId,
    source_key: `endurance-start:${programDayId}:${ordinal}`,
    expected_data_epoch: 0,
  });
  if (!started.ok || !started.session) throw new Error(`start_failed:${JSON.stringify(started)}`);

  let active = started.session;
  let setOrdinal = 0;
  let defaultSets = 0;
  let adjustedSets = 0;
  let progressionSets = 0;
  const omittedSetId =
    ordinal === partialOrdinal
      ? active.exercises.find((exercise) => exercise.exercise_id === "leg-press")?.sets.at(-1)?.id
      : null;
  if (ordinal === partialOrdinal && !omittedSetId) {
    throw new Error(
      `partial_target_missing:${active.exercises
        .map((exercise) => `${exercise.exercise_id}:${exercise.sets.length}`)
        .join(",")}`,
    );
  }
  for (const set of active.exercises.flatMap((exercise) => exercise.sets)) {
    if (set.id === omittedSetId) continue;
    setOrdinal += 1;
    const defaults = workoutSetDefaults(set);
    const adjusted = ordinal === adjustedSetOrdinal && setOrdinal === 1;
    const progressionAttempt = ordinal <= 4;
    const repTargets = set.target_reps?.match(/\d+/g)?.map(Number) ?? [];
    const topTarget = repTargets.at(-1) ?? Number(defaults.reps);
    const weight =
      defaults.weight === ""
        ? null
        : Number(defaults.weight) + (adjusted && set.target_weight_kg != null ? 2.5 : 0);
    const reps = (progressionAttempt ? topTarget : Number(defaults.reps)) + (adjusted ? 1 : 0);
    const result = await markSetDone(userId, set.id, {
      completed: true,
      weight_kg: weight,
      reps,
      expected_revision: set.revision,
      expected_data_epoch: 0,
    });
    if (!result.ok || !result.session) {
      throw new Error(`set_failed:${result.error ?? "unknown"}`);
    }
    active = result.session;
    if (adjusted) adjustedSets += 1;
    else if (progressionAttempt) progressionSets += 1;
    else defaultSets += 1;
  }

  const completed = await completeSession(userId, {
    session_id: active.id,
    planned_minutes: 60,
    override_reason:
      "Accelerated local endurance test represents a real 60-minute workout completed offline.",
    partial_reason:
      omittedSetId == null
        ? null
        : "The final leg-press set felt technically poor, so the user stopped instead of forcing it.",
    expected_data_epoch: 0,
  });
  if (!completed.ok) throw new Error(`complete_failed:${completed.error}`);
  return {
    sessionId: active.id,
    defaultSets,
    adjustedSets,
    progressionSets,
    partial: completed.partial,
  };
}

async function reviewAndResolveProposal(userId: string, sessionId: string, ordinal: number) {
  const poorRecovery = ordinal === 7 || ordinal === 8;
  const result = await submitWorkoutReview(userId, {
    session_id: sessionId,
    difficulty: poorRecovery ? 4 : 2,
    energy: poorRecovery ? 2 : 4,
    discomfort: 1,
    note: poorRecovery ? "Unexpected overtime at work and poor sleep." : null,
    expected_data_epoch: 0,
  });
  if (!result.ok || !result.proposal) return;
  const preferred =
    result.proposal.options.find((option) => option.id === "deload") ??
    result.proposal.options.find((option) => option.id === "progress") ??
    result.proposal.options[0];
  const decision = await decideAdaptation(userId, {
    proposal_id: result.proposal.id,
    option_id: preferred?.id ?? "keep",
    expected_program_revision: result.proposal.program_revision,
    expected_data_epoch: 0,
  });
  if (!decision.ok) throw new Error(`adaptation_failed:${decision.error}`);
}

async function logTwelveWeeksOfTracking(userId: string, scenario: Scenario) {
  const coach = getCoach(scenario.coachId);
  const startDate = "2044-01-04";
  for (let day = 0; day < 84; day++) {
    const date = addLocalDays(startDate, day);
    await logMeal(userId, {
      description: "Breakfast, lunch and dinner from a normal training day",
      calories: null,
      protein_g: null,
      carbs_g: null,
      fat_g: null,
      logged_date: date,
      timezone: "Europe/Stockholm",
      source_key: `endurance-meals:${scenario.id}:${date}`,
      ingredients: [
        {
          name: "Oats, yogurt and berries",
          amount: "one breakfast bowl",
          calories: 650,
          protein_g: 35,
          carbs_g: 90,
          fat_g: 18,
          nutrients: {
            fiber_g: 14,
            magnesium_mg: 150,
            potassium_mg: 700,
            calcium_mg: 350,
            iron_mg: 5,
            vitamin_c_mg: 30,
            vitamin_b12_mcg: 1.5,
          },
          estimate_confidence: "medium",
        },
        {
          name: "Chicken, rice and mixed vegetables",
          amount: "one large lunch plate",
          calories: 850,
          protein_g: 65,
          carbs_g: 95,
          fat_g: 20,
          nutrients: {
            fiber_g: 10,
            magnesium_mg: 130,
            potassium_mg: 1_100,
            calcium_mg: 120,
            iron_mg: 5,
            vitamin_c_mg: 65,
            vitamin_b12_mcg: 0.6,
          },
          estimate_confidence: "medium",
        },
        {
          name: "Salmon, potatoes and salad",
          amount: "one dinner plate",
          calories: 800,
          protein_g: 55,
          carbs_g: 70,
          fat_g: 30,
          nutrients: {
            fiber_g: 10,
            magnesium_mg: 140,
            potassium_mg: 1_400,
            calcium_mg: 130,
            iron_mg: 3,
            vitamin_c_mg: 55,
            vitamin_b12_mcg: 5,
          },
          estimate_confidence: "medium",
        },
      ],
    });
  }

  const startingWeight = coach.gender === "male" ? 84 : 68;
  for (let week = 0; week < 12; week++) {
    const date = addLocalDays(startDate, week * 7);
    const weight = Math.round((startingWeight + week * 0.12) * 10) / 10;
    await getDb()
      .insert(weightLogs)
      .values({
        user_id: userId,
        weight_kg: weight,
        logged_date: date,
        timezone: "Europe/Stockholm",
        source_key: `endurance-weight:${scenario.id}:${week + 1}`,
      });
    await logMeasurement(userId, {
      metric_key: "waist_cm",
      label: "Waist",
      value: Math.round((coach.gender === "male" ? 84 - week * 0.08 : 72 - week * 0.05) * 10) / 10,
      unit: "cm",
      recorded_date: date,
      timezone: "Europe/Stockholm",
      notes: "Weekly morning measurement.",
      source_key: `endurance-waist:${scenario.id}:${week + 1}`,
    });
  }
  await getDb()
    .update(profiles)
    .set({ weight_kg: Math.round((startingWeight + 11 * 0.12) * 10) / 10 })
    .where(eq(profiles.id, userId));
  return addLocalDays(startDate, 83);
}

async function runTwelveWeekScenario(scenario: Scenario) {
  const userId = await createScenarioUser(scenario);
  const finalTrackingDate = await logTwelveWeeksOfTracking(userId, scenario);
  let ordinal = 0;
  let completedCount = 0;
  let skippedCount = 0;
  let defaultSetCount = 0;
  let adjustedSetCount = 0;
  let progressionSetCount = 0;
  let partialCount = 0;

  while (true) {
    const program = await getCurrentProgram(userId, "2044-12-31");
    if (!program) throw new Error("program_disappeared");
    const next = program.days.find((day) => day.status === "planned");
    if (!next) break;
    ordinal += 1;

    if (ordinal === scenario.skipOrdinal) {
      const skipped = await resolveProgramDay(userId, {
        date: next.date,
        status: "skipped",
        reason: "Family emergency; user asked to move on to the next workout.",
        source_key: `endurance-skip:${next.id}`,
        expected_data_epoch: 0,
      });
      expect(skipped).toMatchObject({ ok: true, status: "skipped" });
      skippedCount += 1;
      continue;
    }

    if (ordinal === scenario.abandonAndRetryOrdinal) {
      const firstStart = await startSession(userId, {
        date: next.date,
        program_day_id: next.id,
        source_key: `endurance-abandon-retry:${next.id}`,
        expected_data_epoch: 0,
      });
      if (!firstStart.ok || !firstStart.session) throw new Error("retry_start_failed");
      const abandoned = await abandonSession(userId, {
        session_id: firstStart.session.id,
        reason: "Gym closed unexpectedly; user wants to retry this program day.",
        program_day_outcome: "planned",
        expected_data_epoch: 0,
      });
      expect(abandoned).toMatchObject({ ok: true, program_day_outcome: "planned" });
      expect(
        (await getCurrentProgram(userId, next.date))?.days.find((day) => day.id === next.id),
      ).toMatchObject({ status: "planned" });
    }

    if (ordinal === scenario.abandonAndSkipOrdinal) {
      const firstStart = await startSession(userId, {
        date: next.date,
        program_day_id: next.id,
        source_key: `endurance-abandon-skip:${next.id}`,
        expected_data_epoch: 0,
      });
      if (!firstStart.ok || !firstStart.session) throw new Error("skip_start_failed");
      const abandoned = await abandonSession(userId, {
        session_id: firstStart.session.id,
        reason: "No reason provided by user.",
        program_day_outcome: "skipped",
        expected_data_epoch: 0,
      });
      expect(abandoned).toMatchObject({ ok: true, program_day_outcome: "skipped" });
      skippedCount += 1;
      continue;
    }

    const completed = await completeWithSets(
      userId,
      next.date,
      next.id,
      ordinal,
      scenario.adjustedSetOrdinal,
      scenario.partialOrdinal,
    );
    defaultSetCount += completed.defaultSets;
    adjustedSetCount += completed.adjustedSets;
    progressionSetCount += completed.progressionSets;
    if (completed.partial) partialCount += 1;
    completedCount += 1;
    await reviewAndResolveProposal(userId, completed.sessionId, completedCount);
  }

  const finalProgram = await getCurrentProgram(userId, "2044-12-31");
  if (!finalProgram) throw new Error("final_program_missing");
  const history = await getWorkoutHistory(userId, { programId: finalProgram.id, limit: 400 });
  const adaptationHistory = await getAdaptationHistory(userId, {
    programId: finalProgram.id,
    limit: 50,
  });
  const recent = await getRecentSessions(userId, 3650, "2044-12-31");
  const nutrition = await getNutrition(userId, finalTrackingDate, "Europe/Stockholm");
  const measurements = await getMeasurements(userId, { metricKey: "waist_cm", limit: 100 });
  const dashboard = await getDashboardData(userId, 120, finalTrackingDate, "Europe/Stockholm");
  return {
    userId,
    finalProgram,
    history,
    adaptationHistory,
    completedCount,
    skippedCount,
    defaultSetCount,
    adjustedSetCount,
    progressionSetCount,
    partialCount,
    programSummary: summarizeProgram(finalProgram, "2044-12-31"),
    workoutSummary: summarizeWorkoutHistory(history),
    recentSummary: summarizeRecentSessions(recent),
    nutrition,
    measurements,
    dashboard,
  };
}

afterEach(async () => {
  while (createdUsers.length) {
    const userId = createdUsers.pop();
    if (userId) await getDb().delete(users).where(eq(users.id, userId));
  }
});

describe.runIf(hasLocalDatabase).sequential("six-persona twelve-week coach endurance", () => {
  for (const scenario of scenarios) {
    it(`finishes ${scenario.id} across twelve accelerated weeks without losing state`, async () => {
      const result = await runTwelveWeekScenario(scenario);
      expect(result.finalProgram).toMatchObject({
        weeks: 12,
        days_per_week: scenario.daysPerWeek,
        status: "completed",
      });
      expect(result.finalProgram.days).toHaveLength(12 * scenario.daysPerWeek);
      expect(result.finalProgram.days.every((day) => day.status !== "planned")).toBe(true);
      expect(result.completedCount + result.skippedCount).toBe(12 * scenario.daysPerWeek);
      expect(result.defaultSetCount).toBeGreaterThan(0);
      expect(result.adjustedSetCount).toBe(1);
      expect(result.progressionSetCount).toBeGreaterThan(0);
      expect(result.partialCount).toBe(1);
      expect(await getActiveSession(result.userId)).toBeNull();
      expect(result.adaptationHistory.some((item) => item.selected_option_id === "progress")).toBe(
        true,
      );
      expect(result.adaptationHistory.some((item) => item.selected_option_id === "deload")).toBe(
        true,
      );

      const completedHistory = result.history.filter((session) => session.status === "completed");
      const abandonedHistory = result.history.filter((session) => session.status === "abandoned");
      expect(completedHistory).toHaveLength(result.completedCount);
      expect(abandonedHistory).toHaveLength(2);
      const fullSessions = completedHistory.filter(
        (session) => !session.end_reason?.startsWith("completed_partial:"),
      );
      const partialSessions = completedHistory.filter((session) =>
        session.end_reason?.startsWith("completed_partial:"),
      );
      expect(fullSessions).toHaveLength(result.completedCount - result.partialCount);
      expect(partialSessions).toHaveLength(result.partialCount);
      expect(
        fullSessions.every((session) =>
          session.exercises.every(
            (exercise) =>
              exercise.completed &&
              exercise.sets.length > 0 &&
              exercise.sets.every((set) => set.completed && set.reps != null),
          ),
        ),
      ).toBe(true);
      expect(
        partialSessions.every(
          (session) =>
            session.exercises.some((exercise) =>
              exercise.sets.some((set) => !set.completed && set.reps == null),
            ) &&
            session.exercises.some((exercise) =>
              exercise.sets.some((set) => set.completed && set.reps != null),
            ),
        ),
      ).toBe(true);

      expect(result.programSummary).toContain("Family emergency");
      expect(result.programSummary).toContain("No reason provided by user.");
      expect(result.workoutSummary).toContain("Gym closed unexpectedly");
      expect(result.recentSummary).toContain("No reason provided by user.");
      expect(
        result.finalProgram.days
          .flatMap((day) => day.exercises)
          .every((exercise) => {
            return (
              exercise.exercise_id == null ||
              !["hack-squat", "smith-machine-squat"].includes(exercise.exercise_id)
            );
          }),
      ).toBe(true);
      expect(
        result.finalProgram.days
          .flatMap((day) => day.exercises)
          .some((exercise) => exercise.exercise_id === "leg-press"),
      ).toBe(true);
      expect(result.nutrition.trend_summary.logged_days).toBe(14);
      expect(result.nutrition.trend_summary.complete_macro_days).toBe(14);
      expect(result.nutrition.trend_summary.average_calories).toBe(2_300);
      expect(result.nutrition.trend_summary.average_protein_g).toBe(155);
      expect(result.measurements).toHaveLength(12);
      expect(result.dashboard.bodyweight).toHaveLength(12);
      expect(result.dashboard.calories).toHaveLength(84);
      expect(result.dashboard.customMeasurements[0]?.points).toHaveLength(12);
      expect(result.dashboard.stats.incomplete_completed_sessions).toBe(1);
      expect(result.dashboard.strengthByLift.length).toBeGreaterThan(1);
      expect(result.dashboard.weeklyVolume.length).toBeGreaterThanOrEqual(11);
    }, 90_000);
  }
});
