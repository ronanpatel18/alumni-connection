# Alumni Connect design system

Version 1.0.0 · Light and dark · Responsive web · WCAG 2.2 AA target

## Product character

A private professional network should feel like a thoughtful introduction: credible, warm, specific, and discreet. This system pairs a restrained editorial voice with the precision of a working tool. It avoids sales-pipeline language, status competition, and ornamental dashboards.

The chosen direction is a design assumption based on the brief, not an existing university brand standard. The deep red is an Alumni Connect accent; it is not represented as an official UW–Madison brand color. The typographic product signature is newly proposed. No university seal, crest, or licensed athletic mark is implied.

## Design read

- New responsive web system for working alumni, recent graduates, and operational administrators.
- Visual variation: 3/10. Stable navigation, familiar forms, editorial headings.
- Motion: 2/10. State feedback only, with no animation needed to understand outcomes.
- Density: 6/10 for member discovery, 8/10 for administration. Compact metadata supports 16px body text rather than replacing it.
- Asset dependence: 1/10. Fictional people use initials; the product depends on clear information, not photography.
- Existing brand fidelity: 3/10. Preserve the name, tagline, Wisconsin context, token API, and professional voice; establish the remaining visual language.

## Package

- `manifest.json`: package identity, theme selectors, font assets, component and screen references.
- `tokens.css`: required application variables and independent dark-theme values.
- `DESIGN.md`: this specification.
- `../screens/components.html`: interactive component previews.
- `../screens/catalog.html`: screen and state directory.

Import `tokens.css` before component styles. The prototypes additionally use `../assets/app.css`, including locally hosted fonts and structural primitives. Keep the exported variable names intact when mapping application utilities onto Tailwind CSS 4. This package is CSS and documentation, not a published JavaScript dependency.

## Color

| Role | Light | Dark |
|---|---|---|
| Page | `#f5f6f7` | `#15191d` |
| Surface | `#ffffff` | `#1e2429` |
| Subtle surface | `#f0f1f3` | `#272e34` |
| Primary text | `#20262b` | `#f2f3f4` |
| Secondary text | `#49535b` | `#c4cdd3` |
| Muted text | `#5d6871` | `#b1bbc3` |
| Accent | `#a22637` | `#f38c9b` |
| Text on accent | `#ffffff` | `#301019` |
| Border | `#cbd1d6` | `#56616a` |
| Success | `#246446` | `#9ed5b2` |
| Caution | `#805512` | `#e9c888` |
| Danger | `#ad2636` | `#ff9aa5` |

Dark mode changes foreground and background together; primary button text never inherits body color. Status always includes explicit text and, when helpful, an outline icon. Unconfirmed records use a neutral treatment, never caution or danger. Reserve danger for destructive actions and errors.

`--surface-warm` is retained for API compatibility; its value is a neutral surface, not a beige ground. `--muted` is supporting text, not disabled text. Avoid reducing opacity on text to invent extra shades.

Theme behavior: system preference on first visit; `data-theme="light"` or `data-theme="dark"` overrides it on the document root. The header theme action stores the choice when browser storage is available.

## Typography

- Display: Source Serif 4, weights 400–700. Headings and member names add a human, editorial quality.
- Body: Geist, weights 400–700. Interface language, forms, tables, and reading text.
- Mono: Geist Mono, weights 400–500. Brief labels, class/date metadata, and analytical counts.
- All font assets are local under `../assets/fonts/`. Font source records and SIL Open Font License files are included there.
- Body starts at 16px, with 1.6 line height. Long reading copy targets about 65–75 characters on desktop and naturally shorter columns on mobile.
- Scale: 12, 14, 16, 18, 24, 32px; display headings fluidly range from 32 to 48px. Authentication storytelling can reach 64px on wide screens.
- 12–14px text is limited to metadata, controls, and short supporting labels; avoid long paragraphs at that size.
- System zoom remains enabled. Names and detail text wrap. Data may truncate only where a detail destination exposes the full value.

## Geometry

- Base rhythm: 4px; predominant increments: 8, 16, 24, 32, 40, 48px.
- `--space-1` through `--space-12` map to 4px through 48px.
- Radii: 4px controls, 8px panels, 12px dialogs, full pills for compact status labels.
- Quiet 1px borders separate surfaces. Shadow is reserved for a search entry, dialog/toast, or elevated control.
- Desktop navigation: 244px persistent sidebar; compact desktop: 216px.
- The main region has a 1440px maximum width. Typical content padding: 40–48px desktop, 24px intermediate, 20px mobile.
- At wide sizes, an optional 296–320px rail carries contextual guidance or a shortlist. It stacks into normal flow at smaller widths.

