# Final consistency check across the five specs (F, P1, P2, P3, P4)

**What I checked against**
- **Code:** origin/main `9670e5b`. On 2026-10-03 the remote main is still `9670e5b`. File copies are in `/private/tmp/claude-501/-Users-abdulazizwaheedi-mahara-cockpits/1742ac47-cfcd-4db7-b565-33e64c239220/scratchpad/fcc/`.
- **Data:** read-only SQL on Creative Triage.
- **Functions:** the Supabase functions list.

**Facts confirmed in this pass (relied on below)**
- **Deployed functions.** `sales-api` is **v58**, deployed 2026-10-02 16:15 UTC with verify_jwt on. P1 still says v57. `sales-mirror` is v14 with verify_jwt off.
- **Migrations.** No `20261003*` migration exists. The last one is `20261002e_sales_client_forms.sql`.
- **Action lists in `index.ts`.**
  - `DESK_ACTIONS` (`index.ts:5076-5082`) holds contract.sync, followup.autosend, followup.settle and dial.resync_stuck.
  - `CRON_ACTIONS` (`5085`) holds contract.sync only.
  - The cron path runs only `DESK_ACTIONS` handlers, as identity `sales-desk` (`5134-5141`).
  - Every call needs a bearer project key (`5111`). `sales-mirror` sends the service key plus `x-cron-secret` (`sales-mirror/index.ts:567-574`).
- **Vault and pg_cron.** The vault holds only `appointments_webhook_secret`, `cockpit_sync_secret`, `ghl_accounts` and `ghl_agency_token`. pg_cron job names follow `mahara-*`, for example `mahara-sales-mirror */3`.
- **Test contact `VjPfR4Cc1Y0OFvaqeor5`.** Tags are `cockpit-test` and `unqualified`, so it has **no roas tag**. The mirror shows `dnd = true`, no phone and an email.
- **WhatsApp template table.** `cockpit_sales_wa_templates` holds only `line_ar` and `line_en`. Both are inactive and have no workflow.
- **Live `followups` setting.** It already has:
  - `quiet {from 21, to 9}`;
  - `autosend` per segment, all false;
  - `cadence.cancelled [0.5, 48, 120]` and `cadence.after_call [24, 72]`;
  - `nurture_per_day 20`, `nurture_every_days 7` and `automation_gap_hours 20`;
  - `per_day 60` and `per_run 12`.
- **Other settings.** `whatsapp_guard` is 250 templates a day, pause at a 0.3 fail share, minimum 5 sends. `wa_fields` holds `rep` (`contact.cockpit_rep_name`) and `line` (`contact.cockpit_whatsapp_line`).
- **`sendTemplate` behaviour.**
  - The 2-minute gap is **per contact** (`index.ts:1163-1168`).
  - The 250-a-day ceiling covers all sources together (`1170-1177`).
  - The read-back runs for 12 s, 6 × 2 s (`1243`).
  - When nothing is seen it saves `provider_status="enrolled"` (`1257`, not the 1252 that P3 cites).
  - `source` is `followup` or `rep` (`1205`).
  - Custom fields are written only for line and rep (`1229-1232`).
- **Read-back match.** `whatsappSentSince` (`1099-1112`) matches any outbound WhatsApp after start minus 15 s. It does not check the text.
- **Template variables.** `TEMPLATE_VARIABLES` is first_name, rep_name and line (`lib.ts:661`). `renderTemplate` (`lib.ts:686`) fills body `{{n}}` by position.
- **Constraints that exist:** `cockpit_sales_messages_source_check` (rep, followup), `cockpit_sales_followups_segment_check` (7 kinds) and `cockpit_sales_confirmations_result_check` (includes message_sent).
- **Banner slot.** `App.tsx:247` renders `{banner}`, which is `portalBanner` today (`179`).
- **Bookings.** There are 0 upcoming appointments. The last booking was 2026-09-28 16:08 Kuwait time.
- **Desk status rows.** They are keyed by (worker, job). `doctor` last ran 2026-09-27. `followups`, `notes`, `digest` and `reviews` show the lapsed sign-in.
- **Line-number drift.** `dialer.ts` no_answer is at 911 (P1 says 910). disqualified → invalid is at 912 (P3 says 911). `upcoming` is defined at 3490 and called at 3607; both citations are valid.

---

## 1. Glossary: one name, one value

### 1.1 Tables (all carry the `cockpit_sales_` prefix)

| Name | Owner | Holds | Where specs deviate |
|---|---|---|---|
| `rooms` | F (P1 and P2 add columns in F's migration) | every video room | none left (P2's `live_rooms` was dropped) |
| `room_secrets` | F | room_id, start_url, expires_at; service role only | none |
| `room_events` | F | every Zoom, worker, door and person event; unique `dedupe_key` | P1 keeps device type only in `detail`. Keep `rooms.open_device` as the summary as well |
| `room_hosts` | F | email, zoom_user_id, zoom_status (licensed, basic, pending, missing), zoom_live_until, google_ok, default_provider, checked_at | P2's Team page "Zoom user" writes here, because `people` has no Zoom column |
| `availability` | F | email, state (away, available), until, via, reason | P2's `live_seats` was dropped |
| `presence` (view) | F | on_call, ready, available, away | P3 says `cockpit_sales_presence`, which is the same thing |
| `live` | F | handovers | P2 adds `entry`, `attempt_id` and `end_reason`; `note` is capped at 200 characters |
| `alerts` | P3, shared | `dedupe_key` unique; one row per alert from any worker or watchdog | F's watchdog had no dedupe store; it uses this table |
| `followup_meta`, `followup_levels`, `followup_waves`, `followup_wave_members`, `reply_waits`, `push_subs` | P3 | | `followup_levels` replaces the live `followups.autosend` |
| `threads`, `thread_steps` | P4 | | none |
| `rooms_weekly` (view) | P1 | weekly room metrics feeding `cockpit_metric_values` | none |
| Existing tables touched | | `messages` (source check), `followups` (segment check), `confirmations`, `appointments`, `worker_status`, `wa_templates`, `settings`; plus `cockpit_audit_log` and `cockpit_metric_values` | |

### 1.2 Column families

**`rooms`**
- **Identity:** `id`; `request_id` unique; `code` unique, `^[A-HJ-NP-Z2-9]{6}$`.
- **What it is for:**
  - `contact_id`, null only when the purpose is standby, enforced by the check `(contact_id is not null or purpose='standby')`;
  - `purpose` (fallback, handover, standby, booked, manual);
  - `trigger` (P1: no_answer, busy, did_not_connect, no_talk, hung_up, bad_number, manual, auto);
  - `call_kind` (intro, demo) and `provider` (zoom, meet);
  - `host_email`, `made_by`;
  - `appointment_id` (the booked call a `booked` room wraps);
  - `handover_id`, `replaced_by`, `attempt_id`.
