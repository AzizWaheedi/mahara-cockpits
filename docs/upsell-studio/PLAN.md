> Approved planning record, copied from the handoff notes on 27 October 2026. For verified implementation, release state and remaining approvals, read SHIP.md. Historical future-tense sections are not a deployment claim.

# Upsell Studio: build plan (source: the CEO plan doc https://claude.ai/artifact/UktQZzTSqUQbo8vfpzs4VT, 26 Oct 2026)

## AMENDMENTS THAT OVERRIDE ANYTHING BELOW (the CEO, 26 Oct 2026)
1. Win (gate): a qualified quote given in the last 30 days, or a signed project. The CSM can also tick "They've had a win" with the win written in (logged, audited).
2. Closer placement: keep the free replacement clause, worded as a contract clause about the hire. No closer deck until a recruiter is named.
3. Prices: the CSM controls the client's price. A price below list carries a one-line reason, logged and shown on the CEO card. NOTHING waits for CEO approval: no price asks table, no floor gate. The CEO sets list prices on Money > Offers (blank = no price yet, the doc's price as a one-click hint). SEO and GEO's price stays locked per the doc unless the CEO unlocks it. "Held full price" in the notes window is a reminder step before saying a lower number on a call; the lower number never shows on the canvas.
4. Proposals live in the CS (client success) cockpit beside the decks, built like the sales cockpit's proposal but not on its AI drafter.
5. Videos and decks: as premium as possible. Voiceover by ElevenLabs (Higgsfield voices as backup), a professional Gulf Arabic voice and a matching English voice, cast from 3 per language for the CEO to pick. Visuals by Higgsfield (GPT Image stills, Kling motion), graded to the deck palette, mixed with real screens; each offer gets an art set (hero visual, revision-cloud-style icons, backgrounds) shared by deck, video and proposal. Rules that stay: never an AI version of Aziz (his closing clip is his real footage); a generated person never poses as a real client or customer; real screenshots stay real wherever they show the client's gap; no client's work without written OK (a fictional demo firm tagged "Example" until then).
6. Pilot scope first: the WEBSITE offer end to end (catalog with all 7 offers seeded, gate, Offers tab, website deck, prep, notes, Hot list row, pitch log, proposal builder + client page + door, website video). Second campaign follows on the same factory.
7. Voices (26 Oct, default while the CEO listens): Arabic = Mohamed (Kuwaiti, ElevenLabs library KJe6YIQ4MHI94EGaDZC7), English = George (JBFqnCBsd6RMkjVDRZzb). The CEO can swap to Nasser, Yousuf, Brian or Daniel. The ElevenLabs account is on the free plan: library voices are refused through the API and nothing it makes is licensed for commercial use, so the Arabic voiceover waits for the CEO to move the plan to Starter or above, and the English draft is for review only until then. The video says so on its own status line; nothing pretends the Arabic exists.



# In one look

**What we build.** One short, premium deck per offer inside the CSM cockpit, opened from the client's page, and a one-minute demo video per offer in English and Arabic. Seven offers come from your doc. The renewal keeps its own flow.

**What the client sees.** Five slides, about six minutes, inside the normal check-in: their own screen with the gap circled, their own goal in their own words, what we would build for them, the price beside one of their own projects, and the next step. It runs on the same engine and brand as the onboarding, launch and Blueprint decks. The one signature is a drawing's revision cloud, drawn around the gap in their own screenshot.

**Prices.** You set list prices in one place: Money, then Offers. A blank price means "no price yet". A CSM opens at list price or higher. Anything lower needs your one tap before the call, or a "held full price" step during the call that never shows on the client's screen. Changing a price never needs a ship.

**Who gets pitched.** The server checks one gate: a win in the last 30 days, happy, not red, nothing raised on the last call, no offer talk in 30 days, and not in the 30 days before renewal. One offer a month, picked by a written order.

**Order.** Website first, then Second campaign: built, with videos, and the website pitched on one live call within about three weeks. Each other offer follows once it has a named delivery owner, a fulfilment list and proof we can show.

**From you.** Three answers (see Decisions) and one 30-minute recording session.


# The deck system (price rule overridden above)

## Where it lives

- **Client page, Present, then "Present an offer".** A picker opens. This month's offer sits on top with why it fits ("No working site, checked twice, 26 and 27 Oct"). The rest sit under Later, each with why it waits ("No win in 30 days", "No cameraman in Riyadh yet"). Fit data loads only when the picker opens, so the Present button stays light.
- **Client page, Money tab, Hot list card.** Each client gets one offer row that says **Ready** or names the missing piece: a capture older than 7 days, no price, or no payment link. Prepare, Present and Log the conversation sit on the row. This extends the existing card, so there is no new card.
- **Money, Offers tab** (/money?tab=offers, beside billing, projections and churn). It holds the price list (you edit, CSMs read), the video links and the pitch log.
- **Routes:** /client-success/clients/&lt;id&gt;/present/offer/&lt;key&gt;, plus ?view=prep and the notes window. The browser tab reads "&lt;Client&gt;: your website". The word "upsell" never appears in a route, a title or on the canvas.

## How it is presented

- **Five slides inside the usual check-in, no cover.** Three more open on keys: H for how it runs, P for proof (hidden until that offer has proof), V for the video. Arrows or a clicker move the deck. F is full screen, L switches language, N opens the notes. Esc never leaves the deck.
- **Three views, all from the existing engine:**
  - The deck, at 1920x1080.
  - The notes window, which only the CSM sees: the talk track, push-back answers, the price steps and Copy payment link.
  - Prep, used before the call.
- **The gate runs on the server when the deck loads.** A client who fails it gets the reason, not the deck. "Client asked" opens the deck anyway once the CSM pastes the client's own words and the date. It is logged as reactive and shows on your card.
- **After the call,** the notes window copies one WhatsApp message: the video link and the agreed next step. The answer is logged on the call.
- **Never on the client's screen:** upsell, renewal, lead, CPL, spend, a budget figure, a list price, a discount or a promised result.

## How it fills from the client's data

| Offer | Fills itself from | The CSM adds in prep |
|---|---|---|
| Every offer | From the onboarding form (42 clients answered), each dated: their 90-day goal, top challenges and the price of each service. Also their logo, their country, and whether they are done for you or done with you. | Captures (dated, cropped, contact details masked), the gap mark, the language. |
| Website | The site on file from the ClickUp card and the onboarding form. It is flagged when the two disagree or point to Instagram. The site check runs on demand. | A capture of their site, or of their name on Google with no site. |
| SEO and GEO | Main service, city from their service-areas answer, the site check. | Google for service plus city, their name, and one AI answer, each stamped "Searched as &lt;city&gt;". Taken by hand, because automated searches hit bot checks and ChatGPT needs a login. |
| SMM | Instagram handle and their ad stills from Meta. Clients already on our social calendar are skipped. | A grid capture with its last post date. |
| UGC | Their current ads in phone frames. In the notes only: frequency, the newest ad's age and the link CTR trend. | What the owner has said about being on camera. |
| Closer placement | From cockpit_client_days, for the last 90 days: quotations, signed, pending with the oldest one's age, and lost. Shows appear for done-for-you clients only. | Their usual decision time, who sells now, and the owner's hours a week on sales. |
| Cameraman day | The newest ad's start date (cockpit_meta_ad_days), and whether a cameraman is listed for their city. | Which sites are worth filming. |
| Second campaign | The services listed at onboarding, and the service we advertise. | The match to the five main services, and services seen on their site. |

