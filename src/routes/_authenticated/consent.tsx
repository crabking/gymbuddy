import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { AppIcon } from "@/components/AppIcon";
import { useLanguage } from "@/components/LanguageProvider";
import { logout } from "@/lib/auth.functions";
import { clearAccountCache } from "@/lib/client-session";
import { acceptCurrentPolicies } from "@/lib/policy.functions";
import { usePwaUpdateBlocker } from "@/lib/pwa-update";

export const Route = createFileRoute("/_authenticated/consent")({
  head: () => ({ meta: [{ title: "Privacy and health consent | COACH" }] }),
  component: ConsentPage,
});

type ConsentKey =
  "terms" | "privacy_notice" | "health_data" | "health_safety" | "adult_attestation";

const initialState: Record<ConsentKey, boolean> = {
  terms: false,
  privacy_notice: false,
  health_data: false,
  health_safety: false,
  adult_attestation: false,
};

function ConsentPage() {
  const { language } = useLanguage();
  const sv = language === "sv";
  const [accepted, setAccepted] = useState(initialState);
  const [saving, setSaving] = useState(false);
  const acceptFn = useServerFn(acceptCurrentPolicies);
  const logoutFn = useServerFn(logout);
  const queryClient = useQueryClient();
  usePwaUpdateBlocker("policy-consent", saving);
  const allAccepted = Object.values(accepted).every(Boolean);

  const items: Array<{
    key: ConsentKey;
    title: string;
    body: React.ReactNode;
  }> = [
    {
      key: "terms",
      title: sv ? "Jag accepterar användarvillkoren" : "I accept the terms of service",
      body: (
        <Link
          to="/terms"
          search={{ lang: language }}
          className="font-bold text-primary underline underline-offset-2"
        >
          {sv ? "Läs villkoren" : "Read the terms"}
        </Link>
      ),
    },
    {
      key: "privacy_notice",
      title: sv ? "Jag har läst integritetspolicyn" : "I have read the privacy notice",
      body: (
        <Link
          to="/privacy"
          search={{ lang: language }}
          className="font-bold text-primary underline underline-offset-2"
        >
          {sv ? "Se hur data används" : "See how data is used"}
        </Link>
      ),
    },
    {
      key: "health_data",
      title: sv
        ? "Jag samtycker uttryckligen till behandling av mina hälsouppgifter"
        : "I explicitly consent to processing my health data",
      body: sv
        ? "Det omfattar träning, vikt, kroppsmått, kost, skador, begränsningar och återhämtningssvar som jag väljer att lämna."
        : "This includes training, weight, body measurements, nutrition, injuries, limitations, and recovery feedback I choose to provide.",
    },
    {
      key: "health_safety",
      title: sv
        ? "Jag förstår att COACH inte är sjukvård eller medicinsk rådgivning"
        : "I understand COACH is not healthcare or medical advice",
      body: (
        <Link
          to="/health-and-safety"
          search={{ lang: language }}
          className="font-bold text-primary underline underline-offset-2"
        >
          {sv ? "Läs säkerhetsinformationen" : "Read the safety information"}
        </Link>
      ),
    },
    {
      key: "adult_attestation",
      title: sv ? "Jag bekräftar att jag är minst 18 år" : "I confirm that I am at least 18",
      body: sv
        ? "Den privata betan är för vuxna användare."
        : "The private beta is for adult users.",
    },
  ];

  async function accept() {
    if (!allAccepted || saving) return;
    setSaving(true);
    try {
      await acceptFn({
        data: {
          locale: language,
          terms: true,
          privacy_notice: true,
          health_data: true,
          health_safety: true,
          adult_attestation: true,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["policy-status"] });
      window.location.replace("/chat");
    } catch (error) {
      toast.error(
        sv
          ? "Samtycket kunde inte sparas. Försök igen."
          : error instanceof Error
            ? error.message
            : "Consent could not be saved. Try again.",
      );
      setSaving(false);
    }
  }

  async function signOut() {
    await logoutFn({ data: undefined });
    await clearAccountCache(queryClient);
    window.location.replace("/auth");
  }

  return (
    <div className="min-h-dvh bg-background px-4 py-[max(1rem,env(safe-area-inset-top))] text-foreground">
      <main className="mx-auto flex min-h-[calc(100dvh-2rem)] max-w-md flex-col justify-center">
        <div className="border border-border bg-card p-5 shadow-2xl">
          <div className="flex items-center gap-3">
            <AppIcon className="h-11 w-11 border border-primary/45" />
            <div>
              <div className="font-display text-xs font-black uppercase tracking-[0.14em] text-primary">
                COACH
              </div>
              <h1 className="font-display text-2xl font-black uppercase tracking-tight">
                {sv ? "Din data. Ditt val." : "Your data. Your choice."}
              </h1>
            </div>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            {sv
              ? "COACH behöver tränings- och hälsouppgifter för att fungera. Läs varje punkt och välj aktivt innan du fortsätter."
              : "COACH needs training and health information to work. Review and actively choose each item before continuing."}
          </p>

          <div className="mt-5 divide-y divide-border border-y border-border">
            {items.map((item) => (
              <label key={item.key} className="flex cursor-pointer gap-3 py-3.5">
                <input
                  type="checkbox"
                  checked={accepted[item.key]}
                  onChange={(event) =>
                    setAccepted((current) => ({ ...current, [item.key]: event.target.checked }))
                  }
                  className="peer sr-only"
                />
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center border border-border bg-background text-transparent peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground">
                  <Check className="h-4 w-4" strokeWidth={3} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold leading-snug text-foreground">
                    {item.title}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                    {item.body}
                  </span>
                </span>
              </label>
            ))}
          </div>

          <button
            type="button"
            disabled={!allAccepted || saving}
            onClick={() => void accept()}
            className="mt-5 flex h-12 w-full items-center justify-center gap-2 bg-primary font-display text-sm font-black uppercase tracking-wide text-primary-foreground disabled:cursor-not-allowed disabled:opacity-35"
          >
            <ShieldCheck className="h-4 w-4" />
            {saving
              ? sv
                ? "Sparar…"
                : "Saving…"
              : sv
                ? "Godkänn och fortsätt"
                : "Accept and continue"}
          </button>
          <div className="mt-4 flex items-center justify-between gap-3 text-xs">
            <button
              type="button"
              onClick={() => void signOut()}
              className="min-h-11 font-bold text-muted-foreground"
            >
              {sv ? "Logga ut" : "Sign out"}
            </button>
            <Link
              to="/account-deletion"
              search={{ lang: language }}
              className="flex min-h-11 items-center font-bold text-muted-foreground"
            >
              {sv ? "Radera konto" : "Delete account"}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
