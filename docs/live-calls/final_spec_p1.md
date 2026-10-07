# Project 1 spec: a video link when the setter's call does not connect (final)

Code facts: origin/main `9670e5b`, re-checked 2026-10-03; the local checkout is 3 commits behind, so build from the latest main. `api/` means `supabase/functions/sales-api/`; every table has the `cockpit_sales_` prefix. P1 is built on the foundation spec (F) and adds no table, function or Slack app of its own.

## What changed after review

1. **One contract (C1).** P1's own table, states, code, `room-go`, `room-hooks`, `sites/call` and keys in Supabase secrets are gone; P1 uses F's.
2. **Booked demos out of scope (C2).** Intros run on the phone, so no HighLevel Zoom link is duplicated.
3. **Joins reach sales-api (H1).** `sales-live` calls `room.joined` with `x-cron-secret`; the action goes in `CRON_ACTIONS` (`api/index.ts:5085`) and `DESK_ACTIONS` (5076), where the cron path looks it up (5136-5141).
4. **Lost Zoom events (H6).** No timestamp window, dedupe by event key, manual marks after 30 s, participant report as second source.
5. **Official numbers (H2, H3, M1, M2).** Test calendar outside B2B's map; delete, never invalid (whether B2B drops deleted rows is UNVERIFIED); cockpit appointment copy written before marks; untagged contacts never booked; intro calendar labels settled first.
6. **No show-rate leak (critic).** Intro "No answer" writes no mark (`api/dialer.ts:910`), so the draft left missed intros confirmed and counted as shown. Expired rooms now end in a no-show.
7. **Quiet live intros (M9)**, titled "Live · {name}" like P2.
8. **No timer ends a room with the lead in it (H7).**
9. **WhatsApp safety (H5, M3, M7).** Live-call health only; re-entry on workflows; the read-back matches the text, and "Not confirmed" falls to email; locked until the single-copy test passes.
10. **Own sweep; queue hold bound to the deadline (M6).**
11. **F's waiting room, plus `participant_jbh_joined` (M8).**
12. **Code-only Google titles (low).**
13. **Automatic mode (ask 4) and an adoption gate (critic).**
14. **One `call_link` template** for F, P2 and P4, not ending in a variable (low).

Not applicable, one line each: H4 is P3's stop rule; H8 is availability, which P1 never reads; H9 does not arise, because P1 uses F's VPS token with no delegation; M4 is batch sending, which P1 never does; M5 is P4's test; M11 and M12 are handover routing; P1 posts nothing to Slack. F's Supabase watchdog covers M10.

## Outcome and success numbers

When the setter's call does not connect, or the number does not work, the lead gets one link to a Meet room (default) or a Zoom room, and the intro happens on video.

Volume is the limit: 1 booked call in the week of 28 September, none booked ahead today, 12 cockpit dials ever. At September's volume (33 intro no-shows) these targets save about 4 intros a month, about 6 show-rate points; today, about 0. P1 creates no leads.

Targets for the 4 weeks after the pilot (goals, not results):
- **Adoption gate:** 80% of the setter's calls go through the cockpit, checked against B2B `maqsam_calls` (last synced 2026-09-20, so "not known" until it runs, never 0).
- **Coverage:** 60% of not-connected booked intros get a room.
- **Opens:** 40% of sent links, previews excluded. **Joins:** 20%.
- **Safety:** 0 wrong-contact or double sends, 0 messages to clients or do-not-disturb contacts, 0 rooms stuck past 60 s.

## Who does what

- **Setter:** sends the link (or lets automatic mode), hosts, admits, runs the intro. **Closer:** no part. **Lead:** taps one link. **Manager or CEO:** setup, switches, scorecard.
- **System:** sales-api guards, sends, books and marks; the VPS worker makes and closes rooms; `sales-live` resolves links and takes Zoom events.

## The flow, step by step

