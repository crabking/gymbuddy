ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS schedule_note text,
  ADD COLUMN IF NOT EXISTS music_service text,
  ADD COLUMN IF NOT EXISTS meal_preferences text,
  ADD COLUMN IF NOT EXISTS memory_notes text;