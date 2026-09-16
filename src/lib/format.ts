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
