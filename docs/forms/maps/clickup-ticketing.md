# ClickUp ticketing, and where the CSM forms land in ClickUp

Read-only map, written 2026-10-25 against origin/main `d2c9817c`. Nothing was
submitted, edited, commented or posted. ClickUp was read through the MCP read
tools and plain `GET` calls on the VPS; Make, Typeform and Slack through `GET`
and search only. Staff are named by role. Client business names appear where
they help; no phone numbers, emails or message bodies.

Words used below:

- **Ticket form**: the ClickUp form "Submit a New Request! 📬".
- **Client card**: a task on `Clients - Mahara` (list `901816559981`).
- **Department lists**: the five lists in folder `All Assignments 🦅`
  (`901812879297`): Operations / Tech `901816723190`, Marketing / ADs
  `901816723196`, Call Center `901816723206`, Client Success `901816723211`,
  Media/Creative `901818016338`. The same folder also holds `All Tasks`
  `901816723226` and `Form Migration Test` `901821494974`.
- **The API user**: the CEO's ClickUp user (`284616470`). The cockpit, Make and
  the agents all write as this user, so their writes cannot be told apart from
  his own clicks.

## 1. What matters most

1. The team's ticketing form is a **ClickUp form on the folder**, not a
   Typeform: view `2kzmr1ky-1178`, public link, created 2026-03-15. It asks one
   question first (Request Type, 31 options) and then shows fields per type
   through 25 conditional rules. Six types have no rule at all.
2. Routing and assignment are **ClickUp automations**. The API cannot read them.
   The evidence says a submission lands in `All Tasks` named
   `Form Submission - #<time>`, and an automation renames it, applies a task
   template, moves it to a department list and sometimes assigns it. Types with
   no automation stay in `All Tasks`, unassigned, forever.
3. **Client offboarding requests are not routed.** 3 of 3 offboarding
   submissions (2026-08-08, 09-07, 10-01) sit open and unassigned in `All
   Tasks`. People then re-create offboarding tasks by hand.
4. The form is used **lightly**. Only 45 tasks with a Request Type exist on
   these lists since 2026-04-11; 16 of the 152 main tasks created in the last 60
   days carry one. Most work arrives as tasks the cockpit, Make and agents write
   directly.
5. **The cockpit already raises tickets** (CSM "Ask a team", media buyer
   reroute, media buyer offboarding). It writes them straight onto department
   lists, so they skip the ClickUp automations: no template, and no assignee
   except on Media/Creative. One code path also writes the **wrong Request Type
   IDs**.
6. **The CSM lifecycle Typeforms write to the client card, not to tickets.**
   Pause, extension and termination change fields and add one comment each.
   None of them creates the Tech or Media task the old flow created, so the
   "pause the ads" and "offboard" work has no ticket.
7. **1-1 call notes land as a GPT comment on the client card**, plus Client
   Happiness and Last POC. The team to-do list stays inside that comment; no
   tasks are created, and Last Check-in Call is not set.
8. **NPS and CSAT never reach ClickUp.** They go to one Slack channel only.

## 2. The ticket form today

| Item | Value | Source |
|---|---|---|
| Name | Submit a New Request! 📬 | ClickUp `GET view/2kzmr1ky-1178` |
| Parent | Folder `All Assignments 🦅` `901812879297` (parent type 5 = folder) | same |
| Visibility | public, `public: true`, anyone with the link can submit | same |
| Created | 2026-03-15 by ClickUp user `107698869` | same |
| Captcha, multiple submits | off, off | public form JSON `form_settings.display` |
| Thank-you text | "Thank You!" | public form JSON `form_settings.submission` |
| Target list | not in the form JSON; submissions observed in `All Tasks` | see section 3 |
| Linked from | CSM links "Client ticketing form" | `apps/media-buyer-cockpit/src/lib/csmLinks.ts:49`, `apps/client-success-cockpit/src/lib/csmTemplates.ts:46`, `apps/creative-director-cockpit/src/lib/creativeLinks.ts:93` |

The public form definition was read once from ClickUp's public form endpoint
(the same `GET` the form page makes). It holds one fixed field and 27
conditional fields.

### 2.1 Fields the form can show

All are folder-level fields on `All Assignments 🦅`, so every department list
has them (`clickup_get_custom_fields folder_id=901812879297`).

| Form label | Task field | Field id | Type / options |
|---|---|---|---|
| Request Type (always, required) | Request Type | `e9fd8024-8abe-4094-ac08-e6c0e736ad7e` | drop_down, 31 options (2.2) |
| Client Name | task **tags** | n/a | 62 tag options in space `901810248115` |
| ADs Platform | ADs Platform | `2de15aa5-7fe9-48bf-86a1-e4cfee1306c9` | Facebook/Meta, Tiktok, Snapchat |
| AD Form Name | AD Form Name | `41930456-4cbb-4431-bdd5-0a64df42a3d7` | short text |
| AD Account Name | AD Account Name | `ad13480f-8e36-4241-aacd-9b874f057749` | short text |
| Priority | native priority | n/a | urgent, high, normal, low |
| Deadline | native due date (with time) | n/a | date and time |
| Additional Info | task description | n/a | long text |
| Employee Full Name | Employee | `fa658ecb-fb6f-4cbe-9a2f-756180f2bdd0` | short text |
| Employee - Email | Employee - Email | `ceb60e57-eedc-4ca3-8c55-6d9cfb87e249` | short text |
| Additional Notes | Additional Notes | `6742edfb-9b6f-4615-933d-7ebd74f9542b` | short text |
| Schedule Rate Issue | Schedule Rate Issue | `e58f563a-63c7-4f3a-b5cd-07cbb4a420d4` | Ads issue, Call Center Issue, Both |
| Lead List | Lead List | `0f8f9334-69e7-46fc-aad1-d62402387f27` | url |
| 📍 New Company Address | 📍 New Company Address | `52ab75a1-20a6-4afe-aa40-95bcf99b35b0` | short text |
| 🆕 New Company Name | 🆕 New Company Name | `faa59f18-beb5-4a76-84e8-14b93c8636a7` | short text |
| Qualification Questions To Be Added | Qualification Questions | `35f4bf1a-7df5-4cc0-919c-2669aea0bc27` | text |
| Which Intent Level Do You Want To Switch To? | Funnel Intent Level | `3a7c5292-0215-43e6-808a-f50abfb1f316` | High, Mid, Low Intent |
| What are we writing? | Script Type | `5fd89e5e-98c8-4800-a1ce-33f5b739a275` | 9 options (Paid Ads Reel ... Other) |
| How is it shot? | Script Style | `846f445e-ab13-4be2-84c5-2b5210dbca35` | UGC, VO, POV, VO + POV, AI Avatar |
| Orientation | Orientation | `7cbff577-4a7b-491f-ab60-5937b3bda4a3` | 9:16, 16:9, 1:1 |
| How many scripts? | Script Quantity | `833192d1-e11b-4f91-807a-60abad061ff2` | number |
| Who Films It | Who Films It | `fb0e7743-9076-473b-9238-72ec729df120` | Us, Them |
| Script Language | Script Language | `0d6140e8-f145-4415-a82e-1d348904924a` | Arabic, English, Both |
| Arabic Dialect | Arabic Dialect | `673028fc-8cf7-4e56-815b-bd454c8d604a` | 10 dialect options |
| Video for Page | Video for Page (optional) | `4b9c5187-430f-4534-99cf-db3fa2741dda` | url |
| Landing Page Copy Link | Copy Doc or Link | `41b41285-1152-48b8-85f2-ccb080ea7662` | text |
| Landing Page Goal | Page Goal | `dfe24578-f27a-43ea-970f-4dd9e1825b47` | 5 options |
| Any specific questions you want added? (optional) | Requested Questions (optional) | `bcba69d7-9941-486d-84f5-6d6dcdefe4d3` | text |

Folder fields the form never shows: Break-Even Status, Daily Budget, Edited
Video Link, Service, and **Privacy Policy - Type** `5000c43f-18a7-4c50-bf7b-60d59ca41417`
(although "Create a Privacy Policy Request" is a type).

### 2.2 Request types, what each asks, and where it went

"Asks" comes from the form's rule for that option (`*` = required). "Seen"
counts non-archived main tasks with that Request Type on the department lists,
`All Tasks` and `Form Migration Test`, all time (first one 2026-04-11).
"Template" is the matching task in `Task Templates` `901816723408`.

