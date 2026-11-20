import { z } from "zod";

import { kampalaLocalToIso } from "@/lib/cycle-assignment";

export const MAX_DEPOSIT_LINES = 20;
export const PLACEMENT_ROWS = 6;
export const AUTHORIZATION_METHODS = [
  ["email", "Email"],
  ["signed_document", "Signed document"],
  ["recorded_call", "Recorded call"],
  ["in_person", "In person"],
] as const;

export type DepositAllocationLine =
  | {
      kind: "reservation";
      investment_id: string;
      account_id: string;
      amount_ugx: string;
    }
  | { kind: "offline_placement"; account_id: string; amount_ugx: string };

// Grouping commas typed by staff are accepted; anything else must already be
// a plain UGX amount with at most two decimals.
const amount = z
  .string()
  .trim()
  .transform((value) => value.replaceAll(",", ""))
  .pipe(z.string().regex(/^\d{1,15}(?:\.\d{1,2})?$/))
  .refine((value) => Number(value) > 0);

const depositSchema = z.object({
  requestId: z.uuid(),
  investorId: z.uuid(),
  cycleId: z.uuid(),
  agreementHash: z.string().regex(/^[a-f0-9]{64}$/i),
  bankReference: z.string().trim().min(3).max(120),
  receivedAmountUgx: amount,
  receivedDate: z.iso.date(),
  receivedTime: z
    .string()
    .trim()
    .regex(/^(?:\d{2}:\d{2})?$/),
  authorizedOn: z.iso.date(),
  authorizationMethod: z.enum(
    AUTHORIZATION_METHODS.map(([value]) => value) as [string, ...string[]],
  ),
  evidenceReference: z.string().trim().min(5).max(500),
  verificationNotes: z.string().trim().min(10).max(2000),
  identityVerified: z.literal("yes"),
  splitVerified: z.literal("yes"),
  agreementAccepted: z.literal("yes").optional(),
  confirmation: z.literal("ALLOCATE"),
});

export type DepositAllocationInput = z.infer<typeof depositSchema> & {
  receivedAt: string | null;
  allocations: DepositAllocationLine[];
};

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

// Reservation lines carry the account and principal the administrator saw;
// the database rejects them if either changed. Empty placement rows are skipped.
export function parseDepositAllocationForm(
  formData: FormData,
):
  | { ok: true; input: DepositAllocationInput }
  | { ok: false; message: string } {
  const parsed = depositSchema.safeParse({
    requestId: text(formData, "requestId"),
    investorId: text(formData, "investorId"),
    cycleId: text(formData, "cycleId"),
    agreementHash: text(formData, "agreementHash"),
    bankReference: text(formData, "bankReference"),
    receivedAmountUgx: text(formData, "receivedAmountUgx"),
    receivedDate: text(formData, "receivedDate"),
    receivedTime: text(formData, "receivedTime"),
    authorizedOn: text(formData, "authorizedOn"),
    authorizationMethod: text(formData, "authorizationMethod"),
    evidenceReference: text(formData, "evidenceReference"),
    verificationNotes: text(formData, "verificationNotes"),
    identityVerified: text(formData, "identityVerified"),
    splitVerified: text(formData, "splitVerified"),
    agreementAccepted: text(formData, "agreementAccepted") || undefined,
    confirmation: text(formData, "confirmation"),
  });
  if (!parsed.success)
    return {
      ok: false,
      message:
        "Check the deposit details, the partner’s split instructions and evidence, tick every verification, and type ALLOCATE exactly.",
    };
  const allocations: DepositAllocationLine[] = [];
  for (const investmentId of formData.getAll("reservation")) {
    const id = z.uuid().safeParse(investmentId);
    const accountId = z
      .uuid()
      .safeParse(text(formData, `reservationAccount.${investmentId}`));
    const principal = amount.safeParse(
      text(formData, `reservationAmount.${investmentId}`),
    );
    if (!id.success || !accountId.success || !principal.success)
      return {
        ok: false,
        message: "A selected reservation changed. Refresh the page and review it again.",
      };
    allocations.push({
      kind: "reservation",
      investment_id: id.data,
      account_id: accountId.data,
      amount_ugx: principal.data,
    });
  }
  for (let row = 0; row < PLACEMENT_ROWS; row += 1) {
    const rawAmount = text(formData, `placementAmount.${row}`).trim();
    const rawAccount = text(formData, `placementAccount.${row}`);
    if (!rawAmount && !rawAccount) continue;
    const accountId = z.uuid().safeParse(rawAccount);
    const placement = amount.safeParse(rawAmount);
    if (!accountId.success || !placement.success)
      return {
        ok: false,
        message: `Placement ${row + 1}: choose an account and enter an amount in UGX with at most two decimals.`,
      };
    allocations.push({
      kind: "offline_placement",
      account_id: accountId.data,
      amount_ugx: placement.data,
    });
  }
  if (!allocations.length || allocations.length > MAX_DEPOSIT_LINES)
    return {
      ok: false,
      message: `Allocate the deposit to between 1 and ${MAX_DEPOSIT_LINES} investments.`,
    };
  if (
    allocations.some((line) => line.kind === "offline_placement") &&
    parsed.data.agreementAccepted !== "yes"
  )
    return {
      ok: false,
      message:
        "Confirm the partner accepted the cycle agreement shown, as instructed offline, before creating placements.",
    };
  const receivedAt = parsed.data.receivedTime
    ? kampalaLocalToIso(`${parsed.data.receivedDate}T${parsed.data.receivedTime}`)
    : null;
  if (parsed.data.receivedTime && !receivedAt)
    return { ok: false, message: "Enter the statement time as HH:MM (Uganda)." };
  return { ok: true, input: { ...parsed.data, receivedAt, allocations } };
}

