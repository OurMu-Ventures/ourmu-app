import "server-only";

import { buildAgreementPdf } from "@/lib/agreements/pdf";
import { sendTransactionalEmail, type EmailTemplate } from "@/lib/email/send";
import { createAdminClient } from "@/lib/supabase/admin";

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
          job.entity_type,
          job.entity_id,
          job.payload as {
            template?: EmailTemplate;
            to?: string;
            actionUrl?: string;
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
  entityType: string,
  entityId: string,
  payload: { template?: EmailTemplate; to?: string; actionUrl?: string },
) {
  const admin = createAdminClient();
  let to = payload.to;
  if (!to && entityType === "investment") {
    const { data: investment } = await admin
      .from("investments")
      .select("investor_id")
      .eq("id", entityId)
      .single();
    const { data: profile } = investment?.investor_id
      ? await admin
          .from("profiles")
          .select("email")
          .eq("id", investment.investor_id)
          .single()
      : { data: null };
    to = profile?.email;
  }
  if (!to || !payload.template) throw new Error("EMAIL_JOB_INVALID");
  await sendTransactionalEmail({
    to,
    template: payload.template,
    actionUrl: payload.actionUrl,
  });
}
