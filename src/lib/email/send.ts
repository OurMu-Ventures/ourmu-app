import "server-only";

import { Resend } from "resend";

import {
  renderTransactionalEmail,
  type EmailTemplate,
} from "@/lib/email/template";
import { getServerEnv } from "@/lib/env";

export type { EmailTemplate } from "@/lib/email/template";

export async function sendTransactionalEmail(input: {
  to: string;
  template: EmailTemplate;
  actionUrl?: string;
  detail?: string;
}) {
  const env = getServerEnv();
  if (!env.RESEND_API_KEY) throw new Error("EMAIL_PROVIDER_NOT_CONFIGURED");
  const resend = new Resend(env.RESEND_API_KEY);
  const content = renderTransactionalEmail(input);
  const { error } = await resend.emails.send({
    from: env.RESEND_FROM_EMAIL,
    replyTo: "community@ourmu.org",
    to: input.to,
    subject: content.subject,
    html: content.html,
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
