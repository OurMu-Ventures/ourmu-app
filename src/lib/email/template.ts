import { ugx } from "@/lib/format";
import {
  MATURITY_CHOICES,
  maturitySplits,
  type MaturityNoticeInput,
} from "@/lib/maturity";

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
  | "maturity_action_needed"
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
  maturity_action_needed: "Action needed on your matured investment",
  maturity_fulfilled: "Your maturity instruction has been fulfilled",
  magic_link: "Your sign-in link",
};

export type ActivationReceiptInput = {
  partnerName?: string;
  amountUgx?: string;
  receiptNumber?: string;
  isReinvestment?: boolean;
  originalInvestmentRef?: string | null;
  actionUrl?: string;
};

export function renderTransactionalEmail(input: {
  template: EmailTemplate;
  actionUrl?: string;
  detail?: string;
  maturityNotice?: MaturityNoticeInput;
  activationReceipt?: ActivationReceiptInput;
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

  if (input.template === "investment_activated") {
    return renderInvestmentActivatedEmail(input.activationReceipt, input);
  }

  if (input.template === "maturity_notice" && input.maturityNotice) {
    return renderMaturityNoticeEmail(
      input.maturityNotice,
      input.actionUrl,
      input.detail,
    );
  }

  const action = input.actionUrl
    ? `<p><a href="${escapeHtml(input.actionUrl)}" style="background:#d7a747;color:#102923;padding:12px 18px;border-radius:999px;text-decoration:none;display:inline-block">Continue securely</a></p>`
    : "";
  return {
    subject: subjects[input.template],
    html: `<div style="font-family:Arial,sans-serif;color:#102923;max-width:600px"><h1 style="font-size:24px">OURMU</h1><p>${escapeHtml(input.detail ?? subjects[input.template])}</p>${action}<p style="color:#5d6c67;font-size:13px">Never forward private application or sign-in links. OURMU will never ask for your NIN or bank details by email.</p></div>`,
  };
}

function renderMaturityNoticeEmail(
  notice: MaturityNoticeInput,
  actionUrl?: string,
  detail?: string,
) {
  const figures = [
    ["Principal invested", ugx(notice.principalUgx)],
    [
      `Projected ROI (${notice.projectedPercent}%)`,
      ugx(notice.projectedReturnUgx),
    ],
    ["Projected total value", ugx(notice.projectedValueUgx)],
  ];
  const standing = figures
    .map(
      ([label, value]) =>
        `<p style="margin:0 0 14px;font-size:14px;line-height:1.5;color:#58706b">${escapeHtml(label)}<br><strong style="font-size:20px;color:#18332f">${escapeHtml(value)}</strong></p>`,
    )
    .join("");
  const plans = MATURITY_CHOICES.map((option) => {
    const split = maturitySplits(
      notice.principalUgx,
      notice.projectedReturnUgx,
      option.value,
    );
    const amounts = [
      split.payoutUgx > 0 ? `Projected payout: ${ugx(split.payoutUgx)}` : null,
      split.reinvestUgx > 0
        ? `Projected reinvestment: ${ugx(split.reinvestUgx)}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return `<div style="border-top:1px solid #dce7e4;padding:16px 0"><p style="margin:0 0 5px;font-size:16px;line-height:1.5;font-weight:700;color:#18332f">${escapeHtml(option.label)}</p><p style="margin:0 0 5px;font-size:15px;line-height:1.6">${escapeHtml(option.description)}</p><p style="margin:0;font-size:13px;line-height:1.6;color:#58706b">${escapeHtml(amounts)}</p></div>`;
  }).join("");
  const action = actionUrl
    ? `<p style="margin:0 0 28px"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#176b5b;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:10px">Choose your payout plan</a></p>`
    : "";
  return {
    subject: subjects.maturity_notice,
    html: `<div style="background:#f4f7f6;padding:32px 16px;font-family:Arial,sans-serif;color:#18332f"><div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:36px"><p style="margin:0 0 24px;color:#2f766b;font-size:13px;font-weight:700;letter-spacing:.12em">OURMU VENTURES</p><h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;color:#18332f">Hello Partner 👋</h1><p style="margin:0 0 24px;font-size:17px;line-height:1.6">Your OURMU investment matured on ${escapeHtml(notice.maturityDate)}. Here is your investment standing and the payout plan you can choose.</p><h2 style="margin:0 0 14px;font-size:18px;color:#18332f">Your investment standing</h2><div style="background:#f4f7f6;border-radius:12px;padding:20px 22px;margin:0 0 28px">${standing}</div><h2 style="margin:0 0 4px;font-size:18px;color:#18332f">The payout plan</h2>${plans}<p style="margin:8px 0 24px;font-size:15px;line-height:1.6">Payouts are scheduled for <strong>${escapeHtml(notice.payoutDate)}</strong>. The amount actually paid follows the return recorded by the fund, which may differ from this projection.</p>${action}<hr style="border:0;border-top:1px solid #dce7e4;margin:0 0 22px"><p style="margin:0;color:#58706b;font-size:13px;line-height:1.6">Need help? Contact <a href="mailto:community@ourmu.org" style="color:#176b5b">community@ourmu.org</a>.</p></div></div>`,
    text: detail
      ? `${detail}${actionUrl ? `\n\nChoose your payout plan: ${actionUrl}` : ""}`
      : undefined,
  };
}

function renderInvestmentActivatedEmail(
  receipt: ActivationReceiptInput | undefined,
  fallback: { actionUrl?: string; detail?: string },
) {
  const actionUrl = receipt?.actionUrl ?? fallback.actionUrl;
  const name = receipt?.partnerName?.trim() || "Partner";
  const amount = receipt?.amountUgx?.trim();
  const receiptNo = receipt?.receiptNumber?.trim();
  const isReinvest = receipt?.isReinvestment === true;
  const heading = isReinvest ? "Your reinvestment is active" : "Your investment is active";
  const intro = isReinvest
    ? `Your reinvestment${amount ? ` of ${escapeHtml(amount)}` : ""}${receipt?.originalInvestmentRef ? ` from matured investment ${escapeHtml(receipt.originalInvestmentRef)}` : ""} is now active. The amount was transferred from your matured investment.`
    : `Your investment${amount ? ` of ${escapeHtml(amount)}` : ""} is now active.`;
  const receiptLine = receiptNo
    ? `Your ${isReinvest ? "Reinvestment" : "Investment"} Receipt <strong>${escapeHtml(receiptNo)}</strong> is attached to this email and available from your investment page.`
    : `Your ${isReinvest ? "reinvestment" : "investment"} receipt is being prepared and will be available from your investment page.`;
  const action = actionUrl
    ? `<p style="margin:0 0 28px"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#176b5b;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:10px">View investment</a></p>`
    : "";
  const detailRows = [
    amount ? `<p style="margin:0 0 10px;font-size:14px;color:#58706b">Amount<br><strong style="font-size:20px;color:#18332f">${escapeHtml(amount)}</strong></p>` : "",
    receiptNo ? `<p style="margin:0 0 10px;font-size:14px;color:#58706b">Receipt number<br><strong style="font-size:16px;color:#18332f">${escapeHtml(receiptNo)}</strong></p>` : "",
  ].join("");
  return {
    subject: subjects.investment_activated,
    html: `<div style="background:#f4f7f6;padding:32px 16px;font-family:'Open Sans',Arial,sans-serif;color:#18332f"><div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:36px"><p style="margin:0 0 24px;color:#2f766b;font-size:13px;font-weight:700;letter-spacing:.12em">OURMU VENTURES</p><h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;color:#18332f">Hello ${escapeHtml(name)}</h1><p style="margin:0 0 16px;font-size:17px;line-height:1.6">${heading}. ${intro}</p><p style="margin:0 0 24px;font-size:15px;line-height:1.6">${receiptLine}</p>${detailRows ? `<div style="background:#f4f7f6;border-radius:12px;padding:20px 22px;margin:0 0 28px">${detailRows}</div>` : ""}${action}<hr style="border:0;border-top:1px solid #dce7e4;margin:0 0 22px"><p style="margin:0;color:#58706b;font-size:13px;line-height:1.6">Need help? Contact <a href="mailto:community@ourmu.org" style="color:#176b5b">community@ourmu.org</a>. Never forward private links. OURMU will never ask for your NIN or bank details by email.</p></div></div>`,
    text:
      `Hello ${name}, ${heading}. ` +
      (fallback.detail ? `${fallback.detail} ` : "") +
      (receiptNo ? `Receipt ${receiptNo}. ` : "") +
      (actionUrl ? `View your investment: ${actionUrl}` : ""),
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
