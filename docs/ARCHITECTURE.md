# Alumni Connect — Technical Plan

## Context
`/Users/Patron/alumni-connection` is an empty repo (no commits). We're building **Alumni Connect**: a national, verified directory of **University of Wisconsin–Madison alumni**, **free to members**. It lets people find alumni by city, industry and keywords, see who they already know, plan meetings in a city, get suggestions on who to meet, and see how many alumni work in an industry or market.

**Operating model (from your answers):** profiles are **pre-built by AI enrichment and third-party data** before the person ever signs up. Signing up is only needed to **view** the network. Alumni can also sign up themselves, and AI enrichment drafts their profile.

**Reference system:** `github.com/ronanpatel18/conference-connection` (wsbcconnect.com). We reuse its backend patterns, not its UX:
- Next.js 15 App Router, Supabase (Postgres + RLS + Auth), Upstash rate limiting, Zod validation
- Enrichment: web search (Tavily), then an LLM writes a summary and tags (`app/api/enrich-profile/route.ts`, `lib/enrichment.ts`)
- LinkedIn URL discovery: web search limited to `linkedin.com/in/`, plus a scoring heuristic (`app/api/lookup-linkedin/route.ts`)
- Pre-seeded profiles that people **claim** through fuzzy name matching (`app/api/onboarding/lookup` + `claim`)

What we change in this platform:
- Enrichment runs in **background jobs**, not inside a request.
- Every field stores **where it came from and how confident we are**.
- The industry list lives in a **database table**, not in code (`lib/industry.ts`).
- Read access requires a **verified** alumnus. In WSBC, any logged-in user can read every profile.
- Claude replaces Gemini/OpenAI.

---

## 1. Stack options (sized for one school: roughly 50k–500k alumni)

