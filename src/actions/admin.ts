"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin, requireInvestor } from "@/lib/auth";
import { audit, requestId } from "@/lib/db";
import { decryptNin } from "@/lib/security/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { emailSchema, type ActionState } from "@/lib/validation";

const cycleSchema = z
  .object({
    name: z.string().trim().min(3).max(100),
    opensAt: z.string().min(16),
    closesAt: z.string().min(16),
    maturityDate: z.iso.date(),
    capacityUgx: z
      .string()
      .trim()
      .regex(/^\d+(?:\.\d{1,2})?$/)
      .refine((value) => Number(value) >= 125_000),
    agreementVersionId: z.uuid(),
  })
  .transform((cycle, context) => {
    const asKampalaIso = (value: string) =>
      new Date(`${value.length === 16 ? `${value}:00` : value}+03:00`);
    const opensAt = asKampalaIso(cycle.opensAt);
    const closesAt = asKampalaIso(cycle.closesAt);
    if (
      !Number.isFinite(opensAt.getTime()) ||
      !Number.isFinite(closesAt.getTime()) ||
      opensAt >= closesAt
    ) {
      context.addIssue({ code: "custom", message: "Cycle dates are invalid" });
      return z.NEVER;
    }
    return {
      ...cycle,
      opensAt: opensAt.toISOString(),
      closesAt: closesAt.toISOString(),
    };
  });

