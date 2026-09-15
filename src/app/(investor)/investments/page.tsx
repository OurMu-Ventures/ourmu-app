import Link from "next/link";
import { cancelInvestment } from "@/actions/investments";
import { CancelInvestmentButton } from "@/components/CancelInvestmentButton";
import { InvestmentCard } from "@/components/InvestmentCard";
import { Button } from "@/components/ui/button";
import { LinkStatus } from "@/components/ui/link-status";
import { requireInvestor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function InvestmentsPage() {
  const profile = await requireInvestor();
  const supabase = await createClient();
  const { data } = await supabase
    .from("investments")
    .select("*,investment_cycles(name)")
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
          // Reservation window is time-sensitive; check at render and re-check server-side on submit.
          // eslint-disable-next-line react-hooks/purity
          const now = Date.now();
          const isCancellable =
            item.status === "reserved" &&
            item.reservation_expires_at &&
            new Date(item.reservation_expires_at).getTime() > now;
          return (
            <InvestmentCard
              key={item.id}
              item={{
                name: Array.isArray(item.investment_cycles)
                  ? (item.investment_cycles[0]?.name ?? "OURMU placement")
                  : (item.investment_cycles?.name ?? "OURMU placement"),
                status: item.status,
                statusLabel: item.status,
                principalUgx: item.principal_ugx,
                unitsValue: item.units ?? 0,
                profitUgx: Number(payout ?? 0) - Number(item.principal_ugx),
                payoutUgx: payout ?? 0,
                maturityDate: item.maturity_date,
                startIso: item.requested_at,
                detailHref: `/investments/${item.id}`,
                detailLabel: "View",
                detailStatus: "Opening investment details",
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
        {!data?.length && (
          <p className="muted">No investment records yet.</p>
        )}
      </div>
    </>
  );
}
