import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const iconDirectory = join(root, "public", "icons");
const iconRevision = "v=tank-gorilla-20260725";
const expectedIcons = [
  ["app-icon-gorilla-180.png", 180],
  ["app-icon-gorilla-192.png", 192],
  ["app-icon-gorilla-512.png", 512],
  ["app-icon-gorilla-maskable-512.png", 512],
] as const;

function pngSize(path: string) {
  const data = readFileSync(path);
  expect(data.subarray(1, 4).toString("ascii")).toBe("PNG");
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
  };
}

describe("gorilla app icon contract", () => {
  it("ships every required PWA and Apple icon at its declared size", () => {
    for (const [name, size] of expectedIcons) {
      const path = join(iconDirectory, name);
      expect(existsSync(path), name).toBe(true);
      expect(pngSize(path)).toEqual({ width: size, height: size });
    }
    expect(existsSync(join(root, "public", "favicon.ico"))).toBe(true);
  });

  it("uses only the gorilla artwork in the manifest and service-worker cache", () => {
    const manifest = JSON.parse(
      readFileSync(join(root, "public", "manifest.webmanifest"), "utf8"),
    ) as {
      icons: Array<{ src: string }>;
      shortcuts: Array<{ icons?: Array<{ src: string }> }>;
    };
    const manifestIcons = [
      ...manifest.icons.map((icon) => icon.src),
      ...manifest.shortcuts.flatMap((shortcut) => (shortcut.icons ?? []).map((icon) => icon.src)),
    ];
    expect(manifestIcons.length).toBeGreaterThan(3);
    expect(manifestIcons.every((src) => src.includes("app-icon-gorilla"))).toBe(true);
    expect(manifestIcons.every((src) => src.includes(iconRevision))).toBe(true);

    const serviceWorker = readFileSync(join(root, "public", "sw.js"), "utf8");
    for (const [name] of expectedIcons) expect(serviceWorker).toContain(`/icons/${name}`);
    expect(serviceWorker).toContain(`/manifest.webmanifest?${iconRevision}`);
    expect(serviceWorker.match(new RegExp(iconRevision, "g"))).toHaveLength(
      expectedIcons.length + 1,
    );
    expect(serviceWorker).not.toContain("/icons/icon-");
  });
});
