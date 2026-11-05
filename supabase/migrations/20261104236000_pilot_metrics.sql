-- Pilot progress for administrators: how invitations turn into claimed profiles,
-- and how many members can actually be reached. Pass a group slug for one cohort.
--
-- "Invited" means a claim link was created. Links are handed out outside the app,
-- so whether one was delivered isn't known here.
create function public.admin_pilot_metrics(p_group_slug text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;

  with cohort as (
    select p.id, p.claimed_by_user_id, p.open_to
      from public.people p
     where p.status <> 'opted_out'
       and (p_group_slug is null
            or exists (select 1 from public.group_memberships gm join public.groups g on g.id = gm.group_id
                        where gm.person_id = p.id and g.slug = p_group_slug))
  ),
  invited as (
    select l.person_id,
           bool_or(l.claimed_at is not null) as claimed,
           bool_or(l.expires_at > now()) as live,
           exists (select 1 from public.claim_requests r where r.person_id = l.person_id and r.status = 'pending') as in_review
      from public.profile_links l
      join cohort c on c.id = l.person_id
     group by l.person_id
  ),
  members as (
    select * from cohort where claimed_by_user_id is not null
  ),
  -- Removal clears person_id, so a removed person can't be placed in a cohort. All
  -- of one person's links share a removed_at, which keeps them to a single count.
  removed as (
    select case when p_group_slug is null
                then (select count(distinct l.removed_at) from public.profile_links l where l.removed_at is not null) end as n
  )
  select jsonb_build_object(
    'invited',       (select count(*) from invited) + coalesce((select n from removed), 0),
    'claimed',       (select count(*) from invited where claimed),
    'in_review',     (select count(*) from invited where not claimed and in_review),
    'waiting',       (select count(*) from invited where not claimed and not in_review and live),
    'expired',       (select count(*) from invited where not claimed and not in_review and not live),
    'removed',       (select n from removed),
    'members',       (select count(*) from members),
    'with_preferences', (select count(*) from members where cardinality(open_to) > 0),
    -- Matches intro_connectors: another member shares a group or a recorded connection.
    'reachable_by_intro', (
      select count(*) from members m
       where exists (select 1 from public.group_memberships a
                       join public.group_memberships b on b.group_id = a.group_id and b.person_id <> a.person_id
                       join public.people c on c.id = b.person_id
                      where a.person_id = m.id and c.claimed_by_user_id is not null and c.status <> 'opted_out')
          or exists (select 1 from public.edges e
                       join public.people c on c.id = case when e.person_a = m.id then e.person_b else e.person_a end
                      where (e.person_a = m.id or e.person_b = m.id) and e.owner_user_id is null
                        and c.claimed_by_user_id is not null and c.status <> 'opted_out')
    )
  ) into result;
  return result;
end;
$$;

revoke all on function public.admin_pilot_metrics(text) from public, anon;
grant execute on function public.admin_pilot_metrics(text) to authenticated;
