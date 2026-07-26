import { describe, expect, it } from "vitest";
import { deriveAttendancePattern, summarizeAttendancePattern } from "@/lib/attendance";

describe("attendance patterns", () => {
  it("detects one skip in each of three consecutive program weeks", () => {
    const pattern = deriveAttendancePattern([
      { week: 1, status: "completed" },
      { week: 1, status: "skipped" },
      { week: 2, status: "skipped" },
      { week: 3, status: "skipped" },
      { week: 4, status: "planned" },
    ]);
    expect(pattern).toMatchObject({
      totalCompleted: 1,
      totalSkipped: 3,
      recentWeeks: [1, 2, 3],
      skipsInRecentWeeks: 3,
      repeatedWeeklySkips: true,
      threeWeekZeroCompletionPattern: false,
    });
  });

  it("does not flag isolated skips as a three-week pattern", () => {
    const pattern = deriveAttendancePattern([
      { week: 1, status: "skipped" },
      { week: 2, status: "completed" },
      { week: 3, status: "skipped" },
    ]);
    expect(pattern.repeatedWeeklySkips).toBe(false);
    expect(summarizeAttendancePattern([{ week: 1, status: "skipped" }])).toContain("1 skipped");
  });

  it("distinguishes one missed session in a four-day week from abandoning the week", () => {
    const days = [
      { week: 1, status: "completed" },
      { week: 1, status: "skipped" },
      { week: 1, status: "planned" },
      { week: 1, status: "planned" },
      ...Array.from({ length: 28 }, (_, index) => ({
        week: Math.floor(index / 4) + 2,
        status: "planned",
      })),
    ];
    const pattern = deriveAttendancePattern(days);
    expect(pattern.latestStartedWeekSummary).toEqual({
      week: 1,
      total: 4,
      completed: 1,
      skipped: 1,
      planned: 2,
    });
    expect(pattern.threeWeekZeroCompletionPattern).toBe(false);
    expect(summarizeAttendancePattern(days)).toContain("W1, 1/4 completed, 1 skipped, 2 remaining");
  });

  it("flags three fully missed weeks with no completed training", () => {
    const pattern = deriveAttendancePattern([
      { week: 1, status: "skipped" },
      { week: 2, status: "skipped" },
      { week: 3, status: "skipped" },
    ]);
    expect(pattern.threeWeekZeroCompletionPattern).toBe(true);
  });

  it("treats three 3-of-4 weeks as a recurring leak, not total abandonment", () => {
    const days = [1, 2, 3].flatMap((week) => [
      { week, status: "completed" },
      { week, status: "skipped" },
      { week, status: "completed" },
      { week, status: "completed" },
    ]);
    const pattern = deriveAttendancePattern(days);
    expect(pattern).toMatchObject({
      totalCompleted: 9,
      totalSkipped: 3,
      repeatedWeeklySkips: true,
      threeWeekZeroCompletionPattern: false,
    });
    expect(pattern.recentWeekSummaries).toEqual([
      { week: 1, total: 4, completed: 3, skipped: 1, planned: 0 },
      { week: 2, total: 4, completed: 3, skipped: 1, planned: 0 },
      { week: 3, total: 4, completed: 3, skipped: 1, planned: 0 },
    ]);
  });
});
