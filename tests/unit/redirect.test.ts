import { describe, expect, it } from "vitest";

import {
  decidePostLoginDestination,
  getHomeDestination,
  parseLoginError,
  resolveNextPath,
  sanitizeNextPath,
} from "@/lib/redirect";

describe("sanitizeNextPath", () => {
  it("accepts plain protected paths", () => {
    expect(sanitizeNextPath("/dashboard")).toBe("/dashboard");
    expect(sanitizeNextPath("/admin/cycles")).toBe("/admin/cycles");
    expect(sanitizeNextPath("/investments/abc")).toBe("/investments/abc");
  });

  it("rejects non-strings, empty, and external URLs", () => {
    expect(sanitizeNextPath(undefined)).toBeNull();
    expect(sanitizeNextPath(null)).toBeNull();
    expect(sanitizeNextPath(42)).toBeNull();
    expect(sanitizeNextPath("")).toBeNull();
    expect(sanitizeNextPath("https://evil.example")).toBeNull();
    expect(sanitizeNextPath("javascript:alert(1)")).toBeNull();
  });

  it("rejects protocol-relative and backslash bypasses", () => {
    expect(sanitizeNextPath("//evil.example")).toBeNull();
    expect(sanitizeNextPath("/\\evil.example")).toBeNull();
    expect(sanitizeNextPath("/%2f%2fevil.example")).toBeNull();
    expect(sanitizeNextPath("/%252f%252fevil.example")).toBeNull();
    expect(sanitizeNextPath("/%5cevil.example")).toBeNull();
  });

  it("rejects plain and encoded dot-segment normalization", () => {
    expect(sanitizeNextPath("/../admin")).toBeNull();
    expect(sanitizeNextPath("/profile/../admin")).toBeNull();
    expect(sanitizeNextPath("/%2e%2e/admin")).toBeNull();
    expect(sanitizeNextPath("/%252e%252e/admin")).toBeNull();
    expect(sanitizeNextPath("/profile/%2e%2e/admin")).toBeNull();
  });

  it("rejects auth loops, API routes, and query/hash smuggling", () => {
    expect(sanitizeNextPath("/login")).toBeNull();
    expect(sanitizeNextPath("/Login")).toBeNull();
    expect(sanitizeNextPath("/auth/confirm")).toBeNull();
    expect(sanitizeNextPath("/api/health/ready")).toBeNull();
    expect(sanitizeNextPath("/admin/mfa")).toBeNull();
    expect(sanitizeNextPath("/dashboard?next=/admin")).toBeNull();
    expect(sanitizeNextPath("/dashboard#x")).toBeNull();
    expect(sanitizeNextPath("/dash%00board")).toBeNull();
    expect(sanitizeNextPath("/%zz")).toBeNull();
  });
});

describe("resolveNextPath", () => {
  it("keeps valid investor destinations out of /admin", () => {
    expect(resolveNextPath("/profile", "investor")).toBe("/profile");
    expect(resolveNextPath("/admin", "investor")).toBe("/dashboard");
    expect(resolveNextPath("/admin/cycles", "investor")).toBe("/dashboard");
    expect(resolveNextPath("/Admin/cycles", "investor")).toBe("/dashboard");
    expect(resolveNextPath("/%2e%2e/admin", "investor")).toBe("/dashboard");
    expect(resolveNextPath("/profile/../admin", "investor")).toBe(
      "/dashboard",
    );
    expect(resolveNextPath("//evil.example", "investor")).toBe("/dashboard");
    expect(resolveNextPath(undefined, "investor")).toBe("/dashboard");
  });

  it("lets administrators use any safe path with an admin default", () => {
    expect(resolveNextPath(undefined, "admin")).toBe("/admin");
    expect(resolveNextPath("/dashboard", "admin")).toBe("/dashboard");
    expect(resolveNextPath("/admin/cycles", "admin")).toBe("/admin/cycles");
    expect(resolveNextPath("/login", "admin")).toBe("/admin");
  });
});

