import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Brain, Camera, Dumbbell, HeartPulse, ListChecks } from "lucide-react";
import coverImage from "@/assets/coach-rex-male.jpg";
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
        content: "Train, plan, eat, track, and improve with one AI coach that remembers you.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
      <section className="relative h-[45dvh] shrink-0 overflow-hidden bg-card">
        <img
          src={coverImage}
          alt="Your AI fitness coach"
          className="h-full w-full object-cover object-top"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/65 via-transparent to-background" />

        <header className="absolute inset-x-0 top-0 z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6">
          <Link to="/" className="flex min-h-11 items-center gap-2">
            <span className="grid h-8 w-8 place-items-center bg-primary font-display text-xs font-black text-primary-foreground">
              C
            </span>
            <span className="font-display text-sm font-black uppercase tracking-[0.08em]">
              COACH
            </span>
            <VersionTag />
          </Link>
          <div className="flex items-center gap-2">
            <InstallAppButton className="flex h-11 items-center gap-1.5 border border-primary/60 bg-background/70 px-3 font-display text-[10px] font-bold uppercase tracking-[0.1em] text-primary backdrop-blur transition active:scale-95" />
          </div>
        </header>
      </section>

      <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
        <section className="shrink-0">
          <p className="font-display text-[9px] font-bold uppercase tracking-[0.22em] text-primary">
            Your complete fitness system
          </p>
          <h1 className="mt-1 font-display text-2xl font-black uppercase leading-none tracking-[-0.04em] sm:text-3xl">
            One coach. Everything connected.
          </h1>
          <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground sm:text-xs">
            Plan, train, eat, track, and improve with one coach that remembers you.
          </p>
        </section>

        <section className="mt-2 flex min-h-0 flex-1 flex-col">
          <div className="grid min-h-0 flex-1 grid-rows-5 border-y border-border">
            {FEATURES.map((feature) => (
              <article
                key={feature.number}
                className="grid min-h-0 grid-cols-[1.75rem_1fr_auto] items-center gap-2.5 border-b border-border last:border-b-0"
              >
                <span className="text-primary [&>svg]:h-[18px] [&>svg]:w-[18px]">
                  {feature.icon}
                </span>
                <div className="min-w-0">
                  <h2 className="font-display text-xs font-black uppercase leading-tight tracking-[0.01em] sm:text-[13px]">
                    {feature.title}
                  </h2>
                  <p className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground sm:text-[11px] [@media(max-height:600px)]:hidden">
                    {feature.body}
                  </p>
                </div>
                <span className="font-mono text-[8px] tracking-[0.12em] text-muted-foreground/35">
                  {feature.number}
                </span>
              </article>
            ))}
          </div>
          <Link
            to="/coaches"
            className="mt-2 flex h-11 shrink-0 items-center justify-between bg-primary px-4 font-display text-xs font-black uppercase tracking-[0.08em] text-primary-foreground transition active:scale-[0.98]"
          >
            Start training
            <ArrowUpRight className="h-4 w-4" strokeWidth={2.5} />
          </Link>
        </section>
      </main>
    </div>
  );
}
