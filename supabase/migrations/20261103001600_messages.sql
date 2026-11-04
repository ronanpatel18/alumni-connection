-- Private messaging between members (the design's "relay"): messages live in
-- Alumni Connect, the recipient gets an email notification with a link, and
-- replies happen here, so neither person's email address is ever revealed.
-- Only members (people with a claimed profile) can be messaged; others are
-- reached through the contact details they've made visible.
-- Notifications double as an email outbox: the app sends any with emailed_at
-- still null, then marks them.

create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  started_by      uuid not null references auth.users (id) on delete cascade,
  with_user       uuid not null references auth.users (id) on delete cascade,
  subject         text not null check (char_length(subject) between 1 and 200),
  trip_id         uuid references public.trips (id) on delete set null,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  check (started_by <> with_user)
);
-- One conversation per pair of members.
create unique index conversations_pair_idx on public.conversations (least(started_by, with_user), greatest(started_by, with_user));

create table public.messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_user_id  uuid references auth.users (id) on delete set null,
  body            text not null check (char_length(body) between 1 and 5000),
  created_at      timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, id);

create table public.conversation_reads (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('message', 'intro_request', 'intro_invite', 'intro_update')),
  title      text not null,
  link       text not null check (link like '/%'),
  ref_id     uuid,
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  emailed_at timestamptz
);
create index notifications_outbox_idx on public.notifications (created_at) where emailed_at is null;
create index notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.conversation_reads enable row level security;
alter table public.notifications enable row level security;
revoke all on public.conversations, public.messages, public.conversation_reads, public.notifications from anon, authenticated;
grant select on public.conversations, public.messages, public.conversation_reads, public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy "participants read conversations" on public.conversations
  for select to authenticated using (auth.uid() in (started_by, with_user));
create policy "participants read messages" on public.messages
  for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id and auth.uid() in (c.started_by, c.with_user)));
create policy "own reads" on public.conversation_reads for select to authenticated using (user_id = auth.uid());
create policy "own notifications" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "mark own notifications read" on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- How a member appears to others: their profile name, or "A verified member".
create function public.member_display_name(p_user uuid) returns text
language sql stable security definer set search_path = public
as $$
  select coalesce((select p.full_name from public.people p where p.claimed_by_user_id = p_user limit 1), 'A verified member')
$$;

-- A message notification, unless one for this conversation is still unread.
create function public.notify_message(p_conversation uuid, p_to uuid, p_from uuid) returns void
language sql security definer set search_path = public
as $$
  insert into public.notifications (user_id, kind, title, link, ref_id)
  select p_to, 'message', public.member_display_name(p_from) || ' sent you a message on Alumni Connect',
         '/messages/' || p_conversation, p_conversation
   where not exists (select 1 from public.notifications n
                      where n.user_id = p_to and n.kind = 'message' and n.ref_id = p_conversation and n.read_at is null);
$$;

