import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth.server";

describe("password verification", () => {
  it("accepts the matching password and rejects a different password", async () => {
    const hash = hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong", hash)).resolves.toBe(false);
  });

  it("rejects malformed stored hashes without throwing", async () => {
    await expect(verifyPassword("password", "not-a-valid-hash")).resolves.toBe(false);
  });
});
