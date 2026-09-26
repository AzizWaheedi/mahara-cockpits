# Mahara cockpits — standing rules for every build

Aziz, 2026-09-19: **every build ships with a solid backend and a beautiful,
brand-aligned design.** Neither is optional and neither is "later".

## Solid backend

- Data is Supabase-first (Creative Triage `bldgtotkfmhoxmlzowdx` for cockpit
  tables, prefix `cockpit_`; B2B `flwboeijllbtrufxkhts` is read-only source of
  truth). New tables come with row security **and the matching grant** in the
  same migration; the service key is the only door unless a browser needs one.
- Every action is gated on the server (role or CEO), every write leaves an
  audit row, and every external call goes through the helpers in `tools.ts`
  so it lands in the health ledger.
- Workers follow the radar's discipline (`hermes/ideation-radar`): keys read
  by name, `doctor`, tests, cron under `flock`, a runbook row, and a plain
  sentence in the UI when something is missing. Missing is never zero.
- Numbers are verified against a second source before they ship, and the
  note beside them says where they came from and what they leave out.
- Ship with `scripts/ship.sh <app>`, verify on production, record the session
  in mahara-context `shared/sessions/`.

## Beautiful, brand-aligned design

- Before any new screen or a reshaped one, load and follow
  `mahara-context/skills/frontend-design/SKILL.md`: a design plan first
  (tokens, type, layout, one signature element), then the code.
- `docs/DESIGN.md` is how the cockpits look (shell, cards, controls, touch,
  one arrow per action); every screen follows it.
- Inside the cockpits, the brand is the cockpit's own system: Geist,
  `--mahara-teal` as primary, the CEO kit (`SectionCard`, `StatTile`,
  `StatusChip`, `EmptyState`, `format.ts`). Extend it; do not invent a second
  palette per feature.
- Public-facing artwork for Aziz and Mahara (thumbnails, covers, banners)
  uses the personal-brand palette from
  `mahara-context/skills/aziz-kuwaiti-voice/references/master-context.md`:
  Midnight `#122C4F`, Ocean `#5B88B2`, Pearl `#FBF9E4`, Noir `#000000` for
  thumbnail headlines, Fade `#9CB1C7`. Arabic in IBM Plex Sans Arabic,
  English in Inter. Never the `#0A0A0A` + `#F5A623` combination, and never
  AI-regenerate Aziz's face: composite his real frame.
- Any Arabic line is written under `mahara-context/skills/aziz-kuwaiti-voice`.
- Copy in the interface is plain and active ("Publish" → "Published"); empty
  states and errors say what to do next.
