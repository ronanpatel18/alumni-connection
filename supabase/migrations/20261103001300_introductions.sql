-- Warm introductions with double opt-in (design/prototypes/HANDOFF.md):
-- the requester asks a connector; only if the connector agrees is the
-- recipient asked; only two yeses complete it. Every decision is a separate,
-- append-only consent event. Requests expire after 30 days. Nobody sees
-- another role's decision controls, and declines need no reason.

alter table public.intro_requests
  add column expires_at timestamptz not null default now() + interval '30 days',
  drop constraint intro_requests_status_check,
  add constraint intro_requests_status_check
    check (status in ('pending_connector', 'pending_target', 'accepted', 'declined', 'cancelled', 'expired'));

-- One open request per requester and recipient at a time.
create unique index intro_requests_open_idx on public.intro_requests (requester_user_id, target_person_id)
  where status in ('pending_connector', 'pending_target');

-- Append-only record of each party's decision.
create table public.intro_events (
  id            bigint generated always as identity primary key,
  intro_id      uuid not null references public.intro_requests (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  role          text not null check (role in ('requester', 'connector', 'recipient', 'system')),
  action        text not null check (action in ('requested', 'agreed', 'declined', 'accepted', 'cancelled', 'expired')),
  created_at    timestamptz not null default now()
);
create index intro_events_intro_idx on public.intro_events (intro_id, created_at);

alter table public.intro_events enable row level security;
revoke all on public.intro_events from anon, authenticated;
grant select on public.intro_events to authenticated;
create policy "parties read intro events" on public.intro_events
  for select to authenticated
  using (exists (select 1 from public.intro_requests r where r.id = intro_id));  -- visible iff the request is (its RLS applies)

-- State changes only through the functions below (they check who's acting and
-- write the consent event in the same transaction).
revoke insert, update on public.intro_requests from authenticated;
drop policy "members request intros" on public.intro_requests;
drop policy "connector responds" on public.intro_requests;
drop policy "target responds" on public.intro_requests;
drop policy "requester cancels" on public.intro_requests;

-- Expired requests read as expired everywhere (also handled lazily by the functions).
create function public.expire_intro_requests() returns void
language sql
security definer
set search_path = public
as $$
  with expired as (
    update public.intro_requests set status = 'expired', updated_at = now()
     where status in ('pending_connector', 'pending_target') and expires_at < now()
    returning id
  )
  insert into public.intro_events (intro_id, role, action) select id, 'system', 'expired' from expired;
$$;

-- Members who could make the introduction: people with a claimed profile who
-- serve in a group with the recipient, or have a recorded connection to them.
create function public.intro_connectors(p_target uuid)
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

create function public.request_intro(p_target uuid, p_connector uuid, p_goal text, p_message text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_verified_member() then raise exception 'Verified members only' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_goal, ''))) < 20 then
    raise exception 'Add a little more context for your connector' using errcode = '22023';
  end if;
  if not exists (select 1 from public.intro_connectors(p_target) c where c.person_id = p_connector) then
    raise exception 'That member can''t introduce you to this person' using errcode = '42501';
  end if;
  perform public.expire_intro_requests();
  insert into public.intro_requests (requester_user_id, connector_person_id, target_person_id, goal, message)
  values (auth.uid(), p_connector, p_target, trim(p_goal), nullif(trim(coalesce(p_message, '')), ''))
  returning id into v_id;
  insert into public.intro_events (intro_id, actor_user_id, role, action) values (v_id, auth.uid(), 'requester', 'requested');
  return v_id;
exception when unique_violation then
  raise exception 'You already have an open introduction request for this person' using errcode = '23505';
end;
$$;

