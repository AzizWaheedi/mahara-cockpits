# Project 3 spec: the follow-up agent (CRM and VPS)

Final, 2026-10-03. Code from origin/main `9670e5b`; the local checkout is 3 commits behind, so the build starts from the latest main. `api/` means `supabase/functions/sales-api/`. Room, handover, presence, door and Slack names are the foundation spec's (F).

## What changed after review

1. **One contract (C1):** F's `room.create`, `cockpit_sales_live`, `cockpit_sales_presence`, `sales-live` door and "Mahara Sales" Slack app (token on the VPS).
2. **Reactivation first.** New leads fell to 65, 55, 21, 4, 1, 0 a week from 24 Aug. Backlog waves need no AI, ship before the sign-in returns, and keep a 10% holdout.
3. **"Qualified at the intro":** shown by the B2B rule and never `invalid`. A disqualified intro writes `invalid` (`api/dialer.ts:911`), and B2B counts `invalid` as shown (H2).
4. **WhatsApp safety:**
   - no automatic do-not-disturb (H4);
   - health per source (H5);
   - unseen templates count as unconfirmed, and every workflow allows re-entry (M3);
   - paced batches (M4);
   - the WA Connector blocked in code (M7).
5. **Visible failures:** a Supabase watchdog (M10). The reply door uses `CRON_ACTIONS` (H1).
6. **Tests never book (H2).** Test contacts carry no roas tag.
7. **Gaps filled:**
   - a HighLevel note per step;
   - email nurture;
   - graduation in the CEO's words;
   - one hours table;
   - corrected `confirm` timing;
   - templates named `line_*` and `opener_*`;
   - one hooks commit.

**Not this spec:**
- C2, H3, H6, H7, H9, M5, M6, M8, M9, M11 and M12 cover rooms, Zoom, marks or P4. P3 books and marks nothing.
- M2: qualification ignores calendar labels.
- H8: F's handover reads HighLevel live.

## 1. Outcome and success numbers

**Outcome:**
- Each lead in the five jobs gets the right next message from the right rep.
- Each reply gets a human answer within minutes.
- Each kind earns the right to send by itself, one at a time.

**Today (verified 2026-10-02 and 10-03):**
- `hermes/sales-desk/desk/followups.py` has 7 kinds (`SEGMENTS`, line 73).
- The VPS sign-in lapsed on 09-27. All 81 drafts expired, and 0 messages were sent.
- **Faults:**
  - Replies are missed when the last inbox message is outbound (526-529).
  - The brief cut drops the newest messages (1339).
  - `after_call` needs `status = showed` (597-599). No demo in the last 30 days had it.
- **Volume:** 0 calls are upcoming. These projects lift rates; none creates leads. October needs the ads back on.

| Metric | Baseline | 90-day target |
|---|---|---|
| First human answer (09:00 to 21:00 lead time) | median 4.7 h; 40% of 2,729 never answered | under 5 min; under 5% |
| Never booked, then booked in 30 days | 3.6% (recompute: same as the next row, possible copy error) | 10% |
| No-show rebooked in 14 days and kept | 3.6% | 10% |
| Good intro with a demo in 14 days | 50.5% | 65% |
| Demo closed in 30 days | 4.8% | 8% |
| Cancellation rebooked in 14 days | 13.6% | 25% |
| Wave bookings above holdout | none | positive, range shown |
| Drafts that expire | 100% | under 20% |

At these targets the agent adds about 40 bookings a month. That is a target, not a result.

## 2. Who does what

- **The setter** approves the intro kinds:
  - never booked;
  - intro no-show and intro cancellation;
  - replies before a demo booking.
- **The closer** approves:
  - `good_intro`;
  - demo no-show and demo cancellation;
  - `after_call`;
  - replies after a demo booking.
  
  These messages sign as the approver through P4's `signAs`. The reason: `signatureFor` (`api/index.ts:1119`) signs as the owner, and mirror-booked demos may not make the closer the owner.