**Missing is never zero.** An empty slot hides its line on the canvas, and prep tells the CSM what to capture. A site is called broken only after two failed checks a day apart.

## The editable price

- **List price (you).** One row per offer on the Offers tab:
  - price parts and cadence;
  - a floor;
  - locked or not;
  - whether a split is allowed.

  A blank price means "no price yet", with the doc's price shown as a hint you accept in one click. Every change writes an audit row. Every deck opened after the change uses the new price.
- **Opening price (the CSM, in prep).** It is prefilled with the list price, and the CSM may raise it freely. A lower opening price, or any price while the list is blank, sends "Ask the CEO" with a reason. It lands on your card for one tap. Prep attaches the payment link for the opening price.
- **On the call (notes window only).** Slide 4 shows the opening price and nothing else for the whole call.
  - To go lower, the CSM first taps "Held full price". The lower number, at or above the floor and with a reason, is said out loud and sent on a new payment link. It never appears on the canvas.
  - SEO and GEO never goes lower. Its 2,500 and 2,500 split appears only after "Held full price".
  - Price fields save on Enter or when the field is left, never on each key. This keeps "1", "18", "180" from flashing on the shared screen.
- **Rules built in:**
  - Paid in full by default.
  - The website always carries its care plan.
  - Second campaign's "What we need from you" line names a daily ad budget for the new service, paid to Meta from their card, with no figure.

## Languages

- English and Arabic. The CSM picks the language in prep, because only 2 of 19 active clients have one on file. L switches live.
- Slides are in white Gulf Arabic with no dialect-only words. This is the rule the Blueprint deck already follows and tests.
- The spoken lines in the notes follow `dialectFor`: Saudi for the 12 Saudi active clients, Kuwaiti otherwise (6 in Kuwait, 1 in Qatar).
- All Arabic is written under the voice skill, never translated. It uses IBM Plex Sans Arabic, a mirrored layout and Arabic-Indic digits.
- Outside facts in the notes match the client's country.

## Built on what exists

- One slide factory makes each offer its own deck kind: `offer_website`, `offer_second_campaign`, and so on. The channel, the windows, the prep and video keys, the timing and the names then work unchanged. The Blueprint deck is not refactored.
- It reuses Fig, Identity, the phone frames, the video slots and the prep saver.


# The story each deck tells

## The story every offer deck shares

| # | Slide | What the client sees | What the CSM does |
|---|---|---|---|
| 1 | What we saw (Rev A) | Their own dated capture. A revision cloud draws around the gap. Step 2 is the question, alone on screen. | Opens with "Quick thing before we get into the numbers." Asks the question, then stops talking. The answer picks the branch in the notes. |
| 2 | Why it matters for you | Their own goal or challenge from onboarding, quoted with its date, and one line tying the offer to it. | Reframes in the client's words. The outside fact stays in the notes. |
| 3 | What you get (Rev B) | An example drawn for them, each part named by a leader line. One amber line: what we need from you. | Walks the parts, one press each. |
| 4 | The investment | A one-line bill of quantities at the opening price. Step 2: their typical project beside this offer's cost in their currency. Step 3: "How many projects would pay for this?" | Holds full price. Lets the client answer. |
| 5 | Next step | What we commit to: deliverables, and timing counted from payment and their content, never results. The closing question. | Asks for the card on the call. Copies the payment link. |
| H | How it runs (key) | Weeks counted from payment and content, and who does what. | Shown if asked. |
| P | Proof (key) | Proof for this offer, once cleared. Until then, one main-programme testimonial labelled "From our main programme". | Shows it. Does not narrate numbers. |
| V | The video (key) | The offer's video. | Plays it, or sends it after the call. |

**The return, in plain words.** Slide 4 never prints a multiple, for two reasons: revenue is not profit, and 17 of 19 active clients have no signed project logged yet. It shows two lines:
- "Your typical project: 18,000 KWD (your answer, 3 Sep)"
- "This, first year: 1,350 KWD"

Then it asks the question. The client works out the return himself, which lands better than us saying it.
- The project value comes from their onboarding answer. Where a signed project has a value, it says "From your sheet" (1 client today).
- With no value on file, step 2 asks for one, and the CSM types it live, tagged "Your figure".

**Done with you.** Those clients never see appointment or call-centre lines. Today that is 1 of 19 (نهوض نجد).

## What is specific to each offer

| Offer | Offered when | Their screen (slide 1) | What you get, and what we need (slide 3) | Investment line (slide 4) | Close (slide 5) |
|---|---|---|---|---|---|
| Website | No working site after two checks a day apart, or a thin one. | Their site, its parked page, or their name on Google with no site. The cloud marks what is missing: the site, WhatsApp, Arabic. | Up to 6 pages in Arabic and English, a portfolio, WhatsApp and an enquiry form, tracking. Care plan: hosting, backups, one hour of edits a month. We need: logo, project photos, the list of services. | Build one time plus the care plan monthly, always together. "Live two weeks after we have your content." | "Want me to start it this week?" |
| SEO and GEO | They have a site, or are buying one, and do not show for their service in their city. | Dated captures, searched as their city: the service plus city, their name, one AI answer. The script's "the new Google is ChatGPT" becomes "Google's own AI answer, now in Arabic above the links". | On-page SEO, Google Business Profile, citations, schema, service and FAQ pages written to be quoted by AI answers, a monthly rank and AI report. If they have no site, one is built in and never itemised. 90 days. We need: access to their site and Google profile. | One line, locked price. "The pages, profile and listings stay yours after the 90 days." A site we build moves to the care plan at day 91. | Proposed: "Shall we start it this month?" |
| SMM | Their page has gone quiet and they are not on our social calendar. | Their grid with its last post date, beside their own ad stills: "Every ad we run shows your page name. Tapping it opens this page." | 20+ posts a month, 5 to 6 graphics a week from footage they already send, weekly stories, a monthly call and report. Reels only when they send footage. We need nothing new. | Monthly. In the notes: this builds the brand; it does not bring enquiries on its own. | Proposed: "Shall we start on the 1st?" |
| UGC | The owner will not be on camera, or wants a face on the brand. | Their current ads in phone frames beside his own words about the camera. Never "your ads are tired". | 8 videos: 5 ads, 1 main video, 2 thank-you videos. We script them. An actor in their dialect presents the firm, never as the owner. The 3 long videos are theirs to keep. We need: one call to agree the script. | One time. | "Want to test it?" |
| Closer placement | Quotations older than their own decision time are piling up, or the owner wants his hours back. | Their own 90 days: quotations, signed, pending ("Pending 36, oldest 52 days"), lost. | We recruit, train on our framework, write the scripts and run month one. Then management, call reviews and coaching. Three-month minimum. Their closer works in their tools, not our cockpit. We need: a seat, a phone, their price list. | Placement plus monthly. | Proposed for 7a: "Shall we start the search this week?" 7b: "What would you actually do with those hours back?" |
| Cameraman day | A cameraman is listed for their city, and their newest ad is ageing or they have no time to film. | Their newest ad's start date and the footage on file: "Your newest ad started 29 days ago." | A full day at a site, the office or both: finished work, work in progress, the team, the owner if willing. The footage is theirs. The aim, not a promise, is about three months of ads and posts. We need: a site and a date. | Per day. | "Which site would be worth filming?" |
| Second campaign | The first campaign produces steadily, and they list a service we do not advertise. | The services they listed at onboarding beside the one we advertise, in the five main services' names. | A second campaign with everything the first has: its own ads, form and words. We need: a daily ad budget for the new service, paid to Meta from their card, with no figure on screen. | Monthly, on top of the program. | "Want me to set it up?" |

