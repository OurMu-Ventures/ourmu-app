import "server-only";

import { Resend } from "resend";
import { EmailQuotaError, EmailRateLimitError } from "@/lib/email/quota";

const PROVIDER_TIMEOUT_MS = 15_000;

function providerErrorDetail(error: unknown): {
  name: string;
  statusCode: number | null;
  retryAfterSec: number | null;
} {
  const record = (error ?? {}) as Record<string, unknown>;
  const headers = (record.headers ?? {}) as Record<string, unknown>;
  const rawRetry =
    record.retryAfter ??
    record.retry_after ??
    headers["retry-after"] ??
    headers["Retry-After"];
  const parsedRetry =
    typeof rawRetry === "string" && rawRetry.trim().length > 0
      ? Number.parseInt(rawRetry.split(",")[0]?.trim() ?? "", 10)
      : typeof rawRetry === "number"
        ? rawRetry
        : Number.NaN;
  return {
    name: typeof record.name === "string" ? record.name : "unknown",
    statusCode:
      typeof record.statusCode === "number" ? record.statusCode : null,
    retryAfterSec: Number.isFinite(parsedRetry) ? parsedRetry : null,
  };
}

async function withProviderTimeout<T>(
  promise: Promise<T>,
  timeoutMs = PROVIDER_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("EMAIL_PROVIDER_TIMEOUT")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

import {
  renderTransactionalEmail,
  type EmailTemplate,
} from "@/lib/email/template";
import { getServerEnv } from "@/lib/env";
import type { MaturityNoticeInput } from "@/lib/maturity";

export type { EmailTemplate } from "@/lib/email/template";

export async function sendTransactionalEmail(input: {
  to: string;
  cc?: string[];
  bcc?: string[];
  replyTo?: string[];
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
  const { data, error } = await withProviderTimeout(
    resend.emails.send(
      {
        from: env.RESEND_FROM_EMAIL,
        replyTo: input.replyTo?.length ? input.replyTo : "community@ourmu.org",
      to: input.to,
      cc: input.cc?.length ? input.cc : undefined,
      bcc: input.bcc?.length ? input.bcc : undefined,
      subject: content.subject,
        html: content.html,
        text: "text" in content ? content.text : undefined,
        attachments: input.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content as Buffer,
          contentType: "application/pdf",
        })),
      },
      input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
    ),
  );
  if (error) {
    const detail = providerErrorDetail(error);
    // Do not log the recipient or provider message: either may contain
    // personal data. The stable fields are enough to alert and correlate.
    console.error("email.transactional.delivery_failed", {
      template: input.template,
      provider: "resend",
      code: detail.name,
      statusCode: detail.statusCode,
    });
    if (error.name === "daily_quota_exceeded")
      throw new EmailQuotaError("EMAIL_DAILY_QUOTA_EXCEEDED");
    if (error.name === "monthly_quota_exceeded")
      throw new EmailQuotaError("EMAIL_MONTHLY_QUOTA_EXCEEDED");
    // Rate limits honour Retry-After and defer without exhausting retries.
    if (
      error.name === "rate_limit_exceeded" ||
      detail.statusCode === 429 ||
      detail.statusCode === 503
    )
      throw new EmailRateLimitError(
        detail.retryAfterSec ?? 60,
        detail.name,
      );
    // Preserve the provider error code for diagnosis without leaking
    // recipient data into the job record.
    const code = String(detail.name || "unknown")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .slice(0, 40);
    throw new Error(`EMAIL_DELIVERY_FAILED:${code}`);
  }
  return data?.id ?? null;
}
