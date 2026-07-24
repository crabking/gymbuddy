import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import { measurements } from "@/db/schema";
import { assertIsoDate, normalizeTimeZone } from "@/lib/local-date";

const METRIC_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export type LogMeasurementInput = {
  metric_key: string;
  label: string;
  value: number;
  unit: string;
  recorded_date: string;
  timezone?: string | null;
  notes?: string | null;
  source_key?: string | null;
};

export type MeasurementCursor = {
  recorded_date: string;
  recorded_at: string;
  id: string;
};

function clean(value: string, max: number, field: string) {
  const result = value.replace(/\s+/g, " ").trim();
  if (!result || result.length > max) throw new Error(`Invalid ${field}`);
  return result;
}

export async function logMeasurement(userId: string, input: LogMeasurementInput) {
  const metricKey = input.metric_key.trim().toLowerCase();
  if (!METRIC_KEY.test(metricKey)) throw new Error("Invalid metric key");
  if (!Number.isFinite(input.value) || Math.abs(input.value) > 1_000_000) {
    throw new Error("Invalid measurement value");
  }
  const timezone = normalizeTimeZone(input.timezone);
  if (input.timezone != null && input.timezone.trim() && !timezone) {
    throw new Error("Invalid measurement timezone");
  }
  let sourceKey: string | null = null;
  if (input.source_key != null) {
    sourceKey = input.source_key.trim();
    if (!sourceKey || sourceKey.length > 200) {
      throw new Error("Invalid measurement source key");
    }
  }
  const value = {
    user_id: userId,
    metric_key: metricKey,
    label: clean(input.label, 100, "measurement label"),
    value: input.value,
    unit: clean(input.unit, 40, "measurement unit"),
    recorded_date: assertIsoDate(input.recorded_date),
    timezone,
    notes: input.notes ? clean(input.notes, 1000, "measurement notes") : null,
    source_key: sourceKey,
  };
  const db = getDb();
  return db.transaction(async (tx) => {
    // One account-scoped lock protects both the source-key ledger and the
    // first row that establishes a metric key's durable label/unit.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"measurement:" + userId}, 0))`,
    );

    if (sourceKey) {
      const [existing] = await tx
        .select()
        .from(measurements)
        .where(and(eq(measurements.user_id, userId), eq(measurements.source_key, sourceKey)))
        .limit(1);
      if (existing) {
        if (!sameMeasurement(existing, value)) {
          throw new Error("Measurement source key conflicts with different data");
        }
        return { ...existing, idempotent: true };
      }
    }

    const [definition] = await tx
      .select({ label: measurements.label, unit: measurements.unit })
      .from(measurements)
      .where(and(eq(measurements.user_id, userId), eq(measurements.metric_key, metricKey)))
      .limit(1);
    if (definition && (definition.label !== value.label || definition.unit !== value.unit)) {
      throw new Error(
        `Measurement key "${metricKey}" already means "${definition.label}" in ${definition.unit}`,
      );
    }

    const [inserted] = await tx.insert(measurements).values(value).returning();
    if (!inserted) throw new Error("Measurement could not be saved");
    return { ...inserted, idempotent: false };
  });
}

function sameMeasurement(
  existing: typeof measurements.$inferSelect,
  expected: typeof measurements.$inferInsert,
) {
  return (
    existing.metric_key === expected.metric_key &&
    existing.label === expected.label &&
    existing.value === expected.value &&
    existing.unit === expected.unit &&
    existing.recorded_date === expected.recorded_date &&
    existing.timezone === (expected.timezone ?? null) &&
    existing.notes === (expected.notes ?? null)
  );
}

export async function getMeasurements(
  userId: string,
  options: {
    metricKey?: string;
    since?: string;
    limit?: number;
    before?: MeasurementCursor | null;
  } = {},
) {
  const requestedLimit = options.limit ?? 200;
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 1000) {
    throw new Error("Invalid measurement limit");
  }
  const limit = requestedLimit;
  const predicates = [eq(measurements.user_id, userId)];
  if (options.metricKey) {
    const key = options.metricKey.trim().toLowerCase();
    if (!METRIC_KEY.test(key)) throw new Error("Invalid metric key");
    predicates.push(eq(measurements.metric_key, key));
  }
  if (options.since) {
    predicates.push(gte(measurements.recorded_date, assertIsoDate(options.since)));
  }
  if (options.before) {
    assertIsoDate(options.before.recorded_date);
    if (
      !Number.isFinite(new Date(options.before.recorded_at).getTime()) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        options.before.id,
      )
    ) {
      throw new Error("Invalid measurement cursor");
    }
    predicates.push(
      sql`(${measurements.recorded_date}, ${measurements.recorded_at}, ${measurements.id}) < (${options.before.recorded_date}::date, ${options.before.recorded_at}::timestamptz, ${options.before.id}::uuid)`,
    );
  }
  return getDb()
    .select()
    .from(measurements)
    .where(and(...predicates))
    .orderBy(
      desc(measurements.recorded_date),
      desc(measurements.recorded_at),
      desc(measurements.id),
    )
    .limit(limit);
}

export async function summarizeMeasurements(userId: string) {
  const rows = await getDb()
    .selectDistinctOn([measurements.metric_key], {
      metric_key: measurements.metric_key,
      label: measurements.label,
      value: measurements.value,
      unit: measurements.unit,
      recorded_date: measurements.recorded_date,
    })
    .from(measurements)
    .where(eq(measurements.user_id, userId))
    .orderBy(
      asc(measurements.metric_key),
      desc(measurements.recorded_date),
      desc(measurements.recorded_at),
      desc(measurements.id),
    )
    .limit(25);
  if (rows.length === 0) return "(no custom measurements yet)";
  return rows
    .map(
      (row) =>
        `- ${row.label}: ${row.value} ${row.unit} (${row.recorded_date}; key ${row.metric_key})`,
    )
    .join("\n");
}
