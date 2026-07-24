const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function assertIsoDate(value: string): string {
  if (!isIsoDate(value)) throw new Error("Invalid local date");
  return value;
}

export function addLocalDays(value: string, days: number): string {
  assertIsoDate(value);
  if (!Number.isInteger(days) || Math.abs(days) > 100_000) {
    throw new Error("Invalid day offset");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function normalizeTimeZone(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate || candidate.length > 100) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return null;
  }
}

export function localDateInTimeZone(timeZone: string, instant: Date = new Date()): string {
  const normalized = normalizeTimeZone(timeZone);
  if (!normalized) throw new Error("Invalid time zone");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: normalized,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value;
  return assertIsoDate(`${part("year")}-${part("month")}-${part("day")}`);
}
