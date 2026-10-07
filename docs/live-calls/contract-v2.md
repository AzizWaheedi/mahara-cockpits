# Shared contract v2: rooms, live calls and the follow-up agent

Integration branch `live-calls` (worktree `/Users/abdulazizwaheedi/mahara-worktrees/live-calls`), after merging lc-db, lc-logic, lc-door, lc-worker, lc-desk and lc-ui on 3 October 2026. This file replaces `contract.md`.

**Updated after the second integration (li-db, li-api, li-ui, li-ops merged into `live-calls` on 3 October 2026).** Where the final code differs from what this file first said, the text below now says what the code does, and section 0b lists every such change in one place. The file as it stood before is kept beside it as `contract-v2.before-integration.md`. The code it describes is branch `live-calls` at commit `68f5c6e`. `updates.md` still wins over everything, and `final_consistency.md` still sets the names. Where this file settles something the glossary left open, it says so.

**Lanes that implement each item**
- **DB**: migration deltas, folded into `20261003a` and `20261003c` in place (neither was applied in production), plus checks in `supabase/migrations/tests/`.
- **API**: Edge Functions. That is `sales-api` (a new `rooms.ts`, `roomlogic.ts`, the shared `index.ts` and `lib.ts`) and, where marked, the `sales-live` door.
- **UI**: the sales cockpit's screens and wiring.
- **OPS**: the desk, the room worker, the VPS cron, the runbooks.

Every item below carries one or more of these tags.

---

## 0. What changed from v1

- **RoomView** gains `link_unconfirmed_at`, `trigger`, `attempt_id`, `appointment_id`, `handover_id` and `starts_at`.
- **Presence** gains `reason`, `booked_at` and `booked_kind`.
- **Health** counts may be null.
- **`live.status`** gains `live_enabled`, `standby_error` and `now`. **`room.status`** gains `now`.
- **`live.take` and `live.decline`** are `{live_id, request_id}`.
- **`room.end`** gains `admit_blocked`, which answers with a `replacement` room.
- **Refusals** carry a `code`.
- **`room.event`** has a fixed list of kinds and payloads, including `tick`, `sweep.replay`, `sweep.settle`, `worker.ready`, `worker.failed` and the stored `live.claimed`.
- **Events are taken with a lease**, never by setting `handled_at` first.
- **The worker handshake** is settled: the worker opens the room, and sales-api sends the link.
- **`room.settle`** is retired. The settle path is `room.event` kind `sweep.settle`.
- **Timers** have one owner: the SQL sweep.

## 0b. Where the final code differs from the first version of this file

Settled at the second integration (li-db, li-api, li-ui, li-ops), 3 October 2026. Each item is also written into the section it belongs to.

