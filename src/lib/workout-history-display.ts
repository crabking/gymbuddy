export type WorkoutHistoryDisplayInput = {
  status: string;
  end_reason?: string | null;
  exercises: Array<{
    completed: boolean;
    completed_sets: number;
    total_sets: number;
  }>;
};

export function describeWorkoutHistoryProgress(session: WorkoutHistoryDisplayInput) {
  const partial =
    session.status === "completed" && session.end_reason?.startsWith("completed_partial:");
  if (partial) {
    return {
      outcome: "partial" as const,
      completed: session.exercises.reduce((total, exercise) => total + exercise.completed_sets, 0),
      total: session.exercises.reduce((total, exercise) => total + exercise.total_sets, 0),
      unit: "sets" as const,
    };
  }
  return {
    outcome: session.status,
    completed: session.exercises.filter((exercise) => exercise.completed).length,
    total: session.exercises.length,
    unit: "exercises" as const,
  };
}
