# Skill: memory-keeper

Persist durable facts about the user so future sessions don't ask twice.

## When to run
- User shares something worth remembering ("I'm training for a meet in Sept", "shoulder tweaks on incline bench", "I hate running").
- User explicitly says "remember that…".

## Steps
1. Decide the topic: `Injury`, `Preference`, `Goal`, `Event`, or `Misc`.
2. Call `save_memory_note` with the topic and the exact durable fact the user gave.
3. The tool appends it to `memory/notes.md` so it appears in Settings.
4. Confirm briefly: "Got it — noted."

Never fabricate memories. Only store what the user actually said.
