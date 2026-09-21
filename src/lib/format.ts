export function ugx(value: number | string | bigint) {
  return `UGX ${Number(value).toLocaleString("en-UG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
export function units(value: number | string) {
  return Number(value).toLocaleString("en-UG", {
    minimumFractionDigits: 6,
    maximumFractionDigits: 6,
  });
}
export function date(value: string) {
  return new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" }).format(
    new Date(value),
  );
}
// Month and year of a timestamp, e.g. "June 2026". Null for missing or
// invalid input so callers can fall back to a stored label.
//
// Timezone is explicit so month-boundary values cannot shift with the
// runtime zone: business timestamps (timestamptz) read in Africa/Kampala,
// while date-only values (PostgreSQL `date` as YYYY-MM-DD) parse as calendar
// dates in UTC instead of undergoing a timezone conversion.
export function monthYear(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const time = Date.UTC(year, month - 1, day);
    const check = new Date(time);
    if (
      check.getUTCFullYear() !== year ||
      check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day
    ) {
      return null;
    }
    return new Intl.DateTimeFormat("en-UG", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(check);
  }
  const time = Date.parse(trimmed);
  if (!Number.isFinite(time)) return null;
  return new Intl.DateTimeFormat("en-UG", {
    month: "long",
    year: "numeric",
    timeZone: "Africa/Kampala",
  }).format(new Date(time));
}
export function dateTime(value: string) {
  return new Intl.DateTimeFormat("en-UG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

// Basis points (e.g. 3000) to a plain percentage number (e.g. 30).
// Stored cycle rates are authoritative; never hardcode the percentage.
export function bpsToPercent(bps: number | string): number {
  return Number(bps) / 100;
}
