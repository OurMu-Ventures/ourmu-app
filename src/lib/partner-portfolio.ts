// Read-only admin view of one partner's portfolio. A partner is a portal
// profile or an unclaimed imported identity; a claimed identity's records
// belong to its profile. Values reuse the partner-facing return rules and
// the settlement rules of the maturity and offline-reinvestment flows.
import { investmentReturnView } from "@/lib/actual-returns";
import type { Tables } from "@/lib/database.types";
import { date, ugx } from "@/lib/format";
import { investmentCycleTitle, investmentTitle } from "@/lib/investments";
import { maturityChoiceLabel } from "@/lib/maturity";

export type PartnerKind = "profile" | "legacy";
export type PartnerRef = { kind: PartnerKind; id: string };

// Imported identities use deterministic manifest IDs, so accept any
// canonical identifier rather than only random (v4) UUIDs.
const IDENTIFIER =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parsePartnerRef(kind: string, id: string): PartnerRef | null {
  if ((kind !== "profile" && kind !== "legacy") || !IDENTIFIER.test(id))
    return null;
  return { kind, id: id.toLowerCase() };
}

// The investments register filter value, e.g. "profile:<id>".
export function parsePartnerFilter(value: string): PartnerRef | null {
  const separator = value.indexOf(":");
  return separator < 0
    ? null
    : parsePartnerRef(value.slice(0, separator), value.slice(separator + 1));
}

export function singleParam(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

export function parsePage(value: string) {
  const parsed = Number(value);
  return /^\d+$/.test(value) &&
    Number.isSafeInteger(parsed) &&
    parsed > 0 &&
    parsed <= 1_000_000
    ? parsed
    : 1;
}

export const PAGE_SIZE = 25;

// A page of an in-memory list; out-of-range pages show the last page.
export function paginate<T>(items: T[], page: number, pageSize = PAGE_SIZE) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * pageSize;
  const visible = items.slice(start, start + pageSize);
  return {
    items: visible,
    page: current,
    pageCount,
    total: items.length,
    first: visible.length ? start + 1 : 0,
    last: start + visible.length,
  };
}

// Back links return only to the two partner-finding lists, never to an
// arbitrary or external address taken from the URL.
const RETURN_PATHS = ["/admin/partners", "/admin/investments"];

export function safeReturnPath(value: string | null | undefined) {
  if (!value?.startsWith("/") || value.length > 500) return null;
  let url: URL;
  try {
    url = new URL(value, "https://portal.invalid");
  } catch {
    return null;
  }
  if (
    url.origin !== "https://portal.invalid" ||
    !RETURN_PATHS.includes(url.pathname)
  )
    return null;
  return `${url.pathname}${url.search}`;
}

export const PORTFOLIO_FILTERS = [
  { value: "all", label: "All records" },
  { value: "active", label: "Active" },
  { value: "reserved", label: "Pending reservations" },
  { value: "awaiting", label: "Awaiting settlement" },
  { value: "settled", label: "Settled" },
  { value: "closed", label: "Cancelled or expired" },
  { value: "excluded", label: "Excluded" },
] as const;

export type PortfolioFilter = (typeof PORTFOLIO_FILTERS)[number]["value"];
export type PortfolioState = Exclude<PortfolioFilter, "all">;

export function parsePortfolioFilter(value: string): PortfolioFilter | null {
  return PORTFOLIO_FILTERS.find((item) => item.value === value)?.value ?? null;
}

export function portfolioHref(
  ref: PartnerRef,
  view: {
    status?: PortfolioFilter;
    cycle?: string;
    page?: number;
    from?: string | null;
  } = {},
) {
  const params = new URLSearchParams();
  if (view.status && view.status !== "all") params.set("status", view.status);
  if (view.cycle) params.set("cycle", view.cycle);
  if (view.page && view.page > 1) params.set("page", String(view.page));
  if (view.from) params.set("from", view.from);
  const query = params.toString();
  return `/admin/partners/${ref.kind}/${ref.id}${query ? `?${query}` : ""}`;
}

