import Link from "next/link";
import { requireInvestor } from "@/lib/auth";
import { date, dateTime, ugx } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const profile = await requireInvestor();
  const supabase = await createClient();
  const [{ data: investments }, { data: cycle }, { data: kin }] =
    await Promise.all([
      supabase
        .from("investments")
        .select("*")
        .eq("investor_id", profile.id)
        .in("status", ["reserved", "active"])
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
  const principal = (investments ?? []).reduce(
    (sum, item) => sum + Number(item.principal_ugx),
    0,
  );
  const projected = (investments ?? []).reduce(
    (sum, item) => sum + Number(item.projected_value_ugx),
    0,
  );
  return (
    <>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Welcome back.</h1>
      {!kin && (
        <div className="notice">
          <strong>Finish onboarding.</strong> Add next-of-kin details before
          requesting an investment.{" "}
          <Link href="/profile">Complete profile</Link>
        </div>
      )}
      <div className="grid">
        <article className="card">
          <p className="muted">Reserved + active</p>
          <p className="stat">{investments?.length ?? 0}</p>
        </article>
        <article className="card">
          <p className="muted">Principal</p>
          <p className="stat">{ugx(principal)}</p>
        </article>
        <article className="card">
          <p className="muted">Projected value</p>
          <p className="stat">{ugx(projected)}</p>
        </article>
      </div>
      <section style={{ marginTop: "2rem" }}>
        <div className="page-head">
          <div>
            <p className="eyebrow">Current opportunity</p>
            <h2>{cycle?.name ?? "No cycle is open"}</h2>
          </div>
          {cycle && kin && (
            <Link className="button" href="/investments/new">
              Request units
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
    </>
  );
}
