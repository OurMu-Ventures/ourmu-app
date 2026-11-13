import Form from "next/form";
import Link from "next/link";

import { getReceiptDownloadUrl } from "@/actions/receipts";
import { PartnerSearchForm } from "@/components/PartnerSearchForm";
import { requireAdmin } from "@/lib/auth";
import { date, dateTime, ugx, units } from "@/lib/format";
import {
  filterPartners,
  parsePage,
  parsePartnerFilter,
  portfolioHref,
  singleParam,
  type PartnerRef,
} from "@/lib/partner-portfolio";
import {
  loadPartnerListings,
  partnerInvestmentFilter,
  resolvePartner,
} from "@/lib/partners";
import { createAdminClient } from "@/lib/supabase/admin";

const PAGE_SIZE = 25;
const SEARCH_RESULT_LIMIT = 10;

type SearchParams = Promise<{
  partner?: string | string[];
  partnerSearch?: string | string[];
  cycle?: string | string[];
  page?: string | string[];
}>;

function investmentsHref(filters: {
  partner?: string;
  partnerSearch?: string;
  cycle?: string;
  page?: number;
}) {
  const params = new URLSearchParams();
  if (filters.partner) params.set("partner", filters.partner);
  if (filters.partnerSearch) params.set("partnerSearch", filters.partnerSearch);
  if (filters.cycle) params.set("cycle", filters.cycle);
  if (filters.page) params.set("page", String(filters.page));
  const search = params.toString();
  return `/admin/investments${search ? `?${search}` : ""}`;
}