## Who fits today (26 Oct; each figure from one source, checked against a second before any slide)

- **Website:**
  - Arcturus: domain parked.
  - ARCWANI: secure connection fails.
  - Liwan: domain does not resolve.
  - Madana: Squarespace expired.
  - Atlantis: the card points to another company.
  - No site on file: mergestudio.kw, Shades, شركة العلا, منشآت خالدة, SAFAD.
- **Second campaign:** Arcturus and Ocean Home list more services than we advertise and are producing: 17 and 38 confirmed appointments in 30 days.
- **Closer placement:** nobody yet. Arcturus has 14 quotations and 0 signed in 30 days. But 36 of its 37 answered outcomes are still pending after about seven weeks of ads, which is a normal sales cycle so far.
- **The gate:**
  - 17 of 19 active clients logged a confirmed or shown appointment in the last 30 days; Joe and Sera and نهوض نجد did not.
  - Happiness, level, the last call and the renewal stretch decide the rest, live.
  - Early-September starters (ARCWANI, Ocean Home, Arcturus, Atlantis) are near renewal, so their November conversation is the renewal. The website can ride in it as the free care-plan month.
  - So the pilot client is whoever passes the gate in the week of 9 Nov.


# Demo videos (voice and visuals overridden above)

## One video per offer, about 60 seconds

| Offer | Opens on | What it shows | Real material needed |
|---|---|---|---|
| Website | "Someone sees your ad. Then they search your name." | A search that finds nothing. Then a bilingual site built page by page: portfolio, WhatsApp, enquiry form. | Our demo firm's site (about 2 days, built from the examples.ts scenes), or a site we built, with the owner's OK. |
| Second campaign | "You also do fit-out. Does anyone know?" | The first campaign's journey copied for a second service: its own ads, form and words. | The launch deck's journey lanes and example ads. |
| SEO and GEO | "Ask Google for the best fit-out firm in your city. What does its AI answer say?" | A search and Google's AI answer on a demo query, rival names blurred. Then the profile, service pages, FAQ pages and the monthly report. | Screen captures on a demo query. |
| SMM | "Your ads work. Your page has gone quiet." | One month on a calendar: 20+ posts and stories made from the same footage. | Our demo firm's grid, from footage we own. |
| UGC | "Not every owner wants to be on camera. You don't have to be." | The script page, an actor presenting a firm, the 8 videos laid out, the 3 long ones marked "yours". | Real UGC we produced. Waits until it exists. |
| Closer placement | "The appointments are coming. Who turns quotations into signed projects?" | Recruit, train, scripts, month one, call reviews, drawn as a programme of works. No cockpit screens. | A real closer on camera, if one agrees. |
| Cameraman day | "One day on site. About three months of content." | A day's timeline, then that footage turning into ads and posts week by week. | Footage from a real shoot day, cleared. The 7 format films in Wistia are candidates. |

## Five beats in every video

1. **Hook (0 to 5 s):** the client's own moment.
2. **The gap (5 to 15 s):** what their customer finds today, shown for real.
3. **What it is (15 to 35 s):** the real deliverable on screen, and one diagram that grows.
4. **What we need from you (35 to 45 s):** three or four labels on the real thing. Never a bullet slide.
5. **The return question and close (45 to 60 s):**
   - The deck's empty card: "Your typical project / This". The line: "How many projects would pay for this? Your CSM works it out with your numbers."
   - Then a real 6 to 10 second clip of you: "Your CSM will walk you through it."
   - No price and no invented figure.

## Files

- Per offer: one English and one Arabic 16:9 cut. The Arabic cut is rebuilt right to left, not subtitled, in regional Gulf wording set under the voice skill. Each has a poster still in the deck's colours.
- That is 4 files for the pilot and 14 for all seven. 9:16 phone cuts come only after first real use, if CSMs ask for them.
- **Hosting:** Wistia, in a folder called "Offer videos". Files are replaced in place, so links never change. Each deck has one video slot per language.
- **WhatsApp link:** the message carries a short link per pitch, served by the proposals plan's door. It records the open, then redirects, with no client data in any URL. Until that door is live, the message carries the plain Wistia link and opens are not counted.

## The face and voice rule

- Your real voice and your real frames only. Never an AI avatar, an AI "customer", dubbing, lip-sync or a voice clone.
- Pilot: one 30-minute session for the two scripts in both languages and the closing clips. UGC and Closer placement are recorded later, once their open questions are settled.
- No client's work appears without their written OK. Until then, one fictional demo firm runs through the videos, tagged "Example".
- If a video is ever posted publicly, its thumbnail follows the personal-brand palette.

## Tools

- **HyperFrames, pinned version,** for assembly, motion and captions: Geist and IBM Plex Sans Arabic, teal on Deep Space. Arabic captions get their own right-to-left component, checked on rendered frames.
- **Playwright captures** of real screens: fixed crops, contact details masked, nothing pressed that sends or saves.
- **No Higgsfield or Kling shots.** Generated atmosphere is the most AI-looking thing a video can carry.
- **One licensed music bed** under the voice, at -14 to -16 LUFS.
- **Rendered on the VPS or with HyperFrames cloud render,** after a doctor check of the render host: FFmpeg, Node 22 or later, 5 GB free. This Mac has no FFmpeg and had 421 MB free on 26 Oct.

## Effort

- **Template:** 1.5 to 2 agent days.
- **Demo firm site:** about 2 days.
- **Each offer:** about 1.5 days. That covers scripts in both languages, captures, the build, the Arabic rebuild and checks.
- **Pilot (Website and Second campaign):** about 6 agent days, running beside the decks.
- **Your time:** one 30-minute session, and about 15 minutes of review per video.
- **Money:** a music licence, if we buy one.


# Design (generated visuals allowed per amendment 5)

Following mahara-context's frontend-design skill (plan, critique, revise) and Hallmark.

## Ground it in the subject

