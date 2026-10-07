# Milestone 1 scope: the video link when a call fails

Branch `live-calls`, worktree `/Users/abdulazizwaheedi/mahara-worktrees/live-calls`, 5 October 2026. This file says exactly what Milestone 1 is on the server, the settings it runs with for the pilot, and what is fenced off and how the fence holds. Nothing here has been deployed or switched on.

## 1. What Milestone 1 does

A setter or closer whose call did not connect presses **Send a video link** (Meet by default for a setter, Zoom for a closer). sales-api checks the seat, the switches and the lead, then asks for a room. The room worker on the VPS makes the meeting and opens the room. sales-api sends the link to the lead: WhatsApp free text inside the 24-hour window, else the `call_link` template, else email. The lead opens the room link (or the short link, once `short_link` and the call site are live) and joins. The rep presses **I'm in the room** and **The lead is in**, and marks the call as usual. Nothing is booked or marked by the join, and nothing settles a no-show by itself: the rep marks the call.

## 2. The Milestone 1 surface

### sales-api seat actions (behind the seat gate, every write audited)

| Action | What it does in Milestone 1 |
|---|---|
| `room.create` | Purposes `fallback` (after a missed call) and `manual` (lead page, bad number). Refuses `standby` (400), `handover` while `live.enabled` is off (409 `disabled`), `booked` (400), and trigger `auto` while `rooms.fallback.auto_on_miss` is off (409 `disabled`) |
| `room.status` | The room and its last 20 events, the health line, the server clock |
| `room.open` | The host's own link (host only) |
| `room.mark` | `host_in`, `lead_in`, `not_lead`, `still_on`. `lead_in` books nothing while `count_on_join` is off |
| `room.end` | End, We are on the phone, Finished, Cancel, I can't let them in (`admit_blocked`, with its replacement on the other provider) |
| `room.send` | Also send by email |
| `live.status` | The banner's read: the seat's open rooms and recent closed ones. While `live.enabled` is off it answers `live_enabled: false`, `offers: []`, `standby_on: false` |
| `live.availability` with `away` | Allowed (it only ends things). `available` is fenced (below) |

Existing actions the branch changed, all in Milestone 1: `convo.send` and `wa.template.send` (a seat's request id kept apart from the room link's message keys), `dial.queue` (a lead whose room is still open is held out of the queue), `whatsapp.guard` (a save keeps every key), `followup.settings` (takes `agent`, manager only, audited), `followup.approve` (backlog openers go only in a batch; confirmation drafts are fenced, below).

### sales-api desk actions (service key) and cron actions (cron secret)

| Action | Caller | In Milestone 1 |
|---|---|---|
| `room.event` kind `worker.ready`, `worker.failed` | the room worker | Yes: the handshake that sends the link, or the failure sentence |
| `room.event` kind `zoom.*` | the door after storing a Zoom event | Yes: host and lead joins, meeting end |
| `room.event` kind `sweep.replay` | the cron door | Yes for Zoom and worker events. A stored `live.claimed` is closed as it stands while `live.enabled` is off (no room, no link) |
| `room.event` kind `tick` | the cron door | Yes: a link claimed and never sent, a WhatsApp link still pending. Its count re-asks do nothing while `count_on_join` is off |
| `room.event` kind `sweep.settle` | the cron door | Fenced: inert while `rooms.settle` is off |
| `live.press` | service key only | Fenced: refused while `live.enabled` is off |
| `thread.tick`, `reply.seen` | cron door, service key | Inert stubs (`handled: false`, "not built yet") |
| `followup.send_due` | the desk | Fenced: refused (`hold_all`) while `followups.agent` is off |
| `followup.autosend` (existing) | the desk | Fenced: refused (`hold_all`) while `followups.agent` is off |
| `followup.settle`, `dial.resync_stuck`, `contract.sync` (existing) | desk, cron | Unchanged, outside this feature |

