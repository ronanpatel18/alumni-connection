-- Row-level security. Rules:
--   * Only verified members (and admins) can read profiles.
--   * Each contact detail is shown according to its own visibility.
--   * Notes, saved contacts, trips and other CRM rows belong to their author.
--   * Members can't change their own role or verification status.
-- Server-side jobs (enrichment, imports, admin actions) use the service role,
-- which bypasses RLS; every other path goes through these policies.

-- ---------------------------------------------------------------------------
-- Helper functions (security definer so policies don't recurse through RLS)
-- ---------------------------------------------------------------------------

create function public.member_role() returns text
language sql stable security definer set search_path = public
as $$ select role from public.members where user_id = auth.uid() $$;

create function public.is_verified_member() returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(public.member_role() in ('member', 'chapter_leader', 'admin', 'super_admin'), false) $$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(public.member_role() in ('admin', 'super_admin'), false) $$;

create function public.my_person_id() returns uuid
language sql stable security definer set search_path = public
as $$ select id from public.people where claimed_by_user_id = auth.uid() limit 1 $$;

create function public.owns_person(target uuid) returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.people where id = target and claimed_by_user_id = auth.uid()) $$;

-- "Connections" = relationships made through the network (met, introduced, mentor).
create function public.is_connected_to(target uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.edges e
     where e.owner_user_id is null
       and e.kind in ('met', 'introduced', 'mentor')
       and public.my_person_id() is not null
       and ((e.person_a = public.my_person_id() and e.person_b = target)
         or (e.person_b = public.my_person_id() and e.person_a = target))
  )
$$;

-- ---------------------------------------------------------------------------
-- Privileges: deny by default, then grant per table / column
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select on public.institutions, public.industries, public.places to anon, authenticated;

grant select on
  public.organizations, public.people, public.educations, public.positions, public.contact_points,
  public.field_provenance, public.edges, public.members, public.suppression_list,
  public.enrichment_jobs, public.audit_log
to authenticated;

-- Profile owners may edit only these columns; status, claims and AI fields are server-managed.
grant update (preferred_name, headline, bio, specialties, open_to, place_id) on public.people to authenticated;

grant insert, update, delete on public.educations, public.positions to authenticated;
grant insert, delete on public.contact_points to authenticated;
grant update (value, label, visibility) on public.contact_points to authenticated;
grant insert, delete on public.edges to authenticated;

grant select, insert, update, delete on public.saved_contacts, public.notes, public.interactions, public.trips to authenticated;
grant select, delete on public.recommendations to authenticated;
grant select, insert on public.intro_requests to authenticated;
grant update (status, connector_note, updated_at) on public.intro_requests to authenticated;

