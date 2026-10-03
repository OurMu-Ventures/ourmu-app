begin;

comment on column public.investments.reservation_expires_at is
  'Historical automatic-expiry deadline on legacy resolved reservations, or the time an administrator manually expired a reservation. NULL on pending reservations; pending reservations never expire automatically. Do not use this column as a payment deadline.';

create or replace function public.expire_investment(
  p_admin_id uuid, p_investment_id uuid, p_confirmation text,
  p_admin_aal2 boolean, p_request_id uuid
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_investment public.investments%rowtype;
begin
  if not private.is_admin(p_admin_id) or p_admin_aal2 is distinct from true then
    raise exception using errcode = '42501', message = 'active administrator AAL2 required';
  end if;
  if p_confirmation is distinct from 'EXPIRE' then
    raise exception using errcode = '22023', message = 'typed confirmation is invalid';
  end if;
  update public.investments set status = 'expired', reservation_expires_at = now()
  where id = p_investment_id and status = 'reserved' and record_origin = 'portal'
  returning * into v_investment;
  if not found then
    raise exception using errcode = '23514', message = 'only a pending reservation can be expired';
  end if;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, request_id, metadata)
  values(p_admin_id, 'investment.expired', 'investment', p_investment_id, p_request_id,
    jsonb_build_object('cycle_id', v_investment.cycle_id, 'principal_ugx', v_investment.principal_ugx));
end;
$$;
revoke all on function public.expire_investment(uuid, uuid, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.expire_investment(uuid, uuid, text, boolean, uuid) to service_role;

commit;
