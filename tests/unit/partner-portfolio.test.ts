import { describe, expect, it } from "vitest";

import { date, ugx } from "@/lib/format";
import {
  basisMix,
  describeInvestment,
  filterPartners,
  maskPhone,
  newestFirst,
  paginate,
  parsePage,
  parsePartnerFilter,
  parsePartnerRef,
  parsePortfolioFilter,
  portfolioCycles,
  portfolioHref,
  safeReturnPath,
  summarizePortfolio,
  type PartnerListing,
  type PortfolioInvestmentRow,
} from "@/lib/partner-portfolio";

const NOW = new Date("2026-11-02T09:00:00Z");
const PROFILE_ID = "5a1c7f9e-2b4d-4e6f-8a0b-1c2d3e4f5a6b";
const LEGACY_ID = "73a1f123-cdb8-5359-9075-f36604131850";
const CYCLE_JUNE = "c1000000-0000-4000-8000-000000000001";
const CYCLE_DEC = "c1000000-0000-4000-8000-000000000002";

const juneCycle = {
  name: "June 2026",
  opens_at: "2026-06-01T00:00:00+00:00",
  actual_return_bps: null,
  legacy_settlement: false,
};

let sequence = 0;
function row(
  overrides: Partial<PortfolioInvestmentRow> = {},
): PortfolioInvestmentRow {
  sequence += 1;
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    cycle_id: CYCLE_JUNE,
    status: "active",
    record_origin: "portal",
    alias: null,
    principal_ugx: 1_000_000,
    projected_return_ugx: 300_000,
    projected_value_ugx: 1_300_000,
    maturity_date: "2026-12-31",
    requested_at: "2026-06-02T10:00:00+00:00",
    payout_basis: "projected",
    reported_return_ugx: null,
    reported_payout_ugx: null,
    is_test: false,
    administratively_archived_at: null,
    offline_settlement_id: null,
    investment_cycles: juneCycle,
    import_batches: null,
    maturity_instructions: null,
    investment_receipts: null,
    offline_reinvestment_authorizations: [],
    ...overrides,
  };
}

function matured(overrides: Partial<PortfolioInvestmentRow> = {}) {
  return row({
    status: "matured",
    maturity_date: "2026-09-30",
    ...overrides,
  });
}

function instruction(
  overrides: Partial<
    NonNullable<PortfolioInvestmentRow["maturity_instructions"]>
  > = {},
): NonNullable<PortfolioInvestmentRow["maturity_instructions"]> {
  return {
    status: "fulfilled",
    choice: "withdraw_all",
    needs_resolution: false,
    actual_payout_ugx: 1_300_000,
    actual_reinvest_ugx: 0,
    fulfilled_at: "2026-10-15T12:00:00+00:00",
    ...overrides,
  };
}

