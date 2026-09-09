# Production runbook

1. Create a fresh Supabase project in the approved organization and data region.
2. Link with `supabase link --project-ref …`; review `supabase db diff --linked`.
3. After local reset/tests, run `supabase db push --dry-run`, then manually `supabase db push`.
4. Keep unrestricted Auth sign-up and anonymous sign-in disabled. Leave the email provider enabled for existing-user magic links and add only exact approved callback URLs.
5. During administrator setup only, Supabase's built-in email service may be used for project-team recipients. Do not invite external investors until Resend custom SMTP and the transactional sending domain are configured.
6. Verify the migrated Storage bucket is private, then bootstrap the administrator.
7. Create one Vercel project and set environment variables only through Vercel.
8. Configure GitHub backup, cron, and release-gate values; complete acceptance before domain change.

Vercel needs `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `IDENTITY_MASTER_KEY_BASE64`, `CRON_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `LEGAL_PRIVACY_VERSION`, and `AGREEMENT_PLACEHOLDER_BLOCK`.

GitHub needs secrets `PROD_DATABASE_URL`, `AGE_RESTORE_IDENTITY`, `CRON_SECRET`, `TEMP_DEPLOYMENT_URL`, `LEGAL_AGREEMENT_SHA256`; variable `AGE_RECIPIENT`; and the release variables named in the workflow.

Operationally verify health, maintenance, dead jobs, daily encrypted artifacts, monthly restore, Supabase advisors, and critical dependency audit. Supabase Free is acceptable only for the controlled invite-only pilot with these compensating backups. Upgrade before open enrollment, payment/payout work, or when automatic backups/support become required.

The canonical pilot URL is `https://partners.ourmu.org`. Keep the legacy `https://ourmu-app.vercel.app/auth/confirm` callback temporarily as a rollback route until acceptance is signed off.