-- The connector agrees (the recipient is then asked) or declines quietly.
create function public.decide_intro_as_connector(p_intro uuid, p_agree boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.intro_requests;
begin
  perform public.expire_intro_requests();
  select * into r from public.intro_requests where id = p_intro for update;
  if not found or r.connector_person_id is distinct from public.my_person_id() then
    raise exception 'This request isn''t yours to decide' using errcode = '42501';
  end if;
  if r.status <> 'pending_connector' then return r.status; end if;
  update public.intro_requests
     set status = case when p_agree then 'pending_target' else 'declined' end, updated_at = now()
   where id = r.id;
  insert into public.intro_events (intro_id, actor_user_id, role, action)
  values (r.id, auth.uid(), 'connector', case when p_agree then 'agreed' else 'declined' end);
  return case when p_agree then 'pending_target' else 'declined' end;
end;
$$;

-- The recipient accepts (both yeses: the introduction is made) or declines.
create function public.decide_intro_as_recipient(p_intro uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.intro_requests;
  requester_person uuid;
begin
  perform public.expire_intro_requests();
  select * into r from public.intro_requests where id = p_intro for update;
  -- Until the connector agrees, the request doesn't exist as far as the recipient knows.
  if not found or r.target_person_id is distinct from public.my_person_id() or r.status = 'pending_connector' then
    raise exception 'This invitation isn''t yours to decide' using errcode = '42501';
  end if;
  if r.status <> 'pending_target' then return r.status; end if;
  update public.intro_requests
     set status = case when p_accept then 'accepted' else 'declined' end, updated_at = now()
   where id = r.id;
  insert into public.intro_events (intro_id, actor_user_id, role, action)
  values (r.id, auth.uid(), 'recipient', case when p_accept then 'accepted' else 'declined' end);

  if p_accept then
    -- The requester's relationship record, and a connection both sides chose.
    insert into public.interactions (owner_user_id, person_id, kind, occurred_at, summary)
    values (r.requester_user_id, r.target_person_id, 'intro', now(), 'Warm introduction: both the connector and the recipient agreed.');
    select person_id into requester_person from public.members where user_id = r.requester_user_id;
    if requester_person is not null then
      insert into public.edges (person_a, person_b, kind, source, shared_by_consent)
      values (least(requester_person, r.target_person_id), greatest(requester_person, r.target_person_id), 'introduced', 'intro_request', true)
      on conflict do nothing;
    end if;
  end if;
  return case when p_accept then 'accepted' else 'declined' end;
end;
$$;

create function public.cancel_intro(p_intro uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.intro_requests;
begin
  select * into r from public.intro_requests where id = p_intro for update;
  if not found or r.requester_user_id <> auth.uid() then
    raise exception 'This request isn''t yours to cancel' using errcode = '42501';
  end if;
  if r.status not in ('pending_connector', 'pending_target') then return r.status; end if;
  update public.intro_requests set status = 'cancelled', updated_at = now() where id = r.id;
  insert into public.intro_events (intro_id, actor_user_id, role, action) values (r.id, auth.uid(), 'requester', 'cancelled');
  return 'cancelled';
end;
$$;

-- Details each party may see: names and headlines of the others, never contact details.
create function public.intro_request_details(p_intro uuid)
returns table (
  id uuid, status text, goal text, message text, created_at timestamptz, expires_at timestamptz,
  my_role text, requester_name text, requester_headline text,
  connector_id uuid, connector_name text, target_id uuid, target_name text, target_headline text
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id,
         case when r.status in ('pending_connector', 'pending_target') and r.expires_at < now() then 'expired' else r.status end,
         r.goal, r.message, r.created_at, r.expires_at,
         case when r.requester_user_id = auth.uid() then 'requester'
              when r.connector_person_id = public.my_person_id() then 'connector'
              else 'recipient' end,
         coalesce(rp.full_name, split_part(m.email, '@', 1)), rp.headline,
         c.id, c.full_name, t.id, t.full_name, t.headline
    from public.intro_requests r
    join public.members m on m.user_id = r.requester_user_id
    left join public.people rp on rp.id = m.person_id
    join public.people c on c.id = r.connector_person_id
    join public.people t on t.id = r.target_person_id
   where r.id = p_intro
     and (r.requester_user_id = auth.uid()
          or r.connector_person_id = public.my_person_id()
          -- The recipient sees nothing until the connector has agreed.
          or (r.target_person_id = public.my_person_id() and r.status <> 'pending_connector'));
$$;

revoke all on function public.expire_intro_requests(), public.intro_connectors(uuid),
  public.request_intro(uuid, uuid, text, text), public.decide_intro_as_connector(uuid, boolean),
  public.decide_intro_as_recipient(uuid, boolean), public.cancel_intro(uuid), public.intro_request_details(uuid)
  from public, anon;
grant execute on function public.intro_connectors(uuid), public.request_intro(uuid, uuid, text, text),
  public.decide_intro_as_connector(uuid, boolean), public.decide_intro_as_recipient(uuid, boolean),
  public.cancel_intro(uuid), public.intro_request_details(uuid)
  to authenticated;
