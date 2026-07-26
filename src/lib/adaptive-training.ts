import type { CoachId } from "@/lib/coaches";

export type WorkoutReviewAnswers = {
  difficulty: number;
  energy: number;
  discomfort: number;
  note?: string | null;
};

export type AdaptiveSet = {
  target_reps: string | null;
  target_weight_kg: number | null;
  weight_kg: number | null;
  reps: number | null;
  completed: boolean;
};

export type ExerciseExposure = {
  exercise_id: string;
  name: string;
  planned_sets: number;
  target_weight_kg: number | null;
  progression_step_kg: number | null;
  sets: AdaptiveSet[];
};

export type ExerciseAdjustmentAction = {
  type: "exercise_adjustment";
  exercise_id: string;
  from_date: string;
  delta_kg?: number;
  sets_delta?: -1 | 1;
  rep_range?: string;
  replacement_exercise_id?: string;
};

export type ScheduleShiftAction = {
  type: "schedule_shift";
  from_date: string;
  days: 1;
};

export type DeloadWeekAction = {
  type: "deload_week";
  week: number;
  load_factor: 0.9;
  set_reduction: 1;
};

export type AdaptationAction = ExerciseAdjustmentAction | ScheduleShiftAction | DeloadWeekAction;

export type AdaptationOption = {
  id: string;
  title_en: string;
  title_sv: string;
  summary_en: string;
  summary_sv: string;
  actions: AdaptationAction[];
};

export type AdaptationRecommendation = {
  rationale_en: string;
  rationale_sv: string;
  requires_follow_up: boolean;
  options: AdaptationOption[];
};

export type AdaptationAnalysisInput = {
  coach_id: CoachId;
  review: WorkoutReviewAnswers;
  current: ExerciseExposure[];
  previous_by_exercise: Record<string, ExerciseExposure[]>;
  previous_reviews: WorkoutReviewAnswers[];
  next_planned_date: string | null;
  next_planned_week: number | null;
};

type RepRange = { low: number; high: number };

export function parseRepRange(value: string | null | undefined): RepRange | null {
  if (!value) return null;
  const values = value.match(/\d+/g)?.map(Number) ?? [];
  if (!values.length || values.some((item) => !Number.isFinite(item) || item < 1)) return null;
  if (values.length === 1) return { low: values[0]!, high: values[0]! };
  return {
    low: Math.min(values[0]!, values[1]!),
    high: Math.max(values[0]!, values[1]!),
  };
}

function shiftedRepRange(value: string | null | undefined, delta: number): string | null {
  const range = parseRepRange(value);
  if (!range) return null;
  const low = Math.max(1, range.low + delta);
  const high = Math.max(low, range.high + delta);
  return low === high ? String(low) : `${low}–${high}`;
}

function exposureResult(exposure: ExerciseExposure) {
  const completed = exposure.sets.filter((set) => set.completed && set.reps != null);
  const expected = exposure.sets.slice(0, exposure.planned_sets);
  if (!expected.length || completed.length < expected.length) {
    return { success: false, failure: true };
  }
  let success = true;
  let failure = false;
  for (const set of expected) {
    const range = parseRepRange(set.target_reps);
    if (!set.completed || set.reps == null) {
      success = false;
      failure = true;
      continue;
    }
    if (range && set.reps < range.low) failure = true;
    if (!range || set.reps < range.high) success = false;
    if (
      set.target_weight_kg != null &&
      (set.weight_kg == null || set.weight_kg < set.target_weight_kg)
    ) {
      success = false;
    }
  }
  return { success, failure };
}

/** 0 = gentle, 1 = balanced, 2 = demanding. Safety gates are shared. */
export function coachAdaptationIntensity(coachId: CoachId) {
  if (coachId === "eli" || coachId === "maya") return 0;
  if (coachId === "brutus" || coachId === "nova") return 2;
  return 1;
}

function recoverySignal(review: WorkoutReviewAnswers) {
  return review.energy <= 2 || review.difficulty >= 4;
}

function progressionOption(input: AdaptationAnalysisInput): AdaptationOption | null {
  if (input.review.discomfort > 1 || input.review.difficulty > 3 || input.review.energy < 3) {
    return null;
  }
  const intensity = coachAdaptationIntensity(input.coach_id);
  const maxActions = intensity === 0 ? 1 : intensity === 1 ? 3 : 6;
  const actions: ExerciseAdjustmentAction[] = [];
  const labels: string[] = [];

  for (const exposure of input.current) {
    const currentResult = exposureResult(exposure);
    const previous = input.previous_by_exercise[exposure.exercise_id]?.[0];
    if (!currentResult.success || !previous || !exposureResult(previous).success) continue;

    const step = exposure.progression_step_kg;
    if (exposure.target_weight_kg != null && step != null && step > 0) {
      actions.push({
        type: "exercise_adjustment",
        exercise_id: exposure.exercise_id,
        from_date: input.next_planned_date ?? "",
        delta_kg: step,
      });
      labels.push(exposure.name);
    } else {
      const repRange = shiftedRepRange(exposure.sets[0]?.target_reps, 1);
      if (repRange) {
        actions.push({
          type: "exercise_adjustment",
          exercise_id: exposure.exercise_id,
          from_date: input.next_planned_date ?? "",
          rep_range: repRange,
        });
        labels.push(exposure.name);
      }
    }
    if (actions.length >= maxActions) break;
  }

  if (!input.next_planned_date || !actions.length) return null;
  const names = labels.join(", ");
  return {
    id: "progress",
    title_en: intensity === 0 ? "Small step forward" : "Progress the next sessions",
    title_sv: intensity === 0 ? "Ett litet steg framåt" : "Öka i nästa pass",
    summary_en: `Advance the planned progression for ${names}.`,
    summary_sv: `Flytta fram den planerade progressionen för ${names}.`,
    actions,
  };
}

