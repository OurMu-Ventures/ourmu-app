// Cycle-wide actual returns. An admin records one rate (basis points) per
// cycle; each placement's actual profit derives from its own principal at the
// database's eight-decimal scale, exactly as private.cycle_actual_return_ugx.
// Timing follows Africa/Kampala calendar dates: the rate is revisable until
// the maturity date begins in Kampala, then locks.

export const MAX_ACTUAL_RETURN_BPS = 100_000;

// "27.35" -> 2735. Two decimal places at most; 0% to 1,000%. String-based so
// no floating-point rounding can change the recorded rate.
export function parsePercentToBps(input: string): number | null {
  const value = input.trim();
  const match = /^(\d{1,4})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return bps <= MAX_ACTUAL_RETURN_BPS ? bps : null;
}

// 2735 -> "27.35%", 3000 -> "30%".
export function formatBpsPercent(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const fraction = bps % 100;
  return fraction === 0
    ? `${whole}%`
    : `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}%`;
}

function moneyUnits(value: number | string): bigint {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric >= 1e21)
    throw new Error("Invalid amount");
  return BigInt(numeric.toFixed(8).replace(".", ""));
}

// round(principal * bps / 10000, 8), half away from zero (amounts are >= 0).
export function cycleActualReturnUgx(
  principalUgx: number | string,
  actualReturnBps: number,
): number {
  if (
    !Number.isInteger(actualReturnBps) ||
    actualReturnBps < 0 ||
    actualReturnBps > MAX_ACTUAL_RETURN_BPS
  )
    throw new Error("Invalid actual return");
  const product = moneyUnits(principalUgx) * BigInt(actualReturnBps);
  return Number((product + 5_000n) / 10_000n) / 100_000_000;
}

export function kampalaDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function actualReturnLocked(
  maturityDateIso: string,
  now: Date = new Date(),
): boolean {
  return kampalaDate(now) >= maturityDateIso;
}

// The day before maturity onward, a missing rate needs admin attention.
export function actualReturnRequired(
  maturityDateIso: string,
  actualReturnBps: number | null | undefined,
  now: Date = new Date(),
): boolean {
  if (actualReturnBps != null) return false;
  const [year, month, day] = maturityDateIso.split("-").map(Number);
  const dayBefore = new Date(Date.UTC(year, month - 1, day - 1))
    .toISOString()
    .slice(0, 10);
  return kampalaDate(now) >= dayBefore;
}

export type ReturnBasis = "paid" | "actual" | "projected";

export type InvestmentReturnView = {
  basis: ReturnBasis;
  profitUgx: number;
  valueUgx: number;
  projectedProfitUgx: number;
  projectedValueUgx: number;
  actualReturnBps: number | null;
  // Published before maturity: may still be revised until maturity.
  revisable: boolean;
  // Matured (or past maturity) without a recorded cycle rate.
  pending: boolean;
};

// The figures an investor sees for one placement: reported-paid history,
// the recorded cycle return, or the projection.
export function investmentReturnView(
  investment: {
    principal_ugx: number | string;
    projected_return_ugx: number | string;
    projected_value_ugx: number | string;
    maturity_date: string;
    payout_basis: string;
    reported_return_ugx?: number | string | null;
    reported_payout_ugx?: number | string | null;
  },
  cycle:
    | {
        actual_return_bps?: number | null;
        legacy_settlement?: boolean | null;
      }
    | null
    | undefined,
  now: Date = new Date(),
): InvestmentReturnView {
  const principal = Number(investment.principal_ugx);
  const projectedProfit = Number(investment.projected_return_ugx);
  const projectedValue = Number(investment.projected_value_ugx);
  const actualReturnBps = cycle?.actual_return_bps ?? null;
  const base = {
    projectedProfitUgx: projectedProfit,
    projectedValueUgx: projectedValue,
    actualReturnBps,
    revisable: false,
    pending: false,
  };
  if (investment.payout_basis === "reported_paid") {
    const value = Number(investment.reported_payout_ugx ?? projectedValue);
    return {
      ...base,
      basis: "paid",
      profitUgx: Number(investment.reported_return_ugx ?? value - principal),
      valueUgx: value,
    };
  }
  const locked = actualReturnLocked(investment.maturity_date, now);
  if (actualReturnBps != null) {
    const profit = cycleActualReturnUgx(principal, actualReturnBps);
    return {
      ...base,
      basis: "actual",
      profitUgx: profit,
      valueUgx:
        Number(moneyUnits(principal) + moneyUnits(profit)) / 100_000_000,
      revisable: !locked,
    };
  }
  return {
    ...base,
    basis: "projected",
    profitUgx: projectedProfit,
    valueUgx: projectedValue,
    pending: locked && !cycle?.legacy_settlement,
  };
}