- **Who watches:** the owner of a Gulf design, fit-out or build firm, on a shared Zoom tab, in the middle of his usual check-in. He reads drawings for a living.
- **The deck's one job:** in about six minutes, he sees his own gap, sees what we would issue for him, and weighs the price against one of his own projects.
- **His world gives us the devices:**
  - the revision cloud, the scalloped line drawn around whatever changed between two issues of a drawing;
  - the revision letter;
  - the bill of quantities.

## Tokens (from the CSM decks; only motion is new)

| Token | Value | Job here |
|---|---|---|
| Deep Space | `#091333` | Slide ground |
| Deep | `#060d24` | The well behind every capture |
| Panel | `#0e1a42` | The bill of quantities |
| Teal | `#00cfc8` | Ours: the Rev B cloud, the lit step |
| Ink | `#f2f6fa` | Theirs: the Rev A cloud, their words, their numbers |
| Amber `--dk-leak` | `#f5b84b` | Only "What we need from you" |
| Line strong | `rgba(255,255,255,.22)` | Leaders and bill rules, which must survive Zoom |

New motion tokens: `--dko-cloud-ms: 640ms` (the cloud draws) and `--dko-issue-ms: 420ms` (Rev A becomes Rev B). Classes start `.dko-`.

## Type

- Geist 700 for headings and 400 for body, on the CSM decks' scale: 56, 30 and 24.
- Geist Mono only for labels of record: the revision letter, "Captured 26 Oct 2026, 10:42, searched as Riyadh", and source lines.
- IBM Plex Sans Arabic, one step larger.
- Floors: 24 px English, 26 px Arabic. At most five sizes a slide. Sentence case, no italic.

## Layout

Slide 1, What we saw (the signature, Rev A):

```
+----------------------------------------------------------------+
| What we saw                                     Rev A  26 Oct  |
|  +----------------------------------------+                    |
|  |  their real capture, 1 px hairline,    |                    |
|  |  no drawn browser bar                  |                    |
|  |      .-~~~~~~~~~~-.                    |                    |
|  |     (   the gap    )-------------------o  "Not on page 1    |
|  |      '-~~~~~~~~~~-'  /A\               |   or page 2"       |
|  +----------------------------------------+                    |
|  Captured 26 Oct 2026, 10:42, searched as Riyadh               |
|  Step 2:  "Do you have a site?"   (alone, nothing else moves)  |
+----------------------------------------------------------------+
```

Slide 4, The investment (example figures):

```
+----------------------------------------------------------------+
| The investment                                                 |
|  Item  Description                       Terms       Dollars   |
|  1     Website, Arabic and English       one time    2,000     |
|  2     Care plan: hosting, edits         monthly       200     |
|        Paid in full. Live two weeks after we have your content.|
|  Step 2:                                                       |
|  Your typical project     18,000 KWD    your answer, 3 Sep     |
|  This, first year          1,350 KWD                           |
|  Step 3:  How many projects would pay for this?                |
+----------------------------------------------------------------+
```

## The signature: the revision cloud

- It appears twice per deck and nowhere else.
  - **Rev A,** in ink, circles the gap in their own capture: theirs. It goes where the CSM marked the gap in prep. With no mark, it wraps the whole capture.
  - **Rev B,** in teal, circles what we would change on the example drawn for them: ours.
- It is a 3 px scalloped line that draws on one press in 640 ms. The revision letter sits in a small triangle at its corner, as on a real drawing.
- In Arabic the cloud and leaders mirror. The letters stay Latin, as Gulf drawings use them.

## Rev B, the example drawn for them

- A fixed template per offer fills from their logo, 2 or 3 of their own stills from Drive and their colours, through the existing Identity and phone mockups.
- It takes about five minutes per client in prep, and is labelled "Example, drawn for &lt;Client&gt;".
- No AI imagery.

## Directions rejected

| Direction | Why not |
|---|---|
| A before-and-after slider | The stock SaaS device. It implies a promised result, and the wipe blurs on Zoom. |
| An audit scorecard with a grade out of 100 | Reads like any SEO tool, grades a client who did not ask, and adds red as a fourth colour meaning. |
| Three pricing tiers | We sell one offer at one price. Tiers invite the client to pick the cheapest. |
| A large return multiple ("covers it 13 times") | The template answer. It compares revenue, not profit, and invites "you haven't got me one yet". Replaced by two lines and a question. |

## What keeps it premium and not AI-made

1. Their real screens, dated, in a plain frame. Never a drawn browser bar.
2. Their own words on slide 2, with the date they said them. No stat slide.
3. No invented number. Every client figure says where it came from, and missing data shows nothing, never zero. Outside figures stay in the notes with their source and year.
4. Every picture that is not live carries a tag: "Captured 26 Oct", "Example, drawn for &lt;Client&gt;", "Your figure", "Preview".
5. One accent. No gradient, glow, shadow lift or loop. One press makes one change, then stillness.
6. Copy in the doc's spoken voice, short, run through the humanizer pass. No em dashes, and no "unlock" or "seamless".
7. Inside the cockpit (Offers tab, prep, the Hot list rows), the cockpit's own kit: Geist, `--mahara-teal`, SectionCard, StatTile, StatusChip, EmptyState, format.ts.

## Before ship

- Shots of every slide and step at 1920x1080 and 1366x768, in both languages, viewed at Zoom's 0.67 scale.
- The Hallmark audit, with all six pre-emit scores at 4 or more.
- The slop test on the screenshots.


# Backend (no price asks per amendment 3)

## Tables (Creative Triage, prefix cockpit_)

Every table has row security on and no browser grants, with EXECUTE on its functions granted in the same migration.

| Table | Holds | Who writes |
|---|---|---|
| cockpit_upsell_catalog | One row per offer, shared with the proposals plan: names and client lines in both languages, price parts (blank means no price yet), cadence, floor, locked, split allowed, the care-plan link, the commission earner (one time or recurring), a default video per language, and a revision. | You only, via cockpit_upsell_catalog_set. Anyone else gets 42501. |
| cockpit_csm_deck_prep (widened) | Per client and offer deck: opening price and reason, the split switch, typical project value and currency, captures with "Searched as", the gap mark, client asked (their words and the date), payment link, language. | CSM seats and you, via cockpit_csm_deck_prep_save. |
| cockpit_upsell_price_asks | An opening price below list, or any price while the list is blank, waiting for you: client, offer, price, reason, your answer. | The CSM asks. You decide. |
| cockpit_upsell_pitches | One row per offer conversation, keyed by task_id: offer, date, CSM, opening price, that day's list price, held price, final price, reason, split, proactive or client asked, gate flags, answer, follow-up date, payment link. It is also the source for the one-a-month rule. | CSM seats and you. |
| cockpit_upsell_payment_tags | payment_id to offer and client. It sits beside the refreshed payments table, shaped like cockpit_billing_payment_exclusions, because the refresh worker rebuilds that table. | The Confirm paid flow. |
| cockpit_client_site_checks | URL, source, status, checked at, checked from. | The site check function. |

**Widened in the same migration:**
- the deck CHECK on cockpit_csm_deck_prep and cockpit_csm_deck_videos, which today allows onboarding and launch only;
- the same check inside cockpit_csm_deck_prep_save;
- the key list in cockpit_csm_deck_prep_value;
- cockpit_csm_deck_video_slot_ok.

