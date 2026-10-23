# The creative director's side: Brand Blueprint, brand DNA, offer, templated ads

Read-only map, 2026-10-22. Code read in the worktree `deck-answers-1020` (branch kickoff-embed-1022 from main a2ad9154). Live reads came from Supabase (sq.py), the Typeform API and MCP (read-only, no answers copied), the Make API (`GET` of the scenario 14 blueprint only), ClickUp (fields and task lists), and the framework Google Doc. No client's answers are copied here. Counts only.

---

## 0. The short answers

**What "templated ads" are.** These are Mahara's own ready-made ads, with one pack for each main service. A new client can launch on them while their custom ads are made from their own content. Other names for the same thing are "starter ads" (the CSM decks), "template creative" (the Blueprint framework) and the "starter campaign" (the fast-client-launch guide).
- **History.** The project started in April 2026. It covered the 5 niches that are now the kickoff's five main services, written for the residential-homeowner avatar as scripts for AI voice, with Kuwaiti, Saudi and UAE variants.
- **Target.** The October target is 50 to 100 templated client ads. It is a manual "creative" KPI in the CEO scoreboard (`templatedClientAds`).

**Who makes them today, from what, with which tool.**
- **Producing the library is creative's job:** the creative director, the editors and AI generation. No shared library folder or table exists. A Drive search found no "templated ads" library folder.
- **Picking the pack for a client is the creative director's job.** It is Creative Onboarding subtask 4, "Select Templated Creatives So They Can Launch". The output is a Drive folder link, which is what the Blueprint form asks for (`bb0016`).
- **Building and launching them is the media buyer's job,** in Meta Ads Manager, from the "New Client Campaign Launch 🚀" task on Marketing/ADs.
- **Showing them is the CSM's job.** The onboarding deck's starter stop reads `cockpit_csm_launch_ads kind='starter'`, which has 0 rows today, and the prep key `starter_pack`, which is not set on any client.

