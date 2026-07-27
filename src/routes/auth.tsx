import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
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
import { betterAuthFrontendEnabled, publicSignupsEnabled } from "@/lib/auth-config";
import { authClient } from "@/lib/better-auth-client";

type AuthMode = "sign-in" | "sign-up" | "forgot" | "reset" | "two-factor";

type AuthSearch = {
  coach?: CoachId;
  lang?: Language;
  mode?: AuthMode;
  token?: string;
};

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>): AuthSearch => ({
    ...(isCoachId(search.coach) ? { coach: search.coach } : {}),
    ...(isLanguage(search.lang) ? { lang: search.lang } : {}),
    ...(["sign-in", "sign-up", "forgot", "reset", "two-factor"].includes(String(search.mode))
      ? { mode: search.mode as AuthMode }
      : {}),
    ...(typeof search.token === "string" && search.token.length <= 2048
      ? { token: search.token }
      : {}),
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
  const { coach, mode = "sign-in", token } = Route.useSearch();
  const selectedCoach = isCoachId(coach) ? coach : undefined;
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [notice, setNotice] = useState("");
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
      if (betterAuthFrontendEnabled) {
        const callbackURL = `/auth?lang=${language}${selectedCoach ? `&coach=${selectedCoach}` : ""}`;
        if (mode === "sign-up") {
          const result = await authClient.signUp.email({
            email,
            name: name.trim(),
            password,
            callbackURL,
          });
          if (result.error) throw new Error(result.error.message);
          setNotice(
            language === "sv"
              ? "Kontrollera din e-post och verifiera kontot."
              : "Check your email and verify your account.",
          );
          return;
        }
        if (mode === "forgot") {
          const result = await authClient.requestPasswordReset({
            email,
            redirectTo: `/auth?mode=reset&lang=${language}`,
          });
          if (result.error) throw new Error(result.error.message);
          setNotice(
            language === "sv"
              ? "Om kontot finns har vi skickat en säker återställningslänk."
              : "If that account exists, a secure reset link has been sent.",
          );
          return;
        }
        if (mode === "reset") {
          if (!token) throw new Error("Reset link is missing or expired");
          const result = await authClient.resetPassword({ newPassword: password, token });
          if (result.error) throw new Error(result.error.message);
          toast.success(language === "sv" ? "Lösenordet är uppdaterat" : "Password updated");
          navigate({ to: "/auth", search: { lang: language }, replace: true });
          return;
        }
        if (mode === "two-factor") {
          const result = await authClient.twoFactor.verifyTotp({
            code: twoFactorCode,
            trustDevice: true,
          });
          if (result.error) throw new Error(result.error.message);
        } else {
          const result = await authClient.signIn.email({ email, password, rememberMe: true });
          if (result.error) throw new Error(result.error.message);
          if (result.data && "twoFactorRedirect" in result.data && result.data.twoFactorRedirect) {
            return;
          }
        }
        await applyAuthPreferencesFn({
          data: { coach_id: selectedCoach, preferred_language: language },
        });
      } else {
        await loginFn({
          data: { email, password, coach_id: selectedCoach, preferred_language: language },
        });
      }
      await clearAccountCache(queryClient);
      window.location.replace("/chat");
    } catch (err) {
      const message = err instanceof Error ? err.message.toLowerCase() : "";
      toast.error(
        message.includes("too many")
          ? t("auth.too_many")
          : message.includes("at least 10") || message.includes("password is too short")
            ? language === "sv"
              ? "Lösenordet måste vara minst 10 tecken."
              : "Password must be at least 10 characters."
            : mode === "reset" && message.includes("missing")
              ? language === "sv"
                ? "Återställningslänken saknas eller har gått ut."
                : "The reset link is missing or expired."
              : mode === "sign-up"
                ? language === "sv"
                  ? "Kontot kunde inte skapas. Kontrollera uppgifterna eller försök senare."
                  : "The account could not be created. Check the details or try again later."
                : t("auth.invalid"),
      );
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
              {mode === "sign-up"
                ? language === "sv"
                  ? "Skapa konto"
                  : "Create account"
                : mode === "forgot"
                  ? language === "sv"
                    ? "Glömt lösenord"
                    : "Reset password"
                  : mode === "reset"
                    ? language === "sv"
                      ? "Nytt lösenord"
                      : "New password"
                    : mode === "two-factor"
                      ? language === "sv"
                        ? "Säkerhetskod"
                        : "Security code"
                      : t("auth.sign_in")}
            </h1>

            <form onSubmit={handleSubmit} className="mt-6 space-y-3">
              {mode === "sign-up" && (
                <>
                  <label htmlFor="auth-name" className="sr-only">
                    {language === "sv" ? "Namn" : "Name"}
                  </label>
                  <input
                    id="auth-name"
                    type="text"
                    required
                    autoComplete="name"
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={language === "sv" ? "Ditt namn" : "Your name"}
                    className="h-12 w-full rounded-xl border border-input bg-card px-4 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                  />
                </>
              )}
              {mode !== "reset" && mode !== "two-factor" && (
                <>
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
                </>
              )}
              {mode !== "forgot" && mode !== "two-factor" && (
                <>
                  <label htmlFor="auth-password" className="sr-only">
                    {t("auth.password")}
                  </label>
                  <input
                    id="auth-password"
                    type="password"
                    required
                    autoComplete={
                      mode === "sign-up" || mode === "reset" ? "new-password" : "current-password"
                    }
                    minLength={mode === "sign-up" || mode === "reset" ? 10 : 1}
                    maxLength={128}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t("auth.password")}
                    className="h-12 w-full rounded-xl border border-input bg-card px-4 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                  />
                </>
              )}
              {mode === "two-factor" && (
                <>
                  <label htmlFor="auth-code" className="sr-only">
                    {language === "sv" ? "Sexsiffrig kod" : "Six-digit code"}
                  </label>
                  <input
                    id="auth-code"
                    type="text"
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={twoFactorCode}
                    onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="000000"
                    className="h-12 w-full rounded-xl border border-input bg-card px-4 text-center text-xl tracking-[0.4em] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                  />
                </>
              )}
              <button
                type="submit"
                disabled={loading}
                className="mt-2 h-12 w-full rounded-xl bg-primary font-bold text-primary-foreground shadow-lg shadow-primary/30 transition active:scale-[0.98] disabled:opacity-60"
              >
                {loading
                  ? "…"
                  : mode === "sign-up"
                    ? language === "sv"
                      ? "Skapa konto"
                      : "Create account"
                    : mode === "forgot"
                      ? language === "sv"
                        ? "Skicka länk"
                        : "Send reset link"
                      : mode === "reset"
                        ? language === "sv"
                          ? "Spara lösenord"
                          : "Save password"
                        : mode === "two-factor"
                          ? language === "sv"
                            ? "Verifiera"
                            : "Verify"
                          : t("auth.sign_in")}
              </button>
              {notice && (
                <p
                  role="status"
                  className="border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200"
                >
                  {notice}
                </p>
              )}
            </form>
            {betterAuthFrontendEnabled && (
              <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs font-bold text-muted-foreground">
                {mode !== "sign-in" && (
                  <Link
                    to="/auth"
                    search={{ coach: selectedCoach, lang: language, mode: "sign-in" }}
                  >
                    {t("auth.sign_in")}
                  </Link>
                )}
                {mode === "sign-in" && (
                  <Link
                    to="/auth"
                    search={{ coach: selectedCoach, lang: language, mode: "forgot" }}
                  >
                    {language === "sv" ? "Glömt lösenord?" : "Forgot password?"}
                  </Link>
                )}
                {mode === "sign-in" && publicSignupsEnabled && (
                  <Link
                    to="/auth"
                    search={{ coach: selectedCoach, lang: language, mode: "sign-up" }}
                  >
                    {language === "sv" ? "Skapa konto" : "Create account"}
                  </Link>
                )}
              </div>
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
