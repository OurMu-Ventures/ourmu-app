import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { processDueJobs } from "@/lib/jobs";
import { PARTNER_PORTAL_CAMPAIGN_KEY } from "@/lib/email-campaign";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  let sameOrigin = false;
  try {
    sameOrigin = !!origin && new URL(origin).origin === new URL(request.url).origin;
  } catch {
    sameOrigin = false;
  }
  if (!sameOrigin)
    return Response.json({ ok: false, error: "Same-origin request required." }, { status: 403 });

  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin" || profile.access_status !== "active")
    return Response.json({ ok: false, error: "An active admin session is required." }, { status: 401 });

  const supabase = await createClient();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2")
    return Response.json({ ok: false, error: "A current admin MFA session is required." }, { status: 403 });

  const admin = createAdminClient();
  const { data: campaign } = await admin
    .from("email_campaigns")
    .select("id,status")
    .eq("campaign_key", PARTNER_PORTAL_CAMPAIGN_KEY)
    .maybeSingle();
  if (!campaign || campaign.status !== "released")
    return Response.json({ ok: false, error: "The campaign has not been released." }, { status: 409 });

  const batch = await processDueJobs(10, campaign.id);
  const { data: jobs, error } = await admin
    .from("jobs")
    .select("status")
    .eq("entity_type", "email_campaign")
    .eq("entity_id", campaign.id)
    .limit(500);
  if (error) return Response.json({ ok: false, error: "Campaign status could not be read." }, { status: 500 });

  const counts = (jobs ?? []).reduce(
    (result, job) => {
      result[job.status] = (result[job.status] ?? 0) + 1;
      return result;
    },
    {} as Record<string, number>,
  );
  return Response.json({
    ok: true,
    jobs: batch,
    sent: counts.succeeded ?? 0,
    pending: counts.pending ?? 0,
    running: counts.running ?? 0,
    failed: counts.failed ?? 0,
    dead: counts.dead ?? 0,
  }, { headers: { "Cache-Control": "no-store" } });
}
