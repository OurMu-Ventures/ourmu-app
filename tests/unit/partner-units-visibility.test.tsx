// @vitest-environment jsdom
// Page-level proof that units survive only in the creation flow: the
// dashboard, investments list, and investment detail pages omit unit counts
// and unit pricing even though the underlying rows still carry units, while
// /investments/new still shows per-unit pricing and fractional-unit guidance.
import type { ReactElement, ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DashboardPage from "@/app/(investor)/dashboard/page";
import InvestmentDetailPage from "@/app/(investor)/investments/[id]/page";
import InvestmentsPage from "@/app/(investor)/investments/page";
import NewInvestmentPage from "@/app/(investor)/investments/new/page";
import { InvestmentRequestForm } from "@/components/forms";
import { MaturityInstructionForm } from "@/components/maturity-forms";
import { InvestmentCard } from "@/components/InvestmentCard";
import { DownloadReceiptButton } from "@/components/DownloadReceiptButton";
import {
  CurrentOpportunityRate,
  PortfolioSummary,
} from "@/components/PortfolioOverview";
import { requestInvestment } from "@/actions/investments";
import { requireInvestor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth", () => ({ requireInvestor: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
// Cut the server-only import chain below the pages and the request form.
vi.mock("@/actions/investments", () => ({
  renameInvestment: vi.fn(),
  renameInvestmentForm: vi.fn(),
  cancelInvestment: vi.fn(),
  requestInvestment: vi.fn(),
  activateInvestment: vi.fn(),
}));
vi.mock("@/components/DepositSlips", () => ({ DepositSlips: () => null }));
vi.mock("@/actions/maturity", () => ({}));
vi.mock("@/actions/receipts", () => ({ downloadInvestmentReceipt: vi.fn() }));
vi.mock("@/actions/admin", () => ({}));
vi.mock("@/actions/applications", () => ({}));
vi.mock("@/actions/auth", () => ({}));
vi.mock("@/actions/profile", () => ({}));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));

type Profile = Awaited<ReturnType<typeof requireInvestor>>;
type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

const profile = {
  id: "investor-1",
  role: "investor",
  access_status: "active",
  legal_name: "Test Partner",
  email: "partner@example.com",
  phone: null,
  date_of_birth: null,
  address: null,
  district: null,
  country: null,
  kyc_status: "verified",
  is_test: false,
  onboarding_completed_at: null,
} as unknown as Profile;

const placement = {
  id: "inv-1",
  status: "active",
  principal_ugx: 250000,
  projected_value_ugx: 325000,
  projected_return_ugx: 75000,
  reported_return_ugx: null,
  reported_payout_ugx: null,
  payout_basis: "projected",
  units: 2.5,
  unit_price_ugx: 125000,
  maturity_date: "2026-07-15T12:00:00.000Z",
  // Requested mid-cycle, after the term opened: the displayed duration must
  // follow the cycle term start below, not this reservation timestamp.
  requested_at: "2026-02-02T09:00:00.000Z",
  reservation_expires_at: null,
  record_origin: "portal",
  investment_cycles: {
    name: "Cycle One",
    status: "open",
    maturity_date: "2026-07-15T12:00:00.000Z",
    opens_at: "2026-01-05T06:00:00.000Z",
    closes_at: "2026-02-01T20:59:59.000Z",
  },
  investment_agreements: [],
};

// Midday mid-month fixture timestamps keep the calendar month stable in every
// timezone, unlike midnight boundary timestamps.
const CYCLE_TITLE = "Cycle One cycle";

const cycle = {
  id: "cycle-1",
  name: "Cycle One",
  status: "open",
  unit_price_ugx: 125000,
  projected_return_bps: 3000,
  maturity_date: "2026-07-15T12:00:00.000Z",
  opens_at: "2020-01-01T00:00:00.000Z",
  closes_at: "2099-02-01T00:00:00.000Z",
  agreement_versions: [
    { id: "agr-1", title: "Current agreement", version: 1, content_hash: "abc" },
  ],
};

