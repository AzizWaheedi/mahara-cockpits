# Project 4 spec: the demo chat (one chat on the official line now, a WhatsApp group only after an Official Business Account)

Final, 2026-10-03. Code is origin/main (`scratchpad/im`). Data is read-only SQL of 2026-10-02 and 10-03. `api/` is `supabase/functions/sales-api/`, and tables carry `cockpit_sales_`. Names follow the foundation spec.

## What changed after review

1. Foundation names: room codes, `call_link_en/ar` (no `join_call_*`), and the `enabled`, `test_only`, `test_contacts`, `send` keys. (C1)
2. A booked demo gets no new room. The link wraps its own Zoom meeting. (C2)
3. The tick reads both demo calendars from HighLevel. The mirror is the second source. (H8)
4. Fair test: the arm is hashed on the contact, live and short-notice demos are left out, both arms get mark tasks, the split is 80/20, and the size table is fixed. (M5, critic)
5. Stop words hold the chat for the closer. Do-not-disturb is never set automatically. (H4)
6. Health per source; "sent" only when read back; re-entry on every workflow; 4 sends per tick. (H5, M3, M4)
7. Tests run on a calendar outside B2B's map, and cleanup deletes. (H2)
8. Route A webhooks use `sales-live` and `CRON_ACTIONS`. (C1, H1)
9. The chat closes as `live_call` when Project 2 moves the demo. (LOW)
10. The day-before rule is corrected. Existing code stops the agent's `confirm` draft. (LOW)
11. The setter can start any chat; HighLevel notes; a plain sentence on groups; a watchdog row; one hooks commit; migration `20261003d_sales_threads.sql`. (critic, M10)
12. Not applicable: H3, H7, H9, M1, M2, M9, M11, M12. The chat books, marks, moves and ends nothing, and uses no Google. H6 applies in part: "They're not here" always shows.

## Outcome and success numbers

**Plainly, for the CEO:** "You asked for a three-way WhatsApp group with the setter, the closer and the lead. Meta allows only a one-to-one chat on the official line now. A group needs an Official Business Account plus three checks."

**Goal.** Raise the show rate of demos booked ahead toward 75%. Live calls (Project 2) are left out.

**Baseline (B2B `calls`, September).**
- 17 demos: 11 confirmed, 4 no-shows, 2 cancelled, 0 marked showed.
- 14 of them were on "Demo 2" (`NDBNz6Og4yfpdpWmHrue`).
- 65% is 11 of 17. Without the cancellations it is 11 of 15, or 73%. The tile uses 17.
- Shown with evidence is 0 of 17, so the true rate is unknown.

**Volume today.** There are 0 upcoming booked calls; the last booking was 2026-09-28. New leads fell from 65 a week to 0. The chat creates no bookings, and it needs no AI.

**Metrics.**

| Metric | Target |
|---|---|
| Primary: show rate by assigned arm, by the B2B rule and with evidence | toward 75% |
| Replies before the demo | 50% |
| Opt-outs | under 2% |
| Templates failed or not confirmed | under 10% |
| The closer's median first answer, working hours | under 15 minutes |

Ship gates: zero doubled messages, zero quiet-hour sends, and zero sends to clients or do-not-disturb contacts.

**Test size** (70% base, 80% power, two-sided 5%):

| Demos in the test | At 60 a month | At 17 a month | Smallest lift seen, 80/20 | 50/50 |
|---|---|---|---|---|
| 120 | 2 months | 7 months | about 29 points | about 23 points |
| 240 | 4 months | 14 months | about 21 points | about 17 points |

The test catches only large effects, so it guards against harm. The tile shows a range.

### Which route

| | A: Groups API | B: WhatsApp Web tool | C: one chat, official line |
|---|---|---|---|
| Official-line rule | Yes | **No** | Yes |
| Lead gets in | Invite link only; 8 people max | Direct add | Already in |
| Staff numbers shown | Yes | Yes | No |
| In HighLevel | Probably not (UNVERIFIED) | No | Yes |
| Cost per demo | $0.06 to $0.30 | Tool fee | $0 to $0.24 |
| Blockers | OBA plus the three checks below | Ban risk | Templates; WA Connector off |
| Build | 8 days after the OBA | 5 days | **8 days** |

The rates are the brief's (UNVERIFIED). Kuwait's utility rates rose on 2026-10-01. Route C costs under $12 a month at 48 chats.

