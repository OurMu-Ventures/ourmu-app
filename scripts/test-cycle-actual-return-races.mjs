// Concurrency checks for cycle-wide actual returns. Clones the local schema
// (with migrations applied) into a disposable database for each run; never
// writes to the application's local database.
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const container = "supabase_db_ourmu-app";
const database = `ourmu_actual_return_race_${process.pid}`;
const admin = "cb000000-0000-4000-8000-000000000001";
const partner = "cb000000-0000-4000-8000-000000000002";
const agreement = "cb000000-0000-4000-8000-000000000010";
const destination = "cb000000-0000-4000-8000-000000000020";
const futureCycle = "cb000000-0000-4000-8000-000000000102";
const pastCycle = "cb000000-0000-4000-8000-000000000104";
const futureInvestment = "cb000000-0000-4000-8000-000000000201";
const pastInvestment = "cb000000-0000-4000-8000-000000000210";

function run(args, input = "", options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn("docker", ["exec", "-i", container, ...args]);
    let output = "";
    if (options.pipeFrom) options.pipeFrom.stdout.pipe(proc.stdin);
    proc.stdout.on("data", (chunk) => { output += chunk; });
    proc.stderr.on("data", (chunk) => { output += chunk; });
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ code, output }));
    if (!options.pipeFrom) proc.stdin.end(input);
  });
}
const query = (sql) => run(["psql", "-U", "postgres", "-d", database, "-At", "-v", "ON_ERROR_STOP=1"], sql);
async function successful(sql) {
  const result = await query(sql);
  assert.equal(result.code, 0, result.output);
  return result.output;
}
async function waitForSleep(name) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const state = await successful(`select count(*) from pg_stat_activity where application_name='${name}' and wait_event='PgSleep';`);
    if (state.trim() === "1") return;
  }
  assert.fail(`${name} must hold its lock before the competing call starts`);
}
const preview = (cycle, bps) =>
  `public.preview_cycle_actual_return('${admin}', true, '${cycle}', ${bps})`;
const record = (cycle, bps, revision) =>
  `select public.record_cycle_actual_return('${admin}', true, '${cycle}', ${bps}, ${revision},
    (${preview(cycle, bps)}->>'investment_count')::bigint,
    (${preview(cycle, bps)}->>'principal_ugx')::numeric, true, gen_random_uuid());`;

