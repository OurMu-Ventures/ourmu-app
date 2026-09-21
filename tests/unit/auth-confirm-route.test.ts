import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  verifyOtp: vi.fn(),
  exchangeCode: vi.fn(),
  signOut: vi.fn(),
  getAal: vi.fn(),
  profileResult: { data: null as unknown, error: null as unknown },
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => mocks.createClient(...args),
}));

vi.mock("@/lib/env", () => ({
  getPublicEnv: () => ({
    NEXT_PUBLIC_APP_URL: "https://partners.ourmu.org",
    NEXT_PUBLIC_SUPABASE_URL: "https://xyz.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  }),
}));

import { GET, POST } from "@/app/(public)/auth/confirm/route";

const APP = "https://partners.ourmu.org";

function buildFakeClient() {
  return {
    auth: {
      getUser: mocks.getUser,
      verifyOtp: mocks.verifyOtp,
      exchangeCodeForSession: mocks.exchangeCode,
      signOut: mocks.signOut,
      mfa: { getAuthenticatorAssuranceLevel: mocks.getAal },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => mocks.profileResult,
        }),
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  mocks.createClient.mockImplementation(async () => buildFakeClient());
  mocks.getAal.mockResolvedValue({ data: { currentLevel: "aal1" } });
  mocks.signOut.mockResolvedValue({ error: null });
});

function investorProfile() {
  mocks.profileResult = {
    data: { role: "investor", access_status: "active" },
    error: null,
  };
}

describe("GET /auth/confirm session-aware flow", () => {
  it("repeat click with an existing session redirects without redeeming", async () => {
    investorProfile();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mocks.verifyOtp.mockResolvedValue({ error: null });
    mocks.exchangeCode.mockResolvedValue({ error: null });

    const response = await GET(
      new Request(`${APP}/auth/confirm?token_hash=already-used&type=magiclink`),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${APP}/dashboard`);
    // The one-time token is never submitted when a session already exists.
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith("auth.verify.outcome", {
      outcome: "already_authenticated",
    });
  });

  it("first valid click redeems and redirects", async () => {
    investorProfile();
    // No session on the pre-check, session present after redemption.
    mocks.getUser
      .mockResolvedValueOnce({ data: { user: null } })
      .mockResolvedValueOnce({ data: { user: { id: "user-1" } } });
    mocks.verifyOtp.mockImplementation(async () => {
      return { error: null };
    });

    const response = await GET(
      new Request(`${APP}/auth/confirm?token_hash=fresh&next=%2Fprofile`),
    );

    expect(mocks.verifyOtp).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${APP}/profile`);
    expect(console.info).toHaveBeenCalledWith("auth.verify.outcome", {
      outcome: "redeemed",
    });
  });

  it("native email-type links verify with the documented type", async () => {
    investorProfile();
    mocks.getUser
      .mockResolvedValueOnce({ data: { user: null } })
      .mockResolvedValueOnce({ data: { user: { id: "user-1" } } });
    mocks.verifyOtp.mockResolvedValue({ error: null });

    const response = await GET(
      new Request(`${APP}/auth/confirm?token_hash=native&next=%2Fdashboard&type=email`),
    );

    expect(response.status).toBe(307);
    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: "native",
      type: "email",
    });
  });

  it("alias magiclink-type links keep verifying with the legacy type", async () => {
    investorProfile();
    mocks.getUser
      .mockResolvedValueOnce({ data: { user: null } })
      .mockResolvedValueOnce({ data: { user: { id: "user-1" } } });
    mocks.verifyOtp.mockResolvedValue({ error: null });

    await GET(new Request(`${APP}/auth/confirm?token_hash=alias&type=magiclink`));

    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: "alias",
      type: "magiclink",
    });
  });

  it("consumed link in a clean browser shows recovery", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    mocks.verifyOtp.mockResolvedValue({
      error: { message: "Token has expired or is invalid", code: "otp_expired" },
    });

    const response = await GET(
      new Request(`${APP}/auth/confirm?token_hash=consumed&type=magiclink`),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${APP}/login?error=invalid_link`);
    expect(console.info).toHaveBeenCalledWith("auth.verify.outcome", {
      outcome: "invalid_or_expired",
    });
  });
});

describe("POST /auth/confirm redemption flow", () => {
  it("deliberate Continue redeems the fragment payload same-origin", async () => {
    investorProfile();
    mocks.getUser
      .mockResolvedValueOnce({ data: { user: null } })
      .mockResolvedValueOnce({ data: { user: { id: "user-1" } } });
    mocks.verifyOtp.mockResolvedValue({ error: null });

    const response = await POST(
      new Request(`${APP}/auth/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token_hash: "tok", type: "magiclink", next: "/dashboard" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      redirectTo: "/dashboard",
    });
    expect(mocks.verifyOtp).toHaveBeenCalledTimes(1);
    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: "tok",
      type: "magiclink",
    });
  });

  it("repeat POST with a session short-circuits without redeeming", async () => {
    investorProfile();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const response = await POST(
      new Request(`${APP}/auth/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token_hash: "tok", type: "magiclink" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      redirectTo: "/dashboard",
      alreadyAuthenticated: true,
    });
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("expired payload returns the recovery target", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    mocks.verifyOtp.mockResolvedValue({
      error: { message: "Token has expired or is invalid" },
    });

    const response = await POST(
      new Request(`${APP}/auth/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token_hash: "stale", type: "magiclink" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "invalid_link",
      redirectTo: "/login?error=invalid_link",
    });
  });

  it("native email-type POST payload verifies with the documented type", async () => {
    investorProfile();
    mocks.getUser
      .mockResolvedValueOnce({ data: { user: null } })
      .mockResolvedValueOnce({ data: { user: { id: "user-1" } } });
    mocks.verifyOtp.mockResolvedValue({ error: null });

    const response = await POST(
      new Request(`${APP}/auth/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token_hash: "native", type: "email" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: "native",
      type: "email",
    });
  });
});
