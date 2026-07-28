import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowLeft,
  Bot,
  CreditCard,
  Dumbbell,
  Loader2,
  MessageCircle,
  RefreshCw,
  UserPlus,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { getAdminAnalytics } from "@/lib/analytics.functions";

export const Route = createFileRoute("/_authenticated/admin-analytics")({
  component: AdminAnalyticsPage,
  head: () => ({
    meta: [
      { title: "Business analytics | COACH" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
  }),
});

type RangeDays = 7 | 30 | 90 | 365;
type AnalyticsData = Awaited<ReturnType<typeof getAdminAnalytics>>;

const tooltipStyle = {
  backgroundColor: "#181818",
  border: "1px solid #343434",
  borderRadius: 8,
  color: "#f4f4f5",
  fontSize: 12,
} as const;

const number = new Intl.NumberFormat("en-US");
const currency = (minor: number, code: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code.toUpperCase(),
  }).format(minor / 100);

function Stat({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-primary">
        <Icon className="h-4 w-4" />
        <span className="text-[10px] font-black uppercase tracking-[0.15em]">{label}</span>
      </div>
      <p className="mt-2 font-display text-2xl font-black">{value}</p>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
    </section>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-4 text-xs font-black uppercase tracking-[0.15em] text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function percent(value: number, total: number) {
  if (total <= 0 || value > total) return "—";
  return `${Math.round((value / total) * 100)}%`;
}

function barWidth(value: number, total: number) {
  if (total <= 0) return "0%";
  return `${Math.min(100, Math.round((value / total) * 100))}%`;
}

function AdminAnalyticsPage() {
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);
  const query = useQuery({
    queryKey: ["admin-business-analytics", rangeDays],
    queryFn: () => getAdminAnalytics({ data: { range_days: rangeDays } }),
    retry: false,
    refetchInterval: 60_000,
  });

  if (query.isLoading) {
    return (
      <main className="grid min-h-dvh place-items-center bg-background">
        <Loader2 className="animate-spin text-primary" />
      </main>
    );
  }

  if (query.isError || !query.data) {
    return (
      <main className="min-h-dvh bg-background px-4 py-6">
        <div className="mx-auto max-w-lg border border-destructive/50 bg-destructive/10 p-5">
          <h1 className="font-black uppercase">Access denied</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This private dashboard requires an allowlisted administrator account
            {import.meta.env.PROD ? " with production MFA enabled." : "."}
          </p>
          <Link className="mt-4 inline-flex min-h-11 items-center gap-2 text-primary" to="/account">
            <ArrowLeft className="h-4 w-4" /> Back to account
          </Link>
        </div>
      </main>
    );
  }

  const data = query.data as AnalyticsData;
  const funnel = [
    ["Visitors", data.funnel.visitors],
    ["Signup starts", data.funnel.signup_started],
    ["Registered", data.funnel.registrations],
    ["Onboarded", data.funnel.onboarding_completed],
    ["Checkout starts", data.funnel.checkout_started],
    ["Checkout complete", data.funnel.checkout_completed],
    ["Active payers", data.funnel.active_payers],
  ] as const;
  const revenue =
    data.business.revenue.length === 0
      ? "No payments"
      : data.business.revenue
          .map((row) => currency(row.net_amount_minor, row.currency))
          .join(" + ");

  return (
    <main className="min-h-dvh bg-background px-3 py-4 text-foreground sm:px-6">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              to="/admin"
              aria-label="Back to users"
              className="grid h-11 w-11 place-items-center border border-border"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <h1 className="font-display text-2xl font-black uppercase">Business analytics</h1>
              <p className="text-xs text-muted-foreground">
                Read-only · {data.timezone} · updated{" "}
                {new Date(data.generated_at).toLocaleTimeString()}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {([7, 30, 90, 365] as const).map((days) => (
              <Button
                key={days}
                size="sm"
                variant={rangeDays === days ? "default" : "outline"}
                onClick={() => setRangeDays(days)}
              >
                {days === 365 ? "1y" : `${days}d`}
              </Button>
            ))}
            <Button
              size="icon"
              variant="outline"
              aria-label="Refresh analytics"
              onClick={() => query.refetch()}
            >
              <RefreshCw className={query.isFetching ? "animate-spin" : ""} />
            </Button>
          </div>
        </header>

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
          <Stat icon={Users} label="Visitors" value={number.format(data.funnel.visitors)} />
          <Stat
            icon={UserPlus}
            label="Registered"
            value={number.format(data.funnel.registrations)}
            detail={`${percent(data.funnel.registrations, data.funnel.visitors)} of visitors`}
          />
          <Stat
            icon={Activity}
            label="Active users"
            value={number.format(data.business.active_users)}
          />
          <Stat
            icon={CreditCard}
            label="Subscriptions"
            value={number.format(data.business.active_subscriptions)}
          />
          <Stat icon={CreditCard} label="Net payments" value={revenue} />
          <Stat
            icon={MessageCircle}
            label="Messages"
            value={number.format(data.product.user_messages)}
          />
          <Stat
            icon={Dumbbell}
            label="Workouts"
            value={number.format(data.product.workouts_completed)}
            detail={`${data.product.workouts_skipped} skipped`}
          />
          <Stat
            icon={Bot}
            label="AI cost"
            value={`$${data.ai.estimated_cost_usd.toFixed(2)}`}
            detail={`${number.format(data.ai.calls)} calls · ${data.ai.failed_calls} failed`}
          />
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Panel title="Acquisition and conversion">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.daily} margin={{ left: -20, right: 8 }}>
                  <CartesianGrid stroke="#292929" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fill: "#888", fontSize: 10 }} minTickGap={24} />
                  <YAxis tick={{ fill: "#888", fontSize: 10 }} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line
                    dataKey="views"
                    name="Page views"
                    stroke="#8a8a8a"
                    dot={false}
                    strokeWidth={2}
                  />
                  <Line
                    dataKey="registrations"
                    name="Registrations"
                    stroke="#ff1f3d"
                    dot={false}
                    strokeWidth={2}
                  />
                  <Line
                    dataKey="checkout_completed"
                    name="Checkouts"
                    stroke="#22c55e"
                    dot={false}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title="Funnel">
            <div className="space-y-3">
              {funnel.map(([label, value], index) => {
                const previous = index === 0 ? value : funnel[index - 1][1];
                return (
                  <div key={label}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="font-bold">{label}</span>
                      <span>
                        {number.format(value)}
                        {index > 0 && (
                          <span className="ml-2 text-muted-foreground">
                            {percent(value, previous)}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary"
                        style={{ width: barWidth(value, funnel[0][1]) }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title="Product usage">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.daily} margin={{ left: -20, right: 8 }}>
                  <CartesianGrid stroke="#292929" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fill: "#888", fontSize: 10 }} minTickGap={24} />
                  <YAxis tick={{ fill: "#888", fontSize: 10 }} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar
                    dataKey="workouts_completed"
                    name="Workouts"
                    fill="#ff1f3d"
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar dataKey="meals" name="Meals" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="tracking" name="Tracking" fill="#22c55e" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title="AI usage and cost">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.daily} margin={{ left: -20, right: 8 }}>
                  <CartesianGrid stroke="#292929" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fill: "#888", fontSize: 10 }} minTickGap={24} />
                  <YAxis tick={{ fill: "#888", fontSize: 10 }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line
                    dataKey="ai_calls"
                    name="AI calls"
                    stroke="#a855f7"
                    dot={false}
                    strokeWidth={2}
                  />
                  <Line
                    dataKey="ai_cost_usd"
                    name="Cost USD"
                    stroke="#f59e0b"
                    dot={false}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {number.format(data.ai.total_tokens)} tokens · {data.ai.unpriced_calls} unpriced calls
            </p>
          </Panel>
        </div>

        <div className="mt-3 grid gap-3 xl:grid-cols-3">
          <Panel title="Product totals">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {Object.entries(data.product).map(([key, value]) => (
                <div key={key} className="border-b border-border pb-2">
                  <dt className="text-[10px] font-bold uppercase text-muted-foreground">
                    {key.replaceAll("_", " ")}
                  </dt>
                  <dd className="mt-1 font-black">{number.format(value)}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel title="Recent registrations">
            <div className="max-h-80 overflow-auto">
              {data.recent_registrations.map((user) => (
                <div key={user.id} className="border-b border-border py-2 text-xs">
                  <p className="truncate font-bold">{user.email}</p>
                  <p className="text-muted-foreground">
                    {user.email_verified ? "Verified" : "Unverified"} ·{" "}
                    {user.created_at ? new Date(user.created_at).toLocaleString() : "Unknown"}
                  </p>
                </div>
              ))}
              {data.recent_registrations.length === 0 && (
                <p className="text-sm text-muted-foreground">No registrations.</p>
              )}
            </div>
          </Panel>

          <Panel title="Active subscribers">
            <div className="max-h-80 overflow-auto">
              {data.active_subscribers.map((subscriber) => (
                <div key={subscriber.id} className="border-b border-border py-2 text-xs">
                  <p className="truncate font-bold">{subscriber.email}</p>
                  <p className="text-muted-foreground">
                    {subscriber.plan} · {subscriber.status}
                    {subscriber.billing_interval ? ` · ${subscriber.billing_interval}` : ""}
                  </p>
                </div>
              ))}
              {data.active_subscribers.length === 0 && (
                <p className="text-sm text-muted-foreground">No active subscriptions.</p>
              )}
            </div>
          </Panel>
        </div>

        <Panel title="Recent privacy-minimal activity">
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-card text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">Event</th>
                  <th className="py-2 pr-4">Account</th>
                  <th className="py-2">Detail</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_activity.map((row, index) => (
                  <tr
                    key={`${row.occurred_at}:${row.event_type}:${index}`}
                    className="border-t border-border"
                  >
                    <td className="whitespace-nowrap py-2 pr-4 text-muted-foreground">
                      {row.occurred_at ? new Date(row.occurred_at).toLocaleString() : "Unknown"}
                    </td>
                    <td className="py-2 pr-4 font-bold">{row.event_type.replaceAll("_", " ")}</td>
                    <td className="max-w-56 truncate py-2 pr-4">
                      {row.actor_email || "Anonymous"}
                    </td>
                    <td className="max-w-72 truncate py-2 text-muted-foreground">
                      {row.detail || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </main>
  );
}