-- Start (or continue) a conversation with the member who claimed p_person.
create function public.start_conversation(p_person uuid, p_subject text, p_body text, p_trip uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_to uuid;
  v_id uuid;
begin
  if not public.is_verified_member() then raise exception 'Verified members only' using errcode = '42501'; end if;
  select claimed_by_user_id into v_to from public.people where id = p_person and status <> 'opted_out';
  if v_to is null then raise exception 'This person hasn''t joined yet, so they can''t be messaged here' using errcode = 'P0002'; end if;
  if v_to = auth.uid() then raise exception 'That''s your own profile' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_body, ''))) = 0 then raise exception 'Write a message' using errcode = '22023'; end if;

  select id into v_id from public.conversations
   where least(started_by, with_user) = least(auth.uid(), v_to) and greatest(started_by, with_user) = greatest(auth.uid(), v_to);
  if v_id is null then
    -- A limit on new conversations keeps the network from being used for mass outreach.
    if (select count(*) from public.conversations where started_by = auth.uid() and created_at > now() - interval '1 day') >= 20 then
      raise exception 'You''ve started 20 conversations today. Try again tomorrow.' using errcode = '54000';
    end if;
    insert into public.conversations (started_by, with_user, subject, trip_id)
    values (auth.uid(), v_to, left(coalesce(nullif(trim(p_subject), ''), 'A hello from a fellow alum'), 200),
            (select id from public.trips where id = p_trip and owner_user_id = auth.uid()))
    returning id into v_id;
  end if;

  insert into public.messages (conversation_id, sender_user_id, body) values (v_id, auth.uid(), trim(p_body));
  update public.conversations set last_message_at = now() where id = v_id;
  insert into public.conversation_reads (conversation_id, user_id, read_at) values (v_id, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set read_at = now();
  perform public.notify_message(v_id, v_to, auth.uid());
  return v_id;
end;
$$;

create function public.send_message(p_conversation uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.conversations;
  v_to uuid;
begin
  select * into c from public.conversations where id = p_conversation;
  if not found or auth.uid() not in (c.started_by, c.with_user) then
    raise exception 'This conversation isn''t yours' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_body, ''))) = 0 then raise exception 'Write a message' using errcode = '22023'; end if;
  v_to := case when c.started_by = auth.uid() then c.with_user else c.started_by end;
  insert into public.messages (conversation_id, sender_user_id, body) values (c.id, auth.uid(), trim(p_body));
  update public.conversations set last_message_at = now() where id = c.id;
  insert into public.conversation_reads (conversation_id, user_id, read_at) values (c.id, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set read_at = now();
  perform public.notify_message(c.id, v_to, auth.uid());
end;
$$;

create function public.mark_conversation_read(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.conversations where id = p_conversation and auth.uid() in (started_by, with_user)) then return; end if;
  insert into public.conversation_reads (conversation_id, user_id, read_at) values (p_conversation, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set read_at = now();
  update public.notifications set read_at = now()
   where user_id = auth.uid() and kind = 'message' and ref_id = p_conversation and read_at is null;
end;
$$;

-- The member's conversations, newest first, with the other person's name and an unread flag.
create function public.my_conversations()
returns table (id uuid, subject text, other_name text, other_person_id uuid, last_message_at timestamptz, last_body text, unread boolean)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.subject,
         public.member_display_name(o.other),
         (select p.id from public.people p where p.claimed_by_user_id = o.other limit 1),
         c.last_message_at,
         (select left(m.body, 140) from public.messages m where m.conversation_id = c.id order by m.id desc limit 1),
         exists (select 1 from public.messages m
                  where m.conversation_id = c.id and m.sender_user_id <> auth.uid()
                    and m.created_at > coalesce((select r.read_at from public.conversation_reads r
                                                  where r.conversation_id = c.id and r.user_id = auth.uid()), '-infinity'))
    from public.conversations c
    cross join lateral (select case when c.started_by = auth.uid() then c.with_user else c.started_by end as other) o
   where auth.uid() in (c.started_by, c.with_user)
   order by c.last_message_at desc;
$$;

-- Introduction steps notify whoever is next (or the requester, about the outcome).
create function public.notify_intro_event() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.intro_requests;
  requester_name text;
  connector_user uuid;
  target_user uuid;
  target_name text;
  connector_name text;
begin
  select * into r from public.intro_requests where id = new.intro_id;
  requester_name := public.member_display_name(r.requester_user_id);
  select claimed_by_user_id, full_name into connector_user, connector_name from public.people where id = r.connector_person_id;
  select claimed_by_user_id, full_name into target_user, target_name from public.people where id = r.target_person_id;

  if new.action = 'requested' and connector_user is not null then
    insert into public.notifications (user_id, kind, title, link, ref_id)
    values (connector_user, 'intro_request', requester_name || ' asked you to introduce them to ' || target_name, '/introductions/' || r.id, r.id);
  elsif new.action = 'agreed' then
    if target_user is not null then
      insert into public.notifications (user_id, kind, title, link, ref_id)
      values (target_user, 'intro_invite', connector_name || ' would like to introduce you to ' || requester_name, '/introductions/' || r.id, r.id);
    end if;
    insert into public.notifications (user_id, kind, title, link, ref_id)
    values (r.requester_user_id, 'intro_update', connector_name || ' agreed to introduce you to ' || target_name, '/introductions/' || r.id, r.id);
  elsif new.action = 'accepted' then
    insert into public.notifications (user_id, kind, title, link, ref_id)
    values (r.requester_user_id, 'intro_update', 'Introduction made: ' || target_name || ' agreed', '/introductions/' || r.id, r.id);
    if connector_user is not null then
      insert into public.notifications (user_id, kind, title, link, ref_id)
      values (connector_user, 'intro_update', target_name || ' accepted the introduction you made', '/introductions/' || r.id, r.id);
    end if;
  elsif new.action = 'declined' then
    -- A decline never says who declined.
    insert into public.notifications (user_id, kind, title, link, ref_id)
    values (r.requester_user_id, 'intro_update', 'Your introduction to ' || target_name || ' didn''t go ahead', '/introductions/' || r.id, r.id);
  end if;
  return new;
end;
$$;

create trigger intro_events_notify after insert on public.intro_events
  for each row execute function public.notify_intro_event();

revoke all on function public.member_display_name(uuid), public.notify_message(uuid, uuid, uuid), public.notify_intro_event() from public, anon, authenticated;
revoke all on function public.start_conversation(uuid, text, text, uuid), public.send_message(uuid, text),
  public.mark_conversation_read(uuid), public.my_conversations() from public, anon;
grant execute on function public.start_conversation(uuid, text, text, uuid), public.send_message(uuid, text),
  public.mark_conversation_read(uuid), public.my_conversations() to authenticated;