**Recommendation.**
- Build C now, and request the OBA in parallel.
- Reject B.
- Try A as a third arm on 20 demos, only after three checks:
  - the OBA is granted;
  - the number runs on Cloud API without the Business app;
  - Mahara's own Meta app keeps the number out of Multi-solution Conversations (UNVERIFIED risk).

**No mix-ups.** HighLevel workflows cannot hold a lock. So "one chat per lead, each step once" lives in unique indexes and conditional claims. Workflows only send templates.

## Who does what

- **System:** plans, sends as the host closer, holds, falls back and closes.
- **Setter:** books, can start the chat, and writes under their own name.
- **Closer:** owns the chat, answers, judges possible stops and marks the demo.
- **Lead:** reads, taps a quick reply, or writes.
- **Manager or CEO:** switches, comparison share, templates and the OBA request.

## The flow, step by step

### Happy path (route C, chat arm)

1. **Booked.**
   - Most demos are self-booked on "Demo 2": 199 came from the public page in 90 days. The cockpit form books only "Demo" (`api/dialer.ts:773`).
   - `thread.tick` runs as pg_cron `mahara-sales-threads` every 2 minutes. It reads both calendars from HighLevel for the next 48 hours (`GET /calendars/events`).
   - If HighLevel and `cockpit_sales_calendar` disagree, the health line says so.
2. **Planned.**
   - Checks: the contact is a cockpit lead (`cockpitLead`) and not a client (`api/clients.ts:13`); the host has a seat; it is not a live call (no `cockpit_sales_live` row and no handover or fallback room row); it was booked 30 or more minutes ahead. A demo that fails is `excluded`.
   - Arm: the first 4 hex characters of `sha256(contact_id)`, divided by 65,536, compared with `holdout_share`.
   - Host: the seat that matches the assigned user. 87 of 91 recent demos were the closer's.
   - A HighLevel note is written.
3. **Intro**, 5 minutes later, or at 09:00 lead time if it falls in quiet hours.
   - Window open: free text through `convoSend` (`api/index.ts:873`).
   - Window closed: `demo_host` through `sendTemplate` (1141).
   - No phone, or WhatsApp do-not-disturb: email.
   - Each send writes a `message_sent` confirmation. The agent's `confirm` pick already skips those appointments (`hermes/sales-desk/desk/followups.py:536-546`).
4. **Quick replies.** "Yes, I'll be there" writes `result=confirmed`. "I need another time" puts the lead on the closer's Today strip. Whether a tap opens the window is UNVERIFIED (Test C).
5. **Check**, at 18:00 lead time the evening before. It goes only if the demo is 20 or more hours after the intro and the lead has not replied.
   - It goes as free text, else through the `line` route (Project 3) if that is active, else not at all.
   - The agent's `confirm_from` works differently: it sends at 09:00 the same day for afternoon calls (`followups.py:317-327`).
6. **Link** (C2).
   - At 15 minutes before, the tick calls the foundation's `room.create` with `purpose=booked`.
   - sales-api reads the appointment (`GET /calendars/events/appointments/{id}`) and takes its `address`. 90 of the last 91 demos hold a HighLevel Zoom link there.
   - It inserts the room in state `open`. No meeting is created.
   - Window open: free text with the short link.
   - Window closed: the `call_link` template, 2 minutes before ("ready now").
   - If the room is refused because the closer still hosts a live room, the message carries the raw `address`.
7. **Late**, 5 minutes after the start. It runs if the room is not `lead_in`, or if the closer pressed "They're not here".
   - The button always shows, because Zoom events need HighLevel's host to be in Mahara's account (UNVERIFIED).
   - Window open: the holding line goes. The panel offers "Call on Maqsam".
8. **After.**
   - The chat closes at the first of: 2 days after the demo, the deal won or lost, or the `client` tag.
   - A note is written, and the agent's segments take over.
   - An unmarked demo gives its host a mark task 2 hours after the start, in both arms.

### Comparison arm

The row gets `arm=holdout` and state `holdout`, with no steps. HighLevel's reminders go out as before.

### The setter's start

"Start the demo chat" sits after `BookForm` `onBooked` (`DialerPage.tsx:1942`) and on the lead page.
- **Chat arm:** the intro goes now.
- **Comparison arm:** the button asks first. A yes sets `override_by`, but the demo still counts as comparison. That only makes the test more cautious. The tile shows overrides.

### Route A (after the OBA and the checks)

1. The VPS worker creates the group "{Company} and Mahara Media" and sends the "Group invite upon request" template. Staff join from work phones.
2. Webhooks reach `sales-live` `POST /meta`, which calls `thread.group_event`.
3. If the lead has not joined 3 hours before the demo, route C runs.
4. To close: the closing line, then `DELETE /<GROUP_ID>`.

