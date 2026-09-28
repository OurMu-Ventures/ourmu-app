import {
  reconcileJobDelivery,
  retryJob,
} from "@/actions/admin";
import { ResolveMaturityCcReviewForm } from "@/components/ResolveMaturityCcReviewForm";
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
  const { data: flaggedJobsData } = await admin
    .from("jobs")
    .select("*")
    .eq("cc_review_required", true)
    .order("created_at", { ascending: false });
  const flaggedJobs = flaggedJobsData ?? [];
  const visibleJobs = [
    ...flaggedJobs,
    ...(data ?? []).filter(
      (job) => !flaggedJobs.some((flagged) => flagged.id === job.id),
    ),
  ];
  return (
    <>
      <p className="eyebrow">Durable side effects</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Jobs</h1>
      {flaggedJobs.length > 0 && (
        <div className="notice" role="alert">
          {flaggedJobs.length} maturity email team{" "}
          {flaggedJobs.length === 1 ? "copy needs" : "copies need"} review.
          Confirm the partner recipient and contact the team manually before
          marking reviewed.
        </div>
      )}
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
              <th>CC review</th>
              <th>Provider message</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visibleJobs.map((item) => (
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
                  {item.cc_review_required
                    ? "Team copy missed; review recipient"
                    : "—"}
                </td>
                <td>
                  {(item as { provider_message_id?: string | null })
                    .provider_message_id ?? "—"}
                </td>
                <td>
                  {item.cc_review_required && (
                    <ResolveMaturityCcReviewForm jobId={item.id} />
                  )}
                  {item.last_error_code === "NEEDS_RECONCILIATION" ? (
                    <>
                      <form action={reconcileJobDelivery}>
                        <input type="hidden" name="jobId" value={item.id} />
                        <input
                          type="hidden"
                          name="outcome"
                          value="confirmed_delivered"
                        />
                        <SubmitButton pendingLabel="Confirming…">
                          Confirm delivered
                        </SubmitButton>
                      </form>
                      <form action={reconcileJobDelivery}>
                        <input type="hidden" name="jobId" value={item.id} />
                        <input
                          type="hidden"
                          name="outcome"
                          value="authorize_resend"
                        />
                        <SubmitButton pendingLabel="Authorizing…">
                          Authorize resend
                        </SubmitButton>
                      </form>
                    </>
                  ) : (
                    ["failed", "dead"].includes(item.status) && (
                      <form action={retryJob}>
                        <input type="hidden" name="jobId" value={item.id} />
                        <SubmitButton pendingLabel="Retrying…">
                          Retry
                        </SubmitButton>
                      </form>
                    )
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
