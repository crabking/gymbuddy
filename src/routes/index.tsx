import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Music, CalendarDays, Brain, Camera, Dumbbell } from "lucide-react";
import { useEffect, useState } from "react";
import coachMale from "@/assets/coach-rex-male.jpg";
import coachFemale from "@/assets/coach-rex-female.jpg";
import { InstallAppButton } from "@/components/InstallAppButton";

const COACH_KEY = "rex.coach";
type CoachGender = "male" | "female";

type Feature = {
  id: string;
  icon: React.ReactNode;
  title: string;
  body: (name: string) => string;
};

const FEATURES: Feature[] = [
  {
    id: "music",
    icon: <Music className="h-5 w-5" strokeWidth={2.5} />,
    title: "Your soundtrack",
    body: (n) =>
      `${n} can spin up your lift playlist on Spotify, YouTube Music or Apple Music — just tell her the vibe.`,
  },
  {
    id: "schedule",
    icon: <CalendarDays className="h-5 w-5" strokeWidth={2.5} />,
    title: "Reads your week",
    body: (n) =>
      `Share your calendar or just talk it through — ${n} slots training around your real schedule.`,
  },
  {
    id: "memory",
    icon: <Brain className="h-5 w-5" strokeWidth={2.5} />,
    title: "Never forgets",
    body: (n) =>
      `Permanent memory. Tell ${n} once — your PRs, allergies, favorite gym — and it sticks forever.`,
  },
  {
    id: "meals",
    icon: <Camera className="h-5 w-5" strokeWidth={2.5} />,
    title: "Snap your meals",
    body: (n) =>
      `Photo any meal or snack. ${n} guesses the macros, logs them, and might roast your snickers bar.`,
  },
  {
    id: "form",
    icon: <Dumbbell className="h-5 w-5" strokeWidth={2.5} />,
    title: "Shows the form",
    body: (n) =>
      `Ask how to back squat and ${n} sends a reference image with the cues — every lift, every machine.`,
  },
];

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Meet Rex — your AI gym coach" },
      {
        name: "description",
        content:
          "Rex is your AI training partner. Writes your plan, logs your sets, counts your macros — all from one chat.",
      },
      { property: "og:title", content: "Meet Rex — your AI gym coach" },
      {
        property: "og:description",
        content:
          "Chat with Rex, an AI trainer that writes your plan, tracks your food, and pushes you between sets.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const [gender, setGender] = useState<CoachGender>("male");
  const [activeFeature, setActiveFeature] = useState<string>(FEATURES[0].id);

  useEffect(() => {
    const saved = localStorage.getItem(COACH_KEY);
    if (saved === "male" || saved === "female") setGender(saved);
  }, []);

  function choose(g: CoachGender) {
    setGender(g);
    localStorage.setItem(COACH_KEY, g);
  }

  const portrait = gender === "female" ? coachFemale : coachMale;
  const coachName = gender === "female" ? "REYA" : "REX";
  const displayName = gender === "female" ? "Reya" : "Rex";
  const feature = FEATURES.find((f) => f.id === activeFeature) ?? FEATURES[0];

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-background text-foreground">
      {/* Full-bleed coach */}
      <img
        key={gender}
        src={portrait}
        alt={`${coachName}, your AI gym coach`}
        className="absolute inset-0 h-full w-full object-cover object-top"
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-background via-background/85 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-background/70 to-transparent" />

      {/* Top-right actions */}
      <div className="absolute right-4 top-4 z-20 flex items-center gap-2 sm:right-6 sm:top-6">
        <InstallAppButton className="flex items-center gap-2 rounded-xl border border-primary/60 bg-background/80 px-3 py-2 font-display text-[11px] font-bold uppercase tracking-widest text-primary backdrop-blur transition active:scale-95" />
        <Link
          to="/auth"
          className="rounded-xl border border-border bg-background/70 px-4 py-2 font-display text-[11px] font-bold uppercase tracking-widest text-foreground backdrop-blur hover:border-primary hover:text-primary"
        >
          Sign in
        </Link>
      </div>

      {/* Floating gender picker */}
      <aside className="absolute left-3 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-2.5 sm:left-5">
        <GenderTile gender="male" active={gender === "male"} onClick={() => choose("male")} />
        <GenderTile gender="female" active={gender === "female"} onClick={() => choose("female")} />
      </aside>

      {/* Bottom content */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col gap-5 p-6 pl-20 sm:p-10 sm:pl-24">
        <div>
          <div className="font-display text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
            Meet your coach
          </div>
          <div className="mt-1 flex items-end justify-between gap-4">
            <h1 className="font-display text-6xl font-bold leading-none tracking-tight text-foreground sm:text-7xl">
              {coachName}
            </h1>
            <span className="pb-2 font-display text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              AI Trainer
            </span>
          </div>
        </div>

        {/* Feature icons */}
        <div className="flex gap-2">
          {FEATURES.map((f) => {
            const active = f.id === activeFeature;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setActiveFeature(f.id)}
                onMouseEnter={() => setActiveFeature(f.id)}
                aria-pressed={active}
                aria-label={f.title}
                className={`grid h-12 w-12 place-items-center rounded-2xl border shadow-lg shadow-black/40 backdrop-blur transition active:scale-95 ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/70 bg-background/80 text-foreground hover:border-primary/60 hover:text-primary"
                }`}
              >
                {f.icon}
              </button>
            );
          })}
        </div>

        {/* Feature description */}
        <div key={feature.id} className="min-h-[76px] animate-in fade-in slide-in-from-bottom-1 duration-200">
          <div className="font-display text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
            {feature.title}
          </div>
          <p className="mt-1 max-w-md text-[15px] leading-relaxed text-muted-foreground">
            {feature.body(displayName)}
          </p>
        </div>

        <Link
          to="/auth"
          className="group flex h-16 items-center justify-between rounded-2xl bg-primary px-6 text-primary-foreground transition active:scale-[0.98]"
        >
          <span className="font-display text-lg font-bold uppercase tracking-wide">
            Train with {displayName}
          </span>
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-foreground/10 transition group-hover:bg-primary-foreground/20">
            <ArrowUpRight className="h-5 w-5" strokeWidth={2.5} />
          </span>
        </Link>
      </div>
    </div>
  );
}

function GenderTile({
  gender,
  active,
  onClick,
}: {
  gender: CoachGender;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={gender === "male" ? "Male coach" : "Female coach"}
      className={`relative grid h-12 w-12 place-items-center rounded-2xl border shadow-lg shadow-black/40 backdrop-blur transition active:scale-95 ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border/70 bg-background/80 text-foreground hover:border-primary/60 hover:text-primary"
      }`}
    >
      <GenderGlyph gender={gender} />
    </button>
  );
}

function GenderGlyph({ gender }: { gender: CoachGender }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {gender === "male" ? (
        <>
          <circle cx="10" cy="14" r="5" />
          <path d="M14.5 9.5L20 4" />
          <path d="M15 4h5v5" />
        </>
      ) : (
        <>
          <circle cx="12" cy="9" r="5" />
          <path d="M12 14v7" />
          <path d="M9 18h6" />
        </>
      )}
    </svg>
  );
}