- **State:** `state`, `version`, `error`; `result` (P1: joined, no_join, moved_to_phone, cancelled, failed, admit_blocked); `settled_mark` (showed, noshow, none).
- **Provider:** `provider_meeting_id`, `join_url`, `send_on` (open, host_in).
- **Deadlines:** `host_by`, `lead_by`, `ends_at`. There is **no `ready_by`**. P1's queue hold uses it, so P1 must change.
- **Times:** `requested_at`, `claimed_at`, `opened_at`, `link_sent_at`, `first_open_at`, `lead_waiting_at`, `host_in_at`, `lead_in_at`, `ended_at`.
- **Messages:** `link_message_ids`, `open_device`.
- **Booking claim:** `count_claimed_at`, `count_appointment_id`, and `count_result` (booked, moved, not_a_lead, failed, undone).
  - P1 deviates with `book_claimed_at` and `live_appointment_id`.
  - P2 deviates with `book_claimed_at`, and stores the live booking in `appointment_id`.

**`live`**
- `id`, `request_id`, `contact_id`, `asked_by`, `kind` (intro, demo).
- `reason` (on_call, replied, manual) and `entry` (dialer, lead_page, inbox, followup).
- `note` (200 characters at most), `attempt_id`.
- `state`, `version`, `offered_to`, `offer_until`, `claimed_by`, `room_id`, `slack_posts`, `end_reason`.

**Unique indexes** (the names are set here):

| Index | Rule |
|---|---|
| `rooms_one_per_lead` | one non-final room per contact |
| `rooms_one_per_host` | one non-final room per host, where purpose is not booked |
| `live_one_open_per_lead` | one open handover per lead |
| `live_one_claim_per_closer` | one claimed handover per closer |
| `threads_one_open_per_lead` | one open demo chat per lead |
| `thread_steps_once` | (thread_id, step) |
| one open draft per lead | already exists |
| one running wave per contact | on `followup_wave_members` |

### 1.3 States

| Machine | One set of names | Deviations |
|---|---|---|
| Room | requested, creating, open, host_in, lead_in; final: ended, expired, failed, cancelled | F's table needs P2's **host_in → open** transition (the host leaves before the lead joins; `host_by` resets to 120 s) |
| Handover (`live`) | offered, claimed, room_ready, lead_joined; final: done, expired, cancelled, **failed** | F has no `failed`; add it. F's table also needs P2's **room_ready → offered, once** |
| Presence | on_call, ready, available, away; the first that applies wins | none |
| Thread | planned, holdout, introduced, at_call, after_call, held; final: closed | none |
| Thread close reasons | won, lost, client, cancelled, opted_out, undeliverable, dnd, manager, two_days_after, live_call | none |
| Thread arm | chat, holdout, excluded | none |
| Thread step | planned, sending, sent, unconfirmed, skipped, failed, held | none |
| Follow-up level | values `approve`, `send_unless_stopped`, `sends_by_itself`, `off`; labels "Approve", "Sends unless stopped", "Sends by itself", "Off" | P3's prose says "Send unless stopped"; use the label |
| Unconfirmed template | `provider_status='enrolled'` (`index.ts:1257`); no new message state | P3 cites 1252 |

### 1.4 Settings and switches (one home for each value)

**`rooms`** (F; the single home for room timers and the test calendar)

```json
{"enabled": false, "test_only": true, "test_contacts": ["VjPfR4Cc1Y0OFvaqeor5"], "test_calendar_id": null,
 "providers": {"zoom": false, "meet": false}, "default_provider": {"setter": "meet", "closer": "zoom"},
 "send": {"whatsapp_text": false, "whatsapp_template": false, "email": false},
 "template_route": "call_link", "count_on_join": false, "short_link": false,
 "waits_s": {"ready": 15, "fail": 60, "meet_pending": 30, "manual_buttons": 30, "handover_host": 120,
   "standby_host": 300, "fallback_host": 900, "lead": 600, "open_grace": 180, "not_lead_undo": 300,
   "event_replay": 20, "settle": 1200, "no_end_signal": 1800, "standby_max": 2100, "booked_guard": 600,
   "unconfirmed": 20},
 "lengths_min": {"intro": 30, "demo": 60}, "booking_min": {"intro": 15, "demo": 45}, "available_hours": 2,
 "fallback": {"scope": "intro", "auto_on_miss": false, "pilot_emails": [], "ended_page_whatsapp": null}}
```

Removed or renamed:
- `rooms.wa_connector_off` moves to `whatsapp_guard`.
- P1's `fallback.book_on_join` becomes `count_on_join`.
- P1's `fallback.test_calendar_id` becomes `rooms.test_calendar_id`.
- P1's `fallback.whatsapp_number` becomes `ended_page_whatsapp`.

**`live`** (F plus P2)

```json
{"enabled": false, "slack": false, "closer_wait_s": 120,
 "kinds": {"demo": false, "intro": false},
 "entries": {"dialer": true, "lead_page": false, "inbox": false, "followup": false}, "standby": true,
 "hours": {"days": [6,0,1,2,3,4], "from": "10:00", "to": "20:00", "tz": "Asia/Kuwait"}}
```

Removed from P2:
- `standby_host_s`, `standby_max_min` and `before_booked_min` now live in `rooms.waits_s`.
- `calendars.demo`: the code reads `BOOKING_CALENDARS.demo` (`dialer.ts:770-774`).
- `calendars.test` becomes `rooms.test_calendar_id`.
- `book_untagged` goes: untagged contacts are never booked, and there is no switch.

**`threads`** (P4) changes:
- `per_tick` is **2**, not 4.
- `test_calendar` is dropped; read `rooms.test_calendar_id`.
- `templates.link` is dropped; read `rooms.template_route`.

**`followups`** (the live setting plus P3)
- **Hours:** keep `quiet {from 21, to 9}` for later steps and agent replies. Add `first_hours [9, 18]`. Drop P3's `send_hours`.
- **Cadence:** `cancelled` stays **[0.5, 48, 120]**. Add `good_intro [24, 72, 168, 336]` and `after_call [24, 72, 168, 336, 504, 720]`.
- **Waves:** `waves {"per_day": 40, "holdout_share": 0.1, "batch_gap_s": 45, "salt": "waves"}`.
- **Nurture:** keep `nurture_per_day 20` and `nurture_every_days 7`. Add `untagged_every_days 14`.
- **Kept from P3:** `graduation`, `reply_alerts {"manager_min":10,"reassign_min":15,"agent_min":30}` and `stop_pause_days 30`.
- **Removed:**
  - `wa_connector_off` and `template_budget_usd_month` move to `whatsapp_guard`.
  - `watchdog_stale_min` moves to the watchdog table in 1.7.
  - `autosend` is replaced by `followup_levels`.

