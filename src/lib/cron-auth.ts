import "server-only";

import { z } from "zod";

import { safeSecretEqual } from "@/lib/security/crypto";

export const MIN_CRON_SECRET_LENGTH = 32;
export const MAX_BEARER_TOKEN_LENGTH = 512;
export type CronSecretName = "CRON_SECRET" | "JOB_TRIGGER_SECRET";
export type CronCaller = "cron_secret" | "job_trigger_secret";
export type WorkerTrigger =
  "pg_cron" | "github" | "vercel_cron" | "manual" | "unknown";

// Read directly, never through getServerEnv(): an unset or short optional
// JOB_TRIGGER_SECRET must not throw, and authorizing a cron call must not
// depend on unrelated variables.
const cronSecretSchema = z
  .string()
  .min(MIN_CRON_SECRET_LENGTH)
  .max(MAX_BEARER_TOKEN_LENGTH);

/** The configured secret, or null when unset, empty, shorter than 32 or longer than 512. Never throws. */
export function configuredCronSecret(name: CronSecretName): string | null {
  const parsed = cronSecretSchema.safeParse(process.env[name]);
  return parsed.success ? parsed.data : null;
}

/** Token from `Authorization: Bearer <token>` (scheme case-insensitive, one token, no inner whitespace,
 *  at most 512 chars); null when the header is missing, not Bearer, or the token is empty. */
export function bearerToken(request: Request): string | null {
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(
    request.headers.get("authorization") ?? "",
  );
  if (!match || match[1].length > MAX_BEARER_TOKEN_LENGTH) return null;
  return match[1];
}

/** Compares the token only against configured secrets in `accepted`; returns which one matched. */
export function authorizeCronRequest(
  request: Request,
  accepted: readonly CronSecretName[],
): CronCaller | null {
  const token = bearerToken(request);
  if (token === null) return null;
  for (const name of accepted) {
    const secret = configuredCronSecret(name);
    if (secret !== null && safeSecretEqual(token, secret))
      return name === "CRON_SECRET" ? "cron_secret" : "job_trigger_secret";
  }
  return null;
}

/** job_trigger_secret -> "pg_cron" (always); else user-agent /^vercel-cron\//i -> "vercel_cron";
 *  else header x-ourmu-trigger trimmed+lowercased "github" | "manual"; else "unknown". */
export function identifyTrigger(
  request: Request,
  caller: CronCaller,
): WorkerTrigger {
  // Only the dispatcher holds JOB_TRIGGER_SECRET, and CRON_SECRET callers can
  // never claim pg_cron. The header is informational.
  if (caller === "job_trigger_secret") return "pg_cron";
  if (/^vercel-cron\//i.test(request.headers.get("user-agent") ?? ""))
    return "vercel_cron";
  const declared = request.headers.get("x-ourmu-trigger")?.trim().toLowerCase();
  return declared === "github" || declared === "manual" ? declared : "unknown";
}

/** For "pg_cron" only: x-ourmu-dispatch-id parsed with z.uuid(); otherwise or invalid -> null. */
export function dispatchIdFrom(
  request: Request,
  trigger: WorkerTrigger,
): string | null {
  if (trigger !== "pg_cron") return null;
  const parsed = z.uuid().safeParse(request.headers.get("x-ourmu-dispatch-id"));
  return parsed.success ? parsed.data : null;
}
