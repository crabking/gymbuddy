import { describe, expect, it, vi } from "vitest";
import {
  isPwaUpdateBlocked,
  setPwaUpdateBlocker,
  subscribePwaUpdateBlockers,
  whilePwaUpdateBlocked,
} from "@/lib/pwa-update";

describe("PWA update blockers", () => {
  it("notifies listeners when pending user work changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePwaUpdateBlockers(listener);

    setPwaUpdateBlocker("test-draft", true);
    expect(isPwaUpdateBlocked()).toBe(true);
    setPwaUpdateBlocker("test-draft", false);
    expect(isPwaUpdateBlocked()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it("keeps reloads blocked for the full async operation", async () => {
    let blockedInside = false;
    await whilePwaUpdateBlocked("test-operation", async () => {
      blockedInside = isPwaUpdateBlocked();
    });

    expect(blockedInside).toBe(true);
    expect(isPwaUpdateBlocked()).toBe(false);
  });

  it("always releases a blocker when an operation fails", async () => {
    await expect(
      whilePwaUpdateBlocked("test-rejection", async () => {
        throw new Error("save failed");
      }),
    ).rejects.toThrow("save failed");

    expect(isPwaUpdateBlocked()).toBe(false);
  });
});
