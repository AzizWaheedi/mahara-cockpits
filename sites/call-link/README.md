# call.maharamedia.com

The short link a lead taps: `call.maharamedia.com/{code}`. It says whose call
it is, in Arabic and English, then opens the Zoom or Meet room. No build: the
files here are the site (the `sites/webinar` pattern). Not deployed yet; the
CNAME `call` waits for the CEO (F build day 5).

| File | Served at | What it is |
| --- | --- | --- |
| `index.html` | `/{code}` (any case), `/` | The page. Its script asks `sales-live/open/{code}`, fills the ring, then opens the room |
| `ended.html` | `/ended`, `/ended?wa={digits}` | Where `/go` sends a link whose room is over; `wa` adds the WhatsApp button |
| `core.js` | | The page's rules and every line it shows (tested) |
| `call.js` | | What the page does |
| `call.css`, `noscript.css` | | Brand styles; the no-script tweak |
| `logo.png`, `mark.png`, `favicon.png`, `apple-touch-icon.png`, `og.png` | | The teal and white lockup for dark, the M mark, the link preview image |
| `vercel.json` | | `/{code}?go=1` redirects to `sales-live/go/{code}` (the no-script link), `/ended` and `/{code}` rewrites, CSP and no-index headers |

## What the lead sees

| State | When | Lines (English; Arabic beside it) |
| --- | --- | --- |
| Opening | the room has its link | "Opening your call with {first name}..." and the app hint; the ring fills, then the room opens |
| Not in yet | back from the app, or still here 2.6 s later | "Not in the call yet? Tap the button below." [Join the call] |
| Preparing | the room is still being made | "Your call is almost ready. This page opens it by itself." Asks again every 2 s, for 90 s |
| Ended | the room is over | "This call has ended. Reply to our last message and we will find a new time." [Message us on WhatsApp] when `rooms.fallback.ended_page_whatsapp` is set |
| Not valid | unknown or mistyped code | "This link is not valid. Reply to our message and we will send a new one." |
| Busy | 30 opens a minute from one network | "Too many tries from this network..." [Try again] |
| Error | the door did not answer (6 s, one retry) | "We could not load your call..." [Join the call] (the no-script route) [Try again] |

The language that leads follows the phone (Arabic first when the phone's
first language is Arabic, and when nothing is known). The Zoom hint shows on
every device, the Meet hint only on an iPhone or iPad.

Without scripts the page shows a "Join the call" link to `/go`. If the script
fails to load, the same link appears after 6 s.

## What it records

Nothing in the page itself: no cookies, no analytics, no third-party script
(fonts come from Google Fonts). The door records one open per device: a random
id the page keeps in this browser (`localStorage` `mm-call-device`) and a
salted hash of the address. `sessionStorage` remembers that the room was
opened in this tab, so coming back from Zoom does not jump to Zoom again.

## Arabic still to approve

New lines for this page, written under aziz-kuwaiti-voice, marked DRAFT in
`core.js`: the "Not in yet", "Preparing", "Error" and "Busy" lines, "Try
again" (حاول مرة ثانية) and "Call code" (كود المكالمة). The opening line, both
hints, the ended lines, the not-valid line and both button labels come from
`final_arabic.md`.

## Deploy (not done)

1. Create the Vercel project (for example `mahara-call-link`) with this
   folder as its root, no build. Keep `.vercel/project.json` out of git.
2. From a commit on GitHub main: `scripts/vercel-deploy-composio.sh sites/call-link`.
3. The CEO adds the CNAME `call` with the value Vercel shows.
4. Check: `curl -sI https://call.maharamedia.com/K7Q2MX` has the CSP header,
   and `/K7Q2MX?go=1` answers 307 to `sales-live/go/K7Q2MX`.
5. Turn on `rooms.short_link` only after both pass.

## Test locally

`bun test sites/call-link` checks the rules and lines. To see the page, serve
the folder with the rewrites above and point the `mm-door` meta at a fake door.
