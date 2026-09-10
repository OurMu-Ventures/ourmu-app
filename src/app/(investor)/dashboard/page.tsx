import Link from "next/link";
import { requireInvestor } from "@/lib/auth";
import { date, dateTime, ugx, units } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const profile = await requireInvestor();
  const supabase = await createClient();
  const [{ data: investments }, { data: cycle }, { data: kin }] =
    await Promise.all([
      supabase
        .from("investments")
        .select("*,investment_cycles(name,status,maturity_date)")
        .eq("investor_id", profile.id)
        .order("requested_at", { ascending: false }),
      supabase
        .from("investment_cycles")
        .select("*")
        .eq("status", "open")
        .maybeSingle(),
      supabase
        .from("next_of_kin")
        .select("id")
        .eq("user_id", profile.id)
        .maybeSingle(),
    ]);
  const activeInvestments = (investments ?? []).filter((item) =>
    ["reserved", "active"].includes(item.status),
  );
  const maturedInvestments = (investments ?? []).filter(
    (item) => item.status === "matured",
  );
  const principal = activeInvestments.reduce(
    (sum, item) => sum + Number(item.principal_ugx),
    0,
  );
  const projected = activeInvestments.reduce(
    (sum, item) => sum + Number(item.projected_value_ugx),
    0,
  );
  const totalUnits = activeInvestments.reduce(
    (sum, item) => sum + Number(item.units),
    0,
  );
  const eligible = profile.kyc_status === "verified" && Boolean(kin);
  return (
    <>
      <p className="eyebrow">Your portfolio</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>
        Good day, {profile.legal_name.split(" ")[0]}.
      </h1>
      {!eligible && (
        <div className="notice">
          <strong>Finish onboarding.</strong> KYC verification and next-of-kin
          details are required before requesting an investment.{" "}
          <Link href="/profile">Complete profile</Link>
        </div>
      )}
      <div className="portfolio-summary">
        <article className="card portfolio-hero-card">
          <p className="muted">Active portfolio value at maturity</p>
          <p className="stat">{ugx(projected)}</p>
          <div className="portfolio-hero-breakdown">
            <p>
              <span>Principal</span>
              <strong>{ugx(principal)}</strong>
            </p>
            <p>
              <span>Projected return</span>
              <strong>{ugx(projected - principal)}</strong>
            </p>
          </div>
        </article>
        <article className="card">
          <p className="muted">Active placements</p>
          <p className="stat">{activeInvestments.length}</p>
          <p className="muted">{units(totalUnits)} units</p>
        </article>
        <article className="card">
          <p className="muted">Past placements</p>
          <p className="stat">{maturedInvestments.length}</p>
          <p className="muted">Reported paid records</p>
        </article>
      </div>
      <section style={{ marginTop: "2rem" }}>
        <div className="page-head">
          <div>
            <p className="eyebrow">Current opportunity</p>
            <h2>{cycle?.name ?? "No cycle is open"}</h2>
          </div>
          {cycle && eligible && (
            <Link className="button" href="/investments/new">
              Request investment
            </Link>
          )}
        </div>
        {cycle && (
          <div className="card">
            <p>
              Unit price <strong>{ugx(cycle.unit_price_ugx)}</strong> ·
              projected return <strong>30%</strong> · maturity{" "}
              <strong>{date(cycle.maturity_date)}</strong>.
            </p>
            <p className="muted">
              Cycle closes {dateTime(cycle.closes_at)}. Projection is not a
              guarantee.
            </p>
          </div>
        )}
      </section>
      <section style={{ marginTop: "2rem" }}>
        <div className="page-head">
          <div>
            <p className="eyebrow">Placement history</p>
            <h2>Your active and past cycles</h2>
          </div>
          <Link className="button-secondary" href="/investments">
            View all placements
          </Link>
        </div>
        <div className="cycle-list">
          {(investments ?? []).map((item) => {
            const itemCycle = item.investment_cycles;
            const paid = item.payout_basis === "reported_paid";
            return (
              <article className="card cycle-row" key={item.id}>
                <div>
                  <p className="eyebrow">
                    {itemCycle?.name ?? "OURMU placement"}
                  </p>
                  <h3>
                    {paid ? "Reported paid" : item.status === "active" ? "Active" : item.status}
                  </h3>
                  <p className="muted">
                    {units(item.units ?? 0)} units · matures {date(item.maturity_date)}
                  </p>
                </div>
                <div className="cycle-row-values">
                  <p>
                    <span>Principal</span>
                    <strong>{ugx(item.principal_ugx)}</strong>
                  </p>
                  <p>
                    <span>{paid ? "Reported payout" : "Projected value"}</span>
                    <strong>
                      {ugx(
                        paid
                          ? (item.reported_payout_ugx ?? item.projected_value_ugx)
                          : item.projected_value_ugx,
                      )}
                    </strong>
                  </p>
                  <Link href={`/investments/${item.id}`}>View details</Link>
                </div>
              </article>
            );
          })}
          {!investments?.length && (
            <article className="card">
              <p className="muted">Your placements will appear here once recorded.</p>
            </article>
          )}
        </div>
      </section>
    </>
  );
}
