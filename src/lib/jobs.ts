import "server-only";

import { createHash } from "node:crypto";
import {
  EMAIL_QUOTA_CODES,
  EmailQuotaError,
  quotaRetryAt,
} from "@/lib/email/quota";

import { buildAgreementPdf } from "@/lib/agreements/pdf";
import { sendTransactionalEmail, type EmailTemplate } from "@/lib/email/send";
import { getPublicEnv } from "@/lib/env";
import { bpsToPercent, date, ugx } from "@/lib/format";
import {
  safeFulfilledSplits,
  UNAVAILABLE_MATURITY_AMOUNTS,
  maturityChoiceLabel,
  maturityInstructionTerms,
  maturityNoticeDetail,
  maturityPayoutDateIso,
  type MaturityChoice,
  type MaturityNoticeInput,
} from "@/lib/maturity";
import { RECEIPT_TEMPLATE_VERSION, buildReceiptPdf } from "@/lib/receipts/pdf";
import { formatUgxExact } from "@/lib/receipts/format";
import { createAdminClient } from "@/lib/supabase/admin";

const MATURITY_TEMPLATES: EmailTemplate[] = [
  "maturity_notice",
  "maturity_choice_confirmed",
  "maturity_action_needed",
  "maturity_fulfilled",
];

export type JobRow = {
  id: string;
  kind: string;
  status: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  created_at: string;
  provider_message_id?: string | null;
  first_send_attempt_at?: string | null;
  send_attempts?: number;
};

export type SendEmailPayload = {
  template?: EmailTemplate;
  to?: string;
  actionUrl?: string;
  // Queued notices (e.g. primary-email change confirmations) carry their own
  // body; investment templates still compute theirs at send time.
  detail?: string;
  accountEmailId?: string;
  receiptId?: string;
  idempotencyKey?: string;
  routing?: {
    revision: number;
    cc: string[];
    replyTo: string[];
    teamCopySelected: boolean;
  };
};

// Resend honours an idempotency key for 24h. A retry outside that window
// with an ambiguous prior send must reconcile before resending.
export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

// Pure reconciliation decision, unit-tested. Keys off the first actual
// provider send attempt — never job creation — so jobs that failed before
// ever sending stay retryable, and only genuinely ambiguous sends block.
export function needsReconciliation(input: {
  firstSendAttemptAt?: string | null;
  providerMessageId?: string | null;
  nowMs?: number;
}): boolean {
  if (input.providerMessageId) return false;
  if (!input.firstSendAttemptAt) return false;
  const now = input.nowMs ?? Date.now();
  return (
    now - new Date(input.firstSendAttemptAt).getTime() > IDEMPOTENCY_WINDOW_MS
  );
}

