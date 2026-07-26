import { Play, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

export function NextWorkoutActions({
  workoutLabel,
  busy = false,
  onStart,
  onSkip,
}: {
  workoutLabel: string;
  busy?: boolean;
  onStart: () => void;
  onSkip: () => void;
}) {
  const { language } = useLanguage();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_5.75rem] gap-2">
      <button
        type="button"
        onClick={onStart}
        disabled={busy}
        className="flex min-h-16 min-w-0 items-center gap-2.5 rounded-xl bg-primary px-3 text-left text-primary-foreground transition active:scale-[0.99] disabled:opacity-50"
      >
        <Play className="h-4 w-4 shrink-0" />
        <span className="min-w-0">
          <span className="block font-display text-[10px] font-bold uppercase tracking-[0.1em]">
            {language === "sv" ? "Starta nästa pass" : "Start next workout"}
          </span>
          <span className="mt-0.5 line-clamp-2 block text-xs font-semibold leading-tight">
            {workoutLabel}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onSkip}
        disabled={busy}
        className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border border-red-500/55 bg-red-500/10 px-2 font-display text-[10px] font-bold uppercase tracking-[0.1em] text-red-400 transition active:scale-[0.99] disabled:opacity-50"
      >
        <X className="h-4 w-4" strokeWidth={2.5} />
        {language === "sv" ? "Hoppa över" : "Skip"}
      </button>
    </div>
  );
}
