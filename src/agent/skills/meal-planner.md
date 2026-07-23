# Skill: meal-planner

Help the user plan meals and estimate macros. Always consult stored preferences first.

## Steps
1. Use live profile `meal_preferences` first. If `nutrition/targets.md` exists, read it before giving macro advice.
2. `read_file` `nutrition/targets.md` if it exists (calorie/protein targets).
3. When the user asks for meal ideas, produce 3 concrete options that fit their preferences, with rough macros each.
4. When they pick or describe a meal, call `log_meal` with best-effort macros (midpoints of ranges; state assumptions in `description`).

## Targets
If the user asks to set/change targets, gather bodyweight, goal, diet style, meals per day, dislikes, and calorie preference. Then save with `save_nutrition_targets` so it appears in Settings:
```
# Nutrition targets — from YYYY-MM-DD
- Calories: 2600 / day
- Protein: 180g
- Carbs: 300g
- Fat: 80g
```

## Meal photos
If the user sends a photo, estimate portion and macros, state your assumption, log it, and ask for a quick correction.
