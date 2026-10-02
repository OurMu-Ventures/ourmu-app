// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/actions/maturity", () => ({
  submitMaturityInstruction: vi.fn(),
  acceptStandingTerms: vi.fn(),
  confirmMaturityAmounts: vi.fn(),
  fulfillMaturityInstruction: vi.fn(),
  reopenMaturityInstruction: vi.fn(),
  revokeStandingTerms: vi.fn(),
}));
import { submitMaturityInstruction } from "@/actions/maturity";
import { MaturityInstructionForm } from "@/components/maturity-forms";
afterEach(cleanup);
const props = {
  investmentId: "f7213635-be92-5ebe-b501-b39276a45bf1",
  principalUgx: 4_569_760,
  projectedReturnUgx: 1_370_928,
  savedDestinations: [],
  openCycles: [],
  isRevision: false,
};
const selectPaka = () =>
  fireEvent.click(screen.getByRole("radio", { name: /B. Paka Paka/ }));
describe("Paka Paka withdrawal form", () => {
  it("keeps exactly three options and reveals a blank required field", () => {
    render(<MaturityInstructionForm {...props} />);
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.queryByLabelText("Amount to withdraw (UGX)")).toBeNull();
    selectPaka();
    expect(screen.getByLabelText("Amount to withdraw (UGX)")).toHaveValue("");
    expect(screen.getByLabelText("Amount to withdraw (UGX)")).toBeRequired();
    expect(screen.getByText(/Available projected total/)).toHaveTextContent(
      "5,940,688.00",
    );
    expect(
      screen.getByText(/both amounts will adjust proportionally/),
    ).toBeVisible();
  });
  it("updates the live preview and rejects invalid boundaries", () => {
    render(<MaturityInstructionForm {...props} />);
    selectPaka();
    const input = screen.getByLabelText("Amount to withdraw (UGX)");
    fireEvent.change(input, { target: { value: "5000000" } });
    expect(
      screen.getByText(/Projected payout UGX 5,000,000.00/),
    ).toHaveTextContent("projected reinvestment UGX 940,688.00");
    fireEvent.change(input, { target: { value: "0" } });
    expect(input).toBeInvalid();
    expect(screen.getByText(/Choose Dobolo/)).toBeVisible();
    fireEvent.change(input, { target: { value: "5940688" } });
    expect(screen.getByText(/Choose Bijjodolo/)).toBeVisible();
    fireEvent.change(input, { target: { value: "5000000" } });
    expect(input).toBeValid();
    fireEvent.click(screen.getByRole("radio", { name: /C. Dobolo/ }));
    selectPaka();
    expect(screen.getByLabelText("Amount to withdraw (UGX)")).toBeValid();
  });
  it("restores a saved withdrawal and hides it when another option is chosen", () => {
    render(
      <MaturityInstructionForm
        {...props}
        existingChoice="withdraw_roi_reinvest_principal"
        existingWithdrawalUgx={5_000_000}
        isRevision
      />,
    );
    expect(screen.getByLabelText("Amount to withdraw (UGX)")).toHaveValue(
      "5000000",
    );
    fireEvent.click(screen.getByRole("radio", { name: /C. Dobolo/ }));
    expect(screen.queryByLabelText("Amount to withdraw (UGX)")).toBeNull();
    expect(screen.queryByText("Where should the payout go?")).toBeNull();
    selectPaka();
    expect(screen.getByLabelText("Amount to withdraw (UGX)")).toHaveValue(
      "5000000",
    );
  });
  it("shows a reload message for unavailable investment figures", () => {
    render(<MaturityInstructionForm {...props} principalUgx={-1} />);
    selectPaka();
    fireEvent.change(screen.getByLabelText("Amount to withdraw (UGX)"), {
      target: { value: "100000" },
    });
    expect(screen.getByText(/investment total is unavailable/)).toBeVisible();
  });
  it("focuses the saved confirmation and retains it when the form becomes a revision", async () => {
    vi.mocked(submitMaturityInstruction).mockResolvedValueOnce({
      ok: true,
      message: "No further action is needed now.",
    });
    const view = render(<MaturityInstructionForm {...props} />);
    await act(async () => {
      fireEvent.submit(view.container.querySelector("form")!);
    });
    const confirmation = await screen.findByRole("status");
    expect(confirmation).toHaveTextContent("Your maturity choice is saved");
    expect(confirmation).toHaveTextContent("No further action is needed now.");
    expect(confirmation).toHaveFocus();
    view.rerender(
      <MaturityInstructionForm
        {...props}
        existingChoice="withdraw_all"
        isRevision
      />,
    );
    expect(screen.getByRole("status")).toBe(confirmation);
    expect(
      screen.getByRole("button", { name: "Revise maturity choice" }),
    ).toBeVisible();
  });
  it("shows failed saves as an alert without a saved confirmation", async () => {
    vi.mocked(submitMaturityInstruction).mockResolvedValueOnce({
      ok: false,
      message: "The maturity choice could not be saved.",
    });
    const view = render(<MaturityInstructionForm {...props} />);
    await act(async () => {
      fireEvent.submit(view.container.querySelector("form")!);
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be saved",
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("explains legacy terms without silently converting them", () => {
    render(
      <MaturityInstructionForm
        {...props}
        existingChoice="withdraw_roi_reinvest_principal"
        existingWithdrawalUgx={null}
        isRevision
      />,
    );
    expect(screen.getByLabelText("Amount to withdraw (UGX)")).toHaveValue("");
    expect(screen.getByText(/replace those original terms/)).toBeVisible();
  });
});