**The minimum needed to start them.** Almost all of it is known before the Blueprint call even starts:
1. the service, one of the five, from the kickoff;
2. "yes, templates", plus which pack, as a Drive folder link;
3. the daily budget, from the kickoff;
4. the destination (the form says a lead form when launching on templates);
5. evidence that the client approved the pack, the offer and the identity (the kickoff's Templated Ads Status);
6. working ad account and Page access with a funded card (the kickoff);
7. any red lines.

Brand DNA, the offer, the mechanism, pricing, competitors and scripts are **not** needed for templates.

**Where a "part finished" signal can hook in.** One already exists, but almost nobody reaches it:
- **Typeform side.** The Blueprint Typeform has a partial-submit point (a "milestone") on `bb0018`, right after the templated-ads and budget page.
- **Make side.** Make 14's PARTIAL route turns that into a "{client} - New Client Campaign Launch 🚀" task on Marketing/ADs, with a media brief comment.
- **Proof it works.** It fired twice, on 13 Sep and 17 Sep: those two launch tasks were created minutes before the matching form events.
- **Why it no longer fires.** No Blueprint form has been opened for a client since 17 Sep. The 6 Creative Onboarding trees created from 4 to 20 Oct therefore have no Blueprint response and no auto-created launch task. The media buyer cockpit treats an open launch task as the meaning of "launching".

---

## 1. The Brand Blueprint form today (Typeform `oYZKtogO`)

**Who fills it, and when.** It is the creative director's form, filled live on the 45-minute Blueprint call. The client never fills it.
- The welcome screen says: "Fill this as you run the call. The templated ads page sends the media buyer what she needs before you are halfway through."
- The CD cockpit's Links page says "client fills it before the call". **That is wrong.** The Make docs and the form itself both say it is the CD's form.

**Size.** 62 questions, 38 of them required, across 12 groups:
- service and capacity;
- **templated ads + budget**, where the partial-submit point sits;
- best customer;
- the process, both halves (the mechanism);
- pricing (7);
- minimum project;
- competitors;
- the offer (14 fields: front-end pattern, name, one-liner, 3 bonuses, a same-day bonus, 3 tiers, audience size and specificity, destination);
- the offer cheat sheet link;
- approval mode, Brand DNA link, status and what is missing;
- the two rules (always and never), projects that cannot be shown, tone;
- content and on-camera, recording method, shot list;
- the launch call booked and its date;
- scripts status, editor, script date;
- the close (events, offer read back);
- the Fathom link, anything else, and the transcript.

**Settings.**
- `type: quiz`.
- `autosave_progress: true`: it resumes on the same device.
- `milestones: [bb0018]`: this is the partial-submit point.
- `partial_responses_to_all_integrations: true`.
- Both Typeform webhooks (tags `blueprint` and `postcallsummary`, both to hook.eu2.make.com) list only `form_response` in their event types. Partials still reached Make 14 in September, presumably through the setting above. It works, but it is not explicit, so treat it as fragile.

**The 9 hidden fields.**
- `onboarding_client_id`, `legal_name`, `service_focus`, `daily_budget`, `consultation_types`, `website`, `instagram`, `csm_name`, `brand_dna_link`.
- The ClickUp card field `🧬 Brand Blueprint Form Link` (`1b7a4a74`) holds the client's own prefilled link. 68 of 69 cards have one, all carrying `onboarding_client_id`.
- Coverage across those links: 42 carry `legal_name`, `service_focus`, `website`, `instagram` and `consultation_types`; 36 carry `csm_name`; 12 carry `daily_budget`; none carry `brand_dna_link`. Make 12 cannot read the card it writes to.

**Usage since it went live on 31 Aug.**
- 1 completed response (13 Sep).
- 1 real partial (17 Sep), never completed.
- 5 test partials (2 Sep).
- 12 "started" with no client id.
- Nothing since 17 Sep except one bare start on 6 Oct.
- The Insights API shows 0 responses. The Responses API shows the counts above.
- The CSM side's `cockpit_client_onboarding.forms.blueprint` is set on 1 card.

**Logic jumps.**
- Service confirmed → capacity.
- Capacity "Yes" → templated page.
- Templated "No" → skip the folder link.
- Brand DNA complete or not opened → skip "what is missing".
- On camera "No" → skip recording questions.
- Scripts "Not started" → skip to the close.
- Launch call not confirmed → skip to Fathom.

### What repeats something we already have

These are the CEO's "repetitive questions".

| Blueprint question | Already known from |
|---|---|
| Service focus, still right? / which instead | Kickoff "Which service are we advertising?" (`service_focus` hidden) and the card's `Service Advertised` (`bab9a58b`) |
| Daily budget, still right? / corrected | Kickoff budget (hidden `daily_budget`, on only 12 of 68 links) and the card's `Daily Budget` (`539743c2`) |
| Brand DNA doc link (required) | Card `🧬 Brand DNA` (`89bbb8b0`). The Apps Script creates the doc at contract signing (Make 8, module 35/45) |
| Offer cheat sheet link (required) | Card `📈 Offer Cheat Sheet` (`43ca3d4c`), created the same way |
| Fathom recording link (required), call transcript | Fathom: the meeting tools can find the Blueprint call by client and date |
| Launch call booked? / date | The CSM cockpit books the GHL launch calendar (`5E1EVxLJbGiDM3iYl2kL`) and reads bookings back |
| Best customer, who they do not want | Onboarding form `KFRCXPFx` "ideal project" and the kickoff's carried profile |
| Competitors (2 required) | Onboarding form research agent (Make 99: online presence + 5 competitors) and the card's `Market Research doc` (25 of 69 cards) |
| Always / never appear, tone | Card `Do's & Don'ts` (23 of 69 cards) and the onboarding deck's red lines (`prep.red_lines`) |
| How they price / typical range | Onboarding form "services and prices" |
| The whole offer block (14 fields + link) | The CEO: "he's just doing it on the Google Doc anyway". The Offer Cheat Sheet doc is where it is really written (avg 15k characters) |
| Will they be on camera / how will they record | Make 14 already maps these to the card's `Can Self-Record?` (`39839c9d`) on completion |
| Which editor / date scripts go to editors | Video Pipeline (`901816720767`) and the editor desk (`editor_jobs`) |

---

## 2. What the automations do (live Make blueprints and docs)

### Make 12 "Kick Off Form Submitted" (`8925654`, hook 3992232, trigger form tG7dnxBn)

Make 12 sets up everything the creative director gets when the CSM files the kickoff:
- **Module 21** writes `🧬 Brand Blueprint Form Link` (`1b7a4a74`) and sets Client Status to **Brand Blueprint Booked♠️** (`dbd21650…`). The flip is unconditional.
- **Modules 22 and 23** create "{legal_name} - Creative Onboarding 🚀" from template `t-86eyu1w3d` on Media/Creative (`901818016338`) and comment the AI kickoff brief on it.
- **That tree has 6 subtasks:**
  1. Intro And Pre-Call Prep
  2. Run The Brand Blueprint Call
  3. Lock The Brand DNA And The Offer
  4. **Select Templated Creatives So They Can Launch**
  5. Write The Custom Scripts
  6. Custom Ads Produced And Approved
- **Live state of step 4:** 3 complete, 1 in progress, 10 to do, across 14 trees. **Step 3:** 3 complete, 11 to do.
- **Make 12 no longer creates the media buyer's launch task.** The old Media Onboarding route (modules 13/16) was removed. **The only automatic creator of "New Client Campaign Launch 🚀" is now Make 14's PARTIAL route.**

### Make 14 "Brand Blueprint Form Submitted" (`9748311`, custom webhook `4350422`)

Module [2] is a router that splits on `1.event_type`.

**PARTIAL route** (`form_response_partial`, the "media handoff"):
- **Module [3]** creates "{legal_name} - New Client Campaign Launch 🚀" from template `t-86ex8xaf1` on Marketing/ADs (`901816723196`).
  - **No assignee**, so `hermes/task-assignment-alerts` never pings Slack: it only announces assigned main tasks.
  - No due date and no dedupe.
- **Module [4]** comments "Brand Blueprint - media handoff" with:
  - the service (from the kickoff, confirmed or replaced);
  - capacity and the capacity risk;
  - **"Launching on templated ads"** and the **templated ads Drive folder**;
  - the budget (from the kickoff, confirmed or corrected);
  - a link to the client task;
  - "This is the partial handoff sent part-way through the blueprint call."

**COMPLETE route** (`form_response`):
- **Module [5]** posts to Slack #media-general (`C0AE8G5MT7Y`, private): "Brand Blueprint completed … Scripts and custom creative can start."
- **Module [8]** writes `Can Self-Record?` and the `Onboarding Map` (phase 5) on the client card.
- **Modules [9], [6], [10] and [7]** look the client up in the Client Data sheet, wait a random 30 to 120 s, then send the phase 5 map over WhatsApp to the client group, with the content-folder reminder.

**Not written anywhere by either route:**
- the card's `Templated Ads Status` (`e7d158a8`);
- `Offer Creation` (`404ba9d5`);
- Brand DNA status or still-missing items;
- the Brand DNA and offer text.

### The second webhook (`postcallsummary`)

It sits on both the kickoff and the Blueprint form, pointing at a Make hook. The framework's checklist says the call summary "goes to slack #client-success for approval". The scenario behind it was not opened here.

### What the media buyer sees

- In `media-buyer-cockpit/convex/sync.ts` and `hermes/cockpit-sync/calculator.ts` (Aziz, 2026-09-11), "a client is launching when there is an open New Client Campaign Launch task, full stop."
- A pre-launch fallback (`sync.preLaunchClients` / `appendLaunchWatch`) also reads client stages: launch booked, ready for launch, blueprint, onboarding booked.
- The newest auto-created launch tasks date from 13 Sep and 17 Sep. Both came from the Blueprint partial; the matching Typeform events were on the same days, minutes apart.
- Since then, launch work for new clients appears on Marketing/ADs only as hand-made tasks, such as "{client} | Launch campaigns after launch call".

---

## 3. The creative director cockpit today (`apps/creative-director-cockpit`)

**Data.** The browser calls `cockpit_creative_source_read()` (migration `20260927s`). It returns verified snapshot tables from `cockpit_creative_sources`, which `hermes/cockpit-sync/creativeProducer.ts` fills from ClickUp. The model is `src/lib/creativeSourceModels.ts`, ported from the old Convex functions.

**Blueprint tracking is blind.**
- The `blueprints` source table has had **0 rows** since 7 Oct, and was never fed: the comments say "the Typeform read has not been ported".
- So the dashboard's third onboarding sign-off, "Brand Blueprint form submitted", always reads "not tracked in the cockpit yet, check Typeform".
- The CSM backend already reads all four forms into `cockpit_client_onboarding.forms`, which has a `blueprint` key. **Reuse that** rather than porting a second reader.

**Offer sign-off.**
- `offerCreationStatus` is null for all 69 clients, because the `Offer Creation` dropdown is not in `creativeProducer.ts`'s `CLIENT_FIELDS`.
- The dashboard instead reads Creative Onboarding step 3 ("Lock The Brand DNA And The Offer") from the creative board.

**Screens.**
- `DashboardPage` `OnboardingSteps`: three sign-offs per client (Brand DNA task closed, offer step closed, Blueprint submitted).
- `ClientPage`: doc chips for **Brand DNA, Offer creation strategy, Market research, Drive folder**. There is **no Blueprint form button**. The client's prefilled link appears only in the "copy context" text pack (`creativeSourceModels.ts:1265`).
- `KeyLinksPage` (`src/lib/creativeLinks.ts`): the framework SOP, the Blueprint booking link (`x84ET6KnA8odlsjYiVLq`) and the **bare** form link. Its note warns not to send the bare link and says the client fills it before the call; that second part is wrong.

**No templated ads anywhere.** Nothing in the cockpit mentions starter or templated ads: no pack picker, no library, and no signal to the media buyer.

**Writes.**
- `cockpit_creative_touch_log` and `cockpit_creative_outbox` (states pending → done/failed) already exist for creative-side writes back to ClickUp.
- Supabase `clickup-writeback` has a `media_buyer` target (`901816723196`).

---

## 4. Brand DNA and offer: where they live and who reads them

**Origin.** At contract signing, the onboarding Apps Script (Make 8 module 35, `create_client_assets.gs`) creates a Brand DNA doc and an Offer Cheat Sheet doc in the client's Drive folder. Module 45 writes both links to the card. They start as **template drafts**, which is why the cockpit does not trust a filled link (Aziz, 2026-09-08).

**ClickUp links (69 cards).**
- 59 have Brand DNA and 57 have an Offer Cheat Sheet.
- All 20 Active clients have both.
- The `Offer Creation` dropdown exists on the card but is not synced.

**Supabase `editor_clients` (70 rows).**
- `brand_dna_url` 59, `offer_url` 57, **`brand_dna` text 23 and `offer` text 23**.
- Text is read only for clients with open video jobs (`hermes/editor-desk/desk.py` sync). It is re-read when Drive's `modifiedTime` changes and capped at 40k characters.
- Average length: about 10k characters of Brand DNA and about 15k of offer.
- Last read on 22 Oct; no doc errors.

**mahara-context snapshot (13 Sep).** 21 of 54 Brand DNA docs were still the blank template. 52 of 54 offer sheets were real.

**Readers.**
- **Editor desk:** `brand_lines`, with links plus 600 characters of do's and don'ts on the editor's card.
- **Salma** (`hermes/salma/salma.py` `brief()`): the first 3,000 characters each of brand DNA, offer and do's and don'ts into social plans and captions.
- **Hermes `cockpit-creative-director` skill:** reads the offer from ClickUp before any script, and stops if there is none.
- **CSM decks:** do's and don'ts, plus red lines typed in prep.
- **Call-center knowledge base:** deliberately excludes the Offer Cheat Sheet, because "its completion has no reliable trigger" (DECISIONS 2026-09-14). A Blueprint "offer locked" signal would unblock that too.

---

## 5. Templated ads: the rules already written down

**The framework doc** (Google Doc `1DUd5Euj…`, "The Brand Blueprint Call"):
- **Block 8:** the shot-list deadline is 72 hours. "If it slips, we launch on template creative … and swap in custom material as soon as it arrives."
- **Outputs table:** "Template ad selection → Media buyer → Launch immediately while custom builds."
- **Post-call checklist:** "Select the template ads so the media buyer can start immediately."
- **The existing 3-minute opening deck:** a 6-card Gamma deck, `gamma.app/docs/The-Blueprint-Call-4ql4ygy1862k8sv`.

**The fast-launch operating guide** (mahara-context `tools/fast-client-launch/OPERATING-GUIDE.md`, Drive "Mahara Starter Campaign Operating Guide"):
- **Use what exists.** Launch with the existing packs and onboarding records: no new questionnaire and **no complete Brand Blueprint required**.
- **Approval rules.** "Templated Ads Discussed" is not approval. "Approved" counts only when the record names the assets, the offer and the publishing identity.
- **Coverage.** Not every service has an accurate pack: mark the gap.
- **Size.** Start with 2 or 3 existing ads per client.
- **Tracking.** Record starter launch separately from custom completion. A starter launch must not falsely complete the Brand Blueprint or move the portal map.
- **Optional shared identity.** A shared Instagram and Page, "مساحة ومشروع", which does not exist yet.

**Kickoff data.** Field `Templated Ads Status`: Approved, Declined, Waiting On Client, Wants To See Them First.
- On the 5 new-form kickoffs: 3 "Wants To See Them First", 1 Approved, 1 Waiting On Client.
- The same dropdown exists on the client card (`e7d158a8`). Nothing writes it automatically.

**CSM decks.**
- The onboarding deck's O7 picks its first-ads line from the kickoff answer.
- It shows the starter ads only when prep's `starter_pack` names the slide-4 service and starter creatives exist. Today neither exists for any client.
- The editor desk's `deck-import` worker already turns a pasted Drive folder link into `cockpit_csm_launch_ads` rows. The same rows could take `kind='starter'` from the Blueprint's templated-ads folder.

---

## 6. Where to hook a "part finished" signal (ranked)

**1. Keep the Typeform partial point and Make 14's PARTIAL route.**
- It already turns "templated ads chosen + budget" into the media buyer's launch task and brief.
- Make it reachable: the cockpit opens the client's prefilled link, embedded, with the templated page first.
- Make it louder:
  - assign the created task to the media buyer, so the existing assignment worker posts to #client-ads-general (`C0C8DLZGTMZ`);
  - add a due date;
  - also write `Templated Ads Status` on the card.
- Make it explicit: add `form_response_partial: true` to the `blueprint` webhook's event types.
- These are Make and Typeform edits, for Aziz to approve. Never test by submitting the live form.

**2. A cockpit-native part save** (if the form moves into the cockpit or is split into parts).
- An RPC writes `cockpit_blueprint_parts(task_id, part, answers jsonb, done_at, by)`.
- An outbox row (`cockpit_creative_outbox` or `clickup-writeback`) then creates or updates the same launch task, ticks Creative Onboarding **step 4**, and sets `Templated Ads Status`.
- A Typeform response cannot be created through the API. If the cockpit replaces the form, it must also reproduce Make 14's effects:
  - the launch task;
  - the #media-general post;
  - `Can Self-Record?`;
  - the phase 5 Onboarding Map field and the WhatsApp send.

**3. ClickUp alone.**
- Closing step 4 ("Select Templated Creatives So They Can Launch") is the natural human signal.
- Nothing listens to it today, but the cockpit-sync already reads these subtasks (`creativeTasks` `onboardingStep`).

**4. The starter tray.**
- Pasting the chosen pack's Drive folder into `cockpit_csm_launch_ads` as `kind='starter'`, through the existing deck-import worker, lights the onboarding deck's starter stop and the launch deck's phones.
- It is not a launch signal on its own.

### Smallest "part 1" that can launch templates

It could be prefilled from the kickoff and confirmed in under a minute:
- service (confirm one of the five);
- capacity yes / tight / no, with a risk note;
- templated ads yes/no and which pack (folder link, or later a picker by service);
- the budget confirmed;
- the destination (lead form);
- the approval status (from the kickoff, with evidence);
- red lines confirmed from the card.

Everything else (mechanism, pricing, competitors, offer, brand rules, content, scripts, Fathom) can follow, and **the offer part should be a link to the Offer Cheat Sheet doc plus a "locked" tick and a one-line offer name**, not 14 fields.

---

## 7. Gaps found, for whoever builds next

1. **No launch tasks since 17 Sep.** Every new client since then has no auto-created launch task, because the Blueprint form is not being opened. Launch detection on the media buyer side leans on hand-made tasks and the stage fallback.
2. **Blueprint tracking is never fed.** The CD cockpit's `blueprints` source has 0 rows, so the sign-off reads "not tracked". The CSM's `cockpit_client_onboarding.forms.blueprint` is the feed to reuse.
3. **`Offer Creation` is not synced** into the CD cockpit (`creativeProducer.ts` `CLIENT_FIELDS`).
4. **The client page has no Blueprint form button.** The Links page also says the client fills the form, which is wrong.
5. **The partial route's task is unassigned and has no due date,** so nobody is pinged.
6. **The daily budget rides on only 12 of 68 Blueprint links,** and `brand_dna_link` and `csm_name` are often missing. The cockpit can supply all of them from the card when it builds the link or the embed.
7. **The welcome screen promises the media buyer a hand-off.** That hand-off happens only through the partial point. Keep the templated page before any long section.

---

## Side note: the VPS question ("what do you need me to tell the VPS")

Read-only check on 187.77.156.166 as `hermes`:
- `heif-convert` and `heif-dec` are missing, and `libheif-examples` is not installed. `libheif1` is.
- `ffmpeg` and `ffprobe` are present.
- `sudo -n` needs a password.
- The disk is 92% used, with 17 GB free.

The one root command the deck-import HEIC path needs, to be run by someone with sudo:

```
sudo apt-get install -y libheif-examples
```

Then `python3 desk.py doctor` should show `deck-import heic` passing.
