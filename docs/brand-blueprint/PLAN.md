# Brand Blueprint: the shorter form, partial submit, and the call deck

Plan, 2026-10-22. Built from `form-map.md`, `call-map.md` and `cd-map.md` (same folder), the kickoff spec `docs/csm-forms/KICKOFF.md` on branch `kickoff-embed-1022`, and the code at `a2ad9154`. Nothing here is built, submitted, deployed or applied. People are named by role. No client's answers appear here.

The CEO's two asks (2026-10-22), in short:
- Make the Blueprint form as easy as possible. Prefill everything the kickoff knows and summarise it. Merge the repeated questions. Make the offer part a waiting link to the Google Doc he already writes in. Finishing a part should already start the templated ads.
- Build a Brand Blueprint call presentation with the form embedded as they go through it. Show different styles and make it astonishing.

Every open point below has a default. The build goes ahead on the default, and the CEO can correct it.

---

## 0. Decisions in one screen

| Decision | Choice |
|---|---|
| The form | **A native cockpit form saved to Supabase** (`cockpit_blueprints`, one row per client card). Typeform `oYZKtogO` is retired, not edited. |
| Its size | **33 visible questions in 3 parts, 21 of them required** (today: 62 and 38). Of the 21, 10 come prefilled or as a summary to confirm, and 3 more start from a seeded default. The 14-field offer worksheet becomes a link to the client's Offer Cheat Sheet doc. |
| Part 1, "Starter ads" | Filled on the call by minute 10, and almost all of it is prefilled from the kickoff. The CD presses **Send to media**, and the cockpit makes the media buyer's launch task: assigned, due, tagged, deduplicated, with the brief. |
| Part 2, "Brand and money" | Filled on the call. **Close the call** fires what Make 14's complete route does today: the Slack post, Can Self-Record?, Onboarding Map phase 5, and the phase 5 WhatsApp. It also writes the card fields nobody writes today. |
| Part 3, "The offer" | A waiting link to the Offer Cheat Sheet, the offer in one sentence, and a **Lock the offer** tick 1 to 2 days later, from the CD cockpit. It sets Offer Creation = Done and tells media and the editor desk. |
| What replaces Make 14 | Part 1: the cockpit's creative outbox (better than Make 14's partial route). Part 2: **one new route on Make 14's existing webhook**, fed by the cockpit and reusing its Slack, card, Sheet and WHAPI modules. The two existing routes stay untouched. That is the only Make edit. |
| Make 06's AI recap | Not replaced in v1. It has never run for a Blueprint, because there was only 1 completion. Phase 2 option. |
| The deck | A third deck kind, `blueprint`, in the existing engine: the 1920x1080 canvas, notes window, prep view, EN/AR. **14 slides, 45 minutes**, presented by the **creative director**. Client-facing fields are typed on the slide, so the client watches their words land. Private fields live in the notes window. |
| Where it lives | **Both cockpits, one code path.** The deck and its form are served by the client success app's deck engine at the shared portal, gated for creative and CSM seats. The CD cockpit has the entry points, the part status, the sign-off and the part 3 finish. The CSM cockpit reads the record: the Onboarding panel and the launch deck. |
| Templates or custom first | **Starter first, custom follows.** The CEO's word of 2026-10-22 overrides the agreement of 2026-10-06. |
| Length | **45 minutes**, matching the calendar and what the client is told. The framework's 62 minutes fit because the kickoff already answered about 10 minutes of it. |
| Look | Three directions to show the CEO (studio wall, editorial issue, cinematic reel). **Default: editorial issue** on Mahara tokens, with the reel's phone frames on the starter-ads slide. |
| Backend | Two tables, six functions, one outbox extension in `cockpit-creative-api`, audit on every part and every send. |

---

## 1. The shorter Blueprint form

### 1.1 How each question is marked

- **PREFILLED**: the answer is already set from the kickoff, the onboarding form, the onboarding deck or the card (source named). The CD taps once to confirm or changes it.
- **SUMMARY**: the client's earlier words, shortened, shown for the CD to confirm or type over (see 1.5).
- **NEW**: needs the CD or the client on the call.
- **AUTO**: never asked. It is read from the card, the call store or the bookings, and attached to the record.

Placement: **slide** means the field sits on the shared slide, so the client sees it typed. **notes** means it sits in the CD's notes window only and never reaches the client's screen.

Kickoff refs are `tG7dnxBn`'s, onboarding refs are `KFRCXPFx`'s (as in `KICKOFF.md` 2.2), and card fields are the client card's on list `901816559981`.

### 1.2 Part 1: Starter ads (on the call, slides 4-5, done by about minute 10)

