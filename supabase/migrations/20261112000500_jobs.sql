-- Jobs and referrals (design/prototypes/screens/jobs.html). A member posts an
-- opening at their employer (or one they know of) and says whether they're
-- willing to refer. Asking for a referral is a private message to the poster.

create table public.job_posts (
  id                 uuid primary key default gen_random_uuid(),
  posted_by          uuid not null references auth.users (id) on delete cascade,
  title              text not null check (char_length(title) between 1 and 200),
  organization_name  text not null check (char_length(organization_name) between 1 and 200),
  location           text check (char_length(location) <= 200),
  is_remote          boolean not null default false,
  employment_type    text not null default 'full_time'
                     check (employment_type in ('full_time', 'part_time', 'contract', 'internship')),
  industry_id        integer references public.industries (id),
  description        text check (char_length(description) <= 5000),
  url                text check (url is null or url ~* '^https?://'),
  can_refer          boolean not null default false,
  expires_on         date not null default (current_date + 60),
  closed_at          timestamptz,
  created_at         timestamptz not null default now()
);
create index job_posts_open_idx on public.job_posts (expires_on) where closed_at is null;

alter table public.job_posts enable row level security;
revoke all on public.job_posts from anon, authenticated;
grant select, insert, delete on public.job_posts to authenticated;
grant update (title, organization_name, location, is_remote, employment_type, industry_id, description, url, can_refer, expires_on, closed_at)
  on public.job_posts to authenticated;

create policy "members read jobs" on public.job_posts
  for select to authenticated using (public.is_verified_member());
create policy "members post jobs" on public.job_posts
  for insert to authenticated with check (posted_by = auth.uid() and public.is_verified_member());
create policy "posters and admins change jobs" on public.job_posts
  for update to authenticated
  using (posted_by = auth.uid() or public.is_admin())
  with check (posted_by = auth.uid() or public.is_admin());
create policy "posters and admins delete jobs" on public.job_posts
  for delete to authenticated using (posted_by = auth.uid() or public.is_admin());

-- Open jobs, newest first, with the poster's name and profile (for a referral request).
create function public.job_board()
returns table (id uuid, title text, organization_name text, location text, is_remote boolean, employment_type text,
               industry_id integer, industry_name text, description text, url text, can_refer boolean, expires_on date,
               created_at timestamptz, poster_name text, poster_person_id uuid, is_mine boolean)
language sql
stable
security definer
set search_path = public
as $$
  select j.id, j.title, j.organization_name, j.location, j.is_remote, j.employment_type, j.industry_id,
         (select i.name from public.industries i where i.id = j.industry_id),
         j.description, j.url, j.can_refer, j.expires_on, j.created_at,
         public.member_display_name(j.posted_by),
         (select p.id from public.people p where p.claimed_by_user_id = j.posted_by limit 1),
         j.posted_by = auth.uid()
    from public.job_posts j
   where public.is_verified_member()
     and ((j.closed_at is null and j.expires_on >= current_date) or j.posted_by = auth.uid())
   order by j.created_at desc
   limit 300;
$$;

revoke all on function public.job_board() from public, anon;
grant execute on function public.job_board() to authenticated;
