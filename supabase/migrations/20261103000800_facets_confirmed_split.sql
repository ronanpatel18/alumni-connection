-- The design shows confirmed and unconfirmed counts per industry and metro, not
-- just totals. Same filters and security model as before (SECURITY INVOKER).
create or replace function public.search_facets(
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
    select p.id,
           p.status in ('claimed', 'verified') as confirmed,
           p.metro,
           coalesce(ip.slug, i.slug) as sector_slug,
           coalesce(ip.name, i.name) as sector_name
      from public.search_filter(p_text, p_industry_slugs, p_place_id, p_radius_miles,
                                p_grad_year_min, p_grad_year_max, p_open_to, p_confirmed_only, p_group_slug) f
      join public.people p on p.id = f.person_id
      left join public.industries i on i.id = p.industry_id
      left join public.industries ip on ip.id = i.parent_id
  )
  select jsonb_build_object(
    'total',       (select count(*) from matched),
    'confirmed',   (select count(*) from matched where confirmed),
    'unconfirmed', (select count(*) from matched where not confirmed),
    'by_sector',   coalesce((select jsonb_agg(s order by s.count desc, s.name)
                               from (select sector_slug as slug, sector_name as name, count(*) as count,
                                            count(*) filter (where confirmed) as confirmed,
                                            count(*) filter (where not confirmed) as unconfirmed
                                       from matched where sector_slug is not null
                                      group by 1, 2 order by 3 desc limit 12) s), '[]'::jsonb),
    'by_metro',    coalesce((select jsonb_agg(m order by m.count desc, m.metro)
                               from (select metro, count(*) as count,
                                            count(*) filter (where confirmed) as confirmed,
                                            count(*) filter (where not confirmed) as unconfirmed
                                       from matched where metro is not null
                                      group by 1 order by 2 desc limit 12) m), '[]'::jsonb)
  )
$$;