// Minimal thenable-free query builder: terminal reads expose { data }
// directly, while maybeSingle() resolves { data } like the real client.
function queryFor(data: unknown) {
  let selected = data;
  const terminal = { data } as { data: unknown } & Record<string, (...args: unknown[]) => unknown>;
  terminal.select = () => terminal;
  terminal.eq = () => terminal;
  terminal.neq = (field, value) => {
    if (typeof field === "string" && Array.isArray(selected)) {
      selected = selected.filter((row) => row[field] !== value);
      terminal.data = selected;
    }
    return terminal;
  };
  terminal.lte = (field, value) => {
    if (field === "opens_at" && selected && typeof selected === "object" &&
        "opens_at" in selected && String(selected.opens_at) > String(value)) selected = null;
    return terminal;
  };
  terminal.gt = (field, value) => {
    if (field === "closes_at" && selected && typeof selected === "object" &&
        "closes_at" in selected && String(selected.closes_at) <= String(value)) selected = null;
    return terminal;
  };
  terminal.order = () => terminal;
  terminal.maybeSingle = () => Promise.resolve({ data: selected });
  return terminal;
}

function mockClient(tables: Record<string, unknown>) {
  vi.mocked(createClient).mockResolvedValue({
    from: (table: string) => queryFor(tables[table] ?? null),
  } as unknown as SupabaseClient);
}

// Walk a server-rendered element tree without invoking nested components,
// so client hooks never run.
function walk(node: ReactNode): ReactElement[] {
  const out: ReactElement[] = [];
  const visit = (current: ReactNode): void => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (
      current !== null &&
      typeof current === "object" &&
      "type" in current &&
      "props" in current
    ) {
      const element = current as ReactElement;
      out.push(element);
      visit(
        (element.props as { children?: ReactNode }).children ?? null,
      );
    }
  };
  visit(node);
  return out;
}

function collectText(node: ReactNode): string {
  const parts: string[] = [];
  // Only rendered children count: props such as hrefs or item payloads are
  // asserted separately so route names cannot skew the text match.
  const visitChildren = (current: ReactNode): void => {
    if (typeof current === "string" || typeof current === "number") {
      parts.push(String(current));
      return;
    }
    if (Array.isArray(current)) {
      current.forEach(visitChildren);
      return;
    }
    if (current !== null && typeof current === "object" && "props" in current) {
      visitChildren(
        (current as { props: { children?: ReactNode } }).props.children ??
          null,
      );
    }
  };
  visitChildren(node);
  return parts.join(" ");
}

function cardItems(elements: ReactElement[]): Record<string, unknown>[] {
  return elements
    .filter((element) => element.type === InvestmentCard)
    .map(
      (element) =>
        (element.props as { item: Record<string, unknown> }).item,
    );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireInvestor).mockResolvedValue(profile);
});

afterEach(() => {
  cleanup();
});

describe("cancelled investments in partner portfolios", () => {
  it.each([
    ["dashboard", DashboardPage],
    ["investments list", InvestmentsPage],
  ])("%s hides cancelled placements while retaining every other status", async (_, page) => {
    const statuses = ["reserved", "active", "matured", "rejected", "expired", "cancelled"];
    mockClient({
      investments: statuses.map((status) => ({ ...placement, id: status, status })),
      investment_cycles: cycle,
      next_of_kin: { id: "kin-1" },
    });

    const elements = walk(await page());
    expect(cardItems(elements).map((item) => item.investmentId)).toEqual(
      statuses.filter((status) => status !== "cancelled"),
    );
    if (page === DashboardPage) {
      const summary = elements.find((element) => element.type === PortfolioSummary);
      expect(summary?.props).toMatchObject({
        activeCount: 2,
        maturedCount: 1,
        principal: 500000,
        projected: 650000,
      });
    }
  });

  it.each([
    ["dashboard", DashboardPage, "Your placements will appear here once recorded."],
    ["investments list", InvestmentsPage, "No investment records yet."],
  ])("%s shows its empty state when all placements are cancelled", async (_, page, message) => {
    mockClient({
      investments: [{ ...placement, status: "cancelled" }],
      investment_cycles: cycle,
      next_of_kin: { id: "kin-1" },
    });

    const tree = await page();
    expect(cardItems(walk(tree))).toHaveLength(0);
    expect(collectText(tree)).toContain(message);
  });
});

