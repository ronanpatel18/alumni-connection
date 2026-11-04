-- Claim-or-remove: private per-person links (no public directory search),
-- claim requests, and suppression records precise enough to stop re-imports.

-- One private link per invitation. Only a hash of the token is stored; the
-- token itself lives in the invitation email. person_id is nulled when the
-- person removes their profile, so a revisited link can say "already removed".
create table public.profile_links (
  id             uuid primary key default gen_random_uuid(),
  person_id      uuid references public.people (id) on delete set null,
  token_sha256   text not null unique,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '90 days',
  claimed_at     timestamptz,
  removed_at     timestamptz
);

create index profile_links_person_idx on public.profile_links (person_id);

create table public.claim_requests (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references public.people (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  link_id      uuid references public.profile_links (id) on delete set null,
  -- email_match: the signed-in email equals an email on file → approved at once.
  -- manual: an administrator confirms identity (admin verification queue).
  method       text not null check (method in ('email_match', 'manual')),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid references auth.users (id),
  unique (person_id, user_id)
);

create index claim_requests_status_idx on public.claim_requests (status, created_at);

-- Suppression keyed by the source's own ID (e.g. a board profile slug), not
-- just a name, so re-imports skip exactly the right record.
alter table public.suppression_list
  add column source text,
  add column external_id text;

create unique index suppression_list_external_idx on public.suppression_list (source, external_id)
  where source is not null and external_id is not null;

-- ---------------------------------------------------------------------------
-- Privileges and RLS. Links are server-only (service role); members see their
-- own claim requests; admins see all.
-- ---------------------------------------------------------------------------

revoke all on public.profile_links, public.claim_requests from anon, authenticated;
grant select on public.claim_requests to authenticated;

alter table public.profile_links enable row level security;
alter table public.claim_requests enable row level security;

create policy "own claims, admins all" on public.claim_requests
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