export type PartnerListing = {
  ref: PartnerRef;
  name: string;
  email: string | null;
  additionalEmails: { email: string; verified: boolean }[];
  // Imported names and aliases that differ from the name above.
  importedNames: string[];
  accessStatus: string | null;
  kycStatus: string | null;
  isTest: boolean;
  // Last digits of an unclaimed partner's phone, to tell duplicates apart.
  phoneHint: string | null;
  importAccepted: boolean;
};

function normalized(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en");
}

// Every word must appear in a name or email, so "Doe Jane" also finds
// "Jane Doe". Unverified additional emails are shown but never matched.
export function filterPartners(listings: PartnerListing[], query: string) {
  const terms = normalized(query).split(/\s+/).filter(Boolean).slice(0, 8);
  if (!terms.length) return listings;
  return listings.filter((item) => {
    const haystack = normalized(
      [
        item.name,
        item.email ?? "",
        ...item.importedNames,
        ...item.additionalEmails
          .filter((entry) => entry.verified)
          .map((entry) => entry.email),
      ].join(" "),
    );
    return terms.every((term) => haystack.includes(term));
  });
}

// Name order; on equal names portal accounts come before imports.
export function comparePartners(a: PartnerListing, b: PartnerListing) {
  return (
    a.name.localeCompare(b.name, "en", { sensitivity: "base" }) ||
    b.ref.kind.localeCompare(a.ref.kind) ||
    (a.email ?? "").localeCompare(b.email ?? "") ||
    a.ref.id.localeCompare(b.ref.id)
  );
}

export function maskPhone(phone: string | null | undefined) {
  const digits = phone?.replace(/\D/g, "") ?? "";
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : null;
}

export type PortfolioInvestmentRow = Pick<
  Tables<"investments">,
  | "id"
  | "cycle_id"
  | "status"
  | "record_origin"
  | "alias"
  | "principal_ugx"
  | "projected_return_ugx"
  | "projected_value_ugx"
  | "maturity_date"
  | "requested_at"
  | "payout_basis"
  | "reported_return_ugx"
  | "reported_payout_ugx"
  | "is_test"
  | "administratively_archived_at"
  | "offline_settlement_id"
> & {
  investment_cycles: Pick<
    Tables<"investment_cycles">,
    "name" | "opens_at" | "actual_return_bps" | "legacy_settlement"
  > | null;
  import_batches: Pick<Tables<"import_batches">, "status"> | null;
  maturity_instructions: Pick<
    Tables<"maturity_instructions">,
    | "status"
    | "choice"
    | "needs_resolution"
    | "actual_payout_ugx"
    | "actual_reinvest_ugx"
    | "fulfilled_at"
  > | null;
  investment_receipts: Pick<
    Tables<"investment_receipts">,
    "id" | "receipt_number" | "pdf_status"
  > | null;
  offline_reinvestment_authorizations: Pick<
    Tables<"offline_reinvestment_authorizations">,
    "status" | "amount_ugx"
  >[];
};

export type ValueBasis =
  "projected" | "actual" | "estimated" | "reported_paid" | "settled";

export const VALUE_BASIS_LABELS: Record<ValueBasis, string> = {
  projected: "Projected",
  actual: "Actual",
  estimated: "Estimated",
  reported_paid: "Reported paid",
  settled: "Settled",
};

const STATUS_LABELS: Record<string, string> = {
  reserved: "Reserved",
  active: "Active",
  matured: "Matured",
  cancelled: "Cancelled",
  rejected: "Rejected",
  expired: "Expired",
};

const ORIGIN_LABELS: Record<string, string> = {
  portal: "Portal",
  legacy_import: "Imported",
  hybrid: "Offline reinvestment",
};

export type PortfolioRecord = {
  id: string;
  title: string;
  cycleId: string;
  cycleName: string;
  termStart: string | null;
  originLabel: string;
  isTest: boolean;
  statusLabel: string;
  state: PortfolioState;
  principalUgx: number;
  // Null for cancelled, rejected and expired records, which never ran.
  valueUgx: number | null;
  valueBasis: ValueBasis | null;
  // An actual return published before maturity may still be revised.
  revisable: boolean;
  maturityDate: string;
  requestedAt: string;
  settlement: string;
  receipt: { id: string; number: string; status: string } | null;
};

