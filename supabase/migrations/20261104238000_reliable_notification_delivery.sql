-- Reliable delivery for the notifications outbox. A run claims rows before
-- sending, so a scheduled job and the action that created a notification can't
-- both email it. Failed sends back off and eventually stop, so a bad address
-- can't hold up everything behind it.

alter table public.notifications
  add column attempts        smallint not null default 0,
  add column next_attempt_at timestamptz not null default now(),
  add column claimed_until   timestamptz,
  add column failed_at       timestamptz;

drop index public.notifications_outbox_idx;
create index notifications_outbox_idx on public.notifications (next_attempt_at, created_at)
  where emailed_at is null and failed_at is null;

-- Takes the next due notifications for this run. The lease outlasts a full batch;
-- a run that dies mid-batch simply lets its rows come due again when it expires.
create function public.claim_notifications(p_limit integer default 25, p_max_attempts integer default 5)
returns setof public.notifications
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A run can die without recording a result, so stop here too, not only after a failed send.
  update public.notifications set failed_at = now()
   where emailed_at is null and failed_at is null and attempts >= p_max_attempts
     and (claimed_until is null or claimed_until < now());

  return query
  with due as (
    select id from public.notifications
     where emailed_at is null and failed_at is null and next_attempt_at <= now()
       and (claimed_until is null or claimed_until < now())
     order by created_at
     limit p_limit
       for update skip locked
  )
  update public.notifications n
     set attempts = n.attempts + 1, claimed_until = now() + interval '10 minutes'
    from due
   where n.id = due.id
  returning n.*;
end;
$$;

revoke all on function public.claim_notifications(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_notifications(integer, integer) to service_role;
