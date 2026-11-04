-- Self-service profile editing for members who have claimed their profile.
-- Both functions act only on the caller's own profile (auth.uid()), record
-- 'self' as the source of every field they touch (member edits win over
-- imported data), and run as one transaction.

-- Changing an email (or any contact value) clears its verified label until it
-- is verified again.
create function public.contact_points_reset_verification() returns trigger
language plpgsql
as $$
begin
  if new.value is distinct from old.value then
    new.verified_at := null;
  end if;
  return new;
end;
$$;

create trigger contact_points_reset_verification
  before update on public.contact_points
  for each row execute function public.contact_points_reset_verification();

create function public.record_self_provenance(p_person_id uuid, p_fields text[])
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.field_provenance (person_id, field, source, confidence, fetched_at)
  select p_person_id, f, 'self', 1, now() from unnest(p_fields) f
  on conflict (person_id, field, source) do update set fetched_at = excluded.fetched_at, confidence = 1;
$$;

revoke all on function public.record_self_provenance(uuid, text[]) from public, anon, authenticated;

-- p: { full_name, current_title, employer, place_id, industry_id, class_year,
--      school, degree, major, open_to[], bio }  (validated by the app first)
create function public.update_my_profile(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.people;
  org_id uuid;
  v_employer text := nullif(trim(p ->> 'employer'), '');
  v_title text := nullif(trim(p ->> 'current_title'), '');
  v_name text := nullif(trim(p ->> 'full_name'), '');
  v_class_year smallint := nullif(p ->> 'class_year', '')::smallint;
  v_place integer := nullif(p ->> 'place_id', '')::integer;
  v_clear_location boolean;
begin
  select * into me from public.people where claimed_by_user_id = auth.uid() for update;
  if not found then raise exception 'You have not claimed a profile' using errcode = 'P0002'; end if;
  if v_name is null then raise exception 'Full name is required' using errcode = '22023'; end if;
  -- Only clear the location when the member switches a listed city to "not shared";
  -- a city we know only as text (not in the places list) is left alone.
  v_clear_location := v_place is null and me.place_id is not null;

  if v_employer is not null then
    select o.id into org_id from public.organizations o where lower(o.name) = lower(v_employer) limit 1;
    if org_id is null then
      insert into public.organizations (name) values (v_employer) returning id into org_id;
    end if;
  end if;

  -- A new title or employer becomes the current position; the old one moves to history.
  if v_title is not null and v_employer is not null
     and not exists (select 1 from public.positions pos
                      where pos.person_id = me.id and pos.is_current and pos.title = v_title
                        and lower(pos.organization_name) = lower(v_employer)) then
    update public.positions set is_current = false, end_date = coalesce(end_date, current_date)
     where person_id = me.id and is_current;
    insert into public.positions (person_id, organization_id, organization_name, title, start_date, is_current)
    values (me.id, org_id, v_employer, v_title, current_date, true);
  end if;

  update public.people set
    full_name = v_name,
    first_name = split_part(v_name, ' ', 1),
    last_name = case when position(' ' in v_name) > 0 then regexp_replace(v_name, '^.* ', '') end,
    current_title = v_title,
    current_organization_id = org_id,
    headline = case when v_title is not null and v_employer is not null then v_title || ' at ' || v_employer else coalesce(v_title, v_employer) end,
    place_id = v_place,
    city = case when v_clear_location then null else city end,
    state = case when v_clear_location then null else state end,
    metro = case when v_clear_location then null else metro end,
    location = case when v_clear_location then null else location end,
    industry_id = nullif(p ->> 'industry_id', '')::integer,
    open_to = coalesce(array(select jsonb_array_elements_text(p -> 'open_to')), '{}'),
    bio = nullif(trim(p ->> 'bio'), '')
  where id = me.id;

  -- The member's own education entry replaces imported/AI-extracted ones;
  -- roster- or admin-verified rows are kept.
  if v_class_year is not null or nullif(trim(p ->> 'degree'), '') is not null or nullif(trim(p ->> 'school'), '') is not null then
    delete from public.educations where person_id = me.id and (verified_by is null or verified_by = 'source');
    insert into public.educations (person_id, institution_id, school, degree, major, grad_year)
    values (me.id, me.institution_id, nullif(trim(p ->> 'school'), ''), nullif(trim(p ->> 'degree'), ''),
            nullif(trim(p ->> 'major'), ''), v_class_year);
  end if;

  perform public.record_self_provenance(me.id,
    array['full_name', 'current_title', 'current_organization_id', 'location', 'industry_id', 'educations', 'open_to', 'bio']);
  insert into public.audit_log (actor_user_id, action, target_table, target_id)
  values (auth.uid(), 'profile.self_edit', 'people', me.id::text);

  return jsonb_build_object('person_id', me.id);
end;
$$;

-- p: [{ kind: email|phone|website|linkedin, value, visibility: members|connections|private }]
-- One entry per kind; an empty value deletes that kind's details.
create function public.update_my_contacts(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid;
  item jsonb;
  new_value text;
  existing public.contact_points;
begin
  select id into me from public.people where claimed_by_user_id = auth.uid();
  if me is null then raise exception 'You have not claimed a profile' using errcode = 'P0002'; end if;

  for item in select * from jsonb_array_elements(p) loop
    if item ->> 'kind' not in ('email', 'phone', 'website', 'linkedin') then continue; end if;
    if item ->> 'visibility' not in ('members', 'connections', 'private') then
      raise exception 'Invalid visibility' using errcode = '22023';
    end if;
    new_value := nullif(trim(item ->> 'value'), '');

    select * into existing from public.contact_points
     where person_id = me and kind = item ->> 'kind'
     order by (source = 'self') desc, created_at limit 1;

    if new_value is null then
      delete from public.contact_points where person_id = me and kind = item ->> 'kind';
    elsif existing.id is null then
      insert into public.contact_points (person_id, kind, value, label, source, visibility)
      values (me, item ->> 'kind', new_value, 'work', 'self', item ->> 'visibility');
    else
      -- Editing an imported value makes it member-provided; the trigger clears
      -- verification if the value itself changed.
      update public.contact_points
         set value = new_value,
             visibility = item ->> 'visibility',
             source = case when value is distinct from new_value then 'self' else source end
       where id = existing.id;
      delete from public.contact_points where person_id = me and kind = item ->> 'kind' and id <> existing.id;
    end if;
  end loop;

  perform public.record_self_provenance(me, array['contact_points']);
end;
$$;

revoke all on function public.update_my_profile(jsonb), public.update_my_contacts(jsonb) from public, anon;
grant execute on function public.update_my_profile(jsonb), public.update_my_contacts(jsonb) to authenticated;
