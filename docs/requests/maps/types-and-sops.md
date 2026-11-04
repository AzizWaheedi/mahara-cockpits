# Request types, their lists, templates and SOPs

Read-only map, written 2026-10-26 in worktree `forms-1025` (branch
`tickets-1026`, from main `86ee4e84`). It checks the 31 request types in plan
section 3.3 against ClickUp as it is today and gives each type a list, a
template or SOP steps, an owner rule and its fields. Nothing was created,
edited, submitted, posted or messaged anywhere.

How it was read:

| Tag | Source |
|---|---|
| CU | ClickUp REST `GET` calls run on the VPS with the key read by name (`CLICKUP_API_KEY`, never printed): `team/90182518398/taskTemplate` pages 0 to 5, `list/{id}` and `list/{id}/field` for the 7 folder lists plus Task Templates and WhatsApp Reconnection, `list/{id}/task?include_closed=true&subtasks=true` for every page of the 7 folder lists (968 tasks), `task/{id}` with checklists for the 28 template sources and the sample tickets named below |
| CU-MCP | ClickUp MCP read tools: workspace members, doc search, the "Cockpit SOPs" doc `2kzmr1ky-7418` page list |
| Drive | Google Drive metadata reads for every SOP link found in a template description, title searches, and full reads of four short SOP docs |
| SB | Supabase `SELECT` through `sq.py` (Creative Triage) |
| MC | the local mahara-context checkout, commit `a5de456` (2026-10-26) |
| Slack | two read-only searches |
| CT | `docs/forms/maps/clickup-ticketing.md`, including its Follow-up (F1 to F12) |
| PLAN | `docs/forms/PLAN.md` |

Staff are named by role. ClickUp user ids (CU-MCP members, matched to the
roles in CT Follow-up): systems manager `113459516`, creative strategist
`113520400` (the SMM SOP calls this seat the creative director), CSM
`113688800`, media buyer A `119413219`, media buyer B `113428468`, CEO and API
user `284616470`. Former member `113428463` still appears on old tasks.

---

## 0. What matters most

1. **All 34 template objects still exist** (CU taskTemplate, 2026-10-26),
   with the same ids and names as CT F4. Every template id in the plan's
   3.3 table resolves. No API returns a template object's content; content
   below comes from the source task in Task Templates `901816723408` and from
   tasks made from the template.
2. **Plan row 8 (Whatsapp Reactivation) points at the wrong object.** The
   plan gives Media/Creative `t-86exj3h8f`, but that object is named
   "Client Reactivation Campaign📣 **(Tech)**". The creative strategist's
   message checklist is `t-86exj3g1a` "Client Reactivation Campaign (Media)📣"
   (source `86exj39z3`). For the Tech task, `t-86exj3h8f` (Tech, saved
   2026-05-10) and `t-86exghd6t` (no suffix, saved about 2026-05-05 from
   `86exghd48`) are both Tech execution snapshots by name; folder rule #25
   applies both and never the Media one. Use `t-86exj3g1a` (Media/Creative)
   and `t-86exj3h8f` (Ops / Tech), checked by the systems manager.
3. **Plan row 21 (Card Missing) must not apply its template.** The source
   `86ex6fd9v` sends the client the Client Card Info form `Uju17Z13` (step 2 and
   both message templates). That form collects card number and CVV and is
   retired (typeform-inventory.md §3.10; commit `86ee4e84` removed it from the
   Links pages). Use the drafted steps until the systems manager re-saves the
   template without it.
4. **Two more templates have drifted** besides the two the plan lists
   (Client Pause Tech, Switch Funnel Intent):
   - Client Offboarding (Tech) `t-86ex629ve`: the source has 9 steps; the
     checklist applied by hand on `86eyuyv9f` (2026-09-07) has 7. The two
     Churn Tracker steps are missing.
   - Whatsapp Connection Issue `t-86ex62m1b` applies no checklist at all (4
     of 4 tickets have none; CT F1.5). Its 6 source steps are given below as
     a fallback.
   - Connecting a new lead form `t-86ex09tmh` carries older wording of 2 of
     its 4 steps (`86exkgjcu`); harmless.
5. **Three templates contradict the CEO's rules.** Low Show Rate `86exj3d5g`
   step 1 measures against "the 75 percent target"; the client show-rate line
   is 60% (memory show-rate-rule, 2026-10-12). Both Low Schedule Rate sources
   (`86exj3cej`, `86exj3ce1`) gate on "CPL $25"; the official gate is $15 per
   lead and $60 per booking (memory kpi-gates). Re-save all three before
   seeding (add to C3).
6. **"Media buyer of record" resolves to nobody today.** The plan reads it from
   the Blueprint `launch_assignee` setting; `cockpit_blueprint_settings` holds
   only `close_route` (SB). Until it is set, the 8 media buyer owners (types 1,
   10, 13, 14, 23, 24, 26, 28) have no named person. The screen must say so
   ("No media buyer of record. Set one in Settings."), never assign nobody in
   silence. Evidence of who does ads tickets: on Marketing / ADs in the last 60
   days, media buyer B is on 8 tasks, the systems manager on 6, media buyer A
   on 0, and 32 of 47 have nobody (CU).
7. **Create Ad Account work went to the systems manager in October**, not a
   media buyer: `z8xmdvhzug`, `z8xmdvhzuk`, `z8xmdvj871` (systems manager) and
   `z8xmdvhzuf` (systems manager and media buyer B). The plan says media buyer
   of record. Check with the systems manager.
8. **WhatsApp disconnections now arrive on another list.** The ClickUp form
   "Report WhatsApp Disconnection" (`2kzmr1ky-6778`) has put 7 tasks on
   WhatsApp Reconnection `901821803697` since 2026-09-23 (2 on 2026-10-25),
   all unassigned, 5 open. The last type-7 ticket was 2026-05-21. That list
   is not watched by `task-assignment-alerts` and its two webhooks' target is
   not known (PLAN 3.10).