export async function createCycle(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const adminProfile = await requireAdmin();
  const parsed = cycleSchema.safeParse({
    name: formData.get("name"),
    opensAt: formData.get("opensAt"),
    closesAt: formData.get("closesAt"),
    maturityDate: formData.get("maturityDate"),
    capacityUgx: formData.get("capacityUgx"),
    agreementVersionId: formData.get("agreementVersionId"),
  });
  if (!parsed.success)
    return {
      ok: false,
      message: "Enter valid cycle dates, capacity, and agreement.",
    };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("investment_cycles")
    .insert({
      name: parsed.data.name,
      opens_at: parsed.data.opensAt,
      closes_at: parsed.data.closesAt,
      maturity_date: parsed.data.maturityDate,
      capacity_ugx: Number(parsed.data.capacityUgx),
      agreement_version_id: parsed.data.agreementVersionId,
      created_by: adminProfile.id,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, message: "Cycle creation failed." };
  await audit({
    actorId: adminProfile.id,
    action: "cycle.created",
    entityType: "investment_cycle",
    entityId: data.id,
    requestId: requestId(),
  });
  revalidatePath("/admin/cycles");
  return { ok: true, message: "Draft cycle created." };
}

export async function updateCycle(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const adminProfile = await requireAdmin();
  const cycleId = z.uuid().safeParse(formData.get("cycleId"));
  const parsed = cycleSchema.safeParse({
    name: formData.get("name"),
    opensAt: formData.get("opensAt"),
    closesAt: formData.get("closesAt"),
    maturityDate: formData.get("maturityDate"),
    capacityUgx: formData.get("capacityUgx"),
    agreementVersionId: formData.get("agreementVersionId"),
  });
  if (!cycleId.success || !parsed.success)
    return {
      ok: false,
      message: "Enter valid cycle dates, capacity, and agreement.",
    };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("investment_cycles")
    .update({
      name: parsed.data.name,
      opens_at: parsed.data.opensAt,
      closes_at: parsed.data.closesAt,
      maturity_date: parsed.data.maturityDate,
      capacity_ugx: Number(parsed.data.capacityUgx),
      agreement_version_id: parsed.data.agreementVersionId,
    })
    .eq("id", cycleId.data)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();
  if (error || !data)
    return { ok: false, message: "Only a valid draft cycle can be edited." };
  await audit({
    actorId: adminProfile.id,
    action: "cycle.updated",
    entityType: "investment_cycle",
    entityId: cycleId.data,
    requestId: requestId(),
  });
  revalidatePath("/admin/cycles");
  return { ok: true, message: "Draft cycle updated." };
}

export async function setCycleStatus(formData: FormData) {
  const adminProfile = await requireAdmin();
  const cycleId = z.uuid().parse(formData.get("cycleId"));
  const status = z
    .enum(["open", "closed", "matured"])
    .parse(formData.get("status"));
  const admin = createAdminClient();
  const { data: current } = await admin
    .from("investment_cycles")
    .select("status,agreement_version_id")
    .eq("id", cycleId)
    .single();
  if (!current) throw new Error("Cycle not found");
  const permitted =
    (current.status === "draft" && status === "open") ||
    (current.status === "open" && status === "closed") ||
    (current.status === "closed" && status === "matured");
  if (!permitted)
    throw new Error(
      `The ${current.status} cycle cannot transition to ${status}.`,
    );
  if (status === "open") {
    if (!current.agreement_version_id)
      throw new Error(
        "An approved agreement is required before opening a cycle.",
      );
    const { data: agreement } = await admin
      .from("agreement_versions")
      .select("is_legally_approved,published_at,template_markdown")
      .eq("id", current.agreement_version_id)
      .single();
    if (
      !agreement?.is_legally_approved ||
      !agreement.published_at ||
      /PLACEHOLDER|TBD/i.test(agreement.template_markdown)
    )
      throw new Error(
        "A published, legally approved, non-placeholder agreement is required.",
      );
  }
  const { error } = await admin
    .from("investment_cycles")
    .update({ status })
    .eq("id", cycleId);
  if (error)
    throw new Error(
      status === "open" && error.code === "23505"
        ? "Another cycle is already open."
        : "Cycle status change failed.",
    );
  await audit({
    actorId: adminProfile.id,
    action: `cycle.${status}`,
    entityType: "investment_cycle",
    entityId: cycleId,
    requestId: requestId(),
  });
  revalidatePath("/admin/cycles");
}

export async function createAgreementVersion(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const adminProfile = await requireAdmin();
  const version = String(formData.get("version") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const template = String(formData.get("template") ?? "").trim();
  const legalConfirmation = formData.get("legalConfirmation") === "yes";
  if (
    !version ||
    !title ||
    template.length < 500 ||
    /PLACEHOLDER|TBD/i.test(template) ||
    !legalConfirmation
  )
    return {
      ok: false,
      message:
        "A complete legally approved template (at least 500 characters, no placeholders) and confirmation are required.",
    };
  const now = new Date().toISOString();
  const admin = createAdminClient();
  const { error } = await admin.from("agreement_versions").insert({
    version,
    title,
    template_markdown: template,
    content_hash: createHash("sha256").update(template).digest("hex"),
    is_legally_approved: true,
    approved_by: adminProfile.id,
    approved_at: now,
    published_at: now,
  });
  if (error) return { ok: false, message: "Agreement publication failed." };
  revalidatePath("/admin/cycles");
  return { ok: true, message: "Immutable agreement version published." };
}

export async function saveBankInstructions(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const adminProfile = await requireAdmin();
  const bankName = String(formData.get("bankName") ?? "").trim();
  const accountName = String(formData.get("accountName") ?? "").trim();
  const accountNumber = String(formData.get("accountNumber") ?? "").trim();
  const instructions = String(formData.get("instructions") ?? "").trim();
  if (!bankName || !accountName || !accountNumber || !instructions)
    return { ok: false, message: "Complete all required bank fields." };
  const admin = createAdminClient();
  await admin
    .from("bank_instructions")
    .update({ is_active: false })
    .eq("is_active", true);
  const { data, error } = await admin
    .from("bank_instructions")
    .insert({
      bank_name: bankName,
      account_name: accountName,
      account_number: accountNumber,
      branch: String(formData.get("branch") ?? "").trim() || null,
      swift_code: String(formData.get("swiftCode") ?? "").trim() || null,
      instructions,
      is_active: true,
      created_by: adminProfile.id,
    })
    .select("id")
    .single();
  if (error || !data)
    return { ok: false, message: "Bank instructions could not be activated." };
  await audit({
    actorId: adminProfile.id,
    action: "bank_instructions.activated",
    entityType: "bank_instructions",
    entityId: data.id,
    requestId: requestId(),
  });
  revalidatePath("/admin/settings");
  return { ok: true, message: "Receiving bank instructions updated." };
}

export async function retryJob(formData: FormData) {
  const adminProfile = await requireAdmin();
  const jobId = z.uuid().parse(formData.get("jobId"));
  const admin = createAdminClient();
  const { error } = await admin
    .from("jobs")
    .update({
      status: "pending",
      available_at: new Date().toISOString(),
      locked_at: null,
      last_error_code: null,
    })
    .eq("id", jobId)
    .in("status", ["failed", "dead"]);
  if (error) throw new Error("Job retry failed");
  await audit({
    actorId: adminProfile.id,
    action: "job.retried",
    entityType: "job",
    entityId: jobId,
    requestId: requestId(),
  });
  revalidatePath("/admin/jobs");
}

export async function resolveClosure(formData: FormData) {
  const adminProfile = await requireAdmin();
  const closureId = z.uuid().parse(formData.get("closureId"));
  const outcome = z
    .enum(["resolved", "declined"])
    .parse(formData.get("outcome"));
  const notes = String(formData.get("notes") ?? "").trim();
  const admin = createAdminClient();
  const { data: closure } = await admin
    .from("account_closure_requests")
    .select("user_id")
    .eq("id", closureId)
    .eq("status", "requested")
    .single();
  if (!closure) throw new Error("Closure request is no longer pending");
  await admin
    .from("account_closure_requests")
    .update({
      status: outcome,
      resolved_by: adminProfile.id,
      resolved_at: new Date().toISOString(),
      resolution_notes: notes || null,
    })
    .eq("id", closureId);
  await admin
    .from("profiles")
    .update({ access_status: outcome === "resolved" ? "closed" : "active" })
    .eq("id", closure.user_id);
  await audit({
    actorId: adminProfile.id,
    action: `account.closure_${outcome}`,
    entityType: "account_closure_request",
    entityId: closureId,
    requestId: requestId(),
  });
  revalidatePath("/admin");
}

export type RevealState = { ok: boolean; value?: string; message: string };
export async function revealNin(
  _: RevealState,
  formData: FormData,
): Promise<RevealState> {
  const profile = await requireInvestor();
  const targetUserId = z.uuid().parse(formData.get("userId"));
  const supabase = await createClient();
  const { data: claimData } = await supabase.auth.getClaims();
  const claims = claimData?.claims;
  if (!claims) return { ok: false, message: "Reauthentication required." };
  if (profile.role === "admin") {
    await requireAdmin();
  } else {
    if (targetUserId !== profile.id)
      return { ok: false, message: "Not authorized." };
    const issuedAt = Number(claims.iat ?? 0);
    if (!issuedAt || Date.now() / 1000 - issuedAt > 600)
      return {
        ok: false,
        message:
          "Use a fresh emailed sign-in link, then try again within 10 minutes.",
      };
  }
  const admin = createAdminClient();
  const { data } = await admin
    .schema("private")
    .from("investor_identities")
    .select("nin_ciphertext,nin_iv,nin_auth_tag,key_version")
    .eq("user_id", targetUserId)
    .is("erased_at", null)
    .single();
  if (!data?.nin_ciphertext || !data.nin_iv || !data.nin_auth_tag)
    return { ok: false, message: "Identity record is unavailable." };
  const decode = (value: string) =>
    Buffer.from(value.startsWith("\\x") ? value.slice(2) : value, "hex");
  const value = decryptNin({
    ciphertext: decode(data.nin_ciphertext),
    iv: decode(data.nin_iv),
    authTag: decode(data.nin_auth_tag),
    keyVersion: data.key_version,
  });
  await audit({
    actorId: profile.id,
    action: "identity.nin_revealed",
    entityType: "profile",
    entityId: targetUserId,
    requestId: requestId(),
  });
  return {
    ok: true,
    value,
    message: "Shown once. Do not copy it into notes or messages.",
  };
}

export async function acceptPartnerImport(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireAdmin();
  const batchId = z.uuid().safeParse(formData.get("batchId"));
  const confirmation = String(formData.get("confirmation") ?? "").trim();
  if (!batchId.success || confirmation !== "ACCEPT IMPORT")
    return { ok: false, message: "Type ACCEPT IMPORT exactly." };
  const supabase = await createClient();
  const { data: aal } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const admin = createAdminClient();
  const { error } = await admin.rpc("accept_partner_import", {
    p_admin_id: profile.id,
    p_batch_id: batchId.data,
    p_confirmation: confirmation,
    p_admin_aal2: aal?.currentLevel === "aal2",
    p_request_id: requestId(),
  });
  if (error)
    return {
      ok: false,
      message: "Import acceptance failed. No access was enabled.",
    };
  revalidatePath("/admin/imports");
  revalidatePath("/admin/partners");
  revalidatePath("/admin/investments");
  revalidatePath("/admin/cycles");
  return {
    ok: true,
    message: "Import accepted and reconciled records enabled.",
  };
}

export async function claimLegacyPartner(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireAdmin();
  const partnerId = z.uuid().safeParse(formData.get("partnerId"));
  const email = emailSchema.safeParse(formData.get("email"));
  const phone = String(formData.get("phone") ?? "").trim();
  const confirmation = String(formData.get("confirmation") ?? "").trim();
  if (!partnerId.success || !email.success || confirmation !== "LINK PARTNER")
    return {
      ok: false,
      message: "Enter a valid email and type LINK PARTNER exactly.",
    };
  const supabase = await createClient();
  const { data: aal } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2")
    return { ok: false, message: "A current AAL2 session is required." };
  const admin = createAdminClient();
  const { data: party } = await admin
    .from("legacy_partner_identities")
    .select("canonical_name,profile_id")
    .eq("id", partnerId.data)
    .single();
  if (!party || party.profile_id)
    return {
      ok: false,
      message: "This legacy partner is unavailable or already linked.",
    };
  let authUserId: string | undefined;
  const created = await admin.auth.admin.createUser({
    email: email.data,
    email_confirm: false,
    user_metadata: { legal_name: party.canonical_name },
  });
  authUserId = created.data.user?.id;
  if (created.error || !authUserId) {
    const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    authUserId = listed.data.users.find(
      (user) => user.email?.toLowerCase() === email.data,
    )?.id;
  }
  if (!authUserId)
    return {
      ok: false,
      message: "The login account could not be created or safely reused.",
    };
  const { error } = await admin.rpc("link_legacy_partner", {
    p_admin_id: profile.id,
    p_legacy_partner_id: partnerId.data,
    p_auth_user_id: authUserId,
    p_email: email.data,
    p_phone: phone,
    p_confirmation: confirmation,
    p_admin_aal2: true,
    p_request_id: requestId(),
  });
  if (error)
    return {
      ok: false,
      message: "The account exists but the legacy history was not linked.",
    };
  revalidatePath("/admin/partners");
  return {
    ok: true,
    message: "Legacy history linked. No email was sent automatically.",
  };
}