**Happy path: a booked intro on Meet.**
1. In the intro window (`api/dialer.ts:398-401`), Maqsam reports a call that did not connect (`callSummary`, 733).
2. The CallBand line (`apps/sales-cockpit/src/pages/DialerPage.tsx:2264`) and `AfterMissStep` (2175, rendered at 1921) show **Send a video link**. With `fallback.auto_on_miss` on, a 10-second strip presses it.
3. `room.create` checks the seat, the switch and test list, `isClient` (`api/clients.ts:13`), `dndFor` (`api/lib.ts:428`), no booked demo, and the host row, then inserts the room in `requested` with a code like `K7Q2MX` and an audit row.
4. The worker claims it (`creating`), makes the room and sets `open`. sales-api polls every 500 ms for up to 15 s, sends the link, and writes a `cockpit_sales_confirmations` try with `result=message_sent` (as `confirmationSent`, 1992).
5. **Open my room** (`room.open`) gives the host link to the setter only. The setter joins and presses **I'm in the room** (`host_in`).
6. `call.maharamedia.com/K7Q2MX` hits `sales-live /go/K7Q2MX`, which logs the open and device type and redirects (302). The panel, tab title and a sound alert the setter.
7. The setter admits the knock and presses **The lead is in**, behind the 5-second undo (`components/MarkControls.tsx:133-183`): `lead_in`.
8. `room.joined` marks the intro "showed" through `markAppointment` (`api/index.ts:300`) as the setter, then `autoMove` (4154). The setter runs the intro and saves its outcome, usually **Book the demo**.

**Alternate paths**
- **Zoom:** the setter's Zoom user hosts; the lead waits in the waiting room; Zoom's events set `host_in` and `lead_in`.
- **Next lead:** the room moves to F's strip in the banner slot (`App.tsx:247`).
- **Any lead (phase 3):** a lead tagged roas-qualified or roas-unqualified who joins gets a live intro booked and marked shown; an untagged contact gets no booking.
- **Bad number:** the button also sits in the lead page header (`LeadPage.tsx:251-283`) and the dialer's ready state (trigger `bad_number`, email first).

## States and transitions

F's states. Sent, opened and waiting are times (`link_sent_at`, `first_open_at`, `lead_waiting_at`), not states.

| State | Entered when | Left when | Timeout |
|---|---|---|---|
| requested | sales-api inserts | worker claims | 60 s, then failed |
| creating | worker's conditional PATCH wins | link saved, or provider refuses | 60 s, then recover by event id or topic code, or fail; Meet pending 30 s |
| open | `join_url` saved, link sent | host_in; lead_in on a Meet mark; cancel | `lead_by` = `link_sent_at` + 600 s; an open in the last 3 min moves it to open + 180 s |
| host_in | Zoom host joined, or "I'm in the room" | lead_in | the same `lead_by` |
| lead_in | Zoom non-staff join, or "The lead is in" | `meeting.ended`, **Finished**, **End room** | No timer ends it. At `ends_at` + 30 min the panel asks "Still on the call?"; Meet rows close 2 hours after `lead_in` |
| ended, expired, failed, cancelled | final | never | worker closes the provider side within 60 s |

Every move is a conditional PATCH on state and `version` (pattern at `api/index.ts:1890-1895`).

**Expiry on a booked intro:** the panel asks for a mark. With no answer by start + 20 minutes, the worker calls the desk action `room.settle`, which writes "noshow" as the setter. A room with no booking writes nothing.

## Edge cases and failure handling

