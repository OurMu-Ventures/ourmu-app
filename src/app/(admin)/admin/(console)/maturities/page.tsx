import { beginMaturityProcessing } from "@/actions/maturity";
import { MaturityFulfillmentForm } from "@/components/maturity-forms";
import { SubmitButton } from "@/components/SubmitButton";
import { requireAdmin } from "@/lib/auth";
import { dateTime, ugx } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function AdminMaturitiesPage() {
  await requireAdmin();
  const admin = createAdminClient();
  const { data } = await admin
    .from("maturity_instructions")
    .select(
      "*,profiles(legal_name,email),investments(principal_ugx,projected_return_ugx,maturity_date),investment_cycles!maturity_instructions_target_cycle_id_fkey(name)",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  return (
    <>
      <p className="eyebrow">Maturity review</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>
        Maturity instructions
      </h1>
      <p className="notice">
        Review each partner choice, record the actual ROI from the fund, verify
        the external payout reference, and approve reinvestments. Instruction
        status (requested, processing, fulfilled) is separate from the
        investment&apos;s matured status. Revisions lock once processing
        begins. Reinvestments are created only here, after capacity, agreement,
        and acceptance checks pass atomically.
      </p>
      {(data ?? []).map((item) => {
        const partner = Array.isArray(item.profiles)
          ? item.profiles[0]
          : item.profiles;
        const source = Array.isArray(item.investments)
          ? item.investments[0]
          : item.investments;
        const target = Array.isArray(item.investment_cycles)
          ? item.investment_cycles[0]
          : item.investment_cycles;
        return (
          <article
            className="card"
            style={{ marginBottom: "1rem" }}
            key={item.id}
          >
            <div className="page-head">
              <div>
                <h2>
                  {partner?.legal_name ?? "Partner"} · {item.choice}
                </h2>
                <p>
                  Principal {ugx(source?.principal_ugx ?? 0)} · projected payout{" "}
                  {ugx(item.projected_payout_ugx)} · projected reinvestment{" "}
                  {ugx(item.projected_reinvest_ugx)} · requested{" "}
                  {dateTime(item.created_at)}
                  {target ? ` · target ${target.name}` : ""}
                  {item.revision_count > 0 &&
                    ` · revised ${item.revision_count}×`}
                </p>
              </div>
              <span className="badge">
                {item.needs_resolution
                  ? "needs resolution"
                  : item.status}
              </span>
            </div>
            {item.status === "requested" && (
              <form action={beginMaturityProcessing}>
                <input type="hidden" name="instructionId" value={item.id} />
                <SubmitButton pendingLabel="Working…">
                  Begin processing (locks revisions)
                </SubmitButton>
              </form>
            )}
            {item.status === "processing" && (
              <MaturityFulfillmentForm
                instructionId={item.id}
                needsPayout={Number(item.projected_payout_ugx) > 0}
              />
            )}
            {item.status === "fulfilled" && (
              <p className="muted">
                Fulfilled {item.fulfilled_at ? dateTime(item.fulfilled_at) : ""}
                : actual ROI {ugx(item.actual_roi_ugx ?? 0)} · payout{" "}
                {ugx(item.actual_payout_ugx ?? 0)}
                {item.payout_reference
                  ? ` (ref ${item.payout_reference})`
                  : ""}{" "}
                · reinvestment {ugx(item.actual_reinvest_ugx ?? 0)}.
              </p>
            )}
          </article>
        );
      })}
      {!data?.length && (
        <article className="card">
          <p className="muted">No maturity instructions yet.</p>
        </article>
      )}
    </>
  );
}
