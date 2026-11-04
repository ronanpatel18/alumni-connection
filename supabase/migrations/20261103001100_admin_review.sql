-- Administration: a review queue for profiles built from public sources, and
-- decisions on claim requests that couldn't be matched automatically.
-- Every function checks is_admin() itself (security definer bypasses RLS),
-- writes an audit entry, and records 'admin' as the source of what it changes.

-- One row per reviewed profile; reviewing takes it out of the queue.
create table public.profile_reviews (
  person_id      uuid primary key references public.people (id) on delete cascade,
  reviewed_by    uuid references auth.users (id) on delete set null,
  reviewed_at    timestamptz not null default now(),
  note           text not null check (length(note) between 1 and 2000),
  changed_fields text[] not null default '{}'
);

alter table public.profile_reviews enable row level security;
revoke all on public.profile_reviews from anon, authenticated;
grant select on public.profile_reviews to authenticated;
create policy "admins read" on public.profile_reviews for select to authenticated using (public.is_admin());

-- What a profile still needs, as short codes the app turns into labels.
create function public.profile_review_reasons(p public.people)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select array_remove(array[
    case when p.current_title is null or p.current_organization_id is null then 'role' end,
    case when p.alumni_status <> 'not_alumnus'
          and not exists (select 1 from public.educations e where e.person_id = p.id and e.grad_year is not null)
         then 'class_year' end,
    case when p.alumni_status in ('likely', 'unknown') then 'alumni_status' end,
    case when p.place_id is null and p.city is null then 'location' end,
    case when p.industry_id is null then 'industry' end
  ], null);
$$;

revoke all on function public.profile_review_reasons(public.people) from public, anon, authenticated;