1. **Retry:** the same `request_id` returns the same room and message (pattern at `api/index.ts:936-943`).
2. **Second room:** `rooms_one_per_lead` and `rooms_one_per_host` refuse; the second matches Zoom's one meeting per host.
3. **The lead calls back:** **We are on the phone** cancels and ends or deletes the Zoom meeting.
4. **Raw link after close:** unstarted Zoom meetings are deleted; a Meet link cannot be stopped, so messages carry the short link once it exists.
5. **Provider fails or Meet stays pending 30 s:** failed, nothing sent, one tap to the other provider.
6. **Setter's Zoom pending or busy:** the doctor writes `room_hosts.zoom_status` every 10 minutes; the worker checks live meetings. Basic is fine for a 15-minute intro.
7. **WhatsApp fails:** the read-back (`api/index.ts:964-977`) offers email; an unseen template shows "Not confirmed" and email goes.
8. **A future intro (H3):** moved to now with `PUT /calendars/events/appointments/{id}` and `toNotify: false`; the new start goes into `cockpit_sales_appointments` before the mark, because `refuseMark` refuses starts over 10 minutes ahead (`api/lib.ts:70-73`). No second booking (`upcoming()`, 3607).
9. **Setter cannot admit on Meet:** **I can't let them in** switches to Zoom and sends a second message (`admit_blocked`).
10. **Unsigned staff in Zoom** look like the lead: **That was not the lead** (within 5 minutes) returns to host_in and deletes any live booking.
11. **Limits pass through:** 30 sends per sender in 10 minutes (1052), 2 minutes between templates (1168), 250 a day (1177).
12. **Duplicates and waves:** P4's duplicate check pauses room WhatsApp; health is read per source (`whatsappHealth`, 1029), so wave failures never block call-tied sends.

## Data model and settings

No new table. P1's columns go into F's `cockpit_sales_rooms` in F's migration `supabase/migrations/20261003a_sales_rooms.sql` (pattern of `20261002e_sales_client_forms.sql`):
- `trigger` check in (no_answer, busy, did_not_connect, no_talk, hung_up, bad_number, manual, auto); `attempt_id` uuid.
- `result` check in (joined, no_join, moved_to_phone, cancelled, failed, admit_blocked); `settled_mark` check in (showed, noshow, none).
- `book_claimed_at` and `live_appointment_id`: the one booking claim, shared with P2.

Device type goes in `room_events.detail`. `room_secrets` holds `start_url` only. The `rooms` setting is F's plus `fallback` and `open_grace`:

```json
"rooms": {"enabled": false, "test_only": true, "test_contacts": ["VjPfR4Cc1Y0OFvaqeor5"],
  "providers": {"zoom": false, "meet": false}, "default_provider": {"setter": "meet", "closer": "zoom"},
  "send": {"whatsapp_text": false, "whatsapp_template": false, "email": false},
  "template_route": "call_link", "waits_s": {"ready": 15, "fallback_host": 900, "lead": 600, "open_grace": 180},
  "lengths_min": {"intro": 30, "demo": 60}, "available_hours": 2, "short_link": false,
  "fallback": {"scope": "intro", "auto_on_miss": false, "book_on_join": true, "pilot_emails": [],
    "test_calendar_id": null, "whatsapp_number": null}}
```

The WhatsApp switches refuse to turn on until a `room_events` row of kind `single_copy_ok` exists.

**Queue hold:** one line in `candidates()` (`api/index.ts:2401`) drops a lead whose room is not final and whose `coalesce(lead_by, host_by, ready_by)` is after now (helper `roomHolds` in `api/rooms.ts`).

## Integrations and calls

F's worker (`hermes/sales-desk/desk/rooms.py`) makes rooms with the VPS keys, reusing `ZoomApp` (`hermes/webinar-pull/pull.py:315-345`). P1's logic goes in `api/rooms.ts`, its screen in `components/RoomPanel.tsx`. One hooks commit: `...roomActions(deps)` in `ACTIONS` (5011); `room.joined` and `room.settle` in `DESK_ACTIONS`; `room.joined` in `CRON_ACTIONS`; the `candidates()` line; the `quiet` option on `markAppointment` (304, shared with P2); the buttons and strip.

