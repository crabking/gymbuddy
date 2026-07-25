import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Client, type DatabaseError } from "pg";
import { describe, expect, it, type TestContext } from "vitest";

const databaseAvailable = Boolean(process.env.DATABASE_URL);

function databaseUrl(base: string, database: string) {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

async function applyMigration(client: Client, filename: string) {
  const contents = await readFile(path.join(process.cwd(), "drizzle", filename), "utf8");
  const statements = contents
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);

  await client.query("BEGIN");
  try {
    for (const statement of statements) await client.query(statement);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw new Error(`Migration ${filename} failed`, { cause: error });
  }
}

async function createTemporaryDatabase(context: TestContext) {
  const baseUrl = process.env.DATABASE_URL!;
  const name = `coach_migration_${randomUUID().replaceAll("-", "")}`;
  if (!/^coach_migration_[a-f0-9]{32}$/.test(name)) {
    throw new Error("Refusing to use an unexpected temporary database identifier");
  }
  const admin = new Client({ connectionString: baseUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } catch (error) {
    if ((error as DatabaseError).code === "42501") {
      await admin.end();
      context.skip("DATABASE_URL role cannot create an isolated migration-test database");
      return null;
    }
    await admin.end();
    throw error;
  }
  return { admin, name, url: databaseUrl(baseUrl, name) };
}

describe.runIf(databaseAvailable).sequential("fresh legacy migration chain", () => {
  it("repairs dirty 0011 data without losing legacy records", async (context) => {
    const temporary = await createTemporaryDatabase(context);
    if (!temporary) return;
    const client = new Client({ connectionString: temporary.url });
    let connected = false;
    try {
      await client.connect();
      connected = true;
      const migrations = (await readdir(path.join(process.cwd(), "drizzle")))
        .filter((filename) => /^\d{4}_.+\.sql$/.test(filename))
        .sort((left, right) => left.localeCompare(right));
      const legacyMigrations = migrations.filter(
        (filename) => Number.parseInt(filename.slice(0, 4), 10) <= 11,
      );
      const hardeningMigrations = migrations.filter(
        (filename) => Number.parseInt(filename.slice(0, 4), 10) >= 12,
      );
      expect(legacyMigrations).toHaveLength(12);
      expect(hardeningMigrations.length).toBeGreaterThanOrEqual(5);
      for (const migration of legacyMigrations) await applyMigration(client, migration);

      const userId = randomUUID();
      const olderProgramId = randomUUID();
      const newerProgramId = randomUUID();
      const olderDayId = randomUUID();
      const duplicateDayId = randomUUID();
      const newerDayId = randomUUID();
      const olderSessionId = randomUUID();
      const newerSessionId = randomUUID();
      const olderExerciseId = randomUUID();
      const newerExerciseId = randomUUID();

      await client.query(
        `INSERT INTO users (id, email, password_hash)
         VALUES ($1, $2, 'migration-test-only')`,
        [userId, `migration-${userId}@test.invalid`],
      );
      await client.query(
        `INSERT INTO profiles (
           id, days_per_week, session_minutes, height_cm, weight_kg, age,
           preferred_language, activity_level, daily_calorie_target,
           coach_gender, coach_id
         )
         VALUES ($1, 99, 2, 999, 2, 2, 'xx', 'impossible', 1, 'other', 'unknown')`,
        [userId],
      );
      await client.query(
        `INSERT INTO memories (user_id, topic, content)
         VALUES ($1, 'Unknown', repeat('m', 600)), ($1, 'Preference', repeat('m', 600))`,
        [userId],
      );
      await client.query(
        `INSERT INTO meal_logs (
           user_id, description, calories, protein_g, carbs_g, fat_g, logged_at
         )
         VALUES ($1, '   ', -5, 5000, -1, 5000, '2029-01-02T23:30:00Z')`,
        [userId],
      );
      await client.query(
        `INSERT INTO weight_logs (user_id, weight_kg, logged_at)
         VALUES ($1, 10, '2029-01-02T23:30:00Z')`,
        [userId],
      );
      await client.query(
        `INSERT INTO workspace_files (user_id, path, content)
         VALUES ($1, 'legacy/oversized.txt', repeat('x', 1100123))`,
        [userId],
      );

      await client.query(
        `INSERT INTO programs (
           id, user_id, name, start_date, end_date, weeks, days_per_week,
           status, created_at, completed_at
         )
         VALUES
           ($1, $3, 'Older legacy cycle', '2029-01-01', '2029-01-14', 2, 2,
            'completed', '2029-01-01T00:00:00Z', '2029-01-14T00:00:00Z'),
           ($2, $3, 'Newer legacy cycle', '2029-02-01', '2029-02-14', 2, 2,
            'completed', '2029-02-01T00:00:00Z', '2029-02-14T00:00:00Z')`,
        [olderProgramId, newerProgramId, userId],
      );
      await client.query(
        `INSERT INTO program_days (
           id, program_id, week, day_index, date, title, status
         )
         VALUES
           ($1, $4, 1, 1, '2029-01-01', 'Older A', 'completed'),
           ($2, $4, 1, 1, '2029-01-02', 'Older B', 'planned'),
           ($3, $5, 1, 1, '2029-02-01', 'Newer A', 'completed')`,
        [olderDayId, duplicateDayId, newerDayId, olderProgramId, newerProgramId],
      );
      await client.query(
        `INSERT INTO program_exercises (
           program_day_id, position, name, sets, rep_range, target_weight_kg
         )
         VALUES
           ($1, 0, 'Legacy squat', 0, '5', -10),
           ($1, 0, 'Legacy press', 3, '8', 40)`,
        [olderDayId],
      );
      await client.query(
        `INSERT INTO workout_sessions (
           id, user_id, session_date, title, status, created_at, completed_at, program_day_id
         )
         VALUES
           ($1, $3, '2029-01-01', 'Invalid older session', 'completed',
            '2029-01-01T10:00:00Z', '2029-01-01T11:00:00Z', $4),
           ($2, $3, '2029-02-01', 'Invalid newer session', 'completed',
            '2029-02-01T10:00:00Z', '2029-02-01T11:00:00Z', $5)`,
        [olderSessionId, newerSessionId, userId, olderDayId, newerDayId],
      );
      await client.query(
        `UPDATE program_days
         SET session_id = CASE id WHEN $1 THEN $2::uuid WHEN $3 THEN $4::uuid END
         WHERE id IN ($1, $3)`,
        [olderDayId, olderSessionId, newerDayId, newerSessionId],
      );
      await client.query(
        `INSERT INTO session_exercises (
           id, session_id, position, name, completed, completed_at
         )
         VALUES
           ($1, $3, 0, repeat('s', 240), true, '2029-01-01T11:00:00Z'),
           ($2, $4, 0, 'Legacy bench', true, '2029-02-01T11:00:00Z')`,
        [olderExerciseId, newerExerciseId, olderSessionId, newerSessionId],
      );
      await client.query(
        `INSERT INTO session_sets (
           session_exercise_id, set_index, weight_kg, reps, completed, completed_at
         )
         VALUES
           ($1, 1, 100, 0, true, '2029-01-01T11:00:00Z'),
           ($2, 1, 80, 0, true, '2029-02-01T11:00:00Z')`,
        [olderExerciseId, newerExerciseId],
      );

      for (const migration of hardeningMigrations) await applyMigration(client, migration);

      const [catalog] = (
        await client.query<{
          exercises: number;
          english_names: number;
          swedish_names: number;
          guide_paths: number;
        }>(
          `SELECT
             count(*)::int AS exercises,
             count(DISTINCT name_en)::int AS english_names,
             count(DISTINCT name_sv)::int AS swedish_names,
             count(DISTINCT image_path)::int AS guide_paths
           FROM exercise_catalog`,
        )
      ).rows;
      expect(catalog).toEqual({
        exercises: 96,
        english_names: 96,
        swedish_names: 96,
        guide_paths: 96,
      });

      const [{ active_cycles }] = (
        await client.query<{ active_cycles: number }>(
          `SELECT count(*)::int AS active_cycles
           FROM programs WHERE user_id = $1 AND status = 'active'`,
          [userId],
        )
      ).rows;
      expect(active_cycles).toBe(1);
      const programStates = (
        await client.query<{ id: string; status: string }>(
          `SELECT id, status FROM programs WHERE id IN ($1, $2)`,
          [olderProgramId, newerProgramId],
        )
      ).rows;
      expect(programStates).toEqual(
        expect.arrayContaining([
          { id: olderProgramId, status: "archived" },
          { id: newerProgramId, status: "active" },
        ]),
      );

      const invalidSessions = (
        await client.query<{ status: string; end_reason: string }>(
          `SELECT status, end_reason
           FROM workout_sessions WHERE id IN ($1, $2) ORDER BY id`,
          [olderSessionId, newerSessionId],
        )
      ).rows;
      expect(invalidSessions).toHaveLength(2);
      expect(invalidSessions.every((row) => row.status === "abandoned")).toBe(true);
      expect(
        invalidSessions.every((row) => row.end_reason === "legacy_incomplete_completion"),
      ).toBe(true);

      const [{ invalid_sets }] = (
        await client.query<{ invalid_sets: number }>(
          `SELECT count(*)::int AS invalid_sets
           FROM session_sets
           WHERE completed OR reps IS NOT NULL OR revision <> 0`,
        )
      ).rows;
      expect(invalid_sets).toBe(0);
      const [{ exercise_count, distinct_positions }] = (
        await client.query<{ exercise_count: number; distinct_positions: number }>(
          `SELECT
             count(*)::int AS exercise_count,
             count(DISTINCT position)::int AS distinct_positions
           FROM program_exercises WHERE program_day_id = $1`,
          [olderDayId],
        )
      ).rows;
      expect(exercise_count).toBe(2);
      expect(distinct_positions).toBe(2);
      const [{ distinct_day_positions }] = (
        await client.query<{ distinct_day_positions: number }>(
          `SELECT count(DISTINCT (week, day_index))::int AS distinct_day_positions
           FROM program_days WHERE program_id = $1`,
          [olderProgramId],
        )
      ).rows;
      expect(distinct_day_positions).toBe(2);

      const [{ total_characters, max_size, mismatched_size }] = (
        await client.query<{
          total_characters: number;
          max_size: number;
          mismatched_size: number;
        }>(
          `SELECT
             sum(char_length(content))::int AS total_characters,
             max(size_bytes)::int AS max_size,
             count(*) FILTER (WHERE size_bytes <> octet_length(content))::int AS mismatched_size
           FROM workspace_files
           WHERE user_id = $1
             AND (path = 'legacy/oversized.txt' OR path LIKE '.legacy-overflow/%')`,
          [userId],
        )
      ).rows;
      expect(total_characters).toBe(1_100_123);
      expect(max_size).toBeLessThanOrEqual(1_000_000);
      expect(mismatched_size).toBe(0);

      const invalidWeight = (
        await client.query<{ value: number; unit: string; recorded_date: string }>(
          `SELECT value, unit, recorded_date::text
           FROM measurements
           WHERE user_id = $1 AND metric_key = 'legacy_invalid_body_weight'`,
          [userId],
        )
      ).rows;
      expect(invalidWeight).toEqual([{ value: 10, unit: "kg", recorded_date: "2029-01-02" }]);
      const [{ invalid_bodyweight_rows }] = (
        await client.query<{ invalid_bodyweight_rows: number }>(
          `SELECT count(*)::int AS invalid_bodyweight_rows
           FROM weight_logs WHERE user_id = $1`,
          [userId],
        )
      ).rows;
      expect(invalid_bodyweight_rows).toBe(0);

      const [{ invalid_completed_days, invalid_completed_sessions }] = (
        await client.query<{
          invalid_completed_days: number;
          invalid_completed_sessions: number;
        }>(
          `SELECT
             (SELECT count(*)::int FROM program_days
              WHERE status = 'completed' AND session_id IS NULL) AS invalid_completed_days,
             (SELECT count(*)::int FROM workout_sessions
              WHERE status = 'completed' AND completed_at IS NULL) AS invalid_completed_sessions`,
        )
      ).rows;
      expect(invalid_completed_days).toBe(0);
      expect(invalid_completed_sessions).toBe(0);

      const dateDefaults = (
        await client.query<{ table_name: string; column_default: string | null }>(
          `SELECT table_name, column_default
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND (table_name, column_name) IN (
               ('meal_logs', 'logged_date'),
               ('weight_logs', 'logged_date'),
               ('measurements', 'recorded_date')
             )
           ORDER BY table_name`,
        )
      ).rows;
      expect(dateDefaults).toHaveLength(3);
      expect(dateDefaults.every((row) => row.column_default === null)).toBe(true);
    } finally {
      if (connected) await client.end();
      await temporary.admin.query(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [temporary.name],
      );
      await temporary.admin.query(`DROP DATABASE IF EXISTS "${temporary.name}"`);
      await temporary.admin.end();
    }
  }, 120_000);
});
