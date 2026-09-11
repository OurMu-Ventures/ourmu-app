import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInvestor } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { LinkStatus } from "@/components/ui/link-status";
import { date, dateTime, ugx, units } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export default async function InvestmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireInvestor();
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("investments")
    .select("*,investment_agreements(id,pdf_status)")
    .eq("id", id)
    .eq("investor_id", profile.id)
    .maybeSingle();
  if (!data) notFound();
  const agreement = Array.isArray(data.investment_agreements)
    ? data.investment_agreements[0]
    : data.investment_agreements;
  return (
    <>
      <p className="eyebrow">Investment record</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>
        {units(data.units ?? 0)} units · {data.status}
      </h1>
      <div className="grid">
        <article className="card">
          <p className="muted">Principal</p>
          <p className="stat">{ugx(data.principal_ugx)}</p>
        </article>
        <article className="card">
          <p className="muted">
            {data.payout_basis === "reported_paid"
              ? "Reported return paid"
              : "Projected return"}
          </p>
          <p className="stat">
            {ugx(data.reported_return_ugx ?? data.projected_return_ugx)}
          </p>
        </article>
        <article className="card">
          <p className="muted">
            {data.payout_basis === "reported_paid"
              ? "Reported payout"
              : "Projected value"}
          </p>
          <p className="stat">
            {ugx(data.reported_payout_ugx ?? data.projected_value_ugx)}
          </p>
        </article>
      </div>
      <div className="card" style={{ marginTop: "1rem" }}>
        <p>
          Maturity: <strong>{date(data.maturity_date)}</strong>
        </p>
        {data.status === "reserved" && data.reservation_expires_at && (
          <p>
            Reservation expires:{" "}
            <strong>{dateTime(data.reservation_expires_at)}</strong>
          </p>
        )}
        <p>
          Record source: <span className="badge">{data.record_origin}</span>
        </p>
        <p>
          Agreement status:{" "}
          <span className="badge">
            {agreement?.pdf_status ?? "legacy agreement not digitized"}
          </span>
        </p>
        {agreement && (
          <Button asChild variant="secondary">
            <Link href={`/agreements/${agreement.id}`}>
              Open agreement <LinkStatus label="Opening agreement" />
            </Link>
          </Button>
        )}
      </div>
    </>
  );
}