export async function processDueJobs(limit = 10, campaignId?: string) {
  const admin = createAdminClient();
  const { data: quotaHold, error: quotaHoldError } = await admin
    .from("jobs")
    .select("available_at")
    .eq("kind", "send_email")
    .in("status", ["pending", "failed"])
    .in("last_error_code", [...EMAIL_QUOTA_CODES])
    .gt("available_at", new Date().toISOString())
    .order("available_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (quotaHoldError) throw new Error("EMAIL_QUOTA_HOLD_FETCH_FAILED");
  let emailPaused = Boolean(quotaHold);
  let query = admin
    .from("jobs")
    .select("*")
    .in("status", ["pending", "failed"])
    .lte("available_at", new Date().toISOString());
  if (emailPaused) query = query.neq("kind", "send_email");
  if (campaignId)
    query = query
      .eq("entity_type", "email_campaign")
      .eq("entity_id", campaignId);
  const { data: jobs, error } = await query.order("created_at").limit(limit);
  if (error) throw new Error("JOB_FETCH_FAILED");
  const result = { processed: 0, succeeded: 0, failed: 0, deferred: 0 };
  for (const raw of (jobs ?? []) as JobRow[]) {
    if (emailPaused && raw.kind === "send_email") continue;
    result.processed += 1;
    // Conditional claim: only the worker whose UPDATE matches a
    // pending/failed row owns the job. Concurrent workers whose UPDATE
    // matches zero rows must skip processing.
    const { data: claimed } = await admin
      .from("jobs")
      .update({
        status: "running",
        locked_at: new Date().toISOString(),
        attempts: raw.attempts + 1,
      })
      .eq("id", raw.id)
      .in("status", ["pending", "failed"])
      .select("id");
    if (!claimed || (claimed as unknown[]).length === 0) continue;
    let providerMessageId: string | null = null;
    try {
      if (raw.kind === "generate_agreement_pdf")
        await generateAgreement(raw.entity_id);
      else if (raw.kind === "generate_receipt_pdf")
        await generateReceipt(raw.entity_id);
      else if (raw.kind === "send_email")
        providerMessageId = await deliverJobEmail({
          ...raw,
          attempts: raw.attempts + 1,
        });
      else throw new Error("JOB_KIND_UNKNOWN");
      await admin
        .from("jobs")
        .update({
          status: "succeeded",
          completed_at: new Date().toISOString(),
          last_error_code: null,
          ...(providerMessageId
            ? { provider_message_id: providerMessageId }
            : {}),
        })
        .eq("id", raw.id);
      result.succeeded += 1;
    } catch (jobError) {
      if (jobError instanceof EmailQuotaError && raw.kind === "send_email") {
        // The provider explicitly rejected this request. Restore prior tracking;
        // any earlier ambiguous send must retain its reconciliation protection.
        const { error: deferError } = await admin
          .from("jobs")
          .update({
            status: "pending",
            attempts: raw.attempts,
            locked_at: null,
            last_error_code: jobError.code,
            available_at: quotaRetryAt(jobError.code),
            first_send_attempt_at: raw.first_send_attempt_at ?? null,
            send_attempts: raw.send_attempts ?? 0,
          })
          .eq("id", raw.id);
        if (deferError) throw new Error("EMAIL_QUOTA_DEFER_FAILED");
        emailPaused = true;
        result.deferred += 1;
        continue;
      }
      const terminal =
        raw.attempts + 1 >= raw.max_attempts ||
        (jobError instanceof Error &&
          [
            "NEEDS_RECONCILIATION",
            "STALE_RESERVATION",
            "RESERVATION_NOT_FOUND",
          ].includes(jobError.message));
      const code =
        jobError instanceof Error
          ? jobError.message.slice(0, 80)
          : "JOB_FAILED";
      await admin
        .from("jobs")
        .update({
          status: terminal ? "dead" : "failed",
          last_error_code: code,
          available_at: new Date(
            Date.now() + Math.min(3600, 2 ** raw.attempts * 60) * 1000,
          ).toISOString(),
        })
        .eq("id", raw.id);
      result.failed += 1;
    }
  }
  return result;
}

async function generateAgreement(investmentId: string) {
  const admin = createAdminClient();
  const { data: investment } = await admin
    .from("investments")
    .select(
      "id,units,principal_ugx,projected_return_ugx,projected_value_ugx,maturity_date,investor_id",
    )
    .eq("id", investmentId)
    .single();
  const { data: acceptance } = await admin
    .from("investment_agreements")
    .select("id,accepted_at,agreement_version_id")
    .eq("investment_id", investmentId)
    .single();
  if (!investment || !acceptance) throw new Error("AGREEMENT_DATA_MISSING");
  if (!investment.investor_id) throw new Error("AGREEMENT_INVESTOR_MISSING");
  const [{ data: profile }, { data: version }] = await Promise.all([
    admin
      .from("profiles")
      .select("legal_name,email")
      .eq("id", investment.investor_id)
      .single(),
    admin
      .from("agreement_versions")
      .select("title,template_markdown,is_legally_approved")
      .eq("id", acceptance.agreement_version_id)
      .single(),
  ]);
  if (
    !profile ||
    !version?.is_legally_approved ||
    /PLACEHOLDER|TBD/i.test(version.template_markdown)
  )
    throw new Error("LEGAL_TEMPLATE_NOT_APPROVED");
  const pdf = await buildAgreementPdf({
    title: version.title,
    template: version.template_markdown,
    investorName: profile.legal_name,
    investorEmail: profile.email,
    units: Number(investment.units),
    principalUgx: Number(investment.principal_ugx),
    projectedReturnUgx: Number(investment.projected_return_ugx),
    projectedValueUgx: Number(investment.projected_value_ugx),
    maturityDate: investment.maturity_date,
    acceptedAt: acceptance.accepted_at,
  });
  const path = `${investment.investor_id}/${investment.id}.pdf`;
  const { error: uploadError } = await admin.storage
    .from("agreements")
    .upload(path, pdf.bytes, { contentType: "application/pdf", upsert: false });
  if (
    uploadError &&
    !uploadError.message.toLowerCase().includes("already exists")
  )
    throw new Error("PDF_UPLOAD_FAILED");
  const { error: updateError } = await admin
    .from("investment_agreements")
    .update({
      pdf_status: "ready",
      pdf_path: path,
      pdf_hash: pdf.hash,
      generated_at: new Date().toISOString(),
    })
    .eq("id", acceptance.id);
  if (updateError) throw new Error("PDF_RECORD_FAILED");
  await admin.from("jobs").insert({
    kind: "send_email",
    entity_type: "investment",
    entity_id: investment.id,
    payload: { template: "agreement_ready" },
  });
}

type ReceiptRow = {
  id: string;
  investment_id: string;
  investor_id: string;
  source: "bank_activation" | "reinvestment";
  receipt_number: string;
  is_test: boolean;
  partner_name: string;
  partner_phone: string | null;
  company_name: string;
  company_address: string;
  amount_ugx: string | number;
  transaction_date: string;
  account_description: string;
  original_investment_id: string | null;
  pdf_status: string;
  pdf_path: string | null;
  template_version: string;
};

async function fetchReceipt(receiptId: string): Promise<ReceiptRow | null> {
  const admin = createAdminClient() as never as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (
          k: string,
          v: string,
        ) => {
          maybeSingle: () => Promise<{
            data: ReceiptRow | null;
            error: unknown;
          }>;
        };
      };
    };
  };
  const { data, error } = await admin
    .from("investment_receipts")
    .select("*")
    .eq("id", receiptId)
    .maybeSingle();
  // Never silently degrade to a receipt-less send: surface lookup failures
  // so the job retries instead of delivering without its PDF.
  if (error) throw new Error("RECEIPT_LOOKUP_FAILED");
  return data;
}

