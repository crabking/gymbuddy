import { Link, useRouterState } from "@tanstack/react-router";
import { MessageCircle, CalendarRange, BarChart3, Settings } from "lucide-react";
import { motion } from "motion/react";

const TABS = [
  { to: "/chat", label: "Coach", Icon: MessageCircle },
  { to: "/program", label: "Program", Icon: CalendarRange },
  { to: "/dashboard", label: "Dashboard", Icon: BarChart3 },
] as const;

export function TabBar() {
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
              className="relative flex flex-1 flex-col items-center gap-0.5 py-2"
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
                className={`font-display text-[9px] font-bold uppercase tracking-[0.14em] ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {t.label}
              </span>
            </Link>
          );
        })}
        <Link
          to="/chat"
          search={{ settings: true }}
          className="relative flex flex-1 flex-col items-center gap-0.5 py-2"
          aria-label="Settings"
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
            className={`font-display text-[9px] font-bold uppercase tracking-[0.14em] ${
              settingsActive ? "text-primary" : "text-muted-foreground"
            }`}
          >
            Settings
          </span>
        </Link>
      </div>
    </nav>
  );
}