- **The manager or CEO:**
  - sets levels, waves and budget, and holds the off switch;
  - gets escalations and the items of inactive seats;
  - does the HighLevel and Meta steps.
- **The system:**
  - The desk picks, drafts, paces and watches.
  - sales-api runs every send with its checks.
  - HighLevel delivers.
  - The watchdog watches the desk.
- **No mix-up.** HighLevel workflows cannot hold a lock, so the rule lives in the database: one open draft per lead and a conditional claim (`api/index.ts:1890-1895`). Workflows only send templates.

## 3. The flow, step by step

### 3.1 From today to the first message
1. **The CEO** signs Claude in. **The build** then:
   - puts `desk.py doctor` on hourly cron with a model probe;
   - ships Phase 0, including `--contact`, which drafts only for `cockpit-test` contacts.
2. **Refusal test.** Run `desk.py followups --contact VjPfR4Cc1Y0OFvaqeor5 --segment no_show`, then approve. Expect "This lead asked not to be contacted." This contact's do-not-disturb looks contact-level, which blocks every channel (`api/lib.ts:428`).
3. **Send tests** use the CEO's second test contact (section 13). The first real message is a `reply` draft inside a lead's window.
4. **The CEO** creates the templates and workflows. **The build** saves the routes (`WhatsAppLibrary.tsx:127`).
5. **Single-copy test.** One template to the second test contact must show exactly 1 message. Only then is `wa_connector_off` set to true.

### 3.2 Each goal as a job

| Goal | Kind | Trigger | Cadence (h) | Approver |
|---|---|---|---|---|
| Not booked | `new` | Created in the last 8 days, no intro. A completed dial now excludes the lead for 24 h only (`followups.py:581`, 1168-1170) | 0.5, 24, 48, 96, 168 | setter |
| No-shows | `no_show` | No-show in the last 7 days, nothing booked since | 0.25, 24, 72, 144 | setter or closer |
| Good intro, no demo | `good_intro` (new) | Qualified at the intro, no demo 24 h later | 24, 72, 168, 336 | closer |
| Demo, no close | `after_call`, 30 days | Demo shown (B2B rule) on `jQqXS1YuFnmGZKLkrE62` or `NDBNz6Og4yfpdpWmHrue`, no deal | 24, 72, 168, 336, 504, 720 | closer |
| Cancellations | `cancelled` | Cancelled in the last 6 days, nothing booked | 0, 48, 120 | setter or closer |
| Backlog | `reactivate` (new) | Wave member, window closed | once | owner, per batch |

- **Channels, in order:**
  1. free text inside the 24-hour window;
  2. otherwise a `line_*` template carrying one model-written line;
  3. otherwise email.
- **Reactivation** sends the CEO's opener with no model text:
  - `opener_ar`: «السلام عليكم {{1}}، معاك {{2}}. كيف حالك؟»
  - `opener_en`: "Hi {{1}}, it's {{2}} from Mahara Media. How are you?"
  
  The lead's answer opens the window for the contextual reply.
- **Waves.** 40 a day, newest first. 10% are held out by a hash of the contact id. Order:
  1. 438 no-shows and 87 cancellations;
  2. 161 good intros;
  3. 220 unclosed demos;
  4. 364 never booked.
- **The 3,368 untagged or not-ready contacts are not leads.** They get email nurture only (3.5). Their bookings are reported apart (M1).
- **An unmarked past call** counts as shown (B2B rule).
  - The owner gets a "Mark it" task at T+2 h.
  - `good_intro` and `after_call` wait 24 h. A no-show mark in that time moves the lead to `no_show`.

### 3.3 Happy path: one intro no-show
1. **10:00.** The setter marks the no-show.
2. **Within 1 minute,** step 1 is drafted as a `line_ar` template. This uses the `watch` job from Phase 3; before then, the next :07 or :37 run drafts it.
3. **The setter approves.**
   - `sendTemplate` (`api/index.ts:1141`) writes the fields and enrolls the workflow.
   - The read-back matches the line's text.
   - The HighLevel note is written.
   - If the take-over switch is on, `takeOver` removes the lead from "2.3 No Show (Intro)".
