import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Brain,
  Camera,
  Dumbbell,
  HeartPulse,
  ListChecks,
} from "lucide-react";
import { InstallAppButton } from "@/components/InstallAppButton";
import { VersionTag } from "@/components/VersionTag";

type Feature = {
  number: string;
  icon: React.ReactNode;
  title: string;
  body: string;
};

const FEATURES: Feature[] = [
  {
    number: "01",
    icon: <Dumbbell className="h-5 w-5" strokeWidth={2.3} />,
    title: "Workout coaching",
    body: "Form guidance, exercise help, and motivation while you train.",
  },
  {
    number: "02",
    icon: <ListChecks className="h-5 w-5" strokeWidth={2.3} />,
    title: "Your workout plan",
    body: "Built around your goals, schedule, experience, and equipment.",
  },
  {
    number: "03",
    icon: <Camera className="h-5 w-5" strokeWidth={2.3} />,
    title: "Photo calorie tracking",
    body: "Snap a meal to estimate and log its calories and macros.",
  },
  {
    number: "04",
    icon: <HeartPulse className="h-5 w-5" strokeWidth={2.3} />,
    title: "Progress dashboard",
    body: "Track weight, gains, heart rate, habits, or anything you choose.",
  },
  {
    number: "05",
    icon: <Brain className="h-5 w-5" strokeWidth={2.3} />,
    title: "Permanent memory",
    body: "Remembers your preferences, style, goals, and workout history.",
  },
];

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "COACH — your complete AI fitness coach" },
      {
        name: "description",
        content:
          "One AI coach for workouts, personalized training plans, photo calorie tracking, progress dashboards, and permanent memory.",
      },
      { property: "og:title", content: "COACH — your complete AI fitness coach" },
      {
        property: "og:description",
        content:
          "Train, plan, eat, track, and improve with one AI coach that remembers you.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="h-dvh overflow-hidden bg-black text-foreground">
      <div className="relative mx-auto flex h-full w-full max-w-md flex-col overflow-hidden border-x border-border bg-background">
        {/* Reserved cover-image area */}
        <section className="relative h-[clamp(10rem,40dvh,22rem)] shrink-0 overflow-hidden bg-card">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_65%,rgba(255,31,55,0.12),transparent_58%)]" />
          <img
            src="/icons/icon-512.png"
            alt=""
            className="absolute left-1/2 top-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 opacity-20"
          />
          <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-background to-transparent" />

          <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <Link to="/" className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center bg-primary font-display text-[10px] font-black text-primary-foreground">
                C
              </span>
              <span className="font-display text-xs font-black uppercase tracking-[0.08em]">
                COACH
              </span>
              <VersionTag />
            </Link>
            <div className="flex items-center gap-2">
              <InstallAppButton className="flex h-8 items-center gap-1.5 border border-primary/50 bg-background/70 px-2.5 font-display text-[9px] font-bold uppercase tracking-[0.1em] text-primary backdrop-blur transition active:scale-95" />
              <Link
                to="/auth"
                className="flex h-8 items-center border border-border bg-background/70 px-3 font-display text-[9px] font-bold uppercase tracking-[0.1em] backdrop-blur transition hover:border-primary hover:text-primary"
              >
                Sign in
              </Link>
            </div>
          </header>
        </section>

        <main className="flex min-h-0 flex-1 flex-col px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <section className="shrink-0">
            <p className="font-display text-[8px] font-bold uppercase tracking-[0.22em] text-primary">
              Your complete fitness system
            </p>
            <h1 className="mt-1 font-display text-[26px] font-black uppercase leading-[0.92] tracking-[-0.045em]">
              One coach. Everything connected.
            </h1>
            <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
              Plan, train, eat, track, and improve with one coach that remembers you.
            </p>
          </section>

          <section className="mt-2 flex min-h-0 flex-1 flex-col">
            <p className="mb-1 shrink-0 font-display text-[7px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
              What COACH handles
            </p>
            <div className="grid min-h-0 flex-1 grid-rows-5 border-y border-border">
              {FEATURES.map((feature) => (
                <article
                  key={feature.number}
                  className="grid min-h-0 grid-cols-[1.5rem_1fr_auto] items-center gap-2 border-b border-border last:border-b-0"
                >
                  <span className="text-primary [&>svg]:h-4 [&>svg]:w-4">{feature.icon}</span>
                  <div className="min-w-0">
                    <h2 className="font-display text-[9px] font-black uppercase leading-tight tracking-[0.02em]">
                      {feature.title}
                    </h2>
                    <p className="mt-0.5 truncate text-[8px] leading-tight text-muted-foreground">
                      {feature.body}
                    </p>
                  </div>
                  <span className="font-mono text-[7px] tracking-[0.12em] text-muted-foreground/30">
                    {feature.number}
                  </span>
                </article>
              ))}
            </div>
            <Link
              to="/auth"
              className="mt-2 flex h-10 shrink-0 items-center justify-between bg-primary px-4 font-display text-[10px] font-black uppercase tracking-[0.08em] text-primary-foreground transition active:scale-[0.98]"
            >
              Start training
              <ArrowUpRight className="h-4 w-4" strokeWidth={2.5} />
            </Link>
          </section>
        </main>
      </div>
    </div>
  );
}
