// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/actions/deposit-slips", () => ({
  listDepositSlips: vi.fn(async () => []),
  reserveDepositSlip: vi.fn(),
  finalizeDepositSlip: vi.fn(),
  removeDepositSlip: vi.fn(),
  viewDepositSlip: vi.fn(),
}));
vi.mock("@/lib/supabase/browser", () => ({ createClient: vi.fn() }));
import { DepositSlips } from "@/components/DepositSlips";
import { listDepositSlips } from "@/actions/deposit-slips";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("deposit slip widget rollout and initial data", () => {
  it("hides the chooser and upload prompt when disabled", () => {
    render(<DepositSlips investmentId="id" initialFiles={[]} />);
    expect(
      screen.queryByLabelText("Choose deposit slip"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Already made your bank deposit/),
    ).not.toBeInTheDocument();
  });
  it("enables the file chooser with the server flag", () => {
    render(<DepositSlips investmentId="id" initialFiles={[]} uploadsEnabled />);
    expect(screen.getByLabelText("Choose deposit slip")).toBeEnabled();
  });
  it("uses supplied admin rows without a server action on mount", () => {
    render(<DepositSlips investmentId="id" initialFiles={[]} admin />);
    expect(listDepositSlips).not.toHaveBeenCalled();
  });
});
