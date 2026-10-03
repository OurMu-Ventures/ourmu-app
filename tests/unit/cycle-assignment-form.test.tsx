// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/actions/maturity", () => ({
  submitMaturityInstruction: vi.fn(),
  acceptStandingTerms: vi.fn(),
  confirmMaturityAmounts: vi.fn(),
  fulfillMaturityInstruction: vi.fn(),
  reopenMaturityInstruction: vi.fn(),
  revokeStandingTerms: vi.fn(),
}));

import { MaturityInstructionForm } from "@/components/maturity-forms";

afterEach(() => {
  cleanup();
});

const base = {
  investmentId: "f7213635-be92-5ebe-b501-b39276a45bf1",
  principalUgx: 125000,
  projectedReturnUgx: 37500,
  savedDestinations: [],
  isRevision: false,
};

describe("automatic reinvestment cycle assignment", () => {
  it("shows the assigned cycle instead of a dropdown", () => {
    render(
      <MaturityInstructionForm
        {...base}
        assignedCycle={{
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          name: "October 2026",
          maturity_date: "2026-10-31",
          agreement_version_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          agreement_title: "Participation Agreement v3",
        }}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /C. Dobolo/ }));
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(
      screen.getByText(/Your reinvestment cycle:/),
    ).toHaveTextContent("October 2026");
    expect(
      document.querySelector('input[name="targetCycleId"]'),
    ).toHaveAttribute("value", "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    expect(
      document.querySelector('input[name="expectedAgreementVersionId"]'),
    ).toHaveAttribute("value", "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  });

  it("explains unavailability while keeping full withdrawal", () => {
    render(<MaturityInstructionForm {...base} assignedCycle={null} />);
    fireEvent.click(screen.getByRole("radio", { name: /C. Dobolo/ }));
    expect(
      screen.getByText(/Reinvestment is unavailable/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("radio", { name: /A. Bijjodolo/ }));
    expect(screen.queryByText(/Reinvestment is unavailable/)).toBeNull();
  });
});
