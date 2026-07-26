import { Link, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { MessageCircle, CalendarRange, Flame, BarChart3, Settings, LogOut } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { useLanguage } from "@/components/LanguageProvider";
import { ConfirmModal } from "@/components/ConfirmModal";
import { getActiveWorkoutSession } from "@/lib/gym-buddy.functions";
import { logout } from "@/lib/auth.functions";
import { clearAccountCache } from "@/lib/client-session";

const TABS = [
  { to: "/chat", labelKey: "nav.coach", Icon: MessageCircle },
  { to: "/program", labelKey: "nav.program", Icon: CalendarRange },
  { to: "/chat", labelKey: "nav.nutrition", Icon: Flame, search: { nutrition: true } },
  { to: "/dashboard", labelKey: "nav.dashboard", Icon: BarChart3 },
] as const;

export function TabBar({ activeWorkout }: { activeWorkout?: boolean }) {
  const { language, t: tr } = useLanguage();
  const queryClient = useQueryClient();
  const location = useRouterState({ select: (s) => s.location });
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const settingsActive =
    location.pathname.startsWith("/chat") &&
    Boolean((location.search as { settings?: boolean }).settings);
  const nutritionActive =
    location.pathname.startsWith("/chat") &&
    Boolean((location.search as { nutrition?: boolean }).nutrition);

  const performLogout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout({ data: undefined });
      await clearAccountCache(queryClient);
      window.location.replace("/auth");
    } catch (error) {
      setSigningOut(false);
      toast.error(
        error instanceof Error
          ? error.message
          : language === "sv"
            ? "Kunde inte logga ut"
            : "Could not sign out",
      );
    }
  };

  const requestLogout = async () => {
    if (signingOut) return;
    try {
      const hasActiveWorkout =
        activeWorkout ?? Boolean(await getActiveWorkoutSession({ data: undefined }));
      if (hasActiveWorkout) {
        setConfirmingLogout(true);
        return;
      }
      await performLogout();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : language === "sv"
            ? "Kunde inte kontrollera det aktiva passet"
            : "Could not check the active workout",
      );
    }
  };

  return (
    <>
      <nav className="shrink-0 border-b border-border bg-card pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-lg">
          {TABS.map((t) => {
            const active =
              "search" in t
                ? nutritionActive
                : location.pathname.startsWith(t.to) &&
                  !(t.to === "/chat" && (settingsActive || nutritionActive));
            return (
              <Link
                key={`${t.to}-${t.labelKey}`}
                to={t.to}
                search={"search" in t ? t.search : undefined}
                aria-current={active ? "page" : undefined}
                className="relative flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-1.5"
              >
                {active && (
                  <motion.div
                    layoutId="tab-indicator"
                    className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
                <t.Icon
                  className={`h-5 w-5 ${active ? "text-primary" : "text-muted-foreground"}`}
                  strokeWidth={active ? 2.5 : 2}
                />
                <span
                  className={`font-display text-[9px] font-bold uppercase tracking-[0.08em] ${
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
            className="relative flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-1.5"
            aria-label={tr("nav.settings")}
            aria-current={settingsActive ? "page" : undefined}
          >
            {settingsActive && (
              <motion.div
                layoutId="tab-indicator"
                className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary"
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
              />
            )}
            <Settings
              className={`h-5 w-5 ${settingsActive ? "text-primary" : "text-muted-foreground"}`}
              strokeWidth={settingsActive ? 2.5 : 2}
            />
            <span
              className={`font-display text-[9px] font-bold uppercase tracking-[0.08em] ${
                settingsActive ? "text-primary" : "text-muted-foreground"
              }`}
            >
              {tr("nav.settings")}
            </span>
          </Link>
          <button
            type="button"
            onClick={() => void requestLogout()}
            disabled={signingOut}
            className="flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-red-400 disabled:opacity-50"
            aria-label={tr("chat.sign_out")}
          >
            <LogOut className="h-5 w-5" />
            <span className="font-display text-[9px] font-bold uppercase tracking-[0.08em]">
              {tr("chat.sign_out")}
            </span>
          </button>
        </div>
      </nav>
      <ConfirmModal
        open={confirmingLogout}
        title={language === "sv" ? "Lämna träningspasset?" : "Leave the workout?"}
        body={
          language === "sv"
            ? "Passet fortsätter vara sparat, men du loggar ut mitt i ett aktivt pass."
            : "The workout stays saved, but you are signing out during an active session."
        }
        confirmLabel={tr("chat.sign_out")}
        danger
        onCancel={() => setConfirmingLogout(false)}
        onConfirm={() => {
          setConfirmingLogout(false);
          void performLogout();
        }}
      />
    </>
  );
}
