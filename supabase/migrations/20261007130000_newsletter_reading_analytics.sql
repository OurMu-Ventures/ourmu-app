begin;

-- Browser sessions submit events through authenticated Server Actions only.
create table public.newsletter_visits (
  partner_id uuid not null references public.profiles(id) on delete cascade,
  newsletter_slug text not null check (newsletter_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  visit_id uuid not null,
  opened_at timestamptz not null default clock_timestamp(),
  reached_end_at timestamptz,
  primary key (partner_id, newsletter_slug, visit_id),
  check (reached_end_at is null or reached_end_at >= opened_at + interval '30 seconds')
);
create index newsletter_visits_issue_idx on public.newsletter_visits(newsletter_slug, partner_id);
alter table public.newsletter_visits enable row level security;
revoke all on public.newsletter_visits from public, anon, authenticated;
grant select, insert, update, delete on public.newsletter_visits to service_role;

create function public.record_newsletter_visit(
  p_partner_id uuid, p_newsletter_slug text, p_visit_id uuid, p_event text
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare affected integer;
begin
  if p_event not in ('opened', 'reached_end') or p_event is null then
    raise exception 'Invalid newsletter event';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_partner_id and role = 'investor' and access_status = 'active' and not is_test
  ) then return false; end if;

  if p_event = 'opened' then
    insert into public.newsletter_visits(partner_id, newsletter_slug, visit_id)
      values (p_partner_id, p_newsletter_slug, p_visit_id)
      on conflict do nothing;
    return true;
  end if;

  update public.newsletter_visits
  set reached_end_at = coalesce(reached_end_at, clock_timestamp())
  where partner_id = p_partner_id and newsletter_slug = p_newsletter_slug and visit_id = p_visit_id
    and opened_at <= clock_timestamp() - interval '30 seconds';
  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

-- A single JSON result avoids the API row cap silently truncating partner counts.
-- The audience is current active, non-test partners, even for older issues.
create function public.newsletter_reading_report(p_slugs text[])
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(report) order by report.newsletter_slug, report.legal_name, report.partner_id), '[]'::jsonb)
  from (
    select issue.slug as newsletter_slug, p.id as partner_id, p.legal_name,
      count(v.visit_id)::integer as opens,
      min(v.opened_at) as first_opened_at,
      max(v.opened_at) as last_opened_at,
      max(v.reached_end_at) as reached_end_at
    from public.profiles p
    cross join (select distinct unnest(p_slugs) as slug) issue
    left join public.newsletter_visits v on v.partner_id = p.id and v.newsletter_slug = issue.slug
    where p.role = 'investor' and p.access_status = 'active' and not p.is_test
    group by issue.slug, p.id, p.legal_name
  ) report;
$$;

revoke all on function public.record_newsletter_visit(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.newsletter_reading_report(text[]) from public, anon, authenticated;
grant execute on function public.record_newsletter_visit(uuid, text, uuid, text) to service_role;
grant execute on function public.newsletter_reading_report(text[]) to service_role;

commit;
