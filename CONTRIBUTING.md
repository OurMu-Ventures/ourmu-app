# Contributing

This repository is public primarily for transparency and auditability.
Maintainers may accept improvements, but do not guarantee review or acceptance
of unsolicited changes.

## Before opening a change

- Discuss substantial behavior changes in an issue first.
- Never submit credentials, personal or financial data, production identifiers,
  private legal material, exports, backups, or screenshots containing them.
- Do not use OURMU trademarks or brand assets without written permission.
- Keep changes focused and include tests for changed behavior.

## Local verification

Use Node.js 24, npm 11, Docker, and the Supabase CLI version documented in the
README. Before opening a pull request, run:

```sh
npm ci
npm run public:scan
npm run lint
npm run typecheck
npm test
npm run build
npm run db:test
npm run test:e2e
```

By contributing, you agree that your contribution is licensed under
AGPL-3.0-or-later and that you have the right to submit it.
