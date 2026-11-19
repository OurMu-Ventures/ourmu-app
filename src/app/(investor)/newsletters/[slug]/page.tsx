import { NewsletterIssue } from "@/components/newsletter/NewsletterIssue";
import { requireInvestor } from "@/lib/auth";

export default async function NewsletterDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const profile = await requireInvestor();
  const { slug } = await params;

  return (
    <NewsletterIssue
      slug={slug}
      basePath="/newsletters"
      trackReading={profile.role === "investor" && !profile.is_test}
    />
  );
}
