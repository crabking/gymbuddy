import { afterAll, describe, expect, it } from "vitest";
import { resetDistributedRateLimit, takeDistributedRateLimit } from "@/lib/security.server";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const suite = describe.runIf(databaseAvailable);

suite("distributed rate limiting", () => {
  const key = `integration:${crypto.randomUUID()}`;

  afterAll(async () => {
    await resetDistributedRateLimit(key);
  });

  it("enforces the same fixed-window count stored in Postgres", async () => {
    await expect(takeDistributedRateLimit(key, 2, 60_000)).resolves.toMatchObject({
      allowed: true,
    });
    await expect(takeDistributedRateLimit(key, 2, 60_000)).resolves.toMatchObject({
      allowed: true,
    });
    await expect(takeDistributedRateLimit(key, 2, 60_000)).resolves.toMatchObject({
      allowed: false,
    });
  });
});
