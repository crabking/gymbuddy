export type ProgramDayStatus = "planned" | "completed" | "skipped";
export type ProgramScheduleMode = "rolling" | "weekday";

const WEEK_OFFSETS: Record<number, readonly number[]> = {
  1: [0],
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 4, 5],
  6: [0, 1, 2, 3, 4, 5],
  7: [0, 1, 2, 3, 4, 5, 6],
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(date: string): Date {
  if (!ISO_DATE.test(date)) throw new Error(`Invalid ISO date: ${date}`);
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid ISO date: ${date}`);
  }
  return parsed;
}

export function addIsoDays(date: string, days: number): string {
  const parsed = parseIsoDate(date);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function trainingDayOffsets(daysPerWeek: number): readonly number[] {
  if (!Number.isInteger(daysPerWeek) || daysPerWeek < 1 || daysPerWeek > 7) {
    throw new Error("daysPerWeek must be an integer from 1 to 7");
  }
  return WEEK_OFFSETS[daysPerWeek];
}

export function calculateProgramDates(startDate: string, weeks: number, daysPerWeek: number) {
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 104) {
    throw new Error("weeks must be an integer from 1 to 104");
  }
  const offsets = trainingDayOffsets(daysPerWeek);
  const dates: string[] = [];
  for (let week = 1; week <= weeks; week++) {
    for (const offset of offsets) dates.push(addIsoDays(startDate, 7 * (week - 1) + offset));
  }
  return dates;
}

export function isoWeekdayIndex(date: string): number {
  return parseIsoDate(date).getUTCDay();
}

export function calculateProgramDatesForSchedule(input: {
  startDate: string;
  weeks: number;
  daysPerWeek: number;
  mode: ProgramScheduleMode;
  weekdayIndices?: number[];
}) {
  if (input.mode === "rolling") {
    return calculateProgramDates(input.startDate, input.weeks, input.daysPerWeek);
  }
  if (!Number.isInteger(input.weeks) || input.weeks < 1 || input.weeks > 104) {
    throw new Error("weeks must be an integer from 1 to 104");
  }
  if (!Number.isInteger(input.daysPerWeek) || input.daysPerWeek < 1 || input.daysPerWeek > 7) {
    throw new Error("daysPerWeek must be an integer from 1 to 7");
  }
  const weekdays = [...new Set(input.weekdayIndices ?? [])];
  if (
    weekdays.length !== input.daysPerWeek ||
    weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
  ) {
    throw new Error("weekday schedule must contain one unique weekday per session");
  }

  const total = input.weeks * input.daysPerWeek;
  const dates: string[] = [];
  let cursor = input.startDate;
  while (dates.length < total) {
    if (weekdays.includes(isoWeekdayIndex(cursor))) dates.push(cursor);
    cursor = addIsoDays(cursor, 1);
  }
  return dates;
}

export function isoDayDifference(fromDate: string, toDate: string): number {
  const from = parseIsoDate(fromDate).getTime();
  const to = parseIsoDate(toDate).getTime();
  return Math.round((to - from) / 86_400_000);
}

export function shiftWeekdayIndices(weekdayIndices: number[], days: number): number[] {
  return weekdayIndices.map((weekday) => (((weekday + days) % 7) + 7) % 7);
}

export type BeginnerCalibrationPrescription = {
  startWeightKg: number | null;
  incrementKg: number;
  note: string;
};

export function beginnerCalibrationPrescription(input: {
  sex: "male" | "female" | "other";
  equipment: "barbell" | "dumbbell" | "machine" | "cable" | "bodyweight" | "mixed";
}): BeginnerCalibrationPrescription {
  if (input.equipment === "bodyweight") {
    return {
      startWeightKg: null,
      incrementKg: 0,
      note: "Calibration first: use bodyweight only. Report the first set's reps and difficulty so the coach can adjust every remaining session immediately.",
    };
  }
  if (input.equipment === "barbell" && input.sex === "male") {
    return {
      startWeightKg: 20,
      incrementKg: 0,
      note: "Calibration first: start with the empty 20 kg bar. Stop if technique breaks down or it feels too heavy, then report the first set so the coach can lower the load or swap the exercise across the remaining program.",
    };
  }
  if (input.equipment === "barbell") {
    return {
      startWeightKg: null,
      incrementKg: 0,
      note: "Calibration first: use bodyweight, a light technique bar, or the lightest suitable alternative—not a standard 20 kg bar by default. Report the first set so the coach can set or swap this exercise across the remaining program.",
    };
  }
  return {
    startWeightKg: null,
    incrementKg: 0,
    note: "Calibration first: choose the lightest available setting or implement. Report the first set's reps and difficulty so the coach can set the load or swap the exercise across the remaining program immediately.",
  };
}

export function calculateTargetWeight(input: {
  startWeightKg: number | null;
  incrementKg: number;
  incrementEveryWeeks: number;
  completedTrainingWeeks: number;
  isDeload: boolean;
}): number | null {
  if (input.startWeightKg == null) return null;
  const every = Math.max(1, Math.trunc(input.incrementEveryWeeks));
  const steps = Math.floor(Math.max(0, input.completedTrainingWeeks) / every);
  const progressed = input.startWeightKg + steps * input.incrementKg;
  const adjusted = input.isDeload ? progressed * 0.9 : progressed;
  return Math.max(0, Math.round(adjusted / 2.5) * 2.5);
}

export function assessProgramLifecycle(input: {
  statuses: ProgramDayStatus[];
  today: string;
  endDate: string;
}) {
  parseIsoDate(input.today);
  parseIsoDate(input.endDate);
  const completed = input.statuses.filter((status) => status === "completed").length;
  const skipped = input.statuses.filter((status) => status === "skipped").length;
  const planned = input.statuses.filter((status) => status === "planned").length;
  const total = input.statuses.length;
  const resolved = completed + skipped;
  const calendarEnded = input.today > input.endDate;

  return {
    completed,
    skipped,
    planned,
    resolved,
    total,
    calendarEnded,
    state:
      total > 0 && planned === 0
        ? ("completed" as const)
        : calendarEnded
          ? ("needs_review" as const)
          : ("active" as const),
  };
}

export function getSessionCompletionIssues(
  exercises: Array<{
    name: string;
    completed: boolean;
    sets: Array<{ completed: boolean; reps?: number | null }>;
  }>,
): string[] {
  if (!exercises.length) return ["The workout has no exercises."];
  const issues: string[] = [];
  for (const exercise of exercises) {
    if (!exercise.completed) issues.push(`${exercise.name} is not complete.`);
    if (exercise.sets.length && exercise.sets.some((set) => !set.completed)) {
      issues.push(`${exercise.name} still has unfinished sets.`);
    }
    if (
      exercise.sets.some(
        (set) => set.completed && (set.reps == null || !Number.isInteger(set.reps) || set.reps < 1),
      )
    ) {
      issues.push(`${exercise.name} has completed sets without actual reps.`);
    }
  }
  return issues;
}
