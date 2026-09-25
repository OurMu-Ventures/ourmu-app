"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { cycleDayBounds } from "@/lib/cycle-dates";
import { audit, requestId } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { emailSchema, type ActionState } from "@/lib/validation";

const cycleSchema = z
  .object({
    name: z.string().trim().min(3).max(100),
    opensAt: z.iso.date(),
    closesAt: z.iso.date(),
    maturityDate: z.iso.date(),
    capacityUgx: z
      .string()
      .trim()
      .regex(/^\d+(?:\.\d{1,2})?$/)
      .refine((value) => Number(value) >= 125_000),
  })
  .transform((cycle, context) => {
    const bounds = cycleDayBounds(cycle.opensAt, cycle.closesAt);
    if (!bounds) {
      context.addIssue({
        code: "custom",
        path: ["closesAt"],
        message: "Closing date must be on or after the opening date.",
      });
      return z.NEVER;
    }
    // Payouts are scheduled on the 15th of the maturity month, so a portal
    // cycle must mature on or before that day. Historical imports are
    // excluded from this rule by the database trigger.
    if (Number(cycle.maturityDate.split("-")[2]) > 15) {
      context.addIssue({
        code: "custom",
        path: ["maturityDate"],
        message: "Maturity date must be on or before the 15th of its month.",
      });
      return z.NEVER;
    }
    return {
      ...cycle,
      opensAt: bounds.opensAt,
      closesAt: bounds.closesAt,
    };
  });

function cycleValidationMessage(error: z.ZodError) {
  const issue = error.issues[0];
  const field = issue?.path[0];
  if (issue?.code === "custom" && issue.message.startsWith("Closing date"))
    return issue.message;
  if (issue?.code === "custom" && issue.message.startsWith("Maturity date"))
    return issue.message;
  if (field === "name") return "Enter a cycle name of at least 3 characters.";
  if (field === "opensAt") return "Select a valid opening date.";
  if (field === "closesAt") return "Select a valid closing date.";
  if (field === "maturityDate") return "Select a valid maturity date.";
  if (field === "capacityUgx")
    return "Enter a capacity of at least UGX 125,000 with at most two decimal places.";
  return "Check the cycle details and try again.";
}

async function latestAgreementId(admin: ReturnType<typeof createAdminClient>) {
  const { data, error } = await admin
    .from("agreement_versions")
    .select("id,template_markdown")
    .eq("is_legally_approved", true)
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data || /PLACEHOLDER|TBD/i.test(data.template_markdown))
    return null;
  return data.id;
}

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
  });
  if (!parsed.success)
    return {
      ok: false,
      message: cycleValidationMessage(parsed.error),
    };
  const admin = createAdminClient();
  const agreementVersionId = await latestAgreementId(admin);
  if (!agreementVersionId)
    return { ok: false, message: "Publish an approved agreement before creating a cycle." };
  const { data, error } = await admin
    .from("investment_cycles")
    .insert({
      name: parsed.data.name,
      opens_at: parsed.data.opensAt,
      closes_at: parsed.data.closesAt,
      maturity_date: parsed.data.maturityDate,
      capacity_ugx: Number(parsed.data.capacityUgx),
      agreement_version_id: agreementVersionId,
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
  });
  if (!cycleId.success)
    return { ok: false, message: "Cycle not found." };
  if (!parsed.success)
    return {
      ok: false,
      message: cycleValidationMessage(parsed.error),
    };
  const admin = createAdminClient();
  const agreementVersionId = await latestAgreementId(admin);
  if (!agreementVersionId)
    return { ok: false, message: "Publish an approved agreement before editing a cycle." };
  const { data, error } = await admin
    .from("investment_cycles")
    .update({
      name: parsed.data.name,
      opens_at: parsed.data.opensAt,
      closes_at: parsed.data.closesAt,
      maturity_date: parsed.data.maturityDate,
      capacity_ugx: Number(parsed.data.capacityUgx),
      agreement_version_id: agreementVersionId,
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
  const { data: job } = await admin
    .from("jobs")
    .select("id,kind,entity_id,status")
    .eq("id", jobId)
    .maybeSingle();
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
  // Retrying a receipt generation reuses the same receipt number: reset the
  // row to generating so the worker rebuilds the same document.
  if (job?.kind === "generate_receipt_pdf" && job.entity_id) {
    await admin
      .from("investment_receipts")
      .update({ pdf_status: "generating", last_error_code: null })
      .eq("id", job.entity_id)
      .eq("pdf_status", "failed");
  }
  await audit({
    actorId: adminProfile.id,
    action: "job.retried",
    entityType: "job",
    entityId: jobId,
    requestId: requestId(),
  });
  revalidatePath("/admin/jobs");
}

// Audited recovery for deliveries blocked by the 24h idempotency guard.
// Either the provider send is confirmed (mark delivered) or a fresh send is
// authorized (clears the first-send timestamp so the next attempt re-keys
// the guard instead of bouncing straight back to dead).
export async function reconcileJobDelivery(formData: FormData) {
  const adminProfile = await requireAdmin();
  const jobId = z.uuid().parse(formData.get("jobId"));
  const outcome = z
    .enum(["confirmed_delivered", "authorize_resend"])
    .parse(formData.get("outcome"));
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 500);
  const admin = createAdminClient();
  const { data: job } = await admin
    .from("jobs")
    .select("id,status,last_error_code")
    .eq("id", jobId)
    .maybeSingle();
  if (
    !job ||
    !["failed", "dead"].includes(job.status) ||
    job.last_error_code !== "NEEDS_RECONCILIATION"
  )
    throw new Error("Job is not awaiting reconciliation");
  if (outcome === "confirmed_delivered") {
    const { error } = await admin
      .from("jobs")
      .update({
        status: "succeeded",
        completed_at: new Date().toISOString(),
        last_error_code: null,
      })
      .eq("id", jobId);
    if (error) throw new Error("Reconciliation failed");
  } else {
    const { error } = await admin
      .from("jobs")
      .update({
        status: "pending",
        available_at: new Date().toISOString(),
        locked_at: null,
        last_error_code: null,
        first_send_attempt_at: null,
      })
      .eq("id", jobId);
    if (error) throw new Error("Reconciliation failed");
  }
  await audit({
    actorId: adminProfile.id,
    action: "job.delivery_reconciled",
    entityType: "job",
    entityId: jobId,
    requestId: requestId(),
    metadata: { outcome, notes: notes || null },
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
