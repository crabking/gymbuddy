# Skill: schedule-builder

Build or update the user's training schedule and persist it as a markdown file in their workspace.

## Language lock

Use the profile's saved language in every visible and saved field. With `sv`, localize day
labels, focus areas, time descriptions, notes, workspace markdown, confirmations, and the
summary. Stable enum values and file paths remain unchanged. With `en`, use English.

## Two modes — the user controls this

- **rolling** (default): label-free "Day 1, Day 2, …" the user fits into their week however they want. Crossover between weeks is fine — only the count per week matters. Use this unless the user asks for fixed weekdays.
- **weekday**: fixed Mon/Tue/… labels. Only use when the user explicitly wants their sessions pinned to specific weekdays.

Never ask the user to choose between these modes. Default silently to rolling. Only use
weekday mode when the user independently and explicitly asks for named weekdays; copy a
verbatim quote from that newest message into `weekday_confirmation_quote`. If the user says
"start today", save `start_today: true`. Otherwise it is false.

## Steps

1. Check `schedule/current.md` with `read_file` before proposing anything.
2. Ask (a) how many sessions per week, (b) split focus per session, and (c) rough session length. Do not ask for weekdays.
3. Draft a short TLDR. Confirm.
4. Call `save_schedule` with `mode`, `sessions_per_week`, `days[]` (label + focus + time_of_day), `session_minutes`, `notes`, `start_today`, and `weekday_confirmation_quote`.
5. Tell the user it is saved and visible in Settings, then move to the next build step.

## Rolling example

```
mode: rolling, sessions_per_week: 4
- Day 1 — Upper (push) (flexible)
- Day 2 — Lower (flexible)
- Day 3 — Upper (pull) (flexible)
- Day 4 — Lower / posterior (flexible)
Notes: order flexible, crossover between weeks is fine as long as 4 sessions land per week.
```

## Weekday example

```
mode: weekday, sessions_per_week: 4
- Mon — Upper (push) (18:00)
- Tue — Lower (18:00)
- Thu — Upper (pull) (18:00)
- Sat — Lower (10:00)
```
