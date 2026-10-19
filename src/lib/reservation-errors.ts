// Only exact, recognized database rules become public text.
const rules: Record<string, string> = {
  "next of kin is required":
    "Add your next-of-kin details in Profile, then return here to reserve your investment.",
  "investor is not eligible":
    "Your account must be active and KYC verified before you can reserve an investment. Check your Profile or contact support.",
  "amount must be at least UGX 125,000 and within your partner limit with at most two decimals":
    "Enter at least UGX 125,000, within the partner limit shown above, with at most two decimal places.",
  "cycle capacity exceeded":
    "This cycle has insufficient remaining capacity for your amount. Try a smaller amount or contact support.",
  "investor cycle limit exceeded":
    "This amount would exceed your limit for this cycle, including your existing investments and pending reservations. Reduce the amount or review your reservations.",
  "the displayed cycle changed; review the refreshed terms and accept again":
    "The investment cycle changed while this page was open. Reload the page, review the current terms, and accept the agreement again.",
  "the agreement changed; review the refreshed terms and accept again":
    "The participation agreement changed while this page was open. Reload the page, review the current agreement, and accept it again.",
  "no eligible cycle is available for this timestamp":
    "No investment cycle is currently available. Reload the page or contact support about the next cycle.",
  "reinvestment and new investment are unavailable; no eligible cycle is open. Full withdrawal remains available.":
    "No investment cycle is currently open for reservations. Reload the page or contact support about the next cycle.",
  "multiple eligible cycles match this timestamp":
    "The current investment cycle needs staff review. Contact support before trying again.",
  "approved agreement is required":
    "The participation agreement is not currently available for this cycle. Contact support before trying again.",
};

export function reservationErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const { message, code } = error as { message?: unknown; code?: unknown };
  if (typeof message === "string" && Object.hasOwn(rules, message))
    return rules[message];
  if (code === "40001" || code === "40P01")
    return "Another update conflicted with your reservation. Reload the page and try again.";
  return null;
}
