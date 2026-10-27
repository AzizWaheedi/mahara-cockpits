# Brand Blueprint path: the old Typeform and Make 14 against the native cockpit form

Read-only map, 2026-10-25, worktree `forms-1025` (origin/main d2c9817c). Nothing was submitted, run, edited or posted. I read the Typeform API, the Make API (GET only), ClickUp and Slack through the read-only MCP tools, Supabase through `sq.py` (SELECT only), and the deployed Edge Function source. People are named by role. Client answers, phone numbers, addresses and message bodies are left out.

---

## 1. The short version

1. **No native press has ever run.** `cockpit_blueprints` holds one row (Smmim studio, `86ex70t90`). The CEO's seat saved it on 24 Oct: three answers, `parts = {}`. There are 0 `blueprint*` rows in `cockpit_creative_outbox`, 0 `blueprint.part_done` audit rows and 0 `creativeClient.blueprint*` actions. The native path is deployed but has never been proven end to end.
2. **So the one real row changed nothing in ClickUp.** No launch task was made or tagged. Can Self-Record?, Ad Approval Needed? and Offer Creation are still empty. The Onboarding Map is still at phase 4, and the six Creative Onboarding steps are all "to do". Smmim's Blueprint call took place on 13 Oct, 11 days before the native tables existed.
3. **The old path last ran in September.** Make 14's log API shows 0 runs, but its logs only reach back to about 30 Sep. ClickUp and Slack show three real runs: two partials (ARDON on 13 Sep, Merge studio on 17 Sep) and one completion (ARDON on 13 Sep). Typeform has had 0 completed and 0 partial responses since 17 Sep.
4. **The old path is still live, and the cockpit still links to it.** These are all live: the Typeform form (public), both webhooks, Make 14 and the card field `🧬 Brand Blueprint Form Link` (`1b7a4a74`). Make 12 writes that field on every kickoff, and after a kickoff the CSM cockpit's kickoff panel offers "Open the Brand Blueprint form", which opens that Typeform. A partial from that link makes a second launch task, because Make 14 has no dedupe. After that, the native "Send to media" refuses: "Two open launch tasks match".
5. **ClickUp parity is mostly met in code.** Part 1 makes the same launch task from the same template, with a better brief, plus a dedupe, a tag and a due date. Part 2 writes the same two card fields Make 14 wrote: Can Self-Record? and Onboarding Map phase 5. It also writes fields the old path never wrote.
6. **Four old effects are missing today:**
   - the "Brand Blueprint completed" Slack post (#media-general), which waits on `close_route = slack`;
   - the phase 5 WhatsApp to the client's group, which the CSM now pastes by hand;
   - Make 06's AI client recap;
   - Make 06's "Client summary pending approval" post in **#csm-general**.

   The last one is the only Slack post the old Blueprint path ever made in #csm-general.
7. **No route posts to #csm-general today.** The three routes are `card_only` (no Slack), `slack` (#media-general `C0AE8G5MT7Y`) and `make` (Make). The setting is `card_only`. The new #csm-general notice should be its own step at the first "Close the call", posted on every route (section 6).
8. **Do not switch `close_route` to `make` yet.** Make 14 has no route for the cockpit's event, but Make's webhook still answers 200. The cockpit would mark the close "sent" while Make does nothing. In `make` mode the cockpit also skips Can Self-Record?, the Onboarding Map and the WhatsApp paste text (`blueprint.ts:117-132`).
9. **Settings are empty except the switch.** There is no `launch_assignee`, so launch tasks go out unassigned and nobody is pinged, and there are no starter packs. The VPS creative sync does not carry the four card fields the spec added (Templated Ads Status, Can Self-Record?, Ad Approval Needed?, Offer Creation), so the Blueprint's card snapshot reads them as empty.

---

## 2. The old path, as it runs today

### 2.1 Typeform `oYZKtogO` "Mahara - Brand Blueprint form"

| | Value (source) |
|---|---|
| State | Public. Last edited 2026-09-17 13:03 UTC. 32 top-level fields, 62 questions with the inline groups (`GET /forms/oYZKtogO`, read 2026-10-25). |
| Partial submit | `partial_responses_to_all_integrations = true`. One milestone: `bb0018-0000-4000-8000-000000000001` "Corrected daily budget", status active. |
| Webhooks | Two, both enabled, both to `hook.eu2.make.com`, event types `{form_response: true}`, no secret, created 2026-09-02 (`GET /forms/oYZKtogO/webhooks`). The partial setting adds partial events to both. |
| | `blueprint` → Make hook 4350422 "Brand Blueprint form" (gateway webhook) → **Make 14** (9748311). |
| | `postcallsummary` → Make hook 4114295 (Typeform-type webhook) → **Make 06** (9209179). The kickoff `tG7dnxBn` and the check-in `fRokTITH` share it. |
| Responses since 2026-08-26 | **Completed 1** (2026-09-13 07:58 UTC, hidden client ID set: ARDON). **Partial 6** (5 on 2 Sep 13:33 to 14:33 UTC, build tests; 1 on 17 Sep 10:13 UTC, Merge studio). **Started 12**, none with a hidden client ID (bare link). The latest of any kind is 2026-10-06 (started). |
| Orphan hook | Make hook 4347926 "TEMP - Blueprint partial response probe" is enabled with no scenario, and no webhook on this form points at it (`GET /hooks`). |

### 2.2 Make 14 "14. Brand Blueprint Form Submitted" (9748311)

Active, linked, scheduling "immediately", maxErrors 3, no DLQ, not sequential. Created 2026-09-02, last edit 2026-09-17 15:47 UTC (`GET /scenarios/9748311`, `/blueprint`).

| Module | What it does (from the blueprint) |
|---|---|
| [1] `gateway:CustomWebHook` | Hook 4350422, maxResults 1. |
| [2] Router "Split: partial vs complete" | Two routes. |
| **Route 0, filter `{{1.event_type}} = form_response_partial`** | |
| [3] `clickup:createATaskFromATemplate` | List `901816723196` (Marketing / ADs), template `t-86ex8xaf1`, name `{{hidden.legal_name}} - New Client Campaign Launch 🚀`. No dedupe, and no check that templated = yes. The template brings six subtasks: New Setup / Onboarding · Facebook Ads Buildout · Tracking Sheets · QA Checklist · 0 · Intro Message To The Client · Message The Client: Campaign Ready (seen under the ARDON and Merge studio launch tasks). |
| [4] `clickup:postATaskComment` | On [3]: "**Brand Blueprint - media handoff**". It carries the service from the kickoff and whether it still holds, the service instead, capacity and the capacity risk, templated yes or no and the Drive folder, the kickoff budget, whether it is still correct, the corrected budget, the client task link and "partial handoff… rest still being filled". `notify_all: false`. |
| **Route 1, filter `{{1.event_type}} = form_response`** | |
| [5] `slack:CreateMessage` | Channel `C0AE8G5MT7Y` (private, #media-general): "*Brand Blueprint completed*", then Client {legal_name}, Service focus {service_focus}, Client task link, and "The blueprint call is done and the full form is in. Scripts and custom creative can start." |
| [8] `clickup:editATask` | Card on `901816559981`. **Can Self-Record?** `39839c9d-c373-4737-9e92-bce03096281e`: bb0090 = "No" → option `470ebb08` (No); else bb0200 "They have a studio or cameraman" → `07699d93` (Yes - studio/cameraman); "Phone only" → `b6e6a675` (Yes - phone only); else `5dc20671` (Unsure). **Onboarding Map** `51f49cb1-9f76-48be-b639-c42ca552d20a` = `https://mahara-onboarding-map.vercel.app/?phase=5&cid={card}`. |
| [9] `clickup:getATask` | Reads the card back (for the map link). |
| [6] `google-sheets:filterRows` | Sheet "Client Data" `1_0Nv-…`, the row where column C = the card ID. |
| [10] `util:FunctionSleep` | 30 to 120 s, random (WhatsApp safety). |
| [7] `whapi-cloud:text` | Filter: column F (the group) not blank. To the client's WhatsApp group: the Arabic phase 5 message, the map link `{{9.custom_fields.Onboarding Map}}`, then the content-folder block with the folder from **sheet column H** (`{{6.7}}`). |

What Make 14 never did: set Client Status (it stays "Brand Blueprint Booked♠️" from Make 12), Ad Approval Needed?, Offer Creation, Templated Ads Status, tags, an assignee, a due date, any Creative Onboarding step, any CSM comment, or any post in #csm-general.

### 2.3 Make 06 "Post Call Summary - Tasks, Notes, Client Summary" (9209179): the Blueprint branch

Trigger `typeform:WatchEventsWithResponses` (hook 4114295) → [16] ClickUp get task (`hidden.onboarding_client_id`) → [13] Client Data sheet row → [30] Router (`GET /scenarios/9209179/blueprint`).

- **Route 0**, filter `form_id = fRokTITH` (check-in only): GPT to-do list, card comment, call grade to Slack `C09SVG6FHGU`, Happiness and Last POC.
- **Route 1**, filter "not a mid-call partial": `form_id ≠ oYZKtogO` **OR** `bb0019` exists.
  - [22] GPT client WhatsApp summary.
  - [23] Data store 171744, keyed by the response token.
  - [24] Slack **`C09RZ0GS0V9` (#csm-general)**: "*Client summary pending approval: {sheet column 1}*", then the draft, with APPROVE / DENY links into Make 07 (9523861), which sends it by WHAPI.
  - A completed Blueprint response has bb0019 (the best client is a required question), so the old path posted a recap for approval in #csm-general.

### 2.4 What the old path actually did in the last 60 days

| When (UTC) | Run | Evidence |
|---|---|---|
| 2026-09-13 07:46 | Make 14 partial, ARDON | Launch task `86eywc0xy` "ARDON - New Client Campaign Launch 🚀" on 901816723196, made 07:46. Comment "Brand Blueprint - media handoff" at 07:46 with "Launching on templated ads: false" (the task was made anyway). No tags. Status complete now. |
| 2026-09-13 07:58 | Make 14 complete, ARDON | #media-general post by "Admin Bot" (Make's Slack connection), 08:58 BST: "Brand Blueprint completed / Client: ARDON …". ARDON's card today: Can Self-Record? = Unsure; Onboarding Map = `?phase=6` (Make 16 moved it on after launch). |
| 2026-09-14 00:17 | Make 06 route 1? | One "Client summary pending approval: Ardon" in #csm-general that week. **Not verified** that it came from the Blueprint, because the Make 06 logs for September are gone. |
| 2026-09-17 10:14 | Make 14 partial, Merge studio | Launch task `z8xmdvdza1` "Merge studio - New Client Campaign Launch 🚀", comment "Brand Blueprint - media handoff" ("Launching on templated ads: false"). No completion followed, so no #media-general post and no phase 5 fields. |
| 2026-09-30 to now | none | Make 14 log API: 0 entries. Make 06 has 26 entries from 30 Sep, all kickoff or check-in sized (6 or 11 operations), and the Blueprint had no response in that window. |

Blueprint calls in the call store over the same 60 days: 9 (`cockpit_csm_calls kind='blueprint'`). Six fell after the last form response: Alalia.co (19 Oct), Makers (15 and 18 Oct), Smmim studio (13 Oct), Shades Interior Design (7 Oct) and Madana (5 Oct). None of them produced a Blueprint record on either path. All 9 have 0 recordings attached.

### 2.5 The old link is still handed out

- Make 12 module [21] writes `🧬 Brand Blueprint Form Link` (`1b7a4a74`) on every kickoff (form-map.md §6). Smmim's card holds it today.
- `apps/client-success-cockpit/src/forms/kickoff.ts:61-67` names that field as the kickoff's link back, and `FormPanel.tsx:1170-1172` renders it as "Open the Brand Blueprint form". After each kickoff, the CSM is one click from the Typeform.
- `apps/creative-director-cockpit/src/lib/creativeSourceModels.ts:1281` still lists "Brand blueprint form" in the client brief text, from the synced `blueprintFormLink`.
- The CD cockpit's Links page no longer carries the bare Typeform: no `oYZKtogO` in `apps/creative-director-cockpit/src`.

---

## 3. The native path

### 3.1 Data (`supabase/migrations/20261024a_brand_blueprints.sql`)

- **Tables.** `cockpit_blueprints` (one row per card: answers, answer_meta, `parts` jsonb, revision, `launch_task_id`) and `cockpit_blueprint_settings`. The settings key CHECK allows only `pack.<service>`, `launch_assignee` and `close_route` (line 54). `close_route` is seeded `card_only` (line 125). Row security is on, and only `service_role` holds table grants.
- **Press.** `cockpit_blueprint_part_done(task, part, request_id)` (line 999) does the following:
  - checks the order (part 1, then 2, then 3), the required answers, a same-request replay and "nothing changed";
  - inserts one `cockpit_creative_outbox` row (`blueprintLaunch` / `blueprintClose` / `blueprintOffer`, line 1070);
  - stamps `parts.N`;
  - writes one `blueprint.part_done` audit row (line 1084).
- **Payload.** `cockpit_blueprint_payload` (line 547) carries the answers, the links (onboarding mirror, then the creative snapshot), `previous` (the last started run of that part, so the brief, Slack, Make and the WhatsApp text go only on a first press), and per part:
  - part 1: the kickoff refs, settings and step 4;
  - part 2: `service`, `offer`, step 2, the next booked launch call, `closeRoute` at the press, `mapUrl`, the CSM's first name (lines 621-637);
  - part 3: `dna_status`, `dna_missing`, step 3 and the offer sheet.
- **Settled.** `cockpit_blueprint_outbox_settled` (line 1205) saves `launch_task_id` after a part 1 run.

### 3.2 Where it is filled

- **The deck.** In the client success app's deck engine at `/client-success/clients/:key/present/blueprint` (and `/notes`, `?view=prep`) (`AuthenticatedAppRoutes.tsx:78-92`). It saves with `cockpit_blueprint_save` and presses with `cockpit_blueprint_part_done` (`present/blueprintSources.ts:246, 304`).
- **The CD cockpit call page.** `/creative/blueprint/:taskId` (`BlueprintCallPage.tsx`, commit 88ef6046) frames that deck on the CD cockpit's own origin. The CD shares the tab and the client sees only the deck.
- **The CD client page.** `BlueprintCard` (`ClientPage.tsx:603`) shows the three parts and Lock the offer (part 3). The Settings page has a "Brand Blueprint" section (`SettingsPage.tsx:224`).
- **The CSM.** Reads the parts and gets the phase 5 paste text through `src/lib/blueprintStatus.ts` (read only).

### 3.3 How a press runs, and whether apply really runs

1. The browser calls `cockpit_blueprint_part_done`. It returns `{id, state:'pending'}`.
2. The **browser at once** invokes `cockpit-creative-api` with `{operation:'clientAction', args:{id}, apply:true}` (`present/blueprintSources.ts:361-367`; CD `src/lib/blueprint.ts:725-752`).
3. `runClientAction` (`outbox.ts:49-69`) runs these steps:
   - loads the row through `cockpit_creative_client_action('get')`, which needs the creative role or the CEO;
   - prepares the plan through `prepareBlueprint` (`outbox.ts:10`), with ClickUp GETs only through the `readOnly` guard (`blueprint.ts:18, 155`);
   - journals the run in `cockpit_media_actions` and claims the row (pending → sending);
   - runs `executeOutbox` (`outbox.ts:35-41`): `executePlan` writes each step and reads it back, and the Make POST, when there is one, goes last and once;
   - settles the row as `done`, or as `reconcile` on an error once anything was written;
   - after part 1, calls `cockpit_blueprint_outbox_settled`.
4. **Apply runs only from the browser.** No cron or worker picks up a `pending` row. `cron.job` has no command that names `cockpit-creative-api`, `clientAction` or `creative_outbox`. A dropped tab leaves the row pending until someone presses "Run it again".
5. **Deployed.** `cockpit-creative-api` v23 (updated 2026-10-23 21:12 UTC) contains `prepareBlueprint`, `blueprintRehearse`, `PHASE5_WHATSAPP` and `C0AE8G5MT7Y`, and no `C09RZ0GS0V9` (`get_edge_function`, read only). The migration was applied 2026-10-24 00:11 +03 (the `close_route` seed's audit row).

### 3.4 What each press writes (code)

| Press | Steps, in order (`supabase/functions/cockpit-creative-api/blueprint.ts`) |
|---|---|
| **1 Send to media** (`prepareLaunch`, 72-107) | `findLaunch` (40-48): the record's task, else one open task tagged with the card name, else one whose name starts with the card name and holds "launch". Two or more open matches → refuse before any write. **None** → create from `t-86ex8xaf1` on 901816723196, tag it with the lower-case card name, PUT the due date (2 working days, Kuwait) and the assignee if `launch_assignee` is set (members re-checked), then comment the brief (`launchBrief`, blueprintBrief.ts:491). **One** → comment there, create nothing. Then Templated Ads Status (`e7d158a8`) := Approved / Wants To See Them First / Declined; Creative Onboarding step 4 → done (starter = yes); a capacity comment on the card for the CSM when capacity is tight or no. |
| **2 Close the call** (`prepareClose`, 108-134) | Ad Approval Needed? (`dd2253f9`) := Yes / No. **When the route is not `make`:** Can Self-Record? (`39839c9d`, by label) and, on the first press, the Onboarding Map (`51f49cb1`) phase 5. Step 2 → done. A launch-task comment (`closeLaunchComment`). A card comment assigned to the CSM (`closeCsmComment`, 630), with the phase 5 WhatsApp to paste on a first press when the route is not `make`. **`slack` route, first press:** `chat.postMessage` to `MEDIA_GENERAL = C0AE8G5MT7Y` with `slackCloseText` (677): "Brand Blueprint completed: {card}. Scripts and custom creative can start. {launch task link}". **`make` route, first press, flag and both secrets set:** one POST of `makeClose` (689) to `MAKE_BLUEPRINT_HOOK`. |
| **3 Lock the offer** (`prepareOffer`, 135-147) | Offer Creation (`404ba9d5`) := Done; step 3 → done (DNA complete) or a "Brand DNA still missing" comment on step 3; the offer comment on the launch task, else on the card for the CSM. |
| Safety | `assertSafe` (64-71) refuses any plan that names Launch Date, Next Payment Date or Daily Budget, a bulk `custom_fields` body, or a task PUT beyond the assignee, due date and status. |

Card field options checked against `GET list/901816559981/field` on 2026-10-25. Every label the code writes exists: Can Self-Record? has the four options, Ad Approval Needed? has Yes and No, Offer Creation has Done, and Templated Ads Status has Approved, Declined and Wants To See Them First.

### 3.5 The close switch today

| `close_route` | Slack | Can Self-Record? and Onboarding Map | Phase 5 WhatsApp | State |
|---|---|---|---|---|
| `card_only` | none | the cockpit | the CSM pastes it (card comment and copy button) | **current** (settings row, `updated_by: migration`) |
| `slack` | #media-general only | the cockpit | the CSM pastes it | needs the Edge bot in #media-general (not verified) |
| `make` | Make, through a Make 14 route that **does not exist** | skipped by the cockpit | skipped by the cockpit (`whatsapp = first && effective !== 'make'`) | `BLUEPRINT_MAKE_CLOSE` and the hook and key secrets not verified. If set, Make answers 200 and nothing happens, because both Make 14 routes filter on `event_type` and the cockpit's body has none (`tools.ts:9-22`, Make 14 [3] and [5] filters). |

### 3.6 Live state, read 2026-10-25

| Read | Result |
|---|---|
| `cockpit_blueprints` | 1 row: `86ex70t90` Smmim studio, revision 2, `launch_task_id` null, `parts = {}`, answers `starter`, `destination`, `daily_budget` (meta `from`: default, default, kickoff), saved 2026-10-24 13:58 +03 |
| `cockpit_blueprint_settings` | 1 row: `close_route = card_only`. No `launch_assignee`, no `pack.*`. |
| `cockpit_creative_outbox` kinds `blueprint%` | 0 rows |
| `cockpit_audit_log` `blueprint.%` | 2 × `blueprint.save` (24 Oct, the CEO's seat), 1 × `blueprint.insert` (the `close_route` seed) |
| `cockpit_media_actions` `creativeClient.blueprint%` | 0 rows |
| Creative seats | 4 active seats hold `creative`: the CEO's two, the systems manager's and the creative director's. All have no client limit (`cockpit_members`). |
| Creative sync, clients row for `86ex70t90` (snapshot 2026-10-25 13:19 +03) | No `templatedAdsStatus`, `canSelfRecord`, `adApprovalNeeded` or `offerCreationStatus` keys. The repo's `hermes/cockpit-sync/creativeProducer.ts:70-73` has them, but the VPS sync does not send them yet. |

---

## 4. The one real row, checked in ClickUp

| Question | Answer (source) |
|---|---|
| Did part 1 make the media buyer's "New Client Campaign Launch" task? | **No.** Part 1 was never pressed (`parts = {}`, 0 outbox rows). On list 901816723196, 0 tasks carry the tag "smmim studio". The only "SMMIM Studio - New Client Campaign Launch 🚀" there is `86ex8tjyh`: made 2026-04-15 and cancelled 2026-08-29 (status type `closed`, which `findLaunch` skips). A second one, `86exj3ehp`, sits on Media/Creative and is archived. |
| Did the close write the card fields? | **No.** Card `86ex70t90` today: Onboarding Map `?phase=4`; Can Self-Record?, Ad Approval Needed? and Offer Creation not set; Templated Ads Status "Wants To See Them First" (set before the cockpit, not by a press); Client Status "Ready For Launch🚀". |
| Creative Onboarding | `z8xmdvh9qf` "smmim studio - Creative Onboarding 🚀" (list 901818016338, made 2026-10-12). Steps 1 to 6 are all "to do", including `z8xmdvh9qh` "2 · Run The Brand Blueprint Call" and `z8xmdvh9qk` "4 · Select Templated Creatives So They Can Launch". |
| What would part 1 do now? | Create a new launch task: none is open, and the cancelled one is skipped. It would go out unassigned, with nobody pinged (no `launch_assignee`). It would set Templated Ads Status from the answers and tick step 4 when starter = yes. The pack link would have to be pasted, because no pack is set. |

---

## 5. Parity: old effect → native today → what to build

"ClickUp is updated the same way it used to" means rows 1 to 4 and 6 to 7. All of them are in code, and none has run.

| # | Old effect (source) | Native today (source) | What to build |
|---|---|---|---|
| 1 | Partial at bb0018: create "{legal_name} - New Client Campaign Launch 🚀" from `t-86ex8xaf1` on 901816723196 (Make 14 [3]). No dedupe; made even when templated = no. | Part 1: the same template and list, named from the card; dedupe by record, then tag, then name; refuses two open matches (`blueprint.ts:40-48, 82-94`). | Nothing in code. Prove it with the first real press, and check that the six template subtasks arrive. |
| 2 | "Brand Blueprint - media handoff" comment (Make 14 [4]). | `launchBrief` comment, with more lines (`blueprintBrief.ts:491`). | Nothing. |
| 3 | No assignee, so nobody was pinged. | Assignee from `launch_assignee`. **Unset**, so it goes out unassigned and nobody is pinged. When it is set, the hermes task-assignment worker posts it to #client-ads-general (`hermes/task-assignment-alerts/worker.py:21-28`, list 901816723196 → `C0C8DLZGTMZ`). | Set the launch media buyer in CD Settings. This is data, not code. |
| 4 | Complete: Slack #media-general "*Brand Blueprint completed*" with the client, the service focus and the card link (Make 14 [5]). | Only on `close_route = slack`. Today `card_only`, so **no post**. The text is shorter: no service, and the launch task link instead of the card link (`blueprintBrief.ts:677-683`). | Confirm the Edge `SLACK_BOT_TOKEN` bot is in #media-general, then switch to `slack`. Add the service and the card link to `slackCloseText` to match the old text. |
| 5 | (none) | (none) | **New:** #csm-general notice at the first Close, on every route (section 6). |
| 6 | Can Self-Record? by option ID (Make 14 [8]). | Same field, by label, routes `card_only` and `slack` (`blueprint.ts:118`). | Nothing, unless the route goes to `make`. |
| 7 | Onboarding Map = `?phase=5&cid=` (Make 14 [8]). | Same URL, first press, routes `card_only` and `slack` (`blueprint.ts:119`). | Nothing. |
| 8 | Phase 5 WhatsApp to the group after the sheet lookup and a 30 to 120 s wait, with the content folder from sheet column H (Make 14 [6][10][7]). | **Not sent.** The CSM gets the text in a card comment assigned to them (`closeCsmComment`) and a copy button (`blueprintStatus.ts`). The folder comes from the card's links (`links.driveFolder ?? drive`, `phase5Message`, 616), not from the sheet. | To match "the same way", build Make 14's "COCKPIT CLOSE" route on hook 4350422. It filters on `source = mahara-cockpit` and the key, then reuses [5][8][9][6][10][7]. Set `MAKE_BLUEPRINT_HOOK`, `MAKE_BLUEPRINT_KEY` and `BLUEPRINT_MAKE_CLOSE = on`, then switch to `make`. This is a Make edit, so it needs the CEO's yes. Until the route exists, keep `card_only` or `slack`. |
| 9 | Make 06 route 1: GPT client recap → data store 171744 → #csm-general "Client summary pending approval" → Make 07 sends on APPROVE. | None (PLAN.md:23 and 229: "not in v1"). | Optional, phase 2: a recap drafted from the record (and the Fathom transcript when one is matched) posted for the CSM's approval in #csm-general. This could be the #csm-general notice's thread. |
| 10 | (none) | Ad Approval Needed?, Templated Ads Status, Creative Onboarding steps 2, 3 and 4, the launch-task close and offer comments, the CSM comment, Offer Creation = Done. | Native only. Deploy the VPS sync so the cockpit sees these fields back (`creativeProducer.ts:70-73`). |
| 11 | Client Status not touched. | Not touched. | Not promised by either side. Name the owner if Aziz wants a move to "LAUNCH BOOKED" or similar. |
| 12 | The Typeform is the only record (1 of 70 cards in `cockpit_client_onboarding.forms.blueprint`). | The native rows are not in `forms.blueprint`. The CSM reads them through `cockpit_blueprint_read`. `hermes/csm-calls/sources.ts:39` and `onboarding-sync` count only Typeform. | Have the onboarding mirror (or its readers) treat `cockpit_blueprints.parts` as the Blueprint's "done". |

Retiring the old path (needed, so the two paths never both fire):

1. Point the kickoff panel's link back at the cockpit's Blueprint, or drop it (`kickoff.ts:61-67`).
2. Drop the "Brand blueprint form" line (`creativeSourceModels.ts:1281`).
3. Ask the CEO to change Make 12 [21] to write the cockpit Blueprint link into `1b7a4a74`.
4. After the first native close is verified, ask the CEO to switch off Make 14 or the `blueprint` webhook.
5. Leave the `postcallsummary` webhook alone: the kickoff and the check-in share it.

---

## 6. The Slack notice for "Blueprint complete" in #csm-general

**Where.** #csm-general `C09RZ0GS0V9`, a private channel with 8 members: the CEO, the systems manager, the creative director, the CSM, Admin Bot (Make's Slack connection) and three bots: `abdulazizs_second_ass`, `maharaclubbot` and `viktor` (`slack_list_channel_members`).

**When.**
- **Complete = the first press of Close the call (part 2).** That is the moment Make 14's complete route fired, and the moment Make 06 posted its recap in #csm-general.
- **Per part (recommended defaults):**
  - Part 1 needs no #csm-general post. Media hears through the launch task, and through #client-ads-general once `launch_assignee` is set.
  - Part 3, Lock the offer, should be a thread reply on the close's message: "Offer locked: {offer line}". A new top-level post is the fallback when the close's message ID is missing.
  - A later press never posts again. This matches the existing `first` rule.

**How it fits the routes.** It is its own step, independent of `close_route`, because none of the three routes posts to #csm-general:

| `close_route` | #media-general | #csm-general (new) |
|---|---|---|
| `card_only` | none | the cockpit, first close |
| `slack` | the cockpit (`MEDIA_GENERAL`) | the cockpit, first close |
| `make` | Make (once the COCKPIT CLOSE route exists) | the cockpit, first close |

**Build.**
1. `blueprintBrief.ts`: add `CSM_GENERAL = "C09RZ0GS0V9"` and `csmCloseSlackText(p, launchTaskId, {whatsappBy: "paste" | "make"})`, in plain lines with no budget, no phone and no client message text. For example: "Brand Blueprint done: {card}. Service: {service label}. Launch call: booked for {day time} (Kuwait) / not booked yet, book it from the client page. Phase 5 WhatsApp: paste it from the card comment / Make sent it. Card: {card link} · Launch task: {link}". `p.service` and `p.launchCall` are already in the part 2 payload (migration lines 621-637).
2. `blueprint.ts prepareClose`: on `first`, push a Slack step `{provider:'slack', path:'chat.postMessage', body:{channel: B.CSM_GENERAL, text}, verifyPath:'conversations.history', expected:{text}, slackMessage:true}` after the ClickUp steps, so a ClickUp failure never announces a close. Add a rehearsal line "Would post to #csm-general: …". Keep the close's result `{slackTs}` from the receipt, so part 3 can reply in its thread. That means adding the latest `blueprintClose` outbox result's ts to the part 3 payload (`cockpit_blueprint_payload`, part 3 branch).
3. A switch, if wanted: the settings CHECK (line 54) and `cockpit_blueprint_settings_set` (line 1150) allow only three keys, so a `csm_notice` key needs a migration. The default can simply be "always on".
4. Tests in `blueprint.test.ts`:
   - one #csm-general step on the first close for each route;
   - none on a later press, a rehearsal or `card_only` with Slack failing first;
   - the text never holds the budget fields.
5. The bot. The Edge `SLACK_BOT_TOKEN` must be a member of #csm-general, and it needs `groups:history` for the private-channel read-back.
   - The VPS env's `SLACK_BOT_TOKEN` is the `abdulazizs_second_ass` bot, and it is a member of both #csm-general and #media-general (`auth.test` and `conversations.info`, 2026-10-25).
   - Whether the Edge secret is that same bot is **not verified**. Its only Edge post so far (2026-10-14, `edit.askViktorFor`) went to the default `ALERT_SLACK_TO`, a DM.
6. The kickoff notice can reuse the same channel constant and text rules (the kickoff map covers its trigger).

---

## 7. Risks found

1. **Two paths at once.** The live Typeform, its link on the card and in the CSM kickoff panel, and Make 14's dedupe-free partial route mean one stray partial creates a second open launch task. After that the native part 1 refuses until someone closes one in ClickUp (`blueprint.ts:35, 44-47`).
2. **`make` is a silent no-op today** (section 3.5). The settings UI lets admins choose it.
3. **A pending press without a runner.** If the browser drops between `part_done` and `clientAction`, nothing retries it. The UI says "Run it again", but no server sweep exists.
4. **Prefills that read empty.** The card snapshot misses the four fields until the VPS sync is deployed, so `card.canSelfRecord` and `card.templatedAds` are null in `cockpit_blueprint_sources`. Smmim's card says "Wants To See Them First", but the snapshot says nothing.
5. **Nobody pinged.** With no `launch_assignee`, the launch task is unassigned. This repeats the old path's gap (PLAN.md:166).
6. **The content folder source changed.** Make used Client Data column H; the cockpit uses the card's Drive Folder or Drive Link. They can differ. **Not verified** for any card.

---

## 8. Not verified

- **Make 14 runs before about 30 Sep.** Make's log API keeps roughly four weeks (Make 06 and 07 logs start 30 Sep and 1 Oct). The three September runs are inferred from ClickUp tasks and comments and the #media-general post, not from Make logs.
- **Whether the 13 Sep completion's WhatsApp was sent.** I did not read client WhatsApp history.
- **Whether module [8] wrote ARDON's "Unsure".** Make 14's Can Self-Record? mapping was edited on 17 Sep, after that run.
- **Whether the 14 Sep "Client summary pending approval: Ardon" post came from the Blueprint response** or from another form on hook 4114295.
- **Which Slack app the Edge Function's `SLACK_BOT_TOKEN` is, and whether it can post and read history in #csm-general and #media-general.** Edge secrets were not read.
- **Whether `BLUEPRINT_MAKE_CLOSE`, `MAKE_BLUEPRINT_HOOK` and `MAKE_BLUEPRINT_KEY` are set in the Edge env.** Secrets were not listed.
- **Whether the front ends with the Blueprint card and call page are on production.** The 24 Oct saves show the deck's prep saved through the live database, but I did not check the Vercel bundle.
- **Whether a native launch task gets the same six template subtasks.** It is the same endpoint and template ID, but no native run exists.

---

## 9. How this was read

- **Typeform** (VPS, `TYPEFORM_API_TOKEN` by name): `GET /forms/oYZKtogO`, `/forms/oYZKtogO/webhooks`, `/forms/oYZKtogO/responses?since=2026-08-26&response_type=completed|partial|started`. Only dates and whether the hidden ID was set were printed.
- **Make** (VPS, `MAKE_API_KEY` by name, browser UA, backoff on 429): `/scenarios/9748311`, `/scenarios/9748311/blueprint`, `/scenarios/9209179/blueprint`, `/scenarios/{9748311,9209179,9523861,8925654}/logs`, `/hooks?teamId=2108984`, `/scenarios?teamId=2108984`. Connections were masked.
- **ClickUp MCP:** `get_task 86ex70t90 / 86eyurepc (four fields only) / 86ex8tjyh / z8xmdvh9qf (subtasks)`, `filter_tasks list 901816723196`, `search "Smmim"`, `get_task_comments 86eywc0xy, z8xmdvdza1`, `get_list 901816723196` (statuses), `get_custom_fields 901816559981`.
- **Slack MCP:** `search "Brand Blueprint"`, `search "Client summary pending approval" in C09RZ0GS0V9 (12 to 19 Sep)`, `list_channel_members C09RZ0GS0V9, C0AE8G5MT7Y`. The VPS ran `auth.test` and `conversations.info` only.
- **Supabase `sq.py`:** `cockpit_blueprints`, `cockpit_blueprint_settings`, `cockpit_creative_outbox`, `cockpit_audit_log`, `cockpit_media_actions`, `cockpit_media_provider_health`, `cockpit_members` (roles only), `cockpit_csm_calls`, `cockpit_client_onboarding`, `cockpit_creative_sources`, `pg_constraint`, `pg_proc` (`cockpit_creative_client_action`), `cron.job`.
- **Supabase MCP, read only:** `list_edge_functions`, `get_edge_function cockpit-creative-api` (searched for strings, then deleted locally).
- **Code:** `supabase/migrations/20261024a_brand_blueprints.sql`, `supabase/functions/cockpit-creative-api/{blueprint,outbox,index}.ts`, `supabase/functions/cockpit-media-api/{tools,execute,slack}.ts`, `apps/client-success-cockpit/src/present/{blueprintBrief,blueprintSources}.ts`, `src/lib/blueprintStatus.ts`, `src/forms/{kickoff.ts,FormPanel.tsx}`, `apps/creative-director-cockpit/src/{pages/BlueprintCallPage.tsx,lib/blueprint.ts,lib/creativeSourceModels.ts}`, `hermes/task-assignment-alerts/worker.py`, `hermes/cockpit-sync/creativeProducer.ts`, `docs/brand-blueprint/{SPEC,PLAN,form-map}.md`.
