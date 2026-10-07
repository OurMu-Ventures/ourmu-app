import Link from "next/link";
import { notFound } from "next/navigation";

import { NewsletterReadTracker } from "@/components/NewsletterReadTracker";
import { LinkStatus } from "@/components/ui/link-status";
import { requireInvestor } from "@/lib/auth";
import { getPublishedNewsletter } from "@/lib/newsletters";

export default async function NewsletterDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const profile = await requireInvestor();
  const { slug } = await params;
  const issue = getPublishedNewsletter(slug);
  if (!issue) notFound();

  const { Content } = issue;

  return (
    <>
      <p style={{ marginBottom: "1.25rem" }}>
        <Link href="/newsletters">
          ← Back to newsletters{" "}
          <LinkStatus label="Back to newsletters" />
        </Link>
      </p>
      {profile.role === "investor" && !profile.is_test ? (
        <NewsletterReadTracker key={slug} slug={slug}><Content /></NewsletterReadTracker>
      ) : <Content />}
    </>
  );
}
