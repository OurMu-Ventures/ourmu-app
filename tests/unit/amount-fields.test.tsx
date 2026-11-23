// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/actions/admin", () => ({
  createCycle: vi.fn(),
  updateCycle: vi.fn(),
}));
vi.mock("@/actions/applications", () => ({}));
vi.mock("@/actions/auth", () => ({}));
vi.mock("@/actions/profile", () => ({}));
vi.mock("@/actions/investments", () => ({}));
vi.mock("@/actions/bank-deposits", () => ({ allocateBankDeposit: vi.fn() }));
vi.mock("@/actions/maturity", () => ({
  acceptStandingTerms: vi.fn(),
  confirmMaturityAmounts: vi.fn(),
  fulfillMaturityInstruction: vi.fn(),
  reopenMaturityInstruction: vi.fn(),
  revokeStandingTerms: vi.fn(),
  submitMaturityInstruction: vi.fn(),
}));
import { createCycle } from "@/actions/admin";
import { DepositAllocationForm } from "@/components/DepositAllocationForm";
import { CycleEditForm, CycleForm } from "@/components/forms";
import { MaturityFulfillmentForm } from "@/components/maturity-forms";

beforeEach(() => {
  // jsdom has no modal dialogs; opening is all the review step needs here.
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const submitted = (input: HTMLElement, name: string) =>
  new FormData((input as HTMLInputElement).form!).get(name);

describe("UGX amount fields", () => {
  it("groups cycle capacity, checks the minimum and submits a plain amount", async () => {
    vi.mocked(createCycle).mockResolvedValue({
      ok: true,
      message: "Draft cycle created.",
    });
    render(<CycleForm />);
    const capacity = screen.getByLabelText("Capacity (UGX)") as HTMLInputElement;
    fireEvent.change(capacity, { target: { value: "100000" } });
    expect(capacity).toHaveValue("100,000");
    expect(capacity.checkValidity()).toBe(false);

    fireEvent.change(capacity, { target: { value: "250000000" } });
    expect(capacity).toHaveValue("250,000,000");
    expect(capacity.checkValidity()).toBe(true);
    expect(submitted(capacity, "capacityUgx")).toBe("250000000");

    fireEvent.submit(capacity.form!);
    await screen.findByText("Draft cycle created.");
    expect(vi.mocked(createCycle).mock.calls[0][1].get("capacityUgx")).toBe(
      "250000000",
    );
    await waitFor(() => expect(capacity).toHaveValue(""));
  });

  it("shows a saved cycle capacity grouped", () => {
    render(
      <CycleEditForm
        cycle={{
          id: "6d1c4f63-6c7a-4b8e-9f1e-0d4f2c3b1a01",
          name: "April 2027",
          opens_at: "2027-04-01T00:00:00+03:00",
          closes_at: "2027-04-30T00:00:00+03:00",
          maturity_date: "2027-09-30",
          capacity_ugx: "500000000.00",
        }}
      />,
    );
    const capacity = screen.getByLabelText("Capacity (UGX)");
    expect(capacity).toHaveValue("500,000,000.00");
    expect(submitted(capacity, "capacityUgx")).toBe("500000000.00");
  });

  it("groups bank deposit amounts and submits them without commas", () => {
    render(
      <DepositAllocationForm
        requestId="6d1c4f63-6c7a-4b8e-9f1e-0d4f2c3b1a01"
        investorId="6d1c4f63-6c7a-4b8e-9f1e-0d4f2c3b1a02"
        cycleId="6d1c4f63-6c7a-4b8e-9f1e-0d4f2c3b1a03"
        agreementHash={"ab".repeat(32)}
        receivedDate="2026-11-20"
        today="2026-11-21"
        accounts={[{ id: "6d1c4f63-6c7a-4b8e-9f1e-0d4f2c3b1a04", name: "Main" }]}
        reservations={[]}
      />,
    );
    const received = screen.getByLabelText("Exact amount received (UGX)");
    const [placement] = screen.getAllByLabelText("Amount (UGX)");
    fireEvent.change(received, { target: { value: "3000000.5" } });
    fireEvent.change(placement, { target: { value: "3000000.50" } });
    expect(received).toHaveValue("3,000,000.5");
    expect(placement).toHaveValue("3,000,000.50");
    expect(submitted(received, "receivedAmountUgx")).toBe("3000000.5");
    expect(submitted(placement, "placementAmount.0")).toBe("3000000.50");
    expect(screen.getByText(/matches the deposit/)).toBeInTheDocument();
  });

  it("groups a legacy actual ROI and reviews it as a plain amount", () => {
    render(
      <MaturityFulfillmentForm
        instructionId="00000000-0000-4000-8000-000000000002"
        partnerName="Example Partner"
        principalUgx={1_000_000}
        acceptedAmounts={{ payoutUgx: 1_300_000, reinvestUgx: 0 }}
        choice="withdraw_all"
        actualReturn={{ kind: "legacy" }}
      />,
    );
    const roi = screen.getByLabelText(/Actual ROI \(UGX\)/) as HTMLInputElement;
    fireEvent.change(roi, { target: { value: "300000.005" } });
    expect(roi).toHaveValue("300,000.005");
    expect(roi.checkValidity()).toBe(false);

    fireEvent.change(roi, { target: { value: "10.500" } });
    expect(roi.checkValidity()).toBe(true);

    // Deleting only a selected comma must not delete a digit.
    fireEvent.change(roi, { target: { value: "1234" } });
    expect(roi).toHaveValue("1,234");
    roi.setSelectionRange(1, 2);
    roi.dispatchEvent(new InputEvent("beforeinput", { bubbles: true }));
    roi.setSelectionRange(1, 1);
    fireEvent.input(roi, {
      target: { value: "1234" },
      inputType: "deleteContentBackward",
    });
    expect(roi).toHaveValue("1,234");

    fireEvent.change(roi, { target: { value: "300000" } });
    expect(roi).toHaveValue("300,000");
    expect(roi.checkValidity()).toBe(true);
    fireEvent.change(screen.getByLabelText("External payout reference"), {
      target: { value: "PAY-1" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /verified it matches/ }));
    fireEvent.click(screen.getByRole("button", { name: /Review/ }));
    const dialog = screen.getByRole("dialog");
    expect(
      dialog.querySelector('input[name="actualRoiUgx"]'),
    ).toHaveValue("300000");
    expect(within(dialog).getAllByText(/1,300,000/).length).toBeGreaterThan(0);
  });
});
