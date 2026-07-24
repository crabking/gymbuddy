// Applies pending Drizzle migrations at container start (before the server
// boots). Uses drizzle-orm's programmatic migrator against ./drizzle.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  console.error("[migrate] Missing DATABASE_URL");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 15_000,
  statement_timeout: 5 * 60_000,
  idle_in_transaction_session_timeout: 5 * 60_000,
  application_name: "coach-migrate",
});
const client = await pool.connect();
try {
  // Every replica starts the same image. Hold one session-level lock so only
  // one process can advance the migration journal at a time.
  await client.query("select pg_advisory_lock(hashtextextended('coach-schema-migration', 0))");
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  console.log("[migrate] up to date");
} catch (err) {
  console.error("[migrate] failed:", err);
  process.exitCode = 1;
} finally {
  try {
    await client.query("select pg_advisory_unlock(hashtextextended('coach-schema-migration', 0))");
  } finally {
    client.release();
  }
  await pool.end();
}
