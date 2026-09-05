# Architecture decision record

The portal is one deployable Next.js application backed by one Supabase project. Browser code has a publishable key and read-only RLS access to explicitly granted records. Server Components read with the signed-in user's session. Server Actions authenticate with `getUser()`, reload the current profile and status, then perform role checks. Administrator actions require Supabase AAL2.

The service-role key exists only in modules importing `server-only`. It is used for identity, administrative, audit, and financial operations after application-level authorization. Financial state changes call service-role-only PostgreSQL functions so capacity locks, immutable bank receipt insertion, investment activation, audit creation, and job creation commit or roll back together.

## Boundaries

- `src/app`: routes, Server Components, health and cron handlers.
- `src/actions`: validated, authenticated application commands.
- `src/lib/supabase`: browser, cookie-aware server, and server-only admin clients.
- `src/lib/security`: context-separated encryption and fingerprint derivation.
- `src/lib/jobs`: retryable email and agreement generation.
- `supabase/migrations`: source-of-truth schema, grants, RLS, functions, and Storage policy.
- `supabase/tests`: schema/security assertions.

There is no FastAPI service, Redis, custom JWT layer, S3 abstraction, general-purpose REST API, or hosted staging environment. PostgreSQL owns state. UGX uses whole-shilling `bigint`. Investment terms are snapshotted. Published agreements, receipts, activated terms, and audit events are immutable.