describe("partner units visibility across pages", () => {
  it.each(["portal", "legacy_import"])(
    "links matured %s investments to their available maturity choices",
    async (recordOrigin) => {
    const matured = { ...placement, status: "matured", record_origin: recordOrigin };
    mockClient({
      investments: [matured],
      investment_cycles: cycle,
      next_of_kin: { id: "kin-1" },
      maturity_instructions: null,
      payout_destinations: [],
    });

    const dashboard = cardItems(walk(await DashboardPage()));
    expect(dashboard[0]).toMatchObject({
      detailHref: "/investments/inv-1",
      detailLabel: "Withdraw or Re-invest",
      detailAction: true,
    });

    mockClient({
      investments: matured,
      investment_cycles: [],
      maturity_instructions: null,
      payout_destinations: [],
    });
    const detail = walk(await InvestmentDetailPage({
      params: Promise.resolve({ id: "inv-1" }),
    }));
    expect(detail.some((element) => element.type === MaturityInstructionForm)).toBe(true);
    },
  );

  it("hides a past-deadline cycle from the dashboard and investment form", async () => {
    mockClient({
      investments: [],
      investment_cycles: { ...cycle, closes_at: "2026-09-15T21:00:00.000Z" },
      next_of_kin: { id: "kin-1" },
    });
    expect(collectText(await DashboardPage())).toMatch(/No cycle is open/);
    expect(collectText(await NewInvestmentPage())).toMatch(/No cycle is open/);
  });

  it("dashboard omits units while keeping projected return and maturity", async () => {
    mockClient({
      investments: [placement],
      investment_cycles: cycle,
      next_of_kin: { id: "kin-1" },
    });

    const tree = await DashboardPage();
    const text = collectText(tree);

    expect(text).toMatch(/projected return/i);
    expect(text).toMatch(/maturity/i);
    expect(text).not.toMatch(/\bunits\b/i);
    expect(text).not.toMatch(/unit price/i);
    expect(text).not.toMatch(/how units are calculated/i);

    const elements = walk(tree);
    const summary = elements.find(
      (element) => element.type === PortfolioSummary,
    );
    expect(summary).toBeDefined();
    expect(summary?.props as Record<string, unknown>).not.toHaveProperty(
      "totalUnits",
    );
    expect(summary?.props as Record<string, unknown>).toMatchObject({
      activeCount: 1,
    });

    const rate = elements.find(
      (element) => element.type === CurrentOpportunityRate,
    );
    expect(rate?.props as Record<string, unknown>).toMatchObject({
      projectedReturnBps: 3000,
    });

    const items = cardItems(elements);
    expect(items).toHaveLength(1);
    for (const item of items) {
      expect(item).not.toHaveProperty("unitsValue");
      expect(item).not.toHaveProperty("unitPriceUgx");
    }
    expect(items[0]).toMatchObject({ name: CYCLE_TITLE });
  });

  it("investments list omits units from every card", async () => {
    mockClient({ investments: [placement] });

    const tree = await InvestmentsPage();
    const text = collectText(tree);

    expect(text).toMatch(/investments/i);
    expect(text).not.toMatch(/\bunits\b/i);
    expect(text).not.toMatch(/how units are calculated/i);

    const items = cardItems(walk(tree));
    expect(items).toHaveLength(1);
    for (const item of items) {
      expect(item).not.toHaveProperty("unitsValue");
      expect(item).not.toHaveProperty("unitPriceUgx");
    }
    expect(items[0]).toMatchObject({ name: CYCLE_TITLE });
  });

  it("investment detail names the cycle with a status badge and no units", async () => {
    mockClient({ investments: placement });

    const tree = await InvestmentDetailPage({
      params: Promise.resolve({ id: "inv-1" }),
    });
    const elements = walk(tree);
    const text = collectText(tree);

    const heading = elements.find((element) => element.type === "h1");
    expect(collectText(heading ?? null)).toBe(CYCLE_TITLE);

    const badges = elements
      .filter(
        (element) =>
          element.type === "span" &&
          String(
            (element.props as { className?: unknown }).className ?? "",
          ).includes("badge"),
      )
      .map((element) => collectText(element));
    expect(badges.join(" ")).toMatch(/active/i);
    expect(text).not.toMatch(/\bunits\b/i);
    expect(text).toMatch(/Investment window/i);
    expect(text).not.toMatch(/Duration:/i);
    expect(text).not.toMatch(/january 2026 - july 2026/i);
  });

  it("keeps prior-month cycle windows separate from receipt dates and pending destinations", async () => {
    const investment = {
      ...placement,
      status: "matured",
      investment_cycles: {
        ...placement.investment_cycles,
        name: "October 2026",
        opens_at: "2026-09-24T21:00:00Z",
      },
      investment_receipts: {
        source: "reinvestment",
        transaction_date: "2026-10-20",
      },
      maturity_instructions: {
        status: "requested",
        choice: "reinvest_all",
        investment_cycles: {
          name: "November 2026",
          maturity_date: "2027-04-30",
        },
      },
    };
    mockClient({ investments: [investment], investment_cycles: cycle });
    for (const tree of [await DashboardPage(), await InvestmentsPage()]) {
      expect(cardItems(walk(tree))[0]).toMatchObject({
        defaultTitle: "October 2026 cycle",
        recordedDate: { label: "Reinvested", value: "2026-10-20" },
        pendingReinvestment: {
          name: "November 2026",
          maturity_date: "2027-04-30",
        },
      });
    }
  });

  it.each([
    { status: "requested", choice: "reinvest_all", hasTarget: true, pending: true },
    { status: "processing", choice: "reinvest_all", hasTarget: true, pending: true },
    { status: "requested", choice: "withdraw_all", hasTarget: true, pending: false },
    { status: "processing", choice: "reinvest_all", hasTarget: false, pending: false },
  ])("keeps pending cycle notices consistent for $status $choice with target=$hasTarget", async ({ status, choice, hasTarget, pending }) => {
    const target = hasTarget ? { ...cycle, name: "November 2026", maturity_date: "2027-04-30" } : null;
    const instruction = { status, choice, target_cycle_id: hasTarget ? "target-cycle" : null,
      projected_payout_ugx: 0, projected_reinvest_ugx: 325000, investment_cycles: target };
    const investment = { ...placement, status: "matured", maturity_instructions: instruction };
    mockClient({ investments: [investment], investment_cycles: target });
    for (const tree of [await DashboardPage(), await InvestmentsPage()]) {
      expect(cardItems(walk(tree))[0].pendingReinvestment).toEqual(pending ? target : null);
    }
    mockClient({ investments: investment, maturity_instructions: instruction, investment_cycles: target });
    const text = collectText(await InvestmentDetailPage({ params: Promise.resolve({ id: "inv-1" }) }));
    expect((text.match(/Reinvestment pending/g) ?? []).length).toBe(pending ? 1 : 0);
    expect((text.match(/November 2026 cycle/g) ?? []).length).toBe(pending ? 1 : 0);
    expect(text).not.toContain("assigned cycle");
  });

  it("new-investment page shows return and maturity without a per-unit card", async () => {
    mockClient({
      investment_cycles: cycle,
      next_of_kin: { id: "kin-1" },
      bank_instructions: null,
    });

    const tree = await NewInvestmentPage();
    const text = collectText(tree);

    expect(text).not.toMatch(/per unit/i);
    expect(text).toMatch(/projected return/i);
    expect(text).toMatch(/maturity/i);
    expect(text).toMatch(/cycle one/i);

    const elements = walk(tree);
    const form = elements.find(
      (element) => element.type === InvestmentRequestForm,
    );
    expect(form?.props as Record<string, unknown>).toMatchObject({
      cycleId: "cycle-1",
      agreementId: "agr-1",
    });
  });

  it("creation flow keeps fractional-unit guidance", () => {
    render(
      <InvestmentRequestForm
        cycleId="cycle-1"
        agreementId="agr-1"
        agreementTitle="Current agreement"
      />,
    );

    expect(
      screen.getByText(/fractional units are calculated automatically/i),
    ).toBeInTheDocument();
  });
});

