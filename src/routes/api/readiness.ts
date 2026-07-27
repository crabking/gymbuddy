import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import { readinessConfiguration } from "@/lib/runtime-config.server";

export const Route = createFileRoute("/api/readiness")({
  server: {
    handlers: {
      GET: async () => {
        const configuration = readinessConfiguration();
        let database = false;
        let databaseEnvironment: string | null = null;
        try {
          await getDb().execute(sql`select 1`);
          const result = await getDb().execute(
            sql`select value from deployment_metadata where key = 'app_environment' limit 1`,
          );
          databaseEnvironment =
            ((result.rows?.[0] as { value?: string } | undefined)?.value as string | undefined) ??
            null;
          database =
            databaseEnvironment === null || databaseEnvironment === configuration.environment;
        } catch (error) {
          console.error("Readiness database check failed", error);
        }
        const checks = { ...configuration.checks, database };
        const ready = Object.values(checks).every(Boolean);
        return Response.json(
          {
            ok: ready,
            environment: configuration.environment,
            database_environment: databaseEnvironment,
            checks,
          },
          {
            status: ready ? 200 : 503,
            headers: {
              "Cache-Control": "no-store",
              "X-Robots-Tag": "noindex",
            },
          },
        );
      },
    },
  },
});
