import { DecisionForm, Tabs } from "@/components/forms";
import { requireAdmin } from "@/lib/auth";
import { date, dateTime } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
export default async function ApplicationsPage() {
  await requireAdmin();
  const admin = createAdminClient();
  const { data } = await admin
    .from("investor_applications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  return (
    <>
      <p className="eyebrow">Offline KYC decisions</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Applications</h1>
      {(data ?? []).map((item) => (
        <article
          className="card"
          style={{ marginBottom: "1rem" }}
          key={item.id}
        >
          <div className="page-head">
            <div>
              <h2>{item.legal_name}</h2>
              <p>
                {item.email} · {item.phone}
                <br />
                {item.address}, {item.district}, {item.country}
                <br />
                Born {date(item.date_of_birth)} · submitted{" "}
                {dateTime(item.created_at)}
              </p>
            </div>
            <span className="badge">{item.status}</span>
          </div>
          {item.status === "submitted" && (
            <Tabs labels={["Approve", "Reject"]}>
              <DecisionForm applicationId={item.id} decision="approve" />
              <DecisionForm applicationId={item.id} decision="reject" />
            </Tabs>
          )}
        </article>
      ))}
    </>
  );
}
