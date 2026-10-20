# Offline reinvestments for unclaimed legacy partners

Admin → Maturities → **Offline authorizations for unclaimed imported partners** records specific offline authority without creating an email login. Initial scope is full-value reinvestment of an unclaimed, unpaid, matured imported investment with a recorded cycle actual return. Linked partners continue through the existing portal instruction workflow.

1. Select the source investment. Review the full actual matured value, open destination cycle, and published agreement.
2. Independently verify identity and check external settlement records. Retain evidence of the partner's instruction for the exact amount and destination agreement. Enter the Uganda authorization date, method, evidence reference, and verification notes. Check the attestations and record the authorization. No investment is created at this step.
3. Review the recorded partner, amount, cycle, agreement version, and evidence. Type **REINVEST** and confirm to complete. The backend rechecks source eligibility, payout date, the actual return, agreement hash, enrollment at record time, current cycle status/maturity, capacity, and the UGX 50 million legacy-partner cycle limit. Failures roll back the entire settlement. Authorization captured inside enrollment can complete after the cycle closes, before destination maturity.
4. If evidence is wrong or withdrawn before completion, revoke it with a reason. The original evidence remains immutable. A replacement authorization can then be recorded. Completed settlements cannot be revoked by this workflow.

Recording and completion both require an authenticated active administrator with a verified AAL2 session. Server actions derive the administrator from that session. RPCs are security invoker and executable only by the trusted service role; browser roles cannot execute them. RLS limits offline evidence to administrators. Authorized date is a date, not a fabricated timestamp. Recorded and completed timestamps reflect the actual database time.

The authority preserves the source investment, legacy identity, agreement version/hash, principal, actual ROI, full amount, evidence location, verification notes, authorizing date, recording administrator, completing administrator, and immutable audit events. Evidence references are plain text; the system does not upload a document, validate a document exists, or certify its legal sufficiency. The administrator must retain and verify it. No portal IP, user-agent, standing authorization, bank payment, or online agreement acceptance is manufactured.

Completion creates one new `hybrid` investment linked to the imported identity and explicit offline authority. It has no source sheet or fabricated import row, and remains visible in Admin → Investments and cycle totals. It atomically creates one reinvestment receipt and a receipt-PDF job. No email or online agreement-PDF job is queued. No funds are sent externally. A later verified legacy-account claim attaches both the investment and its existing receipt to the real owner.

## Deployment and verification

Apply `20261020191147_admin_offline_reinvestment_authorizations.sql` before deploying the UI. This migration adds an administrator-only evidence table and three service-only RPCs, extends hybrid investment provenance and receipt ownership, and preserves existing online settlement rules. Regenerate database types after applying migrations. Run `supabase test db` including `offline_reinvestment.test.sql` and the existing receipt, maturity, and investment-limit suites before rollout. Run the TypeScript, unit, lint, and production-build checks.

Enter the actual evidence date, method, reference, and verification notes. Implementation and testing never populate these fields from assumptions or settle a real partner's investment.

## Reporting

Maturity reporting must include `offline_reinvestment_authorizations`: `fulfilled` rows are reinvested using `amount_ugx` and `fulfilled_investment_id`; `recorded` rows are pending offline authorization; `revoked` rows are historical evidence only. Exclude recorded/fulfilled offline sources from “no instruction” counts. The original matured investment remains unchanged, matching the existing online settlement model.

SQL for outstanding sources must require both no `maturity_instructions` row and no offline authorization with `status <> 'revoked'`. Receipt access stays with administrators until a real partner account is linked. Reconcile any offline payment before recording authorization; absence of a portal payout is not proof that no external payment occurred.
