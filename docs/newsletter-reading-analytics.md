# Newsletter reading analytics

The Admin overview shows per-issue unique readers, total opens, reach among current active partners, and partners who reached the end. Expand an issue to see partner names, reading status, opens and last-opened time in EAT.

An open is recorded after a newsletter detail page mounts in a visible browser tab. Rendering the page on the server, prefetching a link, viewing the list, and admin/test visits do not count. Retries share a visit ID so they do not inflate counts; returning to an issue creates another visit.

“Reached the end” requires the bottom of the newsletter to enter the viewport and at least 30 seconds with the page visible during that visit. Hidden-tab time does not count. This is an engagement signal, not proof that the text was read. JavaScript disabled, network failures, or a blocked tracking request can undercount activity. Tracking failures never prevent reading, and retries are bounded.

Reports use current active, non-test investor profiles as their audience, including partners without recorded opens. A partner who becomes disabled or closes their account is excluded from current reports. No historical activity is backfilled: tracking begins when the migration and application are deployed. Refresh Admin overview for updated figures.

## Deployment

Apply `supabase/migrations/20261007130000_newsletter_reading_analytics.sql` before deploying this application change. No production database changes are made by the PR itself. If the migration has not been applied, newsletters remain readable and the admin panel shows analytics unavailable instead of misleading zero counts.

The migration adds the RLS-enabled `newsletter_visits` table and two security-invoker RPCs. Table access and RPC execution are restricted to `service_role`; authenticated partners cannot read other partners' activity or call them directly. The recording Server Action reloads the caller's profile, validates eligibility and the published issue, and supplies the authenticated partner ID. The report helper requires active AAL2 administrator access before fetching names.

For rollback, roll back the application first. Keeping the unused visits table preserves collected activity. Do not drop it unless its data is no longer needed.