### Ties to the other projects

- **Project 2:**
  - A reply while the host is `available` shows "Start a live call now", and the link goes free in the window.
  - A demo moved to now closes the chat as `live_call`.
- **Project 3:** replies go to the closer first. The agent drafts after 30 minutes unanswered. It signs as the chat's closer until 7 days after close.

## States and transitions

| State | Entered when | Left when | Timeout |
|---|---|---|---|
| planned | Chat arm planned | Intro sent; moved; cancelled | Intro skipped if unsent 30 min before |
| holdout | Comparison arm | Close rule | 2 days after |
| introduced | Intro sent | 15 min before | none |
| at_call | 15 min before | 60 min after start | 60 min |
| after_call | 60 min after start | Close rule | 2 days after |
| held | Switch, health, ceiling, no route, possible stop | Block clears | Passed steps skipped |
| closed | won, lost, client, cancelled, opted_out, undeliverable, dnd, manager, two_days_after, live_call | never | final |

Excluded demos close at once, with a reason of `no_host`, `client`, `live_call` or `short_notice`. Step states: planned, sending, sent, unconfirmed, skipped, failed, held.

## Edge cases and failure handling

1. **Booked in quiet hours for before 09:45:** only the link goes.
2. **Rescheduled:** unsent steps are re-planned, and a "moved" line goes if the window is open. HighLevel may notify too (`toNotify: true`, `api/index.ts:3790-3796`).
3. **Second demo:** one open chat per lead, on the earliest demo. The move is audited.
4. **Host changes:** later steps sign as the new host. The host change line goes if the window is open.
5. **No phone, or WhatsApp do-not-disturb:** email. Do-not-disturb on every channel closes the chat as `dnd`, and the demo keeps its arm.
6. **Stop words** (`OPT_OUT`, `followups.py:112-117`): this also matches "لا تتصل الحين" ("don't call now"). The chat goes to `held` (possible_stop). The closer confirms (`opted_out`) or dismisses.
7. **Health:** `whatsappHealth` (`api/index.ts:1029-1045`) counts all sources today. With the `source` filter, the chat holds only on its own failures or a number-wide error such as an empty wallet. After 30 minutes held, the intro goes by email.
8. **No active template** (`line_en/ar` are inactive today): email outside the window.
9. **Ceilings:**
   - At 250 templates a day (1170-1177), the step is held to tomorrow, or goes by email if the demo comes first.
   - Within 2 minutes of another template (1163-1168), the next tick retries.
10. **Not confirmed:** `sendTemplate` saves "enrolled" as sent when the read-back sees nothing (1257). With text matching, `unconfirmed` intro and link steps go by email. Two failures close the chat as `undeliverable`.
11. **WA Connector doubles:** two identical outbound messages within 60 seconds pause every chat. The detector is shared with the foundation (M7).
12. **Sender ceiling:** desk sends share `sent_by = sales-desk`, capped at 30 per 10 minutes (1052-1058). The chat sends 4 per tick, intro and link first.
13. **Overlapping ticks:** each step is claimed by a conditional PATCH.
14. **HighLevel unreadable, or the tick stale:** "The demo chat could not read HighLevel's calendars at {time}." The watchdog alerts the CEO after 10 minutes in working hours. Missing is never shown as zero.
15. **Time zones:** UAE and Oman are UTC+4, the rest UTC+3. The country is named in every time.

## Data model and settings

**Migration `20261003d_sales_threads.sql`.** It runs after the foundation's `20261003a_sales_rooms.sql` and follows the pattern of `20261002e_sales_client_forms.sql`.

**`cockpit_sales_threads`**
- Identity: `id uuid pk`, `contact_id`, `appointment_id unique`, `request_id unique`.
- Route and arm: `route` (one_chat, group), `arm` (chat, holdout, excluded), `override_by`.
- State: `state`, `held_reason`, `close_reason`.
- People and call: `host_email`, `setter_email`, `demo_start_at`, `language`, `tz`, `room_id`.
- Consent: `consent_source` (booking_page, setter_asked, lead_wrote).
- Times: `first_reply_at`, `mark_task_at`, `closes_at`, `closed_at`, plus timestamps.
- Route A: `group_id`, `invite_link`.
- Unique index: `(contact_id) where closed_at is null`.

