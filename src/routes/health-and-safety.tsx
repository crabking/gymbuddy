import { createFileRoute } from "@tanstack/react-router";
import { LegalDocument } from "@/components/LegalDocument";
import { healthContent } from "@/lib/legal-content";
import { isLanguage, type Language } from "@/lib/i18n";

export const Route = createFileRoute("/health-and-safety")({
  validateSearch: (search: Record<string, unknown>): { lang?: Language } =>
    isLanguage(search.lang) ? { lang: search.lang } : {},
  head: () => ({ meta: [{ title: "Health and safety | COACH" }] }),
  component: HealthRoute,
});

function HealthRoute() {
  const { lang = "en" } = Route.useSearch();
  return <LegalDocument {...healthContent(lang)} language={lang} path="/health-and-safety" />;
}
