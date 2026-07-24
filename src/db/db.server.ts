import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Server-only Postgres client. NEVER import this from files that ship to the
// browser bundle (route components, *.functions.ts) at the top level — load it
// dynamically inside server handlers/middleware instead. `pg` uses Node
// built-ins and will break a client build.
let _pool: Pool | undefined;
let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function getDb() {
  if (!_db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("Missing DATABASE_URL environment variable");
    _pool = new Pool({
      connectionString,
      max: boundedInteger(process.env.DB_POOL_MAX, 10, 1, 50),
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      statement_timeout: 30_000,
      query_timeout: 35_000,
      idle_in_transaction_session_timeout: 30_000,
      application_name: "coach-app",
    });
    _pool.on("error", (error) => {
      // Idle client errors are otherwise emitted without a consumer and can
      // terminate the Node process.
      console.error("Unexpected PostgreSQL pool error", error);
    });
    _db = drizzle(_pool, { schema });
  }
  return _db;
}

export { schema };