| # | Request Type | Option id | Asks | Seen | Landed on / owner seen | Template |
|---|---|---|---|---|---|---|
| 0 | Connect a New Lead Form 🆕 | `37d99ca0-e53f-4499-90e8-f1be8a21b207` | Client*, ADs Platform, AD Form Name*, AD Account Name*, Deadline*, Priority | 1 | Operations / Tech, systems manager | Connecting a new lead form 📥 |
| 1 | Create Ad Account | `fd4d330d-2bda-4872-b195-11e694b29231` | Client*, ADs Platform*, Priority*, Deadline* | 0 | | Create Meta / Snapchat / TikTok Ad Account |
| 2 | Missing Leads ❌ | `9fd304bb-7078-4485-9b9f-aa19ad47ed98` | Client*, ADs Platform*, Deadline*, Priority | 0 | | Missing Leads ❌ |
| 3 | New Employee Onboarding 🤵 | `88ab0389-7e36-4714-8b65-6d966ce9aed1` | Employee Full Name*, Deadline*, Priority* | 0 | | New Employee Onboarding 🙋‍♂️ |
| 4 | Employee Offboarding 👋 | `504c3ffc-9264-4402-b03e-f349d0d8cbe0` | Employee Full Name*, Employee - Email*, Deadline*, Priority | 0 | | Employee Offboarding 👋 |
| 5 | Create a Privacy Policy Request 📝 | `5552a329-4e97-45d6-a195-9097e7df5cf5` | **no rule** | 0 | | none |
| 6 | AD Spend Invoice Request🧾 | `a82b0b80-e4f7-4f30-a3a5-49a5ea4c7f2d` | Client*, Deadline*, Priority | 0 | | Ad Spend Invoice Request 🧾 |
| 7 | Whatsapp Connection Issue 🔁 | `663ffd51-a838-4038-a8c0-a936b86f43b7` | Client*, Deadline*, Priority | 4 (last 2026-05-21) | Client Success, unassigned | Whatsapp Connection Issue📲❌ |
| 8 | Whatsapp Reactivation Campaign 📬 | `862f83da-8980-4ebe-9477-7501ccbf23d3` | Client*, Lead List*, Additional Notes, Deadline*, Priority | 0 | | Client Reactivation Campaign📣 (+ Media) |
| 9 | Add Custom Qualification Questions🙋 | `7fc82c41-7bcd-47f7-bae0-868d4954495b` | Client*, ADs Platform*, Qualification Questions*, Deadline*, Priority | 0 | | Add custom qualifiation questions🙋 |
| 10 | Client Offboarding Request 🔴 | `d5ab86ae-18af-42d5-abd1-120c3fa2bcc3` | Client*, Additional Notes, Deadline, Priority | 3 (2026-08-08, 09-07, 10-01) | **stayed in All Tasks, unassigned, open** | Client Offboarding (Tech) / (Media) 👋❌ |
| 11 | Change From DFY to DWY 🔁 | `d5a87389-3657-4334-8aee-14d67c2129d3` | Client*, Additional Info*, Deadline*, Priority | 0 | | none |
| 12 | Change From DWY to DFY 🔁 | `5e83c505-a5b2-43f1-849c-ce3a11c0c7b1` | **no rule** | 0 | | none |
| 13 | Client Pause Request ⏸️ | `196991a9-dac9-4da8-a693-6b6d64372be5` | Client*, Priority*, Deadline* | 3 (last 2026-08-31) | renamed "Client Pause ⏸️": Operations / Tech (2), Marketing / ADs (1); systems manager on 1 | Client Pause ⏸️ (Tech) / (Media) |
| 14 | Client Relaunch Request ⏯️ | `59b89a7c-6970-4aad-8c01-1d7bf58b124a` | Client*, Priority*, Deadline* | 0 | | Client Relaunch 🚀↪️ (Tech) / (Media) |
| 15 | Change Company Name🔃 | `bbef2ea6-a3cd-49be-a82d-33352a23f7d0` | Client*, New Company Name*, Additional Notes, Deadline*, Priority | 0 | | Change Company Name⏎ |
| 16 | Change Company Address🔃 | `9d0997fb-0523-477a-b5fe-54dd3971a614` | Client*, New Company Address*, Additional Notes, Deadline*, Priority | 0 | | Change Company Address📍 |
| 17 | Switch Funnel Intent🌪️ | `645a7f4f-a4d8-4fe7-a58c-dda546c40188` | Client*, Intent Level*, Additional Notes, Requested Questions, Deadline*, Priority | 0 | | Switch funnel intent level🌪️ |
| 18 | Create Landing Page📊 | `a2d9483c-2dde-486d-969e-78679e5d27a6` | Client*, Additional Notes, Requested Questions, Page Goal, Copy Link, Video for Page, Deadline*, Priority | 2 (last 2026-09-15) | Operations / Tech, systems manager | Create Landing Page📊 |
| 19 | Client Success Management Request 🙋‍♂️ | `6cde0a1f-a3f1-43c3-b9f9-7166e6899463` | **no rule** | 1 (2026-10-10) | **stayed in All Tasks, unassigned, open** | none |
| 20 | Client Business License is Missing ❗ | `b286f3d0-957e-487f-92ef-ae82499c450e` | **no rule** | 0 | | none |
| 21 | Client Card Missing for ADs ❗❗ | `7e7ae553-abde-4cd2-af26-a1cca7be668c` | Client*, Deadline*, Priority | 0 | | Card Missing 💳 ❌ |
| 22 | New Script Request 📗 | `a79b08d7-8e4f-469d-b70f-cba8514a06c3` | Client*, Script Type*, Script Style, Orientation*, Quantity*, Who Films It*, Language*, Dialect, Additional Notes, Deadline*, Priority | 18 (last 2026-10-13) | renamed "New Script Request✍️", Media/Creative, creative strategist on 17 of 18 | New Script Request✍️ |
| 23 | Marketing/ADs Request 🃏 | `b796a968-347d-43b8-b187-c658b955587e` | **no rule** | 1 (2026-04-11) | **stayed in All Tasks, unassigned, open** | none |
| 24 | Edit Existing Campaign Request 🎱 | `75095c91-9cc0-4505-ae96-e6317bbeade1` | **no rule** | 0 | | none |
| 25 | Low Show Rate📉 | `d85246c8-7dcc-4294-b981-d1fe8b1221a6` | Client*, Additional Notes, Deadline*, Priority | 0 | | Low Show Rate📉 |
| 26 | Low Schedule Rate📉 | `36ea1d39-4115-4a46-9f18-34664e7adac3` | Client*, Schedule Rate Issue*, Additional Notes, Deadline*, Priority | 0 | | Low Schedule Rate📉 (Call Center) / (Ads) |
| 27 | General Tech Request | `71c628d0-ee1f-4dc6-90ce-b4da84b7b367` | Deadline*, Priority*, Additional Info* | 5 (last 2026-09-09) | Operations / Tech (4), Form Migration Test (1); systems manager on 4 | none |
| 28 | General Marketing Request | `d52bde7c-13b5-4b1f-a34e-042478f883a6` | Deadline*, Priority*, Additional Notes* | 1 (2026-04-20) | Marketing / ADs, a former team member | none |
| 29 | General CSM Ticket | `5db37a3e-f3cd-4513-8e38-750fecfa34c6` | Deadline*, Priority*, Additional Notes* | 6 (last 2026-05-11) | Client Success, unassigned | none |
| 30 | Social Media Management Request | `108eef9b-55f7-45c5-9af0-0c9462925902` | Client*, Additional Info*, Deadline*, Priority | 0 | | none |

Sources: rules from the public form JSON (`form_settings.fields[0].rules`,
25 rules); options from `clickup_get_custom_fields list_id=901816723190`;
counts from `GET list/{id}/task?include_closed=true&subtasks=true` on the seven
lists (967 tasks, 313 main tasks); templates from `GET list/901816723408/task`
and `GET team/90182518398/taskTemplate`.

### 2.3 Statuses

The department lists, `All Tasks` and `Form Migration Test` share the space
statuses (`clickup_get_list 901816723190`, ids `p901810248115_*`):

| Status | Type |
|---|---|
| to do | open |
| in progress | custom |
| review required | custom |
| pending | custom |
| complete | done |
| cancelled | closed |

## 3. How a ticket moves and who gets it

ClickUp has no public API for automations. Earlier probes recorded in Slack got
`404` on every automation endpoint (DM with the CEO's assistant agent,
2026-09-17), and the systems manager wrote on 2026-09-10 in #tech-general that
the Typeform version still had to be "attached" with a ClickUp automation. So
the flow below is **inferred from task data**, not read.

1. Someone opens the public form and submits it. The task is created in
   `All Tasks` with ClickUp's default name `Form Submission - #<timestamp>`.
   Evidence: all five unrouted form tasks have that name and sit in `All Tasks`
   (`86ex7krbw`, `86eyjjky6`, `86eyuyv8w`, `z8xmdvf7vy`, `z8xmdvh26g`); the
   Make draft for the Typeform version also targets `All Tasks` (scenario
   `9783436` module 2 `list_id 901816723226`).
2. A ClickUp automation keyed on Request Type renames the task, applies the
   matching template from `Task Templates`, and moves it to a department list.
   Evidence: `86eytarzg` sits on Operations / Tech, is named "Client Pause ⏸️",
   has a Request Type and 2 checklists like the "Client Pause ⏸️ (Tech)"
   template `86ex63k45` ("Tech pause steps", 6 items).
3. Some automations assign. New Script Requests always go to the creative
   strategist; typed Tech requests usually reach the systems manager. Types with
   no automation stay in `All Tasks` with no owner (rows 10, 19, 23 above).
4. Creator: a submitter signed in to ClickUp shows as the creator (media buyer,
   systems manager); otherwise the creator is `ClickBot` (id `-1`), which hides
   who asked. 9 of the 45 typed tickets have `ClickBot` as creator.
5. Once a task has an assignee on a department list, the VPS worker
   `hermes/task-assignment-alerts` posts the assignment in that department's
   Slack channel; Client Success goes to #csm-general `C09RZ0GS0V9`
   (`hermes/task-assignment-alerts/README.md:6-13`,
   `hermes/task-assignment-alerts/worker.py:22-29`). It posts nothing for an
   unassigned task, and it does not watch `All Tasks`.

What happens after the offboarding form shows the gap. "North Gulf Systems"
(form task `86eyjjky6`, 2026-08-08) and "Mofag" (`86eyuyv8w`, 2026-09-07) each
got a hand-made offboarding task later (`86eyjkqzy` on Marketing / ADs;
`86eyuyv9f` on Operations / Tech and `86eyv2up2` on Marketing / ADs). The
2026-10-01 request (`z8xmdvf7vy`, tag "حول العمران للمقاولات", priority high)
has no follow-up task found by search.

### 3.1 Assignment by list, last 60 days (main tasks)

