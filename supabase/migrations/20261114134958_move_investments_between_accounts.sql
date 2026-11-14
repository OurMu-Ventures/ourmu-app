begin;

-- Partners may move a whole reserved or active investment between their own
-- open accounts. The investment keeps its ID, terms and issued documents;
-- only account_id changes, through one audited database operation.
create table public.investment_account_moves (
  id uuid primary key default gen_random_uuid(),
  investment_id uuid not null references public.investments(id) on delete restrict,
  investor_id uuid not null references public.profiles(id) on delete restrict,
  from_account_id uuid not null,
  to_account_id uuid not null,
  request_id uuid not null unique,
  moved_at timestamptz not null default now(),
  foreign key (from_account_id, investor_id) references public.investment_accounts(id, investor_id) on delete restrict,
  foreign key (to_account_id, investor_id) references public.investment_accounts(id, investor_id) on delete restrict,
  check (from_account_id <> to_account_id)
);
create index investment_account_moves_investment_idx on public.investment_account_moves(investment_id, moved_at desc);
alter table public.investment_account_moves enable row level security;
create policy account_moves_self_read on public.investment_account_moves for select to authenticated using (investor_id = (select auth.uid()));
create policy account_moves_admin_read on public.investment_account_moves for select to authenticated using (private.is_admin());
grant select on public.investment_account_moves to authenticated;
grant all on public.investment_account_moves to service_role;

-- Direct updates still cannot reassign an investment; only the move operation
-- below opens this transaction-local gate for the one investment it moves.
create or replace function private.assign_investment_account() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if TG_OP = 'UPDATE' and old.account_id is not null and new.account_id is distinct from old.account_id
    and current_setting('ourmu.moving_investment', true) is distinct from new.id::text then
    raise exception using errcode = '23514', message = 'investment account cannot be changed';
  end if;
  if new.investor_id is not null and new.account_id is null then
    select id into new.account_id from public.investment_accounts where investor_id = new.investor_id and is_default;
  end if;
  if TG_OP = 'INSERT' or new.account_id is distinct from old.account_id then
    if new.account_id is not null then
      perform 1 from public.investment_accounts where id = new.account_id and investor_id = new.investor_id and archived_at is null for update;
      if not found then raise exception using errcode = '42501', message = 'investment account unavailable'; end if;
    end if;
  end if;
  return new;
end;
$$;

-- Lock investment, then profile, then destination account. Activation also
-- locks investment before profile; account management locks profile before
-- account and only reads investments, so it introduces no reverse row lock.
create function public.move_investment_account(
  p_investor_id uuid,
  p_investment_id uuid,
  p_expected_account_id uuid,
  p_to_account_id uuid,
  p_request_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_existing public.investment_account_moves;
  v_investment public.investments;
begin
  select * into v_investment from public.investments where id = p_investment_id and investor_id = p_investor_id for update;
  if not found then raise exception using errcode = '42501', message = 'investment unavailable'; end if;

  perform 1 from public.profiles where id = p_investor_id and access_status = 'active' for update;
  if not found then raise exception using errcode = '42501', message = 'partner unavailable'; end if;

  -- A retried request returns its original result instead of moving twice.
  select * into v_existing from public.investment_account_moves where request_id = p_request_id;
  if found then
    if v_existing.investor_id <> p_investor_id or v_existing.investment_id <> p_investment_id
      or v_existing.to_account_id <> p_to_account_id then
      raise exception using errcode = '23505', message = 'request already used';
    end if;
    return jsonb_build_object('move_id', v_existing.id, 'investment_id', v_existing.investment_id,
      'from_account_id', v_existing.from_account_id, 'to_account_id', v_existing.to_account_id, 'replayed', true);
  end if;

  if v_investment.account_id is distinct from p_expected_account_id then
    raise exception using errcode = '23514', message = 'investment already moved';
  end if;
  if v_investment.status not in ('reserved', 'active') then
    raise exception using errcode = '55000', message = 'investment cannot be moved';
  end if;
  if p_to_account_id = v_investment.account_id then
    raise exception using errcode = '23514', message = 'investment already in account';
  end if;
  perform 1 from public.investment_accounts where id = p_to_account_id and investor_id = p_investor_id and archived_at is null for update;
  if not found then raise exception using errcode = '42501', message = 'investment account unavailable'; end if;

  perform set_config('ourmu.moving_investment', p_investment_id::text, true);
  update public.investments set account_id = p_to_account_id where id = p_investment_id;
  perform set_config('ourmu.moving_investment', '', true);

  insert into public.investment_account_moves(investment_id, investor_id, from_account_id, to_account_id, request_id)
    values (p_investment_id, p_investor_id, v_investment.account_id, p_to_account_id, p_request_id)
    returning * into v_existing;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, request_id, metadata)
    values (p_investor_id, 'investment.account_moved', 'investment', p_investment_id, p_request_id,
      jsonb_build_object('from_account_id', v_investment.account_id, 'to_account_id', p_to_account_id,
        'status', v_investment.status));
  return jsonb_build_object('move_id', v_existing.id, 'investment_id', p_investment_id,
    'from_account_id', v_investment.account_id, 'to_account_id', p_to_account_id, 'replayed', false);
end;
$$;
revoke all on function public.move_investment_account(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.move_investment_account(uuid, uuid, uuid, uuid, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