4. **The lead answers.** A reply wait opens, and the agent drafts a reply inside the window.
5. **The lead books.** `booked_again` (440) ends the sequence.

### 3.4 Live calls, replies and demos
- **"Call me now."** The draft gets `intent=call_now`.
  - Approving it starts F's flow instead of sending. F's message service sends the draft as the link once the rep is in the room.
  - Demo stage: `live.ask`, reason `replied`.
  - Intro stage: `room.create`, with the setter as host and purpose `manual`.
  - If no closer claims it within F's 120 s, the draft comes back with: "No closer took it in 2 minutes. Change the message to offer a time."
  - The agent never starts a call by itself. Links always need a person (`api/lib.ts:822-826`).
- **Any reply:**
  - T+0: alert the owner.
  - T+4: the draft is ready.
  - T+10: Slack message to the manager.
  - T+15: offer the reply to the other free rep.
  - T+30: the agent sends only if the kind is at "Sends by itself" and `needsPerson` passes.
  - At night, the clock starts at 09:00 lead time.
- **Demos.** An open P4 demo chat suppresses `confirm` for that appointment.
- **`confirm` timing** (`followups.py:317-327`):
  - a morning call: 18:00 the evening before;
  - an afternoon call: 09:00 the same day.
- **No open channel:** the lead becomes a dialer call task.

### 3.5 Contextual email nurture (new)
- **Pools:**
  - the 811 nurture-stage leads, every 7 days;
  - the 3,368 untagged or not-ready contacts, every 14 days.
  
  They share `nurture_per_day`: 20 at first, 40 after 2 clean weeks.
- **Context:** form answers, call notes, the last 20 messages, industry and country.
- **One angle per email:** a next-quarter question, a client story from the sales assets, a seasonal note, a checklist, or an offer to talk.
- **Rules:**
  - subject under 50 characters;
  - 60 to 120 words, with one question;
  - no links, percentages or promises, so `needsPerson` allows graduation;
  - never a results guarantee;
  - signed "{rep}, Mahara Media", with the stop line last.
- **Health:** nurture pauses when bounces exceed 5% of the last 200 sends. UNVERIFIED: whether HighLevel reports spam complaints.

## 4. States and transitions

| State | Entered when | Left when | Timeout |
|---|---|---|---|
| draft | the desk writes it | approved, held, skipped, expired | 48 h; WhatsApp: when the window closes; `confirm`: 1 h before the call |
| send at | the kind is at "Send unless stopped", or a batch is approved | held (back to draft), or its time comes | 30 min; batches 30 s apart |
| sending | a claim wins | HighLevel answers | 30 min, then `free_stuck` (889) |
| live wait | `call_now` approved | F's `link_sent`, or the offer expired (back to draft) | 120 s |
| unconfirmed | template not seen (`provider_status=enrolled`) | seen, or failed over to the next channel | 30 min |
| sent, then replied, booked, showed or closed | outcome seen | final | 7, 14, 14, 30 days |
| failed | HighLevel or Meta failed it | the next run may draft again | 2 failures in 24 h: lead set aside for 24 h |
| paused lead | a stop match that is not an unsubscribe | a rep resumes it | 30 days |
| reply wait | inbound message seen | answered or closed | alerts at T+0, T+10, T+15 |
| wave member | added (`wave` or `holdout`) | drafted, excluded, replied, booked | 14 days after the send |

**Graduation.** A kind is segment × language × channel. The levels are Approve, Send unless stopped, Sends by itself, and Off.
- **The system suggests a move** after 30 days when all of these hold:
  - 40 drafts decided (80 for demo-stage kinds);
  - 85% sent as written or nearly (similarity 0.85 or more);
  - no "wrong message" skip in the last 20;
  - a reply rate at or above the workflow it replaces;
  - no stop after its sends.
  
  The manager confirms with one tap.