function reductionOption(input: AdaptationAnalysisInput): AdaptationOption | null {
  if (input.review.discomfort >= 4) return null;
  const actions: ExerciseAdjustmentAction[] = [];
  const labels: string[] = [];
  for (const exposure of input.current) {
    const currentResult = exposureResult(exposure);
    const previous = input.previous_by_exercise[exposure.exercise_id]?.[0];
    if (!currentResult.failure || !previous || !exposureResult(previous).failure) continue;
    const step = exposure.progression_step_kg;
    if (exposure.target_weight_kg != null && step != null && step > 0) {
      actions.push({
        type: "exercise_adjustment",
        exercise_id: exposure.exercise_id,
        from_date: input.next_planned_date ?? "",
        delta_kg: -step,
      });
    } else if (exposure.planned_sets > 1) {
      actions.push({
        type: "exercise_adjustment",
        exercise_id: exposure.exercise_id,
        from_date: input.next_planned_date ?? "",
        sets_delta: -1,
      });
    } else {
      continue;
    }
    labels.push(exposure.name);
  }
  if (!input.next_planned_date || !actions.length) return null;
  const names = labels.join(", ");
  return {
    id: "reduce",
    title_en: "Reduce and rebuild",
    title_sv: "Sänk och bygg upp igen",
    summary_en: `Take one planned step back on ${names}, then rebuild with clean reps.`,
    summary_sv: `Ta ett planerat steg tillbaka i ${names} och bygg upp igen med rena repetitioner.`,
    actions,
  };
}

function restOption(input: AdaptationAnalysisInput): AdaptationOption | null {
  if (!input.next_planned_date) return null;
  if (input.review.discomfort < 3 && input.review.energy > 2 && input.review.difficulty < 5) {
    return null;
  }
  return {
    id: "rest-day",
    title_en: "Add one recovery day",
    title_sv: "Lägg till en återhämtningsdag",
    summary_en: "Move every unresolved workout one day later without changing completed history.",
    summary_sv: "Flytta alla återstående pass en dag framåt utan att ändra slutförd historik.",
    actions: [
      {
        type: "schedule_shift",
        from_date: input.next_planned_date,
        days: 1,
      },
    ],
  };
}

function deloadOption(input: AdaptationAnalysisInput): AdaptationOption | null {
  if (!input.next_planned_week || input.review.discomfort >= 4) return null;
  if (!recoverySignal(input.review) || !input.previous_reviews.some(recoverySignal)) return null;
  return {
    id: "deload",
    title_en: "Run a recovery week",
    title_sv: "Kör en återhämtningsvecka",
    summary_en: "Reduce unresolved work in the next week by one set and 10% load.",
    summary_sv: "Minska återstående arbete nästa vecka med ett set och 10 % belastning.",
    actions: [
      {
        type: "deload_week",
        week: input.next_planned_week,
        load_factor: 0.9,
        set_reduction: 1,
      },
    ],
  };
}

export function analyzeWorkoutAdaptation(
  input: AdaptationAnalysisInput,
): AdaptationRecommendation | null {
  if (input.review.discomfort >= 3) {
    const rest = restOption(input);
    return {
      rationale_en:
        input.review.discomfort >= 4
          ? "Pain takes priority over progression. Identify the movement and what the pain felt like before changing an exercise."
          : "The discomfort needs clarification before changing load or exercise. Identify the movement, location, and sensation first.",
      rationale_sv:
        input.review.discomfort >= 4
          ? "Smärta går före progression. Identifiera övningen och hur smärtan kändes innan en övning ändras."
          : "Obehaget behöver förtydligas innan belastning eller övning ändras. Identifiera först rörelsen, platsen och känslan.",
      requires_follow_up: true,
      options: rest ? [rest] : [],
    };
  }

  const options = [
    reductionOption(input),
    deloadOption(input),
    restOption(input),
    progressionOption(input),
  ].filter((option): option is AdaptationOption => Boolean(option));
  const unique = options.filter(
    (option, index) => options.findIndex((candidate) => candidate.id === option.id) === index,
  );
  if (!unique.length) return null;

  const selected = unique.slice(0, 2);
  if (selected.some((option) => option.id === "progress")) {
    return {
      rationale_en:
        "You have two comparable successful exposures and the recovery check is positive. A controlled progression is available.",
      rationale_sv:
        "Du har två jämförbara lyckade pass och återhämtningskontrollen är positiv. En kontrollerad progression är möjlig.",
      requires_follow_up: false,
      options: selected,
    };
  }
  return {
    rationale_en:
      "Recent performance and recovery suggest that forcing the current progression may cost more than it gives.",
    rationale_sv:
      "Den senaste prestationen och återhämtningen tyder på att fortsatt progression kan kosta mer än den ger.",
    requires_follow_up: false,
    options: selected,
  };
}
