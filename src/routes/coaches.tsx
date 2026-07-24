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
  intermediate: "border-lime-400/70 text-lime-300 bg-lime-400/10",
  advanced: "border-red-500/70 text-red-400 bg-red-500/10",
};

const LEVEL_ACTIVE: Record<CoachLevel, string> = {
  beginner:
    "border-cyan-300 ring-2 ring-cyan-300 shadow-[0_0_24px_rgba(34,211,238,0.5),inset_0_0_20px_rgba(34,211,238,0.1)]",
  intermediate:
    "border-lime-300 ring-2 ring-lime-300 shadow-[0_0_24px_rgba(163,230,53,0.5),inset_0_0_20px_rgba(163,230,53,0.1)]",
  advanced:
    "border-red-400 ring-2 ring-red-400 shadow-[0_0_24px_rgba(248,113,113,0.5),inset_0_0_20px_rgba(248,113,113,0.1)]",
};

const TRAIN_BUTTON: Record<CoachLevel, string> = {
  beginner: "bg-cyan-500 text-black",
  intermediate: "bg-lime-400 text-black",
  advanced: "bg-red-600 text-white",
};

const IMAGE_CROP: Record<CoachId, string> = {
  eli: "origin-top scale-[1.25]",
  rex: "origin-top scale-100",
  brutus: "origin-top scale-[1.32]",
  maya: "origin-top scale-[1.25]",
  reya: "origin-top scale-100",
  nova: "origin-top scale-100",
};

function CoachSelect() {
  const navigate = useNavigate();
  const getCurrentUserFn = useServerFn(getCurrentUser);
  const getProfileFn = useServerFn(getProfile);
  const updateProfileFn = useServerFn(updateProfile);
  const [selectedId, setSelectedId] = useState<CoachId>(DEFAULT_COACH_ID);
  const [signedIn, setSignedIn] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getCurrentUserFn({ data: undefined }).then(async (user) => {
      if (!user) return;
      setSignedIn(true);
      const profile = await getProfileFn({ data: undefined });
      if (profile?.coach_id) setSelectedId(getCoach(profile.coach_id).id);
    });
  }, [getCurrentUserFn, getProfileFn]);

  async function chooseCoach(coachId: CoachId) {
    if (saving) return;
    setSaving(true);
    try {
      if (signedIn) {
        await updateProfileFn({ data: { coach_id: coachId } });
        await navigate({ to: "/chat" });
      } else {
        await navigate({ to: "/auth", search: { coach: coachId } });
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
            <span className="text-lime-300">Intermediate</span>
            <span className="text-red-400">Advanced</span>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-3 grid-rows-2 gap-1.5 sm:gap-2">
          {COACHES.map((coach) => {
            const active = coach.id === selectedId;
            return (
              <article
                key={coach.id}
                className={`group relative min-h-0 overflow-hidden border bg-card text-left transition-all duration-200 ${
                  active
                    ? LEVEL_ACTIVE[coach.level]
                    : "border-border bg-card hover:border-muted-foreground/60"
                }`}
              >
                <img
                  src={COACH_IMAGES[coach.id].full}
                  alt=""
                  className={`absolute inset-0 h-full w-full object-cover object-top transition-transform duration-300 ${IMAGE_CROP[coach.id]}`}
                />
                <div
                  className={`absolute inset-0 transition ${
                    active
                      ? "bg-gradient-to-t from-black via-black/10 to-transparent"
                      : "bg-gradient-to-t from-black via-transparent to-transparent"
                  }`}
                />
                <button
                  type="button"
                  aria-pressed={active}
                  aria-label={`Select ${coach.name}, ${coach.level} coach`}
                  onFocus={() => setSelectedId(coach.id)}
                  onClick={() => setSelectedId(coach.id)}
                  className="absolute inset-0 z-10"
                >
                  <span className="sr-only">Select {coach.name}</span>
                </button>
                <div
                  className={`pointer-events-none absolute left-1.5 top-1.5 z-20 border px-1.5 py-0.5 font-display text-[7px] font-black uppercase tracking-wider backdrop-blur-sm sm:text-[8px] ${LEVEL_STYLE[coach.level]}`}
                >
                  {coach.level}
                </div>
                {active && (
                  <span className="pointer-events-none absolute right-1.5 top-1.5 z-20 grid h-5 w-5 place-items-center bg-white text-black shadow-[0_0_12px_rgba(255,255,255,0.8)]">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                )}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black via-black/90 to-transparent p-1.5 pt-8 sm:p-2.5 sm:pt-10">
                  <span className="block font-display text-sm font-black uppercase leading-none text-white sm:text-xl">
                    {coach.name}
                  </span>
                  <span
                    className={`mt-1 line-clamp-2 text-[7px] leading-[1.15] text-white/75 sm:text-[9px] ${
                      active ? "block" : "hidden sm:group-hover:block"
                    }`}
                  >
                    {coach.summary}
                  </span>
                  {active && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void chooseCoach(coach.id)}
                      className={`pointer-events-auto mt-1.5 flex h-7 w-full items-center justify-between gap-1 px-1.5 font-display text-[7px] font-black uppercase tracking-wide transition active:scale-[0.98] disabled:opacity-60 sm:h-8 sm:px-2 sm:text-[9px] ${TRAIN_BUTTON[coach.level]}`}
                    >
                      <span>{saving ? "Saving…" : "Train with"}</span>
                      <ArrowUpRight className="h-3 w-3 shrink-0" />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </main>
    </div>
  );
}
