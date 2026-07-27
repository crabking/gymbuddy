import { afterEach, describe, expect, it, vi } from "vitest";

type TestWindow = EventTarget & {
  matchMedia: () => {
    matches: boolean;
    addEventListener: () => void;
  };
};

function installBrowserGlobals() {
  const testWindow = new EventTarget() as TestWindow;
  testWindow.matchMedia = () => ({
    matches: false,
    addEventListener: () => undefined,
  });
  vi.stubGlobal("window", testWindow);
  vi.stubGlobal("navigator", { standalone: false });
  return testWindow;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("PWA install prompt state", () => {
  it("captures the Android install event and records an accepted install", async () => {
    const testWindow = installBrowserGlobals();
    const prompt = vi.fn(async () => undefined);
    const module = await import("@/lib/pwa-install");
    module.initPwaInstall();

    const event = Object.assign(new Event("beforeinstallprompt"), {
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted" as const, platform: "web" }),
    });
    testWindow.dispatchEvent(event);

    expect(module.getPwaInstallState()).toEqual({
      canInstall: true,
      isInstalled: false,
    });
    await expect(module.requestPwaInstall()).resolves.toBe("accepted");
    expect(prompt).toHaveBeenCalledOnce();
    expect(module.getPwaInstallState()).toEqual({
      canInstall: false,
      isInstalled: true,
    });
  });

  it("remains available after dismissal only when the browser emits a new prompt", async () => {
    const testWindow = installBrowserGlobals();
    const module = await import("@/lib/pwa-install");
    module.initPwaInstall();

    testWindow.dispatchEvent(
      Object.assign(new Event("beforeinstallprompt"), {
        prompt: vi.fn(async () => undefined),
        userChoice: Promise.resolve({ outcome: "dismissed" as const, platform: "web" }),
      }),
    );

    await expect(module.requestPwaInstall()).resolves.toBe("dismissed");
    expect(module.getPwaInstallState()).toEqual({
      canInstall: false,
      isInstalled: false,
    });
    await expect(module.requestPwaInstall()).resolves.toBe("unavailable");
  });

  it("hides installation after the browser reports appinstalled", async () => {
    const testWindow = installBrowserGlobals();
    const module = await import("@/lib/pwa-install");
    module.initPwaInstall();

    testWindow.dispatchEvent(new Event("appinstalled"));

    expect(module.getPwaInstallState()).toEqual({
      canInstall: false,
      isInstalled: true,
    });
  });
});