- **Always a person:** `call_now`, the hot list, and any draft `needsPerson` flags.
- **Automatic drop-back,** one level down, with the manager told, after any of:
  - a stop following an automatic send;
  - more than 30% of the last 20 drafts edited;
  - its source's health pausing.
- **Learning:** examples with outcomes come first (`examples_block`, 783). Weak angles drop out after 30 sends.

## 5. Edge cases and failure handling
1. **The lead writes while a draft waits.** The send is refused with "The conversation has moved on" (`api/index.ts:1862-1877`). A fresh reply draft follows.
2. **The lead becomes a client.** The draft closes at send (1832-1841) and through `close_clients` (1007).
3. **Two approvals at once.** One wins. The other sees "Someone else has just dealt with this draft."
4. **The sign-in lapses.** Drafts fail, the status row turns false, and the watchdog alerts within 10 minutes. Approved drafts and openers still send.
5. **Stop words.** `OPT_OUT` (`followups.py:112-117`) also matches "not interested" and «لا تتصل».
   - An explicit unsubscribe creates a task. Examples: "stop", "unsubscribe", "remove me", «احذف رقمي», «وقفوا الرسائل». Confirming the task sets WhatsApp do-not-disturb only.
   - Any other match pauses the agent for that lead for 30 days. The dialer keeps the lead.
6. **A workflow is unpublished, or two templates are unconfirmed in 24 h.** The route turns itself off and the manager is told.
7. **Wallet empty** ("funds" errors). The CEO is alerted and waves pause.
8. **Failures in one source.** `whatsappHealth` (`api/index.ts:1029-1045`) counts every source today.
   - With a source filter, wave failures pause waves only. They never hold `confirm`, P4 or room sends.
   - "Not on WhatsApp" errors mark the lead unreachable on WhatsApp and do not count toward the pause. UNVERIFIED: how HighLevel reports them.
9. **Meta's per-person marketing limit.** That lead gets no template for 7 days.
10. **A company name on file.** No greeting by name (`person_name`, 369). UAE and Oman times use UTC+4 (`PLUS_FOUR`, 105).
11. **The sender ceiling** is 30 messages in 10 minutes (`api/index.ts:1052-1058`). Pacing leaves 10 slots for P4's tick, which uses the same desk identity.
12. **A HighLevel automation wrote less than 20 h ago.** The lead is held (3 h when take-over is on).
13. **Two identical outbound messages within 60 s.** Agent WhatsApp sends pause.
14. **A HighLevel note fails.** It is logged, and the send still goes.

## 6. Data model and settings

**Migration:** `20261003f_sales_followup_agent.sql`. F holds `20261003a`, so check the folder on the day. It copies `20261002e_sales_client_forms.sql`:
- RLS on, with seat read through `cockpit_sales_seat()`;
- revoke from public, anon and authenticated;
- grant select to authenticated and all to service_role;
- end with `notify pgrst`.

**New tables** (prefix `cockpit_sales_`):
- **`followup_meta`:** `followup_id` pk, `kind_key`, `level_at_draft`, `send_after`, `held_by`, `intent`, `edit_ratio`, `wave_id`, `live_id`, `room_id`, `crm_note_id`, outcome times.
- **`followup_levels`:** `kind_key` pk, `level`, `suggested`, `set_by`, `reason`.
- **`followup_waves`:** `id`, `pool`, `segment`, `per_day`, `holdout_share`, `state`, `started_at`.
- **`followup_wave_members`:** pk (`wave_id`, `contact_id`), `arm` (wave, holdout), `state`, `followup_id`. One running wave per contact.
- **`reply_waits`:** unique on (`contact_id`, `inbound_at`), owner, alert times, `first_answer_at`, `answered_by_kind`.
- **`alerts`:** service role only, `dedupe_key` unique.
- **`push_subs`:** each seat reads its own rows only.

**One hooks commit.** It is shared with F and P4 and deployed once from the latest main, with the live version checked before and after. It contains:
- the two new kinds in `cockpit_sales_followups_segment_check`, `api/lib.ts:657`, `followups.py:73` (plus `GOAL` and `ANGLES`) and `FollowupsPage.tsx:119`;
- a source filter on `whatsappHealth`;
- a text-matched read-back in `whatsappSentSince` (1099-1112). When nothing is seen it keeps `provider_status=enrolled` (1252), so no constraint changes;
- registrations for `followup.*` and `health.watch`.

