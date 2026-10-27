# Kickoff form: the live submit path, end to end

Read-only map, 2026-10-25, worktree `forms-1025` (origin/main `d2c9817c`).
Nothing was submitted, run, edited, posted or messaged. Client data is left
out: business names only, never phone numbers, emails or message bodies. The
Make approval link, a token found in Make 13 and every key stay out of this
file.

Sources are cited inline:
- `TF` = the Typeform API or MCP.
- `Make <id> [module]` = the scenario blueprint, read with GET.
- `CU` = ClickUp, read through the MCP and REST GETs.
- `SQL` = `sq.py` SELECTs on `bldgtotkfmhoxmlzowdx`.
- `Slack` = the Slack MCP, read only.

---

## 0. The answer in one screen

| Question | Answer |
|---|---|
| Does a kickoff "completely work" today? | **The ClickUp half, yes.** For all 8 kickoffs in the last 60 days, Make 12 ran, the card got its handoff comment, the Technical and Creative tasks were created, and the Blueprint link was written (section 4). **The client half, no.** None of the 8 WhatsApp summaries reached a client: all 8 are still `pending` in Make's approval data store (section 3.4). |
| Is there a "kickoff complete" Slack notice? | **No.** The only Slack message a kickoff sends is Make 06's "Client summary pending approval — <client>" in #csm-general, posted as Admin Bot. It says nothing about the card, the tasks or the Blueprint (section 5). |
| Has the cockpit's kickoff window been used? | **No.** The window is live (bundle check, section 6), but `cockpit_csm_form_sends` has 0 rows and the audit log has 0 `csm_form.sent` rows. The last kickoff was on 2026-10-20, before the window shipped. |
| Where should the #csm-general notice come from? | **From the cockpit's record, not from Make or the browser.** When the client's mirror row gets a new kickoff response, queue one notice. A small server sender then checks the card with the trail's own rule and posts once to #csm-general as mahara-club-bot, through `tools.ts`. Make 12 stays the only ClickUp writer (section 8). |

---

## 1. The form, Typeform `tG7dnxBn` "Mahara - Kickoff form"

| Item | Value | Source |
|---|---|---|
| Created and published | 2026-08-30 13:25 UTC; last edited 2026-10-23 17:08 UTC | TF `GET /forms/tG7dnxBn` |
| Settings | public; `autosave_progress=false` (switched off 2026-10-23, memory `forms-in-cockpits-queue.md` item 1); `partial_responses_to_all_integrations=false` | TF form settings |
| Hidden fields (23) | `onboarding_client_id, legal_name, phone, email, address, maps_link, instagram, website, facebook, booking_platform, hours, consultants, service_focus, consultation_types, payment_options, last_revenue, goal_90d, goal_12_24, marketing_tried, challenges, why_joined, client_notes, content_drive` | TF skeleton `hidden` |
| Questions | 3 read-back groups (business, links, operations) with a "what is wrong" follow-up each; Q "Which service are we advertising?" (`c…0007`, multiple choice, 6 options, **multi-select**); consultation types (`c…0008`); profile; Contract status (`c…000a`, dropdown, 5 choices); support, ads, Facebook access, WhatsApp, calendar/CRM, content, leads, training groups; **Call Recording Link** (`b5578678`, required website); **Payment Amount** (`75e97e7d`, number); "Post call form filled?" | TF skeleton |
| Endings | `d6cdedfc`: "Kickoff notes received. The client will receive their summary shortly. Next step is the Brand Blueprint call…", button "Book the Brand Blueprint call", `button_mode=redirect` to `api.leadconnectorhq.com` (the GHL Blueprint calendar). `default_tys`: no button. | TF `thankyou_screens` |

### 1.1 Webhooks (host only)

| Tag | Host | Enabled | Events | Created | Goes to | Source |
|---|---|---|---|---|---|---|
| `WHTP3992232` | hook.eu2.make.com | yes | `form_response` | 2026-08-31 | Make hook 3992232 "kickoff typeform" → **Make 12** (8925654) | TF `GET /forms/tG7dnxBn/webhooks`; Make `/hooks` URL match |
| `postcallsummary` | hook.eu2.make.com | yes | `form_response` | 2026-09-01 | Make hook 4114295 → **Make 06** (9209179). The same hook also serves the Blueprint form `oYZKtogO`. | same |

The old form `BbJy6xg4` has 2 webhooks, both **disabled**: `WHTP3992232`
(still the Make 12 hook) and `WHTP4017622` (hook 4017622, no scenario).
Source: TF webhooks for BbJy6xg4.

**Nothing else fires on a kickoff.** Of the 27 active Make scenarios that use
Typeform, all are webhook-triggered. Only Make 12 and Make 06 sit on the
kickoff's two hooks. Three blueprints name `tG7dnxBn`:
- Make 06, in its booking-line switch;
- Make 10 (Closer Form to Onboarding), which writes the plain kickoff link;
- Make 13, which writes the prefilled kickoff link.

Source: Make `/scenarios` filtered on `usedPackages`, and a blueprint text
scan.

### 1.2 Responses, last 60 days (since 2026-08-26)

8 responses for 7 cards, the newest on 2026-10-20, none from 10-21 to 10-25.
Source: TF `insights-public_list_responses` (match 8 of 8). The mirror
cross-checks it: `cockpit_client_onboarding.forms->'kickoff'` holds the newest
response per card, with the same tokens (SQL).

| Submitted (UTC) | Card | Client | Token (first 8) | Open for |
|---|---|---|---|---|
| 2026-10-20 11:55 | z8xmdvj7hm | SMART INTERIOR | 0dvg18xt | 26.5 h |
| 2026-10-15 13:19 | z8xmdvh0k9 | Alalia.co | eduevtk5 | 4.5 h |
| 2026-10-15 08:54 | z8xmdvhk7m | Makers | ujtp3nnb | 2.7 h |
| 2026-10-12 13:53 | 86ex70t90 | Smmim studio | tvyjl5ru | 3.8 h |
| 2026-10-08 10:49 | z8xmdvfpyw | Shades (2nd kickoff) | rrzcgbcr | 26.1 h |
| 2026-10-07 11:58 | z8xmdvfpyw | Shades (1st kickoff) | ipire2n1 | 26.7 h |
| 2026-10-04 09:39 | z8xmdvffcd | Madana (مدانة) | m610n2vv | 0.6 h |
| 2026-09-13 14:24 | 86eywazcu | mergestudio.kw | vv369r9i | 0.3 h |

"Open for" is `submitted_at − landed_at`. Three kickoffs sat open for about a
day. Autosave is off since 10-23, so a window closed mid-way now loses its
answers.

The old form `BbJy6xg4` has 4 responses in the same window (08-27 to 09-01)
on the mirror. They are older-form history, with their webhooks off.

---

## 2. Make 12 "Kick Off Form Submitted" (8925654), the ClickUp writer

Active; `scheduling=immediately`; last edited 2026-09-17 by Ziad; 13 modules;
no error handlers (`onerror` absent on every module). Source: Make 12
blueprint and `/scenarios/8925654`.

