import { createFileRoute } from "@tanstack/react-router";
import { LegalDocument } from "@/components/LegalDocument";
import { getPublicLegalConfig } from "@/lib/policy.functions";
import { privacyContent } from "@/lib/legal-content";
import { isLanguage, type Language } from "@/lib/i18n";

export const Route = createFileRoute("/privacy")({
  validateSearch: (search: Record<string, unknown>): { lang?: Language } =>
    isLanguage(search.lang) ? { lang: search.lang } : {},
  loader: () => getPublicLegalConfig({ data: undefined }),
  head: () => ({ meta: [{ title: "Privacy policy | COACH" }] }),
  component: PrivacyRoute,
});

function PrivacyRoute() {
  const config = Route.useLoaderData();
  const { lang = "en" } = Route.useSearch();
  const content = privacyContent(config, lang);
  return (
    <LegalDocument
      {...content}
      language={lang}
      path="/privacy"
      privateBeta={!config.detailsComplete}
    />
  );
}
