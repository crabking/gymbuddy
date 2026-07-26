export type AttendanceDay = {
  week: number;
  status: string;
};

export type AttendanceWeekSummary = {
  week: number;
  total: number;
  completed: number;
  skipped: number;
  planned: number;
};

export type AttendancePattern = {
  totalSessions: number;
  totalCompleted: number;
  totalSkipped: number;
  totalPlanned: number;
  latestStartedWeek: number | null;
  latestStartedWeekSummary: AttendanceWeekSummary | null;
  recentWeeks: number[];
  recentWeekSummaries: AttendanceWeekSummary[];
  skipsInRecentWeeks: number;
  skippedRecentWeeks: number[];
  repeatedWeeklySkips: boolean;
  threeWeekZeroCompletionPattern: boolean;
};

function summarizeWeek(days: AttendanceDay[], week: number): AttendanceWeekSummary {
  const weekDays = days.filter((day) => day.week === week);
  return {
    week,
    total: weekDays.length,
    completed: weekDays.filter((day) => day.status === "completed").length,
    skipped: weekDays.filter((day) => day.status === "skipped").length,
    planned: weekDays.filter((day) => day.status === "planned").length,
  };
}

/**
 * Detect repeated attendance trouble without relying on chat memory. The
 * three-week signal fires only when each of the latest three started program
 * weeks contains at least one explicitly skipped workout.
 */
export function deriveAttendancePattern(days: AttendanceDay[]): AttendancePattern {
  const startedWeeks = [
    ...new Set(days.filter((day) => day.status !== "planned").map((day) => day.week)),
  ].sort((a, b) => a - b);
  const latestStartedWeek = startedWeeks.at(-1) ?? null;
  const recentWeeks =
    latestStartedWeek == null
      ? []
      : Array.from({ length: Math.min(3, latestStartedWeek) }, (_, index) => {
          return latestStartedWeek - Math.min(3, latestStartedWeek) + index + 1;
        });
  const skipped = days.filter((day) => day.status === "skipped");
  const skippedRecentWeeks = recentWeeks.filter((week) => skipped.some((day) => day.week === week));
  const recentWeekSummaries = recentWeeks.map((week) => summarizeWeek(days, week));
  return {
    totalSessions: days.length,
    totalCompleted: days.filter((day) => day.status === "completed").length,
    totalSkipped: skipped.length,
    totalPlanned: days.filter((day) => day.status === "planned").length,
    latestStartedWeek,
    latestStartedWeekSummary:
      latestStartedWeek == null ? null : summarizeWeek(days, latestStartedWeek),
    recentWeeks,
    recentWeekSummaries,
    skipsInRecentWeeks: skipped.filter((day) => recentWeeks.includes(day.week)).length,
    skippedRecentWeeks,
    repeatedWeeklySkips:
      recentWeeks.length === 3 && recentWeeks.every((week) => skippedRecentWeeks.includes(week)),
    threeWeekZeroCompletionPattern:
      recentWeekSummaries.length === 3 &&
      recentWeekSummaries.every(
        (week) => week.completed === 0 && week.skipped > 0 && week.planned === 0,
      ),
  };
}

export function summarizeAttendancePattern(days: AttendanceDay[], language: "en" | "sv" = "en") {
  const pattern = deriveAttendancePattern(days);
  if (pattern.totalSkipped === 0) {
    return language === "sv"
      ? "Närvaro: inga pass har hoppats över."
      : "Attendance: no workouts skipped.";
  }
  const latest = pattern.latestStartedWeekSummary;
  const recent = pattern.recentWeekSummaries
    .map(
      (week) =>
        `W${week.week} ${week.completed}/${week.total} complete, ${week.skipped} skipped, ${week.planned} open`,
    )
    .join("; ");
  if (language === "sv") {
    return `Närvaro: ${pattern.totalCompleted} slutförda, ${pattern.totalSkipped} överhoppade och ${pattern.totalPlanned} planerade av ${pattern.totalSessions} pass. Senast påbörjade vecka: ${
      latest
        ? `V${latest.week}, ${latest.completed}/${latest.total} slutförda, ${latest.skipped} överhoppade, ${latest.planned} kvar`
        : "ingen"
    }. Senaste veckorna: ${recent || "inga"}. Tre helt avgjorda veckor i rad utan ett enda slutfört pass: ${pattern.threeWeekZeroCompletionPattern ? "JA" : "nej"}.`;
  }
  return `Attendance: ${pattern.totalCompleted} completed, ${pattern.totalSkipped} skipped, and ${pattern.totalPlanned} planned of ${pattern.totalSessions} sessions. Latest started week: ${
    latest
      ? `W${latest.week}, ${latest.completed}/${latest.total} completed, ${latest.skipped} skipped, ${latest.planned} remaining`
      : "none"
  }. Recent weeks: ${recent || "none"}. Three fully resolved consecutive weeks with zero completed sessions: ${pattern.threeWeekZeroCompletionPattern ? "YES" : "no"}.`;
}
