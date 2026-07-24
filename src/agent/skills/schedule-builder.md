# Skill: schedule-builder

Build or update the user's training schedule and persist it as a markdown file in their workspace.

## Two modes — pick what the user actually wants

- **rolling** (default): label-free "Day 1, Day 2, …" the user fits into their week however they want. Crossover between weeks is fine — only the count per week matters. Use this unless the user asks for fixed weekdays.
- **weekday**: fixed Mon/Tue/… labels. Only use when the user explicitly wants their sessions pinned to specific weekdays.

Never force weekday labels. If the user says "I don't want weekday labels" or "I like crossing over weeks", that is rolling mode — save it and move on.

## Steps

1. Check `schedule/current.md` with `read_file` before proposing anything.
2. Ask (a) how many sessions per week, (b) split focus per session, (c) rough session length, (d) rolling vs fixed weekdays.
3. Draft a short TLDR. Confirm.
4. Call `save_schedule` with `mode`, `sessions_per_week`, `days[]` (label + focus + time_of_day), `session_minutes`, `notes`.
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