-- Unclaimed, unreviewed profiles with at least one gap, most gaps first.
create function public.admin_review_queue()
returns table (
  person_id     uuid,
  full_name     text,
  photo_url     text,
  current_title text,
  employer      text,
  market        text,
  alumni_status text,
  reasons       text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  return query
    select p.id, p.full_name, p.photo_url, p.current_title, o.name,
           coalesce(p.metro, nullif(concat_ws(', ', p.city, p.state), '')),
           p.alumni_status, r.reasons
      from public.people p
      left join public.organizations o on o.id = p.current_organization_id
      cross join lateral (select public.profile_review_reasons(p) as reasons) r
     where p.claimed_by_user_id is null
       and p.status <> 'opted_out'
       and cardinality(r.reasons) > 0
       and not exists (select 1 from public.profile_reviews pr where pr.person_id = p.id)
     order by cardinality(r.reasons) desc, p.full_name;
end;
$$;

-- p: { full_name, current_title, employer, city, state, industry_id,
--      alumni_status, educations: [{ id?, degree, major, grad_year, school }] }
-- An education entry left completely empty is deleted. Validated by the app first.
create function public.admin_review_profile(p_person_id uuid, p jsonb, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.people;
  org_id uuid;
  v_name text := nullif(trim(p ->> 'full_name'), '');
  v_title text := nullif(trim(p ->> 'current_title'), '');
  v_employer text := nullif(trim(p ->> 'employer'), '');
  v_city text := nullif(trim(p ->> 'city'), '');
  v_state text := upper(nullif(trim(p ->> 'state'), ''));
  v_industry integer := nullif(p ->> 'industry_id', '')::integer;
  v_alumni text := coalesce(nullif(p ->> 'alumni_status', ''), 'unknown');
  v_place integer;
  v_old_place integer;
  v_old_city text;
  item jsonb;
  v_degree text;
  v_major text;
  v_school text;
  v_year smallint;
  v_edu_changed boolean := false;
  changed text[] := '{}';
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  if nullif(trim(p_note), '') is null then raise exception 'A review note is required' using errcode = '22023'; end if;
  if v_name is null then raise exception 'Full name is required' using errcode = '22023'; end if;
  if v_alumni not in ('confirmed', 'source_stated', 'likely', 'not_alumnus', 'unknown') then
    raise exception 'Invalid alumni status' using errcode = '22023';
  end if;

  select * into me from public.people where id = p_person_id for update;
  if not found then raise exception 'Profile not found' using errcode = 'P0002'; end if;
  if me.claimed_by_user_id is not null then
    raise exception 'This profile belongs to a member; they edit it themselves' using errcode = '42501';
  end if;

  if v_employer is not null then
    select o.id into org_id from public.organizations o where lower(o.name) = lower(v_employer) limit 1;
    if org_id is null then
      insert into public.organizations (name) values (v_employer) returning id into org_id;
    end if;
  end if;

  -- A corrected role becomes the current position; the old one moves to history.
  if v_title is not null and v_employer is not null
     and not exists (select 1 from public.positions pos
                      where pos.person_id = me.id and pos.is_current and pos.title = v_title
                        and lower(pos.organization_name) = lower(v_employer)) then
    -- Fixing a misread listing (same person, same job) replaces it rather than adding history.
    delete from public.positions where person_id = me.id and is_current and start_date is null and end_date is null;
    update public.positions set is_current = false, end_date = coalesce(end_date, current_date)
     where person_id = me.id and is_current;
    insert into public.positions (person_id, organization_id, organization_name, title, is_current)
    values (me.id, org_id, v_employer, v_title, true);
  end if;

  -- A city in the places list links to it (the trigger fills metro and map point);
  -- any other city is kept as text.
  if v_city is not null then
    select pl.id into v_place from public.places pl
     where lower(pl.name) = lower(v_city) and (v_state is null or pl.state = v_state)
     order by pl.population desc nulls last limit 1;
  end if;
  v_old_place := me.place_id;
  v_old_city := me.city;

  if v_name is distinct from me.full_name then changed := array_append(changed, 'full_name'); end if;
  if v_title is distinct from me.current_title then changed := array_append(changed, 'current_title'); end if;
  if org_id is distinct from me.current_organization_id then changed := array_append(changed, 'current_organization_id'); end if;
  if v_industry is distinct from me.industry_id then changed := array_append(changed, 'industry_id'); end if;
  if v_alumni is distinct from me.alumni_status then changed := array_append(changed, 'alumni_status'); end if;
  if v_place is distinct from v_old_place
     or (v_place is null and (v_city is distinct from v_old_city or v_state is distinct from me.state)) then
    changed := array_append(changed, 'location');
  end if;

  update public.people set
    full_name = v_name,
    first_name = split_part(v_name, ' ', 1),
    last_name = case when position(' ' in v_name) > 0 then regexp_replace(v_name, '^.* ', '') end,
    current_title = v_title,
    current_organization_id = org_id,
    headline = case when v_title is not null and v_employer is not null then v_title || ' at ' || v_employer else coalesce(v_title, v_employer) end,
    industry_id = v_industry,
    alumni_status = v_alumni,
    place_id = v_place,
    city = case when v_place is null then v_city else city end,
    state = case when v_place is null then v_state else state end,
    metro = case when v_place is null then null else metro end,
    location = case when v_place is null then null else location end
  where id = me.id;

  for item in select * from jsonb_array_elements(coalesce(p -> 'educations', '[]')) loop
    v_degree := nullif(trim(item ->> 'degree'), '');
    v_major := nullif(trim(item ->> 'major'), '');
    v_school := nullif(trim(item ->> 'school'), '');
    v_year := nullif(item ->> 'grad_year', '')::smallint;
    if v_year is not null and (v_year < 1900 or v_year > extract(year from now())::int + 6) then
      raise exception 'Class year must be between 1900 and %', extract(year from now())::int + 6 using errcode = '22023';
    end if;

    if nullif(item ->> 'id', '') is not null then
      if v_degree is null and v_major is null and v_year is null then
        delete from public.educations where id = (item ->> 'id')::uuid and person_id = me.id;
        v_edu_changed := v_edu_changed or found;
      else
        update public.educations
           set degree = v_degree, major = v_major, grad_year = v_year, school = v_school, verified_by = 'admin'
         where id = (item ->> 'id')::uuid and person_id = me.id
           and (degree, major, grad_year, school) is distinct from (v_degree, v_major, v_year, v_school);
        v_edu_changed := v_edu_changed or found;
      end if;
    elsif v_degree is not null or v_major is not null or v_year is not null then
      insert into public.educations (person_id, institution_id, school, degree, major, grad_year, verified_by)
      values (me.id, me.institution_id, v_school, v_degree, v_major, v_year, 'admin');
      v_edu_changed := true;
    end if;
  end loop;
  if v_edu_changed then changed := array_append(changed, 'educations'); end if;

  insert into public.field_provenance (person_id, field, source, confidence, fetched_at)
  select me.id, f, 'admin', 1, now() from unnest(changed) f
  on conflict (person_id, field, source) do update set fetched_at = excluded.fetched_at, confidence = 1;

  insert into public.profile_reviews (person_id, reviewed_by, reviewed_at, note, changed_fields)
  values (me.id, auth.uid(), now(), trim(p_note), changed)
  on conflict (person_id) do update
    set reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at,
        note = excluded.note, changed_fields = excluded.changed_fields;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, metadata)
  values (auth.uid(), 'profile.admin_review', 'people', me.id::text, jsonb_build_object('changed', changed));

  return jsonb_build_object('person_id', me.id, 'changed', changed);
end;
$$;

-- Approve or decline a claim that couldn't be matched by email.
create function public.admin_decide_claim(p_request_id uuid, p_approve boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.claim_requests;
  person public.people;
  member public.members;
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;

  select * into req from public.claim_requests where id = p_request_id for update;
  if not found then return jsonb_build_object('status', 'error', 'reason', 'not_found'); end if;
  if req.status <> 'pending' then return jsonb_build_object('status', 'error', 'reason', 'already_decided'); end if;

  if not p_approve then
    update public.claim_requests set status = 'rejected', decided_at = now(), decided_by = auth.uid() where id = req.id;
    insert into public.audit_log (actor_user_id, action, target_table, target_id)
    values (auth.uid(), 'claim.rejected', 'people', req.person_id::text);
    return jsonb_build_object('status', 'rejected');
  end if;

  select * into person from public.people where id = req.person_id for update;
  if person.claimed_by_user_id is not null and person.claimed_by_user_id <> req.user_id then
    return jsonb_build_object('status', 'error', 'reason', 'already_claimed');
  end if;
  select * into member from public.members where user_id = req.user_id for update;
  if not found then return jsonb_build_object('status', 'error', 'reason', 'no_account'); end if;
  if member.person_id is not null and member.person_id <> person.id then
    return jsonb_build_object('status', 'error', 'reason', 'has_other_profile');
  end if;

  update public.people set claimed_by_user_id = req.user_id, status = 'claimed', claimed_at = now() where id = person.id;
  update public.members
     set person_id = person.id,
         role = case when role = 'pending' then 'member' else role end,
         verification_method = coalesce(verification_method, 'admin'),
         verified_at = coalesce(verified_at, now())
   where user_id = req.user_id;
  update public.claim_requests set status = 'approved', decided_at = now(), decided_by = auth.uid() where id = req.id;
  -- Other people's pending claims on the same profile can't succeed now.
  update public.claim_requests set status = 'rejected', decided_at = now(), decided_by = auth.uid()
   where person_id = person.id and status = 'pending' and id <> req.id;
  if req.link_id is not null then update public.profile_links set claimed_at = now() where id = req.link_id; end if;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, metadata)
  values (auth.uid(), 'profile.claimed', 'people', person.id::text, jsonb_build_object('method', 'admin'));

  return jsonb_build_object('status', 'approved', 'person_id', person.id);
end;
$$;

revoke all on function public.admin_review_queue(), public.admin_review_profile(uuid, jsonb, text),
  public.admin_decide_claim(uuid, boolean) from public, anon;
grant execute on function public.admin_review_queue(), public.admin_review_profile(uuid, jsonb, text),
  public.admin_decide_claim(uuid, boolean) to authenticated;
