"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { requireAdmin, requireInvestor } from "@/lib/auth";
import { publicError, requestId, toBytea } from "@/lib/db";
import {
  encryptPayoutReference,
  fingerprintRequestValue,
} from "@/lib/security/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  maturityConfirmSchema,
  maturityFulfillmentSchema,
  maturityInstructionSchema,
  maturityReopenSchema,
  standingTermsSchema,
  type ActionState,
} from "@/lib/validation";

function involvesPayout(choice: string) {
  return (
    choice === "withdraw_all" ||
    choice === "withdraw_roi_reinvest_principal"
  );
}

function involvesReinvestment(choice: string) {
  return (
    choice === "withdraw_roi_reinvest_principal" || choice === "reinvest_all"
  );
}

export async function submitMaturityInstruction(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireInvestor();
  const parsed = maturityInstructionSchema.safeParse({
    investmentId: formData.get("investmentId"),
    choice: formData.get("choice"),
    payoutDestinationId: formData.get("payoutDestinationId") ?? "",
    channel: formData.get("channel") ?? undefined,
    providerLabel: formData.get("providerLabel") ?? undefined,
    accountName: formData.get("accountName") ?? undefined,
    accountReference: formData.get("accountReference") ?? undefined,
    destinationConfirmed: formData.get("destinationConfirmed") ?? "",
    targetCycleId: formData.get("targetCycleId") ?? "",
    agreementAccepted: formData.get("agreementAccepted") ?? "",
  });
  if (!parsed.success)
    return { ok: false, message: "Choose one of the three maturity options." };
  const input = parsed.data;
  const admin = createAdminClient();
  const requestHeaders = await headers();
  const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0] ?? "unknown";

  let payoutDestinationId: string | null = null;
  if (involvesPayout(input.choice)) {
    if (input.destinationConfirmed !== "yes")
      return {
        ok: false,
        message: "Confirm the payout destination before submitting.",
      };
    if (input.payoutDestinationId) {
      const { data: saved } = await admin
        .from("payout_destinations")
        .select("id")
        .eq("id", input.payoutDestinationId)
        .eq("investor_id", profile.id)
        .eq("is_active", true)
        .maybeSingle();
      if (!saved)
        return {
          ok: false,
          message: "The selected payout destination is not available.",
        };
      payoutDestinationId = saved.id;
    } else {
      if (
        !input.channel ||
        !input.providerLabel ||
        !input.accountName ||
        !input.accountReference
      )
        return {
          ok: false,
          message:
            "Enter a complete bank or mobile money destination and confirm it.",
        };
      let envelope: ReturnType<typeof encryptPayoutReference>;
      try {
        envelope = encryptPayoutReference(input.accountReference);
      } catch {
        return { ok: false, message: "The account reference is invalid." };
      }
      // Destinations are immutable once saved: a repeat submission of the
      // same account reuses the existing row as-is and never rewrites what
      // a locked instruction points at.
      const { data: existing } = await admin
        .from("payout_destinations")
        .select("id,channel,provider_label,account_name")
        .eq("investor_id", profile.id)
        .eq("account_ref_fingerprint", toBytea(envelope.fingerprint))
        .maybeSingle();
      if (existing) {
        // The account number matches a saved destination, but the bank,
        // network, or account name must also match: the row is immutable,
        // so mismatched details are rejected rather than silently swapped.
        if (
          existing.channel !== input.channel ||
          existing.provider_label !== input.providerLabel ||
          existing.account_name !== input.accountName
        )
          return {
            ok: false,
            message:
              "That account number is saved with different bank or account details. Select the saved destination or correct the details.",
          };
        payoutDestinationId = existing.id;
      } else {
        const { data: destination, error: destinationError } = await admin
          .from("payout_destinations")
          .insert({
            investor_id: profile.id,
            channel: input.channel,
            provider_label: input.providerLabel,
            account_name: input.accountName,
            account_ref_ciphertext: toBytea(envelope.ciphertext),
            account_ref_iv: toBytea(envelope.iv),
            account_ref_auth_tag: toBytea(envelope.authTag),
            account_ref_fingerprint: toBytea(envelope.fingerprint),
            account_last_four: envelope.lastFour,
            key_version: envelope.keyVersion,
            is_active: true,
          })
          .select("id")
          .single();
        if (destinationError || !destination)
          return {
            ok: false,
            message: "The payout destination could not be saved.",
          };
        payoutDestinationId = destination.id;
      }
    }
  }

  let targetCycleId: string | null = null;
  if (involvesReinvestment(input.choice)) {
    if (!input.targetCycleId || input.agreementAccepted !== "yes")
      return {
        ok: false,
        message:
          "Select a destination cycle and accept its current agreement.",
      };
    targetCycleId = input.targetCycleId;
  }

  // The RPC accepts null for the uninvolved leg; the generated Args type
  // marks these uuid params as required strings, hence the narrow cast.
  const { error } = await admin.rpc("submit_maturity_instruction", {
    p_investor_id: profile.id,
    p_investment_id: input.investmentId,
    p_choice: input.choice,
    p_target_cycle_id: targetCycleId as unknown as string,
    p_payout_destination_id: payoutDestinationId as unknown as string,
    p_agreement_accepted: input.agreementAccepted === "yes",
    p_destination_confirmed: input.destinationConfirmed === "yes",
    p_request_id: requestId(),
    p_user_agent: requestHeaders.get("user-agent") ?? "unknown",
    p_ip_fingerprint: toBytea(fingerprintRequestValue("ip", ip)),
  });
  if (error)
    return {
      ok: false,
      message: publicError(error, "The maturity choice could not be saved."),
    };
  revalidatePath(`/investments/${input.investmentId}`);
  revalidatePath("/investments");
  revalidatePath("/dashboard");
  return {
    ok: true,
    message:
      "Maturity choice recorded. You can revise it until an admin begins processing.",
  };
}