`CRON_ACTIONS` is `contract.sync`, `room.event`, `thread.tick`. The cron door (`sales-live/cron.ts`) passes on only `room.event` kinds `sweep.replay`, `sweep.settle`, `tick` with 1 to 50 ids, and `thread.tick`.

### sales-live door routes (verify_jwt off, each checks its own key)

| Route | In Milestone 1 |
|---|---|
| `POST /zoom` | Yes: Zoom's meeting events, signature checked, stored once, passed to `room.event` |
| `GET /open/{code}` | Yes: the short page's script (records the lead's open) |
| `GET /go/{code}` | Yes: the no-script redirect |
| `POST /cron` | Yes: the sweep's posts (replay and tick act; settle is inert at sales-api) |
| `GET /health` | Yes |
| `POST /slack` | Fenced: forwards `live.press`, which sales-api refuses while `live.enabled` is off. Answers 503 while `SLACK_SIGNING_SECRET` is not set |

### Desk commands and worker jobs (VPS, cron under flock)

| Command | Schedule | In Milestone 1 |
|---|---|---|
| `desk.py rooms --for 57` | every minute, `flock -w 10` | Yes: the room worker. It refuses `standby` and `handover` rooms while `live.enabled` is off (unread counts as off) and `booked` rooms always |
| `desk.py rooms --check-hosts` | every 10 minutes | Yes: each seat's Zoom status and the Google sign-in (`room_hosts`) |
| Slack poster (inside the room worker) | every minute | Fenced: sends nothing unless `live.enabled` and `live.slack` are both on |
| `desk.py waves` | every 5 minutes | Fenced: does nothing but wind down a stopped wave while `followups.agent` is off |
| `desk.py followups` (existing) | :07 and :37 | Drafts for reps to approve (`followups.enabled`). Confirmation drafts and autosend fenced by `followups.agent` |
| `desk.py doctor --cron`, `desk.py deploy-check` | hourly, by hand | Yes. deploy-check now also checks `rooms.settle`, `rooms.wrap` and `followups.agent` are off |

### SQL (pg_cron) rules

- `mahara-sales-rooms-sweep` every minute: `cockpit_sales_rooms_tick()` runs `cockpit_sales_rooms_sweep()` and posts to `sales-live/cron`.
  - Milestone 1 rules: P0 (place a Zoom event), R1 (requested 60 s), R2 (creating 120 s), R3 (host not in), R4 (lead not in), R7 (no end signal), R9 (backstop), E0 and E1 (event give-up and replay), T (the tick list).
  - Live handover rules: A1, L0 (new: ends every open offer while live is off), L1, L2, L3 (re-offer only while live is on), R5 (fresh standby only while live is on), R6, R8, R10 (new: ends or cancels every empty standby room while live is off), L4.
  - S1 (settle): runs only while `rooms.settle` is true.
- `mahara-sales-watchdog` every 5 minutes: status rows and alerts. Milestone 1.
- RPCs sales-api uses in Milestone 1: `cockpit_sales_room_event_lease`, `cockpit_sales_message_slot`, `cockpit_sales_alert_set`, `cockpit_sales_disposition_replace`. `cockpit_sales_room_count_claim` answers `missed` while `count_on_join` is off. `cockpit_sales_live_claim` is reached only through `live.take`, which is refused, and itself claims nothing while `live.enabled` is off.

### Screens