| Call | When | Idempotency | Retries |
|---|---|---|---|
| Zoom `POST /users/{id}/meetings`: type 2, no `start_time`, topic "Mahara call K7Q2MX", waiting room for `users_not_in_account` | worker | row first; on an unclear answer, match the code in the host's meetings | 2 on 429 or 5xx |
| Zoom `PUT /meetings/{id}/status` end if started, else `DELETE` (end call UNVERIFIED) | final state, never lead_in | state | each loop, 10 min |
| Google `events.insert` on "Sales rooms", `conferenceDataVersion=1`, `sendUpdates=none`, id = room UUID hex, title = code, no attendees, `guestsCanInviteOthers` false | worker | event id; 409 leads to a GET | `events.get` each second, 30 s |
| `convoSend` internals (window 913-920), `sendTemplate` (1141), or email | sales-api | `request_id` = room id | next channel |
| HighLevel `POST /calendars/events/appointments` | `room.joined`, after the PATCH on `book_claimed_at` | the claim | 0; a 502 flags "Shown not written" |
| Zoom events to `sales-live/zoom`: meeting started and ended; participant joined, left, joined waiting room, jbh waiting, jbh joined | Zoom | `dedupe_key` from event, meeting id, `participant_uuid`, `join_time` | Zoom retries at 5, 20, 60 min |
| `sales-live` to `room.joined`, `x-cron-secret` | after the event row | room version | sweep re-sends |

Failures show on the panel and in `room_events`.

**Live intro booking:** the intro calendar for the lead's class, or `fallback.test_calendar_id` in test mode; start at the join minute (a past minute is UNVERIFIED); 15 minutes; the setter as `assignedUserId`; confirmed; `ignoreFreeSlotValidation` and `ignoreDateRange` true; `toNotify` false; custom location with the short link and `overrideLocationConfig` true; title "Live · {name}". Then the row goes into `cockpit_sales_appointments` (as `bookCreate`, 3699-3716), then `markAppointment(setter, id, "showed", {anyRep: true, quiet: true})`, then `autoMove` with `targetRoles("lead","booked","booked","intro")` (`api/dialer.ts:945`). A booked intro gets the normal mark.

**Who joined:** staff have a non-empty `participant_user_id` or a seat's email; the lead is anyone else. Signature: HMAC SHA-256 of `v0:{ts}:{body}` against `x-zm-signature` (hex digest UNVERIFIED).

## Screens and copy

**Dialer:** "Nobody spoke. Save it as No answer or Call back, or send a video link." [Send a video link]. Automatic: "Sending a video link to {first name} in 10 s." [Stop]. Picker: [Meet] [Zoom instead], "The lead gets the link on {WhatsApp | a WhatsApp template | email}." or "No message can reach this lead. You can still make the room and read the link out."

**Room panel:**

| Moment | Copy |
|---|---|
| Making | "Making your {Meet / Zoom} room..." |
| Sent | "Link sent on {channel} at 14:03. Waiting for {first name} (9:59 left)." [Open my room] [Copy link] [End room] |
| Not sent | "Not sent: {reason}. Read it out: call.maharamedia.com/K7Q2MX" |
| Not confirmed | "HighLevel did not confirm the WhatsApp template. The link went by email." |
| Opened | "{first name} opened the link at 14:05. Join now." |
| Waiting room | "{first name} is in the waiting room. Admit them in Zoom." |
| Host in | "You are in. Waiting for {first name} (6:12 left)." [The lead is in] |
| Joined | "{first name} joined at 14:06. The intro is marked shown." / "{first name} joined. Booked as a live intro and marked shown." / "{first name} joined. Not booked: this contact is not a tagged lead." [That was not the lead] |
| Expired | "Nobody joined in 10 minutes. The room is closed. Mark the intro:" [No-show] [We spoke on the phone] |
| Failed | "{Provider} did not make the room: {reason}. Try {other provider}, or call again." |
| Zoom | "Your Zoom seat is not active yet. Accept Zoom's email invite. Meet works now." / "Your Zoom is in another meeting. End it or use Meet." |
| Refused | "This contact is an active client. Client success looks after them." / "Do not disturb is on in HighLevel. No link can go." / "This lead has a booked demo. Its Zoom link comes from HighLevel, so no new room is made." / "A video room is already open for this lead. Use that one." / "You already have a room open. End it first." |