export async function beginMaturityProcessing(formData: FormData) {
  const profile = await requireAdmin();
  const instructionId = String(formData.get("instructionId") ?? "");
  const supabase = await createClient();
  const { data: aal } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const admin = createAdminClient();
  const { error } = await admin.rpc("begin_maturity_instruction_processing", {
    p_admin_id: profile.id,
    p_instruction_id: instructionId,
    p_admin_aal2: aal?.currentLevel === "aal2",
    p_request_id: requestId(),
  });
  if (error) throw new Error(publicError(error, "Processing could not begin."));
  revalidatePath("/admin/maturities");
}

export async function fulfillMaturityInstruction(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireAdmin();
  const parsed = maturityFulfillmentSchema.safeParse({
    instructionId: formData.get("instructionId"),
    actualRoiUgx: formData.get("actualRoiUgx"),
    payoutReference: formData.get("payoutReference") ?? "",
    destinationVerified: formData.get("destinationVerified") ?? "",
    confirmation: formData.get("confirmation"),
  });
  if (!parsed.success)
    return {
      ok: false,
      message: "Enter the actual ROI (zero or more) and type FULFILL exactly.",
    };
  const supabase = await createClient();
  const { data: aal } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("fulfill_maturity_instruction", {
    p_admin_id: profile.id,
    p_instruction_id: parsed.data.instructionId,
    p_actual_roi_ugx: Number(parsed.data.actualRoiUgx),
    p_payout_reference: parsed.data.payoutReference?.trim() || "",
    p_confirmation: parsed.data.confirmation,
    p_admin_aal2: aal?.currentLevel === "aal2",
    p_request_id: requestId(),
    p_destination_verified: parsed.data.destinationVerified === "yes",
  });
  if (error)
    return {
      ok: false,
      message: publicError(error, "Fulfillment failed. No records were moved."),
    };
  revalidatePath("/admin/maturities");
  revalidatePath("/admin/investments");
  const outcome = data as {
    held?: boolean;
    reason?: string;
    pending_partner_confirmation?: boolean;
  } | null;
  if (outcome?.held)
    return {
      ok: true,
      message: `Held for resolution: ${outcome.reason ?? "destination unavailable"}. Reopen it with notes so the partner can revise and re-confirm. No placement was created.`,
    };
  if (outcome?.pending_partner_confirmation)
    return {
      ok: true,
      message:
        "The actual return differs from the projection, so the new amounts are pending partner confirmation. Nothing was paid or reinvested yet.",
    };
  return { ok: true, message: "Maturity instruction fulfilled atomically." };
}

