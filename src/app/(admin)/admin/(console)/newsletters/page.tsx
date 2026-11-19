import { NewsletterArchive } from "@/components/newsletter/NewsletterArchive";
import { requireAdmin } from "@/lib/auth";

export default async function NewslettersPage() {
  await requireAdmin();
  return (
    <NewsletterArchive
      basePath="/admin/newsletters"
      eyebrow="Partner communications"
      lead="The published issues partners see, newest first. Your reads here are not counted in partner reading analytics."
    />
  );
}