- **Dialer:** Send a video link after a missed call (the picker and the after-miss step), and the room panel (the room line, Open my room, The lead is in, Copy link, Also send by email, End room, I can't let them in).
- **Lead page:** Send a video link in the video menu, and the same room panel.
- **Banner:** the seat's open room in one line (polls `live.status`).
- **Team page:** the rooms health line (worker, hosts, sweep).
- **Short link page** (`sites/call-link`, `call.maharamedia.com`): built, not deployed (the CNAME waits for the CEO); with `short_link` off the messages carry the room link itself.

## 3. Pilot settings

| Setting | Pilot value | Production now |
|---|---|---|
| `rooms.enabled` | true | false |
| `rooms.providers.meet`, `rooms.providers.zoom` | true, true | false, false |
| `rooms.send.whatsapp_text`, `.whatsapp_template`, `.email` | true, true, true | false |
| `rooms.test_only` | true | true |
| `rooms.test_contacts` | `["VjPfR4Cc1Y0OFvaqeor5"]` (the test contact) | the same |
| `rooms.count_on_join` | false | false |
| `rooms.settle` | false | missing (off); 20261004a adds false |
| `rooms.wrap` | false | missing (off); 20261004a adds false |
| `rooms.fallback.auto_on_miss` | false | false |
| `rooms.fallback.scope` | `intro` as shipped (a missed call's link needs the lead's booked intro). For the test contact without a booked intro, use the lead page's link (`manual`), or a manager sets `any` | `intro` |
| `rooms.short_link` | false until the call site is deployed | false |
| `live.enabled`, `live.slack` | false, false | false, false |
| `followups.agent` | false | missing (off); 20261004a adds false |
| `followups.enabled` | unchanged (true): the drafts reps approve one by one, live since 26 September | true |

Two facts to know before the pilot:
- **Production's `followups.enabled` is true, not off.** It is main's draft-for-approval desk (reply and nurture drafts are written today). The branch used that same switch for the agent's new sends, so on deploy waves, batches and the paced send would have been allowed. They now need `followups.agent`, which is off and missing reads as off.
- **WhatsApp links are locked by the WhatsApp gate** until a manager confirms the WA Connector is off and the single-copy test passed (`whatsapp_guard`: `connector_off` false and `single_copy_ok_at` null today), and the template needs the `call_link` row active with its workflow. Until then the link goes by email (`rooms.send.email`).

**How the pilot is switched on** (after 20261004a is applied; the settings guard refuses it otherwise unless the write names an active manager as its actor in its own transaction, and updated_by is that manager):

```sql
begin;
set local mahara.actor = '<the manager''s email>';
update public.cockpit_sales_settings
   set value = value || jsonb_build_object(
         'enabled', true,
         'providers', '{"meet": true, "zoom": true}'::jsonb,
         'send', '{"whatsapp_text": true, "whatsapp_template": true, "email": true}'::jsonb),
       updated_by = '<the manager''s email>', updated_at = now()
 where key = 'rooms';
commit;
```

It leaves an audit row `settings.switch` naming the manager and every switch that went on. Order: apply 20261004a, deploy sales-api and sales-live, put the desk on the VPS with its cron lines, run `desk.py deploy-check` (every switch off), then the write above.

## 4. Fenced off, and how each stays off

| What | Switch (off) | Seat | Desk (service key) | Cron door | Database | Worker |
|---|---|---|---|---|---|---|
| Live handover: Available, Take, Not now, ask, cancel | `live.enabled` | 409 `disabled` (Away still works) | `live.press` 409 | not a cron action | L0 ends open offers; `cockpit_sales_live_claim` claims nothing | n/a |
| Handover and standby rooms | `live.enabled` | `room.create` handover 409, standby 400 | a stored `live.claimed` replay is closed with no room | same | R5 makes no fresh standby, R10 ends empty ones, L3 never re-offers | refuses standby and handover rooms |
| Counting a join as a booking | `rooms.count_on_join` | `room.count_confirm` 409; `lead_in` books nothing | Zoom joins and ticks book nothing | ticks book nothing | the count's claim answers `missed` | n/a |
| Settling no-shows automatically | `rooms.settle` (new) | n/a | `sweep.settle` leases, reads and marks nothing | same | S1 makes, posts and marks nothing | n/a |
| Rooms for booked calls | `rooms.wrap` (new) | `room.wrap` 409 before HighLevel is read | n/a | n/a | n/a | refuses booked rooms always |
| Automatic video links | `rooms.fallback.auto_on_miss` | `room.create` trigger auto 409 | n/a | n/a | n/a | n/a |
| Waves, openers, the approved batch | `followups.agent` (new) | wave start and resume, batch 409; pause, stop and hold always work | `followup.send_due` 409 `hold_all` | not a cron action | n/a | `desk.py waves` enrols, drafts and sends nothing |
| Levels that send by themselves | `followups.agent` | `followup.level` above Approve 409 | `followup.send_due` refused | n/a | n/a | n/a |
| Confirmation drafts, autosend | `followups.agent` | `followup.approve` on a confirmation 409 | `followup.autosend` 409 `hold_all` | not a cron action | n/a | the desk writes no confirmation draft and calls no autosend |
| Slack | `live.enabled` and `live.slack` | n/a | `live.press` refused | n/a | n/a | the Slack poster sends nothing |
| Demo chats | `threads.enabled` | n/a | `thread.tick`, `reply.seen` inert | `thread.tick` inert | n/a | n/a |

**Turning a switch on.** In sales-api the only setting writes are `setting.save` (`crm_writes` only), `followup.settings` (manager, audited), `whatsapp.guard` (manager, audited), the duplicate detector's WhatsApp pause (it only pauses), `contract.templates.save`, `asset.hide` and the contract sync's own state; none writes `rooms`, `live` or `threads`. The desk writes only `client_form`, `maqsam_calls` and `offer`. In the database, `cockpit_sales_settings_guard` (20261004a) refuses any write that turns on a switch of `rooms`, `live`, `threads` or `followups`, or widens who the rooms reach (`test_only`, `test_contacts`, `fallback.pilot_emails`, the test and live calendars), unless the write names an active sales manager as its actor in its own transaction (`set local mahara.actor`, or sales-api's `x-mahara-actor` header) and its `updated_by` is that manager; a guarded row is never renamed, a new `rooms` row is compared with the shipped one, `fallback.scope` is guarded whatever its spelling, and a deleted row is its switches turned off; every switch change, on or off, leaves a `settings.switch` audit row naming the actor or "not named". Turning a switch off needs no one.

## 5. Proof

- `supabase/functions/sales-api/m1_fence.test.ts`: every fenced action through rooms.ts and followupAgent.ts as a seat, the desk and the cron door's bodies, with the pilot settings; Milestone 1's own path still works with them.
- `supabase/functions/sales-api/m1_fence_router.test.ts`: the same through index.ts's doors (a seat's session, the service-role token, the cron secret), and turning `followups.agent` on through a manager's `followup.settings` with its audit row; a rep, the desk and the cron secret cannot.
- `hermes/sales-desk/tests/test_m1_fence.py`: waves, confirmation drafts and autosend off on the desk; the worker refuses standby and handover rooms while live is off (and makes them when on); the desk writes no switch.
- `supabase/migrations/tests/20261003_rooms_checks.sql` section M (run_checks.py, rolled back): kill switches by anyone with audit rows; turning on refused for the desk, sales-api's name, a non-manager, an unstamped write, an upsert; allowed and audited for a manager; settle off posts nothing; live off ends offers and empty standby rooms, makes no fresh one and claims nothing; the count's claim answers missed.

## 6. Commit and matrix

Commit `683003a` on `live-calls` (not pushed, not deployed). Full matrix on it: sales-api 1191 pass, 0 fail; sales-live and call-link 358 pass, 0 fail; cockpit 796 pass, 0 fail; `tsc -b` clean; biome clean (main's 2 warnings); desk 1232 tests OK (16 skipped); run_checks.py 496 of 496 (also with `--twice`), run_adversarial.py 56 of 56, nothing persisted. The SQL stress scripts outside the matrix (`supabase/migrations/tests/stress_*.py`) were not run again; the ones that turn a switch on in their own rolled-back runs need `updated_by` set to a manager now.
