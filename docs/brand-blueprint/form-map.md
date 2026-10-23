# Brand Blueprint form (oYZKtogO) and its automation: the map

Read-only map, 2026-10-22. Nothing was submitted, run or changed. All reads were direct: Typeform API, Make API, ClickUp API, Supabase and Drive. Client answers are summarised as counts only.

Raw definitions saved beside this file in `bb/data/`: the three form JSONs, the Blueprint webhooks, and the Make blueprints for 14, 06, 12 and 16 with their sample data stripped. The scenario list and the ClickUp field list are there too.

---

## 1. The short version

1. **The calls happen, but the form does not get filled.**
   - 9 Blueprint calls were booked on the GHL calendar between 2 Sep and 19 Oct, each 45 minutes.
   - The creative board has 10 Creative Onboarding tasks. On 4 of them, step "2 · Run The Brand Blueprint Call" is complete.
   - The form's current version, edited 17 Sep, has **0 completed responses**.
   - Make 14 has **0 runs** in Make's log window and 0 operations in the last 30 days.
2. **The real output of the call is two Google Docs, not the form.**
   - Make 10 creates the Brand DNA doc and the Offer Cheat Sheet doc at signup, through a Google Apps Script in module 35, and links them on the card:
     - `🧬 Brand DNA` 89bbb8b0, on 59 of 70 cards;
     - `📈 Offer Cheat Sheet` 43ca3d4c, on 57 of 70 cards.
   - The editor desk, Salma and the CD cockpit read those docs through `editor_clients.brand_dna` and `editor_clients.offer`.
   - The form's 14-question offer block retypes the doc's worksheet field for field, which matches the CEO's point: "he's just doing it on the Google Doc anyway".
3. **Partial submit already exists, and it is wired to a single milestone.**
   - `partial_responses_to_all_integrations` is true.
   - `settings.milestones` = [bb0018, "Corrected daily budget"].
   - Make 14 turns that partial into a Media "New Client Campaign Launch 🚀" task with a brief.
   - **Adding more milestones as they stand would cause two problems:**
     - Make 14 would create a duplicate media task for each one, because it has no dedupe and no check on templated = yes.
     - Make 06 would draft a client WhatsApp summary for every partial after bb0019.
   - Both scenarios need a filter before partial submit can be extended.
4. **Most of the form's answers reach nobody.** The complete route writes only three things back:
   - Can Self-Record?;
   - the Onboarding Map phase 5 link;
   - the phase 5 WhatsApp to the client.

   Nothing writes the following back to the card: the Brand DNA link, the offer link, approval mode, the launch date, Offer Creation, the editor, price bands or competitors. The native CD cockpit has no Blueprint producer (0 `blueprints` rows in `cockpit_creative_sources`). The only reader is the CSM onboarding mirror, and 1 card has a Blueprint there.
5. **The form's size:** 62 questions on 32 screens, 38 of them required, 17 long texts.
   - 7 are already answered by the onboarding form or the kickoff;
   - 4 repeat another Blueprint question;
   - 14 are the offer worksheet the CD fills in the Google Doc;
   - 6 are already on the card or in Fathom or GHL.

   That leaves **31 that need the creative director**, and 7 of those are only status ticks.

---

## 2. The form at a glance

| | |
|---|---|
| Form | `oYZKtogO` "Mahara - Brand Blueprint form", created 2026-08-31, last edited 2026-09-17 13:03 UTC |
| Display | https://maharamedia.typeform.com/to/oYZKtogO (public, theme qHWOQ7, workspace N8SfN5) |
| Size | 62 questions on 32 screens. 38 are required. Types: 17 long_text, 15 multiple_choice, 14 short_text, 6 yes_no, 4 website, 4 number, 2 date. 12 are inline_groups. |
| Hidden fields (9) | `onboarding_client_id, legal_name, service_focus, daily_budget, consultation_types, website, instagram, csm_name, brand_dna_link` |
| Hidden fields Make 12 fills (7) | `onboarding_client_id, legal_name, service_focus` (kickoff c…0007), `daily_budget` (kickoff cf53482c), `consultation_types` (kickoff c…0008), `website, instagram` |
| Hidden fields never filled | `csm_name`, `brand_dna_link`. The Brand DNA link is on the card, yet question 48 asks for it to be pasted. |
| Hidden fields filled but unused in any title | `consultation_types, website, instagram` |
| Settings | autosave_progress true, partial_responses_to_all_integrations true, milestones [bb0018], show_time_to_complete true, progress bar proportion, question numbers on |
| Welcome | "Brand Blueprint · {{hidden:legal_name}}" |
| Ending | the default "All done! Thanks for your time." The 13 Sep completion ended on `bbthanks-…`, which no longer exists, so the ending was replaced on 17 Sep. |
| Webhooks | `blueprint` → Make hook 4350422 (gateway) → **Make 14** (9748311) · `postcallsummary` → Make hook 4114295 (Typeform module) → **Make 06** (9209179). The kickoff shares the second one. |
| Builder | `/opt/data/bibi/workspace/forms/build_blueprint_form.py` on the VPS, dated **Aug 31**, older than the 17 Sep live edit. Diff it against the live form before using it again. |