describe("partner references", () => {
  it("accepts profile and imported identity IDs, including deterministic import IDs", () => {
    expect(parsePartnerRef("profile", PROFILE_ID)).toEqual({
      kind: "profile",
      id: PROFILE_ID,
    });
    expect(parsePartnerRef("legacy", LEGACY_ID.toUpperCase())).toEqual({
      kind: "legacy",
      id: LEGACY_ID,
    });
  });

  it("rejects unknown kinds and anything that is not a plain identifier", () => {
    expect(parsePartnerRef("admin", PROFILE_ID)).toBeNull();
    expect(parsePartnerRef("profile", "profile-1")).toBeNull();
    expect(
      parsePartnerRef("profile", `${PROFILE_ID},investor_id.not.is.null`),
    ).toBeNull();
    expect(parsePartnerRef("legacy", "")).toBeNull();
  });

  it("parses the investments register filter value", () => {
    expect(parsePartnerFilter(`profile:${PROFILE_ID}`)).toEqual({
      kind: "profile",
      id: PROFILE_ID,
    });
    expect(parsePartnerFilter(`legacy:${LEGACY_ID}`)?.kind).toBe("legacy");
    expect(parsePartnerFilter(PROFILE_ID)).toBeNull();
    expect(parsePartnerFilter("profile:")).toBeNull();
    expect(parsePartnerFilter(`profile:${PROFILE_ID}:extra`)).toBeNull();
  });

  it("builds portfolio links that keep filters and the return path", () => {
    const ref = { kind: "profile" as const, id: PROFILE_ID };
    expect(portfolioHref(ref)).toBe(`/admin/partners/profile/${PROFILE_ID}`);
    expect(
      portfolioHref(ref, {
        status: "all",
        page: 1,
        from: "/admin/partners?q=jane",
      }),
    ).toBe(
      `/admin/partners/profile/${PROFILE_ID}?from=%2Fadmin%2Fpartners%3Fq%3Djane`,
    );
    expect(
      portfolioHref(ref, { status: "settled", cycle: CYCLE_JUNE, page: 3 }),
    ).toBe(
      `/admin/partners/profile/${PROFILE_ID}?status=settled&cycle=${CYCLE_JUNE}&page=3`,
    );
  });

  it("only returns to the partner-finding lists", () => {
    expect(safeReturnPath("/admin/partners?q=jane&page=2")).toBe(
      "/admin/partners?q=jane&page=2",
    );
    expect(safeReturnPath("/admin/investments?partnerSearch=jane")).toBe(
      "/admin/investments?partnerSearch=jane",
    );
    for (const value of [
      undefined,
      "",
      "https://evil.example/admin/partners",
      "//evil.example/admin/partners",
      "/\\evil.example/admin/partners",
      "/admin/cycles",
      "/admin/partners/../cycles",
      `/admin/partners?q=${"x".repeat(600)}`,
    ])
      expect(safeReturnPath(value)).toBeNull();
  });

  it("parses page numbers and filters defensively", () => {
    expect(parsePage("3")).toBe(3);
    for (const value of ["", "0", "-1", "1.5", "abc", "9999999"])
      expect(parsePage(value)).toBe(1);
    expect(parsePortfolioFilter("awaiting")).toBe("awaiting");
    expect(parsePortfolioFilter("bogus")).toBeNull();
  });

  it("paginates in memory and clamps pages beyond the end", () => {
    const items = Array.from({ length: 30 }, (_, index) => index);
    expect(paginate(items, 2)).toMatchObject({
      page: 2,
      pageCount: 2,
      total: 30,
      first: 26,
      last: 30,
    });
    expect(paginate(items, 9).page).toBe(2);
    expect(paginate([], 1)).toMatchObject({ pageCount: 1, first: 0, last: 0 });
  });
});

describe("partner search", () => {
  const listing = (overrides: Partial<PartnerListing>): PartnerListing => ({
    ref: { kind: "profile", id: PROFILE_ID },
    name: "Jane Doe",
    email: "jane@example.test",
    additionalEmails: [],
    importedNames: [],
    accessStatus: "active",
    kycStatus: "verified",
    isTest: false,
    phoneHint: null,
    importAccepted: true,
    ...overrides,
  });

  it("matches every word in any order, ignoring case and accents", () => {
    const partners = [
      listing({ name: "Jane Doe" }),
      listing({ name: "Zoë Mukasa", email: "zoe@example.test" }),
    ];
    expect(
      filterPartners(partners, "doe JANE").map((item) => item.name),
    ).toEqual(["Jane Doe"]);
    expect(filterPartners(partners, "zoe").map((item) => item.name)).toEqual([
      "Zoë Mukasa",
    ]);
    expect(filterPartners(partners, "  ")).toHaveLength(2);
    expect(filterPartners(partners, "%_")).toHaveLength(0);
  });

  it("matches primary and verified additional emails and imported names, never pending emails", () => {
    const partner = listing({
      additionalEmails: [
        { email: "verified@example.test", verified: true },
        { email: "pending@example.test", verified: false },
      ],
      importedNames: ["J. Doe-Spreadsheet"],
    });
    expect(filterPartners([partner], "jane@example")).toHaveLength(1);
    expect(filterPartners([partner], "verified@example")).toHaveLength(1);
    expect(filterPartners([partner], "pending@example")).toHaveLength(0);
    expect(filterPartners([partner], "spreadsheet")).toHaveLength(1);
  });

  it("masks phone numbers to their last four digits", () => {
    expect(maskPhone("+256 700 123 456")).toBe("•••• 3456");
    expect(maskPhone("12")).toBeNull();
    expect(maskPhone(null)).toBeNull();
  });
});

