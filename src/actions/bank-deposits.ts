"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { activationErrorCode } from "@/lib/activation-errors";
import { requireAdmin } from "@/lib/auth";
import {
  depositErrorMessage,
  parseDepositAllocationForm,
} from "@/lib/bank-deposits";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/validation";

// The request ID comes from the rendered form, so a retry or double submit
// replays the original allocation instead of posting the deposit twice.
export async function allocateBankDeposit(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireAdmin();
  const parsed = parseDepositAllocationForm(formData);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  const input = parsed.input;
  const supabase = await createClient();
  const { data: aal } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const { data, error } = await createAdminClient().rpc(
    "allocate_bank_deposit",
    {
      p_admin_id: profile.id,
      p_admin_aal2: aal?.currentLevel === "aal2",
      p_request_id: input.requestId,
      p_investor_id: input.investorId,
      p_expected_cycle_id: input.cycleId,
      p_bank_reference: input.bankReference,
      p_received_amount_ugx: Number(input.receivedAmountUgx),
      p_received_date: input.receivedDate,
      p_authorized_on: input.authorizedOn,
      p_authorization_method: input.authorizationMethod,
      p_evidence_reference: input.evidenceReference,
      p_verification_notes: input.verificationNotes,
      p_allocations: input.allocations,
      p_identity_verified: true,
      p_split_verified: true,
      p_expected_agreement_hash: input.agreementHash,
      p_agreement_accepted_offline: input.agreementAccepted === "yes",
      p_confirmation: input.confirmation,
      ...(input.receivedAt ? { p_received_at: input.receivedAt } : {}),
    },
  );
  const depositId =
    data && typeof data === "object" && "deposit_id" in data
      ? String(data.deposit_id)
      : null;
  if (error || !depositId) {
    const reason = depositErrorMessage(error);
    console.error("bank_deposit.allocation_failed", {
      requestId: input.requestId,
      code: activationErrorCode(error),
      recognized: reason !== null,
    });
    return {
      ok: false,
      message: reason
        ? `${reason} No records were changed.`
        : `The deposit could not be allocated. No records were changed. Contact support with reference ${input.requestId}.`,
    };
  }
  for (const path of [
    "/admin/deposits",
    "/admin/activations",
    "/admin/investments",
    "/admin",
  ])
    revalidatePath(path);
  redirect(`/admin/deposits?allocated=${depositId}#allocation-success`);
}
