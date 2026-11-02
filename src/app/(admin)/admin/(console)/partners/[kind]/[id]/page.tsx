import Form from "next/form";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  PortfolioRecords,
  PortfolioTotals,
} from "@/components/PartnerPortfolio";
import { PartnerSearchForm } from "@/components/PartnerSearchForm";
import { requireAdmin } from "@/lib/auth";
import {
  describeInvestment,
  newestFirst,
  paginate,
  parsePage,
  parsePartnerRef,
  parsePortfolioFilter,
  portfolioCycles,
  portfolioHref,
  PORTFOLIO_FILTERS,
  safeReturnPath,
  singleParam,
  summarizePortfolio,
  type PortfolioFilter,
} from "@/lib/partner-portfolio";
import {
  loadPortfolioInvestments,
  resolvePartner,
  type PortfolioPartner,
} from "@/lib/partners";
import { createAdminClient } from "@/lib/supabase/admin";

type Params = Promise<{ kind: string; id: string }>;
type SearchParams = Promise<{
  status?: string | string[];
  cycle?: string | string[];
  page?: string | string[];
  from?: string | string[];
}>;

function PartnerIdentity({ partner }: { partner: PortfolioPartner }) {
  if (partner.kind === "legacy")
    return (
      <div className="portfolio-identity">
        <p>
          <strong>{partner.email ?? "No email on file"}</strong>
          {partner.phoneHint ? ` · phone ${partner.phoneHint}` : ""}
        </p>
        <p>
          <span className="badge">Unclaimed import</span>{" "}
          {!partner.importAccepted && (
            <span className="badge">Import not accepted</span>
          )}{" "}
          Not linked to a portal account. Link it on the Partners page after
          verifying the partner&apos;s email.
        </p>
      </div>
    );
  return (
    <div className="portfolio-identity">
      <p>
        <strong>{partner.email}</strong>
      </p>
      {partner.additionalEmails.length > 0 && (
        <p className="muted">
          Other emails:{" "}
          {partner.additionalEmails
            .map(
              (entry) =>
                `${entry.email} (${entry.verified ? "verified" : "pending"})`,
            )
            .join(", ")}
        </p>
      )}
      <p>
        <span className="badge">Portal account</span>{" "}
        <span className="badge">Access {partner.accessStatus}</span>{" "}
        <span className="badge">KYC {partner.kycStatus}</span>
        {partner.isTest && (
          <>
            {" "}
            <span className="badge">Test account</span>
          </>
        )}
      </p>
      {partner.linkedIdentities.length > 0 && (
        <p className="muted">
          Linked imported records:{" "}
          {partner.linkedIdentities.map((identity) => identity.name).join(", ")}
        </p>
      )}
    </div>
  );
}

