-- Meetings between two members (design/prototypes/screens/meeting.html): one
-- proposes a time, the other accepts or declines. Only an accepted meeting is
-- "booked"; a calendar file alone never was. Like messages, only people with a
-- claimed profile can be invited, and nobody's email address is revealed.

create table public.meetings (
  id               uuid primary key default gen_random_uuid(),
  proposed_by      uuid not null references auth.users (id) on delete cascade,
  with_user        uuid not null references auth.users (id) on delete cascade,
  trip_id          uuid references public.trips (id) on delete set null,
  title            text not null check (char_length(title) between 1 and 200),
  starts_at        timestamptz not null,
  duration_minutes integer not null default 30 check (duration_minutes between 15 and 480),
  location         text check (char_length(location) <= 300),
  note             text check (char_length(note) <= 2000),
  status           text not null default 'proposed' check (status in ('proposed', 'accepted', 'declined', 'cancelled')),
  created_at       timestamptz not null default now(),
  responded_at     timestamptz,
  check (proposed_by <> with_user)
);
create index meetings_proposed_by_idx on public.meetings (proposed_by, starts_at);
create index meetings_with_user_idx on public.meetings (with_user, starts_at);

alter table public.meetings enable row level security;
revoke all on public.meetings from anon, authenticated;
grant select on public.meetings to authenticated;
create policy "participants read meetings" on public.meetings
  for select to authenticated using (auth.uid() in (proposed_by, with_user));

create function public.propose_meeting(
  p_person uuid, p_title text, p_starts_at timestamptz, p_duration integer,
  p_location text default null, p_note text default null, p_trip uuid default null
) returns uuid
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
  if v_to is null then raise exception 'This person hasn''t joined yet, so they can''t be invited here' using errcode = 'P0002'; end if;
  if v_to = auth.uid() then raise exception 'That''s your own profile' using errcode = '22023'; end if;
  if p_starts_at is null or p_starts_at < now() then raise exception 'Choose a time in the future' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_title, ''))) = 0 then raise exception 'Say what the meeting is for' using errcode = '22023'; end if;
  -- The same limit as new conversations: this isn't a mass-invitation tool.
  if (select count(*) from public.meetings where proposed_by = auth.uid() and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You''ve proposed 20 meetings today. Try again tomorrow.' using errcode = '54000';
  end if;

  insert into public.meetings (proposed_by, with_user, trip_id, title, starts_at, duration_minutes, location, note)
  values (auth.uid(), v_to, (select id from public.trips where id = p_trip and owner_user_id = auth.uid()),
          left(trim(p_title), 200), p_starts_at, coalesce(p_duration, 30),
          nullif(left(trim(coalesce(p_location, '')), 300), ''), nullif(left(trim(coalesce(p_note, '')), 2000), ''))
  returning id into v_id;

  insert into public.notifications (user_id, kind, title, link, ref_id)
  values (v_to, 'meeting', public.member_display_name(auth.uid()) || ' proposed a time to meet', '/meetings', v_id);
  return v_id;
end;
$$;

create function public.respond_to_meeting(p_meeting uuid, p_accept boolean) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.meetings;
begin
  select * into m from public.meetings where id = p_meeting for update;
  if not found or m.with_user <> auth.uid() then raise exception 'This invitation isn''t yours to answer' using errcode = '42501'; end if;
  if m.status <> 'proposed' then raise exception 'This invitation was already answered' using errcode = '22023'; end if;
  update public.meetings set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now() where id = m.id;
  insert into public.notifications (user_id, kind, title, link, ref_id)
  values (m.proposed_by, 'meeting',
          public.member_display_name(auth.uid()) || case when p_accept then ' accepted your meeting' else ' can''t make the time you proposed' end,
          '/meetings', m.id);
end;
$$;

-- Either person can call off a meeting that is proposed or booked.
create function public.cancel_meeting(p_meeting uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.meetings;
begin
  select * into m from public.meetings where id = p_meeting for update;
  if not found or auth.uid() not in (m.proposed_by, m.with_user) then raise exception 'This meeting isn''t yours' using errcode = '42501'; end if;
  if m.status not in ('proposed', 'accepted') then return; end if;
  update public.meetings set status = 'cancelled', responded_at = now() where id = m.id;
  insert into public.notifications (user_id, kind, title, link, ref_id)
  values (case when m.proposed_by = auth.uid() then m.with_user else m.proposed_by end, 'meeting',
          public.member_display_name(auth.uid()) || ' cancelled your meeting', '/meetings', m.id);
end;
$$;

-- The member's meetings with the other person's name, soonest first.
create function public.my_meetings()
returns table (id uuid, title text, starts_at timestamptz, duration_minutes integer, location text, note text, status text,
               i_proposed boolean, other_name text, other_person_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.title, m.starts_at, m.duration_minutes, m.location, m.note, m.status,
         m.proposed_by = auth.uid(),
         public.member_display_name(o.other),
         (select p.id from public.people p where p.claimed_by_user_id = o.other limit 1)
    from public.meetings m
    cross join lateral (select case when m.proposed_by = auth.uid() then m.with_user else m.proposed_by end as other) o
   where auth.uid() in (m.proposed_by, m.with_user)
   order by m.starts_at;
$$;

revoke all on function public.propose_meeting(uuid, text, timestamptz, integer, text, text, uuid),
  public.respond_to_meeting(uuid, boolean), public.cancel_meeting(uuid), public.my_meetings() from public, anon;
grant execute on function public.propose_meeting(uuid, text, timestamptz, integer, text, text, uuid),
  public.respond_to_meeting(uuid, boolean), public.cancel_meeting(uuid), public.my_meetings() to authenticated;
