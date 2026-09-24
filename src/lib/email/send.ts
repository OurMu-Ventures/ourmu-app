import "server-only";

import { Resend } from "resend";

import {
  renderTransactionalEmail,
  type EmailTemplate,
} from "@/lib/email/template";
import { getServerEnv } from "@/lib/env";
import type { MaturityNoticeInput } from "@/lib/maturity";

export type { EmailTemplate } from "@/lib/email/template";

export async function sendTransactionalEmail(input: {
  to: string;
  template: EmailTemplate;
  actionUrl?: string;
  detail?: string;
  maturityNotice?: MaturityNoticeInput;
  activationReceipt?: import("@/lib/email/template").ActivationReceiptInput;
  attachments?: { filename: string; content: Buffer | Uint8Array | string }[];
  idempotencyKey?: string;
}): Promise<string | null> {
  const env = getServerEnv();
  if (!env.RESEND_API_KEY) throw new Error("EMAIL_PROVIDER_NOT_CONFIGURED");
  const resend = new Resend(env.RESEND_API_KEY);
  const content = renderTransactionalEmail(input);
  const { data, error } = await resend.emails.send({
    from: env.RESEND_FROM_EMAIL,
    replyTo: "community@ourmu.org",
    to: input.to,
    subject: content.subject,
    html: content.html,
    text: "text" in content ? content.text : undefined,
    attachments: input.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content as Buffer,
      contentType: "application/pdf",
    })),
  }, input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined);
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
  return data?.id ?? null;
}
