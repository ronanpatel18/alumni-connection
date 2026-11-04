-- A member's own LinkedIn data export (docs/ARCHITECTURE.md §4): match their
-- Connections.csv to directory profiles ("people you already know", private
-- to them), and, for members with a claimed profile, add their work history
-- and UW–Madison degrees from Positions.csv / Education.csv as member-provided
-- data. The raw files are never stored; unmatched connections are discarded.
--
-- Matches are kept here rather than in `edges`: an edge needs the member's own
-- profile, and members can use this before they've claimed one.
create table public.my_connections (
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  person_id     uuid not null references public.people (id) on delete cascade,
  source        text not null default 'linkedin_export' check (source in ('linkedin_export')),
  matched_by    text not null check (matched_by in ('profile_url', 'name_and_company')),
  created_at    timestamptz not null default now(),
  primary key (owner_user_id, person_id)
);

alter table public.my_connections enable row level security;
grant select, insert, delete on public.my_connections to authenticated;
create policy "own connections" on public.my_connections
  for all to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid() and public.is_verified_member());

-- "https://www.linkedin.com/in/Jane-Roe/?x=1" → "linkedin.com/in/jane-roe"
create function public.normalize_linkedin_url(u text) returns text
language sql immutable
as $$ select regexp_replace(regexp_replace(lower(split_part(coalesce(u, ''), '?', 1)), '^https?://([a-z]{2,3}\.)?', ''), '/+$', '') $$;

-- "John J. Oros" → "john oros"
create function public.normalize_person_name(n text) returns text
language sql immutable
as $$ select trim(regexp_replace(regexp_replace(lower(coalesce(n, '')), '\m[a-z]\.\s*', '', 'g'), '\s+', ' ', 'g')) $$;

-- p_rows: [{ first, last, url, company }]. Runs as the member (SECURITY INVOKER),
-- so only profiles and LinkedIn links they're allowed to see can match.
-- A match needs the same LinkedIn profile URL, or the same full name AND employer;
-- a name alone is never enough (namesakes).
create function public.match_linkedin_connections(p_rows jsonb)
returns table (person_id uuid, matched_by text)
language sql
stable
security invoker
set search_path = public
as $$
  with rows as (
    select public.normalize_linkedin_url(r ->> 'url') as url,
           public.normalize_person_name(concat_ws(' ', r ->> 'first', r ->> 'last')) as name,
           lower(trim(coalesce(r ->> 'company', ''))) as company
      from jsonb_array_elements(p_rows) r
  ),
  by_url as (
    select distinct cp.person_id, 'profile_url'::text as matched_by
      from rows
      join public.contact_points cp on cp.kind = 'linkedin' and rows.url <> '' and public.normalize_linkedin_url(cp.value) = rows.url
  ),
  by_name as (
    select distinct p.id as person_id, 'name_and_company'::text as matched_by
      from rows
      join public.people p on public.normalize_person_name(p.full_name) = rows.name
     where rows.company <> '' and rows.name <> ''
       and (
         exists (select 1 from public.organizations o where o.id = p.current_organization_id
                  and (lower(o.name) like '%' || rows.company || '%' or rows.company like '%' || lower(o.name) || '%'))
         or exists (select 1 from public.positions pos where pos.person_id = p.id
                     and (lower(pos.organization_name) like '%' || rows.company || '%' or rows.company like '%' || lower(pos.organization_name) || '%'))
       )
  )
  -- The stronger evidence wins when both match.
  select person_id, case when bool_or(matched_by = 'profile_url') then 'profile_url' else 'name_and_company' end
    from (select * from by_url union all select * from by_name) m
   where person_id is distinct from public.my_person_id()
   group by person_id;
$$;

