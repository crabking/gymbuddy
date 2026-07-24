import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowDown,
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
  label: string;
  title: string;
  body: string;
};

const FEATURES: Feature[] = [
  {
    number: "01",
    icon: <Dumbbell className="h-5 w-5" strokeWidth={2.3} />,
    label: "During the workout",
    title: "A coach in your pocket",
    body: "Get form guidance, clear exercise explanations, live help between sets, and motivation when you need it.",
  },
  {
    number: "02",
    icon: <ListChecks className="h-5 w-5" strokeWidth={2.3} />,
    label: "Your training",
    title: "A plan built around you",
    body: "Your coach builds and adjusts a workout plan around your goals, experience, schedule, equipment, and recovery.",
  },
  {
    number: "03",
    icon: <Camera className="h-5 w-5" strokeWidth={2.3} />,
    label: "Your nutrition",
    title: "Calories from a photo",
    body: "Snap your food and your coach estimates calories and macros, logs the meal, and helps keep your nutrition on track.",
  },
  {
    number: "04",
    icon: <HeartPulse className="h-5 w-5" strokeWidth={2.3} />,
    label: "Your progress",
    title: "Track what matters to you",
    body: "Weight, lifts, measurements, heart rate, habits, or anything else—your coach sets it up in your personal dashboard.",
  },
  {
    number: "05",
    icon: <Brain className="h-5 w-5" strokeWidth={2.3} />,
    label: "Your history",
    title: "A coach that remembers",
    body: "Permanent memory keeps your preferences, training style, goals, injuries, meals, and workout history available across sessions.",
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
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center bg-primary font-display text-xs font-black text-primary-foreground">
              GB
            </span>
            <span className="hidden font-display text-sm font-black uppercase tracking-[0.08em] min-[430px]:inline">
              Gym Buddy
            </span>
            <VersionTag />
          </Link>

          <div className="flex items-center gap-2">
            <InstallAppButton className="flex h-9 items-center gap-2 border border-primary/50 px-3 font-display text-[10px] font-bold uppercase tracking-[0.12em] text-primary transition hover:bg-primary/10 active:scale-95" />
            <Link
              to="/auth"
              className="flex h-9 items-center border border-border px-3.5 font-display text-[10px] font-bold uppercase tracking-[0.12em] text-foreground transition hover:border-primary hover:text-primary"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl gap-12 px-5 pb-16 pt-14 sm:px-8 sm:pb-24 sm:pt-20 lg:grid-cols-[0.9fr_1.1fr] lg:items-end lg:gap-20 lg:pt-28">
          <div>
            <p className="font-display text-[10px] font-bold uppercase tracking-[0.24em] text-primary">
              Your complete fitness system
            </p>
            <h1 className="mt-5 max-w-xl font-display text-5xl font-black uppercase leading-[0.9] tracking-[-0.055em] sm:text-7xl">
              One coach.
              <br />
              Every part
              <br />
              of fitness.
            </h1>
          </div>

          <div className="max-w-xl lg:pb-1">
            <p className="text-lg leading-relaxed text-muted-foreground sm:text-xl">
              Gym Buddy stays with you through the whole process—from planning the workout to
              tracking the result.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="#what-it-does"
                className="flex h-12 items-center gap-3 bg-primary px-5 font-display text-xs font-black uppercase tracking-[0.1em] text-primary-foreground transition hover:brightness-110 active:scale-[0.98]"
              >
                See what it does
                <ArrowDown className="h-4 w-4" strokeWidth={2.5} />
              </a>
              <Link
                to="/auth"
                className="flex h-12 items-center gap-3 border border-border px-5 font-display text-xs font-black uppercase tracking-[0.1em] transition hover:border-primary hover:text-primary active:scale-[0.98]"
              >
                Start training
                <ArrowUpRight className="h-4 w-4" strokeWidth={2.5} />
              </Link>
            </div>
          </div>
        </section>

        <section id="what-it-does" className="border-t border-border">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
            <div className="mb-9 flex items-end justify-between gap-6 sm:mb-12">
              <div>
                <p className="font-display text-[10px] font-bold uppercase tracking-[0.24em] text-primary">
                  What Gym Buddy does
                </p>
                <h2 className="mt-3 font-display text-3xl font-black uppercase tracking-[-0.035em] sm:text-4xl">
                  The whole journey. Connected.
                </h2>
              </div>
              <span className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/50 sm:block">
                5 core systems
              </span>
            </div>

            <div className="grid border-l border-t border-border md:grid-cols-2">
              {FEATURES.map((feature, index) => (
                <article
                  key={feature.number}
                  className={`group border-b border-r border-border p-6 transition hover:bg-card/40 sm:p-8 md:min-h-64 ${
                    index === FEATURES.length - 1 ? "md:col-span-2" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <span className="grid h-10 w-10 place-items-center border border-primary/40 text-primary">
                      {feature.icon}
                    </span>
                    <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground/40">
                      {feature.number}
                    </span>
                  </div>
                  <p className="mt-8 font-display text-[9px] font-bold uppercase tracking-[0.22em] text-primary">
                    {feature.label}
                  </p>
                  <h3 className="mt-2 font-display text-2xl font-black uppercase tracking-[-0.025em]">
                    {feature.title}
                  </h3>
                  <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
                    {feature.body}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-border">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-7 px-5 py-14 sm:flex-row sm:items-center sm:px-8 sm:py-16">
            <div>
              <p className="font-display text-[10px] font-bold uppercase tracking-[0.24em] text-primary">
                Built around one person
              </p>
              <h2 className="mt-2 font-display text-3xl font-black uppercase tracking-[-0.035em]">
                You.
              </h2>
            </div>
            <Link
              to="/auth"
              className="flex h-14 w-full items-center justify-between bg-primary px-5 font-display text-sm font-black uppercase tracking-[0.08em] text-primary-foreground transition hover:brightness-110 active:scale-[0.98] sm:w-72"
            >
              Start training
              <ArrowUpRight className="h-5 w-5" strokeWidth={2.5} />
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
