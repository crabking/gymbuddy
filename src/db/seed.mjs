// Seed / upsert an app login. The app is invite-only — this is the only way to
// create accounts (there is no public sign-up).
//
//   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=secret npm run db:seed
//
// Re-run with different values to add more people; an existing email just has
// its password reset.
import { Pool } from "pg";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || "";
const extraEmail = (process.env.EXTRA_ADMIN_EMAIL || "").trim().toLowerCase();
const extraPassword = process.env.EXTRA_ADMIN_PASSWORD || "";

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}
if (!email || !password) {
  console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD");
  process.exit(1);
}
if ((extraEmail && !extraPassword) || (!extraEmail && extraPassword)) {
  console.error("Set both EXTRA_ADMIN_EMAIL and EXTRA_ADMIN_PASSWORD");
  process.exit(1);
}

const accounts = [
  { email, password },
  ...(extraEmail ? [{ email: extraEmail, password: extraPassword }] : []),
];

if (
  accounts.some(
    (account) =>
      account.email.length > 254 ||
      account.password.length < 8 ||
      account.password.length > 1024,
  )
) {
  console.error("ADMIN_EMAIL or ADMIN_PASSWORD does not meet the login policy");
  process.exit(1);
}

// Must match src/lib/auth.server.ts hashPassword: `scrypt:<saltHex>:<hashHex>`, keylen 64.
function hashPassword(pw) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(pw, stored) {
  const [scheme, salt, hashHex] = String(stored ?? "").split(":");
  if (
    scheme !== "scrypt" ||
    !/^[a-f0-9]{32}$/i.test(salt ?? "") ||
    !/^[a-f0-9]{128}$/i.test(hashHex ?? "")
  ) {
    return false;
  }
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(pw, salt, expected.length);
  return timingSafeEqual(expected, actual);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 15_000,
  statement_timeout: 30_000,
  idle_in_transaction_session_timeout: 30_000,
  application_name: "coach-seed",
});
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const results = [];
  for (const account of accounts) {
    const existing = await client.query(
      "SELECT id, password_hash FROM users WHERE email = $1 FOR UPDATE",
      [account.email],
    );
    let userId;
    let rotated = false;
    if (existing.rows[0]) {
      userId = existing.rows[0].id;
      if (!verifyPassword(account.password, existing.rows[0].password_hash)) {
        await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
          hashPassword(account.password),
          userId,
        ]);
        // Password rotation must revoke stolen sessions atomically.
        await client.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
        rotated = true;
      }
    } else {
      const inserted = await client.query(
        "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
        [account.email, hashPassword(account.password)],
      );
      userId = inserted.rows[0].id;
    }
    await client.query(
      "INSERT INTO profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING",
      [userId],
    );
    results.push(
      rotated
        ? `Updated login ${account.email}; existing sessions revoked`
        : `Login ${account.email} is up to date`,
    );
  }
  await client.query("COMMIT");
  console.log(results.join("\n"));
} catch (err) {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error("Seed failed:", err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
