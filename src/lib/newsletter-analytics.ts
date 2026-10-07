import "server-only";

import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { listPublishedNewsletters } from "@/lib/newsletters";
import { createAdminClient } from "@/lib/supabase/admin";

const rowSchema = z.object({
  newsletter_slug: z.string(),
  partner_id: z.uuid(),
  legal_name: z.string(),
  opens: z.number().int().nonnegative(),
  first_opened_at: z.string().nullable(),
  last_opened_at: z.string().nullable(),
  reached_end_at: z.string().nullable(),
});
export type NewsletterReader = z.infer<typeof rowSchema>;

export async function getNewsletterReadingAnalytics() {
  await requireAdmin();
  const issues = listPublishedNewsletters();
  const { data, error } = await createAdminClient().rpc("newsletter_reading_report", {
    p_slugs: issues.map((issue) => issue.slug),
  });
  const parsed = z.array(rowSchema).safeParse(data);
  if (error || !parsed.success) return null;
  return issues.map((issue) => {
    const partners = parsed.data.filter((row) => row.newsletter_slug === issue.slug);
    const readers = partners.filter((row) => row.opens > 0).length;
    return {
      slug: issue.slug,
      title: issue.title,
      audience: partners.length,
      readers,
      opens: partners.reduce((sum, row) => sum + row.opens, 0),
      reachedEnd: partners.filter((row) => row.reached_end_at !== null).length,
      partners,
    };
  });
}
