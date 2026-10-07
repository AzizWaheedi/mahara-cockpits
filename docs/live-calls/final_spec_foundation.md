# 0. Foundation: rooms, availability and messages (final)

Written 2026-10-03 from origin/main `9670e5b`. The sales-api line numbers match `f1ed167`. `api/` means `supabase/functions/sales-api/`, and every table has the `cockpit_sales_` prefix.

This spec is the only contract for:
- rooms, handovers and availability;
- the short link and the webhooks;
- the live booking;
- the `rooms` and `live` settings.

P1 to P4 refer to it and do not redefine any of it.

## What changed after review

1. **One contract (C1).** There is one migration, one `rooms` setting, one `live` setting, one inbound function (`sales-live`), one Zoom URL and one Slack app.
   - Dropped from P1: `room-go`, `room-hooks` and `sites/call`.
   - Dropped from P2: `live_rooms`, `live_seats`, `live_events`, `sales-live-door`, `_assign` and `_take`.
   - P3 and P4 renumber their migrations to `20261003c` and `20261003d`.
2. **Standby rooms (critic).** Pressing Available opens the closer's room, as the CEO described, so a room's lead is optional. A Take press is still required, and it serves as the accept step (M12).
3. **Booked calls never get a new room (C2).** A room with purpose `booked` wraps the appointment's own meeting.
4. **The doors use the cron secret (H1).** `room.event` and `live.press` join `CRON_ACTIONS` (index.ts:5085) and `DESK_ACTIONS` (5076). The cron path runs desk handlers only (5136-5140).
5. **One booking claim on the room (C1, H2, H3, M1, M2, M9).** See `countLive` under Integrations.
6. **Joins can be checked (H6, M10).** There is no timestamp window, Zoom rooms get manual buttons after 30 s, Zoom's participant report is the second source, and a watchdog runs inside Supabase.
7. **The system never ends a room with a lead in it (H7).** Busy checks read HighLevel live (H8).
8. **Google is per rep (H9).** Each rep has their own `calendar.events` token on the VPS. There is no domain-wide delegation.
9. **WhatsApp isolation (H5, M3, M7).** Rooms keep their own health check, workflows allow re-entry, the read-back matches the message text, and the WA Connector switch-off is enforced in code.
10. **One Zoom setup (M8).** People outside the account go to the waiting room, and both join events are subscribed.
11. **Smaller fixes (M11 and LOW).**
    - Handovers require the short link, and the link follows a replaced room.
    - The short page shows a device hint.
    - The worker runs under systemd.
    - `sales-live` answers Slack's `url_verification`.
    - The test contact's do-not-disturb is checked first.
    - Templates get a `join` field.
12. **Not for this spec.**
    - H4 belongs to P3.
    - M4 does not arise, because a room sends one message.
    - M5 belongs to P4.

## Outcome and success numbers

The foundation is three shared services: rooms, availability and messages. It also adds the door `sales-live` and the short link `call.maharamedia.com/{code}`. It uses no AI, so the lapsed VPS sign-in does not block it.

**Volume.**
- New tagged leads per week, starting 24 August: 65, 55, 21, 4, 1, 0.
- No calls are booked ahead, and the cockpit has logged 12 dials ever.
- This work lifts rates. It creates no leads.

Success over the first 14 days after phase 2:
- 95% of rooms have a join link within 15 s.
- Zero mix-ups, checked daily by SQL. A mix-up is two open rooms for a lead or host, a double claim, or a link sent to another contact.
- Every room ends in a named final state with a reason.
- The health line turns red within 90 s of the worker stopping, and the CEO gets a Slack alert within 10 minutes.
- The joins in every Zoom room match Zoom's participant report.
- The rescue rate is recorded as a baseline only. It is the share of unconnected cockpit dials whose lead joined a room. It sits beside the share of Maqsam calls placed through the cockpit.

## Who does what

- **Setter:** makes a room for any lead, hosts intro rooms, and asks for handovers.
- **Closer:** presses Available, joins their standby room, takes offers, and admits the lead.
- **Lead:** taps one short link.
- **Manager or CEO:** holds the switches, reads the health line, and can end any room.
- **System:**
  - the VPS worker makes rooms and posts to Slack;
  - `sales-api` guards, sends and counts;
  - `sales-live` takes callbacks;
  - pg_cron runs the sweep and the watchdog.

