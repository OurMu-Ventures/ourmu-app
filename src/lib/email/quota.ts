export const EMAIL_QUOTA_CODES = [
  "EMAIL_DAILY_QUOTA_EXCEEDED",
  "EMAIL_MONTHLY_QUOTA_EXCEEDED",
] as const;
export type EmailQuotaCode = (typeof EMAIL_QUOTA_CODES)[number];

// Rate-limit and local-budget deferrals behave like quota holds: the request
// was not accepted and must not exhaust the ordinary retry budget.
export const EMAIL_DEFERRAL_CODES = [
  ...EMAIL_QUOTA_CODES,
  "EMAIL_RATE_LIMITED",
  "EMAIL_BUDGET_DEFERRED",
] as const;
export type EmailDeferralCode = (typeof EMAIL_DEFERRAL_CODES)[number];

// Conservative queued-email budget for the shared free-tier Resend allowance.
// Authentication SMTP and manual sends share the same provider quota, so these
// local counters reserve capacity for them and are reconciled against provider
// quota responses — never presented as a complete account guarantee.
export const QUEUED_EMAIL_DAILY_BUDGET = 80;
export const QUEUED_EMAIL_MONTHLY_BUDGET = 2400;

// Only explicit provider refusals prove that this request was not accepted.
export class EmailQuotaError extends Error {
  constructor(public readonly code: EmailQuotaCode) {
    super(code);
    this.name = "EmailQuotaError";
  }
}

export class EmailRateLimitError extends Error {
  public readonly code = "EMAIL_RATE_LIMITED" as const;
  constructor(
    public readonly retryAfterSec: number = 60,
    public readonly providerCode: string = "rate_limit_exceeded",
  ) {
    super("EMAIL_RATE_LIMITED");
    this.name = "EmailRateLimitError";
  }
}

export class EmailBudgetDeferredError extends Error {
  public readonly code = "EMAIL_BUDGET_DEFERRED" as const;
  constructor(
    public readonly scope: "daily" | "monthly" = "daily",
  ) {
    super("EMAIL_BUDGET_DEFERRED");
    this.name = "EmailBudgetDeferredError";
  }
}

export function isEmailDeferralError(
  error: unknown,
): error is EmailQuotaError | EmailRateLimitError | EmailBudgetDeferredError {
  return (
    error instanceof EmailQuotaError ||
    error instanceof EmailRateLimitError ||
    error instanceof EmailBudgetDeferredError
  );
}

export function deferralCode(
  error: EmailQuotaError | EmailRateLimitError | EmailBudgetDeferredError,
): EmailDeferralCode {
  if (error instanceof EmailQuotaError) return error.code;
  return error.code;
}
export function deferRetryAt(
  code: EmailDeferralCode,
  nowMs = Date.now(),
  retryAfterSec?: number,
): string {
  // Honour Retry-After for rate limits (bounded between 5s and 15min).
  // Budget holds probe daily: the worker does not know the account reset date
  // and local counters alone are not a complete quota guarantee.
  if (code === "EMAIL_RATE_LIMITED") {
    const bounded = Math.min(900, Math.max(5, retryAfterSec ?? 60));
    return new Date(nowMs + bounded * 1000).toISOString();
  }
  return quotaRetryAt(
    code === "EMAIL_BUDGET_DEFERRED" ? "EMAIL_MONTHLY_QUOTA_EXCEEDED" : code,
    nowMs,
  );
}

export function quotaRetryAt(code: EmailQuotaCode, nowMs = Date.now()): string {
  const now = new Date(nowMs);
  // Daily quotas reset at midnight UTC. Leave a minute for the reset to settle.
  // Monthly reset dates depend on the account: probe once per day rather than guess.
  return new Date(
    code === "EMAIL_DAILY_QUOTA_EXCEEDED"
      ? Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() + 1,
          0,
          1,
        )
      : nowMs + 24 * 60 * 60 * 1000,
  ).toISOString();
}
