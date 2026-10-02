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
    description: "Choose how much to withdraw and reinvest the rest.",
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

// Scheduled payout day: the 15th of the month after maturity.
export function maturityPayoutDateIso(maturityDateIso: string): string {
  const [year, month] = maturityDateIso.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(year, month, 15));
  return nextMonth.toISOString().slice(0, 10);
}

export const PAKA_PAKA_EXPLANATION =
  "If the final return changes, both amounts will adjust proportionally. You’ll confirm the revised amounts before processing.";

// Match PostgreSQL numeric arithmetic at the database's eight-decimal scale.
function moneyUnits(value: number): bigint {
  if (!Number.isFinite(value) || value < 0) throw new Error("Invalid amount");
  return BigInt(value.toFixed(8).replace(".", ""));
}

function moneyValue(value: bigint): number {
  return Number(value) / 100_000_000;
}

export function customWithdrawalError(
  amount: string,
  totalUgx: number,
): string | null {
  if (
    !/^\d+(?:\.\d{1,2})?$/.test(amount.trim()) ||
    !Number.isFinite(Number(amount))
  )
    return "Enter an amount to withdraw with up to two decimal places.";
  if (Number(amount) >= totalUgx)
    return "Choose Bijjodolo to withdraw everything, or enter a smaller amount.";
  const withdrawal = moneyUnits(Number(amount));
  const total = moneyUnits(totalUgx);
  if (withdrawal === 0n) return "Choose Dobolo to reinvest everything.";
  if (withdrawal >= total)
    return "Choose Bijjodolo to withdraw everything, or enter a smaller amount.";
  const remainder = total - withdrawal;
  if (remainder < moneyUnits(125_000) || remainder > moneyUnits(50_000_000))
    return "The amount reinvested must be between UGX 125,000 and UGX 50,000,000.";
  if (remainder % 1_000_000n !== 0n)
    return "The amount reinvested must have no more than two decimal places.";
  return null;
}

export type CustomMaturityBasis = {
  requestedWithdrawalUgx: number;
  projectedTotalUgx: number;
};

export function maturityInstructionTerms(
  choice: MaturityChoice,
  requestedWithdrawalUgx?: number | null,
): string | null {
  if (choice !== "withdraw_roi_reinvest_principal") return null;
  return requestedWithdrawalUgx == null
    ? "Original Paka Paka terms: withdraw ROI and reinvest principal."
    : PAKA_PAKA_EXPLANATION;
}

// Projected split for a choice, from the placement's own projected figures.
// The projected return is shown when the choice opens; fulfillment always
// uses the actual ROI recorded by an admin instead.
export function maturitySplits(
  principalUgx: number,
  projectedReturnUgx: number,
  choice: MaturityChoice,
  requestedWithdrawalUgx?: number | null,
): { payoutUgx: number; reinvestUgx: number } {
  if (choice === "withdraw_all")
    return { payoutUgx: principalUgx + projectedReturnUgx, reinvestUgx: 0 };
  if (
    choice === "withdraw_roi_reinvest_principal" &&
    requestedWithdrawalUgx != null
  )
    return {
      payoutUgx: requestedWithdrawalUgx,
      reinvestUgx: moneyValue(
        moneyUnits(principalUgx) +
          moneyUnits(projectedReturnUgx) -
          moneyUnits(requestedWithdrawalUgx),
      ),
    };
  if (choice === "withdraw_roi_reinvest_principal")
    return { payoutUgx: projectedReturnUgx, reinvestUgx: principalUgx };
  return { payoutUgx: 0, reinvestUgx: principalUgx + projectedReturnUgx };
}

// Fulfilled split for a choice, from the actual ROI recorded by an admin.
export function fulfilledSplits(
  principalUgx: number,
  actualRoiUgx: number,
  choice: MaturityChoice,
  customBasis?: CustomMaturityBasis,
): { payoutUgx: number; reinvestUgx: number } {
  if (choice === "withdraw_roi_reinvest_principal" && customBasis) {
    const total = moneyUnits(principalUgx) + moneyUnits(actualRoiUgx);
    const numerator = total * moneyUnits(customBasis.requestedWithdrawalUgx);
    const denominator = moneyUnits(customBasis.projectedTotalUgx) * 1_000_000n;
    if (denominator <= 0n) throw new Error("Invalid projected total");
    const payout = ((numerator + denominator / 2n) / denominator) * 1_000_000n;
    return {
      payoutUgx: moneyValue(payout),
      reinvestUgx: moneyValue(total - payout),
    };
  }
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
    `(choose how much to withdraw and reinvest the rest; amounts adjust proportionally if the final return changes). ` +
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

// New portal cycles mature on the final calendar day of their month.
export function isMonthEndMaturity(maturityDateIso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(maturityDateIso)) return false;
  const [year, month, day] = maturityDateIso.split("-").map(Number);
  if (month < 1 || month > 12) return false;
  return day === new Date(Date.UTC(year, month, 0)).getUTCDate();
}
