import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/db.server";
import { profiles, users } from "@/db/schema";
import {
  decideAdaptation,
  getAdaptationHistory,
  submitWorkoutReview,
} from "@/lib/adaptive-training.server";
import type { CoachId } from "@/lib/coaches";
import {
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
        ],
      },
    ],
  },
];

async function createScenarioUser(scenario: Scenario) {
  const userId = randomUUID();
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
      coach_gender: scenario.coachId === "eli" ? "male" : "female",
      experience: scenario.experience,
      days_per_week: scenario.daysPerWeek,
      session_minutes: 60,
      preferred_language: "en",
      timezone: "Europe/Stockholm",
      onboarding_completed: true,
      data_epoch: 0,
    });
  await generateProgram(userId, {
    name: `${scenario.id} Eight Week Cycle`,
    goal: scenario.experience === "beginner" ? "general fitness" : "strength and muscle",
    experience: scenario.experience,
    start_date: "2044-01-04",
    weeks: 8,
    session_minutes: 60,
    schedule_mode: "rolling",
    weekday_indices: [],
    deload_weeks: [5],
    progression_rules: "Use actual performance and two comparable exposures before progressing.",
    why: "Accelerated local endurance coverage.",
    week_template: scenario.template,
  });
  return userId;
}

async function completeWithSets(
  userId: string,
  date: string,
  programDayId: string,
  ordinal: number,
  adjustedSetOrdinal: number,
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
  for (const set of active.exercises.flatMap((exercise) => exercise.sets)) {
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
    expected_data_epoch: 0,
  });
  if (!completed.ok) throw new Error(`complete_failed:${completed.error}`);
  return { sessionId: active.id, defaultSets, adjustedSets, progressionSets };
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

async function runEightWeekScenario(scenario: Scenario) {
  const userId = await createScenarioUser(scenario);
  let ordinal = 0;
  let completedCount = 0;
  let skippedCount = 0;
  let defaultSetCount = 0;
  let adjustedSetCount = 0;
  let progressionSetCount = 0;

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
    );
    defaultSetCount += completed.defaultSets;
    adjustedSetCount += completed.adjustedSets;
    progressionSetCount += completed.progressionSets;
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
    programSummary: summarizeProgram(finalProgram, "2044-12-31"),
    workoutSummary: summarizeWorkoutHistory(history),
    recentSummary: summarizeRecentSessions(recent),
  };
}

afterEach(async () => {
  while (createdUsers.length) {
    const userId = createdUsers.pop();
    if (userId) await getDb().delete(users).where(eq(users.id, userId));
  }
});

describe.runIf(hasLocalDatabase).sequential("three-persona eight-week coach endurance", () => {
  for (const scenario of scenarios) {
    it(`finishes ${scenario.id} across eight accelerated weeks without losing state`, async () => {
      const result = await runEightWeekScenario(scenario);
      expect(result.finalProgram).toMatchObject({
        weeks: 8,
        days_per_week: scenario.daysPerWeek,
        status: "completed",
      });
      expect(result.finalProgram.days).toHaveLength(8 * scenario.daysPerWeek);
      expect(result.finalProgram.days.every((day) => day.status !== "planned")).toBe(true);
      expect(result.completedCount + result.skippedCount).toBe(8 * scenario.daysPerWeek);
      expect(result.defaultSetCount).toBeGreaterThan(0);
      expect(result.adjustedSetCount).toBe(1);
      expect(result.progressionSetCount).toBeGreaterThan(0);
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
      expect(
        completedHistory.every((session) =>
          session.exercises.every(
            (exercise) =>
              exercise.completed &&
              exercise.sets.length > 0 &&
              exercise.sets.every((set) => set.completed && set.reps != null),
          ),
        ),
      ).toBe(true);

      expect(result.programSummary).toContain("Family emergency");
      expect(result.programSummary).toContain("No reason provided by user.");
      expect(result.workoutSummary).toContain("Gym closed unexpectedly");
      expect(result.recentSummary).toContain("No reason provided by user.");
    }, 45_000);
  }
});
