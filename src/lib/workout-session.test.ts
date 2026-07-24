import { describe, expect, it } from "vitest";
import { recentSessionCutoff } from "@/lib/workout-session.server";

describe("recent workout calendar window", () => {
  it("anchors the seven-day window to the phone-local date across month/year boundaries", () => {
    expect(recentSessionCutoff("2030-01-01", 7)).toBe("2029-12-26");
    expect(recentSessionCutoff("2030-03-01", 2)).toBe("2030-02-28");
  });

  it("rejects invalid window sizes and calendar dates", () => {
    expect(() => recentSessionCutoff("2030-02-30", 7)).toThrow();
    expect(() => recentSessionCutoff("2030-01-01", 0)).toThrow("invalid_recent_session_window");
  });
});
