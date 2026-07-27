import { describe, expect, it } from "vitest";
import { hashPassword, hashPasswordAsync, verifyPassword } from "./auth.server";

describe("password hash compatibility", () => {
  it("verifies legacy synchronous hashes through Better Auth's async verifier", async () => {
    const hash = hashPassword("A-realistic-password-2026");
    await expect(verifyPassword("A-realistic-password-2026", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("keeps new hashes compatible with the rollback-safe local verifier", async () => {
    const hash = await hashPasswordAsync("Another-realistic-password-2026");
    expect(hash).toMatch(/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/);
    await expect(verifyPassword("Another-realistic-password-2026", hash)).resolves.toBe(true);
  });

  it("rejects malformed hashes without throwing", async () => {
    await expect(verifyPassword("anything", "not-a-password-hash")).resolves.toBe(false);
  });
});