1. **No delta migration.** The section 10 items went into `20261003a_sales_rooms.sql` and `20261003c_sales_followup_agent.sql` in place; `20261003b` needed no change. Neither migration is applied in production yet. `desk.py deploy-check` names those two files when a column is missing.
2. **Settling both kinds of room.** The SQL sweep posts `sweep.settle` for a **fallback** room of a booked intro (not a booked room) that closed with nobody joining (expired with no result or `no_join`, or ended `no_join`; a join taken back by "That was not the lead" counts as nobody), while the intro is still new or confirmed, at the intro's start + `waits_s.settle`. sales-api's `sweep.settle` runs `settleWanted`, which accepts both a fallback room for a booked intro and a booked room. Rooms closed `admit_blocked` are never settled.
3. **Link request ids are per channel.** The message service keys each send on a UUID made from `mahara-room/link/{room_id}/{channel}` (`liveio.ts uuidFrom`, a SHA-256 name hash), not on the bare room id: still one send per room and channel, and it lets email follow an unconfirmed template. "Also send by email" uses the rep's own `request_id`.
4. **`room.open` without a fresh start link.** sales-api holds no Zoom keys, so it returns the stored start link while it is fresh, and otherwise the join link (Zoom opens it as the host when they are signed in). Meet rooms and booked rooms always get the join link.
5. **`worker.ready` on a `lead_in` room** is handled like a final room: marked handled, no link.
6. **Presence comes from the view.** The view's column is `why` (not `on_call_why`). It also puts a closer `on_call` while they hold a handover (`why = 'handover'`), which `presenceOf` has no input for, so the view is the source. `live.status` reads `reason`, `booked_at` and `booked_kind` from the view; `booked_at` and `booked_kind` are set only with `reason = 'booked_call_soon'`.
7. **Done waves.** No trigger ends a done wave's members. The desk's wind-down is the only thing that does, so held-back members stay in the comparison. Waves have four states: `draft`, `running`, `paused`, `done`; `cancelled` is refused.
8. **The cron door's kinds** are one map, `CRON_KINDS` in `sales-live/cron.ts`: `sweep.replay` carries `event_ids`, `sweep.settle` and `tick` carry `room_ids`. Its 202 answer names the kind and counts the ids (`events` or `rooms`).
9. **`live.ask` and `live.cancel` are registered** (project 2 is not built): with `live.enabled` off they answer "Live handover is not switched on yet."; with it on, "Asking for a live handover is not built yet. Book the call for now." Both are 409 with code `disabled`, never "Unknown action.". The lead page sends `{request_id, contact_id, kind: 'demo'|'intro', host: 'closer'|'me', note}`; that shape is not settled until P2 builds the action. `live.press` answers "Live handover is not switched on yet." while off and "Slack presses are not built yet. Use the cockpit." while on; `thread.tick` and `reply.seen` answer `{handled: false}` with a "not built yet" note.
10. **The duplicate detector watches only once the gate is open on that side.** It runs after a WhatsApp send only while `whatsapp_guard.connector_off` is true and no pause stands (`sendrules.ts duplicateWatchOn`). Before that, the WA Connector copies every send, and a watch would pause WhatsApp for every rep on the first one.
11. **`whatsapp.guard` saves keep every key** and take only what is sent: `templates_per_day`, `pause_fail_share`, `pause_min_sends`, `connector_off` (a boolean), `single_copy_ok_at` (`true` for now, `null`, or a past time), `dup_window_s` (10 to 600), `template_budget_usd_month`, `template_rate_usd`, and `dup_paused_at: null`, which clears the pause and its reason. The Follow-ups page's WhatsApp card sends only the keys a press changes: "The WA Connector is off", "The test message arrived once", "It is on again" and "Clear the pause".
12. **The follow-up agent's switch gates the screens' actions too.** With `followups.enabled` false, `followup.wave` start and resume and `followup.batch` are refused (409, "The follow-up agent is switched off, so no wave starts and no opener is approved. A manager switches it on under Follow-ups, How it works."). Pause, stop and hold always work.
13. **Audit rows added at integration:** `room.link` (the link went, with its channels and whether email followed an unconfirmed template), `room.link.not_sent` (why it could not go), `room.settle` with `settled_mark: none` (the call was already marked), `live.room` (a handover's new room linked), `live.room.ready` (an adopted room's link claimed on a Take or its replay) and `followup.set_aside` (a refused draft set aside by `followup.send_due`).
14. **The desk counts a draft sales-api set aside.** `followup.send_due` sets a refused draft aside itself before it answers, so the desk's own write finds it held; the waves run still counts it as set aside.
15. **Hours.** The 9 to 18 first-message hours apply to every first message (a rep's approval too). The Friday day off applies only to `followup.send_due`.
16. **`signAs` and the button variable** exist on template sends only; a free-text send is signed by its sender.
17. **Timeouts in `index.ts`.** Every database and seat-check call has 20 s, every HighLevel call 25 s; `liveio.ts` gives the live-call modules 8 s and 15 s.
18. **The dialer's queue hold** is in `index.ts` `candidates` (`rooms.held`), not in `dialer.ts`. An unreadable hold holds nobody and says so in the log.
19. **Built by OPS since this file was written:** the VPS Slack poster (`desk/slackpost.py`), `desk.py deploy-check`, and the runbook rows in the top-level `RUNBOOK.md`.

---

## 1. Conflicts settled here

**S1. One owner for every timer: the SQL sweep. [DB, API]**
- **The conflict.** `cockpit_sales_rooms_sweep()` (lc-db) closes rooms, handovers and availability on every timer, R1 to R9, L1 to L4, A1 and S1. Separately, lc-logic asked for a sweep with "no timer rules" that posts a `tick` per room so `roomlogic.ts` fires the timers. Two owners would close the same room with different `end_reason` and `result`. For example, SQL closes a knock that was never let in as `not_admitted` / `admit_blocked`, and roomlogic's tick closes it as `no_join`.
- **Why SQL owns them.** The SQL sweep runs inside the database every minute whether sales-api is up or not, and 325 checks prove it on the real schema.
- **What roomlogic keeps.** `timers()` stays as the reference model. It drives `nextDueAt`, `holdUntil`, the countdowns and the tests.
- **What `tick` does now.** A `room.event` kind `tick` only does what SQL cannot:
  - re-ask for a link that was claimed and never sent;
  - re-ask for a count never claimed, or alert on one stuck;
  - re-ask for an undo that never landed;
  - alert when a room with a lead in it runs into a booked call.
- **[API]** `room.event {kind:'tick'}` calls `sweepRoom` with a new option, `owner: 'sql'`. Under it, no timer moves a state, and only re-asks and alerts come back. The roomlogic change and its tests belong to the API lane.
- **[DB]** The sweep must also do what lc-logic's review added to the timers; see section 10, items 4 to 6.

**S2. The worker opens the room, and sales-api sends the link. [OPS, API]**
- **The two lanes' handshakes.**
  - lc-worker (built and stress-tested) stores `worker.ready`, then sets the room `open` itself. Its write is guarded by `state=eq.creating&worker_run=eq.{run}` and sets `join_url`, `provider_meeting_id`, `opened_at`, `host_by` and `ends_at` when they are unset. It then calls `room.event`.
  - lc-logic asked that the worker write only `join_url` and `provider_meeting_id`, and that sales-api move `creating → open`.
- **The worker's handshake stands.** The room is usable the moment the meeting exists, even while sales-api is slow. The worker's 117 tests and its 151-seed stress run cover it.
- **The confirmed defect.** `roomlogic.ts` `ready` on an open room asks for the link only when `opened_at` is null. That branch is for rows an older worker opened itself. But the worker sets `opened_at`, and the rooms guard trigger stamps it on every move to `open` anyway. As merged, then, `worker.ready` on a worker-opened room is a no-op, and **the lead's link is never sent**.
- **[API]** Change `ready` on `open` or `host_in` to two steps:
  1. Fill in only the deadlines that are missing (`lead_by` when the room has a lead; `host_by` and `ends_at` with `laterIso`).
  2. Claim the link when `linkDue(room)`, which sets `link_claimed_at` in the same guarded write.
- **[API]** Pin both steps in tests. `ready` on `creating` is never fed by sales-api (section 7). lc-logic's `recover` at `claimed_at + 15 s` is superseded, because the worker's own orphan path and SQL's R2 cover a lost open.

**S3. Events are taken with the lease, never by stamping `handled_at` first. [API, DB]**
- **The lanes' versions.**
  - lc-door's README tells sales-api to claim a Zoom event with `update ... set handled_at = now() where id = $1 and handled_at is null`.
  - lc-db built `cockpit_sales_room_event_lease()` and `lease_until`, which E0 and E1 respect.
- **The lease is the one way.** Stamping `handled_at` first loses the event when sales-api dies mid-work. A lease runs out, and then the sweep replays the event.
- **lc-db's suggestion is withdrawn.** It suggested that the door insert its events with `lease_until` set. That would make sales-api's own lease call return null, and the event would never be handled. The door's 16.4 s forward window, under the 20 s `event_replay`, is the guard. Section 6 has the protocol.

**S4. Settle and tick go through the cron door. [API (sales-live), DB]**
- **The defect.** `cockpit_sales_rooms_tick()` posts `room.event` kind `sweep.settle` with `room_ids`. But `sales-live/cron.ts` passes on only `sweep.replay` and `thread.tick`, and refuses anything else with a 403. **As merged, no booked intro is ever settled as a no-show.**
- **[API (sales-live)]** `cronForwardable` also passes on two bodies, each rebuilt field by field:
  - `{action:'room.event', kind:'sweep.settle', payload:{room_ids}}`;
  - `{action:'room.event', kind:'tick', payload:{room_ids}}`.
- **Validation:** 1 to 50 UUIDs, lower-cased and de-duplicated. `cron.test.ts` gains the two bodies.
- **Why only ids.** The tick carries room ids and nothing else. sales-api reads `pending_events`, `next_booked_start` and `available_until` itself, so a forged cron post can only ask for a re-check of rows as they stand.
- **[DB]** `cockpit_sales_rooms_tick()` posts `tick` for two sets of rooms, in posts of at most 50, and at most 2 posts a run:
  - every room not in a final state that has a lead;
  - every final room whose `lead_in_at` or `count_undo_at` falls in the last hour.

**S5. Presence has one source: the view. [DB, API]**
- **The conflict.** `cockpit_sales_presence` (SQL) and `roomlogic.ts` `presenceOf` disagree.
  - SQL puts a standby room with the host in as `ready` even after Available has run out.
  - SQL counts the host's own open Zoom room as "a live Zoom meeting".
  - SQL does not put a host whose room waits for its lead `on_call`.
- **The view stays the one source.** The sweep's re-offer (L3) and `live.ask`'s offer targets must agree with the strip.
- **[DB]** Align the view with `presenceOf`'s order:
  1. `on_call`, for any of these: an open dial, a room with the lead in it, an appointment now, a live Zoom meeting that is not one of their own open rooms, or a room of theirs that waits for its lead;
  2. `ready`, only while Available has not run out;
  3. `available`;
  4. `away`.
- **[DB]** `default_provider` gives way to the provider the host can use. A pending or missing Zoom seat with no saved default gets Meet, and no Google gets Zoom. This is lc-logic's `defaultProvider` and lc-worker's suggestion.
- **[API]** `live.status` and `live.availability` read the seat's view row and shape it with `presenceView`, plus the fields in section 3.
- **[API, DB]** One shared fixture set checks that the view and `presenceOf` agree.

**S6. Who owns which words.** Section 15.

**S7. When the worker ends a meeting. [OPS]**
- lc-logic says "never while Zoom shows anyone but the host". lc-worker ends a started meeting only when the live participant list shows nobody outside the team (every room host and every seat), and leaves it open otherwise, with an alert.
- **The worker's rule stands.** A team member is never the lead (H7 protects the lead).
- When the list cannot be read, the meeting is held and alerted, never ended.

---

## 2. Defects confirmed at merge (fix before any switch is turned on)

| # | Defect | Fix | Lane |
|---|---|---|---|
| 1 | `worker.ready` on a worker-opened room sends no link (S2) | `ready` claims the link when `linkDue` on an open room | API |
| 2 | `sweep.settle` is refused 403 by the cron door (S4) | the door accepts `sweep.settle` and `tick` | API (sales-live) |
| 3 | `open_device` check is `('phone','tablet','desktop','unknown')`; the door, roomlogic and the UI use `phone`, `tablet`, `computer` | the check becomes `open_device is null or open_device in ('phone','tablet','computer')`; null means not known | DB |
| 4 | `link_claimed_at` and `count_undo_at` are written by roomlogic but are not columns | add both, `timestamptz` null | DB |
| 5 | The desk writes wave and meta columns the migration lacks (section 14), and member state `closed` is refused by the check | add the columns and the state | DB |
| 6 | The open grace is not capped in SQL R4: a lead who reopens the link every 2 minutes keeps a room open until the R9 backstop | cap it as roomlogic `graceCap` does | DB |
| 7 | SQL timers ignore unreplayed events (lc-logic F4 and F5: a knock the door could not forward) | the pending-events hold in SQL | DB |
| 8 | The worker's stored events have no `text`; `room.status` and the UI drop events without text | the worker writes a sentence; sales-api fills one for any event still without | OPS, API |

All eight are fixed in the final code (second integration, 3 October 2026), each with a test: 1 and 8 in sales-api (`rooms.test.ts`), 2 in `sales-live/cron.ts` (`cron.test.ts`, `handler.test.ts`), 3 to 7 in the migrations (`run_checks.py` and `run_adversarial.py`), and 8 in the worker (`test_ops_contract.py`).

---

## 3. Shapes

**`RoomView`**

```
{ id, code, contact_id|null, contact_first_name|null,
  purpose: 'fallback'|'handover'|'standby'|'booked'|'manual',
  call_kind: 'intro'|'demo', provider: 'meet'|'zoom', host_email,
  state: 'requested'|'creating'|'open'|'host_in'|'lead_in'|'ended'|'expired'|'failed'|'cancelled',
  version, short_url|null, join_url|null,
  link_channels: ('whatsapp_text'|'whatsapp_template'|'email')[],
  link_sent_at, link_unconfirmed_at, first_open_at,
  open_device: 'phone'|'tablet'|'computer'|null,
  lead_waiting_at, host_in_at, lead_in_at, ended_at,
  host_by, lead_by, ends_at, starts_at,
  result: 'joined'|'no_join'|'moved_to_phone'|'cancelled'|'failed'|'admit_blocked'|null,
  count_result: 'booked'|'moved'|'not_a_lead'|'failed'|'undone'|null,
  error|null, refusal|null, created_at|null,
  trigger|null, attempt_id|null, appointment_id|null, handover_id|null }
```

Notes on the fields:
- **New fields.** `link_unconfirmed_at`, `starts_at`, `trigger`, `attempt_id`, `appointment_id` and `handover_id` are new.
  - **[API]** Add them to `ROOM_VIEW_KEYS` and `toRoomView`.
  - **[UI]** The UI already reads them when present. Update its pinned key list when the API adds them.
- **`link_unconfirmed_at`.** Set when a WhatsApp template was not seen within `rooms.waits_s.unconfirmed` (20 s) and email went too.
  - **[DB]** New column.
  - **[API]** The message service writes it.
  - "Not confirmed" reads this field, never a channel value.
- **`starts_at`.** A booked room's appointment start, or the start of the booked intro a fallback room is for. **[API]** sales-api reads it from `cockpit_sales_appointments`; it is not a column.
- **`link_channels`.** Only the three glossary channels. There is no `read_out` and no bare `whatsapp`. **[UI]** Fix the stale comment in `rooms.ts`.
- **`start_url`.** Never in a RoomView or in any answer except `room.open`'s.
- **`short_url`.** `https://call.maharamedia.com/{code}` when `rooms.short_link` is true, else `join_url`.

**`Presence`**

```
{ email, state: 'on_call'|'ready'|'available'|'away', until|null, room_id|null,
  zoom_status: 'licensed'|'basic'|'pending'|'missing'|null, default_provider: 'meet'|'zoom',
  reason|null, booked_at|null, booked_kind: 'intro'|'demo'|null }
```

`reason` takes one of these values:
- `missed_offer`: from `availability.reason`, written by the sweep's L1;
- `expired`: from `availability.reason`, written by A1;
- `booked_call_soon`: the seat's latest standby room closed with that `end_reason` while the seat was still Available. `booked_at` and `booked_kind` then come from the host's next appointment;
- null otherwise.

**[API]** builds all of these. **[UI]** reads them when present; without them, the strip guesses a miss from Away, as it does now.

**`Health`**
- **Shape:** `{ worker_ok, last_run_at|null, rooms_today|null, failed_today|null, line }`.
- **Null counts.** A count that could not be read is null, never 0.
- **`line`.** roomlogic `roomsHealth`'s sentence. The mismatch line contains "disagree", which the UI's tone reads.
- **Inputs.** `mismatched_today` is the count of today's open `room_report` alerts from the worker's host check. **[API]**

**`Offer`** (project 2)
- **Shape:** `{ id, version, kind, contact_first_name, company|null, country|null, reason, note|null, offer_until }`.
- `version` is shown only. Take does not send it.

**Refusal body** (every seat action)
- **Shape:** `{ ok: false, error: <one sentence that says what to do next>, code: RefusalCode }`, with roomlogic's `Refused.status` as the HTTP status.
- **Desk and cron callers** also get `retry` and `cleanup`. **[API]**
- **[UI]** Prefer `code` (`stale`, `confirm_end`, `disabled` and the rest) over matching words. Until the API sends `code`, keep matching "changed a moment ago" and "still in this room". Those two sentences are pinned in `roomlogic.copy.test.ts` and must not change.

---

## 4. Seat actions (sales-api `ACTIONS`, behind the seat gate; every write leaves an audit row)

| Action | Payload | Answer | Notes | Lane |
|---|---|---|---|---|
| `room.create` | `{request_id, contact_id\|null, provider, call_kind, purpose, trigger?, attempt_id?, appointment_id?}` | `{room}` or a refusal | See the steps after this table | API |
| `room.status` | `{room_id}` | `{room, events: [{at, kind, source, text}] (last 20, text required), health, now}` | | API |
| `room.open` | `{room_id}` | `{start_url}` | Host only; otherwise 403 "This room belongs to {host first name}." The stored start link while it is fresh, else the join link (sales-api holds no Zoom keys; 0b.4) | API |
| `room.mark` | `{room_id, version, what: 'host_in'\|'lead_in'\|'not_lead'}` | `{room}` | `not_lead` works within 300 s of `lead_in_at`, also on a closed room, where it takes only the count back (`count_undo_at`; result becomes `no_join`). A repeat press is a no-op | API |
| `room.end` | `{room_id, version, reason: 'end'\|'on_phone'\|'finished'\|'cancel'\|'admit_blocked', confirm?}` | `{room, replacement?: RoomView, replacement_refusal?: string}` | See the `room.end` rules after this table | API, UI |
| `room.send` | `{room_id, request_id, channel: 'email'}` | `{room}` | "Also send by email" | API |
| `room.wrap` | `{appointment_id, request_id}` | `{room}` | `wrapPlan` with `setting`, `contact_id` and `contact`. A booked room is inserted `open` with its own link; there is no worker and no provider call. Refused more than 30 minutes early, after the call, on a phone call, or for a host link | API |
| `live.availability` | `{state: 'available'\|'away'}` | `{me: Presence, standby_error?: string}` | See the availability rules after this table | API |
| `live.status` | `{}` | `{me, rooms: RoomView[] (mine, not final), offers: Offer[], health, live_enabled, standby_error\|null, now}` | See the status rules after this table | API, UI |
| `live.ask` / `live.cancel` | project 2, as P2 | | | API |
| `live.take` | `{live_id, request_id}` | `{room?: RoomView, claim_room, line?: string}` | Section 8 | API, UI |
| `live.decline` | `{live_id, request_id}` | `{}` | Adds the seat to `declined_by` (lower case). The version does not move. 409 "This offer has ended." when it is gone (the UI's "gone") | API, UI |

**`room.create`, step by step**
1. Run `createRefusal` with its two new inputs:
   - `host_email` (the seat);
   - `booked_intro` (the lead has a booked intro; `fallback.scope` "intro" needs one).
2. Insert the room `requested`, leaving the code out so the database picks one. Read a 23505 by its constraint name (section 9).
3. Wait up to 15 s, reading the row every 500 ms, for `open` or `failed`.
4. If the room is still `creating`, return it as it is. The browser then reads `room.status` every 2 s.

**`room.end`**
- **The lead in the room:**
  - `admit_blocked` is refused as `stale`;
  - any other reason except `finished` needs `confirm: true` ("The lead is still in this room. End it anyway?").
- **Early rooms.** On a `requested` or `creating` room, `cancel` is a state change. The worker's open write then misses and the worker closes the meeting.
- **lc-worker finding 23 (cancel during creating).** A rep's version that is exactly one behind, where the only change since was the worker's claim (`requested` to `creating`), is accepted, not "This changed a moment ago." **[API]**
- **`admit_blocked`** cancels the room with result `admit_blocked`. Inside the same request, sales-api makes the replacement on the other provider:
  - with the same contact, purpose, trigger, `attempt_id`, `appointment_id` and `handover_id`;
  - through `createRefusal`;
  - returning it as `replacement`, or its refusal sentence as `replacement_refusal`.
- **[UI]** Makes the room itself only when the answer carries neither.

**`live.availability`**
- **`available`** asks for a standby room when `live.standby` is on and the seat may host. If it cannot be made, the refusal sentence comes back as `standby_error`.
- **`away`** ends the seat's empty standby rooms (`standbyToEnd`, `{kind:'end', reason:'end'}`).

**`live.status`**
- **When it answers.** It answers while `rooms.enabled` or `live.enabled` is on. With both off, it is a 409 `disabled` refusal, and the UI shows nothing.
- **`live_enabled: false`** means rooms are on and live calls are off: presence is still sent, and `offers` is `[]`.
- **`standby_error`** is the refusal or failure sentence of the seat's latest standby room asked for during this Available.
- **`now`** is the server's clock.
- **The UI** polls every 4 s, or 30 s when Away, also while the tab is hidden.

---

## 5. `room.event` (in both `DESK_ACTIONS` and `CRON_ACTIONS`; runs as identity `sales-desk`)

**Callers.** The room worker calls it with the service key. The door calls it with the service key plus `x-cron-secret`. The cron door forwards only the bodies listed for it in S4.

**Every answer** is one of two shapes:
- `{ok:true, handled:true|false, room?: RoomView}`;
- a refusal `{ok:false, error, code, retry, cleanup}`.

The worker reads a 4xx as refused, and a 5xx, a 429, a timeout or no answer as unclear (the sweep replays the event). **[API]**

**Kinds sent to sales-api**

| Kind | Sent by | Body | sales-api does |
|---|---|---|---|
| `zoom.<event>` (for example `zoom.meeting.participant_joined`) | door, after storing the event | `{kind, source:'zoom', event_id, room_id\|null, dedupe_key, payload}` (payload is the stored, trimmed Zoom event) | See "zoom events" after this table |
| `worker.ready` | room worker, once, 4 s, no retry | `{kind, room_id, request_id: uuid5('mahara-room/worker.ready/{room_id}'), dedupe_key:'worker.ready:{room_id}', payload:{provider, provider_meeting_id, worker_run, seconds}}` | Section 7 |
| `worker.failed` | room worker, the same way | the same, with `payload:{error, worker_run}` | Lease. Act only when the room is `failed`: the handover moves in SQL's L2, and the panel reads `error`. Otherwise release |
| `sweep.replay` | cron door (S4) | `{payload:{event_ids: uuid[1..50]}}` | For each id: lease, read the stored row, and dispatch by its stored kind (`zoom.*`, `worker.*`, `live.claimed`). A row already handled or held is skipped |
| `sweep.settle` | cron door (S4) | `{payload:{room_ids: uuid[1..50]}}` | See "sweep.settle" after this table |
| `tick` | cron door (S4) | `{payload:{room_ids: uuid[1..50]}}` | Per room: read the row, `pending_events`, `next_booked_start` and, for a standby room, `available_until`; run `sweepRoom(..., owner:'sql')`; carry out its re-asks and alerts. Nothing to lease |

**zoom events**
1. Lease by `event_id`.
2. When `room_id` is null, find the room by `provider_meeting_id`, or by the topic code (`zoomCode`), and write `room_id` on the event.
3. Turn the event into a room event with `zoomEffect`, using the staff context: the room's host and `room_hosts` only (lc-logic F15).
4. Apply it. Ignore late or out-of-order events by `at`.
5. Set `handled_at`.

Never work out a dedupe key: the door's `event_id` is the key. **[API]**

**sweep.settle**
1. For each room, lease `dedupe_key = 'sweep.settle:{room_id}'`.
2. If `settleWanted` (a fallback room for a booked intro, or a booked room; 0b.2), write the no-show mark the dialer's own mark path writes, and `settled_mark`. A call already marked gets `settled_mark = 'none'`.
3. Set `handled_at`.

Rooms closed `admit_blocked` are never settled. **[API]**

**Kinds only stored** (they never reach sales-api as a call)
- `live.claimed`: written by `cockpit_sales_live_claim` with `lease_until = now() + 60 s` (section 8). Replayed through `sweep.replay` when it is left unhandled.
- `slack.reply`: written by the door when a Slack refusal has no `response_url`. Source `door`, never replayed. The VPS Slack poster sends it as a DM and sets `handled_at` (project 2). **[OPS]**
- Log only, stored handled:
  - `door.open`;
  - `worker.create_sent`, `worker.closing`, `worker.held`, `report.checked`;
  - `live.replaced`;
  - `sweep.<rule>`, `sweep.live_<rule>`, `sweep.standby_fresh`.

**Effects sales-api carries out after a write lands** (roomlogic `Effect`)
- **`send_link`:** the message service, keyed per channel on a UUID made from `mahara-room/link/{room_id}/{channel}` (0b.3), so a re-ask can never send twice, inside `waitUntil`.
- **`count_live`:** `countClaim`, then book or mark (`countLive` with `appointment_calendar_id`), then `countFinish`. A missed finish undoes what it made, then writes `countUndone`.
- **`undo_count`:** `countUndo` on the row as it is read now.
- **`delete_secret`:** delete the room's row in `room_secrets`.
- **`replace`:** the `admit_blocked` replacement (section 4).
- **`alert`:** through `cockpit_sales_alert_set`.
- **`close_provider`:** left to the worker, which closes every finished room's meeting itself.
- **`recover` and `refresh_standby`:** dropped under `owner:'sql'`.

---

## 6. The event lease (the atomic claim by event id) [API, DB]

**Taking the event.**
- `select public.cockpit_sales_room_event_lease(p_event_id => $id)` takes an event by id.
- For the worker's events and settle events, sales-api passes `p_dedupe_key` instead.
- `p_seconds` is 30 for a Zoom or worker event and 60 for a `live.claimed` replay; it is capped at 600.
- The function answers with the id when this caller now holds the event, and null when the event is handled or someone else holds it. On null, sales-api does nothing and answers `{ok:true, handled:false}`.

**Done.** `update cockpit_sales_room_events set handled_at = now(), lease_until = null where id = $id`.

**Failed or not yet** (a refusal with `retry`: `too_early`, `not_claimed` or `contact_unread`, or a provider error).
- sales-api runs `update ... set lease_until = null where id = $id`.
- `handled_at` stays null.
- The sweep replays the event after `event_replay` (20 s), up to 3 tries.
- After the 3rd try it gives up: `handled_at` is set, with `detail.gave_up`, and the watchdog raises one alert a day.

**Final refusals** (`final`, `stale` or `bad_input`) set `handled_at` and record the refusal in `detail.refused`.

**The door's part.** It never sets `lease_until` (S3). It stores the event before it forwards it, and its whole forward (16.4 s at most) ends before the 20 s replay.

**[DB] Checks to add.**
- Two leases on one event: one wins.
- A held event is neither replayed nor given up.
- A released event is replayed after 20 s.

---

## 7. The worker handshake [OPS, API, DB]

1. **sales-api inserts the room** with `state='requested'`, the code left out, and a unique `request_id`. It sets the deadlines it already knows: booked rooms carry all three (start + 15 and + 20 minutes, the appointment's end), and a handover's come from the claim.
2. **The worker claims it.** `PATCH cockpit_sales_rooms?id=eq.X&state=eq.requested` sets `state='creating'`, `claimed_at`, `worker_run`, `version = v + 1` and `error = null`, with `return=representation`.
   - The worker uses the row that comes back, so lc-logic's extra `&version=eq.v` is not needed.
   - It claims only while `rooms.enabled` and that provider's switch are on. A setting it cannot read counts as off.
3. **It makes the meeting.**
   - **Zoom:** on the host's own user, type 2, waiting room on, passcode in the link, no recording.
   - **Meet:** an event on the "Sales rooms" calendar, with the room id as the event id.
   - The host link goes to `cockpit_sales_room_secrets` (upsert, a TTL) and never anywhere else.
4. **It stores `worker.ready` before it opens the room.**
   - The event: `room_id`, `source:'worker'`, `dedupe_key:'worker.ready:{room_id}'`, `detail:{provider, provider_meeting_id, worker_run, seconds}`, and a `text` sentence such as "Room made on Zoom in 4.2 s.". **[OPS]** adds the text.
5. **It opens the room.** `PATCH ...&state=eq.creating&worker_run=eq.{run}` sets `state='open'`, `join_url`, `provider_meeting_id`, `opened_at`, `error = null` and `version = v + 1`, plus `host_by` and `ends_at` only where they are unset.
   - The worker never sets `lead_by`.
   - If the answer is lost, it reads the row again.
   - If the room went final meanwhile, the worker closes the meeting it made (`_withdrawn`).
   - **[OPS]** Verify one more case: when the write misses because another run holds the room, the meeting this run made must be closed too.
6. **It tells sales-api once:** `room.event {kind:'worker.ready', ...}`, 4 s, no retry, with a breaker.
7. **sales-api handles `worker.ready`. [API]**
   1. Lease the event by its dedupe key.
   2. Read the room.
   3. **`creating`:** release the lease and answer `handled:false`. The worker's open is in flight, and the sweep replays the event.
   4. **`open` or `host_in`:** apply `ready` as S2 changes it, with a guarded write (section 9). Set `handled_at`. Send the link inside `waitUntil`. Answer in under 2 s.
   5. **Final:** set `handled_at` and answer `handled:true`. The worker closes meetings of final rooms itself.
   - A `payload.worker_run` that differs from the row's is recorded in the event's detail. It does not refuse.
8. **Failure.** The worker stores `worker.failed` (with text), then runs `PATCH ...&state=in.(requested,creating)` setting `state='failed'`, `error`, `result='failed'`, `ended_at` and `version = v + 1`. Then it calls `room.event {kind:'worker.failed'}` the same way.
   - `error` is whole sentences that end with what to do next (section 15).
9. **Status rows.**
   - `(sales-desk, rooms)`: at least every 30 s. The health line turns red at 90 s; the watchdog alerts at 10 minutes.
   - `(sales-desk, room-hosts)`: from the host check every 10 minutes.
   - **[DB]** Add `room-hosts` to the watchdog (section 10).
10. **Timeouts.**
    - SQL R1 fails a room still `requested` at 60 s.
    - SQL R2 fails a room still `creating` at `claimed_at + 120 s`.
    - The worker itself fails only rooms older than 10 minutes, plus a Meet link still pending at 30 s.

---

## 8. The handover claim: `live.take`, `claim_room`, `live.claimed` [API, UI, DB]

1. **[API] `adoptRefusal` comes first.** It checks the switch, the test list, a client and do-not-disturb for the handover's contact, before the claim RPC, because the RPC adopts a standby room inside the database. On a refusal, sales-api does not claim and answers the sentence.
2. **The claim.** `select * from cockpit_sales_live_claim(p_live_id, p_email, null)`. Take sends no version (lc-ui F17). An empty answer is a refusal: "Someone else took this lead." (409; the UI's "lost").
3. **What sales-api does next** depends on `claim_room` on the returned row:
   - **`standby`:** the taker's standby room was adopted. If the room is `host_in`, the link is due: apply `adopt` semantics. In practice sales-api claims `link_claimed_at` with a guarded write and sends. It answers `{room, claim_room}`.
   - **`own_room`:** the taker already had a room for this lead. The link is due as above, and the answer is `{room}`.
   - **`lead_room`:** the lead is already in a room. The taker gets that room's view (they join with `join_url`), and nothing goes to the lead.
   - **`busy`:** the lead has a booked room open, so no room was made. The answer carries `line: "The lead has a booked call open, so no room was made."` The sweep's L2 ends the handover (`lead_has_booked_room`).
   - **`none`:** sales-api makes a room through the `room.create` path (purpose `handover`, `handover_id`, the taker's default provider). The lead's cancelled room then points at it through `replaced_by`.
4. **Finishing.**
   - The claim stored `live.claimed:{live_id}:{reoffers}` with `lease_until = now() + 60 s`, so the request that made the claim holds it.
   - When step 3 is done, sales-api sets that event's `handled_at`.
   - If it fails, sales-api clears `lease_until`. The sweep then replays it through `sweep.replay`, and the `live.claimed` handler re-runs step 3 from `detail.claim_room`. Every branch is idempotent: the message on its per-channel request id (0b.3), and the room create on `request_id = live_id`.
5. **Words and Slack.** The `live.claimed` event `text` (the database's words) shows in the room's timeline. Slack posts and the App Home view are published again by `live.press` (project 2). **[API]**

---

## 9. Refusal handling [API]

- **`createRefusal`, `adoptRefusal` and `wrapPlan`** run before anything is written. Their sentences are roomlogic's `ROOM_COPY.refusals` and `LANE_COPY`, pinned word for word.
- **Conditional writes.**
  - Every change roomlogic returns is written with `PATCH ...?id=eq.X&{guardFilter(expect)}` and `return=representation`.
  - An empty answer means someone else wrote first: read again and apply again, at most `MAX_WRITE_TRIES` (5) times, then answer `stale`.
  - Effects run only when the write landed.
- **23505 on insert,** read by constraint name, never by guess:
  - `cockpit_sales_rooms_request_id_key`: the same request again. Answer the existing room.
  - `cockpit_sales_rooms_code_key`: only when a code was given. Insert again without one.
  - `cockpit_sales_rooms_one_per_lead`: `lead_has_room`.
  - `cockpit_sales_rooms_one_per_host`: `host_has_room`.
  - `cockpit_sales_live_one_open_per_lead`: "This lead is already being handed over."
- **The lead checks.** `contact_unread` (503, retry) when HighLevel cannot be read. A lead is never treated as clear.
- **Errors redacted.** Errors and event details pass through `redactRoom`.
  - **[API]** Add `zak=` and `pwd=` to `lib.ts` `redact`, as the worker's `http.py` already does.

---

## 10. Database deltas [DB] (folded into `20261003a` and `20261003c` in place, with checks; 0b.1)

**Rooms**
1. `cockpit_sales_rooms` adds:
   - `link_claimed_at timestamptz`;
   - `count_undo_at timestamptz`;
   - `link_unconfirmed_at timestamptz`.

   None of them moves `version`.
2. The `open_device` check becomes `('phone','tablet','computer')`, with null meaning not known.
3. Index `cockpit_sales_rooms (provider_meeting_id) where provider_meeting_id is not null`, for the door's lookup.

**The sweep**

4. **The pending-events hold.** R3, R4, R5, R6, R8 and R7 skip a room while an unhandled event of a replayable source (`zoom`, `worker`, `claim`) for it is younger than `REPLAY_MAX_AGE_S`. The hold lasts at most until the rule's due time + 300 s (lc-logic F4 and F5).
5. **The open grace capped.** R4's `coalesce(last_open_at, first_open_at) + open_grace` may not pass `coalesce(link_sent_at, opened_at) + lead + open_grace` for a room that is not booked, nor `ends_at` for a booked room (lc-logic F12 and F18).
6. **The tick posts.** `cockpit_sales_rooms_tick()` posts `tick` as S4 sets out.

**Presence and watchdog**

7. Align `cockpit_sales_presence` with `presenceOf` and `defaultProvider` (S5).
8. Watchdog rows:
   - `(sales-desk, room-hosts)`: 20 minutes stale, on with `rooms.enabled`;
   - `sales-live/zoom`, `/slack`, `/open`, `/go` and `/cron`: failing-only, with no stale check, on with `rooms.enabled` (the Slack row with `live.slack`). `config:sales-live/*` alerts come from the door itself.

**Follow-up agent**

9. Wave tables, as the desk writes them:
   - `cockpit_sales_followup_waves` adds:
     - `enrolled_at timestamptz`;
     - `done_reason text` (300 characters at most);
     - `settled_at timestamptz`;
     - index `(state, settled_at)`.

     It keeps `made_by` (sales-api writes it); the desk's notes say `created_by`, and that name is folded into `made_by`.
   - `cockpit_sales_followup_wave_members` adds:
     - `next_try_at timestamptz`;
     - `later_reason text` (300 at most);
     - `fail_count integer not null default 0`;
     - `last_error text` (300 at most);
     - `due_at timestamptz`;
     - `replied_at`, `booked_at` and `closed_at timestamptz`.
   - The member state check gains `closed`, the desk's 14-day close. `done` and `failed` stay valid.
   - Member indexes:
     - `(wave_id, state, next_try_at)`;
     - `(sent_at)`;
     - `(due_at)`;
     - `(state, drafted_at)`.
   - The one-open index stays as built (`..._one_running` on `waiting`, `held_out` and `drafted`). The desk reads only 409 or 23505, never the name.
   - `cockpit_sales_followup_meta` adds `hold_reason text` (300 at most).

**Checks**

10. Add checks for each item above to `20261003_rooms_checks.sql`, plus:
    - the S5 fixture comparison;
    - the lease checks from section 6;
    - the tick post body and secret header, checked inside the rolled-back run as today.

**Out of scope**

11. Three existing cron jobs (`mahara-sync-business`, `mahara-sync-overnight`, `mahara-sync-activities`) keep a literal bearer token in their command. They are not live-calls work. Flag them for a separate fix.

---

## 11. sales-api work list [API]

**Rooms**
1. **A new `rooms.ts`** with every action in section 4 and the `room.event` handler in sections 5 to 8.
   - `ACTIONS` gains the seat actions.
   - `DESK_ACTIONS` gains `room.event`, `live.press`, `thread.tick`, `reply.seen` and `followup.send_due`.
   - `CRON_ACTIONS` gains `room.event`, `live.press`, `thread.tick` and `reply.seen`.
   - `room.settle` is not added.
2. **roomlogic changes:**
   - `ready` on an open room (S2);
   - `owner: 'sql'` for `tick` (S1);
   - the six new RoomView keys;
   - the cancel-during-creating version rule (section 4).
3. **Desk handlers build the host seat's `Who`** before they mark or send. `refuseMark` and the sender ceiling count by `sent_by`.
4. **The message service** is keyed per channel on a UUID made from `mahara-room/link/{room_id}/{channel}` (0b.3). It writes `link_sent_at`, `link_channels`, `link_message_ids {channel: id}` and, when a template is not seen within 20 s, `link_unconfirmed_at`, then sends email.
5. **Test contacts** are checked first. A room is booked only on `rooms.test_calendar_id`. `count_on_join` stays off.
6. **The dialer's queue hold** uses `heldContacts`. A booked room holds no lead. It lives in `index.ts` `candidates` through `rooms.held` (0b.18).
7. **`lib.ts`:**
   - `redact` adds `zak=` and `pwd=`;
   - `TEMPLATE_VARIABLES` adds `call_time`, so a manager can save the `demo_host` templates;
   - `FOLLOWUP_SEGMENTS` adds `reactivate`, and `good_intro` in phase 2.

**The door (sales-live)**

8. `cron.ts` accepts `sweep.settle` and `tick` (S4).
9. The README's "claim before it acts" paragraph is replaced by the lease (S3).
10. roomlogic `zoomDedupeKey` stays only as a test of the door's key. sales-api never computes a key.

**Settings and follow-ups**

11. **Settings saves keep every key** (lc-db and lc-desk finding 17).
    - `whatsappGuardSave` and `followupSettings` spread `...before`, so a save keeps the keys it does not edit.
    - They validate the new keys with the desk's bounds:
      - `waves.per_day` 0 to 200;
      - `holdout_share` 0 to 0.5;
      - `batch_gap_s` 30 to 3600;
      - `first_hours` two ordered hours in 0 to 24;
      - `stop_pause_days` 1 to 90;
      - `template_budget_usd_month` 0 or more.
    - They keep `autosend.reactivate` false.
    - Each comes with a test that a save keeps every key it does not edit.
12. **Follow-up agent actions** (desk NOTES section 4): `followup.wave`, `followup.batch`, `followup.hold`, `followup.send_due` and `followup.stop_task`. They take the shapes and refusals given there, including the `hold_all` set.
13. **Follow-up checks** (desk NOTES section 5):
    - `sendFollowup`'s first-message hours, `followups.first_hours` [9, 18);
    - one clock: `leadHour` takes the desk's UTC+4 list for every UAE and Oman place;
    - a fixed `reactivate` opener;
    - the "conversation moved on" check aligned with the desk's;
    - `followupAutosend` refuses WhatsApp while the gate is shut;
    - wave health counted per source;
    - the month's template budget refused as `hold_all` in every template send;
    - `followups.enabled` off refused as `hold_all`.

**Project 2**

14. **`live.press`.** It posts its own success. On a refusal it answers 4xx `{ok:false, error}` and posts nothing; the door says the sentence once. An App Home press publishes the Home view again with `view_id`.

---

## 12. Screens and wiring [UI]

1. **Wire the built components into the shared files** (touched by the UI lane only):
   - `SalesBanner` goes in `App.tsx`'s banner slot, in place of `portalBanner` when it has nothing to say;
   - `RoomPanel` goes in `DialerPage.tsx` and `LeadPage.tsx` (P1 places it).
2. **The Team page:**
   - the health line, with the five `sales-live` status rows and `(sales-desk, room-hosts)`, read through `useWorkerStatus`;
   - the seat's Zoom user and default room. These are P2 fields, and they need a sales-api save action and an audit row.
3. **Refusals.** Read `code` from refusals once sales-api sends it (section 3). Keep the two matched sentences until then.
4. **The pinned key list.** Update the RoomView key list in `rooms.review.test.tsx` when the API adds the six keys.
5. **Follow-ups.** `FollowupsPage.tsx` `SEGMENT` gains the label "Backlog opener" (desk NOTES section 5). The wave screens (start, pause, approve a batch, the stop task) follow the actions in section 11, item 12.
6. **Not verified in the lane.** The UI lane has no DOM test library. The press handlers were checked by hand in a browser against a fake server. Repeat that check against the real sales-api on the test contact.

---

## 13. Desk, worker, cron and runbook [OPS]

1. **The worker's events carry `text`** (section 2, item 8). Verify the case in section 7, step 5.
2. **VPS cron:**
   - `rooms --for 57` every minute under `flock -w 10`;
   - `rooms --check-hosts` every 10 minutes;
   - `doctor --cron` at :05;
   - `waves` every 5 minutes;
   - `followups` at :07 and :37, as it runs today (making it hourly would halve drafting).

   All five lines are now in `hermes/sales-desk/README.md` "Cron", and `desk.py deploy-check` reads them from `crontab -l`. This settles the glossary's 1.7: the rooms worker runs under cron, not as a systemd service (build brief).
3. **The VPS Slack poster** sends `slack.reply` events as DMs (project 2, with the bot token on the VPS). Built in `desk/slackpost.py`: it runs inside the rooms run only while `live.enabled` and `live.slack` are on, takes each reply with the lease, and writes the `(sales-desk, slack)` status row. `SLACK_SALES_BOT_TOKEN` is not set yet.
4. **Runbook.** Done: the top-level `RUNBOOK.md` has "Live calls: video rooms and the Slack poster" and "Follow-up agent and backlog waves", with the Zoom endpoint check, the phase-0 Zoom test, `waves --pools` before showing numbers, and the daily orphan-booking check.
5. **Before any wave copy shows a number,** run `desk.py waves --pools` read-only. The new 24-hour and demo-calendar rules lower the earlier counts (179 good intros, 227 unclosed demos).
6. **Read the Zoom endpoints on Mahara's plan once:** the live participant list and the past-meeting participant report. If either is missing, the worker says so, and that is safe but noisy.
7. **Phase-0 Zoom test:** does `meeting.ended` fire when the host leaves, and what do its fields mean (lc-logic F9)?

---

## 14. Follow-up agent: the desk lane's requests, by lane

| Request (desk NOTES) | Lane |
|---|---|
| Wave, member and meta columns, and member state `closed` (section 10, item 9) | DB |
| Segment check `reactivate`: already in `20261003b`. `good_intro` waits for phase 2 | DB (done) |
| `opener_ar` and `opener_en` template rows, inactive: already in `20261003b` | DB (done) |
| Watchdog rows `(sales-desk, waves)` 15 minutes, `(sales-desk, model)` on `ok=false`, `(sales-desk, doctor)` 75 minutes: already in `cockpit_sales_watchdog()` | DB (done) |
| Settings saves keep keys; follow-up actions; `send_due` in `DESK_ACTIONS`; first hours; one clock; fixed openers; budget and off-switch refusals | API |
| Segment label, wave screens | UI |
| Cron lines (done in the README), runbook rows, pool recount | OPS |

---

## 15. Who owns which words

| Words | Owner | Rule |
|---|---|---|
| Room panel, room line, availability strip, banner (the browser) | UI (`rooms.ts`, the components) | The UI composes every state sentence from RoomView fields. roomlogic's `panelLine` and `stripLine` are for Slack and App Home only |
| Refusal sentences (every action) | API (roomlogic `ROOM_COPY.refusals`, `LANE_COPY`) | Shown by the UI word for word. "This changed a moment ago." and "The lead is still in this room. End it anyway?" never change while the UI matches them |
| Health line | API (roomlogic `roomsHealth`) | The UI shows `line`, and keeps its own fallback only when `line` is empty |
| `rooms.error` | The writer: the worker (`SAY` in `rooms.py`) for making a room; the SQL sweep for its timeouts; roomlogic `LANE_COPY` for sales-api's own failures | Whole sentences that end with what to do next. The UI shows a text with two or more sentences as it is, and wraps a single clause. Single-sentence `LANE_COPY.worker_late`, `worker_lost` and `worker_failed` gain a next step |
| `rooms.refusal` (why the link could not go) | API (message service) | One sentence with the next step |
| `room_events.text` (timeline) | Whoever stores the event: the door (Zoom, opens), the worker, the SQL sweep and claim, sales-api | Required; plain; no names of team members; no links, tokens or host links |
| Messages to the lead (WhatsApp text, template, email) | API (message service) with the templates in `cockpit_sales_wa_templates` | Arabic lines under `aziz-kuwaiti-voice`. The template rows ship inactive until the CEO approves `final_arabic.md`'s drafts |
| The short page and `/go` | API (sales-live `GO_COPY`, `sites/call-link`) | Marked DRAFT, in the door README's approval list. No punctuation right after the link in templates |
| Slack offers, App Home, Slack refusals | API (`live.press`, roomlogic `offerLine`, `appHomeReadyLine`) | P2's Slack table. The door says a refusal sentence once |
| Alerts (`cockpit_sales_alerts.message`) | The writer, passed through `cockpit_sales_alert_words` | Cut at a whole sentence; first names become roles; email addresses removed |
| Status rows (`worker_status.detail`) | Each job | A plain sentence. Missing is never zero |
| Follow-up drafts, waves and model rows | OPS (desk) | As NOTES section 1 |

---

## 16. Not verified, still open

- **Nothing is deployed or applied.** The migrations, both Edge Functions, the cockpit build and the VPS cron lines all wait for a deploy; `desk.py deploy-check` on the VPS is the check before any switch is turned on.
- **Real services not exercised:** HighLevel's appointment create, move, delete and status calls and the room-code and call-time contact fields; Slack `chat.postMessage` to a user id; the PostgREST answers for a GET on the lease function and the `detail->>done` filter; the two Zoom endpoints. The press handlers were checked only in the harness, never against the real sales-api on the test contact.

- **Parallel claims.** Fifty claims at once against committed rows need a Supabase branch (lc-db, lc-logic, lc-worker).
- **One orphan booking case.** A count that crashes after its own result write missed, and before it deletes its booking, leaves an orphan booking. Only a daily check of "Live ·" bookings against `count_result` catches it (lc-logic). **[OPS]** Add that check to the runbook.
- **The booked demo's Zoom ID.** Booked demos that reuse a closer's personal meeting ID would match other calls on that ID to the booked room (lc-door).
- **The cron door's tick.** Under S4, a forged cron post can ask for re-checks of rows as they stand, and nothing more. The door's rate stays as built.
- **Glossary updates.** The glossary (`final_consistency.md`) needs:
  - 1.5: `room.settle` retired; `followup.send_due` added;
  - 1.7: the rooms worker runs under cron;
  - 1.2: the new columns from section 10;
  - 1.3: the wave member states, including `closed`.