Other buttons: [I'm in the room] [We are on the phone] [I can't let them in] [Also send by email] [Finished].

**Strip:** "Video room: {first name}, 7:40 left. Open", then "{first name} {opened the link / joined}. Open". **Lead page:** "Video room on Meet: sent 14:03, opened 14:05, joined 14:06." **Team page card (manager):** switches, pilot seats, scope, automatic mode; "Zoom: ready" or "Zoom: the setter's seat is pending"; F's health line, "Rooms: working. Last run 14:03:58. 6 rooms today, 0 failed." or "Rooms are down. The room worker last ran at 13:52. New rooms cannot be made."

**Lead messages** (Arabic written under `aziz-kuwaiti-voice` before launch):
- WhatsApp, booked intro: "Hi {first name}, it's {setter} from Mahara Media. I just tried to call you for your intro call and couldn't get through. We can do it on video now instead: {link} I'll wait for you for the next 10 minutes. On a phone it opens in the {Meet / Zoom} app or your browser."
- WhatsApp, no booking: "Hi {first name}, it's {setter} from Mahara Media. I tried to call you just now and couldn't get through. If you have 15 minutes, we can talk on video now: {link} I'll be there for the next 10 minutes."
- Template `call_link_en` (Utility): "Hi {{1}}, your call with {{2}} from Mahara Media is ready now. Tap the button below to join." Button "Join the call" to `https://call.maharamedia.com/{{1}}` (the button's own variable), filled from `cockpit_join_code` (`wa_fields` entry `join`, shared with P4). Whether a workflow can fill a URL button from a contact field is UNVERIFIED (day 1 test). If not: "Hi {{1}}, your call with {{2}} from Mahara Media is ready. Join here: {{3}} The room is open for 10 minutes."
- Email: subject "I tried to call you: join on video now"; the WhatsApp text, the link on its own line, "{setter}, Mahara Media".
- Ended page: "This call has ended. Reply to our last message, or message us on WhatsApp, and we will find a new time." [Message us on WhatsApp]. Unknown code: "This link is not valid. Reply to our message and we will send a new one."

No Slack messages.

## How it counts in the numbers

- **Booked intro joined:** shown, with evidence. **Nobody joined:** a no-show mark.
- **Live intro:** one booking and one show in B2B, so it counts toward the $60 per booking and 25% gates. It has its own scorecard line; the 60% target is read on intros booked ahead only, because a live intro is shown by construction. **Untagged joins:** room numbers only.
- **Two show-rate lines:** the B2B rule, and with evidence (a mark or a Zoom join). September's 54% could not be reproduced (35 of 68 is 51%), so the scorecard names its denominator.
- **Metrics:** `cockpit_sales_rooms_weekly` into `cockpit_metric_values` (`sales.rooms.*`): rooms, open and join rates, minutes to join, intros saved, live intros, cockpit share of calls. Note: "From the cockpit's rooms table. A Meet join is the setter's press; Zoom joins are checked against Zoom's participant report. Opens leave out previews. An unmarked Meet room shows as not known, never 0."
- **Second sources:** Zoom's participant report; HighLevel appointments titled "Live ·" (P2's daily check); HighLevel status for marks. No effect is claimed before 4 weeks.

## Security and privacy

- Keys stay on the VPS; `sales-live` holds only `ZOOM_WEBHOOK_SECRET` and `IP_SALT`. `start_url` sits in `room_secrets` (service role only), reaches the host only and is deleted at the end.
- Codes: 6 of 32 characters (1.07 billion), live only while the room is open; IPs as salted hashes. Titles carry the code only.
- Signatures checked first; an audit row per action; errors through `redact` (`api/lib.ts:268`); recording off; sales-api deployed with `--verify-jwt`.

## Tests and acceptance criteria

