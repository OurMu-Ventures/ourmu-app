import Link from "next/link";
import { AdminPayoutDestinationForm } from "@/components/admin-payout-destination-form";
import { beginMaturityProcessing } from "@/actions/maturity";
import {
  MaturityFulfillmentForm,
  MaturityReopenForm,
} from "@/components/maturity-forms";
import { SubmitButton } from "@/components/SubmitButton";
import { requireAdmin } from "@/lib/auth";
import { dateTime, ugx } from "@/lib/format";
import {
  safeFulfilledSplits,
  UNAVAILABLE_MATURITY_AMOUNTS,
  maturityChoiceLabel,
  maturityInstructionTerms,
} from "@/lib/maturity";
import { decryptPayoutReference } from "@/lib/security/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

type DestinationReveal = {
  channel: string;
  provider_label: string;
  account_name: string;
  account_last_four: string | null;
  reference: string | null;
};

function toBuffer(value: string | null): Buffer | null {
  if (!value) return null;
  const hex = value.startsWith("\\x") ? value.slice(2) : value;
  return Buffer.from(hex, "hex");
}

// Authorized reveal: this AAL2-gated console decrypts the partner's saved
// payout destination so the admin can see where to send the money and
// verify it before marking a payout fulfilled.
async function revealDestination(
  destination: {
    channel: string;
    provider_label: string;
    account_name: string;
    account_last_four: string | null;
    account_ref_ciphertext: string | null;
    account_ref_iv: string | null;
    account_ref_auth_tag: string | null;
    key_version: number | null;
  } | null,
): Promise<DestinationReveal | null> {
  if (!destination) return null;
  const ciphertext = toBuffer(destination.account_ref_ciphertext);
  const iv = toBuffer(destination.account_ref_iv);
  const authTag = toBuffer(destination.account_ref_auth_tag);
  let reference: string | null = null;
  if (ciphertext && iv && authTag && destination.key_version != null) {
    try {
      reference = decryptPayoutReference({
        ciphertext,
        iv,
        authTag,
        keyVersion: destination.key_version,
      });
    } catch {
      reference = null;
    }
  }
  return {
    channel: destination.channel,
    provider_label: destination.provider_label,
    account_name: destination.account_name,
    account_last_four: destination.account_last_four,
    reference,
  };
}

