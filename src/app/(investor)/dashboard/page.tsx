import Link from "next/link";
import { requireInvestor } from "@/lib/auth";
import { InvestmentCard } from "@/components/InvestmentCard";
import {
  CurrentOpportunityRate,
  PortfolioSummary,
} from "@/components/PortfolioOverview";
import { Button } from "@/components/ui/button";
import { LinkStatus } from "@/components/ui/link-status";
import { date, dateTime } from "@/lib/format";
import { investmentPeriod } from "@/lib/investments";
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
  const eligible = profile.kyc_status === "verified" && Boolean(kin);
  return (
    <>
      <p className="eyebrow">Your portfolio</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>
        Good day, {profile.legal_name.split(" ")[0]}.
      </h1>
      {profile.is_test && (
        <div className="notice">
          <strong>Test account.</strong> All amounts and placements shown for
          this account are sample data and are excluded from OURMU financial
          totals and cycle capacity.
        </div>
      )}
      {!eligible && (
        <div className="notice">
          <strong>Finish onboarding.</strong> KYC verification and next-of-kin
          details are required before requesting an investment.{" "}
          <Link href="/profile">
            Complete profile <LinkStatus label="Opening profile" />
          </Link>
        </div>
      )}
      <PortfolioSummary
        principal={principal}
        projected={projected}
        activeCount={activeInvestments.length}
        maturedCount={maturedInvestments.length}
      />
      <section style={{ marginTop: "2rem" }}>
        <div className="page-head">
          <div>
            <p className="eyebrow">Current opportunity</p>
            <h2>{cycle?.name ?? "No cycle is open"}</h2>
          </div>
          {cycle && eligible && (
            <Button asChild>
              <Link href="/investments/new">
                Make an Investment{" "}
                <LinkStatus label="Opening investment form" />
              </Link>
            </Button>
          )}
        </div>
        {cycle && (
          <div className="card">
            <p>
              Projected return{" "}
              <CurrentOpportunityRate
                projectedReturnBps={cycle.projected_return_bps}
              />{" "}
              · maturity <strong>{date(cycle.maturity_date)}</strong>.
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
          <Button asChild variant="secondary">
            <Link href="/investments">
              View all placements{" "}
              <LinkStatus label="Opening investments" />
            </Link>
          </Button>
        </div>
        <div className="cycle-list">
          {(investments ?? []).map((item) => {
            const itemCycle = item.investment_cycles;
            const paid = item.payout_basis === "reported_paid";
            const payout = paid
              ? (item.reported_payout_ugx ?? item.projected_value_ugx)
              : item.projected_value_ugx;
            return (
              <InvestmentCard
                key={item.id}
                item={{
                  name:
                    investmentPeriod(item.requested_at, item.maturity_date) ??
                    (itemCycle?.name ?? "OURMU placement"),
                  status: item.status,
                  statusLabel: paid
                    ? "Reported paid"
                    : item.status === "active"
                      ? "Active"
                      : item.status,
                  principalUgx: item.principal_ugx,
                  isPaid: paid,
                  profitUgx: Number(payout ?? 0) - Number(item.principal_ugx),
                  payoutUgx: payout ?? 0,
                  maturityDate: item.maturity_date,
                  startIso: item.requested_at,
                  detailHref: `/investments/${item.id}`,
                  detailLabel: "View details",
                  detailStatus: "Opening investment details",
                }}
              />
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
