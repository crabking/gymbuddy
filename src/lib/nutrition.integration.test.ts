import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import { profiles, users } from "@/db/schema";
import { logMeal } from "@/lib/nutrition.server";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabase).sequential("nutrition mutation idempotency", () => {
  const userId = randomUUID();

  beforeAll(async () => {
    await getDb()
      .insert(users)
      .values({
        id: userId,
        email: `nutrition-test-${userId}@example.invalid`,
        password_hash: "test-only",
      });
    await getDb().insert(profiles).values({ id: userId });
  });

  afterAll(async () => {
    await getDb().delete(users).where(eq(users.id, userId));
  });

  it("accepts an identical retry and rejects a changed estimate under the same key", async () => {
    const input = {
      description: "Chicken and rice (estimated)",
      calories: 650,
      protein_g: 50,
      carbs_g: 70,
      fat_g: 16,
      logged_date: "2030-07-25",
      timezone: "Europe/Stockholm",
      source_key: `meal:${userId}`,
    };
    const first = await logMeal(userId, input);
    const replay = await logMeal(userId, input);
    expect(replay).toMatchObject({ id: first.id, idempotent: true });

    await expect(logMeal(userId, { ...input, calories: 700 })).rejects.toThrow(
      "source key conflicts with different data",
    );
  });
});
