-- More ways to find someone who can make an introduction (the "2-hop paths" of
-- docs/ARCHITECTURE.md §10). Before this, a connector had to serve in a group
-- with the recipient or have a recorded connection. Now also:
--   * a member who worked at the same organization as the recipient, and
--   * a member whose imported LinkedIn connections include the recipient,
--     but only if that member chose to let others ask them (off by default:
--     an import is private until its owner says otherwise).

alter table public.members add column share_connections boolean not null default false;

create function public.set_share_connections(p_share boolean) returns void
language sql
security definer
set search_path = public
as $$ update public.members set share_connections = coalesce(p_share, false) where user_id = auth.uid() $$;

create or replace function public.intro_connectors(p_target uuid)
returns table (person_id uuid, full_name text, headline text, photo_url text, shared text)
language sql
stable
security definer
set search_path = public
as $$
  with candidates as (
    select gc.person_id as id, g.name as shared
      from public.group_memberships gc
      join public.group_memberships gt on gt.group_id = gc.group_id and gt.person_id = p_target
      join public.groups g on g.id = gc.group_id
    union all
    select case when e.person_a = p_target then e.person_b else e.person_a end, 'A recorded connection'
      from public.edges e
     where (e.person_a = p_target or e.person_b = p_target) and e.owner_user_id is null
    union all
    select pc.person_id, 'Worked at ' || pt.organization_name
      from public.positions pt
      join public.positions pc
        on pc.person_id <> pt.person_id
       and ((pc.organization_id is not null and pc.organization_id = pt.organization_id)
            or lower(pc.organization_name) = lower(pt.organization_name))
     where pt.person_id = p_target
    union all
    select c.id, 'Connected on LinkedIn'
      from public.my_connections mc
      join public.members m on m.user_id = mc.owner_user_id and m.share_connections
      join public.people c on c.claimed_by_user_id = mc.owner_user_id
     where mc.person_id = p_target
  )
  select c.id, c.full_name, c.headline, c.photo_url, string_agg(distinct cand.shared, ', ')
    from candidates cand
    join public.people c on c.id = cand.id
   where public.is_verified_member()
     and c.claimed_by_user_id is not null
     and c.claimed_by_user_id <> auth.uid()
     and c.id <> p_target
     and c.status <> 'opted_out'
   group by c.id, c.full_name, c.headline, c.photo_url
   order by c.full_name;
$$;

revoke all on function public.set_share_connections(boolean) from public, anon;
grant execute on function public.set_share_connections(boolean) to authenticated;
