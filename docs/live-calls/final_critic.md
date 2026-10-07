# Review: the sales follow-up and live calls plan (completeness and value)

I only read, and wrote nothing. I checked origin/main `9670e5b`, Creative Triage and the B2B database (read-only SQL), and the five specs. Every line number I spot-checked in `supabase/functions/sales-api/index.ts`, `lib.ts`, `dialer.ts` and `clients.ts` points at the function the specs name.

## Verdict

- **The specs are careful, but they are not one plan yet.** The foundation, P1 and P2 each design their own version of the core:
  - three room data models;
  - two handover models;
  - three Google routes;
  - three Edge Functions taking the same Zoom webhooks;
  - two Slack apps.
- **P1 and P2 would collide on day 1 if built as written.** P1 and the foundation give the same migration file name, `20261003a_sales_rooms.sql`, to different tables. Three specs use `api/rooms.ts` for three different modules.
- **The business case misses the biggest fact in the data: almost nothing is coming in.**
  - P1, P2 and P4 need dials and booked calls, and there are almost none.
  - Only P3's backlog waves create bookings without new leads. Its reactivation opener needs no AI.
- **This plan cannot deliver the October targets (100 intros, 60 demos, 8 clients).** The CEO should hear that now.

## 0. What I checked today (2026-10-03)

| Fact | Number | Source |
|---|---|---|
| New leads per week (tagged roas-qualified or roas-unqualified), weeks starting 24 Aug to 28 Sep | 65, 55, 21, 4, 1, 0 | B2B `leads` by `lead_created_at`. It last synced 2026-10-03 09:40 UTC, so the drop is real, not a stale copy. |
| Booked intros and demos, by week of the call, 31 Aug to 28 Sep | 67, 32, 3, 3, 1 | B2B `calls`, location 7NI8yyJtwsh2OOWA5Icr |
| Upcoming booked calls | 0. The last booking was made 2026-09-28. | B2B `calls` |
| Cockpit dialer attempts, ever | 12. The last was 2026-09-27 10:46. | `cockpit_sales_attempts` |
| Maqsam calls in B2B | 72, 20, 22, 3 per week. The sync last ran 2026-09-20. | B2B `maqsam_calls` |
| Follow-up drafts | 81 ever, the last on 2026-09-26, 0 sent. `cockpit_sales_messages` has 0 rows. | Triage |
| VPS Claude sign-in | Still lapsed at 12:37 today (followups, reviews, notes and digest rows). Doctor last ran 2026-09-27. | `cockpit_sales_worker_status` |
| September demos | 17 rows: 11 confirmed, 4 no-show, 2 cancelled, 0 marked showed. 14 of the 17 were on "Demo 2". | B2B `calls` |
| September intros | 74 rows: 22 showed, 13 confirmed, 33 no-show, 5 invalid, 1 cancelled | B2B `calls` |
| Seats | 4 active (2 managers, the setter, the closer). 0 have a `slack_user_id`. | `cockpit_sales_people` |

Why leads stopped is UNVERIFIED. The most likely cause is that the ads stopped running. Check Ads Manager.

## 1. The six asks, word by word

