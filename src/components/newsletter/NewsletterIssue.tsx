import Link from "next/link";
import { notFound } from "next/navigation";

import { NewsletterReadTracker } from "@/components/NewsletterReadTracker";
import { LinkStatus } from "@/components/ui/link-status";
import { getPublishedNewsletter } from "@/lib/newsletters";

export function NewsletterIssue({ slug, basePath, trackReading }: {
  slug: string;
  basePath: string;
  trackReading: boolean;
}) {
  const issue = getPublishedNewsletter(slug);
  if (!issue) notFound();

  const { Content } = issue;

  return (
    <>
      <p style={{ marginBottom: "1.25rem" }}>
        <Link href={basePath}>
          ← Back to newsletters{" "}
          <LinkStatus label="Back to newsletters" />
        </Link>
      </p>
      {trackReading ? (
        <NewsletterReadTracker key={slug} slug={slug}><Content /></NewsletterReadTracker>
      ) : <Content />}
    </>
  );
}
