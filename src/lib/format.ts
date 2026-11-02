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
// PostgreSQL `date` values (YYYY-MM-DD) are calendar days, not instants.
// Returns UTC midnight of the day, to format with timeZone "UTC" so the day
// cannot shift with the runtime zone; NaN for days that do not exist (e.g.
// 2026-02-30); null when the value is not date-only.
function parseDateOnly(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const time = Date.UTC(year, month - 1, day);
  const check = new Date(time);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return NaN;
  }
  return time;
}
// Day, month and year, e.g. "31 Dec 2026". Date-only values show their
// calendar day on any runtime timezone; timestamps show their Africa/Kampala
// day. Invalid input, including impossible days, throws RangeError.
export function date(value: string) {
  const day = parseDateOnly(value.trim());
  if (day !== null) {
    return new Intl.DateTimeFormat("en-UG", {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(day);
  }
  return new Intl.DateTimeFormat("en-UG", {
    dateStyle: "medium",
    timeZone: "Africa/Kampala",
  }).format(new Date(value));
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
  const day = parseDateOnly(trimmed);
  if (day !== null) {
    if (!Number.isFinite(day)) return null;
    return new Intl.DateTimeFormat("en-UG", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(day);
  }
  const time = Date.parse(trimmed);
  if (!Number.isFinite(time)) return null;
  return new Intl.DateTimeFormat("en-UG", {
    month: "long",
    year: "numeric",
    timeZone: "Africa/Kampala",
  }).format(new Date(time));
}
// Day, month, year and time of a timestamp in Africa/Kampala, e.g.
// "1 Jan 2027, 00:30". The explicit zone keeps server rendering (UTC on
// Vercel) and browser hydration identical.
export function dateTime(value: string) {
  return new Intl.DateTimeFormat("en-UG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Kampala",
  }).format(new Date(value));
}

// Basis points (e.g. 3000) to a plain percentage number (e.g. 30).
// Stored cycle rates are authoritative; never hardcode the percentage.
export function bpsToPercent(bps: number | string): number {
  return Number(bps) / 100;
}
