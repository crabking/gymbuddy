import { useEffect, useRef } from "react";
import { ConfirmModal } from "@/components/ConfirmModal";
import { useLanguage } from "@/components/LanguageProvider";

export function SkipWorkoutModal({
  open,
  workoutLabel,
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  workoutLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string | null) => void;
}) {
  const { language } = useLanguage();
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open && reasonRef.current) reasonRef.current.value = "";
  }, [open]);

  return (
    <ConfirmModal
      open={open}
      title={language === "sv" ? "Hoppa över det här passet?" : "Skip this workout?"}
      body={
        language === "sv"
          ? `${workoutLabel} markeras som missat och din coach får veta det. Är du säker?`
          : `${workoutLabel} will be recorded as missed and your coach will be told. Are you sure?`
      }
      confirmLabel={
        busy
          ? language === "sv"
            ? "Sparar…"
            : "Saving…"
          : language === "sv"
            ? "Ja, hoppa över"
            : "Yes, skip it"
      }
      danger
      onCancel={() => {
        if (!busy) onCancel();
      }}
      onConfirm={() => {
        if (!busy) onConfirm(reasonRef.current?.value.trim().slice(0, 500) || null);
      }}
    >
      <label className="mt-3 block text-xs font-semibold text-foreground">
        {language === "sv" ? "Varför? (valfritt)" : "Why? (optional)"}
        <textarea
          ref={reasonRef}
          disabled={busy}
          maxLength={500}
          rows={2}
          placeholder={
            language === "sv"
              ? "Skriv orsaken så att coachen kan hjälpa dig…"
              : "Add the reason so your coach can help…"
          }
          className="mt-1.5 max-h-24 min-h-16 w-full resize-none rounded-sm border border-border bg-background px-3 py-2 text-sm font-normal text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50"
        />
      </label>
    </ConfirmModal>
  );
}
