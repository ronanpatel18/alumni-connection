-- Groups (advisory boards, chapters, clubs), profile photos, alumni status and
-- external IDs so imports are idempotent.

alter table public.people
  add column photo_url text,
  -- How sure we are this person is a UW–Madison alumnus:
  --   confirmed     roster, self-reported and verified, or admin
  --   source_stated a public source explicitly says UW–Madison
  --   likely        a source says "University of Wisconsin" without the campus
  --   not_alumnus   sources show degrees elsewhere only (e.g. faculty, board members)
  --   unknown       nothing found yet
  add column alumni_status text not null default 'unknown'
    check (alumni_status in ('confirmed', 'source_stated', 'likely', 'not_alumnus', 'unknown'));

grant update (photo_url) on public.people to authenticated;

-- A person's ID in an outside system (a board profile slug, a PDL id, a roster id).
create table public.person_external_ids (
  person_id    uuid not null references public.people (id) on delete cascade,
  source       text not null,
  external_id  text not null,
  url          text,
  created_at   timestamptz not null default now(),
  primary key (source, external_id)
);

create index person_external_ids_person_idx on public.person_external_ids (person_id);

create table public.groups (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid not null references public.institutions (id),
  slug            text not null unique,
  name            text not null,
  kind            text not null check (kind in ('advisory_board', 'chapter', 'club', 'program', 'other')),
  parent_unit     text,          -- e.g. Wisconsin School of Business
  source_url      text,
  created_at      timestamptz not null default now()
);

create table public.group_memberships (
  group_id    uuid not null references public.groups (id) on delete cascade,
  person_id   uuid not null references public.people (id) on delete cascade,
  role        text,
  source_url  text,
  created_at  timestamptz not null default now(),
  primary key (group_id, person_id)
);

create index group_memberships_person_idx on public.group_memberships (person_id);

-- Provenance can now cite group listings.
alter table public.field_provenance drop constraint field_provenance_source_check;
alter table public.field_provenance
  add constraint field_provenance_source_check
  check (source in ('self', 'roster', 'pdl', 'apollo', 'clay', 'hunter', 'web', 'ai', 'admin', 'institution'));

-- ---------------------------------------------------------------------------
-- Privileges and RLS (same rules as profiles: verified members read)
-- ---------------------------------------------------------------------------

revoke all on public.person_external_ids, public.groups, public.group_memberships from anon, authenticated;
grant select on public.groups, public.group_memberships to authenticated;
grant select on public.person_external_ids to authenticated;

alter table public.person_external_ids enable row level security;
alter table public.groups enable row level security;
alter table public.group_memberships enable row level security;

create policy "members read groups" on public.groups
  for select to authenticated using (public.is_verified_member());

create policy "read with profile" on public.group_memberships
  for select to authenticated using (exists (select 1 from public.people p where p.id = person_id));

create policy "admins read external ids" on public.person_external_ids
  for select to authenticated using (public.is_admin());
