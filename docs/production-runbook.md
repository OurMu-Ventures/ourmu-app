# Production runbook

1. Create a fresh Supabase project in the approved organization and data region.
2. Link with `supabase link --project-ref …`; review `supabase db diff --linked`.
3. After local reset/tests, run `supabase db push --dry-run`, then manually `supabase db push`.
4. Keep unrestricted Auth sign-up and anonymous sign-in disabled. Leave the email provider enabled for existing-user magic links and add only exact approved callback URLs.
5. Use Resend for both Supabase Auth SMTP and application transactional mail. Verify the dedicated `auth.ourmu.org` domain in Resend before changing either production sender. Keep `ALLOW_MANUAL_TEST_LINKS=false` outside a controlled emergency rollback.
6. Verify the migrated Storage bucket is private, then bootstrap the administrator.
7. Create one Vercel project and set environment variables only through Vercel.
8. Configure GitHub backup, cron, and release-gate values; complete acceptance before domain change.

Vercel needs `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `IDENTITY_MASTER_KEY_BASE64`, `CRON_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `ALLOW_MANUAL_TEST_LINKS`, `LEGAL_PRIVACY_VERSION`, and `AGREEMENT_PLACEHOLDER_BLOCK`.

GitHub needs secrets `PROD_DATABASE_URL`, `AGE_RESTORE_IDENTITY`, `CRON_SECRET`, `TEMP_DEPLOYMENT_URL`, `LEGAL_AGREEMENT_SHA256`; variable `AGE_RECIPIENT`; and the release variables named in the workflow.

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

Configure the production Supabase project (`prodprojectrefplaceholder`) Auth SMTP with
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
