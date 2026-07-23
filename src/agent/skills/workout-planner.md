# Skill: workout-planner (create-workout-plan)

Build a complete, systematic, goal-anchored training program that fits the user's goal, timeline, experience, sex, days/week, equipment, session length, injuries and dislikes — then persist it as markdown in the workspace so it survives sessions and can be modified in real time.

You do NOT freestyle numbers. You use the calculator tools (`calc_program_timeline`, `calc_starting_weights`, `substitute_exercise`, `shift_schedule_weeks`) to produce sets, reps, weights, deloads and progression. You do freestyle exercise selection based on the template library below and the user's preferences.

---

## Step-by-step workflow

1. **Read context first.** `read_file` `schedule/current.md` and `plans/current.md` if they exist. The save tool archives the old current plan automatically.
2. **Pitch first, never dump.** Name the best base template in 2–3 sentences, explain why it fits, and ask if they want to run it. Do not show exercises, sets, reps, or weights yet.
3. **Confirm the goal(s) and timeline.** Ask one short question at a time:
   - Primary goal(s) — hypertrophy, strength, fat loss, general health, athletic, powerlifting, bodybuilding, glute/booty focus, yoga+lifting hybrid, etc.
   - **Timeline / target date** — 4 weeks, 8 weeks, 12 weeks, 6 months, 1 year. This is required — the plan is built backwards from it.
   - Concrete target if any (e.g. "+5kg lean mass", "bench 100kg", "-8kg fat", "run 5k in 25 min alongside lifting").
4. **Pick a base template** from the library below that best matches goal × days/week × experience × sex. State which template and why in 1 sentence.
5. **Personalize the template.** For every exercise the user dislikes or can't do (equipment / injury), call `substitute_exercise` — do NOT silently drop it and do NOT swap it for a lazy alternative. Offer 2-3 real substitutes and ask which they prefer. Confirm equipment access when needed.
6. **Systematize the numbers.** Call `calc_program_timeline` with { goal, timeline_weeks, days_per_week, experience }. Use its output for mesocycle structure, weekly volume, intensity waves, deload placement. Call `calc_starting_weights` with { sex, bodyweight_kg, experience, key_lifts } for realistic starting loads.
7. **Save, then summarize.** Call `generate_program` with the full week_template — the engine materializes every dated week/day/exercise. Reply with a TLDR only and point the user to the Program tab for the full day-by-day program. Do not paste the full plan into chat.
8. **Move forward.** After saving, immediately move to nutrition targets.

---

## Real-time modification workflow

When the user says things like "I'm skipping this week", "add a deload", "swap Tuesday to Thursday", "I hurt my shoulder", "I want to double leg volume":

1. `read_file` `plans/current.md`.
2. Call the right calculator:
   - Skipped / inserted / shifted weeks → `shift_schedule_weeks`.
   - Exercise swap → `substitute_exercise`.
   - Goal/timeline changed → `calc_program_timeline` again.
3. For a full plan rewrite, regenerate with `generate_program` (or tune future weeks with `adjust_program`) after all required fields are known. For simple notes/preferences, use `save_memory_note`.
4. Reply with a 2-3 sentence summary of what changed and why.

---

## Template library (pick from these — do NOT invent randomly)

### Beginner (0-12 months serious training)
- **Starting Strength / StrongLifts 5x5** — 3 days/wk, full body, 5×5 squat/bench/row/OHP/deadlift. Best for absolute beginners chasing strength + baseline mass.
- **GZCLP** — 3-4 days/wk, linear progression with T1 (5×3→1×5+), T2 (3×10), T3 (3×15+). Better long-term than SL5x5, still simple.
- **Reddit PPL (nSuns-lite / Metallicadpa PPL)** — 6 days/wk for beginners with time; hybrid strength+hypertrophy.
- **Ivysaur 4-4-8** — 3 days/wk full-body alt; kinder to recovery than SL.

### Intermediate (1-3 years)
- **Upper/Lower 4-day** — classic; balanced hypertrophy + strength. Great default.
- **PPL 6-day (Push / Pull / Legs)** — high volume hypertrophy; bodybuilding staple.
- **PHUL** (Power Hypertrophy Upper Lower) — 4 days, 2 strength + 2 hypertrophy.
- **PHAT** (Layne Norton) — 5 days, strength-focused Mon/Tue + hypertrophy Thu/Fri/Sat.
- **531 Boring But Big** — 4 days; 5/3/1 main lift then 5×10 accessory. Strength + size.
- **Nsuns 5-day / 6-day** — high-frequency 531 variant; strong intermediate strength gains.

### Advanced (3+ years)
- **Conjugate (Westside)** — max-effort + dynamic-effort days; powerlifting-oriented.
- **Sheiko / Smolov Jr** — peaking cycles for powerlifting.
- **Fortitude Training (Scott Stevenson)** — advanced hypertrophy; blood + loading + pump sets.
- **RP hypertrophy mesocycles** — MEV → MAV → MRV progression with planned deload.

### Female-focused / physique
- **Bret Contreras Booty Bible / Strong Curves** — glute-dominant, 4 days/wk, hip thrust centric.
- **Stephanie Buttermore FUPPL** — Full-body + PPL hybrid, 5-6 days, hypertrophy.
- **Meg Squats / Stronger by the Day** — powerbuilding for women, 4-5 days.
- Any Upper/Lower or PPL above works identically — sex is not a programming variable, but goal often skews glute/hamstring/shoulder emphasis.

### Powerlifting-specific
- **531 for Powerlifting**, **Sheiko #29/#32/#37**, **Candito 6-week**, **Calgary Barbell 8/16-week**, **Boris Sheiko peaking**.