- **Unit** (`rooms.test.ts`, `sales-live/*.test.ts`, `tests/test_rooms.py`): transitions, channel order, refusals, `roomHolds`, the staff-or-lead classifier, Zoom's signature example, previews, the booking body, the claim race, `room.settle`.
- **End-to-end (H1):** a signed test event to the deployed `sales-live/zoom` reaches `room.joined`.
- **Harness:** `/sales/harness.html?path=/dialer&call=failed|busy|noanswer&room=making|ready|sent|opened|joined|expired|failed|down|pending_zoom&auto=1`: the button on every outcome but Answered, never for a client. Plus `bun run typecheck`, `bunx biome check src`, `bun test src`.
- **Live test** (test contact `VjPfR4Cc1Y0OFvaqeor5`, test calendar only): (1) the CEO checks its do-not-disturb; if contact-wide, `dndFor` blocks every channel, so the CEO lifts it and blocks every channel but email for one hour; (2) 10 Meet rooms from a phone not signed in to Google: knock, admit, one open counted, no preview counted, a booking with no workflow in the history, expiry, ended page; (3) 10 Zoom rooms on the CEO's licensed user: `host_in` and `lead_in` within 10 s, report matches; (4) delete test appointments, restore do-not-disturb with the CEO's approval; (5) WhatsApp only on a second test contact with the CEO's phone.
- **Acceptance:** 20 rooms, links within 15 s, 0 sends to other contacts in the audit query.

## Rollout and build days

| Phase | On | Gate to go on |
|---|---|---|
| 0 Dark | `enabled` false | all tests pass |
| 1 Pilot, 1 week | setter, Meet, booked intros, email; WhatsApp text after the single-copy test | adoption 80%; 10+ rooms; 0 wrong or double sends; every join counted |
| 2 Automatic | `auto_on_miss` | 1 week, no link sent to a lead on the phone |
| 3 Any lead | scope `any`, lead page | calendar labels settled |
| 4 Zoom | Zoom for the setter | seat active, webhook verified |
| 5 Templates | `call_link_*` | Meta approval, single-copy test |

`rooms.enabled=false` is the kill switch. P1 adds 4 build days to F's 6. Ship: migration; `deploy_fn.py` for sales-api with `--verify-jwt` and `sales-live` without; `scripts/ship.sh sales`; the `apps/call-link` Vercel project; a runbook row; a session note in `shared/sessions/`. Check the live sales-api version (v57) and tell the parallel session before each deploy.

## What the CEO must do and the decisions it needs

1. **Google:** create "Sales rooms"; keep Meet host management and "Host must join before anyone else" off (Admin path UNVERIFIED); confirm the setter has a maharamedia.com account (UNVERIFIED).
2. **Zoom:** Event Subscriptions on the Server-to-Server app to `https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-live/zoom` with the seven events; the Secret Token into `/opt/data/bibi/api-keys.env` as `ZOOM_WEBHOOK_SECRET` (the build copies it unprinted); waiting room with custom options and the embedded passcode on. The setter accepts Zoom's invite.
3. **GoDaddy:** CNAME `call` to the value Vercel shows. Until then opens are not tracked.
4. **HighLevel:** a test calendar outside B2B's map; say which intro calendar is qualified; `call_link_en` and `call_link_ar` (Utility), each with a published one-step workflow with Allow re-entry; a second test contact with your phone, tagged `cockpit-test`.
5. **WA Connector:** switch it off.

**Decisions** (all recommended yes): book and mark on a join, tagged leads only; Meet by default with Zoom offered; automatic mode after the pilot; expired booked intros become no-shows; a 10-minute wait. Also: the official number for the ended page, and later the Meet API scope (open decision 6).

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Almost no dials or bookings | Adoption gate; weekly raw counts; no claim before 4 weeks |
| Google pages disagree on who admits a Meet knock | Live test first; Zoom becomes the default if it fails |
| Meet joins depend on a press | Prompts; "not known" instead of 0; a manager list of rooms with no result |
| Meta files `call_link` as marketing | Under 8 cents a send at Kuwait's $79.20 per 1,000 (UNVERIFIED); email still goes |
| The parallel session overwrites sales-api | New files, one hooks commit, latest main, version check |