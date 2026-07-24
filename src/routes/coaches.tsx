import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, Check, Dumbbell } from "lucide-react";
import { getCurrentUser } from "@/lib/auth.functions";
import { getProfile, updateProfile } from "@/lib/gym-buddy.functions";
import { COACH_IMAGES } from "@/lib/coach-assets";
import { COACHES, DEFAULT_COACH_ID, getCoach, type CoachId, type CoachLevel } from "@/lib/coaches";
import { VersionTag } from "@/components/VersionTag";

export const Route = createFileRoute("/coaches")({
  head: () => ({
    meta: [
      { title: "Choose your coach — COACH" },
      {
        name: "description",
        content: "Choose the coaching personality and intensity that fits you.",
      },
    ],
  }),
  component: CoachSelect,
});

const LEVEL_STYLE: Record<CoachLevel, string> = {
  beginner: "border-cyan-400/70 text-cyan-300 bg-cyan-400/10",
  intermediate: "border-primary/70 text-primary bg-primary/10",
  advanced: "border-red-500/70 text-red-400 bg-red-500/10",
};

const LEVEL_TEXT: Record<CoachLevel, string> = {
  beginner: "text-cyan-300",
  intermediate: "text-primary",
  advanced: "text-red-400",
};

function CoachSelect() {
  const navigate = useNavigate();
  const getCurrentUserFn = useServerFn(getCurrentUser);
  const getProfileFn = useServerFn(getProfile);
  const updateProfileFn = useServerFn(updateProfile);
  const [selectedId, setSelectedId] = useState<CoachId>(DEFAULT_COACH_ID);
  const [signedIn, setSignedIn] = useState(false);
  const [saving, setSaving] = useState(false);
  const selected = getCoach(selectedId);

  useEffect(() => {
    getCurrentUserFn({ data: undefined }).then(async (user) => {
      if (!user) return;
      setSignedIn(true);
      const profile = await getProfileFn({ data: undefined });
      if (profile?.coach_id) setSelectedId(getCoach(profile.coach_id).id);
    });
  }, [getCurrentUserFn, getProfileFn]);

  async function chooseCoach() {
    if (saving) return;
    setSaving(true);
    try {
      if (signedIn) {
        await updateProfileFn({ data: { coach_id: selectedId } });
        await navigate({ to: "/chat" });
      } else {
        await navigate({ to: "/auth", search: { coach: selectedId } });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
      <header className="mx-auto flex h-12 w-full max-w-5xl shrink-0 items-center justify-between border-b border-border px-3 pt-[env(safe-area-inset-top)] sm:px-5">
        <Link
          to="/"
          aria-label="Back"
          className="grid h-8 w-8 place-items-center text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex items-center gap-2">
          <Dumbbell className="h-4 w-4 text-primary" />
          <span className="font-display text-xs font-black uppercase tracking-[0.12em]">
            Choose your coach
          </span>
          <VersionTag />
        </div>
        {!signedIn ? (
          <Link
            to="/auth"
            className="font-display text-[9px] font-bold uppercase tracking-widest text-muted-foreground"
          >
            Sign in
          </Link>
        ) : (
          <span className="w-8" />
        )}
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-2.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 sm:px-5">
        <div className="mb-1.5 flex shrink-0 items-end justify-between gap-3 px-0.5">
          <div>
            <p className="font-display text-[8px] font-bold uppercase tracking-[0.22em] text-primary">
              Pick your intensity
            </p>
            <h1 className="font-display text-lg font-black uppercase leading-none sm:text-2xl">
              Who fits you?
            </h1>
          </div>
          <div className="hidden gap-3 text-[8px] font-bold uppercase tracking-widest text-muted-foreground sm:flex">
            <span className="text-cyan-300">Beginner</span>
            <span className="text-primary">Intermediate</span>
            <span className="text-red-400">Advanced</span>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-3 grid-rows-2 gap-1.5 sm:gap-2">
          {COACHES.map((coach) => {
            const active = coach.id === selectedId;
            return (
              <button
                key={coach.id}
                type="button"
                aria-pressed={active}
                aria-label={`${coach.name}, ${coach.level} coach`}
                onMouseEnter={() => setSelectedId(coach.id)}
                onFocus={() => setSelectedId(coach.id)}
                onClick={() => setSelectedId(coach.id)}
                className={`group relative min-h-0 overflow-hidden border text-left transition ${
                  active
                    ? `${LEVEL_STYLE[coach.level]} ring-1 ring-current`
                    : "border-border bg-card hover:border-muted-foreground/60"
                }`}
              >
                <img
                  src={COACH_IMAGES[coach.id].full}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover object-top transition duration-300 group-hover:scale-[1.03]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/5 to-transparent" />
                <div
                  className={`absolute left-1.5 top-1.5 border px-1.5 py-0.5 font-display text-[7px] font-black uppercase tracking-wider backdrop-blur-sm sm:text-[8px] ${LEVEL_STYLE[coach.level]}`}
                >
                  {coach.level}
                </div>
                {active && (
                  <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center bg-foreground text-background">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                )}
                <div className="absolute inset-x-0 bottom-0 p-1.5 sm:p-2.5">
                  <span className="block font-display text-sm font-black uppercase leading-none text-white sm:text-xl">
                    {coach.name}
                  </span>
                  <span className="mt-1 hidden text-[9px] leading-tight text-white/75 opacity-0 transition group-hover:opacity-100 sm:block">
                    {coach.summary}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <section className="mt-1.5 grid shrink-0 grid-cols-[1fr_auto] items-center gap-3 border border-border bg-card px-3 py-2 sm:mt-2 sm:px-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={`font-display text-[8px] font-black uppercase tracking-[0.18em] ${LEVEL_TEXT[selected.level]}`}
              >
                {selected.level}
              </span>
              <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
                {selected.gender}
              </span>
            </div>
            <p className="truncate font-display text-sm font-black uppercase sm:text-base">
              {selected.tagline}
            </p>
            <p className="line-clamp-2 text-[9px] leading-tight text-muted-foreground sm:text-[10px]">
              {selected.summary}
            </p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={chooseCoach}
            className={`flex h-10 items-center gap-2 px-3 font-display text-[9px] font-black uppercase tracking-wider text-white transition active:scale-[0.98] disabled:opacity-60 ${
              selected.level === "advanced"
                ? "bg-red-600"
                : selected.level === "beginner"
                  ? "bg-cyan-600"
                  : "bg-primary text-primary-foreground"
            }`}
          >
            {saving ? "Saving…" : `Train with ${selected.name}`}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </section>
      </main>
    </div>
  );
}