function receiptDisplayDate(isoDate: string): string {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (dateOnly) {
    const check = new Date(
      Date.UTC(
        Number(dateOnly[1]),
        Number(dateOnly[2]) - 1,
        Number(dateOnly[3]),
      ),
    );
    return new Intl.DateTimeFormat("en-UG", {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(check);
  }
  return new Intl.DateTimeFormat("en-UG", {
    dateStyle: "medium",
    timeZone: "Africa/Kampala",
  }).format(new Date(isoDate));
}

// Build the branded receipt PDF, store it privately, then queue the single
// activation email (with the PDF attached) for the investment. Generation or
// delivery failures never reverse the activated investment; retries reuse the
// same receipt number and stored document.
async function generateReceipt(receiptId: string) {
  const admin = createAdminClient() as never as {
    from: (
      t: string,
    ) => ReturnType<ReturnType<typeof createAdminClient>["from"]>;
    storage: ReturnType<typeof createAdminClient>["storage"];
  };
  const receipt = await fetchReceipt(receiptId);
  if (!receipt) throw new Error("RECEIPT_NOT_FOUND");
  if (receipt.pdf_status === "ready" && receipt.pdf_path) {
    await queueActivationEmail(receipt);
    return;
  }
  try {
    const pdf = await buildReceiptPdf({
      title:
        receipt.source === "reinvestment"
          ? "Reinvestment Receipt"
          : "Investment Receipt",
      receiptNumber: receipt.receipt_number,
      partnerName: receipt.partner_name,
      partnerPhone: receipt.partner_phone,
      companyName: receipt.company_name,
      companyAddress: receipt.company_address,
      accountDescription: receipt.account_description,
      amountUgx: String(receipt.amount_ugx),
      transactionDate: receiptDisplayDate(receipt.transaction_date),
      originalInvestmentRef: receipt.original_investment_id,
      transferNote:
        receipt.source === "reinvestment"
          ? "This amount was transferred from the matured investment listed above."
          : null,
      isTest: receipt.is_test,
    });
    const path = `${receipt.investor_id}/${receipt.id}.pdf`;
    const { error: uploadError } = await admin.storage
      .from("receipts")
      .upload(path, pdf.bytes, {
        contentType: "application/pdf",
        upsert: false,
      });
    // Record the hash of the bytes actually stored. On an upload conflict
    // (a previous attempt already stored the file) download the stored
    // object and hash that — regenerated bytes can differ in metadata.
    let storedHash = pdf.hash;
    if (uploadError) {
      if (!uploadError.message.toLowerCase().includes("already exists"))
        throw new Error("PDF_UPLOAD_FAILED");
      const { data: existing, error: downloadError } = await admin.storage
        .from("receipts")
        .download(path);
      if (downloadError || !existing) throw new Error("PDF_UPLOAD_FAILED");
      storedHash = createHash("sha256")
        .update(Buffer.from(await existing.arrayBuffer()))
        .digest("hex");
    }
    const { error: updateError } = await (
      admin as never as ReturnType<typeof createAdminClient>
    )
      .from("investment_receipts" as never)
      .update({
        pdf_status: "ready",
        pdf_path: path,
        pdf_hash: storedHash,
        template_version: RECEIPT_TEMPLATE_VERSION,
        generated_at: new Date().toISOString(),
        last_error_code: null,
      } as never)
      .eq("id", receipt.id);
    if (updateError) throw new Error("PDF_RECORD_FAILED");
    await queueActivationEmail({
      ...receipt,
      pdf_status: "ready",
      pdf_path: path,
    });
  } catch (error) {
    await (admin as never as ReturnType<typeof createAdminClient>)
      .from("investment_receipts" as never)
      .update({
        pdf_status: "failed",
        last_error_code:
          error instanceof Error ? error.message.slice(0, 80) : "JOB_FAILED",
      } as never)
      .eq("id", receipt.id);
    throw error instanceof Error ? error : new Error("JOB_FAILED");
  }
}

async function queueActivationEmail(receipt: ReceiptRow) {
  const admin = createAdminClient();
  const { error } = await admin.from("jobs").insert({
    kind: "send_email",
    entity_type: "investment",
    entity_id: receipt.investment_id,
    payload: {
      template: "investment_activated",
      receiptId: receipt.id,
    },
  });
  if (error) throw new Error("EMAIL_QUEUE_FAILED");
}

async function receiptForInvestment(
  investmentId: string,
): Promise<ReceiptRow | null> {
  const admin = createAdminClient() as never as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (
          k: string,
          v: string,
        ) => {
          order: (
            c: string,
            o: object,
          ) => {
            limit: (n: number) => Promise<{
              data: ReceiptRow[] | null;
              error: unknown;
            }>;
          };
        };
      };
    };
  };
  const { data, error } = await admin
    .from("investment_receipts")
    .select("*")
    .eq("investment_id", investmentId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error("RECEIPT_LOOKUP_FAILED");
  return data?.[0] ?? null;
}

