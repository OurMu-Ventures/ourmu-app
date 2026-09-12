import { requireAdmin } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
export default async function AuditPage() {
  await requireAdmin();
  const admin = createAdminClient();
  const { data } = await admin
    .from("audit_events")
    .select("id,actor_id,action,entity_type,entity_id,request_id,created_at")
    .order("created_at", { ascending: false })
    .limit(250);
  return (
    <>
      <p className="eyebrow">Append-only history</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Audit events</h1>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Actor</th>
              <th>Request</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((item) => (
              <tr key={item.id}>
                <td>{dateTime(item.created_at)}</td>
                <td>{item.action}</td>
                <td>
                  {item.entity_type} · {item.entity_id ?? "—"}
                </td>
                <td>{item.actor_id ?? "system"}</td>
                <td>{item.request_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
