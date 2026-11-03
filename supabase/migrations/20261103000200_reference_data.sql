-- Reference data: institutions, the industry taxonomy and US places.
-- These ship to every environment (not just dev), so they live in a migration.

create table public.institutions (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  created_at  timestamptz not null default now()
);

insert into public.institutions (id, slug, name)
values ('00000000-0000-4000-8000-000000000001', 'uw-madison', 'University of Wisconsin–Madison');

-- Two-level taxonomy: sectors (parent_id null) and their specialties.
-- Admin-editable; `synonyms` feed the rule-based search parser.
create table public.industries (
  id           integer generated always as identity primary key,
  slug         text not null unique,
  name         text not null,
  parent_id    integer references public.industries (id) on delete restrict,
  synonyms     text[] not null default '{}',
  sort_order   integer not null default 0
);

create index industries_parent_idx on public.industries (parent_id);

insert into public.industries (slug, name, synonyms, sort_order) values
  ('finance',        'Finance & Investing',              '{finance,investing,financial services}', 1),
  ('real-estate',    'Real Estate',                      '{real estate,property}', 2),
  ('technology',     'Technology',                       '{tech,technology}', 3),
  ('healthcare',     'Healthcare & Life Sciences',       '{healthcare,health care,life sciences,medicine}', 4),
  ('law',            'Law',                              '{law,legal,attorney,lawyer}', 5),
  ('consulting',     'Consulting',                       '{consulting,consultant}', 6),
  ('accounting',     'Accounting & Tax',                 '{accounting,cpa,tax}', 7),
  ('manufacturing',  'Manufacturing & Industrial',       '{manufacturing,industrial}', 8),
  ('energy',         'Energy & Utilities',               '{energy,utilities}', 9),
  ('agriculture',    'Agriculture & Food',               '{agriculture,ag,food}', 10),
  ('media',          'Media, Marketing & Entertainment', '{media,marketing,entertainment}', 11),
  ('sports',         'Sports Business',                  '{sports,sports business}', 12),
  ('government',     'Government & Nonprofit',           '{government,nonprofit,non-profit,public sector}', 13),
  ('education',      'Education',                        '{education,teaching}', 14),
  ('consumer',       'Retail & Consumer',                '{retail,consumer,cpg}', 15),
  ('construction',   'Construction & Engineering',       '{construction,engineering firm}', 16),
  ('transportation', 'Transportation & Logistics',       '{transportation,logistics}', 17);

