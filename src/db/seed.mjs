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
  { email, password, role: "admin" },
  ...(extraEmail ? [{ email: extraEmail, password: extraPassword, role: "admin" }] : []),
];

if (
  email.length > 254 ||
  password.length < 8 ||
  password.length > 128 ||
  (extraEmail &&
    (extraEmail.length > 254 || extraPassword.length < 8 || extraPassword.length > 128))
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
    let passwordHash;
    if (existing.rows[0]) {
      userId = existing.rows[0].id;
      if (!verifyPassword(account.password, existing.rows[0].password_hash)) {
        passwordHash = hashPassword(account.password);
        await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
          passwordHash,
          userId,
        ]);
        // Password rotation must revoke stolen sessions atomically.
        await client.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
        rotated = true;
      } else {
        passwordHash = existing.rows[0].password_hash;
      }
    } else {
      passwordHash = hashPassword(account.password);
      const inserted = await client.query(
        "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
        [account.email, passwordHash],
      );
      userId = inserted.rows[0].id;
    }
    await client.query("INSERT INTO profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING", [
      userId,
    ]);
    const betterAuthTables = await client.query(
      "SELECT to_regclass('public.auth_users') IS NOT NULL AS available",
    );
    if (betterAuthTables.rows[0]?.available) {
      await client.query(
        `INSERT INTO auth_users
          (id, name, email, email_verified, role, banned, two_factor_enabled, created_at, updated_at)
         VALUES
          ($1, COALESCE((SELECT display_name FROM profiles WHERE id = $1), split_part($2, '@', 1)),
           $2, true, $3, false, false, now(), now())
         ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          email_verified = true,
          role = EXCLUDED.role,
          updated_at = now()`,
        [userId, account.email, account.role],
      );
      await client.query(
        `INSERT INTO auth_accounts
          (account_id, provider_id, user_id, password, created_at, updated_at)
         VALUES ($1::text, 'credential', $1::uuid, $2, now(), now())
         ON CONFLICT (provider_id, account_id) DO UPDATE SET
          password = EXCLUDED.password,
          updated_at = now()`,
        [userId, passwordHash],
      );
      if (rotated) {
        await client.query("DELETE FROM auth_sessions WHERE user_id = $1", [userId]);
      }
    }
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