| Ask | Status | Where it is covered, and the gap |
|---|---|---|
| **1. Five follow-up goals** | Covered | P3 §3.2 |
| **1. Reactivation opener template** | Covered | P3 §3.2. It sends the fixed opener with no model text. |
| **1. Contextual email nurture** | **Missing** | P3 says nurture "grows in Phase 4", but P3's rollout stops at phase 3. There is no design and no build days. |
| **1. "Reps approve first, then it sends by itself, one kind at a time"** | Partly | P3's ceiling keeps these from ever reaching "Sends by itself": leads under 30 days old, anyone who had a demo, the hot list. That rules out new leads, demo no-shows, after-demo and demo cancellations. Only the reactivation opener ever sends on its own. That may be wise, but it reverses the CEO's words and is buried in the spec. Make it a decision. |
| **1. "Lives in the CRM"** | Partly | Messages land in HighLevel conversations. Drafts, levels and sequence steps live only in the cockpit. No spec writes a HighLevel note or tag per step, so nobody looking at the contact in HighLevel can see "agent: no-show 2 of 4, next Thursday". |
| **1. "Qualified at the intro"** | Undefined | `good_intro` says "qualified", but the intro outcomes are only showed, no-show, no answer and disqualified (`dialer.ts:908-912`). "Qualified" exists only as the ad-form class (`dialer.ts:232`, `780`). Define it as "intro shown and not disqualified". |
| **2. The setter presses live handover while on the phone** | Covered | P2 §3 |
| **2. "Whatever lead replies"** | Partly | A rep must press "Offer a call now". P3's call-now intent only drafts. Keeping a human in the loop is fine, but say so. |
| **2. Intro or demo, on any lead** | Covered | P2's lead-page menu |
| **2. "Presses available on Slack, joins the waitroom, and the meeting gets created"** | Covered by P2, contradicted by the foundation | P2's standby room opens when the closer presses Available, which is the CEO's model. The foundation makes the room only after a claim. |
| **2. Slack** | Covered with a dependency | The setter and the closer are not in Slack. P2 makes the cockpit banner do everything Slack does, which is good. |
| **2. "Use workflows so there's no mix-up"** | Partly | The specs use database locks, which is correct. None tells the CEO the plain reason: HighLevel workflows cannot hold a lock, so the no-mix-up rule lives in the database, and HighLevel workflows only send templates. Add that sentence. |
| **3. WhatsApp group: the setter makes it, with the closer and the lead, created automatically** | Substituted | P4 recommends no group (route C) and requesting the Official Business Account (OBA). That is probably right, but two gaps remain. The setter cannot start the chat: the hash decides who gets it, and a tap "can never move a lead into the chat group". With a 50% comparison group, half the demo leads get nothing new. Tell the CEO plainly: "You asked for a three-way group. Meta allows only a one-to-one chat on the official line now. A group needs the OBA plus three checks." |
| **3. "For a set amount of time"** | Covered | P4: until 2 days after the demo, or the deal is won or lost |
| **4. "Automatically make a Zoom or Meet and send the link"** | Partly | P1 is one tap, not automatic. It also only fires from the cockpit dialer, which has 12 attempts ever. |
| **5. Setter on Meet; both Zoom and Meet offered** | Covered, with a risk | In the foundation and P1, the CEO organises every Meet event, so it is unproven that the setter can admit the lead. Only P2's delegation route makes the rep the organiser. |
| **6. "The full plan, an amazing one"** | Partly | Five specs, but no single timeline, CEO list, decision sheet, cost line, scorecard, rep training or visuals |

## 2. Contradictions across the specs

1. **Migration names.** All four use `20261003a_`. The foundation and P1 also share the full name `20261003a_sales_rooms.sql` with different contents.
2. **The room table.**
   - Foundation: `cockpit_sales_rooms`, lead required, 9 states.
   - P1: `cockpit_sales_rooms` with 10 different states plus `channel` and `result`.
   - P2: `cockpit_sales_live_rooms`, and it says P1's rooms live there too.
   - P2's standby rooms have no lead, which the foundation's model cannot hold.
3. **Room states.**
   - Foundation: requested, creating, open, host_in, lead_in, ended, expired, failed, cancelled.
   - P1: creating, ready, sent, opened, lead_waiting, lead_joined, done, closed, cancelled, failed.
   - P2 gives its room table no state list.
4. **The handover model.**
   - Foundation: offer goes to every available closer; `cockpit_sales_live_claim`; the room is made after the claim; 4 states.
   - P2: a standby room exists first and the lead goes to the closer who has waited longest; `cockpit_sales_live_assign` plus `_take`; 6 working states.
5. **Secrets.** The foundation stores `start_url` only. P1 stores `join_url` and `host_url`. P2 never stores `start_url`.
6. **Where rooms are made.**
   - Foundation: on the VPS, with keys staying there. That is its decision A.
   - P1 and P2: in sales-api, with the keys in function secrets. P1 calls the VPS too slow, and P2's decision A recommends the opposite of the foundation's.
   - "Decision A" therefore means opposite things in two specs.
7. **The Google route.**
   - Foundation: the CEO's token, a "Sales rooms" calendar, the title is the code only, no attendee.
   - P1: a narrow token on `primary`, titled "Intro on video: {first name}", with the setter as attendee. That breaks the foundation's privacy rule.
   - P2: a service account with domain-wide delegation, so the rep is the organiser.
8. **Inbound doors.** The foundation has `sales-live`, P1 has `room-go` and `room-hooks`, P2 has `sales-live-door`, and P4 has `wa-groups-hook`. That gives three different Zoom webhook URLs in three CEO click lists.
9. **Zoom meeting settings.**
   - Foundation: join before host off.
   - P1: join before host on and the waiting room off, so a forwarded link walks straight in.
   - P2: waiting room on for people outside the account.
   - The topic format differs in all three.
