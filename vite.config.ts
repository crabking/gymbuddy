import { defineConfig, loadEnv, type PluginOption } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

// Plain TanStack Start + Nitro config (previously wrapped by
// @lovable.dev/vite-tanstack-config). Builds a self-hostable Node server via
// Nitro's `node-server` preset — output lands in `.output/` and boots with
// `node .output/server/index.mjs` (see Dockerfile).
export default defineConfig(async ({ command, mode }) => {
  const plugins: PluginOption[] = [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
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
