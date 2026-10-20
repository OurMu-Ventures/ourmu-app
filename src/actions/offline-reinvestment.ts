"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { publicError, requestId } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  offlineCompletionSchema,
  offlineReinvestmentSchema,
} from "@/lib/offline-reinvestment";
import type { ActionState } from "@/lib/validation";

async function administrator() {
  const profile = await requireAdmin();
  const client = await createClient();
  const { data, error } =
    await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || data?.currentLevel !== "aal2") return null;
  return profile;
}

function refresh() {
  revalidatePath("/admin/maturities/offline");
  revalidatePath("/admin/maturities");
  revalidatePath("/admin/investments");
  revalidatePath("/admin/cycles");
}

export async function recordOfflineReinvestment(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const profile = await administrator();
  if (!profile)
    return {
      ok: false,
      message: "Complete administrator two-factor authentication first.",
    };
  const parsed = offlineReinvestmentSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      ok: false,
      message: "Complete the evidence details and all verification checks.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  const input = parsed.data;
  const { error } = await createAdminClient().rpc(
    "record_offline_reinvestment",
    {
      p_admin_id: profile.id,
      p_admin_aal2: true,
      p_request_id: requestId(),
      p_investment_id: input.investmentId,
      p_cycle_id: input.cycleId,
      p_agreement_hash: input.agreementHash,
      p_amount: Number(input.amount),
      p_authorized_on: input.authorizedOn,
      p_method: input.method,
      p_evidence_reference: input.evidenceReference,
      p_verification_notes: input.verificationNotes,
      p_target_maturity_date: input.targetMaturityDate,
      p_target_return_bps: input.targetReturnBps,
      p_identity_verified: true,
      p_settlement_checked: true,
      p_agreement_accepted: true,
    },
  );
  if (error)
    return {
      ok: false,
      message: publicError(
        error,
        "Authorization could not be recorded. Refresh and review the terms.",
      ),
    };
  refresh();
  return {
    ok: true,
    message:
      "Offline authorization recorded. Review it below before completing the reinvestment.",
  };
}

export async function completeOfflineReinvestment(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const profile = await administrator();
  if (!profile)
    return {
      ok: false,
      message: "Complete administrator two-factor authentication first.",
    };
  const parsed = offlineCompletionSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return { ok: false, message: "Type REINVEST to confirm completion." };
  const { error } = await createAdminClient().rpc(
    "complete_offline_reinvestment",
    {
      p_admin_id: profile.id,
      p_admin_aal2: true,
      p_request_id: requestId(),
      p_authorization_id: parsed.data.authorizationId,
      p_confirmation: parsed.data.confirmation,
    },
  );
  if (error)
    return {
      ok: false,
      message: publicError(
        error,
        "Completion failed. No investment was created.",
      ),
    };
  refresh();
  return {
    ok: true,
    message:
      "Reinvestment completed. The active investment and receipt were recorded together.",
  };
}

export async function revokeOfflineReinvestment(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const profile = await administrator();
  if (!profile)
    return {
      ok: false,
      message: "Complete administrator two-factor authentication first.",
    };
  const parsed = z
    .object({
      authorizationId: z.uuid(),
      reason: z.string().trim().min(10).max(2000),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      ok: false,
      message: "Enter a revocation reason of 10–2000 characters.",
    };
  const { error } = await createAdminClient().rpc(
    "revoke_offline_reinvestment",
    {
      p_admin_id: profile.id,
      p_admin_aal2: true,
      p_request_id: requestId(),
      p_authorization_id: parsed.data.authorizationId,
      p_reason: parsed.data.reason,
    },
  );
  if (error)
    return {
      ok: false,
      message: publicError(
        error,
        "Revocation failed. Completed reinvestments cannot be revoked here.",
      ),
    };
  refresh();
  return {
    ok: true,
    message:
      "Authorization revoked. Its original evidence remains in the audit history.",
  };
}
