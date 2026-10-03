export const EMAIL_QUOTA_CODES = [
  "EMAIL_DAILY_QUOTA_EXCEEDED",
  "EMAIL_MONTHLY_QUOTA_EXCEEDED",
] as const;
export type EmailQuotaCode = (typeof EMAIL_QUOTA_CODES)[number];

// Only explicit provider refusals prove that this request was not accepted.
export class EmailQuotaError extends Error {
  constructor(public readonly code: EmailQuotaCode) {
    super(code);
    this.name = "EmailQuotaError";
  }
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
