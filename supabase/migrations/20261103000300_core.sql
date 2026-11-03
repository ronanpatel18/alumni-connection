-- Core directory schema: organizations, people (profiles), education, positions,
-- contact details, provenance, relationship edges, members and ops tables.

create table public.organizations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  domain           text unique,
  industry_id      integer references public.industries (id),
  hq_place_id      integer references public.places (id),
  website          text,
  is_alumni_owned  boolean not null default false,
  created_at       timestamptz not null default now()
);

create index organizations_name_trgm_idx on public.organizations using gin (name extensions.gin_trgm_ops);
create index organizations_industry_idx on public.organizations (industry_id);

-- A profile. Seeded from licensed/public data before the person signs up;
-- `claimed_by_user_id` links it to an auth user once they claim it.
create table public.people (
  id                       uuid primary key default gen_random_uuid(),
  institution_id           uuid not null references public.institutions (id) on delete cascade,
  full_name                text not null,
  first_name               text,
  last_name                text,
  preferred_name           text,
  headline                 text,
  bio                      text,
  ai_summary               text[],
  summary_input_hash       text,
  current_title            text,
  current_organization_id  uuid references public.organizations (id) on delete set null,
  industry_id              integer references public.industries (id),
  seniority                text check (seniority in ('entry', 'mid', 'senior', 'manager', 'director', 'vp', 'c_suite', 'partner', 'owner')),
  specialties              text[] not null default '{}',
  open_to                  text[] not null default '{}'
                           check (open_to <@ array['networking', 'mentoring', 'hiring', 'job_seeking', 'investing',
                                                   'fundraising', 'referrals', 'meeting_travelers', 'speaking']::text[]),
  place_id                 integer references public.places (id),
  city                     text,
  state                    text,
  metro                    text,
  location                 extensions.geography(point, 4326),
  status                   text not null default 'seeded' check (status in ('seeded', 'claimed', 'verified', 'opted_out')),
  claimed_by_user_id       uuid unique references auth.users (id) on delete set null,
  claimed_at               timestamptz,
  profile_completeness     smallint not null default 0 check (profile_completeness between 0 and 100),
  embedding                extensions.vector(1024),
  search_tsv               tsvector,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index people_search_tsv_idx on public.people using gin (search_tsv);
create index people_full_name_trgm_idx on public.people using gin (full_name extensions.gin_trgm_ops);
create index people_location_idx on public.people using gist (location);
create index people_industry_idx on public.people (industry_id);
create index people_metro_idx on public.people (metro);
create index people_org_idx on public.people (current_organization_id);
create index people_embedding_idx on public.people using hnsw (embedding extensions.vector_cosine_ops);

-- Keeps location fields and the full-text vector in sync. Security definer so
-- the organization lookup isn't filtered by the editing user's RLS.
create function public.people_before_write() returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  org_name text;
begin
  new.updated_at := now();

  if new.place_id is not null
     and (tg_op = 'INSERT' or new.place_id is distinct from old.place_id) then
    select p.name, p.state, p.metro,
           case when tg_op = 'INSERT' and new.location is not null then new.location else p.location end
      into new.city, new.state, new.metro, new.location
      from public.places p
     where p.id = new.place_id;
  end if;

  select o.name into org_name from public.organizations o where o.id = new.current_organization_id;

  new.search_tsv :=
       setweight(to_tsvector('english', coalesce(new.full_name, '') || ' ' || coalesce(new.preferred_name, '')), 'A')
    || setweight(to_tsvector('english', coalesce(new.current_title, '') || ' ' || coalesce(new.headline, '') || ' ' || coalesce(org_name, '')), 'B')
    || setweight(to_tsvector('english', array_to_string(new.specialties, ' ') || ' ' || coalesce(new.city, '') || ' ' || coalesce(new.metro, '')), 'B')
    || setweight(to_tsvector('english', coalesce(new.bio, '') || ' ' || coalesce(array_to_string(new.ai_summary, ' '), '')), 'C');

  return new;
end;
$$;

create trigger people_before_write
  before insert or update on public.people
  for each row execute function public.people_before_write();

create table public.educations (
  id              uuid primary key default gen_random_uuid(),
  person_id       uuid not null references public.people (id) on delete cascade,
  institution_id  uuid not null references public.institutions (id),
  school          text,        -- e.g. Wisconsin School of Business
  degree          text,        -- e.g. BBA, MBA, JD
  major           text,
  grad_year       smallint check (grad_year between 1900 and 2100),
  verified_by     text check (verified_by in ('roster', 'email_domain', 'admin', 'degree_verify', 'source')),
  created_at      timestamptz not null default now()
);

create index educations_person_idx on public.educations (person_id);
create index educations_grad_year_idx on public.educations (institution_id, grad_year);

create table public.positions (
  id                 uuid primary key default gen_random_uuid(),
  person_id          uuid not null references public.people (id) on delete cascade,
  organization_id    uuid references public.organizations (id) on delete set null,
  organization_name  text not null,
  title              text not null,
  seniority          text,
  start_date         date,
  end_date           date,
  is_current         boolean not null default false,
  created_at         timestamptz not null default now()
);

create index positions_person_idx on public.positions (person_id);
create index positions_org_idx on public.positions (organization_id);

-- Contact details. Each row carries its own visibility so a member can show
-- their work email to all members but keep a phone number private.
create table public.contact_points (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references public.people (id) on delete cascade,
  kind         text not null check (kind in ('email', 'phone', 'website', 'linkedin', 'other')),
  value        text not null,
  label        text check (label in ('work', 'personal', 'other')),
  source       text not null check (source in ('self', 'roster', 'pdl', 'apollo', 'clay', 'hunter', 'web', 'admin')),
  verified_at  timestamptz,
  visibility   text not null default 'private' check (visibility in ('members', 'connections', 'private')),
  created_at   timestamptz not null default now(),
  unique (person_id, kind, value)
);

create index contact_points_person_idx on public.contact_points (person_id);

-- Where each profile field came from. Member-entered values (source 'self') win.
create table public.field_provenance (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references public.people (id) on delete cascade,
  field       text not null,
  source      text not null check (source in ('self', 'roster', 'pdl', 'apollo', 'clay', 'hunter', 'web', 'ai', 'admin')),
  confidence  numeric(3, 2) check (confidence between 0 and 1),
  source_url  text,
  fetched_at  timestamptz not null default now(),
  unique (person_id, field, source)
);

create index field_provenance_person_idx on public.field_provenance (person_id);

-- Relationships between people. `owner_user_id` is set for private edges
-- (e.g. a member's own LinkedIn import); null means a shared network fact.
create table public.edges (
  id                 uuid primary key default gen_random_uuid(),
  person_a           uuid not null references public.people (id) on delete cascade,
  person_b           uuid not null references public.people (id) on delete cascade,
  kind               text not null check (kind in ('classmate', 'coworker', 'linkedin_import', 'met', 'introduced', 'mentor')),
  weight             real not null default 1,
  source             text,
  owner_user_id      uuid references auth.users (id) on delete cascade,
  shared_by_consent  boolean not null default false,
  created_at         timestamptz not null default now(),
  check (person_a < person_b)
);

create unique index edges_unique_idx on public.edges
  (person_a, person_b, kind, coalesce(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index edges_person_b_idx on public.edges (person_b);

-- One row per auth user: their role and how they were verified as an alumnus.
create table public.members (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  institution_id       uuid not null references public.institutions (id),
  email                text,
  person_id            uuid unique references public.people (id) on delete set null,
  role                 text not null default 'pending'
                       check (role in ('pending', 'member', 'chapter_leader', 'admin', 'super_admin')),
  verification_method  text check (verification_method in ('claim_code', 'roster', 'email_domain', 'admin', 'dev')),
  verified_at          timestamptz,
  created_at           timestamptz not null default now()
);

create function public.handle_new_auth_user() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.members (user_id, institution_id, email)
  values (new.id, (select id from public.institutions where slug = 'uw-madison'), new.email)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- People who asked to be removed. Checked before any seeding or enrichment.
create table public.suppression_list (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid not null references public.institutions (id),
  full_name       text not null,
  email_sha256    text,
  reason          text,
  created_at      timestamptz not null default now()
);

create index suppression_list_name_idx on public.suppression_list (institution_id, lower(full_name));

create table public.enrichment_jobs (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references public.people (id) on delete cascade,
  kind         text not null check (kind in ('summary', 'embedding', 'full')),
  status       text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'needs_review')),
  provider     text,
  attempts     smallint not null default 0,
  error        text,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);

create index enrichment_jobs_status_idx on public.enrichment_jobs (status, created_at);

create table public.audit_log (
  id             bigint generated always as identity primary key,
  actor_user_id  uuid,
  action         text not null,
  target_table   text,
  target_id      text,
  metadata       jsonb not null default '{}',
  created_at     timestamptz not null default now()
);

create index audit_log_created_idx on public.audit_log (created_at desc);
