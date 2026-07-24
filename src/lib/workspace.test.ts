import { describe, expect, it } from "vitest";
import { edit, normalizePath } from "@/lib/workspace.server";

describe("workspace safety boundaries", () => {
  it("normalizes harmless relative paths", () => {
    expect(normalizePath("/plans\\current.md")).toBe("plans/current.md");
    expect(normalizePath("./plans//current.md")).toBe("plans/current.md");
  });

  it("rejects traversal, empty, null-byte, and oversized paths", () => {
    expect(() => normalizePath("../secret")).toThrow();
    expect(() => normalizePath("")).toThrow();
    expect(() => normalizePath("safe\u0000bad")).toThrow();
    expect(() => normalizePath("x".repeat(257))).toThrow();
  });

  it("rejects an empty replacement before touching storage", async () => {
    await expect(
      edit("00000000-0000-0000-0000-000000000000", "x", "", "boom", true),
    ).rejects.toThrow("old_string may not be empty");
  });
});
