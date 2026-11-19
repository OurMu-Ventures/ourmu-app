import { NewsletterIssue } from "@/components/newsletter/NewsletterIssue";
import { requireAdmin } from "@/lib/auth";

export default async function NewsletterDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await requireAdmin();
  const { slug } = await params;

  return (
    <NewsletterIssue
      slug={slug}
      basePath="/admin/newsletters"
      trackReading={false}
    />
  );
}