| # | Question | Mark and source | Where | Req |
|---|---|---|---|---|
| 1.1 | The one service this campaign sells | PREFILLED: kickoff "Which service are we advertising?" (`c…0007`), then slide 4's pick on the onboarding deck (prep `service_focus` with `service_chosen_at`), then onboarding `6271b610` mapped onto the five. If the kickoff picked two services, the slide asks which one goes first. | slide (five chips, one lit) | yes |
| 1.2 | Capacity to take more of it: Yes / Tight / No. When Tight or No, one line for the CSM. | NEW | notes | yes |
| 1.3 | Launch on starter ads now? Yes / No | PREFILLED: kickoff Templated Ads Status `eb7ed18c`. Approved means Yes and Declined means No. "Wants To See Them First" and "Waiting On Client" are decided live, after slide 5 shows the pack. | slide | yes |
| 1.4 | Which pack | PREFILLED: that service's pack from the starter-pack settings (a Drive folder). The CD can paste another. | notes | if 1.3 = Yes |
| 1.5 | The client approved the pack: On this call / Before (kickoff Approved) / Wants changes (one line) | NEW, seeded from 1.3. This is the approval record the fast-launch guide requires: the assets are named (the pack), along with the publishing identity (1.8). | slide (one tap) | if 1.3 = Yes |
| 1.6 | Daily budget | PREFILLED: kickoff `cf53482c`, then card Daily Budget `539743c2`. One-tap confirm or correct. **Never on a slide**, following the decks' rule of no budget money on screen. | notes | yes |
| 1.7 | Where the ad sends people: Lead form / Landing page | PREFILLED: Lead form when 1.3 = Yes, the old form's own rule | notes | yes |
| 1.8 | Publishing identity: Their Page / Our Page | PREFILLED: kickoff Facebook Access Status `6fcbd33c`. "Using Ours" means Our Page; "Access Confirmed" and "Their Page Our Ad Acc" mean Their Page. | notes | yes |
| 1.9 | Red lines for any ad (always / never) | SUMMARY: onboarding deck prep `red_lines`, plus the card's Do's & Don'ts `0f06a523` | slide | no |

Carried into the media brief, never asked (AUTO): platforms (kickoff `7d16afbb`), the exact ad account and Page names (`e4b9dbd3`, `940f494c`), card linked with funds (`8bee68fc`), consultation types (`c…0008`), the CSM, and the Drive, Brand DNA and offer links.

### 1.3 Part 2: Brand and money (on the call, slides 6-14, ends with Close the call)

| # | Question | Mark and source | Where | Req |
|---|---|---|---|---|
| 2.1 | Their best client, the kind they want more of | SUMMARY: onboarding `6c819933` "Describe your ideal project" | slide | yes |
| 2.2 | Who they don't want | NEW | slide | no |
| 2.3 | How a project runs with them, first call to handover, in their words. This is the mechanism, and it merges the old `bb0022` and `bb0023`. | NEW | slide (pull quote) | yes |
| 2.4 | What most firms in their city can't do | NEW | slide | no |
| 2.5 | How they price, and the typical range | SUMMARY: onboarding `d976036f` "services and prices" | slide | yes |
| 2.6 | The minimum project they accept (a number). This becomes the call centre's filter. | NEW | slide | yes |
| 2.7 | The price the ads anchor at (the high end they want more of) | NEW. The August spec asked for it, and the old form never had it. | slide | yes |
| 2.8 | Deposit and payment terms | SUMMARY: onboarding `ee25f923` | slide | no |
| 2.9 | Margin on this service (text, so a % or a range both fit). It merges the old gross and net number fields. | NEW | notes | no |
| 2.10 | Competitors, and who they actually lose to | SUMMARY when the card's Market Research doc `7489dbcc` exists (25 of 70 cards), otherwise NEW. Research is a starting list, never an approved offer. | slide | yes |
| 2.11 | Why people choose them instead | NEW | slide | no |
| 2.12 | Custom ads approval: Every video / First batch only / Run and show after | NEW, seeded to First batch when the kickoff said "Wants To See Them First" | slide (three cards, the client picks) | yes |
| 2.13 | Brand DNA doc status: Complete / Small gaps / Big gaps, plus one line on what is missing. "Not opened" is no longer an exit. | NEW. The doc link is AUTO from card `89bbb8b0`. | notes | yes |
| 2.14 | Always / never / never show (projects, names) | SUMMARY: 1.9's lines. It merges the old `bb0076`, `bb0077` and `bb0078`. | slide | yes |
| 2.15 | On camera, and how: Yes, studio or cameraman / Yes, phone only / No / Unsure. These are the card's own four choices. | NEW, seeded from card Can Self-Record? `39839c9d` when set. It merges `bb0090` and `bb0200`. | slide | yes |
| 2.16 | Their existing content: Strong / Usable / Weak / None | SUMMARY: kickoff `3418ef58` links and onboarding `64d23c81` Drive, shown as links | notes | no |
| 2.17 | Shot list given; the due date is AUTO (the call plus 72 hours, Kuwait time) | tick | slide (date) / notes (tick) | no |
| 2.18 | Events coming up to script for | NEW | slide | no |
| 2.19 | Read-back confirmed: they said yes to the one sentence (3.1) | tick | notes | yes |
| 2.20 | Capacity, UGC or upsell signals for the CSM | NEW | notes | no |
| 2.21 | Anything else the team should know | NEW | notes | no |

AUTO, never asked:
- the launch call booking (from the bookings the cockpit already reads);
- the Fathom link and the transcript (the call store, when it matches; **never required**, because 0 of 9 Blueprint calls has a matched recording today).

### 1.4 Part 3: The offer (built live in the doc, locked 1 to 2 days later)

