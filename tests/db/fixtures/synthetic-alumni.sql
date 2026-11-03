-- Synthetic TEST data: ~5,000 fictional UW–Madison alumni, loaded only by the
-- test suite (tests/db/harness.ts), never into a real database.
-- Every name, company, email and phone number here is made up. Emails use the
-- reserved example.com domain and phones use the fictional 555-01xx range.
-- Deterministic (fixed random seed), so every test run gets the same data.

select setseed(0.42);

create temp table seed_sector (
  slug         text primary key,
  org_suffixes text[] not null,
  roles        text[] not null,
  specialties  text[] not null
);

insert into seed_sector values
  ('finance',        '{Capital Partners,Wealth Advisors,Bancorp,Investment Group,Financial,Asset Management}', '{Analyst,Associate,Financial Advisor}', '{M&A,leveraged finance,portfolio management,financial modeling,credit,family offices}'),
  ('real-estate',    '{Realty,Property Group,Development,Real Estate Partners,Commercial}',                     '{Broker,Analyst,Development Associate}', '{office leasing,industrial,multifamily,acquisitions,site selection,capital markets}'),
  ('technology',     '{Labs,Software,Systems,Technologies,Data,Cloud}',                                         '{Software Engineer,Product Manager,Data Scientist}', '{machine learning,cloud infrastructure,B2B SaaS,product strategy,security,developer tools}'),
  ('healthcare',     '{Health,Medical Group,Therapeutics,Biosciences,Clinic}',                                  '{Physician,Research Scientist,Nurse Practitioner}', '{clinical trials,oncology,regulatory affairs,population health,medical devices,care delivery}'),
  ('law',            '{LLP,Law Group,& Associates,Legal}',                                                      '{Associate,Attorney,Counsel}', '{M&A,litigation,patents,employment law,securities,real estate law}'),
  ('consulting',     '{Advisors,Consulting,Partners,Strategy Group}',                                           '{Consultant,Senior Consultant,Analyst}', '{operations,digital transformation,pricing,org design,due diligence,change management}'),
  ('accounting',     '{CPAs,Accounting,Tax Advisors,& Co.}',                                                    '{Staff Accountant,Senior Accountant,Tax Associate}', '{audit,tax planning,FP&A,SEC reporting,valuation,internal controls}'),
  ('manufacturing',  '{Industries,Manufacturing,Works,Components,Machinery}',                                   '{Engineer,Operations Analyst,Plant Engineer}', '{lean manufacturing,supply chain,quality,automation,procurement,product engineering}'),
  ('energy',         '{Energy,Power,Renewables,Utilities}',                                                     '{Engineer,Analyst,Project Developer}', '{solar development,grid operations,energy trading,sustainability,wind,energy policy}'),
  ('agriculture',    '{Farms,Foods,Dairy Cooperative,Agri,Brewing Co.}',                                        '{Food Scientist,Agronomist,Supply Analyst}', '{dairy science,food safety,agtech,commodity trading,brewing,sustainable farming}'),
  ('media',          '{Media,Creative,Studios,Communications,Agency}',                                          '{Producer,Strategist,Account Executive}', '{brand strategy,content,public relations,digital marketing,journalism,media buying}'),
  ('sports',         '{Sports,Athletics,Sports Group,Sports Media}',                                            '{Coordinator,Analyst,Account Executive}', '{ticketing,sponsorships,athlete representation,sports analytics,broadcast,fan experience}'),
  ('government',     '{Foundation,Institute,Agency,Council,Coalition}',                                         '{Policy Analyst,Program Manager,Specialist}', '{public policy,grant writing,community development,program evaluation,advocacy,public finance}'),
  ('education',      '{Academy,Learning,Education,College}',                                                    '{Teacher,Instructor,Program Coordinator}', '{curriculum design,student success,research,edtech,higher ed administration,advising}'),
  ('consumer',       '{Brands,Goods,Retail,Hospitality,Outfitters}',                                            '{Brand Manager,Merchandiser,Buyer}', '{brand management,e-commerce,merchandising,consumer insights,retail operations,hospitality}'),
  ('construction',   '{Construction,Builders,Architects,Engineering}',                                          '{Project Engineer,Architect,Estimator}', '{project management,sustainable design,infrastructure,estimating,BIM,site development}'),
  ('transportation', '{Logistics,Freight,Transport,Airways}',                                                   '{Logistics Analyst,Operations Manager,Planner}', '{freight brokerage,fleet operations,last-mile delivery,aviation,route planning,warehousing}');

