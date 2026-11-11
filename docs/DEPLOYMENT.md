# Deploying Alumni Connect

Hosting: **Vercel** (the Next.js app, deployed from GitHub) and a hosted **Supabase**
project (database, sign-in). Both have free tiers; Vercel's Hobby plan is for
non-commercial use, so move to Pro before a commercial launch. Total time: about 30 minutes.

Steps marked **(you)** need your own accounts; everything else is scripted.

## 1. Create the Supabase project (you)

1. At https://supabase.com/dashboard, **New project**. Name it `alumni-connect`, pick a
   US region near your users (e.g. East US), and set a strong database password
   (keep it; you'll need it once in step 2).
2. When it's ready, open **Connect** and copy the **Session pooler** connection string.
3. Paste it into `.env.production.local` (git-ignored) as `PROD_DB_URL=...`, replacing
   `[YOUR-PASSWORD]` with the password.

## 2. Set up the database

```bash
npm run deploy:db
```

Applies every migration in `supabase/migrations/`, then copies the directory data from
your local database (people, organizations, positions, education, contact details,
sources, groups, removal requests, admin reviews). Accounts, notes, trips, messages
and introductions are not copied. Safe to re-run.

## 3. Configure sign-in (you)

In the Supabase dashboard:

- **Authentication → URL Configuration**
  - Site URL: your Vercel address from step 4 (e.g. `https://alumni-connect.vercel.app`).
  - Redirect URLs: add `https://<your-domain>/**`.

Sign-in links are sent by the app through Resend (`RESEND_API_KEY` and `EMAIL_FROM` in
step 4), so Supabase's own SMTP settings aren't needed. Resend's free tier needs a domain
you control, verified under **Domains**; `EMAIL_FROM` must use that domain.

## 4. Deploy to Vercel (you, then automatic)

1. At https://vercel.com/new, import the GitHub repository `ronanpatel18/alumni-connection`.
   The defaults (Next.js, `npm run build`) are right.
2. Before the first deploy, add these **Environment Variables** (Production):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → API Keys → publishable key |
| `SUPABASE_SECRET_KEY` | Supabase → API Keys → secret key (server only) |
| `NEXT_PUBLIC_SITE_URL` | your Vercel address, e.g. `https://alumni-connect.vercel.app` |
| `AI_MODE` | `live` |
| `AI_EXTRACT_PROVIDER` / `AI_WRITE_PROVIDER` | `gemini` |
| `AI_EXTRACT_MODEL` / `AI_WRITE_MODEL` | `gemini-3.1-flash-lite` |
| `AI_EMBED_PROVIDER` | `gemini` |
| `AI_EMBED_MODEL` | `gemini-embedding-2` (free tier; profiles must then be embedded once, see README "Prompt search") |
| `GEMINI_API_KEY` | your Google AI Studio key |
| `RESEND_API_KEY` | Resend API key (message and introduction emails) |
| `EMAIL_FROM` | e.g. `Alumni Connect <notifications@your-domain>` |

Recommended: `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (free at
https://upstash.com). Without them, rate limits are counted per server instance, which
on Vercel means they're weak.

Never set `DEV_AUTO_LOGIN_EMAIL` or `INNGEST_DEV` in production (the auto sign-in is
ignored outside `next dev` anyway).

### Background jobs (Inngest), before inviting anyone

Three jobs run on a schedule or on demand, and none of them run until Inngest is connected:

- every 5 minutes: retry failed notification emails (without it a failed email waits
  until someone's next message or introduction);
- every hour: write the AI summary and the search embedding for new profiles, so
  people added by an import or a claim show up in prompt search without running a script;
- on demand: `people/summaries.backfill` and `people/embeddings.backfill`.

To connect it (free plan):

1. Create an account at https://www.inngest.com.
2. Easiest: in Vercel, **Integrations → Browse Marketplace → Inngest → Add**, and pick
   this project. It adds `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` and syncs the app
   on every deploy. (By hand instead: copy both keys from Inngest → **Manage → Event Keys /
   Signing Key** into Vercel's Production environment variables.)
3. Redeploy, then in Inngest → **Apps** check `alumni-connect` is listed with its five
   functions. If it isn't, **Sync new app** with `https://<your-domain>/api/inngest`.
4. If Vercel **Deployment Protection** is on for production, allow `/api/inngest` (the
   integration offers a bypass), or Inngest's calls are blocked.

Failed and waiting emails show under **Administration → Pilot progress**.

3. Deploy. After that, every push to `main` deploys automatically. A deploy does **not** update the database: when a push adds a file under `supabase/migrations/`, apply it (`npm run deploy:db`, step 1) or pages that need it will fail.

## 5. Make yourself an administrator

Sign in once on the live site with your email, then in Supabase → SQL Editor:

```sql
update public.members set role = 'admin', verified_at = now(), verification_method = 'admin'
 where email = 'you@your-domain.edu';
```

## 6. Check it

- Sign in by email link; Discover, Search, Insights and a profile load.
- Administration → Profile review lists profiles.
- Plan a trip and open a shortlist (AI relevance lines appear).
- `https://<your-domain>/robots.txt` disallows everything, and responses carry
  `X-Robots-Tag: noindex` (the network is private).

## Later

- Private claim/remove links: `npm run links:generate` makes links for the site in
  `NEXT_PUBLIC_SITE_URL`; run it with the production URL set before sending invitations.
- Profile data scripts (`import:wsb-boards`, `enrich`, `class-years`, `linkedin`) run from
  your machine; point them at production by running them with the production
  `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY`.
