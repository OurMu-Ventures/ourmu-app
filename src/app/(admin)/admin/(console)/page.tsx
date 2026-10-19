import Link from "next/link";
import { resolveClosure } from "@/actions/admin";
import { NewsletterReadingAnalytics } from "@/components/NewsletterReadingAnalytics";
import { SubmitButton } from "@/components/SubmitButton";
import { kampalaDate } from "@/lib/actual-returns";
import { requireAdmin } from "@/lib/auth";
import { ugx, units } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function AdminPage() {
  const profile = await requireAdmin();
  const admin = createAdminClient();
  // Cycles at or within a day of maturity without a recorded actual return.
  const [year, month, day] = kampalaDate().split("-").map(Number);
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
  const { data: returnCandidates } = await admin
    .from("investment_cycles")
    .select("id,name")
    .is("actual_return_bps", null)
    .eq("legacy_settlement", false)
    .neq("status", "draft")
    .lte("maturity_date", tomorrow);
  const returnsRequired = (
    await Promise.all(
      (returnCandidates ?? []).map(async (item) => {
        const { data } = await admin.rpc("preview_cycle_actual_return", {
          p_admin_id: profile.id,
          p_admin_aal2: true,
          p_cycle_id: item.id,
        });
        return (data as { required?: boolean } | null)?.required ? item : null;
      }),
    )
  ).filter((item) => item !== null);
  const [
    { count: pending },
    { count: awaitingActivation },
    { count: active },
    { count: failed },
    { data: closures, error: closuresError },
    { data: cycle },
    { data: reserved },
    { data: oldestPending, error: oldestPendingError },
  ] = await Promise.all([
    admin
      .from("investor_applications")
      .select("id", { count: "exact", head: true })
      .eq("status", "submitted"),
    admin
      .from("investments")
      .select("id", { count: "exact", head: true })
      .eq("status", "reserved")
      .eq("is_test", false),
    admin
      .from("investments")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .eq("is_test", false),
    admin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .in("status", ["failed", "dead"]),
    admin
      .from("account_closure_requests")
      .select(
        "id,user_id,reason,requested_at,profiles!account_closure_requests_user_id_fkey(legal_name,email)",
      )
      .eq("status", "requested"),
    admin
      .from("investment_cycles")
      .select("id,name,capacity_units,capacity_ugx")
      .eq("status", "open")
      .maybeSingle(),
    admin
      .from("investments")
      .select("cycle_id,units,principal_ugx")
      .eq("is_test", false)
      .in("status", ["reserved", "active"]),
    admin
      .from("investments")
      .select("requested_at")
      .eq("status", "reserved")
      .eq("is_test", false)
      .order("requested_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  if (oldestPendingError)
    throw new Error("Unable to load the oldest pending reservation");
  // eslint-disable-next-line react-hooks/purity -- server-rendered queue age at request time
  const now = Date.now();
  const oldestPendingHours = oldestPending
    ? Math.max(
        0,
        Math.floor(
          (now - new Date(oldestPending.requested_at).getTime()) /
            3_600_000,
        ),
      )
    : null;
  const oldestPendingAge =
    oldestPendingHours === null
      ? "None"
      : oldestPendingHours >= 24
        ? `${Math.floor(oldestPendingHours / 24)} days`
        : `${oldestPendingHours} hours`;
  const openCycleInvestments = cycle
    ? (reserved ?? []).filter((item) => item.cycle_id === cycle.id)
    : [];
  const used = openCycleInvestments.reduce(
    (sum, item) => sum + Number(item.units),
    0,
  );
  return (
    <>
      <p className="eyebrow">Operations</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Admin overview</h1>
      {returnsRequired.length > 0 && (
        <div className="notice actual-return-required" role="alert">
          <strong>Actual return required</strong> for{" "}
          {returnsRequired.map((item) => item.name).join(", ")}. Settlement is
          blocked until it is recorded.{" "}
          <Link href="/admin/cycles">Record it on the Cycles page</Link>.
        </div>
      )}
      <div className="grid">
        <article className="card">
          <p className="muted">Pending applications</p>
          <p className="stat">{pending ?? 0}</p>
          <Link href="/admin/applications?tab=review">Review applications</Link>
        </article>
        <article className="card">
          <p className="muted">Awaiting activation</p>
          <p className="stat">{awaitingActivation ?? 0}</p>
          <p>
            Oldest pending: <strong>{oldestPendingAge}</strong>
          </p>
          <p
            className={
              oldestPendingHours !== null && oldestPendingHours >= 72
                ? "notice"
                : "muted"
            }
          >
            Review pending reservations daily; follow up after 3 days. Verify
            bank receipts before expiring.
          </p>
        </article>
        <article className="card">
          <p className="muted">Active investments</p>
          <p className="stat">{active ?? 0}</p>
        </article>
        <article className="card">
          <p className="muted">Failed jobs</p>
          <p className="stat">{failed ?? 0}</p>
        </article>
        <article className="card">
          <p className="muted">Open-cycle capacity</p>
          <p className="stat">
            {cycle
              ? `${units(used)} / ${units(cycle.capacity_units ?? 0)} units`
              : "—"}
          </p>
        </article>
        <article className="card">
          <p className="muted">Reserved + active principal</p>
          <p className="stat">
            {ugx(
              (reserved ?? []).reduce(
                (sum, item) => sum + Number(item.principal_ugx),
                0,
              ),
            )}
          </p>
        </article>
      </div>
      <NewsletterReadingAnalytics />
      <section style={{ marginTop: "2rem" }}>
        <h2>Closure requests</h2>
        {closuresError ? (
          <p role="alert" className="notice">
            Closure requests could not be loaded. Refresh the page to try again.
          </p>
        ) : closures?.length === 0 ? (
          <p className="muted">No pending closure requests.</p>
        ) : null}
        {(!closuresError ? (closures ?? []) : []).map((item) => {
          const owner = item.profiles as unknown as
            { legal_name: string } | { legal_name: string }[] | null;
          return (
            <div className="card" key={item.id}>
              <p>
                <strong>
                  {Array.isArray(owner)
                    ? owner[0]?.legal_name
                    : owner?.legal_name}
                </strong>{" "}
                · {item.reason || "No reason provided"}
              </p>
              <form action={resolveClosure} className="form-grid">
                <input type="hidden" name="closureId" value={item.id} />
                <label>
                  Resolution notes
                  <input name="notes" />
                </label>
                <label>
                  Outcome
                  <select name="outcome">
                    <option value="resolved">Resolve and close</option>
                    <option value="declined">Decline and restore access</option>
                  </select>
                </label>
                <SubmitButton className="button" pendingLabel="Recording…">
                  Record outcome
                </SubmitButton>
              </form>
            </div>
          );
        })}
      </section>
    </>
  );
}
