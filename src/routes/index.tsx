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
      { title: "Gym Buddy — your complete AI fitness coach" },
      {
        name: "description",
        content:
          "One AI coach for workouts, personalized training plans, photo calorie tracking, progress dashboards, and permanent memory.",
      },
      { property: "og:title", content: "Gym Buddy — your complete AI fitness coach" },
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
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <header className="shrink-0 border-b border-border">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-8">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center bg-primary font-display text-[10px] font-black text-primary-foreground">
              GB
            </span>
            <span className="hidden font-display text-sm font-black uppercase tracking-[0.08em] min-[430px]:inline">
              Gym Buddy
            </span>
            <VersionTag />
          </Link>

          <div className="flex items-center gap-2">
            <InstallAppButton className="flex h-8 items-center gap-1.5 border border-primary/50 px-2.5 font-display text-[9px] font-bold uppercase tracking-[0.1em] text-primary transition hover:bg-primary/10 active:scale-95" />
            <Link
              to="/auth"
              className="flex h-8 items-center border border-border px-3 font-display text-[9px] font-bold uppercase tracking-[0.1em] text-foreground transition hover:border-primary hover:text-primary"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-4 sm:px-8 sm:pt-6 md:grid md:grid-cols-[0.75fr_1.25fr] md:gap-8 md:py-6 lg:gap-14 lg:py-10">
        <section className="shrink-0 md:flex md:flex-col md:justify-center">
          <div className="max-w-lg">
            <p className="font-display text-[10px] font-bold uppercase tracking-[0.24em] text-primary">
              Your complete fitness system
            </p>
            <h1 className="mt-2 font-display text-[clamp(2rem,9vw,3.5rem)] font-black uppercase leading-[0.88] tracking-[-0.055em] md:text-5xl lg:mt-5 lg:text-7xl">
              One coach.
              <br />
              Every part of fitness.
            </h1>
            <p className="mt-3 max-w-md text-xs leading-snug text-muted-foreground sm:text-sm lg:mt-6 lg:text-lg lg:leading-relaxed">
              Gym Buddy stays with you through the whole process—from planning the workout to
              tracking the result.
            </p>
          </div>
        </section>

        <section className="mt-4 flex min-h-0 flex-1 flex-col md:mt-0">
          <p className="mb-2 shrink-0 font-display text-[8px] font-bold uppercase tracking-[0.22em] text-primary">
            What your coach handles
          </p>
          <div className="grid min-h-0 flex-1 grid-rows-5 border-l border-t border-border">
            {FEATURES.map((feature) => (
              <article
                key={feature.number}
                className="grid min-h-0 grid-cols-[2rem_1fr_auto] items-center gap-3 border-b border-r border-border px-3 py-1.5 transition hover:bg-card/40 sm:grid-cols-[2.5rem_1fr_auto] sm:px-4"
              >
                <span className="grid h-8 w-8 place-items-center border border-primary/40 text-primary sm:h-10 sm:w-10">
                  {feature.icon}
                </span>
                <div className="min-w-0">
                  <h2 className="font-display text-[11px] font-black uppercase leading-tight tracking-[0.01em] sm:text-sm">
                    {feature.title}
                  </h2>
                  <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground sm:text-xs">
                    {feature.body}
                  </p>
                </div>
                <span className="self-start pt-1 font-mono text-[8px] tracking-[0.14em] text-muted-foreground/35">
                  {feature.number}
                </span>
              </article>
            ))}
          </div>
          <Link
            to="/auth"
            className="mt-3 flex h-11 shrink-0 items-center justify-between bg-primary px-4 font-display text-xs font-black uppercase tracking-[0.08em] text-primary-foreground transition hover:brightness-110 active:scale-[0.98] md:h-12 lg:h-14 lg:text-sm"
          >
            Start training
            <ArrowUpRight className="h-4 w-4" strokeWidth={2.5} />
          </Link>
        </section>
      </main>
    </div>
  );
}
