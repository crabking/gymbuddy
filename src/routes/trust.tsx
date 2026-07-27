import { createFileRoute } from "@tanstack/react-router";
import { LegalDocument } from "@/components/LegalDocument";
import { getPublicLegalConfig } from "@/lib/policy.functions";
import { trustContent } from "@/lib/legal-content";
import { isLanguage, type Language } from "@/lib/i18n";

export const Route = createFileRoute("/trust")({
  validateSearch: (search: Record<string, unknown>): { lang?: Language } =>
    isLanguage(search.lang) ? { lang: search.lang } : {},
  loader: () => getPublicLegalConfig({ data: undefined }),
  head: () => ({ meta: [{ title: "Trust | COACH" }] }),
  component: TrustRoute,
});

function TrustRoute() {
  const config = Route.useLoaderData();
  const { lang = "en" } = Route.useSearch();
  return (
    <LegalDocument
      {...trustContent(config, lang)}
      language={lang}
      path="/trust"
      privateBeta={!config.detailsComplete}
    />
  );
}
