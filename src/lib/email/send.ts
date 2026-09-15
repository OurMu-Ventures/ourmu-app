import "server-only";

import { Resend } from "resend";

import { getServerEnv } from "@/lib/env";

export type EmailTemplate =
  | "application_invitation"
  | "application_approved"
  | "application_rejected"
  | "reservation_created"
  | "investment_activated"
  | "agreement_ready";

const subjects: Record<EmailTemplate, string> = {
  application_invitation: "Your private OURMU application link",
  application_approved: "Your OURMU application has been approved",
  application_rejected: "An update on your OURMU application",
  reservation_created: "Your OURMU investment reservation",
  investment_activated: "Your OURMU investment is active",
  agreement_ready: "Your OURMU agreement is ready",
};

export async function sendTransactionalEmail(input: {
  to: string;
  template: EmailTemplate;
  actionUrl?: string;
  detail?: string;
}) {
  const env = getServerEnv();
  if (!env.RESEND_API_KEY) throw new Error("EMAIL_PROVIDER_NOT_CONFIGURED");
  const resend = new Resend(env.RESEND_API_KEY);
  const action = input.actionUrl
    ? `<p><a href="${escapeHtml(input.actionUrl)}" style="background:#d7a747;color:#102923;padding:12px 18px;border-radius:999px;text-decoration:none;display:inline-block">Continue securely</a></p>`
    : "";
  const { error } = await resend.emails.send({
    from: env.RESEND_FROM_EMAIL,
    replyTo: "community@ourmu.org",
    to: input.to,
    subject: subjects[input.template],
    html: `<div style="font-family:Arial,sans-serif;color:#102923;max-width:600px"><h1 style="font-size:24px">OURMU</h1><p>${escapeHtml(input.detail ?? subjects[input.template])}</p>${action}<p style="color:#5d6c67;font-size:13px">Never forward private application or sign-in links. OURMU will never ask for your NIN or bank details by email.</p></div>`,
  });
  if (error) {
    // Do not log the recipient or provider message: either may contain
    // personal data. The stable fields are enough to alert and correlate.
    console.error("email.transactional.delivery_failed", {
      template: input.template,
      provider: "resend",
      code: error.name ?? "unknown",
    });
    throw new Error("EMAIL_DELIVERY_FAILED");
  }
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        char
      ]!,
  );
}
