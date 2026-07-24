import { describe, expect, it } from "vitest";
import {
  addLocalDays,
  assertIsoDate,
  isIsoDate,
  localDateInTimeZone,
  normalizeTimeZone,
} from "@/lib/local-date";

describe("local date handling", () => {
  it("validates real calendar dates", () => {
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2027-02-29")).toBe(false);
    expect(() => assertIsoDate("2026-13-01")).toThrow("Invalid local date");
  });

  it("adds calendar days without DST drift", () => {
    expect(addLocalDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(addLocalDays("2026-10-24", 2)).toBe("2026-10-26");
  });

  it("derives the user's date on opposite sides of midnight", () => {
    const instant = new Date("2026-07-24T22:30:00.000Z");
    expect(localDateInTimeZone("Europe/Stockholm", instant)).toBe("2026-07-25");
    expect(localDateInTimeZone("America/Los_Angeles", instant)).toBe("2026-07-24");
  });

  it("rejects invalid timezone names", () => {
    expect(normalizeTimeZone("Europe/Stockholm")).toBe("Europe/Stockholm");
    expect(normalizeTimeZone("not/a-zone")).toBeNull();
  });
});
