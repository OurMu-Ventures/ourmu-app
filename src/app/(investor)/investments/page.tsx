import Link from "next/link";
import { cancelInvestment } from "@/actions/investments";
import { CancelInvestmentButton } from "@/components/CancelInvestmentButton";
import { InvestmentCard } from "@/components/InvestmentCard";
import { Button } from "@/components/ui/button";
import { LinkStatus } from "@/components/ui/link-status";
import { investmentReturnView } from "@/lib/actual-returns";
import { requireInvestor } from "@/lib/auth";
import {
  canChooseMaturity,
  investmentCycleTitle,
  investmentRecordedDate,
  investmentTitle,
} from "@/lib/investments";
import { createClient } from "@/lib/supabase/server";

export default async function InvestmentsPage() {
  const profile = await requireInvestor();
  const supabase = await createClient();
  const { data } = await supabase
    .from("investments")
    .select(
      "*,investment_cycles(name,opens_at,actual_return_bps,legacy_settlement),investment_receipts!investment_receipts_investment_id_fkey(source,transaction_date),maturity_instructions!maturity_instructions_investment_id_fkey(status,choice,investment_cycles!maturity_instructions_target_cycle_id_fkey(name,maturity_date))",
    )
    .eq("investor_id", profile.id)
    .neq("status", "cancelled")
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
          const cycle = Array.isArray(item.investment_cycles)
            ? item.investment_cycles[0]
            : item.investment_cycles;
          const returns = investmentReturnView(item, cycle);
          const isCancellable = item.status === "reserved";
          const maturityAction = canChooseMaturity(
            item,
            item.maturity_instructions?.status,
          );
          const defaultTitle = investmentCycleTitle(cycle?.name);
          return (
            <InvestmentCard
              key={item.id}
              depositUploadsEnabled={
                process.env.DEPOSIT_SLIPS_ENABLED === "true" &&
                item.record_origin === "portal"
              }
              item={{
                investmentId: item.id,
                alias: item.alias,
                defaultTitle,
                name: investmentTitle(item.alias, defaultTitle),
                status: item.status,
                statusLabel:
                  item.payout_basis === "reported_paid"
                    ? "Reported paid"
                    : item.status,
                principalUgx: item.principal_ugx,
                isPaid: item.payout_basis === "reported_paid",
                returnBasis: returns.basis,
                returnPending: returns.pending,
                returnRevisable: returns.revisable,
                profitUgx: returns.valueUgx - Number(item.principal_ugx),
                payoutUgx: returns.valueUgx,
                maturityDate: item.maturity_date,
                startIso: item.requested_at,
                recordedDate: investmentRecordedDate(
                  item.investment_receipts,
                  item.status,
                  item.requested_at,
                ),
                pendingReinvestment:
                  item.maturity_instructions &&
                  ["requested", "processing"].includes(
                    item.maturity_instructions.status,
                  ) &&
                  item.maturity_instructions.choice !== "withdraw_all"
                    ? item.maturity_instructions.investment_cycles
                    : null,
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