10. **Webhook timestamp window.** The foundation sets none, P1 sets 5 minutes and P2 sets 300 seconds. If Zoom's retries keep the original timestamp (UNVERIFIED), P1 and P2 refuse every retry.
11. **Short link.**
    - Foundation: 6 uppercase characters, a Vercel rewrite to a 302, and a non-bot GET counts as an open.
    - P1: 8 lowercase characters, a static page plus `room-go`, and an open counts only when the page script runs.
    - P1's own example `AB12CD34` breaks its alphabet (uppercase letters and the digit 1).
12. **Module and action names.**
    - `api/rooms.ts` means three things: the message service (foundation), pure logic (P1), and the Zoom and Google calls (P2).
    - The action `room.open` returns the host link in the foundation but creates the room in P1.
13. **Settings shapes.**
    - `rooms` has two shapes. The foundation has both providers off and `default_provider` as an object. P1 has Meet on, `default_provider` as a string, and `max_open`.
    - `live` has 3 keys in the foundation and 18 in P2.
14. **Waits and limits.**

    | Item | Foundation | P1 | P2 |
    |---|---|---|---|
    | Rep gets into the room after taking a lead | 120 s | (not specified) | 180 s |
    | Wait for a pending Meet link | 30 s | 10 s in one place, 5 polls in another | 6 s |
    | Give up on making a room | 60 s | 20 s | (not specified) |
    | Misses before the rep goes Away | 1 | (not specified) | 2 |
    | Availability | 2 hours | (not specified) | blocks of 30, 60 or 120 minutes |
    | Open rooms per host | 1 | 3 on Meet | (not specified) |
    | Sweep | every minute, plus the VPS every second | every 3 minutes | every 20 s |

