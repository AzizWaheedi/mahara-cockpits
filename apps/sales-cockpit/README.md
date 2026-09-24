# Sales cockpit

For Mahara's own setters and closers, at https://cockpit.maharamedia.com/sales/
(own domain https://mahara-sales.vercel.app). Built 2026-09-24; the plan and
Aziz's decisions are in `SALES_COCKPIT_PLAN.md` at the repo root.

## How it is put together

- **No Convex.** The browser reads Creative Triage (`bldgtotkfmhoxmlzowdx`)
  with the anon key. Every `cockpit_sales_*` table has row security with one
  policy, `cockpit_sales_seat()`: the CEO, a live seat on
  `cockpit_sales_people`, or the sales role in the shared member directory.
  A rep reads only their own pay rule and scorecard; `cockpit_sales_board` is
  the team's rates without counts.
- **Sign-in** through the portal: `/go/sales` mints a two-minute pass,
  `src/lib/portal.ts` posts it to `/portal/sales-session`
  (`apps/media-buyer-cockpit/convex/salesPortal.ts`), and the browser
  finishes the Supabase sign-in with `verifyOtp`. Seats are given on the
  portal's Admin page, with Setter, Closer, Both or Manager.
- **Nothing is written from the browser.** Every change goes through the
  Edge Function `sales-api` (`supabase/functions/sales-api`), which asks the
  database who is calling, checks the seat, writes an audit row and is the
  only thing that talks to HighLevel.
- **The data is B2B's, copied.** The Edge Function `sales-mirror` reads B2B
  every three minutes (read only) into `cockpit_sales_leads`,
  `_appointments`, `_dials`, `_deals`, `_reps` and `_scorecards`. No rate is
  recomputed here: the scorecard is B2B's own `b2b_rep_scorecard`.
- **AI work** (proposals now; call reviews, briefs and drafts next) is queued
  in `cockpit_sales_requests` and run by `hermes/sales-desk` on the VPS.

## Design

The subject is a rep's working day: calls at set times, leads waiting, marks
owed, money closed. The screens are built inside the cockpit family's own
system and add nothing to its palette.

- **Colour.** The cockpit tokens: Mahara Teal `#00cfc8` as primary, Deep
  Space `#091333` as the dark canvas with cards one step lighter
  (`#0f1b45`), Royal Blue `#2e5bd6` for links, and the success, warning and
  destructive colours. Three of those get names for what they mean on a
  rep's day (`--owed`, `--won`, `--now` in `src/index.css`); no new hue.
- **Type.** Geist for the interface, Geist Mono for times, counts and money.
  Geist has no Arabic and half of what a lead writes is Arabic, so IBM Plex
  Sans Arabic (the brand's Arabic face) sits behind it in the stack, and any
  field that may be Arabic is `dir="auto"`.
- **Layout.** The cockpit rail on a desktop; below `md` a tab bar with the
  four places a rep goes all day (Today, Calendar, Leads, Numbers) and More
  for the rest. The lead page is three columns on a wide screen (what they
  said, everything so far, notes and proposal) and one on a phone.
- **The one signature element: the day line** (`src/components/DayLine.tsx`).
  Today opens with the rep's day in Kuwait time as a single band: every call
  a block the length of the call, the current minute a teal hairline, the
  past shaded, and the calls still owed a mark hatched in the warning colour.
  It answers the two questions a rep has all day, where am I and what have I
  left undone, before anything is read. Everything around it stays quiet: the
  CEO kit's cards, tiles and chips (`src/components/kit.tsx`).
- **Motion.** One: the undo strip on a mark drains across the row for the
  five seconds before the mark is sent, because a no-show mark sends the lead
  HighLevel's no-show message.
- **Copy.** Plain and active: "Mark", "Marked no-show. HighLevel is
  updated.", "Draft proposal". Errors say what happened and what to do; an
  empty list says what fills it; a number that is not known is n/a, never 0.

## Run it

```bash
cp .env.example .env.local   # the anon key is public by design
bun install
bun run dev                  # http://localhost:5190/sales/
```

Checks: `bun run typecheck`, `bunx biome check src`, `bun test src`.
Ship: `scripts/ship.sh sales` from a commit that is on GitHub main.
