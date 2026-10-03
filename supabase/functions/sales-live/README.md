# sales-live

The one public door of the live-call work: Zoom's meeting events, the
"Mahara Sales" Slack app, the short link `call.maharamedia.com/{code}` and
pg_cron's way in to `sales-api`. Deployed with `verify_jwt = false`, so every
route checks its own key first. Not deployed yet.

| Route | Who calls it | Checks | Answers |
| --- | --- | --- | --- |
| `POST /zoom` | Zoom's event subscription | `x-zm-signature` = `v0=` + hex HMAC-SHA256 of `v0:{x-zm-request-timestamp}:{raw body}`, constant time, no time window (Zoom retries 5, 20 and 60 minutes later with the first timestamp) | `endpoint.url_validation` (only after the signature matches, so the door is never an HMAC oracle); the seven subscribed events stored once, 200 inside Zoom's 3 s; anything else 200 and ignored |
| `POST /slack` | Slack: slash commands, interactivity, events | `X-Slack-Signature` v0 with the 300 s window | `url_verification`; `/available`, `/unavailable` (and `/away`), `block_actions` and `app_home_opened` passed to `live.press`; an empty 200 inside Slack's 3 s |
| `GET /open/{code}` | the short page's script | origin (the live site, its Vercel previews, localhost); 30 a minute per salted address | where the room is: `open` with `join_url`, `provider` and the host's first names, `preparing`, `ended` (with the WhatsApp number), or `unknown` |
| `GET /go/{code}` | the page's no-script link | 30 a minute per address | 302 to the room, the ended page or the site; records nothing |
| `POST /cron` | pg_cron (`mahara-sales-rooms-sweep`, later `mahara-sales-threads`) | `x-cron-secret` against `CRON_SECRET`, constant time | passes on `room.event` and `thread.tick` only, with the project key plus the cron secret, and returns sales-api's answer |
| `GET /health` | the doctor, a person | none | which routes are ready, by secret name only, never a value |

## Secrets, read by name

`ZOOM_WEBHOOK_SECRET`, `SLACK_SIGNING_SECRET`, `IP_SALT`, `CRON_SECRET`, and the
platform's own `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. A missing one
closes only its own routes with a 503 and a plain sentence, and `/health`
names it. The CEO writes the values to `/opt/data/bibi/api-keys.env` on the
VPS; the build copies the verifiers into function secrets without printing
them. `CRON_SECRET` is the vault's `cockpit_sync_secret` value (the same one
sales-mirror and sales-api use). `IP_SALT` is any long random string; changing
it only means an old device's opens are counted again.

## What it writes

- `cockpit_sales_room_events`, on conflict of `dedupe_key` do nothing:
  - Zoom: `kind` = `zoom.` + Zoom's event name, `source` `zoom`, `room_id`
    from `provider_meeting_id` (else the code in the topic "Mahara call
    {code}", else null), `text` a plain line, `detail` the event in Zoom's own
    shape with fewer fields (no phone, IP, customer key or registrant id).
    `handled_at` stays null: `room.event` sets it, and the sweep replays it
    after 20 s if the first pass failed. Dedupe key: event, meeting instance,
    participant and the event's own time, so Zoom's retries collapse and a
    rejoin stays a second event.
  - Opens: `kind` `door.open`, `source` `door`, one per room and device
    (a random id the page keeps in the browser, else the salted address and
    browser), `handled_at` set at once (log only), `detail` = device, system,
    the salted IP hash and the room's state. A link preview is never counted.
- `cockpit_sales_rooms`: `first_open_at`, `last_open_at` and `open_device`
  (`phone`, `tablet`, `desktop`) on the first counted open
  (`first_open_at=is.null`, so 50 at once write it once), and `last_open_at`
  on later opens at most every 30 s (the sweep's open grace reads it). Nothing
  else about a room is ever changed here.
- `cockpit_sales_worker_status` rows `sales-live/zoom`, `/slack`, `/open`,
  `/go` and `/cron`: the last outcome as a sentence, written when it changes
  or at most once a minute per instance.

## What it sends to sales-api

`POST {SUPABASE_URL}/functions/v1/sales-api` with `Authorization` and
`apikey` = the service key and `x-cron-secret`, as sales-mirror does:

- `{action: "room.event", kind, source: "zoom", room_id, dedupe_key, payload}`
  where `payload` is the stored Zoom event (read it with roomlogic's
  `zoomEffect`). Two tries, 15 s each, inside `EdgeRuntime.waitUntil`.
- `{action: "live.press", kind: "command" | "block_actions" | "app_home_opened",
  request_id, slack_user_id, slack_team_id, response_url, command?, actions?,
  channel_id?, message_ts?, event_id?, text?, tab?}`. `request_id` is the same
  for every retry of one Slack request. One try (a second "Take it" after a
  slow first one would read as lost); a failure is said in Slack through
  `response_url`.
- The cron door's body as pg_cron sent it.

`room.event`, `live.press` and `thread.tick` must be in sales-api's
`CRON_ACTIONS` and `DESK_ACTIONS` (the hooks commit).

## Run, check, deploy

```bash
bun test supabase/functions/sales-live      # 149 tests, no network
python3 deploy_fn.py sales-live supabase/functions/sales-live   # verify_jwt off; NOT run yet
curl -s https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-live/health
```

Then, in this order: Zoom's Event Subscriptions URL
`https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-live/zoom`
(press Validate), the Slack app's Interactivity, Slash Commands and Event
Subscriptions URL `.../sales-live/slack`, and the short site's `mm-door` meta
(already this function).
