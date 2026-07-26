import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Drawer } from "vaul";
import {
  CalendarRange,
  Check,
  X,
  Dumbbell,
  Moon,
  ChevronRight,
  Sparkles,
  History,
  ChevronDown,
} from "lucide-react";
import { getProgramAdaptationHistory, getProgramFull } from "@/lib/gym-buddy.functions";
import { TabBar } from "@/components/TabBar";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { useLanguage } from "@/components/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/program")({
  head: () => ({ meta: [{ title: "Program — COACH" }] }),
  component: ProgramPage,
});

const pad2 = (n: number) => String(n).padStart(2, "0");
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

type Program = NonNullable<Awaited<ReturnType<typeof getProgramFull>>>;
type Day = Program["days"][number];

function fmtDate(dateStr: string, language: "en" | "sv") {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(language === "sv" ? "sv-SE" : "en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function statusStyle(day: Day, today: string) {
  if (day.status === "completed")
    return {
      border: "border-emerald-500/40",
      chip: "bg-emerald-500/15 text-emerald-400",
      labelKey: "common.done" as TranslationKey,
    };
  if (day.status === "skipped")
    return {
      border: "border-red-500/30",
      chip: "bg-red-500/10 text-red-400",
      labelKey: "common.skipped" as TranslationKey,
    };
  if (day.date === today)
    return {
      border: "border-primary/70",
      chip: "bg-primary/15 text-primary",
      labelKey: "common.today" as TranslationKey,
    };
  if (day.date < today)
    return {
      border: "border-amber-500/35",
      chip: "bg-amber-500/10 text-amber-300",
      labelKey: "common.review" as TranslationKey,
    };
  return {
    border: "border-border",
    chip: "bg-secondary/60 text-muted-foreground",
    labelKey: "common.planned" as TranslationKey,
  };
}

function ProgramPage() {
  const { language, t } = useLanguage();
  const today = todayStr();
  const {
    data: program,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["program"],
    queryFn: () => getProgramFull({ data: { date: today } }),
    refetchInterval: 30_000,
  });

  const currentWeek = useMemo(() => {
    if (!program) return 1;
    const overdue = program.days.find((d) => d.status === "planned" && d.date <= today);
    if (overdue) return overdue.week;
    const todayDay = program.days.find((d) => d.status === "planned" && d.date >= today);
    return todayDay?.week ?? program.weeks;
  }, [program, today]);

  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const week = selectedWeek ?? currentWeek;
  const [openDayId, setOpenDayId] = useState<string | null>(null);
  const openDay = program?.days.find((day) => day.id === openDayId) ?? null;
  const firstOpenExerciseId = openDay?.exercises[0]?.id ?? null;
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);
  const [guideFailed, setGuideFailed] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const adaptationHistoryQuery = useQuery({
    queryKey: ["adaptation-history", program?.id],
    queryFn: () =>
      getProgramAdaptationHistory({
        data: { program_id: program?.id ?? null, limit: 20 },
      }),
    enabled: !!program,
  });
  const selectedExercise =
    openDay?.exercises.find((exercise) => exercise.id === selectedExerciseId) ??
    openDay?.exercises[0] ??
    null;

  const displayExerciseName = (exercise: Day["exercises"][number]) =>
    language === "sv" ? exercise.name_sv : exercise.name_en;

  useEffect(() => {
    setSelectedWeek(null);
    setOpenDayId(null);
    setSelectedExerciseId(null);
  }, [program?.id]);

  useEffect(() => {
    setSelectedExerciseId(firstOpenExerciseId);
    setGuideFailed(false);
  }, [openDay?.id, firstOpenExerciseId]);

  const doneCount = program?.days.filter((d) => d.status === "completed").length ?? 0;
  const isRolling = program?.schedule_mode === "rolling";
  const firstPlannedDayId = program?.days.find((day) => day.status === "planned")?.id ?? null;

  return (
    <div className="flex h-dvh flex-col bg-background">
      <TabBar />

      <header className="border-b border-border bg-card px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-lg font-bold text-foreground">
              {program ? program.name : t("program.title")}
            </h1>
            {program && (
              <p className="text-[11px] text-muted-foreground">
                {program.status === "completed" ? `${t("common.completed")} · ` : ""}
                {program.weeks} {t("common.weeks")} ·{" "}
                {t("program.times_week", { count: program.days_per_week })}
                {!isRolling && ` · ${program.start_date} → ${program.end_date}`}
              </p>
            )}
          </div>
          {program && (
            <div className="text-right">
              <div className="font-display text-lg font-bold text-emerald-400">
                {doneCount}
                <span className="text-muted-foreground">/{program.days.length}</span>
              </div>
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
                {t("common.sessions")}
              </div>
            </div>
          )}
        </div>

        {/* Week grid — wraps into rows, never scrolls sideways */}
        {program && (
          <div className="mt-3 grid grid-cols-8 gap-1">
            {Array.from({ length: program.weeks }, (_, i) => i + 1).map((w) => {
              const isDeload = (program.deload_weeks as number[]).includes(w);
              const weekDays = program.days.filter((d) => d.week === w);
              const allDone =
                weekDays.length > 0 && weekDays.every((d) => d.status === "completed");
              const active = w === week;
              return (
                <button
                  key={w}
                  type="button"
                  onClick={() => setSelectedWeek(w)}
                  aria-pressed={active}
                  className={`relative flex h-11 items-center justify-center gap-0.5 rounded-sm border text-[11px] font-bold transition ${
                    active
                      ? "border-primary bg-primary/15 text-primary"
                      : allDone
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                        : "border-border bg-secondary/40 text-muted-foreground"
                  }`}
                >
                  <span className="font-display">
                    {t("common.week_short")}
                    {w}
                  </span>
                  {isDeload && <Moon className="h-2.5 w-2.5 opacity-70" />}
                  {w === currentWeek && (
                    <span className="absolute right-0.5 top-0.5 h-1 w-1 rounded-full bg-primary" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4">
        {isLoading && (
          <div className="grid h-40 place-items-center">
            <Shimmer>{t("program.load")}</Shimmer>
          </div>
        )}

        {isError && !program && (
          <div className="mx-auto mt-16 max-w-xs text-center">
            <X className="mx-auto h-10 w-10 text-red-400" />
            <h2 className="mt-3 font-display text-lg font-bold text-foreground">
              {t("program.load_failed")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("program.load_failed_body")}</p>
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="mt-5 min-h-11 rounded-xl border border-primary/60 px-5 text-sm font-bold text-primary disabled:opacity-50"
            >
              {isFetching ? t("common.retrying") : t("common.retry")}
            </button>
          </div>
        )}

        {isError && program && (
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="mb-3 flex min-h-11 w-full items-center justify-center rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 text-xs font-bold text-amber-300 disabled:opacity-50"
          >
            {t("program.last_synced")} ·{" "}
            {isFetching ? t("common.retrying") : t("program.retry_sync")}
          </button>
        )}

        {!isLoading && !isError && !program && (
          <div className="mx-auto mt-16 max-w-xs text-center">
            <Sparkles className="mx-auto h-10 w-10 text-primary" />
            <h2 className="mt-3 font-display text-lg font-bold text-foreground">
              {t("program.no_program")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("program.no_program_body")}</p>
            <Link
              to="/chat"
              className="mt-5 inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground"
            >
              {t("program.talk_coach")} <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        )}

        {program && (adaptationHistoryQuery.data?.length ?? 0) > 0 && (
          <section className="mb-3 overflow-hidden rounded-2xl border border-border bg-card">
            <button
              type="button"
              onClick={() => setHistoryOpen((open) => !open)}
              aria-expanded={historyOpen}
              className="flex min-h-12 w-full items-center justify-between gap-3 px-3.5 text-left"
            >
              <span className="flex items-center gap-2">
                <History className="h-4 w-4 text-primary" />
                <span>
                  <span className="block font-display text-xs font-bold uppercase tracking-wider text-foreground">
                    {language === "sv" ? "Anpassningshistorik" : "Adaptation history"}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {language === "sv"
                      ? `${adaptationHistoryQuery.data?.length ?? 0} sparade beslut`
                      : `${adaptationHistoryQuery.data?.length ?? 0} saved decisions`}
                  </span>
                </span>
              </span>
              <ChevronDown
                className={`h-4 w-4 text-muted-foreground transition-transform ${
                  historyOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            {historyOpen && (
              <div className="max-h-56 divide-y divide-border overflow-y-auto border-t border-border">
                {adaptationHistoryQuery.data?.map((entry) => {
                  const selected = entry.options.find(
                    (option) => option.id === entry.selected_option_id,
                  );
                  const title =
                    entry.status === "kept"
                      ? language === "sv"
                        ? "Programmet behölls"
                        : "Plan kept"
                      : selected
                        ? language === "sv"
                          ? selected.title_sv
                          : selected.title_en
                        : language === "sv"
                          ? "Tidigare rekommendation"
                          : "Previous recommendation";
                  return (
                    <div key={entry.id} className="px-3.5 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-foreground">{title}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {entry.session_date}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                        {entry.session_title} ·{" "}
                        {language === "sv" ? entry.rationale_sv : entry.rationale_en}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {program && (
          <AnimatePresence mode="wait">
            <motion.div
              key={week}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.15 }}
              className="flex flex-col gap-2.5"
            >
              {program.status === "completed" && (
                <div className="mb-1 rounded-2xl border border-emerald-500/35 bg-emerald-500/10 p-3">
                  <div className="font-display text-sm font-bold text-emerald-300">
                    {t("program.cycle_complete")}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t("program.cycle_complete_body")}
                  </div>
                  <Link
                    to="/chat"
                    className="mt-2 inline-flex min-h-11 items-center gap-1 text-xs font-bold text-emerald-300"
                  >
                    {t("program.next_cycle")} <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              )}
              <div className="flex items-center justify-between">
                <h2 className="font-display text-sm font-bold uppercase tracking-widest text-foreground">
                  {t("common.week")} {week}
                </h2>
                {(program.deload_weeks as number[]).includes(week) && (
                  <span className="flex items-center gap-1 rounded-sm bg-indigo-500/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-indigo-300">
                    <Moon className="h-3 w-3" /> {t("common.deload")}
                  </span>
                )}
              </div>

              {program.days
                .filter((d) => d.week === week)
                .map((day) => {
                  const s = statusStyle(day, today);
                  return (
                    <button
                      key={day.id}
                      type="button"
                      onClick={() => setOpenDayId(day.id)}
                      className={`rounded-2xl border ${s.border} bg-card p-3.5 text-left transition active:scale-[0.99]`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            {isRolling
                              ? `${language === "sv" ? "Dag" : "Day"} ${day.day_index}`
                              : fmtDate(day.date, language)}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 font-display text-[15px] font-bold text-foreground">
                            <Dumbbell className="h-3.5 w-3.5 text-primary" />
                            {day.title}
                          </div>
                          {day.focus && (
                            <div className="text-xs text-muted-foreground">{day.focus}</div>
                          )}
                        </div>
                        <span
                          className={`flex shrink-0 items-center gap-1 rounded-sm px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ${s.chip}`}
                        >
                          {day.status === "completed" && (
                            <Check className="h-3 w-3" strokeWidth={3} />
                          )}
                          {day.status === "skipped" && <X className="h-3 w-3" strokeWidth={3} />}
                          {t(s.labelKey)}
                        </span>
                      </div>
                    </button>
                  );
                })}
            </motion.div>
          </AnimatePresence>
        )}
      </main>

      {/* Day detail sheet */}
      <Drawer.Root open={!!openDay} onOpenChange={(o) => !o && setOpenDayId(null)}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 h-[92dvh] max-h-[52rem] rounded-t-3xl border-t border-border bg-card outline-none">
            {openDay && (
              <div className="flex h-full min-h-0 flex-col">
                <div className="shrink-0 px-4 pb-3 pt-3">
                  <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border" />
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {t("common.week")} {openDay.week} ·{" "}
                        {isRolling
                          ? `${language === "sv" ? "Dag" : "Day"} ${openDay.day_index}`
                          : fmtDate(openDay.date, language)}
                        {openDay.is_deload ? ` · ${t("common.deload")}` : ""}
                      </div>
                      <h3 className="mt-1 font-display text-xl font-bold text-foreground">
                        {openDay.title}
                      </h3>
                    </div>
                    <Drawer.Close
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground transition hover:text-foreground"
                      aria-label={t("program.close_details")}
                    >
                      <X className="h-4 w-4" />
                    </Drawer.Close>
                  </div>
                  {openDay.focus && (
                    <p className="text-sm text-muted-foreground">{openDay.focus}</p>
                  )}
                </div>

                <div className="relative min-h-0 flex-[1.15] overflow-hidden border-y border-border bg-black">
                  {selectedExercise?.image_path && !guideFailed ? (
                    <img
                      key={selectedExercise.id}
                      src={selectedExercise.image_path}
                      alt={t("program.exercise_guide_alt", {
                        name: displayExerciseName(selectedExercise),
                      })}
                      onError={() => setGuideFailed(true)}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div className="grid h-full place-items-center px-8 text-center text-sm text-muted-foreground">
                      {selectedExercise
                        ? t("program.image_unavailable")
                        : t("program.select_exercise")}
                    </div>
                  )}
                </div>

                <div className="flex min-h-0 flex-1 flex-col">
                  {selectedExercise && (
                    <div className="flex shrink-0 items-center justify-between border-b border-border bg-secondary/35 px-4 py-2">
                      <span className="min-w-0 truncate text-sm font-bold text-foreground">
                        {displayExerciseName(selectedExercise)}
                      </span>
                      <span className="shrink-0 font-display text-sm font-bold text-primary">
                        {selectedExercise.sets}×{selectedExercise.rep_range}
                      </span>
                    </div>
                  )}
                  <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
                    {openDay.resolution_note && (
                      <p className="mb-2 rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
                        {openDay.resolution_note}
                      </p>
                    )}
                    <div className="flex flex-col gap-1.5">
                      {openDay.exercises.map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          aria-pressed={selectedExercise?.id === e.id}
                          onClick={() => {
                            setSelectedExerciseId(e.id);
                            setGuideFailed(false);
                          }}
                          className={`flex min-h-14 items-center justify-between rounded-xl border px-3.5 py-2.5 text-left transition ${
                            selectedExercise?.id === e.id
                              ? "border-primary bg-primary/10 shadow-[0_0_16px_rgba(232,36,63,0.16)]"
                              : "border-border bg-background"
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-foreground">
                              {displayExerciseName(e)}
                            </div>
                            {e.notes && (
                              <div className="text-xs text-muted-foreground">{e.notes}</div>
                            )}
                          </div>
                          <div className="shrink-0 text-right font-display text-sm font-bold text-foreground">
                            {e.sets}×{e.rep_range}
                            {e.target_weight_kg != null && (
                              <div className="text-xs font-semibold text-primary">
                                {e.target_weight_kg} kg
                              </div>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                    {openDay.status === "planned" &&
                      (openDay.date <= today ||
                        (isRolling && openDay.id === firstPlannedDayId)) && (
                        <Link
                          to="/chat"
                          search={{ start: true }}
                          className="mt-2 flex h-12 items-center justify-center gap-2 rounded-xl bg-primary font-bold text-primary-foreground"
                        >
                          <Dumbbell className="h-4 w-4" /> {t("program.start_due")}
                        </Link>
                      )}
                  </div>
                </div>
              </div>
            )}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}
