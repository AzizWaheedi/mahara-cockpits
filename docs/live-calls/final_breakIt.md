# Red-team review of the follow-up agent, live handover, fallback room and demo chat plans (checked 2026-10-03)

The plan has two critical faults, nine high ones and fifteen medium or low ones. The two critical ones: the four specs define the same tables and functions in conflicting ways, and a booked demo would end up with two different Zoom rooms.

I read the code from origin/main `9670e5b` in `/Users/abdulazizwaheedi/mahara-worktrees/sales-cockpit`. A copy of the files I read is in `/private/tmp/claude-501/-Users-abdulazizwaheedi-mahara-cockpits/1742ac47-cfcd-4db7-b565-33e64c239220/scratchpad/redteam/`. The data comes from read-only SQL on the cockpit database and the B2B database. In this list, `api/` means `supabase/functions/sales-api/`. Spec names: F is the foundation, P1 the video link, P2 live handover, P3 the follow-up agent, P4 the demo chat.

## CRITICAL

**C1. The four specs define the same objects in conflicting ways. If each project is built as written, they break each other. (F 6 and 7, P1 6 and 7, P2 6 and 7)**
- **Rooms table:**
  - F's `cockpit_sales_rooms` has 9 states, a 6-character upper-case code, and `join_url` in the rooms table.
  - P1's table of the same name has 10 states, an 8-character lower-case code, and `join_url` in a secrets table.
  - P2 uses `cockpit_sales_live_rooms` instead, and says P1 stores its rooms there.
