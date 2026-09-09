# OURMU Investor Portal

Invite-only investor administration for OURMU Ventures. This repository is a greenfield Next.js 16 application; the legacy frontend/API are deliberately not dependencies.

## Architecture

- One Next.js 16 / React 19 / TypeScript application and one Vercel project.
- Supabase Auth, PostgreSQL 17, RLS, and a private `agreements` Storage bucket.
- Server Components for reads and authenticated Server Actions for UI mutations.
- Service-role-only, `SECURITY INVOKER` PostgreSQL functions for reservation, cancellation, activation, and maintenance.
- Supabase Auth email for administrator-only setup testing. Resend transactional mail and custom SMTP remain production launch gates.
- No application payment collection. Staff verify bank transfers outside the portal.

See [architecture](docs/architecture.md), [security model](docs/security.md), and [production runbook](docs/production-runbook.md).

## Local setup

Requirements: Node.js 24, npm 11, Docker Desktop, and Supabase CLI 2.113 or newer.

```bash
npm ci
supabase start
supabase db reset
supabase status -o env
cp .env.example .env.local
npm run dev
```

Copy the local API URL, publishable/anon key, and service-role key shown by `supabase status` into `.env.local`. Generate local secrets with `openssl rand -base64 32` and `openssl rand -hex 32`. Use the base64 value for `IDENTITY_MASTER_KEY_BASE64` and the hex value for `CRON_SECRET`. Local auth emails appear in Mailpit at `http://127.0.0.1:54324`.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run db:test
npm run test:e2e
```

`npm run release:check` intentionally fails until all legal and operational launch-gate variables are supplied. This is not a defect: counsel-approved agreement/privacy/risk text and verified production services are required before promoting `our-mu.com`.

Supabase's built-in email service is temporary and must not be used for external investor onboarding: it is restricted to project-team recipients, rate-limited, and has no delivery SLA. Keep invitations internal until Resend custom SMTP and transactional email are configured.

Never commit `.env.local`, service-role keys, database URLs, age identities, invite tokens, magic links, bank references, or plaintext NIN values. Do not paste them into issues, logs, CI output, or chat.
