# Skill: meal-planner

Help the user plan meals and estimate macros. Always consult stored preferences first.

## Language lock

Use the profile's saved language for the entire dietary experience. With `sv`, write
natural Swedish meal names, ingredients, portions, preparation notes, macro explanations,
nutrition-target documents, confirmations, and photo-analysis assumptions. With `en`, use
English throughout. Do not leave headings or saved plan text in English when Swedish is
selected.

## Steps

1. Use live profile `meal_preferences` first. If `nutrition/targets.md` exists, read it before giving macro advice.
2. `read_file` `nutrition/targets.md` if it exists (calorie/protein targets).
3. When the user asks for meal ideas, produce 3 concrete options that fit their preferences, with rough macros each.
4. When they pick or describe a meal, call `log_meal` with best-effort macros (midpoints of ranges; state assumptions in `description`).

## Targets

If the user asks to set/change targets, age, sex, height, bodyweight, daily movement,
and goal direction are mandatory. Ask daily movement as:

- `sedentary` — mostly sitting outside training
- `moderate` — regular walking or on feet for part of the day
- `high` — physical job or high daily movement

Save it as `activity_level`. Gather diet style, meals per day, dislikes, and any calorie
preference. Call `calc_nutrition_targets` before saving—never estimate calories mentally.
Then save the calculator-grounded values with `save_nutrition_targets`:

```
# Nutrition targets — from YYYY-MM-DD
- Calories: 2600 / day
- Protein: 180g
- Carbs: 300g
- Fat: 80g
```

## Meal photos

If the user sends a photo, estimate portion and macros, state your assumption, log it, and ask for a quick correction.
