"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { requireAdmin, requireInvestor } from "@/lib/auth";
import { publicError, requestId, toBytea } from "@/lib/db";
import { fingerprintRequestValue } from "@/lib/security/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  activationSchema,
  investmentRequestSchema,
  type ActionState,
} from "@/lib/validation";

export async function requestInvestment(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireInvestor();
  const parsed = investmentRequestSchema.safeParse({
    cycleId: formData.get("cycleId"),
    principalUgx: formData.get("principalUgx"),
    agreementAccepted: formData.get("agreementAccepted"),
  });
  if (!parsed.success)
    return {
      ok: false,
      message:
        "Enter UGX 125,000–50,000,000 with at most two decimals and accept the current agreement.",
    };
  const requestHeaders = await headers();
  const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const admin = createAdminClient();
  const { error } = await admin.rpc("request_investment", {
    p_investor_id: profile.id,
    p_cycle_id: parsed.data.cycleId,
    p_principal_ugx: Number(parsed.data.principalUgx),
    p_request_id: requestId(),
    p_user_agent: requestHeaders.get("user-agent") ?? "unknown",
    p_ip_fingerprint: toBytea(fingerprintRequestValue("ip", ip)),
  });
  if (error)
    return {
      ok: false,
      message: publicError(error, "The reservation could not be created."),
    };
  revalidatePath("/dashboard");
  revalidatePath("/investments");
  return {
    ok: true,
    message:
      "Investment reserved for 48 hours. Use the displayed bank instructions to transfer the exact amount.",
  };
}

export async function cancelInvestment(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireInvestor();
  const investmentId = String(formData.get("investmentId") ?? "");
  const admin = createAdminClient();
  const { error } = await admin.rpc("cancel_investment", {
    p_investor_id: profile.id,
    p_investment_id: investmentId,
    p_request_id: requestId(),
  });
  if (error) {
    const message = publicError(error, "Cancellation failed.");
    // Race after expiry: row still reads `reserved` until hourly maintenance flips it to `expired`.
    if (message.toLowerCase().includes("cannot be cancelled"))
      return {
        ok: false,
        message:
          "This reservation has expired and can no longer be cancelled. Refresh to see its updated status.",
      };
    return { ok: false, message };
  }
  revalidatePath("/dashboard");
  revalidatePath("/investments");
  return { ok: true, message: "Reservation cancelled." };
}

export async function activateInvestment(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireAdmin();
  const parsed = activationSchema.safeParse({
    investmentId: formData.get("investmentId"),
    bankReference: formData.get("bankReference"),
    receivedAmountUgx: formData.get("receivedAmountUgx"),
    receivedDate: formData.get("receivedDate"),
    confirmation: formData.get("confirmation"),
  });
  if (!parsed.success)
    return {
      ok: false,
      message: "Check the bank receipt details and type ACTIVATE exactly.",
    };
  const supabase = await createClient();
  const { data: aal } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const admin = createAdminClient();
  const { error } = await admin.rpc("activate_investment", {
    p_admin_id: profile.id,
    p_investment_id: parsed.data.investmentId,
    p_bank_reference: parsed.data.bankReference,
    p_received_amount_ugx: Number(parsed.data.receivedAmountUgx),
    p_received_date: parsed.data.receivedDate,
    p_confirmation: parsed.data.confirmation,
    p_admin_aal2: aal?.currentLevel === "aal2",
    p_request_id: requestId(),
  });
  if (error)
    return {
      ok: false,
      message: publicError(
        error,
        "Activation failed. No records were changed.",
      ),
    };
  revalidatePath("/admin/investments");
  return {
    ok: true,
    message:
      "Investment activated atomically; agreement and email jobs are queued.",
  };
}

export async function getAgreementDownloadUrl(agreementId: string) {
  const profile = await requireInvestor();
  const admin = createAdminClient();
  let query = admin
    .from("investment_agreements")
    .select("pdf_path,pdf_status,investor_id")
    .eq("id", agreementId);
  if (profile.role !== "admin") query = query.eq("investor_id", profile.id);
  const { data } = await query.single();
  if (!data?.pdf_path || data.pdf_status !== "ready") return null;
  const { data: signed } = await admin.storage
    .from("agreements")
    .createSignedUrl(data.pdf_path, 60);
  return signed?.signedUrl ?? null;
}
