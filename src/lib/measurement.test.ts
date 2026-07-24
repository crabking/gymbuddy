import { describe, expect, it } from "vitest";

describe("measurement input contract", () => {
  it("keeps metric keys deliberately small and portable", () => {
    const valid = /^[a-z0-9][a-z0-9_-]{0,63}$/;
    expect(valid.test("resting_heart_rate")).toBe(true);
    expect(valid.test("../heart-rate")).toBe(false);
    expect(valid.test("Heart Rate")).toBe(false);
    expect(valid.test(`x${"y".repeat(64)}`)).toBe(false);
  });
});
