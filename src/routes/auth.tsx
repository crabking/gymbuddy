import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { login, getCurrentUser } from "@/lib/auth.functions";
import { updateProfile } from "@/lib/gym-buddy.functions";
import { Dumbbell } from "lucide-react";
import { toast } from "sonner";
import { InstallAppButton } from "@/components/InstallAppButton";
import { VersionTag } from "@/components/VersionTag";

type AuthSearch = {
  coach?: "male" | "female";
};

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>): AuthSearch =>
    search.coach === "male" || search.coach === "female"
      ? { coach: search.coach }
      : {},
  head: () => ({
    meta: [
      { title: "Sign in — Gym Buddy" },
      { name: "description", content: "Sign in to your Gym Buddy account." },
      { property: "og:title", content: "Sign in — Gym Buddy" },
      { property: "og:description", content: "Sign in to your Gym Buddy account." },
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
  const updateProfileFn = useServerFn(updateProfile);
  const { coach } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getCurrentUserFn({ data: undefined }).then(async (user) => {
      if (!user) return;
      if (coach) await updateProfileFn({ data: { coach_gender: coach } });
      navigate({ to: "/chat", replace: true });
    });
  }, [coach, navigate, getCurrentUserFn, updateProfileFn]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await loginFn({ data: { email, password, coach_gender: coach } });
      navigate({ to: "/chat", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid email or password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-10 pt-10">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Link to="/" className="flex items-center gap-2 text-sm font-semibold text-primary">
              <Dumbbell className="h-5 w-5" />
              GYM BUDDY
            </Link>
            <VersionTag />
          </div>
          <InstallAppButton className="flex items-center gap-2 rounded-xl border border-primary/60 bg-primary/10 px-3 py-2 text-xs font-bold text-primary transition active:scale-95" />
        </div>

        <div className="mt-16">
          <h1 className="text-3xl font-black tracking-tight text-foreground">Welcome back</h1>
          <p className="mt-2 text-sm text-muted-foreground">Sign in to keep training.</p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-3">
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
    </div>
  );
}