export async function confirmMaturityAmounts(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireInvestor();
  const parsed = maturityConfirmSchema.safeParse({
    instructionId: formData.get("instructionId"),
  });
  if (!parsed.success)
    return { ok: false, message: "The confirmation could not be recorded." };
  const admin = createAdminClient();
  const { error } = await admin.rpc("confirm_maturity_amounts", {
    p_investor_id: profile.id,
    p_instruction_id: parsed.data.instructionId,
    p_request_id: requestId(),
  });
  if (error)
    return {
      ok: false,
      message: publicError(error, "The confirmation could not be recorded."),
    };
  revalidatePath(`/investments`);
  revalidatePath("/dashboard");
  return {
    ok: true,
    message:
      "Amounts confirmed. An admin will now complete the payout and reinvestment.",
  };
}

export async function reopenMaturityInstruction(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireAdmin();
  const parsed = maturityReopenSchema.safeParse({
    instructionId: formData.get("instructionId"),
    notes: formData.get("notes"),
  });
  if (!parsed.success)
    return {
      ok: false,
      message: "Explain the resolution so the partner can revise.",
    };
  const supabase = await createClient();
  const { data: aal } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const admin = createAdminClient();
  const { error } = await admin.rpc("reopen_maturity_instruction", {
    p_admin_id: profile.id,
    p_instruction_id: parsed.data.instructionId,
    p_notes: parsed.data.notes,
    p_admin_aal2: aal?.currentLevel === "aal2",
    p_request_id: requestId(),
  });
  if (error)
    return {
      ok: false,
      message: publicError(error, "The instruction could not be reopened."),
    };
  revalidatePath("/admin/maturities");
  return {
    ok: true,
    message: "Instruction reopened. The partner can now revise and re-confirm.",
  };
}


export async function acceptStandingTerms(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireInvestor();
  const parsed = standingTermsSchema.safeParse({
    agreementVersionId: formData.get("agreementVersionId"),
  });
  if (!parsed.success)
    return { ok: false, message: "Select the standing terms to accept." };
  const requestHeaders = await headers();
  const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const admin = createAdminClient();
  const { error } = await admin.rpc("accept_standing_reinvest_terms", {
    p_investor_id: profile.id,
    p_agreement_version_id: parsed.data.agreementVersionId,
    p_user_agent: requestHeaders.get("user-agent") ?? "unknown",
    p_ip_fingerprint: toBytea(fingerprintRequestValue("ip", ip)),
    p_request_id: requestId(),
  });
  if (error)
    return {
      ok: false,
      message: publicError(error, "The standing terms could not be accepted."),
    };
  revalidatePath("/profile");
  return {
    ok: true,
    message:
      "Standing reinvest terms accepted. Unanswered maturities covered by these exact terms may be reinvested automatically.",
  };
}

export async function revokeStandingTerms() {
  const profile = await requireInvestor();
  const admin = createAdminClient();
  const { error } = await admin.rpc("revoke_standing_reinvest_authorization", {
    p_investor_id: profile.id,
    p_request_id: requestId(),
  });
  if (error) throw new Error(publicError(error, "Revocation failed."));
  revalidatePath("/profile");
}
