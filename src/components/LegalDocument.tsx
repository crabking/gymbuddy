import { Link } from "@tanstack/react-router";
import { AppIcon } from "@/components/AppIcon";
import type { Language } from "@/lib/i18n";

export type LegalSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

export function LegalDocument({
  title,
  intro,
  sections,
  language,
  path,
  privateBeta = false,
}: {
  title: string;
  intro: string;
  sections: LegalSection[];
  language: Language;
  path: "/privacy" | "/terms" | "/health-and-safety" | "/trust" | "/account-deletion";
  privateBeta?: boolean;
}) {
  const links = [
    { to: "/trust" as const, en: "Trust", sv: "Trygghet" },
    { to: "/privacy" as const, en: "Privacy", sv: "Integritet" },
    { to: "/terms" as const, en: "Terms", sv: "Villkor" },
    { to: "/health-and-safety" as const, en: "Health & safety", sv: "Hälsa & säkerhet" },
    { to: "/account-deletion" as const, en: "Delete account", sv: "Radera konto" },
  ];
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-3xl items-center justify-between gap-3 px-4">
          <Link to="/" search={{ lang: language }} className="flex min-h-11 items-center gap-2">
            <AppIcon className="h-8 w-8 border border-primary/45" />
            <span className="font-display text-sm font-black uppercase tracking-[0.08em]">
              COACH
            </span>
          </Link>
          <div className="flex items-center gap-2 text-xs font-bold">
            {(["en", "sv"] as const).map((option) => (
              <Link
                key={option}
                to={path}
                search={{ lang: option }}
                className={option === language ? "text-primary" : "text-muted-foreground"}
              >
                {option.toUpperCase()}
              </Link>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 pb-16">
        {privateBeta && (
          <div className="mb-6 border border-amber-500/35 bg-amber-500/10 p-4 text-sm text-amber-100">
            {language === "sv"
              ? "COACH är fortfarande en privat beta. Offentlig registrering ska förbli avstängd tills fullständiga operatörsuppgifter och kontaktuppgifter har publicerats."
              : "COACH is still a private beta. Public registration must remain disabled until complete operator and contact details are published."}
          </div>
        )}
        <p className="font-display text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
          {language === "sv" ? "Senast uppdaterad 27 juli 2026" : "Last updated 27 July 2026"}
        </p>
        <h1 className="mt-2 font-display text-3xl font-black uppercase tracking-tight">{title}</h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">{intro}</p>

        <div className="mt-8 space-y-8">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="font-display text-lg font-black uppercase tracking-tight">
                {section.title}
              </h2>
              <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
                {section.paragraphs?.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {section.bullets && (
                  <ul className="list-disc space-y-2 pl-5">
                    {section.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ))}
        </div>

        <nav className="mt-10 flex flex-wrap gap-x-4 gap-y-3 border-t border-border pt-5 text-xs font-bold uppercase tracking-wide">
          {links.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              search={{ lang: language }}
              className={item.to === path ? "text-primary" : "text-muted-foreground"}
            >
              {language === "sv" ? item.sv : item.en}
            </Link>
          ))}
        </nav>
      </main>
    </div>
  );
}
