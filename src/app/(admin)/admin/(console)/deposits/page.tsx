import { randomUUID } from "node:crypto";
import Link from "next/link";
import { z } from "zod";

import { DepositAllocationForm } from "@/components/DepositAllocationForm";
import { requireAdmin } from "@/lib/auth";
import { kampalaDateOfIso } from "@/lib/cycle-assignment";
import { effectiveInvestmentLimit } from "@/lib/investment-limits";
import { date, dateTime, ugx } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

const one = <T,>(value: T | T[] | null | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? null;

export default async function AdminDepositsPage({
  searchParams,
}: {
  searchParams: Promise<{
    partner?: string | string[];
    paid?: string | string[];
    allocated?: string | string[];
  }>;
}) {
  await requireAdmin();
  const admin = createAdminClient();
  const params = await searchParams;
  const partnerId = z.uuid().safeParse(params.partner);
  const paid = z.iso.date().safeParse(params.paid);
  const allocatedId = z.uuid().safeParse(params.allocated);
  const today = kampalaDateOfIso(new Date().toISOString());

  const [{ data: partners, error: partnerError }, { data: deposits, error: depositError }] =
    await Promise.all([
      admin
        .from("profiles")
        .select("id,legal_name,email,is_test")
        .eq("role", "investor")
        .eq("access_status", "active")
        .order("legal_name")
        .limit(1000),
      admin
        .from("bank_deposits")
        .select(
          "id,bank_reference,received_amount_ugx,received_date,received_at,posted_at,authorization_method,authorized_on,evidence_reference,allocation_count,is_test,investor:profiles!bank_deposits_investor_id_fkey(legal_name),poster:profiles!bank_deposits_posted_by_fkey(legal_name),investment_cycles(name),bank_receipts(investment_id,received_amount_ugx,allocation_kind,deposit_line,investments(investment_accounts(name)))",
        )
        .order("posted_at", { ascending: false })
        .limit(25),
    ]);
  if (partnerError || depositError)
    throw new Error(
      "Unable to load bank deposits. Apply the bank deposit migration before using this page.",
    );
  const partner = partnerId.success
    ? partners?.find((item) => item.id === partnerId.data)
    : undefined;

  let review: React.ReactNode = null;
  if (partner && paid.success) {
    const dayStart = new Date(`${paid.data}T00:00:00+03:00`).toISOString();
    const nextDay = new Date(
      Date.parse(`${paid.data}T00:00:00+03:00`) + 86_400_000,
    ).toISOString();
    // Same rule as the database: a cycle intersecting the Uganda payment day.
    const { data: cycles, error: cycleError } = await admin
      .from("investment_cycles")
      .select(
        "id,name,status,opens_at,closes_at,maturity_date,capacity_ugx,agreement_versions(id,version,title,template_markdown,content_hash,is_legally_approved,published_at)",
      )
      .eq("record_origin", "portal")
      .lt("opens_at", nextDay)
      .gt("closes_at", dayStart)
      .limit(2);
    if (cycleError) throw new Error("Unable to load cycles");
    const cycle = cycles?.length === 1 ? cycles[0] : null;
    if (paid.data > today) {
      review = <p className="notice">The payment date cannot be in the future.</p>;
    } else if (!cycle) {
      review = (
        <p className="notice" role="alert">
          {cycles?.length
            ? "More than one cycle covers this payment date. Ask staff to reconcile the cycle boundaries first."
            : "No investment cycle covers this payment date."}
        </p>
      );
    } else {
      const agreement = one(cycle.agreement_versions);
      const [
        { data: accounts },
        { data: reservations },
        { data: partnerRows },
        { data: cycleRows },
        { data: profile },
      ] = await Promise.all([
        admin
          .from("investment_accounts")
          .select("id,name,is_default")
          .eq("investor_id", partner.id)
          .is("archived_at", null)
          .order("is_default", { ascending: false })
          .order("name"),
        admin
          .from("investments")
          .select("id,principal_ugx,requested_at,account_id,investment_accounts(name)")
          .eq("investor_id", partner.id)
          .eq("cycle_id", cycle.id)
          .eq("status", "reserved")
          .eq("record_origin", "portal")
          .order("requested_at"),
        admin
          .from("investments")
          .select("principal_ugx")
          .eq("investor_id", partner.id)
          .eq("cycle_id", cycle.id)
          .in("status", ["reserved", "active"]),
        admin
          .from("investments")
          .select("principal_ugx")
          .eq("cycle_id", cycle.id)
          .eq("is_test", false)
          .in("status", ["reserved", "active"]),
        admin
          .from("profiles")
          .select("investment_limit_ugx,kyc_status")
          .eq("id", partner.id)
          .maybeSingle(),
      ]);
      const sum = (rows: { principal_ugx: number }[] | null) =>
        (rows ?? []).reduce((total, row) => total + Number(row.principal_ugx), 0);
      const limit = effectiveInvestmentLimit(profile?.investment_limit_ugx);
      // eslint-disable-next-line react-hooks/purity -- closure checked on the authenticated server render
      const closed = Date.parse(cycle.closes_at) <= Date.now();
      review = (
        <>
          <h3>{cycle.name}</h3>
          <p>
            Payment date {date(paid.data)} falls in this cycle ({cycle.status}
            {closed ? ", closed" : ""}): opens {dateTime(cycle.opens_at)}, closes{" "}
            {dateTime(cycle.closes_at)}, matures {date(cycle.maturity_date)}.
            {closed &&
              " A payment received inside the cycle can be posted after it closes."}
          </p>
          <p className="muted">
            Partner limit {ugx(limit)} · already in this cycle{" "}
            {ugx(sum(partnerRows))} across all accounts · cycle capacity used{" "}
            {ugx(sum(cycleRows))} of {ugx(Number(cycle.capacity_ugx ?? 0))}
            {partner.is_test ? " (test partner: capacity exempt)" : ""}.
          </p>
          {agreement?.is_legally_approved && agreement.published_at ? (
            <>
              <p>
                Cycle agreement <strong>{agreement.version}</strong> ({agreement.title}).
                New placements record that the partner accepted this agreement
                offline; no electronic acceptance or agreement PDF is created
                for them.
              </p>
              <details>
                <summary>Read the cycle agreement</summary>
                <pre style={{ whiteSpace: "pre-wrap" }}>{agreement.template_markdown}</pre>
              </details>
              <DepositAllocationForm
                // One request ID per rendered form makes retries idempotent.
                requestId={randomUUID()}
                investorId={partner.id}
                cycleId={cycle.id}
                agreementHash={agreement.content_hash}
                receivedDate={paid.data}
                today={today}
                accounts={(accounts ?? []).map(({ id, name }) => ({ id, name }))}
                reservations={(reservations ?? []).map((item) => ({
                  id: item.id,
                  accountId: item.account_id ?? "",
                  accountName: one(item.investment_accounts)?.name ?? "Main Account",
                  amount: String(item.principal_ugx),
                  requested: date(kampalaDateOfIso(item.requested_at)),
                }))}
              />
            </>
          ) : (
            <p className="notice">
              This cycle has no approved, published agreement. Ask staff to
              review it before allocating.
            </p>
          )}
        </>
      );
    }
  }

  const allocated = allocatedId.success
    ? deposits?.find((item) => item.id === allocatedId.data)
    : undefined;
  return (
    <>
      <p className="eyebrow">Payments</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Allocate bank deposit</h1>
      {allocated && (
        <div id="allocation-success" className="success" role="status" tabIndex={-1}>
          <strong>Deposit allocated.</strong>
          <p>
            {one(allocated.investor)?.legal_name ?? "Partner"} ·{" "}
            {allocated.bank_reference} · {ugx(Number(allocated.received_amount_ugx))}{" "}
            across {allocated.allocation_count} investments. Receipts will appear
            under Investments when ready.
          </p>
          <Link href="/admin/deposits">Dismiss</Link>
        </div>
      )}
      <p className="notice">
        Use this when one verified bank transfer pays for several investments of
        one partner. Check the bank statement independently. The partner’s
        retained instructions decide the split; the Uganda payment date decides
        the cycle. Pending reservations are funded in full; other amounts become
        new placements in the partner’s chosen accounts.
      </p>
      <section className="card" style={{ marginBottom: "1rem" }}>
        <h2>Review a deposit</h2>
        <form method="get" className="form">
          <label>
            Partner
            <select name="partner" defaultValue={partner?.id ?? ""} required>
              <option value="">Choose a partner</option>
              {(partners ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.legal_name} · {item.email}
                  {item.is_test ? " · test" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Payment received date (Uganda)
            <input
              name="paid"
              type="date"
              max={today}
              defaultValue={paid.success ? paid.data : ""}
              required
            />
          </label>
          <button className="button-secondary">Review</button>
        </form>
        {review}
      </section>
      <h2>Recent deposits</h2>
      <p className="muted">
        Each bank transfer is listed once, with its allocations beneath it.
      </p>
      {!deposits?.length && <p className="muted">No split deposits recorded yet.</p>}
      {(deposits ?? []).map((item) => (
        <article className="card" key={item.id} style={{ marginBottom: "1rem" }}>
          <h3>
            {item.bank_reference} · {ugx(Number(item.received_amount_ugx))}
            {item.is_test ? " · test" : ""}
          </h3>
          <p>
            {one(item.investor)?.legal_name ?? "Partner"} · paid {date(item.received_date)}
            {item.received_at ? ` (${dateTime(item.received_at)})` : ""} ·{" "}
            {one(item.investment_cycles)?.name ?? "Cycle"}
          </p>
          <p className="muted">
            Posted {dateTime(item.posted_at)} by {one(item.poster)?.legal_name ?? "an administrator"} ·
            instructed {date(item.authorized_on)} by {item.authorization_method.replaceAll("_", " ")} ·
            evidence {item.evidence_reference}
          </p>
          <ul>
            {[...(item.bank_receipts ?? [])]
              .sort((a, b) => (a.deposit_line ?? 0) - (b.deposit_line ?? 0))
              .map((line) => (
                <li key={line.investment_id}>
                  {ugx(Number(line.received_amount_ugx))} ·{" "}
                  {one(one(line.investments)?.investment_accounts)?.name ?? "Account"} ·{" "}
                  {line.allocation_kind === "offline_placement"
                    ? "offline placement"
                    : "reservation"}{" "}
                  · {line.investment_id.slice(0, 8)}
                </li>
              ))}
          </ul>
        </article>
      ))}
    </>
  );
}
