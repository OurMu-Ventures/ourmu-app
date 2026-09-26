import Link from "next/link";

import { PartnerPortalCampaignControls } from "@/components/PartnerPortalCampaignControls";
import { requireAdmin } from "@/lib/auth";
import { getPartnerPortalWelcomeAudience, PARTNER_PORTAL_CAMPAIGN_KEY } from "@/lib/email-campaign";
import { dateTime } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function AnnouncementsPage() {
  await requireAdmin();
  const admin = createAdminClient();
  const [audience, { data: campaign },] = await Promise.all([
    getPartnerPortalWelcomeAudience(),
    admin
      .from("email_campaigns")
      .select("*")
      .eq("campaign_key", PARTNER_PORTAL_CAMPAIGN_KEY)
      .maybeSingle(),
  ]);

  const { data: jobs } = campaign
    ? await admin
        .from("jobs")
        .select("status")
        .eq("entity_type", "email_campaign")
        .eq("entity_id", campaign.id)
        .limit(500)
    : { data: [] };
  const statuses = (jobs ?? []).reduce(
    (counts, job) => {
      counts[job.status] = (counts[job.status] ?? 0) + 1;
      return counts;
    },
    {} as Record<string, number>,
  );
  const complete =
    campaign?.status === "released" &&
    (statuses.succeeded ?? 0) === campaign.recipient_count &&
    (statuses.pending ?? 0) === 0 &&
    (statuses.running ?? 0) === 0 &&
    (statuses.failed ?? 0) === 0 &&
    (statuses.dead ?? 0) === 0;

  return (
    <>
      <p className="eyebrow">Partner communications</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Announcements</h1>
      <h2>Partner Portal welcome email</h2>
      <p>
        One time launch note for active, non-test partner and admin accounts with a
        verified primary email. It includes every eligible account, whether or
        not they have signed in before.
      </p>
      <div className="grid">
        <article className="card">
          <p className="muted">Recipients</p>
          <p className="stat">{audience.total}</p>
        </article>
        <article className="card">
          <p className="muted">Partners</p>
          <p className="stat">{audience.partners}</p>
        </article>
        <article className="card">
          <p className="muted">Admins</p>
          <p className="stat">{audience.admins}</p>
        </article>
      </div>
      <p className="muted">
        One message per verified primary email. Test delivery goes to the signed in
        admin first. Release snapshots the displayed audience and queues individual
        messages; the worker sends 10 at a time.
      </p>
      <section style={{ marginTop: "1rem" }}>
        <h2>Campaign status</h2>
        {!campaign && <p>Test not sent yet.</p>}
        {campaign?.status === "test_sent" && (
          <p>Test sent {dateTime(campaign.test_sent_at!)}. Review it before release.</p>
        )}
        {campaign?.status === "released" && (
          <p>
            Released {dateTime(campaign.released_at!)} · {statuses.succeeded ?? 0} accepted by Resend of{" "}
            {campaign.recipient_count} · {statuses.pending ?? 0} pending ·{" "}
            {(statuses.failed ?? 0) + (statuses.dead ?? 0)} failed
          </p>
        )}
        <PartnerPortalCampaignControls
          status={campaign?.status ?? "draft"}
          expectedCount={audience.total}
          complete={complete}
        />
      </section>
      {(statuses.failed ?? 0) + (statuses.dead ?? 0) > 0 && (
        <p>
          Some deliveries need review in <Link href="/admin/jobs">Jobs</Link>. Once
          retried, use Continue sending queued batches here.
        </p>
      )}
    </>
  );
}
