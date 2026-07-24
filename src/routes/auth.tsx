import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { login, getCurrentUser } from "@/lib/auth.functions";
import { Dumbbell } from "lucide-react";
import { toast } from "sonner";
import { InstallAppButton } from "@/components/InstallAppButton";
import { VersionTag } from "@/components/VersionTag";
import { COACH_IMAGES } from "@/lib/coach-assets";
import { getCoach, isCoachId, type CoachId } from "@/lib/coaches";
import { clearAccountCache } from "@/lib/client-session";
import { usePwaUpdateBlocker } from "@/lib/pwa-update";

type AuthSearch = {
  coach?: CoachId;
};

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>): AuthSearch =>
    isCoachId(search.coach) ? { coach: search.coach } : {},
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
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const loginFn = useServerFn(login);
  const getCurrentUserFn = useServerFn(getCurrentUser);
  const { coach } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);
  usePwaUpdateBlocker("auth-login", loading);

  useEffect(() => {
    getCurrentUserFn({ data: undefined })
      .then((user) => {
        if (!user) return;
        navigate({ to: "/chat", replace: true });
      })
      .catch(() => {
        // The form remains usable when the session probe fails.
      });
  }, [navigate, getCurrentUserFn]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    try {
      await loginFn({ data: { email, password, coach_id: coach } });
      await clearAccountCache(queryClient);
      window.location.replace("/chat");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid email or password");
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
              className="flex min-h-11 items-center gap-2 text-sm font-semibold text-primary"
            >
              <Dumbbell className="h-5 w-5" />
              COACH
            </Link>
            <VersionTag />
          </div>
          <InstallAppButton className="flex min-h-11 items-center gap-2 rounded-xl border border-primary/60 bg-primary/10 px-3 text-xs font-bold text-primary transition active:scale-95" />
        </header>

        <main className="flex flex-1 items-center py-8">
          <div className="w-full">
            {coach && (
              <Link
                to="/coaches"
                className="mb-7 flex items-center gap-3 border border-border bg-card p-3 transition hover:border-primary/60"
              >
                <img
                  src={COACH_IMAGES[coach].avatar}
                  alt=""
                  className="h-14 w-14 object-cover object-top"
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                    Selected coach
                  </span>
                  <span className="block text-base font-bold text-foreground">
                    {getCoach(coach).name}
                  </span>
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Change
                </span>
              </Link>
            )}
            <h1 className="text-center font-display text-3xl font-black uppercase tracking-tight text-foreground">
              Sign in
            </h1>

            <form onSubmit={handleSubmit} className="mt-6 space-y-3">
              <label htmlFor="auth-email" className="sr-only">
                Email
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
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="h-12 w-full rounded-xl border border-input bg-card px-4 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
              <button
                type="submit"
                disabled={loading}
                className="mt-2 h-12 w-full rounded-xl bg-primary font-bold text-primary-foreground shadow-lg shadow-primary/30 transition active:scale-[0.98] disabled:opacity-60"
              >
                {loading ? "…" : "Sign in"}
              </button>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}
