# Skill: workout-planner (create-workout-plan)

Build a complete, systematic, goal-anchored training program that fits the user's goal, timeline, experience, sex, days/week, equipment, session length, injuries and dislikes — then persist it as markdown in the workspace so it survives sessions and can be modified in real time.

You do NOT freestyle numbers. Use `calc_program_timeline` and `calc_starting_weights` for sets, reps, weights, deloads, and progression, and `substitute_exercise` for grounded swaps. `shift_schedule_weeks` is not a calculator: it persistently changes the active program and requires a verbatim confirmation quote from the newest user message. Select every movement by `exercise_id` from the injected canonical exercise catalog. Never invent a new movement name, use an alias as an ID, or emit a free-text exercise.

## Language lock

Use the profile's saved language for every user-visible field. With `sv`, write natural
Swedish program names, day titles, focus areas, notes, progression rules, rationale,
workspace markdown, confirmations, and summaries. Exercise IDs remain unchanged; display
their Swedish catalog names. With `en`, use English throughout. Never mix the two languages
unless the user explicitly asks for a translation.

---

## Step-by-step workflow

1. **Read context first.** `read_file` `schedule/current.md` and `plans/current.md` if they exist. Use the live `recent_training_baseline`; the save tool archives the old current plan automatically.
2. **Establish a real baseline.** If `recent_training_baseline` is missing, ask whether they can describe one or two recent workouts: exercises, weights, sets × reps, duration, frequency, and difficulty/RPE. Save their answer with `update_profile`. If they have none, save `"No recent workouts provided; use conservative estimated starting loads."` Never invent history.
3. **Pitch first, never dump.** Name the best base template in 2–3 sentences, explain why it fits their real schedule and recent workload, and ask if they want to run it. Do not show exercises, sets, reps, or weights yet.
4. **Confirm the goal(s) and timeline.** Ask one short question at a time:
   - Primary goal(s) — hypertrophy, strength, fat loss, general health, athletic, powerlifting, bodybuilding, glute/booty focus, yoga+lifting hybrid, etc.
   - **Timeline / target date** — 4 weeks, 8 weeks, 12 weeks, 6 months, 1 year. This is required — the plan is built backwards from it.
   - Concrete target if any (e.g. "+5kg lean mass", "bench 100kg", "-8kg fat", "run 5k in 25 min alongside lifting").
5. **Pick a base template** from the library below that best matches goal × days/week × experience × sex × recent workload. State which template and why in 1 sentence.
6. **Personalize the template.** For every exercise the user dislikes or can't do (equipment / injury), call `substitute_exercise` with its catalog `exercise_id` — do NOT silently drop it and do NOT swap it for a lazy alternative. Offer 2-3 returned catalog options and ask which they prefer. Confirm equipment access when needed.
7. **Systematize the numbers.** Call `calc_program_timeline` with { goal, timeline_weeks, days_per_week, experience }. Use its output for mesocycle structure, weekly volume, intensity waves, deload placement. Call `calc_starting_weights` with { sex, bodyweight_kg, experience, lifts, recent_working_sets }. Translate reported recent sets into `recent_working_sets`; observed loads take priority over estimates.
8. **Confirm, save, then summarize.** Before the mutation, make sure the newest user message explicitly authorizes this exact plan. If it does not, ask one compact yes/no question. Call `generate_program` with the full week_template and `confirmation_quote` copied verbatim from that newest authorizing message — the engine materializes every dated week/day/exercise. Reply with a TLDR only and point the user to the Program tab for the full day-by-day program. Do not paste the full plan into chat.
9. **Move forward.** After saving, immediately move to nutrition targets.

---

## Real-time modification workflow

When the user says things like "I'm skipping this week", "add a deload", "swap Tuesday to Thursday", "I hurt my shoulder", "I want to double leg volume":

1. `read_file` `plans/current.md`.
2. Take the right grounded action:
   - Confirmed skipped / inserted / shifted time → call `shift_schedule_weeks` with the first unresolved date, the exact calendar-day shift, and `confirmation_quote` copied verbatim from the newest user message. If the user has not explicitly confirmed the actual shift, ask first; never call it speculatively.
   - Exercise swap → `substitute_exercise`.
   - Goal/timeline changed → `calc_program_timeline` again.
3. For a full plan rewrite, regenerate with `generate_program` (or tune future weeks with `adjust_program`) after all required fields are known. Durable user preferences are captured by the automatic memory job.
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

### Substitutions

Always call `substitute_exercise`; its returned catalog IDs are the only valid options.
Do not use substitutions remembered from general knowledge because they may not have a
database identity, bilingual label, or movement guide.

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
- Every exercise in `week_template` must use a canonical `exercise_id`; never pass a name.
- Never silently drop or lazy-swap an exercise — use `substitute_exercise` and confirm.
- Never modify a live plan without `read_file` first.
- The plan save tool archives before overwriting.
- Every plan MUST have a timeline and a deload cadence.
- Every plan MUST cite which template it's based on.
