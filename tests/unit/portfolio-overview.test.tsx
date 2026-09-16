// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import {
  CurrentOpportunityRate,
  PortfolioSummary,
} from "@/components/PortfolioOverview";
import { bpsToPercent } from "@/lib/format";

afterEach(() => {
  cleanup();
});

async function reveal(label: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: label }));
  return user;
}

describe("bpsToPercent", () => {
  it("derives the percentage from stored basis points", () => {
    expect(bpsToPercent(3000)).toBe(30);
    expect(bpsToPercent(3500)).toBe(35);
    expect(bpsToPercent(3250)).toBe(32.5);
  });
});

describe("PortfolioSummary hints", () => {
  function renderSummary() {
    render(
      <PortfolioSummary
        principal={500000}
        projected={650000}
        activeCount={2}
        totalUnits={4}
        maturedCount={1}
      />,
    );
  }

  it("explains all six overview computed metrics", async () => {
    renderSummary();

    const expectations: Array<[string, string]> = [
      [
        "How active portfolio value is calculated",
        "Sum of principal plus projected returns across your reserved and active placements. Projected amounts are estimates, not guaranteed.",
      ],
      [
        "How principal is calculated",
        "Total amount you contributed across reserved and active placements.",
      ],
      [
        "How projected return is calculated",
        "Portfolio value at maturity minus principal, using each placement's projected rate. This is a projection, not a guarantee.",
      ],
      [
        "How active placements are counted",
        "Number of placements currently reserved or active.",
      ],
      [
        "How units are calculated",
        "Total units across reserved and active placements. Each placement's units equal its principal divided by its unit price.",
      ],
      [
        "How past placements are counted",
        "Number of placements recorded as matured.",
      ],
    ];

    for (const [label, text] of expectations) {
      const user = await reveal(label);
      expect(screen.getByRole("tooltip")).toHaveTextContent(text);
      await user.keyboard("{Escape}");
    }
  });
});

describe("CurrentOpportunityRate", () => {
  it("renders the stored bps value instead of a hardcoded rate", async () => {
    const { rerender } = render(<CurrentOpportunityRate projectedReturnBps={3000} />);
    expect(screen.getByText("30%")).toBeInTheDocument();

    rerender(<CurrentOpportunityRate projectedReturnBps={3500} />);
    expect(screen.getByText("35%")).toBeInTheDocument();
    expect(screen.queryByText("30%")).not.toBeInTheDocument();
  });

  it("explains that the rate is a projection, not a guarantee", async () => {
    render(<CurrentOpportunityRate projectedReturnBps={3500} />);
    await reveal("How the projected return rate works");
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "The rate applied to principal to estimate the payout. This is a projection, not a guarantee.",
    );
  });
});