## Responsive behavior

The same HTML screen adapts rather than shipping a second disconnected mobile mockup.

- 375px: single-column content; search action below its input; filters wrap; forms stack; person actions remain reachable.
- 768px: sidebar appears; main content remains stacked when comparison space is limited.
- 1024px: main-plus-context columns can appear; desktop tool hierarchy returns.
- 1440px and wider: the shared maximum width and wider gutters preserve readable line lengths.
- Mobile navigation uses a labeled menu control in the sticky header. Its navigation panel overlays the workspace below the header, with Escape and explicit toggle dismissal.
- Dense admin rows become labeled blocks on narrow screens; the reader does not need to pan a desktop table.
- This is a responsive web app, so no simulated phone hardware is added.

## Component contracts

### Actions

One dominant action per task area. Primary = accent fill and explicit contrasting text; secondary = bordered surface; tertiary = text action. Keep action labels specific: “Save note”, “Request introduction”, “Remove my profile now”. Minimum control height is 44px, with at least 8px between adjacent action targets.

### Member rows

Initial avatar, full name/detail link, explicit profile status, current title/employer, market, Wisconsin education, and a concise relationship cue. Saving never implies a connection or sends a notification. Missing fields say what is missing; they do not fabricate work history.

### Profile status

- **Confirmed:** this person claimed and verified their profile. Not an endorsement of their professional claims.
- **Unconfirmed:** normal pre-claim state, built from roster/public/licensed sources. Describe neutrally and expose provenance.
- **Verification pending:** account-level access state. It is distinct from an unclaimed profile record.
- Admin content review cannot change identity status to confirmed.

### Contact details

Each detail has its own visibility and verification state. Explain restricted access beside the detail rather than leaving a mysterious lock. Modes: verified members, accepted connections, hidden. A verified email label does not imply the phone or website is verified. Changing an email removes its verified label until verification occurs again.

First-contact relay messaging keeps the sender address private until the recipient replies. Contact visibility is a separate member setting; do not conflate the recipient’s visible address with the sender’s relay privacy.

### AI

- Summaries: “AI-generated summary”, with source-based bullets and a short reliability caveat.
- Relevance: “AI-generated relevance”, tied to the selected goal and evidence.
- Messages: “AI-drafted · Editable”. Subject and body stay editable before the explicit send review.
- No hidden score, global professional ranking, or numerical match percentage.

### Forms and feedback

Persistently visible labels, specific helper text, adjacent error text, keyboard access, and explicit success feedback. Invalid forms stay editable. Show email errors on blur or submission; untouched fields do not show errors. Enter invokes the same local action as the primary button where appropriate.

### Dialogs

Native dialogs, visible close control, Escape dismissal, and focus return. Dialogs carry secondary tasks such as note review or consent confirmation; primary navigation remains on screens. When a mutation rebuilds a row, focus returns to a replacement action or the main region.

### Counts and charts

Compute displayed counts from the currently filtered records. Separate confirmed from unconfirmed. A missing population estimate is an em dash and “unavailable”, never zero and never the total of unconfirmed records. The sample bar charts use a solid confirmed segment and a patterned unconfirmed segment, with explicit text counts.

### Loading, empty, error

Reserve row space during loading with text-labeled skeletons. Empty states explain the cause and next action. Errors preserve entered data where possible and offer a retry. In the screen directory, state links open loading/empty/error scenarios using a query string; scenario controls are not included in product chrome.

## Accessibility and motion

Target WCAG 2.2 AA: readable text contrast, 3:1 essential graphic contrast, visible focus, accessible names, labels, semantic navigation and tables, non-color status cues, and keyboard-reachable tasks. Use `--focus-ring` rather than suppressing browser focus with no replacement. The file set was authored to this target; it has not undergone an executable accessibility audit.

Motion: 180ms state transitions, standard ease-out; 120ms exit token available. Reduced motion disables animation and transitions. No parallax, auto-playing media, or decorative motion.

## Voice

Use brief, respectful language. Say “connections”, “conversations”, “shared experience”, and “follow-up”. Avoid “leads”, “prospects”, “conversion”, or “top alumni”. Ask for relevance, not status. Never imply that an unclaimed record is suspicious.

## Extension rules

Preserve token names, semantic status meanings, source disclosures, focus behavior, and member-controlled contact visibility. Reuse the same outline icon family, stroke width, avatar treatments, and action hierarchy. Prefer normal-flow grid/flex layout and content-driven height. Future features belong within the same relationship-oriented navigation model.
