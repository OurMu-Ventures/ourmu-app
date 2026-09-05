# Cutover and rollback

Run the portal first on a protected temporary Vercel URL against its fresh Supabase database. Do not migrate legacy users or investments.

Acceptance covers invite → application → offline KYC approval → first magic link → admin MFA → next of kin → request → bank verification → atomic activation → PDF → signed download, plus mobile/keyboard/reduced-motion, RLS isolation, backup restore, health, maintenance, and retry.

After written acceptance, promote the accepted immutable deployment and move only `our-mu.com`. Record the previous deployment and DNS values. Keep the legacy application read-only during the rollback window. Do not repoint or delete `api.our-mu.com` until the rollback window formally closes.
