// Clones a disposable pre-deposit schema database, records synthetic single
// payments the old way, applies the migration, and checks that historical
// payments, receipts and their duplicate protection are unchanged.
// OURMU_TEST_CONTAINER=... OURMU_TEST_TEMPLATE_DB=... node scripts/test-bank-deposit-migration.mjs
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const container = process.env.OURMU_TEST_CONTAINER;
const template = process.env.OURMU_TEST_TEMPLATE_DB;
assert.ok(container && template, "Provide a disposable pre-deposit test template");
const database = `ourmu_bank_deposit_migration_${process.pid}`;
const admin = "a0000000-0000-4000-8000-000000000001";
const partner = "b0000000-0000-4000-8000-000000000001";
const cycle = "c0000000-0000-4000-8000-000000000001";
const today = `(now() at time zone 'Africa/Kampala')::date`;

function run(args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", container, ...args]);
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
    child.stdin.end(input);
  });
}
const query = (sql) =>
  run(["psql", "-U", "postgres", "-d", database, "-At", "-v", "ON_ERROR_STOP=1"], sql);
async function success(sql) {
  const result = await query(sql);
  assert.equal(result.code, 0, result.output);
  return result.output.trim();
}
const snapshot = `select md5(string_agg(row_text, '|' order by row_text)) from (
  select to_jsonb(r)::text as row_text from public.bank_receipts r
  union all select (to_jsonb(x) - array['bank_deposit_id','payment_reference','deposit_amount_ugx','deposit_allocation_count'])::text
    from public.investment_receipts x) rows;`;
const legacySnapshot = `select md5(string_agg(row_text, '|' order by row_text)) from (
  select (to_jsonb(r) - array['deposit_id','deposit_line','allocation_kind'])::text as row_text from public.bank_receipts r
  union all select (to_jsonb(x) - array['bank_deposit_id','payment_reference','deposit_amount_ugx','deposit_allocation_count'])::text
    from public.investment_receipts x) rows;`;

const created = await run(["createdb", "-U", "supabase_admin", "-O", "postgres", "-T", template, database]);
assert.equal(created.code, 0, created.output);
try {
  await success(`
    insert into auth.users (id, email) values ('${admin}', 'migration-admin@test.local'), ('${partner}', 'migration-partner@test.local');
    insert into public.profiles (id, role, access_status, legal_name, email, phone, kyc_status) values
      ('${admin}', 'admin', 'active', 'Migration Admin', 'migration-admin@test.local', '+256700000401', 'verified'),
      ('${partner}', 'investor', 'active', 'Migration Partner', 'migration-partner@test.local', '+256700000402', 'verified');
    insert into public.agreement_versions (id, version, title, template_markdown, content_hash, is_legally_approved, approved_by, approved_at, published_at)
      values ('a9000000-0000-4000-8000-000000000001', 'v-migration', 'Migration Agreement', 'Terms.', repeat('ab', 32), true, '${admin}', now(), now());
    insert into public.investment_cycles (id, name, opens_at, closes_at, maturity_date, capacity_ugx, unit_price_ugx,
      projected_return_bps, status, agreement_version_id, created_by, record_origin)
    values ('${cycle}', 'Migration cycle', (${today} - 5)::timestamp at time zone 'Africa/Kampala',
      (${today} + 5)::timestamp at time zone 'Africa/Kampala',
      (date_trunc('month', now() + interval '6 months') + interval '1 month - 1 day')::date, 200000000, 125000, 3000,
      'open', 'a9000000-0000-4000-8000-000000000001', '${admin}', 'portal');
    insert into public.investments (id, investor_id, cycle_id, principal_ugx, projected_return_bps, projected_return_ugx,
      projected_value_ugx, unit_price_ugx, maturity_date, requested_at, status, policy_version)
    select ('e0000000-0000-4000-8000-00000000000' || n)::uuid, '${partner}', '${cycle}', 125000, 3000, 37500, 162500, 125000,
      maturity_date, opens_at, 'reserved', case when n = 1 then null else 'auto_cycle_v1' end
    from public.investment_cycles, generate_series(1, 4) n where id = '${cycle}';
    insert into public.investment_agreements (investment_id, investor_id, agreement_version_id, accepted_content_hash,
      accepted_at, acceptance_request_id, accepted_user_agent, accepted_ip_fingerprint)
    select id, investor_id, 'a9000000-0000-4000-8000-000000000001', repeat('ab', 32), requested_at, gen_random_uuid(), 'migration', '\\x00'
    from public.investments;
    -- A legacy-policy payment and an automatic-cycle payment, both single.
    select public.activate_investment('${admin}', 'e0000000-0000-4000-8000-000000000001', 'LEGACY-PAY-1', 125000, ${today}, 'ACTIVATE', true, gen_random_uuid());
    select public.activate_investment('${admin}', 'e0000000-0000-4000-8000-000000000002', 'LEGACY-PAY-2', 125000, ${today}, 'ACTIVATE', true, gen_random_uuid());
  `);
  const before = await success(snapshot);
  const migration = await readFile(
    new URL("../supabase/migrations/20261120090000_allocate_bank_deposits.sql", import.meta.url),
    "utf8",
  );
  await success(migration);
  assert.equal(await success(legacySnapshot), before, "historical payments and receipts unchanged");
  assert.equal(
    await success(`select count(*) from public.bank_receipts where deposit_id is null and deposit_line is null and allocation_kind is null;`),
    "2",
  );
  assert.equal(
    await success(`select count(*) from public.investment_receipts where payment_reference is null and bank_deposit_id is null;`),
    "2",
  );
  console.log("PASS: historical single payments and receipts survive unchanged");

  const duplicate = await query(
    `select public.activate_investment('${admin}', 'e0000000-0000-4000-8000-000000000003', 'LEGACY-PAY-1', 125000, ${today}, 'ACTIVATE', true, gen_random_uuid());`,
  );
  assert.notEqual(duplicate.code, 0);
  assert.match(duplicate.output, /duplicate key value violates unique constraint "bank_receipts_bank_reference_key"/);
  await success(
    `select public.activate_investment('${admin}', 'e0000000-0000-4000-8000-000000000001', 'LEGACY-PAY-1', 125000, ${today}, 'ACTIVATE', true, gen_random_uuid());`,
  );
  assert.equal(await success(`select count(*) from public.bank_receipts;`), "2");
  console.log("PASS: duplicate references keep the same constraint error; retries stay idempotent");

  const reused = await query(`select public.allocate_bank_deposit('${admin}', true, gen_random_uuid(), '${partner}', '${cycle}',
    'legacy-pay-2', 125000, ${today}, ${today}, 'email', 'Mailbox: migration test', 'Synthetic migration check only.',
    jsonb_build_array(jsonb_build_object('kind', 'reservation', 'investment_id', 'e0000000-0000-4000-8000-000000000004',
      'account_id', (select account_id from public.investments where id = 'e0000000-0000-4000-8000-000000000004'), 'amount_ugx', '125000')),
    true, true, repeat('ab', 32), false, 'ALLOCATE');`);
  assert.notEqual(reused.code, 0);
  assert.match(reused.output, /bank reference is already recorded/);
  assert.equal(
    await success(`select count(*) || ' ' || sum(received_amount_ugx)::numeric(28,2) from public.bank_payment_reconciliation;`),
    "2 250000.00",
  );
  console.log("PASS: historical references block deposits; each legacy payment reconciles once");
} finally {
  const dropped = await run(["dropdb", "-U", "supabase_admin", database]);
  assert.equal(dropped.code, 0, dropped.output);
}