**`cockpit_sales_thread_steps`**
- `id`, `thread_id` (cascade).
- `step` (intro, check, soon, late, moved, host_change, close_note), `due_at`, `state`.
- `via` (free, template, email), `message_id`, `request_id unique`, `skip_reason`, `sent_at`.
- Unique index: `(thread_id, step)`.

**Access.**
- RLS on, with seat read through `cockpit_sales_seat()`.
- Revoke from public, anon and authenticated. Grant all to service_role.
- Grant select to authenticated **by column, without `invite_link`**, as `CONTRACT_COLS` does (`api/index.ts:4263`).
- End with `notify pgrst`.

**Hooks commit.** One deploy, announced to the parallel session first. It holds:
- `'thread'` added to `cockpit_sales_messages_source_check` (`20260924n_sales_messages.sql:27`).
- `{source, signAs}` on `convoSend` and `sendTemplate`. Today `source` is followup or rep (1205), and `signatureFor` (1119) signs as the owner.
- `whatsappHealth({source})`.
- Read-back by text.
- `call_time` and `join_code` in `TEMPLATE_VARIABLES` (`api/lib.ts:661`).
- `thread.tick` in `CRON_ACTIONS` (5085) and `DESK_ACTIONS` (5076).

**Setting `threads`** (no secrets):
```json
{"enabled": false, "plan": false, "test_only": true, "test_contacts": ["VjPfR4Cc1Y0OFvaqeor5"],
 "send": {"whatsapp_text": false, "whatsapp_template": false, "email": false},
 "holdout_share": 0.2, "calendars": ["jQqXS1YuFnmGZKLkrE62", "NDBNz6Og4yfpdpWmHrue"], "test_calendar": null,
 "min_notice_min": 30, "intro_delay_min": 5, "check_hour": 18, "soon_min": 15, "template_link_min": 2,
 "late_min": 5, "close_after_days": 2, "per_tick": 4, "hours": [9, 21],
 "templates": {"host_en": "demo_host_en", "host_ar": "demo_host_ar", "check": "line", "link": "call_link"}}
```
`wa_fields` gains `join` (`cockpit_join_code`, shared) and `when` (`cockpit_demo_time`).

**Wrap rooms** (`purpose=booked`) take their deadlines from the appointment:
- `host_by`: the start plus 10 minutes.
- `lead_by`: the start plus 15 minutes.
- `ends_at`: the start plus 45 minutes.

The worker never ends a wrapped meeting. Closing the room only retires the short link.

## Integrations and calls

**Modules:** `api/threads.ts` (I/O) and `api/threadplan.ts` (pure logic, tested).

**Actions in `ACTIONS` (5011):**
- `thread.start`: the setter, the closer or a manager.
- `thread.send`: any seat. It appends "{first name}, Mahara Media".
- `thread.skip`, `thread.close` and `thread.stop_review`: the host closer or a manager.

| Call | When | Idempotency | Failure shows |
|---|---|---|---|
| `GET /calendars/events` × 2 | Each tick | Read | Health line |
| `GET /calendars/events/appointments/{id}` | Link step | Read | Raw link |
| `POST /conversations/messages` | Free text, email | Step `request_id` | Step row, panel |
| Fields, then `POST /contacts/{id}/workflow/{wid}` | Templates | Step `request_id` | `unconfirmed`, email |
| `POST /contacts/{id}/notes` | Open, close | Thread + event | Audit row |

- **Retries.** The tick is the retry loop. A refusal before sending returns the step to `planned`. A failure after sending goes to `failed`, then to the fallback.
- **Route A.** Graph calls run on the VPS. `sales-live` holds only the Meta app secret (signature format UNVERIFIED).
- **Slack.** None. The setter and the closer are not in Slack.

## Screens and copy