| List | Created | Assigned to (count) | Unassigned |
|---|---|---|---|
| Operations / Tech | 34 | systems manager 12, media buyer 2, CEO 1 | 21 (20 are "Technical Onboarding Check 🚀" parents) |
| Marketing / ADs | 48 | media buyer 8, systems manager 6, a former team member 3, CSM 1 | 33 |
| Media/Creative | 51 | creative strategist 50 (65 of 67 all time) | 1 (a New Script Request, 2026-10-13) |
| Client Success | 15 | CSM 12, creative strategist 1, CEO 1 | 2 |
| Call Center | 0 | none | none (no non-archived main task, ever) |
| All Tasks | 3 | none | 3 |

The Media/Creative pattern (one owner on almost every task, whoever created
it) suggests a list-level "assign on create" automation. Not verified.

## 4. Volume, filers and time to finish

Window: tasks created on or after 2026-08-26. Main tasks only, archived tasks
excluded. "Time to finish" uses `date_done` or `date_closed` minus
`date_created`, for tasks that reached **complete**.

| List | Created | Complete | Median days | 80th pct days | Cancelled | Still open |
|---|---|---|---|---|---|---|
| Operations / Tech | 34 | 21 | 3.1 | 19.9 | 4 | 9 |
| Marketing / ADs | 48 | 29 | 8.2 | 20.5 | 17 | 2 |
| Media/Creative | 51 | 26 | 6.0 | 14.7 | 4 | 21 |
| Client Success | 15 | 0 | n/a | n/a | 6 | 9 |
| All Tasks | 3 | 0 | n/a | n/a | 0 | 3 |
| Form Migration Test | 1 | 0 | n/a | n/a | 0 | 1 |

Who created those 152 tasks:

| Creator | Tasks | Note |
|---|---|---|
| The API user (CEO) | 124 | cockpit, Make and agent writes plus his own; cannot be split |
| Media buyer | 19 | |
| ClickBot | 5 | anonymous form submits or ClickUp automations |
| Systems manager | 4 | |

The most common task shapes in the window are onboarding parents
("Technical Onboarding Check 🚀" 20, "Creative Onboarding 🚀" 14, "Brand DNA 🧬"
14, "New Client Campaign Launch 🚀" 9), payment failures (16) and agent tasks
named "<Client> | <action>". Typed tickets are 16 of 152.

Typed tickets, all time, rough close times: General Tech Request 1.5 days
(n=4), Client Pause 2.0 (n=3), Create Landing Page 12.0 (n=2), New Script
Request 28.5 (n=16), WhatsApp Connection Issue 59.3 (n=4), General CSM Ticket
121.8 (n=6). Client Offboarding: 0 of 3 closed. Typed tickets per month:
April 11, May 11, June 3, July 0, August 6, September 10, October 4.

## 5. Other ClickUp forms in the workspace

All are public form views (`GET view/{id}`). Field lists from each form's public
JSON.

| Form | View id | Lives on | Created | What it collects |
|---|---|---|---|---|
| Submit a New Request! 📬 | `2kzmr1ky-1178` | folder All Assignments 🦅 | 2026-03-15 | the ticket form (section 2) |
| Video Request Form | `2kzmr1ky-1058` | Video Pipeline `901816720767` | 2026-03-15 | client, type, format, footage, script, deadline, editor (14 fields) |
| Launch New Campaign | `2kzmr1ky-3878` | Ads Managment `901817774521` | 2026-04-30 | campaign card for the media buyer (17 fields) |
| Campaign Launch From | `2kzmr1ky-2298` | Client Success `901816723211` | 2026-03-30 | client tag, daily budget, platform, video, due, notes |
| Payment Failure | `2kzmr1ky-1218` | Marketing / ADs | 2026-03-16 | client tag, card ending, reason, platform, debt |
| Order Form | `2kzmr1ky-4338` | Marketing / ADs | 2026-05-12 | generic order (5 fields) |
| Report WhatsApp Disconnection | `2kzmr1ky-6778` | WhatsApp Reconnection `901821803697` | 2026-09-12 | client tag, reconnect link, notes |
| Form (portal tasks) | `2kzmr1ky-7138` | Client Portal Tasks `1100530000000279` | 2026-09-19 | client tag, title, what to do, type, due, **responsible employee** |
| Form (review inbox) | `2kzmr1ky-7638` | Review Inbox `1100530000004644` | 2026-10-18 | video title, Drive link, name, task, brand, notes |
| 🚀 | `2kzmr1ky-1078` | Clients - Mahara | 2026-03-15 | new client card (19 fields, closer handoff) |
| Client Update Form | `2kzmr1ky-2278` | Clients - Mahara | 2026-03-30 | client tag, Last Meeting Link, Last Meeting Transcription, Client Happiness |
| Project Intake Form | `2kzmr1ky-2258` | Clients - Mahara | 2026-03-30 | "CSM Giving Extension" as the task name, client tag, details, priority, attachments |

Two of these are older CSM forms that now have Typeform replacements: the
**Client Update Form** (call update) and the **Project Intake Form** (extension).
The portal tasks form shows a form can carry an assignee field; the ticket form
does not.

## 6. The Typeform migration that stopped half way

On 2026-09-09 the CEO asked in #tech-general to move the ClickUp forms to
Typeform, because the ClickUp plan was paid mainly for conditional logic on the
ticket form. On 2026-09-10 he said he was willing to keep it. The parts built:

| Part | State | Source |
|---|---|---|
| Typeform "[SANDBOX] Mahara Internal Request" `o0ULXQhD` | 30 request choices, one inline group per type, a 55-client dropdown per group, no hidden fields; 2 responses ever | Typeform `get_form` skeleton; `insights aggregate count` |
| Typeform webhook | enabled, tag `WHTP4364124`, points at Make hook `4364124` | `GET forms/o0ULXQhD/webhooks`, Make `GET /hooks` |
| Make "[DRAFT] Typeform Internal Request -> ClickUp Production" `9783436` | **inactive**; one module creates a task in `All Tasks` with the Request Type, tags and folder fields mapped by `switch()`; no assignee, no status | Make blueprint, module 2 |
| Hook queue | 0 waiting | Make `GET /hooks/4364124` |
| Test list "Form Migration Test" | 1 task, "General Tech Request", open | list `901821494974` |

Older, Monday-era routing is still in Make but inactive: "Universal Ticket
Assignment" `8063994` routed by "Department Responsible" to department boards,
and "SOP-Specific Ticketing System To PM Tool" `8064859` routed by type to Slack
channels and Monday boards. Both are historical.

## 7. Tickets the cockpit already raises

| Path | Where it writes | Request Type | Assignee | Source |
|---|---|---|---|---|
| CSM "Ask a team" (direct) | department list from `DEPARTMENTS`; due = +2 days; comment on the client card with the ticket link | looked up **by option name** (7 names) | none | `supabase/functions/cockpit-csm-api/core.ts:4-15`, `:34-38`, `:47-50` |
| CSM "Ask a team" (writeback queue) | department list from `DEPARTMENT_LIST`; description says "Requested from the Client Success Cockpit" and "Raised by"; link comment on the client card | Tech only, **by fixed option id** | none | `supabase/functions/clickup-writeback/queue.ts:196-228`, `:180-188` |
| CSM daily plan items | Client Success list `901816723211` | none | none | `supabase/functions/cockpit-csm-api/core.ts:22`, `:44` |
| Media buyer offboarding | Operations / Tech `901816723190`, tag = client, Request Type "Client Offboarding Request 🔴" | by option name | none | `supabase/functions/cockpit-media-api/clientLifecycle.ts:5`, `:37`, `:48`; `docs/media-launch/PAUSE-OFFBOARD.md:11-19` |

Seen in ClickUp since 2026-10-12: 7 cockpit tickets named
"<client> - <action>", all created by the API user. The 5 on Media/Creative got
the creative strategist; "GHL or automation change needed" on Operations / Tech
(`z8xmdvjzb7`) and "Lead quality is poor, review targeting" on Marketing / ADs
(`z8xmdvh7vn`) have no assignee, so no Slack alert fired for them.

**Wrong ids.** `supabase/functions/clickup-writeback/rules.ts:59-66` maps "Add
qualification questions to the lead form" and "Switch to a landing page" to
`37d99ca0-...`, which ClickUp names "Connect a New Lead Form 🆕". The right
options are `7fc82c41-7bcd-47f7-bae0-868d4954495b` (Add Custom Qualification
Questions🙋) and `a2d9483c-2dde-486d-969e-78679e5d27a6` (Create Landing Page📊).
The same table is in `apps/media-buyer-cockpit/convex/writeback.ts:136-141`.
"Landing page or tracking is broken" maps to Missing Leads ❌ `9fd304bb-...`,
which is a fair match.

Small note: `apps/client-success-cockpit/src/pages/CsmPage.tsx:179-180` says
the Request Type field "actually lives" on Operations / Tech. It is a folder
field, present on all five department lists.

## 8. Who should file a ticket, and see their own

- **Everyone in the team.** Active cockpit seats today
  (`select roles::text, count(*) ... from cockpit_members group by 1`): 3
  editor, 2 media buyer, 2 call centre, 1 creative, 1 CSM, 1 sales, 3 admin
  seats with several roles. ClickUp has 10 workspace members
  (`clickup_get_workspace_members`). The two call centre agents share a login
  (memory note "Team-only seats"), so their requests would show one seat.
- **Today nobody can see "my requests".** The public form records no requester
  when the person is not signed in (ClickBot), and every cockpit, Make and agent
  write shows as the API user. ClickUp keeps no field for the real requester;
  the writeback queue only puts "Raised by" in the description text.
