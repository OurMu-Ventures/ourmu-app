// Requires the migration applied to the disposable ourmu_partner_limits_test DB.
// Clones it for each run; never writes to the application's local database.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const container = "supabase_db_ourmu-app";
const database = `ourmu_partner_limit_race_${process.pid}`;
const admin = "11111111-1111-1111-1111-111111111111";
const partner = "22222222-2222-2222-2222-222222222222";
const second = "33333333-3333-3333-3333-333333333333";
const cycle = "cccccccc-cccc-cccc-cccc-cccccccccccc";
function run(args, input = "") {
  return new Promise((resolve, reject) => {
    const proc = spawn("docker", ["exec", "-i", container, ...args]);
    let output = "";
    proc.stdout.on("data", (chunk) => { output += chunk; });
    proc.stderr.on("data", (chunk) => { output += chunk; });
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ code, output }));
    proc.stdin.end(input);
  });
}
const query = (sql) => run(["psql", "-U", "postgres", "-d", database, "-At", "-v", "ON_ERROR_STOP=1"], sql);
const limit = (id, value) => `select public.set_partner_investment_limit('${id}', '${admin}', ${value}, 'Concurrency test', gen_random_uuid());`;
const reserve = (id, amount) => `select public.request_investment('${id}', '${cycle}', ${amount}, gen_random_uuid(), 'race-test', '\\x01');`;
async function successful(sql) {
  const result = await query(sql);
  assert.equal(result.code, 0, result.output);
  return result.output;
}
function oneSuccess(results, error) {
  assert.equal(results.filter((r) => r.code === 0).length, 1, JSON.stringify(results));
  assert.match(results.find((r) => r.code !== 0).output, error);
}
const created = await run(["createdb", "-U", "supabase_admin", "-O", "postgres", "-T", "ourmu_partner_limits_test", database]);
assert.equal(created.code, 0, created.output);
try {
  const test = await readFile(new URL("../supabase/tests/partner_investment_limits.test.sql", import.meta.url), "utf8");
  const fixture = test.split("set local role service_role;")[0].replace("select no_plan();", "");
  await successful(fixture + limit(partner, 100000000) + "commit;");
  oneSuccess(await Promise.all([
    query("begin;" + reserve(partner, 60000000) + "select pg_sleep(0.3); commit;"),
    query("begin;" + reserve(partner, 60000000) + "commit;"),
  ]), /investor cycle limit exceeded/);
  assert.equal((await successful(`select sum(principal_ugx)::bigint from public.investments where cycle_id='${cycle}' and status in ('reserved','active');`)).trim(), "60000000");
  console.log("PASS: concurrent partner placements cannot exceed the override");

  await successful(`update public.investments set status='cancelled' where cycle_id='${cycle}';
    insert into auth.users(id,email) values('${second}','race-second@test.local');
    insert into public.profiles(id,legal_name,email) values('${second}','Second Partner','race-second@test.local');
    insert into public.next_of_kin(user_id,legal_name,relationship,phone,address) values('${second}','Kin','Sibling','0700000000','Kampala');
    ${limit(partner, 200000000)} ${limit(second, 200000000)}`);
  oneSuccess(await Promise.all([
    query("begin;" + reserve(partner, 125000000) + "select pg_sleep(0.3); commit;"),
    query("begin;" + reserve(second, 125000000) + "commit;"),
  ]), /cycle capacity exceeded/);
  assert.equal((await successful(`select sum(principal_ugx)::bigint from public.investments where cycle_id='${cycle}' and status in ('reserved','active');`)).trim(), "125000000");
  console.log("PASS: concurrent partners cannot exceed total cycle capacity");

  await successful(`update public.investments set status='cancelled' where cycle_id='${cycle}';`);
  // Establish that the setter holds the profile lock before starting a placement.
  const setter = query(`begin; set application_name='partner-limit-setter-race'; ${limit(partner, "null")} select pg_sleep(1); commit;`);
  let locked = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    const state = await successful("select count(*) from pg_stat_activity where application_name='partner-limit-setter-race' and wait_event='PgSleep';");
    if (state.trim() === "1") { locked = true; break; }
  }
  assert.ok(locked, "setter must hold its lock before reservation starts");
  const reservation = await query(reserve(partner, 60000000));
  assert.equal((await setter).code, 0);
  assert.notEqual(reservation.code, 0);
  assert.match(reservation.output, /within your partner limit/);
  console.log("PASS: placements wait for override changes and use the committed limit");
} finally {
  const dropped = await run(["dropdb", "-U", "supabase_admin", database]);
  assert.equal(dropped.code, 0, dropped.output);
}
