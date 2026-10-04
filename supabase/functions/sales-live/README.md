# sales-live

The one public door of the live-call work: Zoom's meeting events, the
"Mahara Sales" Slack app, the short link `call.maharamedia.com/{code}` and
pg_cron's way in to `sales-api`. Deployed with `verify_jwt = false`, so every
route checks its own key first. Not deployed yet.

| Route | Who calls it | Checks | Answers |
| --- | --- | --- | --- |
| `POST /zoom` | Zoom's event subscription | `x-zm-signature` = `v0=` + hex HMAC-SHA256 of `v0:{x-zm-request-timestamp}:{raw body}`, constant time, no time window (Zoom retries 5, 20 and 60 minutes later with the first timestamp) | `endpoint.url_validation` (only after the signature matches, so the door is never an HMAC oracle); one room lookup (500 ms); a meeting that is no cockpit room: 200 `{ignored: "not a room"}` and nothing kept; a room's event: stored once, 200 inside Zoom's 3 s; other events 200 and ignored |
| `POST /slack` | Slack: slash commands, interactivity, events | `X-Slack-Signature` v0 with the 300 s window | `url_verification`; `/available`, `/unavailable` (and `/away`), `block_actions` and `app_home_opened` passed to `live.press`; an empty 200 inside Slack's 3 s |
| `GET /open/{code}` | the short page's script | origin (`call.maharamedia.com`, the one `CALL_SITE_URL`, localhost); 30 a minute per salted address and device, 120 a minute per address, 150 a minute per room code from every address; all reads inside 4.5 s. The address is the one the edge saw (`cf-connecting-ip`, else the last `X-Forwarded-For` hop), never the first hop a client writes; bodies on `/zoom` and `/slack` are read a chunk at a time and cut off past their cap | where the room is: `open` with `join_url`, `provider` and the host's first names, `preparing`, `ended` (with the official WhatsApp number), or `unknown` |
| `GET /go/{code}` | the page's no-script link | the same limits | 302 to the room, to `/ended?c={code}` or to the site; records nothing |
| `POST /cron` | pg_cron (`mahara-sales-rooms-sweep`, later `mahara-sales-threads`) | `x-cron-secret` against `CRON_SECRET`, constant time | 202 at once for the sweep's replays and `thread.tick` only; the forward runs after, its outcome in the status row |
| `GET /health` | the doctor, a person | none | which routes are ready, by secret name only, never a value |

A code is read the way a lead taps it: any case, stray spaces, invisible
marks (left-to-right and right-to-left marks, zero-width characters, bidi
isolates) and punctuation the message glued on (`K7Q2MX.`, `K7Q2MX،`,
`K7Q2MX)`). A seventh letter or digit is still refused. The page
(`sites/call-link/core.js`) reads it the same way; a test keeps them equal.

## Secrets, read by name

`ZOOM_WEBHOOK_SECRET`, `SLACK_SIGNING_SECRET`, `IP_SALT`, `CRON_SECRET`, and the
platform's own `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. A missing one
closes only its own routes with a 503 and a plain sentence, `/health` names
it, and an alert is raised (below). The CEO writes the values to
`/opt/data/bibi/api-keys.env` on the VPS; the build copies the verifiers into
function secrets without printing them. `CRON_SECRET` is the vault's
`cockpit_sync_secret` value (the same one sales-mirror and sales-api use).
`IP_SALT` is any long random string; changing it only means an old device's
opens are counted again. `CALL_SITE_URL` (optional) names one more https
origin that may read `/open`, exactly; no vercel.app wildcard, because anyone
can name a Vercel project `call-link-something`.

## What it writes

