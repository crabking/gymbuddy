import { useEffect } from "react";
import { initPwaInstall } from "@/lib/pwa-install";

declare const __APP_VERSION__: string;

export function PwaRegistration() {
  useEffect(() => {
    initPwaInstall();
    if (!("serviceWorker" in navigator)) return;

    let registration: ServiceWorkerRegistration | null = null;
    let reloading = false;
    let lastCheck = 0;

    const checkForUpdate = async (force = false) => {
      const now = Date.now();
      if (!force && now - lastCheck < 60_000) return;
      lastCheck = now;

      try {
        const response = await fetch(`/version.json?t=${now}`, { cache: "no-store" });
        if (response.ok) {
          const payload = (await response.json()) as { version?: string };
          if (payload.version && payload.version !== __APP_VERSION__) {
            reloading = true;
            window.location.reload();
            return;
          }
        }
      } catch {
        // Offline launches keep using the installed version.
      }

      try {
        await registration?.update();
      } catch {
        // A failed update check should never block the app from opening.
      }
    };

    const register = async () => {
      try {
        registration = await navigator.serviceWorker.register("/sw.js", {
          updateViaCache: "none",
        });
        await checkForUpdate(true);
      } catch (error) {
        console.error("Service worker registration failed", error);
      }
    };

    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkForUpdate();
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    document.addEventListener("visibilitychange", onVisibilityChange);

    let waitingForLoad = false;
    if (document.readyState === "complete") {
      void register();
    } else {
      waitingForLoad = true;
      window.addEventListener("load", register, { once: true });
    }

    return () => {
      if (waitingForLoad) window.removeEventListener("load", register);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return null;
}
