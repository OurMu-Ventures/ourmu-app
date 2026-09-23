export type MaturityChoice =
  | "withdraw_all"
  | "withdraw_roi_reinvest_principal"
  | "reinvest_all";

export const MATURITY_CHOICES: {
  value: MaturityChoice;
  label: string;
  description: string;
}[] = [
  {
    value: "withdraw_all",
    label: "Withdraw principal and ROI",
    description: "Receive the full principal plus the return as a payout.",
  },
  {
    value: "withdraw_roi_reinvest_principal",
    label: "Withdraw ROI, reinvest principal",
    description: "Receive the return as a payout and reinvest the principal.",
  },
  {
    value: "reinvest_all",
    label: "Reinvest principal and ROI",
    description: "Reinvest the full maturity value into a new cycle.",
  },
];

// Scheduled payout day: the 15th of the maturity month (ISO date string).
export function maturityPayoutDateIso(maturityDateIso: string): string {
  const [year, month] = maturityDateIso.split("-").map(Number);
  const padded = String(month).padStart(2, "0");
  return `${year}-${padded}-15`;
}

// Projected split for a choice, from the placement's own projected figures.
// The projected return is shown when the choice opens; fulfillment always
// uses the actual ROI recorded by an admin instead.
export function maturitySplits(
  principalUgx: number,
  projectedReturnUgx: number,
  choice: MaturityChoice,
): { payoutUgx: number; reinvestUgx: number } {
  if (choice === "withdraw_all")
    return { payoutUgx: principalUgx + projectedReturnUgx, reinvestUgx: 0 };
  if (choice === "withdraw_roi_reinvest_principal")
    return { payoutUgx: projectedReturnUgx, reinvestUgx: principalUgx };
  return { payoutUgx: 0, reinvestUgx: principalUgx + projectedReturnUgx };
}

// Fulfilled split for a choice, from the actual ROI recorded by an admin.
export function fulfilledSplits(
  principalUgx: number,
  actualRoiUgx: number,
  choice: MaturityChoice,
): { payoutUgx: number; reinvestUgx: number } {
  if (choice === "withdraw_all")
    return { payoutUgx: principalUgx + actualRoiUgx, reinvestUgx: 0 };
  if (choice === "withdraw_roi_reinvest_principal")
    return { payoutUgx: actualRoiUgx, reinvestUgx: principalUgx };
  return { payoutUgx: 0, reinvestUgx: principalUgx + actualRoiUgx };
}

// The ROI implied by an instruction's projected splits. Fulfillment uses
// the admin-recorded actual ROI; when it differs from this basis the
// partner must confirm the recalculated amounts before execution.
export function impliedProjectedRoi(
  principalUgx: number,
  projectedPayoutUgx: number,
  projectedReinvestUgx: number,
): number {
  return projectedPayoutUgx + projectedReinvestUgx - principalUgx;
}

// Portal cycles must mature on or before the 15th payout day so the payout
// date (the 15th of the maturity month) never precedes maturity.
export function isMaturityDayAllowed(maturityDateIso: string): boolean {
  const day = Number(maturityDateIso.split("-")[2]);
  return Number.isInteger(day) && day >= 1 && day <= 15;
}