**`whatsapp_guard`** (exists; becomes the single WhatsApp safety home)
- Add `connector_off: false`, `single_copy_ok_at: null`, `dup_window_s: 60` and `template_budget_usd_month: 100`.
- Add `health {"room": {"window": 20, "fail_share": 0.3}, "thread": {...}, "followup": {...}}`.
- Every WhatsApp switch refuses to turn on while `connector_off` is false or `single_copy_ok_at` is null. That covers `rooms.send.*`, `threads.send.*` and template levels in `followup_levels`.

**`wa_fields`** (exists)
- Add `join` → `contact.cockpit_join_code` (F, P1, P4).
- Add `when` → `contact.cockpit_call_time`. P4 calls it `cockpit_demo_time`; use `call_time` to match the variable.

**`TEMPLATE_VARIABLES`** (`lib.ts:661`)
- Add `call_time` only.
- `join_code` is a **button** variable. Its route row gets `button_variable='join_code'`; it does not go in `TEMPLATE_VARIABLES`.

**Template keys** (rows in `cockpit_sales_wa_templates`)
- `call_link_en/ar`, `opener_en/ar`, `line_en/ar` (these exist but are inactive) and `demo_host_en/ar`.
- No `join_call_*`.

**Kill switches:** `rooms.enabled`, `live.enabled`, `threads.enabled`, `followups.enabled` and `messaging.whatsapp` (global, exists).

### 1.5 Actions (sales-api)