export default async function AdminMaturitiesPage({
  searchParams,
}: { searchParams?: Promise<{ tab?: string; page?: string }> }) {
  await requireAdmin();
  const admin = createAdminClient();
  const params = await searchParams;
  const tab = params?.tab === "history" || params?.tab === "reinvestments"
    ? params.tab : "withdrawals";
  const parsedPage = Number(params?.page ?? 1);
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const pageSize = 25;
  // The investment FK prevents orphans; !inner applies pending source filters.
  // The filtered empty embed lets History include legacy reported-paid
  // instructions even when their instruction status was never fulfilled.
  let query = admin.from("maturity_instructions").select(
    "*,profiles!maturity_instructions_investor_id_fkey(legal_name,email),investments!maturity_instructions_investment_id_fkey!inner(principal_ugx,projected_return_ugx,maturity_date,payout_basis),paid_investment:investments!maturity_instructions_investment_id_fkey(),investment_cycles!maturity_instructions_target_cycle_id_fkey(name),payout_destinations!maturity_instructions_payout_destination_id_fkey(channel,provider_label,account_name,account_last_four,account_ref_ciphertext,account_ref_iv,account_ref_auth_tag,key_version)",
    { count: "exact" },
  );
  if (tab === "history") {
    query = query.eq("paid_investment.payout_basis", "reported_paid")
      .or("status.eq.fulfilled,paid_investment.not.is.null");
  } else {
    query = query.in("status", ["requested", "processing"])
      .neq("investments.payout_basis", "reported_paid")
      .gt(tab === "withdrawals" ? "projected_payout_ugx" : "projected_reinvest_ugx", 0);
  }
  const { data, count, error } = await query
    .order("created_at", { ascending: tab !== "history" })
    .order("id", { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new Error("Unable to load maturity instructions.");
  const items = data ?? [];
  const heldAudits = items.some((item) => item.needs_resolution)
    ? ((
        await admin
          .from("audit_events")
          .select("entity_id,metadata,created_at")
          .eq("action", "maturity_instruction.held")
          .in(
            "entity_id",
            items
              .filter((item) => item.needs_resolution)
              .map((item) => item.id),
          )
          .order("created_at", { ascending: false })
      ).data ?? [])
    : [];
  const heldReason = (instructionId: string) => {
    const entry = heldAudits.find((audit) => audit.entity_id === instructionId);
    const metadata = entry?.metadata as { reason?: string } | null;
    return metadata?.reason ?? null;
  };
  return (
    <>
      <p className="eyebrow">Maturity review</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>
        Maturity instructions
      </h1>
      <p className="notice">
        Review each partner choice, record the actual ROI from the fund, verify
        the revealed payout destination against the external transfer, and
        approve reinvestments. Instruction status (requested, processing,
        fulfilled) is separate from the investment&apos;s matured status.
        Revisions lock once processing begins. A changed actual ROI needs
        partner confirmation before anything moves, and held instructions are
        resolved by reopening them for partner revision — never silently.
      </p>
      <nav aria-label="Maturity views" className="admin-investment-pagination">
        {(["withdrawals", "reinvestments", "history"] as const).map((view) => (
          <Link key={view} href={`/admin/maturities?tab=${view}`}
            className={tab === view ? "button" : "button-secondary"}
            aria-current={tab === view ? "page" : undefined}>
            {view === "withdrawals" ? "Withdrawals" : view === "reinvestments" ? "Reinvestments" : "History"}
          </Link>
        ))}
      </nav>
      <p className="muted">
        {tab === "history" ? "Completed and reported-paid instructions." :
          tab === "withdrawals" ? "Pending requests with a payout. Mixed withdrawal and reinvestment requests also appear under Reinvestments." :
          "Pending requests with a reinvestment. Mixed requests share the same instruction and processing status with Withdrawals."}
      </p>
      {await Promise.all(
        items.map(async (item) => {
          const partner = Array.isArray(item.profiles)
            ? item.profiles[0]
            : item.profiles;
          const source = Array.isArray(item.investments)
            ? item.investments[0]
            : item.investments;
          const alreadyPaid = source?.payout_basis === "reported_paid";
          const target = Array.isArray(item.investment_cycles)
            ? item.investment_cycles[0]
            : item.investment_cycles;
          const destinationRow = Array.isArray(item.payout_destinations)
            ? item.payout_destinations[0]
            : item.payout_destinations;
          const destination = alreadyPaid
            ? null
            : await revealDestination(destinationRow ?? null);
          const instructionTerms = maturityInstructionTerms(
            item.choice,
            item.requested_withdrawal_ugx,
          );
          const awaitingConfirmation =
            item.proposed_actual_roi_ugx != null &&
            item.confirmed_actual_roi_ugx !== item.proposed_actual_roi_ugx;
          return (
            <article
              className="card"
              style={{ marginBottom: "1rem" }}
              key={item.id}
            >
              <div className="page-head">
                <div>
                  <h2>
                    {partner?.legal_name ?? "Partner"} ·{" "}
                    {maturityChoiceLabel(item.choice)}
                  </h2>
                  <p>
                    Principal {ugx(source?.principal_ugx ?? 0)} · projected
                    payout {ugx(item.projected_payout_ugx)} · projected
                    reinvestment {ugx(item.projected_reinvest_ugx)} · requested{" "}
                    {dateTime(item.created_at)}
                    {target ? ` · target ${target.name}` : ""}
                    {item.revision_count > 0 &&
                      ` · revised ${item.revision_count}×`}
                  </p>
                </div>
                <span className="badge">
                  {alreadyPaid
                    ? "Reported paid"
                    : item.needs_resolution
                      ? "needs resolution"
                      : awaitingConfirmation
                        ? "awaiting partner"
                        : item.status}
                </span>
              </div>
              {instructionTerms && <p className="muted">{instructionTerms}</p>}
              {!alreadyPaid &&
                item.proposed_actual_roi_ugx != null &&
                source &&
                (() => {
                  const split = safeFulfilledSplits(
                    Number(source.principal_ugx),
                    Number(item.proposed_actual_roi_ugx),
                    item.choice,
                    item.requested_withdrawal_ugx == null
                      ? undefined
                      : {
                          requestedWithdrawalUgx: Number(
                            item.requested_withdrawal_ugx,
                          ),
                          projectedPayoutUgx: Number(item.projected_payout_ugx),
                          projectedReinvestUgx: Number(
                            item.projected_reinvest_ugx,
                          ),
                          projectedTotalUgx:
                            Number(item.projected_payout_ugx) +
                            Number(item.projected_reinvest_ugx),
                        },
                  );
                  if (!split)
                    return (
                      <p className="notice">{UNAVAILABLE_MATURITY_AMOUNTS}</p>
                    );
                  return (
                    <p>
                      Proposed payout {ugx(split.payoutUgx)} · proposed
                      reinvestment {ugx(split.reinvestUgx)}
                    </p>
                  );
                })()}
              {alreadyPaid && (
                <p className="notice">
                  This investment was reported paid. Withdrawal and reinvestment
                  processing are unavailable.
                </p>
              )}
              {!alreadyPaid && item.status === "requested" && !item.payout_destination_id && Number(item.projected_payout_ugx) > 0 && (
                <AdminPayoutDestinationForm instructionId={item.id} />
              )}
              {destination && (
                <div className="notice">
                  <strong>Payout destination (revealed for transfer).</strong>{" "}
                  {destination.channel === "bank" ? "Bank" : "Mobile money"} ·{" "}
                  {destination.provider_label} · {destination.account_name} ·{" "}
                  {destination.reference ??
                    `•••• ${destination.account_last_four ?? "****"}`}
                  {item.destination_verified_at
                    ? ` · verified ${dateTime(item.destination_verified_at)}`
                    : " · not yet verified"}
                </div>
              )}
              {item.target_cycle_id && (
                <p className="muted">
                  Agreement acceptance:{" "}
                  {item.agreement_accepted ? "accepted" : "not accepted"}
                  {item.acceptance_captured_at
                    ? ` by the partner at ${dateTime(item.acceptance_captured_at)}`
                    : item.standing_authorization_id
                      ? " via the partner's standing reinvest authorization (terms re-verified at fulfillment)"
                      : " (no partner acceptance captured)"}
                  {item.acceptance_user_agent
                    ? ` · ${item.acceptance_user_agent}`
                    : ""}
                </p>
              )}
              {!alreadyPaid && awaitingConfirmation && (
                <p className="notice">
                  Awaiting partner confirmation of the actual return{" "}
                  {ugx(item.proposed_actual_roi_ugx ?? 0)}. Nothing has been
                  paid or reinvested.
                </p>
              )}
              {!alreadyPaid &&
                item.status === "requested" &&
                !item.needs_resolution && (
                  <form action={beginMaturityProcessing}>
                    <input type="hidden" name="instructionId" value={item.id} />
                    <SubmitButton pendingLabel="Working…">
                      Begin processing (locks revisions)
                    </SubmitButton>
                  </form>
                )}
              {!alreadyPaid &&
                item.status === "processing" &&
                !item.needs_resolution && (
                  <MaturityFulfillmentForm
                    instructionId={item.id}
                    needsPayout={Number(item.projected_payout_ugx) > 0}
                  />
                )}
              {!alreadyPaid &&
                item.status === "processing" &&
                item.needs_resolution && (
                  <>
                    {heldReason(item.id) && (
                      <p className="notice">
                        Held: <strong>{heldReason(item.id)}</strong>. Reopen
                        with notes so the partner can revise and re-confirm.
                      </p>
                    )}
                    <MaturityReopenForm instructionId={item.id} />
                  </>
                )}
              {item.resolution_notes && (
                <p className="muted">
                  Resolution notes: {item.resolution_notes}
                </p>
              )}
              {item.status === "fulfilled" && (
                <p className="muted">
                  Fulfilled{" "}
                  {item.fulfilled_at ? dateTime(item.fulfilled_at) : ""}: actual
                  ROI {ugx(item.actual_roi_ugx ?? 0)} · payout{" "}
                  {ugx(item.actual_payout_ugx ?? 0)}
                  {item.payout_reference
                    ? ` (ref ${item.payout_reference})`
                    : ""}{" "}
                  · reinvestment {ugx(item.actual_reinvest_ugx ?? 0)}.
                </p>
              )}
            </article>
          );
        }),
      )}
      {!items.length && (
        <article className="card">
          <p className="muted">No instructions in this view.</p>
        </article>
      )}
      <nav aria-label="Maturity pagination" className="admin-investment-pagination">
        {page > 1 && <Link className="button-secondary" href={`/admin/maturities?tab=${tab}&page=${page - 1}`}>Previous</Link>}
        <span>Page {page} · {count ?? 0} instructions</span>
        {page * pageSize < (count ?? 0) && <Link className="button-secondary" href={`/admin/maturities?tab=${tab}&page=${page + 1}`}>Next</Link>}
      </nav>
    </>
  );
}
