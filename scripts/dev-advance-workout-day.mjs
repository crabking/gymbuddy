import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
const email = (process.env.DEV_USER_EMAIL ?? "").trim().toLowerCase();
const days = Number.parseInt(process.env.DEV_ADVANCE_DAYS ?? "1", 10);
const activeSessionMinutes = Number.parseInt(process.env.DEV_ADVANCE_SESSION_MINUTES ?? "0", 10);

if (!connectionString || !email) {
  throw new Error("Set DATABASE_URL and DEV_USER_EMAIL");
}
const host = new URL(connectionString).hostname;
if (!["localhost", "127.0.0.1", "::1"].includes(host) || process.env.NODE_ENV === "production") {
  throw new Error("This time-travel helper only runs against a local development database");
}
if (!Number.isInteger(days) || days < 0 || days > 30) {
  throw new Error("DEV_ADVANCE_DAYS must be an integer between 0 and 30");
}
if (
  !Number.isInteger(activeSessionMinutes) ||
  activeSessionMinutes < 0 ||
  activeSessionMinutes > 720
) {
  throw new Error("DEV_ADVANCE_SESSION_MINUTES must be an integer between 0 and 720");
}
if (days === 0 && activeSessionMinutes === 0) {
  throw new Error("Advance at least one simulated day or active-session minute");
}

const pool = new Pool({ connectionString, max: 1, application_name: "coach-dev-time-travel" });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const user = await client.query("SELECT id FROM users WHERE email = $1 FOR UPDATE", [email]);
  if (!user.rows[0]) throw new Error(`No local user found for ${email}`);
  let shiftedSessionDays = 0;
  if (days > 0) {
    const shifted = await client.query(
      `UPDATE workout_sessions
          SET session_date = (session_date::date - ($2::int * interval '1 day'))::date::text
        WHERE user_id = $1
          AND status IN ('completed', 'abandoned')
          AND session_date >= current_date::text
        RETURNING id, program_day_id`,
      [user.rows[0].id, days],
    );
    shiftedSessionDays = shifted.rowCount ?? 0;
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
  }
  let agedActiveSessions = 0;
  if (activeSessionMinutes > 0) {
    const aged = await client.query(
      `UPDATE workout_sessions
          SET created_at = created_at - ($2::int * interval '1 minute')
        WHERE user_id = $1
          AND status = 'active'
        RETURNING id`,
      [user.rows[0].id, activeSessionMinutes],
    );
    agedActiveSessions = aged.rowCount ?? 0;
  }
  await client.query("COMMIT");
  console.log(
    `Advanced ${email}: ${days} simulated day(s) shifted ${shiftedSessionDays} completed session(s); ${activeSessionMinutes} simulated minute(s) aged ${agedActiveSessions} active session(s).`,
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
