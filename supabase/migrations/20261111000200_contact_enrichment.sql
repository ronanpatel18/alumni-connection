-- Contact enrichment (docs/ARCHITECTURE.md §3, §3b, §7): emails and phone
-- numbers found on public pages or returned by licensed APIs, staged for an
-- administrator's decision before any other member can see them.

-- ---------------------------------------------------------------------------
-- Finer sources, so each can be deleted on its own.
--   linkedin       LinkedIn pages, snippets and vendors that read LinkedIn
--   people_search  Spokeo, Whitepages, BeenVerified and similar
--   registry       official registries (NPI, bar directories, DSPS, BrokerCheck, EDGAR)
-- source_detail narrows it further ('npi', 'spokeo', 'wisbar', a page's host).
-- ---------------------------------------------------------------------------
alter table public.contact_points drop constraint contact_points_source_check;
alter table public.contact_points
  add constraint contact_points_source_check
  check (source in ('self', 'roster', 'pdl', 'apollo', 'clay', 'hunter', 'web', 'admin', 'linkedin', 'people_search', 'registry'));

alter table public.contact_points
  add column source_detail text,
  add column source_url    text,
  -- How the value was checked: seen on a source page, confirmed by an email or
  -- phone verifier, or a guessed work-email pattern that a verifier confirmed.
  add column verification  text check (verification in ('source_page', 'verifier', 'pattern_verified'));

alter table public.field_provenance drop constraint field_provenance_source_check;
alter table public.field_provenance
  add constraint field_provenance_source_check
  check (source in ('self', 'roster', 'pdl', 'apollo', 'clay', 'hunter', 'web', 'ai', 'admin', 'institution',
                    'linkedin', 'people_search', 'registry'));

-- ---------------------------------------------------------------------------
-- Who can read a contact detail. Member-entered details stay visible to every
-- verified member, as before. Anything from a third party is shown only once
-- its visibility is 'members', which for enrichment findings takes an
-- administrator's approval. Details already in the directory keep showing.
-- ---------------------------------------------------------------------------
update public.contact_points set visibility = 'members' where source <> 'self' and visibility <> 'members';

drop policy "verified members read contact details" on public.contact_points;

create policy "members read shown contact details" on public.contact_points
  for select to authenticated
  using (
    public.owns_person(person_id)
    or public.is_admin()
    or (
      public.is_verified_member()
      and exists (select 1 from public.people p where p.id = person_id)
      and (source = 'self' or visibility = 'members')
    )
  );

-- Never re-add someone who asked to be removed: a third-party email whose hash
-- is on the suppression list can't be stored, whatever code path tries.
create function public.contact_points_block_suppressed() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'email' and new.source <> 'self' and exists (
    select 1 from public.suppression_list s
     where s.email_sha256 = encode(sha256(convert_to(lower(new.value), 'UTF8')), 'hex')
  ) then
    raise exception 'This email belongs to someone who asked to be removed' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger contact_points_block_suppressed
  before insert or update of value on public.contact_points
  for each row execute function public.contact_points_block_suppressed();

-- ---------------------------------------------------------------------------
-- Findings: everything the pipeline found, with its evidence. Administrators only.
-- ---------------------------------------------------------------------------
create table public.contact_findings (
  id               uuid primary key default gen_random_uuid(),
  person_id        uuid not null references public.people (id) on delete cascade,
  kind             text not null check (kind in ('email', 'phone')),
  value            text not null,
  label            text not null check (label in ('work', 'personal', 'other')),
  source           text not null check (source in ('pdl', 'apollo', 'clay', 'hunter', 'web', 'linkedin', 'people_search', 'registry')),
  source_detail    text,
  -- The page (or API request) the value was read from, and the exact text around it.
  source_url       text not null,
  evidence_quote   text not null,
  confidence       numeric(3, 2) not null check (confidence between 0 and 1),
  -- { status: valid|domain_ok|invalid|risky|unknown, method, checked_at, line_type? }
  verification     jsonb not null default '{}',
  -- A work address built from the company's pattern (first.last@company.com)
  -- rather than read from a page. Only ever stored after a verifier confirms it.
  pattern_guessed  boolean not null default false,
  -- Why a person should look: low_confidence, conflict, personal, third_party_phone, pattern, unverified.
  review_reasons   text[] not null default '{}',
  -- pending:  needs a decision; the value is stored nowhere else yet.
  -- stored:   confident work detail, already saved as a private contact detail
  --           (usable for claim matching); an administrator may show or reject it.
  -- approved / rejected: decided.
  status           text not null default 'pending' check (status in ('pending', 'stored', 'approved', 'rejected')),
  decided_by       uuid references auth.users (id) on delete set null,
  decided_at       timestamptz,
  decided_note     text check (length(decided_note) <= 2000),
  created_at       timestamptz not null default now(),
  unique (person_id, kind, value, source)
);

create index contact_findings_status_idx on public.contact_findings (status, created_at);
create index contact_findings_source_idx on public.contact_findings (source, source_detail);

alter table public.contact_findings enable row level security;
revoke all on public.contact_findings from anon, authenticated;
grant select on public.contact_findings to authenticated;
create policy "admins read" on public.contact_findings for select to authenticated using (public.is_admin());

-- Findings in one state: 'pending' (needs a decision) or 'stored' (private, may be shown).
create function public.admin_contact_queue(p_status text default 'pending')
returns table (
  id               uuid,
  person_id        uuid,
  full_name        text,
  current_title    text,
  employer         text,
  kind             text,
  value            text,
  label            text,
  source           text,
  source_detail    text,
  source_url       text,
  evidence_quote   text,
  confidence       numeric,
  verification     jsonb,
  pattern_guessed  boolean,
  review_reasons   text[],
  created_at       timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  return query
    select f.id, f.person_id, p.full_name, p.current_title, o.name,
           f.kind, f.value, f.label, f.source, f.source_detail, f.source_url, f.evidence_quote,
           f.confidence, f.verification, f.pattern_guessed, f.review_reasons, f.created_at
      from public.contact_findings f
      join public.people p on p.id = f.person_id
      left join public.organizations o on o.id = p.current_organization_id
     where f.status = p_status and p_status in ('pending', 'stored') and p.status <> 'opted_out'
     order by p.full_name, f.kind, f.created_at;
end;
$$;

-- p_decision: 'show' (approve and show to members), 'keep_private' (approve, keep
-- for identity checks such as claim matching) or 'reject' (discard the value).
create function public.admin_decide_contact_finding(p_finding_id uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.contact_findings;
  check_status text;
  v_visibility text;
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  if p_decision not in ('show', 'keep_private', 'reject') then
    raise exception 'Unknown decision' using errcode = '22023';
  end if;

  select * into f from public.contact_findings where id = p_finding_id for update;
  if not found then raise exception 'Finding not found' using errcode = 'P0002'; end if;
  if f.status not in ('pending', 'stored') then return jsonb_build_object('status', 'already_decided'); end if;
  check_status := coalesce(f.verification ->> 'status', 'unknown');

  if p_decision = 'reject' then
    delete from public.contact_points
     where person_id = f.person_id and kind = f.kind and value = f.value and source = f.source;
  else
    if p_decision = 'show' then
      -- Shown details must be work details that passed a validity check. A
      -- pattern-built address needs a verifier's "valid"; one read from a page
      -- may also pass on a working mail domain.
      if f.label <> 'work' then
        raise exception 'Only work contact details can be shown to members' using errcode = '22023';
      end if;
      if f.kind = 'email' and not (check_status = 'valid' or (check_status = 'domain_ok' and not f.pattern_guessed)) then
        raise exception 'This email has not passed a validity check' using errcode = '22023';
      end if;
      if f.kind = 'phone' and check_status = 'invalid' then
        raise exception 'This phone number failed validation' using errcode = '22023';
      end if;
    end if;
    v_visibility := case when p_decision = 'show' then 'members' else 'private' end;

    -- A value the member entered themselves is theirs: never overwritten.
    if not exists (select 1 from public.contact_points
                    where person_id = f.person_id and kind = f.kind and value = f.value and source = 'self') then
      insert into public.contact_points (person_id, kind, value, label, source, source_detail, source_url, verification, verified_at, visibility)
      values (f.person_id, f.kind, f.value, f.label, f.source, f.source_detail, f.source_url,
              case when f.pattern_guessed then 'pattern_verified' when check_status = 'valid' then 'verifier' else 'source_page' end,
              case when check_status = 'valid' then now() end,
              v_visibility)
      on conflict (person_id, kind, value) do update
        set label = excluded.label, source = excluded.source, source_detail = excluded.source_detail,
            source_url = excluded.source_url, verification = excluded.verification,
            verified_at = excluded.verified_at, visibility = excluded.visibility;

      insert into public.field_provenance (person_id, field, source, confidence, source_url, fetched_at)
      values (f.person_id, 'contact_points', f.source, f.confidence, f.source_url, now())
      on conflict (person_id, field, source) do update
        set confidence = excluded.confidence, source_url = excluded.source_url, fetched_at = excluded.fetched_at;
    end if;
  end if;

  update public.contact_findings
     set status = case when p_decision = 'reject' then 'rejected' else 'approved' end,
         decided_by = auth.uid(), decided_at = now(), decided_note = nullif(trim(p_note), '')
   where id = f.id;

  -- The audit entry names the finding, not the value.
  insert into public.audit_log (actor_user_id, action, target_table, target_id, metadata)
  values (auth.uid(), 'contact_finding.' || p_decision, 'contact_findings', f.id::text,
          jsonb_build_object('person_id', f.person_id, 'kind', f.kind, 'source', f.source));

  return jsonb_build_object('status', case when p_decision = 'reject' then 'rejected' else 'approved' end, 'visibility', v_visibility);
end;
$$;

-- Drop everything one source contributed (a license ended, or a source is
-- withdrawn). Service role only: run from a script, never from the app.
create function public.delete_contacts_from_source(p_source text, p_source_detail text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n_points integer;
  n_findings integer;
begin
  if p_source in ('self', 'admin') then raise exception 'Member and administrator entries are not a deletable source' using errcode = '22023'; end if;
  delete from public.contact_points where source = p_source and (p_source_detail is null or source_detail = p_source_detail);
  get diagnostics n_points = row_count;
  delete from public.contact_findings where source = p_source and (p_source_detail is null or source_detail = p_source_detail);
  get diagnostics n_findings = row_count;
  if p_source_detail is null then
    delete from public.field_provenance where source = p_source and field = 'contact_points';
  end if;
  insert into public.audit_log (action, target_table, metadata)
  values ('contacts.source_deleted', 'contact_points',
          jsonb_build_object('source', p_source, 'source_detail', p_source_detail, 'contact_points', n_points, 'findings', n_findings));
  return jsonb_build_object('contact_points', n_points, 'findings', n_findings);
end;
$$;

revoke all on function public.admin_contact_queue(text), public.admin_decide_contact_finding(uuid, text, text),
  public.delete_contacts_from_source(text, text), public.contact_points_block_suppressed() from public, anon, authenticated;
grant execute on function public.admin_contact_queue(text), public.admin_decide_contact_finding(uuid, text, text) to authenticated;
grant execute on function public.delete_contacts_from_source(text, text) to service_role;
