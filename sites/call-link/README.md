# call.maharamedia.com

The short link a lead taps: `call.maharamedia.com/{code}`. It says whose call
it is, in Arabic and English, then opens the Zoom or Meet room. No build: the
files here are the site (the `sites/webinar` pattern). Not deployed yet; the
CNAME `call` waits for the CEO (F build day 5).

| File | Served at | What it is |
| --- | --- | --- |
| `index.html` | `/{code}` (any case), `/` | The page. Its script asks `sales-live/open/{code}`, fills the ring, then opens the room |
| `ended.html` | `/ended?c={code}` | Where `/go` sends a link whose room is over. Its script asks `sales-live/open/{code}`, and the WhatsApp button shows only the number the door gives (`rooms.fallback.ended_page_whatsapp`); nothing but the code is read from the address, so nobody can send leads a Mahara page with their own number on it |
| `core.js` | | The page's rules and every line it shows (tested) |
| `call.js` | | What the page does |
| `call.css`, `noscript.css` | | Brand styles; the no-script tweak |
| `logo.png`, `mark.png`, `favicon.png`, `apple-touch-icon.png`, `og.png` | | The teal and white lockup for dark, the M mark, the link preview image |
| `vercel.json` | | `/{code}?go=1` redirects to `sales-live/go/{code}` (the no-script link), `/ended` and `/{code}` rewrites, CSP and no-index headers |

## What the lead sees

| State | When | Lines (English; Arabic beside it) |
| --- | --- | --- |
| Opening | the room has its link | "Opening your call with {first name}..." ("...with the sales team..." when the host has no name on file) and the app hint; the ring fills, then the room opens |
| Not in yet | back from the app, or still here 2.6 s later | "Not in the call yet? Tap the button below." [Join the call] |
| Preparing | the room is still being made | "Your call is almost ready. This page opens it by itself." Asks again every 2 s, for 90 s |
| Ended | the room is in a final state (only the sweep decides) | "This call has ended. Reply to our last message and we will find a new time." [Message us on WhatsApp] when `rooms.fallback.ended_page_whatsapp` is set |
| Not valid | unknown or mistyped code | "This link is not valid. Reply to our message and we will send a new one." A full stop, an Arabic comma or a right-to-left mark glued to the link does not make it invalid |
| Busy | 30 opens a minute from one browser on one network, or 120 from one network | "Too many tries from this network..." [Try again] |
| Not working | the door refuses the room's join link (`broken`) | "This link is not working. Reply to our message and we will send a new one." No Join button: it would lead to the same dead link |
| Still loading | the door is slow (6 s and still waiting) | The opening line, with [Join the call] (the no-script route) while it waits |
| Error | the door did not answer (6 s, then one retry of 15 s), its answer could not be read, or the page was still loading after 25 s | "We could not load your call. Tap Join the call, or reply to our message and we will call you." [Join the call] (the no-script route) [Try again] |

Back on the page (from the call app, or a phone that slept), the page asks
the door once more: a room that ended says so instead of offering a dead
Join button, and a room that was being made while the phone slept opens.

The language that leads follows the phone (Arabic first when the phone's
first language is Arabic, and when nothing is known). The Zoom hint shows on
every device, the Meet hint only on an iPhone or iPad.

When the buttons are redrawn (Try again), keyboard and screen-reader focus
stays in the page: on the line while it loads, then on the first new button.

Without scripts the page shows a "Join the call" link to `/go`. If the script
fails to load, the same link appears after 6 s; if it throws while loading
(an error or a rejected promise), the error line shows with the same link.
The `/go` route's own failure texts are in English and Arabic.

To walk every door answer on this machine (nothing leaves it):
`bun sites/call-link/dev-door.ts`, then open
`http://127.0.0.1:5419/K7Q2MX?door=slow` (or `open`, `preparing`, `ended`,
`unknown`, `busy`, `broken`, `garbage`, `stall`, `hang`, `down`, `error`).

## What it records

Nothing in the page itself: no cookies, no analytics, no third-party script
(fonts come from Google Fonts). The door records one open per device: a random
id the page keeps in this browser (`localStorage` `mm-call-device`) and a
salted hash of the address. `sessionStorage` remembers that the room was
opened in this tab, so coming back from Zoom does not jump to Zoom again.

## Arabic still to approve

New lines for this page, written under aziz-kuwaiti-voice, marked DRAFT in
`core.js`: the "Not in yet", "Preparing", "Error" (its "reply to our message
and we will call you" half added 4 October) and "Busy" lines, "Try
again" (حاول مرة ثانية) and "Call code" (كود المكالمة). The opening line, both
hints, the ended lines, the not-valid line and both button labels come from
`final_arabic.md`; the host-name fallback is فريق المبيعات, "the sales team"
in English too.

Two more DRAFT lines are the no-script route's plain answers, in
`supabase/functions/sales-live/door.ts` `GO_COPY`: for a link preview,
افتح هاللينك من تلفونك عشان تدخل المكالمة. ("Open this link on your phone to
join the call."), and the "Preparing" pair, which a test keeps equal to the
page's own. Since 4 October `/go`'s failures are said in both languages too,
three of them DRAFT: "cannot be opened right now" (ما نقدر نفتح لينك المكالمة
الحين. رد على رسالتنا ونرسله لك مرة ثانية.), "too many tries" and "could not be
read just now"; the broken-link line reuses the not-valid Arabic.

## Deploy (not done)

1. Create the Vercel project (for example `mahara-call-link`) with this
   folder as its root, no build. Keep `.vercel/project.json` out of git.
2. From a commit on GitHub main: `scripts/vercel-deploy-composio.sh sites/call-link`.
3. The CEO adds the CNAME `call` with the value Vercel shows.
4. Check: `curl -sI https://call.maharamedia.com/K7Q2MX` has the CSP header,
   and `/K7Q2MX?go=1` answers 307 to `sales-live/go/K7Q2MX`.
   A preview deployment cannot read `/open` (the door allows only
   `call.maharamedia.com`, one exact `CALL_SITE_URL`, and localhost); preview
   the look against a local fake door instead.
5. Turn on `rooms.short_link` only after both pass.

## Test locally

`bun test sites/call-link` checks the rules and lines (`core.test.js`) and
runs `call.js` against a small fake DOM (`call.test.js`: the ended page's
button, focus after Try again). To see the page, serve the folder with the
rewrites above and point the `mm-door` meta at a fake door.
