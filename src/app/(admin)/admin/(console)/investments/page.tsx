import Link from "next/link";

import { getReceiptDownloadUrl } from "@/actions/receipts";
import { ActivationForm } from "@/components/forms";
import { requireAdmin } from "@/lib/auth";
import { date, dateTime, ugx, units } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

const PAGE_SIZE = 25;
const PARTNER_OPTION_LIMIT = 25;

type SearchParams = Promise<{
  partner?: string | string[];
  partnerSearch?: string | string[];
  cycle?: string | string[];
  page?: string | string[];
}>;

function singleParam(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

function pageNumber(value: string) {
  const parsed = Number(value);
  return /^\d+$/.test(value) &&
    Number.isSafeInteger(parsed) &&
    parsed > 0 &&
    parsed <= 1_000_000
    ? parsed
    : 1;
}

function pageHref(
  partner: string,
  partnerSearch: string,
  cycle: string,
  page: number,
) {
  const params = new URLSearchParams();
  if (partner) params.set("partner", partner);
  if (partnerSearch) params.set("partnerSearch", partnerSearch);
  if (cycle) params.set("cycle", cycle);
  params.set("page", String(page));
  return `/admin/investments?${params.toString()}`;
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
  const page = pageNumber(singleParam(params.page));

  // Escape LIKE wildcards so a name search stays a literal, bounded lookup.
  const searchPattern = `%${partnerSearch.replace(/[\\%_]/g, "\\$&")}%`;
  let profileOptionsQuery = admin
    .from("profiles")
    .select("id,legal_name,email")
    .eq("role", "investor");
  let legacyOptionsQuery = admin
    .from("legacy_partner_identities")
    .select("id,canonical_name,normalized_email,profile_id")
    .is("profile_id", null);
  if (partnerSearch) {
    profileOptionsQuery = profileOptionsQuery.ilike(
      "legal_name",
      searchPattern,
    );
    legacyOptionsQuery = legacyOptionsQuery.ilike(
      "canonical_name",
      searchPattern,
    );
  }
  const [
    { data: profiles, error: profilesError },
    { data: legacyIdentities, error: legacyError },
    { data: cycles, error: cyclesError },
  ] = await Promise.all([
    profileOptionsQuery.order("legal_name").limit(PARTNER_OPTION_LIMIT),
    legacyOptionsQuery.order("canonical_name").limit(PARTNER_OPTION_LIMIT),
    admin
      .from("investment_cycles")
      .select("id,name")
      .order("opens_at", { ascending: false }),
  ]);
  if (profilesError || legacyError || cyclesError) {
    throw new Error("Unable to load investment filters");
  }

  let partnerOptions = [
    ...(profiles ?? []).map((profile) => ({
      value: `profile:${profile.id}`,
      label: `${profile.legal_name} (${profile.email})`,
    })),
    ...(legacyIdentities ?? []).map((identity) => ({
      value: `legacy:${identity.id}`,
      label: `Unclaimed: ${identity.canonical_name}${
        identity.normalized_email ? ` (${identity.normalized_email})` : ""
      }`,
    })),
  ];
  let selectedPartner = partnerOptions.find(
    (option) => option.value === partner,
  );
  if (partner && !selectedPartner) {
    if (partner.startsWith("profile:")) {
      const { data, error } = await admin
        .from("profiles")
        .select("id,legal_name,email")
        .eq("role", "investor")
        .eq("id", partner.slice("profile:".length))
        .maybeSingle();
      if (error) throw new Error("Unable to load selected partner");
      if (data)
        selectedPartner = {
          value: `profile:${data.id}`,
          label: `${data.legal_name} (${data.email})`,
        };
    } else if (partner.startsWith("legacy:")) {
      const { data, error } = await admin
        .from("legacy_partner_identities")
        .select("id,canonical_name,normalized_email,profile_id")
        .eq("id", partner.slice("legacy:".length))
        .is("profile_id", null)
        .maybeSingle();
      if (error) throw new Error("Unable to load selected partner");
      if (data)
        selectedPartner = {
          value: `legacy:${data.id}`,
          label: `Unclaimed: ${data.canonical_name}${data.normalized_email ? ` (${data.normalized_email})` : ""}`,
        };
    }
    if (selectedPartner) partnerOptions = [selectedPartner, ...partnerOptions];
  }
  const selectedCycle = (cycles ?? []).find((option) => option.id === cycle);
  const invalidFilter =
    (partner !== "" && !selectedPartner) || (cycle !== "" && !selectedCycle);

  const investmentResult = invalidFilter
    ? null
    : await (async () => {
        let query = admin
          .from("investments")
          .select(
            "id,investor_id,legacy_partner_id,cycle_id,record_origin,status,units,principal_ugx,projected_value_ugx,reported_payout_ugx,requested_at,maturity_date,profiles(legal_name,email),investment_cycles(name),legacy_partner_identities(canonical_name,normalized_email),investment_receipts(id,receipt_number,pdf_status)",
            { count: "exact" },
          );
        if (partner.startsWith("profile:")) {
          // selectedPartner was resolved from the database before any raw
          // PostgREST .or() expression is built. Never interpolate input here.
          const profileId = selectedPartner!.value.slice("profile:".length);
          const { data: linkedIdentities, error: linkedError } = await admin
            .from("legacy_partner_identities")
            .select("id")
            .eq("profile_id", profileId);
          if (linkedError) throw new Error("Unable to load linked partners");
          const linkedLegacyIds = (linkedIdentities ?? []).map(
            (identity) => identity.id,
          );
          query = linkedLegacyIds.length
            ? query.or(
                `investor_id.eq.${profileId},legacy_partner_id.in.(${linkedLegacyIds.join(",")})`,
              )
            : query.eq("investor_id", profileId);
        } else if (partner.startsWith("legacy:")) {
          query = query.eq(
            "legacy_partner_id",
            selectedPartner!.value.slice("legacy:".length),
          );
        }
        if (cycle) query = query.eq("cycle_id", cycle);
        const from = (page - 1) * PAGE_SIZE;
        return query
          .order("requested_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + PAGE_SIZE - 1);
      })();
  if (investmentResult?.error) throw new Error("Unable to load investments");
  const investments = investmentResult?.data ?? [];
  const count = investmentResult?.count ?? 0;

  return (
    <>
      <p className="eyebrow">Partner investment records</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Investments</h1>
      <p className="notice">
        Compare bank statements independently before activating a reservation.
        Activation requires the exact amount, a unique reference, the received
        date, typed confirmation, and your current AAL2 session.
      </p>

      <form
        action="/admin/investments"
        method="get"
        className="card admin-investment-filters"
      >
        <label>
          Find partner by name
          <input
            name="partnerSearch"
            type="search"
            defaultValue={partnerSearch}
            placeholder="Enter a name"
          />
        </label>
        <label>
          Partner
          <select name="partner" defaultValue={selectedPartner?.value ?? ""}>
            <option value="">All partners</option>
            {partnerOptions.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="muted">
            Showing up to {PARTNER_OPTION_LIMIT} matching profiles and unclaimed
            partners. Search, then choose a partner and apply filters.
          </span>
        </label>
        <label>
          Cycle
          <select name="cycle" defaultValue={selectedCycle?.id ?? ""}>
            <option value="">All cycles</option>
            {(cycles ?? []).map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <div className="admin-investment-filter-actions">
          <button className="button-secondary" type="submit">
            Find partners
          </button>
          <button className="button" type="submit">
            Apply filters
          </button>
          <Link href="/admin/investments">Clear</Link>
        </div>
      </form>

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
          {investments.map((item) => (
            <article
              className="card"
              style={{ marginBottom: "1rem" }}
              key={item.id}
            >
              <div className="page-head">
                <div>
                  <h2>
                    {(Array.isArray(item.profiles)
                      ? item.profiles[0]?.legal_name
                      : item.profiles?.legal_name) ??
                      (Array.isArray(item.legacy_partner_identities)
                        ? item.legacy_partner_identities[0]?.canonical_name
                        : item.legacy_partner_identities?.canonical_name) ??
                      "Unclaimed partner"}
                  </h2>
                  <p>
                    {(Array.isArray(item.investment_cycles)
                      ? item.investment_cycles[0]?.name
                      : item.investment_cycles?.name) ?? "Unknown cycle"}{" "}
                    · {units(item.units ?? 0)} units · {ugx(item.principal_ugx)}
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
              {item.status === "reserved" &&
                item.record_origin === "portal" && (
                  <ActivationForm
                    investmentId={item.id}
                    expectedAmount={Number(item.principal_ugx)}
                  />
                )}
              <ReceiptAdminLine receipts={item.investment_receipts} />
            </article>
          ))}
          {count > 0 && (page > 1 || page * PAGE_SIZE < count) && (
            <nav
              className="admin-investment-pagination"
              aria-label="Investment pages"
            >
              {page > 1 && (
                <Link
                  className="button-secondary"
                  href={pageHref(partner, partnerSearch, cycle, page - 1)}
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
                  href={pageHref(partner, partnerSearch, cycle, page + 1)}
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
