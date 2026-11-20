# Allocating one bank deposit across investments

Admin → **Deposits** posts one verified bank transfer from one partner across
several investments in that partner's accounts. The main use is a partner who
pays one amount and tells staff, outside the portal, how to split it between
accounts. Each part becomes a new **offline placement** in the chosen account.
A part can instead fund one of the partner's pending reservations in full.

## Using it

1. Choose the partner and the payment date shown on the bank statement
   (Uganda calendar date). The page shows the cycle that date falls in, the
   partner's limit and what is already in the cycle across all accounts, the
   cycle capacity, and the cycle agreement.
2. Enter the bank reference and the exact amount received. Add the statement
   time only if the statement shows one; it is kept as evidence, the date
   decides the cycle.
3. Split the deposit: tick pending reservations to fund (always their full
   reserved amount) and add placements as account + amount. The running total
   must match the deposit exactly.
4. Record the partner's instructions: the date they gave them, how (email,
   signed document, recorded call, in person), where the evidence is kept and
   your verification notes. Tick the identity, statement and split checks and,
   for placements, that the partner accepted the cycle agreement shown.
5. Type **ALLOCATE**. Everything is written in one transaction or not at all.

## Rules the database enforces

- Active administrator with a verified AAL2 session. The RPC
  `public.allocate_bank_deposit` is executable by the service role only.
- One bank reference per transfer. A reference is used by either one
  single-payment activation or one deposit, compared ignoring case and
  surrounding spaces. Single-payment activations keep the
  `bank_receipts_bank_reference_key` error they always had.
- The cycle comes from the payment's Uganda date, exactly as date-only
  activation resolves it: a cycle intersecting that day; a day split between
  two cycles is refused. A payment made inside a cycle can be posted after the
  cycle closes, until it matures. A payment dated after the close belongs to
  the next cycle and never moves a reservation.
- Reservations: the partner's own, pending, in the payment's cycle, still in
  the account the page showed, reserved on or before the payment date, funded
  with exactly their reserved principal. One payment per investment, as before.
- Placements: the partner's own open account, at least UGX 125,000 with at most
  two decimals, an active verified partner with next of kin, and the cycle's
  approved agreement unchanged since the page loaded.
- Lines add up exactly to the deposit; at most 20 lines. Reserved and active
  principal across all of the partner's accounts stays within their cycle
  limit, and the cycle within its capacity (test partners are exempt from
  capacity only).
- A retry or double submit of the same form replays the original result. The
  same request ID with different details is refused.
- At commit, a deposit's allocations must add up to it. Allocations cannot be
  added to a deposit later.

## What is recorded

- `bank_deposits`: reference, amount, payment date (and statement time if
  given), the cycle, the partner's instruction date, method, evidence
  reference and verification notes, the identity/split attestations, the
  agreement version and content hash accepted offline (placements only), the
  posting administrator and the real posting time. Immutable; administrators
  only.
- `bank_receipts`: one row per investment with its own amount, the shared
  reference, `deposit_id`, line number and `allocation_kind`. Partners can see
  their own rows, as before.
- New placements are ordinary `portal` investments created active at the
  posting time. `requested_at` and `activated_at` are the real posting time,
  never backdated; the payment date lives on the payment records.
- One receipt per investment showing that investment's amount, the shared bank
  reference and the deposit total, plus receipt PDF jobs. Reservations also
  queue their usual agreement PDF.
- `audit_events`: `investment.activated` per investment (with the deposit and
  `allocation_kind`) and one `bank_deposit.allocated`.

### Offline placements and the agreement

Placements have no electronic acceptance: no `investment_agreements` row, no
browser evidence and no agreement PDF, because the approved template states the
member accepted electronically. A trigger refuses any later
`investment_agreements` row for an offline placement. The offline authority on
`bank_deposits` is the agreement evidence. The partner's investment page shows
the agreement as "accepted offline". This follows the offline reinvestment
precedent in `20261020191147_admin_offline_reinvestment_authorizations.sql`.

## Reconciliation

`public.bank_payment_reconciliation` (service role only) lists each real bank
transfer once: single payments as `single_investment`, split deposits as one
`split_deposit` row with the full amount and investment count. Its total
equals the sum of `bank_receipts`. Count transfers from this view, not from
`bank_receipts`.

## Deployment order

1. Back up production.
2. Apply `20261120090000_allocate_bank_deposits.sql`. It adds the deposit
   table, view and RPC, adds nullable columns to `bank_receipts` and
   `investment_receipts`, and swaps the reference unique constraint for a
   partial unique index of the same name. Existing rows and the current app
   keep working: the old app never sets `deposit_id`.
3. Deploy the app. The Deposits page appears in the admin navigation.
4. Post the real deposit with the partner's actual evidence. Do not post test
   entries in production.

Rollback: hide the page by reverting the app. Do not drop the table or columns
once a deposit is recorded.

## Verification

- `supabase test db` runs `bank_deposits.test.sql` (synthetic 3,000,000 UGX
  split 2,000,000 / 500,000 / 500,000 across three accounts, paid on a cycle's
  last day and posted the next day after close; legacy payments, boundaries,
  invalid splits, retries, caps, capacity, no partial writes, RLS).
- `npm run check` covers the form parser, action, error contract, receipts and
  navigation.
- Docker harnesses against disposable synthetic databases:

```sh
OURMU_TEST_CONTAINER=<test-container> OURMU_TEST_TEMPLATE_DB=<migrated-empty-db> node scripts/test-bank-deposit-concurrency.mjs
OURMU_TEST_CONTAINER=<test-container> OURMU_TEST_TEMPLATE_DB=<pre-deposit-empty-db> node scripts/test-bank-deposit-migration.mjs
```

The first commits real transactions: the 3m split after close, a blocked
late append, double submits, shared references, activation/deposit,
cancellation/deposit and move/deposit races, and the partner cap. The second
applies the migration over legacy single payments and checks they are
unchanged.
