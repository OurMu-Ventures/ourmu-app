"use server";

import { z } from "zod";

import { getCurrentProfile } from "@/lib/auth";
import { getPublishedNewsletter } from "@/lib/newsletters";
import { createAdminClient } from "@/lib/supabase/admin";

const eventSchema = z.object({
  slug: z.string().max(100),
  visitId: z.uuid(),
  event: z.enum(["opened", "reached_end"]),
});

export async function recordNewsletterVisit(input: unknown): Promise<boolean> {
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success || !getPublishedNewsletter(parsed.data.slug)) return false;
  try {
    const profile = await getCurrentProfile();
    if (!profile || profile.access_status !== "active" || profile.role !== "investor" || profile.is_test) {
      return false;
    }
    const { error, data } = await createAdminClient().rpc("record_newsletter_visit", {
      p_partner_id: profile.id,
      p_newsletter_slug: parsed.data.slug,
      p_visit_id: parsed.data.visitId,
      p_event: parsed.data.event,
    });
    if (error) {
      console.warn("Newsletter tracking unavailable");
      return false;
    }
    return data === true;
  } catch {
    console.warn("Newsletter tracking unavailable");
    return false;
  }
}
