-- Preserve deployed authorization while excluding independently paid records.
do $migration$
declare
  v_name text;
  v_definition text;
  v_updated text;
begin
  foreach v_name in array array['submit_maturity_instruction', 'fulfill_maturity_instruction'] loop
    select pg_get_functiondef(p.oid) into strict v_definition
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_name;
    v_updated := replace(v_definition,
      'v_investment.status <> ''matured''',
      '(v_investment.status <> ''matured'' or v_investment.payout_basis = ''reported_paid'')');
    if v_updated = v_definition then
      raise exception 'Maturity eligibility guard not found in %', v_name;
    end if;
    execute v_updated;
  end loop;
  select pg_get_functiondef('public.run_maintenance(uuid)'::regprocedure) into v_definition;
  v_updated := replace(v_definition, 'where i.status = ''matured''',
    'where i.status = ''matured'' and i.payout_basis <> ''reported_paid''');
  if v_updated = v_definition then
    raise exception 'Automatic maturity eligibility guard not found';
  end if;
  execute v_updated;
end;
$migration$;
