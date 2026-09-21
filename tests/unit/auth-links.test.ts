import { describe, expect, it, vi } from "vitest";

import {
  buildAuthStartUrl,
  extractConfirmPayload,
  extractStartPayloadFromHash,
  isInvalidOrExpiredError,
  logAuthVerificationOutcome,
  parseAuthStartFragment,
  PRODUCTION_MAGIC_LINK_TEMPLATE_HREF,
  renderProductionMagicLinkHref,
} from "@/lib/auth-links";
import { LOGIN_ERROR_MESSAGES } from "@/lib/redirect";

const APP = "https://partners.ourmu.org";
const SUPABASE = "https://xyz.supabase.co";

describe("parseAuthStartFragment", () => {
  it("extracts confirmation_url with or without a leading hash", () => {
    const inner = encodeURIComponent(`${APP}/auth/confirm?token_hash=abc&type=magiclink`);
    expect(parseAuthStartFragment(`#confirmation_url=${inner}`)).toBe(
      `${APP}/auth/confirm?token_hash=abc&type=magiclink`,
    );
    expect(parseAuthStartFragment(`confirmation_url=${inner}`)).toBe(
      `${APP}/auth/confirm?token_hash=abc&type=magiclink`,
    );
  });

  it("returns null when the fragment is missing or empty", () => {
    expect(parseAuthStartFragment(null)).toBeNull();
    expect(parseAuthStartFragment("")).toBeNull();
    expect(parseAuthStartFragment("#")).toBeNull();
    expect(parseAuthStartFragment("#next=%2Fdashboard")).toBeNull();
    expect(parseAuthStartFragment("#confirmation_url=")).toBeNull();
  });
});

describe("buildAuthStartUrl", () => {
  it("places the confirmation URL in the fragment so scanners cannot redeem it", () => {
    const confirm = `${APP}/auth/confirm?token_hash=abc&type=magiclink`;
    const start = buildAuthStartUrl(APP, confirm);
    expect(start.startsWith(`${APP}/auth/start#confirmation_url=`)).toBe(true);
    // The fragment is client-only: the server-visible part has no token.
    const serverVisible = start.split("#")[0];
    expect(serverVisible).toBe(`${APP}/auth/start`);
    expect(serverVisible).not.toContain("abc");
    expect(parseAuthStartFragment(start.split("#")[1] && `#${start.split("#")[1]}`)).toBe(
      confirm,
    );
  });
});

describe("extractConfirmPayload allowlisting", () => {
  it("accepts a same-origin confirm URL with a safe next", () => {
    const decision = extractConfirmPayload(
      `${APP}/auth/confirm?token_hash=tok123&type=magiclink&next=%2Fdashboard`,
      { appOrigin: APP, supabaseOrigin: SUPABASE },
    );
    expect(decision).toEqual({
      kind: "confirm",
      payload: { kind: "token", token_hash: "tok123", type: "magiclink", next: "/dashboard" },
    });
  });

  it("accepts a code credential and unwraps redirect_to next", () => {
    const inner = encodeURIComponent(`${APP}/auth/confirm?next=%2Fprofile`);
    const decision = extractConfirmPayload(`${APP}/auth/confirm?code=code123&redirect_to=${inner}`, {
      appOrigin: APP,
      supabaseOrigin: SUPABASE,
    });
    expect(decision.kind).toBe("confirm");
    if (decision.kind === "confirm") {
      expect(decision.payload).toEqual({ kind: "code", code: "code123", next: "/profile" });
    }
  });

  it("accepts a Supabase verify URL whose redirect_to is a safe confirm URL", () => {
    const redirectTo = encodeURIComponent(`${APP}/auth/confirm?next=%2Fdashboard`);
    const supabaseUrl = `${SUPABASE}/auth/v1/verify?token=raw&type=magiclink&redirect_to=${redirectTo}`;
    const decision = extractConfirmPayload(supabaseUrl, {
      appOrigin: APP,
      supabaseOrigin: SUPABASE,
    });
    expect(decision.kind).toBe("supabase");
    if (decision.kind === "supabase") {
      expect(decision.next).toBe("/dashboard");
    }
  });

  it("rejects an unexpected host", () => {
    const decision = extractConfirmPayload(
      `https://evil.example/auth/confirm?token_hash=abc&type=magiclink`,
      { appOrigin: APP, supabaseOrigin: SUPABASE },
    );
    expect(decision.kind).toBe("invalid");
  });

  it("rejects an unexpected path on the app origin", () => {
    const decision = extractConfirmPayload(`${APP}/api/health/ready?token_hash=abc`, {
      appOrigin: APP,
      supabaseOrigin: SUPABASE,
    });
    expect(decision.kind).toBe("invalid");
  });

  it("rejects an unexpected verification type", () => {
    const decision = extractConfirmPayload(
      `${APP}/auth/confirm?token_hash=abc&type=recovery`,
      { appOrigin: APP, supabaseOrigin: SUPABASE },
    );
    expect(decision).toEqual({ kind: "invalid", reason: "unexpected_verification_type" });
  });

  it("rejects an unsafe redirect target", () => {
    const evilNext = encodeURIComponent("//evil.example");
    const decision = extractConfirmPayload(
      `${APP}/auth/confirm?token_hash=abc&type=magiclink&next=${evilNext}`,
      { appOrigin: APP, supabaseOrigin: SUPABASE },
    );
    expect(decision).toEqual({ kind: "invalid", reason: "unsafe_redirect_target" });

    const traversal = encodeURIComponent("/profile/../admin");
    const traversalDecision = extractConfirmPayload(
      `${APP}/auth/confirm?code=abc&next=${traversal}`,
      { appOrigin: APP, supabaseOrigin: SUPABASE },
    );
    expect(traversalDecision.kind).toBe("invalid");
  });

  it("rejects Supabase URLs with a cross-origin redirect_to", () => {
    const redirectTo = encodeURIComponent(`https://evil.example/auth/confirm`);
    const supabaseUrl = `${SUPABASE}/auth/v1/verify?token=raw&type=magiclink&redirect_to=${redirectTo}`;
    const decision = extractConfirmPayload(supabaseUrl, {
      appOrigin: APP,
      supabaseOrigin: SUPABASE,
    });
    expect(decision.kind).toBe("invalid");
  });
});

