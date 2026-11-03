// Local-only migration regression: fixtures and DDL roll back together.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261103030635_retire_stale_maturity_confirmation_jobs.sql",
    import.meta.url,
  ),
  "utf8",
)
  .replace(/^begin;\s*/i, "")
  .replace(/commit;\s*$/i, "");
const sql = `begin;
drop trigger if exists retire_stale_maturity_confirmation_jobs on public.maturity_instructions;
drop trigger if exists retire_stale_maturity_confirmation_jobs on public.investments;
drop function if exists private.retire_stale_maturity_confirmation_jobs();
drop function if exists private.is_stale_maturity_confirmation(public.jobs);
insert into auth.users(id,email) values
 ('5e000000-0000-4000-8000-000000000001','cleanup-admin@test.local'),
 ('5e000000-0000-4000-8000-000000000002','cleanup-partner@test.local');
insert into public.profiles(id,role,access_status,legal_name,email,phone,kyc_status) values
 ('5e000000-0000-4000-8000-000000000001','admin','active','Cleanup Admin','cleanup-admin@test.local','+256700000701','verified'),
 ('5e000000-0000-4000-8000-000000000002','investor','active','Cleanup Partner','cleanup-partner@test.local','+256700000702','verified');
insert into public.agreement_versions(id,version,title,template_markdown,content_hash,is_legally_approved,approved_by,approved_at,published_at)
values('5e000000-0000-4000-8000-000000000003','stale-cleanup-test','Test Agreement','Test terms',repeat('d',64),true,'5e000000-0000-4000-8000-000000000001',now(),now());
insert into public.investment_cycles(id,name,opens_at,closes_at,maturity_date,capacity_ugx,unit_price_ugx,projected_return_bps,status,agreement_version_id,created_by,record_origin)
values('5e000000-0000-4000-8000-000000000004','Stale Cleanup Cycle','2026-01-05 00:00+03','2026-01-20 00:00+03','2026-07-31',200000000,125000,3000,'closed','5e000000-0000-4000-8000-000000000003','5e000000-0000-4000-8000-000000000001','portal');
insert into public.payout_destinations(id,investor_id,channel,provider_label,account_name,account_ref_ciphertext,account_ref_iv,account_ref_auth_tag,account_ref_fingerprint,account_last_four,key_version)
values('5e000000-0000-4000-8000-000000000005','5e000000-0000-4000-8000-000000000002','bank','Test Bank','Cleanup Partner','\\x01','\\x02','\\x03','\\x04','0702',1);
-- Investment 1 keeps its live request, 2 is fulfilled, 3 is reported paid.
insert into public.investments(id,investor_id,cycle_id,principal_ugx,unit_price_ugx,projected_return_bps,projected_return_ugx,projected_value_ugx,maturity_date,status,record_origin)
select ('5e000000-0000-4000-8000-00000000001'||n)::uuid,'5e000000-0000-4000-8000-000000000002','5e000000-0000-4000-8000-000000000004',1000000,125000,3000,300000,1300000,'2026-07-31','matured','portal'
from generate_series(1,3) n;
insert into public.maturity_instructions(id,investment_id,investor_id,choice,status,projected_payout_ugx,projected_reinvest_ugx,payout_destination_id,request_id)
select ('5e000000-0000-4000-8000-00000000002'||n)::uuid,('5e000000-0000-4000-8000-00000000001'||n)::uuid,'5e000000-0000-4000-8000-000000000002','withdraw_all','requested',1300000,0,'5e000000-0000-4000-8000-000000000005',gen_random_uuid()
from generate_series(1,3) n;
update public.maturity_instructions set status='fulfilled', actual_roi_ugx=300000,
  actual_payout_ugx=1300000, actual_reinvest_ugx=0, fulfilled_at=now()
where id='5e000000-0000-4000-8000-000000000022';
alter table public.investments disable trigger investment_immutable_guard;
update public.investments set payout_basis='reported_paid', reported_return_ugx=projected_return_ugx,
  reported_payout_ugx=projected_value_ugx
where id='5e000000-0000-4000-8000-000000000013';
alter table public.investments enable trigger investment_immutable_guard;
-- Rows that went stale while queued, before the retirement triggers.
alter table public.jobs disable trigger guard_stale_maturity_confirmation_job;
insert into public.jobs(id,kind,entity_type,entity_id,payload,status,claim_token,lease_expires_at,locked_at,last_error_code) values
 ('5e000000-0000-4000-8000-000000000031','send_email','investment','5e000000-0000-4000-8000-000000000012','{"template":"maturity_choice_confirmed"}','pending',null,null,null,null),
 ('5e000000-0000-4000-8000-000000000032','send_email','investment','5e000000-0000-4000-8000-000000000012','{"template":"maturity_choice_confirmed"}','failed','failed-owner',now()+interval '5 minutes',now(),'EMAIL_DELIVERY_FAILED'),
 ('5e000000-0000-4000-8000-000000000033','send_email','investment','5e000000-0000-4000-8000-000000000012','{"template":"maturity_choice_confirmed"}','running','lost-owner',now()-interval '1 minute',now()-interval '6 minutes',null),
 ('5e000000-0000-4000-8000-000000000034','send_email','investment','5e000000-0000-4000-8000-000000000012','{"template":"maturity_choice_confirmed"}','running',null,null,now()-interval '30 days',null),
 ('5e000000-0000-4000-8000-000000000035','send_email','investment','5e000000-0000-4000-8000-000000000012','{"template":"maturity_choice_confirmed"}','running','live-owner',now()+interval '5 minutes',now(),null),
 ('5e000000-0000-4000-8000-000000000036','send_email','investment','5e000000-0000-4000-8000-000000000012','{"template":"maturity_notice"}','pending',null,null,null,null),
 ('5e000000-0000-4000-8000-000000000037','generate_agreement_pdf','investment','5e000000-0000-4000-8000-000000000012','{}','pending',null,null,null,null),
 ('5e000000-0000-4000-8000-000000000038','send_email','investment','5e000000-0000-4000-8000-000000000012','{"template":"maturity_choice_confirmed"}','dead',null,null,null,'EMAIL_DELIVERY_FAILED'),
 ('5e000000-0000-4000-8000-000000000039','send_email','investment','5e000000-0000-4000-8000-000000000011','{"template":"maturity_choice_confirmed"}','pending',null,null,null,null),
 ('5e000000-0000-4000-8000-000000000040','send_email','investment','5e000000-0000-4000-8000-000000000013','{"template":"maturity_choice_confirmed"}','pending',null,null,null,null);
alter table public.jobs enable trigger guard_stale_maturity_confirmation_job;
${migration}
do $$ begin
 if (select count(*) from public.jobs where id in ('5e000000-0000-4000-8000-000000000031','5e000000-0000-4000-8000-000000000032','5e000000-0000-4000-8000-000000000033','5e000000-0000-4000-8000-000000000040') and status='dead' and last_error_code='STALE_MATURITY_CONFIRMATION_CANCELLED' and claim_token is null and lease_expires_at is null and locked_at is null) <> 4 then raise exception 'stale queued or lapsed confirmations not retired'; end if;
 if not exists (select 1 from public.jobs where id='5e000000-0000-4000-8000-000000000034' and status='dead' and last_error_code='STALE_MATURITY_CONFIRMATION_CANCELLED' and locked_at is null) then raise exception 'pre-lease running confirmation not retired'; end if;
 if not exists (select 1 from public.jobs where id='5e000000-0000-4000-8000-000000000035' and status='running' and claim_token='live-owner') then raise exception 'live lease retired'; end if;
 if (select count(*) from public.jobs where id in ('5e000000-0000-4000-8000-000000000036','5e000000-0000-4000-8000-000000000037','5e000000-0000-4000-8000-000000000039') and status='pending') <> 3 then raise exception 'unrelated or live jobs retired'; end if;
 if not exists (select 1 from public.jobs where id='5e000000-0000-4000-8000-000000000038' and last_error_code='EMAIL_DELIVERY_FAILED') then raise exception 'dead job rewritten'; end if;
 if (select count(*) from public.audit_events where action='email.stale_maturity_confirmation_cancelled' and entity_id in ('5e000000-0000-4000-8000-000000000031','5e000000-0000-4000-8000-000000000032','5e000000-0000-4000-8000-000000000033','5e000000-0000-4000-8000-000000000034','5e000000-0000-4000-8000-000000000040')) <> 5 then raise exception 'retirements not audited'; end if;
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