The messages `source` stays `followup`.

**Additions to the `followups` setting:**
```json
{"send_hours":{"first":[9,18],"later":[9,21],"agent_reply":[9,21]},"quiet_days":["friday"],
 "cadence":{"good_intro":[24,72,168,336],"after_call":[24,72,168,336,504,720]},
 "waves":{"per_day":40,"holdout_share":0.1,"batch_gap_s":30},"nurture_per_day":20,
 "template_budget_usd_month":100,"wa_connector_off":false,"stop_pause_days":30,
 "graduation":{"min_decided":40,"min_decided_demo":80,"as_written":0.85,"clean_last":20,"drop_edit_share":0.3},
 "reply_alerts":{"manager_min":10,"reassign_min":15,"agent_min":30},"watchdog_stale_min":75}
```

**Hours, on the lead's clock**

| What | Hours |
|---|---|
| First message of a sequence | 09:00 to 18:00 |
| Later steps | 09:00 to 21:00 (`api/index.ts:1844-1848`) |
| Agent replies | 09:00 to 21:00 |
| A person's reply | any time |
| Days off | Friday (`followups.py:1219`) |

## 7. Integrations and calls

| Call | When | Idempotency | Failure shows |
|---|---|---|---|
| Claude proxy `127.0.0.1:3456/v1` (`model.py:50`) | each draft; hourly probe | one open draft per lead | followups row, watchdog |
| `convo.send` → `POST /conversations/messages` | approve, autosend, batch | `request_id` = followup id | card, audit row |
| `sendTemplate`: fields, then `POST /contacts/{id}/workflow/{wid}` | window closed | `request_id`; 2 min per lead (1168); 250 a day (1177) | card |
| `takeOver`: `DELETE /contacts/{id}/workflow/{wid}`; `POST /contacts/{id}/notes` plus field `cockpit_agent_next` | after the send settles | `took_over`, `crm_note_id` | followup row |
| F `live.ask` or `room.create` | `call_now` approval | followup id + ":live" | draft back to waiting |
| "Customer Replied" webhook → `sales-live /reply` → `reply.seen` (`CRON_ACTIONS`, `x-cron-secret`) | each inbound message | `reply_waits` key; `watch` also polls | watchdog |
| Slack (from the VPS), Web Push; pg_cron → `health.watch` every 5 min | alerts | `dedupe_key` | alerts row, banner |

UNVERIFIED: whether the HighLevel webhook can send a secret header, and the notes endpoint's exact path and scope.

## 8. Screens and copy

**Follow-ups page**
- Chips: "Approve", "Sends unless stopped", "Sends by itself", "Off".
- Send-at: "Sends at 10:42 unless you hold it." [Hold]
- Suggestion: "No-show, Arabic, WhatsApp template: 46 decided, 91% sent as written, no stop requests. Move to Sends unless stopped?" [Move up] [Not yet]
- Drop-back: "Moved back to Approve: a lead asked to stop after an automatic send."
- Waves: "438 no-shows, 40 a day, newest first; 44 held back to measure the effect. Next batch tomorrow at 09:00." [Start a wave] [Pause] [Resume]
- Batch: [Approve all 40], then "Approved. One goes every 30 seconds, finishing at 09:20."
- Unconfirmed: "HighLevel took it but we could not see it go out. Email goes at 10:35 if it never shows."
- Connector: "WhatsApp templates are off until the single-copy test passes."
- Spend: "WhatsApp templates this month: about $23 of $100 (estimate)."
- Live wait: "Finding a closer for {Lead}: 1:42 left."

**Banner** (`App.tsx:247`): "{Lead} wrote 3 minutes ago. Answer now." [Open]. When a closer is free it adds [Offer a call now].

