import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { SignIn } from "@clerk/tanstack-react-start";
import { login, getCurrentUser, applyAuthPreferences } from "@/lib/auth.functions";
import { toast } from "sonner";
import { AppIcon } from "@/components/AppIcon";
import { InstallAppButton } from "@/components/InstallAppButton";
import { VersionTag } from "@/components/VersionTag";
import { COACH_IMAGES } from "@/lib/coach-assets";
import { getCoach, isCoachId, type CoachId } from "@/lib/coaches";
import { clearAccountCache } from "@/lib/client-session";
import { usePwaUpdateBlocker } from "@/lib/pwa-update";
import { LanguageProvider, useLanguage } from "@/components/LanguageProvider";
import { isLanguage, type Language } from "@/lib/i18n";
import { clerkFrontendEnabled, publicSignupsEnabled } from "@/lib/auth-config";

type AuthSearch = {
  coach?: CoachId;
  lang?: Language;
};

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>): AuthSearch => ({
    ...(isCoachId(search.coach) ? { coach: search.coach } : {}),
    ...(isLanguage(search.lang) ? { lang: search.lang } : {}),
  }),
  head: () => ({
    meta: [
      { title: "Sign in — COACH" },
      { name: "description", content: "Sign in to your COACH account." },
      { property: "og:title", content: "Sign in — COACH" },
      { property: "og:description", content: "Sign in to your COACH account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthRoute,
});

function AuthRoute() {
  const { lang = "en" } = Route.useSearch();
  return (
    <LanguageProvider language={lang}>
      <AuthPage language={lang} />
    </LanguageProvider>
  );
}

function AuthPage({ language }: { language: Language }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const loginFn = useServerFn(login);
  const getCurrentUserFn = useServerFn(getCurrentUser);
  const applyAuthPreferencesFn = useServerFn(applyAuthPreferences);
  const { coach } = Route.useSearch();
  const selectedCoach = isCoachId(coach) ? coach : undefined;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);
  usePwaUpdateBlocker("auth-login", loading);

  useEffect(() => {
    getCurrentUserFn({ data: undefined })
      .then(async (user) => {
        if (!user) return;
        await applyAuthPreferencesFn({
          data: { coach_id: selectedCoach, preferred_language: language },
        });
        navigate({ to: "/chat", replace: true });
      })
      .catch(() => {
        // The form remains usable when the session probe fails.
      });
  }, [applyAuthPreferencesFn, getCurrentUserFn, language, navigate, selectedCoach]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    try {
      await loginFn({
        data: { email, password, coach_id: selectedCoach, preferred_language: language },
      });
      await clearAccountCache(queryClient);
      window.location.replace("/chat");
    } catch (err) {
      const message = err instanceof Error ? err.message.toLowerCase() : "";
      toast.error(message.includes("too many") ? t("auth.too_many") : t("auth.invalid"));
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col px-6">
        <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
          <div className="flex items-center gap-2">
            <Link
              to="/"
              search={{ lang: language }}
              className="flex min-h-11 items-center gap-2 text-sm font-semibold text-primary"
            >
              <AppIcon className="h-6 w-6 border border-primary/45" />
              COACH
            </Link>
            <VersionTag />
          </div>
          <div className="flex items-center gap-1">
            {(["en", "sv"] as const).map((lang) => (
              <Link
                key={lang}
                to="/auth"
                search={{ coach: selectedCoach, lang }}
                aria-label={lang === "sv" ? t("language.swedish") : t("language.english")}
                className={language === lang ? "opacity-100" : "opacity-35"}
              >
                <span aria-hidden="true">{lang === "sv" ? "🇸🇪" : "🇬🇧"}</span>
              </Link>
            ))}
            <InstallAppButton className="flex min-h-11 items-center gap-2 rounded-xl border border-primary/60 bg-primary/10 px-3 text-xs font-bold text-primary transition active:scale-95" />
          </div>
        </header>

        <main className="flex flex-1 items-center py-8">
          <div className="w-full">
            {selectedCoach && (
              <Link
                to="/coaches"
                search={{ lang: language }}
                className="mb-7 flex items-center gap-3 border border-border bg-card p-3 transition hover:border-primary/60"
              >
                <img
                  src={COACH_IMAGES[selectedCoach].avatar}
                  alt=""
                  className="h-14 w-14 object-cover object-top"
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                    {t("auth.selected_coach")}
                  </span>
                  <span className="block text-base font-bold text-foreground">
                    {getCoach(selectedCoach).name}
                  </span>
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {t("common.change")}
                </span>
              </Link>
            )}
            <h1 className="text-center font-display text-3xl font-black uppercase tracking-tight text-foreground">
              {t("auth.sign_in")}
            </h1>

            {clerkFrontendEnabled ? (
              <div className="mt-6 flex justify-center">
                <SignIn
                  routing="hash"
                  withSignUp={publicSignupsEnabled}
                  forceRedirectUrl={`/auth?lang=${language}${selectedCoach ? `&coach=${selectedCoach}` : ""}`}
                  fallbackRedirectUrl="/chat"
                  appearance={{
                    elements: {
                      rootBox: "w-full",
                      cardBox: "w-full",
                      card: "w-full bg-card border border-border shadow-none",
                    },
                  }}
                />
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="mt-6 space-y-3">
                <label htmlFor="auth-email" className="sr-only">
                  {t("auth.email")}
                </label>
                <input
                  id="auth-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="h-12 w-full rounded-xl border border-input bg-card px-4 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
                <label htmlFor="auth-password" className="sr-only">
                  {t("auth.password")}
                </label>
                <input
                  id="auth-password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("auth.password")}
                  className="h-12 w-full rounded-xl border border-input bg-card px-4 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="mt-2 h-12 w-full rounded-xl bg-primary font-bold text-primary-foreground shadow-lg shadow-primary/30 transition active:scale-[0.98] disabled:opacity-60"
                >
                  {loading ? "…" : t("auth.sign_in")}
                </button>
              </form>
            )}
          </div>
        </main>
        <footer className="flex min-h-11 shrink-0 items-center justify-center gap-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
          <Link to="/privacy" search={{ lang: language }}>
            {language === "sv" ? "Integritet" : "Privacy"}
          </Link>
          <Link to="/terms" search={{ lang: language }}>
            {language === "sv" ? "Villkor" : "Terms"}
          </Link>
          <Link to="/health-and-safety" search={{ lang: language }}>
            {language === "sv" ? "Hälsa" : "Health"}
          </Link>
          <Link to="/account-deletion" search={{ lang: language }}>
            {language === "sv" ? "Radera konto" : "Delete account"}
          </Link>
        </footer>
      </div>
    </div>
  );
}
