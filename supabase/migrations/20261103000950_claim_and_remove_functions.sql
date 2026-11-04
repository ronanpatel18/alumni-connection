-- Server-only operations behind the private claim/remove links. Each runs as
-- one transaction. Only the service role may call them; the app hashes the
-- token (SHA-256, hex) before calling, so raw tokens never reach the database.

-- What the link page may show: just enough to recognize your own record.
create function public.profile_link_identity(p_token_sha256 text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.profile_links;
  person public.people;
  class_year smallint;
begin
  select * into link from public.profile_links where token_sha256 = p_token_sha256;
  if not found then return jsonb_build_object('state', 'invalid'); end if;
  if link.removed_at is not null or link.person_id is null then return jsonb_build_object('state', 'removed'); end if;
  if link.expires_at < now() then return jsonb_build_object('state', 'expired'); end if;

  select * into person from public.people where id = link.person_id;
  if person.status = 'opted_out' then return jsonb_build_object('state', 'removed'); end if;
  select min(grad_year) into class_year from public.educations where person_id = person.id;

  return jsonb_build_object(
    'state', case when person.claimed_by_user_id is not null then 'claimed' else 'valid' end,
    'name', person.full_name,
    'class_year', class_year,
    'groups', coalesce((select jsonb_agg(g.name order by g.name)
                          from public.group_memberships gm join public.groups g on g.id = gm.group_id
                         where gm.person_id = person.id), '[]'::jsonb)
  );
end;
$$;

-- Claim: approved at once when the signed-in email matches an email on file
-- for the profile; otherwise recorded for an administrator to confirm.
create function public.claim_profile(p_token_sha256 text, p_user_id uuid, p_user_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.profile_links;
  person public.people;
  member public.members;
  email_matches boolean;
begin
  select * into link from public.profile_links where token_sha256 = p_token_sha256 for update;
  if not found then return jsonb_build_object('status', 'error', 'reason', 'invalid_link'); end if;
  if link.removed_at is not null or link.person_id is null then return jsonb_build_object('status', 'error', 'reason', 'removed'); end if;
  if link.expires_at < now() then return jsonb_build_object('status', 'error', 'reason', 'expired'); end if;

  select * into person from public.people where id = link.person_id for update;
  if person.status = 'opted_out' then return jsonb_build_object('status', 'error', 'reason', 'removed'); end if;
  if person.claimed_by_user_id = p_user_id then
    return jsonb_build_object('status', 'approved', 'person_id', person.id, 'name', person.full_name);
  end if;
  if person.claimed_by_user_id is not null then return jsonb_build_object('status', 'error', 'reason', 'already_claimed'); end if;

  select * into member from public.members where user_id = p_user_id for update;
  if not found then return jsonb_build_object('status', 'error', 'reason', 'no_account'); end if;
  if member.person_id is not null and member.person_id <> person.id then
    return jsonb_build_object('status', 'error', 'reason', 'has_other_profile');
  end if;

  email_matches := exists (
    select 1 from public.contact_points
     where person_id = person.id and kind = 'email' and lower(value) = lower(p_user_email)
  );

  insert into public.claim_requests (person_id, user_id, link_id, method, status, decided_at)
  values (person.id, p_user_id, link.id,
          case when email_matches then 'email_match' else 'manual' end,
          case when email_matches then 'approved' else 'pending' end,
          case when email_matches then now() end)
  on conflict (person_id, user_id) do update
    set method = excluded.method, status = excluded.status, decided_at = excluded.decided_at, link_id = excluded.link_id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, metadata)
  values (p_user_id, case when email_matches then 'profile.claimed' else 'profile.claim_requested' end,
          'people', person.id::text, jsonb_build_object('method', case when email_matches then 'email_match' else 'manual' end));

  if not email_matches then
    return jsonb_build_object('status', 'pending', 'person_id', person.id, 'name', person.full_name);
  end if;

  update public.people
     set claimed_by_user_id = p_user_id, status = 'claimed', claimed_at = now()
   where id = person.id;
  update public.members
     set person_id = person.id,
         role = case when role = 'pending' then 'member' else role end,
         verification_method = coalesce(verification_method, 'claim_code'),
         verified_at = coalesce(verified_at, now())
   where user_id = p_user_id;
  update public.profile_links set claimed_at = now() where id = link.id;

  return jsonb_build_object('status', 'approved', 'person_id', person.id, 'name', person.full_name);
end;
$$;

-- Remove: no account needed. Deletes the profile and everything derived from
-- it (positions, contacts, provenance, memberships, edges, others' notes about
-- them), keeping only a minimal suppression record so imports skip them.
create function public.remove_profile_by_link(p_token_sha256 text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.profile_links;
  person public.people;
  ext record;
  wrote_suppression boolean := false;
begin
  select * into link from public.profile_links where token_sha256 = p_token_sha256 for update;
  if not found then return jsonb_build_object('status', 'error', 'reason', 'invalid_link'); end if;
  if link.removed_at is not null or link.person_id is null then return jsonb_build_object('status', 'removed'); end if;
  if link.expires_at < now() then return jsonb_build_object('status', 'error', 'reason', 'expired'); end if;

  select * into person from public.people where id = link.person_id for update;

  for ext in select source, external_id from public.person_external_ids where person_id = person.id loop
    insert into public.suppression_list (institution_id, full_name, source, external_id, reason)
    values (person.institution_id, person.full_name, ext.source, ext.external_id, 'Self-removal via private link')
    on conflict (source, external_id) where source is not null and external_id is not null do nothing;
    wrote_suppression := true;
  end loop;

  insert into public.suppression_list (institution_id, full_name, email_sha256, reason)
  select person.institution_id, person.full_name, encode(sha256(convert_to(lower(cp.value), 'UTF8')), 'hex'), 'Self-removal via private link'
    from public.contact_points cp
   where cp.person_id = person.id and cp.kind = 'email';
  if found then wrote_suppression := true; end if;

  if not wrote_suppression then
    insert into public.suppression_list (institution_id, full_name, reason)
    values (person.institution_id, person.full_name, 'Self-removal via private link');
  end if;

  -- The audit entry records that a removal happened, not who was removed.
  insert into public.audit_log (action, target_table, metadata)
  values ('profile.removed_by_subject', 'people', jsonb_build_object('link_id', link.id));

  update public.profile_links set removed_at = now(), person_id = null where person_id = person.id;
  delete from public.people where id = person.id;

  return jsonb_build_object('status', 'removed');
end;
$$;

revoke all on function public.profile_link_identity(text), public.claim_profile(text, uuid, text),
  public.remove_profile_by_link(text) from public, anon, authenticated;
grant execute on function public.profile_link_identity(text), public.claim_profile(text, uuid, text),
  public.remove_profile_by_link(text) to service_role;