**Captures** use the cockpit_csm_launch_ads upload chain with a new kind, 'capture'. **Commission** is tagged as a product on cockpit_pay_entries. The rates stay in csmMoney.ts.

## The gate

`cockpit_csm_offer_gate(task_id)` returns either ok or the reasons, each with its source and date:
- Active and more than 30 days live, the bar that reviews and referrals already use.
- A win in the last 30 days: a shown appointment by the cockpit's show rule, a quotation, or a signed project. Or the CSM's "They've had a win" tick, with the win written in and audited.
- Happy on the record, updated in the last 14 days, and not red.
- No escalation or problem in the last call's takeaways. The patterns already exist in clientBrief.ts.
- No offer conversation in the last 30 days, from cockpit_upsell_pitches by task_id. Reviews and referrals do not count.
- Not between 30 days before the renewal date and the renewal's outcome. Projections' own 60-day window would block days 30 to 90 of every first program, so the gate uses the last 30 days (RED_DAYS).

`cockpit_csm_offer_sources(p_task_id, p_offer)` calls the gate and refuses a failing client with the reasons. It never returns leads, CPL, spend or budgets. Saving a pitch never refuses; it stores the flags. The proposals plan uses the same gate and catalog.

## How a price changes

1. You type a list price on the Offers tab and save. The audit row reads "Website: blank to 2,000, by the CEO". Every deck opened after that uses it. Nothing ships.
2. A client with an approved opening price keeps it. Prep flags it: "List is now 2,000. Approved 1,800 on 20 Oct."
3. The CSM raises an opening price freely. A lower one, or any price while the list is blank, goes to you as a price ask. Your tap approves or declines it.
4. On the call, a drop needs "Held full price" first, stays at or above the floor, and carries a reason. It goes on a new payment link, never the canvas.
5. "Full price held" counts on a call, or after a proposal was sent at list price. That is one rule for decks and proposals.
6. Each pitch stores the opening price, that day's list price, the held price and the final price, so reports stay true after later changes.

## Tracking pitches and outcomes

- **On the call,** the CSM logs the answer: yes and paid, yes not paid, not now with a follow-up date, or no with a reason. Follow-ups land on the Hot list.
- **Hot list:**
  - The offer fit rules go into `opportunitiesFor` in csmHotList.ts.
  - Second campaign uses the existing "Upsell - Service". Its pitch line, "Budget increase, no new retainer", is rewritten to the doc's monthly fee in the same change.
- **Payment:**
  - The invoice desk's Pay online link (Whop), or Card on file. It has made no Whop link yet, so it is tested first.
  - Monthly parts start on the same invoice, then run on the billing sheet's monthly line.
  - Clients paying in KWD use the ecom rail, as in the proposals plan.
- **After payment:**
  - Website, SMM and Backend open their existing fulfilment Typeform.
  - The other offers post on the ClickUp card and the client update board in Slack, through a Slack helper added to cockpit-csm-api via tools.ts.
  - One cockpit order form comes later, once the Typeforms' Make, ClickUp and Slack links are mapped.
- **Your card,** in the CEO cockpit's Client success section, with a SOURCES.md entry:
  - pitches this month by offer;
  - yes and paid;
  - cash collected, from the payment tags;
  - opening prices below list, with reasons;
  - client-asked counts per CSM;
  - price asks waiting for your tap;
  - follow-ups due.

## Workers

- **Just one: an on-demand site check from prep.** It is an Edge Function going through tools.ts. A site is called broken only after two failed checks a day apart. It has a health line. In the UI it says "Site not checked yet", never "No site".
- **No Instagram or footage worker.** The CSM captures the grid. The newest ad's age comes from cockpit_meta_ad_days (the first day per ad).

## Audit, health and numbers

- Every human write writes an audit row: catalog, prep, price asks, pitches and payment tags. The site check table does not, so cockpit_audit_log stays small after the 9 Oct compaction.
- Every outside call goes through tools.ts and lands in the health ledger: site GETs, ClickUp, Slack and the short link.
- Client outcomes come from cockpit_client_days and are checked against the client sheet's tab. Each figure has a note in prep: where it came from, and what it leaves out.

## Tests and ship

- **On every ship,** scripts/deck-offer-*.test.ts check:
  - the step order;
  - the copy check on the canvas, the notes and the WhatsApp text, through cockpit_client_copy_problems (shared with proposals): no lead, CPL, guarantee, promised outcome, "upsell" or em dash;
  - that no lower price ever reaches the canvas;
  - that the split stays hidden until full price is held;
  - the gate's refusals;
  - the prep keys against the migration.
- **Harness fixtures:** full, sparse, done with you, no price, and a Saudi client in Arabic. Shots of every slide at two sizes.
- **Ship** with scripts/ship.sh, check production, and record the session in mahara-context.


# Proof

## Rules for every offer

- **Mahara numbers** come only from the approved list: 70+ firms, 5 countries, $1.32M+ of ad spend managed, 4.7 on Google from 15 reviews. "65 GCC companies, $76M" is retired.
- **No client's** site, account or video appears without their written OK. Decks and proposals share one proof list. joeandsera.com, greystonegcc.framer.website and euphoriainteriors.ae stay off both, because none is our work on record.
- **No record shows we have delivered any offer except Second campaign,** which is the main programme on another service. On the other offers, main-programme proof sits only behind the proof key, labelled "From our main programme".
- **Outside facts** sit in the notes, matched to the client's country, never on the canvas as a claim of ours.

## Already on file

- **Wistia "Testimonials":** 10 client videos, including SAFAD, Joe and Sera, AMHECO, GrandioCity, Life Depth, Mass Design and Kesan.
- **Wistia "Content Page Examples":** 7 format films (talking head, render film, brand film, project story and others). To audit as UGC and Cameraman day proof: whose footage is it, and do we have their OK?
- **Proof page case studies,** in plain words: BAYT 22, Phoenix, SAFAD, Joe and Sera, GrandioCity, The Last Step, Life Depth, AMHECO, Mass Design, Kesan.

## Per offer

