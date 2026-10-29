# Review and referral asks in the client portal

Aziz, 2026-10-29: the CSM presses a button on a client's page in the cockpit to
ask for a referral or a Google review. The client sees a clean pop-up the next
time they open the portal, and a phone alert if they have alerts on. The
referral pop-up leads to the referral programme document; the review pop-up
leads to Mahara's Google review form.

## How it works

1. **Cockpit.** Client page → Actions → "Ask for a review or referral". There are two
   tiles, Google review and Referral. Each tile shows what the client reads,
   an optional line from the CSM (280 characters at most), a "phone alert"
   tick (on by default), and "Send to their portal". Once sent, the tile shows
   the status, the phone alert result and every step the client's people took.
   "Withdraw" removes the ask. "See what they see" opens the portal's staff
   preview of that client's workspace.
2. **Database (Creative Triage).** Two tables, `cockpit_client_asks` and
   `cockpit_client_ask_events`, created in
   `supabase/migrations/20261029170000_client_asks.sql`.
   - The seat calls three `cockpit_csm_*` functions behind the client gate.
   - The portal's server key calls six `portal_client_ask*` functions.
   - Both tables carry the cockpit audit trigger.
3. **Portal** (mahara-client-portal):
   - `GET`/`POST /api/asks`, with the logic in `src/lib/client-asks.ts`.
   - The pop-up is `src/components/ClientAsk.tsx`.
   - The phone alert is `src/lib/ask-notifications.ts`, run first in the
     5-minute `/api/cron/client-tasks`.
   - Contract: `docs/CLIENT-ASKS.md` in that repository.

## Rules (kept in the database)

- One open ask of each kind per client. Withdraw it to send another.
- An ask closes by itself 30 days after it was sent.
- A client who said they posted a Google review is never asked for another.
- A person sees an ask at most twice, and at most one ask a day.
  - "Not now" waits seven days.
  - "No thanks" ends it for that person.
  - Tapping the phone alert opens the ask whatever the day's count.
  - A first visit to the portal never shows an ask; the workspace tour comes
    first.
- Cancelled and removed workspaces cannot be asked. A client card with no
  workspace, or with two, says what to fix.
- The phone alert goes once per device. It only reaches client devices with
  task alerts on, and is never sent a day late. The cockpit shows the counts,
  or why nothing went: "nobody there has task alerts on".

## Design plan

- **Subject:** a short note from the client's success manager inside Mahara
  OS, not an advert. Its one job is to make one favour a single tap, or easy
  to put off.
- **Tokens:** the portal's own (`--surface`, `--ink`, `--muted`, `--line`,
  `--teal`, `--teal-soft`, `--accent`), IBM Plex Sans Arabic, in light and
  dark. The cockpit tiles use the cockpit kit (`Chip`, `ExtLink`, Geist, teal).
- **Layout:**
  - On a computer, a 392 px card in the bottom corner. It does not dim or block
    the page.
  - On a phone, a bottom sheet with a grip and the safe area.
  - It waits until no other window is open and no field is in use.
- **Signature:** the sender's name and initial, with their own line set off by
  a teal rule. On the referral, the reward ladder: four rungs, each as tall as
  its reward ($500, $750, $750, then $1,000 each, from the programme
  document).
- **Copy:** plain, Arabic first, light Kuwaiti (aziz-kuwaiti-voice).
  - No stars and no "if you're happy" wording.
  - Nothing is offered for a review.

## Research that shaped it

These are the sources behind the rules above.

- **Google contribution policy:** no selective asking, no reward for any
  review, no review targets for staff. So:
  - the review button is the same for every client;
  - the panel says to ask everyone;
  - the referral reward never appears on the review ask.
- **NiceJob:** stop once the review is done. Apple: at most a few asks a year,
  never mid-task. Hence the two showings, the daily cap, the 30-day close and
  the calm-page wait.
- **Appcues and Chameleon:** one prompt per visit, and dismissals count. Hence
  "Not now" and "No thanks" as separate choices.
- **GrowSurf and ReferralCandy:** one main action, WhatsApp first on phones,
  rewards stated plainly. Hence the WhatsApp button with a pre-filled message,
  and the email-introduction route the programme document describes.
- **Web push guidance:** one alert per ask, tagged so it never stacks, and a
  tap deep-links straight to the ask (`/?clientId=…&ask=<id>`).

## Not in scope

- Checking that a review was really posted. "Said they posted it" is the
  client's word. Matching it against the Business Profile reviews needs the
  Business Profile API.
- Referral attribution to a lead. The referral arrives by WhatsApp or email
  and is logged in the referral form as today.
- A permanent "Refer a firm" or "Review us" place in the portal, and asking
  every client automatically at a fixed day.
- Slack notices to the CSM when a client acts. The tile shows it.

## How we know it works

- `apps/media-buyer-cockpit/scripts/client-asks-supabase.test.ts` covers the
  database rules on PGlite, with the migration applied twice: 9 tests.
- Portal `tests/client-asks.test.ts` covers the route, its scope, the link
  allowlist and the phone alert journal: 7 tests. The full portal suite is
  1,846 tests.
- The pop-up was checked on the dev-only `/preview/client-ask` page in Arabic
  and English, light and dark, at phone and desktop widths. The cockpit tile
  was checked on `asks-harness.html`.
- On production, a rolled-back run of the functions against a real client, and
  the staff preview of that client's workspace.