-- Where alumni live: weighted toward Wisconsin and the Midwest.
create temp table seed_place_weight (name text, state text, weight real);
insert into seed_place_weight values
  ('Madison','WI',14), ('Milwaukee','WI',10), ('Waukesha','WI',3), ('Green Bay','WI',3),
  ('Chicago','IL',13), ('Evanston','IL',2), ('Naperville','IL',2),
  ('Minneapolis','MN',6), ('St. Paul','MN',2), ('New York','NY',6), ('Brooklyn','NY',2),
  ('San Francisco','CA',4), ('Oakland','CA',1), ('San Jose','CA',1), ('Los Angeles','CA',3), ('San Diego','CA',1),
  ('Seattle','WA',3), ('Bellevue','WA',1), ('Portland','OR',1), ('Denver','CO',3), ('Salt Lake City','UT',1),
  ('Phoenix','AZ',2), ('Dallas','TX',2), ('Plano','TX',1), ('Austin','TX',2), ('Houston','TX',2),
  ('Atlanta','GA',2), ('Boston','MA',2), ('Washington','DC',3), ('Arlington','VA',1), ('Philadelphia','PA',1),
  ('Detroit','MI',1), ('Columbus','OH',1), ('Indianapolis','IN',1), ('St. Louis','MO',1), ('Kansas City','MO',1),
  ('Omaha','NE',1), ('Des Moines','IA',1), ('Nashville','TN',1), ('Charlotte','NC',1), ('Raleigh','NC',1), ('Miami','FL',1);

create temp table seed_program (school text, degree text, major text, sector text);
insert into seed_program values
  ('Wisconsin School of Business', 'BBA', 'Finance, Investment & Banking', 'finance'),
  ('Wisconsin School of Business', 'BBA', 'Real Estate & Urban Land Economics', 'real-estate'),
  ('Wisconsin School of Business', 'BBA', 'Marketing', 'media'),
  ('Wisconsin School of Business', 'BBA', 'Accounting', 'accounting'),
  ('Wisconsin School of Business', 'BBA', 'Operations & Technology Management', 'manufacturing'),
  ('Wisconsin School of Business', 'MBA', 'Business Administration', null),
  ('College of Letters & Science', 'BS', 'Computer Sciences', 'technology'),
  ('College of Letters & Science', 'BS', 'Economics', null),
  ('College of Letters & Science', 'BA', 'Political Science', 'government'),
  ('College of Letters & Science', 'BA', 'Journalism', 'media'),
  ('College of Letters & Science', 'BA', 'Communication Arts', 'media'),
  ('College of Letters & Science', 'BS', 'Data Science', 'technology'),
  ('College of Engineering', 'BS', 'Mechanical Engineering', 'manufacturing'),
  ('College of Engineering', 'BS', 'Electrical Engineering', 'technology'),
  ('College of Engineering', 'BS', 'Civil Engineering', 'construction'),
  ('College of Engineering', 'BS', 'Biomedical Engineering', 'healthcare'),
  ('College of Agricultural & Life Sciences', 'BS', 'Food Science', 'agriculture'),
  ('College of Agricultural & Life Sciences', 'BS', 'Dairy Science', 'agriculture'),
  ('College of Agricultural & Life Sciences', 'BS', 'Agricultural & Applied Economics', 'agriculture'),
  ('School of Medicine & Public Health', 'MD', 'Medicine', 'healthcare'),
  ('School of Nursing', 'BSN', 'Nursing', 'healthcare'),
  ('School of Pharmacy', 'PharmD', 'Pharmacy', 'healthcare'),
  ('Law School', 'JD', 'Law', 'law'),
  ('School of Education', 'BS', 'Elementary Education', 'education'),
  ('School of Education', 'BS', 'Kinesiology', 'sports'),
  ('Nelson Institute', 'MS', 'Environment & Resources', 'energy'),
  ('La Follette School of Public Affairs', 'MPA', 'Public Affairs', 'government');

