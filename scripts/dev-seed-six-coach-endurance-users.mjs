import { randomBytes, scryptSync } from "node:crypto";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const hostname = new URL(connectionString).hostname.toLowerCase();
if (
  !["localhost", "127.0.0.1", "::1"].includes(hostname) ||
  process.env.NODE_ENV === "production"
) {
  throw new Error("Six-coach endurance users may only be seeded in a local development database");
}

const PASSWORD = "local-endurance";
const USERS = [
  { coachId: "eli", gender: "male", email: "endurance-eli@gymbuddy.local" },
  { coachId: "maya", gender: "female", email: "endurance-maya@gymbuddy.local" },
  { coachId: "rex", gender: "male", email: "endurance-ct@gymbuddy.local" },
  { coachId: "reya", gender: "female", email: "endurance-nova@gymbuddy.local" },
  { coachId: "brutus", gender: "male", email: "endurance-tank@gymbuddy.local" },
  { coachId: "nova", gender: "female", email: "endurance-athena@gymbuddy.local" },
];

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${digest}`;
}

const pool = new Pool({
  connectionString,
  max: 1,
  application_name: "coach-six-persona-endurance-seed",
});
const client = await pool.connect();
try {
  await client.query("BEGIN");
  for (const account of USERS) {
    await client.query("DELETE FROM users WHERE email = $1", [account.email]);
    const result = await client.query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id`,
      [account.email, hashPassword(PASSWORD)],
    );
    await client.query(
      `INSERT INTO profiles (
         id, coach_id, coach_gender, preferred_language, timezone, onboarding_completed, data_epoch
       )
       VALUES ($1, $2, $3, 'en', 'Europe/Stockholm', false, 0)`,
      [result.rows[0].id, account.coachId, account.gender],
    );
  }
  await client.query("COMMIT");
  console.log(`Seeded ${USERS.length} clean local endurance accounts.`);
  console.log(`Password: ${PASSWORD}`);
  for (const account of USERS) console.log(`${account.coachId}: ${account.email}`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
