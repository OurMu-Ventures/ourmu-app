alter table public.deposit_slips add column cleanup_attempts integer not null default 0,
 add column last_cleanup_at timestamptz;
create or replace function public.reserve_deposit_slip(p_investor uuid,p_investment uuid,p_mime text,p_bytes integer,p_ceiling bigint)
returns public.deposit_slips language plpgsql set search_path=public as $$
declare r public.deposit_slips; v_id uuid := gen_random_uuid();
begin
 perform pg_advisory_xact_lock(70860211);
 perform 1 from public.investments where id=p_investment and investor_id=p_investor and status='reserved' and record_origin='portal' for update;
 if not found then raise exception 'Reservation unavailable'; end if;
 if (select count(*) from public.deposit_slips where investment_id=p_investment and expires_at>now()
 and (state='ready' or (state='uploading' and created_at>now()-interval '15 minutes'))) >=3 then raise exception 'Three attachments maximum'; end if;
 -- Removed and abandoned slots still reserve capacity until Storage confirms deletion.
 -- Bound churn across ALL reservations belonging to one partner.
 if (select count(*) from public.deposit_slips where investor_id=p_investor and state<>'deleted') >=6 then
 raise exception 'Previous uploads awaiting cleanup. Please try again later'; end if;
 if (select count(*)*2097152 from public.deposit_slips where state<>'deleted')+2097152>least(p_ceiling,209715200) then
 raise exception 'Uploads temporarily full. Investment processing continues'; end if;
 insert into public.deposit_slips(id,investment_id,investor_id,path,mime,bytes)
 values(v_id,p_investment,p_investor,p_investor||'/'||v_id,p_mime,p_bytes) returning * into r;
 return r;
end $$;
-- Atomically claim a batch. Failed attempts rotate behind untouched work; a lease
-- prevents overlapping workers from claiming the same objects immediately again.
create or replace function public.deposit_slip_cleanup_candidates() returns setof public.deposit_slips
language sql set search_path='' as $$
 with candidates as (
 select d.id from public.deposit_slips d join public.investments i on i.id=d.investment_id
 where d.state<>'deleted' and d.created_at<=now()-interval '20 minutes'
 and (d.last_cleanup_at is null or d.last_cleanup_at<=now()-interval '2 minutes')
 and (d.state='deleting' or i.status<>'reserved' or d.expires_at<=now() or (d.state='uploading' and d.created_at<=now()-interval '15 minutes'))
 order by d.last_cleanup_at nulls first,d.created_at,d.id limit 20 for update of d skip locked
 ) update public.deposit_slips d set state='deleting',cleanup_attempts=d.cleanup_attempts+1,last_cleanup_at=now()
 from candidates c where d.id=c.id returning d.*
$$;