insert into public.industries (slug, name, parent_id, synonyms, sort_order)
select c.slug, c.name, p.id, c.synonyms, c.sort_order
from (values
  ('finance', 'investment-banking',     'Investment Banking',        '{investment banking,investment banker,ib,m&a}'::text[], 1),
  ('finance', 'private-equity',         'Private Equity',            '{private equity,pe,buyout}', 2),
  ('finance', 'venture-capital',        'Venture Capital',           '{venture capital,vc,venture}', 3),
  ('finance', 'wealth-management',      'Wealth Management',         '{wealth management,financial advisor,financial planning}', 4),
  ('finance', 'commercial-banking',     'Commercial Banking',        '{commercial banking,banking,bank,lending}', 5),
  ('finance', 'asset-management',       'Asset Management',          '{asset management,hedge fund,portfolio management}', 6),
  ('finance', 'insurance',              'Insurance',                 '{insurance,underwriting,actuarial}', 7),
  ('finance', 'fintech',                'Fintech',                   '{fintech,payments}', 8),
  ('real-estate', 'commercial-real-estate',  'Commercial Real Estate',  '{commercial real estate,cre,office,industrial real estate}', 1),
  ('real-estate', 'residential-real-estate', 'Residential Real Estate', '{residential real estate,realtor,homes}', 2),
  ('real-estate', 'real-estate-development', 'Real Estate Development', '{real estate development,developer,development}', 3),
  ('real-estate', 'property-management',     'Property Management',     '{property management}', 4),
  ('technology', 'software',                'Software',                 '{software,saas,software engineering,developer}', 1),
  ('technology', 'data-ai',                 'Data & AI',                '{data,ai,artificial intelligence,machine learning,data science,analytics}', 2),
  ('technology', 'cybersecurity',           'Cybersecurity',            '{cybersecurity,security,infosec}', 3),
  ('technology', 'hardware-semiconductors', 'Hardware & Semiconductors','{hardware,semiconductors,chips}', 4),
  ('technology', 'product-management',      'Product Management',       '{product management,product manager,pm}', 5),
  ('healthcare', 'healthcare-providers', 'Healthcare Providers', '{hospital,physician,doctor,nurse,clinical}', 1),
  ('healthcare', 'biotech-pharma',       'Biotech & Pharma',     '{biotech,pharma,pharmaceutical,life sciences}', 2),
  ('healthcare', 'medical-devices',      'Medical Devices',      '{medical devices,medtech}', 3),
  ('healthcare', 'health-tech',          'Health Tech',          '{health tech,digital health,healthtech}', 4),
  ('healthcare', 'public-health',        'Public Health',        '{public health,epidemiology}', 5),
  ('law', 'corporate-law',         'Corporate Law',         '{corporate law,m&a law,securities law}', 1),
  ('law', 'litigation',            'Litigation',            '{litigation,trial,litigator}', 2),
  ('law', 'intellectual-property', 'Intellectual Property', '{intellectual property,ip law,patent}', 3),
  ('law', 'government-legal',      'Government & Public Law','{prosecutor,public defender,judicial}', 4),
  ('consulting', 'management-consulting', 'Management Consulting', '{management consulting,strategy consulting}', 1),
  ('consulting', 'technology-consulting', 'Technology Consulting', '{technology consulting,it consulting}', 2),
  ('consulting', 'hr-consulting',         'HR & People Consulting','{hr consulting,human resources,people operations}', 3),
  ('accounting', 'audit-assurance',   'Audit & Assurance', '{audit,assurance}', 1),
  ('accounting', 'tax',               'Tax',               '{tax,tax advisory}', 2),
  ('accounting', 'corporate-finance', 'Corporate Finance', '{corporate finance,fp&a,cfo,controller}', 3),
  ('manufacturing', 'industrial-manufacturing', 'Industrial Manufacturing', '{manufacturing,industrial,plant}', 1),
  ('manufacturing', 'automotive',               'Automotive',               '{automotive,auto}', 2),
  ('manufacturing', 'aerospace',                'Aerospace & Defense',      '{aerospace,defense}', 3),
  ('manufacturing', 'supply-chain',             'Supply Chain & Operations','{supply chain,operations,procurement}', 4),
  ('energy', 'renewable-energy', 'Renewable Energy', '{renewable energy,solar,wind,clean energy}', 1),
  ('energy', 'oil-gas',          'Oil & Gas',        '{oil,gas,oil and gas}', 2),
  ('energy', 'utilities',        'Utilities',        '{utilities,utility,power}', 3),
  ('agriculture', 'agribusiness',   'Agribusiness',     '{agribusiness,farming,agtech}', 1),
  ('agriculture', 'dairy',          'Dairy',            '{dairy,cheese}', 2),
  ('agriculture', 'food-beverage',  'Food & Beverage',  '{food,beverage,brewing,food science}', 3),
  ('media', 'marketing-advertising', 'Marketing & Advertising', '{marketing,advertising,brand}', 1),
  ('media', 'journalism',            'Journalism & Publishing', '{journalism,journalist,publishing,news}', 2),
  ('media', 'entertainment',         'Entertainment',           '{entertainment,film,music,gaming}', 3),
  ('media', 'public-relations',      'Public Relations',        '{public relations,pr,communications}', 4),
  ('sports', 'team-operations',      'Team Operations',      '{team operations,front office}', 1),
  ('sports', 'sports-media',         'Sports Media',         '{sports media,broadcast}', 2),
  ('sports', 'athlete-representation','Athlete Representation','{agent,athlete representation,talent}', 3),
  ('sports', 'sports-tech',          'Sports Tech',          '{sports tech,sports analytics}', 4),
  ('government', 'public-service', 'Public Service', '{government,public service,civil service}', 1),
  ('government', 'nonprofit',      'Nonprofit',      '{nonprofit,non-profit,foundation,philanthropy}', 2),
  ('government', 'policy',         'Policy',         '{policy,think tank,lobbying}', 3),
  ('government', 'military',       'Military',       '{military,army,navy,air force,veteran}', 4),
  ('education', 'higher-education', 'Higher Education', '{higher education,university,professor,faculty}', 1),
  ('education', 'k12',              'K–12',             '{k12,k-12,teacher,school}', 2),
  ('education', 'edtech',           'EdTech',           '{edtech,education technology}', 3),
  ('consumer', 'retail',         'Retail',         '{retail,ecommerce,e-commerce}', 1),
  ('consumer', 'consumer-goods', 'Consumer Goods', '{consumer goods,cpg,consumer packaged goods}', 2),
  ('consumer', 'hospitality',    'Hospitality',    '{hospitality,hotels,restaurants}', 3),
  ('construction', 'general-contracting', 'General Contracting', '{general contractor,contractor,construction management}', 1),
  ('construction', 'architecture',      'Architecture',      '{architecture,architect}', 2),
  ('construction', 'civil-engineering', 'Civil Engineering', '{civil engineering,infrastructure}', 3),
  ('transportation', 'logistics', 'Logistics & Freight', '{logistics,freight,trucking,shipping}', 1),
  ('transportation', 'airlines',  'Airlines & Aviation', '{airline,aviation}', 2)
) as c(parent_slug, slug, name, synonyms, sort_order)
join public.industries p on p.slug = c.parent_slug;