| Registry | Actions | Deviations |
|---|---|---|
| `ACTIONS` (seat, `index.ts:5011`) | `room.create`, `room.open`, `room.wrap`, `room.mark` {what: host_in, lead_in, not_lead}, `room.end` {reason: end, on_phone, finished, cancel} | P4 used room.create purpose=booked instead of room.wrap. P2 used live.mark_in and live.not_lead. F and P1 never named the mark or end action |
| `ACTIONS` | `live.availability` {state}, `live.ask`, `live.take`, `live.decline`, `live.cancel`, `live.status` (the strip's single poll for presence, offers and open rooms) | `live.availability` is named here; neither F nor P2 named it |
| `ACTIONS` | `thread.start`, `thread.send`, `thread.skip`, `thread.close`, `thread.stop_review` | none |
| `ACTIONS` | `followup.level`, `followup.wave`, `followup.batch`, `followup.hold`, `followup.stop_task` (manager ones call `needManager`) | P3 says only "followup.*"; names set here |
| `DESK_ACTIONS` (service key, `5076`) | existing four, plus `room.event`, `room.settle`, `live.press`, `thread.tick`, `reply.seen` | |
| `CRON_ACTIONS` (`5085`) | `contract.sync`, `room.event`, `live.press`, `thread.tick`, `reply.seen` | P1's room.joined, P2's live.event and P3's health.watch are retired |
| SQL (service role only) | `cockpit_sales_live_claim`, `cockpit_sales_rooms_sweep()`, `cockpit_sales_watchdog()` | F's `cockpit_sales_rooms_watchdog` is renamed, because it watches every worker |

Desk handlers run as `sales-desk` (`5141`). `room.event`, `live.press` and `room.settle` must build the host seat's `Who` before they mark or send. `refuseMark` checks the HighLevel user (`lib.ts:63-67`), and the sender ceiling counts by `sent_by` (`1052-1058`).

### 1.6 Edge Functions, site and secrets

- **`sales-api`:** verify_jwt on; v58 is live.
- **`sales-mirror`:** unchanged.
- **`sales-live`** (new, verify_jwt off). Routes:
  - `POST /zoom`, `POST /slack`;
  - `GET /open/{code}` (the counted open);
  - `GET /go/{code}` (the noscript 302 only);
  - **`POST /cron`** (new; see C9);
  - `POST /reply` (P3 phase 3);
  - `POST /meta` (P4 route A, later).
- **Secrets on `sales-live`:**
  - `ZOOM_WEBHOOK_SECRET`, `SLACK_SIGNING_SECRET`, `IP_SALT`, `CRON_SECRET`;
  - `REPLY_SECRET` (name set here);
  - `META_APP_SECRET` (later).
  - When it forwards to `sales-api`, it sends the project key plus `x-cron-secret`, as `sales-mirror/index.ts:567-574` does.
- **Short link site:** `sites/call-link/` (the repo's `sites/webinar/` pattern), served on `call.maharamedia.com`. P1 deviates with `apps/call-link`.

### 1.7 Cron jobs, services and status rows

**pg_cron**
- `mahara-sales-mirror */3` (exists).
- `mahara-sales-rooms-sweep * * * * *` (SQL; replays events through `sales-live/cron`).
- `mahara-sales-watchdog */5` (SQL; posts with pg_net to the vault webhook).
- `mahara-sales-threads */2` (through `sales-live/cron` to `thread.tick`).

**VPS services**
- systemd `sales-desk-rooms` (rooms and Slack posts; polls every 1 s).
- systemd `sales-desk-watch` (P3 phase 3; name set here).
- Each has a `flock -n` restart line in the format of `hermes/sales-desk/README.md:332-334`.

**VPS cron**
- `followups` at :07 and :37. This comes from P3 and from today's 13:07:19 status row. The README block lists only requests, recordings and maqsam-calls, so the crontab itself is UNVERIFIED here.
- `doctor` hourly.
- Room host check every 10 minutes.

**Status rows and alert thresholds.** The watchdog alerts once per incident, Saturday to Thursday, 09:00 to 21:00 Kuwait time.

| Status row (worker, job) | Alert after |
|---|---|
| (sales-desk, rooms) | health line red at 90 s; alert at 10 min |
| (sales-desk, slack) | 10 min |
| (sales-desk, watch) | 10 min |
| (sales-desk, followups) | 75 min |
| (sales-desk, doctor) | 75 min |
| (sales-api, threads) | 10 min |
| (sales-api, sweep) | 5 min |

### 1.8 Slack

- **App:** "Mahara Sales".
- **URL** for interactivity, commands and events: `https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-live/slack`.
- **Commands:** `/available` and **`/unavailable`**. F uses `/away`; reports say Slack has a built-in `/away` (UNVERIFIED).
- **Scopes:** `chat:write`, `commands`, `im:write`, `users:read`, `users:read.email`, plus **`incoming-webhook`** (missing from P2's list).
- **Event:** `app_home_opened`.
- **Token:** `SLACK_SALES_BOT_TOKEN`, on the VPS only.
- **Copy:** P2's Slack table replaces F's for every message.

### 1.9 Wait times and timings

| Name | Value | Deviations |
|---|---|---|
| ready | the browser polls every 500 ms for up to 15 s | none |
| fail | 60 s: requested → failed; creating → recover or fail | none |
| meet_pending | 30 s | none |
| manual_buttons | 30 s with no Zoom event | none |
| handover_host | 120 s from claim to host in the room | none |
| standby_host | 300 s | P2 had it under `live`; F had no value |
| fallback_host | 900 s (also used for `manual` rooms) | for fallback rooms it never fires, because lead (600) ends first |
| lead | 600 s after `link_sent_at` | none |
| open_grace | an open in the last 3 minutes extends to open + 180 s | missing in F |
| not_lead_undo | 300 s | none |
| event_replay | 20 s | none |
| settle | start + 1,200 s writes a no-show on an expired booked intro | P1 only |
| no_end_signal | at `ends_at` + 1,800 s a `lead_in` room becomes `ended` ("No end signal"); the panel asks "Still on the call?" at `ends_at` | P1: the prompt at +30 and Meet closing at lead_in + 2 h |
| standby_max | 2,100 s, then a fresh standby room | none |
| booked_guard | an empty standby room ends 600 s before a booked call | none |
| booked rooms | `host_by` = start + 15 min, `lead_by` = start + 20 min, `ends_at` = appointment end | P4: +10, +15 and +45 |
| ends_at (other rooms) | room start + `lengths_min` (intro 30, demo 60) | none |
| live booking length | `booking_min`: intro 15, demo 45 | specs hard-code it |
| offer | `live.closer_wait_s` 120 s; 1 miss sets Away; "Not now" does not | F sets every offered closer Away |
| available | 2 h | none |
| strip poll | 4 s; 30 s when Away | none |
| Slack offer | posted at most 3 s after `live.ask` | F: 1 s; P2: 5 s, with a test target under 2 s |
| room template unconfirmed | 20 s, then email | the code reads back for only 12 s (`1243`) |
| thread template unconfirmed | email at the same tick for intro and link steps | none |
| follow-up template unconfirmed | 30 min, then email | none |
| duplicate detector | 2 identical outbound messages within 60 s | none |
| reply alerts | T+0 owner, T+4 draft ready, T+10 manager, T+15 reassign, T+30 agent may send | P4 says "agent drafts after 30 minutes" |
| template gap | 120 s per contact | P1 implies a global gap |
| templates per day | 250 across all sources | none |
| sender ceiling | 30 per 10 minutes per `sent_by` | none |
| P4 timings | notice 30 min; intro +5 min; check 18:00 the evening before; link −15 min; template link −2 min; late +5 min; close +2 days; mark task start + 2 h | none |
| P3 timings | draft 48 h; send-at 30 min; stuck sending 30 min; set aside 24 h after 2 failures; stop pause 30 days; wave member 14 days | none |

### 1.10 Hours (on the lead's clock unless stated)

| What | Hours |
|---|---|
| Handovers | Saturday to Thursday, 10:00 to 20:00 Kuwait time (`live.hours`) |
| Fallback room after a missed dial | no extra rule; it follows the setter's own call |
| First follow-up message | 09:00 to 18:00 (`followups.first_hours`) |
| Later steps and agent replies | 09:00 to 21:00 (`followups.quiet`; `index.ts:1844-1848`) |
| A person's reply | any time |
| Demo chat | 09:00 to 21:00; link and late steps go at their set time |
| Days off | Friday for follow-ups (`followups.py:1217-1220`) and handovers |
| Time zones | UAE and Oman UTC+4 (`PLUS_FOUR`, `followups.py:105`); all others UTC+3 |

---

## 2. Remaining contradictions and gaps, each with its fix

### Names and contract

**C1. The booking claim has three sets of column names.**
- **Conflict:** F uses `count_claimed_at`, `count_appointment_id` and `count_result`. P1 uses `book_claimed_at` and `live_appointment_id`. P2 uses `book_claimed_at` and puts the booking in `appointment_id`.
- **Fix:** use F's three columns. `appointment_id` means only "the booked call this room wraps".

**C2. Inbound action names differ.**
- **Conflict:** F uses `room.event` and `live.press`. P1 uses `room.joined`. P2 routes both Zoom and Slack to `live.event`.
- **Fix:**
  - `room.event` carries Zoom events, worker signals and sweep replays. "Joined" becomes an internal branch of it.
  - `live.press` carries Slack.
  - `room.settle` stays desk-only, because the worker holds the service key.
  - The final `CRON_ACTIONS` set is in 1.5.

**C3. Manual marks are unnamed in F and P1 and split in P2.** Fix: one action, `room.mark {room_id, version, what}`.

**C4. Wrapping a booked call has two names.**
- **Conflict:** F uses `room.wrap`. P4 calls `room.create` with purpose=booked.
- **Fix:** `room.wrap {appointment_id}`.

**C5. P4's refusal case cannot happen.**
- **Conflict:** P4 says a link is refused "because the closer still hosts a live room". F's `rooms_one_per_host` exempts booked rooms.
- **Fix:** delete P4's case. The only refusal left is `rooms_one_per_lead`, and then the message carries the raw HighLevel `address`.

**C6. P1's queue hold uses `ready_by`, which does not exist.** Fix: `roomHolds` keeps a lead out when the room is not final and `coalesce(lead_by, host_by, requested_at + waits_s.fail)` is after now.

**C7. Setting keys overlap.** Fix: apply 1.4 exactly.
- Four keys name one test calendar: `rooms.test_calendar_id`, `rooms.fallback.test_calendar_id`, `live.calendars.test` and `threads.test_calendar`.
- Two switches control one behaviour: `count_on_join` and `fallback.book_on_join`.
- Three gates cover one fact: `rooms.wa_connector_off`, `followups.wa_connector_off` and P1's `single_copy_ok` row.
- The standby timers are duplicated in `rooms` and `live`.
- P3's `send_hours` duplicates the live `followups.quiet`.
- P3's levels duplicate the live `followups.autosend`.
- `live.book_untagged` contradicts F's rule.

**C8. Migration numbering does not match.**
- **Conflict:** F says P3 is `20261003c` and P4 is `20261003d`. P3 says `20261003f`.
- **Fix:**
  - `20261003a_sales_rooms.sql` (F, P1, P2);
  - `20261003b_sales_hooks.sql` (messages source check, follow-ups segment check);
  - `20261003c_sales_followup_agent.sql`;
  - `20261003d_sales_threads.sql`.
  - Re-list the folder on origin/main the day each one lands; the parallel session uses letters too.

### Doors and security

**C9. pg_cron cannot call sales-api directly.**
- **Conflict:** P4 (`thread.tick`) and P3 (`health.watch`) call `sales-api` from pg_cron. The gateway needs a project key (`index.ts:5111`), and the vault has none.
- **Fix:** pg_cron posts to `sales-live/cron` with `x-cron-secret` from vault `cockpit_sync_secret`. `sales-live` checks it against `CRON_SECRET` and forwards only an allow-list (`thread.tick` and `room.event` replays) to `sales-api` with its project key plus `x-cron-secret`. That both names are the same value is implied by `index.ts:5129-5131` (UNVERIFIED).

**C10. P1 and P2 list too few `sales-live` secrets.**
- **Conflict:** P1 says `sales-live` holds "only ZOOM_WEBHOOK_SECRET and IP_SALT". P2 leaves out `CRON_SECRET`.
- **Fix:** use the list in 1.6. Without `CRON_SECRET`, H1 is not fixed.

**C11. There are two watchdogs.**
- **Conflict:** F has a SQL function that posts to the CEO's DM through a vault webhook. P3 has the `health.watch` action, a webhook kept in function secrets and the channel #sales-alerts.
- **Fix:** one SQL `cockpit_sales_watchdog()` every 5 minutes, using the 1.7 thresholds and deduping in `alerts`. It posts to one incoming webhook for #sales-alerts, stored in the **vault** as `sales_alerts_slack_webhook`, because SQL cannot read function secrets. Drop `health.watch` and P3's "exception to F's rule".

**C12. Secrets are handled two ways.**
- **Conflict:** P2 has the CEO paste the Slack Signing Secret into function secrets. F has the CEO write to `/opt/data/bibi/api-keys.env`.
- **Fix:** the CEO writes only to `api-keys.env`. The build copies verifier secrets into function secrets without printing them.

**C13. There are three Google models.**
- **Conflict:** F uses per-rep tokens. P1 uses a "Sales rooms" calendar through "F's VPS token". P2 uses "the foundation's CEO calendar first".
- **Fix:** use per-rep `calendar.events` tokens, so each rep is the organiser and can admit a knock. Drop P1's "Sales rooms" step and P2's decision B. The CEO's existing token serves only the phase-0 live test, where the CEO hosts.

### Rooms and handovers

**C14. Booked-room deadlines differ.** F uses start + 15. P4 uses host +10, lead +15 and ends at +45. Fix: use the 1.9 row. The short link stays valid until `ends_at`, and the worker never ends a wrapped meeting.

**C15. The end of a `lead_in` room differs.** F ends it at `ends_at` + 30. P1 prompts, and closes Meet rooms 2 h after `lead_in`. Fix: use the 1.9 `no_end_signal` row for both providers. Make no provider call for any room that reached `lead_in`.

**C16. P2 ends a P1 room that may have the lead in it.**
- **Conflict:** P2 says "for a demo, the P1 room ends" when a handover starts. F (H7) never ends a room with a lead in it.
- **Fix:** if the P1 room is `lead_in`, the taker gets that room's join link in the strip. No new link goes to the lead and the room is not replaced. `replaced_by` applies only to rooms with no lead in them.

**C17. Offer expiry differs.** F sets every offered closer to Away. P2 spares closers who pressed "Not now". Fix: use P2's rule (1 miss).

**C18. Slack latency targets differ** (1 s, 5 s, and under 2 s in a test). Fix: the worker polls every 1 s, with Slack at most 3 s after `live.ask` and the strip at most 4 s.

**C19. The Zoom create body is missing settings in F and P1.** Fix: add `join_before_host:false`. Subscribe with the full event names:
- `meeting.started`, `meeting.ended`;
- `meeting.participant_joined`, `meeting.participant_left`;
- `meeting.participant_joined_waiting_room`;
- `meeting.participant_jbh_waiting`, `meeting.participant_jbh_joined`.

These names come from Zoom's webhook reference and were not re-checked in this pass.

**C20. Who sends the link is unclear.**
- **Gap:** with `send_on=open`, if the browser's 15 s poll ends, no one sends the link.
- **Fix:** after it saves `join_url`, the worker calls `room.event {kind: worker.ready}`. That handler sends the link once, keyed on the room id.

**C21. P2's automatic save has no outcome value.**
- **Conflict:** P2 calls `saveOutcome` (`index.ts:2921`) at join; F's `countLive` does not.
- **Fix:** `countLive` stays booking-only. The setter's phone attempt is saved by the setter's normal dialer step. Remove P2's automatic `saveOutcome`.

**C22. The short link works differently in each spec.**
- **Conflict:** P1 and P2 describe `/go/{code}` as a 302 that logs the open. F counts opens through a script that calls `/open/{code}` (bots run no script), and keeps `/go` for noscript only.
- **Fix:** use F's model. The P1 and P2 open rates hold only with it. The site path is `sites/call-link/`.

**C23. The CNAME timing differs.**
- **Conflict:** F gates handovers on the CNAME and says handovers require the short link. P2 runs handovers in phase 3 and adds the CNAME in phase 5.
- **Fix:** the CEO adds the CNAME on F build day 5, when Vercel shows the value. P2 phase 3 is gated on it.

### WhatsApp and messages

**C24. `call_link` has three texts.**
- **Fix:** one body for every spec: "Hi {{1}}, your call with {{2}} from Mahara Media is ready now. Tap the button below to join." The button is "Join the call", pointing to `https://call.maharamedia.com/{{1}}` (`join_code`).
- **Fallback body**, if a URL button cannot be filled from a contact field (UNVERIFIED day-1 test): "Hi {{1}}, your call with {{2}} from Mahara Media is ready. Join here: {{3}} See you there." P1's "open for 10 minutes" is wrong for booked demos.

**C25. Button variables have no plumbing.**
- **Gap:** P4's hook adds `join_code` to `TEMPLATE_VARIABLES`, but `renderTemplate` fills body positions only (`lib.ts:686`), and `sendTemplate` writes only the line and rep fields (`index.ts:1229-1232`).
- **Fix:** add `button_variable` to the route row. `sendTemplate` writes `cockpit_join_code` when it is set. Add only `call_time` to `TEMPLATE_VARIABLES`.

**C26. Messages need one more source value.**
- **Conflict:** F sends room links as `source='rep'` to avoid a constraint change. P4 changes the constraint anyway, and per-source health cannot tell room sends from rep sends.
- **Fix:** `cockpit_sales_messages_source_check` in ('rep','followup','thread','room'), in `20261003b`.

**C27. Room WhatsApp health is measured two ways.**
- **Conflict:** F uses its own "30% of the last 20" rule. P1 uses per-source `whatsappHealth`.
- **Fix:** use `whatsappHealth({source})` (`index.ts:1029`) with per-source windows from `whatsapp_guard.health`. Rooms use `source='room'`, a window of 20 and 0.3.

**C28. Nobody clearly owns the duplicate detector.**
- **Conflict:** F says it owns it, P1 says P4 does, and P4 says it is shared.
- **Fix:** F builds it in the hooks commit. Two identical outbound messages within 60 s pause WhatsApp for every source.

**C29. The read-back windows conflict with the code.**
- **Conflict:** the code reads back for 12 s (`1243`), F needs 20 s, and `whatsappSentSince` matches any outbound message, so a WA Connector copy counts as success.
- **Fix:** match the rendered text, and pass the window as a parameter: rooms 20 s, others 12 s. Then apply the per-source fallbacks in 1.9.

**C30. The desk's send ceiling is oversubscribed.**
- **Conflict:** P3 waves at 30 s gaps send 20 per 10 minutes, and P4 at 4 per 2-minute tick sends 20. That is 40 against the 30-per-10-minutes desk ceiling (`1052-1058`, identity `sales-desk`). Room sends triggered through `room.event` would also land on the desk.
- **Fix:**
  - waves `batch_gap_s` 45 (13 per 10 minutes);
  - threads `per_tick` 2 (10 per 10 minutes);
  - autosend at most 5 per 10 minutes;
  - room sends act as the host's seat.
  - Also state that wave sends do not count toward `followups.per_day` 60.

**C31. One budget, one test contact.**
- **Gap:** P3's $100 budget covers only follow-ups, but every source spends from the same wallet. Fix: `whatsapp_guard.template_budget_usd_month`, with spend shown by source.
- **Gap:** three specs define the second test contact. Fix: define it once: the CEO's phone, a staff email, and the tag `cockpit-test` only.

**C32. Reply timing differs.**
- **Conflict:** P4 says "the agent drafts after 30 minutes". P3 has the draft ready at T+4.
- **Fix:** use P3's timeline everywhere. In an open demo chat the draft goes to the chat's closer, and it sends by itself at T+30 only at the "Sends by itself" level.

**C33. P3's cancelled cadence does not match the live setting.** P3 says 0 h; the setting says 0.5 h. Fix: keep 0.5 h.

### Numbers and tests

**C34. The test contact cannot test a booking.**
- **Conflict:** `VjPfR4Cc1Y0OFvaqeor5` has no roas tag, so `countLive` returns `not_a_lead`. F and P2's live tests expect a "Live ·" booking. P3 requires that test contacts carry no roas tag.
- **Fix:** contacts in `rooms.test_contacts`, or tagged `cockpit-test`, are booked only on `rooms.test_calendar_id`, whatever their tags, and never on a B2B calendar. If `test_calendar_id` is null, nothing is booked.

**C35. The do-not-disturb tests clash.**
- **Conflict:** P3's refusal test and P4 Test A need do-not-disturb on. P1 and P4 Test B lift email do-not-disturb. The mirror shows `dnd=true` with no phone; if that is the contact-level flag, `dndFor` blocks every channel (`lib.ts:428-429`).
- **Fix:** one ordered protocol, all with the CEO's approval:
  1. Run the refusal tests first (P3 3.1 step 2, P4 Test A).
  2. The CEO lifts email do-not-disturb for one hour.
  3. Run the P1 and P4 email tests.
  4. The CEO restores do-not-disturb.
  5. Run WhatsApp tests only on the second contact.

**C36. P3 and P4 holdouts would overlap.**
- **Conflict:** both hash `contact_id`. P4 takes the first 4 hex characters of sha256. P3's hash is unspecified and would likely nest inside P4's.
- **Fix:** salt each hash: `sha256('waves:'||contact_id)` for P3 and `sha256('threads:'||contact_id)` for P4.

**C37. P2 and P3 measure intro to demo differently.** P2 uses a held demo within 24 h (target 60%; baseline about half, 35 shown and 17 demos). P3 uses a demo within 14 days (50.5% → 65%). Fix: keep both as `sales.intro_to_demo.held_24h` (P2) and `.booked_14d` (P3), over one denominator: shown by the B2B rule and not `invalid`.

**C38. September's intro show rate has two denominators.** The brief says 54%; P1 says "35 of 68 is 51%". 35 of 65 is 53.8%, so 54% reproduces with 65 intros. Fix: the scorecard states its denominator. That the 3-row gap is cancellations is UNVERIFIED.

**C39. P3's baseline table repeats a value.** "Never booked → booked" repeats 3.6%. Fix: recompute it in P3 phase 0 before any target is shown.

**C40. P1's live version is out of date.** Fix: the live version check uses today's v58. Every deploy re-reads it first.

### Screens

**C41. Four specs want the same banner slot.** F, P1, P2 and P3 all put something in `App.tsx:247`, which shows `portalBanner` today. Fix: one `SalesBanner.tsx` showing, in order:
1. an offer;
2. the rep's own room;
3. the setter's handover;
4. a reply alert;
5. the portal banner.

This is the single `App.tsx` line.

**C42. Two specs add buttons to the same header.** P1's "Send a video link" and P2's "Live call" both go in `LeadPage.tsx:251-283`. Fix: one "Video call" menu: "Send a video link", "Demo now with a closer", "Intro now with me".

**C43. Copy and build-day details disagree.**
- F's Slack copy and setter "nobody" line should be replaced by P2's.
- F's generic lead messages apply only to `manual` rooms. P1 owns fallback copy, P2 handover copy and P4 booked-demo copy.
- Every lead message says "Mahara Media"; F, P2 and P4 sometimes say "Mahara".
- P1 and P2 count F as 6 build days; F is **7**.

---

## 3. One combined build order

**Day 0: the CEO, before build day 1** (about 3 hours in total). Items 2, 3, 4 and 7 have the longest waits.
1. Sign Claude in on the VPS.
2. Switch off the WA Connector.
3. Submit `call_link_*`, `opener_*`, `line_*` and `demo_host_*`, each with a one-step workflow with Allow re-entry. Meta's review time is UNVERIFIED.
4. Request the Official Business Account and start Meta business verification.
5. Top up the wallet with $100.
6. Create the HighLevel test calendar "Cockpit test (not counted)" and the second test contact.
7. Settle decision D1, the Zoom licence.
8. Set up the Google Internal consent screen and web OAuth client.
9. Invite the setter and the closer to Slack.
10. Read the two intro calendar names.

**Single order with one builder: 50 build days**

| Build days | Work | Depends on |
|---|---|---|
| 1 | Hooks commit for all five specs (list below) plus `20261003a` and `20261003b`; every new module ships as an empty export with its switch off; deploy sales-api | parallel-session hand-off |
| 2 to 4 | P3 phase 0: desk fault fixes (`followups.py:526-529`, `1339`, `597-599`), B2B rule, stop rule, `--contact`, hourly doctor, the single SQL watchdog with `alerts`, baselines | G0 starts (24 h with doctor OK) |
| 5 to 7 | P3 phase 1: `reactivate`, waves (salted holdout), pacing, connector gate, per-source health, HighLevel notes, `followup_levels`; deploy; single-copy test | G1: templates approved, single-copy test passed, wallet at least $50 |
| 8 to 14 | F days 2 to 7: worker and systemd, `api/rooms.ts`, `countLive`, `sales-live`, `sites/call-link`, sweep, strip, panel, live test. The CEO adds the CNAME and the Zoom subscription on F day 5 | Google consent, test calendar |
| 15 to 22 | P4: day-1 checks, `20261003d`, planner, tick, link via `room.wrap`, screens, live tests | F's `room.wrap` |
| 23 to 26 | P1 | F |
| 27 to 33 | P2 | F, Slack app, decision D1 |
| 34 to 38 | P3 phase 2 (`good_intro`, 30-day `after_call`, `signAs`) | P3 phase 1 |
| 39 to 44 | P3 phase 3 (`watch`, `reply_waits`, push, reply door, `call_now`) | F and P2 |
| 45 to 47 | P3 phase 5 (email nurture) | none |
| 48 to 51 | P3 phase 4 (levels go live, drop-back) | G3 calendar time |

**With a second lane of our own: 29 build days**

| Days | Lane 1 (rooms) | Lane 2 (messages) |
|---|---|---|
| 1 to 7 | hooks commit, then F | P3 phases 0 and 1 (lane 2 needs the hooks deploy by day 3) |
| 8 to 14 | P1 days 1 to 4, P2 days 1 to 3 | P4 |
| 15 to 21 | P2 days 4 to 7, P3 phase 5 | P3 phase 2, P3 phase 3 days 1 to 2 |
| 22 to 29 | fixes and the rollout gates | P3 phase 3 days 3 to 6, P3 phase 4 |

**Calendar gates (not build days)**
- G0: 24 h.
- G1: Meta approval.
- P1 pilot: 1 week at 80% cockpit dialing.
- P2 phase 3: 1 week at 80% cockpit dialing.
- P3 G2: 2 weeks.
- P3 G3: 30 days.
- P4 decision: at 120 demos, which is 2 months at 60 a month or 7 months at 17 a month.

**The hooks commit (the only edits to shared files)**
- **`index.ts`:**
  - module spreads into `ACTIONS` (5011);
  - the five desk names in `DESK_ACTIONS` (5076) and `CRON_ACTIONS` (5085);
  - `quiet` on `markAppointment` (opts at 304, passed to `writeMarkToCrm` `notify` at 263);
  - `{source, signAs, buttonVariable, readBackMs}` on `convoSend` (873) and `sendTemplate` (1141);
  - the text read-back in `whatsappSentSince` (1099);
  - `whatsappHealth({source})` (1029);
  - the duplicate detector;
  - one `roomHolds` line in `candidates()` (2401).
- **`lib.ts`:** `FOLLOWUP_SEGMENTS` + `good_intro` and `reactivate` (657); `TEMPLATE_VARIABLES` + `call_time` (661).
- **`followups.py`:** `SEGMENTS` (73), `GOAL` (149), `ANGLES` (162).
- **`FollowupsPage.tsx`:** the `SEGMENT` map (119).
- **`App.tsx`:** line 247 renders `<SalesBanner/>`.
- **Migration `20261003b`:** both check constraints.

**What runs in parallel with the other session**
- **Safe at any time** (new files only):
  - migrations `a`, `c` and `d`;
  - `api/roomlogic.ts`, `rooms.ts`, `live.ts`, `liveio.ts`, `threads.ts`, `threadplan.ts`, `followupAgent.ts` and their tests;
  - `supabase/functions/sales-live/*` and `sites/call-link/*`;
  - `desk/rooms.py`, `desk/watch.py`, `tests/test_rooms.py`, `test_waves.py`, `test_watch.py`;
  - `AvailabilityStrip.tsx`, `RoomPanel.tsx`, `LiveStartSheet.tsx`, `LiveStrip.tsx`, `SalesBanner.tsx`, `pages/LivePage.tsx`;
  - the systemd unit files.
- **Needs a hand-off window** (shared files): `index.ts`, `lib.ts`, `dialer.ts`, `App.tsx`, `DialerPage.tsx`, `LeadPage.tsx`, `FollowupsPage.tsx`, `TeamSeat.tsx`, `WhatsAppLibrary.tsx`, `src/dev/harness.tsx`, `followups.py`, the README runbook and `scripts/ship.sh`.
- **Every sales-api deploy:**
  - run from a fresh worktree rebased on the latest origin/main;
  - read the live version first (v58 today);
  - tell the other session before you deploy;
  - deploy with `--verify-jwt`;
  - confirm the version went up by exactly one;
  - never move HEAD in the shared checkout.

---

## 4. Decisions for the CEO (merged, duplicates removed)

| # | Decision | Recommended answer | Why |
|---|---|---|---|
| D1 | The closer's room | One paid Zoom licence for the closer now (price UNVERIFIED) | Basic ends at 40 minutes and demos run 45. Booked demos may already run on that seat (check on day 1). Zoom gives automatic join signals; Meet gives none |
| D2 | Counting live calls | Book and mark shown, quietly, the minute a tagged lead joins. Nothing if they never join. Untagged contacts are never booked. "That was not the lead" deletes the booking. Test contacts are booked on the test calendar only | Live calls then count in the $60 and 25% gates on evidence. B2B counts `invalid` as shown, so the undo must delete. The test exception is the only way to test (C34) |
| D3 | WhatsApp group route | Route C (one chat on the official line) now. Request the OBA now. Reject route B. Try route A as a third arm on 20 demos only after: the OBA is granted, the number runs on Cloud API without the Business app, and no Multi-solution conflict | Keeps the official-line rule and the HighLevel thread, shows no staff numbers, and avoids ban risk |
| D4 | Demo chat lifetime | Close at the first of: 2 days after the demo, won or lost, or the `client` tag | Matches the CEO's "set amount of time" |
| D5 | Waits | 120 s to take; 120 s into the room; 600 s for the lead; 300 s for a standby host; 2 h available; 1 miss sets Away | Short enough to keep the lead on the phone; one shared set of values (1.9) |
| D6 | Meet REST permission | Later | Calendar-made Meet works today. Unmarked Meet joins show as "not known", never 0 |
| D7 | Google | Per-rep `calendar.events` tokens on the VPS. Internal consent screen on project 824095651303. No delegation. The CEO's calendar only for the phase-0 test. Confirm the setter has a maharamedia.com account (UNVERIFIED) | The organiser admits the knock. This replaces P2's "CEO calendar first" |
| D8 | Where rooms are made | On the VPS | The keys stay there, and `ZoomApp` exists (`hermes/webinar-pull/pull.py:315-345`) |
| D9 | Lead's email as a Meet guest | No | No Google invite emails (`sendUpdates=none`). The short link is the only way in |
| D10 | Providers | Meet by default for the setter, Zoom by default for the closer, both offered | The CEO said "add both". The setter's Zoom seat is still pending |
| D11 | Hours | Handovers Saturday to Thursday, 10:00 to 20:00 Kuwait time. First follow-up 09:00 to 18:00, later steps 09:00 to 21:00, lead's time. Friday off | One hours table (1.10) |
| D12 | Standby room on Available | Yes | The CEO's own description of the flow |
| D13 | Automatic fallback | Yes, after the 1-week pilot with no link sent to a lead who is on the phone | Removes a press at the moment the setter is busiest |
| D14 | Expired booked intro | Becomes a no-show at start + 20 minutes | Otherwise a missed intro stays "confirmed" and counts as shown |
| D15 | Ended-page button | The official WhatsApp line's number | Keeps the official-line rule |
| D16 | Test contacts | A second contact on the CEO's phone, tag `cockpit-test` only. Use the do-not-disturb protocol in C35 | No real lead is ever messaged |
| D17 | Graduation ceiling | Every kind may reach "Sends by itself", after 40 decided drafts (80 for demo-stage kinds) | The CEO's words, with a stricter bar where a lead is worth more |
| D18 | Template budget | $100 a month across all sources. Accept a template that Meta files as marketing (at most $0.0792 a send in Kuwait) and ask for a review | Openers to 1,153 leads cost about $67 at the brief's rates (UNVERIFIED). One wallet serves every source |
| D19 | Backup model | An Anthropic API key, through `model.py`'s supported path | The sign-in has been lapsed for 6 days. Lead data stays on frontier models only |
| D20 | Slack | Invite the setter and the closer now; build web push as well | Handover offers need Slack. P3's "Slack later" no longer holds |
| D21 | Stop requests | Do-not-disturb only on an explicit unsubscribe a rep confirms. Other stop words pause the agent for 30 days, or hold the demo chat for the closer | "Not interested" is not a legal stop. Avoids silencing leads by mistake |
| D22 | Alert route | One incoming webhook to #sales-alerts, stored in the vault and used by the SQL watchdog | SQL can read the vault but not function secrets. One route for every worker |
| D23 | Demo chat test | 80/20, decided at 120 demos as a harm check. The setter may start a chat for a comparison-group lead; that demo still counts as comparison and is shown | The test can only detect about a 29-point difference |
| D24 | Work SIMs | Decide only if route A is tried | Route A shows staff numbers |
| D25 | Show-rate tiles | Keep "Live ·" calls out of the 60% and 75% targets, on their own line. The scorecard names its denominator | B2B counts live calls as shown, which would make the targets meaningless |
| D26 | Lead flow | Restart the ads (outside this build) | New leads fell from 65 to 0 a week. None of these projects create leads |
| D27 | Intro calendar labels | Confirm `dsqmJ393Dwl9fDSbIVOI` = qualified and `cFeDl0FY8iaXll61lus8` = unqualified, as the cockpit setting says | The live intro booking picks a calendar by tag |

---

## 5. Merged risk register (top 12)

| # | Risk | Owner | Mitigation |
|---|---|---|---|
| 1 | No volume: new leads 65 → 0 a week, 0 upcoming calls, 12 cockpit dials ever | The CEO | Reactivation waves ship first with no AI; D26; adoption gates; no effect claimed before 4 weeks |
| 2 | The VPS fails or the Claude sign-in lapses (lapsed since 09-27; doctor row stale) | The CEO (sign-in), the build lead (watchdog) | systemd restart; one SQL watchdog alerting within 10 minutes; hourly model probe; backup API key (D19); phase 1 needs no AI |
| 3 | WA Connector doubles (5,168) harm the number's quality and confuse leads | The CEO | `whatsapp_guard.connector_off` and `single_copy_ok_at` gate every WhatsApp switch; 60 s duplicate detector |
| 4 | Official numbers polluted (test bookings, `invalid` counted as shown, live calls inside targets; whether B2B drops deleted rows is UNVERIFIED) | The build lead | Test calendar outside B2B's map; delete, never mark invalid; "Live ·" line kept apart; daily checks against HighLevel and Zoom; named denominators |
| 5 | Zoom Basic cuts 45-minute demos at 40 minutes; one meeting per host | The CEO (D1) | Licence; Basic refusal; booked-call guard; day-1 check of who hosts HighLevel's demo Zoom |
| 6 | Join signals lost or impossible (Meet sends none; HighLevel's Zoom host may be outside Mahara's account) | The build lead | Manual buttons after 30 s; Zoom participant report as second source; "not known" instead of 0; "That was not the lead" within 5 minutes |
| 7 | The parallel session's work is overwritten (sales-api v58 was deployed by it 10-02) | The build lead | One hooks commit; new files only; deploy from a fresh worktree; version check before and after; tell the other session first |
| 8 | Meta cost and quality (utility filed as marketing, ignored templates, per-person marketing limits, shared 250 a day) | The manager | One budget; per-source health; at most 3 templates per demo; ceilings; holdout |
| 9 | Wrong contact, wrong time, a client or a do-not-disturb contact messaged | The build lead | `isClient` and `dndFor` run before any room or send; one open room and one chat per lead; request ids; hours table; daily audit query for sends to other contacts |
| 10 | Reps do not adopt it (calls placed outside the cockpit; not in Slack; Zoom invite pending; Google not allowed) | The manager | 80% cockpit-dialing gate; Slack invites (D20); 30-minute training and role-play; strip copy as the phone script |
| 11 | Security exposure (`sales-live` has verify_jwt off; `start_url` leak; port 3456 reported open) | The build lead and the CEO | Signatures and cron secret checked first; `start_url` only in `room_secrets`, deleted at the end; close port 3456; frontier models only; redaction |
| 12 | A lead silenced by mistake, or messaged without consent ("not interested", «لا تتصل الحين») | The closer and the setter (review), the CEO (consent line) | 30-day pause instead of do-not-disturb; a rep confirms every stop; consent line on forms and booking pages |

**Still UNVERIFIED after this pass:**
- Zoom: the end, delete and participant-report endpoints, the live-meeting check, and the signature digest format.
- Slack: whether `/away` is a built-in command.
- HighLevel: URL-button variables filled from contact fields, the notes endpoint, and the calendar-events query fields.
- B2B: whether it drops deleted appointments.
- Meta: the template categories and the October rates.
- Google: whether the setter has a Workspace account, and the consent screen type.
- The test contact's do-not-disturb: whether it is contact-level or per channel.