- What a cockpit page needs to show, from the data above: **My requests**
  (requester = me), **Assigned to me**, the **department queue** for the
  department lead, and **everything** for the CEO and admins. Each row needs
  type, client, due, priority, status mirrored from ClickUp, owner, and the
  ClickUp link.

## 9. Where the CSM forms land in ClickUp

The client card list `Clients - Mahara` `901816559981` is the join. The pause,
extension and termination forms carry the card id as hidden
`onboarding_client_id`, and each scenario checks the task really is on that
list before it writes (filter "Task belongs to Clients - Mahara" in `9805613`,
`9805665`, `9805538`). The call notes route takes the hidden id or, if empty,
a typed answer (`c484f390-9695-4ffa-9693-9cc219592713`) and has no list check
(`9209179` module 16).
The per-client form links live on the card: Kickoff Form Link
`87d7d889-afea-42f8-9485-6f3ead5b857f`, 🧬 Brand Blueprint Form Link
`1b7a4a74-d0e7-4a7f-9218-59c80a738186`, Pause Form Link
`3a04c8a1-d00a-4127-a9fd-5c355fde24bc`, Extension Form Link
`538b6c6a-4919-41df-ac0b-8da5caea7fcb`, Termination Form Link
`24a77b61-af94-46df-b567-d596271421c7` (`GET list/901816559981/field`).

### 9.1 Form by form

| Form | Live Make route | ClickUp writes (card fields) | Comment on card | Ticket created | Slack | Responses, 60 days |
|---|---|---|---|---|---|---|
| Client 1-1 Call Notes `fRokTITH` | `9209179` "06. Post Call Summary", hook `4114295` | Client Happiness `4e3924e3-4898-4e98-aca1-cc1ac3015b73` (by option id), Last POC `e183f2ce-8b7a-491a-b160-2287a247758b` = submitted time | yes: GPT "to-do list" for team and client (module 17) | **no** | grading to private `C09SVG6FHGU` (module 15); client WhatsApp recap held for approval in #csm-general `C09RZ0GS0V9` (modules 23-24, datastore `171744`) | 24 (34 all time) |
| Client Extension `gqBcyK6g` | `9805665` "Client Lifecycle - Client Extension Form submitted", hook `4371922` | Next Payment Date `669ae046-bf82-4b59-80d5-bf25d6b57ef3` + 7 / 14 / 28 days | yes: "CLIENT EXTENSION" with CSM, at-risk answer, recording, duration | no | none from this route | 1 |
| (same form, second route) | `9000763` "14. Client Extension Given", hook `4022911` | none | none | no | #csm-announcements `C09SNG5BP53`; row in sheet tab "03.1: Extension Audit" | same 1 |
| Pause Request `CTUjv6l3` | `9805613` "Client Lifecycle - Pause Request Form submitted", hook `4371898` | Client Status `9368ca9e-3549-4320-84ff-9abd0a2901cb` = **orderindex 1** (Paused), Paused On `930c49eb-9374-410c-801f-9aa81fff4944`, Resume On `d3c46259-3017-4429-a52a-c609a40f348b` | yes: "PAUSE REQUEST" with reason, detail, dates, consent answers | **no** | none | 1 |
| Contract Termination Survey `knIe4eF3` | `9805538` "Client Lifecycle - Contract Termination Survey submitted", hook `4371873` | Client Status = **orderindex 11** (Stopped), ❌ Churn Date `42429a6e-5cba-4a3b-964d-2b493315421b`, ❌ Churn Reason `796f25e7-7e63-4d08-9ec4-41c58a5b57ca` = 0 (Cancelled), ❌ Churn Type `a121f39a-f8a4-41f5-905e-a735ee729071` = 0 (Mid-programme loss) | yes: "CONTRACT TERMINATION SURVEY" with reasons and ratings | **no** | #csm-announcements `C09SNG5BP53` | 1 |
| (same form, old route) | `8962418` "13. Cancellation Form to Sheet", **inactive**, hook `4007438` still enabled, queue 0 | none | none | used to create "<Company> - Client Offboarding👋❌" from templates `t-86ex629x6` on Marketing / ADs and `t-86ex629ve` on Operations / Tech | used to post to `C09SNG5BP53` | |
| NPS Survey `fuPgs85S` | `8962328` "12. NPS Survey", hook `4007419` | **none** | none | no | private `C09TTGBRQ0G` | 0 |
| CSAT Survey - Onboarding `KbcbPA73` | `8962387` "11. CSAT - Onboarding", hook `4007430` | **none** | none | no | private `C09TTGBRQ0G` | 0 |
| Old ClickUp "Client Update Form" `2kzmr1ky-2278` | `8903351` "15. ClickUp Client Update" (custom webhook `3982801`) | none | yes, on the card found via the "Client Data" sheet | no | private `C0AL6QP8HU4`; also appends to the client Google Doc | no runs in the log window |

Sources: Make blueprints (`GET /scenarios/{id}/blueprint`), Typeform webhooks
(`GET /forms/{id}/webhooks`, matched to Make hooks by URL without printing it),
Typeform `insights aggregate count` from 2026-08-26, ClickUp task 86eywfu7g
(the 2026-09-14 lifecycle build notes and test results).

The pause flow has one more piece: Make `9686154` "10. Client Resume Due" reads
the client cards and posts in media-general `C0AE8G5MT7Y` when a Paused card's
Resume On is within 3 days (blueprint module 3 filter).

The cockpit mirrors the call forms in Supabase `cockpit_csm_call_forms`
(`select form_kind, form_id, count(*) ...`): onboarding `KFRCXPFx` 46, check-in
`fRokTITH` 34, old kickoff `BbJy6xg4` 27, kickoff `tG7dnxBn` 8, blueprint
`oYZKtogO` 1. It has no rows for the pause, extension, termination, NPS or CSAT
forms. `cockpit_csm_form_sends` is empty.

### 9.2 What a client card's comments look like

The latest page of comments (up to 25) on each of the 70 client cards, grouped
by their first line. Bodies were not printed.

| Kind | All | Last 60 days | Written by |
|---|---|---|---|
| Post-call style summaries (call notes route and similar) | 56 | 33 | API user |
| Meta billing notices (unsettled balance, grace period, cleared) | 57 | 57 | API user |
| Payment failed notices | 50 | 8 | API user |
| "Status Changed To ..." | 50 | 50 | ClickBot (a ClickUp automation) |
| "@<person> clients next payment is in 1 week" | 43 | 18 | ClickBot |
| "Submission Overview" (onboarding form) | 26 | 5 | API user |
| Media buyer changes (🎯 Cockpit) | 11 | 11 | API user |
| "Cockpit · Client success asked Media/Creative" | 4 | 4 | API user |
| Typeform lifecycle: termination / pause / extension | 3 / 1 / 1 | 3 / 1 / 1 | API user (includes the internal test card) |

## 10. Gaps

