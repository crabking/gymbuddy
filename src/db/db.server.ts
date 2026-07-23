import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Server-only Postgres client. NEVER import this from files that ship to the
// browser bundle (route components, *.functions.ts) at the top level — load it
// dynamically inside server handlers/middleware instead. `pg` uses Node
// built-ins and will break a client build.
let _pool: Pool | undefined;
let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getDb() {
  if (!_db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("Missing DATABASE_URL environment variable");
    _pool = new Pool({ connectionString });
    _db = drizzle(_pool, { schema });
  }
  return _db;
}

export { schema };
