begin;

-- The 13-argument submit signature ships with default PUBLIC execute;
-- restrict it to service_role like every other partner RPC.
revoke all on function public.submit_maturity_instruction(uuid,uuid,public.maturity_choice,uuid,uuid,boolean,boolean,uuid,text,bytea,numeric,boolean,uuid)
  from public, anon, authenticated;
grant execute on function public.submit_maturity_instruction(uuid,uuid,public.maturity_choice,uuid,uuid,boolean,boolean,uuid,text,bytea,numeric,boolean,uuid)
  to service_role;

notify pgrst, 'reload schema';
commit;
