// Clone an explicitly supplied disposable schema database; never mutate the source.
// OURMU_TEST_CONTAINER=... OURMU_TEST_TEMPLATE_DB=... node scripts/test-bank-deposit-concurrency.mjs
// Every transaction commits, so the deferred deposit balance checks run for real.
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";

const container = process.env.OURMU_TEST_CONTAINER;
const template = process.env.OURMU_TEST_TEMPLATE_DB;
assert.ok(
  container && template,
  "Provide a disposable test container and template database",
);
const database = `ourmu_bank_deposit_race_${process.pid}`;
const admin = "a0000000-0000-4000-8000-000000000001";
const partner = "b0000000-0000-4000-8000-000000000001";
const school = "ac000000-0000-4000-8000-000000000001";
const retirement = "ac000000-0000-4000-8000-000000000002";
const closed = "c0000000-0000-4000-8000-000000000000";
const reservation = (n) => `e0000000-0000-4000-8000-00000000000${n}`;
const main = `(select id from public.investment_accounts where investor_id='${partner}' and is_default)`;
const yesterday = `((now() at time zone 'Africa/Kampala')::date - 1)`;

function run(args, input = "") {
  return new Promise((resolve, reject) => {
    const proc = spawn("docker", ["exec", "-i", container, ...args]);
    let output = "";
    proc.stdout.on("data", (chunk) => {
      output += chunk;
    });
    proc.stderr.on("data", (chunk) => {
      output += chunk;
    });
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ code, output }));
    proc.stdin.end(input);
  });
}
const query = (sql) =>
  run(
    ["psql", "-U", "postgres", "-d", database, "-Atq", "-v", "ON_ERROR_STOP=1"],
    `set statement_timeout = '10s'; ${sql}`,
  );
async function successful(sql) {
  const result = await query(sql);
  assert.equal(result.code, 0, result.output);
  return result.output.trim();
}
// The first transaction takes its locks and holds them; the second starts
// shortly after, so it must wait and then see the committed outcome.
async function race(first, second) {
  const firstRun = query(`begin; ${first} select pg_sleep(1); commit;`);
  await delay(300);
  return Promise.all([firstRun, query(`begin; ${second} commit;`)]);
}
function oneSuccess(results, expected) {
  assert.equal(
    results.filter((result) => result.code === 0).length,
    1,
    JSON.stringify(results),
  );
  assert.match(results.find((result) => result.code !== 0).output, expected);
}
const line = {
  place: (account, amount) =>
    `jsonb_build_object('kind','offline_placement','account_id',${account},'amount_ugx','${amount}')`,
  reserve: (id, amount) =>
    `jsonb_build_object('kind','reservation','investment_id','${id}','account_id',${main},'amount_ugx','${amount}')`,
};
const allocate = ({ lines, amount, reference, request = "gen_random_uuid()" }) =>
  `select public.allocate_bank_deposit('${admin}',true,${request},'${partner}','${closed}','${reference}',${amount},
    ${yesterday},${yesterday},'email','Mailbox: synthetic split instruction','Synthetic statement line and instruction verified.',
    jsonb_build_array(${lines.join(",")}),true,true,repeat('ab',32),true,'ALLOCATE');`;
const activate = (id, reference, amount) =>
  `select public.activate_investment('${admin}','${id}','${reference}',${amount},${yesterday},'ACTIVATE',true,gen_random_uuid());`;

