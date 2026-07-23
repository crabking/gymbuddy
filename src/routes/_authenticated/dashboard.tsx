import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Legend,
} from "recharts";
import { Flame, Dumbbell, Scale, Trophy, Plus, CheckCircle2, XCircle } from "lucide-react";
import { getDashboard, logWeight } from "@/lib/gym-buddy.functions";
import { TabBar } from "@/components/TabBar";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Gym Buddy" }] }),
  component: DashboardPage,
});

// Palette validated for the dark surface (dataviz six-checks: PASS).
const C = {
  strength: "#3987e5",
  volume: "#199e70",
  weight: "#c98500",
  calories: "#e66767",
  grid: "#2a2a2a",
  ink: "#8a8a8a",
};

const fmtShort = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const tooltipStyle = {
  backgroundColor: "#1c1c1c",
  border: "1px solid #333",
  borderRadius: 10,
  fontSize: 12,
  color: "#eee",
} as const;

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="rounded-2xl border border-border bg-card p-4"
    >
      <h2 className="mb-3 font-display text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </h2>
      {children}
    </motion.section>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Flame;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <Icon className="h-4 w-4" style={{ color: accent }} />
      <div className="mt-1.5 font-display text-lg font-bold leading-tight text-foreground">
        {value}
      </div>
      <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function DashboardPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => getDashboard({ data: undefined }),
  });

  const [selectedLift, setSelectedLift] = useState<string | null>(null);
  const lifts = data?.strengthByLift ?? [];
  const lift = lifts.find((l) => l.name === selectedLift) ?? lifts[0] ?? null;

  const [weightInput, setWeightInput] = useState("");

  const calorieData = useMemo(
    () => (data?.calories ?? []).slice(-21), // last 3 weeks
    [data],
  );

  async function submitWeight() {
    const kg = parseFloat(weightInput.replace(",", "."));
    if (!kg || kg < 25 || kg > 400) return toast.error("Enter a weight in kg");
    await logWeight({ data: { weight_kg: kg } });
    setWeightInput("");
    await qc.invalidateQueries({ queryKey: ["dashboard"] });
    toast.success(`Logged ${kg} kg`);
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="border-b border-border bg-card px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <h1 className="font-display text-lg font-bold text-foreground">Dashboard</h1>
        <p className="text-[11px] text-muted-foreground">Your training, tracked.</p>
      </header>

      <main className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {isLoading && (
          <div className="grid h-40 place-items-center">
            <Shimmer>Crunching your numbers…</Shimmer>
          </div>
        )}

        {data && (
          <>
            {/* Stat tiles */}
            <div className="grid grid-cols-4 gap-2">
              <StatTile
                icon={Trophy}
                label="Sessions"
                value={String(data.stats.sessions_completed)}
                accent={C.strength}
              />
              <StatTile
                icon={Flame}
                label="Streak"
                value={`${data.stats.streak_weeks}w`}
                accent={C.calories}
              />
              <StatTile
                icon={Scale}
                label="Weight"
                value={data.stats.current_weight_kg ? `${data.stats.current_weight_kg}` : "—"}
                accent={C.weight}
              />
              <StatTile
                icon={Dumbbell}
                label="Kcal goal"
                value={data.stats.calorie_target ? String(data.stats.calorie_target) : "—"}
                accent={C.volume}
              />
            </div>

            {/* Strength per lift */}
            <Card title="Strength — top set & est. 1RM">
              {lifts.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  Complete workouts with logged sets and your strength curves show up here.
                </p>
              ) : (
                <>
                  <div className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1">
                    {lifts.slice(0, 8).map((l) => (
                      <button
                        key={l.name}
                        onClick={() => setSelectedLift(l.name)}
                        className={`shrink-0 rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                          lift?.name === l.name
                            ? "border-primary bg-primary/15 text-primary"
                            : "border-border bg-secondary/40 text-muted-foreground"
                        }`}
                      >
                        {l.name}
                      </button>
                    ))}
                  </div>
                  <div className="h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={lift?.points ?? []} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                        <CartesianGrid stroke={C.grid} strokeDasharray="3 6" vertical={false} />
                        <XAxis
                          dataKey="date"
                          tickFormatter={fmtShort}
                          tick={{ fill: C.ink, fontSize: 10 }}
                          axisLine={{ stroke: C.grid }}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fill: C.ink, fontSize: 10 }}
                          axisLine={false}
                          tickLine={false}
                          unit=""
                        />
                        <Tooltip
                          contentStyle={tooltipStyle}
                          labelFormatter={(d) => fmtShort(String(d))}
                          formatter={(v: number, name: string) => [
                            `${v} kg`,
                            name === "top_weight_kg" ? "Top set" : "Est. 1RM",
                          ]}
                        />
                        <Legend
                          formatter={(v) => (
                            <span style={{ color: C.ink, fontSize: 11 }}>
                              {v === "top_weight_kg" ? "Top set" : "Est. 1RM"}
                            </span>
                          )}
                        />
                        <Line
                          type="monotone"
                          dataKey="top_weight_kg"
                          stroke={C.strength}
                          strokeWidth={2}
                          dot={{ r: 3, fill: C.strength, strokeWidth: 0 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="e1rm"
                          stroke={C.strength}
                          strokeOpacity={0.45}
                          strokeWidth={2}
                          strokeDasharray="5 4"
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </Card>

            {/* Weekly volume */}
            <Card title="Weekly volume — completed sets">
              {data.weeklyVolume.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  Finish sessions to build your weekly volume history.
                </p>
              ) : (
                <div className="h-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.weeklyVolume} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke={C.grid} strokeDasharray="3 6" vertical={false} />
                      <XAxis
                        dataKey="week"
                        tickFormatter={fmtShort}
                        tick={{ fill: C.ink, fontSize: 10 }}
                        axisLine={{ stroke: C.grid }}
                        tickLine={false}
                      />
                      <YAxis tick={{ fill: C.ink, fontSize: 10 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelFormatter={(d) => `Week of ${fmtShort(String(d))}`}
                        formatter={(v: number, name: string) => [
                          name === "sets" ? `${v} sets` : `${v} kg total`,
                          name === "sets" ? "Sets" : "Tonnage",
                        ]}
                      />
                      <Bar dataKey="sets" fill={C.volume} radius={[4, 4, 0, 0]} maxBarSize={22} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            {/* Bodyweight */}
            <Card title="Bodyweight">
              <div className="mb-3 flex items-center gap-2">
                <input
                  value={weightInput}
                  onChange={(e) => setWeightInput(e.target.value)}
                  inputMode="decimal"
                  placeholder="Log today's weight (kg)"
                  className="h-10 flex-1 rounded-xl border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
                <button
                  onClick={submitWeight}
                  className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground"
                  aria-label="Log weight"
                >
                  <Plus className="h-4 w-4" strokeWidth={3} />
                </button>
              </div>
              {data.bodyweight.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  Log your first weight to start the trend.
                </p>
              ) : (
                <div className="h-32">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.bodyweight} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke={C.grid} strokeDasharray="3 6" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tickFormatter={fmtShort}
                        tick={{ fill: C.ink, fontSize: 10 }}
                        axisLine={{ stroke: C.grid }}
                        tickLine={false}
                      />
                      <YAxis
                        domain={["dataMin - 1", "dataMax + 1"]}
                        tick={{ fill: C.ink, fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelFormatter={(d) => fmtShort(String(d))}
                        formatter={(v: number) => [`${v} kg`, "Weight"]}
                      />
                      <Line
                        type="monotone"
                        dataKey="weight_kg"
                        stroke={C.weight}
                        strokeWidth={2}
                        dot={{ r: 3, fill: C.weight, strokeWidth: 0 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            {/* Calories */}
            <Card title="Calories — last 3 weeks">
              {calorieData.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  Log meals (or snap photos in chat) to see daily calories here.
                </p>
              ) : (
                <div className="h-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={calorieData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke={C.grid} strokeDasharray="3 6" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tickFormatter={fmtShort}
                        tick={{ fill: C.ink, fontSize: 10 }}
                        axisLine={{ stroke: C.grid }}
                        tickLine={false}
                      />
                      <YAxis tick={{ fill: C.ink, fontSize: 10 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelFormatter={(d) => fmtShort(String(d))}
                        formatter={(v: number, name: string) => [
                          name === "calories" ? `${v} kcal` : `${v} g`,
                          name === "calories" ? "Calories" : "Protein",
                        ]}
                      />
                      {data.stats.calorie_target && (
                        <ReferenceLine
                          y={data.stats.calorie_target}
                          stroke={C.ink}
                          strokeDasharray="4 4"
                          label={{
                            value: "target",
                            fill: C.ink,
                            fontSize: 10,
                            position: "insideTopRight",
                          }}
                        />
                      )}
                      <Bar dataKey="calories" fill={C.calories} radius={[4, 4, 0, 0]} maxBarSize={14} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            {/* Session history */}
            <Card title="Session history">
              {data.history.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  Your completed and skipped sessions will appear here.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {data.history.slice(0, 20).map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        {s.status === "completed" ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                        ) : (
                          <XCircle className="h-4 w-4 shrink-0 text-red-400/70" />
                        )}
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-foreground">
                            {s.title}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {fmtShort(s.date)}
                            {s.duration_min != null ? ` · ${s.duration_min} min` : ""} ·{" "}
                            {s.exercises.filter((e) => e.completed).length}/{s.exercises.length}{" "}
                            exercises
                          </div>
                        </div>
                      </div>
                      <span
                        className={`shrink-0 text-[10px] font-bold uppercase tracking-widest ${
                          s.status === "completed" ? "text-emerald-400" : "text-red-400/70"
                        }`}
                      >
                        {s.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </main>

      <TabBar />
    </div>
  );
}