-- ---------------------------------------------------------------------------
-- Organizations: four fictional employers per specialty
-- ---------------------------------------------------------------------------

insert into public.organizations (name, domain, industry_id, hq_place_id, website, is_alumni_owned)
select x.name,
       lower(regexp_replace(x.name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || i.id || '-' || k || '.example',
       i.id,
       x.place_id,
       'https://' || lower(regexp_replace(x.name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || i.id || '-' || k || '.example',
       random() < 0.15
  from public.industries i
  join public.industries p on p.id = i.parent_id
  join seed_sector s on s.slug = p.slug
  cross join generate_series(1, 4) k
  cross join lateral (
    select ((array['Lakeshore','Isthmus','North Star','Prairie','Driftless','Mendota','Monona','Harbor','Cardinal',
                   'Northwoods','Fox River','Capitol','Granite','Bluestem','Oak Creek','Meridian','Summit','Keystone',
                   'Juniper','Ironwood','Riverbend','Pinecrest','Silverline','Bascom','Lakeview','Highland'])
              [1 + floor(random() * 26)::int + 0 * k + 0 * i.id]
            || ' ' || s.org_suffixes[1 + floor(random() * array_length(s.org_suffixes, 1))::int]) as name,
           (select pl.id from public.places pl join seed_place_weight w using (name, state)
             where i.id > 0 and k > 0
             order by -ln(1 - random()) / w.weight limit 1) as place_id
  ) x
on conflict (domain) do nothing;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

create temp table seed_people as
select g as n,
       gen_random_uuid() as person_id,
       f.first_name,
       l.last_name,
       o.id as org_id,
       o.name as org_name,
       o.industry_id,
       ind.name as industry_name,
       sec.slug as sector,
       pl.id as place_id,
       pl.location as place_location,
       (2025 - floor(power(random(), 1.6) * 56))::smallint as grad_year,
       random() as r_status,
       random() as r_open
  from generate_series(1, 5000) g
  cross join lateral (
    select (array['Emma','Liam','Olivia','Noah','Ava','Ethan','Sophia','Mason','Isabella','Logan','Mia','Lucas',
                  'Charlotte','Jackson','Amelia','Aiden','Harper','Carter','Evelyn','Owen','Abigail','Wyatt','Emily',
                  'Henry','Ella','Samuel','Grace','Jack','Chloe','Benjamin','Lily','Nathan','Zoe','Ryan','Nora',
                  'Daniel','Hannah','Matthew','Aria','David','Priya','Arjun','Mei','Wei','Jamal','Aaliyah','Carlos',
                  'Sofia','Mateo','Fatima','Omar','Hana','Kenji','Anika','Diego','Leah','Marcus','Tessa','Ravi','Nina'])
             [1 + floor(random() * 60)::int + 0 * g] as first_name
  ) f
  cross join lateral (
    select (array['Anderson','Johnson','Schmidt','Mueller','Olson','Nelson','Peterson','Larson','Hansen','Kowalski',
                  'Nowak','Schultz','Wagner','Becker','Hoffman','Klein','Meyer','Weber','Fischer','Thompson','Miller',
                  'Davis','Garcia','Martinez','Lee','Kim','Nguyen','Patel','Shah','Chen','Wang','Singh','Brown','Wilson',
                  'Moore','Taylor','Clark','Lewis','Walker','Hall','Young','Allen','King','Wright','Lopez','Hill',
                  'Green','Adams','Baker','Rivera','Campbell','Mitchell','Roberts','Carter','Phillips','Evans',
                  'Turner','Torres','Parker','Collins'])
             [1 + floor(random() * 60)::int + 0 * g] as last_name
  ) l
  cross join lateral (
    select org.id, org.name, org.industry_id from public.organizations org where g > 0 order by random() limit 1
  ) o
  join public.industries ind on ind.id = o.industry_id
  join public.industries sec on sec.id = ind.parent_id
  cross join lateral (
    select pl.id, pl.location
      from public.places pl join seed_place_weight w using (name, state)
     where g > 0
     order by -ln(1 - random()) / w.weight
     limit 1
  ) pl;

alter table seed_people add column seniority text;
update seed_people set seniority = case
  when 2026 - grad_year < 3  then 'entry'
  when 2026 - grad_year < 7  then (array['entry','mid','mid'])[1 + floor(random() * 3)::int]
  when 2026 - grad_year < 12 then (array['mid','senior','senior','manager'])[1 + floor(random() * 4)::int]
  when 2026 - grad_year < 20 then (array['senior','manager','director','director'])[1 + floor(random() * 4)::int]
  when 2026 - grad_year < 30 then (array['director','vp','vp','partner','owner'])[1 + floor(random() * 5)::int]
  else (array['vp','c_suite','partner','owner','director'])[1 + floor(random() * 5)::int]
end;

insert into public.people (
  id, institution_id, full_name, first_name, last_name, headline, current_title,
  current_organization_id, industry_id, seniority, specialties, open_to,
  place_id, location, status, claimed_at, profile_completeness
)
select sp.person_id,
       '00000000-0000-4000-8000-000000000001',
       sp.first_name || ' ' || sp.last_name,
       sp.first_name,
       sp.last_name,
       t.title || ' at ' || sp.org_name,
       t.title,
       sp.org_id,
       sp.industry_id,
       sp.seniority,
       array(select distinct x from unnest(array[s.specialties[1 + floor(random() * 6)::int],
                                                  s.specialties[1 + floor(random() * 6)::int]]) x),
       array_remove(array[
         case when sp.r_open < 0.70 then 'networking' end,
         case when random() < 0.35 then 'mentoring' end,
         case when random() < 0.15 then 'hiring' end,
         case when random() < 0.40 then 'meeting_travelers' end,
         case when random() < 0.25 then 'referrals' end,
         case when sp.sector = 'finance' and random() < 0.30 then 'investing' end,
         case when sp.seniority = 'entry' and random() < 0.30 then 'job_seeking' end
       ], null),
       sp.place_id,
       extensions.st_setsrid(extensions.st_makepoint(
         extensions.st_x(sp.place_location::extensions.geometry) + (random() - 0.5) * 0.25,
         extensions.st_y(sp.place_location::extensions.geometry) + (random() - 0.5) * 0.20), 4326)::extensions.geography,
       case when sp.r_status < 0.005 then 'opted_out'
            when sp.r_status < 0.065 then 'claimed'
            when sp.r_status < 0.095 then 'verified'
            else 'seeded' end,
       case when sp.r_status between 0.005 and 0.095 then now() - (random() * interval '300 days') end,
       (40 + floor(random() * 56))::smallint
  from seed_people sp
  join seed_sector s on s.slug = sp.sector
  cross join lateral (
    select case sp.seniority
             when 'entry'    then s.roles[1 + floor(random() * 3)::int]
             when 'mid'      then s.roles[1 + floor(random() * 3)::int]
             when 'senior'   then 'Senior ' || s.roles[1 + floor(random() * 3)::int]
             when 'manager'  then 'Manager, ' || sp.industry_name
             when 'director' then 'Director, ' || sp.industry_name
             when 'vp'       then 'Vice President, ' || sp.industry_name
             when 'partner'  then case when sp.sector in ('law', 'consulting', 'accounting', 'finance')
                                       then 'Partner' else 'Managing Director' end
             when 'owner'    then 'Founder & CEO'
             else (array['Chief Executive Officer', 'Chief Operating Officer', 'Chief Financial Officer',
                         'Chief Technology Officer'])[1 + floor(random() * 4)::int]
           end as title
  ) t;

-- Education: one UW–Madison degree each (matched to their field ~70% of the time),
-- plus a graduate degree for some.
insert into public.educations (person_id, institution_id, school, degree, major, grad_year, verified_by)
select sp.person_id, '00000000-0000-4000-8000-000000000001', pr.school, pr.degree, pr.major, sp.grad_year,
       case when random() < 0.6 then 'source' end
  from seed_people sp
  cross join lateral (
    select * from seed_program p
     where p.degree not in ('MBA', 'MD', 'JD', 'PharmD', 'MS', 'MPA')
       and (case when random() < 0.7 + 0 * sp.n then p.sector = sp.sector or p.sector is null else true end)
     order by random() limit 1
  ) pr;

insert into public.educations (person_id, institution_id, school, degree, major, grad_year, verified_by)
select sp.person_id, '00000000-0000-4000-8000-000000000001', pr.school, pr.degree, pr.major,
       least(sp.grad_year + 3 + floor(random() * 6)::int, 2025)::smallint, 'source'
  from seed_people sp
  cross join lateral (
    select * from seed_program p
     where p.degree in ('MBA', 'MD', 'JD', 'PharmD', 'MS', 'MPA')
       and (p.sector = sp.sector or p.sector is null)
       and sp.n > 0
     order by random() limit 1
  ) pr
 where sp.grad_year <= 2018 and random() < 0.18;

-- Positions: the current job, plus an earlier one for half of people.
insert into public.positions (person_id, organization_id, organization_name, title, seniority, start_date, is_current)
select p.id, p.current_organization_id, o.name, p.current_title, p.seniority,
       make_date(least(2025, sp.grad_year + floor(random() * greatest(1, 2026 - sp.grad_year))::int), 1 + floor(random() * 12)::int, 1),
       true
  from public.people p
  join seed_people sp on sp.person_id = p.id
  join public.organizations o on o.id = p.current_organization_id;

insert into public.positions (person_id, organization_id, organization_name, title, seniority, start_date, end_date, is_current)
select sp.person_id, prev.id, prev.name, s.roles[1 + floor(random() * 3)::int], 'mid',
       make_date(least(sp.grad_year + 1, 2024), 6, 1), make_date(least(sp.grad_year + 4, 2025), 5, 1), false
  from seed_people sp
  join seed_sector s on s.slug = sp.sector
  cross join lateral (
    select o.id, o.name
      from public.organizations o
      join public.industries i on i.id = o.industry_id
      join public.industries pi on pi.id = i.parent_id
     where pi.slug = sp.sector and o.id <> sp.org_id and sp.n > 0
     order by random() limit 1
  ) prev
 where sp.grad_year <= 2020 and random() < 0.5;

-- Contact details with a mix of sources and visibility settings.
insert into public.contact_points (person_id, kind, value, label, source, verified_at, visibility)
select sp.person_id, 'email',
       lower(sp.first_name) || '.' || lower(sp.last_name) || sp.n || '@example.com', 'work',
       (array['pdl', 'roster', 'self'])[1 + floor(random() * 3)::int],
       case when random() < 0.7 then now() - interval '30 days' end,
       case when random() < 0.6 then 'members' when random() < 0.5 then 'connections' else 'private' end
  from seed_people sp;

insert into public.contact_points (person_id, kind, value, label, source, visibility)
select sp.person_id, 'linkedin',
       'https://linkedin.example/in/' || lower(sp.first_name) || '-' || lower(sp.last_name) || '-' || sp.n,
       'work', 'web', 'members'
  from seed_people sp
 where random() < 0.75;

insert into public.contact_points (person_id, kind, value, label, source, visibility)
select sp.person_id, 'phone',
       '+1-608-555-01' || lpad((sp.n % 100)::text, 2, '0'),
       'work', (array['pdl', 'self'])[1 + floor(random() * 2)::int],
       case when random() < 0.2 then 'members' when random() < 0.4 then 'connections' else 'private' end
  from seed_people sp
 where random() < 0.35;

insert into public.field_provenance (person_id, field, source, confidence, source_url)
select sp.person_id, f.field, 'pdl', round((0.7 + random() * 0.29)::numeric, 2), null
  from seed_people sp
  cross join (values ('current_title'), ('current_organization_id'), ('place_id')) f(field);

-- Relationship edges: classmates (same year and school) and coworkers (same employer).
insert into public.edges (person_a, person_b, kind, weight, source)
select least(a, b), greatest(a, b), 'classmate', 1, 'education'
  from (
    select e.person_id as a,
           lead(e.person_id) over (partition by e.grad_year, e.school order by random()) as b
      from public.educations e
  ) pairs
 where b is not null and random() < 0.6
on conflict do nothing;

insert into public.edges (person_a, person_b, kind, weight, source)
select least(a, b), greatest(a, b), 'coworker', 1, 'positions'
  from (
    select p.id as a,
           lead(p.id) over (partition by p.current_organization_id order by random()) as b
      from public.people p
  ) pairs
 where b is not null
on conflict do nothing;
