export type WorkoutSkipRecovery =
  | {
      kind: "hold_progression";
      affected_exercises: number;
      affected_days: number;
    }
  | {
      kind: "none";
    };

/**
 * UI events carry state facts, never coaching copy. The server prompt already
 * has the program, attendance, coach personality, and behavior rules. Keeping
 * this marker neutral prevents repeated UI actions from becoming a response
 * template that the model imitates.
 */
export function workoutSkipUiEvent(
  source: "chat" | "program",
  recovery: WorkoutSkipRecovery,
): string {
  return `__ui_event__ ${JSON.stringify({
    type: "workout_skipped",
    source,
    recovery,
  })}`;
}
