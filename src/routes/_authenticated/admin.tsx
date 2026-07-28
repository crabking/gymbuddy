import { type FormEvent, useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Ban,
  BarChart3,
  Loader2,
  RefreshCw,
  Shield,
  ShieldOff,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/better-auth-client";
import { useLanguage } from "@/components/LanguageProvider";

type AdminUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role?: string | null;
  banned?: boolean | null;
  createdAt: Date;
};

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPage,
  head: () => ({ meta: [{ title: "Users | COACH" }] }),
});

function AdminPage() {
  const { language } = useLanguage();
  const session = authClient.useSession();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const isAdmin = Boolean(
    session.data?.user && "role" in session.data.user && session.data.user.role === "admin",
  );

  const loadUsers = useCallback(async () => {
    setLoading(true);
    const result = await authClient.admin.listUsers({
      query: { limit: 100, sortBy: "createdAt", sortDirection: "desc" },
    });
    setLoading(false);
    if (result.error) {
      setError(result.error.message || "Access denied");
      return;
    }
    setError("");
    setUsers(result.data.users as AdminUser[]);
  }, []);

  useEffect(() => {
    if (isAdmin) void loadUsers();
    else if (session.data?.user) setLoading(false);
  }, [isAdmin, loadUsers, session.data?.user]);

  async function createUser(event: FormEvent) {
    event.preventDefault();
    setPending("create");
    const result = await authClient.admin.createUser({
      email: email.trim().toLowerCase(),
      name: name.trim(),
      password,
      role: "user",
    });
    setPending(null);
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    setEmail("");
    setName("");
    setPassword("");
    toast.success(language === "sv" ? "Användaren skapades" : "User created");
    await loadUsers();
  }

  async function mutate(user: AdminUser, action: "ban" | "unban" | "revoke" | "role" | "delete") {
    if (user.id === session.data?.user.id && ["ban", "role", "delete"].includes(action)) {
      toast.error(
        language === "sv" ? "Du kan inte låsa ditt eget konto" : "You cannot lock your own account",
      );
      return;
    }
    if (
      action === "delete" &&
      !window.confirm(
        language === "sv"
          ? `Radera ${user.email} och all träningsdata permanent?`
          : `Permanently delete ${user.email} and all training data?`,
      )
    ) {
      return;
    }
    setPending(`${action}:${user.id}`);
    const result =
      action === "ban"
        ? await authClient.admin.banUser({
            userId: user.id,
            banReason: "Access suspended by COACH administrator",
          })
        : action === "unban"
          ? await authClient.admin.unbanUser({ userId: user.id })
          : action === "revoke"
            ? await authClient.admin.revokeUserSessions({ userId: user.id })
            : action === "role"
              ? await authClient.admin.setRole({
                  userId: user.id,
                  role: user.role === "admin" ? "user" : "admin",
                })
              : await authClient.admin.removeUser({ userId: user.id });
    setPending(null);
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    toast.success(language === "sv" ? "Kontot uppdaterades" : "Account updated");
    await loadUsers();
  }

  return (
    <main className="min-h-dvh bg-background px-4 py-5">
      <div className="mx-auto max-w-2xl">
        <Link
          to="/account"
          className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-primary"
        >
          <ArrowLeft />
          {language === "sv" ? "Till kontot" : "Back to account"}
        </Link>
        {!loading && !isAdmin ? (
          <section className="border border-destructive/50 bg-destructive/10 p-5">
            <h1 className="font-black uppercase">
              {language === "sv" ? "Åtkomst nekad" : "Access denied"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {language === "sv"
                ? "Endast COACH-administratörer kan hantera användare."
                : "Only COACH administrators can manage users."}
            </p>
          </section>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-black uppercase">
                  {language === "sv" ? "Användare" : "Users"}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {language === "sv" ? "Administratörsverktyg" : "Administrator controls"}
                </p>
              </div>
              <Button variant="outline" size="icon" aria-label="Refresh" onClick={loadUsers}>
                <RefreshCw className={loading ? "animate-spin" : ""} />
              </Button>
            </div>

            <Link
              to="/admin-analytics"
              className="mt-4 flex min-h-12 items-center justify-between border border-primary/50 bg-primary/10 px-4 font-black uppercase text-primary"
            >
              <span className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Business analytics
              </span>
              <span aria-hidden>→</span>
            </Link>

            <form
              className="mt-5 grid gap-3 border border-border bg-card p-4"
              onSubmit={createUser}
            >
              <h2 className="flex items-center gap-2 font-black uppercase">
                <UserPlus className="text-primary" />
                {language === "sv" ? "Skapa användare" : "Create user"}
              </h2>
              <Input
                required
                type="text"
                autoComplete="name"
                maxLength={100}
                placeholder={language === "sv" ? "Namn" : "Name"}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <Input
                required
                type="email"
                autoComplete="email"
                maxLength={254}
                placeholder="email@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <Input
                required
                type="password"
                autoComplete="new-password"
                minLength={10}
                maxLength={128}
                placeholder={language === "sv" ? "Tillfälligt lösenord" : "Temporary password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <Button disabled={pending !== null || password.length < 10}>
                {pending === "create" && <Loader2 className="animate-spin" />}
                {language === "sv" ? "Skapa konto" : "Create account"}
              </Button>
            </form>

            {error ? (
              <p className="mt-5 border border-destructive/50 bg-destructive/10 p-4 text-sm">
                {error}
              </p>
            ) : (
              <div className="mt-5 grid gap-3">
                {users.map((user) => (
                  <section key={user.id} className="border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate font-bold">{user.name}</h2>
                        <p className="truncate text-sm text-muted-foreground">{user.email}</p>
                        <p className="mt-1 text-[10px] font-bold uppercase tracking-wider">
                          {user.role || "user"} · {user.emailVerified ? "verified" : "unverified"}
                          {user.banned ? " · suspended" : ""}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending !== null}
                        onClick={() => mutate(user, user.banned ? "unban" : "ban")}
                      >
                        {user.banned ? <Shield /> : <Ban />}
                        {user.banned
                          ? language === "sv"
                            ? "Återställ"
                            : "Restore"
                          : language === "sv"
                            ? "Pausa"
                            : "Suspend"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending !== null}
                        onClick={() => mutate(user, "revoke")}
                      >
                        <ShieldOff />
                        {language === "sv" ? "Sessioner" : "Sessions"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending !== null}
                        onClick={() => mutate(user, "role")}
                      >
                        <Shield />
                        {user.role === "admin" ? "User" : "Admin"}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={pending !== null}
                        onClick={() => mutate(user, "delete")}
                      >
                        <Trash2 />
                        {language === "sv" ? "Radera" : "Delete"}
                      </Button>
                    </div>
                  </section>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
