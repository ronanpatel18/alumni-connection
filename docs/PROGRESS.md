# Build progress

What is finished, what is partly done and what is left, against the build phases in
[ARCHITECTURE.md §10](ARCHITECTURE.md). Updated 2026-11-12. Update this file whenever a feature lands.

Status words: **Done** (built, tested, in the app) · **Partly** (usable, with a named gap) · **Not started**.

## Phase 0 — Setup: Done

Scaffold, AI mode switch, AI provider layer, design tokens, core migrations and RLS, CI, Vercel deploy, architecture document.

## Phase 1 — Foundation: Done

| Item | Status | Where |
|---|---|---|
| Roster CSV import | **Done** (2026-11-12). Preview, then import the rows marked New; duplicates, repeats and removed people are left out and re-checked at import time. Optional web lookup for the first 25 people with gaps. | `/admin/roster`, `lib/importers/roster-import.ts` |
| Enrichment pipeline | **Done**. Five hosted search providers plus SearXNG; add people by name; bulk "fill in what's missing". | `/admin/people`, `lib/enrichment/` |
| Claim and verify | **Done** | `/claim`, `/admin/claims` |
| Directory with filters | **Done** | `/search`, `/search/ask` |
| Profile editing and privacy | **Done** | `/me` |
| Contact details | **Done** | `/admin/contacts`, `npm run contacts` |
| Saved contacts and notes | **Done** | `/saved`, profile pages |
| Admin review queue | **Done** | `/admin/review` |

Known gap: the city list is still the 42-city starter set. Other cities are stored as text and aren't found by radius search.

## Phase 2 — Intelligence: Done

| Item | Status | Where |
|---|---|---|
| Natural-language search | **Done** | `/search/ask` |
| Relevance ranking with "why" | **Done** | `/discover/who-to-meet` |
| LinkedIn CSV import and mutual connections | **Done** | `/me/linkedin` |
| Introductions (double opt-in) | **Done**. 2026-11-12: more paths to a connector: a member who worked at the same organization, and a member who imported the person as a LinkedIn connection and chose to offer introductions. | `/introductions`, migration `…intro_paths` |
| Trip planner with outreach drafts | **Done**. Drafts send as private messages; 2026-11-12: "Propose a time" books a meeting. | `/trips` |
| Meetings | **Done** (2026-11-12). Propose, accept or decline, cancel; calendar file and Google Calendar link for booked meetings. | `/meetings`, migration `…meetings` |
| Follow-up reminders | **Done** (2026-11-12). Private log of conversations with an optional follow-up date; an email reminder on the day. | `/followups`, migration `…follow_ups` |
| Private messaging | **Done** | `/messages` |

## Phase 3 — Network intelligence: Done

| Item | Status | Where |
|---|---|---|
| Industry and market analytics | **Done** | `/insights` |
| Events by city | **Done** (2026-11-12). Any member posts; RSVP; who's going; host or admin cancels. | `/events`, migration `…events` |
| Jobs and referrals | **Done** (2026-11-12). Post an opening, say whether you'll refer; a referral request is a private message. Posts expire after 60 days. | `/jobs`, migration `…jobs` |
| Business directory | **Done** (2026-11-12). Members list a business; the page also shows founders and owners already in the directory. | `/businesses`, migration `…businesses` |
| Mentorship matching | **Done** (2026-11-12). Members open to mentoring, own field and city first; ask, accept or decline, end. Accepting records a mentor connection. | `/mentorship`, migration `…mentorship` |
| Engagement dashboard | **Done** (2026-11-12). Active members, weekly activity, counts by feature. Counts only. | `/admin/engagement`, migration `…engagement` |
| Calendar sync | **Partly** (2026-11-12). A private calendar address (subscribe once in Google, Apple or Outlook) carries booked meetings, events and follow-up dates, plus per-item calendar files. Reading a member's own calendar for free/busy times is not built; it needs a Google or Microsoft app registration. | `/meetings`, `app/calendar/[token]` |

Navigation: Events, Jobs, Mentorship, Businesses and Insights sit under **Community**; Meetings and Follow-ups under **Relationships**.

## Data quality (2026-11-12)

- Looked-up facts are written one way: degree short forms and title-case majors ("BS, Computer Science"), title-case job titles, keyword-length specialties. Sentences in those fields are dropped. `lib/enrichment/format.ts`
- When a person's employer is known, a page must name it (or the business school's boards) to be used, so a same-name person at UW–Madison isn't mixed in.
- Two different years for one degree: UW–Madison's own page decides; otherwise no year is saved and the lookup says so.
- If the AI model can't be reached (the free tier's per-minute limit, an outage), a lookup saves nothing and is marked failed so it can be run again; a batch stops instead of spending searches. Model calls are spaced out to stay inside the free limit (`ENRICH_MODEL_GAP_MS`, default 4.5 seconds).
- Bulk lookup of profiles with gaps: `/admin/people` → "Fill in what's missing" (15 per click), or `npm run add-people -- --gaps`.

### Lookup of the first 66 profiles (local database, 2026-11-15)

Every unclaimed profile with a gap was looked up once with Keenable, Serper, Exa and Linkup and Gemini.

| | Before | After |
|---|---|---|
| Has a class year | 30 | 49 |
| Has a location | 52 | 63 |
| Has a work history (two or more jobs) | 35 | 62 |
| Has a LinkedIn link | 46 | 57 |

This ran against the local database. Production needs the same run from `/admin/people` → "Fill in what's missing".

## To do before or at deploy

1. **Push the eight `20261112…` migrations to production** (`npm run deploy:db`). Deploys don't migrate; until this runs, the new pages error in production.
2. **Set `CRON_SECRET` in Vercel** (any long random value). `vercel.json` schedules `/api/cron/daily`, which creates follow-up reminders and retries notification emails. Without the secret the job is refused and reminders aren't emailed (Inngest does the same job where it's set up).
3. **Run "Fill in what's missing" on production** (`/admin/people`), 15 profiles per click, after the deploy.

## Not started

- Full US city list (GeoNames) in place of the 42-city starter set.
- Browser end-to-end tests (Playwright): claim → search → save → introduction.
- Enrichment accuracy check against a hand-checked reference set of about 50 people.
- Two-way calendar sync (free/busy) through Google or Microsoft.
- The five open decisions at the end of ARCHITECTURE.md (roster access, pilot group, data budget, runtime model, legal sign-off).