// Exported for worker-level regression tests (the production caller is
// processDueJobs above).
export async function deliverJobEmail(job: JobRow): Promise<string | null> {
  const admin = createAdminClient();
  const payload = job.payload as SendEmailPayload;
  const to = payload.to;
  if (
    job.entity_type === "investment" &&
    payload.template === "reservation_created"
  ) {
    const { data: investment, error } = await admin
      .from("investments")
      .select("status")
      .eq("id", job.entity_id)
      .maybeSingle();
    if (error) throw new Error("RESERVATION_LOOKUP_FAILED");
    if (!investment) throw new Error("RESERVATION_NOT_FOUND");
    if (investment.status !== "reserved") throw new Error("STALE_RESERVATION");
  }
  if (to && payload.accountEmailId) {
    const { data: activeRecipient } = await admin
      .from("account_emails")
      .select("id")
      .eq("id", payload.accountEmailId)
      .eq("email", to)
      .not("verified_at", "is", null)
      .maybeSingle();
    // Removing an alias immediately suppresses any queued delivery to it.
    if (!activeRecipient) {
      if (payload.routing?.teamCopySelected) {
        await admin
          .from("jobs")
          .update({ cc_review_required: true })
          .eq("id", job.id);
      }
      return null;
    }
  }
  if (!to && job.entity_type === "investment") {
    await fanOutInvestmentEmails(job);
    return null;
  }
  if (!to || !payload.template) throw new Error("EMAIL_JOB_INVALID");
  // Ambiguous sends outside Resend's 24h idempotency window need human
  // reconciliation before retrying, otherwise a retry could double-send.
  // Keys off the first actual provider send, not job creation, so jobs that
  // failed before ever sending stay retryable.
  if (
    needsReconciliation({
      firstSendAttemptAt: job.first_send_attempt_at,
      providerMessageId: job.provider_message_id,
    })
  ) {
    throw new Error("NEEDS_RECONCILIATION");
  }
  let actionUrl = payload.actionUrl;
  let detail: string | undefined =
    typeof payload.detail === "string" && payload.detail.length > 0
      ? payload.detail
      : undefined;
  let maturityNotice: MaturityNoticeInput | undefined;
  let activationReceipt:
    import("@/lib/email/template").ActivationReceiptInput | undefined;
  let attachments: { filename: string; content: Buffer }[] | undefined;
  let idempotencyKey = payload.idempotencyKey;
  if (
    job.entity_type === "investment" &&
    MATURITY_TEMPLATES.includes(payload.template)
  ) {
    const content = await maturityEmailContent(job.entity_id, payload.template);
    actionUrl = payload.actionUrl ?? content.actionUrl;
    detail = content.detail;
    maturityNotice = content.maturityNotice;
  }
  if (
    job.entity_type === "investment" &&
    payload.template === "reservation_created"
  ) {
    const content = await reservationEmailContent(job.entity_id);
    actionUrl = payload.actionUrl ?? content.actionUrl;
    detail = content.detail;
  }
  if (
    job.entity_type === "investment" &&
    payload.template === "investment_activated"
  ) {
    // When the job names a receipt, the email must carry its PDF: a missing
    // row or a not-yet-ready document retries without sending. Only the
    // legacy path (no receiptId, e.g. pre-rollout activations) may send
    // without an attachment.
    const receipt = payload.receiptId
      ? await fetchReceipt(payload.receiptId)
      : await receiptForInvestment(job.entity_id);
    if (payload.receiptId && !receipt) throw new Error("RECEIPT_NOT_FOUND");
    if (
      payload.receiptId &&
      (!receipt || receipt.pdf_status !== "ready" || !receipt.pdf_path)
    )
      throw new Error("RECEIPT_NOT_READY");
    const baseUrl = getPublicEnv().NEXT_PUBLIC_APP_URL;
    actionUrl = payload.actionUrl ?? `${baseUrl}/investments/${job.entity_id}`;
    if (receipt) {
      activationReceipt = {
        partnerName: receipt.partner_name,
        amountUgx: formatUgxExact(receipt.amount_ugx),
        receiptNumber: receipt.receipt_number,
        isReinvestment: receipt.source === "reinvestment",
        originalInvestmentRef: receipt.original_investment_id,
        actionUrl,
      };
      if (receipt.pdf_path && receipt.pdf_status === "ready") {
        const { data: file, error } = await admin.storage
          .from("receipts")
          .download(receipt.pdf_path);
        if (error) throw new Error("RECEIPT_DOWNLOAD_FAILED");
        const bytes = Buffer.from(await file.arrayBuffer());
        attachments = [
          {
            filename: `${receipt.receipt_number}.pdf`,
            content: bytes,
          },
        ];
      }
      idempotencyKey =
        payload.idempotencyKey ??
        `receipt-${receipt.id}-${payload.accountEmailId ?? to}`;
    } else {
      // Historical activation without a receipt (no backfill): themed email
      // without attachment.
      const { data: investment } = await admin
        .from("investments")
        .select("principal_ugx,investor_id")
        .eq("id", job.entity_id)
        .single();
      let partnerName: string | undefined;
      if (investment?.investor_id) {
        const { data: profile } = await admin
          .from("profiles")
          .select("legal_name")
          .eq("id", investment.investor_id)
          .single();
        partnerName = profile?.legal_name ?? undefined;
      }
      activationReceipt = {
        partnerName,
        amountUgx: investment
          ? formatUgxExact(String(investment.principal_ugx))
          : undefined,
        actionUrl,
      };
      idempotencyKey =
        payload.idempotencyKey ??
        `job-${job.id}-${payload.accountEmailId ?? to}`;
    }
  }
  // Record the first actual provider send attempt (separate from worker
  // claim attempts) before calling the provider, so the idempotency guard
  // and any later reconciliation key off real sends. This write must succeed
  // first: if tracking is lost while Resend accepts the email, a retry past
  // the 24h window could otherwise bypass reconciliation and double-send.
  const sendAttemptAt = new Date().toISOString();
  const { error: trackingError } = await admin
    .from("jobs")
    .update({
      send_attempts: (job.send_attempts ?? 0) + 1,
      first_send_attempt_at: job.first_send_attempt_at ?? sendAttemptAt,
    })
    .eq("id", job.id);
  if (trackingError) throw new Error("SEND_TRACKING_FAILED");
  const messageId = await sendTransactionalEmail({
    to,
    cc: MATURITY_TEMPLATES.includes(payload.template)
      ? payload.routing?.cc
      : undefined,
    replyTo: MATURITY_TEMPLATES.includes(payload.template)
      ? payload.routing?.replyTo
      : undefined,
    template: payload.template,
    actionUrl,
    detail,
    maturityNotice,
    activationReceipt,
    attachments,
    idempotencyKey,
  });
  return messageId;
}