### Bodybuilding-specific
- **Arnold split (6-day 2-a-day)** — advanced only.
- **Fortitude / Dante's DoggCrapp** — high-intensity low-volume, rest-pause.
- **Jeff Nippard Fundamentals / Pure Bodybuilding** — modern evidence-based 3-6 day.

### Yoga / hybrid / general health
- **3-day full body + 2 yoga/mobility** — perfect for hybrid users.
- **CrossFit-style circuits** only if explicitly requested — otherwise stick to progressive resistance.

### Minimal-equipment
- **Kettlebell-only (Simple & Sinister / ABC / Giant)** — 3-6 days/wk, swings + get-ups + clean&press. Great for travel, home, conditioning + strength.
- **Dumbbell-only Upper/Lower or PPL** — same splits as barbell versions, swap main lifts for heavy DB variants (goblet squat, DB RDL, DB bench, DB row).
- **Bodyweight / Calisthenics** — Recommended Routine (r/bodyweightfitness), Convict Conditioning, Overcoming Isometrics. 3-6 days/wk, progressions from push-up → planche, row → front lever, squat → pistol.
- **Resistance-band only** — travel fallback; higher reps, tempo + pause work.

### Hybrid endurance + lifting
- **Hybrid Athlete (Nick Bare / Fergus Crawley style)** — 4 lift + 3-4 run days; balances strength, hypertrophy and 5k-half marathon endurance.
- **Tactical Barbell (Base Building / Operator / Zulu)** — strength + conditioning blocks for military/first responder style goals.
- **Run + Lift 3+3** — 3 full-body lift days alternating with 3 run days (easy/tempo/long).
- **Concurrent (Wendler 5/3/1 + conditioning)** — 5/3/1 main lifts with 2-3 hard conditioning slots.



### Fat loss on top of ANY plan
Programming stays the same. Fat loss is a nutrition variable (see meal-planner). Bump NEAT + optional 2-3 low-intensity cardio slots (15-30 min post-lift or off-day walks). Reduce total volume ~10-20% only if recovery collapses.

---

## Exercise substitution rules

When the user pushes back on any lift, follow this order:

1. **Ask WHY** (dislike, boredom, form issue, joint pain, no equipment). This drives the substitute.
2. **Same movement pattern, different implement** first. Only change the pattern if you must.
3. Offer **2-3 concrete options** with 1-line trade-offs. Never single-option.
4. Confirm equipment. Do not assume a hack squat / belt squat / GHR / cable stack exists — ask.
5. Log the substitution in the plan file so it sticks.

### Substitution cheat sheet (call `substitute_exercise` — this is the same map it uses)

- **Back squat →** front squat · hack squat · belt squat · safety-bar squat · Bulgarian split squat + heavy leg press combo · pendulum squat.
- **Barbell deadlift →** trap-bar deadlift · Romanian deadlift + heavy back extensions · rack pull · sumo deadlift · single-leg RDL.
- **Bench press →** dumbbell bench · low-incline barbell · machine chest press · weighted dips · Smith bench.
- **Overhead press →** seated DB press · Arnold press · landmine press · machine shoulder press.
- **Barbell row →** chest-supported T-bar · seal row · Meadows row · single-arm DB row · cable row.
- **Pull-up →** lat pulldown · assisted pull-up · inverted row · neutral-grip machine pulldown.
- **Lunges →** split squat · Bulgarian split squat · step-ups · reverse lunges · leg press single-leg.
- **Standing calf raise →** seated calf · leg-press calf · donkey calf.
- **Hip thrust →** glute bridge · single-leg hip thrust · cable pull-through · 45° back extension w/ glute bias · machine glute drive.

If the user says "I hate legs day" — do NOT drop legs. Offer: (a) split legs across two upper/lower days, (b) machine-only leg day, (c) glute-focused day if aesthetic goal.

---

## Plan file format (`plans/current.md`)

```
# Plan — <split name>
Goal: <goal(s)>
Timeline: <start> → <end> (<N> weeks)
Training days: <N>/week, ~<minutes> min
Deloads: week <x>, week <y>

## Week 1 (Accumulation)
### Mon — Upper (push)
- Bench press — 4 × 6–8 @ 60 kg
- Incline DB press — 3 × 10 @ 22.5 kg
- ...
### Tue — Lower
- ...

## Mesocycle overview
- Weeks 1–4: accumulation (volume ↑, RPE 7–8)
- Week 5: deload (-40% volume, RPE 6)
- Weeks 6–9: intensification (volume ↓, load ↑, RPE 8–9)
- Week 10: deload
- Weeks 11–12: peak / test week

## Progression rules
- Top-set: +2.5 kg upper / +5 kg lower when all sets hit top of rep range for 2 sessions.
- Accessories: +1 rep/session until top of range, then +2.5 kg and reset.

## Substitutions locked in
- Back squat → hack squat (user preference).
- Barbell row → chest-supported T-bar (lower-back injury).

## Why this plan
- Chosen because goal is hypertrophy + strength on 4 days/wk, intermediate.
- Base template: PHUL.
- 12-week arc calculated by calc_program_timeline for a "+4 kg lean mass" target.
```

---

## Hard rules

- Never invent progression numbers — use `calc_program_timeline`.
- Never invent starting weights — use `calc_starting_weights`.
- Never silently drop or lazy-swap an exercise — use `substitute_exercise` and confirm.
- Never modify a live plan without `read_file` first.
- The plan save tool archives before overwriting.
- Every plan MUST have a timeline and a deload cadence.
- Every plan MUST cite which template it's based on.
