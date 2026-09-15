/* eslint-disable react-hooks/purity -- server page computes a request-time 24-hour cutoff */
import { resolveClosure } from "@/actions/admin";
import { SubmitButton } from "@/components/SubmitButton";
import { requireAdmin } from "@/lib/auth";
import { ugx, units } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function AdminPage() {
  await requireAdmin();
  const admin = createAdminClient();
  const expiryCutoff = new Date(Date.now() + 24 * 3_600_000).toISOString();
  const [
    { count: pending },
    { count: expiring },
    { count: active },
    { count: failed },
    { data: closures },
    { data: cycle },
    { data: reserved },
  ] = await Promise.all([
    admin
      .from("investor_applications")
      .select("id", { count: "exact", head: true })
      .eq("status", "submitted"),
    admin
      .from("investments")
      .select("id", { count: "exact", head: true })
      .eq("status", "reserved")
      .eq("is_test", false)
      .lte("reservation_expires_at", expiryCutoff),
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
      .select("id,user_id,reason,requested_at,profiles(legal_name,email)")
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
  ]);
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
      <div className="grid">
        <article className="card">
          <p className="muted">Pending applications</p>
          <p className="stat">{pending ?? 0}</p>
        </article>
        <article className="card">
          <p className="muted">Expiring in 24h</p>
          <p className="stat">{expiring ?? 0}</p>
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
      <section style={{ marginTop: "2rem" }}>
        <h2>Closure requests</h2>
        {(closures ?? []).map((item) => {
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