**Web push:** title "{Lead} wrote back", body "{first 80 characters}. Tap to answer."

**Lead page:** "Next from the agent: WhatsApp template, no-show message 2 of 4, Thursday 10:00 their time." Switch: "Pause the agent for this lead".

**Tasks**
- "Mark Tuesday's intro so the right follow-up goes out."
- "{Lead} wrote: '{text}'. Stop WhatsApp for them?" [Yes, stop WhatsApp] [No, pause the agent for 30 days]

**Watchdog banner:** "The follow-up agent has not run since 13:07. No drafts are being written."

**Slack**
- "{Lead} wrote 10 minutes ago and nobody has answered. Owner: the setter. {link}"
- "The follow-up agent cannot write: the Claude sign-in on the VPS lapsed at {time}. Sign in again: SSH to the VPS, run claude, then /login."
- "WhatsApp sends are failing: the HighLevel wallet is empty. Top it up under WhatsApp settings."
- "Sales desk job '{job}' last ran at {time}. Follow-ups are not going out."

**HighLevel note:** "Follow-up agent: no-show (intro) 2 of 4 sent on WhatsApp template, approved by the setter. Next: Thursday 10:00 their time."

**Lead messages** (the Arabic versions are written under `aziz-kuwaiti-voice`)
- Call offer: "Yes, {rep first name} can talk now. Join here: https://call.maharamedia.com/{code} They will let you in within a minute."
- Nurture email:
  - Subject: "{first name}, a quick question"
  - Body: "Hi {first name}, when we last spoke you were looking for more design projects in Riyadh. Is that still the plan for next quarter? If it helps, I can show you how other studios in Saudi Arabia fill their pipeline. Reply here and I'll set a time. {rep}, Mahara Media"
- Stop line: "If you'd rather not hear from us, reply 'stop' and we won't email again."
- Form consent: "By sending this form you agree that Mahara Media may contact you about your enquiry by WhatsApp, phone and email." Checkbox: "Send me updates and offers by WhatsApp and email."

## 9. How it counts in the numbers

- **"From follow-up"** is a label on a booking made within 7 days of a sent follow-up, after a reply. It never adds a booking.
- **The wave effect** is the wave's booking rate minus the holdout's at 14 days, shown with its range.
- **Show rate** by the B2B rule sits beside show rate with evidence (a mark or a Zoom join). None of September's 17 demos was marked showed.
- **Bookings from untagged contacts** are shown apart, because B2B counts bookings with no tag filter. Test contacts are excluded.
- **Template spend per follow-up booking** is shown against the $60 gate. The true cost is the wallet top-ups on the costs page.
- **Every number** notes its source and what it leaves out.

## 10. Security and privacy

- Lead data goes to frontier models only. DeepSeek is refused (`model.py:59-67`), and logs are scrubbed (`http.scrub`).
- Every send, level change, wave, stop and pause writes `cockpit_audit_log`. Level and wave actions call `needManager`.
- Push keys are readable by their own seat only. The Slack and VAPID secrets stay on the VPS, and settings hold no secrets.
- The reply door checks a shared secret and passes ids only.
- Port 3456 must be closed to the internet.

## 11. Tests and acceptance criteria

- **Desk tests** (`test_followups.py`, plus new `test_waves.py` and `test_watch.py`, with fakes):
  - the B2B rule feeds `after_call` and `good_intro`, and `invalid` never does;
  - a "Demo 2" call feeds `after_call`;
  - an outbound email does not hide a reply;
  - the brief keeps the newest 20 messages;
  - the 10% holdout is stable;
  - `reactivate` never calls the model;
  - "not interested" only pauses;
  - first messages wait for 09:00;
  - a dial excludes a lead for 24 h only.
- **sales-api tests** (`followupAgent.ts` and its test):
  - graduation and drop-back maths;
  - per-source health;
  - the unconfirmed read-back;
  - pacing;
  - the note text;
  - watchdog thresholds;
  - the `call_now` hand-off.
