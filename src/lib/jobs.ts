import "server-only";

import { buildAgreementPdf } from "@/lib/agreements/pdf";
import { sendTransactionalEmail, type EmailTemplate } from "@/lib/email/send";
import { getPublicEnv } from "@/lib/env";
import { bpsToPercent, date, ugx } from "@/lib/format";
import {
  fulfilledSplits,
  MATURITY_CHOICES,
  maturityNoticeDetail,
  maturityPayoutDateIso,
  type MaturityChoice,
} from "@/lib/maturity";
import { createAdminClient } from "@/lib/supabase/admin";

const MATURITY_TEMPLATES: EmailTemplate[] = [
  "maturity_notice",
  "maturity_choice_confirmed",
  "maturity_action_needed",
  "maturity_fulfilled",
];

export async function processDueJobs(limit = 10) {
  const admin = createAdminClient();
  const { data: jobs, error } = await admin
    .from("jobs")
    .select("*")
    .in("status", ["pending", "failed"])
    .lte("available_at", new Date().toISOString())
    .order("created_at")
    .limit(limit);
  if (error) throw new Error("JOB_FETCH_FAILED");
  const result = { processed: 0, succeeded: 0, failed: 0 };
  for (const job of jobs ?? []) {
    result.processed += 1;
    await admin
      .from("jobs")
      .update({
        status: "running",
        locked_at: new Date().toISOString(),
        attempts: job.attempts + 1,
      })
      .eq("id", job.id)
      .in("status", ["pending", "failed"]);
    try {
      if (job.kind === "generate_agreement_pdf")
        await generateAgreement(job.entity_id);
      else if (job.kind === "send_email")
        await deliverJobEmail(
          job.id,
          job.entity_type,
          job.entity_id,
          job.payload as {
            template?: EmailTemplate;
            to?: string;
            actionUrl?: string;
            accountEmailId?: string;
          },
        );
      await admin
        .from("jobs")
        .update({
          status: "succeeded",
          completed_at: new Date().toISOString(),
          last_error_code: null,
        })
        .eq("id", job.id);
      result.succeeded += 1;
    } catch (jobError) {
      const terminal = job.attempts + 1 >= job.max_attempts;
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
            Date.now() + Math.min(3600, 2 ** job.attempts * 60) * 1000,
          ).toISOString(),
        })
        .eq("id", job.id);
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

async function deliverJobEmail(
  jobId: string,
  entityType: string,
  entityId: string,
  payload: {
    template?: EmailTemplate;
    to?: string;
    actionUrl?: string;
    accountEmailId?: string;
  },
) {
  const admin = createAdminClient();
  const to = payload.to;
  if (to && payload.accountEmailId) {
    const { data: activeRecipient } = await admin
      .from("account_emails")
      .select("id")
      .eq("id", payload.accountEmailId)
      .eq("email", to)
      .not("verified_at", "is", null)
      .maybeSingle();
    // Removing an alias immediately suppresses any queued delivery to it.
    if (!activeRecipient) return;
  }
  if (!to && entityType === "investment") {
    await fanOutInvestmentEmails(jobId, entityId, payload.template);
    return;
  }
  if (!to || !payload.template) throw new Error("EMAIL_JOB_INVALID");
  let actionUrl = payload.actionUrl;
  let detail: string | undefined;
  if (entityType === "investment" && MATURITY_TEMPLATES.includes(payload.template)) {
    const content = await maturityEmailContent(entityId, payload.template);
    actionUrl = payload.actionUrl ?? content.actionUrl;
    detail = content.detail;
  }
  await sendTransactionalEmail({
    to,
    template: payload.template,
    actionUrl,
    detail,
  });
}

function choiceLabel(choice: string) {
  return (
    MATURITY_CHOICES.find((option) => option.value === choice)?.label ?? choice
  );
}

// Maturity emails carry the figures that prompt the partner's decision:
// principal, projected ROI, payout date, the three choices with their
// splits, and a link to the investment — never just the subject line.
async function maturityEmailContent(
  investmentId: string,
  template: EmailTemplate,
): Promise<{ detail: string; actionUrl: string }> {
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
      "choice,status,projected_payout_ugx,projected_reinvest_ugx,actual_payout_ugx,actual_reinvest_ugx,actual_roi_ugx,proposed_actual_roi_ugx,resolution_notes",
    )
    .eq("investment_id", investmentId)
    .maybeSingle();
  const basis =
    `Your OURMU investment of ${ugx(principal)} matured on ${date(investment.maturity_date)} ` +
    `with a projected ${bpsToPercent(investment.projected_return_bps)}% return of ` +
    `${ugx(projectedReturn)} (projected value ${ugx(investment.projected_value_ugx)}). ` +
    `Payouts are scheduled for ${payoutDate}.`;
  if (template === "maturity_notice") {
    return {
      actionUrl,
      detail: maturityNoticeDetail({
        principalUgx: principal,
        projectedReturnUgx: projectedReturn,
        projectedValueUgx: Number(investment.projected_value_ugx),
        projectedPercent: bpsToPercent(investment.projected_return_bps),
        maturityDate: date(investment.maturity_date),
        payoutDate,
      }),
    };
  }
  if (template === "maturity_choice_confirmed" && instruction) {
    return {
      actionUrl,
      detail:
        `Your maturity choice (${choiceLabel(instruction.choice)}) is recorded: projected payout ` +
        `${ugx(instruction.projected_payout_ugx)}, projected reinvestment ` +
        `${ugx(instruction.projected_reinvest_ugx)}. You can revise it until our team begins ` +
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
    const proposed = fulfilledSplits(
      principal,
      Number(instruction.proposed_actual_roi_ugx),
      instruction.choice as MaturityChoice,
    );
    return {
      actionUrl,
      detail:
        `The fund recorded an actual return of ${ugx(instruction.proposed_actual_roi_ugx)} ` +
        `instead of the projected ${ugx(projectedReturn)}. Your updated amounts for ` +
        `(${choiceLabel(instruction.choice)}): payout ${ugx(proposed.payoutUgx)}, reinvestment ` +
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

async function fanOutInvestmentEmails(
  parentJobId: string,
  investmentId: string,
  template?: EmailTemplate,
) {
  if (!template) throw new Error("EMAIL_JOB_INVALID");
  const admin = createAdminClient();
  const { data: investment } = await admin
    .from("investments")
    .select("investor_id")
    .eq("id", investmentId)
    .single();
  const { data: recipients } = investment?.investor_id
    ? await admin
        .from("account_emails")
        .select("id,email")
        .eq("user_id", investment.investor_id)
        .not("verified_at", "is", null)
    : { data: null };
  if (!recipients?.length) throw new Error("EMAIL_JOB_INVALID");
  const actionUrl = `${getPublicEnv().NEXT_PUBLIC_APP_URL}/investments/${investmentId}`;
  const { error } = await admin.from("jobs").upsert(
    recipients.map((recipient) => ({
      kind: "send_email" as const,
      entity_type: "investment",
      entity_id: investmentId,
      payload: {
        template,
        to: recipient.email,
        accountEmailId: recipient.id,
        actionUrl,
      },
      email_dedupe_key: `${parentJobId}:${recipient.id}`,
    })),
    { onConflict: "email_dedupe_key", ignoreDuplicates: true },
  );
  if (error) throw new Error("EMAIL_FANOUT_FAILED");
}
