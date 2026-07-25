import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Brain, Camera, Dumbbell, HeartPulse, ListChecks } from "lucide-react";
import coverImage from "@/assets/coach-rex-male.jpg";
import { AppIcon } from "@/components/AppIcon";
import { InstallAppButton } from "@/components/InstallAppButton";
import { VersionTag } from "@/components/VersionTag";
import { LanguageProvider, useLanguage } from "@/components/LanguageProvider";
import { isLanguage, type Language, type TranslationKey } from "@/lib/i18n";

type Feature = {
  number: string;
  icon: React.ReactNode;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
};

const FEATURES: Feature[] = [
  {
    number: "01",
    icon: <Dumbbell className="h-5 w-5" strokeWidth={2.3} />,
    titleKey: "landing.feature.workout.title",
    bodyKey: "landing.feature.workout.body",
  },
  {
    number: "02",
    icon: <ListChecks className="h-5 w-5" strokeWidth={2.3} />,
    titleKey: "landing.feature.plan.title",
    bodyKey: "landing.feature.plan.body",
  },
  {
    number: "03",
    icon: <Camera className="h-5 w-5" strokeWidth={2.3} />,
    titleKey: "landing.feature.calories.title",
    bodyKey: "landing.feature.calories.body",
  },
  {
    number: "04",
    icon: <HeartPulse className="h-5 w-5" strokeWidth={2.3} />,
    titleKey: "landing.feature.progress.title",
    bodyKey: "landing.feature.progress.body",
  },
  {
    number: "05",
    icon: <Brain className="h-5 w-5" strokeWidth={2.3} />,
    titleKey: "landing.feature.memory.title",
    bodyKey: "landing.feature.memory.body",
  },
];

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { lang?: Language } =>
    isLanguage(search.lang) ? { lang: search.lang } : {},
  head: () => ({
    meta: [
      { title: "COACH — your complete AI fitness coach" },
      {
        name: "description",
        content:
          "One AI coach for workouts, personalized training plans, photo calorie tracking, progress dashboards, and permanent memory.",
      },
      { property: "og:title", content: "COACH — your complete AI fitness coach" },
      {
        property: "og:description",
        content: "Train, plan, eat, track, and improve with one AI coach that remembers you.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { lang = "en" } = Route.useSearch();
  return (
    <LanguageProvider language={lang}>
      <LandingContent language={lang} />
    </LanguageProvider>
  );
}

function LandingContent({ language }: { language: Language }) {
  const { t } = useLanguage();
  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
      <section className="relative h-[45dvh] shrink-0 overflow-hidden bg-card">
        <img
          src={coverImage}
          alt={t("landing.image_alt")}
          className="h-full w-full object-cover object-top"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/65 via-transparent to-background" />

        <header className="absolute inset-x-0 top-0 z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6">
          <Link to="/" className="flex min-h-11 items-center gap-2">
            <AppIcon className="h-8 w-8 border border-primary/45" />
            <span className="font-display text-sm font-black uppercase tracking-[0.08em]">
              COACH
            </span>
            <VersionTag />
          </Link>
          <div className="flex items-center gap-2">
            <div
              className="flex h-11 items-center border border-border bg-background/70 p-1 backdrop-blur"
              aria-label={t("language.choose")}
            >
              {(["en", "sv"] as const).map((lang) => (
                <Link
                  key={lang}
                  to="/"
                  search={{ lang }}
                  aria-label={lang === "sv" ? t("language.swedish") : t("language.english")}
                  aria-current={language === lang ? "true" : undefined}
                  className={`grid h-8 w-9 place-items-center text-lg transition ${
                    language === lang ? "bg-primary/20 ring-1 ring-primary" : "opacity-55"
                  }`}
                >
                  <span aria-hidden="true">{lang === "sv" ? "🇸🇪" : "🇬🇧"}</span>
                </Link>
              ))}
            </div>
            <InstallAppButton className="flex h-11 items-center gap-1.5 border border-primary/60 bg-background/70 px-3 font-display text-[10px] font-bold uppercase tracking-[0.1em] text-primary backdrop-blur transition active:scale-95" />
          </div>
        </header>
      </section>

      <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
        <section className="shrink-0">
          <p className="font-display text-[9px] font-bold uppercase tracking-[0.22em] text-primary">
            {t("landing.eyebrow")}
          </p>
          <h1 className="mt-1 font-display text-2xl font-black uppercase leading-none tracking-[-0.04em] sm:text-3xl">
            {t("landing.title")}
          </h1>
          <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground sm:text-xs">
            {t("landing.body")}
          </p>
        </section>

        <section className="mt-2 flex min-h-0 flex-1 flex-col">
          <div className="grid min-h-0 flex-1 grid-rows-5 border-y border-border">
            {FEATURES.map((feature) => (
              <article
                key={feature.number}
                className="grid min-h-0 grid-cols-[1.75rem_1fr_auto] items-center gap-2.5 border-b border-border last:border-b-0"
              >
                <span className="text-primary [&>svg]:h-[18px] [&>svg]:w-[18px]">
                  {feature.icon}
                </span>
                <div className="min-w-0">
                  <h2 className="font-display text-xs font-black uppercase leading-tight tracking-[0.01em] sm:text-[13px]">
                    {t(feature.titleKey)}
                  </h2>
                  <p className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground sm:text-[11px] [@media(max-height:600px)]:hidden">
                    {t(feature.bodyKey)}
                  </p>
                </div>
                <span className="font-mono text-[8px] tracking-[0.12em] text-muted-foreground/35">
                  {feature.number}
                </span>
              </article>
            ))}
          </div>
          <Link
            to="/coaches"
            search={{ lang: language }}
            className="mt-2 flex h-11 shrink-0 items-center justify-between bg-primary px-4 font-display text-xs font-black uppercase tracking-[0.08em] text-primary-foreground transition active:scale-[0.98]"
          >
            {t("landing.start")}
            <ArrowUpRight className="h-4 w-4" strokeWidth={2.5} />
          </Link>
        </section>
      </main>
    </div>
  );
}
