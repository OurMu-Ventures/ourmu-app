import { InvestmentRequestForm } from "@/components/forms";
import { requireInvestor } from "@/lib/auth";
import { date, ugx } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export default async function NewInvestmentPage() {
  const profile = await requireInvestor();
  const supabase = await createClient();
  const [{ data: cycle }, { data: kin }, { data: bank }] = await Promise.all([
    supabase
      .from("investment_cycles")
      .select("*,agreement_versions(id,title,version,content_hash)")
      .eq("status", "open")
      .maybeSingle(),
    supabase
      .from("next_of_kin")
      .select("id")
      .eq("user_id", profile.id)
      .maybeSingle(),
    supabase
      .from("bank_instructions")
      .select("*")
      .eq("is_active", true)
      .maybeSingle(),
  ]);
  if (!cycle)
    return (
      <>
        <h1 style={{ fontSize: "3rem" }}>No cycle is open.</h1>
        <p>
          OURMU will email approved partners when a new cycle is available.
        </p>
      </>
    );
  if (!kin)
    return (
      <>
        <h1 style={{ fontSize: "3rem" }}>Complete your profile first.</h1>
        <p>Next-of-kin details are required for the final agreement.</p>
      </>
    );
  if (profile.kyc_status !== "verified")
    return (
      <>
        <h1 style={{ fontSize: "3rem" }}>KYC verification is required.</h1>
        <p>
          An administrator must complete offline verification before you can
          invest.
        </p>
      </>
    );
  const agreement = Array.isArray(cycle.agreement_versions)
    ? cycle.agreement_versions[0]
    : cycle.agreement_versions;
  return (
    <>
      <p className="eyebrow">New investment</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>{cycle.name}</h1>
      <div className="grid">
        <article className="card">
          <p className="muted">Per unit</p>
          <p className="stat">{ugx(cycle.unit_price_ugx)}</p>
        </article>
        <article className="card">
          <p className="muted">Projected return</p>
          <p className="stat">30%</p>
        </article>
        <article className="card">
          <p className="muted">Maturity</p>
          <p className="stat">{date(cycle.maturity_date)}</p>
        </article>
      </div>
      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Request and accept</h2>
        <p className="muted">
          Each request creates a separate investment placement. You may make
          multiple placements in this monthly cycle, subject to your cumulative
          cycle limit and the remaining cycle capacity.
        </p>
        <InvestmentRequestForm
          cycleId={cycle.id}
          agreementId={agreement.id}
          agreementTitle={agreement?.title ?? "Current agreement"}
        />
      </section>
      {bank && (
        <section className="card" style={{ marginTop: "1rem" }}>
          <h2>Receiving bank</h2>
          <p>
            <strong>{bank.bank_name}</strong>
            <br />
            {bank.account_name}
            <br />
            {bank.account_number}
            <br />
            {bank.branch}
          </p>
          <p>{bank.instructions}</p>
          <p className="notice">
            Transfer only after reserving. Use the exact amount shown on your
            reservation.
          </p>
        </section>
      )}
    </>
  );
}
