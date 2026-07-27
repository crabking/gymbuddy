import { type FormEvent, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Check, ChevronRight, Loader2, ShieldCheck, Users } from "lucide-react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { useLanguage } from "@/components/LanguageProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { betterAuthFrontendEnabled } from "@/lib/auth-config";
import { authClient } from "@/lib/better-auth-client";

export const Route = createFileRoute("/_authenticated/account")({
  component: AccountPage,
  head: () => ({ meta: [{ title: "Account | COACH" }] }),
});

function Field({ label, ...props }: { label: string } & React.ComponentProps<typeof Input>) {
  return (
    <label className="grid gap-2 text-xs font-bold uppercase tracking-wider">
      {label}
      <Input className="min-h-11 text-base normal-case tracking-normal" {...props} />
    </label>
  );
}

function BetterAuthAccount() {
  const { language } = useLanguage();
  const session = authClient.useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [twoFactorPassword, setTwoFactorPassword] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [totpQr, setTotpQr] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [totpCode, setTotpCode] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (session.data?.user.name) setName(session.data.user.name);
  }, [session.data?.user.name]);

  useEffect(() => {
    if (session.data?.user.email) setEmail(session.data.user.email);
  }, [session.data?.user.email]);

  useEffect(() => {
    let active = true;
    if (!totpUri) {
      setTotpQr("");
      return;
    }
    QRCode.toDataURL(totpUri, {
      width: 256,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#050505", light: "#ffffff" },
    })
      .then((value) => {
        if (active) setTotpQr(value);
      })
      .catch(() => {
        if (active) setTotpQr("");
      });
    return () => {
      active = false;
    };
  }, [totpUri]);

  async function saveName(event: FormEvent) {
    event.preventDefault();
    setPending("name");
    const result = await authClient.updateUser({ name: name.trim() });
    setPending(null);
    if (result.error) toast.error(result.error.message);
    else toast.success(language === "sv" ? "Namnet sparades" : "Name saved");
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setPending("password");
    const result = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    setPending(null);
    if (result.error) toast.error(result.error.message);
    else {
      setCurrentPassword("");
      setNewPassword("");
      toast.success(language === "sv" ? "Lösenordet ändrades" : "Password changed");
    }
  }

  async function changeEmail(event: FormEvent) {
    event.preventDefault();
    setPending("email");
    const result = await authClient.changeEmail({
      newEmail: email.trim().toLowerCase(),
      callbackURL: `${window.location.origin}/account`,
    });
    setPending(null);
    if (result.error) toast.error(result.error.message);
    else
      toast.success(
        language === "sv"
          ? "Kontrollera den nya adressen för att bekräfta bytet"
          : "Check the new address to confirm the change",
      );
  }

  async function revokeOtherSessions() {
    setPending("sessions");
    const result = await authClient.revokeOtherSessions();
    setPending(null);
    if (result.error) toast.error(result.error.message);
    else toast.success(language === "sv" ? "Andra sessioner stängdes" : "Other sessions revoked");
  }

  async function beginTwoFactor(event: FormEvent) {
    event.preventDefault();
    setPending("two-factor");
    const result = await authClient.twoFactor.enable({ password: twoFactorPassword });
    setPending(null);
    if (result.error) toast.error(result.error.message);
    else if (result.data?.totpURI) {
      setTotpUri(result.data.totpURI);
      setBackupCodes(result.data.backupCodes || []);
    }
  }

  async function verifyTwoFactor(event: FormEvent) {
    event.preventDefault();
    setPending("verify-two-factor");
    const result = await authClient.twoFactor.verifyTotp({
      code: totpCode,
      trustDevice: true,
    });
    setPending(null);
    if (result.error) toast.error(result.error.message);
    else {
      setTotpUri("");
      setTotpQr("");
      setTotpCode("");
      setTwoFactorPassword("");
      setBackupCodes([]);
      await session.refetch();
      toast.success(
        language === "sv" ? "Tvåfaktorsinloggning är aktiv" : "Two-factor sign-in enabled",
      );
    }
  }

  async function disableTwoFactor(event: FormEvent) {
    event.preventDefault();
    setPending("disable-two-factor");
    const result = await authClient.twoFactor.disable({ password: twoFactorPassword });
    setPending(null);
    if (result.error) toast.error(result.error.message);
    else {
      setTwoFactorPassword("");
      await session.refetch();
      toast.success(
        language === "sv" ? "Tvåfaktorsinloggning stängdes av" : "Two-factor sign-in disabled",
      );
    }
  }

  const twoFactorEnabled = Boolean(
    session.data?.user &&
    "twoFactorEnabled" in session.data.user &&
    session.data.user.twoFactorEnabled,
  );

  return (
    <div className="grid gap-4">
      <section className="border border-border bg-card p-5">
        <h1 className="text-xl font-black uppercase">
          {language === "sv" ? "Ditt konto" : "Your account"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{session.data?.user.email}</p>
        {session.data?.user.emailVerified && (
          <p className="mt-2 flex items-center gap-1 text-xs font-bold uppercase text-emerald-400">
            <Check className="h-3.5 w-3.5" />
            {language === "sv" ? "Verifierad e-post" : "Verified email"}
          </p>
        )}
        <form className="mt-5 grid gap-3" onSubmit={saveName}>
          <Field
            label={language === "sv" ? "Namn" : "Name"}
            value={name}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
          />
          <Button className="min-h-11" disabled={!name.trim() || pending !== null}>
            {pending === "name" && <Loader2 className="animate-spin" />}
            {language === "sv" ? "Spara namn" : "Save name"}
          </Button>
        </form>
        <form className="mt-5 grid gap-3 border-t border-border pt-5" onSubmit={changeEmail}>
          <Field
            label={language === "sv" ? "E-post" : "Email"}
            type="email"
            autoComplete="email"
            value={email}
            maxLength={254}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Button
            className="min-h-11"
            variant="outline"
            disabled={
              !email.trim() ||
              email.trim().toLowerCase() === session.data?.user.email.toLowerCase() ||
              pending !== null
            }
          >
            {pending === "email" && <Loader2 className="animate-spin" />}
            {language === "sv" ? "Byt e-post" : "Change email"}
          </Button>
        </form>
      </section>

      <section className="border border-border bg-card p-5">
        <h2 className="font-black uppercase">
          {language === "sv" ? "Byt lösenord" : "Change password"}
        </h2>
        <form className="mt-4 grid gap-3" onSubmit={changePassword}>
          <Field
            label={language === "sv" ? "Nuvarande lösenord" : "Current password"}
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
          <Field
            label={language === "sv" ? "Nytt lösenord" : "New password"}
            type="password"
            autoComplete="new-password"
            minLength={10}
            maxLength={128}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <Button
            className="min-h-11"
            disabled={currentPassword.length === 0 || newPassword.length < 10 || pending !== null}
          >
            {pending === "password" && <Loader2 className="animate-spin" />}
            {language === "sv" ? "Byt lösenord" : "Change password"}
          </Button>
        </form>
      </section>

      <section className="border border-border bg-card p-5">
        <h2 className="flex items-center gap-2 font-black uppercase">
          <ShieldCheck className="text-primary" />
          {language === "sv" ? "Tvåfaktorsinloggning" : "Two-factor sign-in"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {twoFactorEnabled
            ? language === "sv"
              ? "Aktiv. En kod krävs från din autentiseringsapp."
              : "Active. A code from your authenticator app is required."
            : language === "sv"
              ? "Skydda kontot med en autentiseringsapp."
              : "Protect the account with an authenticator app."}
        </p>
        {!totpUri ? (
          <form
            className="mt-4 grid gap-3"
            onSubmit={twoFactorEnabled ? disableTwoFactor : beginTwoFactor}
          >
            <Field
              label={language === "sv" ? "Lösenord" : "Password"}
              type="password"
              autoComplete="current-password"
              value={twoFactorPassword}
              onChange={(event) => setTwoFactorPassword(event.target.value)}
            />
            <Button
              className="min-h-11"
              variant={twoFactorEnabled ? "outline" : "default"}
              disabled={!twoFactorPassword || pending !== null}
            >
              {(pending === "two-factor" || pending === "disable-two-factor") && (
                <Loader2 className="animate-spin" />
              )}
              {twoFactorEnabled
                ? language === "sv"
                  ? "Stäng av tvåfaktor"
                  : "Disable two-factor"
                : language === "sv"
                  ? "Aktivera tvåfaktor"
                  : "Enable two-factor"}
            </Button>
          </form>
        ) : (
          <form className="mt-4 grid gap-3" onSubmit={verifyTwoFactor}>
            {totpQr && (
              <img
                src={totpQr}
                alt={language === "sv" ? "QR-kod för autentiseringsapp" : "Authenticator QR code"}
                className="mx-auto h-56 w-56 border-8 border-white"
              />
            )}
            <p className="text-xs text-muted-foreground">
              {language === "sv"
                ? "Skanna QR-koden i din autentiseringsapp och skriv sedan in sexsiffrig kod."
                : "Scan the QR code in your authenticator app, then enter its six-digit code."}
            </p>
            {backupCodes.length > 0 && (
              <div className="border border-amber-500/40 bg-amber-500/10 p-3">
                <p className="text-xs font-bold uppercase text-amber-300">
                  {language === "sv"
                    ? "Spara återställningskoderna nu"
                    : "Save these recovery codes now"}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs">
                  {backupCodes.map((code) => (
                    <span key={code}>{code}</span>
                  ))}
                </div>
              </div>
            )}
            <Field
              label={language === "sv" ? "Kod" : "Code"}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              value={totpCode}
              onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            />
            <Button className="min-h-11" disabled={totpCode.length !== 6 || pending !== null}>
              {pending === "verify-two-factor" && <Loader2 className="animate-spin" />}
              {language === "sv" ? "Bekräfta" : "Confirm"}
            </Button>
          </form>
        )}
      </section>

      <section className="border border-border bg-card p-5">
        <h2 className="font-black uppercase">
          {language === "sv" ? "Inloggade enheter" : "Signed-in devices"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {language === "sv"
            ? "Stäng alla andra sessioner om en enhet är borttappad eller okänd."
            : "Close every other session if a device is lost or unfamiliar."}
        </p>
        <Button
          className="mt-4 min-h-11 w-full"
          variant="outline"
          disabled={pending !== null}
          onClick={revokeOtherSessions}
        >
          {pending === "sessions" && <Loader2 className="animate-spin" />}
          {language === "sv" ? "Logga ut andra enheter" : "Sign out other devices"}
        </Button>
      </section>

      {session.data?.user && "role" in session.data.user && session.data.user.role === "admin" && (
        <Link
          to="/admin"
          className="flex min-h-14 items-center gap-3 border border-border bg-card px-5 py-3"
        >
          <Users className="text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block font-black uppercase">
              {language === "sv" ? "Användare" : "User management"}
            </span>
            <span className="block text-xs text-muted-foreground">
              {language === "sv"
                ? "Konton, roller, åtkomst och sessioner."
                : "Accounts, roles, access, and sessions."}
            </span>
          </span>
          <ChevronRight />
        </Link>
      )}
    </div>
  );
}

function AccountPage() {
  const { language } = useLanguage();
  return (
    <main className="min-h-dvh bg-background px-4 py-5">
      <div className="mx-auto max-w-lg">
        <Link
          to="/chat"
          search={{ settings: true }}
          className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          {language === "sv" ? "Till inställningar" : "Back to settings"}
        </Link>
        {betterAuthFrontendEnabled ? (
          <BetterAuthAccount />
        ) : (
          <section className="border border-border bg-card p-5">
            <h1 className="text-xl font-black uppercase">
              {language === "sv" ? "Kontohantering" : "Account management"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {language === "sv"
                ? "Den lokala inloggningen hanteras av appadministratören."
                : "Local sign-in is managed by the app administrator."}
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