**Lead page.** A "Demo chat" `SectionCard` under Conversation (`LeadPage.tsx:334`). Chips: Planned, Introduced, Confirmed, At the call, After the call, Held, Closed, Comparison group.
- **Planned:** "{Closer} introduces themselves on WhatsApp at {time}." [Send now] [Skip the intro]
- **Introduced:** "Intro sent {ago}, {read/delivered}. Next: a check at 6:00 pm tomorrow."
- **Not confirmed:** "HighLevel took the template but we could not see it go out. The intro went by email too."
- **Possible stop:** "{Name} wrote: '{first 80 characters}'. Does this ask us to stop?" [Yes, stop the chat] [No, keep going]
- **At the call:** [They're not here] [Call on Maqsam]
- **Composer:** label "Write as {your first name}". Placeholder "Your message. Your name is added at the end." [Send], which becomes "Sent".
- **Comparison:** "This demo is in the comparison group. HighLevel's usual reminders go out and the cockpit sends nothing extra. This keeps the show-rate test fair." [Start the chat anyway]
  - The button asks: "This lead is in the comparison group (1 in 5). Start the chat anyway?"
- **Held:** "Messages are held: demo chat sends are failing ({reason}). They go out on their own when it clears."
- **Close:** [Close the chat]
  - Confirm: "Close this demo chat? Scheduled messages stop. The lead sees nothing."
  - Done: "Closed. Follow-ups continue under Follow-ups."

**Dialer after booking.** One of:
- "Demo booked. {Closer} introduces themselves on WhatsApp in 5 minutes."
- "Demo booked. This demo is in the comparison group: HighLevel's usual reminders only."

**Closer's Today strip:**
- Row: "{Name} wrote {ago}: {first 80 characters}" [Answer]
- Empty: "No unanswered messages from your demo leads."
- Task: "Mark {day}'s demo with {name} so the test counts it."
- Live-call clash: "Your {time} demo starts soon and you are still on a live call."

**Manager card "Demo chats":**
- Switches: "Plan demo chats", "Send messages", "Test contacts only", "Comparison share".
- Health: "Last run {ago}. {n} chats open, {n} held."

**Tile "Demo chat test":** "With the chat: {a}% ({x} of {n}). Without: {b}% ({y} of {m}). Likely difference: {lo} to {hi} points. With evidence: {e} and {f}. Unmarked: {u}. Started anyway: {o}."

**Lead messages.** English here; the Arabic is written under the voice skill. Each ends "{Closer}, Mahara Media".
- **Intro:** "Hi {first name}, this is {closer} from Mahara Media. {setter} passed me your details, and I'll host your demo on {day} at {time} ({country} time). It's a 45-minute Zoom call, and I'll send the link here 15 minutes before. If the time stops working, reply here and I'll move it."
- **`demo_host_en` (Utility):** "Hi {{1}}, this is {{2}} from Mahara Media. I'll host your demo on {{3}}. I'll send the Zoom link here 15 minutes before. Can you still make it?"
  - Quick replies: "Yes, I'll be there" and "I need another time".
  - {{3}} reads like "Sunday 5 October at 4:00 pm (Saudi time)".
- **Check:** "Hi {first name}, a quick check for tomorrow: our demo is at {time} ({country} time). Does that still work?"
- **Link:** "Hi {first name}, I'm getting ready for our call at {time}. Here is the link: {link} See you in 15 minutes."
- **`call_link_en` (the foundation's):** "Your call with Mahara is ready now. Tap the button to join." Button: "Join the call".
- **Late:** "Hi {first name}, I'm in the call now and holding it for you: {link} If now is not a good time, reply with a time that suits you."
- **Moved:** "Hi {first name}, done: your demo is now on {day} at {time} ({country} time). I'll send the link here 15 minutes before."
- **Host change:** "Hi {first name}, a small change: {new closer} will host your demo on {day} at {time}. Same time, same link."
- **Email intro:** subject "Your demo on {day}: meet {closer}". The body is the intro text.
- **Route A close:** "This group closes today. For anything else, message us here on Mahara Media's WhatsApp. Thank you."
- **HighLevel notes:**
  - "Cockpit demo chat opened for the demo on {day} {time}. Host: {closer}."
  - "Cockpit demo chat closed: {reason}."
- **Contact card:** none in release one. The build tests a `.vcf` of the official line only.

## How it counts in the numbers

- The chat books, marks and moves nothing. A quick-reply "Yes" writes a cockpit confirmation, never a HighLevel status.
- The tile applies the B2B rule itself, because `cockpit_sales_calendar.status` does not. In the last 30 days, 7 past demos sat at `confirmed` and 0 at `showed`.
- Each demo keeps its planned arm.
- `source='thread'` messages count toward the ceilings, not toward the agent's numbers.
- Note beside the tile: "From the cockpit's demo chats and B2B calls. Live calls and demos booked under 30 minutes ahead are left out. Costs use the brief's rates, not yet checked against Meta's."

## Security and privacy

- **Consent.** Every message relates to a call the lead booked. The CEO confirms the booking pages say so. The `BookForm` line "Lead agreed to WhatsApp updates" sets `consent_source='setter_asked'`.
- **Wording.** No message says "let's continue on WhatsApp".
- **Exposure.** Route C shows no staff number. Route A needs work SIMs.
- **Access.** Seats never read `invite_link`. Every write is audited.

## Tests and acceptance criteria

**Unit** (`threadplan.test.ts`):
- timing cases: booked 3 days, 4 hours and 20 minutes ahead, and one booked at 23:00 for 09:30;
- reschedule;
- the arm is stable and close to 80/20 over 10,000 ids;
- exclusions;
- no `{` left in any copy;
- close rules, the stop hold and pacing.

**Desk** (`tests/fakes.py`): no `confirm` draft for an appointment with a `message_sent` row.

**Harness:** `/sales/harness.html?path=/lead/<id>&thread=planned|introduced|confirmed|held|stop|holdout|closed`.

**Day-1 checks (UNVERIFIED items):**
- the calendar events query;
- quick replies through a workflow;
- a URL-button variable filled from a contact field;
- what HighLevel's demo reminders send;
- whether `address` comes back through the API;
- whether HighLevel's Zoom hosts are in Mahara's account;
- that no workflow triggers on "Note added".

**Acceptance:** a 3-day dry run threads every demo within 4 minutes. No step falls in quiet hours. Nothing is sendable to clients or do-not-disturb contacts.

**Live tests** on `VjPfR4Cc1Y0OFvaqeor5` and the test calendar. Cleanup deletes; it never marks invalid.
- **A:** every step refuses. Its `dnd=true` may be contact-level, and `dndFor` (`api/lib.ts:428`) applies that to all channels.
- **B:** with email do-not-disturb lifted for an hour, the email arrives.
- **C:** on a staff-phone `cockpit-test` contact, the name renders, a tap opens the window, and exactly 1 copy arrives.
- No real lead is messaged.

## Rollout and build days

| Days | Work |
|---|---|
| 1 to 2 | Day-1 checks, migration, planner and tests, hooks commit |
| 3 to 4 | Tick (live read, steps, fallbacks, pacing, notes, pg_cron); link on wrap rooms, with the raw link until the foundation ships |
| 5 to 6 | Lead panel, dialer line, Today strip, stop review, manager card, tile, harness |
| 7 to 8 | Desk test, watchdog row, dry run, live tests, ship |

- Days 1 to 3 run beside the foundation build.
- Ship with `scripts/ship.sh sales` and `deploy_fn.py sales-api ... --verify-jwt`, from a fresh worktree of the latest main. Check the live version before and after.
- Record the session in `shared/sessions/`.

**Phases:**
1. Dry run for 3 days.
2. Test contacts only.
3. All demos at 80/20. This starts once the WA Connector is off, `demo_host` is approved and the single-copy test passes.
4. At 120 demos: keep the chat unless the chat arm is lower or opt-outs reach 2%.

## What the CEO must do and decide

1. **Switch off the WA Connector** (Marketplace, Installed apps, Uninstall; the path is UNVERIFIED).
2. **Create a HighLevel test calendar** "Cockpit test demo", outside B2B's map.
3. **Create the templates** (Settings, WhatsApp, Templates):
   - `demo_host_en/ar`: Utility, with two quick replies.
   - The foundation's `call_link_en/ar`.
   - Project 3's `line_en/ar`.
4. **Create one published workflow per template.** Each has one WhatsApp action, maps the `cockpit_rep_name`, `cockpit_demo_time` and `cockpit_join_code` fields, and has **Allow re-entry on**. Paste each id under Follow-ups, WhatsApp library.
5. **Request the OBA** (WhatsApp Manager, Phone numbers, the number, Profile, Official business account, Submit request). First make sure two-step verification is on, the display name is approved and the business is verified.
6. **Check the number's setup:** whether it is also on the WhatsApp Business app, and how many partners are connected.
7. **Decide:**
   - route C now;
   - 80/20, with the decision at 120 demos;
   - the close rule;
   - the setter's override;
   - tests B and C;
   - whether to accept `demo_host` as marketing (at most $0.079 a send);
   - work SIMs for route A.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `demo_host` approved as marketing | Tie it to the booked call; request a review within 60 days |
| Ignored templates lower the number's quality | At most 3 per demo; ceilings; health per source |
| Booked demos on the closer's Basic Zoom are cut at 40 minutes (UNVERIFIED) | Day-1 host check; decision 1 |
| Replies go unanswered (40% today) | Today strip; agent draft after 30 minutes |
| The parallel session overwrites `index.ts` | One hooks commit, new modules, latest main, `--verify-jwt` |
| Route A breaks HighLevel's WhatsApp | No second Meta app until Meta confirms in writing |