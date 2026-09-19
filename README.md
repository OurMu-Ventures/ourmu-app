# OURMU Partner Portal

Invite-only partner administration for OURMU Ventures. This repository is a greenfield Next.js 16 application; the legacy frontend/API are deliberately not dependencies.

The source is published for transparency and auditability. It is not a turnkey
hosted service, and access to this repository does not grant access to OURMU's
production systems, accounts, or data. The project is maintained for OURMU's
current production deployment; outside contributions may be considered but are
not guaranteed support or acceptance.

## Architecture

- One Next.js 16 / React 19 / TypeScript application and one Vercel project.
- Supabase Auth, PostgreSQL 17, RLS, and a private `agreements` Storage bucket.
- Server Components for reads and authenticated Server Actions for UI mutations.
- Service-role-only, `SECURITY INVOKER` PostgreSQL functions for reservation, cancellation, activation, and maintenance.
- Resend-backed Supabase Auth email and application transactional mail, using separate production credentials.
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
npm run public:scan
```

`npm run release:check` intentionally fails until all legal and operational launch-gate variables are supplied. This is not a defect: counsel-approved agreement/privacy/risk text and verified production services are required before promoting `our-mu.com`.

Production email must use Resend for both Supabase Auth SMTP and application transactional messages. Use separate sending-only keys, verify `auth.ourmu.org` before cutover, keep link tracking disabled for Auth mail, and leave manual-link mode disabled except during a controlled emergency rollback. See `docs/production-runbook.md` for verification and rotation procedures.

Never commit `.env.local`, service-role keys, database URLs, age identities, invite tokens, magic links, bank references, or plaintext NIN values. Do not paste them into issues, logs, CI output, or chat.

## License and trademarks

The source code is licensed under
[AGPL-3.0-or-later](https://www.gnu.org/licenses/agpl-3.0.html). OURMU names,
logos, slides, and other identified brand assets are trademarks or brand assets
of OurMu Ventures Limited and may be used only with prior written permission.
The fish sprites retain their Creative Commons Attribution-ShareAlike licenses.
See [ASSETS.md](ASSETS.md) for the asset-by-asset boundary.

See [CONTRIBUTING.md](CONTRIBUTING.md) before proposing changes and
[SECURITY.md](SECURITY.md) for private vulnerability reporting. Never submit
personal data, financial records, credentials, or production identifiers in a
public issue or pull request.
