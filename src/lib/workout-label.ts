export function compactWorkoutLabel(dayIndex: number, title: string, language: "en" | "sv" = "en") {
  const withoutDayPrefix = title
    .replace(/^(?:day|dag)\s+\d+\s*[—–-]\s*/i, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
  const fallback = language === "sv" ? "Träningspass" : "Workout";
  return `${language === "sv" ? "Dag" : "Day"} ${dayIndex} — ${withoutDayPrefix || fallback}`;
}
