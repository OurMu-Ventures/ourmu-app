// Local-only migration regression: fixtures and DDL roll back together.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261005115634_queue_worker_review_fixes.sql",
    import.meta.url,
  ),
  "utf8",
)
  .replace(/^begin;\s*/i, "")
  .replace(/commit;\s*$/i, "");
const sql = `begin;
drop trigger if exists reserve_queued_email_budget on public.jobs;
drop function if exists private.reserve_queued_email_budget();
drop table if exists private.queued_email_reservations;
insert into public.jobs(id,kind,entity_type,entity_id,payload,status,locked_at)
values
 ('87000000-0000-4000-8000-000000000011','generate_receipt_pdf','test','87000000-0000-4000-8000-000000000000','{}','running',now()-interval '1 hour'),
 ('87000000-0000-4000-8000-000000000012','send_email','test','87000000-0000-4000-8000-000000000000','{"to":"test@example.test"}','running',now()-interval '1 hour'),
 ('87000000-0000-4000-8000-000000000013','send_email','test','87000000-0000-4000-8000-000000000000','{}','running',now()-interval '1 hour');
${migration}
do $$ begin
 if not exists (select 1 from public.jobs where id='87000000-0000-4000-8000-000000000011' and lease_expires_at > now() and claim_token like 'legacy-%') then raise exception 'legacy document not recoverable'; end if;
 if not exists (select 1 from public.jobs where id='87000000-0000-4000-8000-000000000012' and status='dead' and last_error_code='NEEDS_RECONCILIATION') then raise exception 'legacy ambiguous send not quarantined'; end if;
 if not exists (select 1 from public.jobs where id='87000000-0000-4000-8000-000000000013' and status='running' and lease_expires_at > now()) then raise exception 'legacy fanout not recoverable'; end if;
end $$;
rollback;`;
const result = spawnSync(
  "docker",
  [
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
  ],
  { input: sql, encoding: "utf8" },
);
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exit(result.status ?? 1);
