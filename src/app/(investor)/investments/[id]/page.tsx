import { effectiveInvestmentLimit } from "@/lib/investment-limits";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cancelInvestment } from "@/actions/investments";
import { CancelInvestmentButton } from "@/components/CancelInvestmentButton";
import {
  MaturityConfirmAmountsForm,
  MaturityInstructionForm,
  type SavedDestination,
} from "@/components/maturity-forms";
import { requireInvestor } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { LinkStatus } from "@/components/ui/link-status";
import { bpsToPercent, date, ugx } from "@/lib/format";
import {
  safeFulfilledSplits,
  UNAVAILABLE_MATURITY_AMOUNTS,
  maturityInstructionTerms,
  maturityChoiceLabel,
  maturityPayoutDateIso,
} from "@/lib/maturity";
import { canChooseMaturity, investmentPeriod } from "@/lib/investments";
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
      "*,investment_agreements(id,pdf_status),investment_receipts!investment_receipts_investment_id_fkey(id,receipt_number,pdf_status),investment_cycles(name,opens_at)",
    )
    .eq("id", id)
    .eq("investor_id", profile.id)
    .maybeSingle();
  if (!data) notFound();
  const agreement = Array.isArray(data.investment_agreements)
    ? data.investment_agreements[0]
    : data.investment_agreements;
  const receiptRaw = (data as unknown as { investment_receipts?: unknown })
    .investment_receipts;
  const receipt = (Array.isArray(receiptRaw) ? receiptRaw[0] : receiptRaw) as
    { id: string; receipt_number: string; pdf_status: string } | undefined;
  const isMatured = canChooseMaturity(data);
  const nowIso = new Date().toISOString();
  const [
    { data: instruction },
    { data: destinations },
    { data: assignedCycleRow },
  ] = isMatured
    ? await Promise.all([
        supabase
          .from("maturity_instructions")
          .select("*")
          .eq("investment_id", id)
          .maybeSingle(),
        supabase
          .from("payout_destinations")
          .select("id,channel,provider_label,account_name,account_last_four")
          .eq("investor_id", profile.id)
          .eq("is_active", true)
          .order("created_at", { ascending: false }),
        supabase
          .from("investment_cycles")
          .select(
            "id,name,maturity_date,agreement_version_id,agreement_versions(title)",
          )
          .eq("status", "open")
          .eq("record_origin", "portal")
          .lte("opens_at", nowIso)
          .gt("closes_at", nowIso)
          .maybeSingle(),
      ])
    : [{ data: null }, { data: null }, { data: null }];
  const { data: recordedCycle } = instruction?.target_cycle_id
    ? await supabase
        .from("investment_cycles")
        .select("id,name,maturity_date")
        .eq("id", instruction.target_cycle_id)
        .maybeSingle()
    : { data: null };
  const instructionTerms = instruction
    ? maturityInstructionTerms(
        instruction.choice,
        instruction.requested_withdrawal_ugx,
      )
    : null;
  const assignedVersion = assignedCycleRow
    ? Array.isArray(assignedCycleRow.agreement_versions)
      ? assignedCycleRow.agreement_versions[0]
      : assignedCycleRow.agreement_versions
    : null;
  const assignedCycle = assignedCycleRow
    ? {
        id: assignedCycleRow.id,
        name: assignedCycleRow.name,
        maturity_date: assignedCycleRow.maturity_date,
        agreement_version_id: assignedCycleRow.agreement_version_id ?? "",
        agreement_title: assignedVersion?.title ?? "Participation agreement",
      }
    : null;
  const isCancellable = data.status === "reserved";
  const isExpired = data.status === "expired";
  const period = investmentPeriod(
    Array.isArray(data.investment_cycles)
      ? data.investment_cycles[0]?.opens_at
      : data.investment_cycles?.opens_at,
    data.maturity_date,
  );
  return (
    <>
      <p className="eyebrow">Investment record</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Investment details</h1>
      <p>
        <span className="badge">
          {data.payout_basis === "reported_paid"
            ? "Reported paid"
            : data.status}
        </span>
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
        {data.status === "reserved" && (
          <p className="muted">
            No automatic expiry. This reservation stays pending until an
            administrator activates or expires it, or you cancel it. Transfer
            the exact amount shown. Payments must match the reserved cycle.
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
            <p className="muted">
              Receipt {receipt.receipt_number} is generating…
            </p>
          )
        ) : data.status === "active" ? (
          <p className="muted">Receipt generation pending…</p>
        ) : null}
        {isCancellable && (
          <div style={{ marginTop: "1rem" }}>
            <p className="muted" style={{ marginBottom: "0.5rem" }}>
              Reserved — transfer the exact amount shown or cancel this
              reservation.
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
            This reservation has expired and cannot be activated. Contact our
            team if you already transferred funds; do not pay again.
          </p>
        )}
      </div>
      {isMatured && (
        <div className="card" style={{ marginTop: "1rem" }}>
          <p className="eyebrow">Matured investment choices</p>
          <h2>What should happen to this placement?</h2>
          <p>
            Projected return{" "}
            <strong>{bpsToPercent(data.projected_return_bps ?? 3000)}%</strong>{" "}
            ({ugx(data.projected_return_ugx)}) on {ugx(data.principal_ugx)}{" "}
            principal. Payouts are scheduled for{" "}
            <strong>{date(maturityPayoutDateIso(data.maturity_date))}</strong>.
            The amount actually paid follows the return recorded by the fund,
            which may differ from this projection.
          </p>
          {instructionTerms && <p className="muted">{instructionTerms}</p>}
          {instruction?.status === "requested" && (
            <>
              <div className="success">
                <h3>Your recorded maturity choice</h3>
                <p>
                  <strong>{maturityChoiceLabel(instruction.choice)}</strong>{" "}
                  (projected payout {ugx(instruction.projected_payout_ugx)} ·
                  projected reinvestment{" "}
                  {ugx(instruction.projected_reinvest_ugx)}
                  {recordedCycle
                    ? ` · assigned cycle ${recordedCycle.name} (matures ${date(recordedCycle.maturity_date)})`
                    : ""}
                  ). You can revise it until our team begins processing.
                </p>
              </div>
              {instruction.resolution_notes && (
                <p className="notice">
                  Our team asked for a revision:{" "}
                  <strong>{instruction.resolution_notes}</strong>
                </p>
              )}
            </>
          )}
          {(!instruction || instruction.status === "requested") && (
            <>
              {!assignedCycle && (
                <p className="notice">
                  Reinvestment is currently unavailable; no eligible cycle is
                  open. Full withdrawal remains available.
                </p>
              )}
              <MaturityInstructionForm
                limitUgx={effectiveInvestmentLimit(
                  profile.investment_limit_ugx,
                )}
                investmentId={data.id}
                principalUgx={Number(data.principal_ugx)}
                projectedReturnUgx={Number(data.projected_return_ugx)}
                savedDestinations={(destinations ?? []) as SavedDestination[]}
                assignedCycle={assignedCycle}
                existingChoice={instruction?.choice}
                existingWithdrawalUgx={instruction?.requested_withdrawal_ugx}
                isRevision={!!instruction}
              />
            </>
          )}
          {instruction?.status === "processing" && (
            <>
              <p className="notice">
                Your choice (
                <strong>{maturityChoiceLabel(instruction.choice)}</strong>) is
                being processed by our team and can no longer be revised.
              </p>
              {instruction.proposed_actual_roi_ugx != null &&
                instruction.confirmed_actual_roi_ugx !==
                  instruction.proposed_actual_roi_ugx &&
                (() => {
                  const proposed = safeFulfilledSplits(
                    Number(data.principal_ugx),
                    Number(instruction.proposed_actual_roi_ugx),
                    instruction.choice,
                    instruction.requested_withdrawal_ugx == null
                      ? undefined
                      : {
                          requestedWithdrawalUgx: Number(
                            instruction.requested_withdrawal_ugx,
                          ),
                          projectedPayoutUgx: Number(
                            instruction.projected_payout_ugx,
                          ),
                          projectedReinvestUgx: Number(
                            instruction.projected_reinvest_ugx,
                          ),
                          projectedTotalUgx:
                            Number(instruction.projected_payout_ugx) +
                            Number(instruction.projected_reinvest_ugx),
                        },
                  );
                  if (!proposed)
                    return (
                      <p className="notice">{UNAVAILABLE_MATURITY_AMOUNTS}</p>
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
    </>
  );
}
