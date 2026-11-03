# Alumni Connect prototype handoff

## Open the work

Start with **[index.html](index.html)** for the member discovery experience. Open **[screens/catalog.html](screens/catalog.html)** for all screen files, role-specific consent steps, and loading/empty/error scenarios. **[screens/components.html](screens/components.html)** is the design-system preview.

The prototypes are plain HTML, CSS, and JavaScript. They need no build step or CDN runtime. Fonts are local. Open the files in a JavaScript-enabled browser or serve the project using your normal static preview. Every screen also has its own HTML entry and uses the same responsive system at phone and desktop widths.

## Design-system export

The package is in `design-system/`:

- `manifest.json`
- `DESIGN.md`
- `tokens.css`

The app can import `tokens.css` directly. Every CSS variable requested in the brief is retained. The package adds semantic surfaces, accent feedback, display scale, target size, and sidebar sizing tokens. Component previews use the same actual exported stylesheet as the screen prototypes.

## Screen inventory

| Area | HTML files | States and interactions |
|---|---|---|
| Discover | `index.html`, `screens/search.html`, `screens/recommendations.html` | Natural-language search, 17 industry sectors and 66 specialty options, city/radius, class year, all nine “open to” choices, confirmed-only, sorting, pagination, market/industry breakdowns; goal-sensitive recommendations and reasons |
| Member profiles | `screens/profile.html`, `screens/saved.html` | Save/unsave, profile details, AI summary, private notes, source disclosure, restricted contact explanations, saved-contact search |
| Access | `screens/sign-in.html`, `screens/verification-pending.html` | Email validation, simulated magic link, pending-member request, no profile content in pending state |
| Public rights | `screens/claim.html`, `screens/remove.html` | Private-link record identification, identity-verification handoff, one-step removal without account creation, suppression |
| Own profile | `screens/edit-profile.html`, `screens/settings.html`, `screens/data-sources.html` | Education/work/openness edits; editable email, phone, website, LinkedIn; independent visibility; changed-email verification reset; provenance |
| Relationships | `screens/relationships.html`, `screens/lists.html`, `screens/followups.html` | Create lists, assign saved people, log private interactions, set reminders, complete/reopen |
| Introductions | `screens/introductions.html`, `screens/introduction-review.html`, `screens/introduction-response.html` | Requester asks, connector agrees/declines, recipient agrees/declines; completion only after both agree |
| Trips | `screens/trips.html`, `screens/trip-planner.html`, `screens/trip-shortlist.html` | City/date/industry/goal, date-order validation, relevant candidates, private shortlist, per-person outreach |
| Outreach and scheduling | `screens/outreach.html`, `screens/meeting.html` | Editable AI-labeled subject/body, draft saving, explicit review before simulated relay sending, duration/time zone/location, downloadable `.ics` invitation |
| Insights | `screens/insights.html` | Current filtered counts by city/industry; confirmed and unconfirmed separated; population estimates explicitly unavailable |
| Future concepts | `screens/mentorship.html`, `screens/businesses.html`, `screens/events.html`, `screens/jobs.html` | Mentorship topic/market filtering; business search; city events and local RSVP; job search and editable referral requests |
| Administration | `screens/admin-import.html`, `screens/admin-review.html`, `screens/admin-verification.html`, `screens/admin-removal.html`, `screens/admin-audit.html` | CSV staging, template/sample, correction feedback, duplicates/suppression, import, field review, identity verification decisions, removal exceptions, local audit history |
| Handoff | `screens/catalog.html`, `screens/components.html` | Screen/state directory and design-system components |

There are 35 HTML entries: 33 product and flow screens, a screen directory, and a component preview.

## State coverage

Loading, empty, and recoverable error scenarios are linked from the directory for discovery, search, recommendations, relationships, saved contacts, lists, follow-ups, trips, shortlist, insights, future-feature lists, and administrative queues/audit. Authentication, claim, verification, editing, scheduling, import, and message flows show validation and success states through their actions. Buttons provide hover, focus, active, and disabled treatments through shared styles.

The loading scenario is intentionally held for inspection; the error scenario has a functional retry. These are local scenarios, not delayed server calls. Product screens contain no viewport, status-simulation, or design-variant panels.

## Recommended information architecture

**Discover** answers “who should I know?” with search, explainable relevance, and profiles. Start with the user’s goal rather than an undifferentiated national directory. Recommendations are a starting point, never a public ranking.

