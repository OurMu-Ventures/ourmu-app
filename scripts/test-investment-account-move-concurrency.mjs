// Clone an explicitly supplied disposable schema database; never mutate the source.
// OURMU_TEST_CONTAINER=... OURMU_TEST_TEMPLATE_DB=... node scripts/test-investment-account-move-concurrency.mjs
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";

const container = process.env.OURMU_TEST_CONTAINER;
const template = process.env.OURMU_TEST_TEMPLATE_DB;
assert.ok(
  container && template,
  "Provide a disposable test container and template database",
);
const database = `ourmu_account_move_race_${process.pid}`;
const partner = "22222222-2222-2222-2222-222222222222";
const school = "12345678-1234-4234-8234-123456789012";
const retirement = "12345678-1234-4234-8234-123456789013";
const reserved = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const active = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const secondReservation = "dddddddd-dddd-dddd-dddd-ddddddddddde";
const main = `(select id from public.investment_accounts where investor_id='${partner}' and is_default)`;
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
// Account arguments are SQL expressions so Main Account can be a subquery.
const move = (investment, from, to) =>
  `select public.move_investment_account('${partner}','${investment}',${from},${to},gen_random_uuid());`;
// The first transaction takes its locks and holds them; the second starts
// shortly after, so it must wait and then see the committed outcome.
async function race(first, second) {
  const firstRun = query(`begin; ${first} select pg_sleep(0.4); commit;`);
  await delay(100);
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
  const test = await readFile(
    new URL(
      "../supabase/tests/investment_account_moves.test.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const fixture = test
    .split("create temp table main_account")[0]
    .replace("select no_plan();", "");
  await successful(fixture + "commit;");

  oneSuccess(
    await race(move(active, main, `'${school}'`),
      move(active, main, `'${retirement}'`),),
    /investment already moved/,
  );
  assert.equal(
    await successful(
      `select count(*) from public.investment_account_moves where investment_id='${active}';`,
    ),
    "1",
  );
  console.log("PASS: simultaneous moves of one investment apply only once");

  oneSuccess(
    await race(
      `select public.manage_investment_account('${partner}','Retirement',gen_random_uuid(),'${retirement}',true);`,
      move(reserved, main, `'${retirement}'`),
    ),
    /investment account unavailable/,
  );
  assert.equal(
    await successful(
      `select count(*) from public.investments i join public.investment_accounts a on a.id=i.account_id where a.archived_at is not null and i.status in ('reserved','active');`,
    ),
    "0",
  );
  console.log("PASS: archiving and moving in cannot strand live money");

  oneSuccess(
    await race(
      `update public.investments set status='matured' where id='${active}';`,
      move(active, `'${school}'`, main),
    ),
    /investment cannot be moved/,
  );
  // Use the production activation RPC and its auto-cycle profile lock, rather
  // than a direct status UPDATE (which misses the investment/profile deadlock).
  await successful(`
    update public.investment_cycles set opens_at=now()-interval '1 day', closes_at=now()+interval '1 day',
      maturity_date=(date_trunc('month',now()+interval '300 days')+interval '1 month - 1 day')::date, record_origin='portal';
    update public.investments set policy_version='auto_cycle_v1' where id='${reserved}';
    insert into public.investments(id,investor_id,cycle_id,unit_price_ugx,principal_ugx,
      projected_return_bps,projected_return_ugx,projected_value_ugx,maturity_date,
      reservation_expires_at,status,record_origin,policy_version)
    select '${secondReservation}',investor_id,cycle_id,unit_price_ugx,principal_ugx,
      projected_return_bps,projected_return_ugx,projected_value_ugx,maturity_date,
      reservation_expires_at,'reserved',record_origin,policy_version
    from public.investments where id='${reserved}';
  `);
  const activate = (investment) => `select public.activate_investment(
    '11111111-1111-1111-1111-111111111111','${investment}','move-race-${investment}',
    500000,(now() at time zone 'Africa/Kampala')::date,'ACTIVATE',true,gen_random_uuid());`;
  const both = await race(
    // Hold activation's first lock while the move starts, then run the real
    // operation. The old profile-first move deadlocks with this transaction.
    `select id from public.investments where id='${reserved}' for update;
     select pg_sleep(0.4); ${activate(reserved)}`,
    move(reserved, main, `'${school}'`),
  );
  assert.ok(
    both.every((result) => result.code === 0),
    JSON.stringify(both),
  );
  assert.equal(
    await successful(
      `select status || ' ' || account_id from public.investments where id='${reserved}';`,
    ),
    `active ${school}`,
  );
  console.log(
    "PASS: maturity blocks a waiting move; real activation and move both apply",
  );
  assert.equal(await successful(`select investment_account_name from public.investment_receipts where investment_id='${reserved}';`),
    'Main Account');
  const moveFirst = await race(
    move(secondReservation, main, `'${school}'`), activate(secondReservation),
  );
  assert.ok(moveFirst.every((result) => result.code === 0), JSON.stringify(moveFirst));
  assert.equal(await successful(`select status || ' ' || account_id from public.investments where id='${secondReservation}';`),
    `active ${school}`);
  assert.equal(await successful(`select investment_account_name from public.investment_receipts where investment_id='${secondReservation}';`),
    'School Fees');
  console.log('PASS: move before real activation snapshots the destination account in its receipt');
} finally {
  const dropped = await run(["dropdb", "-U", "supabase_admin", database]);
  assert.equal(dropped.code, 0, dropped.output);
}
