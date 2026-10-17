// Only recognized database rules become public text. Never return raw SQL errors.
const rules: Record<string, string> = {
  "valid payment received date is required":
    "Enter a valid payment received date using Uganda’s calendar date.",
  "payment date predates the reservation date; held for staff resolution":
    "The payment date is before the reservation date in Uganda. Ask staff to reconcile it; do not change the actual payment date to bypass this check.",
  "no eligible cycle is available for this payment date":
    "No investment cycle covers this payment date. Ask staff to review the payment record and cycle dates.",
  "multiple eligible cycles match this payment date; held for staff resolution":
    "More than one cycle covers this payment date. Ask staff to reconcile the cycle boundaries before activation.",
  "payment date resolves to a different cycle; held for staff resolution without moving funds":
    "The payment date belongs to a different investment cycle. Ask staff to reconcile the cycle before activation.",
  "active administrator AAL2 required":
    "Complete administrator two-factor authentication, then try again.",
  "typed confirmation is invalid":
    "Type ACTIVATE exactly to confirm activation.",
  "bank reference is required":
    "Enter the reference from the verified payment record.",
  "received date cannot be in the future":
    "The received date is in the future. Check it against the payment record using Uganda time.",
  "investment not found":
    "This reservation could not be found. Refresh the activation list.",
  "imported investments cannot be activated":
    "This is an imported investment, not a pending portal reservation. Review it under Investments.",
  "cancelled reservations cannot be revived; create a new reservation":
    "This reservation was cancelled. Create a new reservation instead of activating it.",
  "payment timestamp cannot be in the future":
    "The payment time is in the future. Check the date, time, and Uganda time zone against the payment record.",
  "received date must match the Kampala date of the verified payment timestamp":
    "The received date must match the Uganda calendar date of the payment time entered.",
  "payment timestamp predates the reservation; held for staff resolution":
    "The payment time is earlier than this reservation was created. Review the payment and reservation with staff; do not change the actual payment time to bypass this check.",
  "only a pending reservation can be activated":
    "This investment is no longer pending. Refresh the list and check whether it was already activated or resolved.",
  "payment timestamp resolves to a different cycle; held for staff resolution without moving funds":
    "The payment time belongs to a different investment cycle. Ask staff to reconcile the cycle before activation.",
  "received amount must exactly match expected principal":
    "The received amount must exactly match the reserved principal shown on the page. Verify the payment; if the reservation is wrong, cancel and replace it with the correct amount and agreement.",
  "destination cycle is not valid; held for staff resolution":
    "The reservation’s cycle is not eligible for activation. Ask staff to review its status and maturity date.",
  "cycle capacity exceeded; held for staff resolution":
    "This cycle has insufficient remaining capacity. Ask staff to review the cycle allocation.",
  "investor cycle limit exceeded; held for staff resolution":
    "This activation would exceed the partner’s limit for this cycle. Review their other investments and reservations with staff.",
};

// Contract tests compare this set with the latest migration-defined function.
export const ACTIVATION_DATABASE_MESSAGES = Object.freeze(Object.keys(rules));

export function activationErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const { message, code } = error as { message?: unknown; code?: unknown };
  if (typeof message === "string" && Object.hasOwn(rules, message))
    return rules[message];
  if (
    code === "23505" &&
    message ===
      'duplicate key value violates unique constraint "bank_receipts_bank_reference_key"'
  )
    return "This payment reference is already recorded. Check the existing receipt before trying again; do not invent a different reference.";
  if (code === "40001" || code === "40P01")
    return "Another update conflicted with this activation. Refresh the reservation and try again.";
  return null;
}

export function activationErrorCode(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error ? error.code : null;
  return typeof code === "string" && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(code)
    ? code
    : "unknown";
}
