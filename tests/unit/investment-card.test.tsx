// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import {
  InvestmentCard,
  type InvestmentCardData,
} from "@/components/InvestmentCard";

afterEach(() => {
  cleanup();
});

const baseItem: InvestmentCardData = {
  name: "Cycle One",
  status: "active",
  statusLabel: "Active",
  principalUgx: 250000,
  unitsValue: 2,
  unitPriceUgx: 125000,
  profitUgx: 75000,
  payoutUgx: 325000,
  maturityDate: "2026-07-01T00:00:00.000Z",
  startIso: "2026-01-01T00:00:00.000Z",
  detailHref: "/investments/1",
  detailLabel: "View details",
  detailStatus: "Opening investment details",
};

async function reveal(label: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: label }));
  return user;
}

describe("InvestmentCard computed-metric hints", () => {
  it("explains principal and units in the header", async () => {
    render(<InvestmentCard item={baseItem} />);

    let user = await reveal("How principal is calculated");
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Amount you contributed to this placement.",
    );
    await user.keyboard("{Escape}");

    user = await reveal("How units are calculated");
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Your principal divided by this placement's unit price.",
    );
  });

  it("explains projected profit and total for non-paid placements", async () => {
    render(<InvestmentCard item={{ ...baseItem, isPaid: false }} />);

    let user = await reveal("How profit is calculated");
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Total payout minus principal, using this placement's projected rate. This is a projection, not a guarantee.",
    );
    await user.keyboard("{Escape}");

    user = await reveal("How total at maturity is calculated");
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Principal plus projected profit. This is a projection, not a guarantee.",
    );
  });

  it("explains profit and total with recorded amounts for paid placements", async () => {
    render(<InvestmentCard item={{ ...baseItem, isPaid: true }} />);

    let user = await reveal("How profit is calculated");
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Total payout minus principal, using the recorded paid amount.",
    );
    await user.keyboard("{Escape}");

    user = await reveal("How total at maturity is calculated");
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "The recorded payout for this paid placement.",
    );
  });

  it("explains maturity progress", async () => {
    render(<InvestmentCard item={baseItem} />);

    await reveal("How maturity progress is calculated");
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Time elapsed between placement creation and maturity. Matured or past-due placements show 100%.",
    );
  });

  it("exposes exactly five computed-metric hints and no hint on maturity date", async () => {
    render(<InvestmentCard item={baseItem} />);
    const buttons = screen.getAllByRole("button", { name: /^How / });
    expect(buttons).toHaveLength(5);
    expect(
      screen.queryByRole("button", { name: /maturity date/i }),
    ).not.toBeInTheDocument();
  });
});