| Option | Pieces | Good for | Downsides |
|---|---|---|---|
| **A. Recommended** | Next.js 15 (TS) on **Vercel** + **Supabase** (Postgres with PostGIS, pgvector, pg_trgm and full-text search; Auth; Storage) + **Inngest** for background jobs + **Upstash** Redis | Fastest path; same stack as WSBC; one database handles 500k profiles easily; row-level security protects data at the database layer | Vendor lock-in is moderate (it's still plain Postgres, so we can leave) |
| B. Best-of-breed | Next.js on Vercel + **Neon** Postgres + **Clerk** auth + **Typesense** search | Strong search UX and polished auth UI | More vendors; no RLS through auth; search index must stay in sync with the database |
| C. Enterprise | Next.js on AWS (Amplify or ECS) + RDS/Aurora + Cognito + OpenSearch + SQS/Lambda | Fits if the university's IT requires AWS, SOC 2 or data residency | 2–3x the setup and ops work |

**Pick A.** Move to B or C only if the institution requires it. We don't need a graph database: an `edges` table plus recursive SQL handles 2-hop introduction paths at this scale.

## 2. Backend architecture

```
Browser ─► Next.js (Vercel): server components + route handlers (Zod, rate limits)
              │
              ├─► Supabase Postgres (RLS)  ◄── Inngest jobs (enrichment, refresh, imports, embeddings)
              │       PostGIS · pgvector · FTS/trgm              │
              ├─► Claude API (search parsing, ranking "why",     ├─► People Data Labs (licensed enrichment)
              │    outreach drafts, enrichment extraction)       ├─► Claude web_search / web_fetch (verification)
              ├─► Voyage AI (embeddings; Anthropic has none)     ├─► Geocoding (Mapbox)
              └─► Resend (email: invites, intros, digests)       └─► Email verification (ZeroBounce/NeverBounce)
```

### Core data model (Postgres; every table has `institution_id` so we can add more schools later at little cost)
- `people`: the profile (name, `claimed_by_user_id`, status `seeded|claimed|verified|opted_out`, headline, bio, `ai_summary`, `embedding vector`, `location geography`, city, state, metro, networking interests)
- `educations`: degree, program, graduation year, clubs. `verified_by` = roster, email or admin
- `positions`: employer org, title, seniority, function, start and end dates, current flag
- `organizations`: name, domain, NAICS industry, HQ location. Feeds the alumni business directory
- `industries`: two-level taxonomy (NAICS sectors + custom subtags), editable by admins
- `contact_points`: type (email, phone, website, linkedin), value, `source`, `verified_at`, `visibility` (`members|connections|private`; recorded but no longer limits reads)
- `field_provenance`: per field: source (`self|roster|pdl|web|ai`), confidence, `fetched_at`, citation URL. **Anything the member edits themselves always wins.**
- `edges`: person_a, person_b, type (`classmate|coworker|linkedin_import|met|introduced|mentor`), weight, source, `shared_by_consent`
- CRM layer: `saved_contacts`, `lists`, `notes` (private), `interactions` (meetings, calls, follow-ups with due dates), `intro_requests` (requester → connector → target, double opt-in status)
- `trips`: city, dates, goals → `trip_suggestions`
- `recommendations`: cached score + JSON of reasons
- `privacy_settings`, `suppression_list` (people who asked to be removed; checked before any seeding), `audit_log`, `enrichment_jobs`

### Search ("commercial real estate alumni in Chicago")
1. Claude **parses the free-text query into structured filters** using structured outputs: `{industries, keywords, location, radius_mi, grad_years, interests}`.
2. **Hybrid SQL:** filters (PostGIS `ST_DWithin`, industry, year) + full-text/trigram on titles and bios + pgvector similarity, merged into one score.
3. Facet counts come back with every search. That covers "N alumni in this industry in this market."

### "Who is the best to connect with?" (relevance, not one global ranking)
- **Stage 1, deterministic score:** industry/specialty match, seniority fit for the goal, distance, connection proximity (1st/2nd degree), shared program/club/class year, open to networking, profile completeness and freshness.
- **Stage 2:** Claude re-ranks the top ~30 against the user's stated goal and writes a one-line **"why this person"** for each.
- Counts always separate **verified** records from **estimated/seeded** ones.

### Meeting planner ("I'll be in Dallas next week")
Create a trip → find candidates within a radius, in the chosen industries, who are open to meeting → rank them → Claude drafts a personal outreach note for each → send through the platform's email relay (Resend). The real email address stays hidden unless the recipient allows it. Phase 1 scheduling uses ICS files and a booking link. Google/Microsoft calendar sync (via Nylas or Cal.com) comes in Phase 3.

### Organic introductions
Find 2-hop paths in `edges` where the middle person has opted in to sharing connections → **double opt-in intro request** (the connector agrees, then the target agrees) → becomes an `interaction` with follow-up reminders (Inngest scheduled jobs).

## 3. Data acquisition and enrichment pipeline (evolved from WSBC)

```
Seed list (school roster CSV / public alumni sources / self sign-up)
  → check suppression_list → dedupe (name + school + year + employer; trigram similarity)
  → PDL person enrichment (employer, title, location, industry; work email/phone only where the license allows)
  → Claude + web_search/web_fetch: confirm current role, find LinkedIn URL (WSBC scoring heuristic as fallback),
     extract a strict JSON profile with a confidence score and source URL per field
  → normalize: geocode, map to the industry taxonomy, map seniority
  → email verification → write the fields with provenance → embed (Voyage) → index
  → if confidence is low → admin review queue
  → re-run every quarter, or when a member updates their profile
```

- Bulk seeding goes through the **Message Batches API** (50% cheaper, fine since it isn't real-time). The prompt is the same for every person, so prompt caching applies.
- **Rule: the LLM only extracts what its sources say. It never guesses contact information.** A phone or email is shown only if it came from the member, the roster or a licensed provider, and passed verification.

## 3b. Ways to find UW–Madison alumni and their details

Legend: **E** email · **P** phone · **C** current company/title · **Y** graduation year/degree · **L** location

### Tier 1: Partnerships (best data, lowest risk; pursue in parallel with the build)
| Source | Gives | How | Notes |
|---|---|---|---|
| **Wisconsin Foundation and Alumni Association (WFAA)** | E P C Y L | Data-sharing agreement, roster export | The biggest unlock. WFAA holds the official alumni database. Gives us verified status, permission to email, and possibly the right to use UW branding. **WFAA already runs [Badger Bridge](https://www.uwalumni.com/alumni-directory)**, a members-only directory covering 440,000+ graduates where you can search by location and profession. It's both a competitor and a possible partner. Our edge is the AI layer (who to meet, trip planner, intro paths, market intelligence); pitch WFAA on that rather than on a second directory. |
| School/college alumni offices (Wisconsin School of Business, Law, Engineering, L&S, Ag & Life Sciences) | E C Y | Per-school partnership | Easier to approach than WFAA; good pilot audience (Business alumni fit "business networking" best). |
| City **Badger chapters** / alumni clubs (Chicago, NYC, Dallas, etc.) | E C L | Chapter leaders share member lists or promote sign-up | Seeds markets city by city; also our channel for events. |
| Student organization, Greek and athletics alumni groups | E Y | Leaders invite their members | High-trust groups that bring warm sign-ups. |

### Tier 2: Licensed data providers (API, paid, allowed for commercial use)
| Provider | Gives | Notes |
|---|---|---|
| **People Data Labs**: Person Search filtered on `education.school = University of Wisconsin–Madison` | C Y L, LinkedIn URL, some E P | **Best way to generate the seed list:** one query returns every alumnus PDL knows of, with employer, title, location and degree end-date. Pay per record. |
| **Clay** (waterfall enrichment) | E P | Tries Apollo, Hunter, Lusha, Prospeo and others in turn until it finds an email/phone. Good for filling contact gaps on high-value profiles. |
| Apollo.io / RocketReach | E P C | Both can filter by school; APIs available. Good second sources. |
| Hunter.io | E | Guesses the work-email pattern for a company domain and checks it. Cheap. |
| ZeroBounce / NeverBounce | email validity | Check every email before showing it. |
| Crunchbase | C (founders, executives) + education | Feeds the alumni business directory. |
| National Student Clearinghouse **DegreeVerify** | Y (verified) | Confirms a degree, with the person's consent, for high-trust verification. |

### Tier 3: Public sources (free; AI agent extracts the facts and records the source)
| Source | Gives | Notes |
|---|---|---|
| **UW–Madison commencement programs** (published by year and degree) | Y + degree, names | Lets us confirm graduation year and degree against a seeded name. Check how far back they're published online. |
| ***On Wisconsin* magazine class notes** (WFAA) | Y C | "Name '98 joined X as VP…" gives year and career news in one line. |
| **UW Digital Collections**: Badger Yearbook | Y | Older classes. |
| UW Athletics historical rosters | Y | Former athletes are a strong networking group. |
| Department "alumni spotlight" pages, Daily Cardinal, Wisconsin State Journal, press releases ("a graduate of UW–Madison") | C Y | Found through web search. |
| **Professional license lookups**: State Bar of Wisconsin directory (law school and admission year), Wisconsin DSPS license lookup (CPAs, engineers, real estate), other states' bars | C L, Y for lawyers | Public records, often with business phone/address. |
| **FINRA BrokerCheck**, NPI Registry (doctors), SEC EDGAR executive bios | C L, business P/address | Industry-specific; EDGAR bios often mention the degree. |
| Company team/leadership pages | C, sometimes E | Claude web_fetch extracts these. |
| Google Scholar / ORCID / faculty pages | C Y | Academic alumni. |
| Search engines (Claude web_search, Exa people search, Brave/SerpAPI) for `"University of Wisconsin" site:linkedin.com/in` | LinkedIn URL, headline, C | Same approach WSBC uses: we read search-result snippets, never LinkedIn itself. |

### Tier 3b: More free public-data APIs
| API | Gives | Notes |
|---|---|---|
| **SEC EDGAR full-text search** | C, education in executive bios | Search filings for "University of Wisconsin" to find public-company officers and directors. |
| **NPPES NPI Registry API** | C L, practice phone/address | Every US healthcare provider. Match names against the seed list. |
| **OpenAlex** and **ORCID** APIs | C Y, affiliation history | Researchers and academics. OpenAlex can filter authors by past UW–Madison affiliation. |
| **Wikidata SPARQL** | C Y | Notable people "educated at" UW–Madison: execs, founders, public figures. |
| **GitHub API** | C L | Engineers (company, location, bio). |
| **USPTO PatentsView API** | C L | Inventors with employer and city. |
| **Census County Business Patterns** + **BLS OEWS** APIs | Market totals | Total workers and businesses by industry and metro. Shows market size, so "120 alumni in Chicago finance" can sit next to the total finance workforce there. |
| **GeoNames** / Census Geocoder | Lat/long for cities | Free geocoding: load the US cities table into Postgres once. |
| **Do not use:** FEC donor data (federal law bars using it for solicitation or commercial purposes), people-search sites (Spokeo, Whitepages, BeenVerified: home addresses, FCRA risk), LinkedIn-derived datasets (Bright Data, Apify actors, Coresignal LinkedIn data). After LinkedIn sued, [Proxycurl shut down in 2025](https://nubela.co/blog/goodbye-proxycurl/). | | |

### Tier 2b: More commercial APIs, by job
| Job | Options |
|---|---|
| Person and company enrichment | People Data Labs (primary), Apollo, RocketReach, Lusha, Diffbot Knowledge Graph (built from crawling the web), ZoomInfo / Cognism (enterprise, $$$) |
| Contact-finding waterfalls | Clay, FullEnrich, BetterContact (each tries several providers in turn and charges only for hits) |
| Work-email lookup | Hunter, Snov.io, Prospeo |
| Email verification | ZeroBounce, NeverBounce, Kickbox, MillionVerifier (cheapest) |
| Phone validation | Twilio Lookup (line type and carrier; filters out bad numbers before we store them) |
| Web search for the AI agent | Claude `web_search` ($10 per 1,000), Tavily (1,000 free credits/month), Exa (people-focused search), Brave Search, Serper/SerpAPI (Google results) |
| Page → clean text for the AI | Claude `web_fetch`, Jina Reader, Firecrawl |
| Founders and companies | Crunchbase API, OpenCorporates (company officers) |
| Alumni-owned businesses | Google Places API, Yelp Fusion |
| Calendar and scheduling | Cal.com (open source, free to self-host), Google Calendar API, Microsoft Graph, Nylas |
| Email delivery | Resend, Postmark, SendGrid |

### Tier 4: Members themselves (highest accuracy, and the network grows on its own)
- Claim-your-profile emails.
- "Invite a Badger" referrals.
- LinkedIn `Connections.csv` uploads (see §4), which also surface alumni we haven't seeded yet.
- Profile-completeness prompts.
- Quarterly "still at X?" confirmation emails.

### Market-sizing only (manual, don't scrape)
- LinkedIn's **UW–Madison school page → Alumni tab** filters alumni by where they live, where they work and what they do. Use it **by hand** to estimate totals per market ("~4,000 alumni in Chicago finance") and label those numbers as estimates.
- Sales Navigator's terms forbid extracting data, so it's off-limits for seeding.

### Rules
- No LinkedIn scraping, and no vendors that scrape LinkedIn (some "LinkedIn email finder" tools).
- Personal mobile numbers are shown only if the member supplied them or opted in. Third-party phone numbers default to `private` (used only to verify identity).
- Each record's source goes into `field_provenance`, so we can honor deletion requests and drop a source cleanly if its license ends.
- **UW branding:** the project is associated with UW–Madison (confirmed 2026-11-03), so UW branding (motion W, Bucky, UW red, "Badgers") may be used, following UW–Madison's brand guidelines.

## 4. LinkedIn: what's actually possible
- **There is no API for anyone's LinkedIn connections**, and scraping breaks LinkedIn's terms. Don't build on it, and don't use vendors that scrape LinkedIn.
- **Sign In with LinkedIn (OpenID Connect)** gives only name, email and photo. It's useful as a login option and as a light identity signal.
- **"Who do I already know" works this way instead:** a member uploads their own LinkedIn data export (`Connections.csv`). We match those rows to directory profiles and create `linkedin_import` edges that only that member can see, unless they choose to share them. They can delete the upload anytime.
- Public profile URLs are found with web search, as WSBC does.

## 5. Authentication and verification
- **Supabase Auth:** email magic link, Google, and LinkedIn OIDC. Add SAML SSO if the school offers an alumni login.
- **Proving someone is an alumnus**, in this order: (1) **claim a seeded profile** (WSBC lookup/claim flow, strengthened with an emailed code to an email we have on file, or admin approval); (2) match against the institution's roster; (3) alumni or `.edu` email domain; (4) manual admin queue.
- **Roles:** `pending`, `member` (verified), `chapter_leader`, `admin`, `super_admin`. RLS rules:
  - Only verified members can read profiles.
  - Every contact detail is visible to all verified members. The `visibility` column is kept but no longer limits reads.
  - Notes are private to their author.
  - Admins get audit logs.
- **Unclaimed profiles:** a public "Is this you? Claim or remove" page. Removal takes one click and adds the person to the suppression list.

## 6. AI integration (Claude, TypeScript `@anthropic-ai/sdk`)

> **Update:** at runtime, open models (§6b) are now the default. The Claude setup below is the fallback path, and the reference quality bar for the eval.

| Job | Model | Feature |
|---|---|---|
| Parse free-text search into filters | `claude-opus-5-5` at low effort | structured outputs (`output_config.format`) |
| Re-rank and explain "why", trip shortlists | `claude-opus-5-5` | structured outputs, prompt caching |
| Draft outreach and intro messages | `claude-opus-5-5` | streaming |
| Bulk enrichment extraction | `claude-opus-5-5` by default. **Decision for you:** `claude-haiku-5-5` costs ~40x less per token for large seeding runs | Batches API + `web_search_20260209` / `web_fetch_20260209` |
| Embeddings | Voyage AI | — |

All prompts and schemas live in `lib/ai/`. We build a small **eval set**: about 50 known alumni with hand-checked fields, used to measure enrichment accuracy before we trust a model or prompt change.

## 6b. AI cost: open models for profiles and day-to-day use

**Claude builds the platform** (Claude Code). **Open models run the product.** Claude is used at runtime only as an optional fallback.

### Where the money actually goes
- Per profile, the LLM is a small cost: ~$0.002 on Haiku 5.5, ~$0 on an open model run locally.
- The real costs per profile are web searches (~$0.02) and People Data Labs records (~$0.28).
- So the biggest savings come from **calling less**, more than from changing models.

### Ways to cut cost, in order of savings
1. **Use code where code works.** People Data Labs's structured fields (employer, title, location, education) map straight into the database. The LLM only writes the summary and settles conflicting sources.
2. **Tag industries with embeddings, not an LLM.** Pick the nearest category vector in the taxonomy table.
3. **Search only when needed.** Web searches run only for low-confidence profiles. Use Tavily's free tier or self-hosted **SearXNG** before paid search.
4. **Send less text.** The model gets only the top 3–5 snippets (~2k tokens), not whole pages.
5. **Write once.** Each summary is cached by a hash of its input facts and regenerated only when the facts change.
6. **Day-to-day features:**
   - Searches go through a rule-based parser first (city and industry dictionaries); the LLM only handles what the rules miss.
   - Ranking is plain SQL scoring; the LLM writes "why" lines for the top 10 only, cached per person and goal for 7 days.
   - Outreach drafts are generated only when the user clicks.

### Open models to use (October 2026 rankings; re-check before locking in)
| Job | Pick | Alternatives | License |
|---|---|---|---|
| Pulling facts out of sources, search parsing, tagging (small and fast) | **Qwen3.8-27B** | Gemma 4, gpt-oss-20b; Llama 3.2 3B or Osmosis-Structure-0.6B for very small JSON-only jobs | Apache 2.0 |
| "Why" lines, outreach drafts, trip shortlists (writing quality) | **gpt-oss-120b** | **DeepSeek V4.1 Flash** (MIT, 1M-token context, best value), GLM-5.3, Kimi K3 (strongest overall, larger) | Apache 2.0 / MIT |
| Embeddings | **Qwen3-Embedding** (0.6B for CPU/dev, 8B for best quality) | **BGE-M3** (MIT; one model covers both keyword-style and meaning-based search) | Apache 2.0 / MIT |

- Avoid models with custom licenses for the core product: Llama (community license), Meta's Muse Spark Open, Gemma's own terms. Prefer Apache 2.0 or MIT.
- Always use **constrained JSON output** (Ollama `format` with a JSON Schema; vLLM guided decoding). Validate with Zod, and retry once with the validation error fed back.

### Where they run
| Stage | Runtime | Cost |
|---|---|---|
| Development | **Ollama** (or LM Studio) on this Mac. The Mac's RAM sets the size: 16GB fits gpt-oss-20b or small Gemma 4; 32GB+ fits Qwen3.8-27B (4-bit). Use Qwen3-Embedding-0.6B or BGE-M3 for embeddings. | $0 |
| Pilot seeding (10k profiles) | Same local model, run overnight by an Inngest job (~5s per profile → ~14h) | $0 in tokens |
| Production (day-to-day + refresh) | Hosted open-model APIs (OpenAI-compatible): **DeepInfra** (cheapest; gpt-oss-120b ≈ $0.04 in / $0.17 out per 1M tokens), **Groq** (fastest; gpt-oss-120b $0.15 / $0.60, Qwen3-32B $0.29 / $0.59, 50% batch discount), **Together**, Fireworks; **OpenRouter** to fail over between them | ~$0.01–0.05 per active user/month |
| Self-hosted GPU (vLLM on Modal/RunPod) | Only once usage is steady and high | ~$300–1,500/month always-on |

### How it plugs in
- `lib/ai/provider.ts` defines one interface: `extractProfile`, `parseQuery`, `explainMatches`, `draftOutreach`, `embed`.
- Backends:
  - `fixture`: recorded answers, used in tests.
  - `ollama`: local.
  - `openai-compatible`: covers DeepInfra, Groq, Together, Fireworks and OpenRouter through their OpenAI-style APIs, so one client handles them all.
  - `anthropic`: optional fallback.
- **Each task's model is chosen in config:** `AI_EXTRACT_MODEL`, `AI_WRITE_MODEL`, `AI_EMBED_MODEL`, each with a `*_PROVIDER`.
- **Fallback:** when the open model's extraction confidence is low, or the JSON fails validation twice, the job is re-run on Claude Haiku 5.5. Expected on <5% of profiles.
- **The 50-person eval set picks the model per task.** The pass bar is per-field accuracy ≥ the Haiku baseline and zero made-up contact info.
- The "no source, no field" rule stays enforced in code, whatever the model.

### Effect on the cost estimates (§11)
- **Claude extraction line in the seed cost:** pilot ~$0 (run locally); full seed ~$300–1,000 with hosted gpt-oss or DeepSeek, instead of $6.6k–18k.
- **Claude live-features line in the monthly cost:** ~$10–50 per month for 1,000 active users, instead of $150–400.
- Data (People Data Labs, contact-finding) and searches are now most of the spend.

## 7. Privacy and compliance (needs a legal review before seeding)
- Seeded profiles with contact details of people who never signed up may count as **data-broker activity** under California's Delete Act (and its DROP deletion platform) and other state privacy laws. Contact data from the school's records may fall under **FERPA "directory information"** rules. Get counsel to sign off on the seeding scope and the data agreement with the school.
- **Mitigations built in from day one:**
  - Profiles are visible only to verified members, never public or indexed by search engines.
  - Every field records where it came from.
  - Opt-out and suppression.
  - People can see and delete their data.
  - CAN-SPAM-compliant platform email.
  - No SMS/robocalls (TCPA).
  - Rate limits and audit logs to catch bulk scraping of contact info.

## 8. Deployment and operations
- **Environments:** Supabase projects `dev`, `staging` and `prod`; Vercel preview deploy per PR, production on `main`.
- **Repo:** `supabase/migrations/*.sql` via Supabase CLI (no hand-run SQL like WSBC's schema file), `supabase/seed.sql` with fake alumni.
- **CI (GitHub Actions):** typecheck, lint, unit tests, `supabase db reset` + pgTAP RLS tests, Playwright e2e on preview deploys.
- **Ops:** Inngest Cloud for jobs/crons; Sentry for errors; PostHog for product analytics; Postgres point-in-time backups.
- **Secrets** in Vercel/Supabase env: `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `PDL_API_KEY`, `RESEND_API_KEY`, `UPSTASH_*`, `SUPABASE_SERVICE_ROLE_KEY` (server only).

## 9. Proposed repo layout
```
app/(public)/          landing, claim-or-remove, login
app/(member)/          search, people/[id], trips, saved, intros, settings
app/(admin)/           imports, review queue, analytics, taxonomy
app/api/               route handlers (thin; Zod-validated)
lib/ai/                Claude client, prompts, schemas
lib/search/  lib/ranking/  lib/enrichment/  lib/graph/
lib/rate-limit.ts  lib/validation.ts            ← adapted from WSBC
inngest/               enrichment, refresh, linkedin-import, reminders
supabase/migrations/   schema + RLS + PostGIS/pgvector
docs/ARCHITECTURE.md   this plan, kept current
design/system/         Open Design design-system package (DESIGN.md, tokens.css, manifest.json)
design/prototypes/     exported Open Design screen prototypes (visual reference)
```

## 9b. UI/UX design with Open Design (local, $0)

Open Design (`/Applications/Open Design.app`, v0.26.1) is installed on this Mac. It is where the UI/UX gets designed. Its design systems are portable packages: `manifest.json`, `DESIGN.md` (design rules written for an agent to follow) and `tokens.css` (colors, type, spacing as CSS variables). That gives us a clean handoff into code.

**Workflow:**
1. **Create an "Alumni Connect" design system in Open Design.**
   - Start from a close bundled one (e.g. `clean`, `corporate` or `dashboard`), then set our palette, type and spacing.
   - UW–Madison branding is allowed (the project is associated with UW–Madison).
2. **Design screens as prototypes in Open Design:**
   - Landing page
   - "Is this you?" claim-or-remove page
   - Sign-up and verification
   - Search with filters, map and result cards
   - Profile page
   - Who to meet (recommendations with "why")
   - Trip planner
   - Intro request flow
   - Saved contacts and notes (CRM)
   - Admin: imports, review queue, analytics
   - Mobile versions of the search and profile screens
3. **Check the designs into the repo** so code and design stay in sync:
   - `design/system/` holds the design-system package (`manifest.json`, `DESIGN.md`, `tokens.css`).
   - `design/prototypes/*.html` holds exported screen prototypes, used as the visual reference.
4. **Build from them:**
   - `design/system/tokens.css` is imported into the app and mapped to the Tailwind theme, so colors and spacing come only from the tokens.
   - Components use **shadcn/ui + Tailwind**, styled to the tokens.
   - Each screen is built to match its prototype; Playwright screenshots are compared side by side with it.
5. **Changes go one way:** update the design in Open Design → re-export to `design/` → the code follows. We never hand-edit the tokens in code.

Data and backend work (Phase 0–1 schema, enrichment, auth) doesn't wait on design. Screens get built as each prototype is approved.

## 10. Build phases
- **Phase 0 (setup, $0):**
  - Scaffold Next.js + local Supabase + Inngest Dev Server.
  - Add the `AI_MODE=fixture|live` switch and a synthetic-alumni seed script.
  - Build the `lib/ai/provider.ts` interface with the `fixture`, `ollama` and `openai-compatible` backends.
  - Create the `design/` folder; wire `tokens.css` into Tailwind (design system and prototypes come from Open Design).
  - Migrations for the core tables and RLS.
  - Seed with fake data.
  - CI and Vercel deploy.
  - Write `docs/ARCHITECTURE.md`.
- **Phase 1 (foundation):**
  - Roster CSV import.
  - Enrichment pipeline v1.
  - Claim/verify flow.
  - Directory with filters (geography, industry, keywords).
  - Profile editing and privacy controls.
  - Contact details.
  - Saved contacts and notes.
  - Admin review queue.
- **Phase 2 (intelligence):**
  - Natural-language search.
  - Relevance ranking with "why". **Built** (`lib/recommendations.ts`, `/discover/who-to-meet`): rule-based order per goal, AI writes the reason only.
  - LinkedIn CSV import and mutual connections. **Built** (`/me/linkedin`, migration `…1500_linkedin_import`): the export is parsed in the browser; matches go to a private `my_connections` table rather than `edges`, so members without a claimed profile can use it.
  - Intro engine. **Built** (double opt-in with consent events; migration `…1300_introductions`); 2-hop paths will use `edges` as members import connections.
  - Trip/meeting planner with outreach drafts. **Built** (`app/(member)/trips`, `lib/trips.ts`, migration `…1200_trips`); the email relay and booked meetings are still to come.
  - Follow-up reminders.
  - Private messaging **built** instead of an email-alias relay (migration `…1600_messages`): messages stay in the app, email notifications carry no content or addresses, members only.
- **Phase 3 (network intelligence):**
  - Industry and market analytics (verified vs estimated). **Built** (`/insights`, `network_insights()`, migration `…1400_network_insights`).
  - Business directory.
  - Mentorship matching.
  - Events by city.
  - Jobs and referrals.
  - Engagement dashboard.
  - Calendar sync.

## 11. Cost

Prices come from third-party summaries as of mid-to-late 2026; confirm each on the vendor's pricing page before buying. Claude prices are from Anthropic's current list.

### Development costs $0
| Piece | Free option |
|---|---|
| Database, auth, storage | **Local Supabase in Docker** (`supabase start`): full Postgres with PostGIS and pgvector, plus auth, plus a local inbox that catches every outgoing email. Free cloud Supabase project (2 projects, 500 MB) for a shared dev/staging database. |
| Hosting | `next dev` locally; **Vercel Hobby** (free) for preview deploys during development. Hobby is for non-commercial use only, so switch to Pro at launch. |
| Background jobs | **Inngest Dev Server** locally (free); Inngest Hobby cloud is free up to ~50,000 runs/month. |
| Rate limiting | The in-memory fallback from WSBC's `lib/rate-limit.ts`; Upstash free tier when we deploy. |
| Data | **Synthetic alumni**: a seed script generates ~5,000 realistic fake UW–Madison profiles. No data-provider spend and no real people's information in dev. |
| AI | `AI_MODE=fixture` (default): Claude responses are recorded once and replayed, so tests and day-to-day development make no API calls. `AI_MODE=live` is opt-in, with a hard monthly spend cap (e.g. $5) set in the Anthropic Console. |
| Embeddings | Voyage AI's first **200M tokens are free**, enough to embed ~400,000 profiles. |
| Real-data testing | Free monthly allowances: PDL ~100 records, Tavily 1,000 credits, Hunter ~50 credits, Clay 100 credits, Apollo free plan. Plus every public API in Tier 3b. Enough to run the real pipeline on ~100 real alumni a month. |
| Geocoding | GeoNames city table in Postgres (free forever, in production too). |
| Email | Supabase's local inbox in dev; Resend free tier for staging. |
| CI, errors, analytics | GitHub Actions free minutes, Sentry free developer plan, PostHog free tier. |

The only real dev costs are optional: live Claude calls (pennies per test) and a domain name (~$15/year).

### One-time cost to seed profiles (rough estimates)
Per-profile assumptions: one PDL record, Claude reads ~10k tokens of sources and writes ~1k tokens, about 2 web searches, and one email check.

| Item | Per profile | Pilot: 10,000 alumni | Full: ~300,000 findable alumni |
|---|---|---|---|
| People Data Labs | ~$0.28 on Pro ($98/month for 350 records); much lower on an annual contract | ~$1,000–2,800 | Contract needed; budget ~$10k–30k |
| Claude extraction, Opus 5.5 via Batches (50% off tokens) | ~$0.04 + searches | ~$600 | ~$18,000 |
| Claude extraction, Haiku 5.5 instead | ~$0.002 + searches | ~$220 | ~$6,600 |
| Web searches (2 × $0.01) | $0.02 | included above | included above |
| Contact gaps: Clay or Apollo, only for profiles missing an email | ~$0.05–0.20 per hit | ~$200–800 | ~$5k–20k |
| Email verification | ~$0.005 | ~$50 | ~$1,500 |
| Embeddings | free tier | $0 | $0 |
| **Pilot total** | | **~$2k–4.5k** | |
| **Full total** | | | **~$25k–70k** |

Ways to cut it a lot:
- A **WFAA roster** replaces most of the PDL and contact-finding spend.
- Run web searches only where PDL's data is thin or low-confidence.
- Use Haiku 5.5 for bulk extraction.
- **Seed one pilot group first** (Business School alumni, or one city).

### Monthly running cost in production
| Item | Pilot (~1,000 active users) | Larger (~10,000 active users) |
|---|---|---|
| Vercel Pro | $20 | $20–100 |
| Supabase Pro + compute | $25–60 | $100–300 |
| Inngest, Upstash, Resend, Sentry, PostHog | $0–50 (mostly free tiers) | $100–300 |
| Claude live features: search parsing, "why" rankings, outreach drafts (~$0.40 per active user per month on Opus 5.5; about a third of that with Haiku for search parsing) | ~$150–400 | ~$1,500–4,000 |
| Quarterly data refresh (re-enrich ~25% of profiles) | ~$100–300 | ~$1,000–3,000 |
| **Total** | **~$300–800/month** | **~$3k–8k/month** |

Members use it free, so a sponsor pays these costs: WFAA, a school or college, a chapter, or corporate sponsors. That's one more reason to approach WFAA early.

## Open decisions (don't block Phase 0)
1. Roster access: get the alumni roster through WFAA or UW–Madison, or seed from licensed and public data first?
2. Pilot group: Wisconsin School of Business alumni, or one city (e.g. Chicago), before going national?
3. Data budget: pilot seed (~$2k–4.5k) before a full seed (~$25k–70k)? And who sponsors the ~$300–800/month running cost?
4. Runtime models: open models (§6b) as the default, with Claude Haiku 5.5 as the low-confidence fallback. Confirm with the eval set.
5. Legal sign-off on seeding contact information.

## Verification
- `npm run build` and typecheck pass; `supabase db reset` applies all migrations plus seed data cleanly.
- **pgTAP RLS tests:**
  - An unverified user can't read `people`.
  - A `private` contact detail never shows to others.
  - Notes are visible only to their author.
- **Playwright e2e:** seeded profile → claim with emailed code → search "real estate in Chicago" → save contact → request intro.
- **Enrichment eval:** run on the 50-person reference set; track per-field accuracy and how often contact info is made up (target: 0).
- **Manual check:** a Vercel preview deploy of each phase in the browser pane.
- **Design match:** each built screen's Playwright screenshot is reviewed next to its Open Design prototype in `design/prototypes/`.

## Implementation notes (Phase 0, 2026-11-03)
- **Next.js 16**, not 15: `middleware.ts` is now `proxy.ts`, and Cache Components is on, so every page that reads cookies or search params renders inside `<Suspense>`.
- **Database tests without Docker:** `tests/db/harness.ts` runs the real migrations and seed in PGlite (Postgres compiled to WebAssembly, with PostGIS, pgvector and pg_trgm). A small shim supplies Supabase's `auth` schema and API roles. RLS and search are tested there, and CI also applies the migrations to real Supabase Postgres.
- **Search** is two SQL functions, `search_people` and `search_facets`, both SECURITY INVOKER, so RLS always applies. Free text goes through the rule-based parser in `lib/search/parse-query.ts` first; a model is called only when that parser recognizes nothing.
- **Places** start with 42 US cities in a migration. Phase 1 swaps in the full GeoNames table.
- **Embeddings** are `vector(1024)` to match bge-m3 and Qwen3-Embedding-0.6B. The AI layer refuses vectors of any other size.
- **Inngest locally** needs `INNGEST_DEV=1`.
- **First real data (2026-11-03):** 66 living members of the Wisconsin School of Business advisory boards: External Advisory Board, Wisconsin Naming Partners and Wisconsin Business Alumni Board, plus their cross-listed center boards. They're read from business.wisc.edu, which is behind a Cloudflare bot check, so the page was read in a browser and saved as `data/sources/wsb-advisory-boards-2026-11-03.json`. Refreshing it later means re-reading the page that way, or asking WSB for an export.
- **Runtime AI is a free model from models.dev:** DeepSeek V4.1 Flash on NVIDIA's API, through the `openai-compatible` provider. Enrichment requires a verbatim evidence quote for every fact, checked in code before anything is saved.
- **Synthetic data** moved to `tests/db/fixtures/`. Local and production databases hold only real people.