// Match PostgreSQL numeric sums at the database's eight-decimal scale.
function moneyUnits(value: number | string): bigint {
  return BigInt(Number(value).toFixed(8).replace(".", ""));
}

function sumUgx(values: (number | string)[]): number {
  return (
    Number(values.reduce<bigint>((sum, value) => sum + moneyUnits(value), 0n)) /
    100_000_000
  );
}

const CLOSED_STATUSES = new Set(["cancelled", "rejected", "expired"]);

// Classifies one record. Reported-paid records, fulfilled maturity
// instructions and completed offline settlements are settled history;
// archived records and rows of an import that was never accepted are kept
// visible but out of every total.
export function describeInvestment(
  row: PortfolioInvestmentRow,
  now: Date = new Date(),
): PortfolioRecord {
  const cycle = row.investment_cycles;
  const instruction = row.maturity_instructions;
  const offlineDone = row.offline_reinvestment_authorizations.find(
    (item) => item.status === "fulfilled",
  );
  const offlinePending = row.offline_reinvestment_authorizations.some(
    (item) => item.status === "recorded",
  );
  const exclusion = row.administratively_archived_at
    ? "Archived by an administrator"
    : row.record_origin === "legacy_import" &&
        row.import_batches?.status !== "accepted"
      ? "Import not accepted"
      : null;
  const fulfilled = instruction?.status === "fulfilled";
  const offlineSettled = Boolean(row.offline_settlement_id || offlineDone);
  const closed = CLOSED_STATUSES.has(row.status);
  const state: PortfolioState = exclusion
    ? "excluded"
    : closed
      ? "closed"
      : row.status === "reserved"
        ? "reserved"
        : fulfilled || offlineSettled || row.payout_basis === "reported_paid"
          ? "settled"
          : row.status === "matured"
            ? "awaiting"
            : "active";

  const returns = investmentReturnView(row, cycle, now);
  let valueUgx: number | null = returns.valueUgx;
  let valueBasis: ValueBasis | null =
    returns.basis === "paid"
      ? "reported_paid"
      : returns.basis === "actual"
        ? "actual"
        : row.status === "matured"
          ? "estimated"
          : "projected";
  if (closed) {
    valueUgx = null;
    valueBasis = null;
  } else if (
    fulfilled &&
    instruction.actual_payout_ugx != null &&
    instruction.actual_reinvest_ugx != null
  ) {
    valueUgx = sumUgx([
      instruction.actual_payout_ugx,
      instruction.actual_reinvest_ugx,
    ]);
    valueBasis = "settled";
  } else if (offlineDone) {
    valueUgx = Number(offlineDone.amount_ugx);
    valueBasis = "settled";
  }

  let settlement: string;
  if (exclusion) settlement = `${exclusion}; not counted in totals`;
  else if (closed) settlement = "Not counted in totals";
  else if (state === "reserved") settlement = "Awaiting payment confirmation";
  else if (state === "active") settlement = "Not yet matured";
  else if (fulfilled) {
    const payout = Number(instruction.actual_payout_ugx ?? 0);
    const reinvest = Number(instruction.actual_reinvest_ugx ?? 0);
    const parts = [
      payout > 0 ? `Paid ${ugx(payout)}` : null,
      reinvest > 0 ? `Reinvested ${ugx(reinvest)}` : null,
    ].filter(Boolean);
    settlement = `${parts.join(" · ") || "Fulfilled"}${
      instruction.fulfilled_at ? ` on ${date(instruction.fulfilled_at)}` : ""
    }`;
  } else if (offlineSettled)
    settlement = offlineDone
      ? `Reinvested offline ${ugx(offlineDone.amount_ugx)}`
      : "Reinvested offline";
  else if (state === "settled")
    settlement =
      row.reported_payout_ugx != null
        ? `Reported paid ${ugx(row.reported_payout_ugx)}`
        : "Reported paid";
  else if (offlinePending)
    settlement = "Offline reinvestment recorded; awaiting completion";
  else if (!instruction) settlement = "Awaiting maturity choice";
  else {
    const choice = maturityChoiceLabel(instruction.choice);
    settlement = instruction.needs_resolution
      ? `${choice} held for resolution`
      : `${choice} ${instruction.status === "processing" ? "processing" : "requested"}`;
  }

  const defaultTitle = investmentCycleTitle(cycle?.name);
  const receipt = row.investment_receipts;
  return {
    id: row.id,
    title: investmentTitle(row.alias, defaultTitle),
    cycleId: row.cycle_id,
    cycleName: cycle?.name ?? "Unknown cycle",
    termStart: cycle?.opens_at ?? null,
    originLabel: ORIGIN_LABELS[row.record_origin] ?? row.record_origin,
    isTest: row.is_test,
    statusLabel: STATUS_LABELS[row.status] ?? row.status,
    state,
    principalUgx: Number(row.principal_ugx),
    valueUgx,
    valueBasis,
    revisable: valueBasis === "actual" && returns.revisable,
    maturityDate: row.maturity_date,
    requestedAt: row.requested_at,
    settlement,
    receipt: receipt
      ? {
          id: receipt.id,
          number: receipt.receipt_number,
          status: receipt.pdf_status,
        }
      : null,
  };
}

