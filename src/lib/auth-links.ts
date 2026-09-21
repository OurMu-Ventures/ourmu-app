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

// Verification types redeemable through this flow. `email` is the documented
// native Supabase token-hash type (`signup`/`magiclink` are deprecated upstream
// and current docs specify `type=email` for TokenHash verification).
// `magiclink` is retained only for alias links issued via
// `admin.generateLink({ type: "magiclink" })`, whose hashes must be verified
// with the same type. Anything else (recovery, invite, email-change, ...)
// is rejected to avoid repurposing a token issued for a different purpose.
export const NATIVE_VERIFY_TYPE = "email";
export const ALIAS_VERIFY_TYPE = "magiclink";
const ALLOWED_VERIFY_TYPES = new Set<string>([NATIVE_VERIFY_TYPE, ALIAS_VERIFY_TYPE]);

export type VerifyOtpType = typeof NATIVE_VERIFY_TYPE | typeof ALIAS_VERIFY_TYPE;

/** Resolve a raw `type` value: missing defaults to the legacy alias type. */
export function resolveVerifyType(raw: string | null | undefined): VerifyOtpType | null {
  if (raw == null || raw === "") return ALIAS_VERIFY_TYPE;
  if (raw === NATIVE_VERIFY_TYPE || raw === ALIAS_VERIFY_TYPE) return raw;
  return null;
}

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
 *
 * NOTE: this intentionally reads only the single `confirmation_url` field. A
 * real Supabase `ConfirmationURL` contains its own `&type=...&redirect_to=...`,
 * so embedding it unencoded (e.g.
 * `#confirmation_url={{ .ConfirmationURL }}`) truncates at the first `&` and
 * fails validation. The supported production template uses discrete fragment
 * fields instead (see PRODUCTION_MAGIC_LINK_TEMPLATE_HREF); this helper is
 * kept for the alias/Resend path where buildAuthStartUrl() percent-encodes
 * the complete nested URL.
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
  // Fails closed: accepted only when a configured, valid Supabase origin
  // exists and matches exactly. A missing or malformed configured origin
  // must never accept an arbitrary HTTPS origin (open redirect otherwise).
  const supabaseOrigin = opts.supabaseOrigin ? getOrigin(opts.supabaseOrigin) : null;
  if (
    supabaseOrigin != null &&
    url.origin === supabaseOrigin &&
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

// ---------------------------------------------------------------------------
// Production Supabase email template (discrete fragment fields).
//
// Supabase Go templates render variables unencoded, so wrapping the whole
// `{{ .ConfirmationURL }}` inside a fragment
// (`#confirmation_url={{ .ConfirmationURL }}`) truncates at the first `&`
// (`?token=abc` survives; `&type=` and `&redirect_to=` are parsed as sibling
// fragment fields). The supported production representation therefore passes
// the credential as discrete fragment fields:
//
//   {{ .SiteURL }}/auth/start#token_hash={{ .TokenHash }}&type=email&redirect_to={{ .RedirectTo }}
//
// where `{{ .RedirectTo }}` is the `emailRedirectTo` passed to
// `signInWithOtp` (our same-origin `/auth/confirm?next=...` URL, which itself
// contains no raw `&`). `email` is the documented native Supabase TokenHash
// type; the start page parses these fields without any nested-URL decoding
// step, so nothing can be truncated.
export const PRODUCTION_MAGIC_LINK_TEMPLATE_HREF =
  "{{ .SiteURL }}/auth/start#token_hash={{ .TokenHash }}&type=email&redirect_to={{ .RedirectTo }}";

/**
 * Render the production template with literal values (used by tests and
 * rollout verification to prove the exact dashboard href parses correctly).
 */
export function renderProductionMagicLinkHref(input: {
  siteUrl: string;
  tokenHash: string;
  redirectTo: string;
}): string {
  const site = input.siteUrl.replace(/\/$/, "");
  return `${site}/auth/start#token_hash=${input.tokenHash}&type=email&redirect_to=${input.redirectTo}`;
}

function parseFragmentParams(
  hash: string | null | undefined,
): URLSearchParams | null {
  if (!hash) return null;
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!trimmed) return null;
  try {
    return new URLSearchParams(trimmed);
  } catch {
    return null;
  }
}

