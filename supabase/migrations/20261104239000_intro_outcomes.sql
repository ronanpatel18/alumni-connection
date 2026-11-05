-- What came of an introduction. Either person introduced can record that they
-- met, as one more entry in the append-only consent log. Administrators see
-- totals only: no one's individual decisions or meetings.

alter table public.intro_events
  drop constraint intro_events_action_check,
  add constraint intro_events_action_check
    check (action in ('requested', 'agreed', 'declined', 'accepted', 'cancelled', 'expired', 'met'));

create function public.record_intro_meeting(p_intro uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.intro_requests;
  my_role text;
  other_person uuid;
begin
  select * into r from public.intro_requests where id = p_intro for update;
  if found and r.requester_user_id = auth.uid() then
    my_role := 'requester';
    other_person := r.target_person_id;
  elsif found and r.target_person_id = public.my_person_id() then
    my_role := 'recipient';
    select person_id into other_person from public.members where user_id = r.requester_user_id;
  else
    raise exception 'This introduction isn''t yours to update' using errcode = '42501';
  end if;
  if r.status <> 'accepted' then
    raise exception 'Only a completed introduction can lead to a meeting' using errcode = '22023';
  end if;
  if exists (select 1 from public.intro_events e where e.intro_id = r.id and e.action = 'met' and e.actor_user_id = auth.uid()) then
    return 'already_recorded';
  end if;

  insert into public.intro_events (intro_id, actor_user_id, role, action) values (r.id, auth.uid(), my_role, 'met');
  if other_person is not null then
    insert into public.interactions (owner_user_id, person_id, kind, occurred_at, summary)
    values (auth.uid(), other_person, 'meeting', now(), 'Met after a warm introduction.');
  end if;
  return 'recorded';
end;
$$;

-- p_group_slug limits to introductions to people in one group. Email totals
-- cover the whole outbox, since a notification isn't tied to a cohort.
create function public.admin_intro_metrics(p_group_slug text default null)
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

  with intros as (
    select r.id,
           -- Requests expire lazily, so one past its date may not say so yet.
           case when r.status in ('pending_connector', 'pending_target') and r.expires_at < now() then 'expired' else r.status end as state
      from public.intro_requests r
     where p_group_slug is null
        or exists (select 1 from public.group_memberships gm join public.groups g on g.id = gm.group_id
                    where gm.person_id = r.target_person_id and g.slug = p_group_slug)
  )
  select jsonb_build_object(
    'requested',          (select count(*) from intros),
    'awaiting_connector', (select count(*) from intros where state = 'pending_connector'),
    'awaiting_recipient', (select count(*) from intros where state = 'pending_target'),
    'accepted',           (select count(*) from intros where state = 'accepted'),
    'declined',           (select count(*) from intros where state = 'declined'),
    'closed',             (select count(*) from intros where state in ('cancelled', 'expired')),
    'met',                (select count(distinct e.intro_id) from public.intro_events e join intros i on i.id = e.intro_id where e.action = 'met'),
    'emails_waiting',     (select count(*) from public.notifications where emailed_at is null and failed_at is null),
    'emails_failed',      (select count(*) from public.notifications where failed_at is not null)
  ) into result;
  return result;
end;
$$;

revoke all on function public.record_intro_meeting(uuid), public.admin_intro_metrics(text) from public, anon;
grant execute on function public.record_intro_meeting(uuid), public.admin_intro_metrics(text) to authenticated;
