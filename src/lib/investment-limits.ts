export const DEFAULT_INVESTMENT_LIMIT_UGX = 50_000_000;

export function effectiveInvestmentLimit(override?: number | null): number {
  return override ?? DEFAULT_INVESTMENT_LIMIT_UGX;
}
