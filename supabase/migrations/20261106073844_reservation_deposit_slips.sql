create table public.deposit_slips (
 id uuid primary key default gen_random_uuid(),
 investment_id uuid not null references public.investments(id),
 investor_id uuid not null references public.profiles(id),
 path text not null unique,
 mime text not null check (mime in ('image/jpeg','image/png','image/webp','application/pdf')),
 bytes integer not null check (bytes between 1 and 2097152),
 state text not null default 'uploading' check (state in ('uploading','ready','deleting','deleted')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now() + interval '30 days'
);
alter table public.deposit_slips enable row level security;
grant select on public.deposit_slips to authenticated;
grant all on public.deposit_slips to service_role;
create policy deposit_slip_owner on public.deposit_slips for select to authenticated using (
 investor_id = (select auth.uid()) and exists (select 1 from public.investments i where i.id=investment_id and i.status='reserved')
 and state='ready' and expires_at>now()
);
create index deposit_slips_cleanup on public.deposit_slips(state, created_at);

create function public.reserve_deposit_slip(p_investor uuid,p_investment uuid,p_mime text,p_bytes integer,p_ceiling bigint)
returns public.deposit_slips language plpgsql set search_path=public as $$
declare r public.deposit_slips; v_id uuid := gen_random_uuid();
begin
 perform pg_advisory_xact_lock(70860211);
 perform 1 from public.investments where id=p_investment and investor_id=p_investor and status='reserved' and record_origin='portal' for update;
 if not found then raise exception 'Reservation unavailable'; end if;
 if (select count(*) from public.deposit_slips where investment_id=p_investment and state in ('uploading','ready') and expires_at>now()) >=3 then raise exception 'Three attachments maximum'; end if;
 if (select coalesce(count(*)*2097152,0) from public.deposit_slips where state<>'deleted') + 2097152 > least(p_ceiling,209715200) then raise exception 'Uploads temporarily full. Investment processing continues'; end if;
 insert into public.deposit_slips(id,investment_id,investor_id,path,mime,bytes)
 values(v_id,p_investment,p_investor,p_investor||'/'||v_id,p_mime,p_bytes) returning * into r;
 return r;
end $$;
create function public.finalize_deposit_slip(p_id uuid,p_investor uuid) returns boolean language plpgsql set search_path=public as $$
begin
 perform 1 from public.investments i join public.deposit_slips d on d.investment_id=i.id
 where d.id=p_id and d.investor_id=p_investor and i.status='reserved' for update of i;
 if not found then return false; end if;
 update public.deposit_slips set state='ready' where id=p_id and investor_id=p_investor and state='uploading' and created_at>now()-interval '15 minutes';
 return found;
end $$;
revoke all on function public.reserve_deposit_slip(uuid,uuid,text,integer,bigint), public.finalize_deposit_slip(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_deposit_slip(uuid,uuid,text,integer,bigint), public.finalize_deposit_slip(uuid,uuid) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('deposit-slips','deposit-slips',false,2097152,array['image/jpeg','image/png','image/webp','application/pdf']);
-- The helper exposes only a boolean, and reads metadata hidden by the ready-only SELECT policy.
create function public.can_upload_deposit_slip(p_path text) returns boolean language sql security definer set search_path='' as $$
 select exists(select 1 from public.deposit_slips d join public.investments i on i.id=d.investment_id
 join public.profiles p on p.id=d.investor_id
 where d.path=p_path and d.investor_id=(select auth.uid()) and p.access_status='active'
 and i.status='reserved' and d.state='uploading' and d.created_at>now()-interval '15 minutes')
$$;
revoke all on function public.can_upload_deposit_slip(text) from public,anon;
grant execute on function public.can_upload_deposit_slip(text) to authenticated;
create policy deposit_slip_insert on storage.objects for insert to authenticated
with check(bucket_id='deposit-slips' and public.can_upload_deposit_slip(name));
create function public.deposit_slip_cleanup_candidates() returns setof public.deposit_slips language sql set search_path='' as $$
 select d.* from public.deposit_slips d join public.investments i on i.id=d.investment_id
 where d.state<>'deleted' and (d.state='deleting' or i.status<>'reserved' or d.expires_at<=now() or (d.state='uploading' and d.created_at<=now()-interval '15 minutes'))
 order by d.created_at limit 20
$$;
revoke all on function public.deposit_slip_cleanup_candidates() from public,anon,authenticated;
grant execute on function public.deposit_slip_cleanup_candidates() to service_role;
create function public.deposit_slip_orphan_paths() returns table(path text) language sql set search_path='' as $$
 select o.name from storage.objects o left join public.deposit_slips d on d.path=o.name
 where o.bucket_id='deposit-slips' and (d.id is null or d.state='deleted') and o.created_at<now()-interval '20 minutes'
 order by o.created_at limit 20
$$;
revoke all on function public.deposit_slip_orphan_paths() from public,anon,authenticated;
grant execute on function public.deposit_slip_orphan_paths() to service_role;
