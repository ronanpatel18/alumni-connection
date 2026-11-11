-- Mentorship (design/prototypes/screens/mentorship.html). Mentors are members
-- who marked themselves open to mentoring. A member with a profile asks; the
-- mentor accepts or declines. Accepting records a "mentor" connection between
-- the two, which is what unlocks contact details shared with connections.

create table public.mentorships (
  id                uuid primary key default gen_random_uuid(),
  mentee_user_id    uuid not null references auth.users (id) on delete cascade,
  mentor_person_id  uuid not null references public.people (id) on delete cascade,
  goal              text not null check (char_length(goal) between 1 and 1000),
  status            text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'ended')),
  created_at        timestamptz not null default now(),
  responded_at      timestamptz
);
-- One open or active mentorship per pair.
create unique index mentorships_pair_idx on public.mentorships (mentee_user_id, mentor_person_id) where status in ('pending', 'accepted');
create index mentorships_mentor_idx on public.mentorships (mentor_person_id);

alter table public.mentorships enable row level security;
revoke all on public.mentorships from anon, authenticated;
grant select on public.mentorships to authenticated;
create policy "the two people read a mentorship" on public.mentorships
  for select to authenticated using (mentee_user_id = auth.uid() or public.owns_person(mentor_person_id));

create function public.request_mentorship(p_mentor uuid, p_goal text) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mentor_user uuid;
  v_open text[];
  v_id uuid;
begin
  if not public.is_verified_member() then raise exception 'Verified members only' using errcode = '42501'; end if;
  if public.my_person_id() is null then raise exception 'Set up your own profile before asking for a mentor' using errcode = '22023'; end if;
  select claimed_by_user_id, open_to into v_mentor_user, v_open from public.people where id = p_mentor and status <> 'opted_out';
  if v_mentor_user is null then raise exception 'This person hasn''t joined yet' using errcode = 'P0002'; end if;
  if v_mentor_user = auth.uid() then raise exception 'That''s your own profile' using errcode = '22023'; end if;
  if not ('mentoring' = any (v_open)) then raise exception 'This person isn''t taking mentees right now' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_goal, ''))) = 0 then raise exception 'Say what you''d like help with' using errcode = '22023'; end if;
  if exists (select 1 from public.mentorships where mentee_user_id = auth.uid() and mentor_person_id = p_mentor and status in ('pending', 'accepted')) then
    raise exception 'You''ve already asked this person' using errcode = '23505';
  end if;
  if (select count(*) from public.mentorships where mentee_user_id = auth.uid() and created_at > now() - interval '7 days') >= 5 then
    raise exception 'You''ve asked 5 mentors this week. Give them time to answer.' using errcode = '54000';
  end if;

  insert into public.mentorships (mentee_user_id, mentor_person_id, goal)
  values (auth.uid(), p_mentor, left(trim(p_goal), 1000)) returning id into v_id;
  insert into public.notifications (user_id, kind, title, link, ref_id)
  values (v_mentor_user, 'mentorship', public.member_display_name(auth.uid()) || ' asked you to be their mentor', '/mentorship', v_id);
  return v_id;
end;
$$;

create function public.respond_to_mentorship(p_mentorship uuid, p_accept boolean) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.mentorships;
  v_mentee_person uuid;
begin
  select * into m from public.mentorships where id = p_mentorship for update;
  if not found or not public.owns_person(m.mentor_person_id) then raise exception 'This request isn''t yours to answer' using errcode = '42501'; end if;
  if m.status <> 'pending' then raise exception 'This request was already answered' using errcode = '22023'; end if;
  update public.mentorships set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now() where id = m.id;

  if p_accept then
    select id into v_mentee_person from public.people where claimed_by_user_id = m.mentee_user_id limit 1;
    if v_mentee_person is not null and not exists (
      select 1 from public.edges e
       where e.kind = 'mentor' and e.owner_user_id is null
         and e.person_a = least(v_mentee_person, m.mentor_person_id) and e.person_b = greatest(v_mentee_person, m.mentor_person_id)
    ) then
      insert into public.edges (person_a, person_b, kind, source)
      values (least(v_mentee_person, m.mentor_person_id), greatest(v_mentee_person, m.mentor_person_id), 'mentor', 'mentorship');
    end if;
  end if;
  -- A decline is worded gently and carries no reason.
  insert into public.notifications (user_id, kind, title, link, ref_id)
  values (m.mentee_user_id, 'mentorship',
          (select full_name from public.people where id = m.mentor_person_id)
            || case when p_accept then ' agreed to mentor you' else ' can''t take on a mentee right now' end,
          '/mentorship', m.id);
end;
$$;

-- Either person can end it; the connection it created is removed with it.
create function public.end_mentorship(p_mentorship uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.mentorships;
  v_mentee_person uuid;
begin
  select * into m from public.mentorships where id = p_mentorship for update;
  if not found or not (m.mentee_user_id = auth.uid() or public.owns_person(m.mentor_person_id)) then
    raise exception 'This mentorship isn''t yours' using errcode = '42501';
  end if;
  if m.status not in ('pending', 'accepted') then return; end if;
  update public.mentorships set status = 'ended', responded_at = now() where id = m.id;
  select id into v_mentee_person from public.people where claimed_by_user_id = m.mentee_user_id limit 1;
  delete from public.edges e
   where e.kind = 'mentor' and e.source = 'mentorship' and e.owner_user_id is null
     and e.person_a = least(v_mentee_person, m.mentor_person_id) and e.person_b = greatest(v_mentee_person, m.mentor_person_id);
end;
$$;

-- The member's mentorships in both directions, with the other person's name.
create function public.my_mentorships()
returns table (id uuid, goal text, status text, created_at timestamptz, i_am_mentor boolean, other_name text, other_person_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.goal, m.status, m.created_at,
         public.owns_person(m.mentor_person_id),
         case when public.owns_person(m.mentor_person_id) then public.member_display_name(m.mentee_user_id)
              else (select full_name from public.people where id = m.mentor_person_id) end,
         case when public.owns_person(m.mentor_person_id) then (select p.id from public.people p where p.claimed_by_user_id = m.mentee_user_id limit 1)
              else m.mentor_person_id end
    from public.mentorships m
   where m.mentee_user_id = auth.uid() or public.owns_person(m.mentor_person_id)
   order by m.created_at desc;
$$;

revoke all on function public.request_mentorship(uuid, text), public.respond_to_mentorship(uuid, boolean),
  public.end_mentorship(uuid), public.my_mentorships() from public, anon;
grant execute on function public.request_mentorship(uuid, text), public.respond_to_mentorship(uuid, boolean),
  public.end_mentorship(uuid), public.my_mentorships() to authenticated;
