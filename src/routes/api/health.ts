import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import { runtimeEnvironment } from "@/lib/runtime-config.server";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        try {
          await getDb().execute(sql`select 1`);
          return Response.json(
            { ok: true, environment: runtimeEnvironment() },
            {
              headers: {
                "Cache-Control": "no-store",
                "X-Robots-Tag": "noindex",
              },
            },
          );
        } catch (error) {
          console.error("Health check failed", error);
          return Response.json(
            { ok: false },
            {
              status: 503,
              headers: {
                "Cache-Control": "no-store",
                "X-Robots-Tag": "noindex",
              },
            },
          );
        }
      },
    },
  },
});
