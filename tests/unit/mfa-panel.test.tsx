// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MfaPanel } from "@/components/MfaPanel";

const mocks = vi.hoisted(() => ({
  listFactors: vi.fn(),
  enroll: vi.fn(),
  challenge: vi.fn(),
  verify: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({
    auth: {
      mfa: {
        listFactors: mocks.listFactors,
        enroll: mocks.enroll,
        challenge: mocks.challenge,
        verify: mocks.verify,
      },
    },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  Object.defineProperty(window, "location", {
    value: { replace: mocks.replace },
    writable: true,
    configurable: true,
  });
  mocks.listFactors.mockResolvedValue({
    data: { totp: [{ id: "factor-1", status: "verified" }] },
    error: null,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MfaPanel", () => {
  it("navigates exactly once, fully, after the cookie update", async () => {
    const user = userEvent.setup();
    mocks.challenge.mockResolvedValue({ data: { id: "c-1" }, error: null });
    mocks.verify.mockResolvedValue({ data: { id: "c-1" }, error: null });
    render(<MfaPanel target="/admin/cycles" />);

    const button = await screen.findByRole("button", {
      name: "Verify administrator MFA",
    });
    await user.type(screen.getByLabelText(/six-digit code/i), "123456");
    await user.click(button);

    expect(mocks.challenge).toHaveBeenCalledWith({ factorId: "factor-1" });
    // One deterministic full navigation: no client-side refresh racing it.
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith("/admin/cycles");
  });

  it("rejects codes with a stable message that leaks no provider text", async () => {
    const user = userEvent.setup();
    mocks.challenge.mockResolvedValue({ data: { id: "c-1" }, error: null });
    mocks.verify.mockResolvedValue({
      data: null,
      error: { message: "Token has expired or is invalid", code: "otp_expired" },
    });
    render(<MfaPanel target="/admin" />);

    const button = await screen.findByRole("button", {
      name: "Verify administrator MFA",
    });
    await user.type(screen.getByLabelText(/six-digit code/i), "000000");
    await user.click(button);

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(
      "That code was not accepted. Check the code and try again.",
    );
    expect(status).not.toHaveTextContent(/expired or is invalid/);
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("attempts enrollment when no verified factor exists", async () => {
    mocks.listFactors.mockResolvedValue({
      data: { totp: [] },
      error: null,
    });
    mocks.enroll.mockResolvedValue({ data: null, error: { code: "x" } });
    render(<MfaPanel target="/admin" />);

    await waitFor(() => expect(mocks.enroll).toHaveBeenCalled());
    expect(await screen.findByRole("status")).toHaveTextContent(
      "MFA enrollment could not be started. Reload to retry.",
    );
  });

  it("reports load failures with verify staying disabled", async () => {
    mocks.listFactors.mockResolvedValue({
      data: null,
      error: { message: "network failure", code: "network" },
    });
    render(<MfaPanel target="/admin" />);

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(
      "MFA status could not be loaded. Reload to retry.",
    );
    expect(status).not.toHaveTextContent(/network failure/);
    expect(
      screen.getByRole("button", { name: "Verify administrator MFA" }),
    ).toBeDisabled();
  });
});
