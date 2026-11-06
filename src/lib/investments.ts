// Time progress of an investment toward maturity, 0–100.
// Unlike the legacy app's hardcoded 180-day window, this uses each
// placement's real start and maturity dates. Matured placements and any
// placement past maturity read 100; missing or invalid dates read 0.
import { monthYear } from "@/lib/format";
export function maturityProgress(
  startIso: string | null | undefined,
  maturityIso: string | null | undefined,
  status: string,
  nowMs = Date.now(),
): number {
  if (status === "matured") return 100;
  const start = startIso ? Date.parse(startIso) : NaN;
  const maturity = maturityIso ? Date.parse(maturityIso) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(maturity)) return 0;
  if (maturity <= start) return nowMs >= maturity ? 100 : 0;
  if (nowMs <= start) return 0;
  if (nowMs >= maturity) return 100;
  return Math.round(((nowMs - start) / (maturity - start)) * 100);
}

// Human-readable placement duration, e.g. "June 2026 - December 2026".
// The start is the cycle term start (investment_cycles.opens_at), never the
// reservation timestamp: a request can land days or weeks after the cycle
// opens, so request-month would misstate the contractual term. Reserved
// placements show the cycle term they reserved for; the stored cycle label
// remains the fallback when the term start is unknown. A single month reads
// once ("June 2026"); a missing maturity reads as the start month alone.
// Null when the start is missing or invalid so callers can fall back.
export function investmentPeriod(
  termStart: string | null | undefined,
  maturityIso: string | null | undefined,
): string | null {
  const start = monthYear(termStart);
  if (!start) return null;
  const maturity = monthYear(maturityIso);
  if (!maturity || maturity === start) return start;
  return `${start} - ${maturity}`;
}

export function investmentTitle(
  alias: string | null | undefined,
  defaultTitle: string,
): string {
  return alias?.trim() || defaultTitle;
}

// Paid records and completed instructions are history, even when status remains matured.
export function canChooseMaturity(
  investment: {
    status: string;
    record_origin: string;
    payout_basis: string;
    offline_settlement_id?: string | null;
  },
  instructionStatus?: string | null,
): boolean {
  return (
    investment.status === "matured" &&
    investment.payout_basis !== "reported_paid" &&
    instructionStatus !== "fulfilled" &&
    !investment.offline_settlement_id
  );
}

// Cycle names are contractual labels; opening windows can start in the prior month.
export function investmentCycleTitle(name: string | null | undefined): string {
  return name?.trim() ? `${name.trim()} cycle` : "OURMU investment";
}

export function investmentRecordedDate(
  receipt: { source: string; transaction_date: string } | null | undefined,
  status: string,
  requestedAt: string,
): { label: string; value: string } | undefined {
  if (receipt?.source === "bank_activation")
    return { label: "Payment received", value: receipt.transaction_date };
  if (receipt?.source === "reinvestment")
    return { label: "Reinvested", value: receipt.transaction_date };
  if (status === "reserved") return { label: "Reserved", value: requestedAt };
  // Imported records have no verified payment date. Never infer one from entry time.
  return undefined;
}
