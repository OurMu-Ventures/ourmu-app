# Controlled partner-data import

Production source workbooks, manifests, checksums, reconciliation totals, batch
identifiers, and operator records are private data and do not belong in this
repository. This document describes the controls expected of an import without
publishing an OURMU production dataset or its fingerprint.

## Required controls

1. Parse the source only in a restricted operator environment. Never upload it
   to public CI or print row-level content to logs.
2. Pin the approved source checksum and expected reconciliation values in the
   private operation record, not in public source code.
3. Generate deterministic identifiers from the approved source checksum and
   source-row identity so retries are idempotent.
4. Validate identities, duplicate aliases, monetary arithmetic, record counts,
   status counts, and aggregate totals before connecting to production.
5. Stage with disabled profiles and records hidden by RLS. Acceptance must be a
   separate AAL2-protected administrator action and must be transactional.
6. Back up and restore-test production before staging. Reconcile the staged
   batch against the private operation record before acceptance.
7. Retain only an encrypted backup and sanitized audit record after acceptance;
   securely remove local workbooks and generated manifests.

## Failure handling

- A checksum or reconciliation mismatch stops the operation; it is never
  overridden to force an import through.
- A failed stage remains inaccessible to investors and may be retried with the
  same deterministic identifiers after the cause is corrected.
- Accepted financial records are immutable. Corrections use a separately
  reviewed compensating migration and audit event.

The private operations repository contains the production parser, exact schema
mapping, approval record, and runbook. Those materials are intentionally not
part of the public application source.
