import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { login, getCurrentUser } from "@/lib/auth.functions";
import { Dumbbell } from "lucide-react";
import { toast } from "sonner";
import { InstallAppButton } from "@/components/InstallAppButton";
import { VersionTag } from "@/components/VersionTag";
import { COACH_IMAGES } from "@/lib/coach-assets";
import { getCoach, isCoachId, type CoachId } from "@/lib/coaches";

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
  const loginFn = useServerFn(login);
  const getCurrentUserFn = useServerFn(getCurrentUser);
  const { coach } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getCurrentUserFn({ data: undefined }).then((user) => {
      if (!user) return;
      navigate({ to: "/chat", replace: true });
    });
  }, [navigate, getCurrentUserFn]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await loginFn({ data: { email, password, coach_id: coach } });
      navigate({ to: "/chat", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid email or password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col px-6">
        <header className="flex h-16 shrink-0 items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Link to="/" className="flex items-center gap-2 text-sm font-semibold text-primary">
              <Dumbbell className="h-5 w-5" />
              COACH
            </Link>
            <VersionTag />
          </div>
          <InstallAppButton className="flex items-center gap-2 rounded-xl border border-primary/60 bg-primary/10 px-3 py-2 text-xs font-bold text-primary transition active:scale-95" />
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
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="h-12 w-full rounded-xl border border-input bg-card px-4 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
              <input
                type="password"
                required
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