describe("decidePostLoginDestination", () => {
  const investor = { role: "investor", access_status: "active" };
  const admin = { role: "admin", access_status: "active" };

  it("sends investors to their destination or dashboard", () => {
    expect(
      decidePostLoginDestination({
        profile: investor,
        aal2: false,
        rawNext: "/profile",
      }),
    ).toEqual({ kind: "redirect", to: "/profile" });
    expect(
      decidePostLoginDestination({
        profile: investor,
        aal2: false,
        rawNext: "/admin/cycles",
      }),
    ).toEqual({ kind: "redirect", to: "/dashboard" });
  });

  it("sends AAL1 administrators through MFA carrying the target", () => {
    expect(
      decidePostLoginDestination({
        profile: admin,
        aal2: false,
        rawNext: "/admin/cycles",
      }),
    ).toEqual({
      kind: "redirect",
      to: "/admin/mfa?next=%2Fadmin%2Fcycles",
    });
  });

  it("sends AAL2 administrators straight to the target", () => {
    expect(
      decidePostLoginDestination({
        profile: admin,
        aal2: true,
        rawNext: "/admin/cycles",
      }),
    ).toEqual({ kind: "redirect", to: "/admin/cycles" });
    expect(
      decidePostLoginDestination({
        profile: admin,
        aal2: true,
        rawNext: undefined,
      }),
    ).toEqual({ kind: "redirect", to: "/admin" });
  });

  it("fails closed on missing or disabled profiles", () => {
    expect(
      decidePostLoginDestination({
        profile: null,
        aal2: false,
        rawNext: "/dashboard",
      }),
    ).toEqual({ kind: "error", code: "no_profile" });
    expect(
      decidePostLoginDestination({
        profile: { role: "investor", access_status: "disabled" },
        aal2: false,
        rawNext: "/dashboard",
      }),
    ).toEqual({ kind: "error", code: "disabled_access" });
  });
});

describe("parseLoginError", () => {
  it("allowlist known codes and drops everything else", () => {
    expect(parseLoginError("invalid_link")).toBe("invalid_link");
    expect(parseLoginError("disabled_access")).toBe("disabled_access");
    expect(parseLoginError("no_profile")).toBe("no_profile");
    expect(parseLoginError("<script>")).toBeNull();
    expect(parseLoginError(undefined)).toBeNull();
  });
});

describe("getHomeDestination", () => {
  const activeInvestor = { role: "investor" as const, access_status: "active" as const, is_test: false };
  const activeTestAccount = { role: "investor" as const, access_status: "active" as const, is_test: true };
  const activeAdmin = { role: "admin" as const, access_status: "active" as const, is_test: false };
  const disabledInvestor = { role: "investor" as const, access_status: "disabled" as const, is_test: false };
  const closedInvestor = { role: "investor" as const, access_status: "closed" as const, is_test: false };

  it("returns null for null profile (signed out)", () => {
    expect(getHomeDestination(null, false)).toBeNull();
    expect(getHomeDestination(null, true)).toBeNull();
  });

  it("returns null for disabled or closed accounts", () => {
    expect(getHomeDestination(disabledInvestor, false)).toBeNull();
    expect(getHomeDestination(closedInvestor, true)).toBeNull();
    expect(getHomeDestination({ ...activeAdmin, access_status: "disabled" }, true)).toBeNull();
  });

  it("sends active investors to dashboard", () => {
    expect(getHomeDestination(activeInvestor, false)).toBe("/dashboard");
    expect(getHomeDestination(activeInvestor, true)).toBe("/dashboard");
  });

  it("sends active test accounts to dashboard", () => {
    expect(getHomeDestination(activeTestAccount, false)).toBe("/dashboard");
    expect(getHomeDestination(activeTestAccount, true)).toBe("/dashboard");
  });

  it("sends AAL2 admins to admin", () => {
    expect(getHomeDestination(activeAdmin, true)).toBe("/admin");
  });

  it("sends AAL1 admins to admin/mfa", () => {
    expect(getHomeDestination(activeAdmin, false)).toBe("/admin/mfa");
  });
});
