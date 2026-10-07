# Project 2 spec: live handover (final)

Code read from origin/main `9670e5b`. The local checkout is 3 commits behind, so the build starts from the latest main and re-checks line numbers. `api/` is `supabase/functions/sales-api/`, `src/` is `apps/sales-cockpit/src/`, and tables carry the `cockpit_sales_` prefix. The foundation spec is the only contract for rooms, availability, the door and settings. This spec adds only what a handover needs.

## What changed after review

- **One contract (C1).** P2 no longer has its own tables, door or claim functions. It uses the foundation's tables, claim function, door `sales-live`, single migration and waits: 120 s to take, 120 s into the room, 600 s for the lead, 1 miss, 2 hours available.
- **Standby room kept, made safe.** Pressing Available still opens a room, as the CEO described. Every handover needs a "Take it" press (M12).
- **Doors reach sales-api (H1).** `live.event` is in `CRON_ACTIONS` and `DESK_ACTIONS`, called with `x-cron-secret` (`index.ts:5085, 5130-5141`).
- **Zoom events (H6).** No timestamp window, dedupe by key, manual buttons after 30 s, the participant report as second source, and a Supabase watchdog (M10).
- **Live data (H8, H7).** Offers read HighLevel directly. No rule ends a room with a lead in it.
- **Official numbers (H2, H3, M1, M2, M9).**
  - Tests book on a calendar outside the B2B map.
  - Undo deletes the booking.
  - The cockpit copy gets the new start time before the mark.
  - Marks are quiet.
  - Untagged contacts are not booked.
  - The intro calendar labels are settled first.
- **Google (H9).** No domain-wide delegation. Keys stay on the VPS.
- **WhatsApp (M11, M7, H5, M3).**
  - The short link is required.
  - WhatsApp stays off until the single-copy test passes.
  - Health is measured per source.
  - A send counts as "sent" only when the read-back matches its text.
- **Slack (low).** The door handles `url_verification`. `/unavailable` replaces `/away`, which is reported as a Slack built-in (UNVERIFIED).
- **Critic gaps.** A volume note, an intro-to-demo metric, a cockpit-dialing gate and rep training.
- **Not this spec.**
  - H4 and M4 belong to P3.
  - M5 belongs to P4, which can exclude "Live · {name}" bookings from its test.
  - M6 belongs to P1.
  - C2 and the worker gap belong to the foundation and P4.

## 1. Outcome and success numbers

A lead who is on the phone with the setter, or who just replied, gets on video with a rep within minutes. No slot is booked. Demos go to a closer and intros to a setter.

The system guarantees three things:
- No rep holds two leads.
- No lead gets two links.
- Every joined call is booked and marked shown in HighLevel within 1 minute, or flagged to the manager.

HighLevel workflows cannot hold a lock, so the no-mix-up rule lives in database indexes and one claim function. HighLevel workflows only send templates.

**Volume, plainly.** New leads per week since 24 August were 65, 55, 21, 4, 1 and 0. There are 0 upcoming booked calls and 12 cockpit dials ever. P2 lifts rates; it creates no leads. October's 8 clients need the ads running again.

