import { createFileRoute } from "@tanstack/react-router";
import { LegalDocument } from "@/components/LegalDocument";
import { getPublicLegalConfig } from "@/lib/policy.functions";
import { termsContent } from "@/lib/legal-content";
import { isLanguage, type Language } from "@/lib/i18n";

export const Route = createFileRoute("/terms")({
  validateSearch: (search: Record<string, unknown>): { lang?: Language } =>
    isLanguage(search.lang) ? { lang: search.lang } : {},
  loader: () => getPublicLegalConfig({ data: undefined }),
  head: () => ({ meta: [{ title: "Terms of service | COACH" }] }),
  component: TermsRoute,
});

function TermsRoute() {
  const config = Route.useLoaderData();
  const { lang = "en" } = Route.useSearch();
  const content = termsContent(config, lang);
  return (
    <LegalDocument
      {...content}
      language={lang}
      path="/terms"
      privateBeta={!config.detailsComplete}
    />
  );
}
