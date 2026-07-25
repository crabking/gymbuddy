import { Link, useRouterState } from "@tanstack/react-router";
import { MessageCircle, CalendarRange, BarChart3, Settings } from "lucide-react";
import { motion } from "motion/react";
import { useLanguage } from "@/components/LanguageProvider";

const TABS = [
  { to: "/chat", labelKey: "nav.coach", Icon: MessageCircle },
  { to: "/program", labelKey: "nav.program", Icon: CalendarRange },
  { to: "/dashboard", labelKey: "nav.dashboard", Icon: BarChart3 },
] as const;

export function TabBar() {
  const { t: tr } = useLanguage();
  const location = useRouterState({ select: (s) => s.location });
  const settingsActive =
    location.pathname.startsWith("/chat") &&
    Boolean((location.search as { settings?: boolean }).settings);
  return (
    <nav className="border-t border-border bg-card pb-[max(0.25rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto flex max-w-md">
        {TABS.map((t) => {
          const active =
            location.pathname.startsWith(t.to) && !(t.to === "/chat" && settingsActive);
          return (
            <Link
              key={t.to}
              to={t.to}
              aria-current={active ? "page" : undefined}
              className="relative flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 py-1.5"
            >
              {active && (
                <motion.div
                  layoutId="tab-indicator"
                  className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-primary"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              <t.Icon
                className={`h-5 w-5 ${active ? "text-primary" : "text-muted-foreground"}`}
                strokeWidth={active ? 2.5 : 2}
              />
              <span
                className={`font-display text-[10px] font-bold uppercase tracking-[0.12em] ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {tr(t.labelKey)}
              </span>
            </Link>
          );
        })}
        <Link
          to="/chat"
          search={{ settings: true }}
          className="relative flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 py-1.5"
          aria-label={tr("nav.settings")}
          aria-current={settingsActive ? "page" : undefined}
        >
          {settingsActive && (
            <motion.div
              layoutId="tab-indicator"
              className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-primary"
              transition={{ type: "spring", stiffness: 500, damping: 40 }}
            />
          )}
          <Settings
            className={`h-5 w-5 ${settingsActive ? "text-primary" : "text-muted-foreground"}`}
            strokeWidth={settingsActive ? 2.5 : 2}
          />
          <span
            className={`font-display text-[10px] font-bold uppercase tracking-[0.12em] ${
              settingsActive ? "text-primary" : "text-muted-foreground"
            }`}
          >
            {tr("nav.settings")}
          </span>
        </Link>
      </div>
    </nav>
  );
}