const created = await run([
  "createdb",
  "-U",
  "supabase_admin",
  "-O",
  "postgres",
  "-T",
  template,
  database,
]);
assert.equal(created.code, 0, created.output);
try {
  await successful(`
    insert into auth.users (id, email) values ('${admin}', 'race-admin@test.local'), ('${partner}', 'race-partner@test.local');
    insert into public.profiles (id, role, access_status, legal_name, email, phone, kyc_status) values
      ('${admin}', 'admin', 'active', 'Race Admin', 'race-admin@test.local', '+256700000301', 'verified'),
      ('${partner}', 'investor', 'active', 'Race Partner', 'race-partner@test.local', '+256700000302', 'verified');
    insert into public.next_of_kin (user_id, legal_name, relationship, phone, address)
      values ('${partner}', 'Race Kin', 'sibling', '+256700000303', 'Kampala');
    insert into public.investment_accounts (id, investor_id, name) values
      ('${school}', '${partner}', 'School Fees'), ('${retirement}', '${partner}', 'Retirement');
    insert into public.agreement_versions (id, version, title, template_markdown, content_hash, is_legally_approved, approved_by, approved_at, published_at)
      values ('a9000000-0000-4000-8000-000000000001', 'v-race', 'Race Agreement', 'Race terms.', repeat('ab', 32), true, '${admin}', now(), now());
    -- Closed at the end of yesterday in Uganda: the payment day was its last day.
    insert into public.investment_cycles (id, name, opens_at, closes_at, maturity_date, capacity_ugx, unit_price_ugx,
      projected_return_bps, status, agreement_version_id, created_by, record_origin)
    values ('${closed}', 'Race cycle', (${yesterday} - 29)::timestamp at time zone 'Africa/Kampala',
      (${yesterday} + 1)::timestamp at time zone 'Africa/Kampala' - interval '1 millisecond',
      (date_trunc('month', now() + interval '6 months') + interval '1 month - 1 day')::date, 200000000, 125000, 3000,
      'closed', 'a9000000-0000-4000-8000-000000000001', '${admin}', 'portal');
    insert into public.investments (id, investor_id, cycle_id, principal_ugx, projected_return_bps, projected_return_ugx,
      projected_value_ugx, unit_price_ugx, maturity_date, requested_at, status, policy_version)
    select ('e0000000-0000-4000-8000-00000000000' || n)::uuid, '${partner}', '${closed}', 125000, 3000, 37500, 162500, 125000,
      maturity_date, opens_at + interval '1 day', 'reserved', 'auto_cycle_v1'
    from public.investment_cycles, generate_series(1, 6) n where id = '${closed}';
    insert into public.investment_agreements (investment_id, investor_id, agreement_version_id, accepted_content_hash,
      accepted_at, acceptance_request_id, accepted_user_agent, accepted_ip_fingerprint)
    select id, investor_id, 'a9000000-0000-4000-8000-000000000001', repeat('ab', 32), requested_at, gen_random_uuid(), 'race', '\\x00'
    from public.investments where investor_id = '${partner}';
  `);

  // Synthetic UGX 3,000,000 paid on the cycle's last day, committed the next day.
  await successful(allocate({
    lines: [line.place(main, "2000000"), line.place(`'${school}'`, "500000"), line.place(`'${retirement}'`, "500000")],
    amount: 3000000,
    reference: "RACE-SPLIT-1",
  }));
  assert.equal(
    await successful(`select count(*) || ' ' || sum(r.received_amount_ugx)::numeric(28,2) || ' ' || bool_and(i.status = 'active')
      from public.bank_receipts r join public.investments i on i.id = r.investment_id
      join public.bank_deposits d on d.id = r.deposit_id where d.bank_reference = 'RACE-SPLIT-1'
        and d.posted_at > (select closes_at from public.investment_cycles where id = '${closed}');`),
    "3 3000000.00 true",
  );
  console.log("PASS: 3m split commits after close with three balanced allocations");

  const appended = await query(`insert into public.bank_receipts (investment_id, bank_reference, received_amount_ugx,
      received_date, recorded_by, activated_at, deposit_id, deposit_line, allocation_kind)
    select '${reservation(6)}', bank_reference, 125000, received_date, posted_by, posted_at, id, 4, 'reservation'
    from public.bank_deposits where bank_reference = 'RACE-SPLIT-1';`);
  assert.notEqual(appended.code, 0);
  assert.match(appended.output, /deposit allocation does not match its deposit/);
  console.log("PASS: a later transaction cannot append to a posted deposit");

  const request = "'f0000000-0000-4000-8000-000000000001'";
  const sameRequest = allocate({ lines: [line.reserve(reservation(1), "125000")], amount: 125000, reference: "RACE-RETRY", request });
  const retried = await race(sameRequest, sameRequest);
  assert.ok(retried.every((result) => result.code === 0), JSON.stringify(retried));
  assert.deepEqual(
    retried.map((result) => /"replayed": true/.test(result.output)).sort(),
    [false, true],
  );
  assert.equal(await successful(`select count(*) from public.bank_deposits where request_id = ${request};`), "1");
  console.log("PASS: a double submit with one request ID posts once and replays");

  oneSuccess(
    await race(
      allocate({ lines: [line.place(`'${school}'`, "125000")], amount: 125000, reference: "RACE-DUP" }),
      allocate({ lines: [line.place(`'${retirement}'`, "125000")], amount: 125000, reference: "race-dup" }),
    ),
    /bank reference is already recorded/,
  );
  console.log("PASS: simultaneous deposits cannot share a reference");

  oneSuccess(
    await race(activate(reservation(2), "RACE-SINGLE", 125000),
      allocate({ lines: [line.reserve(reservation(3), "125000")], amount: 125000, reference: "RACE-SINGLE" })),
    /bank reference is already recorded/,
  );
  oneSuccess(
    await race(allocate({ lines: [line.reserve(reservation(4), "125000")], amount: 125000, reference: "RACE-CROSS" }),
      activate(reservation(5), "RACE-CROSS", 125000)),
    /bank reference is already recorded/,
  );
  console.log("PASS: a reference is used by a single payment or a deposit, never both");

  oneSuccess(
    await race(activate(reservation(3), "RACE-ACT-3", 125000),
      allocate({ lines: [line.reserve(reservation(3), "125000")], amount: 125000, reference: "RACE-DEP-3" })),
    /only a pending reservation can be activated/,
  );
  assert.equal(await successful(`select count(*) from public.bank_receipts where investment_id = '${reservation(3)}';`), "1");
  console.log("PASS: a reservation is paid once when activation and a deposit race");

  oneSuccess(
    await race(`select public.cancel_investment('${partner}','${reservation(5)}',gen_random_uuid());`,
      allocate({ lines: [line.reserve(reservation(5), "125000")], amount: 125000, reference: "RACE-CANCEL" })),
    /cancelled reservations cannot be revived/,
  );
  console.log("PASS: a cancelled reservation cannot be funded by a waiting deposit");

  const moved = await race(
    `select public.move_investment_account('${partner}','${reservation(6)}',${main},'${school}',gen_random_uuid());`,
    allocate({ lines: [line.reserve(reservation(6), "125000")], amount: 125000, reference: "RACE-MOVE" }),
  );
  oneSuccess(moved, /reservation moved to another account/);
  console.log("PASS: a reservation moved while a deposit waits is not funded from a stale form");

  // 3.75m is already in the cycle; two 25m placements cannot both fit under 50m.
  oneSuccess(
    await race(
      allocate({ lines: [line.place(`'${school}'`, "25000000")], amount: 25000000, reference: "RACE-CAP-1" }),
      allocate({ lines: [line.place(`'${retirement}'`, "25000000")], amount: 25000000, reference: "RACE-CAP-2" }),
    ),
    /investor cycle limit exceeded/,
  );
  assert.ok(Number(await successful(`select sum(principal_ugx) from public.investments
    where investor_id = '${partner}' and cycle_id = '${closed}' and status in ('reserved','active');`)) <= 50000000);
  console.log("PASS: simultaneous placements respect the partner-wide cap");

  assert.equal(
    await successful(`select count(*) from public.bank_deposits d where (select sum(received_amount_ugx) from public.bank_receipts r
      where r.deposit_id = d.id) is distinct from d.received_amount_ugx;`),
    "0",
  );
  assert.equal(
    await successful(`select (select count(*) from public.bank_payment_reconciliation) =
      (select count(*) from public.bank_receipts where deposit_id is null) + (select count(*) from public.bank_deposits);`),
    "t",
  );
  console.log("PASS: every committed deposit balances and reconciles once");
} finally {
  const dropped = await run(["dropdb", "-U", "supabase_admin", database]);
  assert.equal(dropped.code, 0, dropped.output);
}