- `cockpit_sales_room_events`, on conflict of `dedupe_key` do nothing:
  - Zoom, only for a cockpit room's meeting: `kind` = `zoom.` + Zoom's
    event name, `source` `zoom`, `room_id` from the one lookup
    `or=(provider_meeting_id.eq.{id},code.eq.{topic code})` (the topic's
    code decides first; null when two rooms wrap one meeting, or when the
    lookup failed, so a lead's join is never lost), `text` a plain line,
    `detail` the event in Zoom's own shape with fewer fields (no phone, IP,
    customer key or registrant id). An event whose meeting matches no room
    (the webinar, a client call, an interview on the same Zoom account) is
    kept nowhere: its attendees' names and emails never reach this table,
    which every seat can read. `handled_at` stays null: `room.event` sets
    it, and the sweep replays it after 20 s if the first pass failed.
    Dedupe key: event, meeting instance, participant and the event's own
    time, so Zoom's retries collapse and a rejoin stays a second event.
  - Opens: `kind` `door.open`, `source` `door`, one per room and device
    (a random id the page keeps in the browser, else the salted address and
    browser), `handled_at` set at once (log only), `detail` = device, system,
    the salted IP hash and the room's state. A link preview is never counted.
  - Slack replies with no `response_url`: `kind` `slack.reply`, `source`
    `door`, `room_id` null, `dedupe_key` `slack.reply:{request_id}`,
    `text` the sentence, `detail` `{slack_user_id, slack_team_id, view_id,
    container_type}`, `handled_at` null. Work for the VPS Slack poster (below);
    the sweep never replays it (it replays `zoom`, `slack`, `worker` and `claim` only).
