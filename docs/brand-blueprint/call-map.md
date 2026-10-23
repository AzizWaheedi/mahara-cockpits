# The Brand Blueprint call: how it runs

Written 2026-10-22, read-only. Every claim names its source. Client answers are not quoted anywhere in this file. People are named by role, per memory `team-docs-roles-not-names`.

## Sources read

| Code | Source | What it gave |
|---|---|---|
| BBF | Google Doc **"The Brand Blueprint Call — Creative Director Framework"** `1DUd5Euj4Ke7TNlY1MwAH-YB72-VED8JcILa84GvG528` (last edited 2026-09-01) | The main source: why the call exists, 15-minute prep, Blocks 0 to 10 with times and scripts, outputs and handoffs, post-call checklist, pitfalls |
| BBN | Google Doc of the same name `1dHt2uwI2NovtVJD9oN5TbSr7oMS-tBZnf3RIRf3yrd4` | The CEO's 9-line build note: form links into ClickUp, partial submit triggers media, post-call summary loop |
| GB | Gamma **"The Brand Blueprint Call"** `gamma.app/docs/The-Brand-Blueprint-Call-4ql4ygy1862k8sv`, read in the in-app browser | The six-card opening deck the client sees |
| SPEC | Google Doc **"Forms, Triggers & Post-Call Loop — Build Spec (Aug 2026)"** `1bnVJ3higqj6EXtHDx8Ti8gntbVqk1IScFMzfj2rNpbA` | The form design: partial trigger after templates, the approval question, task triggers, summary loop |
| TF | Live Typeform `oYZKtogO` "Mahara - Brand Blueprint form" (skeleton read via the Typeform connector) and kickoff `tG7dnxBn` | The questions as they are today, hidden fields, welcome text |
| CJ | Google Doc "MaharaMedia Client Journey SOP" `1K_vXVwgUNnroK1Y8ErkJ4pJn7q8e-1QkrEUw49HlLMo`, section 4 and M1/M2 | Call #2 placement, prep, the problems table |
| OCF | Google Doc "Onboarding Call Framework" `1JN4oTUo…`, Steps 9 and 16 | How the CSM books and pitches the Blueprint; the overlapping service questions |
| LCF | Google Doc "Launch Call Process & Framework" `1kTq3cEn…` | What the launch call shows, so the Blueprint can promise it |
| OCS | Google Doc "Offer Creation Cheat Sheet" `14fBr8Qp…` (the CEO's original; the per-client copies come from template `1mfh32Bm…`) | The sheet shared on screen in Block 5 |
| SOP-O / SOP-S | Google Docs "Offer Creation — Creative Director SOP" `1yvn0lgg…` and "Ad Scripting — Creative Director SOP" `1dZ2iEI5…` | How the offer and the scripts are made after the call |
| CDS | "Creative Director, Daily SOP" `1oQUqtpW…` and the "Creative Director/Strategist Scorecard" `16lvh17M…` | Where the Blueprint work sits in the creative director's day and grade |
| MC | mahara-context: `systems/Projects/Onboarding Map.md`, `Make Scenarios/Maharav1/14. Brand Blueprint Form Submitted.md`, `Systems/Typeform Forms.md`, `Processes/Client Onboarding Flow.md`, `Scripts/Apps Script - auto onboarding.md`, `client-comms/creative-director-templates.md`, `client-comms/onboarding-to-launch-csm.md`, `tools/fast-client-launch/*`, `context/projects/client-journey-roadmap.md`, `context/DECISIONS.md`, `clients/*/brand-dna.UNFILLED-TEMPLATE.md` (structure only) | Automations, calendars, documents, live state |
| MEM | Project memory: `forms-in-cockpits-queue`, `client-onboarding-links`, `csm-booking-and-portal-tasks`, `csm-call-sync`, `main-services`, `team-docs-roles-not-names` | Ids, the CEO's queue, rules |
| FTH | Fathom, summaries only: 238 meetings 2026-08-20 to 2026-10-22 searched by title and transcript | Process decisions; no Blueprint call itself is recorded in the accessible library |
| SB | Supabase read-only: `cockpit_client_onboarding`, `editor_clients` (counts only) | How often the form is actually submitted |
| CDC | Repo (read only): `apps/creative-director-cockpit/src/lib/creativeLinks.ts`, `creativeTemplates.ts`, `pages/DashboardPage.tsx` | What the creative director's cockpit says about the call today |

Not found: no separate "Brand Blueprint SOP" besides BBF; BBF's "Appendix A" (the Gamma prompt) is referenced but not in the doc text. The onboarding Gamma ("Welcome to the Premium Projects Program") would not load in the browser this time; `docs/csm-decks/CONTENT.md` read it on 2026-10-20 and lists its roadmap card 2 as "Brand Blueprint call", kept as O5 stop 4.

---

## 1. Who is on the call

- **The creative director and the client's owner. Nobody else, by design.** BBF Block 8: "Keeping the Creative Director out of selling is what protects the creative relationship, and it is the reason this call is Creative Director and client only." Block 0's script says the CSM is "still your main contact" but not on this call. FTH (2026-08-27 sales and fulfilment wraps, 2026-10-16 role screening) says the same: the creative director meets the client, the CSM runs onboarding and launch.
- **The owner, not a delegate.** Block 0: "it is the only one where I need you thinking like the owner of the business, not like a client." CJ M1 marks "owner sends someone else" red on the onboarding call; the same logic applies here because pricing, mechanism and offer decisions need the decision maker.
- **The CSM is fed, not present.** Capacity risk, the UGC hesitation and upsell signals go to the CSM "in writing, the same day" (BBF Blocks 1 and 8, outputs table). OCF Step 16: the CSM books the call at the end of onboarding.
- **The creative director role is in motion.** The CEO assigned the role on 2026-09-01 with "100% of Brand Blueprint calls" as a monthly A-grade target (FTH 1:1, CDS scorecard "brand identity DONE before the launch call"). FTH shows a creative director offer accepted 2026-10-15 and another screening 2026-10-16, while the current creative director still ran creative onboarding on 2026-10-20. Anything client-facing must say "our creative director", never a name, and must not carry a years-of-experience number until it is confirmed for whoever presents.

## 2. How long, and when

| Fact | Value | Source |
|---|---|---|
| Calendar slot | **45 minutes**, GHL calendar `x84ET6KnA8odlsjYiVLq`, round robin, one member | MEM `csm-booking-and-portal-tasks`, MC Onboarding Map |
| What the client is told | "about 45 mins" (OCF Step 16); "The Next 45 Minutes" (GB card 3); "45 minutes with our creative director: your brand, your offer, your first ad scripts" (onboarding deck O7) | OCF, GB, CONTENT.md |
| What the framework's blocks add up to | **about 62 minutes** (5+5+10+8+4+12+5+3+5+3+2), plus the 3-minute opening deck | BBF |
| Cap the framework sets | "Cap it at 45 to 50 minutes and frame it as the creative session, not more admin" (Pitfall 1) | BBF |
| CJ's figure | "60 Minutes – Within 48 Hours of OB" | CJ section 4 |
| When it is booked | On the onboarding call, before hanging up, 24 to 72 hours out | OCF checklist and Step 16; CJ step "Schedule the brand blueprint call 24-72 hrs" |
| When the launch call follows | 1 to 3 days after the Blueprint, booked live in Block 10, run by the CSM, 30-minute calendar `5E1EVxLJbGiDM3iYl2kL` (20-30 minutes client-facing) | BBF Block 10, CJ, MC Onboarding Map |
| The whole promise | Launch within 3 to 7 days of onboarding ("four to seven day launch promise", BBF Block 10); target launch within 7 days of signup (onboarding-to-launch CSM guide) | BBF, MC |
| Creative director prep | 15 minutes before; join 15 minutes early | BBF, CJ |
| Late or unprepared client | More than 10 minutes late, or on a phone: re-book. No-show: three messages at 5 minutes, then leave (CDC no-show template). Fallback: an async form plus a 20-minute call within 24 hours | CJ problems table, BBF Pitfall 5, CDC |

**The gap to close:** the content is a 60-minute call sold and booked as 45. The GB agenda already compresses it to six parts that sum to 47 minutes, folding Blocks 6 to 10 into one "Content and next steps, 8 min". A new presentation should be built to the 45-minute slot, which means cutting what the kickoff already answered (see section 6).

## 3. The agenda, in order

The client-facing version (GB) and the creative director's version (BBF) side by side.

| # | BBF block (time) | GB card | What happens | Key questions or script (BBF) |
|---|---|---|---|---|
| 0 | **Frame and authority** (5) | 1 Title with the company; 2 "Why you are here with our creative director" | Opening script: who the creative director is, why this call, "Everything my team builds for you this week ... comes out of the next 45 minutes." Then the 3-minute deck. | "I'm going to take three minutes to show you how this works, then we get straight into your business." |
| – | Opening deck (3) | 3 "The Next 45 Minutes" (six parts with minutes); 4 "Three rules for this session"; 5 "What I need from you today"; 6 "What happens next" | Rules: I will push back; be specific on money; say you do not know. Needs: honest ranges, the real answer, decisions not opinions. Next: this call, we build, your launch call ("You see the full system before anything goes live"). | |
| 1 | **Service map and focus** (5) | "Your services and where we focus, 5 min" | Pick the **one** service the first offer is built for; everything else to a parking lot, said out loud. | Everything you actually sell; most money per project; most capacity; which you want more of; biggest headache for the pay; one type of project for 90 days. Decision rule: highest margin the firm can deliver; on conflict margin wins and the capacity risk goes to the CSM in writing. |
| 2 | **What they are actually best at** (10) | "What you are best at, 10 min" | Extract a **mechanism, not an adjective**. Write their exact words. | Proudest project and why; what clients say made the difference; what they refuse to compromise on; what most firms in their city cannot do; first consultation to handover walk-through; last project turned down; best client of the year; what goes wrong in the industry and what they do differently. |
| 3 | **Pricing and project tiers** (8) | "Your pricing, 8 min" | Two outputs: the price anchor for the ad, and the bands the call centre uses to filter budget. | Minimum project; how they price (per metre etc.); typical range; the high end they want more of; what moves a job bottom to top; deposit and payment terms; timeline per tier; "Can I see a picture of a quotation?" |
| 4 | **Competitors** (4) | "Your competitors, 4 min" | Position against the real alternative. | Biggest competitors; who they actually lose to; the reason given; whose marketing they respect; anyone far cheaper who keeps winning. |
| 5 | **Build the offer live** (12) | "Building your offer, 12 min" | **Screen share the Offer Creation Cheat Sheet at their service section.** The client watches the offer get built, so they own it. | Pick the front-end pattern; name it in their voice; pick 2 or 3 bonuses; set the ad's price anchor; define what the free consultation gives and who on their side delivers it. |
| 6 | **Paid advertising expectations** (5) | inside "Content and next steps, 8 min" | Pre-handle the week-two complaints. | The offer is an entry point, not a discount ("nobody buys a car without a test drive"); paid vs referral ("same person, same money, the only difference is trust"); paid vs organic; creative flexibility for 30 to 60 days ("volume negates luck"); hold the frame. SPEC adds **the approval question**: approve every video, approve only the first batch, or run and show after. |
| 7 | **Brand DNA confirmation** (3) | same | Open their Brand DNA file on screen and confirm out loud. | Logo files; dos and don'ts; colours with exact codes; Arabic and English fonts; tone (formal or conversational, dialect or standard); projects that can or cannot be shown; names that cannot appear; watermark and logo placement. Always ask: what must always appear, what must never appear. |
| 8 | **Content and assets** (5) | same | Shot list and a 72-hour deadline. | What photos, video, renders exist and where; will the owner be on camera; who else is good on camera. Shot list: owner talking head, site or workshop, finished walkthroughs, before and after stills. If it slips: "we launch on template creative ... and swap in the custom material". If they hesitate: note it, no selling, flag to the CSM. |
| 9 | **Confirm and close** (3) | same | Read it back and get a yes. | "So here is what we are building: [offer in one sentence]. Your projects run from [X] to [Y], and we anchor the ads at [Z]. You are sending me [assets] by [day]. At your launch call you will see the finished ads, the landing page, and the exact questions we ask before anyone reaches your calendar, all before we spend a single dollar." |
| 10 | **Book the launch call** (2) | card 6 "What happens next" | Book the CSM's launch call live, 1 to 3 days out. | "Book a meeting from a meeting." Booking link `5E1EVxLJbGiDM3iYl2kL`. Confirm who runs it, what they will see, roughly how long. |

## 4. What the client must decide or provide

**Decisions (said out loud, confirmed on screen):**
1. The one service the first campaign sells (from the five main services: Design and build, Interior design, Architectural design, Fit out and renovation, Construction only; "Other" is flagged to the creative director, OCF Step 9).
2. The offer: front-end pattern, name in their voice, 2 or 3 bonuses (each passes "the seven-day question"), the price anchor in the ad, what the free consultation delivers and who delivers it. Optional: Essential, Signature and Heritage back-end tiers and a same-day sign-up bonus (OCS worksheet, TF).
3. The approval mode: every video, first batch only, or run and show after (SPEC section 3, TF "Does every video need client approval before it runs?").
4. Whether we launch on the starter (templated) ads now while custom work is made (TF "Are we launching on templated ads?"; kickoff already holds a Templated Ads Status).
5. Red lines: what must always appear, what must never appear, projects and names that cannot be shown.
6. The launch call date and time.

**Facts and files they provide:**
- Their mechanism in their own words (process, first contact to signed, signed to handover).
- Pricing for the chosen service: minimum, method, typical range, high end, what moves the price, deposit and terms, timelines; a photo of a real quotation.
- Competitors and who they lose to.
- Brand basics: logo files, colour codes, fonts, tone.
- Content: what exists and where; on camera or not; who else; the shot list due in 72 hours into the client Drive folder.
- A yes to the one-sentence offer read-back.

## 5. What is produced after the call

BBF: "All of this goes out the same day. The build window is four days."

| Output | Lives in | Goes to | Used for | Source |
|---|---|---|---|---|
| **Brand DNA** completed, draft flags cleared | Per-client Google Doc `{client} - Brand DNA`, created at signup by the onboarding Apps Script from template `1RjbNqiX…` (12 sections plus moodboard); link on the ClickUp card; `editor_clients.brand_dna_url` (59 of 70 rows), text mirrored in `brand_dna` (23) | Scripting and creative | Ad angles, VSL, hooks | BBF, MC Apps Script, SB |
| **Offer worksheet** filled | Per-client `{client} - Offer Cheat Sheet` (template `1mfh32Bm…`, ClickUp field `📈 Offer Cheat Sheet` `43ca3d4c…`); `editor_clients.offer_url` (57 of 70), `offer` text (23) | Media buyer and creative director | Ads, landing page, form | BBF, MC, SB |
| Price bands and filter language | Call centre guide | Call centre | Budget qualification without quoting a price | BBF Block 3 |
| Competitor list and mystery-shop screenshots | Client channel | Creative director | Positioning | BBF |
| Content status and shot list | | Editor and CSM | Production, or the UGC upsell | BBF |
| **Starter (template) ad selection** | Drive link to the chosen templates (TF) | Media buyer | Launch immediately while custom ads are built | BBF, SPEC, FCL |
| Capacity risk and upsell flags | In writing | CSM | Delivery planning, backend pipeline | BBF |
| Fathom recording link | Client channel and the form (required) | Everyone | "Source of truth for the whole build" | BBF, TF |
| **The Blueprint form** `oYZKtogO` | Typeform, Make 14 `9748311` | Partial: creates the media task. Complete: Slack post, then the phase 5 Onboarding Map message to the client's WhatsApp group. Also posts to Make `9502731`, which one note calls "13. Receive - Creative Director" and the EOD overview lists as the creative director's end-of-day-to-sheet scenario (worth checking what it does with a Blueprint answer) | Kicks off media and moves the client's road | MC Make 14, Client Onboarding Flow §6 |
| Call summary and action items | 1-1 call summary form `fRokTITH` | Slack #client-success for approval, then the client group | What we covered, agreed, owe, next call | CJ step 5, BBF checklist, SPEC §7 |
| **First ad scripts** | Scripts & Creatives folder; Video request form to the pipeline | Editors (name and date on the form) | Custom ads | SOP-S; TF "Initial ad scripts", "Which editor?", "Date the scripts go to the editors"; the CEO says the custom scripts take him 1 to 2 days |
| Creative onboarding checklist | ClickUp template `t-86eyu1w3d` | Creative director | Brand DNA and offer locked, creatives, scripts, ads approved | MC Onboarding Map, SPEC §4 |

The client ends the call with **two documents**: what their brand is (Brand DNA) and what they sell (the offer). Both exist in their Drive folder before the call, so the call fills them, it does not create them (MC Apps Script, "The second document", the CEO's onboarding-rebuild note). The creative director messages the scripts to the group "written off the brand DNA and the offer we built together on the blueprint call" (MC creative-director-templates).

## 6. What usually stalls

**The form is the biggest stall, and the data proves it.**
- `cockpit_client_onboarding` (70 cards, 7 in onboarding) holds **one** Blueprint response ever, dated 2026-09-13, with zero answers retained. 30 cards have a kickoff (SB). Memory `csm-call-sync` found the same on 2026-10-11 ("matches 1 of 68 cards, and that one has no answers"). Make 14 returned no successful runs from 1 October (MC client-journey-roadmap). Three of the seven onboarding clients sit at "Brand Blueprint Booked" today (SB).
- Meanwhile 59 Brand DNA links and 57 offer links exist (SB): the work happens in the Google Docs, the form is skipped. That matches the CEO's words: "even just creating the offer on the brand form, he's just doing it on the Google Doc anyway."
- The form is about **60 questions** (MC Typeform Forms), almost all required, in one long run that mirrors the whole call. Its welcome text asks the creative director to fill it live ("do not save it for the end"), which competes with running the call.
- **It asks for what it already has.** It carries a hidden `brand_dna_link`, then requires "Brand DNA doc link" again. It requires "Offer cheat sheet link" though the card holds it. Its offer fields copy the cheat-sheet worksheet field for field, so the creative director types the offer twice. It asks for the Fathom link by hand.
- **It repeats the kickoff and the onboarding call.** The CSM already asks the one-service question with the same three tests (wanted, profitable, easy to deliver) in OCF Step 9 and records it in kickoff "Which service are we advertising?". The kickoff also records the daily budget, consultation types, content links, Content Discussed, Templated Ads Discussed and Status. The onboarding form holds website, Instagram, payment options, goals and challenges. The Brand DNA template's first section (name, website, socials, contact) is all onboarding-form data.
- **The partial trigger is not where the spec put it.** SPEC wanted five fields first (templates chosen, service, price anchor, landing page or lead form, daily budget), then a webhook. The live form has service, capacity, templated ads and budget first, but "Where does the ad send them?" sits deep inside the offer group and there is no price-anchor field, only "Minimum project". Typeform sends a partial event when it judges the respondent stopped, not at a chosen question (unverified here; check Typeform's partial-response rules before relying on it). A cockpit-built form can send the starter step explicitly instead.
- **Templates first or custom first is unsettled.** FTH 2026-10-06: the creative director argued custom ads perform better; the agreed process became custom first, templates only when the client's material is missing, and he was to change the Blueprint form to match. The CEO's 2026-10-22 ask goes the other way: picking the templated ads should trigger media straight away. The newest word is the CEO's, but the presentation and form should make the template pick one tap, with custom work following.
- **The creative director's cockpit mislabels the form.** `creativeLinks.ts` says "Brand Blueprint form (client fills it before the call)". The form, MC Typeform Forms and memory all say the creative director fills it and the client never does. Its Key Links row is the bare link (no `onboarding_client_id`), so a submission from it cannot be joined to a client (MEM `csm-call-sync`).

**On the call itself (BBF pitfalls, CJ, FTH):**
- Client fatigue: second long call within 48 hours.
- The creative director becomes an order-taker; owners have strong opinions about their own ads.
- Owners want to advertise every service; one service, one offer, settled in Block 1.
- Adjectives written down as differentiators.
- Fantasy bonuses.
- Owners resist "discount" offers (CJ M1 failure condition) and reject starter ads (CJ problems table).
- Money: the call needs specific numbers, but GB card 5 says "Not exact figures. Approximate project values and timelines are enough" while BBF Block 3 says "I want specific numbers". One line should be chosen.
- Content: the client has not uploaded, will not be on camera (answer: someone else, AI ads, or the UGC upsell via the CSM), or the 72-hour deadline slips (launch on templates). FTH 2026-10-20: the team now downloads assets the moment a link arrives.
- Late, on a phone, or no-show; re-booking pushes launch week.

## 7. On screen for the client versus private to the creative director

The CSM decks already split the canvas (what the client sees) from the notes window and prep (what the presenter sees). The Blueprint call maps onto the same split.

### The client sees

| Moment | What is on screen |
|---|---|
| Opening (Block 0, GB 1–6) | Their company name; why the creative director; the 45-minute agenda; three rules; what we need from you; this call, we build, your launch call |
| Service (Block 1) | The five main services with the kickoff's choice already lit; the parking lot for the rest; "one service, one offer" |
| Best at (Block 2) | Their own words captured as they speak (exact phrasing is the rule); the adjective-versus-mechanism contrast as a teaching card |
| Pricing (Block 3) | A band ladder for the chosen service (minimum, typical, high end, the anchor); the filter line the call centre will use, shown as an example, never a quote |
| Competitors (Block 4) | The names they give, typed in as they speak |
| The offer (Block 5) | The offer built live from their service section of the cheat sheet: pattern, name, bonuses, anchor, what the consultation gives and who delivers it, then the tiers. Start from the creative director's pre-written draft so the client corrects it instead of facing a blank page (BBF prep) |
| Expectations (Block 6) | Paid versus referral (the two roads, already drawn for launch slide L7), paid versus organic, the test window, and the approval choice as three options |
| Brand (Block 7) | Their Brand DNA essentials: logo, colour swatches, fonts, tone, always and never |
| Content (Block 8) | The shot list, the 72-hour date, their Drive folder |
| Close (Blocks 9–10) | The one-sentence offer with X to Y and Z, what they owe by when, what the launch call will show; the launch call booked on the calendar |

### The creative director keeps private (notes window, prep, the form)

- Prep: kickoff summary, onboarding notes, the closer's notes and sales-call transcript, the research report. The internal doc `Internal Mahara - {client}` holds negotiated pricing and discounts and must never be shared on screen (MC Apps Script).
- The decision rule (margin versus capacity) and the capacity-risk note to the CSM.
- Scoring: mechanism strength, audience size, audience specificity, content rating, gross and net margin.
- The starter-ad pick (Drive link), daily budget check, landing page or lead form.
- The UGC flag and upsell signals (no website, weak site, no deck, not on Google, no branded material): "These go to the CSM in writing, not into this conversation."
- Scripts status, editor, hand-off date, events to script for, the Fathom link, the transcript.
- Talk-track lines for pushback ("hold the frame"), the paid-ad objections, the no-show messages.
- Claims that need checking before they are ever shown: "worked with over X companies the past Y years" (BBF placeholder), "over ten years of experience" (OCF), "well over a million dollars advertising ... in this region" (BBF Block 6). Keep them in the notes until confirmed for the person presenting.
- The cheat sheet's Fit-out examples use kitchen and bathroom names; per memory `main-services`, client-facing slides name the five main services, never a sub-trade as "the service".

## 8. What the kickoff already answers (fill these in before the call)

| Blueprint question | Already known from | Treatment |
|---|---|---|
| Service focus | Kickoff "Which service are we advertising?", hidden `service_focus` | Show pre-selected; one tap to confirm |
| Daily budget | Kickoff "What is your daily budget for the ads?", hidden `daily_budget` | Confirm only |
| Templated ads | Kickoff Templated Ads Discussed and Status (Approved, Declined, Waiting On Client, Wants To See Them First) | Pre-answer "Are we launching on templated ads?"; the pick is the partial trigger |
| Consultation types | Kickoff and onboarding form | Pre-fill "what the free consultation includes" |
| Content and Drive | Kickoff content links, onboarding `content_drive`, client Drive folder | Pre-fill the content block |
| Website, Instagram | Onboarding form | Pre-fill Brand DNA section 1 and the upsell signals |
| Payment options | Onboarding form `payment_options` | Starting point for deposit and terms |
| Goals, challenges, why joined | Onboarding form | Context for best-client and problem questions |
| Competitors | Market research link (25 of 70 cards) | A starting list to confirm; research is never an approved offer (DECISIONS 2026-09-14) |
| Brand DNA link, offer link | ClickUp card, `editor_clients` | Never ask; read them |
| Fathom link | The meeting tool | Fetch, do not ask |

## 9. Ids in one place

- Blueprint Typeform `oYZKtogO`; hidden fields `onboarding_client_id, legal_name, service_focus, daily_budget, consultation_types, website, instagram, csm_name, brand_dna_link`.
- Make 14 "Brand Blueprint Form Submitted" `9748311` (partial vs complete); the form also posts to `9502731`.
- Make "Kick Off Form Submitted" `8925654` (called 12 in memory, 7 in mahara-context): writes the Blueprint link to ClickUp field `1b7a4a74…`, sets Brand Blueprint Booked, sends phase 4.
- Calendars: Blueprint `x84ET6KnA8odlsjYiVLq` (45 min), launch `5E1EVxLJbGiDM3iYl2kL`.
- Call summary form `fRokTITH`. Creative onboarding template `t-86eyu1w3d`.
- Onboarding Map phase 4 "بناء الهوية والعرض" (building the identity and the offer); phase 5 is sent only on a complete Blueprint.
- Framework docs: BBF `1DUd5Euj4Ke7TNlY1MwAH-YB72-VED8JcILa84GvG528`; Gamma `The-Brand-Blueprint-Call-4ql4ygy1862k8sv`; cheat sheet `14fBr8Qp6Ze6fMjNFAuBRhmRl_exd4f4z8QblyDer1XE` (do not edit; the CEO's original).

## 10. Open points for the lead

1. Pick one length: 45 minutes (calendar, client copy) and cut the call to fit, or 60 (CJ) and change the calendar.
2. Templates first or custom first: the 2026-10-06 agreement versus the CEO's 2026-10-22 ask.
3. Specific numbers or ranges on pricing (GB card 5 versus BBF Block 3).
4. Which claims about the creative director and ad spend can go on screen.
5. The CD cockpit's "client fills it before the call" label and bare form link (repo fix, out of this read-only task).
6. Whether Make 14's partial route can be kept for a cockpit form, or replaced by an explicit "send to media buyer" step; Typeform's partial timing needs confirming.