- **Harness:** `/sales/harness.html?path=/followups&agent=levels|waves|unconfirmed|livewait|blocked`.
- **Live tests:** steps 2, 3 and 5 of 3.1. Test contacts only, and no bookings.
- **Accept when:**
  - doctor reads ok for 24 h;
  - the watchdog alerts within 10 minutes of a stale row;
  - the single-copy test shows exactly 1 message;
  - zero real leads were messaged.

## 12. Rollout and build days

| Phase | Days | Contents | Gate to next |
|---|---|---|---|
| 0 | 3 | Fault fixes, honest status, doctor cron, watchdog, B2B rule, stop rule, test flag, baselines | G0: doctor ok for 24 h |
| 1 | 3 | `reactivate`, waves, holdout, pacing, connector block, source health, notes, levels | G1: templates live, single-copy test passed, wallet at least $50 |
| 2 | 5 | `good_intro`, owners by call type, 30-day `after_call`, `signAs` | 1 week of drafting |
| 3 | 6 | `watch`, `reply_waits`, push, Slack, reply door, `call_now` with F | G2: median first answer under 15 min for 2 weeks |
| 4 | 4 | Send unless stopped, automatic levels, drop-back, weekly sample | G3: section 4 thresholds |
| 5 | 3 | Contextual email nurture | bounces under 5% |

That is 24 build days. Phase 1 needs no sign-in, so the first wave of 40 can go on day 6 if G1 holds. Each phase ships from the latest main, with sales-api deployed with `--verify-jwt`. Each is recorded in mahara-context `shared/sessions/`.

## 13. What the CEO must do

1. **Sign Claude in.** SSH to the VPS with your own login, run `claude`, then `/login`.
2. **Create the templates** in HighLevel (Settings > WhatsApp > Templates): `line_ar`, `line_en`, `opener_ar` and `opener_en`.
3. **Create one workflow for each template.**
   - One WhatsApp action, mapping {{1}} to first name and {{2}} to `contact.cockpit_rep_name`.
   - For the line templates only, also map {{3}} to `contact.cockpit_whatsapp_line`.
   - Turn on "Allow re-entry", then publish.
   
   The menu labels are UNVERIFIED; the build checks each workflow through `GET /workflows/`.
4. **WhatsApp setup.**
   - Uninstall the WA Connector.
   - Top up the wallet with $100.
   - Start Meta business verification.
5. **Add the consent line** to the lead forms.
6. **Test contacts.**
   - Create the second test contact with your WhatsApp number, a staff email and the tag `cockpit-test`. Give it no roas tag.
   - Check whether the first test contact's do-not-disturb is contact-level.

**Decisions**

| # | Decision | Recommendation |
|---|---|---|
| 1 | Every kind can reach "Sends by itself" (your words), or a stricter ceiling | Your words, with 80 decided drafts for demo-stage kinds |
| 2 | First-message hours | 09:00 to 18:00 |
| 3 | Monthly template budget | $100. Openers to the 1,153 job leads outside the holdout cost about $67 at the brief's rates (UNVERIFIED) |
| 4 | Backup model | An Anthropic API key; `model.py` supports it |
| 5 | Rep alerts | Web push now; Slack once the reps join |
| 6 | Stops | Do-not-disturb only on explicit unsubscribes, after a rep confirms |
| 7 | Watchdog route | A post-only Slack webhook to `#sales-alerts`, kept in function secrets. This is an exception to F's rule |

## 14. Risks and mitigations

| Risk | Guard |
|---|---|
| No new leads | Backlog waves; the ads question goes to the CEO |
| Wrong person or time | Client checks at draft and send; the lead's clock, Friday, the 20-hour gap |
| Meta limits and cost | 250 a day, 40 per wave, the budget, per-source pause |
| The sign-in lapses again | Hourly probe, watchdog, backup model |
| Double messages | Connector block, duplicate detector, re-entry |
| A lead silenced by mistake | A 30-day pause instead of do-not-disturb |
| Effect overstated | 10% holdout; labels instead of extra bookings |
| Clash with the parallel session | New files, one hooks commit, deploy from the latest main |