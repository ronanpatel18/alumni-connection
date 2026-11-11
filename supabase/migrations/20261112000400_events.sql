-- Alumni events by city (design/prototypes/screens/events.html). Any verified
-- member can post one; its host or an administrator can change or cancel it.
-- RSVPs are visible to members, so people can see who else is going.

create table public.events (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid not null references public.institutions (id),
  created_by      uuid not null references auth.users (id) on delete cascade,
  title           text not null check (char_length(title) between 1 and 200),
  description     text check (char_length(description) <= 4000),
  starts_at       timestamptz not null,
  ends_at         timestamptz,
  place_id        integer references public.places (id),
  city            text check (char_length(city) <= 100),
  state           text check (char_length(state) <= 2),
  venue           text check (char_length(venue) <= 300),
  url             text check (url is null or url ~* '^https?://'),
  is_online       boolean not null default false,
  cancelled_at    timestamptz,
  created_at      timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);
create index events_starts_idx on public.events (starts_at);

create table public.event_rsvps (
  event_id   uuid not null references public.events (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

-- Keeps city and state in step with a listed place.
create function public.events_before_write() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.place_id is not null then
    select p.name, p.state into new.city, new.state from public.places p where p.id = new.place_id;
  end if;
  return new;
end;
$$;
create trigger events_before_write before insert or update on public.events
  for each row execute function public.events_before_write();

alter table public.events enable row level security;
alter table public.event_rsvps enable row level security;
revoke all on public.events, public.event_rsvps from anon, authenticated;
grant select, insert, delete on public.events to authenticated;
grant update (title, description, starts_at, ends_at, place_id, city, state, venue, url, is_online, cancelled_at) on public.events to authenticated;
grant select, insert, delete on public.event_rsvps to authenticated;

create policy "members read events" on public.events
  for select to authenticated using (public.is_verified_member());
create policy "members post events" on public.events
  for insert to authenticated with check (created_by = auth.uid() and public.is_verified_member());
create policy "hosts and admins change events" on public.events
  for update to authenticated
  using (created_by = auth.uid() or public.is_admin())
  with check (created_by = auth.uid() or public.is_admin());
create policy "hosts and admins delete events" on public.events
  for delete to authenticated using (created_by = auth.uid() or public.is_admin());

create policy "members see who is going" on public.event_rsvps
  for select to authenticated using (public.is_verified_member());
create policy "members rsvp for themselves" on public.event_rsvps
  for insert to authenticated with check (user_id = auth.uid() and public.is_verified_member());
create policy "members withdraw their rsvp" on public.event_rsvps
  for delete to authenticated using (user_id = auth.uid());

-- Upcoming events (or past ones), with the host's name, how many are going and whether the member is.
create function public.event_list(p_past boolean default false)
returns table (id uuid, title text, description text, starts_at timestamptz, ends_at timestamptz, city text, state text,
               venue text, url text, is_online boolean, cancelled boolean, host_name text, host_person_id uuid,
               is_mine boolean, going integer, i_am_going boolean)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.title, e.description, e.starts_at, e.ends_at, e.city, e.state, e.venue, e.url, e.is_online,
         e.cancelled_at is not null,
         public.member_display_name(e.created_by),
         (select p.id from public.people p where p.claimed_by_user_id = e.created_by limit 1),
         e.created_by = auth.uid(),
         (select count(*)::integer from public.event_rsvps r where r.event_id = e.id),
         exists (select 1 from public.event_rsvps r where r.event_id = e.id and r.user_id = auth.uid())
    from public.events e
   where public.is_verified_member()
     and case when p_past then coalesce(e.ends_at, e.starts_at) < now() else coalesce(e.ends_at, e.starts_at) >= now() end
   order by case when p_past then null else e.starts_at end asc, case when p_past then e.starts_at end desc
   limit 200;
$$;

-- A private calendar address for each member: their booked meetings, the events
-- they're going to and their follow-up dates, readable by calendar apps without
-- signing in. The token is the only secret; rotating it cuts off the old address.
create table public.calendar_feeds (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  token      text not null unique,
  created_at timestamptz not null default now()
);
alter table public.calendar_feeds enable row level security;
revoke all on public.calendar_feeds from anon, authenticated;
grant select on public.calendar_feeds to authenticated;
create policy "own calendar feed" on public.calendar_feeds for select to authenticated using (user_id = auth.uid());

create function public.rotate_calendar_feed() returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if not public.is_verified_member() then raise exception 'Verified members only' using errcode = '42501'; end if;
  insert into public.calendar_feeds (user_id, token) values (auth.uid(), v_token)
  on conflict (user_id) do update set token = excluded.token, created_at = now();
  return v_token;
end;
$$;

revoke all on function public.events_before_write() from public, anon, authenticated;
revoke all on function public.event_list(boolean), public.rotate_calendar_feed() from public, anon;
grant execute on function public.event_list(boolean), public.rotate_calendar_feed() to authenticated;
