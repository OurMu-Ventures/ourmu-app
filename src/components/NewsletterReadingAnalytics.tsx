import Link from "next/link";

import { getNewsletterReadingAnalytics } from "@/lib/newsletter-analytics";

function lastOpened(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-UG", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Kampala",
  }).format(new Date(value)) : "—";
}

export async function NewsletterReadingAnalytics() {
  const issues = await getNewsletterReadingAnalytics();
  return (
    <section style={{ marginTop: "2rem" }} aria-labelledby="newsletter-analytics-title">
      <h2 id="newsletter-analytics-title">Newsletter reading</h2>
      <p className="muted">
        Activity recorded since tracking was enabled. Earlier reading is unavailable.
        Figures cover current active partners and exclude admin and test accounts.
        An open is a visible page visit; “Reached the end” means the partner reached the bottom
        after at least 30 seconds with the page visible. It is a reading signal, not proof of reading.
      </p>
      {issues === null ? (
        <p role="status" className="notice">Reading analytics are temporarily unavailable.</p>
      ) : issues.length === 0 ? (
        <p className="muted">No published newsletters yet.</p>
      ) : (
        <div className="newsletter-analytics-list">
          {issues.map((issue) => (
            <article key={issue.slug} className="card">
              <h3><Link href={`/newsletters/${issue.slug}`}>{issue.title}</Link></h3>
              <div className="newsletter-analytics-metrics">
                <div><p className="muted">Unique readers</p><p className="stat">{issue.readers} / {issue.audience}</p></div>
                <div><p className="muted">Partner reach</p><p className="stat">{issue.audience ? `${Math.round(issue.readers / issue.audience * 100)}%` : "—"}</p></div>
                <div><p className="muted">Total opens</p><p className="stat">{issue.opens}</p></div>
                <div><p className="muted">Reached the end</p><p className="stat">{issue.reachedEnd}</p></div>
              </div>
              <details>
                <summary>Partner reading status ({issue.audience})</summary>
                {issue.audience === 0 ? <p>No active partners.</p> : (
                  <div className="newsletter-reader-table" tabIndex={0} role="region" aria-label={`${issue.title} partner reading status`}>
                    <table>
                      <caption className="visually-hidden">Partner reading status for {issue.title}</caption>
                      <thead><tr><th scope="col">Partner</th><th scope="col">Status</th><th scope="col">Opens</th><th scope="col">Last opened (EAT)</th></tr></thead>
                      <tbody>{issue.partners.map((partner) => (
                        <tr key={partner.partner_id}>
                          <th scope="row">{partner.legal_name}</th>
                          <td>{partner.reached_end_at ? "Reached the end" : partner.opens > 0 ? "Opened" : "Not opened"}</td>
                          <td>{partner.opens}</td>
                          <td>{lastOpened(partner.last_opened_at)}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </details>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
