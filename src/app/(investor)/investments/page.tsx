import Link from "next/link";
import { cancelInvestment } from "@/actions/investments";
import { CancelInvestmentButton } from "@/components/CancelInvestmentButton";
import { InvestmentCard } from "@/components/InvestmentCard";
import { Button } from "@/components/ui/button";
import { LinkStatus } from "@/components/ui/link-status";
import { requireInvestor } from "@/lib/auth";
import { canChooseMaturity, investmentPeriod } from "@/lib/investments";
import { createClient } from "@/lib/supabase/server";

export default async function InvestmentsPage() {
  const profile = await requireInvestor();
  const supabase = await createClient();
  const { data } = await supabase
    .from("investments")
    .select(
      "*,investment_cycles(name,opens_at),maturity_instructions!maturity_instructions_investment_id_fkey(status)",
    )
    .eq("investor_id", profile.id)
    .order("requested_at", { ascending: false });
  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Portfolio records</p>
          <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Investments</h1>
        </div>
        <Button asChild>
          <Link href="/investments/new">
            Make an Investment <LinkStatus label="Opening investment form" />
          </Link>
        </Button>
      </div>
      <div className="cycle-list">
        {(data ?? []).map((item) => {
          const payout =
            item.payout_basis === "reported_paid"
              ? (item.reported_payout_ugx ?? item.projected_value_ugx)
              : item.projected_value_ugx;
          const isCancellable = item.status === "reserved";
          const cycleName = Array.isArray(item.investment_cycles)
            ? (item.investment_cycles[0]?.name ?? "OURMU placement")
            : (item.investment_cycles?.name ?? "OURMU placement");
          const termStart = Array.isArray(item.investment_cycles)
            ? item.investment_cycles[0]?.opens_at
            : item.investment_cycles?.opens_at;
          const maturityAction = canChooseMaturity(
            item,
            item.maturity_instructions?.status,
          );
          return (
            <InvestmentCard
              key={item.id}
              item={{
                name:
                  investmentPeriod(termStart, item.maturity_date) ?? cycleName,
                status: item.status,
                statusLabel:
                  item.payout_basis === "reported_paid"
                    ? "Reported paid"
                    : item.status,
                principalUgx: item.principal_ugx,
                isPaid: item.payout_basis === "reported_paid",
                profitUgx: Number(payout ?? 0) - Number(item.principal_ugx),
                payoutUgx: payout ?? 0,
                maturityDate: item.maturity_date,
                startIso: item.requested_at,
                detailHref: `/investments/${item.id}`,
                detailLabel: maturityAction
                  ? "Withdraw or Re-invest"
                  : "View details",
                detailStatus: maturityAction
                  ? "Opening maturity choices"
                  : "Opening investment details",
                detailAction: maturityAction,
              }}
              actions={
                isCancellable ? (
                  <CancelInvestmentButton
                    action={cancelInvestment}
                    investmentId={item.id}
                  />
                ) : undefined
              }
            />
          );
        })}
        {!data?.length && <p className="muted">No investment records yet.</p>}
      </div>
      <p className="notice" style={{ marginTop: "1rem" }}>
        Missing an investment or spotted an incorrect record? Email{" "}
        <a href="mailto:community@ourmu.org">community@ourmu.org</a> and include
        any supporting documentation, such as receipts or deposit confirmations.
      </p>
    </>
  );
}