describe("invalid/expired error parsing and recovery copy", () => {
  it("combines already-used and expired into one non-enumerating signal", () => {
    expect(isInvalidOrExpiredError({ message: "Token has expired or is invalid" })).toBe(true);
    expect(isInvalidOrExpiredError({ code: "otp_expired" })).toBe(true);
    expect(isInvalidOrExpiredError("This link has already been used" )).toBe(true);
    expect(isInvalidOrExpiredError({ message: "token_hash not found" })).toBe(true);
    expect(isInvalidOrExpiredError({ message: "network failure" })).toBe(false);
    expect(isInvalidOrExpiredError(null)).toBe(false);
  });

  it("uses the friendly combined recovery copy", () => {
    expect(LOGIN_ERROR_MESSAGES.invalid_link).toContain("already been used or has expired");
    expect(LOGIN_ERROR_MESSAGES.invalid_link).toContain("works once");
  });
});

describe("safe logging", () => {
  it("never includes token values in log calls", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      logAuthVerificationOutcome("redeemed");
      logAuthVerificationOutcome("already_authenticated");
      logAuthVerificationOutcome("invalid_or_expired");
      logAuthVerificationOutcome("disabled_access");
      expect(info).toHaveBeenCalledTimes(4);
      const serialized = JSON.stringify(info.mock.calls);
      expect(serialized).not.toContain("tok123");
      expect(serialized).not.toContain("token_hash");
      expect(serialized).not.toContain("confirmation_url");
      expect(serialized).not.toContain("partner@example.com");
      for (const call of info.mock.calls) {
        expect(call[1]).toEqual({ outcome: expect.any(String) });
        expect(["already_authenticated", "redeemed", "invalid_or_expired", "disabled_access", "no_profile"]).toContain(
          (call[1] as { outcome: string }).outcome,
        );
      }
    } finally {
      info.mockRestore();
    }
  });
});

describe("Supabase-origin fail-closed", () => {
  const supabaseUrl = `${SUPABASE}/auth/v1/verify?token=raw&type=magiclink&redirect_to=${encodeURIComponent(`${APP}/auth/confirm?next=%2Fdashboard`)}`;

  it("rejects Supabase verify URLs when no origin is configured", () => {
    expect(
      extractConfirmPayload(supabaseUrl, { appOrigin: APP, supabaseOrigin: null }),
    ).toEqual({ kind: "invalid", reason: "unexpected_host" });
    expect(
      extractConfirmPayload(supabaseUrl, { appOrigin: APP, supabaseOrigin: undefined }),
    ).toEqual({ kind: "invalid", reason: "unexpected_host" });
  });

  it("rejects Supabase verify URLs when the configured origin is malformed", () => {
    expect(
      extractConfirmPayload(supabaseUrl, { appOrigin: APP, supabaseOrigin: "not-a-url" }),
    ).toEqual({ kind: "invalid", reason: "unexpected_host" });
  });

  it("rejects Supabase verify URLs from a non-matching origin", () => {
    expect(
      extractConfirmPayload(supabaseUrl, {
        appOrigin: APP,
        supabaseOrigin: "https://other.supabase.co",
      }),
    ).toEqual({ kind: "invalid", reason: "unexpected_host" });
    expect(
      extractConfirmPayload(
        `https://evil.example/auth/v1/verify?token=raw&type=magiclink&redirect_to=${encodeURIComponent(`${APP}/auth/confirm`)}`,
        { appOrigin: APP, supabaseOrigin: SUPABASE },
      ),
    ).toEqual({ kind: "invalid", reason: "unexpected_host" });
  });
});

