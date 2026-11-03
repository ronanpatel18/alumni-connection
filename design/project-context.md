# Alumni Connect: project context for design

Paste everything below the line into Open Design. It describes the product, the
people using it and the constraints. The design decisions are Open Design's to make.

---

## Product

**Alumni Connect** is a private professional network and business-intelligence
tool for **University of Wisconsin–Madison alumni** across the United States. It
helps alumni build professional relationships, find business opportunities and
expand into new markets, using the trust that comes from a shared alma mater.

It sits between three familiar things without being any of them:
- **An alumni directory:** who's out there, where and in what field.
- **A professional network like LinkedIn:** discovery, but limited to verified alumni.
- **A light CRM like Salesforce:** saved contacts, notes, follow-ups, introductions.

The central idea is that the network is a set of **trusted relationships**, not a
list of contacts. Classmates, former coworkers, shared programs and introductions
make a warm connection more likely than a cold one.

## Who uses it

- **Alumni members (primary).** Working professionals, roughly 25–70. Many are
  senior: directors, partners, founders, physicians, attorneys, brokers, bankers.
  - **Goals:** find the right people in a market, get introductions, set up meetings
    when traveling, find mentors, clients, partners, investors or hires.
  - **Devices:** a laptop at work, a phone while traveling.
  - **Expectations:** they're busy and value discretion, speed and relevance.
- **Recent graduates.** Looking for mentors, career advice and job referrals.
- **Chapter leaders and admins (secondary).** Plan events, see where alumni are
  concentrated, import rosters, review profile data and handle verification and
  removal requests. They work with dense data.

## The questions the product answers

1. **Who should I know?** For example: "There are 200 alumni in finance in New York. Who
   should I connect with?" The answer is ranked against the user's own goal, not one
   global ranking, and every suggestion says why that person is relevant.
2. **Who can I meet?** For example: "I'll be in Dallas next week. Find alumni in banking,
   investments and real estate worth meeting." The answer is a shortlist with suggested
   outreach messages and scheduling.
3. **Who do I already know?** Classmates, former coworkers, mutual connections and
   paths to a warm introduction.
4. **Where is the network strongest?** For example: "How many alumni work in technology in
   Austin?", "Which cities have the most alumni?", "Where should we hold the next event?"
5. **What relationships am I building?** Saved contacts, notes, meetings,
   introductions and follow-ups.

## Features

**Already built (working in the app today, unstyled):**
- Magic-link email sign-in.
- A "verification pending" state for signed-in users who aren't verified yet.
- **Search:**
  - Free text such as "commercial real estate in Chicago" or "tech mentors class of 2010", turned into filters automatically.
  - Filters: industry (17 sectors, 66 specialties), city plus radius, class year, "open to" (networking, mentoring, hiring, job seeking, investing, fundraising, referrals, meeting travelers, speaking), and confirmed profiles only.
  - Result counts broken down by industry and by metro.
- **Profile page:** experience, UW–Madison education, AI-written summary, contact details, a "save contact" button and private notes.
- **Saved contacts list.**

**Planned next (needs design):**
- Public "Is this you?" page to claim a profile or remove it from the network.
- Editing your own profile and privacy settings, including who sees each contact detail.
- "Who to meet" recommendations with a reason for each person.
- Trip planner: city, dates, industries and a goal, then a shortlist, AI-drafted outreach and calendar invites.
- Warm introductions with double opt-in: the requester asks a mutual connection, the connector agrees, then the target agrees.
- Relationship management: lists, interaction log, follow-up reminders.
- Network insights: alumni counts by industry and market.
- **Later:** mentorship matching, an alumni business directory, events by city, jobs and referrals.
- **Admin:** roster CSV import, a review queue for low-confidence AI-built profiles, verification requests, removal requests, audit log.

## Content and data the design must handle