15. **Live booking and marking.**
    - P1 titles the booking "Live intro: {name}"; P2 titles it "Live · {name}". P2's daily second-source check counts only "Live ·", so it would flag every P1 live intro as a mismatch.
    - P1 marks shown with the default notify setting. `writeMarkToCrm` sends `toNotify: true` (`index.ts:263-271`), which runs HighLevel automations. P2 adds a `quiet` option (`markAppointment`'s options at `index.ts:304` have none today). The same event would have different effects in the CRM.
16. **Slack.**
    - Foundation: app "Mahara Sales", `/available` and `/away`, a DM to every available closer, token on the VPS.
    - P2: "Mahara Live Calls", `/available` and `/unavailable`, a call-out in `#sales-live`, token in function secrets.
    - P3 says the Slack token lives only on the VPS.
17. **Templates.**
    - Names: `call_link_en` (foundation), `call_link_en` with a different body and 3 variables (P1), `live_call_link_en` (P2), and `join_call_*` (P4, which says it is "shared with P1", but P1 names `call_link`). P3 uses `cockpit_line_*` and `cockpit_opener_*` in §13 but `line_*` everywhere else.
    - Variables: the code has only `first_name`, `rep_name` and `line` (`lib.ts:661`). P1 puts the link into `line`. P4's `demo_host` {{3}} needs the demo time, but no field for it exists in any spec.
    - Whether a HighLevel workflow can fill a dynamic URL-button variable is UNVERIFIED in all specs.
18. **Demo calendars.** P4 covers both. The foundation, P1 and P2 name only `jQqXS1YuFnmGZKLkrE62`. But 14 of September's 17 demos were on "Demo 2" (`NDBNz6Og4yfpdpWmHrue`), and the booking form books on "Demo" only (`dialer.ts:773`).
19. **Hours.**
    - P3: recommends first messages 09:00 to 18:00, but the server allows 09:00 to 21:00 (`index.ts:1844-1848`).
    - P2: live calls Saturday to Thursday, 10:00 to 20:00.
    - P4: quiet hours 21:00 to 09:00.
    - There is no single hours table.
20. **Numbers.**
    - P4's table says "120 per group: 4 months, 17 points". Its decision point and tile say "120 demos" in total, which is 60 per group: about 2 months and a 23-point detectable effect.
    - P3's "never booked, then booked" and "no-show booked again" baselines are both 3.6%. Check this is not a copy error.
    - Demo counts differ: "7, 3, 1" (P3, last 30 days), "11 of 17" (P4, September), "11 demos" (the brief). Use one table.
21. **"New files only" is broken five ways.** P2 changes `markAppointment`, P1 changes `candidates()`, P3 changes the segment constraint plus `lib.ts:657`, `followups.py:73` and `FollowupsPage.tsx:119`, and P4 changes `sendTemplate` and the messages source check (`20260924n_sales_messages.sql:27`). Meanwhile the foundation says "no existing constraint changes".
22. **Base commit.** The specs were written from two commits (`f1ed167` and `9670e5b`). The local checkout is now 3 commits behind origin/main, not 1 or 2 as the briefs say.

## 3. The business case

**The baselines are softer than the specs assume:**

- **No September demo was marked showed.** All 11 counted as shown only by the B2B rule (confirmed and the time passed). 13 of the 35 "shown" intros were never marked either.
  - So the true show rate is unknown.
  - Anything that adds hard marks (P1 no-shows, P2 Zoom joins, P4 "They're not here") can lower the reported rate while real shows rise.
  - Report two lines side by side: shown by the B2B rule, and shown with evidence (a mark or a Zoom join).
- **The demo gap may be 2 points, not 10.** 11 of 17 (65%) counts the 2 cancellations as misses. 11 of 15 is 73%. State which denominator the 75% target uses.
- **I could not reproduce the intro rate.** I get 35 shown of 68 (51%) once invalid and cancelled calls are removed. 54% needs a denominator of 65. UNVERIFIED which rule produced 54%.
- **P1 would inflate the show rate.** Its "closed" copy tells the setter to "Save the call as No answer". On an intro, No answer writes no mark (`dialer.ts:910-911`). The call stays confirmed, and the B2B rule then counts it as shown. P1 also claims "marked no-show as today", which the code does not do.
- **Live calls are 100% shown by construction.** Keep the 60% and 75% targets on calls booked ahead only.

**Each project, sized:**

- **P1 (intro show rate).**
  - At September's volume (33 intro no-shows), P1's own targets (60% coverage, 20% joins) save about 4 intros a month, about 6 points. That only reaches the 60% target if every target is hit.
  - "2 saved a week" needs August's volume (about 17 no-shows a week).
  - At today's volume (1 intro last week), it saves about 0.
  - Its coverage cannot be measured while dials happen outside the cockpit.
- **P2 (intro to demo, and demo show).**
  - The strongest case is missing from the spec: a closer joins right after a good intro.
  - September had about 35 shown intros and 17 demos, about half. October needs 60 demos from 100 held intros (60%).
  - Measure "shown intros that became a held demo within 24 hours".
  - The target of 15 handover demos in October is not credible. It sits behind 10 build days, a 1-week pilot, Slack invites, a Zoom licence, Google delegation, and dials near zero.
- **P3 (replies answered and the backlog).**
  - It is the only project with volume now: 1,281 leads in jobs plus 3,368 untagged.
  - At its own 90-day targets it would bring about 28 rebooked no-shows, 23 first bookings, 10 rebooked cancellations, 23 demos from good intros and 7 closes. These are targets, not results.
  - Even that is about 40 bookings a month.
  - Its attribution rule (a booking within 7 days of a send, after a reply) will also claim bookings that would have happened anyway. Add a 10% holdout to each wave.
- **P4 (demo show rate).**
  - At current volume it never reads.
  - At 60 demos a month, a 50/50 split can only detect a 23-point effect after 2 months, and it costs half the benefit while it runs.
  - Use an 80/20 split and show the result as a range.
- **Closes.** September closed 2 of 11 held demos (18%). October's 8 clients from 45 demos needs the same 18%, so the close rate is not the gap. Volume is.
- **October math.** 8 clients need 45 held demos, which need 60 booked demos, which need 100 held intros. That means about 167 booked intros, or about 670 leads at the 25% lead-to-booking gate. The current flow is 0 to 4 leads a week.

## 4. Can it be built, and in what order?

**Build days.**
- As written: foundation 6, P1 6 plus a 1-week pilot, P2 10, P3 21, P4 7. That is 50 days.
- Merged so rooms are built once: about 42 days. At 5 days a week that is about 8.5 weeks, landing in early December.

**Blockers, in order:**

1. **The VPS sign-in.** It takes the CEO 2 minutes and has been pending since 2026-09-27. It blocks P3 and the doctor.
2. **Templates and workflows.** They block P3 G1, P4 phase 3, and the template phases of P1 and P2. Submit the whole catalogue on day 1. How long Meta review takes is UNVERIFIED.
3. **The WA Connector.** It blocks every WhatsApp send in all four projects.
4. **The Zoom licence (decision 1).** It blocks P2 demos: Basic cuts at 40 minutes and demos run 45. If "Demo 2" uses the closer's Basic Zoom, booked demos are cut today. UNVERIFIED.
5. **Google delegation.**
   - It needs a service account key. Newer Google Cloud organisations block key creation by default. UNVERIFIED for this organisation.
   - The CEO could not find the Meet API, so expect this to need a guided session.
   - Delegation with `calendar.events` can act as any user in the domain, including the CEO. It is narrow in scope, not in reach. Say so.
   - The setter needs a Workspace account. UNVERIFIED that one exists.
6. **Slack.** Free plans limit the number of apps. UNVERIFIED which plan this workspace is on.

**Working beside the other session.**
- Safe to build in parallel: P4's planner, P3's phase 0 desk fixes, the merged rooms migration and pure modules, the door function and the short-link site.
- Everything else in `index.ts`, `lib.ts` and the two constraints goes in one "hooks" commit. Deploy it once from the latest main, with the live version checked before and after.

**A clearer first week:**

| Day | CEO | Build |
|---|---|---|
| 1 | Setup session 1: sign Claude in on the VPS, WA Connector off, templates submitted, wallet topped up, WhatsApp test contact | Merged rooms migration; P3 phase 0 fixes |
| 2 | (none) | Doctor green; P4 planner and tests; room providers |
| 3 | Setup session 2: Zoom webhook, licence choice, Google delegation, CNAME | Room actions and the door function |
| 4 | (none) | P3 email test on the test contact; P4 dry run on; P1 panel in the harness |
| 5 | (none) | First reactivation wave of 40, if the template is approved and the single-copy test passes; P1 live test with 20 rooms |

## 5. Ten changes that would make this plan amazing

1. **Open with one page on the state of the sales floor.** Use the verified table above, the October math, and one line: "These projects lift rates. None creates leads. October needs the ads back on."
2. **Merge the foundation, P1 and P2 into one "Live rooms" spec.** Use P2's standby-room handover (the CEO's own words) and P2's Google delegation. That means one migration, one table with the lead optional, one state machine, one door, one Zoom URL, one Slack app, one settings shape and one table of waits. It saves about 8 days and removes most of the 22 contradictions.
3. **Put P3 reactivation first.** It needs no AI, it reaches 4,649 contacts, and it is the only source of bookings this month. Add a 10% holdout to each wave.
4. **One CEO setup sheet, in order, with minutes and money for each step.**
   - It should cover these 13 steps: the sign-in, the WA Connector, the template catalogue, the wallet, the CNAME, one Zoom webhook, the licence, delegation, Slack invites, the OBA request, Meta verification, the consent line and the test contact.
   - The template catalogue should be 4 templates in Arabic and English (line, opener, demo_host, join_call), each with its workflow and its variable mapping.
   - Run it as two guided 45-minute sessions.
