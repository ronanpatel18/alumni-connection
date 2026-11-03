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

Then:

1. Open http://127.0.0.1:3000/login and request a sign-in link.
2. Open the local inbox at http://127.0.0.1:54324 and click the link.
3. Verify yourself (the real claim/verification flow is Phase 1):

   ```bash
   npm run dev:promote -- you@example.com admin
   ```

4. Search at http://127.0.0.1:3000/search. Use the **Group** filter to see each board.

`npm run db:reset` rebuilds the database from the migrations. It holds no fake
people; the 5,000 synthetic alumni in `tests/db/fixtures/` are only used by tests.

### Enrichment (UW degrees, class year, location, industry)

```bash
npm run enrich -- --group wsb-external-advisory-board
```

Uses a **free** model picked from [models.dev](https://models.dev): DeepSeek V4.1
Flash on NVIDIA's API. Get a free key at https://build.nvidia.com and set the
`AI_MODE=live` block shown in `.env.example`. Optional: a free Tavily key
(`TAVILY_API_KEY`) adds web search for people without a bio. Every saved fact
must quote its source word for word (checked in `lib/enrichment/verify.ts`);
anything the model can't back up is dropped. Add `--dry-run` to preview.

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
| `npm run design:sync` | After re-exporting from Open Design: regenerate the app's copy of the design's component CSS |
| `npm run import:wsb-boards` | Import WSB advisory-board members from `data/sources/` |
| `npm run enrich -- [--group slug] [--concurrency N] [--dry-run]` | Extract degrees, location and industry from bios and web search |

## Project layout

```
app/                    pages (landing, login, pending, search, people/[id], saved) and route handlers
components/             shared UI
lib/ai/                 AI layer: config, schemas, prompts, backends (fixture, OpenAI-compatible, Claude)
lib/search/             rule-based query parser, search vocabulary
lib/supabase/           server, browser and service-role clients
lib/rate-limit.ts       rate limiting (from conference-connection)
lib/validation.ts       input validation (from conference-connection)
inngest/                background jobs (profile summaries, backfill)
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
  pages with per-detail contact visibility, saved contacts, private notes, and
  the AI-summary background job.
- Still to build:
  - Roster CSV import.
  - Enrichment pipeline v1 (People Data Labs + web verification).
  - Claim-your-profile and "remove me" flows.
  - Profile editing and privacy settings UI.
  - Admin review queue.
  - Full GeoNames city table.
