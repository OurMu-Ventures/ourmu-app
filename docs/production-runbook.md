# Production runbook

1. Create a fresh Supabase project in the approved organization and data region.
2. Link with `supabase link --project-ref …`; review `supabase db diff --linked`.
3. After local reset/tests, run `supabase db push --dry-run`, then manually `supabase db push`.
4. Keep unrestricted Auth sign-up and anonymous sign-in disabled. Leave the email provider enabled for existing-user magic links and add only exact approved callback URLs.
5. Use Resend for both Supabase Auth SMTP and application transactional mail. Verify the dedicated `auth.ourmu.org` domain in Resend before changing either production sender. Keep `ALLOW_MANUAL_TEST_LINKS=false` outside a controlled emergency rollback.
6. Verify the migrated Storage bucket is private, then bootstrap the administrator.
7. Create one Vercel project and set environment variables only through Vercel.
8. Configure backup, cron, and release-gate values in the private `OurMu-Ventures/ourmu-ops` repository; complete acceptance before domain change.

Vercel needs `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `IDENTITY_MASTER_KEY_BASE64`, `CRON_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `ALLOW_MANUAL_TEST_LINKS`, `LEGAL_PRIVACY_VERSION`, and `AGREEMENT_PLACEHOLDER_BLOCK`.

The private `OurMu-Ventures/ourmu-ops` repository needs secrets `PROD_DATABASE_URL`, `AGE_RESTORE_IDENTITY`, `CRON_SECRET`, `TEMP_DEPLOYMENT_URL`, and `LEGAL_AGREEMENT_SHA256`; variable `AGE_RECIPIENT`; and the release variables documented alongside its private workflows. Production workflows and their configuration do not belong in this public application repository.

Operationally verify health, maintenance, dead jobs, daily encrypted artifacts, monthly restore, Supabase advisors, and critical dependency audit. Supabase Free is acceptable only for the controlled invite-only pilot with these compensating backups. Upgrade before open enrollment, payment/payout work, or when automatic backups/support become required.

## Resend email cutover and operations

Use separate, sending-only Resend API keys for the two production paths:

- `ourmu-supabase-auth`: Supabase SMTP password only.
- `ourmu-app-transactional`: Vercel `RESEND_API_KEY` only.

Never place either key in the repository, shell history, tickets, or logs. Set
`RESEND_FROM_EMAIL` to `OURMU <no-reply@auth.ourmu.org>` and retain
`community@ourmu.org` as the reply-to/support address.

Before cutover, add `auth.ourmu.org` in Resend and publish the exact DNS records
Resend supplies. Do not alter the root `ourmu.org` SPF record to guess or merge
values; the dedicated subdomain must have its own Resend-provided SPF, DKIM, MX,
and return-path records. Proceed only after Resend reports SPF and DKIM verified.
Keep link tracking disabled for authentication mail.

Configure the production Supabase project (`<prod-project-ref>`) Auth SMTP with
sender `OURMU`, sender
address `no-reply@auth.ourmu.org`, host `smtp.resend.com`, port `465`, username
`resend`, and the dedicated Auth key as password. Preserve the 60-second
per-address frequency and 3600-second OTP expiry. Configure Vercel production
with the separate application key, the sender above, and
`ALLOW_MANUAL_TEST_LINKS=false`; redeploy so the new environment values apply.

Acceptance requires one magic-link request each to `tester-1@example.com`
and `tester-2@example.com`, plus one representative application transactional
message. For each, confirm Supabase `/otp` returns 200 without an SMTP error,
Resend reports `delivered` (not only `sent`), the message arrives, SPF/DKIM/DMARC
pass in received headers, and the magic link completes at
`partners.ourmu.org/auth/confirm`. Use a Resend test address to confirm a safe
intentional failure is visible. Monitor deliveries, bounces, complaints, and
suppressions for 24 hours before revoking the former provider credentials.

For rollback, restore the previous Supabase SMTP configuration and previous
Vercel email variables from the secret manager, then redeploy. Do not change the
authentication flow or commit credential values. Rotate either Resend key by
creating its replacement, updating only its assigned consumer, verifying a
delivery, and then revoking the old key.

