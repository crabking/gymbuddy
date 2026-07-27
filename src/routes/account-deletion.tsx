import { createFileRoute } from "@tanstack/react-router";
import { LegalDocument } from "@/components/LegalDocument";
import { getPublicLegalConfig } from "@/lib/policy.functions";
import { isLanguage, type Language } from "@/lib/i18n";

export const Route = createFileRoute("/account-deletion")({
  validateSearch: (search: Record<string, unknown>): { lang?: Language } =>
    isLanguage(search.lang) ? { lang: search.lang } : {},
  loader: () => getPublicLegalConfig({ data: undefined }),
  head: () => ({ meta: [{ title: "Delete your account | COACH" }] }),
  component: AccountDeletionRoute,
});

function AccountDeletionRoute() {
  const config = Route.useLoaderData();
  const { lang = "en" } = Route.useSearch();
  const sv = lang === "sv";
  return (
    <LegalDocument
      title={sv ? "Radera ditt konto" : "Delete your account"}
      intro={
        sv
          ? "Du kan permanent radera ditt COACH-konto och tillhörande data utan att kontakta support."
          : "You can permanently delete your COACH account and associated data without contacting support."
      }
      sections={[
        {
          title: sv ? "I appen" : "In the app",
          paragraphs: [
            sv
              ? "Logga in, öppna Inställningar, välj Integritet och data och tryck på Radera konto. Bekräfta din identitet när det efterfrågas och skriv DELETE."
              : "Sign in, open Settings, choose Privacy & data, and select Delete account. Reconfirm your identity when requested and type DELETE.",
          ],
        },
        {
          title: sv ? "Vad som raderas" : "What is deleted",
          paragraphs: [
            sv
              ? "Kontot, profil, chatt, minnen, träningsprogram, pass, set, kostloggar, mått och arbetsfiler raderas från den aktiva databasen. Bildfiler lagras inte av COACH."
              : "The account, profile, chat, memories, programs, sessions, sets, nutrition logs, measurements, and workspace files are deleted from the active database. COACH does not store uploaded image files.",
          ],
        },
        {
          title: sv ? "Säkerhetskopior och hjälp" : "Backups and help",
          paragraphs: [
            sv
              ? `Raderade uppgifter kan finnas i åtkomstbegränsade säkerhetskopior tills den dokumenterade backupcykeln löper ut. ${config.contactEmail ? `Hjälp: ${config.contactEmail}.` : "Om du inte kan logga in är tjänsten fortfarande privat beta; en offentlig kontaktkanal måste publiceras innan allmän lansering."}`
              : `Deleted data may remain in access-restricted backups until the documented backup cycle expires. ${config.contactEmail ? `Help: ${config.contactEmail}.` : "If you cannot sign in, the service is still a private beta; a public contact channel must be published before general launch."}`,
          ],
        },
      ]}
      language={lang}
      path="/account-deletion"
      privateBeta={!config.detailsComplete}
    />
  );
}
