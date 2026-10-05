import { spawn, spawnSync } from "node:child_process";
const args = [
  "exec",
  "-i",
  "supabase_db_ourmu-app",
  "psql",
  "-U",
  "postgres",
  "-d",
  "postgres",
  "-v",
  "ON_ERROR_STOP=1",
];
function sql(text) {
  const result = spawnSync("docker", args, { input: text, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
}
function session(text) {
  return new Promise((resolve) => {
    const child = spawn("docker", args);
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      output += data;
    });
    child.on("close", (code) => resolve({ code, output }));
    child.stdin.end(text);
  });
}
const first = "87000000-0000-4000-8000-000000000021";
const second = "87000000-0000-4000-8000-000000000022";
const filler = "87000000-0000-4000-8000-000000000020";
const cleanup = `delete from private.queued_email_reservations where job_id in ('${first}','${second}','${filler}'); delete from public.jobs where id in ('${first}','${second}');`;
try {
  sql(`begin;
    ${cleanup}
    do $$ begin if exists(select 1 from private.queued_email_reservations where reserved_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') then raise exception 'Requires an empty local test budget'; end if; end $$;
    insert into private.queued_email_reservations(delivery_key,job_id,recipients) values ('race-filler','${filler}',79);
    insert into public.jobs(id,kind,entity_type,entity_id,payload,status,claim_token)
      values ('${first}','send_email','test','${filler}','{"to":"a@example.test"}','running','first'),
             ('${second}','send_email','test','${filler}','{"to":"b@example.test"}','running','second');
    commit;`);
  const results = await Promise.all([
    session(
      `begin; update public.jobs set send_attempts=1,first_send_attempt_at=now() where id='${first}' and claim_token='first'; select pg_sleep(2); commit;`,
    ),
    session(
      `begin; update public.jobs set send_attempts=1,first_send_attempt_at=now() where id='${second}' and claim_token='second'; select pg_sleep(2); commit;`,
    ),
  ]);
  if (
    results.filter((r) => r.code === 0).length !== 1 ||
    !results.some((r) => r.output.includes("EMAIL_DAILY_BUDGET_DEFERRED"))
  )
    throw new Error(JSON.stringify(results));
  sql(
    `do $$ begin if (select sum(recipients) from private.queued_email_reservations where reserved_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') <> 80 then raise exception 'Concurrent reservation exceeded 80'; end if; end $$;`,
  );
  console.log(
    "PASS: concurrent workers reserve the final recipient slot once; the other defers.",
  );
} finally {
  sql(cleanup);
}
