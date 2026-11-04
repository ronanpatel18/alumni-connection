-- Trip planner: destination → purpose → relevant people → individual outreach.
-- Everything here is private to the member who planned the trip: nobody on a
-- shortlist is notified, and nothing is sent automatically (design/prototypes/HANDOFF.md).
-- Removing a profile removes it from every shortlist and draft (cascades).

-- People the member chose to meet on a trip.
create table public.trip_shortlist (
  trip_id   uuid not null references public.trips (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  added_at  timestamptz not null default now(),
  primary key (trip_id, person_id)
);

-- One editable message per recipient (and trip). There is no relay yet, so a
-- draft is never sent by the app; the member copies or sends it themselves.
create table public.outreach_drafts (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  person_id     uuid not null references public.people (id) on delete cascade,
  trip_id       uuid references public.trips (id) on delete cascade,
  subject       text not null check (char_length(subject) between 1 and 200),
  body          text not null check (char_length(body) between 1 and 5000),
  -- True until the member edits the AI's draft (it keeps the "AI-drafted" label).
  ai_drafted    boolean not null default true,
  updated_at    timestamptz not null default now(),
  unique nulls not distinct (owner_user_id, person_id, trip_id)
);

create index outreach_drafts_owner_idx on public.outreach_drafts (owner_user_id, updated_at desc);

alter table public.trip_shortlist enable row level security;
alter table public.outreach_drafts enable row level security;

grant select, insert, delete on public.trip_shortlist to authenticated;
grant select, insert, update, delete on public.outreach_drafts to authenticated;

create policy "own trip shortlist" on public.trip_shortlist
  for all to authenticated
  using (exists (select 1 from public.trips t where t.id = trip_id and t.owner_user_id = auth.uid()))
  with check (
    public.is_verified_member()
    and exists (select 1 from public.trips t where t.id = trip_id and t.owner_user_id = auth.uid())
  );

create policy "own outreach drafts" on public.outreach_drafts
  for all to authenticated
  using (owner_user_id = auth.uid())
  with check (
    owner_user_id = auth.uid()
    and public.is_verified_member()
    and (trip_id is null or exists (select 1 from public.trips t where t.id = trip_id and t.owner_user_id = auth.uid()))
  );

-- "Why this person" lines are cached per member and goal, so the app can store
-- the ones it generates. (Reads and deletes were already allowed.)
grant insert, update on public.recommendations to authenticated;
drop policy "own recommendations" on public.recommendations;
create policy "own recommendations" on public.recommendations
  for all to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid() and public.is_verified_member());
