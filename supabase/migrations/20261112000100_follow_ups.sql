-- Follow-up reminders (design/prototypes/screens/followups.html). A member logs
-- a conversation with someone and, optionally, a date to follow up. Everything
-- stays private to its author (the "own interactions" policy). When the date
-- arrives they get one notification, which the outbox emails.

alter table public.interactions
  add column follow_up_done_at timestamptz,
  add column reminded_at       timestamptz;

create index interactions_due_idx on public.interactions (follow_up_at)
  where follow_up_at is not null and follow_up_done_at is null and reminded_at is null;

-- Every notification kind the later phases use, so each needs no constraint change of its own.
alter table public.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('message', 'intro_request', 'intro_invite', 'intro_update', 'claim_approved',
                    'follow_up', 'meeting', 'mentorship', 'event'));

-- Run on a schedule by the server (service role). Returns how many reminders were created.
create function public.queue_follow_up_reminders() returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  with due as (
    update public.interactions i
       set reminded_at = now()
     where i.follow_up_at <= now()
       and i.follow_up_done_at is null
       and i.reminded_at is null
    returning i.id, i.owner_user_id, i.person_id
  ), made as (
    insert into public.notifications (user_id, kind, title, link, ref_id)
    select d.owner_user_id, 'follow_up', 'Time to follow up with ' || p.full_name, '/followups', d.id
      from due d
      join public.people p on p.id = d.person_id and p.status <> 'opted_out'
    returning 1
  )
  select count(*) into n from made;
  return n;
end;
$$;

revoke all on function public.queue_follow_up_reminders() from public, anon, authenticated;
