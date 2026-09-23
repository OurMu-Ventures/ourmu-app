export type EmailTemplate =
  | "application_invitation"
  | "application_approved"
  | "application_rejected"
  | "reservation_created"
  | "investment_activated"
  | "agreement_ready"
  | "account_email_verification"
  | "maturity_notice"
  | "maturity_choice_confirmed"
  | "maturity_fulfilled"
  | "magic_link";

const subjects: Record<EmailTemplate, string> = {
  application_invitation: "Your private OURMU application link",
  application_approved: "Your OURMU application has been approved",
  application_rejected: "An update on your OURMU application",
  reservation_created: "Your OURMU investment reservation",
  investment_activated: "Your OURMU investment is active",
  agreement_ready: "Your OURMU agreement is ready",
  account_email_verification: "Verify your additional OURMU email",
  maturity_notice:
    "Your OURMU investment has matured — choose what happens next",
  maturity_choice_confirmed: "Your maturity choice has been recorded",
  maturity_fulfilled: "Your maturity instruction has been fulfilled",
  magic_link: "Your sign-in link",
};

export function renderTransactionalEmail(input: {
  template: EmailTemplate;
  actionUrl?: string;
  detail?: string;
}) {
  if (input.template === "magic_link") {
    // Primary sign-in emails are sent by signInWithOtp using Supabase's
    // default magic-link template. Keep this alias-only Resend output in
    // lockstep with that subject and markup so both contacts see the same UI.
    const actionUrl = escapeHtml(input.actionUrl ?? "");
    return {
      subject: subjects.magic_link,
      html: `<h2>Your sign-in link</h2><p>Follow the link below to sign in. This link expires one hour after it was requested and works once.</p><p><a href="${actionUrl}">Sign in</a></p>`,
    };
  }

  const action = input.actionUrl
    ? `<p><a href="${escapeHtml(input.actionUrl)}" style="background:#d7a747;color:#102923;padding:12px 18px;border-radius:999px;text-decoration:none;display:inline-block">Continue securely</a></p>`
    : "";
  return {
    subject: subjects[input.template],
    html: `<div style="font-family:Arial,sans-serif;color:#102923;max-width:600px"><h1 style="font-size:24px">OURMU</h1><p>${escapeHtml(input.detail ?? subjects[input.template])}</p>${action}<p style="color:#5d6c67;font-size:13px">Never forward private application or sign-in links. OURMU will never ask for your NIN or bank details by email.</p></div>`,
  };
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
