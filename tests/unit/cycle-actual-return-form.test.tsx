// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/actions/cycle-returns", () => ({
  previewCycleActualReturn: vi.fn(),
  recordCycleActualReturn: vi.fn(),
}));
vi.mock("@/actions/maturity", () => ({
  submitMaturityInstruction: vi.fn(),
  acceptStandingTerms: vi.fn(),
  confirmMaturityAmounts: vi.fn(),
  fulfillMaturityInstruction: vi.fn(),
  reopenMaturityInstruction: vi.fn(),
  revokeStandingTerms: vi.fn(),
}));
import {
  previewCycleActualReturn,
  recordCycleActualReturn,
} from "@/actions/cycle-returns";
import { CycleActualReturnForm } from "@/components/cycle-actual-return-form";
import { MaturityFulfillmentForm } from "@/components/maturity-forms";

const CYCLE = "00000000-0000-4000-8000-000000000001";
const preview = {
  cycleId: CYCLE,
  actualReturnBps: 2735,
  previousActualReturnBps: null,
  revision: 0,
  investmentCount: 2,
  testInvestmentCount: 1,
  principalUgx: 458333.33,
  projectedProfitUgx: 137499.999,
  actualProfitUgx: 125354.165755,
  totalValueUgx: 583687.495755,
  differenceUgx: -12145.833245,
  lateEntry: false,
  requestId: "00000000-0000-4000-8000-0000000000aa",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function previewRate(value: string) {
  fireEvent.change(screen.getByLabelText(/Actual return \(%\)/), {
    target: { value },
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Preview affected totals" }),
    );
  });
}

describe("CycleActualReturnForm", () => {
  it("previews affected totals before an explicit confirmation", async () => {
    vi.mocked(previewCycleActualReturn).mockResolvedValue({
      ok: true,
      message: "Review",
      preview,
    });
    render(<CycleActualReturnForm cycleId={CYCLE} currentBps={null} />);
    expect(screen.queryByRole("button", { name: "Save actual return" })).toBeNull();
    await previewRate("27.35");
    expect(screen.getByText("27.35%")).toBeVisible();
    expect(screen.getByText("UGX 458,333.33")).toBeVisible();
    expect(screen.getByText("UGX 125,354.17")).toBeVisible();
    expect(screen.getByText("UGX 583,687.50")).toBeVisible();
    expect(screen.getByText("−UGX 12,145.83")).toBeVisible();
    expect(screen.getByText(/1 test placement also receive/)).toBeVisible();
    expect(screen.getByRole("checkbox")).toBeRequired();
    expect(
      screen.getByRole("button", { name: "Save actual return" }),
    ).toBeVisible();
  });

  it("withdraws the confirmation when the rate is edited after previewing", async () => {
    vi.mocked(previewCycleActualReturn).mockResolvedValue({
      ok: true,
      message: "Review",
      preview,
    });
    render(<CycleActualReturnForm cycleId={CYCLE} currentBps={null} />);
    await previewRate("27.35");
    fireEvent.change(screen.getByLabelText(/Actual return \(%\)/), {
      target: { value: "28" },
    });
    expect(screen.queryByRole("button", { name: "Save actual return" })).toBeNull();
  });

  it("shows preview errors", async () => {
    vi.mocked(previewCycleActualReturn).mockResolvedValue({
      ok: false,
      message: "The actual return is locked at maturity and can no longer be revised.",
    });
    render(<CycleActualReturnForm cycleId={CYCLE} currentBps={2500} />);
    expect(screen.getByLabelText(/Actual return \(%\)/)).toHaveValue("25");
    await previewRate("26");
    expect(screen.getByRole("alert")).toHaveTextContent("locked at maturity");
  });

  it("hides the confirmation once saved and reports stale saves", async () => {
    vi.mocked(previewCycleActualReturn).mockResolvedValue({
      ok: true,
      message: "Review",
      preview,
    });
    vi.mocked(recordCycleActualReturn).mockResolvedValueOnce({
      ok: false,
      message:
        "the actual return changed since you loaded this page; review the refreshed figures and confirm again",
    });
    render(<CycleActualReturnForm cycleId={CYCLE} currentBps={null} />);
    await previewRate("27.35");
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save actual return" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("changed since you loaded");
    vi.mocked(recordCycleActualReturn).mockResolvedValueOnce({
      ok: true,
      message: "Actual return saved.",
      savedRequestId: preview.requestId,
    });
    // React resets the form after each submission; confirm again.
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save actual return" }));
    });
    expect(screen.getByRole("status")).toHaveTextContent("Actual return saved");
    expect(screen.queryByRole("button", { name: "Save actual return" })).toBeNull();
  });
});

describe("MaturityFulfillmentForm", () => {
  it("uses the cycle's recorded return without an editable ROI", () => {
    const { container } = render(
      <MaturityFulfillmentForm
        instructionId="00000000-0000-4000-8000-000000000002"
        partnerName="Test Partner"
        principalUgx={1000000}
        choice="reinvest_all"
        actualReturn={{ kind: "cycle", actualRoiUgx: 273500, actualReturnBps: 2735 }}
      />,
    );
    expect(screen.queryByLabelText("Actual ROI (UGX)")).toBeNull();
    expect(screen.getByText("UGX 273,500.00")).toBeVisible();
    expect(screen.getByText(/27.35%/)).toBeVisible();
    expect(
      container.querySelector('input[name="actualRoiUgx"]'),
    ).toHaveAttribute("type", "hidden");
  });

  it("keeps per-investment entry for legacy settlement cycles", () => {
    render(
      <MaturityFulfillmentForm
        instructionId="00000000-0000-4000-8000-000000000002"
        partnerName="Test Partner"
        principalUgx={1000000}
        choice="reinvest_all"
        actualReturn={{ kind: "legacy" }}
      />,
    );
    expect(screen.getByLabelText(/Actual ROI \(UGX\)/)).toBeRequired();
  });
});
