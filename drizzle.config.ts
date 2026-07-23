import { defineConfig } from "drizzle-kit";
import { readFileSync } from "node:fs";

// drizzle-kit doesn't read .env on its own, so fall back to parsing it.
function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*(.*?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no .env file */
  }
  throw new Error("DATABASE_URL is not set (in the environment or .env)");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: databaseUrl() },
});
