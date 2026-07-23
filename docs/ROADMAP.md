# Gym Buddy — "Real Coach" Phase Roadmap

Decisions (locked 2026-07-23, interview with Terry):

- **Program model:** full program generated up front (all weeks, day-by-day, concrete
  sets/reps/weights from progression rules + deloads) into structured tables; the coach
  adjusts future weeks based on actual performance.
- **Calendar:** real dated calendar — every training day has a date; missed days become
  visible skips the coach reacts to.
- **Navigation:** bottom tab bar — Coach (chat) / Program / Dashboard.
- **Guardrails:** hard-coded blocks + coach explains (one session/day unless programmed,
  no implausible completion speeds); override only via explicit reason to the coach.
- **Logging:** per-set logging (weight × reps per set, tap-to-complete, inline adjust).
- **Body tracking:** bodyweight to start (trend graph; coach sees it).
- **Graphs:** strength per lift (top set + e1RM) · weekly volume · bodyweight trend ·
  calories/macros adherence.
- **Delivery:** one big pass, visually stunning, clean animations, existing libraries
  (recharts, motion, react-day-picker, date-fns, vaul, shadcn/radix — all installed).

## Phase A — Structured program engine (data foundation)

Tables: `programs` (goal, start/end date, weeks, days_per_week, status, meta),
`program_days` (program week + day index + **date** + title/focus + status:
planned|today|completed|skipped|rest + link to session), `program_exercises`
(position, name, sets, rep_range, target_weight, notes), `session_sets`
(per-set targets + actual weight/reps + completed_at), `weight_logs`.

Generator: template + calc_program_timeline + calc_starting_weights → materialize
every week/day/exercise with progression + deloads applied, dated from start_date.
Coach tools: `generate_program` (replaces save_workout_plan's markdown-only output;
still writes a md summary to the workspace), `adjust_program` (future weeks),
date-aware skip/shift.

## Phase B — Coach realism & guardrails (code-enforced intelligence)

- `start_workout_session`: attaches to today's program_day; refuses a second session
  the same day (unless the program defines one), refuses rest days without an
  explicit override reason; knows the difference.
- Completion realism: sessions and sets carry timestamps; completing a 60-min session
  requires plausible elapsed time; suspiciously fast checkoff sequences are flagged
  and the code refuses auto-acceptance — the coach challenges instead ("that was 40
  seconds, bro — what actually happened?").
- Context injection (every turn): last-7-days session history with durations, time
  since last session, rest status, weight trend, adherence stats — plus the existing
  live session/nutrition/time/training-day state.
- Prompt "reality rules": rest matters, real time frames, one session/day defaults.

## Phase C — Program tab (see the whole 16 weeks)

Bottom tab bar (Coach / Program / Dashboard, motion transitions). Program view:
week strip (deload badges), day-by-day dated list with exercises + targets and
status colors (done/skipped/today/upcoming), tap day → detail sheet (vaul).
Month calendar via react-day-picker with status dots.

## Phase D — Dashboard tab (history, graphs, gains)

Stat tiles (streak, sessions done/planned, current weight, calories today).
Recharts graphs: strength per lift (top-set weight + est. 1RM over time), weekly
volume (sets/tonnage), bodyweight trend, calories vs target + protein adherence.
History lists: sessions (duration, per-set detail) and meals by day.
Weight logging UI + `log_weight` coach tool.

## Phase E — Per-set logging in live sessions

Session start materializes `session_sets` from the program day. WorkoutPanel
exercises expand into set rows (weight × reps, tap done, inline adjust). Set-level
UI events feed the coach; actual set data powers the strength/volume graphs.

## Phase F — Polish & verification

Motion animations, loading/empty states, E2E browser verification of every flow,
generator/guardrail test scripts, workout-planner skill updated to the
generate_program flow.