function single<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminInvestmentsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireAdmin();
  const admin = createAdminClient();
  const params = await searchParams;
  const partner = singleParam(params.partner);
  const partnerSearch = singleParam(params.partnerSearch).trim().slice(0, 80);
  const cycle = singleParam(params.cycle);
  const page = parsePage(singleParam(params.page));
  const partnerRef = partner ? parsePartnerFilter(partner) : null;
  const from = investmentsHref({
    partner,
    partnerSearch,
    cycle,
    page: page > 1 ? page : undefined,
  });

  const [{ data: cycles, error: cyclesError }, resolution, listings] =
    await Promise.all([
      admin
        .from("investment_cycles")
        .select("id,name")
        .order("opens_at", { ascending: false }),
      partnerRef ? resolvePartner(admin, partnerRef) : null,
      partnerSearch ? loadPartnerListings(admin) : null,
    ]);
  if (cyclesError) throw new Error("Unable to load investment filters");
  // A claimed imported identity filters to the profile that owns its records.
  const selectedPartner =
    resolution?.status === "claimed"
      ? await resolvePartner(admin, resolution.profile)
      : resolution;
  const selected =
    selectedPartner?.status === "found" ? selectedPartner.partner : null;
  const partnerMatches = listings
    ? filterPartners(listings, partnerSearch)
    : [];
  const selectedCycle = (cycles ?? []).find((option) => option.id === cycle);
  const invalidFilter =
    (partner !== "" && !selected) || (cycle !== "" && !selectedCycle);

  const investmentResult = invalidFilter
    ? null
    : await (async () => {
        let query = admin
          .from("investments")
          .select(
            "id,investor_id,legacy_partner_id,cycle_id,record_origin,status,units,principal_ugx,projected_value_ugx,reported_payout_ugx,requested_at,maturity_date,investment_accounts(name),profiles(legal_name,email),investment_cycles(name),legacy_partner_identities(canonical_name,normalized_email,profile_id),investment_receipts!investment_receipts_investment_id_fkey(id,receipt_number,pdf_status)",
            { count: "exact" },
          );
        if (selected) query = query.or(partnerInvestmentFilter(selected));
        if (cycle) query = query.eq("cycle_id", cycle);
        const start = (page - 1) * PAGE_SIZE;
        return query
          .order("requested_at", { ascending: false })
          .order("id", { ascending: false })
          .range(start, start + PAGE_SIZE - 1);
      })();
  if (investmentResult?.error) throw new Error("Unable to load investments");
  const investments = investmentResult?.data ?? [];
  const count = investmentResult?.count ?? 0;

  return (
    <>
      <p className="eyebrow">Partner investment records</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Investments</h1>
      <p className="notice">
        Browse all partner investment records. Review and activate pending
        reservations on the <Link href="/admin/activations">Activations</Link>{" "}
        page.
      </p>

      <section className="card" aria-labelledby="find-portfolio">
        <h2 id="find-portfolio" style={{ fontSize: "1.4rem" }}>
          Find a partner&rsquo;s portfolio
        </h2>
        <PartnerSearchForm
          id="portfolio-search"
          action="/admin/investments"
          name="partnerSearch"
          label="Partner name or email"
          defaultValue={partnerSearch}
          keep={{ partner, cycle }}
        />
        {partnerSearch && (
          <>
            <p className="muted" role="status">
              {partnerMatches.length
                ? `${partnerMatches.length} ${partnerMatches.length === 1 ? "partner matches" : "partners match"} “${partnerSearch}”.`
                : `No partners match “${partnerSearch}”. Check the spelling, or search by email.`}
            </p>
            {partnerMatches.length > 0 && (
              <ul className="partner-results">
                {partnerMatches.slice(0, SEARCH_RESULT_LIMIT).map((item) => (
                  <li key={`${item.ref.kind}:${item.ref.id}`}>
                    <span>
                      <Link
                        className="text-link"
                        href={portfolioHref(item.ref, { from })}
                      >
                        {item.name}
                      </Link>
                      <small className="muted" style={{ display: "block" }}>
                        {[
                          item.ref.kind === "legacy"
                            ? "Unclaimed import"
                            : "Portal account",
                          item.email ??
                            item.phoneHint ??
                            `Record ${item.ref.id.slice(0, 8)}`,
                        ].join(" · ")}
                      </small>
                    </span>
                    <Link
                      className="button-secondary"
                      href={portfolioHref(item.ref, { from })}
                    >
                      View portfolio
                      <span className="visually-hidden"> for {item.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {partnerMatches.length > SEARCH_RESULT_LIMIT && (
              <p>
                <Link
                  className="text-link"
                  href={`/admin/partners?${new URLSearchParams({ q: partnerSearch })}`}
                >
                  See all {partnerMatches.length} matches on Partners
                </Link>
              </p>
            )}
          </>
        )}
      </section>

      <h2 style={{ marginTop: "2rem" }}>All investments</h2>
      <Form
        action="/admin/investments"
        className="card admin-investment-filters"
      >
        {partner && <input type="hidden" name="partner" value={partner} />}
        {partnerSearch && (
          <input type="hidden" name="partnerSearch" value={partnerSearch} />
        )}
        <label>
          Cycle
          <select
            name="cycle"
            defaultValue={selectedCycle?.id ?? ""}
            key={cycle}
          >
            <option value="">All cycles</option>
            {(cycles ?? []).map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <div className="admin-investment-filter-actions">
          <button className="button" type="submit">
            Show investments
          </button>
          {(partner || cycle) && (
            <Link
              className="text-link"
              href={investmentsHref({ partnerSearch })}
            >
              Clear filters
            </Link>
          )}
        </div>
      </Form>
      {selected && (
        <p className="notice">
          Showing investments for <strong>{selected.name}</strong>.{" "}
          <Link
            className="text-link"
            href={portfolioHref(selected.ref, { from })}
          >
            View {selected.name}&rsquo;s portfolio
          </Link>{" "}
          ·{" "}
          <Link
            className="text-link"
            href={investmentsHref({ partnerSearch, cycle })}
          >
            Show all partners
          </Link>
        </p>
      )}

      {invalidFilter ? (
        <p className="notice">
          Select a valid partner and cycle to view investments.
        </p>
      ) : (
        <>
          <p className="muted" aria-live="polite">
            {count === 0 || !investments.length
              ? `No investments found${count ? " on this page" : ""}.`
              : `Showing ${(page - 1) * PAGE_SIZE + 1}–${(page - 1) * PAGE_SIZE + investments.length} of ${count} investments.`}
          </p>
          {investments.map((item) => {
            const profile = single(item.profiles);
            const identity = single(item.legacy_partner_identities);
            const owner: PartnerRef | null = item.investor_id
              ? { kind: "profile", id: item.investor_id }
              : identity?.profile_id
                ? { kind: "profile", id: identity.profile_id }
                : item.legacy_partner_id
                  ? { kind: "legacy", id: item.legacy_partner_id }
                  : null;
            return (
              <article
                className="card"
                style={{ marginBottom: "1rem" }}
                key={item.id}
              >
                <div className="page-head">
                  <div>
                    <h3>
                      {profile?.legal_name ??
                        identity?.canonical_name ??
                        "Unclaimed partner"}
                    </h3>
                    <p>Account: {single(item.investment_accounts)?.name ?? "Unclaimed"}</p>
                    <p>
                      {single(item.investment_cycles)?.name ?? "Unknown cycle"}{" "}
                      · {units(item.units ?? 0)} units ·{" "}
                      {ugx(item.principal_ugx)}
                    </p>
                    <p className="muted">
                      Requested {dateTime(item.requested_at)} · Matures{" "}
                      {date(item.maturity_date)} · {item.record_origin}
                    </p>
                    <p className="muted">
                      Projected payout {ugx(item.projected_value_ugx)}
                      {item.reported_payout_ugx != null &&
                        ` · Reported payout ${ugx(item.reported_payout_ugx)}`}
                    </p>
                  </div>
                  <span className="badge">{item.status}</span>
                </div>
                <p className="admin-investment-filter-actions">
                  {owner && (
                    <Link
                      className="button-secondary"
                      href={portfolioHref(owner, { from })}
                    >
                      View portfolio
                    </Link>
                  )}
                  {item.status === "reserved" &&
                    item.record_origin === "portal" && (
                      <Link
                        className="button-secondary"
                        href="/admin/activations"
                      >
                        Review in Activations
                      </Link>
                    )}
                </p>
                <ReceiptAdminLine receipts={item.investment_receipts} />
              </article>
            );
          })}
          {count > 0 && (page > 1 || page * PAGE_SIZE < count) && (
            <nav
              className="admin-investment-pagination"
              aria-label="Investment pages"
            >
              {page > 1 && (
                <Link
                  className="button-secondary"
                  href={investmentsHref({
                    partner,
                    partnerSearch,
                    cycle,
                    page: page - 1,
                  })}
                >
                  Previous
                </Link>
              )}
              <span className="muted">
                Page {page} of {Math.ceil(count / PAGE_SIZE)}
              </span>
              {page * PAGE_SIZE < count && (
                <Link
                  className="button-secondary"
                  href={investmentsHref({
                    partner,
                    partnerSearch,
                    cycle,
                    page: page + 1,
                  })}
                >
                  Next
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </>
  );
}

async function ReceiptAdminLine({
  receipts,
}: {
  receipts:
    | { id: string; receipt_number: string; pdf_status: string }
    | { id: string; receipt_number: string; pdf_status: string }[]
    | null;
}) {
  const receipt = Array.isArray(receipts) ? receipts[0] : receipts;
  if (!receipt) return null;
  if (receipt.pdf_status !== "ready") {
    return (
      <p className="muted">
        Receipt {receipt.receipt_number}: {receipt.pdf_status}
      </p>
    );
  }
  const url = await getReceiptDownloadUrl(receipt.id);
  if (!url) {
    return <p className="muted">Receipt {receipt.receipt_number}: ready</p>;
  }
  return (
    <p>
      <a className="button" href={url} rel="noreferrer">
        Download receipt {receipt.receipt_number}
      </a>
    </p>
  );
}