// Exact cents comparison for the running total; inputs have two decimals at most.
export function ugxCents(value: string): bigint | null {
  const match = /^(\d{1,15})(?:\.(\d{1,2}))?$/.exec(value.trim().replaceAll(",", ""));
  if (!match) return null;
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
}

// Only recognized database rules become public text. Never return raw SQL errors.
const rules: Record<string, string> = {
  "active administrator AAL2 required":
    "Complete administrator two-factor authentication, then try again.",
  "typed confirmation is invalid": "Type ALLOCATE exactly to confirm.",
  "request id is required": "Refresh the page and try again.",
  "bank reference is required":
    "Enter the reference from the verified bank statement (3–120 characters).",
  "received amount must be positive with at most two decimals":
    "Enter the exact amount received in UGX with at most two decimals.",
  "valid payment received date is required":
    "Enter the payment date shown on the bank statement, using Uganda’s calendar date.",
  "received date cannot be in the future":
    "The payment date is in the future. Check it against the bank statement.",
  "payment timestamp cannot be in the future":
    "The statement time is in the future. Check it against the bank statement.",
  "received date must match the Kampala date of the verified payment timestamp":
    "The statement time must fall on the payment date in Uganda time.",
  "dated partner split instructions and verification notes are required":
    "Record how and when the partner gave the split instructions, where the evidence is kept, and your verification notes.",
  "split instruction date cannot be in the future":
    "The instruction date is in the future. Use the date the partner gave the split instructions.",
  "confirm the partner identity, bank statement and split instructions were verified":
    "Tick the identity, bank statement and split instruction checks.",
  "allocations must list between 1 and 20 investments":
    "Allocate the deposit to between 1 and 20 investments.",
  "allocation line is invalid":
    "One allocation line is incomplete. Check each account and amount.",
  "an investment can appear only once in a deposit":
    "A reservation is listed twice. Refresh the page and select it once.",
  "partner not found": "This partner could not be found. Refresh the page.",
  "request already used for a different deposit":
    "This form was already used for a different deposit. Refresh the page and check the recorded deposits before trying again.",
  "bank reference is already recorded":
    "This bank reference is already recorded. Check the recorded deposits and activations; do not invent a different reference.",
  "no eligible cycle is available for this payment date":
    "No investment cycle covers this payment date. Ask staff to review the payment and cycle dates.",
  "multiple eligible cycles match this payment date; held for staff resolution":
    "More than one cycle covers this payment date. Ask staff to reconcile the cycle boundaries first.",
  "payment date resolves to a different cycle than reviewed; refresh and review again":
    "The payment date belongs to a different cycle than the one reviewed. Review the cycle for this date again.",
  "destination cycle is not valid; held for staff resolution":
    "The payment’s cycle cannot accept investments (it may have matured). Ask staff to review it.",
  "reservation not found for this partner":
    "A selected reservation does not belong to this partner. Refresh the page.",
  "imported investments cannot be activated":
    "An imported investment cannot be funded here.",
  "cancelled reservations cannot be revived; create a new reservation":
    "A selected reservation was cancelled. Refresh the page and allocate that amount as a placement instead if the partner instructed it.",
  "only a pending reservation can be activated":
    "A selected reservation is no longer pending. Refresh the page and check whether it was already activated or resolved.",
  "reservation moved to another account; refresh and review again":
    "A selected reservation moved to another account. Refresh the page and review it again.",
  "payment date resolves to a different cycle; held for staff resolution without moving funds":
    "A selected reservation belongs to a different cycle than the payment date. Ask staff to reconcile it; reservations are never moved.",
  "payment date predates the reservation date; held for staff resolution":
    "The payment date is before a selected reservation was made. Ask staff to reconcile it; do not change the payment date.",
  "reservation allocation must exactly match its reserved principal":
    "A reservation must be funded with exactly its reserved amount.",
  "test and live records cannot share a deposit":
    "Test and live records cannot share a deposit.",
  "partner is not eligible for a new placement":
    "This partner’s access or KYC is not active, so new placements cannot be created.",
  "next of kin is required":
    "The partner must have next of kin recorded before a new placement.",
  "confirm the partner accepted the cycle agreement offline":
    "Confirm the partner accepted the cycle agreement shown, as instructed offline.",
  "approved agreement is required":
    "The payment’s cycle has no approved, published agreement. Ask staff to review it.",
  "the agreement changed; review the refreshed terms":
    "The cycle agreement changed since this page loaded. Refresh and confirm the partner accepted the current agreement.",
  "investment account unavailable":
    "A chosen account is archived or belongs to someone else. Refresh the page.",
  "placement amount must be at least UGX 125,000":
    "Each placement must be at least UGX 125,000.",
  "allocations must add up exactly to the received amount":
    "The allocations must add up exactly to the amount received.",
  "cycle capacity exceeded; held for staff resolution":
    "This cycle does not have enough remaining capacity. Ask staff to review the cycle allocation.",
  "investor cycle limit exceeded; held for staff resolution":
    "This would exceed the partner’s limit for this cycle across all their accounts.",
};

// Contract tests compare this set with the latest migration-defined function.
export const DEPOSIT_DATABASE_MESSAGES = Object.freeze(Object.keys(rules));

export function depositErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const { message, code } = error as { message?: unknown; code?: unknown };
  if (typeof message === "string" && Object.hasOwn(rules, message))
    return rules[message];
  if (code === "40001" || code === "40P01")
    return "Another update conflicted with this deposit. Refresh and try again.";
  return null;
}