### Jump logic, resolved to screens (with the bugs)
| Trigger | Jumps to | Skips | Verdict |
|---|---|---|---|
| 1 "service still?" = yes | Capacity | "Which service instead" | fine |
| Capacity = Yes | "Templated ads?" | Capacity risk | fine |
| "Templated ads?" = no | Budget confirm | Drive folder link | fine |
| Budget confirm = yes | (no rule) | **nothing**: "Corrected daily budget" always shows | minor, one extra screen |
| Brand DNA status = Complete or "Not opened on the call" | The two rules | "What is still missing?" | "Not opened" should probably still ask |
| **On camera = No** | Initial ad scripts | How they record, shot list, **launch call booked, launch call date** | **bug**: the launch booking is skipped for anyone not on camera |
| **Launch call = "Client confirming today" or "Not booked"** | Fathom link | Launch date, **plus scripts status, editor, scripts date, events and the required offer read-back** | **bug**: it should jump to "Initial ad scripts" |
| Scripts = Not started | Close | Editor and scripts date | the skill flags this as the "nobody assigned" pitfall |

---

## 3. Usage, last 120 days (numbers only)

| | |
|---|---|
| Completed | **1** (2026-09-13, phone, 13.2 min, 7 hidden fields set). It was made on the version before 17 Sep: the API now returns `answers: null` for it, and its thank-you ref is gone. |
| Partial | **6**: 5 on 2026-09-02 within an hour (build tests, all 9 hidden fields set), 1 on 2026-09-17 10:13 (the day of the edit). All 6 have `answers: null` now. |
| Started, no answers | **12**, every one with **no hidden fields**, so the bare link was opened (2026-08-31 to 2026-10-06) |
| Typeform insights | 19 visits / 7 unique, 1 response, completion 14.3%, average time 793 s (13.2 min) |
| Median completion | 13.2 min (n = 1, so not meaningful) |
| Drop-off per question | **Not available.** Every field reads views 0 / dropoffs 0, because the current version has had no tracked sessions. |
| Make 14 | 0 executions in the log window, `/usage` empty (30 days), dlqCount 0 |
| For comparison | Kickoff tG7dnxBn: 8 responses in insights (average 41,037 s, open across the call). Make 12 ran 7 times between 4 and 20 Oct. Onboarding KFRCXPFx: 46 responses (52.3%). |
| The calls themselves | 9 Blueprint appointments on the GHL calendar x84ET6KnA8odlsjYiVLq, booked 2026-09-02 to 2026-10-19, 45-minute slots. **0 Fathom recordings** are matched to a Blueprint call in `cockpit_csm_calls`, yet the form *requires* a Fathom link. |
| Creative board | 10 "Creative Onboarding" tasks (list 901818016338, created 10 Sep to 20 Oct): 4 complete, 5 to do, 1 cancelled. Their six steps are ticked in one batch, so the timestamps cannot measure the 1-2 days the scripts take. |
| Docs | Of the 23 Brand DNA docs read into `editor_clients`, 22 follow the 12-section Brand_DNA_Template, 7 carry "draft" flags, and their average length is 11.1k characters. 15 of 23 offer docs are copies of the Offer Creation Cheat Sheet with the worksheet. |
| Card fields the form could feed | Offer Creation 404ba9d5: **empty on all 70 cards**. Ad Approval Needed? dd2253f9: **empty on all 70**. Can Self-Record? 39839c9d: 21 set. Templated Ads Status e7d158a8: 5 set (Approved 1, Wants To See Them First 3, Waiting On Client 1). Brand Blueprint Form Link 1b7a4a74: 69 of 70. |

---

## 4. Question by question

Categories:
- **a**: already answered by the onboarding form KFRCXPFx or the kickoff tG7dnxBn (source named).
- **b**: repeats another Blueprint question.
- **c**: needs the creative director's judgement. **c·tick** means a status tick, not judgement.
- **d**: the offer-creation part, done in the Offer Cheat Sheet Google Doc anyway.
- **auto**: already on the client card or in Fathom or GHL, so nobody should type it.

