// Scanner-resistant magic-link helpers.
//
// The email link points to `/auth/start#confirmation_url=...`. The fragment is
// never sent to the server, so ordinary link scanners cannot redeem or log the
// token. The start page reads the fragment only in the browser, clears it
// immediately, and POSTs the extracted payload to `/auth/confirm` same-origin.
//
// These helpers are pure and shared by the client page and the server route so
// both sides enforce the same allowlist.

import { sanitizeNextPath } from "@/lib/redirect";

export const AUTH_START_PATH = "/auth/start";
export const AUTH_CONFIRM_PATH = "/auth/confirm";

// Only magic-link verifications may be redeemed through this flow. Anything
// else (recovery, invite, email-change, ...) is rejected to avoid repurposing
// a token issued for a different purpose.
const ALLOWED_VERIFY_TYPES = new Set(["magiclink"]);

// Supabase Auth verify endpoints. The email `ConfirmationURL` points here with
// `?token=...&type=...&redirect_to=...`.
const SUPABASE_VERIFY_PATHS = new Set(["/auth/v1/verify", "/verify"]);

export type ConfirmPayload =
  | { kind: "code"; code: string; next: string | null }
  | { kind: "token"; token_hash: string; type: string; next: string | null };

export type ConfirmationUrlDecision =
  | { kind: "confirm"; payload: ConfirmPayload }
  | { kind: "supabase"; supabaseUrl: string; next: string | null }
  | { kind: "invalid"; reason: string };

export function buildAuthStartUrl(
  appOrigin: string,
  confirmationUrl: string,
): string {
  const origin = appOrigin.replace(/\/$/, "");
  return `${origin}${AUTH_START_PATH}#confirmation_url=${encodeURIComponent(confirmationUrl)}`;
}

/**
 * Extract the `confirmation_url` value from a location hash. Accepts with or
 * without a leading `#`. Returns null when absent or empty.
 */
export function parseAuthStartFragment(hash: string | null | undefined): string | null {
  if (!hash) return null;
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!trimmed) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(trimmed);
  } catch {
    return null;
  }
  const value = params.get("confirmation_url");
  if (!value) return null;
  const decoded = value.trim();
  return decoded.length > 0 ? decoded : null;
}

function getOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isHttpOrigin(origin: string, allowInsecure: boolean): boolean {
  if (origin.startsWith("https://")) return true;
  if (allowInsecure && origin.startsWith("http://")) {
    try {
      const host = new URL(origin).hostname;
      return (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "[::1]" ||
        host.endsWith(".localhost")
      );
    } catch {
      return false;
    }
  }
  return false;
}

function extractNextFromConfirmUrl(url: URL): { next: string | null; invalid: boolean } {
  // `next` may arrive directly or nested inside `redirect_to` (Supabase wraps
  // our emailRedirectTo there). Prefer an explicit `next`, otherwise unwrap
  // one level of `redirect_to`.
  const direct = url.searchParams.get("next");
  const nested = url.searchParams.get("redirect_to");
  let raw: string | null = direct ?? null;
  if (!raw && nested) {
    try {
      const inner = new URL(nested, url.origin);
      raw = inner.searchParams.get("next");
    } catch {
      return { next: null, invalid: true };
    }
  }
  if (raw == null || raw === "") return { next: null, invalid: false };
  const safe = sanitizeNextPath(raw);
  if (safe == null) return { next: null, invalid: true };
  return { next: safe, invalid: false };
}

/**
 * Validate a confirmation URL extracted from the fragment.
 *
 * Accepted:
 * - Same-origin `/auth/confirm` URLs carrying `code` or `token_hash+type`, plus
 *   an optional safe `next` (direct or nested in `redirect_to`).
 * - Supabase `/auth/v1/verify` URLs whose `redirect_to` is itself a valid
 *   same-origin `/auth/confirm` URL. The client navigates to these deliberately;
 *   the token never touches our logs via the start page.
 *
 * Everything else (unexpected host, path, verification type, redirect target)
 * is rejected as invalid.
 */