**Relationships** combines saved contacts, private lists, notes, interaction history, introductions, and reminders. Saving someone and accepting a connection must remain distinct actions. Avoid treating people as sales-pipeline stages.

**Trips** makes a time-bounded task a first-class flow: destination → purpose → relevant people → individual outreach → agreed meeting. Keep the shortlist private. Don’t add bulk sending or infer availability from a person’s city.

**Insights** holds aggregated network views. Future mentorship, alumni businesses, events, and jobs are reachable as secondary exploration paths from this area, rather than adding four more primary tabs immediately. As usage grows, validate whether mentorship merits primary placement for recent graduates.

**Profile & privacy** is persistent utility navigation. Keep contact visibility near the fields it controls and make source correction reachable without finding an administrator.

**Administration** is a separate workspace. Roster content review and alumni identity verification are different queues and permissions. Public removal is immediate; only exceptions belong in a support queue.

## Consent sequence

1. On a profile or the introduction-request screen, enter context and ask the mutual connection.
2. Open `introduction-review.html` as the connector and agree or decline.
3. If the connector agrees, open `introduction-response.html` as the recipient and accept or decline.
4. Return to `introductions.html`: only two affirmative decisions unlock the conversation path.

The separate role screens avoid placing role-switching or artificial approval controls in member-facing UI. The directory supplies the walkthrough links.

## Technical handoff for the existing app

- Retain the existing Next.js 16 / React 19 / Tailwind CSS 4 application. This delivery is an exportable design reference, not a replacement app scaffold.
- Load `design-system/tokens.css` globally, then map its semantic variables to your existing Tailwind utilities. Keep the variable names as the stable contract.
- Use local font assets or the application’s equivalent Google Font loading. Preserve the exported font-family values if using these exact files.
- Recreate shared primitives as React components: app shell, member row, profile status, contact detail, AI disclosure, labeled field, inline feedback, source disclosure, consent step, empty state, table, skeleton, and dialog.
- Use one source of truth for contacts, saved IDs, lists, notes, introduction state, and counts. UI totals should derive from the same committed data as the visible list.
- Model profile identity status separately from account access and admin content review. A reviewed public-data field never confirms a person.
- Visibility and permission checks belong on the server, independently per contact field. Hidden fields must not be serialized into unauthorized page data.
- Unconfirmed profiles should expose source dates and field-level confidence in the review workflow; members see concise provenance without implementation noise.
- A production introduction needs distinct immutable consent events for requester, connector, and recipient, plus cancellation, expiry, and appropriate notifications. Do not expose another role’s decision controls to the requester.
- Email relay, magic links, verification, reminders, and invitations need real services and access checks. A downloadable calendar file is not a booked meeting.
- Apply removal to the profile, search indexes, caches, recommendations, and downstream exports; retain only the minimal suppression identifiers required to prevent re-import.
- Use stable identities and reviewable merge rules for CSV imports. Preserve source lineage. A simple email match, as demonstrated here, is insufficient for production deduplication.
- Serve member responses with appropriate authentication and caching controls. A `noindex` meta tag alone does not provide privacy.
- For very large results, use server-backed pagination or virtualization and facet counts. The prototype paginates its small sample at five people per page.

## Data and service boundaries

All people, employers, business listings, events, jobs, contacts, and counts are fictional examples. Geographic city names and UW–Madison context are real. Addresses use `example.com`; sample phone numbers use the 555-01xx range. Initials intentionally cover the no-photo case.

The prototype uses browser-local state with an in-memory fallback when storage is unavailable. It makes no backend calls. Member/admin identity, access permissions, magic links, verification evidence, public removal links, AI generation, email relay, delivery, replies, reminders, and calendar sending are simulated. Local storage is not a secure place for actual alumni information; use fictional data only here.

Radius choices express the intended filter UI. Without coordinates or a geospatial source, this sample uses metro-level matches rather than real distance calculations. Recommendations reorder seeded profiles against the selected goal and market; they are not a live AI or relationship-graph service. No population estimate is invented from the small dataset.

A CSV import accepts up to 100 fictional rows and the required schema described on screen. Removed sample identities remain suppressed in local state. This illustrates the flow and is not a legal or operational guarantee of deletion from a real service.

Font source metadata, local files, and OFL notices are under `assets/fonts/`. No third-party photos or university brand marks are used.

## Delivery scope

The responsive screens and design-system exports have been written. No browser testing, screenshots, automated accessibility audit, or live-service validation was performed. The accessibility target and intended interaction behavior are documented above; integration and production testing remain part of implementation in the real app.
