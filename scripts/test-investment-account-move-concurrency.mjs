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
    ["psql", "-U", "postgres", "-d", database, "-At", "-v", "ON_ERROR_STOP=1"],
    sql,
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
  const both = await race(
    `update public.investments set status='active' where id='${reserved}';`,
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
    "PASS: maturity blocks a waiting move; activation and move both apply in order",
  );
} finally {
  const dropped = await run(["dropdb", "-U", "supabase_admin", database]);
  assert.equal(dropped.code, 0, dropped.output);
}