| # | Module | What it writes | Source |
|---|---|---|---|
| 1 | `typeform:WatchEventsWithResponses` (hook 3992232) | trigger | Make 12 [1] |
| 2 | `clickup:postATaskComment` "Brief to the client task" | The **KICKOFF HANDOFF** comment on the card `{{hidden.onboarding_client_id}}`: every hidden value and every answer, in 11 sections (client details, availability, goals, contract and payment, support, advertising, booking/CRM, content, leads, training). Posts as the CEO's ClickUp account. | Make 12 [11]; CU comments (author "Abdulaziz Waheedi") |
| 3 | `clickup:editATaskAdvanced` "Client task to In Progress" | card status `IN PROGRESS` | Make 12 [20] |
| 4 | Router "Split: marketing, tech, handoff": 4 routes, no real filters (`TECH` and `CREATIVE` have empty conditions) | | Make 12 [14] |
| 4.1 | `createATaskFromATemplate` + comment | "**<legal_name> - Technical Onboarding Check 🚀**" in list 901816723190 (Operations / Tech) from template `t-86ex8x9xw`: 9 subtasks (External Automation, Tracking Sheets, Domain, Custom Values, Call Center, WhatsApp Integration, Automation, Calendars, QA). No assignee. The same handoff comment goes on the task. | Make 12 [17], [18]; CU list 901816723190 |
| 4.2 | `clickup:editATask` "Blueprint link + status to Blueprint Booked" | On list 901816559981 (Clients - Mahara), card fields: `1b7a4a74` 🧬 Brand Blueprint Form Link = a prefilled `oYZKtogO` Typeform link; `9368ca9e` **Client Status = Brand Blueprint Booked♠️** (option `dbd21650`); `ac976d4a` Contract Status; `bab9a58b` Service Advertised (switch); `924bba47` Mahara OS Access; `a1520ef3` Google Calendar Integration; `bc7e70a2` Meta Ad Account Access; `cc14ad2d` WhatsApp CRM Sync; `d113cd99` WhatsApp Group Status; `e7d158a8` Templated Ads Status; `f0a20cef` Training Course Access | Make 12 [21]; field names from CU `get_task` on z8xmdvj7hm |
| 4.3 | `createATaskFromATemplate` + comment | "**<legal_name> - Creative Onboarding 🚀**" in list 901818016338 (Media/Creative), template `t-86eyu1w3d`, assigned to the creative director (Sabry) by the template. The handoff comment goes on the task. | Make 12 [22], [23]; CU search |
| 4.4 | edit, get, sheet lookup, sleep, WhatsApp | `51f49cb1` Onboarding Map = phase 4 link. It reads the card back and finds the client's WhatsApp group in the sheet "Client Data" (column C = card ID). It waits 30–120 s at random, then sends the **phase-4 WhatsApp** (Arabic, with the map link) to the group through Whapi, if a group exists. | Make 12 [26], [27], [24], [28], [25] |

**No Slack module, no Google Docs or Drive module, no GHL module and no Make
data store in Make 12.** Make 12 books nothing: "Brand Blueprint Booked" is a
status Make sets. The CSM books the call (from the ending's button, or the
cockpit's own booking dialog).

**Runs, last 30 days:** 7 runs, 7 success, 0 warnings, 0 errors, 13 operations
each, 68 to 147 s (the random WhatsApp delay), on 10-04, 10-07, 10-08, 10-12,
10-15 ×2 and 10-20. They match the 7 Typeform responses in that window one for
one. Source: Make `/scenarios/8925654/logs`. 13 operations means all 13
modules ran, the WhatsApp module included, on every run.

**Known defect, confirmed:** Service Advertised (`bab9a58b`) is empty on all 7
cards (CU). Make 12 [21] runs `switch()` on the multi-select answer, which
arrives as a list, so no label ever matches. It fails even for one-choice
answers (Makers, Madana).

---

## 3. The other scenarios on the path

### 3.1 Make 06 "Post Call Summary - Tasks, Notes, Client Summary" (9209179)

Active; created by Muhammed; last edited 2026-09-06. It fires on the kickoff,
the check-in form `fRokTITH` and the Blueprint form `oYZKtogO`. Source: Make 06
blueprint.

What a kickoff runs:
1. [2] Typeform trigger.
2. [16] Read the card (ID = `hidden.onboarding_client_id`).
3. [13] Find the row in the "Client Data" sheet (column C).
4. [30] Router:
   - **Route 1** (to-do list as a card comment, sales-call grade to Slack
     `C09SVG6FHGU`, Client Happiness and Last POC on the card) is filtered to
     `form_id = fRokTITH`, **so a kickoff skips it.**
   - **Route 2** runs for every form except a Blueprint partial:
     - [22] GPT-4.1 drafts "the client's WhatsApp recap".
     - [23] The draft is saved to data store **171744 "Pending Client
       Sends"**, keyed by the response token, `status=pending`, with the
       WhatsApp group from the sheet. The booking line is added, the GHL
       Blueprint calendar for a kickoff.
     - [24] **Slack, #csm-general (`C09RZ0GS0V9`, private)**: "*Client summary
       pending approval — <client name from the sheet>*". Then "This is
       exactly what will be sent to the client's WhatsApp if you approve:",
       the draft, the booking line, and two links to Make 07's webhook:
       APPROVE and send, or DENY.

Runs, last 30 days: 26. 18 succeeded and 8 failed (2026-09-30 14:19 to
2026-10-01 06:39 UTC). All 8 failures were OpenAI `[429] You have no credits
remaining` at a GPT module, on 4-operation (check-in) runs. The 7 kickoff runs
(6 operations each) all succeeded, so all 7 Slack posts went out. Source: Make
06 logs.

**The kickoff draft is written from nothing.** The prompt's only answer
inputs are:
- the call transcript, `ifempty(0773087f…; 0cf5f422…)` (the check-in's and
  the Blueprint's transcript fields);
- "Additional Notes" `82a6b434…` (the check-in form's notes; TF `fRokTITH`
  field read).

None exists on `tG7dnxBn` (TF skeleton). So a kickoff's draft is a generic
English "Hi there! … we confirmed your business details" message with no
call content. You can see this in the #csm-general posts for 10-04, 10-07,
10-08, 10-12, 10-15 and 10-20 (Slack). Source: Make 06 [22] mapper.

### 3.2 Make 07 "Send Approved Client Summary" (9523861)

It sits behind the APPROVE link:
1. A GET shows a review page (the "safe to crawl" route).
2. A POST with `action=send` on a still-pending record waits 30–120 s,
   WhatsApps the group through Whapi, and marks the record `sent`.
3. `nosend` marks it `denied`.

Source: Make 07 blueprint [1]–[11].

47 runs in the window, all success. Each Slack post is followed seconds later
by two 4-operation review-page loads, probably Slack's link preview (an
inference; the timing matches every post). Sends (6 operations) happened on
10-04, 10-11 and 10-13, none of them for a kickoff. Source: Make 07 logs.

### 3.3 Make 13 "Client Onboarding Form" (8922994), upstream prefill

Trigger: the onboarding form `KFRCXPFx` (hook 3991048).

What it writes on the card:
- `87d7d889` **Kickoff Form Link**: the prefilled `tG7dnxBn` link with the
  hidden fields;
- `7755485f` the revenue goals;
- a "Raw Onboarding Form Answers" comment;
- the Onboarding Map at phase 3, then the phase-3 WhatsApp.

It also creates a "<name> - Brand DNA 🧬🧬" task in Media/Creative for the
creative director, and dispatches a GitHub `market_intel` job.

5 runs in the window, all success. Source: Make 13 blueprint [24]–[51] and
logs.

**Security finding:** module [25] carries a GitHub personal access token in
plain text in its HTTP `Authorization` header. It is not reproduced here.

### 3.4 Where the client summary stands: 0 of 8 sent

Data store 171744 holds 38 records: 20 `pending` and 18 `sent`. **All 8
kickoff records are still `pending`**, from 2026-09-13 to 2026-10-20. None
of the 18 `sent` records is a kickoff. Source: Make `/data-stores/171744/data`, keys
matched to the 8 kickoff tokens.

So the kickoff ending's promise, "The client will receive their summary
shortly", has not held for any kickoff in 60 days. Not verified: whether the
CSM sent a summary by hand in the client's WhatsApp group (the cockpit's WhatsApp
mirror was not read).

### 3.5 Make 02 "Kick Off Submitted (OLD - Monday)" (7908153)

