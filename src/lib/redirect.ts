// Shared post-login destination rules, used identically by the magic-link
// callback, the MFA page, and the login action. Pure and server-only-free
// so the rules themselves are unit-testable; database and session access
// stays in the route handlers and pages that call these helpers.
//
// Roles come only from `profiles.role`. Investors can never be sent to
// `/admin` destinations; administrators may use any safe path.

export type AppRole = "admin" | "investor";

export const LOGIN_ERROR_MESSAGES = {
  invalid_link: "That sign-in link is invalid or expired. Request a new one.",
  disabled_access: "This account does not currently have portal access.",
  no_profile: "No portal profile was found for this sign-in.",
} as const;

export type LoginErrorCode = keyof typeof LOGIN_ERROR_MESSAGES;

export function parseLoginError(raw: unknown): LoginErrorCode | null {
  if (
    raw === "invalid_link" ||
    raw === "disabled_access" ||
    raw === "no_profile"
  )
    return raw;
  return null;
}

// Syntactic safety only: same-origin path, no auth/API destinations, no
// MFA loop target. Returns the normalized path or null. Decodes repeatedly
// so single- and double-encoded bypasses collapse to the same verdict.
export function sanitizeNextPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let value = raw;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const decoded = decodeURIComponent(value);
      if (decoded === value) break;
      value = decoded;
    } catch {
      return null;
    }
  }
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  if (value.includes("?") || value.includes("#")) return null;
  // URL construction canonicalizes dot segments. Reject any path whose
  // canonical pathname differs so role checks cannot be bypassed before
  // NextResponse performs the same normalization.
  let canonicalPath: string;
  try {
    canonicalPath = new URL(value, "https://ourmu.invalid").pathname;
  } catch {
    return null;
  }
  if (canonicalPath !== value) return null;
  const lower = value.toLowerCase();
  if (lower === "/login" || lower.startsWith("/login/")) return null;
  if (lower === "/auth" || lower.startsWith("/auth/")) return null;
  if (lower === "/api" || lower.startsWith("/api/")) return null;
  if (lower === "/admin/mfa") return null;
  return value;
}

// Syntactic safety plus role gating, with a safe default per role.
export function resolveNextPath(raw: unknown, role: AppRole): string {
  const path = sanitizeNextPath(raw);
  if (role === "investor") {
    if (path && !path.toLowerCase().startsWith("/admin")) return path;
    return "/dashboard";
  }
  return path ?? "/admin";
}

export type PostLoginDecision =
  | { kind: "redirect"; to: string }
  | { kind: "error"; code: LoginErrorCode };

export function decidePostLoginDestination(input: {
  profile: { role: string; access_status: string } | null;
  aal2: boolean;
  rawNext: unknown;
}): PostLoginDecision {
  const { profile } = input;
  if (!profile) return { kind: "error", code: "no_profile" };
  if (profile.access_status !== "active")
    return { kind: "error", code: "disabled_access" };
  if (profile.role === "admin") {
    const to = resolveNextPath(input.rawNext, "admin");
    if (input.aal2) return { kind: "redirect", to };
    return {
      kind: "redirect",
      to: `/admin/mfa?next=${encodeURIComponent(to)}`,
    };
  }
  return { kind: "redirect", to: resolveNextPath(input.rawNext, "investor") };
}
