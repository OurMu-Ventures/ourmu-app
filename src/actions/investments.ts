"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { effectiveInvestmentLimit } from "@/lib/investment-limits";
import { dateTime, ugx } from "@/lib/format";
import { requireAdmin, requireInvestor } from "@/lib/auth";
import { kampalaLocalToIso } from "@/lib/cycle-assignment";
import { publicError, requestId, toBytea } from "@/lib/db";
import { fingerprintRequestValue } from "@/lib/security/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  activationSchema,
  investmentRequestSchemaForLimit,
  type ActionState,
} from "@/lib/validation";

export async function requestInvestment(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireInvestor();
  const limitUgx = effectiveInvestmentLimit(profile.investment_limit_ugx);
  const parsed = investmentRequestSchemaForLimit(limitUgx).safeParse({
    cycleId: formData.get("cycleId"),
    agreementVersionId: formData.get("agreementVersionId") ?? "",
    principalUgx: formData.get("principalUgx"),
    agreementAccepted: formData.get("agreementAccepted"),
  });
  if (!parsed.success)
    return {
      ok: false,
      message: `Enter an amount from UGX 125,000 to ${ugx(limitUgx)} with at most two decimals and accept the current agreement.`,
    };
  const requestHeaders = await headers();
  const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const admin = createAdminClient();
  const requestUuid = requestId();
  const { data, error } = await admin.rpc("request_investment", {
    p_investor_id: profile.id,
    p_cycle_id: parsed.data.cycleId,
    p_principal_ugx: Number(parsed.data.principalUgx),
    p_request_id: requestUuid,
    p_user_agent: requestHeaders.get("user-agent") ?? "unknown",
    p_ip_fingerprint: toBytea(fingerprintRequestValue("ip", ip)),
    p_expected_agreement_version_id:
      (parsed.data.agreementVersionId || "") as unknown as string,
  });
  if (error)
    return {
      ok: false,
      message: publicError(error, "The reservation could not be created."),
    };
  revalidatePath("/dashboard");
  revalidatePath("/investments");
  const investmentId = typeof data === "string" ? data : null;
  if (investmentId) {
    const { data: reservation } = await admin
      .from("investments")
      .select("reservation_expires_at")
      .eq("id", investmentId)
      .maybeSingle();
    if (reservation?.reservation_expires_at) {
      return {
        ok: true,
        message: `Investment reserved. Transfer the exact amount before ${dateTime(reservation.reservation_expires_at)} (Africa/Kampala). Payment after the deadline requires a new reservation.`,
      };
    }
  }
  return {
    ok: true,
    message:
      "Investment reserved. Transfer the exact amount before the displayed payment deadline; payment after the deadline requires a new reservation.",
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
    receivedAt: formData.get("receivedAt") ?? undefined,
    confirmation: formData.get("confirmation"),
  });
  if (!parsed.success)
    return {
      ok: false,
      message:
        "Check the bank receipt details, including the verified payment date and time (Africa/Kampala), and type ACTIVATE exactly.",
    };
  const receivedAtIso = parsed.data.receivedAt
    ? kampalaLocalToIso(parsed.data.receivedAt)
    : null;
  if (parsed.data.receivedAt && !receivedAtIso)
    return {
      ok: false,
      message: "Enter a valid verified payment date and time.",
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
    p_received_at: receivedAtIso as unknown as string,
  });
  if (error)
    return {
      ok: false,
      message: publicError(
        error,
        "Activation failed. No records were changed.",
      ),
    };
  revalidatePath("/admin/activations");
  revalidatePath("/admin/investments");
  revalidatePath("/admin");
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
