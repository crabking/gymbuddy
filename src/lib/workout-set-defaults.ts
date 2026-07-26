export type WorkoutSetDefaultsInput = {
  target_reps: string | null;
  target_weight_kg: number | null;
  reps: number | null;
  weight_kg: number | null;
};

/**
 * An untouched set records the conservative end of the prescription.
 * Existing actual values always win, and bodyweight work never receives
 * an invented kilogram value.
 */
export function workoutSetDefaults(set: WorkoutSetDefaultsInput) {
  const prescribedReps = set.target_reps?.match(/\d+/)?.[0] ?? "";
  return {
    weight:
      set.weight_kg != null
        ? String(set.weight_kg)
        : set.target_weight_kg != null
          ? String(set.target_weight_kg)
          : "",
    reps: set.reps != null ? String(set.reps) : prescribedReps,
  };
}
