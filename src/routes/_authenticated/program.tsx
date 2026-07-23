import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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
} from "lucide-react";
import { getProgramFull } from "@/lib/gym-buddy.functions";
import { TabBar } from "@/components/TabBar";
import { Shimmer } from "@/components/ai-elements/shimmer";

export const Route = createFileRoute("/_authenticated/program")({
  head: () => ({ meta: [{ title: "Program — Gym Buddy" }] }),
  component: ProgramPage,
});

const pad2 = (n: number) => String(n).padStart(2, "0");
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

type Program = NonNullable<Awaited<ReturnType<typeof getProgramFull>>>;
type Day = Program["days"][number];

function fmtDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function statusStyle(day: Day, today: string) {
  if (day.status === "completed")
    return { border: "border-emerald-500/40", chip: "bg-emerald-500/15 text-emerald-400", label: "Done" };
  if (day.status === "skipped")
    return { border: "border-red-500/30", chip: "bg-red-500/10 text-red-400", label: "Skipped" };
  if (day.date === today)
    return { border: "border-primary/70", chip: "bg-primary/15 text-primary", label: "Today" };
  return { border: "border-border", chip: "bg-secondary/60 text-muted-foreground", label: "Planned" };
}

function ProgramPage() {
  const today = todayStr();
  const { data: program, isLoading } = useQuery({
    queryKey: ["program"],
    queryFn: () => getProgramFull({ data: { date: today } }),
  });

  const currentWeek = useMemo(() => {
    if (!program) return 1;
    const todayDay = program.days.find((d) => d.date >= today);
    return todayDay?.week ?? program.weeks;
  }, [program, today]);

  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const week = selectedWeek ?? currentWeek;
  const [openDay, setOpenDay] = useState<Day | null>(null);

  const doneCount = program?.days.filter((d) => d.status === "completed").length ?? 0;

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="border-b border-border bg-card px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-lg font-bold text-foreground">
              {program ? program.name : "Program"}
            </h1>
            {program && (
              <p className="text-[11px] text-muted-foreground">
                {program.weeks} weeks · {program.days_per_week}x/week · {program.start_date} →{" "}
                {program.end_date}
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
                sessions
              </div>
            </div>
          )}
        </div>

        {/* Week strip */}
        {program && (
          <div className="-mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {Array.from({ length: program.weeks }, (_, i) => i + 1).map((w) => {
              const isDeload = (program.deload_weeks as number[]).includes(w);
              const weekDays = program.days.filter((d) => d.week === w);
              const allDone = weekDays.length > 0 && weekDays.every((d) => d.status === "completed");
              const active = w === week;
              return (
                <button
                  key={w}
                  onClick={() => setSelectedWeek(w)}
                  className={`relative flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl border text-[10px] font-bold transition ${
                    active
                      ? "border-primary bg-primary/15 text-primary"
                      : allDone
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                        : "border-border bg-secondary/40 text-muted-foreground"
                  }`}
                >
                  <span className="font-display">W{w}</span>
                  {isDeload && <Moon className="h-2.5 w-2.5 opacity-70" />}
                  {w === currentWeek && (
                    <span className="absolute -top-0.5 right-1 h-1.5 w-1.5 rounded-full bg-primary" />
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
            <Shimmer>Loading program…</Shimmer>
          </div>
        )}

        {!isLoading && !program && (
          <div className="mx-auto mt-16 max-w-xs text-center">
            <Sparkles className="mx-auto h-10 w-10 text-primary" />
            <h2 className="mt-3 font-display text-lg font-bold text-foreground">No program yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Ask your coach to build your full training program — every week, day by day, will
              show up here.
            </p>
            <Link
              to="/chat"
              className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground"
            >
              Talk to your coach <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
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
              <div className="flex items-center justify-between">
                <h2 className="font-display text-sm font-bold uppercase tracking-widest text-foreground">
                  Week {week}
                </h2>
                {(program.deload_weeks as number[]).includes(week) && (
                  <span className="flex items-center gap-1 rounded-full bg-indigo-500/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-indigo-300">
                    <Moon className="h-3 w-3" /> Deload
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
                      onClick={() => setOpenDay(day)}
                      className={`rounded-2xl border ${s.border} bg-card p-3.5 text-left transition active:scale-[0.99]`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            {fmtDate(day.date)}
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
                          className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ${s.chip}`}
                        >
                          {day.status === "completed" && <Check className="h-3 w-3" strokeWidth={3} />}
                          {day.status === "skipped" && <X className="h-3 w-3" strokeWidth={3} />}
                          {s.label}
                        </span>
                      </div>
                      <div className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {day.exercises
                          .map(
                            (e) =>
                              `${e.name} ${e.sets}×${e.rep_range}${e.target_weight_kg ? ` @ ${e.target_weight_kg}kg` : ""}`,
                          )
                          .join(" · ")}
                      </div>
                    </button>
                  );
                })}
            </motion.div>
          </AnimatePresence>
        )}
      </main>

      {/* Day detail sheet */}
      <Drawer.Root open={!!openDay} onOpenChange={(o) => !o && setOpenDay(null)}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] rounded-t-3xl border-t border-border bg-card outline-none">
            {openDay && (
              <div className="overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
                <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border" />
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Week {openDay.week} · {fmtDate(openDay.date)}
                  {openDay.is_deload ? " · Deload" : ""}
                </div>
                <h3 className="mt-1 font-display text-xl font-bold text-foreground">
                  {openDay.title}
                </h3>
                {openDay.focus && <p className="text-sm text-muted-foreground">{openDay.focus}</p>}
                <div className="mt-4 flex flex-col gap-2">
                  {openDay.exercises.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-center justify-between rounded-xl border border-border bg-background px-3.5 py-3"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground">{e.name}</div>
                        {e.notes && <div className="text-xs text-muted-foreground">{e.notes}</div>}
                      </div>
                      <div className="shrink-0 text-right font-display text-sm font-bold text-foreground">
                        {e.sets}×{e.rep_range}
                        {e.target_weight_kg != null && (
                          <div className="text-xs font-semibold text-primary">
                            {e.target_weight_kg} kg
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {openDay.date === today && openDay.status === "planned" && (
                  <Link
                    to="/chat"
                    className="mt-4 flex h-12 items-center justify-center gap-2 rounded-xl bg-primary font-bold text-primary-foreground"
                  >
                    <Dumbbell className="h-4 w-4" /> Start with your coach
                  </Link>
                )}
              </div>
            )}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      <TabBar />
    </div>
  );
}