| # | Question | Mark and source | Where | Req |
|---|---|---|---|---|
| 3.1 | The offer in one sentence: its name, plus what they get | NEW. Typed live on the read-back slide (13) and editable until locked. The media brief and the launch deck use it. | slide 13 | yes |
| 3.2 | The Offer Cheat Sheet | AUTO: card `43ca3d4c`. Slide 9 opens it in its own window to share. The 14 worksheet fields stay in the doc. | slide 9 (button) | |
| 3.3 | **Offer locked in the doc** | tick. This is part 3's partial submit. | CD cockpit | yes |
| 3.4 | Custom scripts: In progress / With the editors, plus a date | NEW | CD cockpit | no |

### 1.5 What was cut, and why

| Old (ref) | Now |
|---|---|
| Offer worksheet `bb0042`-`bb0056` (14 fields), mechanism strength `bb0025` | In the Offer Cheat Sheet doc, where the CD already writes it. The form keeps 3.1 and 3.3. |
| Offer link `bb0062`, Brand DNA link `bb0069`, Fathom `bb0113`, transcript `0cf5f422` | AUTO |
| Launch call booked and date (`bb0108`, `bb0112`) | AUTO from the booking. This also fixes the old jump bug that skipped them. |
| Gross and net margin (two number fields) | One optional text field, 2.9 |
| Tone `bb0079`, assets moved `bb0085` | Tone stays in the Brand DNA doc. The asset move is visible in the Drive folder. |
| Editor and scripts date (`bb0099`, `bb0104`), scripts status `bb0095` | 3.4 (optional). The editor desk assigns editors. |
| Quotation photo `bb0037` | A line in slide 7's note: "ask for a photo of a real quotation into their Drive" |
| Budget correction as its own screen (`bb0018`) | Folded into 1.6 |

**Summaries (SUMMARY rows).**
- **v1 is deterministic.** It shows the client's own words, cut to about 160 characters on whole words, with the source and date ("Onboarding form, 13 Oct"), and `show all` beside it. Arabic stays as typed, inside `<bdi dir="auto">`. The CD ticks to accept or types over. Only the accepted text reaches a slide. This is the same choice the CSM client brief made (`clientBrief.ts`).
- **Phase 2** adds AI one-liners drafted at prep through the existing Ask AI queue. The CD still accepts each one before it shows. Arabic client copy stays on a frontier model.

---

## 2. Partial submit

### 2.1 Typeform split or native: native

**Decision: a native cockpit form saved to Supabase, with each Make output replaced one for one (table 2.5).** `oYZKtogO` stays live and unedited, because Make 12 still writes its link on each card. No cockpit links to it any more.