| # | Gap | Impact | Fix |
|---|---|---|---|
| 1 | Offboarding, CSM Management and Marketing/ADs requests from the ticket form never leave `All Tasks` | 5 requests open with no owner; offboarding redone by hand or missed (2026-10-01) | Route every type in the cockpit backend; offboarding creates both Tech and Media tasks from `t-86ex629ve` and `t-86ex629x6`, linked on the client card |
| 2 | 6 types have no form rule, so no client, deadline or details | Requests arrive empty | Give every type client, details, deadline and priority; Privacy Policy uses field `5000c43f-...` |
| 3 | Routing and assignment live in unreadable ClickUp automations; cockpit tickets skip them | No audit; tickets land unassigned (Tech, ADs) and no Slack alert fires | One request-type table in Supabase (type, list, template, owner role, due rule); set the assignee on create so `task-assignment-alerts` posts it |
| 4 | Wrong Request Type ids in `clickup-writeback/rules.ts:59-66` | Qualification and landing-page tickets show "Connect a New Lead Form 🆕" | Look options up by name, as `cockpit-csm-api/core.ts:19` does |
| 5 | Client picker is the tag list (62 tags vs 70 cards) and a hardcoded 55-name Typeform dropdown | Missing clients (media buyer report in #new-campaigns, 2026-06-06); tickets not linked to the card | Pick from `Clients - Mahara` cards; store the task id, add the tag as well |
| 6 | Requester is lost (ClickBot or the API user) | Nobody can list "my requests"; owners cannot ask the requester | Store the cockpit member and role on the request row; show My requests and Assigned to me |
| 7 | Pause Typeform changes the card but creates no Tech or Media pause task | Ads and tech pause steps depend on someone noticing the status | Cockpit pause creates the typed Operations / Tech and Marketing / ADs tasks (templates "Client Pause ⏸️ (Tech)/(Media)") or hands off to the media buyer Pause & offboard hold |
| 8 | Termination survey creates no offboarding tasks (old route `8962418` did, now off) | Campaigns and access may stay on after a client stops | Same as gap 1 |
| 9 | Extension writes Next Payment Date only; "Current extension (weeks)" `8cb9d308-5df5-4ea1-b83d-32b5b7eea778` is never set; two scenarios fire per response | No extension count on the card | Cockpit extension writes both fields and one Supabase row, then one Slack post |
| 10 | Lifecycle routes write dropdowns by orderindex (Paused = 1, Stopped = 11, churn = 0) | Reordering options in ClickUp silently writes the wrong status | Write by option id or name with read-back |
| 11 | Call notes keep team to-dos inside one comment; Last Check-in Call `032203ad-e327-4d76-a0ce-c07496da6486` not set; 8 of the last 26 runs of `9209179` have status 3 | To-dos are not tracked; check-in date stale | Cockpit call form sets Last Check-in Call, Last POC and Happiness, and creates real tasks per to-do on the right list |
| 12 | NPS and CSAT never reach ClickUp or Supabase | No satisfaction on the client page; low scores go unseen | Store responses by card id; show on the client page; a low score raises a CSM ticket |
| 13 | Sandbox internal request Typeform has a live webhook into an inactive scenario | A stray submission waits in Make and would create unassigned tasks if the scenario is switched on | Retire it once the cockpit form ships; never switch `9783436` on as is |

## 11. Not verified

- The ClickUp automations themselves (move, rename, template, assign). The API
  has no automation endpoint; section 3 is inferred from task names, lists,
  checklists and owners.
- That `ClickBot` as creator means an anonymous form submit. It can also be a
  ClickUp automation creating the task.
- Which of the API user's 124 tasks came from the cockpit, Make, agents or the
  CEO by hand.
- Archived tasks. Every count excludes them (`archived=false`).
- Comments beyond the latest page of 25 per card.
- The names of private Slack channels `C09SVG6FHGU`, `C09TTGBRQ0G` and
  `C0AL6QP8HU4` (not looked up).
- Make log status 3 is read as "error" by Make's convention; the failed runs of
  `9209179` were not opened.
- Whether the 2026-10-01 offboarding request was handled outside ClickUp.
- Who watches the Call Center list; it has no non-archived main task.
- Whether scenario `8903351` still runs: it reads ClickUp fields named "Meeting
  Link" and "Client Update", while the Client Update Form uses "Last Meeting
  Link" and "Last Meeting Transcription", and the Make log window had no runs.
- The target list of the ticket form. The public form JSON does not include it;
  `All Tasks` is where its unrouted submissions are found.

## Follow-up 2026-10-25

Read only, same day. Sources: ClickUp MCP read tools and plain `GET` calls on
the VPS (key read by name), the ClickUp **Automations manager viewed in the
built-in browser**, Make `GET`, Slack read tools, the local mahara-context
checkout (files dated 2026-09-16, grep and cat only), and one Google Doc read.

The built-in browser was already signed in to the Maharamedia workspace as the
CEO. In it I opened the Automations manager, changed only its view filters
(status filter, location picker, Activity "Clear filters"), hovered info
icons, dismissed one promotional popup, and closed the manager. I clicked no
toggle, edit, save, duplicate, delete or retry control. Nothing was submitted,
created, moved, assigned or posted. Staff are named by role. ClickUp user ids:
systems manager `113459516`, creative strategist `113520400`, CSM `113688800`,
media buyer A `119413219`, media buyer B `113428468`, CEO and API user
`284616470`. Two former team members still appear on old records: `107698869`
(built the board in March 2026) and `113428463` (no longer a workspace member).

### F1. What changed since section 3

Section 3 inferred the routing. The automations are now read. The inference
was mostly right, with three corrections.

1. **The folder routes; the lists assign.** Folder `All Assignments 🦅` has 26
   active automations and 0 inactive. Each one fires when "a task is created
   and Request Type is X". It moves the task to another list, applies a
   template and renames it. They cover 20 of the 31 Request Types. The other
   11 have no rule, so their tickets stay in `All Tasks` (F2).
2. **Each department list assigns with a different trigger** (F3):

   | List | Rule (read) | Fires on a routed ticket? | Fires on a task created straight on the list? |
   |---|---|---|---|
   | Operations / Tech | "an existing task is moved here" → assign the systems manager | yes | **no** |
   | Marketing / ADs | "an existing task is moved here" → add assignees (name not shown) | yes, but the one routed ticket since August got nobody | **no** |
   | Client Success | "a task is created" → add and remove assignees (name not shown) | **no** | yes |
   | Call Center | "a task is created" → add assignees ("Assign CCM", name not shown) | **no** | yes |
   | Media/Creative | shortcut "Always assign tasks to" the creative strategist, "when task moves to this location" | yes | yes |
   | All Tasks | none (0 active, 0 inactive) | n/a | n/a |

   This explains every pattern in sections 3.1 and 7. Form tickets reach an
   owner only on Operations / Tech and Media/Creative. Cockpit tickets created
   straight on Operations / Tech or Marketing / ADs get nobody (for example
   `z8xmdvjzb7`, `z8xmdvh7vn`). Form tickets moved onto Client Success get
   nobody (all 6 General CSM tickets and all 4 WhatsApp tickets).
3. **Templates assign nobody.** None of the 28 template source tasks has an
   assignee, a checklist-item assignee, a tag, a subtask, a priority or a due
   date (F4). Owners come only from the list rules above.
4. **Client Pause and Client Relaunch have two folder rules each** (Tech and
   Media). Both fire on one task. The task gets both checklists and ends on
   whichever list the last move chose: `86eytarzg` on Operations / Tech,
   `86eyrnqxg` on Marketing / ADs, both with both checklists. Section 3 read
   this as "one automation"; it is two racing automations.
5. **Template objects are snapshots.** Tasks made from a template carry the
   checklist as it was when the template was saved, not the current source
   task. "Tech pause steps" has 6 items on the source `86ex63k45` but 4 on
   every pause task. "Whatsapp Connection Issue📲❌" tasks get the name but no
   checklist, because the source checklist was added after the template was
   saved.

### F2. Folder automations on `All Assignments 🦅` (26 active, 0 inactive)

Read in the Automations manager, Manage tab, location "All Assignments 🦅".
The summary shows "move to another list" but not which list; the editor that
holds the target was not opened (it is an edit control). Every rule's trigger
is "a task is created" plus the condition shown.

| Rule | Condition | Actions | Template applied (object id by name) |
|---|---|---|---|
| #1 "New form request > apply template and send to operations list" | Request Type = Connect a New Lead Form 🆕 | move, template, rename, **add a comment** | Connecting a new lead form `t-86ex09tmh` |
| #2 "Missing leads request > apply template and send to operations list" | Missing Leads ❌ | move, template, rename | Missing Leads ❌ `t-86ex09vmq` |
| #3 "New Employee Onboarding > Send to list & Apply template" | New Employee Onboarding 🤵 | move, template, rename | New Employee Onboarding 🙋‍♂️ `t-86ex09ytj` |
| #4 General Tech Request | General Tech Request | move, rename | none |
| #5 General Marketing Request | General Marketing Request | move, rename | none |
| #6 General CSM Request | General CSM Ticket | move, rename | none |
| #7 Whatsapp Disconnnected | Whatsapp Connection Issue 🔁 | move, template, rename | Whatsapp Connection Issue📲❌ `t-86ex62m1b` |
| #8 New Script Request | New Script Request 📗 | move, template, rename | New Script Request✍️ `t-86ex63j6n` |
| #9 Client Pause (Tech) | Client Pause Request ⏸️ | move, template, rename | Client Pause ⏸️ (Tech) `t-86ex63qk5` |
| #10 Client Pause (Media) | Client Pause Request ⏸️ | move, template, rename | Client Pause ⏸️ (Media) `t-86ex63qm7` |
| #11 Client Relaunch (Tech) | Client Relaunch Request ⏯️ | move, template, rename | Client Relaunch 🚀↪️ (Tech) `t-86ex63qhr` |
| #12 Client Relaunch (Media) | Client Relaunch Request ⏯️ | move, template, rename | Client Relaunch 🚀↪️ (Media) `t-86ex63qjj` |
| #13 Create TikTok Ad Account | Create Ad Account AND ADs Platform = Tiktok | move, template, rename | Create TikTok Ad Account 🎵 `t-86ex6ee7a` |
| #14 Create Snapchat Ad Account 👻 | Create Ad Account AND ADs Platform = Snapchat | move, template, rename | `t-86ex6ehwe` |
| #15 Create Meta Ad Account 🛜 | Create Ad Account AND ADs Platform = Facebook/Meta | move, template, rename | `t-86ex6f3q7` |
| #16 Card Missing 💳 ❌ | Client Card Missing for ADs ❗❗ | move, template, rename | `t-86ex6fdwu` |
| #17 Ad Spend Invoice Request 🧾 | AD Spend Invoice Request🧾 | move, template, rename | `t-86ex6fpu3` |
| #18 Create Landing Page📊 | Create Landing Page📊 | move, template, rename | `t-86exer2gv` |
| #19 Low Show Rate📉 | Low Show Rate📉 | move, template, rename | `t-86exj3ddv` |
| #20 Low Schedule Rate📉 (Ads) | Low Schedule Rate📉 AND Schedule Rate Issue = Ads issue | move, template, rename | (Ads) `t-86exj3cvt` |
| #21 Low Schedule Rate📉 (Call Center) | … AND Schedule Rate Issue = Call Center Issue | move, template, rename | (Call Center) `t-86exj3d37` |
| #22 Low Schedule Rate📉 (Both) | … AND Schedule Rate Issue = Both | move, both templates, rename | `t-86exj3d37` + `t-86exj3cvt` |
| #23 Switch Funnel Intent🌪️ | Switch Funnel Intent🌪️ | move, template, rename | **"Switch to funnel intent🌪️" `t-86exj3gfx`**, not the "Switch funnel intent level🌪️" `t-86exj3gk4` that matches the source task `86exj3gab` |
| #24 Add custom qualification questions🙋 | Add Custom Qualification Questions🙋 | move, template, rename | `t-86exj3gx1` |
| #25 "When task created, then change List, and apply template…" | Whatsapp Reactivation Campaign 📬 | move, two templates, rename | Client Reactivation Campaign📣 (Tech) `t-86exj3h8f` and Client Reactivation Campaign📣 `t-86exghd6t`; the (Media) `t-86exj3g1a` is not applied |
| #26 Social Media Management Request | Social Media Management Request | **move only** (no template, no rename) | none; "Social Media Management Template" `t-86exy04v4` exists but is unused |

Rule #26 was created by the CEO on 2026-09-18 (info tooltip). The Call
Center list rule was created by former team member `107698869` on 2026-03-20
and last updated by the CEO on 2026-04-02 (info tooltip). Other creation
dates were not read.

**Types with no folder rule (11):** Employee Offboarding 👋, Create a Privacy
Policy Request 📝, Client Offboarding Request 🔴, Change From DFY to DWY 🔁,
Change From DWY to DFY 🔁, Change Company Name🔃, Change Company Address🔃,
Client Success Management Request 🙋‍♂️, Client Business License is Missing ❗,
Marketing/ADs Request 🃏, Edit Existing Campaign Request 🎱. Templates exist
for four of them and are never applied: Client Offboarding (Tech) `t-86ex629ve`
and (Media) `t-86ex629x6`, Change Company Name `t-86exj3n5t`, Change Company
Address `t-86exj3ngz`.

### F3. List automations (Manage tab, location = each list)

| List | Active / inactive | Rules read |
|---|---|---|
| Operations / Tech `901816723190` | 1 / 0 | "Automation #1 - When task created in Operations List Assign Y": **When an existing task is moved here then assign** the systems manager (name shown in the summary) |
| Marketing / ADs `901816723196` | 3 / not read | #3 "When task is created in Marketing List Assign Marketer": When an existing task is moved here then add assignees (no name in the summary). #2: When list field "Request Type" `09abf737-302f-422a-9d17-8fb9619903d1` changes from Ads Failed to Ads Active then set status complete and call a webhook. #1 "When Payment Failed is Submitted -> Alert Client and Team": task created AND that field = Ads Failed then add assignees, call a webhook, rename |
| Call Center `901816723206` | 1 / not read | "When task Call Center Task Created Assign CCM": When a task is created then add assignees (no name) |
| Client Success `901816723211` | 2 / not read | #3: When a task is created then add and remove assignees (no name). #1 "When Campaign Launch is created send to Marketing List": task created AND Type of Submission `d3ac52c5-b71c-4782-9fea-1f9371cbae47` = Campaign Launch Request 🚀 then move to another list, rename |
| Media/Creative `901818016338` | 1 / not read | Shortcut "When task moves to this location, then change assignee": Always assign tasks to user `113520400` (creative strategist; avatar file name read from the page) |
| All Tasks `901816723226` | 0 / 0 | none |
| WhatsApp Reconnection `901821803697` (same folder) | 2 / not read | "Notify Webhook On Task Creation"; "Notify Webhook On Status Change" (GoGHL Reconnect Link changes AND status = review required → call a webhook) |

Two things for builders. **Marketing / ADs has two fields named "Request
Type"**: the folder field `e9fd8024-…` (31 options) and a list field
`09abf737-…` (Ads Failed, Ads Active). Look fields up by id, never by name.
The names hidden in "add assignees" need the rule editor to read (see F12).

The Activity tab (workspace, last week) shows the Media/Creative shortcut
running on Media/Creative tasks the API user created on 2026-10-20 and
2026-10-21. It also shows a Clients - Mahara rule, "Automation #6 - When
comment is added, then send webhook", failing on every run listed from
2026-10-20 to 2026-10-25 (15 failures, 0 successes). That is outside the
ticket form but worth a look.

### F4. Task Templates `901816723408`: 28 source tasks, 34 template objects

All 28 source tasks: assignees none, checklist-item assignees none, tags
none, subtasks none, priority none, due date none, custom fields none. The
creator is a watcher (the CEO on 26; nobody on `86ex09yn5` and `86ex09yrf`,
made by former team member `107698869`). **Applying a template assigns
nobody.** Due dates come from the form's Deadline field, not the template.
Template objects come from `GET team/90182518398/taskTemplate` (pages 0 to 2,
34 objects, id and name only; no API returns their content).

| Source task | Checklist (items) | Who the steps address | Applied by folder rule |
|---|---|---|---|
| Connecting a new lead form 📥 `86ex09rtq` | Checklist (4) + SOP doc | tech (GHL integration) | #1 |
| Missing Leads ❌ `86ex09vea` | Lead recovery checklist (7) | tech / media | #2 |
| New Employee Onboarding 🙋‍♂️ `86ex09yn5` | Checklist (5), incl. "Add them to department automations on Clickup" | admin / systems manager | #3 |
| Employee Offboarding 👋 `86ex09yrf` | none; status pending; no template object | | none |
| Client Offboarding (Media) 👋❌ `86ex622wm` | Media offboarding checklist (8) + empty Checklist (0) | media buyer; ends "CSM notified in Slack" | none |
| Client Offboarding (Tech) 👋❌ `86ex6238q` | Tech offboarding checklist (9) | systems manager; ends "CSM notified in Slack" | none |
| Whatsapp Connection Issue📲❌ `86ex62km0` | Resolution checklist (6): contact the client, share the QR link | CSM or tech | #7 (snapshot has no checklist) |
| New Script Request✍️ `86ex63hnu` | Script delivery checklist (8) + Loom and doc | creative strategist; notifies the media buyer | #8 |
| Client Pause ⏸️ (Tech) `86ex63k45` | Tech pause steps (6; tasks get 4) | systems manager | #9 |
| Client Pause ⏸️ (Media) `86ex63k4n` | Media pause checklist (5) | media buyer | #10 |
| Client Relaunch 🚀↪️ (Tech) `86ex63kvz` | Tech relaunch completion (7) | systems manager | #11 |
| Client Relaunch 🚀↪️ (Media) `86ex63kwr` | Media relaunch checklist (5) | media buyer | #12 |
| Create TikTok Ad Account 🎵 `86ex6ee2t` | 14 steps (alias workflow) | tech / media buyer | #13 |
| Create Snapchat Ad Account 👻 `86ex6ehu8` | 12 steps | media buyer | #14 |
| Create Meta Ad Account 🛜 `86ex6em6p` | 4 groups, 19 sub-steps | media buyer / CSM with client | #15 |
| Card Missing 💳 ❌ `86ex6fd9v` | 6 steps; "Forward card info to media buyer via Slack" | CSM | #16 |
| Ad Spend Invoice Request 🧾 `86ex6fppm` | 6 steps; "Send invoice to client" | CSM / billing | #17 |
| Create Landing Page📊 `86exeqv00` | 5 groups, 35 items; "Send full URL to media buyer" | systems manager | #18 |
| Mark Client As Live✅ `86exfnrnt` | none; no template object | | not a Request Type |
| Client Reactivation Campaign📣 `86exghd48` | Execution checklist (16), "Receive launch ticket from Creative Strategist" | systems manager | #25 |
| Client Reactivation Campaign (Media)📣 `86exj39z3` | 16 steps, "Confirm Tech Team has updated…" | creative strategist | not applied |
| Low Schedule Rate📉 (Call Center) `86exj3cej` | 9 steps (CRM sync, speed to lead, intro calls) | call centre lead | #21, #22 |
| Low Schedule Rate📉 (Ads) `86exj3ce1` | 10 steps (radius, lookalike, intent) | media buyer | #20, #22 |
| Low Show Rate📉 `86exj3d5g` | 10 steps (booking window, reminders, intro calls) | call centre / CSM | #19 |
| Switch funnel intent level🌪️ `86exj3gab` | 10 steps; "Notify CSM/MB the swap is live" | systems manager | #23 applies a different object |
| Add custom qualifiation questions🙋 `86exj3grw` | 11 steps; "Send screenshot to CSM" | systems manager | #24 |
| Change Company Name⏎ `86exj3mx6` | 10 steps (GHL, sheets, Drive, WhatsApp, call centre KB) | systems manager | none |
| Change Company Address📍 `86exj3n8y` | 4 steps | systems manager | none |

Template objects with no source in this list: Tech Onboarding `t-86ex8x9xw`,
Media Onboarding 2.0 `t-86ex8xaf1`, Creative Onboarding `t-86eyu1w3d`, Add
Custom Values to Client's sub account `t-86ex1965m`, Lanuch New Client
Campaign 🚀 `t-86ex1964h`, Social Media Management Template `t-86exy04v4`.

### F5. The lists and the form view

`GET list/{id}` on all 11 lists in the folder (the 7 named plus WhatsApp
Reconnection, Client Portal Tasks `1100530000000279`, Web Development
`901818343027`, CEO `1100530000000339`): **no list owner** (`assignee` null),
no list priority, no list due date, no description. Statuses are the space
set (section 2.3) except Media/Creative, which overrides them with "to do, in
progress, review required, done footage pending, complete, cancelled", and
Task Templates. `GET view/2kzmr1ky-1178` returns only id, name, type, parent,
visibility, protection, creator and date; it names no target list and no
assignee. The "Total time in Status" ClickApp is off in this workspace, so
time in status could not be read (`clickup_get_bulk_tasks_time_in_status`
error); F7 uses created-to-done instead.

### F6. Written rules found

- mahara-context `systems/Mahara OS V2/06 - ClickUp Structure.md:74-83`: the
  internal request flow is form, conditional logic, template, department
  list, then the assigned employee is notified. `:97-101`: the folder's
  automations decide who is assigned when a task enters a list, must be
  updated by hand whenever people join or change roles, or else tasks "sit
  unassigned".
- `systems/Mahara Media Master Systems & Operations Manual.md:37` and `:131`:
  set each list's automation to assign the right employee; route general
  templates through folder automations keyed on the form option.
- `systems/Mahara Media ClickUp SOP.md:599-613`: one assignment automation per
  department, each pointing at that department's employee, set by hand.
- Template `86ex09yn5` step 3: add a new hire "to department automations on
  Clickup". Nobody wrote the reverse step for leavers (`86ex09yrf` is empty),
  which fits Marketing / ADs and Call Center now assigning nobody visible.
- ClickUp Doc "Important Forms" `2kzmr1ky-4598`, page `2kzmr1ky-1438`
  (systems manager, 2026-05-24): Typeform links only (post-call `fRokTITH`,
  old kickoff `BbJy6xg4`, onboarding `KFRCXPFx`, three upsells, referral).
  Nothing on the ticket form or routing. Doc searches for ticket, Request
  Type, automation, routing, assign and SOP found no routing SOP. The March
  2026 handoff list `901816817536` has titles only, for example "Add
  department pings driven by ClickUp assignments" `86ex01t4x` (no body, no
  comments).
