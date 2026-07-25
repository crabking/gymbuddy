import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Check } from "lucide-react";
import { toast } from "sonner";
import { AppIcon } from "@/components/AppIcon";
import { getCurrentUser } from "@/lib/auth.functions";
import { getProfile, switchCoach, updateProfile } from "@/lib/gym-buddy.functions";
import { COACH_IMAGES } from "@/lib/coach-assets";
import { COACHES, DEFAULT_COACH_ID, getCoach, type CoachId, type CoachLevel } from "@/lib/coaches";
import { ConfirmModal } from "@/components/ConfirmModal";
import { VersionTag } from "@/components/VersionTag";
import { clearAccountCache, isUnauthorizedError } from "@/lib/client-session";
import { usePwaUpdateBlocker } from "@/lib/pwa-update";
import { LanguageProvider, useLanguage } from "@/components/LanguageProvider";
import { isLanguage, type Language } from "@/lib/i18n";

export const Route = createFileRoute("/coaches")({
  validateSearch: (search: Record<string, unknown>): { lang?: Language } =>
    isLanguage(search.lang) ? { lang: search.lang } : {},
  head: () => ({
    meta: [
      { title: "Choose your coach — COACH" },
      {
        name: "description",
        content: "Choose the coaching personality and intensity that fits you.",
      },
    ],
  }),
  component: CoachSelectRoute,
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

function CoachSelectRoute() {
  const { lang = "en" } = Route.useSearch();
  return (
    <LanguageProvider language={lang}>
      <CoachSelect language={lang} />
    </LanguageProvider>
  );
}

function CoachSelect({ language }: { language: Language }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const getCurrentUserFn = useServerFn(getCurrentUser);
  const getProfileFn = useServerFn(getProfile);
  const switchCoachFn = useServerFn(switchCoach);
  const updateProfileFn = useServerFn(updateProfile);
  const [selectedId, setSelectedId] = useState<CoachId>(DEFAULT_COACH_ID);
  const [currentCoachId, setCurrentCoachId] = useState<CoachId | null>(null);
  const [accountLanguage, setAccountLanguage] = useState<Language | null>(null);
  const [dataEpoch, setDataEpoch] = useState<number | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [pendingCoachId, setPendingCoachId] = useState<CoachId | null>(null);
  usePwaUpdateBlocker("coach-switch", saving);

  useEffect(() => {
    let active = true;
    setAuthReady(false);
    setLoadError(null);

    void (async () => {
      try {
        const user = await getCurrentUserFn({ data: undefined });
        if (!active) return;
        if (!user) {
          setSignedIn(false);
          setCurrentCoachId(null);
          return;
        }
        setSignedIn(true);
        const profile = await getProfileFn({ data: undefined });
        if (!active || !profile) return;
        setAccountLanguage(
          isLanguage(profile.preferred_language) ? profile.preferred_language : null,
        );
        setDataEpoch(profile.data_epoch);
        if (!profile.coach_id) return;
        const coachId = getCoach(profile.coach_id).id;
        setCurrentCoachId(coachId);
        setSelectedId(coachId);
      } catch (error) {
        if (!active) return;
        setLoadError(
          language === "en" && error instanceof Error ? error.message : t("coaches.load_error"),
        );
      } finally {
        if (active) setAuthReady(true);
      }
    })();

    return () => {
      active = false;
    };
  }, [getCurrentUserFn, getProfileFn, language, retryNonce, t]);

  async function activateCoach(coachId: CoachId) {
    if (!authReady || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      if (signedIn) {
        if (accountLanguage !== language && dataEpoch !== null) {
          await updateProfileFn({
            data: { preferred_language: language, expected_data_epoch: dataEpoch },
          });
        }
        if (coachId !== currentCoachId) {
          await switchCoachFn({ data: { coach_id: coachId } });
        }
        window.location.assign("/chat");
      } else {
        await navigate({ to: "/auth", search: { coach: coachId, lang: language } });
      }
    } catch (error) {
      if (isUnauthorizedError(error)) {
        await clearAccountCache(queryClient);
        window.location.replace(
          `/auth?coach=${encodeURIComponent(coachId)}&lang=${encodeURIComponent(language)}`,
        );
        return;
      }
      toast.error(
        language === "en" && error instanceof Error ? error.message : t("coaches.select_error"),
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function chooseCoach(coachId: CoachId) {
    if (!authReady || savingRef.current) return;
    if (signedIn && currentCoachId && coachId !== currentCoachId) {
      setPendingCoachId(coachId);
      return;
    }
    void activateCoach(coachId);
  }

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
      <header className="mx-auto flex min-h-12 w-full max-w-5xl shrink-0 items-center justify-between border-b border-border px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-5">
        <Link
          to="/"
          search={{ lang: language }}
          aria-label={t("common.back")}
          className="grid h-11 w-11 place-items-center text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex items-center gap-2">
          <AppIcon className="h-6 w-6 border border-primary/45" />
          <span className="font-display text-xs font-black uppercase tracking-[0.12em]">
            {t("coaches.choose")}
          </span>
          <VersionTag />
        </div>
        <div className="flex w-11 justify-end gap-0.5">
          {(["en", "sv"] as const).map((lang) => (
            <Link
              key={lang}
              to="/coaches"
              search={{ lang }}
              aria-label={lang === "sv" ? t("language.swedish") : t("language.english")}
              className={language === lang ? "opacity-100" : "opacity-35"}
            >
              <span aria-hidden="true">{lang === "sv" ? "🇸🇪" : "🇬🇧"}</span>
            </Link>
          ))}
        </div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-2.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 sm:px-5">
        <div className="mb-1.5 flex shrink-0 items-end justify-between gap-3 px-0.5">
          <div>
            <p className="font-display text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
              {t("coaches.pick_intensity")}
            </p>
            <h1 className="font-display text-lg font-black uppercase leading-none sm:text-2xl">
              {t("coaches.who_fits")}
            </h1>
          </div>
          <div className="hidden gap-3 text-[8px] font-bold uppercase tracking-widest text-muted-foreground sm:flex">
            <span className="text-cyan-300">{t("coaches.beginner")}</span>
            <span className="text-lime-300">{t("coaches.intermediate")}</span>
            <span className="text-red-400">{t("coaches.advanced")}</span>
          </div>
        </div>

        {loadError && (
          <div className="mb-1.5 flex min-h-11 shrink-0 items-center gap-2 border border-red-500/40 bg-red-500/10 px-2.5 text-[11px] text-red-200">
            <span className="min-w-0 flex-1 truncate">{t("coaches.account_error")}</span>
            <button
              type="button"
              onClick={() => setRetryNonce((value) => value + 1)}
              className="min-h-11 shrink-0 px-2 font-bold uppercase tracking-wide text-red-300"
            >
              {t("common.retry")}
            </button>
          </div>
        )}

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
                  aria-label={t("coaches.select", {
                    name: coach.name,
                    level: t(`coaches.${coach.level}`),
                  })}
                  onFocus={() => setSelectedId(coach.id)}
                  onClick={() => setSelectedId(coach.id)}
                  className="absolute inset-0 z-10"
                >
                  <span className="sr-only">
                    {t("coaches.select", {
                      name: coach.name,
                      level: t(`coaches.${coach.level}`),
                    })}
                  </span>
                </button>
                <div
                  className={`pointer-events-none absolute left-1.5 top-1.5 z-20 border px-1.5 py-0.5 font-display text-[9px] font-black uppercase tracking-wide backdrop-blur-sm sm:text-[10px] ${LEVEL_STYLE[coach.level]}`}
                >
                  {t(`coaches.${coach.level}`)}
                </div>
                {active && (
                  <span className="pointer-events-none absolute right-1.5 top-1.5 z-20 grid h-5 w-5 place-items-center bg-white text-black shadow-[0_0_12px_rgba(255,255,255,0.8)]">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                )}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black via-black/90 to-transparent p-1.5 pt-8 sm:p-2.5 sm:pt-10">
                  <span className="block font-display text-base font-black uppercase leading-none text-white sm:text-xl">
                    {coach.name}
                  </span>
                  <span
                    className={`mt-1 line-clamp-2 text-[11px] leading-[1.25] text-white/85 sm:text-xs ${
                      active ? "block" : "hidden sm:group-hover:block"
                    }`}
                  >
                    {language === "sv" ? coach.summary_sv : coach.summary}
                  </span>
                  {active && (
                    <button
                      type="button"
                      disabled={saving || !authReady || !!loadError}
                      onClick={() => void chooseCoach(coach.id)}
                      className={`pointer-events-auto mt-1.5 flex min-h-11 w-full items-center justify-between gap-1 px-2 font-display text-[10px] font-black uppercase tracking-wide transition active:scale-[0.98] disabled:opacity-60 sm:text-[11px] ${TRAIN_BUTTON[coach.level]}`}
                    >
                      <span>
                        {!authReady
                          ? t("common.loading")
                          : saving
                            ? t("common.saving")
                            : t("coaches.train_with")}
                      </span>
                      <ArrowUpRight className="h-3 w-3 shrink-0" />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </main>
      <ConfirmModal
        open={pendingCoachId !== null}
        title={t("coaches.switch_title", {
          name: pendingCoachId ? getCoach(pendingCoachId).name : t("coaches.choose"),
        })}
        body={t("coaches.switch_body")}
        confirmLabel={t("coaches.switch_confirm")}
        danger
        onCancel={() => setPendingCoachId(null)}
        onConfirm={() => {
          const coachId = pendingCoachId;
          setPendingCoachId(null);
          if (coachId) void activateCoach(coachId);
        }}
      />
    </div>
  );
}
