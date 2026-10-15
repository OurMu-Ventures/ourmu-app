import { setCycleStatus } from "@/actions/admin";
import { CycleActualReturnForm } from "@/components/cycle-actual-return-form";
import {
  AgreementVersionForm,
  CycleEditForm,
  CycleForm,
  Tabs,
} from "@/components/forms";
import { SubmitButton } from "@/components/SubmitButton";
import { formatBpsPercent } from "@/lib/actual-returns";
import { requireAdmin } from "@/lib/auth";
import { date, dateTime, ugx, units } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

type ActualReturnState = {
  actual_return_bps: number | null;
  late_entry: boolean;
  locked: boolean;
  can_record: boolean;
  blocked_reason: string | null;
  required: boolean;
  investment_count: number;
  principal_ugx: number;
  projected_profit_ugx: number;
  actual_profit_ugx: number | null;
  total_value_ugx: number | null;
  difference_from_projection_ugx: number | null;
};

function recordingStatus(
  state: ActualReturnState,
  lateEntry: boolean,
): string {
  if (state.blocked_reason === "legacy_settlement")
    return "Legacy per-investment settlement — this cycle cannot adopt a cycle-wide rate";
  if (state.blocked_reason === "settled")
    return state.actual_return_bps == null
      ? "Settlement started without a cycle rate"
      : "Locked — settlement has started";
  if (state.actual_return_bps == null)
    return state.locked
      ? "Missing after maturity — one late entry allowed; settlement is blocked"
      : "Not recorded";
  if (state.locked)
    return lateEntry ? "Locked — entered after maturity" : "Locked at maturity";
  return "Published — revisable until maturity";
}

export default async function CyclesPage() {
  const profile = await requireAdmin();
  const admin = createAdminClient();
  const { data: cycles } = await admin
    .from("investment_cycles")
    .select("*")
    .order("opens_at", { ascending: false })
    .order("id", { ascending: true });
  const nextStatus = {
    draft: ["open", "Open"],
    open: ["closed", "Close"],
    closed: ["matured", "Mature"],
  } as const;
  const funded = (cycles ?? []).filter((item) => item.status !== "draft");
  const states = new Map<string, ActualReturnState>(
    await Promise.all(
      funded.map(async (item) => {
        const { data } = await admin.rpc("preview_cycle_actual_return", {
          p_admin_id: profile.id,
          p_admin_aal2: true,
          p_cycle_id: item.id,
        });
        return [item.id, data as unknown as ActualReturnState] as const;
      }),
    ),
  );
  const recorderIds = [
    ...new Set(
      funded
        .map((item) => item.actual_return_recorded_by)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const { data: recorders } = recorderIds.length
    ? await admin.from("profiles").select("id,legal_name").in("id", recorderIds)
    : { data: [] };
  const recorderName = (id: string | null) =>
    recorders?.find((row) => row.id === id)?.legal_name ?? "an administrator";
  const required = funded.filter((item) => states.get(item.id)?.required);
  return (
    <>
      <p className="eyebrow">Terms and capacity</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Investment cycles</h1>
      {required.length > 0 && (
        <div className="notice actual-return-required" role="alert">
          <strong>Actual return required</strong> for{" "}
          {required.map((item) => item.name).join(", ")}. Settlement and
          automatic reinvestment stay blocked until it is recorded.
        </div>
      )}
      <Tabs labels={["Create cycle", "Publish agreement"]}>
        <CycleForm />
        <AgreementVersionForm />
      </Tabs>
      {(cycles ?? []).map((item) => {
        const next = nextStatus[item.status as keyof typeof nextStatus];
        const state = states.get(item.id);
        return (
          <article className="card" style={{ marginTop: "1rem" }} key={item.id}>
            <div className="page-head">
              <div>
                <h2>{item.name}</h2>
                <p className="muted">
                  {dateTime(item.opens_at)} – {dateTime(item.closes_at)} ·{" "}
                  {item.capacity_ugx === null
                    ? "Historical capacity not recorded"
                    : `${ugx(item.capacity_ugx)} · ${units(item.capacity_units ?? 0)} units`}{" "}
                  · {item.status}
                </p>
              </div>
              {next && (
                <form action={setCycleStatus}>
                  <input type="hidden" name="cycleId" value={item.id} />
                  <input type="hidden" name="status" value={next[0]} />
                  <SubmitButton pendingLabel="Working…">{next[1]}</SubmitButton>
                </form>
              )}
            </div>
            {item.status === "draft" && item.record_origin === "portal" && (
              <details>
                <summary>Edit draft</summary>
                <CycleEditForm cycle={item} />
              </details>
            )}
            {state && (
              <section
                aria-labelledby={`actual-return-${item.id}`}
                style={{ marginTop: "1rem" }}
              >
                <h3 id={`actual-return-${item.id}`}>Actual return</h3>
                {state.required && (
                  <p className="notice actual-return-required">
                    <strong>Actual return required.</strong> Maturity is{" "}
                    {date(item.maturity_date)}.
                  </p>
                )}
                <p>
                  Maturity <strong>{date(item.maturity_date)}</strong> ·
                  projected{" "}
                  <strong>{formatBpsPercent(item.projected_return_bps)}</strong>{" "}
                  · actual{" "}
                  <strong>
                    {item.actual_return_bps == null
                      ? "not recorded"
                      : formatBpsPercent(item.actual_return_bps)}
                  </strong>
                </p>
                <p className="muted">
                  Status:{" "}
                  <span className="badge">
                    {recordingStatus(state, item.actual_return_late_entry)}
                  </span>
                  {item.actual_return_recorded_at &&
                    ` · recorded ${dateTime(item.actual_return_recorded_at)} by ${recorderName(item.actual_return_recorded_by)}`}
                </p>
                <p className="muted">
                  {state.investment_count} funded investment
                  {state.investment_count === 1 ? "" : "s"} ·{" "}
                  {ugx(state.principal_ugx)} principal · projected profit{" "}
                  {ugx(state.projected_profit_ugx)}
                  {state.actual_profit_ugx != null &&
                    ` · actual profit ${ugx(state.actual_profit_ugx)} · total value ${ugx(state.total_value_ugx ?? 0)}`}
                </p>
                {state.can_record && (
                  <CycleActualReturnForm
                    cycleId={item.id}
                    currentBps={item.actual_return_bps}
                  />
                )}
              </section>
            )}
          </article>
        );
      })}
    </>
  );
}
