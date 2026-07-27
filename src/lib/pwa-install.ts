import { useEffect, useState } from "react";

type InstallOutcome = "accepted" | "dismissed" | "unavailable";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
let initialized = false;
const listeners = new Set<() => void>();

function detectInstalled() {
  if (typeof window === "undefined") return false;

  const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    standaloneNavigator.standalone === true
  );
}

function notify() {
  listeners.forEach((listener) => listener());
}

export function getPwaInstallState() {
  return {
    canInstall: deferredPrompt !== null,
    isInstalled: installed || detectInstalled(),
  };
}

export async function requestPwaInstall(): Promise<InstallOutcome> {
  const prompt = deferredPrompt;
  if (!prompt) return "unavailable";

  await prompt.prompt();
  const choice = await prompt.userChoice;
  deferredPrompt = null;
  if (choice.outcome === "accepted") installed = true;
  notify();
  return choice.outcome;
}

export function initPwaInstall() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  installed = detectInstalled();

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installed = true;
    notify();
  });

  const displayMode = window.matchMedia("(display-mode: standalone)");
  const syncDisplayMode = () => {
    installed = detectInstalled();
    notify();
  };
  if (typeof displayMode.addEventListener === "function") {
    displayMode.addEventListener("change", syncDisplayMode);
  } else {
    // Older iOS WebKit exposes the legacy MediaQueryList listener API.
    (
      displayMode as unknown as {
        addListener: (listener: (event: MediaQueryListEvent) => void) => void;
      }
    ).addListener(syncDisplayMode);
  }
}

export function usePwaInstall() {
  const [state, setState] = useState({ canInstall: false, isInstalled: false });

  useEffect(() => {
    const update = () => setState(getPwaInstallState());

    listeners.add(update);
    initPwaInstall();
    update();
    return () => {
      listeners.delete(update);
    };
  }, []);

  return { ...state, install: requestPwaInstall };
}
