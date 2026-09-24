// Exact UGX formatting for receipts: preserve stored numeric precision
// without silent rounding. Accepts the raw numeric string from Postgres
// numeric(28,8) (or a number) and groups the integer part, keeping the
// fractional scale intact with a minimum of two decimals.
export function formatUgxExact(value: string | number | bigint): string {
  let raw = typeof value === "bigint" ? value.toString() : String(value).trim();
  if (!raw) return "UGX 0.00";
  let negative = false;
  if (raw.startsWith("-")) {
    negative = true;
    raw = raw.slice(1);
  }
  const [intPartRaw, fracPartRaw = ""] = raw.split(".");
  const intDigits = intPartRaw.replace(/[^0-9]/g, "") || "0";
  const fracDigits = fracPartRaw.replace(/[^0-9]/g, "");
  // Keep up to 8 decimals (numeric(28,8)); pad to at least 2.
  const frac = (fracDigits.slice(0, 8) + "00").slice(0, Math.max(2, Math.min(8, fracDigits.length || 2)));
  const grouped = intDigits
    .replace(/^0+(?=\d)/, "")
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `UGX ${negative ? "-" : ""}${grouped}.${frac}`;
}

// Normalise a numeric string for stable hashing/comparison.
export function normaliseAmount(value: string | number): string {
  return String(value).trim();
}