describe("partner limit in the existing investment form", () => {
  it.each([50_000_000, 100_000_000])(
    "uses the effective maximum %s",
    (limitUgx) => {
      render(
        <InvestmentRequestForm
          cycleId="cycle-1"
          agreementId="agr-1"
          agreementTitle="Agreement"
          limitUgx={limitUgx}
        />,
      );
      const amount = screen.getByLabelText(/investment amount/i) as HTMLInputElement;
      fireEvent.change(amount, { target: { value: String(limitUgx + 1) } });
      expect(amount.checkValidity()).toBe(false);

      fireEvent.change(amount, { target: { value: String(limitUgx) } });
      expect(amount.checkValidity()).toBe(true);
      expect(amount).toHaveValue(limitUgx.toLocaleString("en-UG"));
      expect(new FormData(amount.form!).get("principalUgx")).toBe(String(limitUgx));
      expect(screen.getByText(/minimum UGX/i).textContent).toContain(
        limitUgx.toLocaleString("en-UG"),
      );
    },
  );
  it("checks decimals, the minimum and malformed input", () => {
    render(
      <InvestmentRequestForm
        cycleId="cycle-1"
        agreementId="agr-1"
        agreementTitle="Agreement"
      />,
    );
    const amount = screen.getByLabelText(/investment amount/i) as HTMLInputElement;
    const principal = () => new FormData(amount.form!).get("principalUgx");

    fireEvent.change(amount, { target: { value: "125000.5" } });
    expect(amount.checkValidity()).toBe(true);
    expect(principal()).toBe("125000.5");
    expect(screen.getByText(/amount to reserve/i).textContent).toContain(
      "125,000.50",
    );

    fireEvent.change(amount, { target: { value: "125000.555" } });
    expect(amount.checkValidity()).toBe(false);

    fireEvent.change(amount, { target: { value: "124999" } });
    expect(amount.checkValidity()).toBe(false);
    expect(screen.queryByText(/amount to reserve/i)).not.toBeInTheDocument();

    fireEvent.change(amount, { target: { value: "12a" } });
    expect(amount).toHaveValue("12a");
    expect(amount.checkValidity()).toBe(false);
  });

  it("shows the amount error inline once the field is left", () => {
    render(
      <InvestmentRequestForm
        cycleId="cycle-1"
        agreementId="agr-1"
        agreementTitle="Agreement"
      />,
    );
    const amount = screen.getByLabelText(/investment amount/i);
    fireEvent.change(amount, { target: { value: "1000" } });
    expect(screen.queryByText(/enter an amount between/i)).not.toBeInTheDocument();

    fireEvent.blur(amount);
    expect(amount).toHaveAttribute("aria-invalid", "true");
    expect(amount).toHaveAccessibleDescription(/enter an amount between/i);
  });

  it("clears the amount after a successful reservation", async () => {
    vi.mocked(requestInvestment).mockResolvedValue({
      ok: true,
      message: "Investment reserved.",
    });
    render(
      <InvestmentRequestForm
        cycleId="cycle-1"
        agreementId="agr-1"
        agreementTitle="Agreement"
      />,
    );
    const amount = screen.getByLabelText(/investment amount/i) as HTMLInputElement;
    fireEvent.change(amount, { target: { value: "500000" } });
    expect(amount).toHaveValue("500,000");

    await act(async () => {
      fireEvent.submit(amount.form!);
    });
    await waitFor(() => expect(amount).toHaveValue(""));
    expect(new FormData(amount.form!).get("principalUgx")).toBe("");
    expect(screen.queryByText(/amount to reserve/i)).not.toBeInTheDocument();
  });

  it("passes the authenticated partner override from the page", async () => {
    vi.mocked(requireInvestor).mockResolvedValue({
      ...profile,
      investment_limit_ugx: 100_000_000,
    });
    mockClient({
      investment_cycles: cycle,
      next_of_kin: { id: "kin-1" },
      bank_instructions: null,
    });
    const tree = await NewInvestmentPage();
    const form = walk(tree).find(
      (element) => element.type === InvestmentRequestForm,
    );
    expect(form?.props as Record<string, unknown>).toMatchObject({
      limitUgx: 100_000_000,
    });
  });
});

