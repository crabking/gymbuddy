import { useId, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { usePwaInstall } from "@/lib/pwa-install";
import { usePwaUpdateBlocker } from "@/lib/pwa-update";
import { useLanguage } from "@/components/LanguageProvider";

export function InstallAppButton({ className, label }: { className?: string; label?: string }) {
  const { t } = useLanguage();
  const { canInstall, isInstalled, install } = usePwaInstall();
  const [installing, setInstalling] = useState(false);
  const blockerId = useId();
  usePwaUpdateBlocker(`pwa-install-prompt-${blockerId}`, installing);

  if (!canInstall || isInstalled) return null;

  return (
    <button
      type="button"
      disabled={installing}
      onClick={async () => {
        setInstalling(true);
        try {
          const outcome = await install();
          if (outcome === "accepted") toast.success(t("common.installed"));
        } catch {
          toast.error(t("common.install_failed"));
        } finally {
          setInstalling(false);
        }
      }}
      className={className}
    >
      <Download className="h-4 w-4 shrink-0" />
      <span>{installing ? t("common.installing") : (label ?? t("common.install_app"))}</span>
    </button>
  );
}
