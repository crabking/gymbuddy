import pg from "pg";

const { Client } = pg;
const allowed = new Set(["local", "staging", "production"]);
const appEnvironment = (process.env.APP_ENV || "local").trim().toLowerCase();
const connectionString = process.env.DATABASE_URL;

if (!allowed.has(appEnvironment)) {
  throw new Error(`APP_ENV must be one of: ${[...allowed].join(", ")}`);
}
if (!connectionString) throw new Error("Missing DATABASE_URL");

const client = new Client({ connectionString });
await client.connect();
try {
  await client.query("begin");
  await client.query(
    "select pg_advisory_xact_lock(hashtextextended('coach:deployment-environment', 0))",
  );
  const existing = await client.query(
    "select value from deployment_metadata where key = 'app_environment' limit 1",
  );
  if (existing.rowCount === 0) {
    await client.query(
      "insert into deployment_metadata (key, value) values ('app_environment', $1)",
      [appEnvironment],
    );
  } else if (existing.rows[0].value !== appEnvironment) {
    throw new Error(
      `Environment mismatch: ${appEnvironment} application cannot use a ${existing.rows[0].value} database`,
    );
  }
  await client.query("commit");
  console.log(`Environment database verified: ${appEnvironment}`);
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}