## The flow, step by step

**Fallback room after a failed call**
1. The setter presses "Send a video link". The browser calls `room.create` with `{contact_id, provider, call_kind, purpose, request_id}`.
2. `sales-api` checks the seat, the switches, `isClient` (`api/clients.ts:13`), `dndFor` (`api/lib.ts:428`) and the host. It then inserts a `requested` room with a code (for example `K7Q2MX`) and writes an audit row.
3. The worker claims the room (`state=eq.requested` → `creating`). It makes the Meet event on the rep's own calendar, or the Zoom meeting. It saves `join_url`, puts `start_url` in `room_secrets`, and sets the room to `open`.
4. With `send_on=open`, the link goes out at once.
5. "Open my room" gives the host link to the host only. Zoom's host-joined event, or the rep's "I'm in", sets `host_in`.
6. The lead taps the link. A Zoom join from outside the account, or the rep's "The lead is in", sets `lead_in`. `countLive` runs where it applies.
7. `meeting.ended`, "End room" or the sweep sets `ended`. The worker deletes `start_url`.

**Standby and handover**
1. The closer presses Available, which lasts 2 hours. The worker makes a `standby` Zoom room with no lead. The closer joins it and becomes `ready`.
2. The setter presses "Bring in a closer" and writes a note. `sales-api` then:
   - reads each closer's HighLevel events for the next 60 minutes;
   - drops any closer with a call due within the call length plus 10 minutes;
   - offers the lead for 120 s to every closer who is `ready` or `available`.

   The offer shows on the strip within 4 s and in Slack within a second.
3. The first Take press runs `cockpit_sales_live_claim`.
   - If the closer has a standby room, that room is adopted: the lead is set, `purpose` becomes `handover`, and the link goes out at once.
   - Otherwise `room.create` runs with `send_on=host_in`.
4. The lead waits in Zoom's waiting room until the closer admits them.
5. If nobody takes the offer within 120 s, it expires. Every closer it went to is set to Away, and the setter sees "Book a demo instead."

**The lead just replied.** This is the same handover. The link goes as free WhatsApp text.

**A booked call on either demo calendar.**
- `room.wrap` reads the appointment from HighLevel and takes the Zoom meeting id from its `address` field.
- It stores a `booked` room in state `open` without calling Zoom or Google. The short link then opens the closer's own meeting.
- For a phone intro, the panel says: "This call is on the phone. There is no link to send."

## States and transitions

**Room**

| State | Entered when | Left when | Timeout |
|---|---|---|---|
| requested | inserted | worker claims | 60 s → failed |
| creating | claim wins | link saved, or refused | 60 s → recover (code in Zoom topic; Google event id) or fail |
| open | link saved | host_in, Meet lead mark, cancel | `host_by`: 120 s handover, 15 min fallback, start + 15 min booked |
| host_in | host joined, or "I'm in" | lead_in | `lead_by` 600 s after the link; standby refreshed at 35 min |
| lead_in | outside participant joined, or rep's mark | meeting ended, End room | never ended by force |
| ended, expired, failed, cancelled | final | never | provider side closed within 60 s |

"Opened" and "lead waiting" are timestamps, not states. A `lead_in` room with no end event by `ends_at` plus 30 minutes is marked `ended` with "No end signal from Zoom". No end call goes to Zoom.

**Handover (`live`)**

| State | Entered when | Left when | Timeout |
|---|---|---|---|
| offered | setter presses | claim or cancel | 120 s → expired; offered closers go Away |
| claimed | claim wins | room host_in | 120 s → expired |
| room_ready | claimer in the room | room lead_in | 600 s → expired |
| lead_joined | room lead_in | room ends (done) | the room's |
| done, expired, cancelled | final | never | none |

**Locking rules**
1. **Partial unique indexes** allow:
   - one open room per lead (refusal: "This lead already has a room open. Open it.");
   - one open room per host, except `booked` rooms;
   - one open handover per lead;
   - one claimed handover per closer.
2. **One claim function** serves the cockpit and Slack: `update ... where id=$1 and state='offered' and offer_until>now() and $2=any(offered_to) returning *`.
   - An empty result shows "Someone else took this lead."
   - A 23505 error shows "You already have a live call."
