import Link from "next/link";

import { LinkStatus } from "@/components/ui/link-status";
import { requireInvestor } from "@/lib/auth";
import { listPublishedNewsletters } from "@/lib/newsletters";

export default async function NewslettersPage() {
  await requireInvestor();
  const issues = listPublishedNewsletters();

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Partner updates</p>
          <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Newsletters</h1>
          <p className="lead">
            Monthly partner updates, newest first. Shared outside the portal
            through WhatsApp.
          </p>
        </div>
      </div>

      {issues.length === 0 ? (
        <p className="muted">
          No newsletters have been published yet. Check back soon.
        </p>
      ) : (
        <div className="nl-list">
          {issues.map((issue) => (
            <article key={issue.slug} className="nl-card">
              <p className="nl-card-meta">{issue.issueMonth}</p>
              <h2>{issue.title}</h2>
              <p className="muted">{issue.summary}</p>
              <p style={{ marginTop: "0.9rem" }}>
                <Link href={`/newsletters/${issue.slug}`}>
                  Read newsletter{" "}
                  <LinkStatus label={`Opening ${issue.title}`} />
                </Link>
              </p>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
