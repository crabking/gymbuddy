// Applies pending Drizzle migrations at container start (before the server
// boots). Uses drizzle-orm's programmatic migrator against ./drizzle.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  console.error("[migrate] Missing DATABASE_URL");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log("[migrate] up to date");
} catch (err) {
  console.error("[migrate] failed:", err);
  process.exit(1);
} finally {
  await pool.end();
}