// Reservation emails explain the manual expiry policy.
async function reservationEmailContent(
  investmentId: string,
): Promise<{ detail: string; actionUrl: string }> {
  const admin = createAdminClient();
  const actionUrl = `${getPublicEnv().NEXT_PUBLIC_APP_URL}/investments/${investmentId}`;
  const { data: investment } = await admin
    .from("investments")
    .select("principal_ugx,investment_cycles(name)")
    .eq("id", investmentId)
    .single();
  if (!investment) throw new Error("EMAIL_JOB_INVALID");
  const cycle = Array.isArray(investment.investment_cycles)
    ? investment.investment_cycles[0]
    : investment.investment_cycles;
  const detail =
    `Your OURMU investment reservation of ${ugx(Number(investment.principal_ugx))}` +
    `${cycle?.name ? ` for ${cycle.name}` : ""} is recorded. ` +
    "Transfer the exact amount shown. Your reservation does not expire automatically; " +
    "it stays pending until an administrator activates or expires it, or you cancel it. " +
    "Payments must match the reserved cycle. Contact our team if the cycle closes before you transfer. " +
    "If you already transferred, do not pay again.";
  return { detail, actionUrl };
}

// Maturity emails carry the figures that prompt the partner's decision:
// principal, projected ROI, payout date, the three choices with their
// splits, and a link to the investment — never just the subject line.
async function maturityEmailContent(
  investmentId: string,
  template: EmailTemplate,
): Promise<{
  detail: string;
  actionUrl: string;
  maturityNotice?: MaturityNoticeInput;
}> {
  const admin = createAdminClient();
  const actionUrl = `${getPublicEnv().NEXT_PUBLIC_APP_URL}/investments/${investmentId}`;
  const { data: investment } = await admin
    .from("investments")
    .select(
      "principal_ugx,projected_return_ugx,projected_return_bps,projected_value_ugx,maturity_date",
    )
    .eq("id", investmentId)
    .single();
  if (!investment) throw new Error("EMAIL_JOB_INVALID");
  const principal = Number(investment.principal_ugx);
  const projectedReturn = Number(investment.projected_return_ugx);
  const payoutDate = date(maturityPayoutDateIso(investment.maturity_date));
  const { data: instruction } = await admin
    .from("maturity_instructions")
    .select(
      "choice,requested_withdrawal_ugx,status,projected_payout_ugx,projected_reinvest_ugx,actual_payout_ugx,actual_reinvest_ugx,actual_roi_ugx,proposed_actual_roi_ugx,resolution_notes,target_cycle_id",
    )
    .eq("investment_id", investmentId)
    .maybeSingle();
  const basis =
    `Your OURMU investment of ${ugx(principal)} matured on ${date(investment.maturity_date)} ` +
    `with a projected ${bpsToPercent(investment.projected_return_bps)}% return of ` +
    `${ugx(projectedReturn)} (projected value ${ugx(investment.projected_value_ugx)}). ` +
    `Payouts are scheduled for ${payoutDate}.`;
  if (template === "maturity_notice") {
    const maturityNotice: MaturityNoticeInput = {
      principalUgx: principal,
      projectedReturnUgx: projectedReturn,
      projectedValueUgx: Number(investment.projected_value_ugx),
      projectedPercent: bpsToPercent(investment.projected_return_bps),
      maturityDate: date(investment.maturity_date),
      payoutDate,
    };
    return {
      actionUrl,
      detail: maturityNoticeDetail(maturityNotice),
      maturityNotice,
    };
  }
  if (template === "maturity_choice_confirmed" && instruction) {
    const instructionTerms = maturityInstructionTerms(
      instruction.choice as MaturityChoice,
      instruction.requested_withdrawal_ugx,
    );
    const { data: assigned } = instruction.target_cycle_id
      ? await admin
          .from("investment_cycles")
          .select("name,maturity_date")
          .eq("id", instruction.target_cycle_id)
          .maybeSingle()
      : { data: null };
    const cycleSuffix =
      assigned && Number(instruction.projected_reinvest_ugx) > 0
        ? ` Assigned cycle ${assigned.name} (matures ${date(assigned.maturity_date)}). The cycle was assigned automatically when your choice was recorded.`
        : "";
    return {
      actionUrl,
      detail:
        `Your maturity choice (${maturityChoiceLabel(instruction.choice)}) is recorded: projected payout ` +
        `${ugx(instruction.projected_payout_ugx)}, projected reinvestment ` +
        `${ugx(instruction.projected_reinvest_ugx)}.${cycleSuffix} ${instructionTerms ? `${instructionTerms} ` : ""}You can revise it until our team begins ` +
        `processing. Scheduled payout date: ${payoutDate}.`,
    };
  }
  if (template === "maturity_fulfilled" && instruction) {
    return {
      actionUrl,
      detail:
        `Your maturity instruction is fulfilled from an actual return of ` +
        `${ugx(instruction.actual_roi_ugx ?? projectedReturn)}: payout ` +
        `${ugx(instruction.actual_payout_ugx ?? 0)}, reinvestment ` +
        `${ugx(instruction.actual_reinvest_ugx ?? 0)}.`,
    };
  }
  if (
    template === "maturity_action_needed" &&
    instruction?.proposed_actual_roi_ugx != null
  ) {
    const proposed = safeFulfilledSplits(
      principal,
      Number(instruction.proposed_actual_roi_ugx),
      instruction.choice as MaturityChoice,
      instruction.requested_withdrawal_ugx == null
        ? undefined
        : {
            requestedWithdrawalUgx: Number(
              instruction.requested_withdrawal_ugx,
            ),
            projectedPayoutUgx: Number(instruction.projected_payout_ugx),
            projectedReinvestUgx: Number(instruction.projected_reinvest_ugx),
            projectedTotalUgx:
              Number(instruction.projected_payout_ugx) +
              Number(instruction.projected_reinvest_ugx),
          },
    );
    if (!proposed) return { actionUrl, detail: UNAVAILABLE_MATURITY_AMOUNTS };
    return {
      actionUrl,
      detail:
        `The fund recorded an actual return of ${ugx(instruction.proposed_actual_roi_ugx)} ` +
        `instead of the projected ${ugx(projectedReturn)}. Your updated amounts for ` +
        `(${maturityChoiceLabel(instruction.choice)}): payout ${ugx(proposed.payoutUgx)}, reinvestment ` +
        `${ugx(proposed.reinvestUgx)}. Open your investment to confirm before anything is paid or reinvested.`,
    };
  }
  if (template === "maturity_action_needed" && instruction?.resolution_notes) {
    return {
      actionUrl,
      detail:
        `Our team needs your input before your maturity choice can proceed: ` +
        `${instruction.resolution_notes} Open your investment to revise your choice.`,
    };
  }
  return { actionUrl, detail: basis };
}