Active, but on a gateway webhook (hook 3514231) that no kickoff webhook points
to. It writes to monday.com boards. 0 runs in the logs window. It is safe to
leave alone; switching it off is a separate decision. Source: Make 02
blueprint and logs.

---

## 4. Outcome check: did each kickoff land on the card?

Every card was read with ClickUp GETs (task, custom fields, comments); the
tasks were read in lists 901816723190 and 901818016338. Make 12's intended
outcome:
- the KICKOFF HANDOFF comment;
- the status at Brand Blueprint Booked or later;
- the Blueprint link carrying the card ID;
- the map at phase 4 or later;
- one Technical and one Creative task.

| Client (card) | Handoff comment (UTC) | Client Status now | Blueprint link | Map phase | Technical task | Creative task | Verdict |
|---|---|---|---|---|---|---|---|
| SMART INTERIOR (z8xmdvj7hm) | 10-20 11:55:13 (+2 s) | Brand Blueprint Booked♠️ (changed 11:55:21) | yes, this card | 4 | z8xmdvjrrd, in progress | z8xmdvjrrq, to do | **complete** |
| Alalia.co (z8xmdvh0k9) | 10-15 13:19:15 | Brand Blueprint Booked♠️ (already set 10-13) | yes | 4 | z8xmdvj1cv, in progress | z8xmdvj1d5, to do | **complete** |
| Makers (z8xmdvhk7m) | 10-15 08:54:04 | Brand Blueprint Booked♠️ (changed 08:54:16) | yes | 4 | z8xmdvhze9, in progress | z8xmdvhzem, to do | **complete** |
| Smmim studio (86ex70t90) | 10-12 13:53:23 | Ready For Launch🚀 (Blueprint Booked set 10-12 12:16, before the kickoff) | yes | 4 | z8xmdvh9q5, review required | z8xmdvh9qf, to do | **complete** |
| Shades (z8xmdvfpyw) | **two**: 10-07 11:58:27 and 10-08 10:49:13 | Active | yes | 6 | **two**: z8xmdvgd22 (cancelled by hand), z8xmdvgtt0 (review required) | **two**: z8xmdvgd2c and z8xmdvgttb (both complete) | complete, **sent twice** |
| Madana (z8xmdvffcd) | 10-04 09:40:01 | Active | yes | 6 | z8xmdvfpcj, review required | z8xmdvfpcw, to do | **complete** |
| mergestudio.kw (86eywazcu) | 09-13 14:24:41 | Active | yes | 6 | 86eywcmcc, complete | 86eywcmcr, complete | complete (no status-change comment to Blueprint Booked found; not verified why) |

**No kickoff failed on the ClickUp side.** Two things are wrong all the same:
- Service Advertised is empty on all 7 cards (section 2).
- The Shades double kickoff (10-07, then 10-08) ran everything twice: two
  handoff comments, two Technical and two Creative tasks, two phase-4
  WhatsApps (13 operations each run), and two pending summaries. It was
  cleaned up by hand.

On 4 cards (Alalia, Smmim, Shades, Madana), the Client Status was already
Brand Blueprint Booked *before* the kickoff, set by someone or something else
(not verified who). So "status is Brand Blueprint Booked" alone does not prove
Make 12 ran. The cockpit's trail is right to also require
`card_updated_at ≥ sent` (`formStatus.ts:41-53`).

---

## 5. Slack today

| What | Where | Who | Text | Source |
|---|---|---|---|---|
| The only kickoff message | #csm-general `C09RZ0GS0V9` (private) | **Admin Bot** (the Slack user behind Make's Slack connection) | "*Client summary pending approval — <client>*", the draft, the booking line, APPROVE / DENY links | Make 06 [24]; Slack `read_channel` 2026-10-20 12:55:18 BST, and search hits for 10-15 ×2, 10-12, 10-08, 10-07 and 10-04 |
| A "kickoff complete" notice | none | | | Slack search "kickoff" since 09-01 (no such message); no Slack module in Make 12 |

#csm-general has 8 members:
- the people: the CEO, the CSM, the systems manager and the creative
  director;
- the bots and apps: Admin Bot, viktor, the second assistant and
  **maharaclubbot**. Source: Slack `list_channel_members`.

The cockpit's own bot (mahara-club-bot, `SLACK_BOT_TOKEN`; memory
`eod-slack-delivery.md:9`) is therefore already in the channel, so it can
post there without an invite.

---

## 6. The cockpit side (client success, `src/forms/`)

| Piece | What it does | Source |
|---|---|---|
| Config | `KICKOFF` = `tG7dnxBn`, idField `onboarding_client_id`, 23 hidden fields built from the record, `makeDoes` (6 lines), ending opens the cockpit's Blueprint booking, checks at 45/120/300 s, late after 5 min, link stop `blueprint_form` | `apps/client-success-cockpit/src/forms/kickoff.ts:14-69` |
| Embed | `@typeform/embed` `createWidget`, `redirectTarget:_blank`, sandbox only in rehearsal, `onSubmit → handlers.submit(responseId)` | `useFormPanel.ts:304-330` |
| On submit | Ignores `__sandbox`. Notes the send once per response. Broadcasts `sent` on `BroadcastChannel("mahara-forms")`, then `noted`. Schedules three one-card refreshes. | `useFormPanel.ts:235-262`, `OpenFormButton.tsx:88-110` |
| The note | RPC `cockpit_csm_form_sent(task, 'kickoff', response, hidden key names, SHA-256, carried id)`. It is gated by `cockpit_csm_client_gate`; the form ID is a server constant; it refuses the sandbox and another card's ID; it sets `second` itself; it writes one row in `cockpit_csm_form_sends` and one `csm_form.sent` audit row. | `formClient.ts:58-84`; `supabase/migrations/20261023a_csm_form_sends.sql:62-140` |
| The refresh | `cockpit-csm-api` `onboarding.refresh` with `taskIds:[taskId]` | `useLiveForm.ts:73`, `lib/onboardingClient.ts:112-114` |
| The trail | Sent → Typeform has it (`forms.kickoff.response_id` or the timeline) → Card (`client_status` matches `/brand blueprint booked\|launch booked\|ready for launch\|^active$/` **and** `card_updated_at ≥ sent`) → Link (`links.blueprint_form`), then "Open the Brand Blueprint form" | `formStatus.ts:33-53, 80-110`; `FormPanel.tsx:1048, 1170-1172` |
| Also on | the onboarding deck's last slide, through the same `useFormPanel` | `docs/csm-forms/KICKOFF.md` 1, "On the onboarding deck's last slide" |
| Live? | Yes. The production routes chunk contains `cockpit_csm_form_sent` and `tG7dnxBn` (`FormWindow` chunk present). `frame-ancestors 'self'` is on `cockpit.maharamedia.com/client-success/`. | `curl` of the live bundle and headers, 2026-10-25 |
| Used? | **Never.** `cockpit_csm_form_sends`: 0 rows. `cockpit_audit_log` `csm_form.sent`: 0 rows. | SQL |
| One-card refresh proven natively? | **No.** The only `trigger='one'` run is from 2026-10-05 (the Convex era). The 10-minute cron is healthy: 2,645 ok runs and 3 failed in 30 days, newest 2026-10-25 10:24 UTC. | SQL `cockpit_client_onboarding_runs` |
| Other ways in | All 8 cards in onboarding still carry the **Kickoff Form Link** (`87d7d889`) that Make 13 and Make 10 write. That link opens plain Typeform: no guard, no note, no trail. | SQL `links ? 'kickoff_form'`; CU field on z8xmdvj7hm |

---

## 7. Gaps: what keeps "submitted and everything triggered" from being true

