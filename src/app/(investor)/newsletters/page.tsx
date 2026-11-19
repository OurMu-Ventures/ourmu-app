import { NewsletterArchive } from "@/components/newsletter/NewsletterArchive";
import { requireInvestor } from "@/lib/auth";

export default async function NewslettersPage() {
  await requireInvestor();
  return (
    <NewsletterArchive
      basePath="/newsletters"
      eyebrow="Partner updates"
      lead="Monthly partner updates, newest first. Shared outside the portal through WhatsApp."
    />
  );
}