- `cockpit_sales_rooms`: only `first_open_at`, `last_open_at` and
  `open_device` (door.ts `OPEN_COLUMNS`). `open_device` is `phone`, `tablet`
  or `computer` (door.ts `OPEN_DEVICES`, the room logic's `DEVICES`), left
  empty when the device cannot be told apart. `first_open_at` once
  (`first_open_at=is.null`, so 50 at once write it once); `last_open_at` on
  later opens at most every 30 s (the sweep's open grace reads it). If the
  database refuses the device name, the open time is written without it.
  Nothing else about a room is ever changed here.
- `cockpit_sales_worker_status` rows `sales-live/zoom`, `/slack`, `/open`,
  `/go` and `/cron` (handler.ts `STATUS_JOBS`): the last outcome as a
  sentence, written when it changes or at most once a minute per instance.
  A refusal by `live.press` is a working door (green); a failure to reach
  sales-api is red.
- `cockpit_sales_alerts`, through `rpc/cockpit_sales_alert_set`, for setup
  problems only, which never flap: key `config:sales-live/{zoom|slack|open|cron}`,
  raised when a secret is missing or sales-api's gateway refuses the action
  ("Not an action the desk may take.": the hooks commit is not deployed),
  refreshed at most every 10 minutes, resolved the next time that route
  works. The SQL watchdog posts open alerts to #sales-alerts in working hours.

## What it sends to sales-api

`POST {SUPABASE_URL}/functions/v1/sales-api` with `Authorization` and
`apikey` = the service key and `x-cron-secret`, as sales-mirror does:

- `{action: "room.event", kind, source: "zoom", event_id, room_id,
  dedupe_key, payload}` where `event_id` is the stored row's id and `payload`
  the stored Zoom event (read it with roomlogic's `zoomEffect`). One try of
  8 s; a second try only after a network error before any answer, never
  after a timeout or an answer (sales-api may still be working, or answered
  502 after HighLevel half-worked). The whole window, 16.4 s at most, ends
  before the sweep replays the event at 20 s.
- `{action: "live.press", kind: "command" | "block_actions" | "app_home_opened",
  request_id, slack_user_id, slack_team_id, response_url, command?, actions?,
  channel_id?, message_ts?, container_type?, view_id?, event_id?, text?, tab?}`.
  `request_id` is the same for every retry of one Slack request. One try (a
  second "Take it" after a slow first one would read as lost).
- From the cron door, rebuilt field by field, nothing else passed through
  (contract-v2 S4):
  - `{action: "room.event", kind: "sweep.replay", payload: {event_ids}}`;
  - `{action: "room.event", kind: "sweep.settle", payload: {room_ids}}`;
  - `{action: "room.event", kind: "tick", payload: {room_ids}}`;
  - `{action: "thread.tick"}`.

  Each id list is 1 to 50 UUIDs, lower-cased and de-duplicated. Any other
  `room.event` is refused with a 403: the cron secret is shared with
  sales-mirror and sales-api, and must not stand in for Zoom's signature. A
  tick moves no timer, so a forged one can only ask for a re-check of rows
  as they stand.

`room.event`, `live.press` and `thread.tick` must be in sales-api's
`CRON_ACTIONS` and `DESK_ACTIONS` (the hooks commit).

## The contract the other lanes keep

- **room.event takes the event with the lease (contract-v2 S3 and section
  6).** For a Zoom event it takes the stored row by `event_id` with
  `cockpit_sales_room_event_lease(p_event_id => $id, p_seconds => 30)`
  before anything else. A null answer means the event is handled or someone
  else holds it, so it does nothing and answers `{ok: true, handled:
  false}`. When the work is done it sets `handled_at = now(), lease_until =
  null`; when it fails or must wait it sets only `lease_until = null`, and
  the sweep replays the event after 20 s, 3 tries at most. A `sweep.replay`
  takes each id the same way. It never works out a dedupe key of its own: the
  door's `event_id` is the key (roomlogic.ts `zoomDedupeKey` stays only as a
  test of the door's key). The door itself never sets `lease_until`: a
  lease set at insert would make sales-api's own lease call return null.
- **Opens do not move a room's version (lc-db).** `cockpit_sales_rooms_guard`
  raises `version` only when a column outside `first_open_at`,
  `last_open_at`, `open_device` and `updated_at` changes, for example
  `if (to_jsonb(new) - array['first_open_at','last_open_at','open_device','updated_at','version'])
  is distinct from (to_jsonb(old) - array[...same]) then new.version := old.version + 1; end if;`.
  Otherwise the lead tapping the link makes the setter's next press read
  "This changed a moment ago."
- **One device set (lc-db).** The `open_device` check becomes
  `open_device in ('phone', 'tablet', 'computer')` (null for not known). Until
  it does, a computer's open is written without its device.
- **The watchdog watches the door (lc-db).** Add `sales-live/zoom`, `/slack`,
  `/open`, `/go` and `/cron` to `cockpit_sales_watchdog()` as failing-only
  rows with no stale check (they write only when traffic comes), switched on
  with `rooms.enabled` (the Slack row with `live.slack`). Give events the
  sweep gave up on (3 tries) a final mark, `handled_at` plus
  `detail.gave_up`, so `room_events_unhandled` can clear (an event under a
  lease is never replayed while the lease holds). Index
  `cockpit_sales_rooms (provider_meeting_id)` for the Zoom lookup.
- **Time rules belong to the sweep (lc-db, lc-logic).** The door treats a
  room as over only in a final state. Adopting a standby room must reset
  `ends_at`; `no_end_signal` should not fire while the meeting's last Zoom
  event is a join with no `meeting.ended`.
- **Who answers in Slack (lc-logic, lc-worker).** `live.press` posts its own
  success (an App Home press: publish the Home view again with `view_id`).
  On a refusal it posts nothing and answers 4xx `{ok: false, error}`; the
  door says that sentence once. The VPS Slack poster (`sales-desk-rooms`,
  which holds the bot token) sends each `slack.reply` event with
  `handled_at` null as a DM to `detail.slack_user_id`, then sets
  `handled_at`.
- **The health card (lc-ui)** shows the five `sales-live` rows.

## Run, check, deploy

```bash
bun test supabase/functions/sales-live sites/call-link   # no network
python3 deploy_fn.py sales-live supabase/functions/sales-live   # verify_jwt off; NOT run yet
curl -s https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-live/health
```

On the first deploy, check which address header Supabase's edge sets
(`cf-connecting-ip`, or `X-Forwarded-For` with its own hop last): the open
limiter keys on that one (door.ts `clientIp`). If the edge passes on a
client's `X-Forwarded-For` unchanged with nothing after it, fix `clientIp`
before any link goes to a lead.

Check the opposite case too, when `cf-connecting-ip` is missing: open the
health route from two different networks (a phone on mobile data and a
laptop on Wi-Fi) and read the last `X-Forwarded-For` hop each time. If both
show the same address (a shared proxy of the edge), every lead would share
one rate-limit bucket on `/open` and `/go`, and in webinar-events, which
reads the address the same way. Fix `clientIp` (and webinar-events) to read
the hop before the edge's own before any link goes to a lead.

What the door counts as the lead opening their link (final review): only the
call page's own read of `/open` (it always sends an allowed `Origin`) and a
page load of `/go` (`Sec-Fetch-Mode` navigate, or none). An image or a
no-cors fetch on another site's page is answered and never recorded. One
open row per room, salted address and device kind, and at most 12 new rows
per room in 10 minutes per running instance; the room's open times are
written either way. The code's own limit (150 a minute) never locks a new
address out: each address's first 5 opens of a code a minute still pass,
and the page's busy state offers Join the call through `/go`.

Then, in this order: Zoom's Event Subscriptions URL
`https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-live/zoom`
(press Validate), the Slack app's Interactivity, Slash Commands and Event
Subscriptions URL `.../sales-live/slack`, and the short site's `mm-door` meta
(already this function).
