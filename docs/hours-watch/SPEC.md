# Hubstaff watch

Aziz, 2026-10-13: "I need a really easy way to be alerted, maybe on Slack in a
management channel and on the CEO cockpit in the management section ... it has
a cron that goes out during working hours ... if anybody's been doing something
that's not work or hasn't had Hubstaff on. I have the media buyer and the two
call center agents on it for now. Make something really nice and easy, run it
through a design pass, and make it amazing, unbreakable."

This file is the contract the migration, the Edge Function and the screen all
follow. Names here are final; change them here first.

## What it does

Every 5 minutes, all day (it does nothing outside anyone's shift), the
`cockpit-hours-watch` Edge Function looks at each person who must track time
(terms, else the role default: call centre agents and the media buyer, the
same rule as Hours and pay) and who is on shift right now. It raises one
incident per person and kind, posts it once to Slack #team-management
(`C0B5TL9H370`), replies in the same thread when it clears, and shows it all on
the CEO cockpit's Management tab in the "Hubstaff watch" card.

### The three alerts (kinds)

| kind | Opens when | Clears when |
|---|---|---|
| `not_tracking` | On shift, past the grace after the shift starts, and Hubstaff has not been running for `notTrackingMinutes` (default 30): `last_activities.online` is false and `last_client_activity` is older than the threshold or absent. Also opens with `detail.reason='no_account'` when the person has no linked Hubstaff account at all (for example an invite not yet accepted). | Hubstaff is running again (`online` true or `last_client_activity` within the threshold), or the shift ends (`close_reason='shift_ended'`), or a linked account appears for `no_account`. |
| `not_work` | At least `nonWorkShots` (default 2) screenshots recorded in the last `windowMinutes` (default 30) were judged `not_work` with confidence at least `minConfidence` (default 0.75). `unclear` never counts. | No `not_work` screenshot in the last `windowMinutes`, or the shift ends. |
| `idle` | In the activity window `[now - 20 min - idleMinutes, now - 20 min]` (Hubstaff activity data lags up to 20 minutes) the timer tracked at least 20 minutes but keyboard and mouse activity (`overall / tracked`) was under `idleFloorPct` (default 10%). | The same window reaches the floor again, or the shift ends. |

A fourth kind, `source`, has no person: Hubstaff cannot be read (missing key,
refused, firewall, unreachable). It opens once, posts once, clears when a read
works. While a source incident is open, no person incident opens or closes on
missing data: missing is never zero.

At most one open incident per (person, kind): partial unique index.

### When someone is "on shift"

- The schedule in force today: the newest `cockpit_schedule_history` row with
  `effective_from <= today`, else `cockpit_people.schedule`, else the default
  Saturday to Thursday 10:00 to 18:00 Asia/Kuwait (the team standard). An
  exception for the date wins over the weekday.
- Times are wall clock in the schedule's `timezone` (default Asia/Kuwait).
- Not on shift when: the day is off, a holiday (`cockpit_hours_holidays_json`),
  approved or pending Timetastic leave covers the day
  (`cockpit_timetastic_bookings`, same rule as `cockpit_hours_nudge_list`), the
  person is not in an `employed` period or is in a `paused` one, or
  `ended_on` has passed.
- Grace: alerts for `not_tracking` start `graceMinutes` (default 15) after the
  shift starts.

### Screenshots

- Hubstaff takes one screenshot per 10 minutes for Lama and Daniya
  (`screenshot_settings`). Each new screenshot is read once:
  `GET /v2/organizations/{org}/screenshots` for the last 40 minutes, download
  `full_url` (a signed S3 link, 2 hours), send it to the vision model with the
  person's role and the apps and sites Hubstaff logged in that 10-minute slot
  (`tool_usages`).
- Model: Google Gemini (`GOOGLE_AI` key) `gemini-flash-latest`, falling back to
  `gemini-2.5-flash`; OpenAI `gpt-4.1-mini` if only an OpenAI key is present.
  JSON answer: `{verdict: work|not_work|unclear, label (what is on screen, 8
  words at most), reason (one sentence), confidence 0..1, category}`.
- Role context (work, not a reason to alert):
  - Call centre agent: the Mahara dialer (dialer.maharamedia.com), HighLevel
    or LeadConnector (app.gohighlevel.com, link.maharamedia.com), WhatsApp
    chats with leads, Maqsam, Zoom or Google Meet calls, Google Sheets and
    Docs, Slack, ClickUp, the cockpit (cockpit.maharamedia.com), email, call
    scripts.
  - Media buyer: Meta Ads Manager and Business Suite, client Facebook and
    Instagram pages and ads, Google Ads, TikTok Ads, Canva, CapCut, Google
    Sheets, ClickUp, Slack, Foreplay, Frame.io, the cockpit, ChatGPT or Claude
    for copy, ad libraries.
  - Not work: a personal social feed (Reels, TikTok For You, Shorts), YouTube
    or streaming entertainment, games, shopping, sport, gossip or news
    unrelated to work, personal chats that are clearly not with leads.
  - A lock screen, a screensaver or an empty desktop is `unclear` (the idle
    alert covers being away).
- A screenshot judged `not_work` is copied (the 320x180 thumbnail and the full
  image) into the private bucket `cockpit-hours-watch` so the evidence outlives
  the 2-hour link. Others are not stored.
- No AI key: screenshots are recorded with `verdict='skipped'` and the card
  says how to switch the check on. The model failing: `verdict='error'`, retried
  on the next run up to 3 attempts, never counted as not work.

### Slack

- Channel `C0B5TL9H370` (#team-management). `chat:write.public` lets the bot
  post without joining.
- One message per incident (plain text, no emoji, links unfurl off):
  - not_tracking: `*Lama Harb* (call centre agent) has not had Hubstaff on since 10:12, 35 min into the 10:00 to 18:00 shift. <https://cockpit.maharamedia.com/ceo?tab=management#hubstaff-watch|Open Hubstaff watch>`
  - no_account: `*Nada Al Saed* (media buyer) is on shift but is not in Hubstaff yet (invite not accepted). ...`
  - not_work: `*Daniya Ziad* (call centre agent): 3 of the last 3 screenshots do not look like work (YouTube video, Instagram feed). <...|See the screenshots>`
  - idle: `*Lama Harb* (call centre agent): Hubstaff has been running since 11:00 with 3% keyboard and mouse activity. ...`
  - source: `Hubstaff watch cannot read Hubstaff: <note>. Nobody is being watched until it can. <...|Open Hubstaff watch>`
- When it clears, one reply in the thread: `Back on Hubstaff at 10:47 (35 min off).`, `Shift ended. Hubstaff was off from 16:10 to 18:00 (1 h 50 min).`, `No more screenshots off work since 11:30.`, `Activity back above 10% at 11:40.`, `Hubstaff can be read again.`
- Screenshots never go to Slack.
- Alerts switch off (`on=false`): incidents are still recorded, `slack_state='muted'`.
- Every Slack call is receipted in `cockpit_hours_provider_health`
  (provider `slack`). A post is claimed before it is sent; an `unknown` answer
  is never retried (it may have arrived).

## Data (migration `20261013d_cockpit_hours_watch.sql`)

House style: `BEGIN; ... COMMIT;`, safe to apply twice, every function
`SECURITY DEFINER SET search_path=''`, revoked from PUBLIC, anon,
authenticated and service_role, then granted to exactly one role; tables RLS on,
all grants revoked, then service_role only. CEO RPCs open with
`cockpit_is_ceo()`; service RPCs call `cockpit_hours_require_service()`. vault,
net and cron only inside guarded dynamic SQL so the file loads in PGlite. Ends
with `NOTIFY pgrst, 'reload schema'`.

### Settings: `cockpit_settings` key `hours.watch`

```json
{"on": true, "shots": true, "channel": "C0B5TL9H370", "channelName": "team-management",
 "notTrackingMinutes": 30, "graceMinutes": 15, "idleMinutes": 30, "idleFloorPct": 10,
 "windowMinutes": 30, "nonWorkShots": 2, "minConfidence": 0.75}
```
Seeded on first apply (never overwritten). Bounds: notTrackingMinutes 10..240,
graceMinutes 0..120, idleMinutes 20..240, idleFloorPct 1..50, windowMinutes
20..120, nonWorkShots 1..6, minConfidence 0.5..0.99, channel `^[CG][A-Z0-9]{8,12}$`.

### Tables

- `cockpit_hours_watch_runs(id bigserial pk, started_at, finished_at, state in
  ('running','ok','failed','abandoned'), holder uuid, lease_until, dry_run bool,
  requested_by text, result jsonb, error text)`. Its own lease, independent of
  the hourly hours read.
- `cockpit_hours_watch_status(person_id bigint pk -> cockpit_people, state in
  ('tracking','not_tracking','idle','not_work','off_shift','on_leave','holiday',
  'no_account','cant_tell'), since timestamptz, shift_start timestamptz,
  shift_end timestamptz, online bool, last_activity_at timestamptz,
  tracked_today_s int, active_pct_30m numeric, screenshots_on bool,
  updated_at, run_id bigint, detail jsonb)`.
- `cockpit_hours_watch_slots(person_id, slot_start timestamptz, tracked_s int,
  overall_s int, idle bool, pk(person_id, slot_start))`: 10-minute blocks for the
  shift line, kept 14 days.
- `cockpit_hours_watch_shots(shot_id bigint pk (Hubstaff id), person_id,
  hubstaff_user_id text, recorded_at timestamptz, slot_start timestamptz,
  verdict in ('pending','work','not_work','unclear','error','skipped'), label
  text <=120, reason text <=240, category text <=40, confidence numeric,
  model text, apps jsonb, attempts int, classified_at, thumb_path text,
  full_path text, error text <=240, created_at)`. Kept 30 days (stored images
  of flagged ones 90 days).
- `cockpit_hours_watch_incidents(id bigserial pk, person_id bigint null ->
  cockpit_people, kind in ('not_tracking','not_work','idle','source'),
  opened_at, last_seen_at, closed_at, close_reason text, detail jsonb,
  slack_channel text, slack_ts text, slack_state in
  ('pending','sending','posted','failed','unknown','muted'), slack_error text,
  resolve_state in ('none','pending','sending','posted','failed','unknown','muted'),
  reviewed_at, reviewed_by text, review_note text <=300, run_id)`. Unique open:
  `(coalesce(person_id,0), kind) WHERE closed_at IS NULL`.
- `cockpit_hours_watch_keys(provider pk in ('google_ai','openai'), secret text,
  last4 text, saved_by text, saved_at, state in ('connected','refused','unchecked'),
  state_note text, checked_at)`. No grant to any role.
- `cockpit_hours_provider_health.provider` CHECK widened to add `google-ai`,
  `openai`, `storage`.
- Storage bucket `cockpit-hours-watch` (private, 3 MB, image/jpeg, image/png,
  image/webp). Read policy for `authenticated`:
  `public.cockpit_hours_watch_object_allowed(name)` = CEO and a shot row whose
  `thumb_path` or `full_path` is that name. The function writes with the
  service key.

### Service RPCs (service_role only)

- `cockpit_hours_watch_lease_claim(p jsonb {requestedBy, dryRun})` ->
  `{ok, runId, leaseToken}` or `{ok:false, busy:true, since}`; marks expired
  running rows abandoned; lease 4 minutes.
- `cockpit_hours_watch_inputs(p_now timestamptz)` -> `{settings, now, people:
  [{personId, name, role, hubstaffUserId|null, accountStatus, shift:
  {start, end}|null, offReason: null|'day_off'|'holiday'|'leave'|'not_employed'
  |'paused', screenshotsOn|null}], open: [incident rows], knownShots: [shot ids
  from the last 3 hours with verdict and attempts]}`.
- `cockpit_hours_watch_apply(p jsonb {runId, leaseToken, statuses[], slots[],
  shots[], open[], update[], close[]})`: upserts, opens (`slack_state` =
  'pending' when settings.on else 'muted'), touches `last_seen_at`, closes
  (`resolve_state` = 'pending' when the open post went out, else 'none' or
  'muted'). Returns `{opened:[ids], closed:[ids]}`. Refuses without the lease.
- `cockpit_hours_watch_slack_claim(p {incidentId, which: 'open'|'resolve'})`:
  moves pending to sending, returns the incident or null.
- `cockpit_hours_watch_slack_result(p {incidentId, which, state:
  'posted'|'failed'|'unknown', ts?, error?})`.
- `cockpit_hours_watch_finish(p {runId, leaseToken, state, result, error})`:
  closes the run and upserts `cockpit_sync_state('hours-watch')` (ok, note,
  rows_seen = people watched). The guardian watches this key (15 minutes).
- `cockpit_hours_watch_key_get(p_provider)`, `cockpit_hours_watch_key_put(p
  {provider, secret, savedBy, state?, stateNote?})` (audit `hours.watch.keySaved`,
  never the secret).
- `cockpit_hours_watch_prune()`: slots older than 14 days, shots older than 30
  days without stored images and 90 days with, runs older than 30 days, closed
  incidents are kept. Returns the storage paths to delete.

### CEO RPCs (authenticated, `cockpit_is_ceo()`)

- `cockpit_ceo_hours_watch_board()` -> the screen's whole payload:
  ```
  {settings, sources: {hubstaff: {state, note}, ai: {state: 'connected'|'missing'|'refused', provider|null, note}, slack: {state: 'ok'|'failing'|'unknown', note}},
   lastRun: {at, ok, note}|null, cronOn: bool, now,
   people: [{personId, name, role, state, since, shiftStart, shiftEnd, online, lastActivityAt,
             trackedTodayS, activePct30m, screenshotsOn, offReason|null,
             slots: [{start, trackedS, overallS, idle}], shots: [{id, at, verdict, label, confidence, thumbPath|null}]}],
   open: [{id, personId|null, kind, openedAt, lastSeenAt, detail, slackState, slackError|null, reviewedAt|null}],
   recent: [{id, personId|null, kind, openedAt, closedAt, closeReason, detail, reviewedAt}]}   // closed in the last 7 days, newest first, at most 50
  ```
  `shots` are today's screenshots of that person that were judged `not_work`
  or `unclear` (newest 12). Paths are only for signing.
- `cockpit_ceo_hours_watch_set(p jsonb)`: partial settings patch, validated
  against the bounds; audit `hours.watch.set` with before and after.
- `cockpit_ceo_hours_watch_review(p jsonb {incidentId, note?})`: marks reviewed;
  audit `hours.watch.review`.

### Cron

`cockpit_hours_watch_kick()` posts `{"job":"watch"}` to
`/functions/v1/cockpit-hours-watch` with `x-cron-secret` from vault
`cockpit_sync_secret`; `cron.schedule('mahara-hours-watch', '*/5 * * * *', ...)`.
No secret: `cockpit_sync_state('hours-watch-kick')` ok=false with a plain note.

## Edge Function `cockpit-hours-watch` (verify_jwt off)

- Door: POST only, `x-cron-secret` compared in constant time; body
  `{"job": "watch" | "doctor", "dryRun"?: true}`; anything else is 400 (never a
  silent fallback). `watch` answers 202 and works under `waitUntil`; with
  `dryRun` it answers the plan synchronously and writes nothing.
- One run: claim the lease -> read inputs -> if nobody is on shift and no
  incident is open, finish ok ("Nobody on shift") without calling Hubstaff ->
  Hubstaff reads through `hubstaffGet` (paths added to `HUBSTAFF_PATHS`:
  `screenshots`, `tool_usages`, `screenshot_settings`, `tracking_states`):
  `last_activities`, `activities` (today in the shift's day), `screenshots` (last
  40 minutes), `tool_usages` (last 40 minutes, `tool_type` url and application),
  `screenshot_settings` (once an hour is enough; every run is fine) -> classify
  new screenshots (at most 12 per run, oldest first) -> decide with the pure
  rules module -> `cockpit_hours_watch_apply` -> Slack posts for opened and
  resolve replies for closed -> prune once a day (first run after 03:00
  Kuwait) -> finish.
- The rules module `rules.ts` is pure (no I/O, injected `now`) and holds every
  decision above. It is the most tested file.
- `doctor`: names missing secrets (`SLACK_BOT_TOKEN`, `CRON_SECRET`), the
  Hubstaff key state, the AI key state (one cheap model list call), the Slack
  channel (`conversations.info`), and returns them without writing anything
  but receipts.
- Every external call goes through a receipting helper into
  `cockpit_hours_provider_health`: Hubstaff via `hubstaffGet`, Slack via the
  watch's Slack helper (`chat.postMessage`, `conversations.info`), the model via
  `aiCall` (provider `google-ai` or `openai`), storage via the service client
  (provider `storage`). No call without its intent receipt.
- Failures never become alerts about a person: a Hubstaff read failure opens
  the `source` incident; a model failure marks the screenshot `error`; a Slack
  failure is recorded on the incident and shown on the card.

## CEO API (`cockpit-hours-api`, verify_jwt on)

- `{op: "watchNow"}`: posts `{"job":"watch"}` to the watch function with
  `CRON_SECRET`; audit `hours.watch.runNow`.
- `{op: "watchKey", provider: "google_ai"|"openai", key}`: tests the key with
  one model list call, saves it with `cockpit_hours_watch_key_put`, never
  echoes it.

## Screen: Management tab, card "Hubstaff watch" (id `hubstaff-watch`)

Design plan (frontend-design pass, inside the cockpit's own system: Geist,
`--mahara-teal`, the CEO kit, dark first):

- Job of the card: in one glance, who is working right now, who is not, and
  the proof.
- Signature element, the shift line: one bar per person spanning their shift
  (hour ticks under it in Geist Mono 10px). Tracked 10-minute blocks fill in
  `--ceo-emphasis` with opacity following keyboard and mouse activity (idle
  blocks hatched); a gap past the grace turns `--ceo-warning` (orange); a
  not-work screenshot is a small `--ceo-critical` tick above the bar that
  opens it; a thin needle marks now; time outside the shift is
  `--ceo-deemphasis`. The bar is the one teal-glow live element.
- Header: title "Hubstaff watch", one sentence ("All 3 are working." / "Lama
  needs a look." / "Nobody is on shift now. Next shift starts Sun 10:00."),
  actions "Check now" (outline) and the Slack alerts switch.
- Rows: name and role, a status chip (good: Working; warning: Not tracking
  since 10:12 / Timer on, no activity; critical: Not work on screen; neutral:
  Off today, On leave, Holiday, Not in Hubstaff), the shift line, tracked today
  and activity in the last 30 minutes (tabular figures).
- Open alerts: divided rows (no card in card): sentence, opened time, Slack
  state ("Sent to #team-management" / "Alerts are off" / "Slack refused:
  not_in_channel"), a screenshot strip (signed 10-minute links) that opens a
  large view, "Mark reviewed".
- Last 7 days: a quiet list, first 5 then "Show the other N".
- Settings sheet: alerts on or off, screenshot check on or off, the thresholds
  (with plain labels: "Alert after Hubstaff is off for", "Grace after the shift
  starts", "Keyboard and mouse below", "Screenshots off work in 30 minutes"),
  the channel, the AI key paste box with its state, and who is watched (with a
  link to Team & payroll to change someone's tracking).
- Missing and failing states say what to do: "Hubstaff cannot be read: <note>.
  Reconnect it in Team & payroll." / "Screenshot check needs a Google AI key.
  Paste one in Settings." / "Slack refused the last alert: <error>."
- Phone (390px): rows stack, the shift line stays full width, screenshots
  scroll sideways; no sideways page scroll.
- `api.ceo.hours.watchBoard`, `watchSet`, `watchReview`, `watchNow`, `watchKey`,
  `watchShotUrl` in `ceoHoursClient.ts`; `watchBoard` added to `READ_VERBS`.

## Review fixes (2026-10-13, after four adversarial reviews)

These change the contract above; where they disagree, this section wins.

### Rules (cockpit-hours-watch/rules.ts)
- **Lunch break.** One break a day is allowed when the shift is longer than
  `breakWhenLongerThanHours` (Hours rules, default 6): the first stop of the
  day after the person has already tracked during the shift waits
  `max(notTrackingMinutes, breakMinutes + graceMinutes)` (default 60 + 15)
  before it alerts. "First" means no earlier untracked stretch of at least
  `notTrackingMinutes` inside today's shift after their first tracked block
  (from the 10-minute blocks). Every later stop waits `notTrackingMinutes`.
- **Off since.** Off time is measured from `max(lastActivity, shift.start)`,
  so a late start alerts at shift start + `notTrackingMinutes` (as on the
  Hours tab), never earlier; the grace still applies on top.
- **Idle.** Keyboard and mouse share is `overall / input_tracked` (phone and
  web timer time has no activity level). The window is judged only when
  input-tracked time in it is at least 20 minutes. Opens below
  `idleFloorPct`; closes only at `idleFloorPct + 5` or more (hysteresis), or
  when the window no longer has 20 minutes of input-tracked time.
- **Shift start clamps.** The idle window and the not-work window never reach
  before `shift.start`.
- **Not in Hubstaff** (`not_tracking` with `reason='no_account'`) stays open
  across shifts: the shift end does not close it; only a linked account or
  the person no longer being watched does. One post, not one a day.
- **Source alert.** Opens only when Hubstaff has not been read in a run that
  finished ok for 10 minutes (`lastOkRunAt` from the inputs, null counts as
  long ago). Person alerts still freeze from the first failed read.
- **Text.** Percentages in sentences are rounded down (9.7% under a 10% floor
  reads "9%").
- **Read time.** A status row for a person whose Hubstaff data was read in
  this run carries `detail.readAt` (ISO); the screen shows blocks after
  `readAt - 20 min` as "not in from Hubstaff yet", never as a gap.

### Run (cockpit-hours-watch/run.ts and helpers)
- Hubstaff is also read (blocks only, to fill the shift line) for anyone
  whose shift ended in the last 30 minutes; the "nobody on shift" shortcut
  applies only when nobody is on shift or ended in the last 30 minutes.
- Slack: after a claim, any failure before the request is sent records
  `failed`, after it `unknown` (try/catch around the whole send). Thread
  replies due from earlier runs (`inputs.replies`) are sent too.
- Vision provider order: OpenAI first when an `openai` key is saved (API data
  is not used for training), models `gpt-4.1-mini` then `gpt-5-mini`; Gemini
  only when no OpenAI key is saved. A refused key (401/403, or Google's
  API_KEY_INVALID) marks the key with `cockpit_hours_watch_key_mark` state
  `refused` and stops screenshot checks for the rest of the run. A model that
  is not found (404) moves to the next model; any other failure stops trying
  models for that screenshot.
- If `cockpit_hours_watch_apply` throws, the images uploaded in this run are
  deleted before the error is rethrown.
- Tool usage entries keep a URL only up to the first `?` or `#`.

### Database (20261013d)
- Lease 6 minutes (a worst-case run ends inside it; an overlapping cron tick
  simply finds the run busy).
- `cockpit_hours_watch_inputs` also returns:
  `rules: {breakMinutes, breakWhenLongerThanHours}` (from `cockpit_hours_rules`
  when set, else 60 and 6), `lastOkRunAt` (newest non-dry run that finished
  `ok`), `lastPruneOn` (Kuwait date of `cockpit_sync_state('hours-watch-prune')`),
  and `replies` (incidents closed in the last 24 hours whose `resolve_state` is
  still `pending`, same shape as `open`).
- New columns `slack_claimed_at`, `resolve_claimed_at` (set by the claim). The
  apply sweeps `sending` older than 10 minutes to `unknown` (both states).
- New service RPC `cockpit_hours_watch_key_mark(p {provider, state:
  'refused'|'connected', note})`: changes state and note only; audit
  `hours.watch.keyState`.
- Board: `sources.ai.state` is `failing` (note = newest error) when the last 3
  screenshots checked in the last hour all ended `error`; each person carries
  `readAt` (from `detail.readAt`); open and recent incidents keep `name`.
- Prune also deletes `cockpit_hours_provider_health` rows older than 30 days
  for providers `google-ai`, `openai` and `storage`, and upserts
  `cockpit_sync_state('hours-watch-prune')`.
- The review audit row records `hasNote` (true or false), never the note text.

### Screen
- Blocks after `readAt - 20 min` (or with no `readAt`) are "unread", never a gap.
- Last 7 days uses the incident's `name`; close reason `not_watched` reads "No
  longer watched."; a source alert reads "Hubstaff could not be read" (never a
  raw code).
- Ticks closer than 12 px merge into one button that opens that alert's
  screenshots.
- The spoken summary says "Tracked time can't be read yet." when tracked time
  is unknown.
- The problem rows carry no Settings button (the header has the one Settings).
- AI `failing`: "The screenshot check is failing: <note>. Paste a new key in Settings."

## Final round (2026-10-13 evening, after the re-check)

Wins over everything above.

### Slack mention (CEO, 2026-10-13: "a really easy way to be alerted")
- #team-management had no human member, so alerts would never be seen. The
  CEO is added to the channel at go-live, and each **opening** post (never a
  thread reply) starts with `<@U09305KE2KS> ` so his phone gets a push.
- Settings gain `mention` (boolean, default true) and `mentionUser` (Slack user
  id, default `U09305KE2KS`, check `^[UW][A-Z0-9]{8,12}$`). The settings sheet
  shows one switch, "Mention me in each alert"; `mentionUser` is not shown.

### Rules
- **Idle window on finished blocks.** The idle window ends at the last
  finished 10-minute block before `now - 20 min`
  (`winEnd = floor((now - 20 min) / 10 min) * 10 min`, never before
  `shift.start`) and starts `idleMinutes` earlier (never before
  `shift.start`). It opens only with at least 20 minutes of input-tracked time
  in the window; it closes as `not_judged` only when input-tracked time drops
  under 10 minutes.
- **Lunch on the card.** While a person is inside the allowed break wait
  (stopped, no alert yet, the wait is the break one), the status row's state
  is `on_break` (new state) with `since` = when they stopped. The card shows a
  neutral chip "On a break since 13:00" and does not count them as needing a
  look. Once the wait passes, the state is `not_tracking` as before.
- **Part-day leave.** The roster passes `leave: [{start, end}]` (ISO instants)
  for leave that covers only part of today's shift. Rules treat time inside a
  window as off: the off time never counts from before a window's end, no
  `not_tracking` opens while now is inside a window (the status is
  `on_leave`), and the idle and not-work windows skip it.
- **No account for someone who left.** An open `no_account` alert closes with
  `not_watched` when the person's `offReason` is `not_employed` or `paused`.
- **Before-shift screenshots** are not classified, stored or shown: screenshots
  recorded before `shift.start` (or after `shift.end`) are dropped before
  classification.
- **Percentages.** `activePct30m` is sent unrounded; the database keeps two
  decimals; every sentence and the card round down.
- **Grammar.** One screenshot reads "The last screenshot does not look like
  work (YouTube video)."; more read "2 of the last 3 screenshots do not look like
  work (...)". Same rule in Slack and on the card.

### Run and keys
- **Evidence is kept on a lost answer.** If `cockpit_hours_watch_apply` throws,
  this run's uploads are deleted only when the database refused on purpose
  (`RpcError` with code `40001`, `22023` or `54000`); on a network error or a
  5xx they are kept.
- **Provider choice skips refused keys.** The first saved key whose state is not
  `refused`, OpenAI first, then Google. The `watchKey` save message names the
  provider the next run will actually use.
- **Marking a key is compare-and-swap.** `cockpit_hours_watch_key_get` returns
  `savedAt`; `cockpit_hours_watch_key_mark` takes `savedAt` and changes the
  state only when it still matches (a key pasted mid-run is never marked by the
  old key's failure). Returns `{ok:false, note:'The key changed during the run'}`
  otherwise.
- **What is a refused key.** 401; OpenAI 403 unless the error code mentions a
  model (`model_not_found` or similar, which moves to the next model); Google 400
  `API_KEY_INVALID` and 403 `PERMISSION_DENIED`. 404 moves to the next model.
- **Error kinds.** A screenshot whose model call failed is stored with
  `verdict='error'` and `category='model'`; a failed download or an expired link
  with `category='download'`. The board's `ai.state='failing'` counts only
  `category='model'` errors; download errors never say "Paste a new key".
- **Break bound.** `inputs.ts` accepts `breakMinutes` 0 to 600 and
  `breakWhenLongerThanHours` as the database does.

### Database
- Settings: `mention`, `mentionUser` as above.
- Roster: `leave` windows per person (part-day: Morning = shift start to its
  midpoint, Afternoon = midpoint to shift end, `booking_unit='Hours'` =
  `start_at`..`end_at` as wall clock in the schedule's time zone, clipped to
  the shift); whole-shift coverage keeps `offReason='leave'`.
- Roster: a person paid by the hour (terms `pay_basis`, else the role default)
  with **no schedule at all** (no history row and no `cockpit_people.schedule`)
  gets `offReason='no_schedule'` (same rule as Hours and pay and the morning
  note); fixed pay keeps the default Saturday to Thursday 10:00 to 18:00.
- Status `state` allows `on_break`.
- Slots gain `input_tracked_s` (nullable); the board passes `inputTrackedS`, and
  the shift line's shade uses `overall / input_tracked` when present (phone time
  is drawn as tracked at the middle shade).
- Board passes `onBreak` (from state) and `leave` windows per person.
- `key_get` returns `savedAt`; `key_mark` compare-and-swap as above.
- `ai.state='failing'` counts only `category='model'` errors.

### Screen
- Key copy is provider-neutral: "The screenshot check needs an AI key. Paste an
  OpenAI or Google AI key in Settings." The key box preselects OpenAI.
- Close reason `not_judged` reads "Too little time on the computer to judge
  activity."
- `on_break` and `no_schedule` states: neutral chips "On a break since 13:00" and
  "No schedule set" (with "Set one in Team & payroll" on the row).
- Leave windows draw as off time on the shift line (the deemphasised fill),
  never as a gap.
- Settings: the "Mention me in each alert" switch.

### Docs
- RUNBOOK: lease 6 minutes, review notes are not in the audit log (only
  `hasNote`), OpenAI first, the mention and the channel membership. SPEC body:
  "lease 4 minutes" is superseded.
- Guardian: `"hours-watch": 15` in `hermes/cockpit-guardian/checks/sections.py`
  run_jobs keys and its test list.