- **Handover table:** F and P2 both define `cockpit_sales_live`, with different states and different claim functions (`_live_claim` against `_live_take` and `_live_assign`).
- **Settings:** the `rooms` and `live` settings have two different shapes each.
- **Migrations:** all four are named `20261003a_*`.
- **Zoom webhooks:** three endpoints (`sales-live/zoom`, `room-hooks`, `sales-live-door/zoom`).
- **Google:** three routes (the CEO's token on the VPS, a narrow token in Supabase, a domain-wide service account).
- **Zoom meeting settings:** F has join-before-host off; P1 has join-before-host on with no waiting room; P2 has a waiting room for people outside the account.
- **Scenario 1:** P1 creates `cockpit_sales_rooms` first. F's `create table if not exists` keeps P1's columns. The VPS worker then writes a `join_url` column that does not exist, so every room fails.
- **Scenario 2:** a lead has a P1 fallback room in one table and a P2 handover room in the other. The one-open-room-per-lead indexes are per table, so the lead gets two links to two rooms with two hosts.
- **Scenario 3:** P2 adopts P1's room. Both webhook handlers book a live intro, because P1 keys the booking on `book_claimed_at` and P2 keys it on a bookings row. That makes two HighLevel appointments.
- **Fix:**
  - Make F the only contract. Rewrite P1 and P2 sections 6 and 7 to refer to it.
  - Use one migration for rooms, live, availability and events, one `rooms` setting, and one webhook function.
  - Use one booking claim column on the room, used by every project.
  - Drop P1's `room-go` and `room-hooks`, and P2's `sales-live-door`.

**C2. A booked demo gets two different Zoom rooms, and the link is due before the room exists. (P4 step 6, F "A link for a booked call")**
- **The evidence:**
  - 90 of the last 91 demos already have a Zoom link that HighLevel made. It is in the appointment's `address` field (B2B `calls.raw_payload`, last 60 days).
  - HighLevel's own reminders stay on (P3 3.4, P4).
  - P4 sends `call.maharamedia.com/{code}` 15 minutes before the demo. F's `purpose=booked` makes a new room only 5 minutes before.
  - The cockpit's copy of appointments has no column for the link (`cockpit_sales_appointments` has no address field), so P4's "until then, the appointment's own Zoom link" has no source.
- **Scenario 1:** the lead taps the cockpit link and waits in the new room. The closer starts HighLevel's meeting from their calendar.
- **Scenario 2:** if both meetings belong to the closer's Zoom user, whichever starts second shows "host has another meeting in progress" (one meeting per host).
- **Fix:**
  - For a booked call, never create a room.
  - The room row wraps the appointment's own meeting: read `address` with a GET on the appointment, and store the meeting id.
  - The short code redirects to that meeting.
  - Check that HighLevel's Zoom for the closer is the closer's user in the Mahara account (UNVERIFIED). Webhooks only fire for meetings hosted in our account.

## HIGH

**H1. The new outside doors cannot call sales-api. (P1 7 `room.joined`, P2 7 `live.event`)**
- **The rule in code:** sales-api lets a non-browser call in only two ways (`api/index.ts:5130-5141`): a token whose `service_role` claim can be read, or `x-cron-secret` for an action listed in `CRON_ACTIONS` (5085).
- **Why the doors fail:** the comment at 5127-5129, and the way `sales-mirror` calls in (`supabase/functions/sales-mirror/index.ts:567-575`), show that a function's own injected service key cannot be read that way. So these calls fall through to the seat check and get a 401.
- **Scenario:** the lead is admitted in Zoom and the event is stored, but it is never applied. P1 has no sweep for joins and no Zoom "They joined" button. Nothing is booked, nothing is marked shown, and the room closes as "Nobody joined". In P2, "Take it" presses only apply on the 20-second sweep.
- **Fix:** put `room.joined` and `live.event` in `CRON_ACTIONS` and call with the cron secret, as `sales-mirror` does. Add an end-to-end test against the deployed door.

**H2. "Invalid" counts as shown in the official numbers, and test bookings reach them. (P2 5 "That was not the lead", P2 11 step 7, P1 live test)**
- **The rule in B2B:** `b2b_window_metrics` and `b2b_rep_scorecard` count `status in ('confirmed','invalid') and start_at <= now()` as shown. I read the function body; SOURCES.md line 47 says the same.
- **Bookings:** "booked" is counted by `booked_at`, whatever the status.
- **Test bookings already arrive:** the test contact already has a 2026-09-27 test intro in B2B `calls`, cancelled and not voided.
- **Scenario:** six live-test demos are marked invalid as cleanup. October gains 6 booked and 6 shown demos that never happened.
- **Fix:**
  - Run every live test on a HighLevel test calendar that is not in B2B `calendar_call_type_map`. B2B `calls` holds only the 4 mapped calendars; I checked that all 2,582 rows are mapped.
  - For "That was not the lead", delete the appointment instead of marking it invalid. Then check whether B2B drops deleted rows (UNVERIFIED: 0 rows carry `deleted=true`).

**H3. Moving an existing call to "now" and then marking it shown is refused. (P1 edge 15, P2 5)**
- **Why:** `markAppointment` reads the cockpit's own copy (`api/index.ts:300-313`). `refuseMark` refuses any mark other than cancelled when the start is more than 10 minutes ahead (`api/lib.ts:70-73`).
- **The copy lags:** after the PUT, the copy keeps the old start time until B2B's next HighLevel read (every 15 minutes, per `sync_state` for `ghl_calls`) plus the 3-minute mirror.
- **Scenario:** a lead booked for Thursday joins Monday's room. The PUT works. The mark fails with "This call has not happened yet."
- **New bookings have the same gap:** a brand-new live booking is not in the copy unless the new path inserts it, the way `bookCreate` does (3699-3716). `bookCreate` itself cannot be reused: it refuses a start in the past (3571) and checks free slots (3613).
- **Fix:** after a verified create or PUT, write the new `start_at` into `cockpit_sales_appointments` before marking.

**H4. Automatic do-not-disturb would drop live leads from the dialer. (P3 5 edge 5, decision 6)**
- **The trigger:** the stop pattern (`hermes/sales-desk/desk/followups.py:112-117`) matches "not interested", "مو مهتم", "غير مهتم", "لا تتصل" and a bare "stop" anywhere in a message.
- **The effect:** do-not-disturb on the contact removes the lead from the dialer (`api/dialer.ts:507, 623`), refuses calls (`api/index.ts:2794`) and blocks every send (`api/lib.ts:428-429`).
- **Scenario:** a lead writes "لا تتصل الحين، أنا في اجتماع" ("don't call now, I'm in a meeting"). They are never called or messaged again, and nobody sees it.
- **Fix:**
  - Turn on do-not-disturb only for explicit unsubscribe words, only on WhatsApp, and only after a rep confirms.
  - Any other match pauses the agent for that lead for 30 days and creates a rep task.

**H5. One bad reactivation wave pauses WhatsApp for every project. (P3 waves; P4 edge 11; P1 and P2)**
- **The rule:** `whatsappHealth` (`api/index.ts:1029-1045`) pauses when 30% of the last day's WhatsApp sends failed, counting every source.
- **Scenario:** a 40-message wave to old leads has 15 failures (numbers not on WhatsApp, or Meta's per-person limit). P4 then holds every demo intro and link message that afternoon. P1 and P2 fall back to email.
- **Fix:** measure health per source and per error type. Wave failures pause waves only, never sends tied to a booked or live call.

**H6. A lost Zoom event is permanent, and nobody can tell. (P1 7, P2 7, F flow)**
- **Lost:** P1 and P2 refuse webhook timestamps older than 300 s. Zoom retries at 5, 20 and 60 minutes; whether a retry carries a new timestamp is UNVERIFIED. F drops the time limit for exactly this reason.
- **No manual button:**
  - P1 has no "They joined" button for Zoom.
  - F sends a handover link only on `host_in`, which only a Zoom event sets, and has no Zoom "I'm in" button. If the webhook is down, every Zoom handover expires at 120 s and the lead never gets a link.
- **Hidden:** "last Zoom event" on the health line cannot tell broken from idle, on Fridays and at night.
- **Fix:**
  - Check no time limit; remove duplicates by event key instead.
  - Show "I'm in" and "They joined" for Zoom after 30 s with no event.
  - The doctor compares each ended room with Zoom's past-meeting participant report. A mismatch turns the health line red.

**H7. A live demo can be ended with the lead still in it. (P2 5 "booked call coming up"; F `ends_at` + 30 min)**
- **The rule:** "10 minutes before a booked call, the room ends." It is not limited to empty standby rooms.
- **Scenario:** a live demo starts at 14:30 and the closer has a booked demo at 15:00. At 14:50 the sweep sends Zoom's end-meeting call while the lead is talking.
- **Fix:**
  - Never end a room in `lead_in` or `lead_joined`.
  - The booked-call guard applies only to a closer who is waiting in an empty room, joining one, or has stepped out. Otherwise it alerts the closer and the setter.

**H8. "Who is free" reads a calendar copy that is 3 to 18 minutes old. (F presence, P2 booked-call guard, P4 trigger)**
- **Why it matters:** leads book their own demos. In the last 90 days, 199 bookings on "Demo 2" came from the public calendar page (B2B `createdBy.source`). B2B reads HighLevel every 15 minutes, and the mirror runs every 3 minutes.
- **Scenario:** a lead books a 15:00 demo at 14:45. The closer takes a live handover at 14:52. At 15:00 the booked lead hits Zoom's one-meeting-per-host block.
- **P4 cannot meet its own test:** "plans a chat for every new demo within 5 minutes" is not possible on this copy.
- **Fix:**
  - Before offering or assigning a handover, read the rep's HighLevel events for the next 60 minutes directly.
  - P4's tick reads the two demo calendars directly for the next 48 hours.

**H9. P2's domain-wide Google access can write every calendar in the company. (P2 13 click 6, decision B)**
- **The problem:** delegation with `calendar.events` lets the service account act as any maharamedia.com user, the CEO included.
- **Where the key would sit:** in Supabase function secrets, which every function in Creative Triage can read.
- **Scenario:** one leaked log line or one bad function, and every event on the CEO's calendar can be read, changed or deleted.
- **Fix:**
  - Use per-rep OAuth instead: an Internal consent screen, `calendar.events` only, each rep's token kept on the VPS.
  - Or use F's route.
  - Keep the Zoom keys on the VPS. Copying them gives every function the app's report scopes too.

## MEDIUM

**M1. Live bookings of contacts who are not leads go into B2B's booking count. (P1 scope "any", P2, P3 waves)**
- **Why:** B2B counts `intros_booked` by `booked_at` with no tag filter (`b2b_window_metrics`).
- **Scenario:** 30 live intros from the 3,368 untagged contacts raise October's bookings and lower cost per booking. Ad performance did not change.
- **Fix:** either refuse live booking without a roas tag, or book those on a calendar outside the B2B map. Show "bookings from this month's leads" next to B2B's figure.

**M2. Two sources label the qualified and unqualified intro calendars the opposite way round. (P1 7, P2 7)**
- **The conflict:** the cockpit (`api/dialer.ts:770-773` and setting `calendars`) says `dsqmJ393…` is qualified. B2B `calendar_call_type_map` labels `cFeDl0FY…` "(qualified)" and `dsqmJ393…` "(unqualified)".
- **Fix:** read both calendar names in HighLevel and correct one source before any live booking. Which one is right is UNVERIFIED.

**M3. A WhatsApp template can show as "sent" when nothing went out. (F, P1, P4 templates)**
- **The code:**
  - `sendTemplate` saves `sent` / "enrolled" when the 12-second read-back sees nothing (`api/index.ts:1243-1255`).
  - The read-back accepts any outgoing WhatsApp since the start, including the WA Connector's copy (1099-1112).
- **Why it happens:** without "Allow re-entry", a HighLevel workflow quietly ignores a second enrolment. Only P3 asks for re-entry.
- **Scenario:** the second link to a lead that week is never sent, but the panel says "Link sent".
- **Fix:**
  - Re-entry on every cockpit workflow.
  - Match the read-back by the message text.
  - Show "not confirmed" and fall back to email when nothing is seen.

**M4. "Send all 40 openers" stops at 30. (P3 8)**
- **The limit:** the sender ceiling (`api/index.ts:1052-1058`) allows 30 messages per sender in 10 minutes, so sends 31 to 40 get a 429.
- **Shared limit:** P4's tick and P3's automatic sends both run as the sales desk and share one ceiling at 09:00.
- **Fix:** queue batch sends on the desk at a steady pace.

**M5. The demo chat test would be biased. (P4 Outcome, step 2)**
- **Arm switching:** the arm comes from a hash of the appointment id. A cancel-and-rebook gets a new id and can switch arm after the lead has already had chat messages.
- **Live demos:** P2's live demos land on the demo calendar and are shown by definition.
- **Marking:** under the B2B rule, an unmarked past demo counts as shown. The chat arm gets a "They're not here" button, so the two arms are marked with different care.
- **Fix:**
  - Hash the contact id.
  - Leave out "Live ·" appointments, and demos booked less than 30 minutes ahead.
  - Require a mark on every past demo in both arms, and show unmarked demos separately on the tile.

**M6. P1's room sweep rides on the mirror, and the queue hold depends on room state. (P1 States)**
- **Scenario:** a B2B read fails early in the mirror run, so `room.sweep` never runs. Rooms stay `sent`, and those leads stay out of the dialer queue with no end.
- **Fix:** give the sweep its own pg_cron job, and make `candidates()` hold a lead only while `closes_at > now()`.

**M7. The WA Connector is not a hard stop for P1 or the foundation. (P1 edge 18, F phase 2)**
- **Scenario:** pilot leads get every link twice.
- **Fix:** block all room WhatsApp sends in code until the connector is off, and share P4's duplicate detector (two identical outgoing messages within 60 s pauses everything).

**M8. P1's Zoom setup conflicts with P2 and may miss joins.**
- **Conflict:** P1 wants join-before-host on and the waiting room off, but P2 asks the CEO to turn the waiting room on for the whole account.
- **Missed joins:** P1 does not subscribe to `meeting.participant_jbh_joined`. Whether `participant_joined` also fires when someone joins before the host is UNVERIFIED.
- **Fix:** F's waiting-room setup for everything, and subscribe to both events.

**M9. P1's shown mark runs HighLevel automations on a live intro. (P1 7)**
- **Why:** with no quiet flag, `crmDecision` returns "write" for today's calls (`api/lib.ts:95-101`), so HighLevel's "Showed" workflows run on a booking made with `toNotify:false`.
- **Fix:** pass quiet for live bookings, as P2 does.

**M10. Nothing alarms when a worker goes quiet. (F health line, P3 lapse alert)**
- **The evidence:** the `status` row was last written on 2026-09-24 and `doctor` on 2026-09-27, and nothing flagged either.
- **Why:** F's red line only shows when someone opens the Team page. P3's lapse alert is sent from the VPS, so it dies with the VPS.
- **Fix:** a pg_cron watchdog in Supabase every 5 minutes. It checks the age of the rooms, follow-ups and threads status rows and alerts the CEO by Slack or email, during hours only.

**M11. P2 re-routes a handover after the link went out. (P2 5 "The closer leaves before the lead joins")**
- **Scenario:** in phases 3 and 4 the lead has the raw `join_url` to the first closer's room. They land in a dead room.
- **Fix:** make the short link required for handovers, or send a second message whenever the room changes.

**M12. P2 assigns a "ready" closer without asking them.**
- **Scenario:** the closer is away from the screen, and the lead waits 10 minutes in the waiting room.
- **Fix:** a 20-second "Accept" step before the link goes out; if nobody accepts, route to someone else.

## LOW

- **Moved message during a live call (P4 edge 3).** When P2 moves an existing demo to now, P4 sends "your demo is now on…" while the lead is in the call. Close the chat with a `live_call` reason when P2 moves it.
- **Test contact (P1 test step 1).** Its cockpit row shows `dnd = true`. That probably means HighLevel's contact-level DND, and `dndFor` then blocks every channel (`api/lib.ts:428`), so "email-only DND off" would not unblock email. Check it in HighLevel first.
- **Template support (P4, P1 templates).**
  - `sendTemplate` only fills `first_name`, `rep_name` and `line` (`api/lib.ts:661`). There is no URL-button variable and no time variable yet.
  - P1's `call_link_en` body ends with `{{3}}`. Meta tends to reject bodies that end with a variable (UNVERIFIED in this session).
  - P4 misstates `confirm_from`: it sends at 09:00 the same day for afternoon calls (`followups.py:317-327`).
- **Slack (P2 manifest).** Slack checks the Events URL with a `url_verification` challenge. The door spec handles only Zoom's check, so the install will fail.
- **Room worker gap (F worker).** `flock -n` with a 57-second run means a run that overruns skips the next whole minute. The gap can reach 60 s, not 3 s. Use a systemd service, or keep each provider call under 8 s.
- **Phones.** Leads tap from WhatsApp on phones; Meet and Zoom both push an app install. Log the device on open and show the install step on the short page.
- **P1 privacy.** P1 puts "Intro on video: {first name}" on the CEO's primary calendar, against F's rule that titles carry only the code.

## The five fixes that matter most

1. **One contract (C1, H9).** F becomes the only spec for rooms, handovers, availability, webhooks and settings, with one booking claim. No domain-wide Google delegation. Keys stay on the VPS or in narrow per-rep tokens.
2. **Booked calls reuse their own meeting and availability reads live data (C2, H8, H7).** The short link wraps the appointment's existing Zoom. Availability and the booked-call guard read HighLevel directly. A room with a lead in it is never ended.
3. **Make the join signals work and visible (H1, H6, M10).**
   - The doors call sales-api through `CRON_ACTIONS` with the cron secret.
   - No timestamp limit; manual "I'm in" and "They joined" for Zoom.
   - The participant report as the second source.
   - The Supabase-side watchdog.
4. **Protect the official numbers (H2, H3, M1, M2).**
   - All tests on a calendar outside the B2B map.
   - Delete instead of marking invalid.
   - Write the cockpit copy before any mark.
   - No uncounted live bookings for non-leads.
   - Settle the qualified calendar label first.
5. **Stop one project's WhatsApp problem from hitting the others (H5, H4, M3, M7).**
   - Health measured per source.
   - Do-not-disturb only on explicit unsubscribes, after a rep confirms.
   - The WA Connector switch-off enforced in code.
   - Re-entry on every workflow, and an honest "sent".