- Slack #tech-general `C0AS2JLMJCB` ts `1788957846.342129` (2026-09-09): the
  CEO pays for the ClickUp plan for conditional form logic; "the only time we
  use it is for the ticketing form." ts `1789052612.482799` (2026-09-10): the
  systems manager built the Typeform version; attaching it to ClickUp
  automations was the last step left.
- Slack #tech-general ts `1777993519.789019` (2026-05-05): the CEO asked to
  rebuild six tickets (review, referral, backend program, website and SMM
  upsells, client update) on Typeform and Make, linking a Google Doc "Client
  Ticketing System" (`1hdxptlTqsVwDG2yGrTdYTeQv0fp47959D_adnhvtSak`). That doc
  is an outside course template. It describes the pattern (form → task →
  assign the department or person → SOP checklist → deadline → update on the
  client record) and names no Mahara owners. The old Make "Universal Ticket
  Assignment" `8063994` and "SOP-Specific Ticketing System To PM Tool"
  `8064859` came from it (F10).
- Slack DM with the CEO's assistant agent `D0BSRJF3XEW`, thread
  `1788927005.572529`, message `1789649607.401409` (2026-09-17): an audit of
  222 folder tasks found 187 with no Request Type, and ClickUp has no
  automations API. Its handover pack on the VPS
  (`/opt/data/bibi/workspace/video-pipeline-automation/`, read only) holds a
  proposed field set for three ticket branches and 8 automations for the
  **Video Pipeline**, not for the ticket form. Its browser prompt says New
  Script Request "writes to Media/Creative" and Create Landing Page "writes to
  Operations / Tech", which matches F7.
