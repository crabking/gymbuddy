import { createFileRoute, Link } from "@tanstack/react-router";
import { UserProfile } from "@clerk/tanstack-react-start";
import { ArrowLeft } from "lucide-react";
import { clerkFrontendEnabled } from "@/lib/auth-config";
import { useLanguage } from "@/components/LanguageProvider";

export const Route = createFileRoute("/_authenticated/account")({
  component: AccountPage,
  head: () => ({ meta: [{ title: "Account | COACH" }] }),
});

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
        {clerkFrontendEnabled ? (
          <UserProfile
            routing="hash"
            appearance={{
              elements: {
                rootBox: "w-full",
                cardBox: "w-full",
                card: "w-full bg-card border border-border shadow-none",
              },
            }}
          />
        ) : (
          <section className="border border-border bg-card p-5">
            <h1 className="text-xl font-bold">
              {language === "sv" ? "Kontohantering" : "Account management"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {language === "sv"
                ? "Den lokala inloggningen hanteras av appadministratören tills Clerk aktiveras."
                : "The app administrator manages local sign-in until Clerk is enabled."}
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
