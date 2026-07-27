import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { PricingTable } from "@clerk/tanstack-react-start";
import { ArrowLeft } from "lucide-react";
import { getBillingState } from "@/lib/billing.functions";
import { clerkFrontendEnabled } from "@/lib/auth-config";
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

function BillingPage() {
  const { language } = useLanguage();
  const { data } = useSuspenseQuery({
    queryKey: ["billing-state"],
    queryFn: () => getBillingState({ data: undefined }),
  });
  const active = data.subscriptions.find((subscription) => subscription.status === "active");

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
        {!data.enabled || !clerkFrontendEnabled ? (
          <div className="mt-5 border border-border bg-card p-5 text-sm text-muted-foreground">
            {language === "sv"
              ? "Betalningar är avstängda. COACH kör utan betald plan."
              : "Payments are disabled. COACH is currently running without a paid plan."}
          </div>
        ) : (
          <>
            {active && (
              <div className="mt-5 border border-emerald-500/40 bg-emerald-500/10 p-4">
                <div>
                  <div className="font-bold">{active.plan_slug ?? "COACH"}</div>
                  <div className="text-xs uppercase text-emerald-300">{active.status}</div>
                </div>
              </div>
            )}
            <div className="mt-5">
              <PricingTable for="user" newSubscriptionRedirectUrl="/billing" />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