-- US places used for "near city X" search. Phase 1 replaces this starter list
-- with the full GeoNames US cities table.
create table public.places (
  id          integer generated always as identity primary key,
  name        text not null,
  state       text not null,
  metro       text not null,
  location    extensions.geography(point, 4326) not null,
  population  integer,
  unique (name, state)
);

create index places_location_idx on public.places using gist (location);
create index places_metro_idx on public.places (metro);

insert into public.places (name, state, metro, location, population)
select name, state, metro, extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography, population
from (values
  ('Madison',         'WI', 'Madison',                43.0731,  -89.4012,   280000),
  ('Milwaukee',       'WI', 'Milwaukee',              43.0389,  -87.9065,   570000),
  ('Waukesha',        'WI', 'Milwaukee',              43.0117,  -88.2315,    72000),
  ('Green Bay',       'WI', 'Green Bay',              44.5133,  -88.0133,   107000),
  ('Chicago',         'IL', 'Chicago',                41.8781,  -87.6298,  2700000),
  ('Evanston',        'IL', 'Chicago',                42.0451,  -87.6877,    75000),
  ('Naperville',      'IL', 'Chicago',                41.7508,  -88.1535,   150000),
  ('Minneapolis',     'MN', 'Twin Cities',            44.9778,  -93.2650,   425000),
  ('St. Paul',        'MN', 'Twin Cities',            44.9537,  -93.0900,   310000),
  ('New York',        'NY', 'New York',               40.7128,  -74.0060,  8300000),
  ('Brooklyn',        'NY', 'New York',               40.6782,  -73.9442,  2600000),
  ('San Francisco',   'CA', 'San Francisco Bay Area', 37.7749, -122.4194,   810000),
  ('Oakland',         'CA', 'San Francisco Bay Area', 37.8044, -122.2712,   430000),
  ('San Jose',        'CA', 'San Francisco Bay Area', 37.3382, -121.8863,   970000),
  ('Los Angeles',     'CA', 'Los Angeles',            34.0522, -118.2437,  3800000),
  ('San Diego',       'CA', 'San Diego',              32.7157, -117.1611,  1380000),
  ('Seattle',         'WA', 'Seattle',                47.6062, -122.3321,   750000),
  ('Bellevue',        'WA', 'Seattle',                47.6101, -122.2015,   150000),
  ('Portland',        'OR', 'Portland',               45.5152, -122.6784,   630000),
  ('Denver',          'CO', 'Denver',                 39.7392, -104.9903,   715000),
  ('Salt Lake City',  'UT', 'Salt Lake City',         40.7608, -111.8910,   200000),
  ('Phoenix',         'AZ', 'Phoenix',                33.4484, -112.0740,  1650000),
  ('Dallas',          'TX', 'Dallas–Fort Worth',      32.7767,  -96.7970,  1300000),
  ('Plano',           'TX', 'Dallas–Fort Worth',      33.0198,  -96.6989,   290000),
  ('Austin',          'TX', 'Austin',                 30.2672,  -97.7431,   980000),
  ('Houston',         'TX', 'Houston',                29.7604,  -95.3698,  2300000),
  ('Atlanta',         'GA', 'Atlanta',                33.7490,  -84.3880,   500000),
  ('Boston',          'MA', 'Boston',                 42.3601,  -71.0589,   650000),
  ('Washington',      'DC', 'Washington DC',          38.9072,  -77.0369,   690000),
  ('Arlington',       'VA', 'Washington DC',          38.8816,  -77.0910,   235000),
  ('Philadelphia',    'PA', 'Philadelphia',           39.9526,  -75.1652,  1580000),
  ('Detroit',         'MI', 'Detroit',                42.3314,  -83.0458,   630000),
  ('Columbus',        'OH', 'Columbus',               39.9612,  -82.9988,   905000),
  ('Indianapolis',    'IN', 'Indianapolis',           39.7684,  -86.1581,   880000),
  ('St. Louis',       'MO', 'St. Louis',              38.6270,  -90.1994,   290000),
  ('Kansas City',     'MO', 'Kansas City',            39.0997,  -94.5786,   510000),
  ('Omaha',           'NE', 'Omaha',                  41.2565,  -95.9345,   485000),
  ('Des Moines',      'IA', 'Des Moines',             41.5868,  -93.6250,   215000),
  ('Nashville',       'TN', 'Nashville',              36.1627,  -86.7816,   690000),
  ('Charlotte',       'NC', 'Charlotte',              35.2271,  -80.8431,   880000),
  ('Raleigh',         'NC', 'Raleigh–Durham',         35.7796,  -78.6382,   470000),
  ('Miami',           'FL', 'Miami',                  25.7617,  -80.1918,   450000)
) as v(name, state, metro, lat, lng, population);
