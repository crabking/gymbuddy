import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getBillingState } from "@/lib/billing.functions";
import { betterAuthFrontendEnabled } from "@/lib/auth-config";
import { authClient } from "@/lib/better-auth-client";
import { useLanguage } from "@/components/LanguageProvider";

export const Route = createFileRoute("/_authenticated/billing")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      queryKey: ["billing-state"],
      queryFn: () => getBillingState({ data: undefined }),
    }),
  component: BillingPage,
  head: () => ({ meta: [{ title: "Subscription | COACH" }] }),
});

function money(amountMinor: number, currency: string, language: "en" | "sv") {
  return new Intl.NumberFormat(language === "sv" ? "sv-SE" : "en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

function BillingPage() {
  const { language } = useLanguage();
  const [pending, setPending] = useState<string | null>(null);
  const { data } = useSuspenseQuery({
    queryKey: ["billing-state"],
    queryFn: () => getBillingState({ data: undefined }),
  });
  const active = data.subscriptions.find((subscription) =>
    ["active", "trialing", "past_due"].includes(subscription.status),
  );

  async function subscribe(annual: boolean) {
    setPending(annual ? "annual" : "monthly");
    const result = await authClient.subscription.upgrade({
      plan: "coach",
      annual,
      successUrl: `${window.location.origin}/billing?checkout=success`,
      cancelUrl: `${window.location.origin}/billing?checkout=cancelled`,
      returnUrl: `${window.location.origin}/billing`,
    });
    setPending(null);
    if (result.error) {
      toast.error(result.error.message || "Could not open Stripe Checkout");
    }
  }

  async function manageBilling() {
    setPending("portal");
    const result = await authClient.subscription.billingPortal({
      returnUrl: `${window.location.origin}/billing`,
    });
    setPending(null);
    if (result.error) {
      toast.error(result.error.message || "Could not open the billing portal");
    }
  }

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
        <h1 className="text-2xl font-black uppercase">
          {language === "sv" ? "Prenumeration" : "Subscription"}
        </h1>
        {!data.enabled || !betterAuthFrontendEnabled ? (
          <div className="mt-5 border border-border bg-card p-5 text-sm text-muted-foreground">
            {data.temporarily_unavailable
              ? language === "sv"
                ? "Stripe kan inte nås just nu. Ditt konto och din träningsdata påverkas inte."
                : "Stripe cannot be reached right now. Your account and training data are unaffected."
              : language === "sv"
                ? "Betalningar är avstängda. COACH kör utan betald plan."
                : "Payments are disabled. COACH is currently running without a paid plan."}
          </div>
        ) : (
          <>
            {active && (
              <section className="mt-5 border border-emerald-500/40 bg-emerald-500/10 p-4">
                <div className="font-bold uppercase">{active.plan || "COACH"}</div>
                <div className="text-xs uppercase text-emerald-300">{active.status}</div>
                {active.periodEnd && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {language === "sv" ? "Nuvarande period till " : "Current period through "}
                    {new Date(active.periodEnd).toLocaleDateString(
                      language === "sv" ? "sv-SE" : "en-GB",
                    )}
                  </p>
                )}
                <Button className="mt-4 w-full" variant="outline" onClick={manageBilling}>
                  {pending === "portal" ? <Loader2 className="animate-spin" /> : <ExternalLink />}
                  {language === "sv" ? "Hantera i Stripe" : "Manage in Stripe"}
                </Button>
              </section>
            )}
            {!active && (
              <div className="mt-5 grid gap-3">
                {data.plans.map((plan) => (
                  <section key={plan.key} className="border border-border bg-card p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="font-black uppercase">
                          {plan.key === "annual"
                            ? language === "sv"
                              ? "Årsplan"
                              : "Annual"
                            : language === "sv"
                              ? "Månadsplan"
                              : "Monthly"}
                        </h2>
                        <p className="mt-1 text-xl font-black">
                          {money(plan.amount_minor, plan.currency, language)}
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            / {plan.interval}
                          </span>
                        </p>
                      </div>
                    </div>
                    <Button
                      className="mt-4 min-h-11 w-full"
                      disabled={pending !== null}
                      onClick={() => subscribe(plan.key === "annual")}
                    >
                      {pending === plan.key && <Loader2 className="animate-spin" />}
                      {language === "sv" ? "Fortsätt säkert" : "Continue securely"}
                    </Button>
                  </section>
                ))}
              </div>
            )}
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              {language === "sv"
                ? "Betalning, kvitton, moms och kortuppgifter hanteras av Stripe. COACH lagrar inte kortuppgifter."
                : "Payment, receipts, VAT, and card details are handled by Stripe. COACH does not store card details."}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