describe("receipt availability on investment details", () => {
  it.each([
    ["portal", null],
    ["legacy_import", null],
    [
      "portal",
      {
        id: "receipt-1",
        receipt_number: "OURMU-2026-1",
        pdf_status: "generating",
      },
    ],
    [
      "legacy_import",
      { id: "receipt-1", receipt_number: "OURMU-2026-1", pdf_status: "failed" },
    ],
    [
      "portal",
      { id: "receipt-1", receipt_number: "OURMU-2026-1", pdf_status: "ready" },
    ],
  ])(
    "active %s investment offers a download with receipt state %j",
    async (origin, receipt) => {
      mockClient({
        investments: {
          ...placement,
          record_origin: origin,
          status: "active",
          maturity_date: "2099-02-28",
          investment_receipts: receipt ? [receipt] : [],
        },
      });
      const tree = await InvestmentDetailPage({
        params: Promise.resolve({ id: placement.id }),
      });
      const download = walk(tree).find(
        (element) => element.type === DownloadReceiptButton,
      );
      expect(download?.props).toMatchObject({ investmentId: placement.id });
      expect(collectText(tree)).not.toContain("Receipt generation pending");
    },
  );

  it.each(["reserved", "expired", "cancelled"])(
    "%s unpaid investment does not offer a receipt",
    async (status) => {
      mockClient({
        investments: { ...placement, status, investment_receipts: [] },
      });
      const tree = await InvestmentDetailPage({
        params: Promise.resolve({ id: placement.id }),
      });
      expect(
        walk(tree).some((element) => element.type === DownloadReceiptButton),
      ).toBe(false);
    },
  );
});
