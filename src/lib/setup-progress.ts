export type SetupKey = "profile" | "schedule" | "baseline" | "meals";

export type SetupProgressProfile = {
  display_name?: string | null;
  goal?: string | null;
  experience?: string | null;
  equipment?: string | null;
  injuries?: string | null;
  age?: number | null;
  height_cm?: number | null;
  weight_kg?: number | null;
  sex?: string | null;
  days_per_week?: number | null;
  session_minutes?: number | null;
  schedule_note?: string | null;
  recent_training_baseline?: string | null;
  activity_level?: string | null;
  diet_style?: string | null;
  meal_preferences?: string | null;
  daily_calorie_target?: number | null;
};

export function setupStatus(profile: SetupProgressProfile): Record<SetupKey, boolean> {
  return {
    profile: !!(
      profile.display_name &&
      profile.goal &&
      profile.experience &&
      profile.equipment &&
      profile.injuries &&
      profile.age &&
      profile.height_cm &&
      profile.weight_kg &&
      profile.sex
    ),
    schedule: !!(profile.days_per_week && profile.session_minutes && profile.schedule_note),
    baseline: !!profile.recent_training_baseline,
    meals: !!(
      profile.activity_level &&
      profile.diet_style &&
      profile.meal_preferences &&
      profile.daily_calorie_target
    ),
  };
}
