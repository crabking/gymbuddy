// Seed / upsert an app login. The app is invite-only — this is the only way to
// create accounts (there is no public sign-up).
//
//   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=secret npm run db:seed
//
// Re-run with different values to add more people; an existing email just has
// its password reset.
import { Pool } from "pg";
import { randomBytes, scryptSync } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || "";

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}
if (!email || !password) {
  console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD");
  process.exit(1);
}

// Must match src/lib/auth.server.ts hashPassword: `scrypt:<saltHex>:<hashHex>`, keylen 64.
function hashPassword(pw) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

const pool = new Pool({ connectionString: DATABASE_URL });
try {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id`,
    [email, hashPassword(password)],
  );
  const userId = rows[0].id;
  await pool.query(`INSERT INTO profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [userId]);
  console.log(`Seeded login ${email} (${userId})`);
} catch (err) {
  console.error("Seed failed:", err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
