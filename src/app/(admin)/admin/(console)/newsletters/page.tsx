import { NewsletterArchive } from "@/components/newsletter/NewsletterArchive";
import { requireAdmin } from "@/lib/auth";

export default async function NewslettersPage() {
  await requireAdmin();
  return <NewsletterArchive basePath="/admin/newsletters" />;
}