| # | Gap | Impact | Fix |
|---|---|---|---|
| 1 | **No kickoff summary has reached a client** (0 of 8 `sent`). Each draft also has no content: Make 06's prompt reads only check-in and Blueprint fields. | The ending tells the CSM "the client will receive their summary shortly", and it never arrives. #csm-general fills with approval cards nobody acts on. | Decide one owner for the kickoff recap. Either feed it the kickoff's answers and the Fathom onboarding transcript, drafted in the cockpit beside the trail, or take `tG7dnxBn` out of Make 06 route 2. That second option is a filter edit in Make, and needs approval. Until then, change the cockpit's `after.sub` and the ending's wording so they do not promise a summary. |
| 2 | **No "kickoff complete" notice.** The only Slack message is Make 06's approval card, which says nothing about Make 12's work. | The team cannot see a kickoff land, or fail, unless they open the card. | Section 8. |
| 3 | **Make 12 has no failure alert.** There is no error route, and the guardian does not watch Make 12 or Make 06 (no reference in `hermes/`). | A broken ClickUp or Whapi connection fails silently. Only a send from the cockpit shows "Make is late" after 5 minutes. | The notice in section 8 doubles as the alarm: "Make has not updated the card after 10 minutes." Optionally, add a guardian check on Make 12's latest run status. |
| 4 | **The trail's last link opens the retired Blueprint Typeform.** Make 12 [21] still writes an `oYZKtogO` link, and the window shows "Open the Brand Blueprint form" on it. The Blueprint is now native (`cockpit_blueprints`); PLAN.md 2.1 says "No cockpit links to it any more". | The CSM can fill the retired form. That sends Make 06 a Blueprint response, and Make 14 if completed, outside the native flow. | Point `linkBack` at the native Blueprint (the creative director's route or the deck), or drop the link and keep **Book the Brand Blueprint call**. A cockpit change only. |
| 5 | **"Make is booking the Brand Blueprint" is not what Make does.** Make 12 sets a status and writes a link; it books nothing. | The CSM may think the call is booked. | Reword `after.say`, e.g. "Kickoff sent. Make is updating the card; book the Brand Blueprint call below." |
| 6 | **Service Advertised is never filled** (switch on a multi-select). | Anything that reads the card's service gets blank (the spec already avoids it). | Fix the switch in Make 12 (`join()` or a map over the list). That needs a Make edit, so it needs approval. Or have the cockpit write the field from the kickoff answer. |
| 7 | **A second kickoff runs everything again** (Shades, 10-07/10-08). The cockpit guards its own window, but the card's Kickoff Form Link has no guard. | Double tasks, a double WhatsApp to the client's group, and double comments. | Once the window is proven, replace the card's link field with the cockpit window's URL, or teach Make 12 to skip a card whose status is already past the kickoff. The notice (section 8) flags a second kickoff on its own. |
| 8 | **The cockpit path has never run in production**, and the one-card refresh it relies on is unproven natively. | The trail's 45 s / 2 min / 5 min checks may fail on the first real kickoff. | Run KICKOFF.md 7, check 5 (press Refresh on one client and read the run row) before the next onboarding call. |
| 9 | **A GitHub token sits in plain text** in Make 13 [25]. | Anyone with Make access can read it. | Rotate it and move it into a Make connection or keychain. |
| 10 | Make 06 stops when OpenAI credits run out (8 errors, 09-30 to 10-01). | The kickoff's Slack approval post would fail too. | Covered if the notice no longer depends on Make 06. |

---

## 8. Adding a #csm-general notice without firing Make twice

### 8.1 What must hold

- One message per kickoff response, never two. A second kickoff is said as
  such.
- It covers every way in: the cockpit window, the deck's last slide, the
  card's plain Typeform link, and Typeform direct.
- It says what actually happened on the card, not just "submitted".
- No change to Make 12, so ClickUp is updated exactly as it is today. The
  notice path only reads ClickUp.
- The cockpit rules: server-gated, through `tools.ts` into the health ledger,
  an audit row per post, a doctor, a plain health line when it cannot post.

### 8.2 The options

