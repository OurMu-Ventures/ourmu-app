"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin, requireInvestor } from "@/lib/auth";
import { publicError, requestId, toBytea } from "@/lib/db";
import { encryptPayoutReference } from "@/lib/security/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  maturityFulfillmentSchema,
  maturityInstructionSchema,
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
      const { data: destination, error: destinationError } = await admin
        .from("payout_destinations")
        .upsert(
          {
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
          },
          { onConflict: "investor_id,account_ref_fingerprint" },
        )
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
  });
  if (error)
    return {
      ok: false,
      message: publicError(error, "Fulfillment failed. No records were moved."),
    };
  revalidatePath("/admin/maturities");
  revalidatePath("/admin/investments");
  const outcome = data as { held?: boolean; reason?: string } | null;
  if (outcome?.held)
    return {
      ok: true,
      message: `Held for admin resolution with partner confirmation: ${outcome.reason ?? "destination unavailable"}. No placement was created.`,
    };
  return { ok: true, message: "Maturity instruction fulfilled atomically." };
}

