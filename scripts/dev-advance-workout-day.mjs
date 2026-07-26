import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
const email = (process.env.DEV_USER_EMAIL ?? "").trim().toLowerCase();
const days = Number.parseInt(process.env.DEV_ADVANCE_DAYS ?? "1", 10);

if (!connectionString || !email) {
  throw new Error("Set DATABASE_URL and DEV_USER_EMAIL");
}
const host = new URL(connectionString).hostname;
if (!["localhost", "127.0.0.1", "::1"].includes(host) || process.env.NODE_ENV === "production") {
  throw new Error("This time-travel helper only runs against a local development database");
}
if (!Number.isInteger(days) || days < 1 || days > 30) {
  throw new Error("DEV_ADVANCE_DAYS must be an integer between 1 and 30");
}

const pool = new Pool({ connectionString, max: 1, application_name: "coach-dev-time-travel" });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const user = await client.query("SELECT id FROM users WHERE email = $1 FOR UPDATE", [email]);
  if (!user.rows[0]) throw new Error(`No local user found for ${email}`);
  const shifted = await client.query(
    `UPDATE workout_sessions
        SET session_date = (session_date::date - ($2::int * interval '1 day'))::date::text
      WHERE user_id = $1
        AND status IN ('completed', 'abandoned')
        AND session_date >= current_date::text
      RETURNING id, program_day_id`,
    [user.rows[0].id, days],
  );
  await client.query(
    `UPDATE program_days AS day
        SET date = session.session_date
       FROM workout_sessions AS session
      WHERE session.user_id = $1
        AND session.program_day_id = day.id
        AND session.status IN ('completed', 'abandoned')
        AND day.date <> session.session_date`,
    [user.rows[0].id],
  );
  await client.query("COMMIT");
  console.log(
    `Advanced ${email} by ${days} simulated day(s); shifted ${shifted.rowCount} session(s).`,
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