describe("portfolio records", () => {
  it("keeps reservations separate from active capital", () => {
    const summary = summarizePortfolio(
      [
        row({ principal_ugx: 1_000_000 }),
        row({ status: "reserved", principal_ugx: 500_000 }),
      ].map((item) => describeInvestment(item, NOW)),
    );
    expect(summary.active).toMatchObject({
      count: 1,
      principalUgx: 1_000_000,
      valueUgx: 1_300_000,
      actualCount: 0,
    });
    expect(summary.reserved).toEqual({ count: 1, principalUgx: 500_000 });
  });

  it("uses the recorded cycle return where present and labels the mix", () => {
    const actual = describeInvestment(
      row({ investment_cycles: { ...juneCycle, actual_return_bps: 2500 } }),
      NOW,
    );
    expect(actual).toMatchObject({
      valueBasis: "actual",
      valueUgx: 1_250_000,
      revisable: true,
    });
    const summary = summarizePortfolio([
      actual,
      describeInvestment(row(), NOW),
    ]);
    expect(summary.active.valueUgx).toBe(2_550_000);
    expect(
      basisMix(summary.active.count, summary.active.actualCount, "Projected"),
    ).toBe("Mixed: 1 actual, 1 projected");
    expect(basisMix(2, 2, "Projected")).toBe("Actual");
    expect(basisMix(2, 0, "Estimated")).toBe("Estimated");
    expect(basisMix(0, 0, "Projected")).toBeNull();
  });

  it("estimates matured records without a confirmed return and counts them as awaiting settlement", () => {
    const estimated = describeInvestment(matured(), NOW);
    const confirmed = describeInvestment(
      matured({ investment_cycles: { ...juneCycle, actual_return_bps: 3200 } }),
      NOW,
    );
    expect(estimated).toMatchObject({
      state: "awaiting",
      valueBasis: "estimated",
      valueUgx: 1_300_000,
      settlement: "Awaiting maturity choice",
    });
    expect(confirmed).toMatchObject({
      state: "awaiting",
      valueBasis: "actual",
      valueUgx: 1_320_000,
      revisable: false,
    });
    expect(summarizePortfolio([estimated, confirmed]).awaiting).toEqual({
      count: 2,
      principalUgx: 2_000_000,
      valueUgx: 2_620_000,
      actualCount: 1,
    });
  });

  it("describes pending maturity instructions and offline authorizations", () => {
    expect(
      describeInvestment(
        matured({
          maturity_instructions: instruction({
            status: "requested",
            choice: "reinvest_all",
          }),
        }),
        NOW,
      ).settlement,
    ).toBe("C. Dobolo Payout requested");
    expect(
      describeInvestment(
        matured({
          maturity_instructions: instruction({ status: "processing" }),
        }),
        NOW,
      ).settlement,
    ).toBe("A. Bijjodolo payout processing");
    expect(
      describeInvestment(
        matured({
          maturity_instructions: instruction({
            status: "processing",
            needs_resolution: true,
          }),
        }),
        NOW,
      ).settlement,
    ).toBe("A. Bijjodolo payout held for resolution");
    const offline = describeInvestment(
      matured({
        record_origin: "legacy_import",
        import_batches: { status: "accepted" },
        offline_reinvestment_authorizations: [
          { status: "revoked", amount_ugx: 1_300_000 },
          { status: "recorded", amount_ugx: 1_300_000 },
        ],
      }),
      NOW,
    );
    expect(offline).toMatchObject({
      state: "awaiting",
      settlement: "Offline reinvestment recorded; awaiting completion",
    });
  });

  it("treats paid, reinvested and reported-paid records as settled history outside the totals", () => {
    const paid = describeInvestment(
      matured({ maturity_instructions: instruction() }),
      NOW,
    );
    const reinvested = describeInvestment(
      matured({
        maturity_instructions: instruction({
          choice: "reinvest_all",
          actual_payout_ugx: 0,
          actual_reinvest_ugx: 1_320_000,
        }),
      }),
      NOW,
    );
    const split = describeInvestment(
      matured({
        maturity_instructions: instruction({
          choice: "withdraw_roi_reinvest_principal",
          actual_payout_ugx: 320_000,
          actual_reinvest_ugx: 1_000_000,
        }),
      }),
      NOW,
    );
    const reportedPaid = describeInvestment(
      matured({
        record_origin: "legacy_import",
        import_batches: { status: "accepted" },
        payout_basis: "reported_paid",
        reported_return_ugx: 350_000,
        reported_payout_ugx: 1_350_000,
      }),
      NOW,
    );
    const offline = describeInvestment(
      matured({
        record_origin: "legacy_import",
        import_batches: { status: "accepted" },
        offline_settlement_id: "a1000000-0000-4000-8000-000000000001",
        offline_reinvestment_authorizations: [
          { status: "fulfilled", amount_ugx: 1_300_000 },
        ],
      }),
      NOW,
    );
    const settledOn = date("2026-10-15T12:00:00+00:00");
    expect(paid).toMatchObject({
      state: "settled",
      valueBasis: "settled",
      valueUgx: 1_300_000,
      settlement: `Paid ${ugx(1_300_000)} on ${settledOn}`,
    });
    expect(reinvested.settlement).toBe(
      `Reinvested ${ugx(1_320_000)} on ${settledOn}`,
    );
    expect(split).toMatchObject({
      valueUgx: 1_320_000,
      settlement: `Paid ${ugx(320_000)} · Reinvested ${ugx(1_000_000)} on ${settledOn}`,
    });
    expect(reportedPaid).toMatchObject({
      state: "settled",
      valueBasis: "reported_paid",
      valueUgx: 1_350_000,
      settlement: `Reported paid ${ugx(1_350_000)}`,
    });
    expect(offline).toMatchObject({
      state: "settled",
      valueBasis: "settled",
      settlement: `Reinvested offline ${ugx(1_300_000)}`,
    });
    // The reinvestment itself is a new active record; settled amounts must
    // never be added a second time.
    const summary = summarizePortfolio([
      paid,
      reinvested,
      split,
      reportedPaid,
      offline,
      describeInvestment(
        row({
          principal_ugx: 1_320_000,
          projected_return_ugx: 396_000,
          projected_value_ugx: 1_716_000,
        }),
        NOW,
      ),
    ]);
    expect(summary.active).toMatchObject({ count: 1, principalUgx: 1_320_000 });
    expect(summary.awaiting.count).toBe(0);
    expect(summary.counts.settled).toBe(5);
  });

  it("keeps cancelled, rejected, expired, archived and unaccepted import records out of every total", () => {
    const records = [
      row({ status: "cancelled" }),
      row({ status: "rejected" }),
      row({ status: "expired" }),
      row({ administratively_archived_at: "2026-10-01T00:00:00+00:00" }),
      matured({
        record_origin: "legacy_import",
        import_batches: { status: "staged" },
      }),
    ].map((item) => describeInvestment(item, NOW));
    expect(records.map((record) => record.state)).toEqual([
      "closed",
      "closed",
      "closed",
      "excluded",
      "excluded",
    ]);
    expect(records[0]).toMatchObject({
      statusLabel: "Cancelled",
      valueUgx: null,
      valueBasis: null,
      settlement: "Not counted in totals",
    });
    expect(records[3].settlement).toBe(
      "Archived by an administrator; not counted in totals",
    );
    expect(records[4].settlement).toBe(
      "Import not accepted; not counted in totals",
    );
    const summary = summarizePortfolio(records);
    expect(
      summary.active.count + summary.reserved.count + summary.awaiting.count,
    ).toBe(0);
    expect(summary.counts).toMatchObject({ all: 5, closed: 3, excluded: 2 });
  });

  it("sums amounts exactly at the database scale", () => {
    const summary = summarizePortfolio(
      [0.1, 0.2, 125_000.33333333].map((principal) =>
        describeInvestment(row({ principal_ugx: principal }), NOW),
      ),
    );
    expect(summary.active.principalUgx).toBe(125_000.63333333);
  });

  it("titles records like the partner portal and labels origin and receipts", () => {
    const record = describeInvestment(
      row({
        alias: "School fees",
        record_origin: "hybrid",
        is_test: true,
        investment_receipts: {
          id: "r1000000-0000-4000-8000-000000000001",
          receipt_number: "OURMU-2026-000123",
          pdf_status: "ready",
        },
      }),
      NOW,
    );
    expect(record).toMatchObject({
      title: "School fees",
      cycleName: "June 2026",
      originLabel: "Offline reinvestment",
      isTest: true,
      receipt: { number: "OURMU-2026-000123", status: "ready" },
    });
    expect(describeInvestment(row(), NOW).title).toBe(
      "June 2026 - December 2026",
    );
  });

  it("orders newest first and lists each cycle once, latest term first", () => {
    const older = describeInvestment(
      row({ requested_at: "2026-06-02T10:00:00+00:00" }),
      NOW,
    );
    const newer = describeInvestment(
      row({
        cycle_id: CYCLE_DEC,
        requested_at: "2026-10-02T10:00:00+00:00",
        investment_cycles: {
          ...juneCycle,
          name: "December 2026",
          opens_at: "2026-10-01T00:00:00+00:00",
        },
      }),
      NOW,
    );
    expect([older, newer].sort(newestFirst)).toEqual([newer, older]);
    expect(portfolioCycles([older, newer, older])).toEqual([
      {
        id: CYCLE_DEC,
        name: "December 2026",
        start: "2026-10-01T00:00:00+00:00",
      },
      { id: CYCLE_JUNE, name: "June 2026", start: "2026-06-01T00:00:00+00:00" },
    ]);
  });
});