- Slack #health `C0BC6MPL6LU` ts `1790516541.904829` (2026-09-27): a task the
  "Assign" worker created on the Media board got HTTP 400 on all 9
  custom-field writes, so it has no Request Type.

### F7. Evidence per Request Type (up to 3 latest tasks each)

Creator roles from `creator.id`; ClickBot = `-1`. Checklists on every
templated task below were added by ClickBot (`creator -1`), which marks a
ClickUp automation. Days = created to done.

| Request Type | Tasks | Creator | List | Assignee | Checklist | Days | Rule it follows |
|---|---|---|---|---|---|---|---|
| Connect a New Lead Form 🆕 | `86exkgjcu` | media buyer B | Ops / Tech | systems manager | Checklist (4, old version) | 0.0 (cancelled) | #1 → Ops / Tech → list rule |
| Whatsapp Connection Issue 🔁 | `86expd2d9`, `86exetc7e`, `86excm8pw` | systems manager ×3 | Client Success | none | none | 99.7, 9.0, 125.8 | #7 → Client Success; no assign (create-only rule) |
| Client Offboarding Request 🔴 | `z8xmdvf7vy`, `86eyuyv8w`, `86eyjjky6` | ClickBot, systems manager ×2 | All Tasks | none | none | open | no rule |
| Client Pause Request ⏸️ | `86eytarzg`, `86eyrnqxg`, `86eyk56b6` | ClickBot ×2, systems manager | Ops / Tech, Marketing / ADs, Ops / Tech | systems manager, none, none | Media (5) + Tech (4) on all three | 1.1, 2.0, 23.0 (cancelled) | #9 + #10 race |
| Create Landing Page📊 | `86eywpbt0`, `86exkgjk9` | CEO, media buyer B | Ops / Tech | systems manager | Landing page (35) | 23.1, 0.8 | #18 → Ops / Tech |
| Client Success Management Request 🙋‍♂️ | `z8xmdvh26g` | media buyer B | All Tasks | none | none | open | no rule |
| New Script Request 📗 | `z8xmdvhmh8`, `z8xmdvfafv`, `z8xmdve4qd` | CEO ×3 | Media/Creative | none, creative strategist, creative strategist | Script delivery (8) | open, open, 3.1 | #8 → Media/Creative → shortcut |
| Marketing/ADs Request 🃏 | `86ex7krbw` | ClickBot | All Tasks | none | none | open | no rule |
| General Tech Request | `86eyvmpxj`, `86exhx4dq`, `86exgw5g7` | CEO ×3 | Form Migration Test, Ops / Tech ×2 | none, systems manager ×2 | none | open, 1.9, 4.9 | #4 → Ops / Tech |
| General Marketing Request | `86exakqj0` | media buyer B | Marketing / ADs | former member `113428463` | none | 28.4 | #5 → Marketing / ADs |
| General CSM Ticket | `86exjmja8`, `86exeunja`, `86exdrk2x` | systems manager, CEO, systems manager | Client Success | none | none | 109.6, 120.8, 122.8 | #6 → Client Success; no assign |

Notes. Seven Client Success tickets were closed within two minutes on
2026-08-29 (06:44 to 06:45), so their long durations are a bulk close, not
work time.
The "CEO" creators are the API user; the creative cockpit's script writer
sets no Request Type (`supabase/functions/cockpit-creative-api/outbox.ts:11-17`),
so these typed script tasks came through the form. Two exceptions are not
explained: `z8xmdvhmh8` (2026-10-13, Media/Creative, unassigned) and
`86eyk56b6` (2026-08-10, Ops / Tech, unassigned).

### F8. Final table

