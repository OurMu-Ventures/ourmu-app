export type MaturityChoice =
  "withdraw_all" | "withdraw_roi_reinvest_principal" | "reinvest_all";

export type MaturityNoticeInput = {
  principalUgx: number;
  projectedReturnUgx: number;
  projectedValueUgx: number;
  projectedPercent: number;
  maturityDate: string;
  payoutDate: string;
};

export const MATURITY_CHOICES: {
  value: MaturityChoice;
  label: string;
  description: string;
}[] = [
  {
    value: "withdraw_all",
    label: "A. Bijjodolo payout",
    description: "You withdraw both your Principal and ROI.",
  },
  {
    value: "withdraw_roi_reinvest_principal",
    label: "B. Paka Paka payout",
    description:
      "Here, you withdraw only your ROI and Re-invest the principal.",
  },
  {
    value: "reinvest_all",
    label: "C. Dobolo Payout",
    description: "Re-Invest your ROI and Principal.",
  },
];

export function maturityChoiceLabel(choice: string): string {
  return (
    MATURITY_CHOICES.find((option) => option.value === choice)?.label ?? choice
  );
}

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

// Pure composer for the maturity notice email body. Kept here (instead of
// the job runner) so the figures it quotes are unit-tested.
export function maturityNoticeDetail(input: MaturityNoticeInput): string {
  const withdrawAll = maturitySplits(
    input.principalUgx,
    input.projectedReturnUgx,
    "withdraw_all",
  );
  const middle = maturitySplits(
    input.principalUgx,
    input.projectedReturnUgx,
    "withdraw_roi_reinvest_principal",
  );
  const reinvestAll = maturitySplits(
    input.principalUgx,
    input.projectedReturnUgx,
    "reinvest_all",
  );
  const money = (value: number) =>
    `UGX ${value.toLocaleString("en-UG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    `Your OURMU investment of ${money(input.principalUgx)} matured on ${input.maturityDate} ` +
    `with a projected ${input.projectedPercent}% return of ${money(input.projectedReturnUgx)} ` +
    `(projected value ${money(input.projectedValueUgx)}). Payouts are scheduled for ${input.payoutDate}. ` +
    `Record your choice on the investment page: ${maturityChoiceLabel("withdraw_all")} ` +
    `(${money(withdrawAll.payoutUgx)} payout). ${maturityChoiceLabel("withdraw_roi_reinvest_principal")} ` +
    `(${money(middle.payoutUgx)} payout, ${money(middle.reinvestUgx)} reinvested). ` +
    `${maturityChoiceLabel("reinvest_all")} (${money(reinvestAll.reinvestUgx)} reinvested). ` +
    `The amount actually paid follows the return recorded by the fund, which may differ from this projection.`
  );
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