| Option | Covers every way in | Knows Make's result | Fires Make again? | Cost and risk |
|---|---|---|---|---|
| A. A new Typeform webhook on `tG7dnxBn` to our own Edge Function (signed, like `team-onboarding-intake/signature.ts`) | yes | no: it arrives before Make, so it still needs a wait-and-check step | no (a third webhook; Make's two are untouched) | Changes the live form's webhooks, adds a public endpoint and a secret. Instant. |
| B. The cockpit's `onSubmit` | **no**: it misses the card link and Typeform direct, and dies with a closed window | no | no | Cheapest, but blind to outside sends. |
| **C. The cockpit record: the mirror row gets a new `forms.kickoff.response_id`** (10-minute cron, sooner through the one-card refresh after a cockpit send) | **yes** (the sync reads every kickoff response from Typeform) | **yes**: the same pass holds `client_status`, `card_updated_at` and `links.blueprint_form` | no | No Make or Typeform change. Up to about 10 minutes late for outside sends, about 1–2 minutes for cockpit sends once the one-card refresh is proven. |
| D. A Slack module in Make 12 | yes | partly: only what Make 12 itself did | no, but it is an edit to a live scenario | Posts as Admin Bot outside the health ledger, and adds to the Make path the team is retiring. |

### 8.3 Recommendation: option C, an outbox fed by the record

1. **Queue.** A migration adds `cockpit_form_notices`, with row security and
   the grant in the same file:
   - columns `response_id` PK, `form_key`, `task_id`, `client_name`,
     `submitted_at`, `second`, `state` (`waiting|sent|late|failed`),
     `slack_ts`, `tries`;
   - an insert-only trigger on `cockpit_client_onboarding` that fires when
     `forms->'kickoff'->>'response_id'` becomes a value not yet queued, with
     `ON CONFLICT DO NOTHING` (the response ID is the key, so a replay cannot
     post twice);
   - `second` set when the card already had a kickoff, as
     `cockpit_csm_form_sent` decides it.
2. **Send.** One sender: a `cockpit-csm-api` operation, or a small function
   on pg_cron every minute.
   - For each waiting row, apply the trail's own rule (`kickoffCardDone`, and
     the Blueprint link present).
   - If done: post "Kickoff in for <client>. The card is at Brand Blueprint
     Booked, with the Technical and Creative tasks. Book the Brand Blueprint
     call next." with the card link.
   - If 10 minutes have passed and it is still not done: post "Kickoff in for
     <client>, but Make has not updated the card after 10 minutes. Open the
     card; do not send it again."
   - Then:
     - post as mahara-club-bot to `C09RZ0GS0V9`, through `tools.ts` (the CSM
       API's `tools.ts` has no Slack provider today; `cockpit-media-api/tools.ts`
       does, and `cockpit-creative-api` already reuses it for the Blueprint's
       #media-general post with read-back, `blueprint.ts:129-130`);
     - read the post back (`conversations.history`);
     - store `slack_ts` and write one audit row.
3. **Discipline.** A doctor (the token present, the bot in the channel), a
   runbook row, tests on synthetic rows, and a health line ("The kickoff
   notice could not post: <reason>").
4. **Why C.** It is the only option that is complete (every way in), true (it
   reports Make's outcome, which doubles as gap 3's alarm) and changes nothing
   in Make or Typeform. The cockpit's 45 s / 2 min / 5 min one-card refresh
   already moves a cockpit send through quickly. Option A is the upgrade if 10
   minutes is too slow for outside sends. It only replaces the queueing step,
   since the sender and its card check stay the same.
5. **Tie-ins.** The same outbox serves the native Brand Blueprint: queue on a
   `cockpit_blueprints` submit, post to #csm-general. That is the other map's
   decision. If gap 1 is fixed by drafting the summary in the cockpit, the
   notice can carry an "Approve the WhatsApp recap" step. Make 06's approval
   card then goes.

---

## 9. Not verified

- Whether any kickoff summary was sent to a client by hand: the cockpit's
  WhatsApp mirror and the groups were not read.
- Who set Client Status to Brand Blueprint Booked before the kickoff on
  Alalia, Smmim, Shades and Madana, and why mergestudio.kw shows no such
  status change.
- What Make 12 and Make 06 did between 2026-09-25 and the oldest log the API
  returned:
  - the logs endpoint returned runs back to 10-04 for Make 12, 09-30 for
    Make 06, 10-01 for Make 07 and 10-02 for Make 13;
  - Make 12 cannot have missed a run there, because Typeform has no kickoff
    between 09-13 and 10-04.
- That each phase-4 WhatsApp was delivered. Make says the Whapi module ran (13
  of 13 operations); delivery was not read back.
- The September 13 Slack approval post: it was beyond the search's 20 results.
- That maharaclubbot is the same app as `SLACK_BOT_TOKEN` in the Supabase
  secrets. Memory says so; the secret itself was not read.
- Make 10's exact writes of the plain kickoff link (only the fact that it
  names `tG7dnxBn` was read).

---

## Follow-up 2026-10-25

Read only, the same day. This section answers one question: what does "update
ClickUp the same way it used to" mean? It reads Make's blueprint version
history, Slack before 2026-09-01, the live bundles, the launch template and the
status writer. Nothing was submitted, run, edited, restored, posted or
messaged. No webhook URL, key, email, phone number or message body is copied
here. Sources:
- `Make <id> v<n> [m]` = `GET /scenarios/{id}/blueprint?blueprintId=<n>`, module m;
- `Make logs` = `GET /scenarios/{id}/logs`;
- `CU` = ClickUp REST GETs on the VPS (`CLICKUP_API_KEY` by name) and the MCP;
- `Slack` = the Slack MCP read tools. Times are as Slack shows them (BST) unless marked UTC.

### F.0 The answer in one screen

| Question | Answer |
|---|---|
| Was there ever a "kickoff complete" Slack post? | **No.** None of the 24 kept versions of Make 12 (v25, 2026-07-11, to v48, 2026-09-17) has a Slack module. The Monday-era kickoff (Make 02 `7908153`, its only kept version, v10) has none either. Slack has no automated kickoff notice from 2026-03-01 to 2026-09-01 (F.2). The #csm-general notice the CEO asked for is new, not a restore. |
| Was there ever a "Blueprint complete" post in #csm-general? | **No.** All 8 versions of Make 14 (`9748311`) post only to #media-general `C0AE8G5MT7Y`, "*Brand Blueprint completed*", from v2 (2026-09-02 15:41 UTC) on. |
| What did the kickoff do in ClickUp that it no longer does? | **It created the media launch task.** From at least v25 (2026-07-11) to v36, Make 12's MARKETING route made "<name> - New Client Campaign Launch 🚀" from template `t-86ex8xaf1` in Marketing / ADs `901816723196`, with the brief as a comment. v37 (2026-09-02 15:14 UTC) removed it. Make 14 v1 took it over 2 minutes earlier, on the Blueprint partial. Everything else Make 12 writes today was added, never removed. |
| Is the native Blueprint call page live? | **Yes, live and unused.** Both production bundles carry the routes and the RPCs (F.3). The database has 1 Blueprint record, 2 saves and 0 presses. |
| Did Make `9744107` set Brand Blueprint Booked before the kickoffs? | **Only on Smmim studio.** It did not on Alalia.co, Shades or Madana. Its status module did not exist until v9, 2026-10-06 17:58 UTC (F.5). |

### F.1 Make blueprint version history (question 1)

The endpoint exists. `GET /scenarios/{id}/blueprints` returned HTTP 200 for all
five scenarios, and `?blueprintId=<n>` returned each version. Make keeps only
recent versions, so anything older than the oldest kept version cannot be
seen.

| Scenario | Versions kept | Oldest kept | Current |
|---|---|---|---|
| `8925654` Make 12 "12. Kick Off Form Submitted" | 24 (v25 to v48) | v25, 2026-07-11 13:26 UTC, name "7. Mahara > Kick Off Form Submitted" | v48, 2026-09-17 15:47 UTC, by the systems manager |
| `9748311` Make 14 "14. Brand Blueprint Form Submitted" | 8 (v1 to v8) | v1, 2026-09-02 15:12 UTC | v8, 2026-09-17 15:47 UTC |
| `9209179` Make 06 "06. Post Call Summary" | 6 (v42 to v47) | v42, 2026-07-14 16:04 UTC | v47, 2026-09-06 13:01 UTC |
| `7908153` "02. Kick Off Submitted (OLD - Monday)" | 1 (v10) | v10, 2026-01-23 08:27 UTC, name "3. Kick Off Submitted" | the same |
| `8910150` "11. Closer Form to Onboarding (OLD)" | 1 (v98) | v98, 2026-04-01 10:52 UTC, name "8. Mahara - Closer Form/New Client Auto Onboarding" | the same |

Source: `Make /scenarios/{id}/blueprints`. Note: section 2 says Make 12 was
last edited "by Ziad". The version list puts v48 under the systems manager.

#### F.1.1 Make 12 (`8925654`), trigger hook 3992232 in every version

| Version (UTC) | Change | Source |
|---|---|---|
| v25, 07-11 | 9 modules. [1] Typeform. [12] `ai-local-agent:RunLocalAIAgent` writes the brief. [11] comment `{{12.response}}` on the card. [20] status `IN PROGRESS`. Router [14]: **MARKETING** [13] `createATaskFromATemplate` list `901816723196`, template `t-86ex8xaf1`, name "<answer 40829a5c> - New Client Campaign Launch 🚀", + [16] the brief as a comment; **TECH** [17] list `901816723190`, template `t-86ex8x9xw`, + [18] comment. Filters MARKETING and TECH have no conditions. | Make 12 v25 |
| v26, 08-29 06:32 (the CEO) | MARKETING route removed; v27 (06:40) put it back | v26, v27 |
| v30, 08-30 | Task names from `hidden.legal_name` | v30 [13], [17] |
| v32, 09-01 21:04 | **+ [21]** `editATask` on `901816559981`: `1b7a4a74` Blueprint link and `9368ca9e` Client Status = `dbd21650` (Brand Blueprint Booked). No filter. | v32 [21] |
| v36, 09-02 13:10 | Renamed "12. …". **+ CREATIVE** [22] list `901818016338`, template `t-86eyu1w3d`, + [23] comment | v36 |
| **v37, 09-02 15:14** | **− MARKETING [13] and [16]: the launch task and its brief are gone from the kickoff** | v37 diff |
| v40, 09-08 | + [24] sheet lookup, [25] `whapi-cloud:text` phase 4 (filter "WhatsApp group exists" on `{{24.`5`}}`) | v40 |
| v42, 09-10 11:15 | + [26] `51f49cb1` Onboarding Map phase 4, [27] read the card | v42 |
| **v43, 09-10 14:24** | **− [12] the AI brief.** The three comments become the structured "*KICKOFF HANDOFF*" | v43 |
| v45, 09-13 | + [28] 30–120 s sleep | v45 |
| v46, 09-14 (the CEO) | [21] gains 9 fields: `924bba47, a1520ef3, ac976d4a, bab9a58b, bc7e70a2, cc14ad2d, d113cd99, e7d158a8, f0a20cef` | v46 [21] |
| v48, 09-17 | Current: 14 modules counting router [14]. A router uses no operation, so a run is 13 operations. | v48 |

No version has a Slack, GoHighLevel, calendar or data store module. Make 12 has
never booked a call or posted to Slack. Since v32, [21] sets Brand Blueprint
Booked with no filter, so it would move a card back if a kickoff landed after
a later stage. That was not seen in the 8 kickoffs (section 4).

#### F.1.2 Make 14 (`9748311`), gateway hook 4350422

| Version (UTC) | Change |
|---|---|
| v1, 09-02 15:12 | Router [2]. PARTIAL [3] template `t-86ex8xaf1` on `901816723196`, filter `{{1.event_type}}` = `form_response_partial`; [4] comment "**Brand Blueprint - media handoff**" |
| v2, 09-02 15:41 | + [5] Slack `C0AE8G5MT7Y` (#media-general) "*Brand Blueprint completed*", filter `{{1.event_type}}` = `form_response` |
| v4, 09-08 | + [6] sheet lookup, [7] Whapi phase 5 ("WhatsApp group exists" on `{{6.`5`}}`) |
| v5, 09-10 | + [8] `51f49cb1` map phase 5, [9] read the card |
| v6, 09-13 | + [10] sleep |
| v7, 09-17 (the CEO) | [8] gains `39839c9d` Can Self-Record? |

Nothing was ever removed. No version writes Client Status `9368ca9e`, and no
version posts to `C09RZ0GS0V9`. Source: Make 14 v1–v8. None of the five Slack
modules found in F.1 and F.1.4 @-mentions anyone (mapper scan for `<@`, `<!`,
`@channel`, `@here`).

#### F.1.3 Make 06 (`9209179`), hook 4114295 in every version

| Version (UTC) | Change |
|---|---|
| v42, 07-14 | No router. Every run: three GPT calls, read the card from answer `c484f390`, [17] to-do comment, [21] Client Happiness `4e3924e3` and Last POC `e183f2ce`, [23] data store, [24] Slack `C09RZ0GS0V9` "*Client summary pending approval — {{13.`1`}}*", [15] Slack `C09SVG6FHGU` (the grade) |
| v43, 09-01 18:49 | Card ID from `ifempty(hidden.onboarding_client_id; answer)`. Router [30] "Which call was this?": index 0 [3] filter `{{2.form_id}}` = `fRokTITH` → [3] [17] [4] [21] [15]; index 1 → [22] [23] [24] |
| v46, 09-02 16:46 | [22] filter "not a mid-call partial": `form_id ≠ oYZKtogO` OR answer `bb0019` exists |

Nothing was removed; v43 only gated route 0 to the check-in. Before
2026-09-01, Make 06 saw only `fRokTITH`: the kickoff's `postcallsummary`
webhook was created 2026-09-01 and the Blueprint's on 2026-09-02 (TF webhooks).

#### F.1.4 The two old scenarios, and two removed Slack steps found on the way

- **`7908153` v10** (Monday era): 8 modules, all Monday or built-in. They are:
  - [1] gateway webhook;
  - [109] `monday:GetItem` "FIND ONBOARDING TASK";
  - [111] `monday:CreateUpdate` "ADD FINAL NOTES FROM KICK OFF FORM";
  - router [8]: MEDIA BUYING [60] `monday:CreateItem` "MEDIA BUYING TASK" + [90] update; TECH [57] "TECH TASK" + [110] update. Neither filter has conditions.

  It has no Slack, ClickUp or WhatsApp module. Its mappings were not printed,
  because make-inventory.md says they carry card fields. So "safe to leave
  alone" (3.5) means only that no kickoff webhook reaches it (hook 3514231, 0
  runs). make-inventory.md's warning about what it would send to Monday still
  stands.
- **`8910150` v98** posts [53] "Slack to CSM" to `C09MNHBAY1Y`, which is
  **#new-clients** (`slack_search_channels`). The text is "*🔫Pew Pew🔫*", the
  new-sale notice. It also writes card fields `19e39b91`, `87d7d889` (Kickoff
  Form Link) and `e6da13ae`, and tags. It sets no Client Status. Its successor,
  Make 10 MAIN `8979157` v143, still has [53] to #new-clients, plus [102] on an
  error route ("⚠️ Billing fields failed…"). The sale notice moved; it was not
  removed.
- **Removed: two onboarding-form posts (Make 13 `8922994`).** v88–v99 had:
  - [33]: a ClickUp research-doc link to `C09PDFY8MT4`, **#onboarding-form**;
  - [37] "Slack to CSM": "*Onboarding docs for client were cerated on Clickup* 📝📝" to #new-clients.

  **v100 (2026-09-10 15:26 UTC, the systems manager) removed both**, together
  with the ClickUp research-doc HTTP modules [27] [28] [43], the [30] comment
  and the Google Docs modules [32] [34]. [25] became "Queue Market Intel on
  VPS". Slack shows the #new-clients posts under the CEO's account from
  2026-05-25 to the last one on 2026-09-03 18:35. This step belongs to the
  onboarding form `KFRCXPFx`, not the kickoff.
- **Removed earlier: the onboarding-form notice (`7860714` "L&S - Onboarding
  Form Completed", inactive, v46 2026-03-03).** [556] posted "<legal name> has
  just submitted their onboarding form" to #onboarding-form. Make 13
  (created 2026-03-24) has no such module in any kept version.

#### F.1.5 What existed before and is gone now

| Effect | Where it lived | Gone since | Where it is now |
|---|---|---|---|
| Kickoff creates the "New Client Campaign Launch 🚀" task from `t-86ex8xaf1`, with the brief | Make 12 v25–v36 [13] [16] | v37, 2026-09-02 15:14 UTC | Make 14 PARTIAL [3] [4] (old Typeform only); natively, Blueprint part 1 "Send to media" (`blueprint.ts:72-107`), never pressed |
| AI-written kickoff brief ("Submission Overview") | Make 12 v25–v42 [12] | v43, 2026-09-10 | the structured KICKOFF HANDOFF |
| Monday Media Buying and Tech tasks | `7908153` v10 | Monday era | ClickUp Technical task (Make 12 [17]); the media task left the kickoff (row 1) |
| #onboarding-form "has just submitted their onboarding form" | `7860714` [556] | Make 13 replaced it, 2026-03-24 | nothing |
| #new-clients "Onboarding docs … created on ClickUp" and #onboarding-form doc link | Make 13 v88–v99 [37] [33] | v100, 2026-09-10 | nothing |

No Slack post, ClickUp write or WhatsApp send tied to the kickoff or the
Blueprint completion was removed in any kept version of Make 12, Make 14 or
Make 06.

### F.2 Slack before the cockpit (question 2)

Searches were run on `slack_search_public_and_private`, 2026-03-01 to 2026-09-01,
with bots included. "Kick Off Submitted" and "blueprint completed" returned 0
hits. "kick off", "kickoff", "onboarding form", "Brand Blueprint" and "brand
DNA" returned only people's messages, meeting summaries, EODs, call reviews and
the automated rows below. Two channels were read for the window as well:
#onboarding-form and #csm-general.

| Date(s) | Channel | Poster | First line | Source scenario |
|---|---|---|---|---|
| 03-03 to 03-22 (6 posts) | #onboarding-form `C09PDFY8MT4` (private) | the CEO's account | "<client> has just submitted their onboarding form", then "Please reach out and book your onboarding call and react with a ✅ once complete" | `7860714` [556] |
| 04-03 to 05-16 | #onboarding-form | Admin Bot | "Client Research Report — <client>" | Not verified (no kept version shows it) |
| 05-18 to 09-03 | #onboarding-form; #new-clients `C09MNHBAY1Y` (private) | the CEO's account | a ClickUp doc link; "*Onboarding docs for client were cerated on Clickup*" | Make 13 v88–v99 [33], [37] |
| 05-26 to 08-30 and on | #new-clients | Admin Bot | "*🔫Pew Pew🔫*" (a new client signed, "CSM call ASAP") | Make 10 MAIN [53] (closer form) |
| from 07-14 15:32 | #csm-general `C09RZ0GS0V9` (private) | Admin Bot | "*Client summary pending approval — <client>*" | Make 06 [24] (the first post predates v42, so it came from a version no longer kept) |
| from 07-25 / 07-28 | #csm-general | Admin Bot / the CEO's account | "*Report reminder pending approval — <client>*"; billing reminders "*<client>* — $… due …" | Not verified (other scenarios) |
| 08-08, 08-29 | #client-call-feedback | Admin Bot; "Aziz's Assistant" | "Pinpoint Scaling Call Review"; "Call Coaching Log" | Make 06 [15]; a separate assistant |

No message in the window is a kickoff or Blueprint notice. No automated message
@-mentions anyone. The onboarding-form notice asks for a ✅ reaction instead.
Source: Slack searches and `slack_read_channel` on `C09PDFY8MT4` and
`C09RZ0GS0V9` (2026-03-01 to 2026-09-01).

**How a kickoff looked in August (Ocean Home, 2026-08-29):**
- the call notes `fRokTITH` were submitted at 15:52:59 UTC;
- the old kickoff `BbJy6xg4` at 15:53:05 UTC;
- the launch task `86eyt14d1` was created at 15:53:21 UTC (Make 12 MARKETING);
- the #client-call-feedback grade and the #csm-general approval card came at 16:53:25 BST.

So the old Slack trail after a kickoff came from the *call notes form*, not
the kickoff. Sources: TF `GET /forms/{id}/responses` (times only); CU
`86eyt14d1`; Slack hits for 2026-08-29.

### F.3 Today's live pages (question 3)

These were fetched on 2026-10-25 with `curl`, following the chunks from
`index.html`. Creative entry: `index-B92GaIol.js` (index last-modified 2026-10-25
10:16 GMT). Client success entry: `index-DyWx7WHI.js`.

| String | `/creative/` | `/client-success/` |
|---|---|---|
| `BlueprintCallPage` | absent. Component names are minified. The route it serves is present: `path:"/blueprint/:taskId"` and `"/blueprint/:taskId/notes"` in `AuthenticatedAppRoutes-n3Z0ZSQ-.js` (source `AuthenticatedAppRoutes.tsx:87, 98`) | absent (not part of this app) |
| `cockpit_blueprint_part_done` | present, `AuthenticatedAppRoutes-n3Z0ZSQ-.js` | present, `PresentPage-BA4jhTAF.js` |
| `blueprintClose` | absent | absent. It is a server-side outbox kind (`20261024a_brand_blueprints.sql:554, 1012`; `cockpit-creative-api/blueprint.ts:8`), so it is not expected in the browser |
| `present/blueprint` | present: the URL builder `/client-success/clients/${…}/present/blueprint` | present, `AuthenticatedAppRoutes-DALTY87J.js`: routes `/clients/:key/present/blueprint` and `/notes`, gated `anyOf ["csm","creative"]` |
| `cockpit_csm_form_sent` / `C09RZ0GS0V9` / `oYZKtogO` | absent / absent / absent | present / absent / absent |

The server functions exist: `pg_proc` has `cockpit_blueprint_part_done`,
`_save`, `_read` and `_payload` (SQL). Use so far:
- `cockpit_blueprints`: 1 row (Smmim studio `86ex70t90`);
- audit: 1 `blueprint.insert` (the migration) and 2 `blueprint.save` (2026-10-24 10:58 UTC);
- `cockpit_creative_outbox` Blueprint kinds: **0 rows**;
- `close_route` = `card_only`.

The page is live and has never been pressed (SQL).

### F.4 The template native part 1 uses (question 4)

- `GET /team/90182518398/taskTemplate` names `t-86ex8xaf1` as **"Media
  Onboarding 2.0"**. The same listing names `t-86ex8x9xw` "Tech Onboarding"
  and `t-86eyu1w3d` "Creative Onboarding".
- The template is not a task in Task Templates `901816723408`. That list holds
  28 other templates.
- The MCP `get_task 86ex8xaf1` returns "Team not authorized", and ClickUp v2
  has no endpoint that reads a template's contents.
- So the contents below come from tasks made from the template. Source: CU.

| Launch task (created UTC) | Made by | Subtasks | Checklists | First comment |
|---|---|---|---|---|
| `86exgfwgm` JG Designs (05-05), `86ey8jqu4` Liwan (07-11), `86eyt14d1` Ocean Home (08-29), `86eytm865` RENDER (09-01) | Make 12 MARKETING (for 07-11 on, from v25; earlier ones are an inference) | 4: New Setup / Onboarding · Facebook Ads Buildout · Tracking Sheets · QA Checklist | none | "Submission Overview" (the AI brief) |
| `86eywate0` Alola (09-12 15:11), `86eywc0xy` ARDON (09-13 07:46), `z8xmdvdza1` Merge studio (09-17 10:14) | Make 14 PARTIAL | 6: the 4 above + "0 · Intro Message To The Client" + "Message The Client: Campaign Ready" | none | "**Brand Blueprint - media handoff**" |

ARDON's task matches the template exactly: the 6 subtasks above, all "to do".
It has no assignee, no tags and no due date. Its description is "Media buyer
onboarding and campaign buildout for a new client …". The template gained the
two messaging subtasks between 09-01 and 09-12 (not verified exactly when).

Marketing / ADs holds 36 launch tasks:
- 9 made by hand (2026-03-20 to 04-21);
- 24 made by Make's ClickUp connection on kickoffs (05-05 to 09-01);
- 3 made by Make 14 on Blueprint partials.

**For checking native part 1:** "the same way it used to" means one task on
`901816723196` from `t-86ex8xaf1`, named "<name> - New Client Campaign Launch
🚀", carrying the 6 subtasks and the handoff brief as a comment. The native
code goes further: it tags the task with the card name and sets a due date and
an assignee (`blueprint.ts:72-107`). Make never did those. The first real
press should show the 6 subtasks.

### F.5 The status writer (question 5)

Make `9744107` gained its Client Status module ([6] read the stage, [7] "Set
Client Status from the booked call", forward only) in **v9, 2026-10-06 17:58
UTC**. v1–v8 (2026-09-01) wrote only Next POC. The operation count shows what
a run did: [1] + [2] Next POC + [6] + [7]; router [5] uses no operation. So a
**4-operation run is the one that writes Client Status**. Of the 44 runs from
09-27 to 10-22, only two used 4 operations: 2026-10-12 12:16:55 and 2026-10-17
11:58:21 UTC. Sources: Make 9744107 v1–v9, Make logs.

| Card | "Status Changed To" (ClickBot comment, UTC) | Nearest 9744107 runs | Verdict |
|---|---|---|---|
| Smmim studio `86ex70t90` | Brand Blueprint Booked 10-12 12:16:58 | 4-op run 12:16:55 | **Confirmed** |
| Alalia.co `z8xmdvh0k9` | Brand Blueprint Booked 10-13 08:40:11 | 10-13 runs at 07:43:47 (1 op), 07:44:03 (1), 07:58:14 (2), 08:16:46 (2), 08:17:03 (1) | **Refuted**: no run at 08:40 and no 4-op run |
| Shades `z8xmdvfpyw` | Brand Blueprint Booked 10-06 13:17:10 | 09:53:10 (2), 12:24:29 (1); the status module did not exist until 17:58 | **Refuted** |
| Madana `z8xmdvffcd` | Onboarding Booked 10-04 08:59:51; Brand Blueprint Booked 09:39:28 | 09:43:02 (2); before v9 | **Refuted**. The change came 33 s before Make 12's handoff comment (09:40:01), so Make 12 did not make it either |
| Control: SMART INTERIOR `z8xmdvj7hm` | Onboarding Booked 10-17 11:58:23 | 4-op run 11:58:21 | Confirms the operation-count reading |

Smmim's Onboarding Booked (10-08 10:32:58) has no 9744107 run that day either.
The native booking dialog did not make any of these changes:
`cockpit_csm_actions` has 4 rows in all, all `act`, and none is a booking
(SQL). Who made the three refuted changes is **not verified**. The candidates
are a person editing the card, or (for Shades only, after commit 65287d4 on
10-06) the Convex-era booking outbox (memory `csm-booking-and-portal-tasks.md`).
Convex has been exported and switched off, so this was not read.
mergestudio.kw's LAUNCH BOOKED (09-16 14:25:15) came before v9, so 9744107
did not make it. Source: CU comments (first lines only).

### F.6 Contradictions this follow-up settles

| Contradiction | Finding | Source |
|---|---|---|
| Can Make 14's PARTIAL route fire? | **Yes, it did.** Three launch tasks carry Make 14 [4]'s "Brand Blueprint - media handoff" comment 2–3 s after creation: Alola 09-12 15:11:40/42, ARDON 09-13 07:46:21/24 and Merge studio 09-17 10:14. Route 0's filter needs `form_response_partial`, so partial events reached hook 4350422 in September. blueprint-path.md is right and make-inventory.md's claim is refuted. Whether they still arrive today is not verified. | CU tasks and comments; Make 14 v8 [3] |
| Make 06's 8 errors | All 8 are in the logs' own `error` field as `RateLimitError` "[429] You have no credits remaining", with 4 operations each. 4 operations = trigger, [16], [13] and the first GPT call of whichever route ran. No kickoff (09-13 to 10-04) and no Blueprint response (after 09-17) falls in 09-30 to 10-01, so these were check-in runs failing at [3]. That is consistent with section 3.1. The error text does not support a mistyped Client ID. | Make logs `9209179` |
| 26 runs vs 17 responses | The operation buckets are confirmed: 11 runs × 11 ops, 7 × 6 ops, 8 × 4 ops. That makes 26. The one extra check-in run is still not explained. | Make logs |
| Make 06 [21] "by label" vs "by option id" | Both, in turn. It reads the label of answer `ff7970f7` and `switch()`es it to one of six option IDs (Paused, At Risk, Neutral, Happy, Very Happy (testimonial), Churned). Any other label writes empty. | Make 06 v47 [21] |
| 13 vs 14 modules in Make 12 | 14 modules counting router [14]; 13 operations per run, because a router uses none. | Make 12 v48 |
| Make 06 routes "1 and 2" vs "0 and 1" | The same routes. The blueprint indexes them 0 and 1 (`30.0`, `30.1`). | Make 06 v47 |
| Who set Brand Blueprint Booked before the kickoffs | Make 9744107 on Smmim only (F.5). | F.5 |
| "Make 12 books the Brand Blueprint" | No version of Make 12 has a booking, calendar or GHL module. | F.1.1 |
| Names of `C09SVG6FHGU`, `C09MNHBAY1Y`, `C09PDFY8MT4` | `C09SVG6FHGU` = #client-call-feedback: a Make 06 [15] run and an Admin Bot grade post there happened at the same second, 08-29 16:53:25. `C09MNHBAY1Y` = #new-clients and `C09PDFY8MT4` = #onboarding-form, both private (`slack_search_channels`). | Slack |
| 7908153 "safe" vs "maps card fields" | Both hold (F.1.4). | Make 02 v10 |

One small correction to section 1.1: Make `/hooks` lists hook 4017622 (the old
form's `WHTP4017622`) against scenario `9165775` "01. Typeform to RAW LEADS"
(inactive). That scenario's own trigger is hook 4105199. Not verified which
record is current.

### F.7 Not verified

- Anything older than the kept versions: Make 12 v1–v24 (before 2026-07-11),
  Make 06 v1–v41 (before 2026-07-14), `7908153` v1–v9, `8910150` v1–v97 and
  Make 13 v1–v87. A Slack step that lived only there cannot be seen. Make 12
  was created 2026-03-24.
- Who made the Brand Blueprint Booked changes on Alalia.co, Shades and Madana,
  the Onboarding Booked changes on Smmim (10-08) and Madana (10-04), and
  LAUNCH BOOKED on mergestudio.kw.
- When `t-86ex8xaf1` gained its two messaging subtasks. The template's own
  contents cannot be read through the API.
- Who posted Admin Bot's "Client Research Report" (04-03 to 05-16), the
  "Report reminder pending approval" cards and the billing reminders in
  #csm-general.
- Later pages of two Slack searches ("Pew Pew" and "Onboarding docs" each have
  more than 20 hits). The first pages were enough for the dates given.
- Whether Typeform still sends `oYZKtogO` partials to hook 4350422 today.

### Then vs now

| Effect | Old version and date | Today | Native plan |
|---|---|---|---|
| Kickoff → handoff comment on the card | Make 12 v25 (07-11): AI brief `{{12.response}}`; v43 (09-10): structured KICKOFF HANDOFF | Make 12 v48 [11], unchanged since 09-17 | Make 12 stays the writer (8.3) |
| Kickoff → card `IN PROGRESS` | v25 [20] | v48 [20] | unchanged |
| Kickoff → **New Client Campaign Launch task** (`t-86ex8xaf1`, `901816723196`) + brief | v25–v36 [13] [16]; removed v37 (09-02 15:14) | not on the kickoff. Make 14 PARTIAL does it, only from the retired `oYZKtogO` | Blueprint part 1 "Send to media" creates it (dedupe, tag, due date, assignee); 0 presses so far |
| Kickoff → Technical Onboarding task (`t-86ex8x9xw`, `901816723190`) | v25 [17] [18]; Monday era "TECH TASK" (`7908153` v10) | v48 [17] [18] | unchanged |
| Kickoff → Creative Onboarding task (`t-86eyu1w3d`, `901818016338`) | added v36 (09-02) | v48 [22] [23] | unchanged |
| Kickoff → Client Status Brand Blueprint Booked + Blueprint link (`9368ca9e` = `dbd21650`, `1b7a4a74`) | added v32 (09-01 21:04); 9 more fields v46 (09-14) | v48 [21], no forward-only filter | unchanged in Make; the link should point at the native Blueprint (gap 4) |
| Kickoff → Onboarding Map phase 4 + WhatsApp | v40 (09-08), v42 (09-10), v45 (09-13) | v48 [26] [27] [24] [28] [25] | unchanged |
| Kickoff → Slack | none in any kept version; the August trail came from the call notes form via Make 06 (#client-call-feedback grade, #csm-general approval card) | Make 06 [24] approval card in #csm-general on every kickoff since 09-01 | **new** #csm-general "kickoff complete" notice from the cockpit record (8.3) |
| Booking a Blueprint/launch call → Client Status forward | Make 9744107 v1–v8 (09-01): Next POC only | v9 (10-06): forward-only status by calendar; set Smmim's only | the native CSM booking moves the stage forward (`checkins.ts:79-88`), never used yet |
| Blueprint partial → launch task + media brief | Make 14 v1 (09-02); fired 09-12, 09-13, 09-17 | Make 14 v8, live on the retired form | part 1 "Send to media" |
| Blueprint complete → #media-general "Brand Blueprint completed" | Make 14 v2 (09-02 15:41); last real post ARDON 09-13 | Make 14 v8 [5]; native `close_route = card_only` posts nothing | the `slack` route posts to #media-general; **#csm-general is new** (not in any old version) |
| Blueprint complete → Can Self-Record? + map phase 5 + WhatsApp phase 5 | Make 14 v4 (09-08), v5 (09-10), v7 (09-17) | Make 14 v8 [8] [9] [6] [10] [7] | part 2 close writes the fields; the CSM pastes phase 5 |
| Blueprint complete → Client Status | never (no Make 14 version writes `9368ca9e`) | LAUNCH BOOKED comes from 9744107 when the launch call is booked | the same |
| Onboarding form → Slack | `7860714` #onboarding-form notice (03-03 to 03-22); Make 13 v88–v99 #new-clients and #onboarding-form posts (to 09-03) | none since Make 13 v100 (09-10) | not in the CEO's ask; worth a decision |