// Exported for worker-level regression tests (the production caller is
// deliverJobEmail above).
export async function fanOutInvestmentEmails(job: JobRow) {
  const payload = job.payload as SendEmailPayload;
  const template = payload.template;
  if (!template) throw new Error("EMAIL_JOB_INVALID");
  if (MATURITY_TEMPLATES.includes(template)) {
    const actionUrl = `${getPublicEnv().NEXT_PUBLIC_APP_URL}/investments/${job.entity_id}`;
    const { error } = await createAdminClient().rpc("fan_out_maturity_email", {
      p_job_id: job.id,
      p_action_url: actionUrl,
    });
    if (error) throw new Error("EMAIL_FANOUT_FAILED");
    return;
  }
  const admin = createAdminClient();
  const { data: investment } = await admin
    .from("investments")
    .select("investor_id")
    .eq("id", job.entity_id)
    .single();
  const { data: recipients } = investment?.investor_id
    ? await admin
        .from("account_emails")
        .select("id,email")
        .eq("user_id", investment.investor_id)
        .not("verified_at", "is", null)
    : { data: null };
  if (!recipients?.length) throw new Error("EMAIL_JOB_INVALID");
  const actionUrl = `${getPublicEnv().NEXT_PUBLIC_APP_URL}/investments/${job.entity_id}`;
  // One delivery record per receipt and verified recipient: the dedupe key
  // is stable per (receipt, recipient) so retries never duplicate queued
  // deliveries and reuse the same receipt number. A parent job that names a
  // receipt must resolve it here — never fan out receipt-less children that
  // would bypass the RECEIPT_NOT_FOUND guard and send legacy emails.
  let receipt: ReceiptRow | null = null;
  if (template === "investment_activated") {
    if (payload.receiptId) {
      receipt = await fetchReceipt(payload.receiptId);
      if (!receipt) throw new Error("RECEIPT_NOT_FOUND");
    } else {
      receipt = await receiptForInvestment(job.entity_id);
    }
  }
  const rows = recipients.map((recipient) => ({
    kind: "send_email" as const,
    entity_type: "investment",
    entity_id: job.entity_id,
    payload: {
      template,
      to: recipient.email,
      accountEmailId: recipient.id,
      actionUrl,
      ...(receipt
        ? {
            receiptId: receipt.id,
            idempotencyKey: `receipt-${receipt.id}-${recipient.id}`,
          }
        : { idempotencyKey: `job-${job.id}-${recipient.id}` }),
    },
    email_dedupe_key: receipt
      ? `receipt:${receipt.id}:${recipient.id}`
      : `${job.id}:${recipient.id}`,
  }));
  const { error } = await admin.from("jobs").upsert(rows, {
    onConflict: "email_dedupe_key",
    ignoreDuplicates: true,
  });
  if (error) throw new Error("EMAIL_FANOUT_FAILED");
}