| Offer | Proof we have (notes, with source) | Proof we still need | Cut from every screen, script and message |
|---|---|---|---|
| Website | Design was the top reason in 46.1% of credibility comments (Stanford, 2002). Pages are judged in about 50 ms (Nature, 2006). 54% visit the site after reading reviews (BrightLocal, 2026, US). 76% prefer to buy in their own language (CSA, 2020). | 2 or 3 sites we built, each with the owner's OK. Site checks confirmed twice. | "More people turn up, and more of them sign." |
| SEO and GEO | AI use: Kuwait 21.1%, Saudi Arabia 29.4%, UAE 70.1% (Microsoft, Q1 2026). Google's AI answers in Arabic since May 2025 (Google). Google sends about 99.5% of visits measured against ChatGPT in each of the three countries (StatCounter, Sep 2026). Firms' own sites are most of ChatGPT's local sources: 58% (BrightLocal, 2024) and 72.3% (Insites, 2026). | One delivered result. Dated captures for each client pitched. | "Working for clients here." "Almost nobody in the Gulf is set up." "Makes them turn up and sign." "A separate source of appointments." "Keeps sending you work after." |
| SMM | Social is the main brand research channel for 60% in Saudi Arabia and 48.1% in the UAE (We Are Social, 2026). Instagram ads reach 3.0 million in Kuwait (DataReportal, 2026); notes only, because it measures ad reach. | An account we run, cleared. The social engine has published 0 posts so far. | "Show rate goes up, close rate goes up." |
| UGC | Kesan: 10+ agencies before us, not one video redone (proof page). Creator ads had 70% higher click rates (TikTok, 2025). Meta tells advertisers to vary creative (Marketing Brew, 2026). | Real UGC videos we produced. | "About thirty percent better." |
| Closer placement | The client's own quotations, signed and pending. The owner's own hours. | One placement on record. A named recruiter. | The speed-to-lead study (our call centre already answers fast). "Pays for it several times over." |
| Cameraman day | Showing work in stages persuaded 72%, against 44% for a before and after (Darden, 2021, small study). | A past shoot day, cleared. The cameraman list by city. | "Three months of content" said as a promise. It stays as an aim. |
| Second campaign | The main programme's testimonials and case studies. The client's own first campaign. | One client who ran two services, with their OK. | "The program covers ad spend up to 3,000." |


# Phases

## Phases and milestones

**Phase 0. Answers and a render host (26 to 28 Oct)**
- Your three answers. Everything else runs on the defaults.
- A doctor check on the render host, the VPS or HyperFrames cloud: FFmpeg, Node 22 or later, 5 GB free.
- The proposals plan moves onto the same catalog, gate and proof list.

**Phase 1. Website, to a live call (28 Oct to 13 Nov)**
- The catalog and Offers tab, the gate, the offer sources function and the website deck kind.
- Prep: captures, the gap mark, the price and the payment link. Also the notes window's price steps, the pitch log and the Hot list rows.
- The invoice desk's Pay online link is tested first, since it has never made one.
- The video template and the website video, rendered after your session in the week of 2 Nov.
- Milestone: you walk the website deck in the harness on a real client's data. Then one live pitch, in the week of 9 Nov, on a client the gate passes.

**Phase 2. Second campaign (to 17 Nov)**
- The Second campaign deck from the same slide factory, using the launch deck's journey lanes.
- Its video, in English and Arabic.
- Milestone: both decks and all four videos live.

**Phase 3. Close the loop (week of 16 Nov)**
- Payment tags, product tags on pay entries, your CEO card and the Hot list pitch rewrite.

**Phase 4. Each further offer, when it is ready (about one week each)**
- Ready means a named delivery owner, a ClickUp fulfilment list and proof we can show.
- Likely order:
  - SEO and GEO;
  - SMM;
  - Cameraman day, where a cameraman is listed for the city;
  - UGC, once real example videos exist;
  - Closer placement, once a recruiter is named.

**Phase 5. The renewal (December)**
- Its deck reads cockpit_csm_renewal_plans.offer and Plan the renewal. It gets its own plan.

**Later:** one cockpit order form, once the Typeforms are mapped, and 9:16 phone cuts if CSMs ask for them.

## What we build first together

1. A 10-minute pass: your three answers, and prices typed or left blank.
2. The website deck in the harness, slide by slide, on a real client's data. You mark what to change.
3. The website and second campaign scripts in English and Arabic. You read them aloud once, then record.

## For the drawn roadmap

- **Answers:** three questions, prices, render host.
- **Website:** price list, gate, first deck and video, one live call.
- **Second campaign:** second deck, both videos done.
- **Close the loop:** tagged cash, your card.
- **Next offers:** each one when it has an owner, a fulfilment list and proof.
- **Renewal:** its own deck.


# Decisions (answered above)

## Three questions for you

1. **What counts as a win.** Default: a shown appointment, a quotation or a signed project in the last 30 days, or the CSM's written "They've had a win". The alternative is a signed project only, but only 2 of 19 active clients have ever logged one.
2. **Closer placement.** Is "free replacement inside 90 days" OK next to the no-guarantee rule, if it is worded as a contract clause about the hire, not about results? And who recruits? Default: keep the clause, and build no closer deck until a recruiter is named.
3. **Recording.** One 30-minute session in the week of 2 Nov: the two pilot scripts in both languages, plus the closing clips. Default: you record, and there is never an AI voice or a clone.

## Defaults that stand unless you change them (say the number)

4. List prices start blank, with the doc's price as a one-click hint. While a list price is blank, any CSM price needs your tap.
5. Only you edit the price list. Floors start blank, so every price below list needs your tap. Type a floor to let CSMs go lower alone.
6. SEO and GEO is locked at list, on one line. The split appears only after full price is held.
7. One offer conversation per client in any 30 days. Reviews and referrals do not count. The renewal does.
8. Offers pause from 30 days before the renewal date until its outcome. In that stretch, the website can ride in the renewal as the free care-plan month.
9. Proof on screen is limited to their own captures, "Example, drawn for &lt;Client&gt;", and main-programme testimonials labelled as such.
10. Lines without a source, and lines that promise an outcome, are cut everywhere (the list is under Proof).
11. In SEO and GEO's step 2, "the new Google is ChatGPT" becomes "Google's own AI answer, now in Arabic above the links".
12. The voice skill's line against the Arabic word for cameraman is updated for this one offer, before any Arabic copy is written for it.
13. UGC is the doc's 8 videos, sold as a new format to test.
14. Second campaign is the doc's monthly fee on top of the program. The Hot list's "no new retainer" line goes.
15. "Never before the first win" retires the August onboarding-call pitch.
16. Videos are hosted on Wistia. The client gets no deck link after the call; the WhatsApp message carries the video.
17. "Upsell - Cameraman Day" is added to your Hot list sheet's dropdown once Cameraman day is built. It is your sheet, so it waits for your OK then.


# Proposals (price rule overridden above)

## Proposals

**What the CEO asked for (26 Oct):** a place to make a proposal for each upsell, with its demo video attached, the same way the sales cockpit makes proposals. It has to be quick to edit and look good, and the client's logo is optional.

**How "same way in the sales cockpit proposal" was read:** as "built like the sales proposal", not "built inside the sales cockpit". Active clients (tagged `client` in HighLevel) are excluded from every sales process there (`sales-api/clients.ts` `isClient`), so the proposal builder lives in the CSM cockpit. If you meant inside the sales cockpit, say so.

### Where it lives
- On the client page in the CSM cockpit, next to **Present** for the upsell deck. The button is **Make a proposal**. The upsell deck's last slide has the same button, and it opens on the upsell that was just presented.
- Each proposal covers one upsell. The Upsells doc forbids stacking two in one conversation.
- A CSM can only open proposals for their own clients. The gate is `cockpit_csm_client_gate(task_id)`, the same one the decks use.
- Two warnings appear. Neither one blocks, and getting past either one is recorded in the audit log:
  - **Before the first win:** shows when the client has no launch date, launched under 30 days ago, or has an open churn risk. The CSM can tick "They've had a win".
  - **One a month:** shows when any proposal was already sent to this client in the last 30 days, for any upsell.