Screen numbers are the form's 32 screens. ★ marks the partial milestone.

| # | Scr | ref | Type · req | Question (short) | Cat | Source / overlap | Suggested handling |
|---|---|---|---|---|---|---|---|
| 1 | 1 | bb0001 | yes_no · req | Service focus from kickoff is {{service_focus}}, still it? | **a** | Kickoff c…0007 "Which service are we advertising?" (multi-select). Onboarding 6271b610 "#1 service to focus on scaling". | Keep as a one-tap confirm. The kickoff's multi-select can carry two services into a "the service" question. |
| 2 | 2 | bb0002 | choice · req | Which service instead? (the five main services + other) | c | Framework Block 1 | Keep; it only shows on "no" |
| 3 | 3 | bb0009 | choice · req | Capacity to deliver more? Yes/Tight/No | c | Block 1 decision rule | Keep (media part) |
| 4 | 4 | bb0014 | long · req | Capacity risk to flag to the CSM | c | Block 1 ("flag … the same day") | Keep, but as a short text |
| 5 | 5 | bb0015 | yes_no · req | Are we launching on templated ads? | **a** | Kickoff eb7ed18c "Templated Ads Status" + f54986bc "Templated Ads Discussed" → card e7d158a8. The CSM deck prep `starter_pack`. | Prefill from the kickoff and confirm. "Wants to see them first" needs the CD's call. |
| 6 | 6 | bb0016 | website · req | Drive folder link to the templated ads chosen | c | The CD picks the pack. Default: that service's starter pack (`cockpit_csm_launch_ads` kind starter, Drive). | Prefill a default link and let the CD change it |
| 7 | 7 | bb0017 | yes_no · req | Daily budget from kickoff {{daily_budget}}, still correct? | **a** | Kickoff cf53482c "What is your daily budget for the ads?" (free text). The closer form's daily ad spend. | Keep as a confirm |
| 8 | 8 ★ | bb0018 | number · opt | Corrected daily budget | **a** | The correction to #7 | Add the missing skip on "yes". **This screen is the milestone that fires the media partial.** |
| 9 | 9 | bb0019 | long · req | Best client from the last year / the kind they want more of | c | Seed: onboarding 6c819933 "Describe your ideal project in detail". Block 2. | Keep, shown pre-seeded beside it. **Make 06 keys on this field.** |
| 10 | 9 | bb0020 | long · opt | Who do they not want? | c | Overlaps the minimum project (#22) | Keep, optional |
| 11 | 10 | bb0022 | long · req | First contact to signed contract: what happens? | c | Mechanism mining (Block 2). Brand DNA §2 "Consultation / Sales process". | Keep. The Brand DNA doc also wants it, so it is written twice. |
| 12 | 10 | bb0023 | long · req | Signed to handover: on site, updates, what others don't do | c | Brand DNA §2 "Signature Process" | Keep, with the same doc overlap |
| 13 | 10 | bb0024 | long · opt | What most firms in their city genuinely cannot do | c | Brand DNA §3 "Differentiators / USP" | Keep, with the same doc overlap |
| 14 | 10 | bb0025 | choice · req | Mechanism strength: Strong/Workable/Weak | **d** | The worksheet's "three S's: mechanism strength" | Belongs to the offer doc; repeats #35 and #37 |
| 15 | 11 | bb0031 | short · opt | How do they price? (per meter / project / sqm) | **a** | Onboarding d976036f "services … PRICE of the services" | Seed from onboarding and confirm |
| 16 | 11 | bb0032 | short · req | Typical range where most projects land | **a** | Onboarding d976036f (prices) | Seed and confirm. **b** with the tier ranges (#32-34). |
| 17 | 11 | bb0033 | long · opt | What moves a project from the bottom of the range to the top? | c | Block 3e | Keep, optional |
| 18 | 11 | bb0034 | number · opt | Gross margin on this service % | c | Seed: onboarding d976036f "highest profit" | Make it text: the description says "percentage or a range", but a number field rejects a range |
| 19 | 11 | bb0035 | number · opt | Net margin on this service % | **b** | Repeats #18 | Merge into one "margin" field or drop |
| 20 | 11 | bb0036 | short · opt | Deposit structure and payment terms | **a** | Onboarding ee25f923 "payment options … installments, minimum down payment" (kickoff hidden `payment_options`, read back) | Seed and confirm |
| 21 | 11 | bb0037 | yes_no · opt | Quotation photo received? | c·tick | Block 3h | Better as a file upload to their Drive |
| 22 | 12 | bb0030 | number · req | Minimum project they will accept | c | Block 3a. **b** with the Essential tier (#32). | Keep (it is the call centre's filter) |
| 23 | 13 | bb0039 | long · req | Who are their competitors? | c | Brand DNA §3 "Competitor Overview". Card "Market Research doc" 7489dbcc. | Keep; seed from market research when it exists |
| 24 | 13 | bb0040 | long · req | Why do people go to them instead? | c | Block 4 | Keep |
| 25 | 14 | bb0042 | long · req | Front-end pattern | **d** | Worksheet "My pattern". Seed: onboarding ec89854f "Do you offer free consultations?" | Offer doc |
| 26 | 14 | bb0043 | short · req | Offer name in their voice | **d** | Worksheet "My offer name" | Offer doc. Possibly keep 1 line for the media brief. |
| 27 | 14 | bb0044 | short · req | One-line description | **d** | Worksheet "My one-line description" | Offer doc. Possibly keep for the media brief. |
| 28 | 14 | bb0045 | short · opt | Bonus 1 | **d** | Worksheet | Offer doc |
| 29 | 14 | bb0046 | short · opt | Bonus 2 | **d** | Worksheet | Offer doc |
| 30 | 14 | bb0047 | short · opt | Bonus 3 | **d** | Worksheet | Offer doc |
| 31 | 14 | bb0048 | short · opt | Same-day sign-up bonus | **d** | Worksheet | Offer doc |
| 32 | 14 | bb0049 | short · opt | Essential tier, name and price range | **d** | Worksheet | Offer doc |
| 33 | 14 | bb0050 | short · opt | Signature tier | **d** | Worksheet | Offer doc |
| 34 | 14 | bb0051 | short · opt | Heritage tier | **d** | Worksheet | Offer doc |
| 35 | 14 | bb0052 | choice · opt | Audience size big enough? | **d** | Worksheet "three S's" | Offer doc |
| 36 | 14 | bb0055 | short · opt | One line on why | **d** | Worksheet | Offer doc |
| 37 | 14 | bb0056 | choice · opt | Audience specificity? | **d** | Worksheet "three S's" | Offer doc |
| 38 | 14 | bb0059 | choice · req | Where does the ad send them? Lead form / Landing page | c | Media decision. Its description says "lead form if templates". | **Move into the media part**, before the milestone |
| 39 | 15 | bb0062 | website · req | Offer cheat sheet link | **auto** | Card 43ca3d4c, set at signup (57 of 70) | Hidden prefill; drop the question |
| 40 | 16 | bb0064 | choice · req | Does every video need client approval? | c | Card "Ad Approval Needed?" dd2253f9 (empty on all 70; nothing writes it). Seed: kickoff Templated "Wants to see them first". | Move to the media part; write it to the card |
| 41 | 17 | bb0069 | website · req | Brand DNA doc link | **auto** | Card 89bbb8b0 (59 of 70). Hidden `brand_dna_link` declared but never filled. | Hidden prefill; drop the question |
| 42 | 18 | bb0070 | choice · req | Brand DNA status (Complete / Minor / Major / Not opened) | c | Block 7 | Keep |
| 43 | 19 | bb0075 | long · req | What is still missing? | c | Block 7 | Keep (also ask it on "Not opened") |
| 44 | 20 | bb0076 | long · req | What must ALWAYS appear? | c | Seed: CSM deck prep `red_lines` (typed on the onboarding call) and the card's Do's & Don'ts (filled on 20 of 20 active) | Seed and confirm; write to Do's & Don'ts |
| 45 | 20 | bb0077 | long · req | What must NEVER appear? | c | Same seed | Same |
| 46 | 20 | bb0078 | long · opt | Projects that cannot be shown publicly | **b** | Part of #45 ("never") and Block 7 | Merge into #45 |
| 47 | 20 | bb0079 | short · opt | Tone of voice (dialect/standard, formal/conversational) | **b** | Brand DNA §6 "Tone of Voice". Deck prep `dialect` (kw/sa). | Drop; confirm it in the doc |
| 48 | 21 | bb0081 | choice · req | Rate their existing content | c | Seed: kickoff 3418ef58 content links, 753c4cde "Content Discussed". Onboarding 64d23c81 Drive link. | Keep |
| 49 | 21 | bb0085 | choice · req | Assets moved to the client Drive folder? | c·tick | The cockpit can see the Drive folder | Could be read automatically |
| 50 | 22 | bb0090 | choice · req | Will they be on camera? Yes/Maybe/No | c | Card "Can Self-Record?" | Merge with #51 |
| 51 | 23 | bb0200 | choice · req | How will they record? studio / phone / not sure | **b** | Make 14 already folds #50 and #51 into one card field (Yes-studio / Yes-phone / No / Unsure) | One 4-choice question that matches the card |
| 52 | 24 | bb0094 | yes_no · req | Shot list given with the 72 h deadline? | c·tick | Block 8 | Keep as a tick |
| 53 | 25 | bb0108 | choice · req | Launch call booked? | **auto** | GHL launch calendar 5E1EVxLJbGiDM3iYl2kL (the cockpit already books and reads it) | Read the booking; show the Book button |
| 54 | 26 | bb0112 | date · req | Launch call date | **auto** | Same booking. **b** with #53. | Drop |
| 55 | 27 | bb0095 | choice · req | Initial ad scripts: Written / In progress / Not started | c·tick | Creative board step "5 · Write The Custom Scripts". At the end of the call it is almost always "Not started", because scripts take 1-2 days. | Leave it to the board/doc; drop from the call |
| 56 | 28 | bb0099 | choice · req | Which editor? (two named editors / Not assigned) | c·tick | The editor desk assigns | Drop or make optional |
| 57 | 29 | bb0104 | date · req | Date the scripts go to the editors | c·tick | | Optional, or set later on the board |
| 58 | 30 | bb0105 | long · opt | Events coming up to script for? | c | Block 9 | Keep, optional |
| 59 | 30 | bb0106 | yes_no · req | Offer read back in one sentence and confirmed? | c·tick | Block 9. **b** with the offer block. | Keep as the closing tick |
| 60 | 31 | bb0113 | website · req | Fathom recording link | **auto** | Fathom / csm-calls (0 Blueprint recordings matched so far) | Auto-attach; never require it |
| 61 | 32 | bb0114 | long · opt | Anything else the team needs to know | c | | Keep |
| 62 | 32 | 0cf5f422 | long · opt | Call transcript | **auto** | Fathom transcript. **Make 06 uses this field** to write the client's WhatsApp recap. | Auto-fill |

**Tally:** a 7 · b 4 · c 31 (7 of them status ticks) · d 14 · auto 6 = 62.

**What a lean call form keeps:** about 24 judgement questions, plus 5 confirms prefilled from the kickoff and onboarding.
- The 14 offer questions become a link to the client's Offer Cheat Sheet doc, which is already on the card.
- The editor desk and Salma already read that doc as text into `editor_clients.offer`.
- If the media brief needs the offer name and one-line description early, keep just those two.

---

## 5. Make 14 "14. Brand Blueprint Form Submitted" (9748311)

- **State:** active, created 2026-09-02, last edit 2026-09-17 15:47 UTC. Folder "01 - Client Ops". Not sequential, maxErrors 3, no DLQ.
- **Trigger:** gateway custom webhook, hook 4350422 "Brand Blueprint form". Typeform webhook tag `blueprint`, enabled.
- **Documented in:** mahara-context `systems/Mahara OS V2/Make Scenarios/Maharav1/14. Brand Blueprint Form Submitted.md`, last verified 2026-09-08. That note predates the partial route (it says partial saves "follow the PARTIAL route" without listing its modules).

```
[1] Webhook "Blueprint form submitted"
[2] Router "Split: partial vs complete"
 ├─ PARTIAL  filter event_type = form_response_partial
 │   [3] ClickUp createATaskFromATemplate "Create Media Onboarding task"
 │       list 901816723196, template t-86ex8xaf1
 │       name "{legal_name} - New Client Campaign Launch 🚀"
 │   [4] ClickUp comment on that task "Brand Blueprint - media handoff":
 │       service focus + still/instead, capacity + risk, templated yes/no
 │       + Drive folder, budget from kickoff + still correct + corrected,
 │       client task link, "partial handoff… rest still being filled"
 └─ COMPLETE filter event_type = form_response
     [5] Slack C0AE8G5MT7Y (private, "media-general"):
         "Brand Blueprint completed … Scripts and custom creative can start."
     [8] ClickUp edit client card (list 901816559981):
         Can Self-Record? 39839c9d = on camera No → "No"; else by how they
           record: studio → "Yes - studio/cameraman", phone → "Yes - phone
           only", otherwise "Unsure"
         Onboarding Map 51f49cb1 = mahara-onboarding-map.vercel.app/?phase=5&cid=…
     [9] ClickUp get task (reads the Onboarding Map back)
     [6] Google Sheets "Client Data" (1_0Nv-…): find row where C = card id
     [10] Sleep 30–120 s (WhatsApp safety)
     [7] WHAPI text to the group in col F (5), only if F is not blank:
         Arabic "phase 4 done: brand and offer; next: the launch call" +
         Onboarding Map link + content-folder reminder from col H (7)
```

**What it does not do on completion:** it never sets the Client Status, so it stays "Brand Blueprint Booked" even when the launch is booked. It does not write any of these back:
- the Brand DNA link or the offer link (they are already there);
- Ad Approval Needed?;
- Launch Date;
- Offer Creation;
- the editor;
- the scripts date;
- the price bands or the minimum (nothing reaches the call centre);
- the competitors;
- the capacity risk (it goes to the media task only on the partial, never to the CSM);
- Do's & Don'ts.

The Typeform response is the only copy of those answers.

**Gaps that matter for "partial submit per part":**
1. **No dedupe.** Every `form_response_partial` creates a new media task. One milestone means one task per response today. Each extra milestone would add another task, and so would reopening the link in a fresh session, which starts a new response.
2. **No check on templated = yes.** The media launch task is created even when the answer is "not on templates".
3. **The bare link.** A partial from the unprefilled link (the creative cockpit's Links page lists it, see §7) would create " - New Client Campaign Launch 🚀" with no client and a broken client link.
4. **Every webhook gets every partial.** The setting `partial_responses_to_all_integrations` is form-wide, so Make 06 sees each partial too (next section).

---

## 6. The other scenarios that touch the Blueprint

### Make 06 "Post Call Summary - Tasks, Notes, Client Summary" (9209179)

Typeform-module trigger on hook 4114295, tag `postcallsummary`. It is shared by the **kickoff tG7dnxBn, the Blueprint oYZKtogO and the check-in fRokTITH**. It ran 27 times in the log window.

```
[2] Typeform watch → [16] ClickUp get task (hidden onboarding_client_id)
→ [13] Sheets Client Data row (col C = card id)
→ Router "Which call was this?"
  Route 1 (check-in fRokTITH only): GPT to-do list → ClickUp comment, GPT
           call grade → Slack C09SVG6FHGU, Client Happiness + Last POC
  Route 2 filter "not a mid-call partial":
           form_id ≠ oYZKtogO  OR  bb0019 (best customer) exists
     [22] GPT-4.1 client WhatsApp recap from the transcript (0cf5f422 on
          the Blueprint) or, when there is none, from the answers
     [23] Data store 171744 record keyed by response token, status pending,
          with "if you have not booked the launch call yet, book here"
          + launch link 5E1EVxLJbGiDM3iYl2kL
     [24] Slack C09RZ0GS0V9 "Client summary pending approval" with
          APPROVE / DENY links → Make 07 "Send Approved Client Summary"
          (9523861) sends it by WHAPI
```

**Constraint:** the guard is "bb0019 exists", not "this is a completed response".
- Today the only milestone (bb0018) comes before bb0019, so the Blueprint partial is blocked.
- **A milestone after bb0019 would draft a client WhatsApp recap for each partial.** Each draft is a Slack approval post, still human-gated; the data store row is overwritten by token.
- The filter should become `event_type = form_response` for oYZKtogO.

### Make 12 "Kick Off Form Submitted" (8925654), upstream

Ran 7 times between 4 and 20 Oct.
- [11] Handoff comment on the client card, 11 sections.
- [20] Card status set to IN PROGRESS.
- Router:
  - **TECH**: Technical Onboarding task (list 901816723190, template t-86ex8x9xw) and a brief.
  - **Blueprint**: [21] writes these card fields:
    - `🧬 Brand Blueprint Form Link` 1b7a4a74 = `…/to/oYZKtogO#onboarding_client_id=…&legal_name=…&service_focus=<kickoff c…0007>&daily_budget=<kickoff cf53482c>&consultation_types=<kickoff c…0008>&website=…&instagram=…`, all values URL-encoded;
    - **Client Status = "Brand Blueprint Booked♠️"** (option dbd21650);
    - Mahara OS Access, Google Calendar Integration, Contract Status, Service Advertised, Meta Ad Account Access, WhatsApp CRM Sync, WhatsApp Group Status, **Templated Ads Status** and Training Course Access, from the kickoff.
  - **CREATIVE**: Creative Onboarding task (list 901818016338, template t-86eyu1w3d) and a brief. The template has 6 steps: 1 Intro and pre-call prep · 2 Run the Brand Blueprint call · 3 Lock the Brand DNA and the offer · 4 Select templated creatives so they can launch · 5 Write the custom scripts · 6 Custom ads produced and approved.
  - Onboarding Map phase 4, then a WhatsApp to the group.
- The kickoff thank-you screen links the Blueprint booking (x84ET6KnA8odlsjYiVLq).
- **Trap:** the kickoff's service question is multi-select, so `service_focus` can be "A, B". Make 12's `switch()` for Service Advertised then returns nothing, and the Blueprint's "still THE service?" is ambiguous.

### Make 10 "Closer Form to Onboarding (MAIN)" (8979157), where the docs come from

- Module 35 POSTs to a Google Apps Script (`script.google.com/macros/s/AKfycbxagVl8…/exec`) with the client name, email, time zone, ClickUp id, WhatsApp group id and GHL id.
- The script returns `brandDnaLink`, `offerLink` and `internalDocLink`.
- Module 45 writes `🧬 Brand DNA` 89bbb8b0 and `📈 Offer Cheat Sheet` 43ca3d4c onto the card, plus the plain kickoff link 87d7d889.
- So the Brand DNA doc (Brand_DNA_Template, 12 sections plus a moodboard) and the Offer Cheat Sheet copy (5 service sections plus "Your Offer" worksheet, EN and AR) **exist before the Blueprint call.** The CD fills them.

### Make 16 "ClickUp Launch Campaigns to Slack" (9356423), downstream of any launch

- Watches tasks on the Ads management list 901817774521 that carry the client's tag.
- On the client's first campaign it:
  - posts the Slack launch messages;
  - writes **Launch Date** 2e744484 and **Next Payment Date** 669ae046 onto the client card, which is the billing anchor;
  - sets Onboarding Map phase 6 and sends that WhatsApp.
- A starter/templated launch fires this too.
- The fast-client-launch guide (mahara-context `tools/fast-client-launch/OPERATING-GUIDE.md`) warns that a starter campaign must not falsely complete the Brand Blueprint or custom production, and must not send the first-launch messaging twice.

---

## 7. What reads the Blueprint's outcome downstream

| Consumer | Reads | From the form? |
|---|---|---|
| `editor_clients` (Supabase), via hermes/editor-desk `desk/clients.py` | `brand_dna_url/brand_dna`, `offer_url/offer` (doc text, last read 2026-10-22), `dos_donts`, `drive_url` | **No.** Card links and doc text. 19 of 20 active clients have both docs as text. |
| Editor desk scripts, Salma (`hermes/salma/salma.py` BRAND DNA / OFFER / DO'S AND DON'TS), video editor JobPage | the same doc text | No |
| CD cockpit (native, Supabase `cockpit_creative_sources`) | clients (`blueprintFormLink`), creativeTasks, … | `blueprints` is allowed in the CHECK list but has **0 rows**. No producer was ported; Convex's `buildFreshness` says "the Typeform read has not been ported". `creativeSourceModels.ts` makes a "Brand Blueprint form submitted" step expected for clients onboarded after 2026-09-05, so it reads as untracked or not done. |
| Legacy `viktor-side-scripts/sync_cockpit.py fetch_blueprints` | Typeform responses, client from hidden `client`/`client_name` | That hidden field does not exist on this form, so even the old path could not attribute a response |
| CD cockpit offer "done" | creative board subtask "3 · Lock The Brand DNA And The Offer", or the card's Offer Creation = Done | No. Offer Creation is empty on all 70 cards. |
| CSM onboarding mirror `cockpit_client_onboarding.forms.blueprint` (10-min cron) | the Blueprint response per card | Yes: 1 card (the 13 Sep one) |
| CSM decks (`apps/client-success-cockpit/src/present`) | kickoff Templated Ads Status, prep `starter_pack`, `red_lines`, `dialect`, `budget_band`, `cockpit_csm_launch_ads` (kind starter, Drive). The onboarding deck's last stop says "Next: your Brand Blueprint call · 45 minutes … your brand, your offer, your first ad scripts". | No. These are seeds the Blueprint could prefill from: the pack, the red lines, the dialect and the budget band. Deck prep is barely used so far: 1 row, with only `onboarding_presented_at`. |

---

## 8. The call the form mirrors (for the Blueprint deck work)

**Framework doc** "The Brand Blueprint Call — Creative Director Framework" (1DUd5Euj4Ke7TNlY1MwAH-YB72-VED8JcILa84GvG528), linked from the CD cockpit's Links page.

- **Prep:** 15 minutes. Walk in with 70% filled: read the kickoff and the notes, open the Brand DNA and mark its blanks and drafts, copy the Offer Cheat Sheet at their service, and pre-write a guess at their offer.
- **The blocks:**

| Block | Topic | Time |
|---|---|---|
| 0 | Frame and authority, with the 3-minute Gamma opening deck | 5 min |
| 1 | Service map and focus: one service; where margin and capacity conflict, margin wins and the capacity risk goes to the CSM the same day | 5 min |
| 2 | What they are best at: a mechanism, not an adjective; their exact words | 10 min |
| 3 | Pricing and tiers: minimum, method, range, high end, what moves it, deposit, timeline, a quotation photo | 8 min |
| 4 | Competitors | 4 min |
| 5 | Build the offer live, screen-sharing the Offer Cheat Sheet: pattern, name, 2-3 bonuses, price anchor, what the consultation delivers and who gives it | 12 min |
| 6 | Paid-ad expectations (offer as entry point, paid vs referral, paid vs organic, creative flexibility, hold the frame) | 5 min |
| 7 | Brand DNA on screen: logo, dos and don'ts, colours, fonts, tone, public projects, banned names, watermark; always/never | 3 min |
| 8 | Content: shot list with a 72 h deadline, else we launch on templates; hesitation goes to the CSM within 24 h; upsell signals in writing | 5 min |
| 9 | Read back in one sentence and get a yes | 3 min |
| 10 | Book the launch call 1-3 days out, run by the CSM | 2 min |

- **After the call:** the outputs table (Brand DNA → scripting · offer worksheet → media buyer and CD · price bands → call centre · competitors → CD · content status → editor and CSM · template ad selection → media buyer · capacity and upsell → CSM · Fathom → client channel) and a 9-item post-call checklist.
- **Opening deck (Gamma):** "The Brand Blueprint Call" (gamma.app/docs/The-Brand-Blueprint-Call-4ql4ygy1862k8sv), six cards:
  1. "Everything we build for you starts here."
  2. Why you are here with our Creative Director: competitors all say the same, we need the real difference, that difference becomes your advertising.
  3. The next 45 minutes: services 5 · best at 10 · pricing 8 · competitors 4 · offer 12 · content and next steps 8.
  4. Three rules: push back, be specific on money, say you don't know.
  5. What I need from you: honest ranges, the real answer, decisions.
  6. What happens next: this call → we build → your launch call.
- The form's block order follows the framework, and the form-building skill's rule is "mirror the call framework block by block". **The skill also records the design intent:** the media buyer's fields fire about 3 minutes in rather than at minute 45. That is today's milestone.

---

## 9. Other things found

- The CD cockpit's Links page (`apps/creative-director-cockpit/src/lib/creativeLinks.ts`) lists "Brand Blueprint form (client fills it before the call)" with the bare link, and says "Read their answers as part of the prep, not on the call". That is wrong on both counts:
  - the CD fills this form on the call;
  - the bare link is how the 12 unattributed "started" sessions happened.
- "Gross margin %" and "Net margin %" are `number` fields whose description says "Percentage or a range". A range cannot be typed into them.
- The Fathom link is required, but none of the 9 Blueprint calls has a matched recording.
- The form names the two editors and "Sabry" in descriptions. That is fine for an internal form, but the team-docs rule (roles, not names) applies to anything shown to the team in a deck.
- Make 12, 14 and 16 each find the WhatsApp group in the Google Sheet "Client Data" (`1_0Nv-…`), columns C (card id), F (group id) and H (content folder).

---

## How this was read (for the next session)

- **Typeform:** `GET /forms/{id}`, `/forms/{id}/webhooks`, `/forms/{id}/responses?response_type=completed|partial|started&since=…` and `/insights/{id}/summary`. The token is `TYPEFORM_API_TOKEN` in `/opt/data/bibi/api-keys.env` on the VPS, used over ssh and never printed. The raw responses were deleted after counting.
- **Make:** `https://eu2.make.com/api/v2/` (`/scenarios?teamId=2108984`, `/scenarios/{id}/blueprint`, `/scenarios/{id}/logs?pg[limit]=50`, `/scenarios/{id}/usage`, `/hooks?teamId=2108984`). The header is `Authorization: Token $MAKE_API_KEY` with a browser user agent (Cloudflare 1010 otherwise). The logs limit is at most 50.
- **ClickUp:** `/list/901816559981/field`, `/list/901816559981/task` and `/list/901818016338/task?subtasks=true` with `CLICKUP_API_KEY`.
- **Supabase:** `sq.py` reads of `editor_clients`, `cockpit_client_onboarding`, `cockpit_csm_calls`, `cockpit_creative_sources` and `cockpit_csm_deck_prep`.
- **Drive:** the framework doc, the Offer Creation Cheat Sheet 14fBr8Qp6Ze6fMjNFAuBRhmRl_exd4f4z8QblyDer1XE and Brand_DNA_Template 18e3EmAlNoM6YR6kpoxy0eRpyl-oPIkWRxzEyjC2haqM.
- **Gamma:** read through the in-app browser.
