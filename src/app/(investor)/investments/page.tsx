import Link from "next/link";
import { cancelInvestment } from "@/actions/investments";
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
            Request investment <LinkStatus label="Opening investment form" />
          </Link>
        </Button>
      </div>
      <div className="cycle-list">
        {(data ?? []).map((item) => (
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
              profitUgx:
                Number(item.projected_value_ugx ?? 0) -
                Number(item.principal_ugx),
              payoutUgx: item.projected_value_ugx ?? 0,
              maturityDate: item.maturity_date,
              startIso: item.requested_at,
              detailHref: `/investments/${item.id}`,
              detailLabel: "View",
              detailStatus: "Opening investment details",
            }}
            actions={
              item.status === "reserved" ? (
                <form action={cancelInvestment}>
                  <input
                    type="hidden"
                    name="investmentId"
                    value={item.id}
                  />
                  <button type="submit">Cancel</button>
                </form>
              ) : undefined
            }
          />
        ))}
        {!data?.length && (
          <p className="muted">No investment records yet.</p>
        )}
      </div>
    </>
  );
}