const created = await run(["createdb", "-U", "supabase_admin", "-O", "postgres", "-T", "template0", database]);
assert.equal(created.code, 0, created.output);
try {
  const dump = spawn("docker", ["exec", container, "pg_dump", "-U", "supabase_admin", "-d", "postgres",
    "--schema=public", "--schema=private", "--schema=auth", "--schema=extensions",
    "--no-publications", "--no-subscriptions"]);
  const restored = await run(["psql", "-U", "supabase_admin", "-d", database, "-q"], "", { pipeFrom: dump });
  assert.equal(restored.code, 0, restored.output);
  assert.equal((await successful("select count(*) from pg_proc where proname='record_cycle_actual_return';")).trim(), "1",
    "apply the cycle actual returns migration locally first");

  await successful(`
    insert into auth.users(id,email) values ('${admin}','race-admin@test.local'),('${partner}','race-partner@test.local');
    insert into public.profiles(id,role,access_status,legal_name,email,phone,kyc_status) values
      ('${admin}','admin','active','Race Admin','race-admin@test.local','+256700000401','verified'),
      ('${partner}','investor','active','Race Partner','race-partner@test.local','+256700000402','verified');
    insert into public.agreement_versions(id,version,title,template_markdown,content_hash,is_legally_approved,approved_by,approved_at,published_at)
      values('${agreement}','race','Race Agreement','Terms',repeat('d',64),true,'${admin}',now(),now());
    insert into public.payout_destinations(id,investor_id,channel,provider_label,account_name,account_ref_ciphertext,account_ref_iv,account_ref_auth_tag,account_ref_fingerprint,account_last_four,key_version)
      values('${destination}','${partner}','bank','Race Bank','Race Partner','\\x01','\\x02','\\x03','\\x04','0402',1);
    insert into public.investment_cycles(id,name,opens_at,closes_at,maturity_date,capacity_ugx,unit_price_ugx,projected_return_bps,status,agreement_version_id,created_by,record_origin) values
      ('${futureCycle}','Race Future',now()-interval '200 days',now()-interval '190 days',(date_trunc('month',now()+interval '2 months')+interval '1 month - 1 day')::date,500000000,125000,3000,'closed','${agreement}','${admin}','portal'),
      ('${pastCycle}','Race Past',now()-interval '300 days',now()-interval '290 days',(date_trunc('month',current_date-interval '1 month')-interval '1 day')::date,500000000,125000,3000,'closed','${agreement}','${admin}','portal');
    insert into public.investments(id,investor_id,cycle_id,unit_price_ugx,principal_ugx,projected_return_bps,projected_return_ugx,projected_value_ugx,maturity_date,status,record_origin,activated_at,matured_at)
    select '${futureInvestment}'::uuid,'${partner}'::uuid,id,125000,1000000,3000,300000,1300000,maturity_date,'active'::public.investment_status,'portal'::public.record_origin,now()-interval '100 days',null::timestamptz from public.investment_cycles where id='${futureCycle}'
    union all
    select '${pastInvestment}'::uuid,'${partner}'::uuid,id,125000,1000000,3000,300000,1300000,maturity_date,'matured','portal',now()-interval '250 days',now()-interval '20 days' from public.investment_cycles where id='${pastCycle}';
    select public.submit_maturity_instruction('${partner}','${pastInvestment}','withdraw_all',null,'${destination}',false,true,gen_random_uuid(),'race','\\x05');
    select public.begin_maturity_instruction_processing('${admin}',(select id from public.maturity_instructions where investment_id='${pastInvestment}'),true,gen_random_uuid());`);

  // Two administrators save from the same loaded revision.
  const first = query(`begin; set application_name='actual-return-save-race'; ${record(futureCycle, 2735, 0)} select pg_sleep(1); commit;`);
  await waitForSleep("actual-return-save-race");
  const second = await query(record(futureCycle, 2900, 0));
  assert.equal((await first).code, 0, "first save commits");
  assert.notEqual(second.code, 0, "second save from the stale revision fails");
  assert.match(second.output, /changed since you loaded this page/);
  assert.equal((await successful(`select actual_return_bps||'/'||actual_return_revision from public.investment_cycles where id='${futureCycle}';`)).trim(), "2735/1");
  console.log("PASS: concurrent saves from one revision cannot overwrite each other");

  // Fulfillment waits for an in-flight late entry and uses the committed rate.
  const lateEntry = query(`begin; set application_name='actual-return-fulfill-race'; ${record(pastCycle, 2500, 0)} select pg_sleep(1); commit;`);
  await waitForSleep("actual-return-fulfill-race");
  const fulfillment = await successful(`select public.fulfill_maturity_instruction('${admin}',
    (select id from public.maturity_instructions where investment_id='${pastInvestment}'),null,'RACE-REF','FULFILL',true,gen_random_uuid(),true);`);
  assert.equal((await lateEntry).code, 0, "late entry commits");
  const outcome = JSON.parse(fulfillment.trim());
  assert.equal(outcome.pending_partner_confirmation, true, fulfillment);
  assert.equal(Number(outcome.proposed_actual_roi_ugx), 250000, "fulfillment used the committed cycle rate");
  console.log("PASS: fulfillment serializes behind a late entry and settles on the committed rate");
} finally {
  const dropped = await run(["dropdb", "-U", "supabase_admin", database]);
  assert.equal(dropped.code, 0, dropped.output);
}
