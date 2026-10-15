// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/actions/maturity", () => ({
  acceptStandingTerms: vi.fn(),
  confirmMaturityAmounts: vi.fn(),
  fulfillMaturityInstruction: vi.fn(),
  reopenMaturityInstruction: vi.fn(),
  revokeStandingTerms: vi.fn(),
  submitMaturityInstruction: vi.fn(),
}));
import { fulfillMaturityInstruction } from "@/actions/maturity";
import { MaturityFulfillmentForm } from "@/components/maturity-forms";

const base = {
  instructionId: "00000000-0000-4000-8000-000000000002",
  partnerName: "Example Partner",
  principalUgx: 1_000_000,
  acceptedAmounts: { payoutUgx: 1_300_000, reinvestUgx: 0 },
  choice: "withdraw_all" as const,
  actualReturn: {
    kind: "cycle" as const,
    actualRoiUgx: 300_000,
    actualReturnBps: 3000,
  },
};

beforeEach(() => {
  vi.mocked(fulfillMaturityInstruction).mockReset();
  vi.mocked(fulfillMaturityInstruction).mockResolvedValue({
    ok: true,
    message: "Instruction completed.",
  });
  // jsdom does not implement native dialog methods. Native modality and
  // focus trapping are provided by showModal in the browser.
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function reviewPayout() {
  fireEvent.change(screen.getByLabelText("External payout reference"), {
    target: { value: "TRANSFER-123" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(
    screen.getByRole("button", { name: /Review (completion|revised amounts)/ }),
  );
}

describe("maturity completion review", () => {
  it("reviews the partner, exact split and reference without submitting", () => {
    render(<MaturityFulfillmentForm {...base} />);
    expect(screen.queryByLabelText(/Type FULFILL/)).toBeNull();
    reviewPayout();
    const dialog = screen.getByRole("dialog", {
      name: "Confirm instruction completion",
    });
    expect(within(dialog).getByText("UGX 1,300,000.00")).toBeVisible();
    expect(within(dialog).getByText("UGX 0.00")).toBeVisible();
    expect(within(dialog).getAllByText("Example Partner")).toHaveLength(2);
    expect(within(dialog).getByText("TRANSFER-123")).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toHaveFocus();
    expect(fulfillMaturityInstruction).not.toHaveBeenCalled();
  });

  it("cancels without a mutation and retains the entered reference", () => {
    render(<MaturityFulfillmentForm {...base} />);
    reviewPayout();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Review completion" }),
    ).toHaveFocus();
    expect(screen.getByLabelText("External payout reference")).toHaveValue(
      "TRANSFER-123",
    );
    expect(fulfillMaturityInstruction).not.toHaveBeenCalled();
  });

  it("requires the payout reference and destination check before review", () => {
    render(<MaturityFulfillmentForm {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "Review completion" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.change(screen.getByLabelText("External payout reference"), {
      target: { value: "TRANSFER-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review completion" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fulfillMaturityInstruction).not.toHaveBeenCalled();
  });

  it("dismisses with Escape and restores focus without submitting", () => {
    render(<MaturityFulfillmentForm {...base} />);
    reviewPayout();
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Review completion" }),
    ).toHaveFocus();
    expect(fulfillMaturityInstruction).not.toHaveBeenCalled();
  });

  it("submits only after confirmation and closes after the response", async () => {
    render(<MaturityFulfillmentForm {...base} />);
    reviewPayout();
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Confirm completion" }),
      ),
    );
    expect(fulfillMaturityInstruction).toHaveBeenCalledTimes(1);
    const data = vi.mocked(fulfillMaturityInstruction).mock.calls[0][1];
    expect(Object.fromEntries(data)).toMatchObject({
      instructionId: base.instructionId,
      confirmation: "yes",
      actualRoiUgx: "300000",
      payoutReference: "TRANSFER-123",
      destinationVerified: "yes",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Instruction completed.",
    );
  });

  it("shows the proportional custom split for a legacy ROI entry", () => {
    render(
      <MaturityFulfillmentForm
        {...base}
        choice="withdraw_roi_reinvest_principal"
        actualReturn={{ kind: "legacy" }}
        targetCycleName="October 2026"
        customBasis={{
          requestedWithdrawalUgx: 650000,
          projectedTotalUgx: 1300000,
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Actual ROI \(UGX\)/), {
      target: { value: "200000" },
    });
    reviewPayout();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByText("UGX 600,000.00")).toHaveLength(2);
    expect(within(dialog).getByText("October 2026")).toBeVisible();
  });

  it("explicitly reviews and sends revised amounts rather than claiming completion", async () => {
    render(
      <MaturityFulfillmentForm
        {...base}
        actualReturn={{
          kind: "cycle",
          actualRoiUgx: 200000,
          actualReturnBps: 2000,
        }}
      />,
    );
    reviewPayout();
    const dialog = screen.getByRole("dialog", {
      name: "Review revised amounts for partner",
    });
    expect(
      within(dialog).getByText(/will not complete the payout or reinvestment/),
    ).toBeVisible();
    expect(
      within(dialog).queryByRole("button", { name: "Confirm completion" }),
    ).toBeNull();
    expect(within(dialog).getByText("UGX 1,200,000.00")).toBeVisible();
    await act(async () =>
      fireEvent.click(
        within(dialog).getByRole("button", {
          name: "Send revised amounts to partner",
        }),
      ),
    );
    expect(fulfillMaturityInstruction).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(fulfillMaturityInstruction).mock.calls[0][1].get("intent"),
    ).toBe("propose");
  });

  it("offers completion after the partner confirms the actual amounts", () => {
    render(
      <MaturityFulfillmentForm
        {...base}
        acceptedAmounts={{
          payoutUgx: 1400000,
          reinvestUgx: 0,
          proposedRoiUgx: 300000,
          confirmedRoiUgx: 300000,
        }}
      />,
    );
    reviewPayout();
    expect(
      screen.getByRole("button", { name: "Confirm completion" }),
    ).toBeVisible();
  });

  it("reviews reinvestment without asking for a payout reference", () => {
    render(
      <MaturityFulfillmentForm
        {...base}
        choice="reinvest_all"
        targetCycleName="October 2026"
      />,
    );
    expect(screen.queryByLabelText("External payout reference")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review completion" }));
    expect(
      within(screen.getByRole("dialog")).getByText("UGX 1,300,000.00"),
    ).toBeVisible();
    expect(fulfillMaturityInstruction).not.toHaveBeenCalled();
  });

  it("prevents a second confirmation and cancellation while submitting", async () => {
    let finish!: (value: { ok: boolean; message: string }) => void;
    vi.mocked(fulfillMaturityInstruction).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<MaturityFulfillmentForm {...base} />);
    reviewPayout();
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Confirm completion" }),
      ),
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: /Working/ }),
    ).toBeDisabled();
    const escape = new Event("cancel", { cancelable: true });
    fireEvent(dialog, escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(fulfillMaturityInstruction).toHaveBeenCalledTimes(1);
    await act(async () =>
      finish({ ok: false, message: "Reload before fulfilling." }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Reload before fulfilling.",
    );
  });
});
