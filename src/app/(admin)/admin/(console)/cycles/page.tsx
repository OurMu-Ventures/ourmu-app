import { setCycleStatus } from "@/actions/admin";
import {
  AgreementVersionForm,
  CycleEditForm,
  CycleForm,
  Tabs,
} from "@/components/forms";
import { SubmitButton } from "@/components/SubmitButton";
import { requireAdmin } from "@/lib/auth";
import { dateTime, ugx, units } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
export default async function CyclesPage() {
  await requireAdmin();
  const admin = createAdminClient();
  const { data: cycles } = await admin
    .from("investment_cycles")
    .select("*")
    .order("created_at", { ascending: false });
  const nextStatus = {
    draft: ["open", "Open"],
    open: ["closed", "Close"],
    closed: ["matured", "Mature"],
  } as const;
  return (
    <>
      <p className="eyebrow">Terms and capacity</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Investment cycles</h1>
      <Tabs labels={["Create cycle", "Publish agreement"]}>
        <CycleForm />
        <AgreementVersionForm />
      </Tabs>
      {(cycles ?? []).map((item) => {
        const next = nextStatus[item.status as keyof typeof nextStatus];
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
          </article>
        );
      })}
    </>
  );
}
