-- Prompt search ("describe who you want to meet"): hybrid retrieval that merges
-- structured filters, full-text and pgvector similarity into one shortlist for
-- the AI to re-rank. SECURITY INVOKER, like the other search functions, so the
-- caller's row-level security always applies.

-- Which model produced each profile's embedding. Vectors from different models
-- don't share a space, so similarity only compares like with like.
alter table public.people add column embedding_model text;

-- A member's parsed prompt and its query embedding, so repeating or refining a
-- search doesn't call the model again. Private to the member; rows expire in the app.
create table public.ai_search_cache (
  owner_user_id    uuid not null references auth.users (id) on delete cascade,
  query_hash       text not null,
  parsed           jsonb not null,
  embedding        extensions.vector(1024),
  embedding_model  text,
  created_at       timestamptz not null default now(),
  primary key (owner_user_id, query_hash)
);

alter table public.ai_search_cache enable row level security;
revoke all on public.ai_search_cache from anon, authenticated;
grant select, insert, update, delete on public.ai_search_cache to authenticated;
create policy "own searches" on public.ai_search_cache
  for all to authenticated
  using (owner_user_id = auth.uid() and public.is_verified_member())
  with check (owner_user_id = auth.uid() and public.is_verified_member());

-- Location and "confirmed only" are hard filters. Industry, class years,
-- open-to and seniority are preferences: matching more of them ranks higher,
-- but a strong keyword or semantic match can still appear without them. A
-- profile with no embedding simply competes on filters and text.
create function public.search_people_hybrid(
  p_keywords         text[]   default null,
  p_query_embedding  extensions.vector(1024) default null,
  p_embedding_model  text     default null,
  p_industry_slugs   text[]   default null,
  p_place_id         integer  default null,
  p_radius_miles     numeric  default 50,
  p_grad_year_min    integer  default null,
  p_grad_year_max    integer  default null,
  p_open_to          text[]   default null,
  p_seniority        text[]   default null,
  p_confirmed_only   boolean  default false,
  p_limit            integer  default 30
)
returns table (
  id                 uuid,
  full_name          text,
  headline           text,
  current_title      text,
  organization_name  text,
  industry_name      text,
  city               text,
  state              text,
  metro              text,
  status             text,
  alumni_status      text,
  photo_url          text,
  open_to            text[],
  grad_year          smallint,
  degree             text,
  school             text,
  seniority          text,
  specialties        text[],
  ai_summary         text[],
  distance_miles     double precision,
  matched            text[]
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with origin as (
    select location from public.places where id = p_place_id
  ),
  q as (
    select (select string_agg(plainto_tsquery('english', k)::text, ' | ')
              from unnest(coalesce(p_keywords, '{}')) k
             where plainto_tsquery('english', k)::text <> '')::tsquery as tsq
  ),
  wanted as (
    select coalesce(cardinality(p_industry_slugs), 0) > 0 as industry,
           p_grad_year_min is not null or p_grad_year_max is not null as years,
           coalesce(cardinality(p_open_to), 0) > 0 as open_to,
           coalesce(cardinality(p_seniority), 0) > 0 as seniority
  ),
  cand as (
    select p.id,
           case when o.location is null or p.location is null then null
                else st_distance(p.location, o.location) / 1609.344 end as distance_miles,
           w.industry and (i.slug = any (p_industry_slugs) or ip.slug = any (p_industry_slugs)) as m_industry,
           w.years and exists (select 1 from public.educations e
                                where e.person_id = p.id
                                  and e.grad_year between coalesce(p_grad_year_min, 1900) and coalesce(p_grad_year_max, 2100)) as m_years,
           w.open_to and p.open_to && p_open_to as m_open,
           w.seniority and p.seniority = any (p_seniority) as m_seniority,
           case when q.tsq is not null and p.search_tsv @@ q.tsq then ts_rank(p.search_tsv, q.tsq) end as text_rank,
           case when p_query_embedding is not null and p.embedding is not null
                 and p.embedding_model is not distinct from p_embedding_model
                then 1 - (p.embedding <=> p_query_embedding) end as similarity
      from public.people p
      cross join q
      cross join wanted w
      left join origin o on true
      left join public.industries i on i.id = p.industry_id
      left join public.industries ip on ip.id = i.parent_id
     where p.status <> 'opted_out'
       and (not p_confirmed_only or p.status in ('claimed', 'verified'))
       and (p_place_id is null
            or (o.location is not null and st_dwithin(p.location, o.location, p_radius_miles * 1609.344)))
  ),
  ranked as (
    select c.*,
           coalesce(c.m_industry, false)::int + coalesce(c.m_years, false)::int
             + coalesce(c.m_open, false)::int + coalesce(c.m_seniority, false)::int as m_count,
           case when c.text_rank is not null then row_number() over (order by c.text_rank desc nulls last) end as r_text,
           case when c.similarity is not null then row_number() over (order by c.similarity desc nulls last) end as r_vec
      from cand c
  )
  select p.id, p.full_name, p.headline, p.current_title, org.name, i.name,
         p.city, p.state, p.metro, p.status, p.alumni_status, p.photo_url, p.open_to,
         ed.grad_year, ed.degree, ed.school,
         p.seniority, p.specialties, p.ai_summary,
         r.distance_miles,
         array_remove(array[
           case when r.m_industry then 'industry' end,
           case when r.m_years then 'class' end,
           case when r.m_open then 'open_to' end,
           case when r.m_seniority then 'seniority' end,
           case when r.text_rank is not null then 'keywords' end
         ], null)
    from ranked r
    cross join q
    cross join wanted w
    join public.people p on p.id = r.id
    left join public.organizations org on org.id = p.current_organization_id
    left join public.industries i on i.id = p.industry_id
    left join lateral (
      select e.grad_year, e.degree, e.school
        from public.educations e
       where e.person_id = p.id
       order by e.grad_year nulls last
       limit 1
    ) ed on true
   where r.m_count > 0
      or r.r_text <= 60
      or r.r_vec <= 60
      -- Nothing to rank on (a bare location, or no criteria at all): everyone eligible.
      or (q.tsq is null and p_query_embedding is null
          and not (w.industry or w.years or w.open_to or w.seniority))
   order by
     r.m_count * 0.02
       + coalesce(1.0 / (60 + r.r_text), 0)
       + coalesce(1.0 / (60 + r.r_vec), 0) desc,
     r.distance_miles asc nulls last,
     (p.status in ('claimed', 'verified')) desc,
     p.profile_completeness desc,
     p.full_name
   limit least(greatest(p_limit, 1), 60)
$$;

revoke all on function public.search_people_hybrid from public, anon;
grant execute on function public.search_people_hybrid to authenticated;
