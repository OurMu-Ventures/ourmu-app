// @vitest-environment jsdom
// Page-level proof that units survive only in the creation flow: the
// dashboard, investments list, and investment detail pages omit unit counts
// and unit pricing even though the underlying rows still carry units, while
// /investments/new still shows per-unit pricing and fractional-unit guidance.
import type { ReactElement, ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DashboardPage from "@/app/(investor)/dashboard/page";
import InvestmentDetailPage from "@/app/(investor)/investments/[id]/page";
import InvestmentsPage from "@/app/(investor)/investments/page";
import NewInvestmentPage from "@/app/(investor)/investments/new/page";
import { InvestmentRequestForm } from "@/components/forms";
import { InvestmentCard } from "@/components/InvestmentCard";
import {
  CurrentOpportunityRate,
  PortfolioSummary,
} from "@/components/PortfolioOverview";
import { requireInvestor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth", () => ({ requireInvestor: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
// Cut the server-only import chain below the pages and the request form.
vi.mock("@/actions/investments", () => ({
  cancelInvestment: vi.fn(),
  requestInvestment: vi.fn(),
  activateInvestment: vi.fn(),
}));
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
  requested_at: "2026-01-15T12:00:00.000Z",
  reservation_expires_at: null,
  record_origin: "portal",
  investment_cycles: {
    name: "Cycle One",
    status: "open",
    maturity_date: "2026-07-15T12:00:00.000Z",
  },
  investment_agreements: [],
};

// Midday mid-month fixture timestamps keep the calendar month stable in every
// timezone, unlike midnight boundary timestamps.
const DURATION = "January 2026 - July 2026";

const cycle = {
  id: "cycle-1",
  name: "Cycle One",
  status: "open",
  unit_price_ugx: 125000,
  projected_return_bps: 3000,
  maturity_date: "2026-07-15T12:00:00.000Z",
  closes_at: "2026-02-01T00:00:00.000Z",
  agreement_versions: [
    { id: "agr-1", title: "Current agreement", version: 1, content_hash: "abc" },
  ],
};

// Minimal thenable-free query builder: terminal reads expose { data }
// directly, while maybeSingle() resolves { data } like the real client.
function queryFor(data: unknown) {
  const terminal = { data } as { data: unknown } & Record<string, () => unknown>;
  terminal.select = () => terminal;
  terminal.eq = () => terminal;
  terminal.order = () => terminal;
  terminal.maybeSingle = () => Promise.resolve({ data });
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

describe("partner units visibility across pages", () => {
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
    expect(items[0]).toMatchObject({ name: DURATION });
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
    expect(items[0]).toMatchObject({ name: DURATION });
  });

  it("investment detail uses an 'Investment details' heading with a status badge and no units", async () => {
    mockClient({ investments: placement });

    const tree = await InvestmentDetailPage({
      params: Promise.resolve({ id: "inv-1" }),
    });
    const elements = walk(tree);
    const text = collectText(tree);

    const heading = elements.find((element) => element.type === "h1");
    expect(collectText(heading ?? null)).toMatch(/investment details/i);

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
    expect(text).toMatch(/duration/i);
    expect(text).toMatch(/january 2026 - july 2026/i);
  });

  it("new-investment page keeps per-unit pricing in the creation flow", async () => {
    mockClient({
      investment_cycles: cycle,
      next_of_kin: { id: "kin-1" },
      bank_instructions: null,
    });

    const tree = await NewInvestmentPage();
    const text = collectText(tree);

    expect(text).toMatch(/per unit/i);
    expect(text).toMatch(/125,000/);
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
