# Design

UI/UX is designed in **Open Design** (the desktop app installed on this Mac) and
checked in here, so code and design stay in sync. See docs/ARCHITECTURE.md §9b.

| Path | What | Who edits it |
|---|---|---|
| `system/` | Design-system package: `manifest.json`, `DESIGN.md`, `tokens.css` | Exported from Open Design |
| `prototypes/*.html` | Screen prototypes used as the visual reference | Exported from Open Design |

`system/tokens.css` is imported by `app/globals.css` and mapped onto Tailwind
colors and fonts. Components use only these tokens, so re-exporting the design
system restyles the app. Changes flow one way: edit in Open Design → re-export
here → code follows. Don't hand-edit tokens in code.

The current `system/` is a hand-written starter using Open Design's token names
(`--bg`, `--fg`, `--accent`, …) until the real system is designed.

## Screens to design

Landing · "Is this you?" claim-or-remove · sign-up/verification · search with
filters, map and results · profile · who to meet · trip planner · intro request ·
saved contacts and notes · admin (imports, review queue, analytics) · mobile
search and profile.

## Current export (2026-11-03)

- `system/`: Open Design's design-system package (tokens, manifest, DESIGN.md).
- `prototypes/`: all 35 prototype screens plus their assets and local fonts; open
  `prototypes/index.html` or `prototypes/screens/catalog.html` in a browser.
  `HANDOFF.md` is the designer's handoff note.
- The app imports `system/tokens.css`, the fonts and layout primitives from
  `prototypes/assets/`, and a generated copy of `prototypes/assets/app.css`
  (`app/design-components.generated.css`). After re-exporting, run
  `npm run design:sync`.
