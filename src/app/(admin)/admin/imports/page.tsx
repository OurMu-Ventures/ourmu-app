import { ImportAcceptanceForm } from "@/components/forms";
import { requireAdmin } from "@/lib/auth";
import { dateTime, ugx } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function ImportsPage() {
  await requireAdmin();
  const admin = createAdminClient();
  const [{ data: batches }, { data: summaries }] = await Promise.all([
    admin
      .from("import_batches")
      .select("*")
      .order("created_at", { ascending: false }),
    admin
      .from("legacy_monthly_financial_summaries")
      .select("*")
      .order("month_start", { ascending: true }),
  ]);
  return (
    <>
      <p className="eyebrow">Controlled production migration</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Data imports</h1>
      {(batches ?? []).map((batch) => (
        <article
          className="card"
          style={{ marginBottom: "1rem" }}
          key={batch.id}
        >
          <div className="page-head">
            <div>
              <h2>{batch.source_filename}</h2>
              <p className="muted">
                Staged {dateTime(batch.staged_at)} · {batch.investment_count}{" "}
                distinct placements · {batch.partner_count} partners
              </p>
            </div>
            <span className="badge">{batch.status}</span>
          </div>
          <div className="grid">
            <p>
              Principal: <strong>{ugx(batch.principal_total_ugx)}</strong>
            </p>
            <p>
              Return: <strong>{ugx(batch.return_total_ugx)}</strong>
            </p>
            <p>
              Payout: <strong>{ugx(batch.payout_total_ugx)}</strong>
            </p>
          </div>
          {batch.status === "staged" && (
            <ImportAcceptanceForm batchId={batch.id} />
          )}
        </article>
      ))}
      {!batches?.length && (
        <p className="notice">No production import has been staged.</p>
      )}
      {Boolean(summaries?.length) && (
        <section className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>Entries</th>
                <th>Investment</th>
                <th>Partner return</th>
                <th>OURMU receivable</th>
                <th>Profit margin</th>
              </tr>
            </thead>
            <tbody>
              {(summaries ?? []).map((item) => (
                <tr key={item.id}>
                  <td>{item.month_label}</td>
                  <td>{item.entry_count}</td>
                  <td>{ugx(item.total_investment_ugx)}</td>
                  <td>{ugx(item.partner_return_ugx)}</td>
                  <td>{ugx(item.ourmu_receivable_ugx)}</td>
                  <td>{ugx(item.profit_margin_ugx)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
