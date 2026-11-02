import Link from "next/link";

import { LegacyClaimForm } from "@/components/forms";
import { PartnerSearchForm } from "@/components/PartnerSearchForm";
import { requireAdmin } from "@/lib/auth";
import {
  filterPartners,
  paginate,
  parsePage,
  portfolioHref,
  singleParam,
  type PartnerListing,
} from "@/lib/partner-portfolio";
import { loadPartnerListings } from "@/lib/partners";
import { createAdminClient } from "@/lib/supabase/admin";

type SearchParams = Promise<{
  q?: string | string[];
  page?: string | string[];
}>;

function partnersHref(query: string, page: number) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return `/admin/partners${search ? `?${search}` : ""}`;
}

function PartnerRow({
  item,
  from,
}: {
  item: PartnerListing;
  from: string | null;
}) {
  const href = portfolioHref(item.ref, { from });
  return (
    <tr>
      <th scope="row" className="row-heading">
        <Link className="text-link" href={href}>
          {item.name}
        </Link>
        {item.ref.kind === "legacy" && (
          <>
            {" "}
            <span className="badge">Unclaimed import</span>
          </>
        )}
        {item.isTest && (
          <>
            {" "}
            <span className="badge">Test account</span>
          </>
        )}
        {item.importedNames.length > 0 && (
          <small className="muted" style={{ display: "block" }}>
            Imported as {item.importedNames.slice(0, 3).join(", ")}
          </small>
        )}
      </th>
      <td>
        {item.email ?? <span className="muted">No email on file</span>}
        {item.additionalEmails.map((entry) => (
          <small
            className="muted"
            style={{ display: "block" }}
            key={entry.email}
          >
            {entry.email} ({entry.verified ? "verified" : "pending"})
          </small>
        ))}
        {item.phoneHint && (
          <small className="muted" style={{ display: "block" }}>
            Phone {item.phoneHint}
          </small>
        )}
        {item.ref.kind === "legacy" && !item.email && !item.phoneHint && (
          <small className="muted" style={{ display: "block" }}>
            Record {item.ref.id.slice(0, 8)}
          </small>
        )}
      </td>
      <td>
        {item.ref.kind === "profile"
          ? item.accessStatus
          : item.importAccepted
            ? "Unclaimed"
            : "Import not accepted"}
      </td>
      <td>{item.kycStatus ?? "—"}</td>
      <td>
        <Link className="button-secondary" href={href}>
          View portfolio
          <span className="visually-hidden"> for {item.name}</span>
        </Link>
      </td>
    </tr>
  );
}

export default async function PartnersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireAdmin();
  const params = await searchParams;
  const query = singleParam(params.q).trim().slice(0, 80);
  const listings = await loadPartnerListings(createAdminClient());
  const matches = filterPartners(listings, query);
  const view = paginate(matches, parsePage(singleParam(params.page)));
  // The portfolio's back link defaults to this page; only a search or a
  // later page needs to travel with the link.
  const from = query || view.page > 1 ? partnersHref(query, view.page) : null;
  const unclaimed = listings.filter((item) => item.ref.kind === "legacy");
  return (
    <>
      <p className="eyebrow">Partner records</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Partners</h1>
      <p className="muted">
        Search by name or email, then open a partner&apos;s portfolio. Unclaimed
        imported partners are included and labelled.
      </p>
      <PartnerSearchForm
        id="partner-search"
        action="/admin/partners"
        name="q"
        label="Find a partner"
        defaultValue={query}
      />
      <p className="muted" role="status">
        {!matches.length
          ? query
            ? `No partners match “${query}”. Check the spelling, or search by email.`
            : "No partners yet."
          : `Showing ${view.first}–${view.last} of ${view.total} ${
              query ? `partners matching “${query}”` : "partners"
            }.`}
        {query && (
          <>
            {" "}
            <Link className="text-link" href="/admin/partners">
              Clear search
            </Link>
          </>
        )}
      </p>
      {view.items.length > 0 && (
        <div className="table-wrap">
          <table>
            <caption className="visually-hidden">
              {query ? `Partners matching ${query}` : "All partners"}
            </caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Access</th>
                <th scope="col">KYC</th>
                <th scope="col">
                  <span className="visually-hidden">Portfolio</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {view.items.map((item) => (
                <PartnerRow
                  key={`${item.ref.kind}:${item.ref.id}`}
                  item={item}
                  from={from}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view.pageCount > 1 && (
        <nav className="admin-investment-pagination" aria-label="Partner pages">
          {view.page > 1 ? (
            <Link
              className="button-secondary"
              href={partnersHref(query, view.page - 1)}
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
              href={partnersHref(query, view.page + 1)}
            >
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
      <section style={{ marginTop: "2rem" }}>
        <h2>Unclaimed imported partners</h2>
        <p className="muted">
          Link only after independently verifying the partner&apos;s email. This
          action requires AAL2 and sends no email.
        </p>
        {unclaimed.map((item) => (
          <article
            className="card"
            style={{ marginBottom: "1rem" }}
            key={item.ref.id}
          >
            <h3>
              <Link
                className="text-link"
                href={portfolioHref(item.ref, { from })}
              >
                {item.name}
              </Link>
            </h3>
            <LegacyClaimForm partnerId={item.ref.id} />
          </article>
        ))}
      </section>
    </>
  );
}