- **People:** name, current title and employer, industry and specialty, city and metro,
  UW–Madison degrees (school, degree, major, class year), past positions, specialties,
  "open to" tags, an AI-written summary (2–3 short bullets), private notes.
- **Profile status matters everywhere it appears:**
  - **Confirmed:** the person has claimed and verified their own profile.
  - **Unconfirmed:** built from public and licensed data before the person joined.
    This is normal and expected; most profiles start this way. It must not read as an
    error or as less trustworthy in a negative way.
- **Contact details** (email, phone, website, LinkedIn): each one carries its own
  visibility: visible to all verified members, visible only to people they're
  connected with, or hidden. Some are marked as verified. Users need to understand,
  briefly, why they can or can't see a detail.
- **Counts** must always separate confirmed records from estimates or unconfirmed
  data. Never present an estimate as a verified number.
- **AI-generated content** (summaries, "why this person", draft messages) should be
  recognizable as AI-generated and, where it's a draft, editable before sending.
- **Volume:** around 440,000 UW–Madison graduates; a single search can return a few or
  thousands of people. Lists need to handle long names, missing data, and people with
  no photo.

## Brand and tone

- **A UW–Madison product.** Alumni Connect is associated with the University of
  Wisconsin–Madison. UW–Madison branding is available to use: the motion W, Bucky
  Badger, UW red, "Badgers" language, Madison and campus imagery. Follow UW–Madison's
  brand guidelines for logo use.
- **Name:** Alumni Connect. Current tagline: "Your alumni network, nationwide."
- **Feel:** trustworthy, discreet, professional, warm. It handles people's contact
  details, so it should feel safe and respectful, not like a lead-generation tool.
- **Copy:** plain and specific; short privacy explanations wherever contact details
  appear.

## Privacy and trust (shapes the UX)

- Only verified alumni can see profiles. Nothing is public or indexed by search engines.
- Anyone can remove their profile in one step from a public page, and won't be re-added.
- Members control who sees each contact detail, and can see where each piece of their
  data came from (themselves, the alumni roster, licensed data, or the web).
- Introductions are always double opt-in. Outreach goes through an email relay, so the
  sender's address stays hidden until the recipient replies.

## Technical constraints for the handoff

- **App:** Next.js 16 + React 19 + Tailwind CSS 4. Built screens will follow the
  design system and the exported prototypes.
- **Design-system export:** a package of `manifest.json`, `DESIGN.md` and `tokens.css`.
  The app imports `tokens.css` directly and maps it onto Tailwind. The code already
  reads these CSS variable names, so please keep them (values are yours to choose):
  `--bg, --surface, --surface-warm, --fg, --fg-2, --muted, --meta, --border,
  --border-soft, --accent, --accent-on, --accent-hover, --accent-active, --success,
  --warn, --danger, --font-display, --font-body, --font-mono, --text-xs … --text-2xl,
  --leading-body, --leading-tight, --space-1 … --space-12, --radius-sm, --radius-md,
  --radius-lg, --radius-pill, --elev-ring, --elev-raised, --focus-ring,
  --motion-fast, --ease-standard, --container-max`.
  Adding new tokens is fine.
- **Fonts:** the app currently loads Geist (sans and mono) through Next.js. Another
  font is fine if it's a Google Font or self-hostable.
- **Themes:** light and dark.
- **Accessibility:** WCAG 2.2 AA. Keyboard navigation, visible focus, status never
  shown by color alone.
- **Widths:** must work from 375px phones to wide desktops.
- **Prototypes:** HTML files per screen, using fictional data only. Email addresses on
  example.com and phone numbers in the 555-01xx range.

## What to send back

1. The design system package (`manifest.json`, `DESIGN.md`, `tokens.css`, plus any
   component previews).
2. Screen prototypes for the built and planned features above, at desktop and mobile
   widths, with empty, loading and error states where they matter.
3. Any recommendations on information architecture, navigation or flows that would
   serve these users better than the feature list implies.
