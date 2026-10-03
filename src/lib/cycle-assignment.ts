export const AUTO_CYCLE_POLICY_VERSION = "auto_cycle_v1";

// Convert a Kampala wall-clock datetime-local value (YYYY-MM-DDTHH:mm[:ss])
// to an ISO timestamptz. Kampala is UTC+3 year-round (no DST).
export function kampalaLocalToIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    value.trim(),
  );
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const year = Number(y),
    month = Number(mo),
    day = Number(d);
  const hour = Number(h),
    minute = Number(mi),
    second = Number(s ?? "0");
  if (
    year < 1000 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return null;
  const local = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day
  )
    return null;
  const utc = local.getTime() - 3 * 60 * 60 * 1000;
  return new Date(utc).toISOString();
}

export function kampalaDateOfIso(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export type AssignedCycle = {
  id: string;
  name: string;
  maturity_date: string;
  closes_at: string;
  agreement_version_id: string;
  agreement_title: string;
};
