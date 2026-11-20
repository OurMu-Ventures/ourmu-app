// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/actions/bank-deposits", () => ({ allocateBankDeposit: vi.fn() }));
import { allocateBankDeposit } from "@/actions/bank-deposits";
import { DepositAllocationForm } from "@/components/DepositAllocationForm";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const accounts = [
  { id: "6d1c4f63-6c7a-4b8e-9f1e-0d4f2c3b1a04", name: "Main Account" },
  { id: "6d1c4f63-6c7a-4b8e-9f1e-0d4f2c3b1a05", name: "School Fees" },
  { id: "6d1c4f63-6c7a-4b8e-9f1e-0d4f2c3b1a06", name: "Retirement" },
];
function renderForm(reservations = [] as Parameters<typeof DepositAllocationForm>[0]["reservations"]) {
  return render(
    <DepositAllocationForm
      requestId="6d1c4f63-6c7a-4b8e-9f1e-0d4f2c3b1a01"
      investorId="6d1c4f63-6c7a-4b8e-9f1e-0d4f2c3b1a02"
      cycleId="6d1c4f63-6c7a-4b8e-9f1e-0d4f2c3b1a03"
      agreementHash={"ab".repeat(32)}
      receivedDate="2026-11-20"
      today="2026-11-21"
      accounts={accounts}
      reservations={reservations}
    />,
  );
}
const amountRows = () => screen.getAllByLabelText("Amount (UGX)");

describe("deposit allocation form", () => {
  it("tracks the synthetic 3m split until it matches the deposit", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Exact amount received (UGX)"), { target: { value: "3,000,000" } });
    const [first, second, third] = amountRows();
    fireEvent.change(first, { target: { value: "2,000,000" } });
    fireEvent.change(second, { target: { value: "500000" } });
    expect(screen.getByText(/still to allocate/)).toHaveTextContent("500,000");
    fireEvent.change(third, { target: { value: "500000" } });
    expect(screen.getByText(/matches the deposit/)).toBeInTheDocument();
    fireEvent.change(third, { target: { value: "600000" } });
    expect(screen.getByText(/over the deposit/)).toBeInTheDocument();
  });

  it("asks for offline agreement acceptance only when a placement is entered", () => {
    renderForm([
      { id: "6d1c4f63-6c7a-4b8e-9f1e-0d4f2c3b1a07", accountId: accounts[0].id, accountName: "Main Account", amount: "2000000", requested: "19 Nov 2026" },
    ]);
    expect(screen.queryByLabelText(/accepted the cycle agreement/)).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /Main Account · reserved/ }));
    fireEvent.change(screen.getByLabelText("Exact amount received (UGX)"), { target: { value: "2000000" } });
    expect(screen.getByText(/matches the deposit/)).toBeInTheDocument();
    fireEvent.change(amountRows()[0], { target: { value: "125000" } });
    expect(screen.getByLabelText(/accepted the cycle agreement/)).toBeRequired();
  });

  it("keeps entered evidence after the server rejects the allocation", async () => {
    vi.mocked(allocateBankDeposit).mockResolvedValue({ ok: false, message: "The allocations must add up exactly to the amount received. No records were changed." });
    renderForm();
    const reference = screen.getByLabelText("Bank reference");
    fireEvent.change(reference, { target: { value: "DEP-SYNTH-1" } });
    fireEvent.change(screen.getByLabelText("Evidence reference"), { target: { value: "Mailbox: split email" } });
    fireEvent.submit(reference.closest("form")!);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("No records were changed"));
    expect(screen.getByLabelText("Bank reference")).toHaveValue("DEP-SYNTH-1");
    expect(screen.getByLabelText("Evidence reference")).toHaveValue("Mailbox: split email");
  });
});