"Lands on" says how it is known: **seen** (tasks), **rule name** (the folder
rule's name says the list), **unknown** (rule exists, target not readable),
**stays** (no rule). The Slack channel is where `hermes/task-assignment-alerts`
posts when the task has an assignee on that list
(`hermes/task-assignment-alerts/worker.py:21-28`, `README.md:6-13`). It posts
nothing for unassigned tasks or for `All Tasks` (`worker.py:69-72`).

| # | Request Type | Asks today | Lands on | Template | Owner role today | Slack channel | Evidence | Confidence |
|---|---|---|---|---|---|---|---|---|
| 0 | Connect a New Lead Form 🆕 | client, platform, form, account, deadline | Ops / Tech (seen, rule name) | `t-86ex09tmh` + comment | systems manager | #tech-general `C0AS2JLMJCB` | F2 #1, F3, `86exkgjcu` | high |
| 1 | Create Ad Account | client, platform, priority, deadline | unknown | per platform `t-86ex6ee7a` / `t-86ex6ehwe` / `t-86ex6f3q7` | unknown | depends on list | F2 #13-15; 0 tasks | low |
| 2 | Missing Leads ❌ | client, platform, deadline | Ops / Tech (rule name) | `t-86ex09vmq` | systems manager | #tech-general | F2 #2 | medium |
| 3 | New Employee Onboarding 🤵 | name, deadline, priority | unknown | `t-86ex09ytj` | unknown | depends on list | F2 #3; 0 tasks | low |
| 4 | Employee Offboarding 👋 | name, email, deadline | stays in All Tasks | none | none | none | no rule, no template object | high |
| 5 | Create a Privacy Policy Request 📝 | nothing (no form rule) | stays | none | none | none | no rule | high |
| 6 | AD Spend Invoice Request🧾 | client, deadline | unknown | `t-86ex6fpu3` | unknown | depends on list | F2 #17 | low |
| 7 | Whatsapp Connection Issue 🔁 | client, deadline | Client Success (seen) | `t-86ex62m1b` (name only) | **none** | none (would be #csm-general `C09RZ0GS0V9`) | F2 #7, F3, 4 tasks | high |
| 8 | Whatsapp Reactivation Campaign 📬 | client, lead list, notes, deadline | unknown | `t-86exj3h8f` + `t-86exghd6t` | unknown | depends on list | F2 #25 | low |
| 9 | Add Custom Qualification Questions🙋 | client, platform, questions, deadline | unknown | `t-86exj3gx1` | unknown | depends on list | F2 #24 | low |
| 10 | Client Offboarding Request 🔴 | client, notes, deadline | stays in All Tasks (seen) | none applied (`t-86ex629ve`, `t-86ex629x6` unused) | **none** | none | 3 tasks open | high |
| 11 | Change From DFY to DWY 🔁 | client, details, deadline | stays | none | none | none | no rule | high |
| 12 | Change From DWY to DFY 🔁 | nothing | stays | none | none | none | no rule | high |
| 13 | Client Pause Request ⏸️ | client, priority, deadline | Ops / Tech or Marketing / ADs (seen, race) | `t-86ex63qk5` + `t-86ex63qm7` | systems manager if Ops / Tech, none if Marketing / ADs | #tech-general or none | F2 #9-10, 3 tasks | medium |
| 14 | Client Relaunch Request ⏯️ | client, priority, deadline | unknown (same race as pause) | `t-86ex63qhr` + `t-86ex63qjj` | as pause | as pause | F2 #11-12; 0 tasks | low |
| 15 | Change Company Name🔃 | client, new name, deadline | stays | none (`t-86exj3n5t` unused) | none | none | no rule | high |
| 16 | Change Company Address🔃 | client, new address, deadline | stays | none (`t-86exj3ngz` unused) | none | none | no rule | high |
| 17 | Switch Funnel Intent🌪️ | client, intent, deadline | unknown | `t-86exj3gfx` (older object) | unknown | depends on list | F2 #23 | low |
| 18 | Create Landing Page📊 | client, goal, copy, video, deadline | Ops / Tech (seen) | `t-86exer2gv` | systems manager | #tech-general | 2 tasks | high |
| 19 | Client Success Management Request 🙋‍♂️ | nothing | stays (seen) | none | none | none | `z8xmdvh26g` | high |
| 20 | Client Business License is Missing ❗ | nothing | stays | none | none | none | no rule | high |
| 21 | Client Card Missing for ADs ❗❗ | client, deadline | unknown | `t-86ex6fdwu` | unknown | depends on list | F2 #16 | low |
| 22 | New Script Request 📗 | client, script fields, deadline | Media/Creative (seen) | `t-86ex63j6n` | creative strategist | #media-general `C0AE8G5MT7Y` | F3 shortcut, 18 tasks | high |
| 23 | Marketing/ADs Request 🃏 | nothing | stays (seen) | none | none | none | `86ex7krbw` | high |
| 24 | Edit Existing Campaign Request 🎱 | nothing | stays | none | none | none | no rule | high |
| 25 | Low Show Rate📉 | client, notes, deadline | unknown | `t-86exj3ddv` | unknown | depends on list | F2 #19 | low |
| 26 | Low Schedule Rate📉 | client, issue, deadline | unknown (by issue) | `t-86exj3cvt` / `t-86exj3d37` / both | unknown | depends on list | F2 #20-22 | low |
| 27 | General Tech Request | deadline, priority, details | Ops / Tech (seen) | none | systems manager | #tech-general | 4 tasks | high |
| 28 | General Marketing Request | deadline, priority, notes | Marketing / ADs (seen) | none | **none visible** (was the former member) | none | F3, `86exakqj0` | medium |
| 29 | General CSM Ticket | deadline, priority, notes | Client Success (seen) | none | **none** | none | 6 tasks | high |
| 30 | Social Media Management Request | client, details, deadline | unknown (move only) | none | unknown | depends on list | F2 #26 | low |

### F9. Types with no owner today, and a proposed default (PROPOSAL)

These are proposals for the cockpit's request-type table, not current rules.
They follow the template steps in F4.

| Request Type | Proposed default owner (proposal) | Why |
|---|---|---|
| Employee Onboarding / Offboarding | systems manager | invites and access (`86ex09yn5`) |
| Create a Privacy Policy Request | systems manager | site and page work |
| Client Offboarding Request | two tasks: systems manager (Tech) and the client's media buyer (Media) | templates `86ex6238q`, `86ex622wm` |
| Change From DFY to DWY / DWY to DFY | CSM | service change owned by client success |
| Change Company Name / Address | systems manager | GHL, sheets, call centre KB steps |
| Client Success Management Request, General CSM Ticket, Client Business License is Missing | CSM | client success work |
| Whatsapp Connection Issue | CSM, systems manager as watcher | contact the client, share the QR link |
| Marketing/ADs Request, Edit Existing Campaign Request, General Marketing Request | the client's media buyer (from the client card), else media buyer A | two media buyers today |
| Client Card Missing for ADs, AD Spend Invoice Request | CSM | client-facing steps (F4) |
| Low Schedule Rate (Call Center), Low Show Rate | CSM until a call centre lead exists | the "CCM" rule assigns nobody visible |
| Low Schedule Rate (Ads), Create Ad Account | the client's media buyer | ads work |
| Missing Leads, Switch Funnel Intent, Add Custom Qualification Questions, Connect a New Lead Form | systems manager | GHL and form work |
| Whatsapp Reactivation Campaign | creative strategist (message) then systems manager (send) | two templates |
| Social Media Management Request | creative strategist | content work |
| Client Pause / Relaunch | two tasks: systems manager and the client's media buyer | ends the race in F1.4 |

### F10. Other team forms

- **Make `8232835` "02. Anonymous Survey (Internal)"** (active, last edited
  2025-12-04; one run on 2026-10-07, 3 operations, status 1). Modules:
  [1] custom webhook, hook `3664783` "Anonymous Form (Internal)", enabled,
  queue 0; [2] Google Sheets add row (spreadsheet `12L2IXtD…`, Sheet1);
  [3] Slack post to `D0925QADD7G`, the CEO's DM with Admin Bot ("New
  Anonymous Form Submitted", 2026-10-07). It maps six fields: keep doing,
  start doing, stop doing, growing personally and professionally, "recommend
  someone to work here" 1 to 10, general feedback. **The sending form is not
  identified.** No Typeform webhook points at hook `3664783`
  (typeform-inventory.md section 1 matched every webhook). The flat
  question-label keys look like a GoHighLevel form webhook. Not verified.
- **No other team-facing ClickUp forms.** `GET view` on the workspace, every
  space, folder and list found exactly the 12 form views in section 5. The
  view listing for Form Migration Test returned HTTP 500.
- Old Monday-era routers (inactive): "Universal Ticket Assignment" `8063994`
  routes by "Department Responsible" (MEDIA & ADS, CLIENT SUCCESS, CALL
  CENTER, PROJECT MANAGEMENT, OPERATIONS, TECH & GHL, VIDEO EDITING) to seven
  Monday boards, each "<company> - General Ticket". "SOP-Specific Ticketing
  System To PM Tool" `8064859` routes 11 task types (New Client Campaign,
  Client Paused, Client Offboard Request, Increase Ad Spend, Additional
  Location, Change Deposit Amount, Transition to Card on File, Change Company
  Name, Change Address, New Creatives) to Slack, and for name changes and new
  creatives also to Monday "Assign To Tech". Route 9's filter is labelled
  "Transition to Card on File" but tests "Change Company Name". Historical
  only.

### F11. Contradictions between the maps, resolved where this task touches them

| Topic | Finding (source) | Verdict |
|---|---|---|
| Make 06 `9209179` failures | All 8 status-3 runs (2026-09-30 14:19 to 2026-10-01 06:39, 4 operations each) carry `RateLimitError` "[429] You have no credits remaining" from the OpenAI `CreateCompletion` module (`GET /scenarios/9209179/logs`, `error` field and `/logs/{id}`). | kickoff-path.md is right. The mistyped Client ID and partial-payload theories do not match these runs. Section 11's "failed runs were not opened" is closed. |
| Make 06 [21] Client Happiness | Module 21 `clickup:editATask` reads the Typeform label (`mappable_answers` `ff7970f7-…`), checks it against a list, then `switch()`es it to the option id (for example Paused → `67c08bcd-…`). | Both maps hold half. It reads by label and writes by option id. |
| Private channel names | `C09SVG6FHGU` = #client-call-feedback, `C09TTGBRQ0G` = #nps-survey-feedback (`slack_read_channel`). `C0AL6QP8HU4` returns `channel_not_found` for this user. | fathom.md and typeform-inventory.md are right. `C0AL6QP8HU4` stays unnamed. |
| Extension Form Link id | `GET list/901816559981/field`: `538b6c6a-4919-41df-ac0b-8da5caea7fcb` = Extension Form Link; `539743c2-b6cd-4eeb-bf2f-abaf64769a5e` = Daily Budget; `8cb9d308-…` = "Current extension (weeks)" (number). | This map is right. One field, two writers. |
| Cockpit extension writes | `cockpit_clickup_writeback_queue`: kind `billing`, 2 rows, state `dry_run`, both 2026-10-19 (SQL `group by kind, state`). | No cockpit extension has reached ClickUp. Gap 9 stands. |
| Slack read-back | `cockpit-media-api/execute.ts:20` compares the exact message text. The assignment worker finds its receipt by `client_msg_id` or a `TA-<id>` marker in `conversations.history` (`worker.py:169-172`, `:281-282`). | slack.md is right. A #csm-general notice should be verified by ts and a marker, not exact text, and must not block the Blueprint close plan. |
| Outboxes for notices | Ticket assignment notices need no new outbox. Set the assignee when the cockpit creates the task on the department list, and `task-assignment-alerts` posts it in that department's channel. | Use one forms outbox for the other notices (choice left to the build). |
| Pause Request filler | Request Type "Client Pause Request ⏸️" is a staff ticket (creators: systems manager, ClickBot). The client-facing Typeform `CTUjv6l3` is a separate form (typeform-inventory.md). | Both exist. The cockpit needs a staff pause ticket and, separately, the client form. |
| Scenario short numbers | This section names scenarios by id only. | |

### F12. Not verified

- **The target list of each "move to another list" action.** The summary
  hides it and the rule editor was not opened (edit control). Targets in F8
  marked "seen" come from tasks; "rule name" from the rule's own title.
- **Who "add assignees" picks** on Marketing / ADs #3 and #1, Client Success
  #3 and Call Center #1. The summary shows no name. Task data suggests
  Marketing / ADs once assigned the former member `113428463` and now
  assigns nobody visible.
- **Template object content.** No API returns it. Object-to-source matching
  in F2 and F4 is by name. Drift is shown by tasks (4 vs 6 pause steps).
- **Two ClickUp behaviours, not tested:** setting Request Type after a task is
  created (as `cockpit-csm-api/core.ts:47` does) should not fire the folder
  rules, because they trigger on creation; and creating a task with Request
  Type already set on a department list may fire them and move and rename the
  task.
- Why `z8xmdvhmh8` and `86eyk56b6` have no assignee.
- Creation dates of rules other than #26 and the Call Center rule.
- Inactive counts on Marketing / ADs, Call Center, Client Success and
  Media/Creative (only Ops / Tech, All Tasks and the folder were checked: 0).
- The sending form behind Make `8232835`.
- The name of `C0AL6QP8HU4`.
- The current GitHub version of mahara-context; the local checkout's files
  are dated 2026-09-16.