| Metric (4 weeks after phase 3; no October volume target) | Target |
|---|---|
| Shown intros that became a held demo within 24 hours (primary) | Baseline first. September was about half (35 shown, 17 demos); October needs 60% |
| Press to rep in the room | Median under 90 s with a ready closer, under 3 min otherwise |
| Join rate of sent links | 70% or more |
| Mix-ups (foundation's daily SQL check) | 0 |
| Joined handovers whose appointment id is in HighLevel | 100%, checked daily |
| Setter's Maqsam calls placed from the cockpit | 80% for a week before phase 3 |

October's "45 live demos" means demos held. Screens call this kind "handover calls".

## 2. Who does what

| Role | Does |
|---|---|
| Setter | Starts a handover, keeps the lead on the phone, books a slot if nobody takes it, hosts own video intros |
| Closer | Presses Available, joins the standby room, takes offers, admits the lead, runs the demo |
| Lead | Taps one link, waits in Zoom's waiting room or knocks on Meet |
| Manager or CEO | Owns the switches, links Slack IDs, reads the Live page |
| System | The VPS worker makes rooms and posts Slack; `sales-api` guards, sends, books and marks; `sales-live` takes callbacks; the sweep enforces deadlines |

## 3. The flow, step by step

**Happy path: a demo from the dialer, with the closer on a licensed Zoom**

1. The closer presses "I'm available" (the strip, `/available` or App Home). `availability` runs until now plus 2 hours, and `sales-api` inserts a `standby` room with no contact.
2. The worker makes the meeting. "Open my room" calls `room.open`, which gives the host link to the host only. Zoom's host-joined event sets `host_in`, and presence becomes `ready`.
3. On a Maqsam call (`call.answered`), the setter presses "Bring in a closer" (`src/pages/DialerPage.tsx:1843-1885`). `LiveStartSheet` shows:
   - the kind;
   - the channel, and why it was chosen;
   - the lead message;
   - a required one-line note.
4. `live.ask` checks the seat, the switches, `isClient` (`api/clients.ts:13`), `dndFor` (`api/lib.ts:428`), hours, and one open handover per lead. Then it:
   - reads each closer's HighLevel calendar for the next 60 minutes;
   - drops anyone with a call starting within the call length plus 10 minutes;
   - offers the lead for 120 s to closers whose presence is `ready` or `available`.

   The strip polls every 4 s. Slack DMs go out within 5 s.
5. "Take it" runs `cockpit_sales_live_claim`, which also attaches the taker's `host_in` standby room. The handover is `room_ready` at once.
6. The foundation message service sends the short link as the setter, plus an email. The lead has 600 s to join.
7. The lead taps the link. `sales-live /go/{code}` logs the open and the device class, then redirects. `participant_joined_waiting_room` tells the closer to admit the lead.
8. A non-staff `participant_joined` sets the room to `lead_in` and the handover to `lead_joined`. `live.event` then:
   - books the call (section 7);
   - writes the new start into `cockpit_sales_appointments`;
   - marks it shown quietly, acting as the closer's seat;
   - calls `setOwner` (3754), `autoMove` with `targetRoles("lead","booked","booked",kind)` (`api/dialer.ts:945`), and `saveOutcome` (2921).
9. `meeting.ended` ends the room. The handover is `done` and `start_url` is deleted.

**Alternate paths**

- **The taker has no standby room.** `room.create` runs with `send_on=host_in`. The link goes once the taker is in.
- **Nobody takes it within 120 s.** The handover expires (`no_rep`). Closers who did not press "Not now" go away. `BookForm` opens (`DialerPage.tsx:1942`).
- **"Video now (intro)".** No offer goes out. The setter hosts, on Meet by default. "Intro now with a ready setter" offers the lead to setter seats instead.
- **The lead replied.** "Offer a call now" sits in the Conversation (`LeadPage.tsx:334`). A person always presses it, and the link goes as free text. P3's drafts get this button in P3's phase 2.
- **Meet.** "I'm in" and "They joined" are button presses until decision 6.

## 4. States and transitions

| Handover state | Entered when | Left when | Timeout |
|---|---|---|---|
| offered | an eligible rep exists | claim, or cancel | 120 s, then expired (`no_rep`) |
| claimed | claim won, taker not yet in a room | room reaches `host_in` | 120 s, then expired (`rep_not_in_room`) |
| room_ready | taker in the room; link sent | room reaches `lead_in` | 600 s after the link, then expired (`lead_no_show`) |
| lead_joined | Zoom non-staff join, or "They joined" | room ends | room `ends_at` (demo 60, intro 30 min) plus 30 min |
| done, expired, cancelled, failed | final | never | provider side closed within 60 s |

**Additions to the foundation's room machine**

- **Standby rooms have no contact.** If the host is not in within 300 s, the room expires and the rep stays `available`.
- **The host leaves before a lead arrives.** `host_in` returns to `open`, and `host_by` resets to 120 s.
- **Standby room limits.**
  - The room is replaced at 35 minutes, because Zoom ends a licensed meeting 40 minutes after only one person is left.
  - It ends 10 minutes before the rep's next booked call, because Zoom allows one meeting per host even when the host is absent.
- **A room with a lead in it.** No rule ends a room in `lead_in`. The rule alerts the rep and the setter instead.
- **Who gets offers.** Offers go to presence `ready` and `available`, not only `available`.

## 5. Edge cases and failure handling

| Case | What happens |
|---|---|
| Two presses at once, or a late press | The claim's `where state='offered' and offer_until > now()` returns one row. Others see "{rep} took this lead at 14:02." or "This offer closed at 14:07. Nothing to do." |
| Two setters, one lead; a rep already on a call | Unique indexes refuse it. The setter sees "A live call for this lead is already open, started by {setter} at 14:02." The rep sees "You already have a live call." |
| Host leaves before the lead joins | The room goes back to `open`. If the host is not back within 120 s, the room expires and the handover returns to `offered` once, with the lead time left. The short link follows the new room. |
| Lead joins twice | Events are deduplicated on `participant_uuid` and `join_time`. `book_claimed_at` allows one booking. |
| A stranger is admitted | "That was not the lead", pressed within 5 minutes, deletes the appointment and returns the room to `host_in`. |
| No Zoom event for 30 s | [I'm in] and [They joined] appear. Late events after a final state are only logged. |
| Zoom fails | "Zoom did not open your room: {error}. Use Meet." [Use Meet] |
| The host is Basic on a demo | The foundation's Basic refusal |
| HighLevel refuses the booking | The Live page shows "Not in HighLevel: book and mark it by hand." |
| Lead has an upcoming call | `upcoming` (3490) blocks a second booking. Instead, the call is moved to now with a quiet PUT, a custom location and the taker assigned. The copy is written, then the call is marked. P4 closes its chat (`live_call`). |
| No roas tag | The call runs. Nothing is booked, and it is counted as "not a lead". |
| Client, or do-not-disturb on every channel | Refused before any room is made. |
| Do-not-disturb on WhatsApp only | The link goes by email or is read out. |
| Open P1 room | For an intro by the same setter, the room is adopted. For a demo, the P1 room ends and the new link replaces it. |
| Outside hours | "Live calls run Saturday to Thursday, 10:00 to 20:00 Kuwait time." |

## 6. Data model and settings

P2 has no migration of its own. Its additions go into the foundation's `20261003a_sales_rooms.sql`:

- **`rooms`:** `purpose` adds `standby`, with the check `(contact_id is not null or purpose = 'standby')`. A new column `book_claimed_at` is added. The live booking id goes in `appointment_id`.
- **`live`:** adds `entry` (dialer, lead_page, inbox, followup), `note` (200 characters), `attempt_id` and `end_reason`.

**Setting `live`.** It holds the foundation's three keys plus P2's. Every seat can read it, so it holds no secrets.

```json
{"enabled": false, "closer_wait_s": 120, "slack": false,
 "kinds": {"demo": false, "intro": false},
 "entries": {"dialer": true, "lead_page": false, "inbox": false, "followup": false},
 "standby": true, "standby_host_s": 300, "standby_max_min": 35, "before_booked_min": 10,
 "hours": {"days": [6,0,1,2,3,4], "from": "10:00", "to": "20:00", "tz": "Asia/Kuwait"},
 "calendars": {"demo": "jQqXS1YuFnmGZKLkrE62", "test": null}, "book_untagged": false}
```

- The lead wait is `rooms.waits_s.lead` (600).
- Show-only mode means every `rooms.send.*` switch is false.
- When `calendars.test` is set, it takes every live booking.

**Secrets.**
- Function secrets hold only the verifiers: `SLACK_SIGNING_SECRET`, `ZOOM_WEBHOOK_SECRET` and `IP_SALT`.
- The Zoom keys, the Google token and `SLACK_SALES_BOT_TOKEN` stay on the VPS in `/opt/data/bibi/api-keys.env`.

**Code.**
- **`api/live.ts`** with `live.test.ts`: transitions, eligibility, hours, the participant classifier and the copy.
- **`api/liveio.ts`:** `makeLive(deps)` with `svc`, `ghl`, `audit`, `setting`, `markAppointment`, `setOwner`, `autoMove` and `saveOutcome`. It acts as the rep's seat, because `refuseMark` needs the marker's HighLevel user to match the call (`api/lib.ts:63-67`).
- **One shared hooks commit:**
  - `ACTIONS` entries: `live.ask`, `live.take`, `live.decline`, `live.cancel`, `live.status`, `live.mark_in`, `live.not_lead`.
  - `live.event` in both `DESK_ACTIONS` and `CRON_ACTIONS`.
  - A `quiet` option on `markAppointment` (304), passed to the existing `notify` argument of `writeMarkToCrm` (263).
- **Screens and worker:**
  - New files: `LiveStartSheet.tsx`, `LiveStrip.tsx` and `pages/LivePage.tsx`.
  - Offer and standby states go into the foundation's `AvailabilityStrip.tsx` and `RoomPanel.tsx`.
  - Standby rooms and Slack go into `desk/rooms.py`.

## 7. Integrations and calls

| Call | When | Idempotency | Failure shows |
|---|---|---|---|
| Zoom `POST /users/{id}/meetings` (VPS) | standby or claimed room | code in topic; row written first | room failed, strip, DM |
| Zoom `PUT /meetings/{id}/status` end (UNVERIFIED) | final state, refresh, guard | `ended_at` written first | "Room still open" |
| HighLevel calendar events per rep, next 60 min (query fields UNVERIFIED) | `live.ask` | read only | rep left out, reason logged |
| HighLevel create appointment, then quiet status PUT | lead joined | `book_claimed_at` conditional PATCH; mark dedupe (324) | Live page |
| HighLevel delete appointment (endpoint UNVERIFIED) | "That was not the lead" | room event | Live page |
| Message service (`api/rooms.ts`) | room_ready | `request_id` = handover id | setter strip |
| Slack post, update and `views.publish` (VPS); `response_url` (door) | offers, presses | `slack_posts`, `version` | worker_status `slack` |

**Zoom meeting.**
- Type 2 with no `start_time`, topic "Mahara call {code}".
- `waiting_room` on, with mode custom and `users_not_in_account`.
- `join_before_host` false, and no recording.
- Events: `meeting.started`, `meeting.ended`, `participant_joined`, `participant_left`, `participant_joined_waiting_room`, `participant_jbh_waiting` and `participant_jbh_joined`.
- Staff have a `participant_user_id` or a seat email. The lead is the first other participant.

**Booking.**
- Calendar: `live.calendars.demo`, or the intro calendar for the lead's tag once M2 is settled.
- Start at the minute the lead joined. End 15 minutes later for an intro, 45 for a demo.
- The taker is the `assignedUserId`, and the status is confirmed.
- `ignoreFreeSlotValidation` and `ignoreDateRange` true; `toNotify` false.
- `meetingLocationType` custom, `address` set to the short link, and `overrideLocationConfig` true.
- Title "Live · {name}".
- `bookCreate` cannot be reused, because it refuses a start in the past (3571) and checks free slots (3613).

**Door.** `sales-live` does five things in order:
1. Checks the signature on the raw body: within 300 s for Slack, and with no time window for Zoom.
2. Answers `endpoint.url_validation` and `url_verification` inline.
3. Stores the event.
4. Replies 200.
5. Calls `live.event` with `x-cron-secret` inside `EdgeRuntime.waitUntil` (UNVERIFIED on this project).

The worker and the sweep catch anything left over.

**Second sources.** The doctor checks ended rooms against Zoom's participant report. A pg_cron watchdog checks the rooms status row every 5 minutes.

## 8. Screens and copy

**Slack app "Mahara Sales".**
- Every URL is `https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-live/slack`.
- Scopes: `chat:write`, `commands`, `im:write`, `users:read` and `users:read.email`.
- Event: `app_home_opened`.

| Moment | Copy and buttons |
|---|---|
| App Home | "Live calls. You are away." [I'm available]. "Ready now: {n} closers, {m} setters." |
| `/available` | "You are available until 16:30. Opening your room..." |
| Room open | "Your room is open. Join it so live leads can come straight to you." [Open my room] |
| In the room | "You are in your room. Ready until 16:30." [Stop] |
| Offer | "Live demo for you: {name}, {company}, {country}. On the phone with the setter now. Note: {note}. Take it within 2 minutes." [Take it] [Not now] |
| Taken | "You took it at 14:05. Link sent by {channel}. They have 10 minutes to join." [Open lead] |
| Lost | "{rep} took this lead at 14:05." |
| Waiting room | "{name} is in your waiting room. Admit them in Zoom." |
| Joined | "They joined at 14:07. Booked and marked shown in HighLevel." [That was not the lead] |
| No Zoom event | "Zoom has not told us yet. Press when it happens." [I'm in] [They joined] |
| Refresh | "You have waited 35 minutes. Zoom closes a room after 40 minutes alone, so here is a fresh one." [Open my room] [Stop] |
| Booked call, empty room | "Your booked demo starts at 15:00, so your empty room is closed. Press I'm available after it." |
| Booked call, lead in the room | "Your booked demo starts at 15:00 and this call is still running. Tell the setter if you need cover." |
| Missed | "This offer ended at 14:04. You are now away. Type /available when you are back." |
| After the call | "Call finished. Ready for the next one?" [I'm available] [Not now] |
| `/unavailable` | "You are away. Live leads will not come to you." |
| Unlinked | "Your Slack is not linked to a sales seat. Ask the manager to add your Slack ID on the Team page." |

**Cockpit strip** (`src/App.tsx:247`): the same lines and buttons.

**Setter strip** (`LiveStrip.tsx`). Each state has a line the setter can say:

| State | Strip copy and buttons | Say |
|---|---|---|
| Searching | "Finding a closer: 1:42 left." | "I'm bringing in one of our closers now. It takes a minute or two. While we wait, how many projects are you running this quarter?" |
| Ready | "The closer is in the room. Link sent by WhatsApp at 14:05." | "I've just sent you a link. Tap it and you'll be with our closer straight away." |
| Window closed | "WhatsApp is closed for this lead. Ask them to send 'hi' to our WhatsApp and the link goes as soon as they do." [Send when they write]. On Meet: "Read this out: meet.google.com/abc-defg-hij" | |
| Nobody | "Nobody could take it. Book a slot instead." [Book a demo] | "Our closers are all on calls right now. What works better, today at {slot 1} or tomorrow at {slot 2}?" |
| Joined | "They are in the room. You can end your call." | |
| No join | "They did not join in 10 minutes. The room is closed. Nothing was booked." [Book a slot] [Send a message] | |
| Cancel | "Cancel? The room closes and nothing is booked." [Yes, cancel] [Keep it], behind the 5-second undo (`components/MarkControls.tsx:133-183`) | |

**Other screens.**
- **Lead page** (`LeadPage.tsx:251-283`): [Live call] with "Demo now with a closer", "Intro now with me" and "Intro now with a ready setter".
- **Team page** (`TeamSeat.tsx:431-441`): Zoom user, default room, and [Find in Slack] (`users.lookupByEmail`).
- **Live page** (managers): the log, the metrics and the second-source line.

**Lead messages.** The Arabic versions are written under `aziz-kuwaiti-voice`.
- **WhatsApp, Zoom:** "Hi {first name}, {rep} from Mahara is ready for you now: {link} It opens in Zoom or your browser. They will let you in within a minute."
- **WhatsApp, Meet:** "Hi {first name}, {rep} from Mahara is ready for you now: {link} Press 'Ask to join' and they will let you in."
- **After a reply:** "Thanks {first name}. Are you free for a quick video call now? {rep} is ready: {link}"
- **Email:** subject "Your call with {rep} is ready". The body is the WhatsApp text plus "If now is not good, reply and we will find a time."
- **Template (phase 5):** the foundation's `call_link_en` and `call_link_ar`.

## 9. How it counts in the numbers

- **Decision 2.** The call is booked and marked shown when the lead joins. If the lead never joins, there is no appointment. B2B counts the call in both gates and both show rates.
- **Targets stay on booked-ahead calls.** Handover calls are shown by construction. The Live page puts two lines side by side, with a note in `apps/media-buyer-cockpit/src/pages/ceo/SOURCES.md`:
  - shown by the B2B rule;
  - shown with evidence (a mark or a Zoom join).
- **Undo never inflates.** B2B counts `invalid` as shown, so undo deletes the appointment. Whether B2B drops deleted rows is UNVERIFIED. If it does not, the booking moves to 2 minutes after the join.
- **Live page metrics:**
  - handovers by entry and kind;
  - time to a rep;
  - join rate;
  - handover demo close rate within 14 days, beside booked demos;
  - offers nobody took, by hour;
  - ready minutes and misses per rep.

  Meet joins carry the note "The rep's press until Google gives a signal."

## 10. Security and privacy

- **Host link.** `start_url` lives only in `room_secrets` and reaches only the host, through `room.open`.
- **Keys.** They stay on the VPS. No domain-wide delegation.
- **Doors.** `sales-live` is the only door with `verify_jwt` off. `sales-api` always deploys with `--verify-jwt`.
- **Lead details.** Slack never carries a phone number or email. Zoom and Google titles carry only the code.
- **Rules first.** Client and do-not-disturb checks come before any room is made.
- **Audit.** Every write leaves an audit row (`index.ts:184`).

## 11. Tests and acceptance criteria

- **Unit tests** cover:
  - transitions and timeouts;
  - eligibility around booked calls;
  - hours;
  - participant classification on recorded payloads;
  - both signature checks and `url_verification`;
  - the booking body by tag.
- **Database tests** run on a branch, never on production:
  - 50 parallel claims produce one winner;
  - no rep holds two handovers;
  - a second open room for a lead or a host is refused.
- **Harness:** the foundation's `&room=` and `&offer=` knobs, plus `/sales/harness.html?path=/dialer&call=answer&live=standby|searching|taken|nobody|joined|nojoin|noevent`.
- **Live test.** It runs on the test contact `VjPfR4Cc1Y0OFvaqeor5` only, with sends off and the test calendar.
  1. Check the contact's do-not-disturb in HighLevel first.
  2. The CEO presses Available and joins the room; the seat is ready within 10 s.
  3. Start a demo handover. The offer arrives in under 2 s. Take it, and the link shows.
  4. Open the link in a private window that is not signed in to Zoom, then admit the guest. `lead_joined` follows within 10 s.
  5. Check HighLevel. The appointment is on the test calendar, marked showed, with our link as its location. The contact's history shows no workflow.
  6. Repeat with these cases:
     - Meet, to check whether a rep who is not the organiser can admit the guest;
     - two phones pressing Take it at once;
     - no taker;
     - a no-show;
     - a cancel;
     - "That was not the lead";
     - a stopped webhook.
  7. List the test appointments in the session record for the CEO to delete.

**Acceptance:** every step passes, no real lead receives anything, and every write has an audit row.

## 12. Rollout and build days

| Phase | On | Gate to go further |
|---|---|---|
| 0 | CEO setup | Slack IDs linked, Zoom events arriving, test calendar exists |
| 1 | Build, `enabled: false` | Unit, database and harness tests green |
| 2 | Live test | Section 11 passes |
| 3 | Dialer demos on licensed Zoom (or Meet per decision 1), email and read-out, 1 week | 80% cockpit dialing; 0 mix-ups; second source matches daily |
| 4 | Lead page, Conversation, intros, Meet, WhatsApp text | Single-copy WhatsApp test passed |
| 5 | Template, then the agent entry | Template approved; P3 running |

**Build days.** These come after the foundation's 6.

| Day | Work |
|---|---|
| 1 | Migration additions, `live.ts` |
| 2 | Standby rooms, the booked-call guard, the calendar read |
| 3 | Slack |
| 4 | Booking, quiet mark, undo, the PUT path |
| 5 | Screens, harness |
| 6 | Live page, second sources |
| 7 | Live test, ship, runbook row, session record |

**Ship order.**
1. Tell the parallel session first.
2. Deploy `sales-api --verify-jwt` and `sales-live` from the latest main.
3. Deploy the site with `scripts/ship.sh sales`.

**Training.**
- 30 minutes per rep.
- A one-page "what to press when".
- The strip lines as the phone script.
- A role-play with the CEO playing the lead.
- A 15-minute daily check in week one.

## 13. What the CEO must do, and the decisions

1. **Slack.**
   - Invite the setter and the closer.
   - At api.slack.com/apps: Create New App > From a manifest > MaharaMedia > paste > Create > Install > Allow.
   - Put the Signing Secret into the function secret `SLACK_SIGNING_SECRET`.
   - Put the Bot User OAuth Token into `/opt/data/bibi/api-keys.env` as `SLACK_SALES_BOT_TOKEN`. Not in chat.
2. **Zoom.**
   - Use the foundation's event subscription to `sales-live/zoom`, and add "Participant joined waiting room" and "Participant joined before host".
   - In Account Settings, turn Waiting Room on with custom options, and turn on "Embed passcode in invite link".
3. **HighLevel.** Create a calendar "Cockpit test (not counted)" outside the B2B map. Confirm which intro calendar is the qualified one (M2).
4. **Team page.** Fill in each seat's Slack ID and Zoom user.
5. **Later.** Switch the WA Connector off before phase 4. For phase 5, add the CNAME and the `call_link` templates, with "Allow re-entry" on each workflow.

| # | Decision | Recommendation |
|---|---|---|
| 1 | Closer's room: Zoom licence or Meet | Licence. Basic cuts at 40 minutes; demos run 45. |
| 2 | Book and mark shown on join | Yes, quietly, and deleted on undo |
| 5 | Waits | 120 s to take, 120 s into the room, 600 s for the lead |
| 6 | Meet's own permission | Later |
| A | Keys | Stay on the VPS |
| B | Google | The foundation's CEO calendar first. If the admit test fails, per-rep OAuth (Internal consent screen, `calendar.events`, tokens on the VPS). Never domain-wide delegation. |
| C | Hours | Saturday to Thursday, 10:00 to 20:00 Kuwait time |
| D | Standby room on Available | Yes |
| E | Untagged contacts | The call runs; no booking |

## 14. Risks and mitigations

| Risk | Mitigation |
|---|---|
| A standby room blocks a booked demo | The live calendar read, and empty rooms end 10 minutes before a booked call. Whether HighLevel's demo Zoom meeting runs on the closer's Zoom user is UNVERIFIED. |
| "Demo 2" demos may already be cut at 40 minutes on Basic (UNVERIFIED) | Check in phase 0; decision 1 |
| Meet admit is unproven | The live test; Zoom for demos |
| The parallel session overwrites `sales-api` | New modules, one hooks commit, a version check before and after each deploy |
| No volume to test on | The cockpit-dialing gate; no effect claimed before 4 weeks |