The canonical pilot URL is `https://partners.ourmu.org`. Keep the legacy `https://ourmu-app.vercel.app/auth/confirm` callback temporarily as a rollback route until acceptance is signed off.

### Application identity RPC rollout

Apply `20261005110403_fix_application_identity_api.sql` before deploying the
application actions that call `submit_partner_application` and
`review_partner_application`. Both RPCs run with the caller's privileges and
are executable only by `service_role`; keep `private` out of the Data API's
exposed schemas. Submission commits the application, encrypted identity and
invitation consumption together. Approval/rejection commits the identity
change and application decision together.

After rollout, submit a controlled test invitation and verify that the
application is visible to administrators, the invitation is consumed once,
and approval links the identity to the partner (or rejection erases the
ciphertext). Invitations from failed submissions remain reusable until their
original expiration, provided they have not been revoked.

## Admin payout destination setup

When completing a maturity instruction, select **Review completion** to see the partner, payout, reinvestment, destination cycle, and external payout reference. Select **Cancel** to return to the form, or **Confirm completion** to submit. Payout references and verified destinations remain required whenever the actual payout is positive. Completion records an external payment; it does not send money. Revised amounts still require partner confirmation before settlement.

Apply migration `20261005134923_admin_maturity_payout_destination.sql` before deploying the admin form. The runtime must have the existing payout encryption master key and Supabase service-role configuration.

For a requested maturity instruction with a withdrawal amount and no saved destination, open Admin → Maturities and expand **Set up a verified payout destination**. Enter the provider and account holder, select the partner’s phone on file for mobile money or enter the verified account reference, choose the offline verification method, and confirm verification. An active administrator with two-factor authentication can save the encrypted destination without partner login.

The action links an immutable destination and records the authenticated administrator in the audit log. It clears only a documented missing-destination setup hold; unrelated or unexplained holds remain for review. It does not change amounts, transfer money, fulfill the instruction, or activate a reinvestment. Follow the normal processing and fulfillment workflow on the scheduled payout date.

## Cycle-wide actual returns

Apply migration `20261014150000_cycle_actual_returns.sql` before deploying the admin form, then regenerate types. The migration is additive: projected fields stay unchanged, every existing cycle starts without an actual return, and cycles that already had a fulfilled instruction or a proposed per-investment ROI are flagged `legacy_settlement` so they finish on the old per-investment workflow.

An active administrator with two-factor authentication records the rate under Admin → Cycles → **Actual return**: enter a percentage (0% to 1,000%, two decimals), review the preview of affected investments, principal, actual profit, total value and difference from projection, confirm, and save. Partners see the rate immediately; before maturity it is labelled as revisable. It locks when the maturity date begins in Africa/Kampala. A cycle that reaches maturity without a rate accepts exactly one late entry, provided no investment in it has been settled. Each save is audited (`cycle.actual_return_recorded`) with the administrator, previous and new rate, and affected totals.

Recording a rate never matures investments or triggers payments; payouts still follow the 15th of the month after maturity. While a rate is missing, fulfillment and automatic reinvestment instruction creation are blocked (`run_maintenance` reports `awaiting_actual_return`), and an **Actual return required** banner appears on Admin → Overview and Cycles from the day before maturity.

Weekly, and before each month end, check upcoming cycles that are missing a rate:

```sql
select c.name, c.maturity_date, c.status,
  public.maturity_payout_date(c.maturity_date) as payout_date,
  count(i.id) filter (where i.status in ('active', 'matured') and i.payout_basis <> 'reported_paid') as open_investments
from public.investment_cycles c
left join public.investments i on i.cycle_id = c.id
where c.actual_return_bps is null
  and not c.legacy_settlement
  and c.status <> 'draft'
  and c.maturity_date <= (now() at time zone 'Africa/Kampala')::date + 14
group by c.id
order by c.maturity_date;
```

Any row with open investments needs a rate before its payout date. Run `npm run db:test:actual-return-races` against the local stack to recheck save and fulfillment locking after changes to these functions.
