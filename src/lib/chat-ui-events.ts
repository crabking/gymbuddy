/**
 * UI events only identify what happened. Recovery bookkeeping already lives
 * in durable program state and must not become repeated coaching copy.
 */
export function workoutSkipUiEvent(source: "chat" | "program"): string {
  return `__ui_event__ ${JSON.stringify({
    type: "workout_skipped",
    source,
  })}`;
}