3. **Stale buttons.** Every write carries the `version` it saw. A mismatch returns "This changed a moment ago."
4. **Retries, timers and late events.**
   - A repeated `request_id` returns the first row (`index.ts:936-943`).
   - Timers live in columns.
   - `room_events.dedupe_key` is unique, and late events never reopen a room.

## Edge cases and failure handling

| Case | What happens |
|---|---|
| Host's Zoom busy | "Your Zoom is in another meeting. End it or use Meet." |
| Zoom demo on a Basic host | "The closer's Zoom is Basic and ends at 40 minutes. Use Meet for this demo." Wrapped demos on Basic hosts are flagged on the health card. |
| Setter's Zoom pending | Meet becomes the setter's default. |
| Rep has no Google token | "Connect your Google calendar on the Team page first." |
| Meet link still pending after 30 s | "Google did not make the Meet link. Try Zoom." |
| No Zoom event 30 s after the link | [I'm in] and [The lead is in] appear. |
| Zoom event lost for good | The participant report check turns the room red. |
| A booked call is near for a ready closer | An empty standby room ends 10 minutes before the call. A room with a lead in it is never ended; both reps get an alert instead. |
| Handover re-routed after the link went out | `replaced_by` is set, and the short link follows it. |
| WA Connector switch-off not confirmed, or two identical outbound messages within 60 s | Room WhatsApp sends stop. Email and read-out still work. |
| A staff member joins Zoom without signing in | They look like the lead. "That was not the lead", pressed within 5 minutes, returns the room to host_in. |

## Data model and settings

The migration is `supabase/migrations/20261003a_sales_rooms.sql`. It copies the pattern of `20261002e_sales_client_forms.sql`:
- RLS on, with a seat read policy through `cockpit_sales_seat()`;
- revoke from public, anon and authenticated;
- select for authenticated, and all for service_role;
- end with `notify pgrst`.

**`rooms`**
- **Identity:** `request_id` and `code` are unique. The code matches `^[A-HJ-NP-Z2-9]{6}$`, which gives 1.07 billion codes.
- **What it is for:**
  - `contact_id` (null for standby);
  - `purpose` (fallback, handover, standby, booked, manual);
  - `call_kind`, `provider`, `host_email`, `made_by`;
  - `appointment_id`, `handover_id`, `replaced_by`.
- **State:** `state`, `version`, `error`.
- **Provider and link:** `provider_meeting_id`, `join_url`, `send_on`.
- **Deadlines:** `host_by`, `lead_by`, `ends_at`.
- **Times:** one `_at` column per step.
- **Messages:** `link_message_ids`, `open_device`.
- **The booking claim:** `count_claimed_at`, `count_appointment_id`, and `count_result` (booked, moved, not_a_lead, failed, undone).

**Other tables and the view**
- **`room_secrets`:** `room_id`, `start_url`, `expires_at`. Only the service role can read it.
- **`room_events`:** `room_id` (null for system events), `kind`, `source`, a unique `dedupe_key`, `handled_at`, and a redacted `detail`.
- **`room_hosts`:** `email`, `zoom_user_id`, `zoom_status` (licensed, basic, pending, missing), `zoom_live_until`, `google_ok`, `default_provider`, `checked_at`.
- **`availability`:** `email`, `state` (away, available), `until`, `via`, `reason`. Every seat reads every row. This table is needed because `cockpit_sales_people_own_read` stops seats reading other rows in `people`.
- **`presence` (a view).** The first state that applies wins:
  1. `on_call`: an open attempt, a room in lead_in, an appointment running now, or a live Zoom meeting.
  2. `ready`: in their own room with no lead.
  3. `available`.
  4. `away`.
- **`live`:** `request_id`, `contact_id`, `asked_by`, `kind`, `reason` (on_call, replied, manual), `note`, `state`, `version`, `offered_to`, `offer_until`, `claimed_by`, `room_id`, `slack_posts`.

**Functions** (only the service role may run them)
- `cockpit_sales_live_claim`.
- `cockpit_sales_rooms_sweep()`, every minute.
- `cockpit_sales_rooms_watchdog()`, every 5 minutes. During working hours it checks the age of the `rooms`, `followups` and `threads` status rows. It posts once per incident, through pg_net, to a Slack incoming webhook held in the vault.

**Queue hold.** `roomHolds` keeps a lead out of `candidates()` only while its room is not final and its deadline is still ahead (M6).

**Settings.** Every seat can read them, so they hold no secrets.

```json
"rooms": {"enabled": false, "test_only": true, "test_contacts": ["VjPfR4Cc1Y0OFvaqeor5"],
  "test_calendar_id": null, "providers": {"zoom": false, "meet": false},
  "default_provider": {"setter": "meet", "closer": "zoom"},
  "send": {"whatsapp_text": false, "whatsapp_template": false, "email": false},
  "wa_connector_off": false, "template_route": "call_link", "count_on_join": false,
  "waits_s": {"ready": 15, "fail": 60, "meet_pending": 30, "fallback_host": 900, "handover_host": 120,
    "lead": 600, "manual_buttons": 30, "standby_max": 2100, "booked_guard": 600},
  "lengths_min": {"intro": 30, "demo": 60}, "available_hours": 2, "short_link": false}
"live": {"enabled": false, "closer_wait_s": 120, "slack": false,
  "hours": {"days": [6,0,1,2,3,4], "from": "10:00", "to": "20:00", "tz": "Asia/Kuwait"}}
```

A new `wa_fields` entry, `join` (contact field `cockpit_join_code`), is shared with P4. Sends use `messages.source='rep'`, so no existing constraint changes.

## Integrations and calls

**Rooms are made on the VPS.** The Zoom keys and the rep tokens stay there.
- **Code:** `hermes/sales-desk/desk/rooms.py`. It reuses `ZoomApp` (`hermes/webinar-pull/pull.py:315-345`) and `Drive.token` (`hermes/editor-desk/desk/drive.py:67-82`).
- **How it runs:** as the systemd service `sales-desk-rooms`, with `Restart=always` and `EnvironmentFile=/opt/data/bibi/api-keys.env`. A `flock -n` cron line, in the `README.md:332` format, restarts it if it is down.
- **Pace:** it claims up to 3 rooms a second and writes the `rooms` status row every 30 s.

| Call | When | Idempotency, retries |
|---|---|---|
| Zoom `POST /users/{id}/meetings`: type 2, no `start_time`, topic "Mahara call {code}", waiting room for `users_not_in_account`, no recording | creating | code in topic; 2 tries |
| Zoom live-meeting check, end-meeting call, participant report (paths UNVERIFIED) | before create; after final, never in lead_in; doctor | reads, safe repeats |
| Google `events.insert?conferenceDataVersion=1&sendUpdates=none`, rep's calendar, id = room UUID hex, title "Mahara call {code}", no attendees | creating | event id; 30 reads at 1 s |
| HighLevel `GET /calendars/events/appointments/{id}` and a user's events (parameters checked on day 1) | wrap, offer, standby guard | reads |

**Message service** (`api/rooms.ts`, reusing the internals of `convo.send`). It tries the channels in this order:
1. **WhatsApp free text.** It goes only when all of these hold:
   - the window is open (`lib.ts:412`);
   - the lead is not on do-not-disturb;
   - `send.whatsapp_text` and `wa_connector_off` are both on;
   - fewer than 30% of the last 20 room WhatsApp sends failed.

   It never reads the global `whatsappHealth` (1029), so a bad wave elsewhere cannot block a live call.
2. **Template.** `call_link_*` goes through `sendTemplate` (1141) after `cockpit_join_code` is written, within its limits (1168, 1177). If the template text does not appear in the conversation within 20 s, the panel says "not confirmed" and email goes too.
3. **Email** from info.maharamedia.com.
4. **Nothing can go.** The panel shows the code for the rep to read out.

Each send writes a messages row, a `message_sent` confirmation for intro items (1992) and a `link_sent` event.

**Short link.** `sites/call-link/` is a Vercel site on `call.maharamedia.com`, copied from `sites/webinar/live.html`.
- **How it opens the room:** its script fetches `sales-live/open/{code}`, shows the opening line and the app hint, then opens `join_url`.
- **Previews:** bots do not run scripts, so link previews never count as opens. The `<noscript>` fallback uses the 302 at `sales-live/go/{code}`.
- **Privacy and limits:** the IP is kept only as a salted hash, with at most 30 opens a minute.
- **Before the CNAME exists:** fallback rooms send the raw link, and handover links are read out.

**`sales-live`** is deployed with `verify_jwt = false`. Its secrets are `ZOOM_WEBHOOK_SECRET`, `SLACK_SIGNING_SECRET`, `IP_SALT` and the shared `CRON_SECRET`.
- **`POST /zoom`:**
  1. It answers `endpoint.url_validation`.
  2. It checks `x-zm-signature` with no timestamp window.
  3. It stores the event and replies 200.
  4. Inside `EdgeRuntime.waitUntil`, it calls `room.event` with `x-cron-secret`. The sweep replays any event still unhandled after 20 s.
- **Zoom events subscribed (seven):** meeting started, meeting ended, participant joined, participant left, participant joined waiting room, jbh waiting, jbh joined.
- **Who is who:** staff are the host or anyone who matches `room_hosts`. The lead is the first other participant.
- **`POST /slack`:** it checks the signature with a 300 s window and answers `url_verification`. Button presses, `/available` and `/away` go to `live.press`. That action maps the `slack_user_id` to a seat, runs the claim, and replies through `response_url`.

**`countLive`** (in `api/rooms.ts`). It runs at `lead_in` when `count_on_join` is on, per decision 2.
1. **Claim.** It sets `count_claimed_at` only where it is null. A contact without a roas tag gets no booking (`not_a_lead`).
2. **Book.** If the lead has an `upcoming` call (3490), a PUT moves it to now. Otherwise a POST creates one with:
   - the calendar: the test calendar for test contacts, the intro calendar by tag, or the booking form's demo calendar (`dialer.ts:773`);
   - a start at the minute the lead joined, and a length of 15 or 45 minutes;
   - the host as `assignedUserId`, and status `confirmed`;
   - `ignoreFreeSlotValidation` and `ignoreDateRange` true, and `toNotify` false;
   - `meetingLocationType` custom, with the short link and `overrideLocationConfig`;
   - the title "Live · {first name}".
3. **Copy.** It reads the booking back and writes `start_at` into `cockpit_sales_appointments`, as `bookCreate` does (3699-3716).
4. **Mark and move.** It calls `markAppointment(host, id, "showed", {anyRep: true, quiet: true})`. The new `quiet` option is passed to `writeMarkToCrm` (263). Then it calls `setOwner` (3754) and `autoMove` (4154).
5. **Undo.** "That was not the lead" deletes a booking it created, or moves a moved one back. It never marks the call invalid, because B2B counts invalid as shown.

## Screens and copy

**Availability strip** (`AvailabilityStrip.tsx`, in the banner slot at `App.tsx:247`). It polls every 4 s, or every 30 s when Away.

| State | Copy |
|---|---|
| Away | "Away. Live leads skip you." [I'm available] |
| Available | "Available until 16:30. Join your room to get leads first." [Join my room] |
| Ready | "In your room until 16:30. The next live lead comes to you." [Set me away] |
| Offer | "Live demo lead, Saudi Arabia, on the line with the setter." (bold), "Note: {note}." muted under it, the countdown "1:47 left" in mono beside [Take it] [Not now] |
| Taken | "Taken. Sending the link..." |
| Lost | "{name} took this one." |
| Missed | "You missed a live lead at 14:04 and are now Away." |
| Refresh | "Zoom closes a room 40 minutes after only one person is left. Stay available?" [Keep me available] [Stop] |
| Booked call | "Your booked demo starts at 15:00, so your room is closed. Press I'm available after it." |

(Design review, 4 October: "Go away" became "Set me away" everywhere it shows, matching "I'm available", and Away says what it means for the seat.)

**Room panel** (`RoomPanel.tsx`)

| Moment | Copy and buttons |
|---|---|
| Making | "Making your Meet room..." |
| Ready | "Room ready." [Open my room] [Copy link] [End room] |
| Link sent | "Link sent on WhatsApp at 14:02." |
| Not confirmed | "Not confirmed on WhatsApp. Sent by email too." |
| Not sent | "Not sent: {reason}. Read it out: call.maharamedia.com/K7Q2MX" |
| Opened | "The lead opened the link at 14:03 on a phone." |
| Waiting room | "The lead is in the waiting room. Admit them in Zoom." |
| Host in | "You are in. Waiting for the lead (9:12 left)." [The lead is in] |
| Joined and counted | "The lead joined at 14:04. Booked and marked shown in HighLevel." [That was not the lead] |
| Joined, not a lead | "The lead joined at 14:04. Not counted: this contact is not a tagged lead." |
| No join | "The lead did not join in 10 minutes. Room closed. Call again or send a message." |
| End with lead in | "The lead is still in this room. End it anyway?" |

**Health line**
- Working: "Rooms: working. Last run 14:03:58. 6 rooms today, 0 failed."
- Down: "Video rooms are not being made (last check 13:52). Call the lead on the phone, or send your own Zoom or Meet link."
- Mismatch: "Zoom and the cockpit disagree on 1 room today. Open its timeline."

**Slack** (app "Mahara Sales")

| Message | Copy and buttons |
|---|---|
| Offer | "Live lead for you: {kind}, {country}, {on the phone with the setter / just replied on WhatsApp}. Take it within 2 minutes." [Take it] [Not now] |
| Taken | "You took it at 14:02. Open your room: {cockpit link}" |
| Lost | "{name} took this lead at 14:02." |
| Expired | "This offer ended at 14:04. You are now Away. Type /available when you are back." |
| `/available` | "You are available until 16:30. Opening your room..." |
| `/away` | "You are away." |
| Unlinked user | "This button is for the sales team. Ask the manager to add your Slack ID on the Team page." |
| Watchdog | "The room worker has not run since 13:52. New video rooms cannot be made." |

**Lead messages.** The Arabic versions are written under `aziz-kuwaiti-voice`.
- **WhatsApp:** "Hi {first_name}, your call with {rep_first_name} from Mahara is ready now. Join here: https://call.maharamedia.com/K7Q2MX"
- **Template `call_link_en` (utility):** "Your call with Mahara Media is ready now. Tap the button to join." Button "Join the call" → `https://call.maharamedia.com/{{1}}`
- **Email:**
  - Subject: "Your Mahara call is ready".
  - Body: "Hi {first_name}, your call with {rep_first_name} is ready now. Join here: {link}. If it does not open, reply to this email and we will call you."
- **Short page:** "Opening your call with {rep_first_name}..." It adds "No Zoom app? Tap Join from your browser." on Zoom, or "Meet needs iOS 17 or the Meet app." on Meet.
- **Ended page:** "This call has ended. Reply to our last message and we will find a new time."

## How it counts in the numbers

- **Rooms are not bookings.** A room is not a booking or a show; only `countLive` books.
- **Live calls are kept apart.** "Live ·" calls are shown separately and left out of the 60% and 75% show targets.
- **Evidence line.** "Shown with evidence" (a mark or a Zoom join) sits beside the B2B rule.
- **Metrics.** They go under `sales.rooms.*` in `cockpit_metric_values`:
  - rooms made, and links sent by channel;
  - opens, joins, and minutes from link to join;
  - the rescue rate, and the share of dials placed through the cockpit.
- **Second sources:**
  - Zoom joins are checked against the participant report.
  - Marks are checked against the HighLevel status.
  - Each day's "Live ·" appointments are checked against `count_result`.
- **Notes beside the numbers.** "Meet joins are the rep's mark; Google gives no join signal yet." A missing Meet join shows as "not known", never as 0.

## Security and privacy

- **Keys.** They stay on the VPS. Function secrets only verify inbound calls. Each Google token reaches only its own rep's events.
- **Host link.** `start_url` reaches only the host, never Slack or logs, and is deleted when the room ends.
- **Topics and titles.** They carry only the code.
- **Checks.**
  - Unsigned callbacks get a 401.
  - The client and do-not-disturb checks run before anything else.
  - Every action writes an audit row, and errors pass through `redact` (`lib.ts:268`).

## Tests and acceptance criteria

- **Unit tests** (`api/roomlogic.test.ts`, `sales-live/*.test.ts`):
  - transitions and codes;
  - the channel matrix and room health;
  - `roomHolds`;
  - both signature checks;
  - staff-or-lead classification on recorded payloads;
  - the bot filter;
  - the `countLive` branches.
- **Desk tests** (`tests/test_rooms.py` on `tests/fakes.py`):
  - the claim race and crash recovery;
  - a pending Google link;
  - the Basic refusal and a busy host;
  - the standby refresh and the booked-call guard.
- **SQL**, on a Supabase branch: 50 parallel claims give exactly one winner.
- **Harness:** `/sales/harness.html?path=/dialer&call=noanswer&room=making|ready|sent|opened|waiting|joined|expired|failed|down&offer=incoming|lost|expired|standby`.
- **Live test**, on `VjPfR4Cc1Y0OFvaqeor5` and the test calendar only. First, the CEO checks whether that contact's do-not-disturb covers every channel. The test passes when:
  - 20 rooms each get a link within 15 s;
  - a guest knocks and is admitted;
  - Zoom events land within 10 s and match the participant report;
  - two tabs press Take and exactly one wins;
  - the "Live ·" booking lands on the test calendar, not in B2B `calls`, and is then deleted;
  - no message goes to any other contact.

## Rollout and build days

| Phase | On | Gate |
|---|---|---|
| 0 | `enabled`, `test_only` | live test passes |
| 1 | Meet fallback for the setter, read-out only | rep tokens; 0 mix-ups; the setter dials from the cockpit |
| 2 | Email and free text; the template once approved | `wa_connector_off` after the single-copy test |
| 3 | Zoom webhooks, standby, handovers, Slack, `count_on_join` | CNAME; intro calendar labels settled (M2); decisions 1 and 2 |

`rooms.enabled=false` is the kill switch.

**Build days (7)**

| Day | Work |
|---|---|
| 1 | Migration, `roomlogic.ts` and its tests |
| 2 | Worker, doctor, systemd unit and runbook row |
| 3 to 4 | `api/rooms.ts`, the message service, `countLive` and the harness |
| 5 | `sales-live`, the short page, the sweep and the watchdog |
| 6 to 7 | Strip, panel, live test and fixes |

**Existing files get hooks only:**
- `index.ts`: an import, the spreads into `ACTIONS` (5011) and `DESK_ACTIONS`, two names in `CRON_ACTIONS`, and the `quiet` option;
- `App.tsx`: one line;
- `candidates()` (2401): P1's filter.

**Deploying `sales-api`:**
- deploy with `--verify-jwt` from a fresh worktree of the latest main;
- check the live version before and after;
- warn the parallel session first;
- record the session in `shared/sessions/`.

## What the CEO must do

1. **Google** (about 15 minutes):
   - Set Cloud project 824095651303's consent screen to Internal and create a web OAuth client. Its current consent type is UNVERIFIED.
   - The setter and the closer each press Allow on the consent link the build provides.
   - Confirm that the setter has a maharamedia.com account (UNVERIFIED).
2. **Zoom:**
   - Go to the Server-to-Server app → Feature → Event Subscriptions.
   - Enter the URL `https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-live/zoom` and the seven events. Do this after `sales-live` is live.
   - Put the Secret Token in `/opt/data/bibi/api-keys.env`. The build copies it into function secrets without printing it.
   - Turn on Waiting Room with custom options, and turn on the passcode in the link.
   - The setter accepts Zoom's invite.
3. **GoDaddy:** add a CNAME `call` with the value Vercel shows.
4. **Slack:**
   - Create the app from the build's manifest.
   - Add an incoming webhook to your DM for watchdog alerts.
   - Invite the setter and the closer.
   - If Slack refuses `/away` as a built-in command (UNVERIFIED), the command becomes `/unavailable`.
5. **HighLevel:**
   - Create `call_link_en` and `call_link_ar`, each with a one-step workflow that has Allow re-entry on, and send the workflow ids.
   - Create a "Cockpit test" calendar outside the B2B map.
   - Read the names of the two intro calendars, so the wrong label can be fixed.
6. **WA Connector:** switch it off.

**Decisions.** The 6 open decisions, plus:
- **A:** rooms are made on the VPS (recommended).
- **B:** per-rep Google tokens (recommended), rather than delegation or the CEO's calendar.
- **C:** do not add the lead's email as a Meet guest.
- **D:** handover hours, Saturday to Thursday, 10:00 to 20:00.
- **E:** a WhatsApp test contact on a staff phone.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| The VPS fails | systemd restart, sweep, red line in 90 s, Slack alert in 10 minutes |
| Zoom Basic: 40 minutes, one meeting per host | refusals, the booked guard, decision 1 |
| The closer's HighLevel Zoom is outside our account (UNVERIFIED) | wrapped rooms use the rep's buttons |
| HighLevel automations fire on a live booking | `toNotify` false and `quiet`; the live test checks workflow history |