### What the client sees
One page, built for phones first:
1. Mahara's logo, plus the client's logo if the CSM turns it on.
2. "A proposal for {client name}", with the CSM's name, the date and **Valid until** (30 days by default).
3. The demo video. It is the first thing on the page.
4. **What we found:** up to three screenshots, such as their Google result, ChatGPT's answer, a quiet Instagram or a missing site. Optional.
5. **Why this, for you:** two or three sentences about what we do and why it matters to them. No outcomes.
6. **What you get:** in plain words.
7. **Work we've done:** examples from the doc (joeandsera.com, greystonegcc.framer.website, euphoriainteriors.ae).
8. **How it runs:** steps counted from payment and from receiving their content, for example "within two weeks of payment and your content". No calendar dates. Closer placement never gets a hire date.
9. **Investment:** one price per part, for example the website build plus the monthly care plan. There is never a list price or a struck-out price. This is the only section where a money figure may appear.
10. One button, **Yes, let's start**. It opens WhatsApp to a number kept in one setting, with "Yes, let's start the {upsell}" already typed in the proposal's language.
11. A print layout, so the browser's Save as PDF works. The link is printed as text.

These never appear on the page:
- any performance number: leads, CPL, appointments, show or close rate, ROAS, ad spend or budget;
- any outcome or guarantee wording, in English or Arabic;
- the UGC script's "thirty percent better" line;
- internal words: front end ads, VSL, or GEO and "care plan" without saying what they mean;
- the second campaign's "ad spend up to 3,000" line.

For SMM, reels stay "a bonus when you send footage, never a promise".

### Starting prices (from the Upsells doc)
| Upsell | List price | Terms | How it runs |
|---|---|---|---|
| Website | $2,000 build + $200 a month care plan (hosting, backups, one hour of edits a month) | Build paid in full. The care plan is always attached and starts the month the site goes live. | Within two weeks of payment and content |
| SEO and GEO | $5,000 for 90 days | Paid in full. The price is locked. | 90 days from payment |
| SMM | $1,000 a month | Monthly | 20+ posts a month, 5 to 6 graphics a week, weekly stories, a monthly call and report |
| UGC package | $3,500 one time | Paid in full | Eight videos. The doc gives no timeline. |
| Closer placement | $4,000 + $750 a month | Three-month minimum. Free replacement inside 90 days. | The first month is ramp-up. No hire date. |
| Cameraman day | $800 a day | Paid in full | One day on site |
| Second campaign | $500 a month on top of the program | Monthly | The doc gives no timeline. |

The renewal ($12,000 for six months, floor $10,000) becomes an eighth row later.

### Prices kept in one place
- The CEO sets each list price and a floor on one **Price list** screen. CSM seats can read it but not change it. The upsell decks read the same rows, so no price is fixed in any design.
- On a proposal:
  - The first proposal for a client and an upsell goes out at list price ("Always pitch full price first").
  - Going below list needs an earlier sent proposal at list price for that client and upsell, plus a one-line reason.
  - Going below the floor needs the CEO seat.
  - The SEO and GEO price is locked ("the price never changes"). Only the CEO seat can change it.
  - SEO and GEO has an **Allow two payments** switch ($2,500 + $2,500). It is off by default, audited, and turned on only after the full price was held once.
- Each proposal keeps the price it offered and the list price at that time. A later change to the list never alters a proposal already sent.

### Making one
The fields are on the left. On the right is a live preview: the real offer page in preview mode, at phone width with a desktop switch. It redraws as the CSM types, and every field saves itself. Drafts always save.

1. **Upsell and language** (English or Kuwaiti Arabic). Picking the upsell fills in everything below.
2. **Client logo, on or off.** **Find their logo** fetches candidates and the CSM picks one. If none fits, the CSM uploads one. If there is none at all, the monogram shows.
3. **What we found:** up to three screenshots.
4. **Why this, for you.** The picker shows only the two or three triggers that fit this upsell. Picking one fills in two sentences, which the CSM can edit, up to 400 characters.
5. **What you get:** the upsell's lines, each of which can be hidden or reworded. For SMM, platforms are tick boxes, with Instagram always on.
6. **How it runs** and **Valid until.**
7. **Price**, under the rules above.
8. **Video.** The upsell's demo video by default. The CSM can paste a Loom, YouTube, Wistia, Vimeo or Drive link instead. On save, the link is opened as an anonymous visitor. A private video is refused with "This video is private. Set it to anyone with the link."
9. **Button words.**

**The copy check.** Problems show inline while the CSM types. Only **Send** is refused, and the reply names the line and says why.
- It checks only text the CSM edited. Catalog text the CEO approved is not checked again.
- It catches:
  - guarantee and outcome wording, ported from `validate.py` (PROMISE, FREE_WORK, RESULT_GUARANTEED);
  - outcome phrases in English and Arabic: show rate, close rate, more appointments, page one, rank first, appear in ChatGPT;
  - any performance number;
  - money outside Investment;
  - the whole-word "lead" rule.
- `validate.py`'s MENTION pattern only warns.
- The rules live in one function, `cockpit_client_copy_problems(text)`, which WhatsApp sends also call.
- The doc's "WhatsApp and lead form" becomes "an enquiry form".

Each save carries a revision number, as the CSM decks do. If two people edit at once, the second save is refused instead of overwriting.

**Time to make one:** two minutes once the setup exists, and 5 to 10 minutes until then. Today 10 of 55 clients have a verified logo, no demo video exists, and no Arabic catalog text is approved.

### Sending
- **Send** needs a video. It freezes the version: the content, the revision and the price. Later edits stay a draft until **Update the link**, which is audited, and the card then says "Updated after sending".
- The link is `offer.maharamedia.com/` plus a random code of 10 or more characters.
- **Copy link** always works. **Send on WhatsApp** works only into a linked one-to-one chat with the owner, never a group (14 one-to-one chats are linked against 18 live groups). It also stays off until the offer domain is live, because a vercel.app link looks like phishing.
- Sending on WhatsApp marks the proposal Sent, and copying the link marks it Link copied. Nobody marks it by hand.
- The link works until the proposal is archived or passes Valid until. After that the client sees one of:
  - "This proposal is no longer active. Message your account manager."
  - "This proposal has expired. Message your account manager for a new one."
- Arabic reads right to left in IBM Plex Sans Arabic, and English is in Geist.
- The page sets no cookies until the client presses play, because video players set their own. It runs no analytics script and is hidden from search engines. Link previews show nothing about the client: no name, no price.

### Seeing whether the client looked
- The card shows a line like: Sent · Opened on 2 devices, 5 visits · last Mon 4:10 pm · Pressed play · Pressed Yes. Times show on the viewer's clock.
- It says "Not opened yet" by default. "Opens unknown" shows only when the door has logged errors since Send, or is not deployed.
- The cockpit's **View live page** button carries a signed preview flag, so the CSM's own visits are not counted.

