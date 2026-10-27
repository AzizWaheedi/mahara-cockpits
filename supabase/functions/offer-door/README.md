# offer-door

The door behind `offer.maharamedia.com`: the client's proposal page asks it for its proposal, records plays and Yes presses, and turns a pitch's video link into a redirect. Deployed with `verify_jwt = false`, so every route checks its own way in. The full design is in `docs/upsell-studio/EDGE.md` section 6.

Its name is neutral on purpose: the client's browser can show this function's address for a moment while a video link redirects (or longer, when the platform fails before the handler runs), so the word "upsell" never appears in it.

## Routes

| route | who calls it | answers |
|---|---|---|
| `GET /p/{code}?d={device}&pv={token}` | the offer page's script | `{state, proposal, contact}` from `cockpit_upsell_door_open`. Each picture's `{bucket, path}` becomes `{url}`: the verified logo by its public address, the rest signed for 600 s. A picture that cannot be signed is left out, never guessed. |
| `POST /p/{code}/event` | the page | Body `{kind: "play" or "cta", d, pv?}`, at most 1 KB, sent as JSON or as `text/plain` (no preflight). Answers 204. With a live preview token in `pv` nothing is recorded. |
| `GET /v/{code}` | a WhatsApp link, rewritten by the site's `vercel.json` | Always a 302 whenever the handler runs (a platform failure before it, such as a boot error, is Supabase's own answer), since the client opens it on their phone: to the offer video's own page, or to the offer site: `/?gone=1` (unknown code, or a row that is not a video page), `/?busy=1` (rate limit), `/?error=1` (the database did not answer, the door is closed by a missing secret, or anything else failed), `/` (a link preview or crawler, not counted). |
| `GET /health` | the doctor | `{ok, site, routes: {p, event, v}}`, each route `{ok, missing: [secret names]}`. 200 when every route is open, else 503. |

States on `/p`: `open`, `expired`, `archived`, `unknown` (from the database), plus `busy` (429) and `error` (502, 503, or 500 when anything else fails) from the door. Every `error` answer is exactly `{state: "error", proposal: null, contact: null}` with the page's CORS header, whatever the cause; a refused or failed event is `{error: "Not recorded."}`. The cause goes to the status row and the log, never to the client's browser.

## Who gets in

- `/p` and `/p/{code}/event` answer only the page's own origin (`OFFER_SITE_URL`, default `https://offer.maharamedia.com`) or a local run (`http://localhost` or `http://127.0.0.1`, any port). Anything else gets 403 and no database read.
- A code that cannot be a code (`^[a-hj-km-np-z2-9]{12}$` for a proposal, `{10}` for a video) is `unknown` with no database read.
- Link previews, crawlers, HEAD requests and an empty user agent get `unknown` (or the site's front page on `/v`) and are never counted. The rule is sales-live's `isPreviewBot`.
- Rate limits per running instance, as sales-live: 30 a minute per salted address and device, 120 a minute per address. Opens, events and video links count apart.
- A live preview token (`pv`, 24 characters, from `cockpit_upsell_proposal_preview`) goes to the database, which opens the page even past its date and does not count the open. The page sends the same `pv` with each play and Yes press, and the door records none of them, so a CSM checking the page never reads as the client.

## What it keeps

The database counts each open, play, Yes press and video view in `cockpit_upsell_views`: the device id the page made, the device kind (phone, tablet, computer) and a salted sha256 of the caller's network (an IPv4 address, or an IPv6 /64). Never the address itself. The salt is `OFFER_IP_SALT`, hashed with a door-only label, so the stored hash never matches sales-live's.

Each route's last outcome goes to `cockpit_upsell_door_status` through `cockpit_upsell_door_status_set`: when it changes, else at most once a minute. A door that stopped working reads "Opens unknown" on the proposal cards, never zero.

## Secrets (read by name, never printed)

| secret | needed by | if missing |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | every route (the platform sets them) | `/p` answers 503 `{state: "error", proposal: null, contact: null}` and the event route 503 `{error: "Not recorded."}`; `/v` sends the client to `/?error=1`; the log and `/health` name them (the status row cannot be written without them) |
| `OFFER_IP_SALT` | every route | `/p` and the event route answer 503 in the shapes above; `/v` sends the client to `/?error=1`. The sentence "Proposal pages cannot open: OFFER_IP_SALT is missing on offer-door. Add it to the function's secrets." goes to the status row, the log and `/health` only, never to the client and never with its value |
| `OFFER_SITE_URL` | optional | `https://offer.maharamedia.com` |

Set a new random `OFFER_IP_SALT` (32 bytes or more). Supabase Edge secrets are project-scoped, so keep the existing `IP_SALT` unchanged for sales-live. Offer-door reads only `OFFER_IP_SALT` and never falls back to `IP_SALT`.

## Headers on every answer

`Cache-Control: no-store`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'`, `X-Robots-Tag: noindex, nofollow`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.

## Imports

It imports `isPreviewBot`, `deviceOf`, `clientIp`, `limitNet`, `ipHash`, `deviceIdOk` and `RateLimiter` from `../sales-live/door.ts`, `sha256Hex` from `../sales-live/sign.ts`, and `fetchTextWithin`, `redact` and `Timeout` from `../sales-live/util.ts` (the body is read inside the same deadline as the call). It copies none of them. The deploy bundles those files through the import graph.

## Run, check, deploy

```bash
bun test supabase/functions/offer-door/door.test.ts        # no network
bun test supabase/functions/offer-door/handler.test.ts     # no network
# NOT run yet (ship only, with the CEO's OK):
python3 deploy_fn.py offer-door supabase/functions/offer-door --no-verify-jwt
curl -s https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/offer-door/health
```

On the first deploy, check the same two things as sales-live's README: which address header Supabase's edge sets (`cf-connecting-ip`, or `X-Forwarded-For` with its own hop last), and that two networks read as two addresses. `clientIp` is sales-live's, so a fix there covers both doors.

The reliability monitor's profile entry for `offer-door` is added at ship (contract section 10).
