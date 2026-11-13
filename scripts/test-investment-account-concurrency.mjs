// Clone an explicitly supplied disposable schema database; never mutate the source.
// OURMU_TEST_CONTAINER=... OURMU_TEST_TEMPLATE_DB=... node scripts/test-investment-account-concurrency.mjs
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const container = process.env.OURMU_TEST_CONTAINER;
const template = process.env.OURMU_TEST_TEMPLATE_DB;
assert.ok(
  container && template,
  "Provide a disposable test container and template database",
);
const database = `ourmu_account_race_${process.pid}`;
const partner = "22222222-2222-2222-2222-222222222222";
const school = "12345678-1234-4234-8234-123456789012";
const cycle = "cccccccc-cccc-cccc-cccc-cccccccccccc";
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
const reserve = (account, amount) =>
  `select public.request_account_investment(${account},'${partner}','${cycle}',${amount},gen_random_uuid(),'account-race','\\x01');`;
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
    new URL("../supabase/tests/investment_accounts.test.sql", import.meta.url),
    "utf8",
  );
  const fixture = test
    .split("select is((select count(*)::int from public.investment_accounts")[0]
    .replace("select no_plan();", "");
  await successful(fixture + "commit;");
  const main = `(select id from public.investment_accounts where investor_id='${partner}' and is_default)`;
  oneSuccess(
    await Promise.all([
      query(
        "begin;" +
          reserve(`'${school}'`, 30000000) +
          "select pg_sleep(0.3);commit;",
      ),
      query("begin;" + reserve(main, 30000000) + "commit;"),
    ]),
    /investor cycle limit exceeded/,
  );
  assert.equal(
    await successful(
      `select sum(principal_ugx)::bigint from public.investments where cycle_id='${cycle}' and status in ('reserved','active');`,
    ),
    "30000000",
  );
  console.log(
    "PASS: simultaneous reservations in separate accounts share the partner cap",
  );

  const empty = await successful(
    `select public.manage_investment_account('${partner}','Archive race',gen_random_uuid());`,
  );
  oneSuccess(
    await Promise.all([
      query(
        `begin; select public.manage_investment_account('${partner}','Archive race',gen_random_uuid(),'${empty}',true); select pg_sleep(0.3); commit;`,
      ),
      query("begin;" + reserve(`'${empty}'`, 125000) + "commit;"),
    ]),
    /investment account unavailable|account has outstanding investments/,
  );
  assert.equal(
    await successful(
      `select count(*) from public.investments i join public.investment_accounts a on a.id=i.account_id where a.archived_at is not null and i.status in ('reserved','active');`,
    ),
    "0",
  );
  console.log(
    "PASS: archiving and reservation serialize without orphaning live money",
  );
} finally {
  const dropped = await run(["dropdb", "-U", "supabase_admin", database]);
  assert.equal(dropped.code, 0, dropped.output);
}
