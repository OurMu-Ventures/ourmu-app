export const AUTO_CYCLE_POLICY_VERSION = "auto_cycle_v1";

// Payment deadline for a new reservation: earlier of 48h after reservation
// (or now, for the pre-reservation preview) or the cycle's closing time.
export function reservationDeadlineIso(
  baseIso: string,
  closesAtIso: string,
): string {
  const base = new Date(baseIso).getTime();
  const closes = new Date(closesAtIso).getTime();
  const deadline = Math.min(base + 48 * 60 * 60 * 1000, closes);
  return new Date(deadline).toISOString();
}

// Convert a Kampala wall-clock datetime-local value (YYYY-MM-DDTHH:mm[:ss])
// to an ISO timestamptz. Kampala is UTC+3 year-round (no DST).
export function kampalaLocalToIso(value: string): string | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const utc = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h) - 3,
    Number(mi),
    Number(s ?? "0"),
  );
  if (!Number.isFinite(utc)) return null;
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
