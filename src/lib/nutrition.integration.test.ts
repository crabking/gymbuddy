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
      calories: null,
      protein_g: null,
      carbs_g: null,
      fat_g: null,
      ingredients: [
        {
          name: "Chicken breast",
          amount: "180 g cooked",
          calories: 300,
          protein_g: 55,
          carbs_g: 0,
          fat_g: 7,
          nutrients: {
            fiber_g: 0,
            magnesium_mg: 52,
            potassium_mg: 460,
            vitamin_b6_mg: 1.1,
          },
          estimate_confidence: "high" as const,
        },
        {
          name: "Rice",
          amount: "250 g cooked",
          calories: 325,
          protein_g: 7,
          carbs_g: 70,
          fat_g: 1,
          nutrients: {
            fiber_g: 3.5,
            magnesium_mg: 30,
            potassium_mg: 90,
            vitamin_b6_mg: 0.2,
          },
          estimate_confidence: "medium" as const,
        },
      ],
      logged_date: "2030-07-25",
      timezone: "Europe/Stockholm",
      source_key: `meal:${userId}`,
    };
    const first = await logMeal(userId, input);
    expect(first).toMatchObject({
      calories: 625,
      protein_g: 62,
      carbs_g: 70,
      fat_g: 8,
      ingredients: input.ingredients,
    });
    const replay = await logMeal(userId, input);
    expect(replay).toMatchObject({ id: first.id, idempotent: true });

    await expect(
      logMeal(userId, {
        ...input,
        ingredients: [{ ...input.ingredients[0], amount: "200 g cooked" }, input.ingredients[1]],
      }),
    ).rejects.toThrow("source key conflicts with different data");
  });
});
