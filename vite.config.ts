import { defineConfig, loadEnv, type PluginOption } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

// Plain TanStack Start + Nitro config (previously wrapped by
// @lovable.dev/vite-tanstack-config). Builds a self-hostable Node server via
// Nitro's `node-server` preset — output lands in `.output/` and boots with
// `node .output/server/index.mjs` (see Dockerfile).
export default defineConfig(async ({ command, mode }) => {
  const appVersion =
    [process.env.SOURCE_COMMIT, process.env.COOLIFY_GIT_COMMIT_SHA]
      .map((value) => value?.trim())
      .find(Boolean) ?? Date.now().toString(36);
  const plugins: PluginOption[] = [
    tailwindcss(),
    tanstackStart({
      // Redirect the bundled server entry to src/server.ts (our SSR error wrapper).
      server: { entry: "server" },
      importProtection: {
        behavior: "error",
        client: {
          files: ["**/server/**"],
          specifiers: ["server-only"],
        },
      },
    }),
    {
      name: "gym-buddy-app-version",
      apply: "build",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "version.json",
          source: JSON.stringify({ version: appVersion }),
        });
      },
    },
  ];

  // Nitro only participates in the production build.
  if (command === "build") {
    const { nitro } = await import("nitro/vite");
    plugins.push(nitro({ preset: "node-server" }));
  }

  plugins.push(viteReact());

  // Inline VITE_*-prefixed env vars into import.meta.env for both the client
  // bundle and SSR.
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const define: Record<string, string> = {};
  define.__APP_VERSION__ = JSON.stringify(appVersion);
  for (const [key, value] of Object.entries(env)) {
    define[`import.meta.env.${key}`] = JSON.stringify(value);
  }

  // Make ALL .env vars (DATABASE_URL, AI_API_KEY, …) visible to server code via
  // process.env during dev/build. In production the process environment (e.g.
  // Coolify) already provides these, and takes precedence.
  const fullEnv = loadEnv(mode, process.cwd(), "");
  for (const [key, value] of Object.entries(fullEnv)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  return {
    define,
    server: {
      host: true,
      port: 8080,
    },
    resolve: {
      tsconfigPaths: true,
      alias: { "@": `${process.cwd()}/src` },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
    },
    plugins,
  };
});
