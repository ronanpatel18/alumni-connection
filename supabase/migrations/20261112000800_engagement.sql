-- Engagement dashboard for administrators: is the network being used? Counts
-- only, never who did what. "Active" means a member did at least one thing in
-- the last 30 days (sent a message, saved someone, asked for an introduction,
-- proposed a meeting, logged a conversation, planned a trip, posted or RSVPed).

create function public.admin_engagement_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;

  with since as (select now() - interval '30 days' as t),
  verified as (select user_id, verified_at from public.members where role <> 'pending'),
  actions as (
    select sender_user_id as user_id, created_at from public.messages where sender_user_id is not null
    union all select owner_user_id, created_at from public.saved_contacts
    union all select requester_user_id, created_at from public.intro_requests
    union all select proposed_by, created_at from public.meetings
    union all select owner_user_id, created_at from public.interactions
    union all select owner_user_id, created_at from public.trips
    union all select created_by, created_at from public.events
    union all select user_id, created_at from public.event_rsvps
    union all select posted_by, created_at from public.job_posts
    union all select owner_user_id, created_at from public.business_listings
    union all select mentee_user_id, created_at from public.mentorships
  ),
  weeks as (
    select generate_series(date_trunc('week', now()) - interval '7 weeks', date_trunc('week', now()), interval '1 week') as week
  )
  select jsonb_build_object(
    'members',          (select count(*) from verified),
    'new_members_30d',  (select count(*) from verified, since where verified_at >= since.t),
    'active_30d',       (select count(distinct a.user_id) from actions a join verified v on v.user_id = a.user_id, since where a.created_at >= since.t),
    'profiles',         (select count(*) from public.people where status <> 'opted_out'),
    'claimed_profiles', (select count(*) from public.people where claimed_by_user_id is not null and status <> 'opted_out'),
    'last_30d', jsonb_build_object(
      'messages',       (select count(*) from public.messages, since where created_at >= since.t),
      'conversations',  (select count(*) from public.conversations, since where created_at >= since.t),
      'saved',          (select count(*) from public.saved_contacts, since where created_at >= since.t),
      'intros_asked',   (select count(*) from public.intro_requests, since where created_at >= since.t),
      'intros_made',    (select count(*) from public.intro_requests, since where status = 'accepted' and updated_at >= since.t),
      'meetings_proposed', (select count(*) from public.meetings, since where created_at >= since.t),
      'meetings_booked',   (select count(*) from public.meetings, since where status = 'accepted' and responded_at >= since.t),
      'follow_ups',     (select count(*) from public.interactions, since where created_at >= since.t),
      'trips',          (select count(*) from public.trips, since where created_at >= since.t),
      'events',         (select count(*) from public.events, since where created_at >= since.t),
      'rsvps',          (select count(*) from public.event_rsvps, since where created_at >= since.t),
      'jobs',           (select count(*) from public.job_posts, since where created_at >= since.t),
      'businesses',     (select count(*) from public.business_listings, since where created_at >= since.t),
      'mentorships_asked',  (select count(*) from public.mentorships, since where created_at >= since.t),
      'mentorships_agreed', (select count(*) from public.mentorships, since where status = 'accepted' and responded_at >= since.t)
    ),
    'weekly', (
      select jsonb_agg(jsonb_build_object(
               'week', to_char(w.week, 'YYYY-MM-DD'),
               'active', (select count(distinct a.user_id) from actions a where a.created_at >= w.week and a.created_at < w.week + interval '1 week'),
               'joined', (select count(*) from verified v where v.verified_at >= w.week and v.verified_at < w.week + interval '1 week')
             ) order by w.week)
        from weeks w
    )
  ) into result;
  return result;
end;
$$;

revoke all on function public.admin_engagement_metrics() from public, anon;
grant execute on function public.admin_engagement_metrics() to authenticated;
