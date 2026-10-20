import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { date, ugx } from "@/lib/format";
import { cycleActualReturnUgx } from "@/lib/actual-returns";
import {
  OfflineAuthorizationForm,
  OfflineCompletionForm,
  OfflineRevocationForm,
} from "@/components/offline-reinvestment-forms";

export default async function OfflineReinvestmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ investment?: string; page?: string }>;
}) {
  await requireAdmin();
  const admin = createAdminClient();
  const params = await searchParams;
  const parsedPage = Number(params.page ?? 1);
  const page =
    Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const [
    { data: records, error },
    { data: candidates, error: candidateError },
    { data: cycles, error: cycleError },
  ] = await Promise.all([
    admin
      .from("offline_reinvestment_authorizations")
      .select(
        "*,legacy_partner_identities(canonical_name),investment_cycles(name),agreement_versions(version),profiles!offline_reinvestment_authorizations_recorded_by_fkey(legal_name)",
      )
      .order("recorded_at", { ascending: false })
      .range((page - 1) * 25, page * 25 - 1),
    admin
      .from("investments")
      .select(
        "id,principal_ugx,maturity_date,legacy_partner_identities(canonical_name),investment_cycles(name,actual_return_bps)",
      )
      .eq("status", "matured")
      .is("investor_id", null)
      .neq("payout_basis", "reported_paid")
      .is("administratively_archived_at", null)
      .order("maturity_date")
      .limit(250),
    admin
      .from("investment_cycles")
      .select(
        "id,name,opens_at,closes_at,maturity_date,projected_return_bps,agreement_versions(id,version,title,template_markdown,content_hash,is_legally_approved,published_at)",
      )
      .eq("status", "open")
      .eq("record_origin", "portal"),
  ]);
  if (error || candidateError || cycleError)
    throw new Error(
      "Unable to load offline reinvestments. Apply the offline authorization migration before using this page.",
    );
  const selected = candidates?.find((item) => item.id === params.investment);
  const cycle = cycles?.[0];
  const agreement = cycle?.agreement_versions;
  const sourceCycle = selected?.investment_cycles;
  const amount =
    selected && sourceCycle?.actual_return_bps != null
      ? (
          Number(selected.principal_ugx) +
          cycleActualReturnUgx(
            selected.principal_ugx,
            sourceCycle.actual_return_bps,
          )
        ).toFixed(2)
      : null;
  // eslint-disable-next-line react-hooks/purity -- enrollment checked on the authenticated server render
  const now = Date.now();
  const enrollmentOpen =
    cycle &&
    now >= Date.parse(cycle.opens_at) &&
    now < Date.parse(cycle.closes_at);
  return (
    <>
      <p className="eyebrow">Maturity review</p>
      <h1>Offline reinvestment authorizations</h1>
      <p>
        Record retained offline evidence for an unclaimed imported partner, then
        review completion. The investment stays with the legacy partner
        identity. A login and email are not required.
      </p>
      <Link href="/admin/maturities?tab=reinvestments">
        Back to reinvestments
      </Link>
      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Record an authorization</h2>
        <form method="get">
          <label>
            Unclaimed matured investment
            <select
              name="investment"
              defaultValue={params.investment ?? ""}
              required
            >
              <option value="">Select an investment</option>
              {(candidates ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.legacy_partner_identities?.canonical_name ??
                    "Unknown partner"}{" "}
                  · {item.investment_cycles?.name} · {ugx(item.principal_ugx)}{" "}
                  principal · {item.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <button className="button-secondary">Review investment</button>
        </form>
        <p className="muted">
          Showing up to 250 unclaimed matured investments. An existing portal
          instruction or offline authorization is rejected by the database.
        </p>
        {selected && (
          <>
            <h3>{selected.legacy_partner_identities?.canonical_name}</h3>
            <p>
              Matured {date(selected.maturity_date)} · full reinvestment{" "}
              {amount
                ? ugx(Number(amount))
                : "unavailable until the source actual return is recorded"}
            </p>
            {enrollmentOpen &&
            agreement?.is_legally_approved &&
            agreement.published_at &&
            amount ? (
              <>
                <p>
                  Destination: <strong>{cycle.name}</strong> · agreement{" "}
                  <strong>{agreement.version}</strong> ({agreement.title})
                </p>
                <p>
                  Matures {date(cycle.maturity_date)} · projected return{" "}
                  {cycle.projected_return_bps / 100}%
                </p>
                <details>
                  <summary>Read the destination agreement</summary>
                  <pre style={{ whiteSpace: "pre-wrap" }}>
                    {agreement.template_markdown}
                  </pre>
                </details>
                <OfflineAuthorizationForm
                  investmentId={selected.id}
                  cycleId={cycle.id}
                  agreementHash={agreement.content_hash}
                  amount={amount}
                  targetMaturityDate={cycle.maturity_date}
                  targetReturnBps={cycle.projected_return_bps}
                />
              </>
            ) : (
              <p className="notice">
                A destination cycle within its enrollment window, a published
                approved agreement, and the source actual return are required.
              </p>
            )}
          </>
        )}
      </section>
      <h2>Recorded authorizations</h2>
      {(records ?? []).map((item) => (
        <article
          className="card"
          key={item.id}
          style={{ marginBottom: "1rem" }}
        >
          <h3>
            {item.legacy_partner_identities?.canonical_name} ·{" "}
            {ugx(item.amount_ugx)}
          </h3>
          <p>
            {item.status} · destination {item.investment_cycles?.name} ·
            agreement {item.agreement_versions?.version}
          </p>
          <p>
            Authorized {date(item.authorized_on)} via{" "}
            {item.method.replaceAll("_", " ")} · recorded by{" "}
            {item.profiles?.legal_name}
          </p>
          <p>
            Destination maturity {date(item.target_maturity_date)} · projected
            return {item.target_return_bps / 100}%
          </p>
          <p>Evidence reference: {item.evidence_reference}</p>
          <p>Verification notes: {item.verification_notes}</p>
          {item.status === "recorded" && (
            <>
              <OfflineCompletionForm authorizationId={item.id} />
              <OfflineRevocationForm authorizationId={item.id} />
            </>
          )}
          {item.status === "fulfilled" && (
            <p>Active investment reference: {item.fulfilled_investment_id}</p>
          )}
          {item.status === "revoked" && (
            <p>Revocation reason: {item.revocation_reason}</p>
          )}
        </article>
      ))}
      <nav aria-label="Offline authorization pages">
        {page > 1 && <Link href={`?page=${page - 1}`}>Previous page</Link>}{" "}
        {records?.length === 25 && (
          <Link href={`?page=${page + 1}`}>Next page</Link>
        )}
      </nav>
    </>
  );
}
