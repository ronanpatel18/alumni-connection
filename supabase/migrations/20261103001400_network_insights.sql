-- Network insights (design/prototypes/screens/insights.html): where alumni
-- concentrate, by market and industry, always split into confirmed and
-- unconfirmed records. Unlike search_facets it returns every market and
-- industry (not a top 12), keeps cities that aren't in the places list, and
-- reports how many records have no location or industry on file, so the
-- totals always add up. Same security as search (verified members only, RLS).
create function public.network_insights(
  p_industry_slugs text[]  default null,
  p_place_id       integer default null,
  p_radius_miles   numeric default 50
)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with matched as (
    select p.status in ('claimed', 'verified') as confirmed,
           coalesce(p.metro, nullif(concat_ws(', ', p.city, p.state), '')) as market,
           coalesce(ip.slug, i.slug) as sector_slug,
           coalesce(ip.name, i.name) as sector_name
      from public.search_filter(null, p_industry_slugs, p_place_id, p_radius_miles, null, null, null, false, null) f
      join public.people p on p.id = f.person_id
      left join public.industries i on i.id = p.industry_id
      left join public.industries ip on ip.id = i.parent_id
  )
  select jsonb_build_object(
    'total',       (select count(*) from matched),
    'confirmed',   (select count(*) from matched where confirmed),
    'unconfirmed', (select count(*) from matched where not confirmed),
    'by_market',   coalesce((select jsonb_agg(m order by m.count desc, m.name)
                               from (select market as name, count(*) as count,
                                            count(*) filter (where confirmed) as confirmed,
                                            count(*) filter (where not confirmed) as unconfirmed
                                       from matched where market is not null group by 1) m), '[]'::jsonb),
    'no_market',   (select count(*) from matched where market is null),
    'by_sector',   coalesce((select jsonb_agg(s order by s.count desc, s.name)
                               from (select sector_slug as slug, sector_name as name, count(*) as count,
                                            count(*) filter (where confirmed) as confirmed,
                                            count(*) filter (where not confirmed) as unconfirmed
                                       from matched where sector_slug is not null group by 1, 2) s), '[]'::jsonb),
    'no_sector',   (select count(*) from matched where sector_slug is null)
  )
$$;

revoke all on function public.network_insights(text[], integer, numeric) from public, anon;
grant execute on function public.network_insights(text[], integer, numeric) to authenticated;
