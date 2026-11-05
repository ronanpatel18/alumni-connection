-- Every contact detail is now visible to all verified members, whatever its
-- visibility value. Pending users and signed-out visitors still see none, and
-- a profile hidden from the viewer keeps its details hidden too.
--
-- contact_points.visibility is kept, and still records what each person last
-- chose: restoring the previous policy would bring those choices back.

drop policy "visible contact details" on public.contact_points;

create policy "verified members read contact details" on public.contact_points
  for select to authenticated
  using (
    public.owns_person(person_id)
    or public.is_admin()
    or (public.is_verified_member() and exists (select 1 from public.people p where p.id = person_id))
  );
