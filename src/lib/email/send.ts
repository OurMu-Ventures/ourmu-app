import "server-only";

import { Resend } from "resend";
import { EmailQuotaError, EmailRateLimitError } from "@/lib/email/quota";

const PROVIDER_TIMEOUT_MS = 15_000;

function providerErrorDetail(
  error: unknown,
  responseHeaders?: Headers | Record<string, string> | null,
): {
  name: string;
  statusCode: number | null;
  retryAfterSec: number | null;
} {
  const record = (error ?? {}) as Record<string, unknown>;
  const headers = responseHeaders ?? record.headers ?? {};
  const retryHeader =
    headers instanceof Headers
      ? headers.get("retry-after")
      : ((headers as Record<string, unknown>)["retry-after"] ??
        (headers as Record<string, unknown>)["Retry-After"]);
  const rawRetry = record.retryAfter ?? record.retry_after ?? retryHeader;
  const numericRetry =
    typeof rawRetry === "number"
      ? rawRetry
      : typeof rawRetry === "string" && /^\d+(\.\d+)?$/.test(rawRetry.trim())
        ? Number(rawRetry)
        : NaN;
  const parsedRetry = Number.isFinite(numericRetry)
    ? numericRetry
    : typeof rawRetry === "string"
      ? Math.max(0, (Date.parse(rawRetry) - Date.now()) / 1000)
      : NaN;
  return {
    name: typeof record.name === "string" ? record.name : "unknown",
    statusCode:
      typeof record.statusCode === "number" ? record.statusCode : null,
    retryAfterSec: Number.isFinite(parsedRetry) ? parsedRetry : null,
  };
}

async function withProviderTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal,
  timeoutMs = PROVIDER_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, controller.signal])
    : controller.signal;
  signal.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error("EMAIL_PROVIDER_TIMEOUT");
          controller.abort(error);
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
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
  signal?: AbortSignal;
}): Promise<string | null> {
  const env = getServerEnv();
  if (!env.RESEND_API_KEY) throw new Error("EMAIL_PROVIDER_NOT_CONFIGURED");
  const resend = new Resend(env.RESEND_API_KEY);
  const content = renderTransactionalEmail(input);
  const { data, error, headers } = await withProviderTimeout(
    (signal) =>
      resend.emails.send(
        {
          from: env.RESEND_FROM_EMAIL,
          replyTo: input.replyTo?.length
            ? input.replyTo
            : "community@ourmu.org",
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
        // The installed SDK forwards request options to fetch. A variable allows
        // its narrower public type while retaining the standard RequestInit signal.
        { idempotencyKey: input.idempotencyKey, signal } as Parameters<
          typeof resend.emails.send
        >[1] & { signal: AbortSignal },
      ),
    input.signal,
  );
  input.signal?.throwIfAborted();
  if (error) {
    const detail = providerErrorDetail(error, headers);
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
    if (error.name === "rate_limit_exceeded" || detail.statusCode === 429)
      throw new EmailRateLimitError(detail.retryAfterSec ?? 60, detail.name);
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
