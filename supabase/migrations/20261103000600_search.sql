-- Directory search. Both functions are SECURITY INVOKER, so they only ever
-- see the rows the caller's RLS policies allow.

-- Shared filter: returns matching people with a text rank and distance.
create function public.search_filter(
  p_text            text     default null,
  p_industry_slugs  text[]   default null,
  p_place_id        integer  default null,
  p_radius_miles    numeric  default 50,
  p_grad_year_min   integer  default null,
  p_grad_year_max   integer  default null,
  p_open_to         text[]   default null,
  p_confirmed_only  boolean  default false,
  p_group_slug      text     default null
)
returns table (person_id uuid, text_rank real, distance_miles double precision)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with origin as (
    select location from public.places where id = p_place_id
  ),
  q as (
    select case when nullif(trim(p_text), '') is null then null
                else websearch_to_tsquery('english', p_text) end as tsq,
           nullif(trim(p_text), '') as raw
  )
  select p.id,
         case when q.raw is null then 0::real
              else ts_rank(p.search_tsv, q.tsq) + similarity(p.full_name, q.raw) end,
         case when o.location is null or p.location is null then null
              else st_distance(p.location, o.location) / 1609.344 end
    from public.people p
    cross join q
    left join origin o on true
    left join public.industries i on i.id = p.industry_id
    left join public.industries ip on ip.id = i.parent_id
    left join public.organizations org on org.id = p.current_organization_id
   where p.status <> 'opted_out'
     and (not p_confirmed_only or p.status in ('claimed', 'verified'))
     and (q.raw is null
          or p.search_tsv @@ q.tsq
          or p.full_name % q.raw
          or strpos(lower(org.name), lower(q.raw)) > 0)
     and (p_industry_slugs is null or cardinality(p_industry_slugs) = 0
          or i.slug = any (p_industry_slugs) or ip.slug = any (p_industry_slugs))
     and (p_place_id is null
          or (o.location is not null and st_dwithin(p.location, o.location, p_radius_miles * 1609.344)))
     and (p_open_to is null or cardinality(p_open_to) = 0 or p.open_to && p_open_to)
     and (p_group_slug is null
          or exists (select 1 from public.group_memberships gm join public.groups g on g.id = gm.group_id
                      where gm.person_id = p.id and g.slug = p_group_slug))
     and (p_grad_year_min is null and p_grad_year_max is null
          or exists (select 1 from public.educations e
                      where e.person_id = p.id
                        and e.grad_year between coalesce(p_grad_year_min, 1900) and coalesce(p_grad_year_max, 2100)))
$$;

create function public.search_people(
  p_text            text     default null,
  p_industry_slugs  text[]   default null,
  p_place_id        integer  default null,
  p_radius_miles    numeric  default 50,
  p_grad_year_min   integer  default null,
  p_grad_year_max   integer  default null,
  p_open_to         text[]   default null,
  p_confirmed_only  boolean  default false,
  p_group_slug      text     default null,
  p_limit           integer  default 25,
  p_offset          integer  default 0
)
returns table (
  id                    uuid,
  full_name             text,
  headline              text,
  current_title         text,
  organization_name     text,
  industry_name         text,
  city                  text,
  state                 text,
  metro                 text,
  status                text,
  alumni_status         text,
  photo_url             text,
  open_to               text[],
  grad_year             smallint,
  degree                text,
  school                text,
  distance_miles        double precision,
  rank                  real,
  total_count           bigint
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select p.id, p.full_name, p.headline, p.current_title, org.name, i.name,
         p.city, p.state, p.metro, p.status, p.alumni_status, p.photo_url, p.open_to,
         ed.grad_year, ed.degree, ed.school,
         f.distance_miles, f.text_rank,
         count(*) over ()
    from public.search_filter(p_text, p_industry_slugs, p_place_id, p_radius_miles,
                              p_grad_year_min, p_grad_year_max, p_open_to, p_confirmed_only, p_group_slug) f
    join public.people p on p.id = f.person_id
    left join public.organizations org on org.id = p.current_organization_id
    left join public.industries i on i.id = p.industry_id
    left join lateral (
      select e.grad_year, e.degree, e.school
        from public.educations e
       where e.person_id = p.id
       order by e.grad_year nulls last
       limit 1
    ) ed on true
   order by
     f.text_rank desc,
     f.distance_miles asc nulls last,
     (p.status in ('claimed', 'verified')) desc,
     p.profile_completeness desc,
     p.full_name
   limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0)
$$;

-- Counts for the result set: totals, confirmed vs. unconfirmed, and breakdowns
-- by sector and metro ("how many alumni work in X in Y").
create function public.search_facets(
  p_text            text     default null,
  p_industry_slugs  text[]   default null,
  p_place_id        integer  default null,
  p_radius_miles    numeric  default 50,
  p_grad_year_min   integer  default null,
  p_grad_year_max   integer  default null,
  p_open_to         text[]   default null,
  p_confirmed_only  boolean  default false,
  p_group_slug      text     default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with matched as (
    select p.id, p.status, p.metro, coalesce(ip.slug, i.slug) as sector_slug, coalesce(ip.name, i.name) as sector_name
      from public.search_filter(p_text, p_industry_slugs, p_place_id, p_radius_miles,
                                p_grad_year_min, p_grad_year_max, p_open_to, p_confirmed_only, p_group_slug) f
      join public.people p on p.id = f.person_id
      left join public.industries i on i.id = p.industry_id
      left join public.industries ip on ip.id = i.parent_id
  )
  select jsonb_build_object(
    'total',       (select count(*) from matched),
    'confirmed',   (select count(*) from matched where status in ('claimed', 'verified')),
    'unconfirmed', (select count(*) from matched where status = 'seeded'),
    'by_sector',   coalesce((select jsonb_agg(s order by s.count desc, s.name)
                               from (select sector_slug as slug, sector_name as name, count(*) as count
                                       from matched where sector_slug is not null
                                      group by 1, 2 order by 3 desc limit 12) s), '[]'::jsonb),
    'by_metro',    coalesce((select jsonb_agg(m order by m.count desc, m.metro)
                               from (select metro, count(*) as count
                                       from matched where metro is not null
                                      group by 1 order by 2 desc limit 12) m), '[]'::jsonb)
  )
$$;

revoke all on function public.search_filter, public.search_people, public.search_facets from public, anon;
grant execute on function public.search_filter, public.search_people, public.search_facets to authenticated;