// Newest first, the same order as the investments register.
export function newestFirst(a: PortfolioRecord, b: PortfolioRecord) {
  return (
    Date.parse(b.requestedAt) - Date.parse(a.requestedAt) ||
    b.id.localeCompare(a.id)
  );
}

export type PortfolioSummary = {
  active: {
    count: number;
    principalUgx: number;
    valueUgx: number;
    actualCount: number;
  };
  reserved: { count: number; principalUgx: number };
  awaiting: {
    count: number;
    principalUgx: number;
    valueUgx: number;
    actualCount: number;
  };
  counts: Record<PortfolioFilter, number>;
};

// Portfolio-wide totals. Settled amounts never count: a reinvestment
// already appears as its own new record, so adding it here would count the
// money twice.
export function summarizePortfolio(
  records: PortfolioRecord[],
): PortfolioSummary {
  const group = (state: PortfolioState) =>
    records.filter((record) => record.state === state);
  const active = group("active");
  const reserved = group("reserved");
  const awaiting = group("awaiting");
  const counts = Object.fromEntries(
    PORTFOLIO_FILTERS.map((item) => [
      item.value,
      item.value === "all" ? records.length : group(item.value).length,
    ]),
  ) as Record<PortfolioFilter, number>;
  return {
    active: {
      count: active.length,
      principalUgx: sumUgx(active.map((record) => record.principalUgx)),
      valueUgx: sumUgx(active.map((record) => record.valueUgx ?? 0)),
      actualCount: active.filter((record) => record.valueBasis === "actual")
        .length,
    },
    reserved: {
      count: reserved.length,
      principalUgx: sumUgx(reserved.map((record) => record.principalUgx)),
    },
    awaiting: {
      count: awaiting.length,
      principalUgx: sumUgx(awaiting.map((record) => record.principalUgx)),
      valueUgx: sumUgx(awaiting.map((record) => record.valueUgx ?? 0)),
      actualCount: awaiting.filter((record) => record.valueBasis === "actual")
        .length,
    },
    counts,
  };
}

// "Actual", the fallback label, or a mix of both for a group of values.
export function basisMix(
  count: number,
  actualCount: number,
  fallback: "Projected" | "Estimated",
) {
  if (!count) return null;
  if (actualCount === count) return "Actual";
  if (!actualCount) return fallback;
  return `Mixed: ${actualCount} actual, ${count - actualCount} ${fallback.toLowerCase()}`;
}

// Cycles that appear in this portfolio, latest term first.
export function portfolioCycles(records: PortfolioRecord[]) {
  const cycles = new Map<string, { id: string; name: string; start: string }>();
  for (const record of records)
    cycles.set(record.cycleId, {
      id: record.cycleId,
      name: record.cycleName,
      start: record.termStart ?? "",
    });
  return [...cycles.values()].sort(
    (a, b) => b.start.localeCompare(a.start) || a.name.localeCompare(b.name),
  );
}
