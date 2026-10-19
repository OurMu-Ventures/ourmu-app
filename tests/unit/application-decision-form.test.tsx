// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { approveApplication, rejectApplication } from "@/actions/applications";
import { ApplicationDecisionForm } from "@/components/ApplicationDecisionForm";

vi.mock("@/actions/applications", () => ({
  approveApplication: vi.fn(),
  rejectApplication: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("application review", () => {
  it("has one approval submit button and requires a verification reference", async () => {
    const user = userEvent.setup();
    render(<ApplicationDecisionForm applicationId="application-1" />);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    const approve = screen.getAllByRole("button", { name: /Approve/ });
    expect(approve).toHaveLength(1);
    await user.click(approve[0]);
    await user.click(screen.getByRole("button", { name: /Reject/ }));
    expect(
      screen.getByLabelText(/Offline verification reference/),
    ).toBeInvalid();
    expect(approveApplication).not.toHaveBeenCalled();
    expect(rejectApplication).not.toHaveBeenCalled();
  });

  it.each([
    ["Approve", approveApplication, rejectApplication],
    ["Reject", rejectApplication, approveApplication],
  ] as const)(
    "submits %s with the shared verification fields",
    async (label, handler, other) => {
      vi.mocked(handler).mockResolvedValue({
        ok: true,
        message: "Decision saved.",
      });
      const user = userEvent.setup();
      render(<ApplicationDecisionForm applicationId="application-1" />);
      await user.type(
        screen.getByLabelText(/Offline verification reference/),
        "KYC-123",
      );
      await user.type(
        screen.getByLabelText(/Non-sensitive notes/),
        "Review complete",
      );
      await user.click(screen.getByRole("button", { name: new RegExp(label) }));
      expect(await screen.findByRole("status")).toHaveTextContent(
        "Decision saved.",
      );
      expect(handler).toHaveBeenCalledTimes(1);
      expect(other).not.toHaveBeenCalled();
      const data = vi.mocked(handler).mock.calls[0][1];
      expect(data.get("applicationId")).toBe("application-1");
      expect(data.get("verificationReference")).toBe("KYC-123");
      expect(data.get("notes")).toBe("Review complete");
    },
  );

  it("disables both decisions while saving and preserves fields after an error", async () => {
    let finish!: (state: { ok: boolean; message: string }) => void;
    vi.mocked(approveApplication).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<ApplicationDecisionForm applicationId="application-1" />);
    await user.type(
      screen.getByLabelText(/Offline verification reference/),
      "KYC-123",
    );
    await user.type(
      screen.getByLabelText(/Non-sensitive notes/),
      "Review complete",
    );
    await user.click(screen.getByRole("button", { name: /Approve/ }));
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("aria-busy", "true");
    }
    finish({ ok: false, message: "Approval could not be finalized." });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Approval could not be finalized.",
    );
    expect(screen.getByLabelText(/Offline verification reference/)).toHaveValue(
      "KYC-123",
    );
    expect(screen.getByLabelText(/Non-sensitive notes/)).toHaveValue(
      "Review complete",
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Approve/ })).toBeEnabled(),
    );
  });
});
