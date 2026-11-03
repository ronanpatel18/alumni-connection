-- Relationship-management layer: saved contacts, private notes, interactions,
-- warm-intro requests, trips and cached recommendations.

create table public.saved_contacts (
  owner_user_id  uuid not null references auth.users (id) on delete cascade,
  person_id      uuid not null references public.people (id) on delete cascade,
  list_name      text not null default 'Saved',
  created_at     timestamptz not null default now(),
  primary key (owner_user_id, person_id, list_name)
);

create table public.notes (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users (id) on delete cascade,
  person_id      uuid not null references public.people (id) on delete cascade,
  body           text not null check (char_length(body) <= 5000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index notes_owner_person_idx on public.notes (owner_user_id, person_id);

create table public.interactions (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users (id) on delete cascade,
  person_id      uuid not null references public.people (id) on delete cascade,
  kind           text not null check (kind in ('meeting', 'call', 'email', 'intro', 'event', 'other')),
  occurred_at    timestamptz,
  follow_up_at   timestamptz,
  summary        text check (char_length(summary) <= 5000),
  created_at     timestamptz not null default now()
);

create index interactions_owner_idx on public.interactions (owner_user_id, follow_up_at);

-- Double opt-in: the connector agrees first, then the target.
create table public.intro_requests (
  id                   uuid primary key default gen_random_uuid(),
  requester_user_id    uuid not null references auth.users (id) on delete cascade,
  connector_person_id  uuid not null references public.people (id) on delete cascade,
  target_person_id     uuid not null references public.people (id) on delete cascade,
  goal                 text not null check (char_length(goal) <= 1000),
  message              text check (char_length(message) <= 3000),
  status               text not null default 'pending_connector'
                       check (status in ('pending_connector', 'pending_target', 'accepted', 'declined', 'cancelled')),
  connector_note       text check (char_length(connector_note) <= 2000),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (connector_person_id <> target_person_id)
);

create index intro_requests_requester_idx on public.intro_requests (requester_user_id);
create index intro_requests_connector_idx on public.intro_requests (connector_person_id);
create index intro_requests_target_idx on public.intro_requests (target_person_id);

create table public.trips (
  id              uuid primary key default gen_random_uuid(),
  owner_user_id   uuid not null references auth.users (id) on delete cascade,
  place_id        integer not null references public.places (id),
  starts_on       date not null,
  ends_on         date not null,
  industry_slugs  text[] not null default '{}',
  goal            text check (char_length(goal) <= 1000),
  created_at      timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create index trips_owner_idx on public.trips (owner_user_id, starts_on);

create table public.recommendations (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users (id) on delete cascade,
  person_id      uuid not null references public.people (id) on delete cascade,
  goal_hash      text not null,
  score          real not null,
  reasons        jsonb not null default '[]',
  created_at     timestamptz not null default now(),
  unique (owner_user_id, person_id, goal_hash)
);
