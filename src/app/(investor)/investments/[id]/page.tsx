import Link from "next/link";
import { notFound } from "next/navigation";
import { cancelInvestment } from "@/actions/investments";
import { CancelInvestmentButton } from "@/components/CancelInvestmentButton";
import {
  MaturityConfirmAmountsForm,
  MaturityInstructionForm,
  type OpenCycleOption,
  type SavedDestination,
} from "@/components/maturity-forms";
import { requireInvestor } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { LinkStatus } from "@/components/ui/link-status";
import { bpsToPercent, date, dateTime, ugx } from "@/lib/format";
import { fulfilledSplits, maturityChoiceLabel, maturityPayoutDateIso } from "@/lib/maturity";
import { investmentPeriod } from "@/lib/investments";
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
    .select(
      "*,investment_agreements(id,pdf_status),investment_receipts(id,receipt_number,pdf_status),investment_cycles(name,opens_at)",
    )
    .eq("id", id)
    .eq("investor_id", profile.id)
    .maybeSingle();
  if (!data) notFound();
  const agreement = Array.isArray(data.investment_agreements)
    ? data.investment_agreements[0]
    : data.investment_agreements;
  const receiptRaw = (data as unknown as { investment_receipts?: unknown }).investment_receipts;
  const receipt = (
    Array.isArray(receiptRaw)
      ? receiptRaw[0]
      : receiptRaw
  ) as { id: string; receipt_number: string; pdf_status: string } | undefined;
  const isPortalMatured =
    data.status === "matured" && data.record_origin === "portal";
  const [{ data: instruction }, { data: destinations }, { data: openCycles }] =
    isPortalMatured
      ? await Promise.all([
          supabase
            .from("maturity_instructions")
            .select("*")
            .eq("investment_id", id)
            .maybeSingle(),
          supabase
            .from("payout_destinations")
            .select(
              "id,channel,provider_label,account_name,account_last_four",
            )
            .eq("investor_id", profile.id)
            .eq("is_active", true)
            .order("created_at", { ascending: false }),
          supabase
            .from("investment_cycles")
            .select("id,name,agreement_version_id,agreement_versions(title)")
            .eq("status", "open")
            .eq("record_origin", "portal"),
        ])
      : [{ data: null }, { data: null }, { data: null }];
  const cycleOptions: OpenCycleOption[] = (openCycles ?? []).map((cycle) => {
    const version = Array.isArray(cycle.agreement_versions)
      ? cycle.agreement_versions[0]
      : cycle.agreement_versions;
    return {
      id: cycle.id,
      name: cycle.name,
      agreement_version_id: cycle.agreement_version_id ?? "",
      agreement_title: version?.title ?? "Participation agreement",
    };
  });
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const isCancellable =
    data.status === "reserved" &&
    data.reservation_expires_at &&
    new Date(data.reservation_expires_at).getTime() > now;
  const isExpired =
    data.status === "reserved" &&
    data.reservation_expires_at &&
    new Date(data.reservation_expires_at).getTime() <= now;
  const period = investmentPeriod(
    Array.isArray(data.investment_cycles)
      ? data.investment_cycles[0]?.opens_at
      : data.investment_cycles?.opens_at,
    data.maturity_date,
  );
  return (
    <>
      <p className="eyebrow">Investment record</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>
        Investment details
      </h1>
      <p>
        <span className="badge">{data.status}</span>
      </p>
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
        {period && (
          <p>
            Duration: <strong>{period}</strong>
          </p>
        )}
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
        {receipt ? (
          receipt.pdf_status === "ready" ? (
            <Button asChild variant="secondary">
              <Link href={`/receipts/${receipt.id}`}>
                Download receipt {receipt.receipt_number}{" "}
                <LinkStatus label="Opening receipt" />
              </Link>
            </Button>
          ) : receipt.pdf_status === "failed" ? (
            <p className="notice">
              Receipt {receipt.receipt_number} generation failed. OURMU staff
              can retry it without reversing your investment.
            </p>
          ) : (
            <p className="muted">Receipt {receipt.receipt_number} is generating…</p>
          )
        ) : data.status === "active" ? (
          <p className="muted">Receipt generation pending…</p>
        ) : null}
        {isCancellable && (
          <div style={{ marginTop: "1rem" }}>
            <p className="muted" style={{ marginBottom: "0.5rem" }}>
              Reserved — transfer the exact amount before expiry or cancel
              this reservation.
            </p>
            <CancelInvestmentButton
              action={cancelInvestment}
              investmentId={data.id}
              variant="danger"
            />
          </div>
        )}
        {isExpired && (
          <p className="muted" style={{ marginTop: "1rem" }}>
            This reservation has expired. It will be marked expired on the
            next maintenance run.
          </p>
        )}
      </div>
      {isPortalMatured && (
        <div className="card" style={{ marginTop: "1rem" }}>
          <p className="eyebrow">Matured investment choices</p>
          <h2>What should happen to this placement?</h2>
          <p>
            Projected return{" "}
            <strong>
              {bpsToPercent(data.projected_return_bps ?? 3000)}%
            </strong>{" "}
            ({ugx(data.projected_return_ugx)}) on{" "}
            {ugx(data.principal_ugx)} principal. Payouts are scheduled for{" "}
            <strong>{date(maturityPayoutDateIso(data.maturity_date))}</strong>.
            The amount actually paid follows the return recorded by the fund,
            which may differ from this projection.
          </p>
          {!instruction && (
            <MaturityInstructionForm
              investmentId={data.id}
              principalUgx={Number(data.principal_ugx)}
              projectedReturnUgx={Number(data.projected_return_ugx)}
              savedDestinations={(destinations ?? []) as SavedDestination[]}
              openCycles={cycleOptions}
              isRevision={false}
            />
          )}
          {instruction?.status === "requested" && (
            <>
              <p className="notice">
                Choice recorded: <strong>{maturityChoiceLabel(instruction.choice)}</strong>{" "}
                (projected payout {ugx(instruction.projected_payout_ugx)} ·
                projected reinvestment {ugx(instruction.projected_reinvest_ugx)}
                ). You can revise it until an admin begins processing.
              </p>
              {instruction.resolution_notes && (
                <p className="notice">
                  Our team asked for a revision:{" "}
                  <strong>{instruction.resolution_notes}</strong>
                </p>
              )}
              <MaturityInstructionForm
                investmentId={data.id}
                principalUgx={Number(data.principal_ugx)}
                projectedReturnUgx={Number(data.projected_return_ugx)}
                savedDestinations={(destinations ?? []) as SavedDestination[]}
                openCycles={cycleOptions}
                existingChoice={instruction.choice}
                isRevision
              />
            </>
          )}
          {instruction?.status === "processing" && (
            <>
              <p className="notice">
                Your choice (<strong>{maturityChoiceLabel(instruction.choice)}</strong>) is being
                processed by our team and can no longer be revised.
              </p>
              {instruction.proposed_actual_roi_ugx != null &&
                instruction.confirmed_actual_roi_ugx !==
                  instruction.proposed_actual_roi_ugx &&
                (() => {
                  const proposed = fulfilledSplits(
                    Number(data.principal_ugx),
                    Number(instruction.proposed_actual_roi_ugx),
                    instruction.choice,
                  );
                  return (
                    <MaturityConfirmAmountsForm
                      instructionId={instruction.id}
                      proposedRoiUgx={Number(
                        instruction.proposed_actual_roi_ugx,
                      )}
                      proposedPayoutUgx={proposed.payoutUgx}
                      proposedReinvestUgx={proposed.reinvestUgx}
                    />
                  );
                })()}
            </>
          )}
          {instruction?.status === "fulfilled" && (
            <p className="notice">
              Fulfilled: payout {ugx(instruction.actual_payout_ugx ?? 0)} ·
              reinvestment {ugx(instruction.actual_reinvest_ugx ?? 0)} from an
              actual return of {ugx(instruction.actual_roi_ugx ?? 0)}.
            </p>
          )}
        </div>
      )}
      {data.status === "matured" && data.record_origin !== "portal" && (
        <div className="card" style={{ marginTop: "1rem" }}>
          <p className="muted">
            Historical record. Maturity choices apply to newly matured portal
            placements; this imported record is unchanged.
          </p>
        </div>
      )}
    </>
  );
}
