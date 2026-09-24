import { retryJob } from "@/actions/admin";
import { SubmitButton } from "@/components/SubmitButton";
import { requireAdmin } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
export default async function JobsPage() {
  await requireAdmin();
  const admin = createAdminClient();
  const { data } = await admin
    .from("jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(250);
  return (
    <>
      <p className="eyebrow">Durable side effects</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Jobs</h1>
      <div className="table-wrap">
        <table>
          <thead>
              <tr>
              <th>Created</th>
              <th>Kind</th>
              <th>Entity</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Error code</th>
              <th>Provider message</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((item) => (
              <tr key={item.id}>
                <td>{dateTime(item.created_at)}</td>
                <td>{item.kind}</td>
                <td>
                  {item.entity_type} · {item.entity_id}
                </td>
                <td>{item.status}</td>
                <td>
                  {item.attempts}/{item.max_attempts}
                </td>
                <td>{item.last_error_code ?? "—"}</td>
                <td>
                  {(item as { provider_message_id?: string | null }).provider_message_id ?? "—"}
                </td>
                <td>
                  {["failed", "dead"].includes(item.status) && (
                    <form action={retryJob}>
                      <input type="hidden" name="jobId" value={item.id} />
                      <SubmitButton pendingLabel="Retrying…">Retry</SubmitButton>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
