import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
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
  Cell,
} from "recharts";
import { Flame, Dumbbell, Scale, Trophy, Plus, CheckCircle2, XCircle } from "lucide-react";
import { getDashboard, getDashboardHistory, logWeight } from "@/lib/gym-buddy.functions";
import { TabBar } from "@/components/TabBar";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { toast } from "sonner";
import { usePwaUpdateBlocker, whilePwaUpdateBlocked } from "@/lib/pwa-update";
import { hardNavigateToAuth, isUnauthorizedError } from "@/lib/client-session";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — COACH" }] }),
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
const pad2 = (value: number) => String(value).padStart(2, "0");
const todayStr = () => {
  const date = new Date();
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};
const shiftLocalDate = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
};

const tooltipStyle = {
  backgroundColor: "#1c1c1c",
  border: "1px solid #333",
  borderRadius: 10,
  fontSize: 12,
  color: "#eee",
} as const;

type DashboardPayload = NonNullable<Awaited<ReturnType<typeof getDashboard>>>;
type HistoryRow = DashboardPayload["history"][number];
type HistoryCursor = NonNullable<DashboardPayload["history_next_cursor"]>;
type HistoryState = {
  initialized: boolean;
  extraPagesLoaded: boolean;
  rows: HistoryRow[];
  cursor: HistoryCursor | null;
  hasMore: boolean;
};

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
  const localContext = {
    date: todayStr(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["dashboard", localContext.date, localContext.timezone],
    queryFn: () => getDashboard({ data: localContext }),
    refetchInterval: 60_000,
  });

  const [selectedLift, setSelectedLift] = useState<string | null>(null);
  const lifts = data?.strengthByLift ?? [];
  const lift = lifts.find((l) => l.name === selectedLift) ?? lifts[0] ?? null;

  const [weightInput, setWeightInput] = useState("");
  const [savingWeight, setSavingWeight] = useState(false);
  const savingWeightRef = useRef(false);
  const [visibleHistory, setVisibleHistory] = useState(20);
  const [historyState, setHistoryState] = useState<HistoryState>({
    initialized: false,
    extraPagesLoaded: false,
    rows: [],
    cursor: null,
    hasMore: false,
  });
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyLoadError, setHistoryLoadError] = useState(false);
  const loadingHistoryRef = useRef(false);
  usePwaUpdateBlocker("dashboard-weight", savingWeight);
  const [selectedMetricKey, setSelectedMetricKey] = useState<string | null>(null);
  const customMeasurements = data?.customMeasurements ?? [];
  const selectedMetric =
    customMeasurements.find((measurement) => measurement.metric_key === selectedMetricKey) ??
    customMeasurements[0] ??
    null;

  const calorieData = useMemo(() => {
    if (!data) return [];
    const trackedByDate = new Map(data.calories.map((day) => [day.date, day]));
    return Array.from({ length: 21 }, (_, index) => {
      const date = shiftLocalDate(localContext.date, index - 20);
      const tracked = trackedByDate.get(date);
      if (!tracked) {
        return {
          date,
          calories: null,
          known_calories: 0,
          protein_g: null,
          known_protein_g: 0,
          meal_count: 0,
          unknown_calorie_meals: 0,
          unknown_protein_meals: 0,
          chart_calories: null,
        };
      }
      return {
        ...tracked,
        // A partially-known day shows only its known portion, never a fake exact total.
        chart_calories:
          tracked.calories ??
          (tracked.unknown_calorie_meals > 0 && tracked.known_calories > 0
            ? tracked.known_calories
            : null),
      };
    });
  }, [data, localContext.date]);
  const hasCalorieData = calorieData.some((day) => day.meal_count > 0);
  const partialCalorieDays = calorieData.filter(
    (day) => day.meal_count > 0 && day.unknown_calorie_meals > 0,
  );
  const fullyUnknownCalorieDays = partialCalorieDays.filter((day) => day.known_calories === 0);
  const displayedHistory = historyState.initialized ? historyState.rows : (data?.history ?? []);
  const canLoadMoreHistory =
    visibleHistory < displayedHistory.length ||
    (historyState.initialized ? historyState.hasMore : (data?.history_has_more ?? false));

  useEffect(() => {
    if (!data) return;
    setHistoryState((current) => {
      const initial: HistoryState = {
        initialized: true,
        extraPagesLoaded: false,
        rows: data.history,
        cursor: data.history_next_cursor,
        hasMore: data.history_has_more,
      };
      if (!current.initialized || !current.extraPagesLoaded || data.history.length === 0) {
        return initial;
      }
      const initialIds = new Set(data.history.map((session) => session.id));
      return {
        ...current,
        rows: [...data.history, ...current.rows.filter((session) => !initialIds.has(session.id))],
      };
    });
  }, [data]);

  async function loadMoreHistory() {
    if (visibleHistory < historyState.rows.length) {
      setVisibleHistory((count) => Math.min(count + 20, historyState.rows.length));
      return;
    }
    if (!historyState.hasMore || !historyState.cursor || loadingHistoryRef.current) return;
    loadingHistoryRef.current = true;
    setLoadingHistory(true);
    setHistoryLoadError(false);
    try {
      const page = await getDashboardHistory({
        data: { limit: 50, before: historyState.cursor },
      });
      setHistoryState((current) => {
        const seen = new Set(current.rows.map((session) => session.id));
        return {
          initialized: true,
          extraPagesLoaded: true,
          rows: [...current.rows, ...page.history.filter((session) => !seen.has(session.id))],
          cursor: page.next_cursor,
          hasMore: page.has_more,
        };
      });
      setVisibleHistory((count) => count + 20);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        await hardNavigateToAuth(qc);
        return;
      }
      setHistoryLoadError(true);
      toast.error(error instanceof Error ? error.message : "Could not load older sessions");
    } finally {
      loadingHistoryRef.current = false;
      setLoadingHistory(false);
    }
  }

  async function submitWeight() {
    if (savingWeightRef.current) return;
    if (!data) return toast.error("Refresh your dashboard before logging weight");
    const kg = parseFloat(weightInput.replace(",", "."));
    if (!kg || kg < 25 || kg > 400) return toast.error("Enter a weight in kg");
    savingWeightRef.current = true;
    setSavingWeight(true);
    try {
      await whilePwaUpdateBlocked("weight-save", () =>
        logWeight({
          data: {
            weight_kg: kg,
            local_date: localContext.date,
            timezone: localContext.timezone,
            expected_data_epoch: data.data_epoch,
          },
        }),
      );
      setWeightInput("");
      await qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(`Logged ${kg} kg`);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await hardNavigateToAuth(qc);
        return;
      }
      if (err instanceof Error && err.message.includes("data_epoch_conflict")) {
        await qc.invalidateQueries({ queryKey: ["dashboard"] });
        toast.error("Your account changed on another screen. Dashboard refreshed.");
        return;
      }
      toast.error(err instanceof Error ? err.message : "Could not log weight");
    } finally {
      savingWeightRef.current = false;
      setSavingWeight(false);
    }
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="border-b border-border bg-card px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div>
          <h1 className="font-display text-lg font-bold text-foreground">Dashboard</h1>
          <p className="text-[11px] text-muted-foreground">Your training, tracked.</p>
        </div>
      </header>

      <main className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {isLoading && (
          <div className="grid h-40 place-items-center">
            <Shimmer>Crunching your numbers…</Shimmer>
          </div>
        )}

        {isError && !data && (
          <div className="mx-auto mt-16 max-w-xs text-center">
            <XCircle className="mx-auto h-10 w-10 text-red-400" />
            <h2 className="mt-3 font-display text-lg font-bold text-foreground">
              Couldn’t load your dashboard
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Your tracking data is still safe on the server.
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="mt-5 min-h-11 rounded-xl border border-primary/60 px-5 text-sm font-bold text-primary disabled:opacity-50"
            >
              {isFetching ? "Retrying…" : "Retry"}
            </button>
          </div>
        )}

        {isError && data && (
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="flex min-h-11 w-full items-center justify-center rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 text-xs font-bold text-amber-300 disabled:opacity-50"
          >
            Showing last synced data · {isFetching ? "Retrying…" : "Retry sync"}
          </button>
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
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {lifts.slice(0, 8).map((l) => (
                      <button
                        key={l.name}
                        type="button"
                        onClick={() => setSelectedLift(l.name)}
                        className={`min-h-11 shrink-0 rounded-sm border px-3 text-[11px] font-semibold transition ${
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
                      <LineChart
                        data={lift?.points ?? []}
                        margin={{ top: 4, right: 8, left: -18, bottom: 0 }}
                      >
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
                    <BarChart
                      data={data.weeklyVolume}
                      margin={{ top: 4, right: 8, left: -18, bottom: 0 }}
                    >
                      <CartesianGrid stroke={C.grid} strokeDasharray="3 6" vertical={false} />
                      <XAxis
                        dataKey="week"
                        tickFormatter={fmtShort}
                        tick={{ fill: C.ink, fontSize: 10 }}
                        axisLine={{ stroke: C.grid }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: C.ink, fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                      />
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
                  aria-label="Today’s bodyweight in kilograms"
                  value={weightInput}
                  onChange={(e) => setWeightInput(e.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void submitWeight();
                  }}
                  inputMode="decimal"
                  enterKeyHint="done"
                  placeholder="Log today's weight (kg)"
                  className="h-10 flex-1 rounded-xl border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
                <button
                  type="button"
                  onClick={submitWeight}
                  disabled={savingWeight}
                  className="grid h-11 w-11 place-items-center rounded-xl bg-primary text-primary-foreground disabled:opacity-50"
                  aria-label="Log weight"
                >
                  <Plus
                    className={`h-4 w-4 ${savingWeight ? "animate-pulse" : ""}`}
                    strokeWidth={3}
                  />
                </button>
              </div>
              {data.bodyweight.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  Log your first weight to start the trend.
                </p>
              ) : (
                <div className="h-32">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={data.bodyweight}
                      margin={{ top: 4, right: 8, left: -18, bottom: 0 }}
                    >
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

            {selectedMetric && (
              <Card title="Coach tracking">
                <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
                  {customMeasurements.map((measurement) => (
                    <button
                      key={measurement.metric_key}
                      type="button"
                      onClick={() => setSelectedMetricKey(measurement.metric_key)}
                      aria-pressed={selectedMetric.metric_key === measurement.metric_key}
                      className={`min-h-11 shrink-0 rounded-sm border px-3 text-xs font-semibold transition ${
                        selectedMetric.metric_key === measurement.metric_key
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border bg-secondary/40 text-muted-foreground"
                      }`}
                    >
                      {measurement.label}
                    </button>
                  ))}
                </div>
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold text-foreground">
                    {selectedMetric.label}
                  </span>
                  <span className="font-display text-lg font-bold text-primary">
                    {selectedMetric.points.at(-1)?.value ?? "—"}{" "}
                    <span className="text-xs text-muted-foreground">{selectedMetric.unit}</span>
                  </span>
                </div>
                <div className="h-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={selectedMetric.points}
                      margin={{ top: 4, right: 8, left: -18, bottom: 0 }}
                    >
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
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelFormatter={(date) => fmtShort(String(date))}
                        formatter={(value: number) => [
                          `${value} ${selectedMetric.unit}`,
                          selectedMetric.label,
                        ]}
                      />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke={C.strength}
                        strokeWidth={2}
                        dot={{ r: 3, fill: C.strength, strokeWidth: 0 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            )}

            {/* Calories */}
            <Card title="Calories — last 3 weeks">
              {!hasCalorieData ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  Log meals (or snap photos in chat) to see daily calories here.
                </p>
              ) : (
                <div className="h-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={calorieData}
                      margin={{ top: 4, right: 8, left: -18, bottom: 0 }}
                    >
                      <CartesianGrid stroke={C.grid} strokeDasharray="3 6" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tickFormatter={fmtShort}
                        tick={{ fill: C.ink, fontSize: 10 }}
                        axisLine={{ stroke: C.grid }}
                        tickLine={false}
                      />
                      <YAxis
                        // Keep the target reference line inside the plot.
                        domain={[
                          0,
                          (dataMax: number) =>
                            Math.max(dataMax, (data.stats.calorie_target ?? 0) + 150),
                        ]}
                        tick={{ fill: C.ink, fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        cursor={{ fill: "rgba(255,255,255,0.03)" }}
                        content={({ active, payload }) => {
                          const point = payload?.[0]?.payload as
                            (typeof calorieData)[number] | undefined;
                          if (!active || !point) return null;
                          const calories =
                            point.meal_count === 0
                              ? "—"
                              : point.unknown_calorie_meals > 0
                                ? `${point.known_calories} + ? kcal`
                                : `${point.calories} kcal`;
                          const protein =
                            point.meal_count === 0
                              ? "—"
                              : point.unknown_protein_meals > 0
                                ? `${point.known_protein_g} + ? g`
                                : `${point.protein_g} g`;
                          return (
                            <div style={tooltipStyle} className="px-3 py-2 shadow-xl">
                              <div className="font-semibold text-foreground">
                                {fmtShort(point.date)}
                              </div>
                              <div className="mt-1 text-muted-foreground">Calories: {calories}</div>
                              <div className="text-muted-foreground">Protein: {protein}</div>
                            </div>
                          );
                        }}
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
                      <Bar dataKey="chart_calories" radius={[4, 4, 0, 0]} maxBarSize={14}>
                        {calorieData.map((day) => (
                          <Cell
                            key={day.date}
                            fill={day.unknown_calorie_meals > 0 ? C.weight : C.calories}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {hasCalorieData && (
                <p className="mt-1 text-center text-[10px] text-muted-foreground">
                  {partialCalorieDays.length > 0
                    ? `Amber is partial (+ ?); gaps are not zero.${
                        fullyUnknownCalorieDays.length > 0
                          ? ` ${fullyUnknownCalorieDays.length} day${fullyUnknownCalorieDays.length === 1 ? "" : "s"} had no estimate at all.`
                          : ""
                      }`
                    : "Gaps mean no meals were logged; they are not counted as zero."}
                </p>
              )}
            </Card>

            {/* Session history */}
            <Card title="Session history">
              {displayedHistory.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  Your completed and skipped sessions will appear here.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {displayedHistory.slice(0, visibleHistory).map((s) => {
                    const completed = s.status === "completed";
                    const closedWithoutCompletion =
                      s.status === "abandoned" || s.status === "skipped";
                    return (
                      <div
                        key={s.id}
                        className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2.5"
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          {completed ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                          ) : closedWithoutCompletion ? (
                            <XCircle className="h-4 w-4 shrink-0 text-red-400/70" />
                          ) : (
                            <Dumbbell className="h-4 w-4 shrink-0 text-primary" />
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
                            completed
                              ? "text-emerald-400"
                              : closedWithoutCompletion
                                ? "text-red-400/70"
                                : "text-primary"
                          }`}
                        >
                          {s.status}
                        </span>
                      </div>
                    );
                  })}
                  {canLoadMoreHistory && (
                    <button
                      type="button"
                      onClick={() => void loadMoreHistory()}
                      disabled={loadingHistory}
                      className="min-h-11 w-full rounded-xl border border-border px-3 text-xs font-bold text-primary disabled:opacity-50"
                    >
                      {loadingHistory
                        ? "Loading older sessions…"
                        : historyLoadError
                          ? "Retry older sessions"
                          : "Load 20 more"}
                    </button>
                  )}
                  {!canLoadMoreHistory && displayedHistory.length > 50 && (
                    <p className="px-2 py-2 text-center text-[11px] text-muted-foreground">
                      Full server history loaded.
                    </p>
                  )}
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