function resolveNextFromRaw(
  direct: string | null,
  redirectTo: string | null,
  appOrigin: string,
): { next: string | null; invalid: boolean } {
  if (direct != null && direct !== "") {
    const safe = sanitizeNextPath(direct);
    if (safe == null) return { next: null, invalid: true };
    return { next: safe, invalid: false };
  }
  if (redirectTo != null && redirectTo !== "") {
    // `redirect_to` is our same-origin `/auth/confirm?next=...` URL. Validate
    // its origin/path before trusting the nested `next`.
    let inner: URL;
    try {
      inner = new URL(redirectTo, appOrigin);
    } catch {
      return { next: null, invalid: true };
    }
    if (inner.origin !== appOrigin || inner.pathname !== AUTH_CONFIRM_PATH) {
      return { next: null, invalid: true };
    }
    const nested = inner.searchParams.get("next");
    if (nested == null || nested === "") return { next: null, invalid: false };
    const safe = sanitizeNextPath(nested);
    if (safe == null) return { next: null, invalid: true };
    return { next: safe, invalid: false };
  }
  return { next: null, invalid: false };
}

export type StartFragmentDecision =
  | { kind: "confirm"; payload: ConfirmPayload }
  | { kind: "supabase"; supabaseUrl: string; next: string | null }
  | { kind: "invalid"; reason: string };

/**
 * Parse an `/auth/start` location hash in either supported representation:
 * - Encoded nested URL: `#confirmation_url=<percent-encoded /auth/confirm or
 *   Supabase verify URL>` (alias/Resend path via buildAuthStartUrl()).
 * - Discrete fields: `#token_hash=...&type=email[&next=...]` or
 *   `#token_hash=...&type=email&redirect_to=<confirm URL>]`,
 *   `#code=...[&next=...]` (Supabase native template path; `type=magiclink`
 *   is additionally accepted for alias links issued via
 *   `admin.generateLink({ type: "magiclink" })`).
 */
export function extractStartPayloadFromHash(
  hash: string | null | undefined,
  opts: { appOrigin: string; supabaseOrigin?: string | null },
): StartFragmentDecision {
  const params = parseFragmentParams(hash);
  if (!params) return { kind: "invalid", reason: "missing_fragment" };

  const nested = params.get("confirmation_url");
  if (nested && nested.trim()) {
    const decision = extractConfirmPayload(nested.trim(), opts);
    if (decision.kind === "confirm") return { kind: "confirm", payload: decision.payload };
    if (decision.kind === "supabase")
      return { kind: "supabase", supabaseUrl: decision.supabaseUrl, next: decision.next };
    return { kind: "invalid", reason: decision.reason };
  }

  const appOrigin = getOrigin(opts.appOrigin);
  if (!appOrigin) return { kind: "invalid", reason: "misconfigured_app_origin" };

  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  if ((code && tokenHash) || (!code && !tokenHash)) {
    return { kind: "invalid", reason: code && tokenHash ? "conflicting_credential" : "missing_credential" };
  }
  const { next, invalid } = resolveNextFromRaw(
    params.get("next"),
    params.get("redirect_to"),
    appOrigin,
  );
  if (invalid) return { kind: "invalid", reason: "unsafe_redirect_target" };

  if (code) {
    if (code.length > 2000) return { kind: "invalid", reason: "oversized_code" };
    return { kind: "confirm", payload: { kind: "code", code, next } };
  }
  const token = (tokenHash ?? "").trim();
  if (!token || token.length > 2000) {
    return { kind: "invalid", reason: !token ? "missing_credential" : "oversized_token" };
  }
  if (!type || !ALLOWED_VERIFY_TYPES.has(type)) {
    return { kind: "invalid", reason: "unexpected_verification_type" };
  }
  return { kind: "confirm", payload: { kind: "token", token_hash: token, type, next } };
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