**Why native.**
1. **One entry, on the slide.** The client should watch their own words land on the deck (the framework's "exact words" rule). A Typeform iframe is one linear session:
   - it cannot follow the slides;
   - it cannot jump to a section;
   - it cannot keep private answers (margin, budget, capacity) off a shared screen.

   So the CD would type everything twice, which is the problem we are solving.
2. **Parts that wait.** Part 3 waits 1 to 2 days.
   - A Typeform response resumes only in the same browser (autosave), and the kickoff spec already flags autosave carrying one client's answers into the next client's form.
   - Typeform's partial events fire on Typeform's terms, and a reported issue drops the last answer before the partial point.
   - The cockpit sends a part exactly when the CD presses its button.
3. **No duplicate launch tasks.** Make 14 creates a new task for every partial event. The cockpit's outbox is one row per request ID, and the executor looks for an existing launch task before it makes one.
4. **Real prefill.** Hidden fields cannot preselect a choice. The native form starts with the service lit, the budget set and the pack picked.
5. **The answers finally reach someone.** Today the form's answers reach nobody (form-map 5). A Supabase record is readable by the CD cockpit, the CSM Onboarding panel, the launch deck, the editor desk and, later, the call centre.
6. **Little to replace.** Downstream of the Blueprint form there are two Make 14 routes and one Make 06 branch. None has run since 1 October.

**Why not split the Typeform.** Three Typeforms would need:
- three webhooks;
- three Make routes;
- three card link fields where Make 12 writes one;
- three keys in the CSM mirror where it reads one.

The CD would still type everything twice on the call.

**Why the kickoff stays on Typeform but the Blueprint does not.** Make 12 does about a dozen things off each kickoff and runs every week: tasks, statuses, nine card fields, WhatsApp. The Blueprint's Make work is two routes that have not run since September.

### 2.2 Part 1 done: what it means and what it triggers

**Done means** 1.1, 1.2, 1.3, 1.6, 1.7 and 1.8 are answered (plus 1.4 and 1.5 when 1.3 = Yes), and the CD presses **Send to media** in the notes window.
- The server re-checks the required keys before it stamps `part1_at`.
- The button sits in the notes window, because it is private. The shared slide then shows a quiet stamp: "Your first ads: on their way to our media team."

**What moves, exactly** (one outbox row, kind `blueprintLaunch`, run at once):

1. **The media buyer's task.** On Marketing/ADs (`901816723196`): "{card name} - New Client Campaign Launch 🚀".
   - Template `t-86ex8xaf1`, the same as Make 14 uses, so the media buyer cockpit's rule ("an open launch task means launching") keeps working.
   - Tagged with the client's lowercase card name, as the outbox already tags video requests.
   - **Assigned** to the launch media buyer (the `launch_assignee` setting).
   - **Due** in 2 working days (Saturday to Thursday, Kuwait time).

   Assigning it is what makes the existing hermes task-assignment worker post it to #client-ads-general (`C0C8DLZGTMZ`), and ClickUp notifies the assignee too. That fixes today's "nobody is pinged" gap without new Slack code.
2. **Dedupe.** If an open task on that list already carries the client's tag, or the card name with "Launch" in it, the executor comments the brief there and creates nothing. This covers hand-made tasks like "{client} \| Launch campaigns after launch call".
3. **The brief comment**, "Brand Blueprint, starter ads". It holds:
   - the service;
   - starter yes or no, the pack link and the client's approval (when and how);
   - the daily budget, and the kickoff figure when it was corrected;
   - lead form or landing page;
   - the publishing identity, platforms, ad account and Page names, and card funded;
   - red lines;
   - the capacity line;
   - the client card link.

   When starter = No, it says: "No starter ads: build the account and wait for custom ads."
4. **The client card.** Templated Ads Status `e7d158a8` is set to Approved, Wants To See Them First or Declined, from 1.3 and 1.5. Nothing writes this field today.
5. **The Creative Onboarding tree.** Subtask "4 · Select Templated Creatives So They Can Launch" is completed, only when starter = Yes.
6. **The CSM.** When capacity is Tight or No, a comment on the client card mentions the card's CSM (`68ff84db`), "in writing, the same day" as the framework asks.

**What it never touches.** Card Launch Date `2e744484` and Next Payment Date are Make 16's billing anchor, set on the first real campaign. Daily Budget `539743c2` is not overwritten either: a correction goes in the brief and in a card comment.

**A second press** (a correction made after the send) is allowed. It creates no new task. It posts one "Updated from the Blueprint" comment listing what changed. Each press is its own outbox row, with the request ID as its key.

### 2.3 Part 2 done: Close the call

**Done means** the required part 2 fields are set and the CD presses **Close the call** on slide 14.
- If the launch call is not booked yet, the close still runs, and the notes window says "Launch call not booked: the CSM is told".
- If the call runs out of time, the CD finishes part 2 the same day from the CD cockpit. The close fires whenever it is pressed.

**What moves** (outbox kind `blueprintClose`):

1. **Make 14's new route "COCKPIT CLOSE"**, on the same webhook (hook 4350422). The payload is `{source:"mahara-cockpit", key, event:"blueprint.call_closed", task_id, card_name, can_self_record, slack_text}`. The route reuses the complete route's modules unchanged:
   - [5] the Slack post to #media-general `C0AE8G5MT7Y`;
   - [8] card Can Self-Record? and Onboarding Map `…?phase=5&cid=<task_id>`;
   - [9] get task, [6] the Client Data Sheet lookup, [10] the 30-120 s wait, [7] the phase 5 WhatsApp to the client's group.

   The existing routes filter on Typeform's `event_type`, which a cockpit payload never carries, so they cannot fire by mistake. The hook URL and `key` are Supabase secrets, never sent to the browser.
2. **The cockpit's own card writes.**
   - Ad Approval Needed? `dd2253f9`: Yes for Every video or First batch, No for Run and show after. The three-way answer stays in the record and the brief.
   - Creative Onboarding "2 · Run The Brand Blueprint Call" completed.
3. **The launch task.** A comment with the approval mode, the content status and shot-list due date, the minimum project, and the ad anchor.
4. **The CSM.** One card comment mentioning the CSM, with capacity, UGC and upsell signals (2.20) and "launch call booked / not booked".
5. **Not done.** No phase 5 message is ever sent twice: the record stamps `part2_at` once, and a second press only re-posts the card comment.

### 2.4 Part 3 done: Lock the offer (1 to 2 days later)

**Done means** 3.1 is set and the CD ticks **Offer locked**. He does it from the CD cockpit's client page, or from the dashboard row "Offer waiting · Open the offer sheet · Lock the offer".

**What moves** (outbox kind `blueprintOffer`):
- Card Offer Creation `404ba9d5` is set to Done. It is empty on all 70 cards today.
- Creative Onboarding "3 · Lock The Brand DNA And The Offer" is completed **only when** 2.13 = Complete. Otherwise the step stays open with a comment saying what is missing.
- The launch task gets a comment: "Offer locked: <3.1>", with the sheet link, "Custom ads in production".
- The editor desk reads the offer and Brand DNA doc text now (see 4.3), not only when a video job opens.
- The record is complete: the CD cockpit's third sign-off turns green, and the launch deck shows the offer line.

If part 3 is still open 48 hours after part 2, the CD's dashboard row turns orange. No new notification system is added.

### 2.5 Every output of today's form, and what replaces it

| Output today | Made by | After |
|---|---|---|
| Media launch task and brief (partial) | Make 14 [3][4] | Cockpit outbox `blueprintLaunch`: same list, template and name, plus assignee, due date, tag and dedupe |
| Slack "Brand Blueprint completed" | Make 14 [5] | Make 14 route "COCKPIT CLOSE" [5'] |
| Card Can Self-Record? and Onboarding Map phase 5 | Make 14 [8] | the same route [8']. Make stays the one writer of these two fields. |
| Phase 5 WhatsApp to the client's group | Make 14 [6][10][7] | the same route |
| AI client recap for Slack approval | Make 06 route 2 | **Not in v1.** It has never run for a Blueprint. Phase 2 would clone Make 06 route 2 behind the cockpit route if wanted. |
| CSM mirror `forms.blueprint` | onboarding-sync | Unchanged (Typeform history). The CSM side reads `cockpit_blueprint_read` for new clients. |
| CD sign-off "Blueprint submitted" | nothing (0 rows) | `cockpit_blueprints` parts |
| Templated Ads Status, Ad Approval Needed?, Offer Creation, steps 2, 3 and 4 | nobody | the cockpit outbox |
| Make 12's link on the card and Brand Blueprint Booked | Make 12 | Untouched. The status flip still marks the stage, and the link becomes history. |

**If the CEO does not approve the Make route.**
- The cockpit posts the Slack line itself through the existing Slack helper, once its bot is in the channel.
- It writes the two card fields.
- The close shows the CSM the phase 5 Arabic message, ready to paste into the group.

---

## 3. The Brand Blueprint call deck

### 3.1 Who, how long, the shape

- **Presenter:** the creative director, and nobody else from Mahara on the call, by design: the framework keeps the CD out of selling. The CSM books the call, receives the flags in writing and runs the launch call.
- **The client side:** the owner, not a delegate.
- **Length:** 45 minutes (`TARGET_MINUTES.blueprint = 45`). 14 slides. Part 1 is sent by about minute 10.
- **Before the call (15 minutes, prep view):**
  - part 1 already prefilled;
  - a "Still missing" list;
  - the kickoff and onboarding answers, read only;
  - the closer's notes from the card handover;
  - links to the Brand DNA, Offer Cheat Sheet, Market Research and Drive.

  The CD pre-writes his offer guess in the doc, per the framework. The internal pricing doc is never linked anywhere in the deck.
- **The engine:**
  - same canvas, notes window (N), timer, EN/AR (L), still mode, harness;
  - the notes window holds each slide's private fields, its one-line note and the talk track;
  - client-facing fields are typed on the slide, and the notes window mirrors them over the existing BroadcastChannel;
  - every field saves to `cockpit_blueprints` through a saver like deck prep's `PrepSaver`, so a reload or a lost connection never loses a word.

### 3.2 How it starts from the kickoff answers

Slide 2, "What you've told us", is built entirely from what the kickoff and onboarding already hold:
- the service lit among the five;
- their 90-day goal (onboarding `791b99b8`);
- the ideal-project summary (2.1);
- the red lines from the onboarding call.

There is no money on screen. The notes window shows part 1 already filled in, so the call opens with "is this still right?" rather than a blank form.

With no kickoff on record, the deck still opens: part 1's fields are empty, and the notes window says "No kickoff on record: ask the service and the budget."

### 3.3 Slide outline

The minutes add up to 45.

| # | id | Title (EN) | What the client sees | Form on this slide | Filled live | Presenter note |
|---|---|---|---|---|---|---|
| 1 | `cover` | "{Company} · Brand Blueprint" | Their name as the masthead, the date, the presenter's name, "45 minutes" (1 min) | none | none | Join 5 minutes early; check part 1 in prep. |
| 2 | `so-far` | "What you've told us" | Service lit, 90-day goal, ideal project in one line, red lines (1 min) | 1.9 on the slide; 1.1, 1.3 and 1.6 confirms in notes | corrections, typed on the slide | Read it back; fix anything wrong now, it saves. |
| 3 | `today` | "The next 45 minutes" | Three stops: the agenda with minutes, three rules (push back, specific on money, say you don't know), what we need (1 min) | none | none | Three minutes at most, then into their business. |
| 4 | `one-service` | "One service. One offer." | The five services, the kickoff's choice lit, a parking lot for the rest (3 min) | 1.1 on the slide; 1.2 in notes | the pick and the parked services | Margin wins; capacity risk goes to the CSM, never to them. |
| 5 | `first-ads` | "Your first ads go live this week" | The pack for their service, shown as ads: example ads for the lit service in the launch deck's phones, each tagged "Example ad", "while we make yours from your content"; the pack's Drive folder opens in its own window (score round 1, 2026-10-23: it is never framed on the slide; SPEC 5.3) (4 min) | 1.3 and 1.5 on the slide; 1.4 and 1.6-1.8 in notes; **Send to media** in notes | the yes and the approval tap, then the stamp | Press Send to media before you leave this slide. |
| 6 | `best-at` | "What you're actually best at" | Their method as a large pull quote typed as they speak, plus "your ideal client" (6 min) | 2.1, 2.2, 2.3, 2.4 | their words | A method, not an adjective; type their words, not yours. |
| 7 | `pricing` | "Your projects, in numbers" | A band ladder (minimum, typical, the ad's anchor), deposit terms, an example of the call centre's filter line (5 min) | 2.5-2.8 on the slide; 2.9 in notes | the numbers | Specific numbers; ask for a photo of a real quotation into their Drive. |
| 8 | `competitors` | "Who you're up against" | Names appear as chips, then "why people pick you" (3 min) | 2.10, 2.11 | names and reasons | Who do you actually lose to, and why? |
| 9 | `offer` | "Let's build your offer" | Five ingredients as a frame (pattern, name, bonuses, anchor, the free consultation and who gives it); then the CD shares the Offer Cheat Sheet window (9 min) | 3.2 (opens the doc window); a 3.1 draft in notes | the offer, in the doc | Share the doc window; start from your pre-written draft. |
| 10 | `how-ads-work` | "How paid ads work" | Two roads (paid against referral, the launch deck's drawing), the 30-60 day test window, three approval cards (3 min) | 2.12 (the client taps) | the approval choice | Hold the frame: volume beats luck. |
| 11 | `brand` | "Your brand, on one page" | Always / never / never show, the Brand DNA essentials (2 min) | 2.14 on the slide; 2.13 in notes | the rules | Open their Brand DNA doc in its own window if a section is blank. |
| 12 | `content` | "What we need in 72 hours" | The four-shot list, the due date, their Drive folder (2 min) | 2.15 on the slide; 2.16-2.18 | the camera choice and the tick | If it slips, the starter ads keep running and we swap yours in. |
| 13 | `read-back` | "Here's what we're building" | The one sentence (3.1); "Your projects run from X to Y, and the ads anchor at Z"; "You send us … by …" (2 min) | 3.1 on the slide; 2.19 in notes | the sentence and the yes | Read it out; wait for a yes. |
| 14 | `next` | "What happens next" | The days after the call on a clothesline (part 1 said as sent only once Send to media went), then what the launch call shows (their custom ads, the form, the questions we ask before anyone reaches their calendar); the time once booked; "Starter ads: live once your account is ready" (3 min) | the booking (opens the launch booking page in its own window); 2.20 and 2.21 and **Close the call** in notes | the booking | Book it live; then press Close the call. |

Score round 2 (2026-10-23) kept the outline and fixed what the client sees (SPEC 5.3): the part 1 sheet is as tall as its words, so its fold row is never cut, and loses its tabs; part 1 ticks as the stamp lands; nothing on slides 11 and 12 covers or cuts a line; the offer tag says "In your offer sheet" once and grows with its words; empty entries are ruled rows, never boxes; slides 6, 8, 9 and 12 show their later cards from the first stop at half strength, so no arrival is half an empty wall; slide 4's park lifts the lit strip to the middle; slide 7's cards share one grid and its empty tape carries example marks, tagged; slide 14's cards hang as the string reaches them. The shot run now fails on text that overlaps, is covered, is cut, or runs off its paper.

### 3.4 How it ends: what happens next, and when

1. **On the call:**
   - part 1 sent (minute ~10);
   - the launch call booked, 1 to 3 days out, on calendar `5E1EVxLJbGiDM3iYl2kL`, run by the CSM;
   - **Close the call** pressed.
2. **Within about 2 minutes:**
   - the client's group gets the phase 5 WhatsApp (Make);
   - #media-general gets the post;
   - the CSM gets the flags on the card.
3. **Starter ads:** live when the media buyer finishes the launch task, due 2 working days after part 1. This needs ad account and Page access and a funded card, which the brief carries from the kickoff.
4. **Within 1 to 2 days:**
   - the offer is locked (part 3);
   - the custom scripts go to the editors;
   - the editor desk has the doc text.
5. **The launch call:** the client sees their own custom ads, the lead form and the call centre's questions. The custom ads join or replace the starter ads.

**Copy change this forces.** The framework's read-back promised "all before we spend a single dollar". Starter-first breaks that, so the read-back and slide 14 say "Your starter ads go live once your account is ready. At your launch call you'll see your own ads." This is a default, which the CEO can reverse to custom-first with one prep switch per client: starter = No.

### 3.5 Client screen against private

The same rules as the CSM decks:
- Never on a slide: ad budget money, leads, CPL, margins, capacity, the pack pick and destination, the UGC and upsell flags, the internal pricing doc, or another client's material.
- The unconfirmed claims ("over ten years", "well over a million dollars in this region", "worked with X companies") stay in the notes until confirmed for whoever presents.
- Services are always the five main ones.
- Arabic follows `CONTENT-AR.md`, and the client copy is checked on a frontier model. Anything not the client's own is tagged إعلان للتوضيح.

### 3.6 The look: three directions, one default

The three mockups go in `bb/`. Each sits on Mahara tokens: Deep Space, the teal accent, Geist and IBM Plex Sans Arabic. Each is judged against the Hallmark bar and the slop test on screenshots.

- **Editorial issue (default).** The call is a magazine issue about their company:
  - their name is the masthead;
  - their words become pull quotes;
  - pricing reads as a spec table;
  - the offer is the feature headline;
  - the read-back is the cover line.

  It suits a call about their exact words and brand, and it reads well in Arabic.
- **Studio wall.** The CD's pin-up board: their swatches, logo and words pinned up as they are said. It is warm and creative, but it carries a risk of clutter on a 1080p Zoom share.
- **Cinematic reel.** Dark and full-bleed, with ads in phones as the hero. It is strongest for slide 5, but motion is risky on Zoom and it can read as AI-made.

The default takes the editorial issue and borrows the reel's phone frames (the existing `AdsStage`) for slide 5.

---

## 4. Where it lives, and the backend

### 4.1 Where

**The call window** (deck, notes window and prep):
- **Route:** `/client-success/clients/:taskId/present/blueprint` in the client success app.
- **Gate:** `RoleRoute anyOf={["csm","creative"]}`, outside AppLayout like the other decks.
- **One engine, no copy.** `src/present` is about 26k lines. Copying it would drift, and moving it into a package would collide with the kickoff branch.
- **The deck kind:** `blueprint` is a third `DeckKind`. Its data loader is `cockpit_blueprint_sources` and its prep store is `cockpit_blueprints`, never the CSM-gated deck prep or deck sources RPCs.

**The CD cockpit** (`apps/creative-director-cockpit`):
- **Client page:**
  - a **Blueprint** card with parts 1-3 as three states;
  - **Run the Blueprint call**, which opens the call window by name, as the decks do;
  - **Lock the offer** (part 3: the sheet link, 3.1, 3.3, 3.4);
  - finish part 2 later the same day.
- **Dashboard:** the third onboarding sign-off reads the parts.
- **Links page:** remove the bare Typeform link and the wrong "client fills it before the call" label, and point to the client page.
- **`hermes/cockpit-sync/creativeProducer.ts` `CLIENT_FIELDS`:** add Offer Creation, Templated Ads Status, Can Self-Record? and Ad Approval Needed?. These are reads, so the cockpit sees what the outbox wrote.
- **Settings:** a **Starter packs** section, with five Drive folder links (one per main service) and the launch media buyer.

**The CSM cockpit:**
- the Onboarding panel shows one line ("Blueprint: starter ads sent 14:12 · call closed · offer locked");
- the launch deck reads 3.1, 2.12, 1.4 and 2.14 for its offer, approval, pack and red-line stops;
- the CSM can open the Blueprint deck to read or rehearse, but cannot mark parts done.

### 4.2 Supabase (one migration, for example `20261024a_blueprints.sql`)

```sql
create table public.cockpit_blueprints (
  task_id        text primary key check (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  client_name    text not null,
  answers        jsonb not null default '{}'
                 check (jsonb_typeof(answers) = 'object' and octet_length(answers::text) <= 65536),
  revision       integer not null default 1 check (revision >= 1),
  part1_at timestamptz, part1_by text,
  part2_at timestamptz, part2_by text,
  part3_at timestamptz, part3_by text,
  launch_task_id text,
  updated_at     timestamptz not null default now(),
  updated_by     text not null check (btrim(updated_by) <> '')
);
create table public.cockpit_blueprint_settings (
  key        text primary key check (key ~ '^(pack\.(design-build|interior|architecture|fitout|construction)|launch_assignee)$'),
  value      text not null check (char_length(value) between 1 and 500),
  updated_at timestamptz not null default now(),
  updated_by text not null
);
-- both: RLS on; revoke all from public, anon, authenticated; grant to service_role only.
```

**Functions.** All are `SECURITY DEFINER` with `search_path=''`. EXECUTE goes to `authenticated` only, and is revoked from `PUBLIC`, `anon` and `service_role`. Nothing is granted on the tables.

| Function | Who | Does |
|---|---|---|
| `cockpit_blueprint_gate_for_actor(actor, task_id, write)` | internal (service_role) | **Write:** creative role (or admin or the CEO), and `cockpit_client_allowed(name)` for the card's name in the current `cockpit_creative_sources` clients snapshot. **Read:** that, or `cockpit_csm_client_gate`. Returns `{taskId, clientName, email}`. |
| `cockpit_blueprint_read(task_ids text[])` | creative / csm | Up to 200 cards, each gated; rows plus the server's `now()`. |
| `cockpit_blueprint_sources(task_id)` | creative / csm | Everything the deck reads, read only: the kickoff and onboarding answers from `cockpit_client_onboarding.forms`; links and handover; Do's & Don'ts; onboarding deck prep keys (`red_lines`, `service_focus`, `starter_pack`, `dialect`, `language`); pack settings; presenter name; the next launch booking; the Blueprint row. |
| `cockpit_blueprint_save(task_id, patch, revision)` | creative | Key allowlist (the question keys above), 4,000 characters per value, revision check (a conflict returns the current row). Edits after a part is done are kept, and are re-sent only when its button is pressed again. |
| `cockpit_blueprint_part_done(task_id, part, request_id)` | creative | Checks that part's required keys and stamps it, setting `partN_at` and `partN_by` the first time only. Inserts one `cockpit_creative_outbox` row (id = request_id, kind `blueprintLaunch` / `blueprintClose` / `blueprintOffer`, the payload being only that part's brief inputs). Writes one audit row. A repeat request ID writes nothing. |
| `cockpit_blueprint_settings_set(key, value)` | creative or admin | Validates a Drive folder URL or a ClickUp user ID; writes an audit row. |

**Audit.**
- An audit trigger on `cockpit_blueprints` and on the settings table, as deck prep does.
- `cockpit_audit_log` rows: `blueprint.part_done` (metadata: part, client, second press or not) and `blueprint.setting`.
- The outbox's existing audit trigger.
- `cockpit_media_actions` journals each provider run, as the outbox runner already does.

### 4.3 Edge Functions, hermes and config

- **`cockpit-creative-api`, `prepareOutbox`:** three new kinds with dry-run plans and read-back verification.
  - `blueprintLaunch`: find, else create; comment; set the field; complete step 4.
  - `blueprintClose`: field, step 2 and comments, then the Make POST.
  - `blueprintOffer`: field, step 3 or a comment, and a comment.
  - **The Make POST** has no read-back. It is sent once, and a network failure after sending moves the row to `reconcile`, never to an automatic retry, so a WhatsApp is never sent twice.
  - **The secrets** `MAKE_BLUEPRINT_HOOK` and `MAKE_BLUEPRINT_KEY` are set by the CEO. The env flag `BLUEPRINT_MAKE_CLOSE` stays off until the Make route is approved.
  - `runClientAction` is unchanged: it loads through `cockpit_creative_client_action('get')`, which is creative or the CEO.
- **Hermes editor desk:** read the Brand DNA and offer doc text for clients whose part 3 is done in the last 14 days, as well as those with open video jobs.
- **Make 14:** one new route, "COCKPIT CLOSE" (2.3), for the CEO to approve. Make 06, 12 and 16 are untouched.
- **Typeform:** no edits.
- **CSP:** none needed. `drive.google.com` is already in the client success app's `frame-src`. The offer doc opens in its own window rather than a frame, so `docs.google.com` is not added.

---

## 5. Build order, and verifying without submitting anything

### 5.1 Order (after the kickoff form)

0. **The kickoff ships first**, on branch `kickoff-embed-1022`: FormPanel, the kickoff window, and the kickoff stop at the end of the onboarding deck. The Blueprint starts once it merges, because both touch `src/present` and the client page. Patterns to reuse:
   - the "Sends to" seal (here, "Sends to media" on part 1);
   - the after-send trail;
   - the Just me / Sharing switch, which in the deck is the notes window.
1. **Migration** (tables, six functions, grants, audit) and its SQL tests. It writes no data.
2. **Outbox kinds** in `cockpit-creative-api`, with unit tests and dry-run plans. The Make step stays behind its flag.
3. **The CD cockpit:**
   - the Starter packs settings (the CD fills five links and the assignee);
   - the client page Blueprint card and Lock the offer;
   - the dashboard sign-off;
   - the Links page fix;
   - the `CLIENT_FIELDS` additions.
4. **The deck:**
   - the `blueprint` kind and the 14 slides in EN and AR;
   - the notes window form sections, and the prep view as the part 1 pre-check;
   - harness fixtures (full, sparse, no-kickoff, two-services, AR) and JPEG shots at 1920x1080;
   - **the three style mockups to the CEO before the slides are finished.**
5. **The CSM side:** the Onboarding panel line and the launch deck's reads.
6. **Make 14's COCKPIT CLOSE route**, built by or with the CEO's approval. Then the flag goes on.
7. **The hermes editor desk rule.**
8. **The first real Blueprint call** is the end-to-end test.

### 5.2 Verification with nothing submitted and nothing sent

- **No Typeform is involved.** Every native save writes only `cockpit_blueprints`.
- **Unit tests** (`bun test`, synthetic fixtures, no client data):
  - prefill, including the five-service mapping, the two-service kickoff, kickoff missing, Arabic and `+` phones;
  - each part's required keys;
  - the brief builder: the budget appears only in the brief, and never in any slide's text;
  - Can Self-Record? and Ad Approval Needed? mapping;
  - dedupe (an existing launch task means a comment only);
  - the Make payload builder carries only its seven keys;
  - a second part 1 press means one correction comment and no new task.
- **SQL tests:**
  - a creative seat with the client off its list is refused;
  - a CSM can read but not write;
  - `anon` gets nothing, and no grants exist on the tables;
  - required keys are enforced;
  - a repeat request ID writes neither a row nor an audit row;
  - one press writes exactly one audit row.
- **Rehearsal on production:** `?rehearse=1`, for admins and the CEO.
  - Saves stay in memory.
  - Send to media, Close the call and Lock the offer call the executor with `apply:false` and show its dry-run plan: "would create … on list 901816723196 from t-86ex8xaf1, assign …, due …, comment …; would set Templated Ads Status …". The plan uses ClickUp GETs only.
  - Run it on a client in onboarding that has a kickoff and on one without.
- **Make:**
  - read the scenario blueprint (GET) after the route is added, and check its filter;
  - confirm the existing routes still filter on `event_type`;
  - no test payload is sent.
  - The first real close is watched in Make's history.
- **First real call**, checked with `sq.py` and ClickUp reads:
  - one `blueprint.part_done` audit row per part;
  - one launch task, assigned and due;
  - Templated Ads Status set and step 4 done;
  - the media buyer cockpit shows the client as launching;
  - after the close, one Make 14 run and one WhatsApp in the group;
  - after part 3, Offer Creation = Done.

---

## 6. Defaults the CEO can correct

1. **Native form, Typeform retired** (not edited and not deleted). Correct it to "keep Typeform" and the plan becomes a shorter `oYZKtogO` embedded with FormPanel, with Make 14 dedupe and the Make 06 filter added. The deck then loses live capture.
2. **45 minutes, 14 slides.**
3. **Starter first, custom follows.** This changes the read-back promise (3.4).
4. **Specific numbers** for the minimum and the anchor, with a range only for "typical". This takes the framework's side over Gamma card 5.
5. **No AI recap in v1** (Make 06 is not replaced). The phase 5 WhatsApp still goes.
6. **Five starter packs as Drive folders**, set once by the CD in Settings. Until a service has one, part 1 asks for the link.
7. **The launch task is assigned to one launch media buyer** (a setting) and due in 2 working days.
8. **The CD presents.** The CSM is not on the call and gets the flags on the card.
9. **Deterministic summaries in v1**, with AI one-liners in phase 2.
10. **Editorial issue** as the deck's look.
11. **The launch call is booked from GHL's booking page in its own window**, with the booking read back on slide 14. No new booking permission is given to creative seats.
12. **The Make route** (2.3), or, if declined, the cockpit's own Slack post plus a paste-ready WhatsApp for the CSM.
