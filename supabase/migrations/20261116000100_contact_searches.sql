-- Contact searches: which profiles the contact pipeline has been run for, and
-- what came of it, so "search the next profiles" in /admin/contacts moves on
-- instead of repeating itself. One row per person, overwritten on a re-run.
-- The values found live in contact_findings; this holds only counts.
create table public.contact_searches (
  person_id    uuid primary key references public.people (id) on delete cascade,
  status       text not null default 'running' check (status in ('running', 'done', 'failed')),
  -- Findings saved as private contact details straight away.
  stored       smallint not null default 0,
  -- Findings waiting for an administrator's decision.
  pending      smallint not null default 0,
  note         text check (length(note) <= 500),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz
);

create index contact_searches_status_idx on public.contact_searches (status, started_at);

alter table public.contact_searches enable row level security;
revoke all on public.contact_searches from anon, authenticated;
grant select on public.contact_searches to authenticated;
create policy "admins read" on public.contact_searches for select to authenticated using (public.is_admin());