export function extractConfirmPayload(
  confirmationUrl: string,
  opts: { appOrigin: string; supabaseOrigin?: string | null },
): ConfirmationUrlDecision {
  let url: URL;
  try {
    url = new URL(confirmationUrl);
  } catch {
    return { kind: "invalid", reason: "malformed_url" };
  }

  const appOrigin = getOrigin(opts.appOrigin);
  if (!appOrigin) return { kind: "invalid", reason: "misconfigured_app_origin" };
  const allowInsecure =
    appOrigin.startsWith("http://localhost") ||
    appOrigin.startsWith("http://127.0.0.1");
  if (!isHttpOrigin(url.origin, allowInsecure)) {
    return { kind: "invalid", reason: "unexpected_protocol" };
  }

  // Same-origin confirm URL: extract a POSTable payload.
  if (url.origin === appOrigin && url.pathname === AUTH_CONFIRM_PATH) {
    const code = url.searchParams.get("code");
    const tokenHash = url.searchParams.get("token_hash");
    const type = url.searchParams.get("type");
    const { next, invalid } = extractNextFromConfirmUrl(url);
    if (invalid) return { kind: "invalid", reason: "unsafe_redirect_target" };

    if (code && !tokenHash) {
      if (code.length > 2000) return { kind: "invalid", reason: "oversized_code" };
      return { kind: "confirm", payload: { kind: "code", code, next } };
    }
    if (tokenHash && !code) {
      if (tokenHash.length > 2000) return { kind: "invalid", reason: "oversized_token" };
      if (!type || !ALLOWED_VERIFY_TYPES.has(type)) {
        return { kind: "invalid", reason: "unexpected_verification_type" };
      }
      return {
        kind: "confirm",
        payload: { kind: "token", token_hash: tokenHash, type, next },
      };
    }
    return { kind: "invalid", reason: "missing_credential" };
  }

  // Supabase verify URL: validate and hand back for deliberate navigation.
  const supabaseOrigin = opts.supabaseOrigin ? getOrigin(opts.supabaseOrigin) : null;
  if (
    (supabaseOrigin == null || url.origin === supabaseOrigin) &&
    SUPABASE_VERIFY_PATHS.has(url.pathname)
  ) {
    const type = url.searchParams.get("type");
    if (!type || !ALLOWED_VERIFY_TYPES.has(type)) {
      return { kind: "invalid", reason: "unexpected_verification_type" };
    }
    const redirectTo = url.searchParams.get("redirect_to");
    if (!redirectTo) return { kind: "invalid", reason: "missing_redirect_to" };
    let inner: URL;
    try {
      inner = new URL(redirectTo);
    } catch {
      return { kind: "invalid", reason: "malformed_redirect_to" };
    }
    if (inner.origin !== appOrigin || inner.pathname !== AUTH_CONFIRM_PATH) {
      return { kind: "invalid", reason: "unexpected_redirect_host_or_path" };
    }
    const { next, invalid } = extractNextFromConfirmUrl(inner);
    if (invalid) return { kind: "invalid", reason: "unsafe_redirect_target" };
    return { kind: "supabase", supabaseUrl: url.toString(), next };
  }

  if (url.origin !== appOrigin) return { kind: "invalid", reason: "unexpected_host" };
  return { kind: "invalid", reason: "unexpected_path" };
}

const INVALID_OR_EXPIRED_PATTERNS = [
  "expired",
  "invalid",
  "already used",
  "already been used",
  "not found",
  "bad request",
  "token_hash not found",
  "otp_expired",
  "otp_disabled",
];

/**
 * Supabase does not reliably distinguish "already used" from "expired", so the
 * UI intentionally combines the two. Matches error messages/codes from
 * `verifyOtp` / `exchangeCodeForSession` without ever including token values.
 */
export function isInvalidOrExpiredError(error: unknown): boolean {
  if (!error) return false;
  const candidates: string[] = [];
  if (typeof error === "string") {
    candidates.push(error);
  } else if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "code", "error_code", "msg"]) {
      const value = record[key];
      if (typeof value === "string") candidates.push(value);
    }
    const nested = record["error"];
    if (typeof nested === "string") candidates.push(nested);
    else if (nested && typeof nested === "object") {
      const inner = nested as Record<string, unknown>;
      if (typeof inner["message"] === "string") candidates.push(inner["message"]);
      if (typeof inner["code"] === "string") candidates.push(inner["code"]);
    }
  }
  if (candidates.length === 0) return false;
  const haystack = candidates.join(" ").toLowerCase();
  return INVALID_OR_EXPIRED_PATTERNS.some((pattern) => haystack.includes(pattern));
}

export type AuthVerificationOutcome =
  | "already_authenticated"
  | "redeemed"
  | "invalid_or_expired"
  | "disabled_access"
  | "no_profile";

/** Safe, non-enumerating outcome logging. Never pass tokens, URLs, or emails. */
export function logAuthVerificationOutcome(outcome: AuthVerificationOutcome): void {
  console.info("auth.verify.outcome", { outcome });
}