-- p: { positions: [{ title, company, start_date, end_date }],
--      educations: [{ degree, grad_year }] }  (UW–Madison degrees only; validated by the app)
create function public.import_my_linkedin_history(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.people;
  item jsonb;
  v_title text;
  v_company text;
  v_start date;
  v_end date;
  v_degree text;
  v_year smallint;
  existing uuid;
  added_positions int := 0;
  dated_positions int := 0;
  added_degrees int := 0;
  dated_degrees int := 0;
begin
  select * into me from public.people where claimed_by_user_id = auth.uid() for update;
  if not found then raise exception 'You have not claimed a profile' using errcode = 'P0002'; end if;

  for item in select * from jsonb_array_elements(coalesce(p -> 'positions', '[]')) loop
    v_title := nullif(trim(item ->> 'title'), '');
    v_company := nullif(trim(item ->> 'company'), '');
    v_start := nullif(item ->> 'start_date', '')::date;
    v_end := nullif(item ->> 'end_date', '')::date;
    continue when v_title is null or v_company is null;
    select id into existing from public.positions
     where person_id = me.id and lower(title) = lower(v_title) and lower(organization_name) = lower(v_company) limit 1;
    if existing is null then
      insert into public.positions (person_id, organization_name, title, start_date, end_date, is_current)
      values (me.id, v_company, v_title, v_start, v_end, v_end is null);
      added_positions := added_positions + 1;
    else
      -- Only fill in missing dates; never change what's there.
      update public.positions
         set start_date = coalesce(start_date, v_start),
             end_date = case when is_current then end_date else coalesce(end_date, v_end) end
       where id = existing
         and ((start_date is null and v_start is not null) or (not is_current and end_date is null and v_end is not null));
      if found then dated_positions := dated_positions + 1; end if;
    end if;
  end loop;

  for item in select * from jsonb_array_elements(coalesce(p -> 'educations', '[]')) loop
    v_degree := nullif(trim(item ->> 'degree'), '');
    v_year := nullif(item ->> 'grad_year', '')::smallint;
    continue when v_degree is null and v_year is null;
    if v_year is not null and (v_year < 1930 or v_year > extract(year from now())::int + 6) then continue; end if;
    -- Fill the year on a matching degree we already have, or add the degree.
    select id into existing from public.educations
     where person_id = me.id and grad_year is null
       and (v_degree is null or degree is null or upper(replace(degree, '.', '')) = upper(replace(v_degree, '.', '')))
     limit 1;
    if existing is not null then
      update public.educations set grad_year = v_year, degree = coalesce(degree, v_degree), verified_by = null where id = existing;
      dated_degrees := dated_degrees + 1;
    elsif not exists (select 1 from public.educations where person_id = me.id and grad_year = v_year
                       and (degree is null or v_degree is null or upper(replace(degree, '.', '')) = upper(replace(v_degree, '.', '')))) then
      insert into public.educations (person_id, institution_id, degree, grad_year,
                                     school)
      values (me.id, me.institution_id, v_degree, v_year, case when v_degree ~* 'BBA|MBA|MAcc' then 'Wisconsin School of Business' end);
      added_degrees := added_degrees + 1;
    end if;
  end loop;

  if added_positions + dated_positions > 0 then perform public.record_self_provenance(me.id, array['positions']); end if;
  if added_degrees + dated_degrees > 0 then perform public.record_self_provenance(me.id, array['educations']); end if;
  insert into public.audit_log (actor_user_id, action, target_table, target_id, metadata)
  values (auth.uid(), 'profile.linkedin_import', 'people', me.id::text,
          jsonb_build_object('positions', added_positions, 'degrees', added_degrees));

  return jsonb_build_object('added_positions', added_positions, 'dated_positions', dated_positions,
                            'added_degrees', added_degrees, 'dated_degrees', dated_degrees);
end;
$$;

revoke all on function public.match_linkedin_connections(jsonb), public.import_my_linkedin_history(jsonb) from public, anon;
grant execute on function public.match_linkedin_connections(jsonb), public.import_my_linkedin_history(jsonb),
  public.normalize_linkedin_url(text), public.normalize_person_name(text) to authenticated;
