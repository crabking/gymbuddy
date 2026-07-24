import { useEffect } from "react";
import { APP_VERSION } from "@/lib/app-version";
import { initPwaInstall } from "@/lib/pwa-install";
import { isPwaUpdateBlocked, subscribePwaUpdateBlockers } from "@/lib/pwa-update";

export function PwaRegistration() {
  useEffect(() => {
    initPwaInstall();
    if (!("serviceWorker" in navigator)) return;

    let registration: ServiceWorkerRegistration | null = null;
    let reloading = false;
    let reloadRequested = false;
    let lastCheck = 0;
    let hasController = Boolean(navigator.serviceWorker.controller);

    const reloadWhenSafe = () => {
      if (!reloadRequested || reloading || isPwaUpdateBlocked()) return;
      reloading = true;
      window.location.reload();
    };

    const checkForUpdate = async (force = false) => {
      const now = Date.now();
      if (!force && now - lastCheck < 60_000) return;
      lastCheck = now;

      try {
        const response = await fetch(`/version.json?t=${now}`, { cache: "no-store" });
        if (response.ok) {
          const payload = (await response.json()) as { version?: string };
          if (payload.version && payload.version !== APP_VERSION) {
            reloadRequested = true;
            reloadWhenSafe();
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
        registration = await navigator.serviceWorker.register(
          `/sw.js?v=${encodeURIComponent(APP_VERSION)}`,
          {
            updateViaCache: "none",
          },
        );
        await checkForUpdate(true);
      } catch (error) {
        console.error("Service worker registration failed", error);
      }
    };

    const onControllerChange = () => {
      // The first install claims this page too, but the page already contains
      // the current build. Only an actual controller replacement needs reload.
      if (!hasController) {
        hasController = true;
        return;
      }
      reloadRequested = true;
      reloadWhenSafe();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkForUpdate();
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const unsubscribeBlockers = subscribePwaUpdateBlockers(reloadWhenSafe);

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
      unsubscribeBlockers();
    };
  }, []);

  return null;
}
