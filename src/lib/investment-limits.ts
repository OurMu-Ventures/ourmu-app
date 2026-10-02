export const DEFAULT_INVESTMENT_LIMIT_UGX = 50_000_000;

// Runtime numeric values can arrive as strings despite generated database types.
export function effectiveInvestmentLimit(override?: unknown): number {
  if (typeof override !== "number" && typeof override !== "string")
    return DEFAULT_INVESTMENT_LIMIT_UGX;
  const value = Number(override);
  return Number.isFinite(value) && value > DEFAULT_INVESTMENT_LIMIT_UGX
    ? value
    : DEFAULT_INVESTMENT_LIMIT_UGX;
}