9. **Written SOPs exist for two types the plan has no template for:**
   Change From DFY to DWY (MC `systems/Projects/DWY - DFY-to-DWY Switch SOP
   (Internal).md`, same text as Google Doc `1CVVFt…` by the systems manager)
   and Social Media Management (Drive "Creative Director SOP — Social Media
   Management" `1eSsQi…`, 2026-09-18). Their steps below are condensed from
   those SOPs. A third, "Client Wants To Pause — SOP" (Drive `1qctuH…`), is the
   CSM's step before a pause ticket.
10. **The SOP link on Switch Funnel Intent is mis-titled.** Doc `1do0ql…` is
    titled "Tech SOP — Add qualification questions", but its body is the
    intent-ladder funnel swap (read in full). The link is right; the title
    is misleading.
11. **Request Type option 0 has stray spaces**: its name is
    `"Connect a New Lead Form  🆕 "` (two spaces before the emoji, one
    after). A name lookup must trim and collapse spaces, or use the option id.
    All 31 option ids match CT §2.2 (CU `list/901816723190/field`).
12. **Form rules were not re-read today.** The public form definition is loaded
    from a ClickUp shard; 12 shard hosts returned "Form not found" or the page
    shell. The fields per type below are CT §2.2 as read on 2026-10-25, filled
    per PLAN 3.3 where the form has no rule.
13. Since CT was written (2026-10-25) no new ticket with a Request Type was
    created: still 45 typed tasks across the 7 folder lists (CU).

---

## 1. Shared facts

### 1.1 Lists and statuses (CU `list/{id}`, 2026-10-26)

| List | Id | Statuses | List owner | Alert channel (`task-assignment-alerts`) |
|---|---|---|---|---|
| Operations / Tech | `901816723190` | space set | none | #tech-general `C0AS2JLMJCB` |
| Marketing / ADs | `901816723196` | space set | none | #client-ads-general `C0C8DLZGTMZ` |
| Call Center | `901816723206` | space set | none | #csr-general-channel `C09R83NNQV9` |
| Client Success | `901816723211` | space set | none | #csm-general `C09RZ0GS0V9` |
| Media/Creative | `901818016338` | own set (`override_statuses: true`) | none | #media-general `C0AE8G5MT7Y` |
| All Tasks | `901816723226` | space set | none | not watched |
| WhatsApp Reconnection | `901821803697` | space set | none | not watched |

Space set: `to do` (open), `in progress`, `review required`, `pending`,
`complete` (done), `cancelled` (closed). Media/Creative: `to do`,
`in progress`, `review required`, `done footage pending`, `complete` (done),
`cancelled` (closed). Channels from `hermes/task-assignment-alerts/worker.py:21-28`.

Call Center has **no task ever**, archived included (CU `archived=true`), so
nothing there has been seen working.

### 1.2 Owners

| Owner rule | Named id today | Evidence |
|---|---|---|
| `systems_manager` | `113459516` | 12 of 35 Ops / Tech main tasks in 60 days, every typed Tech ticket that got an owner (CU) |
| `csm_of_card` (the card's CSM field, else the active CSM seat) | fallback `113688800` | the only active `csm`-only seat (SB `cockpit_members`); 12 of 15 Client Success tasks in 60 days (CU). SL F4: 33 of 70 cards name an inactive CSM or nobody, so the fallback will be used often |
| `creative_strategist` | `113520400` | 49 of 50 Media/Creative tasks in 60 days (CU) |
| `media_buyer_of_record` | **none** (`launch_assignee` unset, SB) | finding 6 |

Request Type is the folder field `e9fd8024-8abe-4094-ac08-e6c0e736ad7e` on all
five department lists (CU). Marketing / ADs also has a list field named
"Request Type" `09abf737-302f-422a-9d17-8fb9619903d1` (Ads Failed, Ads Active).
Never set it on a ticket: Marketing / ADs list rule #1 fires on it.

### 1.3 What can fight an owner the cockpit sets

| # | Rule | Fires when | Effect on a cockpit ticket | Evidence |
|---|---|---|---|---|
| 1 | Client Success list #3 "add and remove assignees" | a task is created on Client Success | can add someone and remove someone the cockpit set | Two media buyer reroutes created with no assignee (`86eyw9wk4` 2026-09-12, `z8xmdvec0k` 2026-09-23; the writeback body sets none, `clickup-writeback/queue.ts:140-148`, and the old Convex writeback sets none) now carry the CSM `113688800`. So the rule most likely adds the CSM. But `z8xmdvhzuz` kept only the CEO, and `z8xmdvg6vx` and `z8xmdvj875` have nobody (CSM a watcher on `z8xmdvj875`). Who it removes, and under which condition, is not readable (CT F12) |
| 2 | Call Center list #1 "Assign CCM" (add assignees) | a task is created on Call Center | adds a person whose name the summary hides | the list has never held a task, so it has never been seen firing |
| 3 | Media/Creative shortcut "always assign to `113520400`" | a task moves to (and per CT F3, is created on) Media/Creative | adds the creative strategist; `z8xmdvj876` kept two editors beside him, so it seems to add, not replace | CT F3; `z8xmdvhmh8` (2026-10-13) stayed unassigned, not explained |
| 4 | Marketing / ADs #3 "add assignees" | an existing task is moved here | none for a task created on the list; fires if a folder rule moves a ticket in | CT F3 |
| 5 | Marketing / ADs #1 (Payment Failed) | created and list field `09abf737` = Ads Failed | adds assignees, calls a webhook, renames | CT F3; avoid by never setting `09abf737` |
| 6 | Client Success #1 (Campaign Launch) | created and Type of Submission `d3ac52c5-…` = Campaign Launch Request 🚀 | moves the task to Marketing / ADs and renames it | CT F3; never set `d3ac52c5` on a ticket |
| 7 | Operations / Tech #1 | an existing task is moved here | assigns the systems manager | CT F3; no effect on a task created on the list |
| 8 | The 26 folder rules | "a task is created and Request Type is X" | move, apply a template again, rename; pause, relaunch and low schedule (both) apply two templates | CT F2. Never put Request Type in the create body; set it last, as PLAN 3.3 says. Whether setting it after create fires them is untested (CT F12); the `[TEST]` tickets in PLAN 3.3 settle it |
| 9 | `task-assignment-alerts` | a person is added | each added person gets a second alert; removal posts nothing | `README.md` Behaviour. A list rule that adds a second owner makes a second post |
| 10 | Clients - Mahara "Automation #6 - When comment is added, then send webhook" | any comment on a client card | not an owner change, but the link comment the cockpit adds on the card fires it, and it failed on all 15 runs listed 2026-10-20 to 10-25 | CT F3 |

The 2-minute owner re-read in PLAN 3.3 covers rules 1 to 3. Rules 1 and 2
should go off after go-live (PLAN 3.3 Retire, C3).

### 1.4 Seeding rules this map suggests

- Match each object id to its name from `GET team/90182518398/taskTemplate`
  at seed time and refuse a mismatch (PLAN 3.3). Names today are in the JSON
  sources and in section 2.
- After creating from a template, read the checklists back. Where the task
  has no checklist, add `sop_steps` as a checklist named "SOP steps". That
  covers Whatsapp Connection Issue today and any future empty snapshot.
- `sop_steps` marked "draft — check with the systems manager" are proposals.
  Show them on `/requests/settings` as drafts until an editor saves them
  (D17).
- Due dates: no template sets one (CT F4). Typed tickets closed in a median of
  1.5 days (General Tech, n=4), 2.0 (Pause, n=3), 12.0 (Landing Page, n=2) and
  28.5 (New Script, n=16) (CT §4). WhatsApp and General CSM figures are bulk
  closes, not work time (CT F7).

---

## 2. The 31 types

"Asks" is the ClickUp form's rule for the type (CT §2.2, read 2026-10-25;
`*` = required). "Fill" means the form has no rule and PLAN 3.3 fills client,
details, deadline and priority. Client = task tag plus the card's task id.

### 0. Connect a New Lead Form 🆕

- Option `37d99ca0-e53f-4499-90e8-f1be8a21b207` (name has stray spaces, finding 11).
- List: Operations / Tech. Owner: systems manager `113459516`.
- Template `t-86ex09tmh` "Connecting a new lead form": exists. Source `86ex09rtq`: "Checklist" (4) plus the SOP link. The one ticket, `86exkgjcu` (2026-05-13, filed by media buyer B, systems manager, cancelled), got the 4 steps in older wording. Folder rule #1 also adds a comment (CT F2); the cockpit adds no extra comment.
- Asks: client*, ADs Platform, AD Form Name*, AD Account Name*, deadline*, priority.
- SOP: Drive `1cNcRm…` "Connecting Ad forms to CRM ( Tiktok - Snapchat - Meta )" (exists, 2026-04-07).

### 1. Create Ad Account

- Option `fd4d330d-2bda-4872-b195-11e694b29231`.
- List: Marketing / ADs (PLAN; the folder rule's target is not readable, CT F12). One task, template by ADs Platform: Facebook/Meta `t-86ex6f3q7`, Tiktok `t-86ex6ee7a`, Snapchat `t-86ex6ehwe`. All three exist.
- Sources: `86ex6em6p` "Meta setup (high-level)" (4 groups) plus Drive `1H1joz…` "Setting Up A Facebook Page & Ad Account SOP"; `86ex6ee2t` "TikTok Ad Account setup (alias workflow)" (14) plus Loom and Drive `1tbwAo…` "Tiktok Ad Account SOP"; `86ex6ehu8` "Snapchat Ad Account setup" (12) plus Loom and Drive `1ZFn0-…` "Snapchat Ad Account SOP". The one TikTok task made from it (`86excxhw4`, 2026-04-26) matches its source.
- Owner: PLAN says media buyer of record (none set today, finding 6). Evidence says the systems manager did October's ad-account work (finding 7). **Check with the systems manager.**
- Asks: client*, ADs Platform*, priority*, deadline*.
- 0 typed tickets ever.

### 2. Missing Leads ❌

- Option `9fd304bb-7078-4485-9b9f-aa19ad47ed98`.
- List: Operations / Tech (the folder rule's name says so). Owner: systems manager.
- Template `t-86ex09vmq`: exists. Source `86ex09vea` "Lead recovery checklist" (7) plus Drive `1WOZE2…` "Missing Leads SOP".
- Owner evidence: no typed ticket. The closest task, `z8xmdvj86w` "Fix new leads not reaching the dialer" (2026-10-17, Ops / Tech), had media buyer B and the systems manager.
- Asks: client*, ADs Platform*, deadline*, priority.

### 3. New Employee Onboarding 🤵

- Option `88ab0389-7e36-4714-8b65-6d966ce9aed1`.
- List: Operations / Tech (PLAN; target not readable). Owner: systems manager.
- Template `t-86ex09ytj`: exists. Source `86ex09yn5` "Checklist" (5): invite to Slack, invite to ClickUp, add to department automations on ClickUp, invite to GHL, add to Agent Info if a dialer. Once the cockpit owns routing, "department automations" should read "the cockpit's owner rules"; the systems manager re-saves the template.
- Asks: Employee Full Name*, deadline*, priority*.
- SOP: none found (ClickUp doc search, Drive title search).
- 0 typed tickets ever.

### 4. Employee Offboarding 👋

- Option `504c3ffc-9264-4402-b03e-f349d0d8cbe0`.
- List: Operations / Tech. Owner: systems manager. No folder rule, no template object; the source `86ex09yrf` is empty (status pending).
- Asks: Employee Full Name*, Employee - Email*, deadline*, priority.
- SOP steps, **draft — check with the systems manager** (from the onboarding source reversed, MC `calendar-offboarding.md`, memory team-hours and team-only-seats; CT F6 found nobody wrote a leaver step):
  1. Confirm the last working day and the seat with the requester.
  2. Remove the person from Slack and ClickUp, and from any cockpit owner rule or ClickUp list rule that names them.
  3. Remove their GoHighLevel user; for a dialer, remove their row in Agent Info.
  4. Turn off their cockpit seat and end their Hubstaff and Timetastic seats.
  5. Swap them out of every future calendar meeting and give their open tasks a new owner.
  6. Move the files and logins they own to a company account, then suspend their Google Workspace user.
  7. Post in the department channel that access is removed, then mark the task complete.

### 5. Create a Privacy Policy Request 📝

- Option `5552a329-4e97-45d6-a195-9097e7df5cf5`.
- List: Operations / Tech. Owner: systems manager. No form rule, no folder rule, no template, 0 tickets, 0 ClickUp search hits.
- Fields: fill, plus Privacy Policy - Type `5000c43f-18a7-4c50-bf7b-60d59ca41417` (short text; no options).
- SOP steps, **draft — check with the systems manager**, weak evidence (MC client-launch-campaign skill: a Meta app needs a privacy policy URL; lead form policy is off by default; Slack #tech-general 2026-06-17, the systems manager asked for a privacy policy URL):
  1. Read Privacy Policy - Type: which page needs it (lead form, landing page, app or website).
  2. Confirm the client's legal name, address, contact email and the data the form collects.
  3. Write the policy page in the client's GoHighLevel sub-account, starting from the last policy page the team published.
  4. Publish it on the client's domain and check the link opens without a login.
  5. Add the link where it is needed (lead form, page footer or app settings).
  6. Paste the URL in the task and in a comment on the client card, tell the requester, and mark the task complete.

### 6. AD Spend Invoice Request🧾

- Option `a82b0b80-e4f7-4f30-a3a5-49a5ea4c7f2d`.
- List: Client Success (PLAN; target not readable). Owner: CSM.
- Template `t-86ex6fpu3`: exists. Source `86ex6fppm` "Ad Spend Invoice Workflow" (6): confirm the billing period with the media buyer, pick the invoice from Drive "Ad Spend Invoices" `1q9GBq…` (modified 2026-10-22), send it, confirm payment, tell the media buyer, close.
- Asks: client*, deadline*, priority. 0 tickets ever.
- Related Drive docs, not linked from the template: "Client Billing Workflow — SOP", "Billing And Invoice Reminders SOP" (titles only, not read).

### 7. Whatsapp Connection Issue 🔁

- Option `663ffd51-a838-4038-a8c0-a936b86f43b7`.
- List: Client Success (seen on 4 tickets). Owner: CSM, systems manager as watcher (PLAN). Evidence: the systems manager filed 3 of 4 tickets; none had an owner (CT F3, the Client Success rule fires on create only).
- Template `t-86ex62m1b`: exists, applies **no checklist** (finding 4). Source `86ex62km0` "Resolution checklist" (6). Use these 6 lines as the fallback (source text, not a draft):
  1. Open Agency View in MaharaOS, then WhatsApp, and find the client's account.
  2. Confirm the connection shows disconnected or an error.
  3. Send the client the QR code link to rescan.
  4. Confirm WhatsApp shows active (green).
  5. Tell the requester in Slack that it is resolved.
  6. Mark the task complete.
- Asks: client*, deadline*, priority.
- SOP: Drive `1uQpWk…` "WhatsApp Integration — Connecting a Client's WhatsApp to the CRM" (title read only).
- Overlap: finding 8. Decide whether type 7 goes to WhatsApp Reconnection instead (C3).

### 8. Whatsapp Reactivation Campaign 📬

- Option `862f83da-8980-4ebe-9477-7501ccbf23d3`.
- Two tasks (PLAN): Media/Creative for the message (creative strategist), then Operations / Tech for the send (systems manager).
- Templates (finding 2): Media `t-86exj3g1a` "Client Reactivation Campaign (Media)📣", source `86exj39z3` "Client Reactivation Campaign Checklist" (16), ends with posting in #new-campaigns. Tech `t-86exj3h8f` "Client Reactivation Campaign📣 (Tech)" (no source task by that name; content unknown) or `t-86exghd6t` "Client Reactivation Campaign📣", source `86exghd48` "Execution Checklist" (16), first step "Receive launch ticket from Creative Strategist". All three exist.
- Asks: client*, Lead List*, Additional Notes, deadline*, priority. 0 tickets ever.
- SOPs: Drive `1VRjaZ…` "Reactivation Campaign SOP — Creative Strategist", Drive `1Wdgj5…` "Reactivation Campaign SOP — Tech", Drive "WhatsApp Reactivation Message Library — EN + AR"; MC `systems/Projects/WhatsApp Reactivation Campaign — GoGHL.md`.
- Order: the Tech task waits on the Media one (its first step). Create both; the Tech task's description links the Media task.

### 9. Add Custom Qualification Questions🙋

- Option `7fc82c41-7bcd-47f7-bae0-868d4954495b` (the id `clickup-writeback/rules.ts:59-66` gets wrong, CT §7).
- List: Operations / Tech. Owner: systems manager.
- Template `t-86exj3gx1` "Add custom qualifiation questions🙋": exists. Source `86exj3grw` "Qualification questions checklist" (11), ends "Send screenshot to CSM".
- Asks: client*, ADs Platform*, Qualification Questions*, deadline*, priority. 0 tickets ever.
- SOP: Drive `1YtGLA…` "Tech SOP — Add a custom qualification question".

### 10. Client Offboarding Request 🔴

- Option `d5ab86ae-18af-42d5-abd1-120c3fa2bcc3`.
- Two tasks: Operations / Tech `t-86ex629ve` (systems manager) and Marketing / ADs `t-86ex629x6` (media buyer of record, none set today). Both exist; no folder rule applies them.
- Sources: `86ex6238q` "Tech offboarding checklist" (9; the template carries 7, finding 4); `86ex622wm` "Media offboarding checklist" (8) plus an empty "Checklist". Hand-made tasks `86eyuyv9f`, `86eyv2up2` (Mofag, 2026-09-07) and `86eyjkqzy` (North Gulf, 2026-08-08) were made from these by the systems manager and left unassigned.
- Open requests to import (PLAN Mirror): `z8xmdvf7vy` (2026-10-01, "حول العمران للمقاولات", Additional Notes "Get offboarded asap", priority high, due set), `86eyuyv8w`, `86eyjjky6`. All in All Tasks, unassigned.
- Asks: client*, Additional Notes, deadline, priority.
- SOP: Drive `1tlZlM…` "Client Exit Process" (the CSM's exit call; links the termination form `knIe4eF3`). The media buyer cockpit's offboarding (`docs/media-launch/PAUSE-OFFBOARD.md`) already pauses ads and records four confirmations; the Media task should link that hold, not repeat it.

### 11. Change From DFY to DWY 🔁

- Option `d5a87389-3657-4334-8aee-14d67c2129d3`.
- List: Client Success. Owner: CSM (PLAN). The written SOP's audience is "ops / systems" and most steps are GoHighLevel, Make and Maqsam work. **Check with the systems manager** whether this is a CSM task plus a Tech task, or a Tech task.
- No folder rule, no template, 0 tickets. Asks: client*, Additional Info*, deadline*, priority. The card's Service field is `fccfc09c-650e-4aed-b4cd-3f50beba05a3` (DFY, DWY).
- SOP: MC `systems/Projects/DWY - DFY-to-DWY Switch SOP (Internal).md` (status draft, last commit 2026-09-13) = Google Doc `1CVVFt…` by the systems manager.
- SOP steps condensed from its Part B, **draft — check with the systems manager**:
  1. Confirm the client has a call team and collect each caller's name, email and phone.
  2. Tell the client Mahara now runs ads only, and book the handover call with their team.
  3. Add the callers as users in the client's GoHighLevel sub-account and confirm each gets a test push in the LeadConnector app.
  4. In the client's clone only: turn on "DWY — New Lead → Client Internal Notification", turn off the call centre agent workflows and Mahara webhooks, and set Service Mode to DWY.
  5. Push a dummy lead: the caller is notified and a booking sends one confirmation.
  6. Train the client's callers on the client dialing SOP and paste its link in the Call Center SOP Link custom value.
  7. Stop our dialing: take the client out of Make 8850419 and 8842754, Maqsam routing and Agent Data.
  8. Record the reporting choice (clean cut or keep visibility) and set the card's Service field to DWY.
  9. Confirm no Mahara channel, scenario or sheet still gets this client's leads, then mark the task complete.

### 12. Change From DWY to DFY 🔁

- Option `5e83c505-a5b2-43f1-849c-ce3a11c0c7b1`.
- List: Client Success. Owner: CSM (same question as type 11). No form rule, no folder rule, no template, 0 tickets. Fields: fill.
- SOP steps, **draft — check with the systems manager** (type 11's SOP reversed, §A.3, B.5, B.6):
  1. Confirm the switch date with the client and the call centre.
  2. In the client's clone: turn the call centre agent workflows and Mahara webhooks back on, turn off "DWY — New Lead → Client Internal Notification", and set Service Mode to DFY.
  3. Add the client back to Make 8850419 and 8842754, Maqsam routing and Agent Data.
  4. Restore the client's Client Data row and check its GoHighLevel API key works.
  5. Update the call centre knowledge base and brief the agents on the client.
  6. Push a dummy lead: our agents get the notification and the speed-to-lead tracker fires.
  7. Set the card's Service field to DFY, tell the client who now calls their leads, and mark the task complete.

### 13. Client Pause Request ⏸️

- Option `196991a9-dac9-4da8-a693-6b6d64372be5`.
- Two tasks: Operations / Tech `t-86ex63qk5` (systems manager) and Marketing / ADs `t-86ex63qm7` (media buyer of record). Both exist.
- Sources: `86ex63k45` "Tech pause steps" (6; every pause task got 4, missing "Database - MAHARA > marked as paused" and "Churn Tracker > Payment Log > Mark As Paused"); `86ex63k4n` "Media pause checklist" (5, matches).
- Owner evidence: `86eytarzg` (Ops / Tech, systems manager), `86eyrnqxg` (Marketing / ADs, nobody), `86eyk56b6` (Ops / Tech, nobody, cancelled); each carries both checklists (two racing folder rules, CT F1.4).
- Asks: client*, priority*, deadline*. The CSM's "Client Wants To Pause — SOP" (Drive `1qctuH…`) says a genuine pause is at most 14 days and comes after a same-day call; a resume date field would help (not on the form today).
- Due evidence: 2.0 days median (n=3).

### 14. Client Relaunch Request ⏯️

- Option `59b89a7c-6970-4aad-8c01-1d7bf58b124a`.
- Two tasks: Operations / Tech `t-86ex63qhr` (systems manager) and Marketing / ADs `t-86ex63qjj` (media buyer of record). Both exist.
- Sources: `86ex63kvz` "Tech relaunch completion" (7, includes a Churn Tracker step, so this snapshot may have drifted like pause; not testable, 0 tickets); `86ex63kwr` "Media relaunch checklist" (5).
- Asks: client*, priority*, deadline*. SOP doc: none found.

### 15. Change Company Name🔃

- Option `bbef2ea6-a3cd-49be-a82d-33352a23f7d0`.
- List: Operations / Tech. Owner: systems manager.
- Template `t-86exj3n5t` "Change Company Name⏎": exists, never applied by a rule. Source `86exj3mx6` "Client Name Change (Summary Checklist)" (10): GHL name and custom values, DATABASE - MAHARA sheet, find and replace across assets, ClickUp card, Drive sheet and folder, WhatsApp group, call centre knowledge base, CSR Accounts sheet.
- Asks: client*, New Company Name*, Additional Notes, deadline*, priority. 0 tickets.
- SOP: Drive `1XOPCo…` "Changing Company Name" (owned outside Mahara, shared 2026-05-10).

### 16. Change Company Address🔃

- Option `9d0997fb-0523-477a-b5fe-54dd3971a614`.
- List: Operations / Tech. Owner: systems manager.
- Template `t-86exj3ngz` "Change Company Address📍": exists, never applied by a rule. Source `86exj3n8y` "Update client address (summary checklist)" (4).
- Asks: client*, New Company Address*, Additional Notes, deadline*, priority. 0 tickets.
- SOP: Drive `1TbkDR…` "Changing Client Address".

### 17. Switch Funnel Intent🌪️

- Option `645a7f4f-a4d8-4fe7-a58c-dda546c40188`.
- List: Operations / Tech. Owner: systems manager.
- Templates: `t-86exj3gk4` "Switch funnel intent level🌪️" (its name matches source `86exj3gab`) and `t-86exj3gfx` "Switch to funnel intent🌪️" (what folder rule #23 applies) both exist. PLAN says re-save from `86exj3gab`; `t-86exj3gk4` may already be that save. Use it if the systems manager confirms; otherwise re-save.
- Source `86exj3gab` "High intent funnel swap checklist" (10), ends "Notify CSM/MB the swap is live".
- Asks: client*, Intent Level*, Additional Notes, Requested Questions, deadline*, priority. 0 tickets.
- SOP: Drive `1do0ql…` (mis-titled, finding 10). Survey bank: Drive "Mahara - High Intent Surveys (Bilingual, 5 Services)" `1uWPfY…`.

### 18. Create Landing Page📊

- Option `a2d9483c-2dde-486d-969e-78679e5d27a6`.
- List: Operations / Tech (seen). Owner: systems manager (2 of 2 tickets: `86eywpbt0`, `86exkgjk9`).
- Template `t-86exer2gv`: exists. Source `86exeqv00` "Landing page setup checklist" (5 groups); both tickets' checklists match.
- Asks: client*, Additional Notes, Requested Questions, Page Goal, Copy Link, Video for Page, deadline*, priority.
- SOP: Drive `1jjyMv…` "SOP-Client-Landing-Page". Due evidence: 12.0 days median (n=2).

### 19. Client Success Management Request 🙋‍♂️

- Option `6cde0a1f-a3f1-43c3-b9f9-7166e6899463`.
- List: Client Success. Owner: CSM. No form rule, no folder rule, no template. The one ticket, `z8xmdvh26g` (2026-10-10, filed by media buyer B), sits in All Tasks, unassigned, with no details. `cockpit-csm-api/core.ts:14` already maps the cockpit's "Client success management request" to this type.
- Fields: fill.
- SOP steps, **draft — check with the systems manager**:
  1. Read the request and open the client's card; ask the requester for anything missing the same day.
  2. Agree the next step and a due date with the requester in the task comments.
  3. Do the work, or book the client call it needs.
  4. Log the outcome on the client card.
  5. Tell the requester it is done and mark the task complete.

### 20. Client Business License is Missing ❗

- Option `b286f3d0-957e-487f-92ef-ae82499c450e`.
- List: Client Success. Owner: CSM. No form rule, no folder rule, no template, 0 tickets. Fields: fill.
- SOP steps, **draft — check with the systems manager**, weak evidence (sibling: the Card Missing source, where the CSM collects from the client and hands to the media buyer; no SOP found):
  1. Ask the requester which account needs the licence (Meta business verification, TikTok, Snapchat or another) and by when.
  2. Message the client in their group asking for a clear copy of the commercial licence and say why.
  3. Save the file in the client's Drive folder.
  4. Send the file location to the requester and confirm they submitted it.
  5. Confirm the platform accepted it.
  6. Log it on the client card and mark the task complete.

### 21. Client Card Missing for ADs ❗❗

- Option `7e7ae553-abde-4cd2-af26-a1cca7be668c`.
- List: Client Success. Owner: CSM (4 of 4 card tickets since 2026-09-12 carry the CSM: `86eyw9wk4`, `z8xmdvec0k`, `z8xmdvhzue`, `z8xmdvhzum`).
- Template `t-86ex6fdwu` "Card Missing 💳 ❌": exists, **withheld** (finding 3). `template_id` is null in the JSON until it is re-saved.
- Asks: client*, deadline*, priority.
- SOP steps, **draft — check with the systems manager** (the source's 6 steps without the card form):
  1. Confirm the ad account is stopped by a missing or failed payment method.
  2. Ask the client to add the card themselves on the platform's billing page, or on a short call while they type it; never collect card numbers in chat or a form.
  3. Check in the ad account that the payment method shows active and any unpaid balance is cleared.
  4. Confirm with the media buyer that ads are running again.
  5. Log it on the client card and mark the task complete.

### 22. New Script Request 📗

- Option `a79b08d7-8e4f-469d-b70f-cba8514a06c3`.
- List: Media/Creative. Owner: creative strategist (17 of 18 typed tickets).
- Template `t-86ex63j6n` "New Script Request✍️": exists. Source `86ex63hnu` "Script delivery checklist" (8) plus a Loom and Drive `1B961T…` "Client Ad Scripting — How to Create, Refine & Deliver Scripts". The latest tickets' checklists match (`z8xmdvhmh8`, `z8xmdvfafv`).
- Asks: client*, Script Type*, Script Style, Orientation*, Script Quantity*, Who Films It*, Script Language*, Arabic Dialect, Additional Notes, deadline*, priority.
- Due evidence: 28.5 days median (n=16).

### 23. Marketing/ADs Request 🃏

- Option `b796a968-347d-43b8-b187-c658b955587e`.
- List: Marketing / ADs. Owner: media buyer of record (none set today). No form rule, no folder rule, no template. The one ticket, `86ex7krbw` (2026-04-11), sits in All Tasks, unassigned, empty. Fields: fill.
- SOP steps, **draft — check with the systems manager** (memory media-buyer-change-sync):
  1. Read the request and open the client's ad account and campaign card.
  2. Ask the requester for anything missing (campaign, goal, deadline) in the task.
  3. Make the change in the ads manager, or say in the task why not.
  4. Log the change in the media buyer cockpit so it reaches the campaign card and the CSM card.
  5. Tell the requester and mark the task complete.

### 24. Edit Existing Campaign Request 🎱

- Option `75095c91-9cc0-4505-ae96-e6317bbeade1`.
- List: Marketing / ADs. Owner: media buyer of record. No form rule, no folder rule, no template, 0 tickets. Fields: fill.
- SOP steps, **draft — check with the systems manager** (memory kpi-gates, client-dos-donts, media-buyer-change-sync):
  1. Confirm the campaign, the change (budget, audience, creative or form) and the reason with the requester.
  2. Check the change against the client's do's and don'ts and the KPI gates ($15 per lead, $60 per booking).
  3. Make the edit in the ads manager and read it back.
  4. Log it in the media buyer cockpit so the campaign card and the CSM card show it.
  5. Recheck the results after 3 days and note them in the task.
  6. Tell the requester and mark the task complete.

### 25. Low Show Rate📉

- Option `d85246c8-7dcc-4294-b981-d1fe8b1221a6`.
- List: Call Center (PLAN; target not readable; the list has never held a task). Owner: CSM until a call centre lead seat exists (the two call centre seats share one login).
- Template `t-86exj3ddv`: exists. Source `86exj3d5g` "Show rate improvement checklist" (10). Step 1 says 75%; re-save with 60% (finding 5).
- Asks: client*, Additional Notes, deadline*, priority. 0 tickets.
- SOP: Drive `1slpC2…` "Call Center SOP — Low show rate diagnosis" (title read only; may carry the same 75%).

### 26. Low Schedule Rate📉

- Option `36ea1d39-4115-4a46-9f18-34664e7adac3`.
- By Schedule Rate Issue (`e58f563a-63c7-4f3a-b5cd-07cbb4a420d4`): Call Center Issue → Call Center `t-86exj3d37` (CSM); Ads issue → Marketing / ADs `t-86exj3cvt` (media buyer of record); Both → both tasks. Both objects exist.
- Sources: `86exj3cej` "Low Schedule Rate SOP checklist" (9) and `86exj3ce1` "Low Schedule Rate SOP Checklist" (10). Both gate on CPL $25; re-save with $15 per lead and $60 per booking (finding 5). The Ads one hands off to type 17 when an intent swap is needed.
- Asks: client*, Schedule Rate Issue*, Additional Notes, deadline*, priority. 0 tickets.
- SOPs: Drive `15RCQB…` "Call Center SOP — Low schedule rate (call center cause)"; Drive `1a3BOC…` "Media Buyer SOP — Low schedule rate (ads / lead-quality cause)".

### 27. General Tech Request

- Option `71c628d0-ee1f-4dc6-90ce-b4da84b7b367`.
- List: Operations / Tech. Owner: systems manager (4 of 5 typed tickets; the fifth, `86eyvmpxj`, is on Form Migration Test, unassigned). No template.
- Asks: deadline*, priority*, Additional Info*. Past asks: a board clean-up (`86exhx4dq`), client status and Make changes (`86exgw5g7`), a survey swap with a Loom (`86exfzeqb`).
- SOP steps, **draft — check with the systems manager**:
  1. Read the request; ask the requester the same day for anything missing (client, link, deadline).
  2. Move the task to in progress and write the plan in a comment.
  3. Make the change and test it end to end.
  4. Write what changed and where in the task.
  5. Tell the requester and mark the task complete.
- Due evidence: 1.5 days median (n=4).

### 28. General Marketing Request

- Option `d52bde7c-13b5-4b1f-a34e-042478f883a6`.
- List: Marketing / ADs. Owner: media buyer of record. The one ticket, `86exakqj0` (2026-04-20, filed by media buyer B, assigned to former member `113428463`), asked to "Schedule four scripts for editing". No template.
- Asks: deadline*, priority*, Additional Notes*.
- SOP steps, **draft — check with the systems manager**:
  1. Read the request and ask the requester for anything missing in the task.
  2. Agree the next step and the due date in a comment.
  3. Do the work, or hand it to the right team with a reason.
  4. Log any ads change in the media buyer cockpit.
  5. Tell the requester and mark the task complete.

### 29. General CSM Ticket

- Option `5db37a3e-f3cd-4513-8e38-750fecfa34c6`.
- List: Client Success. Owner: CSM. All 6 typed tickets were unassigned; most were closed together on 2026-08-29 (CT F7). Past asks were ops work raised by the CSM side (client data sheet country, check-in calls for all clients, a calendar integration: `86exjmja8`, `86exeunja`, `86exdrk2x`). No template.
- Asks: deadline*, priority*, Additional Notes*.
- SOP steps, **draft — check with the systems manager**:
  1. Read the request and open the client's card if one is named.
  2. Ask the requester for anything missing the same day.
  3. Do the work, or book the client call it needs.
  4. Log the outcome on the client card.
  5. Tell the requester and mark the task complete.

### 30. Social Media Management Request

- Option `108eef9b-55f7-45c5-9af0-0c9462925902`.
- List: Media/Creative (folder rule #26 moves it; CEO-made 2026-09-18). Owner: creative strategist (the SOP's "creative director").
- Template: `t-86exy04v4` "Social Media Management Template" exists but has no source in Task Templates, so its content is unknown, and rule #26 does not apply it. `template_id` is null in the JSON; an editor can set it after opening one task made from it.
- Asks: client*, Additional Info*, deadline*, priority. 0 tickets.
- SOP: Drive `1eSsQi…` "Creative Director SOP — Social Media Management" (2026-09-18, read in full). It expects the SMM upsell Typeform's automation to create this task; that automation was not found.
- SOP steps condensed from it, **draft — check with the systems manager**:
  1. Confirm the client is Active and the upsell is on the client card.
  2. Check the client's GoHighLevel Social Planner has Instagram and Facebook connected as business accounts; test one private draft.
  3. Collect the brand guide, logo and at least 5 real photos from the client's Drive; ask the CSM for anything missing.
  4. Pick the pillar mix and cadence from the SOP's table.
  5. Build the content bank: 10 to 15 real audience questions for the niche.
  6. Write the month's plan (topic and slide count per post) and approve it before any image.
  7. Generate the approved posts in Higgsfield with the client's colours and real photos, and self-check each set.
  8. Have a second person review before the client sees anything.
  9. Push the batch to Social Planner's review queue with the client as approver and send the approval link.
  10. Watch the queue and carry rejected reasons into next month's content bank.

---

## 3. Not verified

- **Template object content.** No API returns it. Drift is shown only where a
  task made from the template exists (pause Tech, offboarding Tech, WhatsApp,
  lead form, and the TikTok ad account task `86excxhw4`). Most objects have
  never been applied to a task, so their content is not known.
- **The two Tech reactivation objects** `t-86exj3h8f` and `t-86exghd6t`: which
  one holds the newer checklist.
- **The list each folder rule moves to** for types 1, 3, 6, 8, 9, 17, 21, 25,
  26 and 30 (CT F12). The lists here follow PLAN 3.3.
- **Who Client Success #3 adds and removes, and who Call Center #1 adds.** The
  rule editor was not opened (only read tools were allowed). Section 1.3 gives
  the task evidence.
- **The form's per-type rules today.** Not re-read (finding 12).
- **Whether `86eyuyv9f`'s 7-step checklist came from `t-86ex629ve`.** The
  checklist's creation date matches the source (2026-04-07) and the systems
  manager applied it on 2026-09-07; a template application is the likely
  cause.
- The content of SOP docs read by title only (all except the four read in
  full: SMM, Client Exit Process, Client Wants To Pause, the funnel intent doc).
- Whether a business licence request is about Meta, TikTok, Snapchat or
  WhatsApp verification; whether a privacy policy request is for a lead form,
  a page or an app. Both drafts rest on weak evidence.
- Where the WhatsApp Reconnection list's webhooks go (PLAN 3.10).
- Whether the SMM upsell Typeform automation the SMM SOP describes exists.

---

## 4. Machine-readable JSON

One object per type, `type_index` 0 to 30 as in PLAN 3.3. Keys:

- `lists[]`: one entry per task to create. `owner_rule` is `systems_manager`,
  `csm_of_card`, `creative_strategist` or `media_buyer_of_record`.
  `named_owner_clickup_id` is the person that rule names today (the CSM entry
  is the fallback seat; `null` = nobody set).
- `lists[].when` (only on types 1 and 26): create this entry only when that
  field holds that option (or one of those options).
- `fields[]`: `key`, `label`, `clickup_field_id` (`native:*` for tags, due date,
  priority and description), `required`, `source` (`form_rule` = CT §2.2;
  `plan_fill` = PLAN 3.3 fill).
- `sop_steps`: a checklist to add when there is no template, or when the
  template applies none (type 7). Drafts say so in `sources`.

```json
[
  {
    "type_index": 0,
    "label": "Connect a New Lead Form  🆕 ",
    "request_type_option_id": "37d99ca0-e53f-4499-90e8-f1be8a21b207",
    "lists": [
      {"list_id": "901816723190", "template_id": "t-86ex09tmh", "owner_rule": "systems_manager", "named_owner_clickup_id": "113459516"}
    ],
    "fields": [
      {"key": "client", "label": "Client", "clickup_field_id": "native:tags+card_task_id", "required": true, "source": "form_rule"},
      {"key": "ads_platform", "label": "ADs Platform", "clickup_field_id": "2de15aa5-7fe9-48bf-86a1-e4cfee1306c9", "required": false, "source": "form_rule"},
      {"key": "ad_form_name", "label": "AD Form Name", "clickup_field_id": "41930456-4cbb-4431-bdd5-0a64df42a3d7", "required": true, "source": "form_rule"},
      {"key": "ad_account_name", "label": "AD Account Name", "clickup_field_id": "ad13480f-8e36-4241-aacd-9b874f057749", "required": true, "source": "form_rule"},
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "form_rule"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": false, "source": "form_rule"}
    ],
    "sop_steps": null,
    "sop_url": "https://docs.google.com/document/d/1cNcRmUzlT0mftjP6jqiw_yJUCHAdXhth9hZULaIDLK4/edit",
    "sources": [
      "CU taskTemplate 2026-10-26: t-86ex09tmh \"Connecting a new lead form\" exists",
      "CU task 86ex09rtq: Checklist (4) + SOP doc",
      "CU task 86exkgjcu: Ops/Tech, systems manager, Checklist (4, older wording)",
      "Drive 1cNcRm…: \"Connecting Ad forms to CRM ( Tiktok - Snapchat - Meta )\"",
      "CT F2 #1, §2.2"
    ]
  },
  {
    "type_index": 1,
    "label": "Create Ad Account",
    "request_type_option_id": "fd4d330d-2bda-4872-b195-11e694b29231",
    "lists": [
      {"list_id": "901816723196", "template_id": "t-86ex6f3q7", "owner_rule": "media_buyer_of_record", "named_owner_clickup_id": null, "when": {"field": "2de15aa5-7fe9-48bf-86a1-e4cfee1306c9", "option": "Facebook/Meta"}},
      {"list_id": "901816723196", "template_id": "t-86ex6ee7a", "owner_rule": "media_buyer_of_record", "named_owner_clickup_id": null, "when": {"field": "2de15aa5-7fe9-48bf-86a1-e4cfee1306c9", "option": "Tiktok"}},
      {"list_id": "901816723196", "template_id": "t-86ex6ehwe", "owner_rule": "media_buyer_of_record", "named_owner_clickup_id": null, "when": {"field": "2de15aa5-7fe9-48bf-86a1-e4cfee1306c9", "option": "Snapchat"}}
    ],
    "fields": [
      {"key": "client", "label": "Client", "clickup_field_id": "native:tags+card_task_id", "required": true, "source": "form_rule"},
      {"key": "ads_platform", "label": "ADs Platform", "clickup_field_id": "2de15aa5-7fe9-48bf-86a1-e4cfee1306c9", "required": true, "source": "form_rule"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": true, "source": "form_rule"},
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "form_rule"}
    ],
    "sop_steps": null,
    "sop_url": "https://docs.google.com/document/d/1H1jozw8G544KlDTH_4bIqD-52TOF4wXtL5zF9zoSwPE/edit",
    "sources": [
      "CU taskTemplate 2026-10-26: all three objects exist",
      "CU tasks 86ex6em6p, 86ex6ee2t, 86ex6ehu8 (sources with SOP docs and Looms)",
      "CU tasks z8xmdvhzug, z8xmdvhzuk, z8xmdvj871 (Oct 2026 ad-account work on Marketing/ADs assigned to the systems manager), z8xmdvhzuf (systems manager + media buyer B)",
      "Supabase cockpit_blueprint_settings: no launch_assignee row",
      "CT F2 #13-15"
    ]
  },
  {
    "type_index": 2,
    "label": "Missing Leads ❌",
    "request_type_option_id": "9fd304bb-7078-4485-9b9f-aa19ad47ed98",
    "lists": [
      {"list_id": "901816723190", "template_id": "t-86ex09vmq", "owner_rule": "systems_manager", "named_owner_clickup_id": "113459516"}
    ],
    "fields": [
      {"key": "client", "label": "Client", "clickup_field_id": "native:tags+card_task_id", "required": true, "source": "form_rule"},
      {"key": "ads_platform", "label": "ADs Platform", "clickup_field_id": "2de15aa5-7fe9-48bf-86a1-e4cfee1306c9", "required": true, "source": "form_rule"},
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "form_rule"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": false, "source": "form_rule"}
    ],
    "sop_steps": null,
    "sop_url": "https://docs.google.com/document/d/1WOZE2zcUM6sXK0uGBBSgr1Tg2wnGHDIxpmvA6CJTtc4/edit",
    "sources": [
      "CU taskTemplate: t-86ex09vmq exists",
      "CU task 86ex09vea: Lead recovery checklist (7)",
      "CU task z8xmdvj86w (Ops/Tech, media buyer B + systems manager)",
      "Drive 1WOZE2…: \"Missing Leads SOP\"",
      "CT F2 #2"
    ]
  },
  {
    "type_index": 3,
    "label": "New Employee Onboarding 🤵",
    "request_type_option_id": "88ab0389-7e36-4714-8b65-6d966ce9aed1",
    "lists": [
      {"list_id": "901816723190", "template_id": "t-86ex09ytj", "owner_rule": "systems_manager", "named_owner_clickup_id": "113459516"}
    ],
    "fields": [
      {"key": "employee_name", "label": "Employee Full Name", "clickup_field_id": "fa658ecb-fb6f-4cbe-9a2f-756180f2bdd0", "required": true, "source": "form_rule"},
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "form_rule"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": true, "source": "form_rule"}
    ],
    "sop_steps": null,
    "sop_url": null,
    "sources": [
      "CU taskTemplate: t-86ex09ytj exists",
      "CU task 86ex09yn5: Checklist (5)",
      "CT F2 #3 (target list not readable)",
      "no SOP doc found (ClickUp doc search, Drive title search)"
    ]
  },
  {
    "type_index": 4,
    "label": "Employee Offboarding 👋",
    "request_type_option_id": "504c3ffc-9264-4402-b03e-f349d0d8cbe0",
    "lists": [
      {"list_id": "901816723190", "template_id": null, "owner_rule": "systems_manager", "named_owner_clickup_id": "113459516"}
    ],
    "fields": [
      {"key": "employee_name", "label": "Employee Full Name", "clickup_field_id": "fa658ecb-fb6f-4cbe-9a2f-756180f2bdd0", "required": true, "source": "form_rule"},
      {"key": "employee_email", "label": "Employee - Email", "clickup_field_id": "ceb60e57-eedc-4ca3-8c55-6d9cfb87e249", "required": true, "source": "form_rule"},
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "form_rule"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": false, "source": "form_rule"}
    ],
    "sop_steps": [
      "Confirm the last working day and the seat with the requester.",
      "Remove the person from Slack and ClickUp, and from any cockpit owner rule or ClickUp list rule that names them.",
      "Remove their GoHighLevel user; for a dialer, remove their row in Agent Info.",
      "Turn off their cockpit seat and end their Hubstaff and Timetastic seats.",
      "Swap them out of every future calendar meeting and give their open tasks a new owner.",
      "Move the files and logins they own to a company account, then suspend their Google Workspace user.",
      "Post in the department channel that access is removed, then mark the task complete."
    ],
    "sop_url": null,
    "sources": [
      "draft — check with the systems manager",
      "CU task 86ex09yrf: source task is empty (no checklist), no template object",
      "CU task 86ex09yn5: onboarding steps reversed",
      "mahara-context skills/meta/mahara-google-artifacts/references/calendar-offboarding.md",
      "memory team-hours.md, team-only-seats.md (Hubstaff, Timetastic, cockpit seats)",
      "CT F6: nobody wrote the leaver step"
    ]
  },
  {
    "type_index": 5,
    "label": "Create a Privacy Policy Request 📝",
    "request_type_option_id": "5552a329-4e97-45d6-a195-9097e7df5cf5",
    "lists": [
      {"list_id": "901816723190", "template_id": null, "owner_rule": "systems_manager", "named_owner_clickup_id": "113459516"}
    ],
    "fields": [
      {"key": "client", "label": "Client", "clickup_field_id": "native:tags+card_task_id", "required": true, "source": "plan_fill"},
      {"key": "details", "label": "Additional Info", "clickup_field_id": "native:description", "required": true, "source": "plan_fill"},
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "plan_fill"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": false, "source": "plan_fill"},
      {"key": "privacy_policy_type", "label": "Privacy Policy - Type", "clickup_field_id": "5000c43f-18a7-4c50-bf7b-60d59ca41417", "required": false, "source": "plan_fill"}
    ],
    "sop_steps": [
      "Read Privacy Policy - Type: which page needs it (lead form, landing page, app or website).",
      "Confirm the client's legal name, address, contact email and the data the form collects.",
      "Write the policy page in the client's GoHighLevel sub-account, starting from the last policy page the team published.",
      "Publish it on the client's domain and check the link opens without a login.",
      "Add the link where it is needed (lead form, page footer or app settings).",
      "Paste the URL in the task and in a comment on the client card, tell the requester, and mark the task complete."
    ],
    "sop_url": null,
    "sources": [
      "draft — check with the systems manager (weak evidence)",
      "no form rule, no folder rule, no template, 0 tickets ever (CU list reads 2026-10-26)",
      "mahara-context skills/meta/client-launch-campaign (a Meta app needs a privacy policy URL; lead form privacy policy is off by default)",
      "Slack #tech-general 2026-06-17: the systems manager asked for a privacy policy URL",
      "ClickUp search \"privacy policy\": 0 results"
    ]
  },
  {
    "type_index": 6,
    "label": "AD Spend Invoice Request🧾",
    "request_type_option_id": "a82b0b80-e4f7-4f30-a3a5-49a5ea4c7f2d",
    "lists": [
      {"list_id": "901816723211", "template_id": "t-86ex6fpu3", "owner_rule": "csm_of_card", "named_owner_clickup_id": "113688800"}
    ],
    "fields": [
      {"key": "client", "label": "Client", "clickup_field_id": "native:tags+card_task_id", "required": true, "source": "form_rule"},
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "form_rule"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": false, "source": "form_rule"}
    ],
    "sop_steps": null,
    "sop_url": "https://docs.google.com/document/d/1q9GBq3yi8jaoGQBV0ZyGsI6sXsod6QnEykhPJjyKTpw/edit",
    "sources": [
      "CU taskTemplate: t-86ex6fpu3 exists",
      "CU task 86ex6fppm: Ad Spend Invoice Workflow (6), links the \"Ad Spend Invoices\" doc (Drive, modified 2026-10-22)",
      "CT F2 #17 (target list not readable); 0 tickets ever"
    ]
  },
  {
    "type_index": 7,
    "label": "Whatsapp Connection Issue 🔁",
    "request_type_option_id": "663ffd51-a838-4038-a8c0-a936b86f43b7",
    "lists": [
      {"list_id": "901816723211", "template_id": "t-86ex62m1b", "owner_rule": "csm_of_card", "named_owner_clickup_id": "113688800"}
    ],
    "fields": [
      {"key": "client", "label": "Client", "clickup_field_id": "native:tags+card_task_id", "required": true, "source": "form_rule"},
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "form_rule"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": false, "source": "form_rule"}
    ],
    "sop_steps": [
      "Open Agency View in MaharaOS, then WhatsApp, and find the client's account.",
      "Confirm the connection shows disconnected or an error.",
      "Send the client the QR code link to rescan.",
      "Confirm WhatsApp shows active (green).",
      "Tell the requester in Slack that it is resolved.",
      "Mark the task complete."
    ],
    "sop_url": "https://docs.google.com/document/d/1uQpWkwse7X3a0H9QcdTo57kayY0f4lO9tFB56_N3nr4/edit",
    "sources": [
      "source checklist, not a draft: CU task 86ex62km0 Resolution checklist (6); use only when the template applies no checklist",
      "CU tasks 86expd2d9, 86exetc7e, 86excm8pw, 86exakpdb: Client Success, unassigned, no checklist",
      "CU list 901821803697 WhatsApp Reconnection: 7 \"Report WhatsApp Disconnection\" form tasks since 2026-09-23, all unassigned",
      "Drive 1uQpWk…: \"WhatsApp Integration — Connecting a Client's WhatsApp to the CRM\"",
      "CT F1.5, F2 #7"
    ]
  },
  {
    "type_index": 8,
    "label": "Whatsapp Reactivation Campaign 📬",
    "request_type_option_id": "862f83da-8980-4ebe-9477-7501ccbf23d3",
    "lists": [
      {"list_id": "901818016338", "template_id": "t-86exj3g1a", "owner_rule": "creative_strategist", "named_owner_clickup_id": "113520400"},
      {"list_id": "901816723190", "template_id": "t-86exj3h8f", "owner_rule": "systems_manager", "named_owner_clickup_id": "113459516"}
    ],
    "fields": [
      {"key": "client", "label": "Client", "clickup_field_id": "native:tags+card_task_id", "required": true, "source": "form_rule"},
      {"key": "lead_list", "label": "Lead List", "clickup_field_id": "0f8f9334-69e7-46fc-aad1-d62402387f27", "required": true, "source": "form_rule"},
      {"key": "additional_notes", "label": "Additional Notes", "clickup_field_id": "6742edfb-9b6f-4615-933d-7ebd74f9542b", "required": false, "source": "form_rule"},
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "form_rule"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": false, "source": "form_rule"}
    ],
    "sop_steps": null,
    "sop_url": "https://docs.google.com/document/d/1VRjaZCVVOD26NCar6sCtWbxgoPGgj7vGtPI4vDrxZY8/edit",
    "sources": [
      "CU taskTemplate: t-86exj3g1a \"(Media)\", t-86exj3h8f \"(Tech)\", t-86exghd6t (no suffix) all exist",
      "CU task 86exj39z3 (Media source, 16, creative strategist steps); CU task 86exghd48 (no-suffix source, Tech execution 16)",
      "CT F2 #25 applies t-86exj3h8f + t-86exghd6t, not the (Media) object",
      "Drive 1VRjaZ… \"Reactivation Campaign SOP — Creative Strategist\"; Drive 1Wdgj5… \"Reactivation Campaign SOP — Tech\"",
      "mahara-context systems/Projects/WhatsApp Reactivation Campaign — GoGHL.md"
    ]
  },
  {
    "type_index": 9,
    "label": "Add Custom Qualification Questions🙋",
    "request_type_option_id": "7fc82c41-7bcd-47f7-bae0-868d4954495b",
    "lists": [
      {"list_id": "901816723190", "template_id": "t-86exj3gx1", "owner_rule": "systems_manager", "named_owner_clickup_id": "113459516"}
    ],
    "fields": [
      {"key": "client", "label": "Client", "clickup_field_id": "native:tags+card_task_id", "required": true, "source": "form_rule"},
      {"key": "ads_platform", "label": "ADs Platform", "clickup_field_id": "2de15aa5-7fe9-48bf-86a1-e4cfee1306c9", "required": true, "source": "form_rule"},
      {"key": "qualification_questions", "label": "Qualification Questions To Be Added", "clickup_field_id": "35f4bf1a-7df5-4cc0-919c-2669aea0bc27", "required": true, "source": "form_rule"},
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "form_rule"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": false, "source": "form_rule"}
    ],
    "sop_steps": null,
    "sop_url": "https://docs.google.com/document/d/1YtGLAN7yQEkMqqEAMg3EugbDt4P1Q7J_WEKbXRGD7vQ/edit",
    "sources": [
      "CU taskTemplate: t-86exj3gx1 exists",
      "CU task 86exj3grw: Qualification questions checklist (11)",
      "Drive 1YtGLA…: \"Tech SOP — Add a custom qualification question\"",
      "CT F2 #24; 0 tickets ever"
    ]
  },
  {
    "type_index": 10,
    "label": "Client Offboarding Request 🔴",
    "request_type_option_id": "d5ab86ae-18af-42d5-abd1-120c3fa2bcc3",
    "lists": [
      {"list_id": "901816723190", "template_id": "t-86ex629ve", "owner_rule": "systems_manager", "named_owner_clickup_id": "113459516"},
      {"list_id": "901816723196", "template_id": "t-86ex629x6", "owner_rule": "media_buyer_of_record", "named_owner_clickup_id": null}
    ],
    "fields": [
      {"key": "client", "label": "Client", "clickup_field_id": "native:tags+card_task_id", "required": true, "source": "form_rule"},
      {"key": "additional_notes", "label": "Additional Notes", "clickup_field_id": "6742edfb-9b6f-4615-933d-7ebd74f9542b", "required": false, "source": "form_rule"},
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": false, "source": "form_rule"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": false, "source": "form_rule"}
    ],
    "sop_steps": null,
    "sop_url": "https://docs.google.com/document/d/1tlZlMcasIXU23wMNjvqcrzx1qzKeCLlPyDLOPcGfoNc/edit",
    "sources": [
      "CU taskTemplate: t-86ex629ve and t-86ex629x6 exist",
      "CU task 86ex6238q: Tech offboarding checklist (9); CU task 86eyuyv9f (applied by hand 2026-09-07) has 7 of 9: the two Churn Tracker steps are missing",
      "CU task 86ex622wm: Media offboarding checklist (8) + empty Checklist; 86eyv2up2 and 86eyjkqzy match",
      "CU tasks z8xmdvf7vy, 86eyuyv8w, 86eyjjky6: All Tasks, unassigned, open",
      "Drive 1tlZlM…: \"Client Exit Process\" (CSM exit call, links the termination form)",
      "docs/media-launch/PAUSE-OFFBOARD.md"
    ]
  },
  {
    "type_index": 11,
    "label": "Change From DFY to DWY 🔁",
    "request_type_option_id": "d5a87389-3657-4334-8aee-14d67c2129d3",
    "lists": [
      {"list_id": "901816723211", "template_id": null, "owner_rule": "csm_of_card", "named_owner_clickup_id": "113688800"}
    ],
    "fields": [
      {"key": "client", "label": "Client", "clickup_field_id": "native:tags+card_task_id", "required": true, "source": "form_rule"},
      {"key": "details", "label": "Additional Info", "clickup_field_id": "native:description", "required": true, "source": "form_rule"},
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "form_rule"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": false, "source": "form_rule"}
    ],
    "sop_steps": [
      "Confirm the client has a call team and collect each caller's name, email and phone.",
      "Tell the client Mahara now runs ads only, and book the handover call with their team.",
      "Add the callers as users in the client's GoHighLevel sub-account and confirm each gets a test push in the LeadConnector app.",
      "In the client's clone only: turn on \"DWY — New Lead → Client Internal Notification\", turn off the call centre agent workflows and Mahara webhooks, and set Service Mode to DWY.",
      "Push a dummy lead: the caller is notified and a booking sends one confirmation.",
      "Train the client's callers on the client dialing SOP and paste its link in the Call Center SOP Link custom value.",
      "Stop our dialing: take the client out of Make 8850419 and 8842754, Maqsam routing and Agent Data.",
      "Record the reporting choice (clean cut or keep visibility) and set the card's Service field to DWY.",
      "Confirm no Mahara channel, scenario or sheet still gets this client's leads, then mark the task complete."
    ],
    "sop_url": "https://docs.google.com/document/d/1CVVFtBK4rd7rbQPnjjt6Y3aAoj4cfuYAnvzrzQeEzls/edit",
    "sources": [
      "condensed from a written SOP: mahara-context systems/Projects/DWY - DFY-to-DWY Switch SOP (Internal).md Part B (status: draft, 2026-09-13); Google Doc 1CVVFt… by the systems manager",
      "draft — check with the systems manager",
      "no form rule beyond client/details/deadline, no folder rule, no template, 0 tickets ever",
      "ClickUp archived handoff task 86ex01t56 \"Document the DFY-to-DWY transition SOP and automation changes\""
    ]
  },
  {
    "type_index": 12,
    "label": "Change From DWY to DFY 🔁",
    "request_type_option_id": "5e83c505-a5b2-43f1-849c-ce3a11c0c7b1",
    "lists": [
      {"list_id": "901816723211", "template_id": null, "owner_rule": "csm_of_card", "named_owner_clickup_id": "113688800"}
    ],
    "fields": [
      {"key": "client", "label": "Client", "clickup_field_id": "native:tags+card_task_id", "required": true, "source": "plan_fill"},
      {"key": "details", "label": "Additional Info", "clickup_field_id": "native:description", "required": true, "source": "plan_fill"},
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "plan_fill"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": false, "source": "plan_fill"}
    ],
    "sop_steps": [
      "Confirm the switch date with the client and the call centre.",
      "In the client's clone: turn the call centre agent workflows and Mahara webhooks back on, turn off \"DWY — New Lead → Client Internal Notification\", and set Service Mode to DFY.",
      "Add the client back to Make 8850419 and 8842754, Maqsam routing and Agent Data.",
      "Restore the client's Client Data row and check its GoHighLevel API key works.",
      "Update the call centre knowledge base and brief the agents on the client.",
      "Push a dummy lead: our agents get the notification and the speed-to-lead tracker fires.",
      "Set the card's Service field to DFY, tell the client who now calls their leads, and mark the task complete."
    ],
    "sop_url": null,
    "sources": [
      "draft — check with the systems manager",
      "the DFY-to-DWY SOP reversed (mahara-context systems/Projects/DWY - DFY-to-DWY Switch SOP (Internal).md §A.3, B.5, B.6)",
      "no form rule, no folder rule, no template, 0 tickets ever"
    ]
  },
  {
    "type_index": 13,
    "label": "Client Pause Request ⏸️",
    "request_type_option_id": "196991a9-dac9-4da8-a693-6b6d64372be5",
    "lists": [
      {"list_id": "901816723190", "template_id": "t-86ex63qk5", "owner_rule": "systems_manager", "named_owner_clickup_id": "113459516"},
      {"list_id": "901816723196", "template_id": "t-86ex63qm7", "owner_rule": "media_buyer_of_record", "named_owner_clickup_id": null}
    ],
    "fields": [
      {"key": "client", "label": "Client", "clickup_field_id": "native:tags+card_task_id", "required": true, "source": "form_rule"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": true, "source": "form_rule"},
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "form_rule"}
    ],
    "sop_steps": null,
    "sop_url": "https://docs.google.com/document/d/1qctuHLsH6TJl_E9UFIfTzy-ZzkcGuHhCbHspc7SabX4/edit",
    "sources": [
      "CU taskTemplate: t-86ex63qk5, t-86ex63qm7 exist",
      "CU task 86ex63k45 Tech pause steps (6); tasks 86eytarzg, 86eyrnqxg, 86eyk56b6 got 4 (missing the Database - MAHARA and Churn Tracker steps)",
      "CU task 86ex63k4n Media pause checklist (5): tasks match",
      "Drive 1qctuH… \"Client Wants To Pause — SOP\" (CSM call first; a genuine pause is at most 14 days)",
      "CT F1.4 (two racing rules)"
    ]
  },
  {
    "type_index": 14,
    "label": "Client Relaunch Request ⏯️",
    "request_type_option_id": "59b89a7c-6970-4aad-8c01-1d7bf58b124a",
    "lists": [
      {"list_id": "901816723190", "template_id": "t-86ex63qhr", "owner_rule": "systems_manager", "named_owner_clickup_id": "113459516"},
      {"list_id": "901816723196", "template_id": "t-86ex63qjj", "owner_rule": "media_buyer_of_record", "named_owner_clickup_id": null}
    ],
    "fields": [
      {"key": "client", "label": "Client", "clickup_field_id": "native:tags+card_task_id", "required": true, "source": "form_rule"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": true, "source": "form_rule"},
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "form_rule"}
    ],
    "sop_steps": null,
    "sop_url": null,
    "sources": [
      "CU taskTemplate: t-86ex63qhr, t-86ex63qjj exist",
      "CU task 86ex63kvz Tech relaunch completion (7); 86ex63kwr Media relaunch checklist (5)",
      "0 typed tickets; z8xmdvhzuz \"Follow up on campaign relaunch\" (Client Success, CEO) is a CSM follow-up, not this type",
      "CT F2 #11-12",
      "no SOP doc found"
    ]
  },
  {
    "type_index": 15,
    "label": "Change Company Name🔃",
    "request_type_option_id": "bbef2ea6-a3cd-49be-a82d-33352a23f7d0",
    "lists": [
      {"list_id": "901816723190", "template_id": "t-86exj3n5t", "owner_rule": "systems_manager", "named_owner_clickup_id": "113459516"}
    ],
    "fields": [
      {"key": "client", "label": "Client", "clickup_field_id": "native:tags+card_task_id", "required": true, "source": "form_rule"},
      {"key": "new_company_name", "label": "🆕 New Company Name", "clickup_field_id": "faa59f18-beb5-4a76-84e8-14b93c8636a7", "required": true, "source": "form_rule"},
      {"key": "additional_notes", "label": "Additional Notes", "clickup_field_id": "6742edfb-9b6f-4615-933d-7ebd74f9542b", "required": false, "source": "form_rule"},
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "form_rule"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": false, "source": "form_rule"}
    ],
    "sop_steps": null,
    "sop_url": "https://docs.google.com/document/d/1XOPCoouk4fHTh2sRBm0yyJabGNmlEwMssYcwbNfbCCY/edit",
    "sources": [
      "CU taskTemplate: t-86exj3n5t exists (no folder rule applies it)",
      "CU task 86exj3mx6: Client Name Change (Summary Checklist) (10)",
      "Drive 1XOPCo… \"Changing Company Name\" (owned outside Mahara, shared 2026-05-10)",
      "0 tickets ever"
    ]
  },
  {
    "type_index": 16,
    "label": "Change Company Address🔃",
    "request_type_option_id": "9d0997fb-0523-477a-b5fe-54dd3971a614",
    "lists": [
      {"list_id": "901816723190", "template_id": "t-86exj3ngz", "owner_rule": "systems_manager", "named_owner_clickup_id": "113459516"}
    ],
    "fields": [
      {"key": "client", "label": "Client", "clickup_field_id": "native:tags+card_task_id", "required": true, "source": "form_rule"},
      {"key": "new_company_address", "label": "📍 New Company Address", "clickup_field_id": "52ab75a1-20a6-4afe-aa40-95bcf99b35b0", "required": true, "source": "form_rule"},
      {"key": "additional_notes", "label": "Additional Notes", "clickup_field_id": "6742edfb-9b6f-4615-933d-7ebd74f9542b", "required": false, "source": "form_rule"},
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "form_rule"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": false, "source": "form_rule"}
    ],
    "sop_steps": null,
    "sop_url": "https://docs.google.com/document/d/1TbkDR0LW8MCUYMESaCqKoHVZaRRdxFUdS2_sh7AxNRs/edit",
    "sources": [
      "CU taskTemplate: t-86exj3ngz exists (no folder rule applies it)",
      "CU task 86exj3n8y: Update client address (summary checklist) (4)",
      "Drive 1TbkDR… \"Changing Client Address\"",
      "0 tickets ever"
    ]
  },
  {
    "type_index": 17,
    "label": "Switch Funnel Intent🌪️",
    "request_type_option_id": "645a7f4f-a4d8-4fe7-a58c-dda546c40188",
    "lists": [
      {"list_id": "901816723190", "template_id": "t-86exj3gk4", "owner_rule": "systems_manager", "named_owner_clickup_id": "113459516"}
    ],
    "fields": [
      {"key": "client", "label": "Client", "clickup_field_id": "native:tags+card_task_id", "required": true, "source": "form_rule"},
      {"key": "funnel_intent_level", "label": "Which Intent Level Do You Want To Switch To?", "clickup_field_id": "3a7c5292-0215-43e6-808a-f50abfb1f316", "required": true, "source": "form_rule"},
      {"key": "additional_notes", "label": "Additional Notes", "clickup_field_id": "6742edfb-9b6f-4615-933d-7ebd74f9542b", "required": false, "source": "form_rule"},
      {"key": "requested_questions", "label": "Any specific questions you want added? (optional)", "clickup_field_id": "bcba69d7-9941-486d-84f5-6d6dcdefe4d3", "required": false, "source": "form_rule"},
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "form_rule"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": false, "source": "form_rule"}
    ],
    "sop_steps": null,
    "sop_url": "https://docs.google.com/document/d/1do0qlIMjKf7P3MYK47aUEZdsItQMNOIu_Y_jCcQxBvg/edit",
    "sources": [
      "CU taskTemplate: t-86exj3gk4 \"Switch funnel intent level🌪️\" (name matches source 86exj3gab) and t-86exj3gfx \"Switch to funnel intent🌪️\" (what rule #23 applies) both exist",
      "CU task 86exj3gab: High intent funnel swap checklist (10)",
      "Drive 1do0ql… titled \"Tech SOP — Add qualification questions\" but its body is the intent-ladder funnel swap SOP (read 2026-10-26)",
      "Drive 1uWPfY… \"Mahara - High Intent Surveys (Bilingual, 5 Services)\"",
      "CT F2 #23"
    ]
  },
  {
    "type_index": 18,
    "label": "Create Landing Page📊",
    "request_type_option_id": "a2d9483c-2dde-486d-969e-78679e5d27a6",
    "lists": [
      {"list_id": "901816723190", "template_id": "t-86exer2gv", "owner_rule": "systems_manager", "named_owner_clickup_id": "113459516"}
    ],
    "fields": [
      {"key": "client", "label": "Client", "clickup_field_id": "native:tags+card_task_id", "required": true, "source": "form_rule"},
      {"key": "additional_notes", "label": "Additional Notes", "clickup_field_id": "6742edfb-9b6f-4615-933d-7ebd74f9542b", "required": false, "source": "form_rule"},
      {"key": "requested_questions", "label": "Any specific questions you want added? (optional)", "clickup_field_id": "bcba69d7-9941-486d-84f5-6d6dcdefe4d3", "required": false, "source": "form_rule"},
      {"key": "page_goal", "label": "Landing Page Goal", "clickup_field_id": "dfe24578-f27a-43ea-970f-4dd9e1825b47", "required": false, "source": "form_rule"},
      {"key": "copy_link", "label": "Landing Page Copy Link", "clickup_field_id": "41b41285-1152-48b8-85f2-ccb080ea7662", "required": false, "source": "form_rule"},
      {"key": "video_for_page", "label": "Video for Page", "clickup_field_id": "4b9c5187-430f-4534-99cf-db3fa2741dda", "required": false, "source": "form_rule"},
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "form_rule"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": false, "source": "form_rule"}
    ],
    "sop_steps": null,
    "sop_url": "https://docs.google.com/document/d/1jjyMvWbmV3tZDfV3yD2isqQA9E3cGEv_3AZ2JSrJcic/edit",
    "sources": [
      "CU taskTemplate: t-86exer2gv exists",
      "CU task 86exeqv00: Landing page setup checklist (5 groups)",
      "CU tasks 86eywpbt0, 86exkgjk9: Ops/Tech, systems manager, checklist matches",
      "Drive 1jjyMv… \"SOP-Client-Landing-Page\""
    ]
  },
  {
    "type_index": 19,
    "label": "Client Success Management Request 🙋‍♂️",
    "request_type_option_id": "6cde0a1f-a3f1-43c3-b9f9-7166e6899463",
    "lists": [
      {"list_id": "901816723211", "template_id": null, "owner_rule": "csm_of_card", "named_owner_clickup_id": "113688800"}
    ],
    "fields": [
      {"key": "client", "label": "Client", "clickup_field_id": "native:tags+card_task_id", "required": true, "source": "plan_fill"},
      {"key": "details", "label": "Additional Info", "clickup_field_id": "native:description", "required": true, "source": "plan_fill"},
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "plan_fill"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": false, "source": "plan_fill"}
    ],
    "sop_steps": [
      "Read the request and open the client's card; ask the requester for anything missing the same day.",
      "Agree the next step and a due date with the requester in the task comments.",
      "Do the work, or book the client call it needs.",
      "Log the outcome on the client card.",
      "Tell the requester it is done and mark the task complete."
    ],
    "sop_url": null,
    "sources": [
      "draft — check with the systems manager",
      "no form rule, no folder rule, no template",
      "CU task z8xmdvh26g (2026-10-10, filed by media buyer B): All Tasks, unassigned, no details",
      "cockpit-csm-api/core.ts:14 maps \"Client success management request\" to this type"
    ]
  },
  {
    "type_index": 20,
    "label": "Client Business License is Missing ❗",
    "request_type_option_id": "b286f3d0-957e-487f-92ef-ae82499c450e",
    "lists": [
      {"list_id": "901816723211", "template_id": null, "owner_rule": "csm_of_card", "named_owner_clickup_id": "113688800"}
    ],
    "fields": [
      {"key": "client", "label": "Client", "clickup_field_id": "native:tags+card_task_id", "required": true, "source": "plan_fill"},
      {"key": "details", "label": "Additional Info", "clickup_field_id": "native:description", "required": true, "source": "plan_fill"},
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "plan_fill"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": false, "source": "plan_fill"}
    ],
    "sop_steps": [
      "Ask the requester which account needs the licence (Meta business verification, TikTok, Snapchat or another) and by when.",
      "Message the client in their group asking for a clear copy of the commercial licence and say why.",
      "Save the file in the client's Drive folder.",
      "Send the file location to the requester and confirm they submitted it.",
      "Confirm the platform accepted it.",
      "Log it on the client card and mark the task complete."
    ],
    "sop_url": null,
    "sources": [
      "draft — check with the systems manager (weak evidence)",
      "no form rule, no folder rule, no template, 0 tickets ever",
      "sibling: Card Missing source 86ex6fd9v (CSM collects from the client, hands to the media buyer)",
      "ClickUp search \"business license\": only a client card and a call-centre doc mention it"
    ]
  },
  {
    "type_index": 21,
    "label": "Client Card Missing for ADs ❗❗",
    "request_type_option_id": "7e7ae553-abde-4cd2-af26-a1cca7be668c",
    "lists": [
      {"list_id": "901816723211", "template_id": null, "owner_rule": "csm_of_card", "named_owner_clickup_id": "113688800"}
    ],
    "fields": [
      {"key": "client", "label": "Client", "clickup_field_id": "native:tags+card_task_id", "required": true, "source": "form_rule"},
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "form_rule"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": false, "source": "form_rule"}
    ],
    "sop_steps": [
      "Confirm the ad account is stopped by a missing or failed payment method.",
      "Ask the client to add the card themselves on the platform's billing page, or on a short call while they type it; never collect card numbers in chat or a form.",
      "Check in the ad account that the payment method shows active and any unpaid balance is cleared.",
      "Confirm with the media buyer that ads are running again.",
      "Log it on the client card and mark the task complete."
    ],
    "sop_url": null,
    "sources": [
      "draft — check with the systems manager",
      "template t-86ex6fdwu exists but is withheld: source 86ex6fd9v step 2 and its message templates send the Client Card Info form Uju17Z13, which collects card number and CVV and is retired (typeform-inventory.md §3.10; commit 86ee4e84)",
      "CU tasks z8xmdvhzum, z8xmdvhzue, z8xmdvec0k, 86eyw9wk4: card problems land on Client Success with the CSM 113688800",
      "CT F2 #16"
    ]
  },
  {
    "type_index": 22,
    "label": "New Script Request 📗",
    "request_type_option_id": "a79b08d7-8e4f-469d-b70f-cba8514a06c3",
    "lists": [
      {"list_id": "901818016338", "template_id": "t-86ex63j6n", "owner_rule": "creative_strategist", "named_owner_clickup_id": "113520400"}
    ],
    "fields": [
      {"key": "client", "label": "Client", "clickup_field_id": "native:tags+card_task_id", "required": true, "source": "form_rule"},
      {"key": "script_type", "label": "What are we writing?", "clickup_field_id": "5fd89e5e-98c8-4800-a1ce-33f5b739a275", "required": true, "source": "form_rule"},
      {"key": "script_style", "label": "How is it shot?", "clickup_field_id": "846f445e-ab13-4be2-84c5-2b5210dbca35", "required": false, "source": "form_rule"},
      {"key": "orientation", "label": "Orientation", "clickup_field_id": "7cbff577-4a7b-491f-ab60-5937b3bda4a3", "required": true, "source": "form_rule"},
      {"key": "script_quantity", "label": "How many scripts?", "clickup_field_id": "833192d1-e11b-4f91-807a-60abad061ff2", "required": true, "source": "form_rule"},
      {"key": "who_films", "label": "Who Films It", "clickup_field_id": "fb0e7743-9076-473b-9238-72ec729df120", "required": true, "source": "form_rule"},
      {"key": "script_language", "label": "Script Language", "clickup_field_id": "0d6140e8-f145-4415-a82e-1d348904924a", "required": true, "source": "form_rule"},
      {"key": "arabic_dialect", "label": "Arabic Dialect", "clickup_field_id": "673028fc-8cf7-4e56-815b-bd454c8d604a", "required": false, "source": "form_rule"},
      {"key": "additional_notes", "label": "Additional Notes", "clickup_field_id": "6742edfb-9b6f-4615-933d-7ebd74f9542b", "required": false, "source": "form_rule"},
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "form_rule"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": false, "source": "form_rule"}
    ],
    "sop_steps": null,
    "sop_url": "https://docs.google.com/document/d/1B961T9tc5Dgu4qTHvecojnjIBxxzQpP7U5dgx_C5Imk/edit",
    "sources": [
      "CU taskTemplate: t-86ex63j6n exists",
      "CU task 86ex63hnu: Script delivery checklist (8); 18 typed tickets, latest z8xmdvhmh8 (2026-10-13, unassigned), z8xmdvfafv and z8xmdve4qd (creative strategist); checklists match",
      "Drive 1B961T… \"Client Ad Scripting — How to Create, Refine & Deliver Scripts\""
    ]
  },
  {
    "type_index": 23,
    "label": "Marketing/ADs Request 🃏",
    "request_type_option_id": "b796a968-347d-43b8-b187-c658b955587e",
    "lists": [
      {"list_id": "901816723196", "template_id": null, "owner_rule": "media_buyer_of_record", "named_owner_clickup_id": null}
    ],
    "fields": [
      {"key": "client", "label": "Client", "clickup_field_id": "native:tags+card_task_id", "required": true, "source": "plan_fill"},
      {"key": "details", "label": "Additional Info", "clickup_field_id": "native:description", "required": true, "source": "plan_fill"},
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "plan_fill"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": false, "source": "plan_fill"}
    ],
    "sop_steps": [
      "Read the request and open the client's ad account and campaign card.",
      "Ask the requester for anything missing (campaign, goal, deadline) in the task.",
      "Make the change in the ads manager, or say in the task why not.",
      "Log the change in the media buyer cockpit so it reaches the campaign card and the CSM card.",
      "Tell the requester and mark the task complete."
    ],
    "sop_url": null,
    "sources": [
      "draft — check with the systems manager",
      "no form rule, no folder rule, no template",
      "CU task 86ex7krbw (2026-04-11): All Tasks, unassigned, empty",
      "memory media-buyer-change-sync.md (cockpit changes post on the ads card and the CSM card)"
    ]
  },
  {
    "type_index": 24,
    "label": "Edit Existing Campaign Request 🎱",
    "request_type_option_id": "75095c91-9cc0-4505-ae96-e6317bbeade1",
    "lists": [
      {"list_id": "901816723196", "template_id": null, "owner_rule": "media_buyer_of_record", "named_owner_clickup_id": null}
    ],
    "fields": [
      {"key": "client", "label": "Client", "clickup_field_id": "native:tags+card_task_id", "required": true, "source": "plan_fill"},
      {"key": "details", "label": "Additional Info", "clickup_field_id": "native:description", "required": true, "source": "plan_fill"},
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "plan_fill"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": false, "source": "plan_fill"}
    ],
    "sop_steps": [
      "Confirm the campaign, the change (budget, audience, creative or form) and the reason with the requester.",
      "Check the change against the client's do's and don'ts and the KPI gates ($15 per lead, $60 per booking).",
      "Make the edit in the ads manager and read it back.",
      "Log it in the media buyer cockpit so the campaign card and the CSM card show it.",
      "Recheck the results after 3 days and note them in the task.",
      "Tell the requester and mark the task complete."
    ],
    "sop_url": null,
    "sources": [
      "draft — check with the systems manager",
      "no form rule, no folder rule, no template, 0 tickets ever",
      "memory kpi-gates.md, client-dos-donts.md, media-buyer-change-sync.md"
    ]
  },
  {
    "type_index": 25,
    "label": "Low Show Rate📉",
    "request_type_option_id": "d85246c8-7dcc-4294-b981-d1fe8b1221a6",
    "lists": [
      {"list_id": "901816723206", "template_id": "t-86exj3ddv", "owner_rule": "csm_of_card", "named_owner_clickup_id": "113688800"}
    ],
    "fields": [
      {"key": "client", "label": "Client", "clickup_field_id": "native:tags+card_task_id", "required": true, "source": "form_rule"},
      {"key": "additional_notes", "label": "Additional Notes", "clickup_field_id": "6742edfb-9b6f-4615-933d-7ebd74f9542b", "required": false, "source": "form_rule"},
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "form_rule"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": false, "source": "form_rule"}
    ],
    "sop_steps": null,
    "sop_url": "https://docs.google.com/document/d/1slpC2QdEATMIQovM3g15hh-WEmeGpJubNFKujUt4LBI/edit",
    "sources": [
      "CU taskTemplate: t-86exj3ddv exists",
      "CU task 86exj3d5g: Show rate improvement checklist (10); step 1 says \"vs the 75 percent target\", the CEO's client line is 60% (memory show-rate-rule.md, 2026-10-12)",
      "Drive 1slpC2… \"Call Center SOP — Low show rate diagnosis\"",
      "Call Center list 901816723206: 0 tasks ever, archived included"
    ]
  },
  {
    "type_index": 26,
    "label": "Low Schedule Rate📉",
    "request_type_option_id": "36ea1d39-4115-4a46-9f18-34664e7adac3",
    "lists": [
      {"list_id": "901816723206", "template_id": "t-86exj3d37", "owner_rule": "csm_of_card", "named_owner_clickup_id": "113688800", "when": {"field": "e58f563a-63c7-4f3a-b5cd-07cbb4a420d4", "option": ["Call Center Issue", "Both"]}},
      {"list_id": "901816723196", "template_id": "t-86exj3cvt", "owner_rule": "media_buyer_of_record", "named_owner_clickup_id": null, "when": {"field": "e58f563a-63c7-4f3a-b5cd-07cbb4a420d4", "option": ["Ads issue", "Both"]}}
    ],
    "fields": [
      {"key": "client", "label": "Client", "clickup_field_id": "native:tags+card_task_id", "required": true, "source": "form_rule"},
      {"key": "schedule_rate_issue", "label": "Schedule Rate Issue", "clickup_field_id": "e58f563a-63c7-4f3a-b5cd-07cbb4a420d4", "required": true, "source": "form_rule"},
      {"key": "additional_notes", "label": "Additional Notes", "clickup_field_id": "6742edfb-9b6f-4615-933d-7ebd74f9542b", "required": false, "source": "form_rule"},
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "form_rule"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": false, "source": "form_rule"}
    ],
    "sop_steps": null,
    "sop_url": "https://docs.google.com/document/d/15RCQBTfIKpJCLxDbH4ojzb-0t3lFs0uJHcXz3xRKndo/edit",
    "sources": [
      "CU taskTemplate: t-86exj3d37, t-86exj3cvt exist",
      "CU task 86exj3cej (Call Center, 9) and 86exj3ce1 (Ads, 10): both gate on \"CPL $25\"; the official gate is $15 per lead (memory kpi-gates.md)",
      "Drive 15RCQB… \"Call Center SOP — Low schedule rate (call center cause)\"; Drive 1a3BOC… \"Media Buyer SOP — Low schedule rate (ads / lead-quality cause)\"",
      "CT F2 #20-22"
    ]
  },
  {
    "type_index": 27,
    "label": "General Tech Request",
    "request_type_option_id": "71c628d0-ee1f-4dc6-90ce-b4da84b7b367",
    "lists": [
      {"list_id": "901816723190", "template_id": null, "owner_rule": "systems_manager", "named_owner_clickup_id": "113459516"}
    ],
    "fields": [
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "form_rule"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": true, "source": "form_rule"},
      {"key": "details", "label": "Additional Info", "clickup_field_id": "native:description", "required": true, "source": "form_rule"}
    ],
    "sop_steps": [
      "Read the request; ask the requester the same day for anything missing (client, link, deadline).",
      "Move the task to in progress and write the plan in a comment.",
      "Make the change and test it end to end.",
      "Write what changed and where in the task.",
      "Tell the requester and mark the task complete."
    ],
    "sop_url": null,
    "sources": [
      "draft — check with the systems manager",
      "CU tasks 86exhx4dq, 86exgw5g7, 86exfzeqb (Ops/Tech, systems manager): board clean-ups, Make changes, a survey swap",
      "CU task 86eyvmpxj: Form Migration Test, unassigned"
    ]
  },
  {
    "type_index": 28,
    "label": "General Marketing Request",
    "request_type_option_id": "d52bde7c-13b5-4b1f-a34e-042478f883a6",
    "lists": [
      {"list_id": "901816723196", "template_id": null, "owner_rule": "media_buyer_of_record", "named_owner_clickup_id": null}
    ],
    "fields": [
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "form_rule"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": true, "source": "form_rule"},
      {"key": "additional_notes", "label": "Additional Notes", "clickup_field_id": "6742edfb-9b6f-4615-933d-7ebd74f9542b", "required": true, "source": "form_rule"}
    ],
    "sop_steps": [
      "Read the request and ask the requester for anything missing in the task.",
      "Agree the next step and the due date in a comment.",
      "Do the work, or hand it to the right team with a reason.",
      "Log any ads change in the media buyer cockpit.",
      "Tell the requester and mark the task complete."
    ],
    "sop_url": null,
    "sources": [
      "draft — check with the systems manager",
      "CU task 86exakqj0 (2026-04-20, filed by media buyer B, assigned to former member 113428463): \"Schedule four scripts for editing\""
    ]
  },
  {
    "type_index": 29,
    "label": "General CSM Ticket",
    "request_type_option_id": "5db37a3e-f3cd-4513-8e38-750fecfa34c6",
    "lists": [
      {"list_id": "901816723211", "template_id": null, "owner_rule": "csm_of_card", "named_owner_clickup_id": "113688800"}
    ],
    "fields": [
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "form_rule"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": true, "source": "form_rule"},
      {"key": "additional_notes", "label": "Additional Notes", "clickup_field_id": "6742edfb-9b6f-4615-933d-7ebd74f9542b", "required": true, "source": "form_rule"}
    ],
    "sop_steps": [
      "Read the request and open the client's card if one is named.",
      "Ask the requester for anything missing the same day.",
      "Do the work, or book the client call it needs.",
      "Log the outcome on the client card.",
      "Tell the requester and mark the task complete."
    ],
    "sop_url": null,
    "sources": [
      "draft — check with the systems manager",
      "CU tasks 86exjmja8, 86exeunja, 86exdrk2x (Client Success, unassigned, bulk-closed): client data sheet change, check-in calls, a calendar integration"
    ]
  },
  {
    "type_index": 30,
    "label": "Social Media Management Request",
    "request_type_option_id": "108eef9b-55f7-45c5-9af0-0c9462925902",
    "lists": [
      {"list_id": "901818016338", "template_id": null, "owner_rule": "creative_strategist", "named_owner_clickup_id": "113520400"}
    ],
    "fields": [
      {"key": "client", "label": "Client", "clickup_field_id": "native:tags+card_task_id", "required": true, "source": "form_rule"},
      {"key": "details", "label": "Additional Info", "clickup_field_id": "native:description", "required": true, "source": "form_rule"},
      {"key": "deadline", "label": "Deadline", "clickup_field_id": "native:due_date", "required": true, "source": "form_rule"},
      {"key": "priority", "label": "Priority", "clickup_field_id": "native:priority", "required": false, "source": "form_rule"}
    ],
    "sop_steps": [
      "Confirm the client is Active and the upsell is on the client card.",
      "Check the client's GoHighLevel Social Planner has Instagram and Facebook connected as business accounts; test one private draft.",
      "Collect the brand guide, logo and at least 5 real photos from the client's Drive; ask the CSM for anything missing.",
      "Pick the pillar mix and cadence from the SOP's table.",
      "Build the content bank: 10 to 15 real audience questions for the niche.",
      "Write the month's plan (topic and slide count per post) and approve it before any image.",
      "Generate the approved posts in Higgsfield with the client's colours and real photos, and self-check each set.",
      "Have a second person review before the client sees anything.",
      "Push the batch to Social Planner's review queue with the client as approver and send the approval link.",
      "Watch the queue and carry rejected reasons into next month's content bank."
    ],
    "sop_url": "https://docs.google.com/document/d/1eSsQiHj3b6QM3tqY7tmXHA-ryYdDjO_Ee2P2FYehjRM/edit",
    "sources": [
      "condensed from a written SOP: Drive 1eSsQi… \"Creative Director SOP — Social Media Management\" (2026-09-18)",
      "draft — check with the systems manager",
      "CU taskTemplate: t-86exy04v4 \"Social Media Management Template\" exists, no source task in Task Templates, content unknown, not applied by rule #26",
      "CT F2 #26 (move only)"
    ]
  }
]
```
