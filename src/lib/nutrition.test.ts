import { describe, expect, it } from "vitest";
import {
  deriveMacroTargets,
  ingredientNutrientTotals,
  ingredientNutritionTotals,
} from "@/lib/nutrition.server";

describe("nutrition calculations", () => {
  it("sums every ingredient into complete meal totals", () => {
    expect(
      ingredientNutritionTotals([
        {
          name: "Salmon",
          amount: "150 g",
          calories: 312,
          protein_g: 33.4,
          carbs_g: 0,
          fat_g: 19.1,
        },
        {
          name: "Potatoes",
          amount: "250 g",
          calories: 190,
          protein_g: 5.2,
          carbs_g: 42.6,
          fat_g: 0.3,
        },
        {
          name: "Olive oil",
          amount: "10 g",
          calories: 90,
          protein_g: 0,
          carbs_g: 0,
          fat_g: 10,
        },
      ]),
    ).toEqual({
      calories: 592,
      protein_g: 38.6,
      carbs_g: 42.6,
      fat_g: 29.4,
    });
  });

  it("derives balanced fallback macro goals for existing calorie targets", () => {
    const targets = deriveMacroTargets(2325, 96);
    expect(targets).toEqual({ protein_g: 173, carbs_g: 235, fat_g: 77 });
    expect(targets.protein_g! * 4 + targets.carbs_g! * 4 + targets.fat_g! * 9).toBe(2325);
  });

  it("sums micronutrients without treating missing estimates as zero", () => {
    const result = ingredientNutrientTotals([
      {
        name: "Salmon",
        amount: "150 g",
        calories: 312,
        protein_g: 33.4,
        carbs_g: 0,
        fat_g: 19.1,
        nutrients: {
          vitamin_d_mcg: 16.5,
          magnesium_mg: 45,
          potassium_mg: 550,
        },
        estimate_confidence: "medium",
      },
      {
        name: "Potatoes",
        amount: "250 g",
        calories: 190,
        protein_g: 5.2,
        carbs_g: 42.6,
        fat_g: 0.3,
        nutrients: {
          vitamin_d_mcg: null,
          magnesium_mg: 58.4,
          potassium_mg: 940,
        },
        estimate_confidence: "high",
      },
    ]);

    expect(result.totals).toMatchObject({
      vitamin_d_mcg: 16.5,
      magnesium_mg: 103.4,
      potassium_mg: 1490,
    });
    expect(result.known).toMatchObject({
      vitamin_d_mcg: 1,
      magnesium_mg: 2,
      potassium_mg: 2,
    });
    expect(result.unknown).toMatchObject({
      vitamin_d_mcg: 1,
      magnesium_mg: 0,
      potassium_mg: 0,
    });
  });
});