5. **One decision sheet.** Fold the 6 open decisions, the foundation's A to C, P2's A to D, P3's 6 and P4's 7 into about 10. Give each a recommended answer and a date after which the default applies.
6. **Fix measurement before launch.**
   - Show rate by the B2B rule beside show rate with evidence.
   - Live calls kept out of the 60% and 75% targets.
   - P1's "closed" state marks a booked intro as a no-show.
   - The denominator stated for 65%.
   - One weekly scorecard, with the second source beside each number.
7. **Fix adoption first.** There are 12 cockpit dials ever. Make "the setter dials from the cockpit" a gate for P1 and P2, and track the share of Maqsam calls placed through the cockpit. Give P1 the automatic mode the CEO asked for, so it does not depend on a button.
8. **Train the reps.**
   - 30 minutes per rep.
   - A one-page "what to press when" for the setter and the closer.
   - P2's strip lines as a phone script.
   - A role-play on the test contact with the CEO playing the lead.
   - A daily 15-minute check in week one.
9. **Add visuals.**
   - An 8-week timeline with the critical path and the CEO's blockers marked.
   - One flow diagram per project, with lanes for the lead, the rep and the system.
   - Mockups of the room panel, the availability strip and the demo chat card.
   - A map of which CEO step unlocks which feature.
10. **A launch checklist and first-week runbook for each phase.**
    - The order to turn switches on, the go or no-go gate, and the daily mix-up SQL check.
    - Who watches the health line, the kill switch, the rollback, and what "done at day 7" looks like.
    - Two missing pieces of the CEO's ask: a design for the contextual email nurture, and a HighLevel note or tag for each agent step.