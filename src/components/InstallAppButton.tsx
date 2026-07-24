import { useId, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { usePwaInstall } from "@/lib/pwa-install";
import { usePwaUpdateBlocker } from "@/lib/pwa-update";

export function InstallAppButton({
  className,
  label = "Install app",
}: {
  className?: string;
  label?: string;
}) {
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
          if (outcome === "accepted") toast.success("COACH installed");
        } catch {
          toast.error("Could not open the install prompt");
        } finally {
          setInstalling(false);
        }
      }}
      className={className}
    >
      <Download className="h-4 w-4 shrink-0" />
      <span>{installing ? "Installing…" : label}</span>
    </button>
  );
}
