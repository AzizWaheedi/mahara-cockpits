# How the cockpits look

The design system every cockpit converges on, written down after the design
pass of 26 September 2026 (Aziz: "anything that has bad padding, anything
that's not brand aligned, anything that looks too busy ... two arrows in the
same place"). A new screen follows this; a reshaped one moves towards it.
The brand itself is Mahara Media Brand Guidelines v1.0.

## Brand

- Dark by default (a saved "Light" choice wins). Deep Space `#091333`
  canvas, cards one step lighter (`#0f1b45`), hairlines at 10% white.
- Mahara Teal `#00CFC8` is the accent: the primary action, the active state,
  focus, the one highlighted number. Never a large fill. Royal Blue only
  inside the 135deg gradient and in charts.
- Orange is the warning colour (`--warning`); never amber or gold. Green is
  `--success`, red is `--destructive`. Colour sits on an icon or a dot, not
  on the words.
- Geist for everything; Geist Mono only for small uppercase labels,
  timestamps and numbers-as-data in tables. IBM Plex Sans Arabic follows
  Geist in the font stack for Arabic. Sentence case, no emoji, no em dashes,
  no glyph icons (use lucide).
- Elevation on dark is a teal glow (`glow-teal`), kept for the one featured
  or live element. No grey drop shadows.

## Shell

- No top bar on a laptop. Below 1024px the rail is a sheet (full width on a
  phone, a 22rem drawer on a tablet) with a "Close menu" X, and the portal
  and sales cockpits show a tab bar; client success, creative and the editor
  show a slim bar with the menu button. So an iPad held upright gets the
  full width.
- Each cockpit has one icon (`src/lib/cockpits.ts`, the same file in all five
  apps), used in every switcher, menu and front door. Team meetings and the
  other cockpits sit at the foot of the rail.
- The active rail row is the teal lamp (`.cockpit-nav-link`,
  `.cockpit-nav-lamp`).
- Floating things never cover content on a phone: Ask Hermes is a round
  button below `sm`; "Report a problem" lives in page headers.

## Pages

- Root: `mx-auto w-full max-w-6xl` (wide data pages `max-w-[1440px]`), no
  padding of its own; the layout's `<main>` pads 16 / 24 / 32px.
- Header: h1 `text-2xl font-semibold tracking-tight`, one muted line under
  it, actions on the right. One status line per page: the CEO header's pill
  says when numbers were computed; a card speaks up only when its own
  numbers are stale.
- Sections `space-y-6`; grids `gap-4 lg:gap-6`; the 8px grid.

## Cards and numbers

- Card: `rounded-2xl border bg-card p-4 sm:p-6`, title `text-[15px]
  font-semibold`, an optional mono kicker of three words at most (a sentence
  goes in a description or folds), body 16px below. A divider only over a
  flush list or table.
- Never a bordered card inside a bordered card: divided rows, or a quiet
  panel `rounded-xl bg-muted/40 p-4`.
- Tiles inside a card: `grid-cols-2`, widening by the card's width
  (`@container` body, `@md:` / `@2xl:`), never by the screen's. Values in
  Geist with tabular figures, `whitespace-nowrap`.
- Long tables scroll inside their card and show the first 50 rows with
  "Show 50 more".

## Controls

- Status chip: rounded-full, 12px, the colour on a leading icon or dot.
- Filters, tabs and segmented controls: 32px pills; the active one is teal
  (`bg-primary/15 ring-1 ring-inset ring-primary/40`), never a white fill.
  A row that can overflow scrolls sideways on a phone; zero-count chips hide.
- Buttons: ui/button (teal default, outline, ghost, white, teal outline); one
  teal primary per view.
- Touch: 40px targets inside `<main>` come from the coarse-pointer rule in
  each index.css. Small inline triggers (info icons, chips with a hint, sort
  headers) take `no-touch` plus an invisible hit area. Hints open on a tap
  on touch screens (CEO `Hint`).
- Disclosures: `<summary>` gets one CSS chevron in every browser (the
  "Disclosures" block in index.css); a summary that draws its own chevron
  uses `no-marker`.

## Arrows and repetition

- One arrow per action: an external link has one trailing ArrowUpRight, an
  in-app link one trailing ChevronRight. Never both, never a text arrow
  beside an icon, never two links to the same place in one card header.
- Say a thing once per screen: counts, timestamps, notes and headings the
  header or a neighbour already shows go; two buttons with one handler
  become one.
- Explanations longer than two lines fold; a warning that changes how a
  number reads stays visible (folded under "2 warnings" is fine).

## Checking a screen

Render it at 390, 820 and 1440 wide before shipping, in dark: no sideways
scroll, nothing overlapping, nothing under the tab bar or the safe areas.
The harnesses: `bun run harness` in the media buyer (CEO tabs and portal
pages, `?tab=` / `?path=`), the sales harness at `/sales/harness.html`, the
creative Social harness (`bun run harness` there).
