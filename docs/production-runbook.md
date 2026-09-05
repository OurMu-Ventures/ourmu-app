# Production runbook

1. Create a fresh Supabase project in the approved organization and data region.
2. Link with `supabase link --project-ref …`; review `supabase db diff --linked`.
3. After local reset/tests, run `supabase db push --dry-run`, then manually `supabase db push`.
4. Disable email and anonymous sign-up in production Auth. Add exact protected-deployment and `our-mu.com/auth/confirm` redirect URLs.
5. Configure Resend custom SMTP and verified transactional domain.
6. Verify the migrated Storage bucket is private, then bootstrap the administrator.
7. Create one Vercel project and set environment variables only through Vercel.
8. Configure GitHub backup, cron, and release-gate values; complete acceptance before domain change.

Vercel needs `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `IDENTITY_MASTER_KEY_BASE64`, `CRON_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `LEGAL_PRIVACY_VERSION`, and `AGREEMENT_PLACEHOLDER_BLOCK`.

GitHub needs secrets `PROD_DATABASE_URL`, `AGE_RESTORE_IDENTITY`, `CRON_SECRET`, `TEMP_DEPLOYMENT_URL`, `LEGAL_AGREEMENT_SHA256`; variable `AGE_RECIPIENT`; and the release variables named in the workflow.

Operationally verify health, maintenance, dead jobs, daily encrypted artifacts, monthly restore, Supabase advisors, and critical dependency audit. Supabase Free is acceptable only for the controlled invite-only pilot with these compensating backups. Upgrade before open enrollment, payment/payout work, or when automatic backups/support become required.