export default async function PartnerPortfolioPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  await requireAdmin();
  const [{ kind, id }, query] = await Promise.all([params, searchParams]);
  const ref = parsePartnerRef(kind, id);
  if (!ref) notFound();
  const from = safeReturnPath(singleParam(query.from));
  const admin = createAdminClient();
  const resolution = await resolvePartner(admin, ref);
  if (resolution.status === "missing") notFound();
  if (resolution.status === "claimed")
    redirect(portfolioHref(resolution.profile, { from }));
  const partner = resolution.partner;

  const records = (await loadPortfolioInvestments(admin, partner))
    .map((row) => describeInvestment(row))
    .sort(newestFirst);
  const summary = summarizePortfolio(records);
  const cycles = portfolioCycles(records);
  const requestedStatus = singleParam(query.status);
  const requestedCycle = singleParam(query.cycle);
  const status = parsePortfolioFilter(requestedStatus) ?? "all";
  const cycle = cycles.find((item) => item.id === requestedCycle);
  const ignoredFilter =
    (requestedStatus !== "" && !parsePortfolioFilter(requestedStatus)) ||
    (requestedCycle !== "" && !cycle);
  const filtered = records.filter(
    (record) =>
      (status === "all" || record.state === status) &&
      (!cycle || record.cycleId === cycle.id),
  );
  const view = paginate(filtered, parsePage(singleParam(query.page)));
  const href = (
    changes: { status?: PortfolioFilter; cycle?: string; page?: number } = {},
  ) =>
    portfolioHref(partner.ref, {
      status,
      cycle: cycle?.id,
      from,
      ...changes,
    });
  const statusLabel =
    PORTFOLIO_FILTERS.find((item) => item.value === status)?.label ??
    "All records";
  const filterLabel = `${statusLabel} · ${cycle?.name ?? "all cycles"}`;
  const back = from ?? "/admin/partners";

  return (
    <>
      <p>
        <Link className="text-link" href={back}>
          ← Back to{" "}
          {back.startsWith("/admin/investments") ? "investments" : "partners"}
        </Link>
      </p>
      <div className="page-head">
        <div>
          <p className="eyebrow">Partner portfolio</p>
          <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>
            {partner.name}&rsquo;s portfolio
          </h1>
          <PartnerIdentity partner={partner} />
        </div>
        <PartnerSearchForm
          id="find-another-partner"
          action="/admin/partners"
          name="q"
          label="Find another partner"
          defaultValue=""
        />
      </div>
      {partner.kind === "profile" && partner.isTest && (
        <p className="notice">
          <strong>Test account.</strong> These records are sample data and are
          excluded from OURMU financial totals and cycle capacity.
        </p>
      )}

      <PortfolioTotals summary={summary} />

      <section
        aria-labelledby="portfolio-records"
        style={{ marginTop: "2rem" }}
      >
        <div className="portfolio-section-head">
          <h2 id="portfolio-records">Investment records</h2>
          <p className="muted">Newest first · {filterLabel}</p>
        </div>
        <nav
          aria-label="Filter records by status"
          className="portfolio-filters"
        >
          {PORTFOLIO_FILTERS.filter(
            (item) => item.value !== "excluded" || summary.counts.excluded > 0,
          ).map((item) => (
            <Link
              key={item.value}
              href={href({ status: item.value, page: 1 })}
              className={item.value === status ? "button" : "button-secondary"}
              aria-current={item.value === status ? "page" : undefined}
            >
              {`${item.label} (${summary.counts[item.value]})`}
            </Link>
          ))}
        </nav>
        {cycles.length > 1 && (
          <Form action="" className="portfolio-cycle-filter">
            {status !== "all" && (
              <input type="hidden" name="status" value={status} />
            )}
            {from && <input type="hidden" name="from" value={from} />}
            <label>
              Cycle
              <select
                name="cycle"
                defaultValue={cycle?.id ?? ""}
                key={cycle?.id}
              >
                <option value="">All cycles</option>
                {cycles.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="button-secondary" type="submit">
              Show cycle
            </button>
          </Form>
        )}
        {ignoredFilter && (
          <p className="notice">
            That filter is not available for this portfolio, so it was ignored.
          </p>
        )}
        <p className="muted" role="status">
          {!records.length
            ? "No investment records for this partner yet."
            : !filtered.length
              ? "No records match this filter."
              : `Showing ${view.first}–${view.last} of ${view.total} records.`}
          {(status !== "all" || cycle) && records.length > 0
            ? " Totals above still cover the entire portfolio."
            : ""}
        </p>
        {view.items.length > 0 && (
          <PortfolioRecords
            records={view.items}
            caption={`${partner.name}'s investment records: ${filterLabel}`}
          />
        )}
        {view.pageCount > 1 && (
          <nav
            className="admin-investment-pagination"
            aria-label="Investment record pages"
          >
            {view.page > 1 ? (
              <Link
                className="button-secondary"
                href={href({ page: view.page - 1 })}
              >
                Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="muted">
              Page {view.page} of {view.pageCount}
            </span>
            {view.page < view.pageCount ? (
              <Link
                className="button-secondary"
                href={href({ page: view.page + 1 })}
              >
                Next
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
        <p className="muted portfolio-total-note" style={{ marginTop: "1rem" }}>
          Projected: principal plus the cycle&apos;s projected return. Actual:
          the cycle&apos;s recorded return, which may change until maturity.
          Estimated: matured, but the cycle&apos;s actual return is not recorded
          yet. Settled and reported-paid amounts were already paid out or
          reinvested and never count toward the totals; a reinvestment appears
          as its own record.
        </p>
      </section>
    </>
  );
}