grant execute on function
  public.member_role(), public.is_verified_member(), public.is_admin(),
  public.my_person_id(), public.owns_person(uuid), public.is_connected_to(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------

alter table public.institutions      enable row level security;
alter table public.industries        enable row level security;
alter table public.places            enable row level security;
alter table public.organizations     enable row level security;
alter table public.people            enable row level security;
alter table public.educations        enable row level security;
alter table public.positions         enable row level security;
alter table public.contact_points    enable row level security;
alter table public.field_provenance  enable row level security;
alter table public.edges             enable row level security;
alter table public.members           enable row level security;
alter table public.suppression_list  enable row level security;
alter table public.enrichment_jobs   enable row level security;
alter table public.audit_log         enable row level security;
alter table public.saved_contacts    enable row level security;
alter table public.notes             enable row level security;
alter table public.interactions      enable row level security;
alter table public.intro_requests    enable row level security;
alter table public.trips             enable row level security;
alter table public.recommendations   enable row level security;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

create policy "reference data is public" on public.institutions for select to anon, authenticated using (true);
create policy "reference data is public" on public.industries   for select to anon, authenticated using (true);
create policy "reference data is public" on public.places       for select to anon, authenticated using (true);

create policy "members read organizations" on public.organizations
  for select to authenticated using (public.is_verified_member());

create policy "members read profiles" on public.people
  for select to authenticated
  using ((public.is_verified_member() and status <> 'opted_out') or claimed_by_user_id = auth.uid());

create policy "owners update their profile" on public.people
  for update to authenticated
  using (claimed_by_user_id = auth.uid())
  with check (claimed_by_user_id = auth.uid());

-- Education and positions follow the visibility of the profile they belong to.
create policy "read with profile" on public.educations
  for select to authenticated using (exists (select 1 from public.people p where p.id = person_id));
create policy "owners manage" on public.educations
  for all to authenticated using (public.owns_person(person_id)) with check (public.owns_person(person_id));

create policy "read with profile" on public.positions
  for select to authenticated using (exists (select 1 from public.people p where p.id = person_id));
create policy "owners manage" on public.positions
  for all to authenticated using (public.owns_person(person_id)) with check (public.owns_person(person_id));

create policy "visible contact details" on public.contact_points
  for select to authenticated
  using (
    public.owns_person(person_id)
    or public.is_admin()
    or (
      public.is_verified_member()
      and exists (select 1 from public.people p where p.id = person_id)
      and (visibility = 'members' or (visibility = 'connections' and public.is_connected_to(person_id)))
    )
  );
create policy "owners add their own details" on public.contact_points
  for insert to authenticated
  with check (public.owns_person(person_id) and source = 'self' and verified_at is null);
create policy "owners edit their details" on public.contact_points
  for update to authenticated
  using (public.owns_person(person_id)) with check (public.owns_person(person_id));
create policy "owners delete their details" on public.contact_points
  for delete to authenticated using (public.owns_person(person_id));

create policy "owners and admins read provenance" on public.field_provenance
  for select to authenticated using (public.owns_person(person_id) or public.is_admin());

create policy "read network edges" on public.edges
  for select to authenticated
  using (
    owner_user_id = auth.uid()
    or (owner_user_id is null and public.is_verified_member())
    or (shared_by_consent and public.is_verified_member())
  );
create policy "members import their own connections" on public.edges
  for insert to authenticated
  with check (owner_user_id = auth.uid() and kind = 'linkedin_import' and public.is_verified_member());
create policy "members delete their own connections" on public.edges
  for delete to authenticated using (owner_user_id = auth.uid());

create policy "read own membership" on public.members
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

create policy "admins read" on public.suppression_list for select to authenticated using (public.is_admin());
create policy "admins read" on public.enrichment_jobs  for select to authenticated using (public.is_admin());
create policy "admins read" on public.audit_log        for select to authenticated using (public.is_admin());

create policy "own saved contacts" on public.saved_contacts
  for all to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid() and public.is_verified_member());

create policy "own notes" on public.notes
  for all to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid() and public.is_verified_member());

create policy "own interactions" on public.interactions
  for all to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid() and public.is_verified_member());

create policy "own trips" on public.trips
  for all to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid() and public.is_verified_member());

create policy "own recommendations" on public.recommendations
  for all to authenticated using (owner_user_id = auth.uid());

create policy "parties read intro requests" on public.intro_requests
  for select to authenticated
  using (
    requester_user_id = auth.uid()
    or connector_person_id = public.my_person_id()
    or (target_person_id = public.my_person_id() and status <> 'pending_connector')
    or public.is_admin()
  );
create policy "members request intros" on public.intro_requests
  for insert to authenticated
  with check (requester_user_id = auth.uid() and public.is_verified_member() and status = 'pending_connector');
-- WITH CHECK clauses of permissive policies are OR'ed together, so each one
-- re-checks who is acting, not just the new status.
create policy "connector responds" on public.intro_requests
  for update to authenticated
  using (connector_person_id = public.my_person_id() and status = 'pending_connector')
  with check (connector_person_id = public.my_person_id() and status in ('pending_target', 'declined'));
create policy "target responds" on public.intro_requests
  for update to authenticated
  using (target_person_id = public.my_person_id() and status = 'pending_target')
  with check (target_person_id = public.my_person_id() and status in ('accepted', 'declined'));
create policy "requester cancels" on public.intro_requests
  for update to authenticated
  using (requester_user_id = auth.uid() and status in ('pending_connector', 'pending_target'))
  with check (requester_user_id = auth.uid() and status = 'cancelled');
