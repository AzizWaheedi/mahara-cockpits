# Make inventory: forms and the client lifecycle

Read-only map, 2026-10-25, branch `forms-1025` (origin/main `d2c9817c`).
Team 2108984 on eu2.make.com. Nothing was run, edited, replayed or
submitted. Every Make call was a GET. No Typeform response was submitted,
and nothing was written to ClickUp or Slack.

What this map leaves out on purpose:
- webhook URLs (each one is a key: anyone holding it can fire the scenario);
- the shared token that `9793648` checks in a filter;
- phone numbers, emails and message bodies (a "WhatsApp text" or a "Slack
  post" is named, never quoted).

Module numbers in square brackets are the module IDs inside the scenario's
blueprint, for example `8925654 [21]`.

---

## 0. The findings that change the forms work

1. **A kickoff posts nothing to Slack itself.** Kickoff `tG7dnxBn` fires two
   scenarios:
   - Make 12 `8925654` (7 runs in 30 days, matching Typeform's 7 completed
     responses). It writes the card, creates tasks and sends the WhatsApp,
     but it has no Slack module.
   - Make 06 `9209179`. Its route 2 drafts an AI WhatsApp recap and posts
     "Client summary pending approval" in **#csm-general** (`C09RZ0GS0V9`).
     The Slack search confirms these posts from "Admin Bot" (15 to
     21 Oct). That post is an approval request, not a "kickoff done" notice.
2. **A Blueprint completion posts to #media-general, never #csm-general, and
   it has not happened in 30 days.**
   - Make 14 `9748311` has 0 runs. Typeform `oYZKtogO` has had 1 completed
     response ever (2026-09-13).
   - The `blueprint` webhook on `oYZKtogO` subscribes to `form_response`
     only, so Make 14's PARTIAL route cannot fire either.
   - The native cockpit form's close is set to `card_only`
     (`cockpit_blueprint_settings`). So a Blueprint closed in the cockpit
     today posts no Slack anywhere.
   - The cockpit's `make` close sends `{source, key, event, …}`
     (`supabase/functions/cockpit-media-api/tools.ts:10-24`). No Make 14
     route reads that: both routes filter on `event_type`. The "COCKPIT
     CLOSE" route in `docs/brand-blueprint/PLAN.md` was never built.
3. **Every client lifecycle form already has a live scenario, and none has
   run in 30 days.** The last completed responses were on 2026-09-14, the
   day those scenarios were built.
   - Extension `gqBcyK6g` fires two active scenarios, so both run on every
     submit:
     - `9000763` adds a Sheet row and posts in #csm-announcements;
     - `9805665` moves the card's Next Payment Date and comments on the card.
   - Pause `CTUjv6l3` fires `9805613`: Client Status Paused, Paused On,
     Resume On and a comment. It posts no Slack.
   - Termination `knIe4eF3` has two webhooks:
     - `9805538` is active: card Stopped, the three churn fields, a comment
       and a post in #csm-announcements;
     - `8962418` is inactive and marked invalid: Sheet, Slack and two
       offboarding tasks.
4. **The check-in form `fRokTITH` (the "1-1 call notes" form) runs the most
   form logic.** Make 06 runs two routes on it:
   - route 1: a GPT to-do list as a card comment, a GPT call grade posted
     in #client-call-feedback, then Client Happiness and Last POC on the
     card;
   - route 2: a GPT WhatsApp recap, saved to data store 171744, posted for
     approval in #csm-general, and sent by Make 07 `9523861` through WHAPI
     once someone approves it.

   Make 06 had 26 runs and 8 errors (30 Sep to 1 Oct). In the same window
   the forms that feed it had 17 completed responses (10 `fRokTITH` and 7
   kickoffs). The two counts are not reconciled.
5. **NPS `fuPgs85S` and CSAT `KbcbPA73` go only to Slack**
   (#nps-survey-feedback). No Sheet, card or table keeps them. Each form has
   had 1 response ever (2026-03-30).
6. **New Client Form `BTzMwXiw` feeds four places.**
   - Make 10 `8979157` (MAIN): 5 runs, matching 5 completed responses.
   - The inactive `9169732`, whose hook is holding 5 queued deliveries.
   - A HighLevel webhook (`live_integration_ai`).
   - A Cortana webhook (`agentkong_…`).
7. **No live Make scenario assigns tickets.**
   - The Monday-era "Universal Ticket Assignment" `8063994` and
     "SOP-Specific Ticketing" `8064859` are off.
   - "[DRAFT] Typeform Internal Request" `9783436` (form `o0ULXQhD`) is
     off. It would create one task in ClickUp "All Tasks" `901816723226`.
   - The ClickUp-side requests that do reach Make go through ClickUp
     automations that call Make webhooks: WhatsApp Reconnection `9799073`,
     Payment Failure/Success `8866601` and Client Update `8903351`.
   - The portal's "Client Portal Tasks" go through `9793648` route 15.
8. **Two switched-on legacy hooks still map card-number and CVV fields**:
   `7908153` "Kick Off Submitted (OLD - Monday)" and `8069605` "Add Client
   Card Info to PM Tool (OLD - Monday)". Neither ran in 30 days.
   - The current "Client Card Info" form `Uju17Z13` → `9018535` adds a Sheet
     row and sends a Slack direct message to one person. It had 1 response
     ever.
   - See section 8.4.

---

## 1. Method and sources

| What | How |
|---|---|
| Scenario list | `GET /scenarios?teamId=2108984&pg[limit]=200` (202 scenarios), `GET /scenarios-folders?teamId=2108984` (9 folders), run 2026-10-25 ~10:12 UTC |
| Blueprints | `GET /scenarios/{id}/blueprint` for all 202. Secrets were stripped on the VPS before the file came back: auth headers and keys, Make hook URLs (swapped for the hook ID), Apps Script URLs and long hex tokens. |
| Runs | `GET /scenarios/{id}/logs?pg[limit]=50&pg[offset]=…`, paged back to 2026-09-25 ~10:30 UTC (30 days). A **run** is a log row with `eventType = EXECUTION_END`. Rows of type `modify`, `start` and `warning` are edits and activations, not runs. **Errors** are status 3 and **warnings** status 2. |
| Hooks | `GET /hooks?teamId=2108984` (160 hooks). Each Typeform webhook URL was matched to its Make hook on the VPS, and only the hook IDs were printed. |
| Typeform | `GET /forms/{id}/webhooks` (tag, enabled, events, host only) and `GET /forms/{id}/responses?response_type=completed[&since=2026-09-25T10:39Z]` (counts only), with `TYPEFORM_API_TOKEN` read by name on the VPS |
| Data stores | `GET /data-stores?teamId=2108984` |
| ClickUp names | MCP `clickup_get_custom_fields(list 901816559981)` and `clickup_get_list` for 901816723226, 901818343027, 901821803697, 1100530000000279, 901817774521 |
| Slack names | MCP `slack_search_channels` ("general"); `slack_search_public_and_private` in `C09RZ0GS0V9`, counts only |
| Supabase | `cockpit_blueprint_settings` (`close_route = card_only`); `cockpit_blueprints` has 1 row, last updated 2026-10-24; `cockpit_csm_form_sends` has 0 rows |

The "ops counter" in the appendix is the `operations` field of Make's
scenario list. It matches the 30-day log sum for most scenarios: for
example 7 kickoff runs × 13 ops = 91. For `8979157` it does not (159 in the
counter against 95 in the logs), so it is shown but not relied on.

---

## 2. The team at a glance

| Folder | Scenarios | Active | Active with a run in 30 days |
|---|---|---|---|
| (no folder) | 90 | 10 | 5 |
| 01 Client Ops | 28 | 21 | 15 |
| 02 Call Center | 7 | 4 | 1 |
| 03 Client Success | 15 | 14 | 5 |
| 04 B2B Sales | 17 | 0 | 0 |
| 05 Billing | 5 | 3 | 2 |
| 06 EOD Reporting | 21 | 14 | 11 |
| 07 Team & Internal | 10 | 2 | 1 |
| 08 Legacy - Still Live | 9 | 9 | 2 |
| **Total** | **202** | **77** | **42** |

The 09 Archive folder is empty.

Trigger modules (first module of each blueprint):
- 93 custom webhooks (`gateway`), 35 of them active;
- 31 Typeform watches (26 active);
- 17 Call Center Mastery app triggers (all off);
- 23 scenario-service subscenarios (4 active);
- 8 Google Sheets, 8 Slack, 6 HTTP;
- 3 ClickUp: `9356423` (`watchTasks`, on) and two scheduled `getListTasks` (`9686154` on, `9585364` off);
- 1 Monday (off), plus one each of Airtable, code, Facebook Insights, Hubstaff, OpenAI, Supabase and WHAPI, and 2 placeholders.

Three blueprints could not be read: `9610459`, `9327580` and `6806400` hit
network errors in both passes.

---

## 3. Form → scenarios → effects

Responses are Typeform completed responses (30 days and all time). Runs are
Make runs in the same 30 days.

| Form | Typeform webhook tag (enabled) → Make hook | Scenario (state) | Responses 30 d / all | Runs 30 d | What it does | Messages the client? |
|---|---|---|---|---|---|---|
| **New Client Form** `BTzMwXiw` | `WHTP4014052` (on) → 4014052 (Typeform) | **Make 10** `8979157` "Closer Form to Onboarding (MAIN)" (on) | 5 / 55 | 5 (2 warnings) | Card in Clients - Mahara with Needs Contacting and 15 fields; GHL sub-account; portal provision; WhatsApp group + welcome + video; GHL user invite; Apps Script docs; AI summary to #new-clients and the card; GHL contact + Client ID; contract catch-up hook 4347387 | **Yes**: creates the group, sends the welcome text and a video, and GHL sends the user invitation |
| | `WHTP4096881` (on) → 4096881 | `9169732` "Closed to RAW LEADS" (**off**, 5 deliveries queued on the hook) | | 0 | B2B RAW_LEADS sheet row | No |
| | `live_integration_ai` (on) → HighLevel | not Make | | | | not verified |
| | `agentkong_f47f41d1` (on, signed) → app.usecortana.ai | not Make | | | | not verified |
| **Onboarding** `KFRCXPFx` | `WHTP3991048` (on) → 3991048 | **Make 13** `8922994` "Client Onboarding Form" (on) | 5 / 46 | 5 | GitHub dispatch `market_intel`; card Client Profile + Kickoff Form Link + Onboarding Map phase 3; raw-answers comment; WhatsApp phase 3; "<business> - Brand DNA 🧬🧬" task in Media/Creative | **Yes**: phase 3 WhatsApp to the group |
| Old onboarding `uUEp9YwJ`, `Aa6nUPOs` | `integration_ai` (on) → HighLevel only | `5891130` "MaharaMedia Onboarding" polled `uUEp9YwJ` (off) | 0 / 3 and 0 / 9 | 0 | Old GHL location + Drive folder | — |
| **Kickoff** `tG7dnxBn` | `WHTP3992232` (on) → 3992232 | **Make 12** `8925654` "Kick Off Form Submitted" (on) | 7 / 8 | 7 | Handoff comment; card IN PROGRESS; Technical + Creative Onboarding tasks with briefs; Blueprint link + Brand Blueprint Booked + 9 status fields; Onboarding Map phase 4 + WhatsApp | **Yes**: phase 4 WhatsApp |
| | `postcallsummary` (on) → 4114295 | **Make 06** `9209179` route 2 (on) | | (shared) | GPT recap → data store → #csm-general approval → Make 07 sends | **Yes**, after a person clicks Send |
| Old kickoff `BbJy6xg4` | `WHTP3992232` and `WHTP4017622`, both **off** | — | | | Dead | — |
| **Brand Blueprint** `oYZKtogO` | `blueprint` (on, `form_response` only) → 4350422 (gateway) | **Make 14** `9748311` (on) | 0 / 1 | 0 | PARTIAL: media launch task + brief. COMPLETE: #media-general, Can Self-Record? + Onboarding Map phase 5, WhatsApp phase 5 | **Yes**: phase 5 WhatsApp (complete route) |
| | `postcallsummary` (on) → 4114295 | Make 06 route 2 | | | Recap draft for approval, launch booking link | Yes, after approval |
| **1-1 call notes / check-in** `fRokTITH` | `WHTP4114295` (on) → 4114295 | **Make 06** `9209179` routes 1 and 2 | 10 / 34 | 26 (8 errors), shared | Route 1: GPT to-do comment, GPT grade to #client-call-feedback, Client Happiness + Last POC. Route 2: recap for approval | Yes, after approval |
| **Client Extension** `gqBcyK6g` | `WHTP4022911` (on) → 4022911 | `9000763` "Client Extension Given" (on) | 0 / 2 | 0 | Sheet "03.1: Extension Audit" row; #csm-announcements | No |
| | `WHTP4371922` (on) → 4371922 | `9805665` "Client Lifecycle - Client Extension Form submitted" (on) | | 0 | Next Payment Date += 7, 14 or 28 days; card comment | No |
| **Pause Request** `CTUjv6l3` | `WHTP4371898` (on) → 4371898 | `9805613` "Client Lifecycle - Pause Request Form submitted" (on) | 0 / 1 | 0 | Client Status Paused, Paused On, Resume On; card comment | No |
| **Contract Termination Survey** `knIe4eF3` | `WHTP4371873` (on) → 4371873 | `9805538` "Client Lifecycle - Contract Termination Survey submitted" (on) | 0 / 3 | 0 | Client Status Stopped, Churn Date, Churn Reason Cancelled, Churn Type mid-programme; comment; #csm-announcements | No |
| | `WHTP4007438` (on) → 4007438 | `8962418` "Cancellation Form to Sheet" (**off, `isinvalid` true**) | | 0 | Sheet "03: Cancellation Audit"; #csm-announcements; Media and Tech offboarding tasks | No |
| **NPS** `fuPgs85S` | `WHTP4007419` (on) → 4007419 | `8962328` "NPS Survey" (on) | 0 / 1 | 0 | #nps-survey-feedback only | No |
| **CSAT - Onboarding** `KbcbPA73` | `WHTP4007430` (on) → 4007430 | `8962387` "CSAT - Onboarding" (on) | 0 / 1 | 0 | #nps-survey-feedback only | No |
| Client Review `ETEynRgb` | `WHTP4096883` → 4096883 | `9169735` (on) | 0 / 4 | 0 | Churn Tracker sheet "04: Referrals, Upsells, Reviews"; card comment; #csm-announcements | No |
| Referral `bAmbMKM2` | `WHTP4105426` (on) → 4105426. `phoenix:1778072965455` (off) → 4105357 (no scenario) | `9188441` (on) | 0 / 8 | 0 | Same sheet; card comment; #csm-announcements | No |
| Backend upsell `cKItPZVI` | `WHTP4105956` → 4105956 | `9190294` (on) | 0 / 8 | 0 | Same sheet ("Backend Ascension"); comment; #csm-announcements | No |
| Website upsell `VP3zmaj2` | `WHTP4108828` → 4108828 | `9195843` (on) | 0 / 12 | 0 | Same sheet ("Website"); comment; #csm-announcements | No |
| SMM upsell `IVHO9BMC` | `WHTP4112950` → 4112950 | `9205789` (on) | 0 / 3 | 0 | Same sheet ("SMM"); comment; #csm-announcements | No |
| Lead List (reactivation) `uXtImBuZ` | `WHTP4077499` → 4077499 | `9122691` "Client Lead List" (on) | 0 / 1 | 0 | Sheet row; #csm-announcements; reactivation tasks in Operations/Tech and Media/Creative | No |
| Client Card Info `Uju17Z13` | `WHTP4030451` → 4030451 | `9018535` (on) | 0 / 1 | 0 | Sheet row; Slack **direct message** `D09SHBK5G8H` | No |
| Site Design Details `PjfTJypg` | `WHTP4149695` → 4149695 | `9282377` "Website Sell Form to ClickUp" (on) | 0 / 3 | 0 | Task in Web Development `901818343027` + brief comment | No |
| [SANDBOX] Internal Request `o0ULXQhD` | `WHTP4364124` (on) → 4364124 | `9783436` "[DRAFT] Typeform Internal Request -> ClickUp Production" (**off**) | 0 / 2 | 0 | One task in All Tasks `901816723226` with 13 custom fields | No |
| Reactivate your ads `ecJQ5Z5C` | no webhooks | — | 0 / 2 | — | Nothing downstream | — |
| Free Gift Survey `P1xP4r24` | no webhooks | — | 0 / 0 | — | — | — |
| Team Onboarding `Cef2QGBh` | `cockpit` (on, signed) → Supabase | not Make | | | Cockpit feature | — |
| `gBpJpsLi` (B2B opt-in) | `phoenix:1778071164307` (on) → 4105199 | `9165775` "Typeform to RAW LEADS" (**off**) | not counted | 0 | B2B sheet | — |

Sources:
- Typeform webhooks: `GET /forms/{id}/webhooks`, with hook IDs matched on the VPS.
- States: the scenario list.
- Runs: the logs.
- Responses: `GET /forms/{id}/responses` (counts only).

---

## 4. Scenario by scenario, in client-journey order

### 4.1 Make 10 "10. Closer Form to Onboarding (MAIN)" `8979157`

- **State:** on; folder 01 Client Ops; last edit 2026-10-21; 1 incomplete execution in the DLQ.
- **Runs (30 days):** 5, with 2 warnings (2 and 4 Oct). The log also shows 23 edits.
- **Trigger:** Typeform hook 4014052 on `BTzMwXiw`.

Order:
1. **[61]** Creates the client card in Clients - Mahara `901816559981`:
   name from the form, native status `in progress`, Email.
2. **[94]** Writes these card fields: Phone Number, Payment Plan, Sales
   Meeting Link, Daily Budget, Company Website, Closer, Sales Call
   Transcript, Closer Notes, Time Zone, Email, Country, Lead Source, Next
   Payment Amount and Billing, plus **Client Status = Needs Contacting**.
   On error it posts to Slack and resumes.
3. **[103] [104]** Writes Onboarding Map phase 2 and reads it back.
4. **Router [84]** with three routes. None of them has a filter, so all three run.

**Route 1**, in order:
- [31] creates the GHL sub-account (`POST /locations/`);
- [32] parses the reply;
- [115] code module that builds proof of the new account;
- [116] posts it to `portal.maharamedia.com/api/provision`;
- [110] writes GHL ID and Client Portal on the card;
- [39] WHAPI creates the WhatsApp group "Mahara | <client>";
- [35] Apps Script returns the Brand DNA, Offer and internal-doc links;
- [130]–[133] Sheets API: writes Service Mode = DFY on the client's "Client Data" row when found and blank;
- [113] runs the subscenario `9921407` (credential save);
- [107] [117] portal provision calls;
- [33] GHL invites the client as a user, only when [117] returns `enrolled`;
- [79] appends to the internal Google Doc;
- [122] WHAPI adds the client to the group;
- [105] waits 30–120 s;
- [40] WHAPI sends the Arabic welcome to the group;
- nested router [81]:
  - 1.1: wait, then [57] WHAPI sends a video;
  - 1.2: [45] card fields Drive Link, Offer Cheat Sheet, First Name, Last Name, Kickoff Form Link, Brand DNA, GHL ID, Client Portal and Sheet Link, plus Client Status = Needs Contacting; [59] [60] client tags in both spaces; [51] Make AI agent (gpt-5.2) writes the onboarding summary; [53] posts in **#new-clients** `C09MNHBAY1Y`; [87] puts the summary on the card as a comment.

**Route 2:**
- [48] GHL contact search by phone;
- [50] GHL contact Client ID fields = the card ID;
- [108] POST `{contact_id}` to Make hook **4347387** (scenario `9742600`, contract catch-up).

**Route 3:**
- [47] GHL createAContact "Create In CS Pipeline" (errors ignored).

Messages the client: yes (route 1). Never imitate a submission:
memory `new-client-form.md` says Make MAIN onboarding, HighLevel, Cortana
and B2B closed_deals all read it.

### 4.2 Make 13 "13. Client Onboarding Form" `8922994`

- **State:** on; last edit 2026-10-04.
- **Runs (30 days):** 5, no errors.
- **Trigger:** Typeform hook 3991048 on `KFRCXPFx`. It keys on hidden `onboarding_client_id`.

Router [44] has two routes and no filters.

**Route 1**, in order:
- [25] GitHub `repository_dispatch` with `event_type: market_intel` (the client name and the ClickUp ID), which queues market intel on the VPS;
- [41] [42] collect every question and answer;
- [29] card **Client Profile** (revenue, goals, marketing tried, challenges, why they joined, notes) and **Kickoff Form Link** (`tG7dnxBn` prefilled with the onboarding answers);
- [47] "Raw Onboarding Form Answers" comment;
- [31] "Client Data" sheet row (column C = card ID);
- [49] [50] Onboarding Map phase 3;
- [51] waits 30–120 s;
- [48] WHAPI phase 3 text to the group in column F. The filter "WhatsApp group exists" skips it when F is blank.

**Route 2:**
- [46] "<business> - Brand DNA 🧬🧬" task in Media/Creative `901818016338`, with one fixed assignee.

Downstream: `9808298` "Market Intel Verified -> Call Center Knowledge Base"
(5 runs) takes the verified result back and dispatches the knowledge-base
job on GitHub.

### 4.3 Make 12 "12. Kick Off Form Submitted" `8925654`

- **State:** on; created 2026-03-24, last edit 2026-09-17.
- **Runs (30 days):** 7, no errors, between 4 and 20 Oct. Typeform shows 7 completed responses for the same window.
- **Trigger:** Typeform hook 3992232 on `tG7dnxBn`.
- **No Slack module** (`usedPackages`: builtin, clickup, google-sheets, typeform, util, whapi-cloud).

Before the router:
1. **[11]** Comment on the client card: the "KICKOFF HANDOFF" text, about 8,300 characters.
2. **[20]** Native status of the client card → `IN PROGRESS`.

Router [14] has four routes. "TECH" and "CREATIVE" have empty filters, so every route runs:
- **Route 1 TECH:**
  - [17] "<client> - Technical Onboarding Check 🚀", Operations / Tech `901816723190`, template `t-86ex8x9xw`;
  - [18] the same handoff comment on that task.
- **Route 2:** [21] client card fields:
  - 🧬 Brand Blueprint Form Link `1b7a4a74` (the `oYZKtogO` link, prefilled);
  - **Client Status = Brand Blueprint Booked♠️** (`dbd21650`);
  - from the kickoff's answers through `switch()`: Mahara OS Access `924bba47`, Google Calendar Integration `a1520ef3`, Contract Status `ac976d4a`, Service Advertised `bab9a58b`, Meta Ad Account Access `bc7e70a2`, WhatsApp CRM Sync `cc14ad2d`, WhatsApp Group Status `d113cd99`, Templated Ads Status `e7d158a8` and Training Course Access `f0a20cef`.
- **Route 3 CREATIVE:**
  - [22] "<client> - Creative Onboarding 🚀", Media/Creative `901818016338`, template `t-86eyu1w3d`;
  - [23] the handoff comment.
- **Route 4:**
  - [26] [27] Onboarding Map phase 4;
  - [24] "Client Data" row;
  - [28] waits 30–120 s;
  - [25] WHAPI phase 4 text to the group (only if column F has a group).

A second submit for the same client repeats every step above: two more
tasks, a second comment and a second WhatsApp. Nothing in the blueprint
deduplicates.

### 4.4 Make 06 "06. Post Call Summary - Tasks, Notes, Client Summary" `9209179`

- **State:** on; created 2026-05-10, last edit 2026-09-06.
- **Runs (30 days):** 26, of which 8 errors (30 Sep 14:19 to 1 Oct 06:39). Each error used 4 ops. The failing module was not read.
- **Trigger:** Typeform hook 4114295. The kickoff `tG7dnxBn` (tag `postcallsummary`), the Blueprint `oYZKtogO` (tag `postcallsummary`) and the check-in `fRokTITH` (tag `WHTP4114295`) all deliver to it.

Order:
1. [16] reads the ClickUp task. Its ID is `ifempty(hidden.onboarding_client_id; typed Client ID c484f390)`.
2. [13] finds the "Client Data" row (column C).
3. Router [30]:
   - **Route 1**, filter `form_id = fRokTITH`:
     - [3] gpt-4.1 to-do list, posted by [17] as a card comment;
     - [4] gpt-4.1 call grade, posted by [15] in **#client-call-feedback** `C09SVG6FHGU`;
     - [21] card Client Happiness `4e3924e3` (from answer `ff7970f7`, mapped by label) and Last POC `e183f2ce` (submit time).
   - **Route 2**, filter `form_id ≠ oYZKtogO` OR `bb0019` exists:
     - [22] gpt-4.1 WhatsApp recap;
     - [23] data store 171744 "Pending Client Sends", keyed by response token, `status: pending`, with a booking link per form: kickoff → Blueprint calendar `x84ET6KnA8odlsjYiVLq`; check-in → `SHjlq0UjeR11maltYNyh`; Blueprint → launch `5E1EVxLJbGiDM3iYl2kL`;
     - [24] **#csm-general** `C09RZ0GS0V9` "Client summary pending approval — <client>" with the review links.
- Slack connection: 12932135 "Real Bot (maharamedia.slack.com - info)", the same for every Slack module listed in this map.

The check-in form's hidden field is `task_id`, not `onboarding_client_id`
(`SOURCES.md:32`). So for check-ins Make falls back to the typed Client ID.
This was not checked against the form definition here.

### 4.5 Make 07 "07. Send Approved Client Summary" `9523861` (and Make 08 / 09)

- `9523861`: on; 47 runs, 0 errors. Trigger: gateway hook 4258649, which reads `id`, `action` and `body`.
  - Any GET (`review`, `approve`, `edit`, `deny`) only renders the review page [4].
  - `action = send` with the record still `pending`:
    - [11] waits 30–120 s;
    - [5] WHAPI sends `body` to the stored group;
    - [6] marks the record `sent`;
    - a "Sent" page.
  - `send` on a record that is not pending → "Already handled" [8].
  - `nosend` → `denied` [9].
- `9572554` "08. Report Reminder - Request Approval": on; 35 runs. Hook 4279348, called by an Apps Script ("Report Gaps Found"). It saves to data store 173772 (no overwrite) and posts in **#csm-general**.
- `9572550` "09. Report Reminder - Approve / Edit / Deny": on; 91 runs. Hook 4279347. It works like Make 07: a WHAPI send to the client after approval.
- Data stores: 171744 holds 38 records and 173772 holds 111 (`GET /data-stores`).

### 4.6 Make 14 "14. Brand Blueprint Form Submitted" `9748311`

- **State:** on; created 2026-09-02, last edit 2026-09-17. 0 runs and 0 ops in 30 days.
- **Trigger:** gateway hook 4350422 "Brand Blueprint form", `maxResults 1`. The hook has no API-key check and no IP list (`/hooks` data: `apikey: []`, `ip: null`).
- Router [2] "Split: partial vs complete":
  - **PARTIAL**, filter `event_type = form_response_partial`:
    - [3] "<legal_name> - New Client Campaign Launch 🚀" in Marketing / ADs `901816723196`, template `t-86ex8xaf1`;
    - [4] "Brand Blueprint - media handoff" comment on that task.
  - **COMPLETE**, filter `event_type = form_response`:
    - [5] **#media-general** `C0AE8G5MT7Y` "Brand Blueprint completed";
    - [8] card **Can Self-Record?** `39839c9d` (from answers `bb0090` and `bb0200`) and **Onboarding Map** `51f49cb1` phase 5;
    - [9] reads the card back;
    - [6] "Client Data" row;
    - [10] waits 30–120 s;
    - [7] WHAPI phase 5 text, only if the group exists.
- Payload it reads (the Typeform webhook shape): `event_type`, `form_response.hidden.{onboarding_client_id, legal_name, service_focus, daily_budget}`, `form_response.answers` (by ref `bb0090-…-0001` `.label` and `bb0200-…-0001` `.label`).
- **Not on the complete route:** Client Status, a #csm-general post, and any card field beyond the two above. `docs/brand-blueprint/form-map.md` §5 lists what it leaves out.

### 4.7 Make 16 "16. ClickUp Launch Campaigns to Slack" `9356423`

- **State:** on.
- **Runs (30 days):** 17, with 1 error (27 Sep).
- **Trigger:** ClickUp `watchTasks` hook 4183352 on `taskCreated` in Ads Managment `901817774521`.

Order:
1. [2] reads the new task.
2. [5] lists the client's tasks on that list, by tag. It needs the task to carry a tag.
3. Router [4]:
   - **Repeat campaign:** Slack `C0AE4GKQKS7` (channel name not resolved).
   - **First campaign:**
     - Slack `C0AE4GKQKS7` and `C0ATR7Y6HQ9` (names not resolved);
     - [10]–[12] **Launch Date** `2e744484` and **Next Payment Date** `669ae046` on the client card, only when Next Payment Date is empty;
     - [13] **#new-clients** "Billing scheduled";
     - [24]–[28] Onboarding Map phase 6 + WhatsApp phase 6.

### 4.8 GoHighLevel → ClickUp

- `9744107` "998. Mahara - Booking -> Next POC": on; 43 runs.
  - Trigger: hook 4348087, from a GHL workflow. Reads `customData.clickup_task_id`, `calendar.{id, startTime, status, appoinmentStatus}` and `location.id`.
  - [2] **Next POC** `c48c1323` for any booking with a real ClickUp ID.
  - [6] [7] move **Client Status** forward only. This needs location `wwG426bwruWWv9W3fazQ`, a calendar that is onboarding `z1Ne59rohCCj87KhcXoi` (→ Onboarding Booked), Blueprint `x84ET6KnA8odlsjYiVLq` (→ Brand Blueprint Booked) or launch `5E1EVxLJbGiDM3iYl2kL` (→ LAUNCH BOOKED), and a status that is not cancel, noshow or invalid. It never sets Active, Ready For Launch, Paused, Stopped or Cancelled.
- `9742600` "14. Contract Signed to ClickUp": on; 11 runs.
  - Trigger: hook 4347387, which reads `contact_id`. Make 10 [108] calls it too.
  - Reads the GHL contact and its completed documents.
  - [5] card **Contract Link** `10b41484` and **Contract** = Signed (`37201e4c`).

### 4.9 Lifecycle forms (all built 2026-09-14, all 0 runs in 30 days)

Shared pattern of the three "Client Lifecycle" scenarios:
- They need hidden `onboarding_client_id` (and `client_name`) on the form link.
- [get] reads the task, and a filter requires a complete response with an ID.
- The edit runs only if the task is on Clients - Mahara `901816559981` and its ID matches.

| Scenario | Writes | Comment | Slack |
|---|---|---|---|
| `9805613` Pause `CTUjv6l3` | **Client Status = Paused** (index 1); **Paused On** `930c49eb` and **Resume On** `d3c46259` from date fields `1oSW8QjBPKYO` / `BD2jRLcwfSmL` (Asia/Kuwait). Both dates are required by the filter. | Reason, detail, dates, and the two acknowledgements (90-day term keeps running; over 14 days ends the engagement) | none |
| `9805665` Extension `gqBcyK6g` | **Next Payment Date** `669ae046` += 7, 14 or 28 days from choice `eCv7oxgUBGll` ("1 WEEK", "2 WEEKS", "4 WEEKS"), only if the card already has a Next Payment Date | CSM, the at-risk flag, the call recording, the duration and the previous date | none |
| `9805538` Termination `knIe4eF3` | **Client Status = Stopped** (index 11), **Churn Date** `42429a6e` = submit time, **Churn Reason = Cancelled** (index 0), **Churn Type = Mid-programme loss** (index 0) | Reasons, three 1–10 scores, recommend yes/no, final comments | **#csm-announcements** `C09SNG5BP53` |

The older siblings:
- `9000763` "14. Client Extension Given": on. Typeform hook 4022911 on the same extension form. It adds a row to Sheet "03.1: Extension Audit" (spreadsheet `1camKnn…`) and posts in **#csm-announcements**. It does not touch the card.
- `8962418` "13. Cancellation Form to Sheet": **off and invalid**. It would add a row to "03: Cancellation Audit", post in #csm-announcements, and run router [4]:
  - [7] "Client Offboarding (Media) 👋❌" task, Marketing / ADs `901816723196`, template `t-86ex629x6`;
  - [6] "Client Offboarding (Tech) 👋❌" task, Operations / Tech `901816723190`, template `t-86ex629ve`.

  The "Tech" filter has no conditions.
- `9686154` "10. Client Resume Due": on; daily, 30 runs. It reads every card and posts in **#media-general** `C0AE8G5MT7Y` when Client Status = Paused and Resume On is less than 3 days away.

No Make scenario writes these card fields: Pause Form Link `3a04c8a1`,
Extension Form Link `538b6c6a`, Termination Form Link `24a77b61`, Current
extension (weeks) `8cb9d308`, Fathom `abaa31ee`, Last Meeting Link
`a5ffe867`, Last Meeting Transcription `9d83e446`, Last Check-in Call
`032203ad`. A search of all 202 blueprints found no reference to them.

### 4.10 Client Success forms (folder 03)

All are on. None ran in 30 days, and Typeform shows no completed responses
in that window.
- `9169735` Review, `9188441` Referral, `9190294` Backend upsell, `9195843` Website upsell and `9205789` SMM upsell:
  - find the first empty row of "04: Referrals, Upsells, Reviews" in "Churn Tracker MaharaMedia 2026" (`1p8CAd…`) and fill it;
  - comment on the client task whose ID the form answer carries;
  - post in **#csm-announcements**.
- `9122691` Lead List: adds a Sheet row, posts in #csm-announcements, and creates two tasks from the templates "Client Reactivation Campaign📣" (Operations / Tech) and "Client Reactivation Campaign (Media)📣" (Media/Creative).
- `8962328` NPS and `8962387` CSAT: one Slack post each in **#nps-survey-feedback** `C09TTGBRQ0G`. Nothing else.
- `9018535` Client Card Info: adds a Sheet row and sends a Slack **direct message** to `D09SHBK5G8H`.
- `9282377` Website sell: a task in Web Development + a design-brief comment.

### 4.11 ClickUp automations that call Make (the ClickUp side of "tickets")

- `9799073` "WhatsApp Disconnected — ClickUp to Client Group": on; 4 runs.
  - Trigger: hook 4369814, from a ClickUp automation. The filter requires the `auto_id`/`trigger_id` pair and, for new reports, ClickUp form `2kzmr1ky-6778`.
  - It works on WhatsApp Reconnection `901821803697`: native status review required → in progress → pending or complete.
  - It calls the subscenario `9799793` (GoGHL reconnect link).
  - It sends the client group the reconnection notice by WHAPI and records the receipt on the task. Test task `86eywar0e` is never sent.
- `8866601` "04. ClickUp Payment Failure / Success": on; 7 runs, 2 errors.
  - Trigger: hook 3966612, which reads `KEY` (`ADS_BACK_LIVE` or `ADS_FAILED`) and `payload.id`.
  - Renames the task "<client> - Payment Failure".
  - WHAPI "ads back live" or "payment failed" text to the group, unless the client is on the exclusion lists. Then a comment.
- `8903351` "15. ClickUp Client Update": on; 0 runs. Trigger: hook 3982801 (`payload.id`). It comments on the client card found through the task's first tag in "Client Data", appends to the client's Google Doc, and posts in **#z-mahara** `C0AL6QP8HU4`.
- `9793648` "Mahara OS — private operations": on; 83 runs. Trigger: hook 4367947. The first filter compares `token` with a shared secret (not copied). It is the portal's gateway: router [2] has 15 routes with modules (numbered 2 to 16 here). The ones that touch forms and tickets:
  - **route 15, "Client portal tasks — staged":** list, read and status-update tasks, and create one in Client Portal Tasks `1100530000000279`. Create needs one client tag from a fixed list, a type option, an assignee ID from a fixed list, a due date and a request ID.
  - routes 9–12: ClickUp Docs hub read and write on fixed pages;
  - routes 13 and 16: WhatsApp connect;
  - routes 6 and 7: Maqsam call history and recordings (read-only);
  - routes 3 and 4: Drive backup;
  - route 2: Slack alert to `C0C13SF9HJA`.

### 4.12 Ticketing scenarios that are off

- `8063994` "Universal Ticket Assignment" (off, hook 3585085): one Monday item and update per department route (MEDIA & ADS, CLIENT SUCCESS, CALL CENTER, PROJECT MANAGEMENT, OPERATIONS, TECH & GHL, Video Editing), each with the client's Monday item looked up.
- `8064859` "SOP-Specific Ticketing System To PM Tool" (off, hook 3585486): one Slack route per request type to #content-strategy, #general-channel or #creative-requests, then a Monday "Assign To Tech" item. The types: New Client Campaign, Client Paused, Client Offboard Request, Increase Ad Spend, Additional Location, Change Deposit Amount, Transition to Card on File, Change Company Name, Change Address and New Creatives.
- `8065434` "QA Forms Submitted - Slack and Monday" (off): #qa-thread plus Monday.
- `9783436` "[DRAFT] Typeform Internal Request -> ClickUp Production" (off): one ClickUp task in All Tasks `901816723226`. It maps the name, tags, content, due date and priority, plus 13 custom fields, from `o0ULXQhD`. It has no assignment logic and no Slack.

### 4.13 Legacy hooks still switched on (folder 08)

The hook names point to GoHighLevel forms and workflows. All are on.

| Scenario | Hook | Runs 30 d | Does |
|---|---|---|---|
| `8069472` "05. Notify CSM When Client Responds" | 3587613 | ≥600 (paging stopped at 600; 4,110 in the ops counter) | Slack **#csm-client-notis** `C09TCNBP4L9` by `Client Stage` (Onboarding, Live, Lost) |
| `8204498` "01. Maqsam Poll (ORPHAN - no output)" | scheduled | ≥1,300 (paging hit a network error) | One HTTP call per run, no output |
| `7908153` "02. Kick Off Submitted (OLD - Monday)" | 3514231 | 0 | Monday items. **Its payload fields include `Card Number`, `CVV` and `Expiration Date`** |
| `8069605` "06. Add Client Card Info to PM Tool (OLD - Monday)" | 3587681 | 0 | Monday item + Slack #failed-payments-and-disputes. **It reads `Card Number`, `Security Code` and `Expiration Date`** |
| `8069181` "03. Client Extension Given (OLD)" | 3587385 | 0 | "03.1: Extension Audit" + #csm-announcements |
| `8068892` "07. NPS and CSAT to Slack + Sheet (OLD)" | 3587165 | 0 | #nps-survey-feedback |
| `7227121` "04. Update Client Stats Sheet On Status Change" | 2959516 | 0 | Appointment-outcome sheets + two Slack channels |
| `8075671` "08. Human Handover (WhatsApp)" | 3590453 | 0 | WHAPI to a group from the fulfilment sheet |
| `8214721` "09. HotProspector Transcript - Alessandro" | 3656044 | 0 | Maqsam call → GPT → sheet + #call-feedback |

---

## 5. ClickUp client card fields: who writes what

Card list: Clients - Mahara `901816559981` (space `901810155402`). The
field names come from `clickup_get_custom_fields`. Only active writers are
listed; the inactive `8910150` also wrote Drive Link, Kickoff Form Link and
Sheet Link.

| Field | Written by |
|---|---|
| Client Status `9368ca9e` | Make 10 (Needs Contacting), Make 12 (Brand Blueprint Booked), `9744107` (Onboarding Booked, Brand Blueprint Booked, LAUNCH BOOKED, forward only), `9805613` (Paused), `9805538` (Stopped) |
| Onboarding Map `51f49cb1` | Make 10 (phase 2), Make 13 (3), Make 12 (4), Make 14 (5), Make 16 (6) |
| Next Payment Date `669ae046` | Make 16 (first launch), `9585358` "Confirm Charge" (+1 month), `9805665` (extension) |
| Launch Date `2e744484` | Make 16 |
| Can Self-Record? `39839c9d` | Make 14 |
| Brand Blueprint Form Link `1b7a4a74`, Mahara OS Access, Google Calendar Integration, Contract Status, Service Advertised, Meta Ad Account Access, WhatsApp CRM Sync, WhatsApp Group Status, Templated Ads Status, Training Course Access | Make 12 |
| Client Profile `7755485f` | Make 13 |
| Kickoff Form Link `87d7d889` | Make 10 (plain) and Make 13 (prefilled with the onboarding answers) |
| Client Happiness `4e3924e3`, Last POC `e183f2ce` | Make 06 route 1 (check-in only) |
| Next POC `c48c1323` | `9744107` |
| Contract Link `10b41484`, Contract `91e9e408` | `9742600` |
| Paused On `930c49eb`, Resume On `d3c46259` | `9805613` |
| Churn Date, Churn Reason, Churn Type | `9805538` |
| Brand DNA, Offer Cheat Sheet, Drive Link, Sheet Link, GHL ID, Client Portal, First/Last Name, Phone, Email, Payment Plan, Daily Budget, Next Payment Amount, Billing, Closer, Closer Notes, Sales Meeting Link, Sales Call Transcript, Time Zone, Country, Lead Source, Company Website | Make 10 |
| Native task status | Make 12 → `IN PROGRESS`; Make 10 creates the card at `in progress` |

Other ClickUp lists Make writes:
- Operations / Tech `901816723190`: Technical Onboarding (Make 12), reactivation (`9122691`), offboarding (`8962418`, off).
- Media/Creative `901818016338`: Creative Onboarding (Make 12), Brand DNA (Make 13), reactivation media.
- Marketing / ADs `901816723196`: launch task (Make 14 PARTIAL), media offboarding (`8962418`, off).
- Web Development `901818343027`.
- All Tasks `901816723226` (draft).
- WhatsApp Reconnection `901821803697`.
- Client Portal Tasks `1100530000000279`.

---

## 6. Slack channels Make posts to (forms and lifecycle)

Names come from the blueprints' restore labels. `C09RZ0GS0V9` and
`C0AE8G5MT7Y` were confirmed with `slack_search_channels`.

| Channel | Posted by (active) |
|---|---|
| **#csm-general** `C09RZ0GS0V9` | Make 06 (client summary approval), `9572554` (report reminder approval), `9585358` (charge recorded); `9585364` Charge Due (off) |
| #csm-announcements `C09SNG5BP53` | `9805538` termination, `9000763` and `8069181` extension, review, referral, three upsells, lead list, `8257112` CSM EOD send |
| #media-general `C0AE8G5MT7Y` | Make 14 complete, `9686154` resume due |
| #new-clients `C09MNHBAY1Y` | Make 10, Make 16 billing scheduled |
| #client-call-feedback `C09SVG6FHGU` | Make 06 route 1 (call grade) |
| #nps-survey-feedback `C09TTGBRQ0G` | NPS, CSAT, legacy `8068892` |
| #csm-client-notis `C09TCNBP4L9` | `8069472` |
| #z-mahara `C0AL6QP8HU4` | `8903351` |
| `C0AE4GKQKS7`, `C0ATR7Y6HQ9` | Make 16 launch posts (names not resolved) |
| DM `D09SHBK5G8H` | `9018535` Client Card Info |

Every one of these uses Make connection 12932135 "Real Bot", which posts as
"Admin Bot". It is already in #csm-general: the Slack search shows Make 06
and Make 08 posts there between 15 and 22 Oct.

---

## 7. Custom webhooks the cockpit could call

Every hook below is a Make gateway hook. The cockpit would need its URL as
a server secret, never in a browser. **None of these hooks checks an API key
or an IP list** (`/hooks` data: `apikey: []`, `ip: null`). The only check is
`9793648`'s token filter.

| Hook | Scenario | Payload the scenario reads | What a cockpit call would do | Notes |
|---|---|---|---|---|
| **4350422** "Brand Blueprint form" | Make 14 `9748311` | Typeform shape: `event_type`, `form_response.hidden.{onboarding_client_id, legal_name, service_focus, daily_budget}`, `form_response.answers[]` with `field.ref` `bb0090-0000-4000-8000-000000000001` and `bb0200-0000-4000-8000-000000000001` (`.label`) | `event_type = form_response` runs the complete route: #media-general post, Can Self-Record? + Onboarding Map phase 5, phase 5 WhatsApp. `form_response_partial` creates a launch task (no dedupe) | The cockpit's `{source, key, event}` body matches no route today, and a run would do nothing. `PLAN.md` §2.3 "COCKPIT CLOSE" was never built. |
| 4258649 "Client Send Approval" | Make 07 | `id` (data store key), `action` (review, approve, edit, deny, send, nosend), `body` | `send` + a pending record → WHAPI to the client | This is how a cockpit approval screen could replace the Slack links |
| 4279347 / 4279348 | Make 09 / 08 | 08: `recordKey, to, body, clientName, sheetUrl, totalGaps, showGapCount, closeGapCount`. 09: `id, action, body` | Report reminder draft and send | 08 is fed by an Apps Script today |
| 4348087 | `9744107` | GHL appointment shape: `customData.clickup_task_id`, `calendar.{id, startTime, status, appoinmentStatus}`, `location.id` | Next POC + forward-only Client Status | GHL calls it |
| 4347387 | `9742600` | `contact_id` | Contract Link + Contract Signed | Make 10 [108] already calls it |
| 4284519 "Billing - Charge Confirmed" | `9585358` | `confirm, task, next, client, amount, nextlabel` | `confirm = yes` → Next Payment Date = `next`, then a #csm-general post | A link clicked by a person |
| 3966612 / 3982801 / 4369814 | `8866601` / `8903351` / `9799073` | ClickUp automation shape: `payload.id` (+ `KEY`; + `auto_id`, `trigger_id`, `payload.ownership.*`) | Payment-failure WhatsApp; client update; reconnection WhatsApp | They expect ClickUp's automation body |
| 4367947 | `9793648` | `token, action, taskId, page, data, filename, …` | The portal's gateway (ClickUp portal tasks, docs hub, WhatsApp connect) | The portal already calls it |

The Typeform-module hooks (3992232 kickoff, 4114295 post-call, 4022911,
4371922, 4371898, 4371873, 4007419, …) are `typeform` hooks, not gateway
hooks. A cockpit could POST a Typeform-shaped body to them, but that was not
tested and is not advised. A real Typeform submit stays the way to fire
them.

No hook stores a data structure: `udt` is null on every gateway hook. Of
the trigger modules checked, only `8866601` and `8903351` carry an
`interface`, and it lists just `body` (plus `KEY`). The payloads above are
what each scenario's modules and filters reference.

---

## 8. Flags

### 8.1 Dead or inactive

- **Inactive scenarios that a live form still delivers to:**
  - `8962418` (termination, invalid; Typeform `WHTP4007438` is on);
  - `9169732` (New Client Form; `WHTP4096881` is on, 5 deliveries queued);
  - `9783436` (internal request draft; `WHTP4364124` is on).
- **Active scenarios whose source is gone or idle:**
  - folder 08: `7908153`, `8068892`, `8069181`, `8069605`, `7227121`, `8075671`, `8214721` (0 runs; GHL forms of the Monday era);
  - `8204498`: runs every few minutes and outputs nothing (its own name says ORPHAN).
- **Forms with no Make path:** `ecJQ5Z5C` (Reactivate your ads), `P1xP4r24` (Free Gift Survey). The old kickoff `BbJy6xg4` has both webhooks off.
- **Active with 0 runs in 30 days:**
  - Make 14;
  - all lifecycle scenarios (`9805538`, `9805613`, `9805665`, `9000763`);
  - NPS, CSAT, review, referral, the three upsells, lead list, card info, website sell;
  - `8903351`, `9585358`.

### 8.2 Scenarios that message clients (WHAPI or GHL)

Make 10 (group creation, welcome text, video, GHL user invite) · Make 13
phase 3 · Make 12 phase 4 · Make 14 phase 5 · Make 16 phase 6 · Make 07
(after approval) · Make 09 (after approval) · `8866601` (ads back live or
payment failed) · `9799073` (reconnection link) · `9837737` (dialer
handover) · `8075671` (legacy) · `8824596`, `9610459`, `8550397` (call
centre side, not read in detail). Every WHAPI text in the scenarios read here waits a
random 30–120 s first, except the dialer handover `9837737`.

### 8.3 What would fire twice if the cockpit also did the work

| Cockpit work | Make that already does it | Double-fire risk |
|---|---|---|
| Embedded kickoff `tG7dnxBn` (`docs/csm-forms/KICKOFF.md`) | Make 12 + Make 06 run on every submit | If the cockpit also writes the card, creates tasks or sends phase 4: a second comment, a second set of tasks and a second WhatsApp. A **#csm-general "kickoff done" post** from the cockpit duplicates nothing in Make 12, but sits beside Make 06's approval post in the same channel. |
| Native Blueprint (`cockpit_blueprints`, close `card_only`) | Make 14 complete route, if anyone opens the old `oYZKtogO` link that Make 12 still writes to every card | Can Self-Record? and Onboarding Map phase 5 would be written twice. The cockpit hands the CSM the phase 5 text to paste, and Make sends phase 5 itself, so **the client could get two phase 5 messages**. The cockpit's `blueprintLaunch` task and Make 14 PARTIAL (only if partials were ever subscribed) use the same template `t-86ex8xaf1`. |
| A Blueprint "complete" Slack in #csm-general | Make 14 posts in #media-general | Two posts in two channels, not a duplicate. Moving Make 14's post is a Make edit. |
| Native extension form | `9805665` (Next Payment Date) and `9000763` (Sheet + Slack) | If both the cockpit and a Typeform submit move Next Payment Date, the date moves twice (+14 becomes +28). |
| Native pause | `9805613` (status + dates), `9686154` (resume reminder) | Status written twice (harmless); the resume reminder reads the same fields. The media buyer cockpit's "Pause & offboard" does not set Client Status (`docs/media-launch/PAUSE-OFFBOARD.md:18-19`). |
| Native termination or churn (`cockpit_churn_*`) | `9805538` (Stopped, churn fields, #csm-announcements) | Churn fields and Slack twice. Turning `8962418` back on would also double the offboarding tasks that `PAUSE-OFFBOARD.md` creates. |
| Native check-in / call notes form | Make 06 route 1 (Happiness, Last POC, to-do comment, grade) + route 2 (recap draft) | Two to-do comments, two grades, two approval drafts. Make 07's `pending` guard stops a second send of the same record only. |
| Native New Client Form | Make 10 + HighLevel + Cortana + the `9169732` queue | Two GHL sub-accounts and two WhatsApp groups. Never imitate a submission (memory `new-client-form.md`). |
| Native NPS/CSAT | `8962328` / `8962387` Slack | Two Slack posts |
| Cockpit tickets | `9793648` route 15 (Client Portal Tasks), `9799073`, `8866601` | Different lists. A cockpit ticket on All Tasks `901816723226` overlaps only with the off draft `9783436`. |

### 8.4 Privacy and security

- `7908153` and `8069605` are switched on and their modules map card-number,
  CVV and expiry fields. A caller that still holds those hook URLs could push
  card data into Monday and Slack. Turning both off is a Make change and was
  not made.
- `9018535` sends payment information from `Uju17Z13` to a person's Slack
  direct message and a Google Sheet.
- Most gateway hooks accept any POST: no API key and no IP list.
- `9793648` keeps its shared token in a filter inside the blueprint, so
  anyone with read access to the blueprint can read it.
- Typeform webhooks to Make carry no `secret` (`secret? False` on every Make
  tag). Only Cortana and the cockpit's Supabase webhook are signed.

---

## 9. Not verified

- **Make 06's 26 runs against 17 completed responses.** I did not open the
  execution details, so neither the failing module of the 8 errors nor the
  source of the extra runs is known.
- **What fills the 5 queued deliveries on hook 4096881** (`9169732`, off).
  The queue was not read.
- **`9610459`, `9327580` and `6806400`.** Their blueprints returned network
  errors twice, so their modules are not mapped. Their run counts came from
  the logs.
- **`8069472` and `8204498` run counts are floors.** Paging stopped at 600
  and at a network error.
- **The Slack names of `C0AE4GKQKS7`, `C0ATR7Y6HQ9`, `C0ASL3ED7K9` and
  `C0C13SF9HJA`.** They are entered by hand in Make, and the channel search
  did not return them.
- **Whether the lifecycle forms (`CTUjv6l3`, `gqBcyK6g`, `knIe4eF3`) carry
  the hidden `onboarding_client_id` and `client_name` that the scenarios
  need.** The form definitions belong to the Typeform map.
- **Whether HighLevel's `live_integration_ai` and Cortana's webhooks on
  `BTzMwXiw` still do anything.** They are outside Make.
- **The ClickUp automations that call hooks 3966612, 3982801 and 4369814.**
  Their trigger lists and forms beyond what the filters name
  (`2kzmr1ky-6778`) were not read in ClickUp.
- **The `operations` counter on the scenario list.** Make does not state its
  period, so the logs were used instead.

---

## Appendix A: all 202 scenarios

"Runs 30 d" counts `EXECUTION_END` rows since 2026-09-25 ~10:30 UTC.
"partial" means paging stopped at a network error, so the count is a floor.
A trigger module of `?` means the blueprint could not be read.

| id | name | folder | state | trigger module | schedule | last edit | ops counter | runs 30 d | errors | warnings | last run | note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 5851635 | Integration Call Center Mastery | (none) | off | `app#call-center-mastery-qeqot5:watchOutboundMessages` | immediately | 2025-06-19 | 0 | 0 | 0 | 0 | - |  |
| 5877843 | MHM - New Lead Alert V2 | (none) | off | `app#call-center-mastery-qeqot5:watchEventsManualPlacement` | immediately | 2025-07-08 | 0 | 0 | 0 | 0 | - |  |
| 5878428 | MHM - SMS Alert V2 | (none) | off | `app#call-center-mastery-qeqot5:watchEventsManualPlacement` | immediately | 2025-06-20 | 0 | 0 | 0 | 0 | - |  |
| 5878546 | MHM - Missed Call Alert V2 | (none) | off | `http:ActionSendDataBasicAuth` | indefinitely | 2025-07-13 | 0 | 0 | 0 | 0 | - |  |
| 5878630 | MHM - Call Back Request Alert V2 | (none) | off | `app#call-center-mastery-qeqot5:watchEventsManualPlacement` | immediately | 2025-11-07 | 0 | 0 | 0 | 0 | - |  |
| 5878793 | CCM - Appointment Confirmation Alert V2 | (none) | off | `app#call-center-mastery-qeqot5:watchEventsManualPlacement` | immediately | 2025-06-20 | 0 | 0 | 0 | 0 | - |  |
| 5879024 | CCM - AI Note Taker | (none) | off | `app#call-center-mastery-qeqot5:watchOutboundMessages` | immediately | 2025-06-20 | 0 | 0 | 0 | 0 | - |  |
| 5886524 | TEMPLATE - PD Scheduler V2 | (none) | off | `gateway:CustomWebHook` | immediately | 2025-06-21 | 0 | 0 | 0 | 0 | - |  |
| 5891130 | MaharaMedia Onboarding | (none) | off | `typeform:WatchResponses` | indefinitely | 2025-07-14 | 0 | 0 | 0 | 0 | - |  |
| 5898865 | MHM - New Lead Tracker | (none) | off | `app#call-center-mastery-qeqot5:watchEventsManualPlacement` | immediately | 2025-07-08 | 0 | 0 | 0 | 0 | - |  |
| 5899004 | MHM - Appt Tracker | (none) | off | `app#call-center-mastery-qeqot5:watchEventsManualPlacement` | immediately | 2025-06-22 | 0 | 0 | 0 | 0 | - |  |
| 5899288 | MHM - Agent Form Submission -> Update Google Sheet [Template V | (none) | off | `app#call-center-mastery-qeqot5:watchEventsManualPlacement` | immediately | 2025-11-07 | 0 | 0 | 0 | 0 | - |  |
| 5899434 | MHM - Speed To Lead - New Lead Tracker | (none) | off | `app#call-center-mastery-qeqot5:watchEventsManualPlacement` | immediately | 2025-06-22 | 0 | 0 | 0 | 0 | - |  |
| 5901124 | MHM - All Dials [Template V2] | (none) | off | `app#call-center-mastery-qeqot5:watchEventsManualPlacement` | immediately | 2025-06-22 | 0 | 0 | 0 | 0 | - |  |
| 5901702 | MHM - Recording URL + AI Summary [Template V2] | (none) | off | `app#call-center-mastery-qeqot5:watchOutboundMessages` | immediately | 2025-06-22 | 0 | 0 | 0 | 0 | - |  |
| 5901739 | MHM - Show Tracker | (none) | off | `app#call-center-mastery-qeqot5:watchEventsManualPlacement` | immediately | 2025-06-22 | 0 | 0 | 0 | 0 | - |  |
| 5901787 | MHM - No Show Tracker | (none) | off | `app#call-center-mastery-qeqot5:watchEventsManualPlacement` | immediately | 2025-06-22 | 0 | 0 | 0 | 0 | - |  |
| 5901950 | MHM - Closed Tracker | (none) | off | `app#call-center-mastery-qeqot5:watchEventsManualPlacement` | immediately | 2025-06-22 | 0 | 0 | 0 | 0 | - |  |
| 5901995 | MHM - Lost Tracker | (none) | off | `app#call-center-mastery-qeqot5:watchEventsManualPlacement` | immediately | 2025-06-22 | 0 | 0 | 0 | 0 | - |  |
| 5902108 | Appointment Setter Feedback | (none) | on | `airtable:webhook` | immediately | 2025-11-08 | 0 | 0 | 0 | 0 | - |  |
| 5902131 | Bayt 22 Facebook Insights | (none) | off | `facebook-insights:GetAdAccountInsights` | indefinitely | 2025-07-16 | 0 | 0 | 0 | 0 | - |  |
| 5902264 | MHM - Daily Summary Project Stats [Template V2] | (none) | off | `google-sheets:filterRows` | daily | 2025-06-22 | 0 | 0 | 0 | 0 | - |  |
| 5904023 | MHM - Daily Summary Agent Stats [Template V2] | (none) | off | `google-sheets:filterRows` | daily | 2025-06-22 | 0 | 0 | 0 | 0 | - |  |
| 5904486 | MHM - Reporting Alert Template | (none) | off | `google-sheets:filterRows` | indefinitely | 2025-06-22 | 0 | 0 | 0 | 0 | - |  |
| 5906737 | CCM - Daily Summary Agent Stats [Template V2] | (none) | off | `google-sheets:filterRows` | indefinitely | 2025-06-22 | 0 | 0 | 0 | 0 | - |  |
| 5911240 | Maqsam contact creation | (none) | off | `gateway:CustomWebHook` | immediately | 2025-07-19 | 0 | 0 | 0 | 0 | - |  |
| 5925328 | Integration HTTP | (none) | off | `http:ActionSendDataBasicAuth` | indefinitely | 2025-06-23 | 0 | 0 | 0 | 0 | - |  |
| 6241156 | MHM - All Dials [Template V2] (Maqsam) | (none) | off | `gateway:CustomWebHook` | immediately | 2026-02-28 | 0 | 0 | 0 | 0 | - |  |
| 6241940 | MHM - All Dials [Template V2] (Maqsam) (recording+phone start) | (none) | off | `http:ActionSendDataBasicAuth` | indefinitely | 2025-07-12 | 0 | 0 | 0 | 0 | - |  |
| 6242294 | MHM - Recording URL [Template V2] (maqsam) | (none) | off | `app#call-center-mastery-qeqot5:watchOutboundMessages` | immediately | 2025-07-12 | 0 | 0 | 0 | 0 | - |  |
| 6246468 | Integration HTTP | (none) | off | `http:ActionSendDataBasicAuth` | indefinitely | 2025-07-12 | 0 | 0 | 0 | 0 | - |  |
| 6667662 | 1.4 (1) Client Appointment Booked Notification & Update Fulfil | (none) | off | `gateway:CustomWebHook` | immediately | 2026-02-28 | 0 | 0 | 0 | 0 | - |  |
| 6669761 | 1.5 (1) Client Appointment Cancelled Notification | (none) | off | `gateway:CustomWebHook` | immediately | 2026-02-18 | 0 | 0 | 0 | 0 | - |  |
| 6670336 | 1.6 (1) Client Appointment No Showed - Update Status On Result | (none) | off | `gateway:CustomWebHook` | immediately | 2026-01-15 | 0 | 0 | 0 | 0 | - |  |
| 6670456 | 1.7 (1) Client Rescheduled Appointment Notification | (none) | off | `gateway:CustomWebHook` | immediately | 2026-01-05 | 0 | 0 | 0 | 0 | - |  |
| 6670508 | 4.1 (1) Add Lead To Client Stats Sheet | (none) | off | `gateway:CustomWebHook` | immediately | 2025-11-25 | 0 | 0 | 0 | 0 | - |  |
| 6705360 | Integration Google Sheets | (none) | off | `google-sheets:filterRows` | indefinitely | 2025-08-10 | 0 | 0 | 0 | 0 | - |  |
| 6705493 | Integration Google Sheets | (none) | off | `google-sheets:filterRows` | indefinitely | 2025-08-10 | 0 | 0 | 0 | 0 | - |  |
| 7227207 | 11. Lead is Disqualified - Update DQ Reason | (none) | off | `gateway:CustomWebHook` | immediately | 2025-09-15 | 0 | 0 | 0 | 0 | - |  |
| 7227258 | 7.4 (1) Client Lead Responds With Buzzword - Make Task For Con | (none) | off | `gateway:CustomWebHook` | immediately | 2025-09-15 | 0 | 0 | 0 | 0 | - |  |
| 7392504 | Integration Webhooks | (none) | off | `gateway:CustomWebHook` | immediately | 2025-10-05 | 0 | 0 | 0 | 0 | - |  |
| 7478747 | 1.9 Phone Consultation Booked | (none) | off | `gateway:CustomWebHook` | immediately | 2025-10-03 | 0 | 0 | 0 | 0 | - |  |
| 7478793 | 1.9 (2) Phone Consultation Reminder | (none) | off | `gateway:CustomWebHook` | immediately | 2025-10-03 | 0 | 0 | 0 | 0 | - |  |
| 7615960 | 1.4 (4) - Send Client Post Appointment Survey | (none) | off | `gateway:CustomWebHook` | immediately | 2026-03-12 | 0 | 0 | 0 | 0 | - |  |
| 7648903 | 1.8 Appointment Showed Review Request | (none) | off | `gateway:CustomWebHook` | immediately | 2025-12-03 | 0 | 0 | 0 | 0 | - |  |
| 7787013 | L&S - New Client Scenario | (none) | off | `gateway:CustomWebHook` | immediately | 2025-11-01 | 0 | 0 | 0 | 0 | - |  |
| 7853901 | MHM - New Client Scenario | (none) | off | `gateway:CustomWebHook` | immediately | 2026-03-08 | 0 | 0 | 0 | 0 | - |  |
| 7860714 | L&S - Onboarding Form Completed | (none) | off | `gateway:CustomWebHook` | immediately | 2026-03-03 | 0 | 0 | 0 | 0 | - |  |
| 7991151 | Integration Slack | (none) | off | `slack:CreateMessage` | weekly | 2025-11-07 | 0 | 0 | 0 | 0 | - |  |
| 7991583 | Notify "Ring-The-Bell" When CSR Books Appointment | (none) | off | `gateway:CustomWebHook` | immediately | 2025-11-07 | 0 | 0 | 0 | 0 | - |  |
| 8063994 | Universal Ticket Assignment | (none) | off | `gateway:CustomWebHook` | immediately | 2025-11-14 | 0 | 0 | 0 | 0 | - |  |
| 8064859 | SOP-Specific Ticketing System To PM Tool | (none) | off | `gateway:CustomWebHook` | immediately | 2026-02-24 | 0 | 0 | 0 | 0 | - |  |
| 8065434 | QA Forms Submitted - Slack and Monday | (none) | off | `gateway:CustomWebHook` | immediately | 2026-03-30 | 0 | 0 | 0 | 0 | - |  |
| 8068428 | 3.1 Cancellation Form Submission Into G-Sheet | (none) | off | `gateway:CustomWebHook` | immediately | 2025-11-14 | 0 | 0 | 0 | 0 | - |  |
| 8069387 | 4.4 Post Call Summary Form Submitted Assign Tasks + Add Notes  | (none) | off | `gateway:CustomWebHook` | immediately | 2025-11-30 | 0 | 0 | 0 | 0 | - |  |
| 8204515 | 4.3 (1) Pull Call Data From HotProspector Into Fulfilment Shee | (none) | off | `gateway:CustomWebHook` | immediately | 2026-02-28 | 0 | 0 | 0 | 0 | - |  |
| 8346770 | 7.3 Lead DQ'ed | (none) | off | `gateway:CustomWebHook` | immediately | 2026-01-27 | 0 | 0 | 0 | 0 | - |  |
| 8358087 | Integration Google Sheets | (none) | off | `google-sheets:addRow` | indefinitely | 2025-12-23 | 0 | 0 | 0 | 0 | - |  |
| 8414653 | 2.1 Post Booking Text | (none) | off | `gateway:CustomWebHook` | immediately | 2026-01-19 | 0 | 0 | 0 | 0 | - |  |
| 8426995 | Integration HTTP (legacy) | (none) | off | `placeholder:Placeholder` | indefinitely | 2026-01-07 | 0 | 0 | 0 | 0 | - |  |
| 8433713 | Integration HTTP (legacy) | (none) | off | `placeholder:Placeholder` | indefinitely | 2026-01-08 | 0 | 0 | 0 | 0 | - |  |
| 8769344 | onboarding to launch ID | (none) | off | `monday:watchBoardItemsV2` | immediately | 2026-03-01 | 0 | 0 | 0 | 0 | - |  |
| 8861029 | Integration Webhooks | (none) | off | `whapi-cloud:sendMedia` | indefinitely | 2026-05-25 | 0 | 0 | 0 | 0 | - |  |
| 8987196 | Integration Typeform, Make AI Agents, Slack | (none) | off | `typeform:ListResponses` | indefinitely | 2026-04-02 | 0 | 0 | 0 | 0 | - |  |
| 9787716 | Mahara OS — reporting connection | (none) | off | `gateway:CustomWebHook` | immediately | 2026-09-13 | 0 | 0 | 0 | 0 | - |  |
| 9793648 | Mahara OS — private operations | (none) | on | `gateway:CustomWebHook` | immediately | 2026-10-24 | 295 | 83 | 0 | 0 | 2026-10-25 |  |
| 9794035 | Mahara OS — verified reporting writes | (none) | on | `scenario-service:StartSubscenario` | on-demand | 2026-09-11 | 0 | 0 | 0 | 0 | - |  |
| 9797734 | Mahara OS — reporting feedback gateway | (none) | on | `gateway:CustomWebHook` | immediately | 2026-09-13 | 631 | 343 | 0 | 0 | 2026-10-22 |  |
| 9797746 | Mahara OS — call connection check | (none) | off | `scenario-service:StartSubscenario` | on-demand | 2026-09-12 | 0 | 0 | 0 | 0 | - |  |
| 9797773 | Mahara OS — creative connection check | (none) | off | `scenario-service:StartSubscenario` | on-demand | 2026-09-12 | 0 | 0 | 0 | 0 | - |  |
| 9805538 | Client Lifecycle - Contract Termination Survey submitted | (none) | on | `typeform:WatchEventsWithResponses` | immediately | 2026-09-14 | 0 | 0 | 0 | 0 | - |  |
| 9805613 | Client Lifecycle - Pause Request Form submitted | (none) | on | `typeform:WatchEventsWithResponses` | immediately | 2026-09-14 | 0 | 0 | 0 | 0 | - |  |
| 9805665 | Client Lifecycle - Client Extension Form submitted | (none) | on | `typeform:WatchEventsWithResponses` | immediately | 2026-09-14 | 0 | 0 | 0 | 0 | - |  |
| 9806268 | Mahara OS — City Wood booking read-only check | (none) | off | `scenario-service:StartSubscenario` | on-demand | 2026-09-14 | 0 | 0 | 0 | 0 | - |  |
| 9837737 | Mahara Dialer - Agent Client Handover | (none) | on | `gateway:CustomWebHook` | immediately | 2026-09-20 | 135 | 27 | 0 | 0 | 2026-10-25 |  |
| 9913995 | API shell: HighLevel Company 12097364 (read-only) | (none) | off | `scenario-service:StartSubscenario` | on-demand | 2026-10-04 | 1 | 1 | 0 | 0 | 2026-10-04 |  |
| 9914039 | Mahara portal — location credential capability check | (none) | off | `scenario-service:StartSubscenario` | on-demand | 2026-10-04 | 4 | 4 | 4 | 0 | 2026-10-04 |  |
| 9918466 | API shell: HighLevel Company 13222332 (read-only) | (none) | off | `scenario-service:StartSubscenario` | on-demand | 2026-10-05 | 1 | 1 | 0 | 0 | 2026-10-05 |  |
| 9918473 | Mahara credential provisioning — Company 13222332 capability c | (none) | off | `scenario-service:StartSubscenario` | on-demand | 2026-10-05 | 1 | 1 | 1 | 0 | 2026-10-05 |  |
| 9918613 | Mahara new-client access — registry preflight (read-only) | (none) | off | `scenario-service:StartSubscenario` | on-demand | 2026-10-05 | 9 | 5 | 4 | 0 | 2026-10-05 |  |
| 9918631 | API shell: Database Mahara status cell (read-only) | (none) | off | `scenario-service:StartSubscenario` | on-demand | 2026-10-05 | 1 | 0 | 0 | 0 | - | partial |
| 9918879 | Mahara automatic onboarding — agency connection acceptance | (none) | off | `scenario-service:StartSubscenario` | on-demand | 2026-10-05 | 15 | 5 | 0 | 0 | 2026-10-05 |  |
| 9920961 | Mahara automatic onboarding — private state bootstrap (inactiv | (none) | off | `scenario-service:StartSubscenario` | on-demand | 2026-10-05 | 2 | 1 | 0 | 0 | 2026-10-05 |  |
| 9921005 | Mahara automatic onboarding — credential save and renewal | (none) | off | `scenario-service:StartSubscenario` | on-demand | 2026-10-05 | 91 | 26 | 1 | 0 | 2026-10-05 |  |
| 9921034 | Mahara automatic onboarding — five-minute recovery and renewal | (none) | off | `code:ExecuteCode` | indefinitely | 2026-10-11 | 6837 | 448 | 0 | 134 | 2026-10-11 | partial |
| 9921112 | Mahara credential source — private read-only acceptance | (none) | off | `scenario-service:StartSubscenario` | on-demand | 2026-10-05 | 15 | 3 | 0 | 0 | 2026-10-05 |  |
| 9921407 | Mahara automatic onboarding — verified rotation candidate | (none) | on | `scenario-service:StartSubscenario` | on-demand | 2026-10-05 | 3647 | 950 | 0 | 0 | 2026-10-17 | partial |
| 9940904 | Hiring migration - read-only field verification | (none) | off | `scenario-service:StartSubscenario` | on-demand | 2026-10-08 | 1 | 1 | 0 | 0 | 2026-10-08 |  |
| 9948679 | Manual Alalia welcome delivery (temporary) | (none) | off | `scenario-service:StartSubscenario` | on-demand | 2026-10-10 | 12 | 12 | 2 | 0 | 2026-10-10 |  |
| 9953627 | Mahara onboarding: client keys (simple) | (none) | on | `google-sheets:makeAPICall` | indefinitely | 2026-10-11 | 8220 | ≥2000 | 0 | 0 | 2026-10-25 |  |
| 8824430 | 01. Contact Created to Sheets | 01 Client Ops | on | `gateway:CustomWebHook` | immediately | 2026-06-16 | 2778 | 932 | 29 | 0 | 2026-10-25 |  |
| 8824596 | 02. Appointments to Sheets | 01 Client Ops | on | `gateway:CustomWebHook` | immediately | 2026-10-22 | 1555 | 191 | 3 | 0 | 2026-10-25 |  |
| 8842433 | 05. Sheets Status to GHL | 01 Client Ops | on | `gateway:CustomWebHook` | immediately | 2026-08-27 | 1000 | 250 | 0 | 0 | 2026-10-22 |  |
| 8842754 | 04. Missed Maqsam Calls | 01 Client Ops | off | `http:MakeRequest` | indefinitely | 2026-04-16 | 0 | 0 | 0 | 0 | - |  |
| 8850419 | 03. Agent Notifications | 01 Client Ops | on | `gateway:CustomWebHook` | immediately | 2026-10-23 | 1348 | 617 | 0 | 0 | 2026-10-25 |  |
| 8903351 | 15. ClickUp Client Update | 01 Client Ops | on | `gateway:CustomWebHook` | immediately | 2026-05-03 | 0 | 0 | 0 | 0 | - |  |
| 8910150 | 11. Closer Form to Onboarding (OLD - inactive) | 01 Client Ops | off | `gateway:CustomWebHook` | immediately | 2026-04-01 | 0 | 0 | 0 | 0 | - |  |
| 8922994 | 13. Client Onboarding Form | 01 Client Ops | on | `typeform:WatchEventsWithResponses` | immediately | 2026-10-04 | 60 | 5 | 0 | 0 | 2026-10-18 |  |
| 8925654 | 12. Kick Off Form Submitted | 01 Client Ops | on | `typeform:WatchEventsWithResponses` | immediately | 2026-09-17 | 91 | 7 | 0 | 0 | 2026-10-20 |  |
| 8979157 | 10. Closer Form to Onboarding (MAIN) | 01 Client Ops | on | `typeform:WatchEventsWithResponses` | immediately | 2026-10-21 | 159 | 5 | 0 | 2 | 2026-10-17 |  |
| 9018535 | 17. Client Card Info | 01 Client Ops | on | `typeform:WatchEventsWithResponses` | immediately | 2026-04-08 | 0 | 0 | 0 | 0 | - |  |
| 9156022 | 06. Speed To Lead Tracker | 01 Client Ops | on | `gateway:CustomWebHook` | immediately | 2026-05-20 | 1080 | 360 | 0 | 0 | 2026-10-25 |  |
| 9282377 | 18. Website Sell Form to ClickUp | 01 Client Ops | on | `typeform:WatchEventsWithResponses` | immediately | 2026-05-24 | 0 | 0 | 0 | 0 | - |  |
| 9356423 | 16. ClickUp Launch Campaigns to Slack | 01 Client Ops | on | `clickup:watchTasks` | immediately | 2026-10-04 | 119 | 17 | 1 | 0 | 2026-10-24 |  |
| 9519898 | 08. OCI - Booked Call | 01 Client Ops | on | `gateway:CustomWebHook` | immediately | 2026-07-13 | 0 | 0 | 0 | 0 | - |  |
| 9610459 | 07. DWY - New Leads | 01 Client Ops | on | `?` | immediately | 2026-10-17 | 103 | 35 | 0 | 0 | 2026-10-25 |  |
| 9742600 | 14. Contract Signed to ClickUp | 01 Client Ops | on | `gateway:CustomWebHook` | immediately | 2026-09-01 | 49 | 11 | 0 | 0 | 2026-10-18 |  |
| 9744107 | 998. Mahara - Booking -> Next POC | 01 Client Ops | on | `gateway:CustomWebHook` | immediately | 2026-10-06 | 83 | 43 | 0 | 0 | 2026-10-22 |  |
| 9748311 | 14. Brand Blueprint Form Submitted | 01 Client Ops | on | `gateway:CustomWebHook` | immediately | 2026-09-17 | 0 | 0 | 0 | 0 | - |  |
| 9783436 | [DRAFT] Typeform Internal Request -> ClickUp Production | 01 Client Ops | off | `typeform:WatchEventsWithResponses` | immediately | 2026-09-10 | 0 | 0 | 0 | 0 | - |  |
| 9799073 | WhatsApp Disconnected — ClickUp to Client Group | 01 Client Ops | on | `gateway:CustomWebHook` | immediately | 2026-09-13 | 4 | 4 | 0 | 0 | 2026-10-25 |  |
| 9799187 | GoGHL Browser — Login Setup | 01 Client Ops | on | `scenario-service:StartSubscenario` | on-demand | 2026-10-05 | 0 | 0 | 0 | 0 | - |  |
| 9799793 | GoGHL — Resolve Reconnection Link | 01 Client Ops | on | `scenario-service:StartSubscenario` | on-demand | 2026-09-24 | 60 | 20 | 0 | 0 | 2026-10-21 |  |
| 9802067 | Mahara OS — Mergestudio identity check | 01 Client Ops | off | `scenario-service:StartSubscenario` | on-demand | 2026-09-13 | 0 | 0 | 0 | 0 | - |  |
| 9808298 | 15. Market Intel Verified -> Call Center Knowledge Base | 01 Client Ops | on | `gateway:CustomWebHook` | immediately | 2026-09-14 | 10 | 5 | 0 | 0 | 2026-10-18 |  |
| 9843272 | Mahara GoGHL — temporary profile sign-in 2026-09-21 | 01 Client Ops | off | `scenario-service:StartSubscenario` | on-demand | 2026-10-10 | 10 | 7 | 0 | 0 | 2026-10-10 |  |
| 9843854 | Mahara GoGHL — temporary task diagnostics 2026-09-21 | 01 Client Ops | off | `scenario-service:StartSubscenario` | on-demand | 2026-10-21 | 9 | 9 | 0 | 0 | 2026-10-21 |  |
| 9925656 | Mahara calendar onboarding — non-writing acceptance 2026-10-06 | 01 Client Ops | off | `scenario-service:StartSubscenario` | on-demand | 2026-10-06 | 3 | 1 | 0 | 0 | 2026-10-06 |  |
| 6806316 | 02. New Lead to Slack | 02 Call Center | on | `gateway:CustomWebHook` | immediately | 2026-09-13 | 1444 | 364 | 0 | 0 | 2026-10-25 |  |
| 6806343 | 03. New Message to Slack | 02 Call Center | off | `gateway:CustomWebHook` | immediately | 2026-01-19 | 0 | 0 | 0 | 0 | - |  |
| 6806367 | 05. Follow Up With Lead | 02 Call Center | off | `gateway:CustomWebHook` | immediately | 2025-10-29 | 0 | 0 | 0 | 0 | - |  |
| 6806400 | 06. Appointment Confirmation Task (12h Before) | 02 Call Center | off | `?` | immediately | 2025-11-29 | 0 | 0 | 0 | 0 | - |  |
| 7888401 | 04. Missed Call to Slack | 02 Call Center | on | `gateway:CustomWebHook` | immediately | 2026-04-13 | 0 | 0 | 0 | 0 | - |  |
| 8242349 | 01. Maqsam - Create Contact | 02 Call Center | on | `gateway:CustomWebHook` | immediately | 2026-01-26 | 0 | 0 | 0 | 0 | - |  |
| 8550397 | 07. PIDCO - New Lead to WhatsApp | 02 Call Center | on | `gateway:CustomWebHook` | immediately | 2026-09-13 | 0 | 0 | 0 | 0 | - |  |
| 8962328 | 12. NPS Survey | 03 Client Success | on | `typeform:WatchEventsWithResponses` | immediately | 2026-03-30 | 0 | 0 | 0 | 0 | - |  |
| 8962387 | 11. CSAT - Onboarding | 03 Client Success | on | `typeform:WatchEventsWithResponses` | immediately | 2026-03-30 | 0 | 0 | 0 | 0 | - |  |
| 8962418 | 13. Cancellation Form to Sheet | 03 Client Success | off | `typeform:WatchEventsWithResponses` | immediately | 2026-04-07 | 0 | 0 | 0 | 0 | - |  |
| 9000763 | 14. Client Extension Given | 03 Client Success | on | `typeform:WatchEventsWithResponses` | immediately | 2026-04-05 | 0 | 0 | 0 | 0 | - |  |
| 9122691 | 15. Client Lead List | 03 Client Success | on | `typeform:WatchEventsWithResponses` | immediately | 2026-05-10 | 0 | 0 | 0 | 0 | - |  |
| 9169735 | 01. Client Review to ClickUp, Sheets, Slack | 03 Client Success | on | `typeform:WatchEventsWithResponses` | immediately | 2026-05-10 | 0 | 0 | 0 | 0 | - |  |
| 9188441 | 02. Client Referral to ClickUp, Sheets, Slack | 03 Client Success | on | `typeform:WatchEventsWithResponses` | immediately | 2026-05-06 | 0 | 0 | 0 | 0 | - |  |
| 9190294 | 03. Backend Program Upsell to ClickUp, Sheets, Slack | 03 Client Success | on | `typeform:WatchEventsWithResponses` | immediately | 2026-05-11 | 0 | 0 | 0 | 0 | - |  |
| 9195843 | 04. Website Upsell to ClickUp, Sheets, Slack | 03 Client Success | on | `typeform:WatchEventsWithResponses` | immediately | 2026-06-29 | 0 | 0 | 0 | 0 | - |  |
| 9205789 | 05. Social Media Management Upsell to ClickUp, Sheets, Slack | 03 Client Success | on | `typeform:WatchEventsWithResponses` | immediately | 2026-05-11 | 0 | 0 | 0 | 0 | - |  |
| 9209179 | 06. Post Call Summary - Tasks, Notes, Client Summary | 03 Client Success | on | `typeform:WatchEventsWithResponses` | immediately | 2026-09-06 | 195 | 26 | 8 | 0 | 2026-10-21 |  |
| 9523861 | 07. Send Approved Client Summary | 03 Client Success | on | `gateway:CustomWebHook` | immediately | 2026-09-13 | 198 | 47 | 0 | 0 | 2026-10-21 |  |
| 9572550 | 09. Report Reminder - Approve / Edit / Deny | 03 Client Success | on | `gateway:CustomWebHook` | immediately | 2026-09-13 | 428 | 91 | 0 | 0 | 2026-10-22 |  |
| 9572554 | 08. Report Reminder - Request Approval | 03 Client Success | on | `gateway:CustomWebHook` | immediately | 2026-07-30 | 105 | 35 | 0 | 0 | 2026-10-22 |  |
| 9686154 | 10. Client Resume Due | 03 Client Success | on | `clickup:getListTasks` | daily | 2026-08-20 | 30 | 30 | 0 | 0 | 2026-10-25 |  |
| 6843173 | 14. New Lead B2B Ads to Slack (OLD) | 04 B2B Sales | off | `gateway:CustomWebHook` | immediately | 2025-08-19 | 0 | 0 | 0 | 0 | - |  |
| 6843317 | 15. New Lead SMS Hot to Slack (OLD) | 04 B2B Sales | off | `gateway:CustomWebHook` | immediately | 2025-08-19 | 0 | 0 | 0 | 0 | - |  |
| 6843389 | 16. New Lead SMS Warm to Slack (OLD) | 04 B2B Sales | off | `gateway:CustomWebHook` | immediately | 2025-08-19 | 0 | 0 | 0 | 0 | - |  |
| 6843509 | 17. New Appointment Booked to Slack (OLD) | 04 B2B Sales | off | `gateway:CustomWebHook` | immediately | 2025-08-19 | 0 | 0 | 0 | 0 | - |  |
| 8207750 | 12. Quote Sent Survey | 04 B2B Sales | off | `gateway:CustomWebHook` | immediately | 2025-12-03 | 0 | 0 | 0 | 0 | - |  |
| 8208977 | 13. Proposal Survey Submitted | 04 B2B Sales | off | `gateway:CustomWebHook` | immediately | 2026-01-08 | 0 | 0 | 0 | 0 | - |  |
| 8214980 | 11. Intro to Demo Feedback + Notes | 04 B2B Sales | off | `gateway:CustomWebHook` | immediately | 2026-02-24 | 0 | 0 | 0 | 0 | - |  |
| 8737454 | 02. B2B Tracker - Lead Data (2-Call) | 04 B2B Sales | off | `gateway:CustomWebHook` | immediately | 2026-05-02 | 0 | 0 | 0 | 0 | - |  |
| 8737730 | 03. B2B Tracker - Intro Call Booked | 04 B2B Sales | off | `gateway:CustomWebHook` | immediately | 2026-05-13 | 0 | 0 | 0 | 0 | - |  |
| 8737804 | 04. B2B Tracker - Post Intro Call | 04 B2B Sales | off | `gateway:CustomWebHook` | immediately | 2026-05-02 | 0 | 0 | 0 | 0 | - |  |
| 8737868 | 05. B2B Tracker - Post Intro No Shows and Cancels | 04 B2B Sales | off | `gateway:CustomWebHook` | immediately | 2026-05-12 | 0 | 0 | 0 | 0 | - |  |
| 8737901 | 06. B2B Tracker - Demo Call Booked | 04 B2B Sales | off | `gateway:CustomWebHook` | immediately | 2026-05-12 | 0 | 0 | 0 | 0 | - |  |
| 8737938 | 07. B2B Tracker - Post Demo Call | 04 B2B Sales | off | `gateway:CustomWebHook` | immediately | 2026-05-02 | 0 | 0 | 0 | 0 | - |  |
| 8737976 | 08. B2B Tracker - Post Demo No Shows and Cancels | 04 B2B Sales | off | `gateway:CustomWebHook` | immediately | 2026-05-12 | 0 | 0 | 0 | 0 | - |  |
| 9165775 | 01. Typeform to RAW LEADS | 04 B2B Sales | off | `gateway:CustomWebHook` | immediately | 2026-05-07 | 0 | 0 | 0 | 0 | - |  |
| 9169732 | 09. Closed to RAW LEADS | 04 B2B Sales | off | `typeform:WatchEventsWithResponses` | immediately | 2026-05-14 | 0 | 0 | 0 | 0 | - |  |
| 9212961 | 10. DQ to B2B Sheet | 04 B2B Sales | off | `gateway:CustomWebHook` | immediately | 2026-05-11 | 0 | 0 | 0 | 0 | - |  |
| 8069550 | 05. Payment Overdue - Notify Internal + External | 05 Billing | off | `gateway:CustomWebHook` | immediately | 2026-07-01 | 0 | 0 | 0 | 0 | - |  |
| 8866601 | 04. ClickUp Payment Failure / Success | 05 Billing | on | `gateway:CustomWebHook` | immediately | 2026-10-17 | 47 | 7 | 2 | 0 | 2026-10-15 |  |
| 9534283 | 03. Whop Payments to Slack | 05 Billing | on | `gateway:CustomWebHook` | immediately | 2026-07-16 | 24 | 8 | 0 | 0 | 2026-10-17 |  |
| 9585358 | 02. Confirm Charge | 05 Billing | on | `gateway:CustomWebHook` | immediately | 2026-07-28 | 0 | 0 | 0 | 0 | - |  |
| 9585364 | 01. Charge Due | 05 Billing | off | `clickup:getListTasks` | daily | 2026-07-28 | 0 | 0 | 0 | 0 | - |  |
| 7990012 | 91. (OLD) EOD Report Submission to Slack | 06 EOD | off | `gateway:CustomWebHook` | immediately | 2026-03-19 | 0 | 0 | 0 | 0 | - |  |
| 7990934 | 03. Send - CSR | 06 EOD | on | `slack:CreateMessage` | weekly | 2026-06-02 | 25 | 25 | 0 | 0 | 2026-10-24 |  |
| 8257099 | 90. (OLD) Client Success - Form Submissions | 06 EOD | off | `gateway:CustomWebHook` | immediately | 2025-12-08 | 0 | 0 | 0 | 0 | - |  |
| 8257112 | 02. Send - CSM | 06 EOD | on | `slack:CreateMessage` | weekly | 2026-06-02 | 25 | 25 | 0 | 0 | 2026-10-24 |  |
| 8434657 | 04. Send - Executive Assistant | 06 EOD | off | `slack:CreateMessage` | weekly | 2026-06-02 | 8 | 8 | 1 | 0 | 2026-10-04 |  |
| 8434674 | 92. (OLD) Executive Assistant - Form Submissions | 06 EOD | off | `gateway:CustomWebHook` | immediately | 2026-02-27 | 0 | 0 | 0 | 0 | - |  |
| 8698165 | 94. (OLD) Sales Rep / Setter - Form Submissions | 06 EOD | off | `gateway:CustomWebHook` | immediately | 2026-02-21 | 0 | 0 | 0 | 0 | - |  |
| 8698193 | 01. Send - Closer / Setter | 06 EOD | on | `slack:CreateMessage` | weekly | 2026-06-02 | 50 | 25 | 0 | 0 | 2026-10-24 |  |
| 8962845 | 05. Send - Media Team | 06 EOD | on | `slack:CreateMessage` | weekly | 2026-07-09 | 25 | 25 | 0 | 0 | 2026-10-24 |  |
| 8962865 | 93. (OLD) Media Buyer - Form Submissions | 06 EOD | off | `gateway:CustomWebHook` | immediately | 2026-03-30 | 0 | 0 | 0 | 0 | - |  |
| 9042441 | 06. Send - Tech | 06 EOD | on | `slack:CreateMessage` | weekly | 2026-06-02 | 25 | 25 | 0 | 0 | 2026-10-24 |  |
| 9042448 | 95. (OLD) Systems Manager - Form Submissions | 06 EOD | off | `gateway:CustomWebHook` | immediately | 2026-05-03 | 0 | 0 | 0 | 0 | - |  |
| 9327485 | 17. Receive - Setter | 06 EOD | on | `typeform:WatchEventsWithResponses` | immediately | 2026-08-05 | 0 | 0 | 0 | 0 | - |  |
| 9327508 | 18. Receive - Systems Manager | 06 EOD | on | `typeform:WatchEventsWithResponses` | immediately | 2026-08-05 | 45 | 15 | 0 | 0 | 2026-10-24 |  |
| 9327573 | 11. Receive - Account Manager | 06 EOD | on | `typeform:WatchEventsWithResponses` | immediately | 2026-10-10 | 24 | 8 | 0 | 0 | 2026-10-24 |  |
| 9327577 | 15. Receive - Media Buyer | 06 EOD | on | `typeform:WatchEventsWithResponses` | immediately | 2026-08-05 | 3 | 1 | 0 | 0 | 2026-09-30 |  |
| 9327580 | 14. Receive - Executive Assistant | 06 EOD | on | `?` | immediately | 2026-08-05 | 0 | 0 | 0 | 0 | - |  |
| 9327583 | 12. Receive - Client Sales Rep | 06 EOD | on | `typeform:WatchEventsWithResponses` | immediately | 2026-08-05 | 78 | 26 | 0 | 0 | 2026-10-24 |  |
| 9327584 | 16. Receive - Sales Rep | 06 EOD | on | `typeform:WatchEventsWithResponses` | immediately | 2026-08-05 | 0 | 0 | 0 | 0 | - |  |
| 9502731 | 13. Receive - Creative Director | 06 EOD | on | `typeform:WatchEventsWithResponses` | immediately | 2026-08-05 | 12 | 4 | 0 | 0 | 2026-10-20 |  |
| 9502736 | 19. Receive - Video Editors | 06 EOD | on | `typeform:WatchEventsWithResponses` | immediately | 2026-10-10 | 36 | 12 | 0 | 0 | 2026-10-24 |  |
| 5906357 | 05. Hiring - Interview Email Sent | 07 Team | off | `gateway:CustomWebHook` | immediately | 2025-06-22 | 0 | 0 | 0 | 0 | - |  |
| 5906747 | 06. Hiring - Rejection Email | 07 Team | off | `gateway:CustomWebHook` | immediately | 2025-06-22 | 0 | 0 | 0 | 0 | - |  |
| 5921188 | 04. Hiring - Application Emails | 07 Team | off | `gateway:CustomWebHook` | immediately | 2025-06-23 | 0 | 0 | 0 | 0 | - |  |
| 7989315 | 01. Daily Fact to Slack | 07 Team | off | `openai-gpt-3:CreateCompletion` | weekly | 2026-01-31 | 0 | 0 | 0 | 0 | - |  |
| 7989844 | 03. Hubstaff Time Summary to Slack | 07 Team | off | `hubstaff:listProjects` | indefinitely | 2026-03-24 | 0 | 0 | 0 | 0 | - |  |
| 8232835 | 02. Anonymous Survey (Internal) | 07 Team | on | `gateway:CustomWebHook` | immediately | 2025-12-04 | 3 | 1 | 0 | 0 | 2026-10-07 |  |
| 8801184 | 07. CSR Onboarding (L&S) | 07 Team | off | `gateway:CustomWebHook` | indefinitely | 2026-03-05 | 0 | 0 | 0 | 0 | - |  |
| 8926624 | 09. AI Sheet Agent (Aziz) | 07 Team | off | `slack:WatchGroupMessages` | indefinitely | 2026-03-24 | 0 | 0 | 0 | 0 | - |  |
| 9126248 | 08. AI Reporter | 07 Team | on | `gateway:CustomWebHook` | immediately | 2026-04-27 | 0 | 0 | 0 | 0 | - |  |
| 9704530 | 10. Client Panel - Weekly Check | 07 Team | off | `supabase:makeAnApiCall` | weekly | 2026-08-24 | 0 | 0 | 0 | 0 | - |  |
| 7227121 | 04. Update Client Stats Sheet On Status Change | 08 Legacy live | on | `gateway:CustomWebHook` | immediately | 2026-03-30 | 0 | 0 | 0 | 0 | - |  |
| 7908153 | 02. Kick Off Submitted (OLD - Monday) | 08 Legacy live | on | `gateway:CustomWebHook` | immediately | 2026-01-23 | 0 | 0 | 0 | 0 | - |  |
| 8068892 | 07. NPS and CSAT to Slack + Sheet (OLD) | 08 Legacy live | on | `gateway:CustomWebHook` | immediately | 2025-11-14 | 0 | 0 | 0 | 0 | - |  |
| 8069181 | 03. Client Extension Given (OLD) | 08 Legacy live | on | `gateway:CustomWebHook` | immediately | 2025-11-14 | 0 | 0 | 0 | 0 | - |  |
| 8069472 | 05. Notify CSM When Client Responds | 08 Legacy live | on | `gateway:CustomWebHook` | immediately | 2025-11-14 | 4110 | ≥600 | 0 | 0 | 2026-10-25 |  |
| 8069605 | 06. Add Client Card Info to PM Tool (OLD - Monday) | 08 Legacy live | on | `gateway:CustomWebHook` | immediately | 2025-11-14 | 0 | 0 | 0 | 0 | - |  |
| 8075671 | 08. Human Handover (WhatsApp) | 08 Legacy live | on | `gateway:CustomWebHook` | immediately | 2026-09-13 | 0 | 0 | 0 | 0 | - |  |
| 8204498 | 01. Maqsam Poll (ORPHAN - no output) | 08 Legacy live | on | `http:ActionSendDataBasicAuth` | indefinitely | 2025-12-01 | 2880 | 1300 | 0 | 0 | 2026-10-25 | partial |
| 8214721 | 09. HotProspector Transcript - Alessandro | 08 Legacy live | on | `gateway:CustomWebHook` | immediately | 2025-12-02 | 0 | 0 | 0 | 0 | - |  |

---

## Follow-up 2026-10-25

Scope: Make 06 `9209179` runs and partial responses, the parity record a
native 1-1 call notes form needs, and the Make 12 `8925654` module count.
Everything was read with GET calls only (Make API, Typeform API, ClickUp and
Slack read tools). Nothing was run, replayed, edited, submitted or posted.
Answer values, transcripts and WhatsApp text were parsed on the VPS and are
not copied here. Times are UTC. A Make log `timestamp` is the run's **start**
(the 1 Oct Slack post landed 28 s after the logged start of a 28 s run).

Scenario short numbers collide across the maps, so this section uses IDs.
In a blueprint, router routes are an array, so the two Make 06 routes are
index 0 and index 1. The other maps call them 1 and 2 (or 0 and 1). This
section names them by their filter names: **"only the check-in call has a
transcript to grade"** (index 0) and **"not a mid-call partial"** (index 1).

### F.1 Short answers

1. **Partials on the old Blueprint link still fire `9748311`'s partial route
   today.** The `blueprint` webhook lists `form_response` only, but Typeform
   still delivered partials to it on 13 and 17 Sep. Nothing has changed on
   the form, the webhook or the scenario since then.
2. **`fRokTITH` partials never reach `9209179`, because the form has never
   had a partial response.** It has no partial submit point. The risk is
   latent: the form already sends partials to integrations, and both Make 06
   routes would accept one.
3. **All 8 errors are one check-in response.** The CSM submitted it on 30 Sep
   at 14:19:42 (Marble and More, card `86eymcqdq`). Module [3] "GPT: Internal
   To-Do List" failed on the original run and on 7 automatic Make reruns, with
   OpenAI `RateLimitError` "[429] You have no credits remaining". It was not a
   mistyped Client ID: [16] and [13] succeeded on all 26 runs. It was not a
   partial either.
4. **That one response then ran to the end twice**, on 1 Oct 08:59 and 2 Oct
   06:39. It left two to-do comments on the card, two different grades in
   #client-call-feedback (5.6/10 and 4.6/10) and two approval posts in
   #csm-general. Its one data store record stayed `pending`. No other
   response in the window ran twice, and none of the window's runs came from
   a partial.
5. **The 26 runs reconcile with the 17 completed responses.** 7 kickoffs ran
   once each. 9 check-ins ran once each. The 30 Sep check-in ran 10 times.
6. **`9209179` [21] reads the Defcon answer's label and writes the option
   id.** The six labels and ids match the ClickUp field exactly. Both earlier
   maps were half right.
7. **`8925654` has 14 modules, the router included.** 13 of them cost an
   operation, and all 13 ran on each of the 7 runs.

### F.2 Partial delivery (question 1)

**Webhooks** (`GET /forms/{id}/webhooks`, 2026-10-25). Every item has only these
keys: `id, form_id, tag, enabled, event_types, created_at, updated_at,
verify_ssl` (plus `url`, not printed). No webhook carries a `secret`.

| Form | Tag | Enabled | `event_types` (every key returned) | Created | Updated | verify_ssl | Secret | Host |
|---|---|---|---|---|---|---|---|---|
| `oYZKtogO` | `blueprint` | true | `{"form_response": true}` | 2026-09-02 15:13:36 | same | true | no | hook.eu2.make.com |
| `oYZKtogO` | `postcallsummary` | true | `{"form_response": true}` | 2026-09-02 16:46:45 | same | true | no | hook.eu2.make.com |
| `fRokTITH` | `WHTP4114295` | true | `{"form_response": true}` | 2026-05-10 14:18:28 | same | true | no | hook.eu2.make.com |
| `tG7dnxBn` | `WHTP3992232` | true | `{"form_response": true}` | 2026-08-31 15:32:28 | same | true | no | hook.eu2.make.com |
| `tG7dnxBn` | `postcallsummary` | true | `{"form_response": true}` | 2026-09-01 18:50:00 | same | true | no | hook.eu2.make.com |

The API returns no `form_response_partial` key at all, so it is neither true
nor false here. No webhook has been updated since it was created.

**Form settings** (`GET /forms/{id}`) and response counts (`GET
/forms/{id}/responses?response_type=…`, `total_items`, all time):

| Form | `partial_responses_to_all_integrations` | `milestones` (partial submit points) | `autosave_progress` | `last_updated_at` | Completed / partial / started |
|---|---|---|---|---|---|
| `oYZKtogO` | **true** | `[{"field_ref": "bb0018-0000-4000-8000-000000000001", "status": "active"}]` | true | 2026-09-17 13:03:56 | 1 / **6** / 12 |
| `fRokTITH` | **true** | none (`null`) | true | 2026-10-13 11:27:29 | 34 / **0** / 9 |
| `tG7dnxBn` | false | none (`null`) | false | 2026-10-23 17:08:52 | 8 / 0 / 23 |

Notes on the settings:
- `autosave_progress` saves progress in the respondent's browser. It does
  not create partial responses ("true to enable saving partial form
  responses on the client side", typeform.com/developers/create/reference/create-form/).
- The API has no key for "Capture partial responses after every question".
  So that setting could not be read. With 0 partials ever on `fRokTITH`
  against 9 started responses, it is off in effect.
- All 9 `fRokTITH` started responses have 0 answers. Seven of them landed
  on 30 Sep between 14:18:06 and 14:19:21, just before the 14:19:42 submit.

What Typeform's documentation says:
- Webhooks: `event_types` is "An object with the event types to which this
  webhook is subscribed", with `form_response` and `form_response_partial` as
  the two events (typeform.com/developers/webhooks/reference/create-or-update-webhook/).
- Help Center "Collect partial responses" (updated 2026-10-20, read through
  the Help Center API because the page returns 403 to fetchers;
  help.typeform.com/hc/en-us/articles/21102221958676):
  - partials come from a Partial Submit Point;
  - "Under Preferences, toggle on Send partial responses to integrations";
  - a webhook can take "Completed and Partial responses";
  - "each Partial Submit Point passed can trigger a webhook".
- Help Center "Capture partial responses after every question" (updated
  2026-10-19; help.typeform.com/hc/en-us/articles/50681134074132):
  - the alternative to submit points, on Growth or Enterprise plans;
  - the partial is saved after about 7 minutes of inactivity;
  - it is then "sent to connected integrations, … automations, and webhooks".
- Community report: partials reached integrations, webhooks included, while
  the user said the partial toggle was off. Support called it "not a bug"
  (community.typeform.com, thread 17764).

What actually reached Make (ClickUp `get_task`, Typeform responses):

| Launch task (Marketing / ADs `901816723196`) | Created | The Typeform response | What it proves |
|---|---|---|---|
| `86eywc0xy` "ARDON - New Client Campaign Launch 🚀" | 2026-09-13 07:46:21 | Landed 07:45:10. Completed 07:58:23, so the API lists it as completed. | A partial event went out 71 s after landing and 12 min before the completion. |
| `z8xmdvdza1` "Merge studio - New Client Campaign Launch 🚀" | 2026-09-17 10:14:07 | Landed 10:13:35. Still partial. | A partial event went out 32 s after landing. |

Only `9748311` module [3] creates tasks with this name. It sits behind the
filter `{{1.event_type}} = form_response_partial` (F.4.2). Both webhooks list
`form_response` only, and neither has been updated since 2026-09-02. So
Typeform sent `event_type: form_response_partial` payloads to a webhook that
does not list that event. The form-level partial setting with an active
submit point is what sends them. `event_types` did not stop them.
Milestone partials go out within about a minute. The 7-minute delay applies
only to "capture after every question".

**Conclusion (a): a partial on the old Blueprint link fires `9748311`'s
partial route today.**
- **Why:** the form settings are unchanged since 2026-09-17 13:03, the
  milestone is active and the webhook is enabled. `9748311` is active. Its
  current route filter still matches `form_response_partial`, and its last
  edit (2026-09-17 15:47:18) came after both tasks.
- **What it would do:** anyone who opens the old link and passes question
  `bb0018` would get a new "<legal_name> - New Client Campaign Launch 🚀"
  task with the media handoff comment. There is no deduplication. A native
  Blueprint that also creates the launch task would make a second one.
- **Why the link is still live:** `8925654` [21] still writes it to every
  card (`blueprint-path.md` §2.5).
- **What Make 06 does with it:** the same partial also goes to
  `postcallsummary`, and so to `9209179`. Both routes skip it, because the
  form id is not `fRokTITH` and `bb0019` comes after the submit point. Make
  06 spends 3 operations and makes nothing. This could not be checked
  against real September runs, because Make 06's logs start on 30 Sep.

**Conclusion (b): `fRokTITH` partials do not reach `9209179`, because none
exist.**
- **Why:** with no submit point and no partial ever recorded, there is
  nothing to send. Started responses are not webhook events.
- **The latent risk:** `partial_responses_to_all_integrations` is already
  true. Neither route checks `event_type`: one filters on `form_id` only, and
  the other passes any form except `oYZKtogO`.
- **What would trigger it:** someone adding a submit point or turning on
  "capture after every question".
- **What a partial would then do:** run the to-do comment, the grade,
  Happiness, Last POC and an approval draft from a half-filled form.

The kickoff `tG7dnxBn` sends no partials (setting false, 0 ever).

### F.3 Make 06 `9209179` runs (question 2)

**Log window.** `GET /scenarios/9209179/logs` with `from` = 2026-09-25
returned 26 rows, all `EXECUTION_END`. The oldest is 2026-09-30 14:19:43.
Nothing older is held, so the 21 Sep check-in's run is not in the log.

**How each run was identified.** The Make API does not return bundle
contents. "Get scenario execution details" gives only status and error.
"List module logs" gives status, bundle count and size per module
(developers.make.com/api-documentation/api-reference/scenarios/logs). Hook
logs are kept 3 days, so only the 21 Oct delivery could be opened.

So each run was placed by five checks:
- **Which modules ran.** `GET /scenarios/9209179/modules/{id}/logs` for all
  11 modules.
- **The error.** `GET /scenarios/9209179/executions/{id}`.
- **The trigger bundle size.** Module [2]'s log `size`.
- **The response it served.** Each response's `submitted_at` is about 1 s
  before the run start. Data store 171744 keeps `created_at =
  {{2.submitted_at}}` and the card id, so each record ties back to one run.
- **Event type and form, directly.** Hook 4114295's log for 21 Oct shows
  `event_type: form_response` and `form_id: fRokTITH`.

The form also follows from the route. [3] runs only when `form_id =
fRokTITH`. A run that skips [3] but reaches [22] is not a check-in.

| # | Start | Status | Ops | Dur (s) | Modules that ran | Last | Trigger size (B) | Form · event · response | `hidden.onboarding_client_id` empty | Typed Client ID `c484f390` empty | Error (module, first 80 chars) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 09-30 14:19:43 | 3 error | 4 | 7 | 2,16,13,3 | 3 | 82,579 | fRokTITH · form_response · completed 14:19:42 (Marble and More) | yes | no | [3] `RateLimitError`: "[429] You have no credits remaining. Add credits to continue using the API at" |
| 2 | 09-30 14:20:55 | 3 error | 4 | 3 | 2,16,13,3 | 3 | 82,579 | rerun of #1 | yes | no | same |
| 3 | 09-30 14:23:04 | 3 error | 4 | 2 | 2,16,13,3 | 3 | 82,579 | rerun of #1 | yes | no | same |
| 4 | 09-30 14:28:08 | 3 error | 4 | 3 | 2,16,13,3 | 3 | 82,579 | rerun of #1 | yes | no | same |
| 5 | 09-30 14:38:16 | 3 error | 4 | 69 | 2,16,13,3 | 3 | 82,579 | rerun of #1 | yes | no | same |
| 6 | 09-30 15:39:27 | 3 error | 4 | 3 | 2,16,13,3 | 3 | 82,579 | rerun of #1 | yes | no | same |
| 7 | 09-30 18:39:31 | 3 error | 4 | 3 | 2,16,13,3 | 3 | 82,579 | rerun of #1 | yes | no | same |
| 8 | 10-01 06:39:35 | 3 error | 4 | 3 | 2,16,13,3 | 3 | 82,579 | rerun of #1 | yes | no | same |
| 9 | 10-01 08:59:46 | 1 ok | 11 | 28 | all 11 | 24 | **81,727** | fRokTITH · same response as #1 (see below) | yes | no | — |
| 10 | 10-02 06:39:39 | 1 ok | 11 | 27 | all 11 | 24 | 82,579 | rerun of #1 (the 8th) | yes | no | — |
| 11 | 10-04 09:40:00 | 1 ok | 6 | 5 | 2,16,13,22,23,24 | 24 | 25,454 | tG7dnxBn · completed 09:39:59 | no | n/a (no such field) | — |
| 12 | 10-04 09:46:37 | 1 ok | 11 | 22 | all 11 | 24 | 71,166 | fRokTITH · completed 09:46:37 | yes | no | — |
| 13 | 10-07 11:58:26 | 1 ok | 6 | 5 | 2,16,13,22,23,24 | 24 | 28,400 | tG7dnxBn · completed 11:58:26 | no | n/a | — |
| 14 | 10-08 10:49:13 | 1 ok | 6 | 4 | 2,16,13,22,23,24 | 24 | 28,123 | tG7dnxBn · completed 10:49:12 | no | n/a | — |
| 15 | 10-08 12:23:55 | 1 ok | 11 | 27 | all 11 | 24 | 11,258 | fRokTITH · completed 12:23:54 | yes | no | — |
| 16 | 10-11 14:54:04 | 1 ok | 11 | 24 | all 11 | 24 | 16,440 | fRokTITH · completed 14:54:03 | yes | no | — |
| 17 | 10-12 13:53:23 | 1 ok | 6 | 7 | 2,16,13,22,23,24 | 24 | 26,748 | tG7dnxBn · completed 13:53:22 | no | n/a | — |
| 18 | 10-12 16:14:01 | 1 ok | 11 | 36 | all 11 | 24 | 84,810 | fRokTITH · completed 16:14:00 | yes | no | — |
| 19 | 10-13 11:46:22 | 1 ok | 11 | 28 | all 11 | 24 | 57,788 | fRokTITH · completed 11:46:21 | yes | no | — |
| 20 | 10-13 14:45:02 | 1 ok | 11 | 35 | all 11 | 24 | 85,183 | fRokTITH · completed 14:45:01 | yes | no | — |
| 21 | 10-14 09:04:07 | 1 ok | 11 | 24 | all 11 | 24 | 8,639 | fRokTITH · completed 09:04:06 | yes | no | — |
| 22 | 10-15 08:54:04 | 1 ok | 6 | 6 | 2,16,13,22,23,24 | 24 | 25,939 | tG7dnxBn · completed 08:54:03 | no | n/a | — |
| 23 | 10-15 13:19:15 | 1 ok | 6 | 9 | 2,16,13,22,23,24 | 24 | 24,079 | tG7dnxBn · completed 13:19:14 | no | n/a | — |
| 24 | 10-17 11:52:17 | 1 ok | 11 | 21 | all 11 | 24 | 11,350 | fRokTITH · completed 11:52:16 (the one with hidden `task_id` set) | yes | no | — |
| 25 | 10-20 11:55:12 | 1 ok | 6 | 6 | 2,16,13,22,23,24 | 24 | 26,210 | tG7dnxBn · completed 11:55:11 | no | n/a | — |
| 26 | 10-21 12:46:52 | 1 ok | 11 | 27 | all 11 | 24 | 98,221 | fRokTITH · **form_response** (hook log) · completed 12:46:51 | yes | no | — |

"All 11" means 2, 16, 13, 3, 17, 4, 15, 21, 22, 23, 24. The router [30] costs
no operation. On every row with a matched response, `event_type` is
`form_response`. Rows 1–10 rest on the trigger size and the Slack and ClickUp
evidence below. Row 26 was read directly. The rest follow from each run
matching one completed response, with no partials existing for either form.

**Per-module totals, 30 days** (`GET /scenarios/9209179/modules/operations?days=30`):
[2] 26 · [16] 26 · [13] 26 · [3] **19, 8 errors** · [17] 11 · [4] 11 · [15] 11
· [21] 11 · [22] 18 · [23] 18 · [24] 18. No other module errored.

**Typeform in the same window** (30 Sep 14:00 to 25 Oct, `response_type`
filters):

| Form | Completed | Partial | Started (no answers) | Make 06 runs |
|---|---|---|---|---|
| `fRokTITH` | 10 | 0 | 7 | 19 (route "only the check-in call…") |
| `tG7dnxBn` | 7 | 0 | 16 | 7 |
| `oYZKtogO` | 0 | 0 | 1 | 0 |

**Why 8 errors on one response.** Make's own rerun ladder explains the
spacing. Each rerun started 1, 2, 5 and 10 minutes, then 1, 3, 12 and 24
hours after the previous run ended (65 s, 126 s, 302 s, 605 s, 1 h, 3 h,
12 h, 24 h). The trigger size was the same 82,579 B every time.
- The scenario stores no incomplete executions (`metadata.scenario.dlq:
  false`, `dlqCount 0`).
- Make's help page "Fix rate limit errors" says that for an instant trigger
  without incomplete executions, Make "reruns the incomplete execution from
  its start with exponential backoff" (help.make.com/fix-rate-limit-errors).
- A Make developer page now at 404
  (developers.make.com/custom-apps-documentation/best-practices/base/429-error-handling)
  gave the 1, 2, 5, 10 min, 1, 3, 12, 24 h ladder in search results.
- The 8-step table in help.make.com/automatic-retry-of-incomplete-executions
  applies to stored incomplete executions, so it is not this case.
- The 8th rerun (#10) succeeded, because OpenAI credits were back by 1 Oct
  08:59 (#9 succeeded).
- Typeform retried nothing. Its retry ladder (5 min, 10 min, 20 min …) does
  not match (typeform.com/developers/webhooks).

**The same response ran to the end twice (#9 and #10).** Evidence:

| Effect | #9 (1 Oct) | #10 (2 Oct) | Source |
|---|---|---|---|
| To-do comment on card `86eymcqdq` | comment `1100530000043216`, 08:59:57 | comment `1100530000050241`, 06:39:47 | ClickUp `get_task_comments` |
| Grade in #client-call-feedback `C09SVG6FHGU` | 09:00:11, "Overall Score: 5.6/10", ORANGE | 06:40:02, "4.6/10", RED | `slack_read_channel` |
| Approval post in #csm-general `C09RZ0GS0V9` | 09:00:14, "Client summary pending approval — Marble and more" | 06:40:05, same title | `slack_read_channel` |
| Data store 171744 | one record, key = the response token (both posts link the same `id`) | overwritten (`overwrite: true`); `status` still `pending` | `GET /data-stores/171744/data` |
| Client Happiness + Last POC | written | written again, same values | [21] ran on both (module logs) |

- #10 is the backoff rerun.
- #9 is off the ladder, and its trigger was 852 B smaller. Its source was
  not identified. Make logs it as `type: auto` with no replay link and no
  author, and the hook log has expired.
- Temperature 1 gave the same call two different grades.
- A third call-note comment sits on the same card, at 30 Sep 14:20:57,
  with linked subtasks. It does not have Make 06's format, and [17] did not
  run then, so another writer made it. That writer was not identified.

**Counts the disagreement needed.**
- **Made from partials:** 0 to-do comments, 0 grades, 0 approval drafts in
  the window. Make 06's logs before 30 Sep are gone.
- **Made twice:** for one response, 1 extra to-do comment, 1 extra grade,
  1 extra approval post, and 1 overwritten record (still one draft).
- **In total across the window:** 11 to-do comments and 11 grades for 10
  check-ins, and 18 approval posts for 17 responses. The data store holds
  17 records from the window.

**Where the approval drafts stand** (data store records keyed to window
responses):

| Form | Drafts | Sent | Still pending |
|---|---|---|---|
| Check-ins | 10 | 4 (4 Oct, 11 Oct, two on 13 Oct) | 6 |
| Kickoffs | 7 | 0 | 7 |

Make 07 `9523861` sent 5 messages since 1 Oct.

**The earlier explanations, checked:**

| Map | Claim | Verdict |
|---|---|---|
| `kickoff-path.md` §3.1 | 8 OpenAI 429 errors on check-in runs | Right. Add: all at [3], all one response, 1 original + 7 reruns. |
| `typeform-inventory.md` | A mistyped Client ID | Wrong for this window. [16] got the task on all 26 runs. |
| `fathom.md` §10 | Partials | Wrong. `fRokTITH` has never had a partial. |
| `make-inventory.md` §9, `clickup-ticketing.md` | The failing module was not read | Now read: [3] "GPT: Internal To-Do List". |

### F.4 Parity record for a native port (question 3)

Read from the current blueprints (`GET /scenarios/9209179/blueprint`, last
edit 2026-09-06 13:01; `GET /scenarios/9523861/blueprint`, last edit
2026-09-13 14:20). Placeholders are kept as Make writes them: `2.` is the
Typeform trigger, `13.` the sheet row, `16.` the ClickUp task, and `22.` the
recap.

#### F.4.1 Before the router

- **[2] trigger.** `typeform:WatchEventsWithResponses` on hook 4114295
  (Make type `typeform`, "My Typeform Events webhook", queue 0). Three forms
  deliver to it: `fRokTITH` (`WHTP4114295`), `tG7dnxBn` and `oYZKtogO`
  (both tagged `postcallsummary`).
- **[16] `clickup:getATask`.**
  `task_id = {{ifempty(2.hidden.onboarding_client_id; 2.mappable_answers.`c484f390-9695-4ffa-9693-9cc219592713`)}}`
  - `fRokTITH` declares only the hidden field `task_id` (`GET
    /forms/fRokTITH`), so check-ins always fall back to the typed Client ID.
  - Client ID `c484f390` is a required `short_text`.
- **[13] `google-sheets:filterRows`.** Spreadsheet "Client Data", rows
  `A1:CZ1` with headers, where column `C` equals the same `ifempty(...)`.
  Later modules read column B (`13.`1``, the client name) and column F
  (`13.`5``, the WhatsApp group).

#### F.4.2 Router [30] "Which call was this?": every route filter, verbatim

```json
{"name": "only the check-in call has a transcript to grade", "conditions": [[{"a": "{{2.form_id}}", "b": "fRokTITH", "o": "text:equal"}]]}
```
```json
{"name": "not a mid-call partial", "conditions": [[{"a": "{{2.form_id}}", "b": "oYZKtogO", "o": "text:notequal"}], [{"a": "{{2.mappable_answers.`bb0019-0000-4000-8000-000000000001`}}", "o": "exist"}]]}
```

The second filter has two condition groups, which Make joins with OR. No
filter reads `event_type`. Make 06 has no other filter.

`9748311` router [2] "Split: partial vs complete", for reference:
- `{"name": "PARTIAL (media handoff)", "conditions": [[{"a": "{{1.event_type}}", "b": "form_response_partial", "o": "text:equal"}]]}`
- `{"name": "COMPLETE", "conditions": [[{"a": "{{1.event_type}}", "b": "form_response", "o": "text:equal"}]]}`
- [7] has `{"name": "WhatsApp group exists", "conditions": [[{"a": "{{6.`5`}}", "b": "", "o": "text:notequal"}]]}`

#### F.4.3 The three GPT modules

All three use `openai-gpt-3:CreateCompletion` with the same settings:
- connection 10705290;
- `model: gpt-4.1`, `temperature: 1`, `top_p: 1`, `max_tokens: 4096`;
- `n_completions: 1`, `response_format: text`.

Each has **one system message and no user message**. The texts below are
exact, including typos and trailing spaces.

**[3] "GPT: Internal To-Do List"** (system):

```text
Below Im going to paste a call with one of our Construction/Design Business clients that we do lead generation and lead calling and converting for. I want you to create a no bullshit to do list seperate by what me & my team need to complete (our company is called MaharaMedia) and what the client needs to complete. this summary will go to our internal team to start completing the tasks, and it will also go to the client. remove all verbiage that makes this sound like AI, make it sound like a real person has drafted this up. also include the call recording at the top of the result, and do not add multiple # or * in one place, if you want to make something bold just ONE * between where you want to make bold will suffice. To be clear, do not add more than ONE * or # next to another. this looks messy, in order to make things bold you add ONE * before and after the text.

CALL SUMMARY: 
{{2.mappable_answers.`0773087f-beda-4e2c-bf50-acdac0dcbe05`}}


Additional notes from the call that have been manually typed out to provide and key resources mentioned or notes not covered on the call that the team needs to have: {{2.mappable_answers.`82a6b434-15d9-4a14-8496-c20c94628536`}}
```

**[4] "GPT: Sales Call Grade"** (system):

```text
You will be given a call transcript. you are an industry leading sales client success director who does not hold back on feedback. This is our client success team taking a call with a Construction/Design Business and our goal is to help grow their business and get them more leads. grade this call in bullet points

Grading cadence:

Rapport - How well you connect, understand, and build the "initial relationship" with the lead. (people buy from people they know, like, and trust). Are you voicing back to them that you listening and understand their frustration? Or are you combative?


Knowledge - How well do you know what is going on with this campaign, stats, etc. (Precall Checklist) 


Intro/Outro Execution - Calling the elephant out immediately or starting with wins. Ending the call on a positive note.


Opportunity - How well do you identify & take advantage of opportunities? Upsells, referrals, testimonials, reviews, etc.


Confidence - How well do you control, lead, and influence the lead with conviction. Do you sound believable? Using strong vs weak words


Professional - Do you represent Pinpoint Scaling like a 5-star operation? Cool Calm Collective under pressure. 


Tonality - Do you have good clear leadership energy or do you sound monotone, unsure, and/or boring? (also, how well you mirror them. If they talk fast, you talk fast etc). 


Clear Flow - Are you direct. Do you make perfect sense throughout the call? Or are you rambling?


Stats - How well do you get the stats updated. Do you have the right person on the call to do this?


Problem Solving - Did you identify the REAL problem and provide the best solution possible for the issue?


Expectations - Setting realistic expectations so the client understands what changes do what. What causes limitations, what the campaign should look like for that spend, this type of office, campaign, ect.

Creating Urgency - How well do you create urgency for them to complete a task. Due date (day & time), Selling the why!?

You should grade each one of the objectives on a scale of 1 to 10, 10 being amazing and 1 being terrible. At the end, you should give an overall score and overall feedback.

You should also at the top of the feedback review, make it crystal clear who took the call, what client it's with, and attach a recording to the call so anybody can review it.
Finally, based on the score, you're going to give the call a one of three grading:
- Red - serious improvement needed, needs auditing manually
- Orange - some improvement needed
- Green - incredible call

CALL TRANSCRIPT: 

{{2.mappable_answers.`0773087f-beda-4e2c-bf50-acdac0dcbe05`}}
```

**[22] "GPT: Client WhatsApp Summary"** (system). Make stores the last three
line breaks as CRLF.

```text
You are a friendly account manager at MaharaMedia (a lead-generation agency), writing a WhatsApp message directly to a client right after a call with them. Using the call transcript and our team's notes below, write the client a warm, natural recap.

Include: a short friendly greeting (use the client's first name if you can tell it from the transcript, otherwise a warm general greeting), a brief recap of what you discussed, a clear simple list of the things THEY need to do on their side, and a warm one-line sign-off. Do NOT include anything internal to MaharaMedia (our own tasks, call grading, etc.) — only what the client should see.

Write exactly like a real person typing on WhatsApp. It must NOT look AI-generated or like a formatted document.

Formatting rules (follow strictly):
- NEVER use double asterisks (**), hashes (#), or any markdown headings/symbols.
- WhatsApp bold is a SINGLE asterisk around a phrase, like *this*. Use it very sparingly — only for a short label or the to-do items — and never two asterisks.
- Separate sections with a blank line. Put each of the client's to-dos on its own line starting with a dash (-) or a number.
- Keep it concise, friendly and human.

CALL TRANSCRIPT:
{{ifempty(2.mappable_answers.`0773087f-beda-4e2c-bf50-acdac0dcbe05`; 2.mappable_answers.`0cf5f422-b446-47f4-bbfe-64881175b96d`)}}

ADDITIONAL NOTES:
{{2.mappable_answers.`82a6b434-15d9-4a14-8496-c20c94628536`}}

WHICH CALL THIS WAS: {{2.definition.title}}
If the transcript and notes above are empty, this was not a check-in call and no transcript exists. Write the recap from the submitted answers instead: what was confirmed or corrected about their business, what we are setting up for them, and what we still need from them. Never say a transcript is missing, never mention forms, fields or internal tools, and never invent anything that is not in the answers. If there is genuinely nothing worth sending, write only: SKIP
```

Refs: `0773087f` is "Clients Call Transcript" (`fRokTITH`, required
`long_text`). `82a6b434` is "Additional Notes" (optional `long_text`).
`0cf5f422` is the Blueprint's transcript field.

#### F.4.4 Where the GPT output goes

- **[17] `clickup:postATaskComment`:** `task_id {{16.id}}`, `comment_text {{3.result}}`, `notify_all false`. Connection 14149699 posts as the CEO's ClickUp account.
- **[15] `slack:CreateMessage`:** channel `C09SVG6FHGU` (private, #client-call-feedback), `text {{4.result}}`, `mrkdwn true`, `parse false`. Connection 12932135.
  - The message has no template around the grade: GPT writes all of it, header and footer included, as the prompt asks.
  - A long grade showed as two Slack messages in the same second (1 and 2 Oct). Slack splitting the post is the likely cause (not verified).
- **[21] `clickup:editATask`:** list `901816559981`, team `90182518398`, space `901810248115`, task `{{16.id}}`.
  - **Client Happiness `4e3924e3-4898-4e98-aca1-cc1ac3015b73`** is matched on the **label** and written as an **option id**:
    `{{if(contains("|Paused|At Risk|Neutral|Happy|Very Happy (testimonial)|Churned|"; "|" + 2.mappable_answers.`ff7970f7-9fad-4fa5-b12b-4d719dfb7587` + "|"); switch(2.mappable_answers.`ff7970f7-9fad-4fa5-b12b-4d719dfb7587`; "Paused"; "67c08bcd-e629-47ab-85ba-3ac4b3796734"; "At Risk"; "f0623c2a-161d-4aa2-8833-d1337c69e1c2"; "Neutral"; "46e595a3-17d7-4835-80f9-8a4c578b72a3"; "Happy"; "c5d6b01f-5f2b-40c1-afac-5b9f1efab213"; "Very Happy (testimonial)"; "d403adf4-24aa-40f0-a960-05e6a4621ee9"; "Churned"; "1c055070-45d6-4a19-ade3-958851313d7c"); )}}`
  - The six labels match the Typeform choices of "Defcon Status" `ff7970f7` (required). The six ids and names match the ClickUp options exactly, in order 0–5 (`clickup_get_custom_fields` list `901816559981`).
  - **Last POC `e183f2ce-8b7a-491a-b160-2287a247758b`** = `{{formatDate(2.submitted_at; "x")}}`, the submit time in Unix milliseconds. This is the form's submit time, not the call time.
  - Last Check-in Call `032203ad` is not written.

#### F.4.5 [23] `datastore:AddRecord`, data store 171744 "Pending Client Sends"

`key = {{2.token}}` (the Typeform response token), `overwrite: true`. The
data structure has six text fields:

| Field | Mapping |
|---|---|
| `to` | `{{13.`5`}}` (sheet column F, the WhatsApp group) |
| `body` | the recap, then the booking lines below |
| `status` | `pending` |
| `created_at` | `{{2.submitted_at}}` |
| `client_name` | `{{13.`1`}}` (sheet column B) |
| `clickup_task_id` | `{{16.id}}` |

`body` template, in order:
1. `{{replace(22.result; "**"; "*")}}`
2. A blank line.
3. The booking line for the form:

| `form_id` | Booking line (Arabic, as written) | Booking widget |
|---|---|---|
| `tG7dnxBn` | إذا ما حجزت مكالمة الهوية والتصميم لين الحين، تقدر تحجزها من هنا: | `x84ET6KnA8odlsjYiVLq` (Blueprint calendar) |
| `fRokTITH` | إذا ما حجزت مكالمة المتابعة لين الحين، تقدر تحجزها من هنا: | `SHjlq0UjeR11maltYNyh` (check-in calendar) |
| `oYZKtogO` | إذا ما حجزت مكالمة الإطلاق لين الحين، تقدر تحجزها من هنا: | `5E1EVxLJbGiDM3iYl2kL` (launch calendar) |
| any other | (empty) | (empty) |

4. The booking link on its own line.
5. For `fRokTITH` only, one more line: عادة نخلي أسبوع تقريبًا بين مكالمات المتابعة، عشان يكون فيه تقدم واضح نستعرضه معك.

#### F.4.6 [24] `slack:CreateMessage`, the approval post

Channel `C09RZ0GS0V9` (private, #csm-general), `mrkdwn true`, `parse
false`, connection 12932135. Layout:

```text
*Client summary pending approval — {{13.`1`}}*

This is exactly what will be sent to the client's WhatsApp if you approve:

{{replace(22.result; "**"; "*")}}

{booking line for the form, as in F.4.5}
{booking link for the form}

<review link: Make 07 hook 4258649, id={{2.token}}, action=approve|APPROVE and send to client>     |     <review link: same hook, id={{2.token}}, action=deny|DENY (do not send)>
```

- The post leaves out the check-in's extra "about a week between
  check-ins" line. The stored body, which is what gets sent, includes it.
  So the post does not show "exactly what will be sent" for check-ins.
- Both links only open the review page. Neither sends anything.

#### F.4.7 Make 07 `9523861`: the review page and the send rules

- **[1]** gateway hook 4258649 reads `id`, `action` and `body`.
- **[2]** `datastore:GetRecord` 171744, `key {{1.id}}`.
- **Router [3] "Which Action?"**, with these filters verbatim:

| Route | First module | Filter (verbatim) | Then |
|---|---|---|---|
| 0 | [4] Show Review Page | `{"name": "Any GET link -> review page only", "conditions": [[{"a": "{{1.action}}", "b": "review", "o": "text:equal"}], [{"a": "{{1.action}}", "b": "approve", "o": "text:equal"}], [{"a": "{{1.action}}", "b": "edit", "o": "text:equal"}], [{"a": "{{1.action}}", "b": "deny", "o": "text:equal"}]]}` | [4] `WebhookRespond` 200 |
| 1 | [11] sleep `{{floor(random * 91) + 30}}` s, **no filter** | on [5]: `{"name": "Send (POST, still pending)", "conditions": [[{"a": "{{1.action}}", "b": "send", "o": "text:equal"}, {"a": "{{2.status}}", "b": "pending", "o": "text:equal"}]]}` | [5] WHAPI `to {{2.to}}`, `body {{1.body}}` (connection 12702724) → [6] update `body {{1.body}}`, `status sent` (`upsert false`) → [7] "Sent" page |
| 2 | [8] | `{"name": "Send but already handled -> block", "conditions": [[{"a": "{{1.action}}", "b": "send", "o": "text:equal"}, {"a": "{{2.status}}", "b": "pending", "o": "text:notequal"}]]}` | [8] "Already handled" page |
| 3 | [9] | `{"name": "Do not send (POST)", "conditions": [[{"a": "{{1.action}}", "b": "nosend", "o": "text:equal"}]]}` | [9] `status denied` → [10] "Not sent" page |

The review page [4] has no links:
- **Header:** the title "Review client summary", then `{{2.client_name}}`
  and "current status: `{{2.status}}`".
- **A note:** "Nothing has been sent yet. Change anything you want below,
  then send it to the client's WhatsApp."
- **Form one:** a textarea holding the stored `body` (with `&` and `<`
  escaped) and a "Send to client" button. It POSTs `id`, `action=send` and
  `body`.
- **Form two:** a "Do not send" button. It POSTs `id` and `action=nosend`.

Runs since 1 Oct (`GET /scenarios/9523861/logs`, `/modules/operations`):

| What | Count |
|---|---|
| All runs | 47, all ran the sleep [11] |
| Review page | 41 |
| Sends | 5 |
| Already handled | 1 |
| Do not send | 0 |

The first run came 1 s after the 1 Oct approval post, which fits Slack
fetching the link for a preview (not verified).

#### F.4.8 What a native port must not copy

1. **The send guard races.** [2] reads `status` before the 30–120 s sleep.
   The record is marked `sent` only after the WHAPI send. Two Send presses
   inside the sleep both pass the `pending` filter, so the client gets the
   message twice. A native send should claim the row first, for example
   with `update … set status='sending' where status='pending' returning`.
2. **A rerun re-arms a sent draft.** [23] writes with `overwrite: true` and
   `status: pending` under the same key. A rerun or second delivery of an
   approved response resets it to pending and posts a fresh approval
   (§F.3). A native submit should be idempotent on the response or call id,
   and keep the first draft's state.
3. **Nothing checks the event type.** Neither Make 06 route reads
   `event_type` (F.4.2). A native form has no partials, but anything that
   consumes Typeform during the cut-over must check
   `event_type = form_response`.
4. **The grade is not reproducible.** At temperature 1 the same call scored
   5.6 and 4.6. Store one grade per call, and do not regrade on retry.
5. **[4]'s prompt names "Pinpoint Scaling"** where it means Mahara. The
   name shows in the posted grades.
6. **Nothing acts on SKIP.** [22] may answer `SKIP`, but no filter follows
   it, so a `SKIP` draft would still be saved and posted for approval.
7. **Kickoff recaps have no input.** [22] gets only the transcript, notes
   and the form title. A kickoff has none of these, so its recap is written
   from nothing (as `kickoff-path.md` §3.1 found). None of the 7 kickoff
   drafts in the window was sent.
8. **The Slack preview is not the message** for check-ins (F.4.6).
9. **"APPROVE and send" sends nothing.** The link only opens the review
   page.
10. **Last POC is the submit time, not the call time.** Last Check-in Call
    is never written.

### F.5 Make 12 `8925654` module count (question 4)

`GET /scenarios/8925654/blueprint`:
- **14 modules:** [1] trigger, [11], [20], router [14], [17], [18], [21],
  [22], [23], [26], [27], [24], [28] and [25].
- **13 cost an operation.** Make does not count the router as one.
- **All 13 ran 7 times** in 30 days (`/modules/operations?days=30`). That
  gives the 13 operations per run that `kickoff-path.md` recorded.
- **Both maps were right on their own terms.** `slack.md` counts 14 with the
  router, and `kickoff-path.md` counts the 13 that run.
- **It books nothing.** None of the 14 is a calendar, HighLevel or booking
  module. The only booking near the kickoff is Make 06's Blueprint link,
  `x84ET6KnA8odlsjYiVLq`, in the approval draft. It reaches the client only
  after someone presses Send. So the memory note "Make 12 books the Brand
  Blueprint" is wrong.

`9209179` has 12 modules (11 cost operations). `9748311` has 10 (9). `9523861`
has 11 (10).

### F.6 Contradictions this follow-up settles

| Contradiction | Settled as | Evidence |
|---|---|---|
| §3 above says the `blueprint` webhook takes `form_response` only, so the PARTIAL route "cannot fire"; `blueprint-path.md` says the partial setting adds partials | `blueprint-path.md` is right. The webhook does list `form_response` only, but partials were delivered anyway. | F.2 |
| The cause of the 8 errors | One response, [3] OpenAI 429, 1 original + 7 reruns | F.3 |
| 26 runs against 17 responses; `fathom.md` finds 1 check-in run too many | That extra run is the duplicate #9 | F.3 |
| Happiness "by label" against "by option id" | Label in, option id out | F.4.4 |
| Make 12 has 13 or 14 modules | 14 with the router, 13 operations | F.5 |
| Route numbering 1/2 against 0/1 | Blueprint index 0/1. Use the filter names. | F.4.2 |
| "Make 12 books the Brand Blueprint" | It books nothing | F.5 |

This follow-up also corrects two of my own earlier lines:
- §4.4 said "The failing module was not read".
- §3's Brand Blueprint row says "`form_response` only" with no note that
  partials still arrive.
Both are superseded by F.2 and F.3.

### F.7 Not verified

- **The source of run #9** (1 Oct 08:59:46). It is off Make's rerun
  ladder, and its trigger was 852 B smaller than the other runs on the same
  response. It may have been a manual resend from Typeform's delivery screen
  or a manual Make action. Make shows `type: auto`, no replay link and no
  author. Hook logs are kept 3 days, and Typeform's delivery history is not
  in its public API.
- **Whether `9209179` processed Blueprint partials on 2 and 17 Sep.** The
  logs start on 30 Sep. The filters say it would have stopped after [13].
- **The "Capture partial responses after every question" setting on
  `fRokTITH`.** The Create API exposes no key for it. Zero partials against
  nine started responses says it is off.
- **Why the Responses API returns 0 answers for every `oYZKtogO`
  response, the completed one included.** So how far each partial got could
  not be checked from Typeform. The ClickUp comments from `9748311` [4]
  carry the answers (`blueprint-path.md` §2.4).
- **The `event_type` for rows 1–25.** It was inferred, not read: hook logs
  for those days are gone, and the 20 Oct log was marked too complex to
  show its data.
- **The writer of the 30 Sep 14:20:57 call-note comment on `86eymcqdq`.**
- **Whether the 41 review-page runs of `9523861` are Slack link previews or
  people.**
- **Make's exact rerun ladder.** The page that stated it now returns 404.
  The observed gaps match the 1, 2, 5, 10 min, 1, 3, 12, 24 h ladder.

Sources for this section:
- **Make API (GET):**
  - `/scenarios/9209179`, `/blueprint`, `/logs`, `/logs/{id}`,
    `/executions/{id}`, `/modules/operations?days=30`,
    `/modules/{2,16,13,3,17,4,15,21,22,23,24}/logs`;
  - `/scenarios/9523861`, `/blueprint`, `/logs`, `/modules/operations`;
  - `/scenarios/9748311/blueprint`;
  - `/scenarios/8925654/blueprint`, `/modules/operations`;
  - `/hooks/4114295`, `/hooks/4114295/logs`, `/hooks/4114295/logs/{id}`
    (event type and form id only);
  - `/data-stores/171744`, `/data-stores/171744/data` (status, created_at
    and key matching only), `/data-structures/{id}`; `/dlqs?scenarioId=9209179`.
- **Typeform API (GET):** `/forms/{oYZKtogO,fRokTITH,tG7dnxBn}`,
  `/webhooks`, `/responses?response_type=completed|partial|started`.
- **ClickUp:** `clickup_get_task` 86eywc0xy and z8xmdvdza1;
  `clickup_get_task_comments` 86eymcqdq (times and authors only);
  `clickup_get_custom_fields` list 901816559981.
- **Slack:** `slack_read_channel` C09RZ0GS0V9 and C09SVG6FHGU, 30 Sep 14:00
  to 2 Oct 07:00 (titles, scores and times only).
- **Docs:**
  - typeform.com/developers/webhooks;
  - typeform.com/developers/webhooks/reference/create-or-update-webhook/;
  - typeform.com/developers/create/reference/create-form/;
  - help.typeform.com articles 21102221958676 and 50681134074132 (via
    `/api/v2/help_center/en-us/articles/{id}.json`);
  - community.typeform.com thread 17764;
  - developers.make.com/api-documentation/api-reference/scenarios/logs;
  - help.make.com/fix-rate-limit-errors;
  - help.make.com/automatic-retry-of-incomplete-executions.