**Statuses:** Draft, Sent (or Link copied), Accepted, Paid, and **Not now**, which records the objection and a next follow-up date, like the Hot List. Opened and Expired are worked out, not stored. A proposal can be archived at any point.

### Accept and pay (second build)
- The button becomes **Accept and pay**. The client types their name, and the system records the time, the device and the revision they saw.
- Closer placement needs a signed contract, not a typed name.
- At Send, the system creates a Whop plan under its own product, with the note `cockpit-upsell:<id>`. The invoice desk has made 0 Whop links in production so far, so this gets tested first.
  - Clients paying in KWD go through the ecom rail.
  - Monthly parts go on the billing sheet.
- Pending payments sends tagged payments to `upsell_cash` on the CSM's pay plan, never to deal money. Castello's website payment had to be taken out by hand (`20261024p`).
- After payment, Website, SMM and Backend open their fulfilment form (`csmLinks.ts`), which is never submitted for the CSM. The other five say: "No form yet. Post it on the client update board in Slack."

### Backend
Everything sits in the Creative Triage Supabase project. Every table has row security on and no browser grants, with the `service_role` grant in the same migration.

**Tables:**
- `cockpit_upsell_catalog`: one row per upsell. It holds the client-facing lines in English and Arabic: what you get, how it runs, terms, button words, trigger sentences and work examples. It also holds the price parts, list price, floor, whether the price is locked, whether a split is allowed, and a default video per language.
- `cockpit_upsell_proposals`: one row per proposal. It holds:
  - the client (ClickUp task ID), the upsell and the language;
  - the fields, the video and its `thumbnail_url`, and the logo choice;
  - the price offered, the list price at the time and the reason;
  - Valid until, the link code, the status and the revision;
  - `sent_content` and `sent_rev`, the "had a win" tick, and who did what and when.
- `cockpit_upsell_proposal_views`: one row per visit, with the kind (open, play or cta), the time, a device ID and a salted hash of the address. Visits stay out of the audit trigger, and raw rows are deleted after 90 days.

**Who can do what:**
- Every create, save, send, archive and read is a `SECURITY DEFINER` function that calls `cockpit_csm_client_gate(task_id)`.
- Saving the price list, pricing below the floor and changing the SEO price are CEO only.
- Every write except visits leaves one audit row, written by a trigger.

**Video:**
- Links pass `cockpit_csm_deck_video_parse`, so only the five allowed providers can be stored.
- An Edge Function opens each link as an anonymous visitor: oEmbed for YouTube, Vimeo, Loom and Wistia, and a cookieless thumbnail fetch for Drive. The same call stores the still image, which Loom and Vimeo otherwise lack.
- Vimeo videos limited to certain domains need the offer domain added.

**Logos:**
- **Find their logo** fetches candidates on the server through `tools.ts`, in this order:
  1. the Meta Page picture;
  2. the website's icon, og:image or header logo;
  3. the logo files in the Brand DNA doc;
  4. ClickUp card attachments;
  5. Instagram, last.
- Uploads reuse the decks' upload chain:
  - `cockpit-csm-api` reserves a row and signs an upload that cannot overwrite;
  - the accept function checks Storage's metadata again;
  - the logo is stored as kind `logo` in `cockpit_csm_launch_ads` (private bucket `cockpit-launch-ads`), which the decks already read.
- The server checks the file bytes, refuses SVG and animated images, strips EXIF data and caps files at 2 MB.
- Nothing here writes `cockpit_client_logos`, because the media buyer cockpit reads that table. Marking a logo verified stays a separate CEO step.

**The client's link:**
- One Edge Function, `upsell-door`, serves the link. It imports from `sales-live/door.ts` instead of copying it.
- It returns only the fields the client may see, serves logos and screenshots as short-lived signed URLs, records visits and limits the rate.
- That door's open route has never served real traffic, so it gets tested here first.
- The content security policy allows frames from the five video providers, plus images from the poster hosts and Supabase storage.

**Preview:**
- The cockpit preview is an iframe of the offer page, fed by postMessage from the cockpit's origin, so the preview and the client's page cannot drift apart.
- `FRAME_SANDBOX`, `FRAME_ALLOW` and `posterFor` are ported. `VideoPlayer` is tied to the decks' `content.ts`, so it cannot be imported as is.

Nothing runs on the VPS.

### English and Kuwaiti Arabic
- The client-facing lines are written fresh in plain words, separate from the doc's internal shorthand.
- The Arabic is written under `aziz-kuwaiti-voice`. Numbers follow `present/figure.ts`.
- The CEO approves all new Arabic in one batch before any client sees it. Edits a CSM makes are their own words and go through the copy check.

### Design
- It follows Mahara's brand guidelines, the same as the call link page: navy `#091333`, teal `#00CFC8`, Geist and IBM Plex Sans Arabic.
- A design plan comes first, under the frontend-design skill. Before shipping, phone and desktop screenshots go through Hallmark's slop test.
- **Signature element:** the video at the top, framed by the client's name, with "What we found" right under it. No stock photos and no icons in circles.
- The cockpit editor uses the CEO kit and `--mahara-teal`.

### Why this does not build on the sales proposal
| Sales proposal today | Upsell proposal |
|---|---|
| An AI drafter that needs a Fathom recording of the demo. 5 of the 15 October drafts failed there. | No AI. The price list and the CSM write it. |
| An A4 template built only for the core program | Its own one-page layout |
| In-document edits are lost | Every field saves |
| A rebuild takes 1 to 10 minutes on the VPS | The preview redraws as you type |
| No link. The closer sends the PDF by hand. | A short link, plus a print layout |
| The video slot is an unused QR code | The video plays on the page |
| No price list | One price list, with gated changes per client |
| "Mark sent" by hand, and no opens tracked | Sent, opened, played and pressed Yes are recorded |

It reuses the sales cockpit's card pattern (`ProposalsPage`, `ProposalChip`), its gated actions with audit rows, its copy rules (`offer.json`, `validate.py`) and the call link's door. Fixing the sales proposal is a separate job.

### Scope of the first build
The expected volume is 5 to 15 proposals a month, with one active CSM. The first build ships the print layout with the link as text. The QR code and a built A4 PDF come later.

### Defaults chosen, for the CEO to overrule
1. **Home:** the CSM cockpit, for the reason given at the top.
2. **Domain:** `offer.maharamedia.com` needs a DNS record (CNAME) from you. It can go in the same request as the call link's record, which is still waiting. Until then, Copy link works on the Vercel address and WhatsApp send stays off.
3. **Prices:** below list only after a proposal at list price, below the floor CEO only, and SEO and GEO locked.
4. **Contracts:** Closer placement needs a signed contract before payment. You decide for the others. No HighLevel contract template exists for any upsell.
5. **Missing from the doc:** timelines for UGC and the second campaign. The CSM writes that line until the creative director gives one.
6. **Fulfilment forms:** SEO and GEO, UGC, Closer placement, Cameraman day and Second campaign have none yet.
7. **Setup before it is quick:** a demo video per upsell (being planned), your approval of the Arabic catalog text, and logos for the 45 clients without a verified one.
