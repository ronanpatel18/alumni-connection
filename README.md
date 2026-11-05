# Alumni Connect

A professional network and business-intelligence tool for
University of Wisconsin–Madison alumni: find alumni by city, industry and class
year, see who you already know, plan meetings in a city, and see how many alumni
work in each industry and market.

The full technical plan is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Stack

| Layer | Technology |
|---|---|
| App | Next.js 16 (App Router, Cache Components), React 19, TypeScript, Tailwind CSS 4 |
| Database & auth | Supabase: Postgres with PostGIS, pgvector, pg_trgm; row-level security; magic-link sign-in |
| Background jobs | Inngest |
| AI | Open models by default (Ollama locally; DeepInfra/Groq/any OpenAI-compatible host in production), optional Claude fallback, `fixture` mode for $0 development |
| Rate limiting | Upstash Redis (in-memory fallback locally) |
| Design | Open Design → `design/system/tokens.css` → Tailwind |

## Local development ($0)

Prerequisites: Node 20.9+, and [Docker Desktop](https://www.docker.com/products/docker-desktop/)
for the local Supabase stack. [Ollama](https://ollama.com) is optional (only for `AI_MODE=live`).

```bash
npm install
```

```bash
npm run db:start
```

`db:start` prints your local API URL, publishable key and secret key. Copy
`.env.example` to `.env.local` and fill in those three values.

```bash
cp .env.example .env.local
```

```bash
npm run dev
```

Load the first real people, the Wisconsin School of Business advisory boards
(a snapshot in `data/sources/`; safe to re-run):

```bash
npm run import:wsb-boards
```

Then open http://127.0.0.1:3000. With `DEV_AUTO_LOGIN_EMAIL=admin@wisc.edu`
in `.env.local` (the default in `.env.example`), you're signed in automatically
as a verified administrator and land on the full directory (`/search`); the
account is created on first visit. Typing admin@wisc.edu on `/login` also skips
the inbox. This only
works under `npm run dev` against a local Supabase, and production builds
ignore it. Signing out takes you to `/login`; open any member page to be signed
back in.

To test the real sign-in instead, remove that line, restart `npm run dev`, and:

1. Open http://127.0.0.1:3000/login and request a sign-in link.
2. Open the local inbox at http://127.0.0.1:54324 and click the link.
3. Verify yourself (the real claim/verification flow is Phase 1):

   ```bash
   npm run dev:promote -- you@example.com admin
   ```

Search at http://127.0.0.1:3000/search. Use the **Group** filter to see each board.

`npm run db:reset` rebuilds the database from the migrations. It holds no fake
people; the 5,000 synthetic alumni in `tests/db/fixtures/` are only used by tests.

### Claim or remove a profile

There's no public name search, so the directory never reveals who's in it.
Each person gets a **private link** (`/claim/<token>`, `/remove/<token>`) for
their invitation email:

```bash
npm run links:generate -- --group wisconsin-business-alumni-board
```

- **Claim:** the person signs in by email. If that email is on file for the
  profile, it's linked and they're verified at once; otherwise the claim waits
  for an administrator.
- **Remove:** one step, no account. The profile and everything derived from it
  is deleted; a minimal suppression record (keyed to the source listing) stops
  imports from re-adding them.

Only a SHA-256 of each token is stored. The CSV holds the real links, so treat
it like a password file.

### Profile & privacy (members with a claimed profile)

`/me` (sidebar: **Profile & privacy**) has three tabs:

- **Edit profile:** name, role, employer, city, industry, UW degree and class
  year, what they're open to, and a short bio. A new role moves the old one to
  history.
- **Privacy & visibility:** email, phone, website and LinkedIn, all visible to
  every verified member. Leaving a field blank removes it. Changing an email
  clears its verified label until it's checked again.
- **Data sources:** where each field came from.

Member edits are recorded as source `self` and always win over imported or AI
data. "Leave the network" deletes the profile the same way a remove link does,
then signs the member out.

### Enrichment (UW degrees, class year, location, industry)

```bash
npm run enrich -- --group wsb-external-advisory-board
```

Uses Google Gemini's **free tier** (`gemini-3.1-flash-lite`, about 1s a call): create a
key at https://aistudio.google.com/apikey, paste it into `GEMINI_API_KEY` in
`.env.local`, and set the `gemini` provider (see `.env.example`). The free tier
limits requests per minute; batch scripts wait and retry. Optional: a free Tavily key
(`TAVILY_API_KEY`) adds web search for people without a bio. Every saved fact
must quote its source word for word (checked in `lib/enrichment/verify.ts`);
anything the model can't back up is dropped. Add `--dry-run` to preview.

### Web search (self-hosted SearXNG, free)

```bash
npm run search:start   # SearXNG in Docker at http://127.0.0.1:8888 (this machine only)
npm run search:stop
```

Enrichment searches the web through a self-hosted [SearXNG](https://docs.searxng.org)
metasearch engine: no key, no cost. Config is in `searxng/`; the first start
writes a random secret to `searxng/.env` (git-ignored). Each search goes to one
engine, rotating through Yahoo, Bing, Brave, Google CSE and Qwant
(`SEARXNG_ENGINES`), and each engine gets at most one search every 6 seconds
(`SEARXNG_GAP_MS`), because engines suspend clients that search fast. Class-year
runs work on 5 people at once (`--concurrency`) and only download pages whose
title or snippet looks relevant. Tavily still works as an opt-in alternative:
`SEARCH_PROVIDER=tavily` with `TAVILY_API_KEY`, or `--tavily` on `class-years`.

### Class years

```bash
npm run class-years            # dry run: prints each year with its quote and link
npm run class-years -- --write # saves them
```

For people still missing a class year, reads explicit statements only ("BBA
'94", "class of 1998", "graduated from UW–Madison in 1991", a LinkedIn
"1993 – 1997" education line). Sources, free ones first:

1. Their stored bio and Wikidata.
2. **UW–Madison's own sites** through their built-in site search, no key and no
   cost: business.wisc.edu, news.wisc.edu, On Wisconsin (onwisconsin.uwalumni.com),
   supportuw.org and engineering.wisc.edu. These write alumni as "Name (BBA '94)".
3. **Wikipedia** search and article text.
4. Three web searches a person through SearXNG (or Tavily with `--tavily`).

Requests go one at a time per site with a pause, back off on "too many
requests", and are cached for a week in `data/private/`. A year counts only when
it's attached to this person's own name (not a spouse's or a namesake's) or the
page is about them. It skips honorary degrees, relatives' degrees, other UW
campuses, name lists such as commencement programs, and conflicting sources;
nothing is estimated. Years a member or administrator entered are never changed.

### LinkedIn

```bash
npm run linkedin            # dry run: what it would change, per person
npm run linkedin -- --write # saves it
```

Works the way wsbcconnect did: through LinkedIn's public search snippets (via
SearXNG, or Tavily), never by fetching or scraping LinkedIn (that breaks LinkedIn's terms).
For each unclaimed profile it finds the LinkedIn URL if missing (wsbcconnect's
"Name Title Company linkedin" search and scoring, plus: the result's title must
carry their first and last name and it must mention their employer), then reads
the snippet for location, dated work history and UW–Madison degrees. When
LinkedIn shows the listed job has ended, the current role moves to the newer
one. Snippets are cached for a week in `data/private/`, so a dry run and the
saving run use the free search quota once. Profiles show a LinkedIn icon by the
name and a "Connect on LinkedIn" button, as on wsbcconnect.

### Administration (`/admin`, administrators only)

- **Profile review:** unclaimed profiles with a missing class year, unconfirmed
  UW degree, incomplete role, or missing location or industry, most gaps
  first. Each review page shows the profile's sources and research links; the
  administrator corrects what a source supports and leaves a note. Corrections
  are recorded as source "Administrator", and re-imports leave them alone.
- **Claim requests:** claims whose sign-in email isn't on file. Approving links
  the profile and verifies the member; every decision goes in the audit log.

### AI in development

`AI_MODE=fixture` (the default) makes no network calls. Each AI task returns a
recorded answer from `lib/ai/fixtures/` if there is one, otherwise a
deterministic stub built only from the profile's facts. To try real models:

```bash
ollama pull gpt-oss:20b && ollama pull bge-m3
```

Then set `AI_MODE=live` in `.env.local`. `AI_MODE=record` calls the live model and
saves each answer as a fixture, so tests can replay it offline.

Fill AI summaries and embeddings for seeded profiles without running Inngest:

```bash
npm run dev:summaries -- 500
```

Or run the Inngest dev server alongside `npm run dev` and send a
`people/summaries.backfill` event from its UI:

```bash
npm run inngest:dev
```

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm run lint` / `npm run typecheck` | ESLint / route-type generation + `tsc` |
| `npm test` | Unit tests plus database tests (migrations, seed and RLS run in PGlite, no Docker needed) |
| `npm run db:start` / `db:stop` / `db:reset` | Local Supabase |
| `npm run inngest:dev` | Inngest dev server for background jobs |
| `npm run dev:promote -- <email> [role]` | Local only: set a member's role |
| `npm run dev:summaries -- [limit]` | Local only: write AI summaries + embeddings |
| `npm run links:generate -- [--group slug]` | Create private claim/remove links for invitation emails (git-ignored CSV in `data/private/`) |
| `npm run design:sync` | After re-exporting from Open Design: regenerate the app's copy of the design's component CSS |
| `npm run import:wsb-boards` | Import WSB advisory-board members from `data/sources/` |
| `npm run enrich -- [--group slug] [--concurrency N] [--dry-run]` | Extract degrees, location and industry from bios and web search |
| `npm run class-years -- [--write] [--names "A,B"] [--no-search] [--tavily]` | Find missing class years from stated sources (dry run unless `--write`) |
| `npm run deploy:db` | Apply migrations to the hosted Supabase project and copy the directory data ([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)) |
| `npm run search:start` / `search:stop` | Start or stop the self-hosted SearXNG search engine (Docker) |
| `npm run linkedin -- [--write] [--names "A,B"]` | LinkedIn URL, location, work history and UW degrees from search snippets (dry run unless `--write`) |

## Project layout

```
app/                    pages (landing, login, pending, search, people/[id], saved) and route handlers
components/             shared UI
lib/ai/                 AI layer: config, schemas, prompts, backends (fixture, OpenAI-compatible, Claude)
lib/search/             rule-based query parser, search vocabulary
lib/supabase/           server, browser and service-role clients
lib/rate-limit.ts       rate limiting (from conference-connection)
lib/validation.ts       input validation (from conference-connection)
inngest/                background jobs (profile summaries, backfill, email retries)
supabase/migrations/    schema, reference data, RLS, search functions
supabase/seed.sql       empty (real people come from importers)
data/sources/           source snapshots for importers (e.g. WSB advisory boards)
lib/importers/          snapshot → directory rows
lib/enrichment/         evidence verification and web search
design/                 Open Design system package and prototypes
tests/db/               PGlite harness + RLS and search tests
tests/unit/             parser and AI-layer tests
```

## Status

**Phase 0 (setup):** done, except a Vercel deploy (needs a Vercel account) and
running the app against local Supabase (needs Docker).

**Phase 1 (foundation), started:**

- Built: magic-link sign-in, pending/verified gate, directory search with
  industry, radius, class-year and open-to filters, a free-text parser,
  confirmed vs. unconfirmed counts, breakdowns by industry and metro, profile
  pages with contact details, saved contacts, private notes, and
  the AI-summary background job, the advisory-board import with web
  enrichment, claim-or-remove links, profile editing and privacy settings, and the admin
  review queue (profile review and claim requests).

**Phase 2 (intelligence), started:**

- Built: the **trip planner** (`/trips`). Pick a city, dates, industries and a
  goal; get alumni within 50 miles with an "AI-generated relevance" line each
  (cached per trip, streamed in so the list shows at once); keep a private
  shortlist; get an "AI-drafted · Editable" first message per person, saved as a
  private draft, plus a downloadable tentative calendar invitation. Nothing is
  sent by the app: there's no email relay yet, so members copy the message or
  open it in their email or LinkedIn. Follows `design/prototypes/HANDOFF.md`
  (Trips flow) and `design/system/DESIGN.md` (AI labels, no scores).
- Built: **who to meet** (`/discover/who-to-meet`, top three on Discover).
  Choose a goal (partnerships, clients and referrals, investors, a mentor) and
  a market; suggestions are ordered by plain signals (seniority, industry,
  experience, what people say they're open to, confirmed profiles) and each gets
  an "AI-generated relevance" line plus an evidence line. No score is shown.
- Built: **introductions** (`/introductions`, "A warmer introduction" on
  profiles). Ask a member who knows someone (a shared board or a recorded
  connection) to introduce you. The connector decides first ("I'm happy to
  introduce them" / "Decline quietly"); the recipient is asked only if they
  agree, and only two yeses complete it. Every decision is an append-only
  consent event (`intro_events`); state changes only through checked database
  functions; requests can be cancelled and expire after 30 days; nobody sees
  another role's controls. Notifications are in-app for now (no email relay).
- Built: **network insights** (`/insights`). Counts by market and industry,
  filterable by industry and city, always split into confirmed and unconfirmed
  records (solid and patterned bars, with numbers). Every record is counted:
  cities outside the places list are kept, and records with no location or
  industry are reported as such. The population estimate shows "—
  unavailable"; nothing is extrapolated.
- Built: **LinkedIn import** (`/me/linkedin`). Members upload their own
  LinkedIn data export (the ZIP or its CSVs); it's read in the browser and never
  stored. Members with a claimed profile can add their work history and
  UW–Madison degrees (recorded as member-provided; nothing is overwritten).
  Connections are matched to the directory by LinkedIn profile URL, or full name
  plus employer (never name alone); only matches are kept, visible only to the
  member ("In your LinkedIn connections" on profiles), and removable anytime.
- Built: **private messages** (`/messages`), the design's "relay". Members
  message each other inside Alumni Connect; the recipient gets an email saying
  who wrote (never the message, never an address) with a link, and replies
  happen here. Only members can be messaged; new conversations are limited to
  20 a day per sender. Trip outreach can send its draft this way to members,
  profiles of members have "Send a message", and every introduction step emails
  whoever is next. Emails go to the local Mailpit inbox in development and
  through Resend (`RESEND_API_KEY`, `EMAIL_FROM`) in production; the
  `notifications` table is the outbox.
- Deployment: see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (Vercel + hosted Supabase;
  `npm run deploy:db` sets up the hosted database).

**Phase 1, still to build:**
  - Roster CSV import.
  - Enrichment pipeline v1 (People Data Labs + web verification).
  - Full GeoNames city table.