describe("production Supabase template (discrete fragment fields)", () => {
  it("documents the exact dashboard template representation", () => {
    expect(PRODUCTION_MAGIC_LINK_TEMPLATE_HREF).toBe(
      "{{ .SiteURL }}/auth/start#token_hash={{ .TokenHash }}&type=magiclink&redirect_to={{ .RedirectTo }}",
    );
  });

  it("parses the literal rendered Supabase-shaped email href", () => {
    // Literal rendering of the dashboard template for a signInWithOtp call
    // whose emailRedirectTo is our same-origin confirm URL.
    const href = renderProductionMagicLinkHref({
      siteUrl: APP,
      tokenHash: "pkce-token-hash-value",
      redirectTo: `${APP}/auth/confirm?next=%2Fdashboard`,
    });
    const decision = extractStartPayloadFromHash(
      href.slice(href.indexOf("#")),
      { appOrigin: APP, supabaseOrigin: SUPABASE },
    );
    expect(decision).toEqual({
      kind: "confirm",
      payload: {
        kind: "token",
        token_hash: "pkce-token-hash-value",
        type: "magiclink",
        next: "/dashboard",
      },
    });
  });

  it("regresses the truncation bug: unencoded ConfirmationURL wrapping loses type/redirect_to", () => {
    // What the old rollout doc suggested: raw ConfirmationURL in the fragment.
    const rawConfirmation =
      `${SUPABASE}/auth/v1/verify?token=abc&type=magiclink&redirect_to=${encodeURIComponent(`${APP}/auth/confirm?next=%2Fdashboard`)}`;
    const buggyHref = `${APP}/auth/start#confirmation_url=${rawConfirmation}`;
    const buggy = extractStartPayloadFromHash(buggyHref.slice(buggyHref.indexOf("#")), {
      appOrigin: APP,
      supabaseOrigin: SUPABASE,
    });
    // URLSearchParams truncates at the first inner `&`, so only `?token=abc`
    // survives and validation must fail rather than redeem something partial.
    expect(buggy.kind).toBe("invalid");

    // The alias/Resend path percent-encodes the whole nested URL and works.
    const encodedHref = buildAuthStartUrl(APP, rawConfirmation);
    const fixed = extractStartPayloadFromHash(
      encodedHref.slice(encodedHref.indexOf("#")),
      { appOrigin: APP, supabaseOrigin: SUPABASE },
    );
    expect(fixed.kind).toBe("supabase");
  });

  it("parses discrete code/next fragments", () => {
    expect(
      extractStartPayloadFromHash("#code=pkce-code-123&next=%2Fprofile", {
        appOrigin: APP,
        supabaseOrigin: SUPABASE,
      }),
    ).toEqual({
      kind: "confirm",
      payload: { kind: "code", code: "pkce-code-123", next: "/profile" },
    });
  });

  it("rejects discrete fragments with bad type or unsafe next", () => {
    expect(
      extractStartPayloadFromHash("#token_hash=abc&type=recovery", {
        appOrigin: APP,
        supabaseOrigin: SUPABASE,
      }),
    ).toEqual({ kind: "invalid", reason: "unexpected_verification_type" });
    expect(
      extractStartPayloadFromHash("#token_hash=abc&type=magiclink&next=%2F%2Fevil.example", {
        appOrigin: APP,
        supabaseOrigin: SUPABASE,
      }),
    ).toEqual({ kind: "invalid", reason: "unsafe_redirect_target" });
    expect(
      extractStartPayloadFromHash("#next=%2Fdashboard", {
        appOrigin: APP,
        supabaseOrigin: SUPABASE,
      }),
    ).toEqual({ kind: "invalid", reason: "missing_credential" });
  });
});
