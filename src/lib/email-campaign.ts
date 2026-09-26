import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export const PARTNER_PORTAL_CAMPAIGN_KEY = "partner_portal_welcome_2026";

export async function getPartnerPortalWelcomeAudience() {
  const admin = createAdminClient();
  const { data: emails, error: emailError } = await admin
    .from("account_emails")
    .select("user_id,email")
    .eq("is_primary", true)
    .not("verified_at", "is", null);
  if (emailError) throw new Error("CAMPAIGN_AUDIENCE_LOOKUP_FAILED");
  const userIds = [...new Set((emails ?? []).map((item) => item.user_id))];
  if (!userIds.length) return { total: 0, partners: 0, admins: 0 };

  const { data: profiles, error: profileError } = await admin
    .from("profiles")
    .select("id,role")
    .in("id", userIds)
    .eq("access_status", "active")
    .eq("is_test", false)
    .in("role", ["investor", "admin"]);
  if (profileError) throw new Error("CAMPAIGN_AUDIENCE_LOOKUP_FAILED");
  const partners = (profiles ?? []).filter((item) => item.role === "investor").length;
  const admins = (profiles ?? []).filter((item) => item.role === "admin").length;
  return { total: partners + admins, partners, admins };
}
