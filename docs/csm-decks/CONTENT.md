# CSM decks: English content

The onboarding deck and the launch deck the client success manager presents from a client's page in the client success cockpit. This file holds the final English copy, the data each slot pulls, the presenter notes and the source behind every claim. The Arabic copy is in `CONTENT-AR.md`, written under `mahara-context/skills/aziz-kuwaiti-voice` in the warm-professional client register and Saudi-safe. The example call is in `EXAMPLE-CALL.md`.

Written 2026-10-19 from the scout reports (`deck-scouts.md`), the old template decks, the sales deck (`apps/sales-cockpit/src/deck/content.ts`, `proof.ts`, `tour.ts`), mahara-context and the memory notes. The lead's decisions are followed as given. Revised the same day after the critique: see [Revision notes](#revision-notes) at the end.

## How to read this

- `{slot}` is filled from data. Each slot is defined once in the [data map](#data-map), with its fallback. A slide lists only the slots it uses, plus anything specific to that slide.
- **On screen** is exactly what shows on the canvas. Everything on the canvas is visible on the Zoom share. **Notes** live only in the notes window.
- **Each fact has one home across both decks.** The [decision table](#decision-table-binding-for-both-files) names it. `DESIGN.md` follows that table wherever the two files once disagreed.
- **Temp check** marks the question the CSM asks to check the client is still with them. The launch framework asks for one every 3 to 4 slides.
- **Sources** gives the fact source for every claim on the slide. The codes are in the [source key](#source-key) at the end.

## Copy rules (pin these in the deck's copy test)

1. **No speed promise, written or drawn.** Never "5 minutes", "within minutes" (for our calls), "instantly", "same day" (for our calls or our fixes), "just now" or a "Calling" chip on a new enquiry, or the 21× and 100× statistics. The calling line is fixed: "We call during working hours, 10 to 6, Saturday to Thursday. New enquiries go to the top of the list. Anything that comes in at night is called from 10 the next working morning." Then "Up to 4 tries over 3 working days."
2. **No results promise.** No ROI, no multiples, no "fill your calendar", no project or appointment counts, no guarantee of any kind. The 7-day satisfaction guarantee never appears.
3. **No leads, no cost per lead, no budgets in money.** On screen and in the notes, the person who responds is "a customer" or "an enquiry", never "a lead". The only money on screen is what the client wrote themselves (their goals) and the fictional customer's budget band in the example call. One accepted exception: the reused Mahara OS screens carry the portal's own headings ("Calls with your leads", "Did the lead attend?"). That is product UI; crop below the heading wherever the crop keeps the screen readable.
4. **No "every" and no "always" for process steps.** Say what we do. The reminder sequence is "what we do before the meeting". "Every" is allowed only for the client's own job ("mark every meeting").
5. **Rhythm:** check-ins are every two weeks after the first one. Never "weekly". Never "seven days a week".
6. **Who follows up:** a no-show is ours to rebook. Someone who came and is deciding is the client's to follow up and mark.
7. **Words:** "Meta" for the company and the platform. "Facebook" only inside "Facebook Page" and "Facebook feed". "Appointments" or "meetings", never "site visits". "Customer" for the client's buyer. Never "contractor", "agency", "B2B", "patient", "deposit", "Slack" or "pod".
8. **Names:** the presenting CSM's first name on the two covers only. Everyone else is a role: the creative director, the media buyer, the systems team, your caller. The caller in the example call is never named.
9. **Form:** sentence case. No exclamation marks. No em dashes. Plain quotes.
10. **Free-text answers from the forms** are cleaned before they show: phone numbers and emails are removed, prices are removed from service chips, and any line that mentions lead counts, appointment counts, a guarantee or a refund is held back until the CSM edits it in prep.
11. **No other client's material, ever.** No screenshot or recording that shows another client's name, brand, ads, customers, messages or staff. These sales-deck assets are banned in both decks, and the copy test fails on their names: `jr-form-1`, `jr-form-2`, `jr-form-3`, `jr-thanks-phone`, `jr-landing*`, `jr-confirm`, `jr-booked`, `jr-slack`, every `cc-*`, `ads-account`, `ads-twenty-on`, `ads-twenty-off`. Anything the customer sees or receives is drawn in deck tokens from this client's data, or drawn as a labelled example.

## Decision table (binding for both files)

Where `CONTENT.md` and `DESIGN.md` gave the same fact different homes, this table rules. `DESIGN.md` section 8.0 points here.

| Fact or piece | Its one home | Elsewhere, only as |
|---|---|---|
| Calling hours, the list, the tries, "not every enquiry books" | L2 stop 3, with the queue card | L6 plays a call; the mini rail lights stop 3 |
| The WhatsApp confirmation and the reminders | L6 stop 7, after the call | L2 stop 4: one line and five dots, each named in a word or two from L6's timeline (four done with you; the provisional bookings' dot carries its whole line) |
| It lands with the client: calendar, Mahara OS, the WhatsApp alert | L2 stop 5 | L6 stop 8 shows what it carries (the caller's notes) |
| A no-show is ours, deciding is theirs | L2 stop 6, the fork, drawn | L7 stop 4 keeps only "mark it, the same day" |
| The thank-you screen | L5 stop 3 | L2 stop 2 names it in its line |
| What their ads look like, and the swap | L3 | L2 stop 1: one picture. L4 stop 1 reuses the feed phone, small |
| Ads are a test; the numbers decide | L4: one line, plus the optional proof stop | O7 plants it with the red lines; L8 row 1 is the action only; L9 is a bar labelled "Finding what works" |
| Red lines | Asked on O7, shown on L4 | |
| Marking outcomes | L7 stop 4, the slide's last stop | L2 stop 7: one picture. L8: one tile |
| Check-in rhythm | L9 | O3 and L10 carry no cadence |
| Group hours | O3, at the foot | L10 card only when the onboarding deck was never presented |
| The Brand Blueprint, described | O7, the next-step band | O5 stop 4: the name and the booked date |
| Content before the Blueprint | O6 row 3 | |
| The Academy | O6 row 5 | |
| "Your one point of contact" | O3 | |
| A laptop, somewhere quiet | L9 notes (check-ins) | |
| An unknown access status | "Not checked yet" | |
| The caller | Unnamed: "the appointments team at {Company}" | |
| The call clock | 0:00 to 4:51, this file's times | |
| Call stage 4 | "What sets you apart" | |
| Agreement on L4 | Recorded from the notes window or the A key; a quiet stamp appears after. No button on the canvas | |
| Upload on the call | A click-swap from the tray prep filled; "add a file" lives in the notes window | |

## Data map

| Slot | Source | Fallback |
|---|---|---|
| `{client.name}` | Client row name (`fetchClientProfile`, CSM client list) | Onboarding form "Business Name". One of the two always exists. |
| `{client.logo}` | `cockpit_client_logos` by `clickup_task_id`, read through the new `cockpit_csm_deck_sources` (10 of 55 clients today) | A logo uploaded in prep (`cockpit_csm_launch_ads`, kind `logo`), then a monogram (DESIGN 7.7). Inside an ad mockup the avatar is the Page's own profile picture from Meta when Leadsie access allows it (DESIGN 7.1). |
| `{client.country}` | `ghl_clients.country` (SA 21, KW 9, QA 3, AE 3, BH 1, 30 blank) | The service areas answer in the onboarding form, then the CSM's choice in prep. |
| `{client.mode}` | `serviceModel(client.service)` in `csmTemplates.ts`: DFY or DWY | Unknown (8 clients today): the DFY copy, with a prep warning "Service mode not set on the card". |
| `{csm.first}` | The signed-in CSM seat's first name | The name line is dropped, and the role line "Your client success manager" stays. |
| `{onboarding.date}` | `kit.onboarding_call_on` (`cockpit_csm_onboarding_read`) | Today's date. |
| `{go_live}` | `prep.go_live`, then `kit.launch_on`, then the client row `launchDate` (ClickUp Launch Date) | No date is shown. Never an estimate. |
| `{next.blueprint}`, `{next.launch}`, `{next.checkin}` | Client row `nextCallAt` with `nextCallKind` (blueprint, launch, checkin), or the booked event on that calendar | Nothing on the canvas until it is booked. The Book button is in the notes window (`BookCallButton`, kinds blueprint and checkin); the date line appears once the booking reads back. |
| `{form.*}` | Onboarding form KFRCXPFx (`forms.onboarding.answers`), read with the `GOALS` patterns and `formAnswer()` in `clientBrief.ts`: `goal90` ("90 Days"), `goal12_24` ("12-24 months"), `challenges` ("TOP 3 challenges"), `why` ("motivated you to join"), `number_one` ("#1 service"), `ideal_project`, `services` (services and prices), `consult_types`, `engineers`, `free_consult`, `instagram`, `areas`, `hours` | Each slide gives its own fallback. |
| `{kickoff.*}` | Kickoff form tG7dnxBn (`forms.kickoff`), read with the `KICKOFF` and `SETUP` patterns in `clientBrief.ts`: `advertised` service, `platforms`, `page_name` ("name of the Facebook page"), `templated` status (Approved, Declined, Waiting On Client, Wants To See Them First), the setup items (card, Facebook access, Mahara OS access, WhatsApp synced, Google Calendar) judged by `SETUP_DONE`, and `pre_existing` leads | The kickoff form is filled on the onboarding call, so before it is filed every setup item reads "Not checked yet". Missing is never shown as done or as to do. |
| `{prep.*}` | New `cockpit_csm_deck_prep` (task_id, deck) `overrides`: `service_focus`, `starter_pack` (the service has a ready starter pack), `goals`, `page_name`, `go_live`, `cover_creative` (a creative marked custom), `dialect`, `project`, `selling_point`, `pain` (delays, design or cost), `budget_band`, `welcome_video`, `booking_video`, `access` (live ticks), `red_lines` (typed on O7), `their_pick` (marked on L3), `form_confirmed` (the Meta form id the CSM ticked as theirs), `call_guide_checked`, `platforms_planned`, `dwy_os_approved`, `creative_agreed_at`, `onboarding_presented_at`, `hidden_slides` | Each slot falls back to the source in its row. |
| `{ads.*}` | New `cockpit_csm_launch_ads` (uploads, with placement, primary text, headline, CTA, language, kind starter or custom), plus `cockpit_csm_client_ads` (built Meta ads, paused ones included) with stills from `cockpit-ad-stills` | Empty phone frames with the logo and Page name, and "We're finishing your first ads". |
| `{funnel.*}` | `cockpit_creative_sources` (table_name `funnels`) through `cockpit_csm_deck_sources`, matched by the exact Meta form id (or ad account id) from this client's own campaigns, never by account name: `kind` (Instant form, WhatsApp, website), `headline`, `questions[{label, options, isGate}]`, `followUpUrl`, the thank-you text | Shown only after the CSM ticks "This is their form" in prep (`prep.form_confirmed`). Then questions typed in prep. Then the drawn example form (DESIGN 7.5), tagged "Example form". Never a real client's screen. |
| `{dosDonts}` | The ClickUp card field "Do's & Don'ts", read through `fetchClientProfile` and `parseDosDonts` (DO and DON'T items only; NOTES never show) | `prep.red_lines` from O7. Else "No red lines written yet. Tell us now and we'll add them to your card." |
| `{links.drive}`, `{links.portal}` | `kit.links` | Drive: "Your folder link is pinned in your WhatsApp group." Portal: portal.maharamedia.com. |
| `{band}`, `{band.answer}`, `{band.note}` | The fictional customer's budget band in the example call: `prep.budget_band`, else the table in `EXAMPLE-CALL.md` by `client.country` (riyals, dinars, dirhams) and the service family's scale | No currency word, the script's own figures. |
| Static links | Leadsie app.leadsie.com/connect/maharamedia/manage (OCF), Academy skool.com/premium-projects-academy-3669 (SD `LINKS.academy`), portal install portal.maharamedia.com/install (SD `LINKS.portalInstall`) | |
| Reused pictures | Only these, copied from the sales deck assets: `portal-overview`, `portal-calls`, `portal-outcome` (EN and AR, Demo workspace), and the phone film `mahara-mobile-{lang}.mp4`. (The `meeting-table` render is no longer used: a generic render read as AI on the client's screen, so journey stop 6 draws the meeting's two outcomes instead, 2026-10-20.) | |
| Drawn pieces | In deck tokens, each tagged (DESIGN 5.4): the WhatsApp group (O3), the queue card (L2 stop 3), the calendar entry (L2 stop 5), the example form and the default thank-you (L2, L5), the WhatsApp confirmation and the reminder timeline (L6 stop 7), the appointment with the caller's notes (L6 stop 8), the test tiles (L4 proof) | |

**Service family**, used by the example call's `{project}` and the budget scale: matched by keywords in `{service}` against the sales deck's `SERVICES` keys. The prep field `project` overrides it.

| Family | `{project}` | Budget scale |
|---|---|---|
| interior design | the interior of your new villa | works |
| construction | building your villa | build |
| fit-out and renovation | renovating your ground floor | works |
| architecture | the design of your new villa | works |
| engineering consultancy | the drawings and permits for your villa | works |
| landscaping | your garden and outdoor area | works |
| kitchens | your new kitchen | works |
| anything else | your project | works |

**Calling hours in the client's own time.** Kuwait, Saudi Arabia, Qatar and Bahrain share the call centre's clock, so the line stays as written. For the UAE (and Oman), add the zone wherever hours show (O3, L2 stop 3, L10): "10 to 6 Saudi time (11 to 7 in the UAE)".

---

# Onboarding deck

Seven slides, about 10 minutes of a 45 to 60 minute call. The setup is done live while slide 6 is up. Payment, the contract and the kickoff form stay in the talk track, and the kickoff form stays in the CSM's own tab.

## O1 · `welcome`

**Title:** Welcome, {client.name}
**Time:** 1 minute

**On screen**
- {client.logo}, over the faint journey lanes (DESIGN 9.1)
- Eyebrow: "Onboarding call · {onboarding.date}"
- Title: "Welcome, {client.name}"
- Agenda, numbered because it is the order of the call: "Before we hang up, we'll:"
  1. Choose your launch service
  2. Set up your access
  3. Book your Brand Blueprint call
- Footer: "{csm.first} · Your client success manager"

**Slots:** `client.logo`, `client.name`, `onboarding.date`, `csm.first`.

**Notes**
- Thank them for their time. Introduce yourself by name. Everyone else on the team is introduced by role on slide 3.
- Frame the call: "About 45 minutes. A few slides first, then we set most things up together, live."
- Check who is on the call. If the owner isn't there, ask who decides on the ads and who meets the customers.
- Say the call is recorded for the team.
- Keep the kickoff form open in your own tab. Share only the deck window.

**DWY:** same.

**Sources:** OCF (rapport and agenda first, 60 minutes, recording link in the kickoff form), RN (roles, not names).

## O2 · `goals`

**Title:** Your goals, as you wrote them
**Time:** 2 minutes

**On screen**
- Eyebrow: "From your onboarding form"
- Title: "Your goals, as you wrote them"
- Four cards:
  - "In 90 days" · {form.goal90}
  - "In 12 to 24 months" · {form.goal12_24}
  - "What's in the way" · {form.challenges}, up to three lines
  - "Why you joined" · {form.why}
- Footnote: "We'll track them with you. They're targets, not a promise of results."

**Slots**
- `form.goal90`, `form.goal12_24`, `form.challenges`, `form.why`, with `prep.goals` overriding any of them.
- Each card holds at most about 120 characters. Money stays in the client's own currency, exactly as they wrote it. Copy rule 10 applies.
- Fallback: a card with no answer is hidden. If all four are missing, the slide shows only the question "What would make the next 90 days a win for you?" as its one heading (no title over it; the composition pass of 2026-10-20 dropped "Your goals, in your words", which competed with the question), and the CSM types the answer live; it saves to prep and goes into the kickoff form.

**Notes**
- Read their goals back. Don't re-ask anything they already answered.
- If a goal is a number, don't endorse it and don't argue with it. "We'll set targets together once the first meetings come in."
- Don't put a number on what's realistic (projects a month). It depends on the offer, the area and how they follow up.
- Remember the top challenge. It comes back when you choose the service on slide 4.
- **Temp check:** "Did we get that right? Anything to change?"

**DWY:** same.

**Sources:** OF (questions), `clientBrief.ts` `GOALS` (fields), GR (no results promise), O2L Day 12 (targets are set after launch).

## O3 · `team`

**Title:** Your team, in your WhatsApp group
**Time:** 1.5 minutes

**On screen**
- Title: "Your team, in your WhatsApp group"
- Line: "The people who run your ads and funnel, our call centre and your success manager are all in this one group."
- Drawn as the group they are about to join (DESIGN 9.3): a header with {client.logo} and "Your WhatsApp group", then one row per role, each with what that person messages them about:
  1. "Your client success manager" · "Your one point of contact, for anything."
  2. "The creative director" · "Your brand, your scripts and your ads."
  3. "The media buyer" · "Your campaigns."
  4. "The systems team" · "Mahara OS and your calendar."
  5. "Your caller" · "Questions from the calls: your hours, a holiday, a service detail."
- Foot: "We reply 10 to 6, Saturday to Thursday. If something worries you, we call you." (UAE zone per the data map.)

**Slots:** `client.logo`, `client.country` (the UAE suffix), `client.mode` (DWY variant only).

**Notes**
- One sentence per role. Each person messages them about one thing; anything else goes to you.
- Roles, not names. Your own name is on the cover.
- Friday is off. Messages after 6 are answered the next working day.

**DWY:** the line becomes "The people who run your ads and funnel and your success manager are all in this one group." (their own team calls, so no call centre of ours is in it), and row 5 becomes "New-enquiry alerts" · "New enquiries arrive here too, for your callers."

**Sources:** CTX §3 and OCF (the pillars: ads and funnel, appointment conversion, 1-1 support), LCF and PS §9 (one group with the team, hours 10 to 6, Friday off, concerns get a call), PS §8 (the questions the call centre asks), DEC 2026-10-17 (DWY enquiries also go to the client's group), RN.

## O4 · `one-service`

**Title:** One service per campaign
**Time:** 2 minutes

**On screen**
- Title: "One service per campaign"
- Line: "We launch with one service, so the ads, the form questions and the calls are all written for one kind of customer."
- Service chips: {form.services}, with {form.number_one} tagged "Your #1" while the "Your first campaign" card names another service (when the card names their #1, the tag is left out: one service is not said three times)
- Three tests, ticked per chip:
  - Easiest to sell
  - Most profit
  - Least painful to deliver
- Result line: "We'll launch with {prep.service_focus}"
- Small line: "Once it works, we can add the next one."

**Slots**
- `form.services`: the services answer, split into names, prices removed. Fallback: `kickoff.advertised` as a single chip. Else the CSM types chips live.
- `form.number_one`. Fallback: no "Your #1" tag.
- `prep.service_focus` is the CSM's pick, saved to `cockpit_csm_deck_prep` and read by O7, the launch deck and the example call. Default: `kickoff.advertised`, then `form.number_one`.
- The CSM ticks the tests on the canvas as the client answers; "Launch with this" saves.

**Notes**
- Ask the three questions out loud for their top two or three services.
- Steer toward the service that passes all three. If none does, take the easiest to sell.
- Why one: the ads, the form questions and the call script are all written for one buyer.
- The choice carries through: it's the service in the launch deck and in the example call.
- **Temp check:** "Happy to start with {prep.service_focus}?"

**DWY:** same.

**Sources:** OCF (one service per campaign, the three qualifiers), PEA (front-end offer criteria: low cost to deliver, fast to start).

## O5 · `road`

**Title:** The road to your first appointments
**Time:** 1 minute

**On screen**
- Title: "The road to your first appointments"
- Six stops on one road, paved up to today, with today lit:
  1. Contract signed
  2. Onboarding form
  3. Onboarding call · "Today"
  4. Brand and offer · {next.blueprint}
  5. Launch call · {next.launch}, else "20 to 30 minutes" · then "We walk you through everything that's going live."
  6. First appointments · "After go-live"
- Footer: "Each call is booked at the end of the one before."

**Slots**
- The lit stop comes from the client's stage: on the onboarding call it is always stop 3. If the deck is opened later, Brand Blueprint Booked lights stop 4, and LAUNCH BOOKED or Ready For Launch lights stop 5.
- `next.blueprint`, `next.launch`: a date shows only when the call is booked. Fallback: no date (the launch call says how long it takes instead). Never an estimate. A step already passed with no date on file reads "Done".

**Notes**
- Stop 4 is the Brand Blueprint call. Name it here; slide 7 says what it is.
- Don't give a launch date unless it's booked. It depends on access, content and approvals.
- As each step finishes, we send the next one to their WhatsApp group.

**DWY:** same on screen. Notes: "Steps 2 to 5 arrive in the group; the first appointments step is yours to run."

**Arabic pass:** reuse the Onboarding Map's own Arabic stop names exactly: توقيع العقد، نموذج التعريف بالنشاط، مكالمة التعريف، بناء الهوية والعرض، مكالمة الإطلاق، أول المواعيد.

**Sources:** OM (the six stops, the 20 to 30-minute launch call, phases 2 to 5 sent to the group, phase 6 for DFY only, booking-copy rule), PS §3 (measured signup to launch: median 25 days, so no date is promised).

## O6 · `this-week`

**Title:** What we need from you this week
**Time:** 1.5 minutes on screen, then the setup itself, live

**On screen**
- Title: "What we need from you this week"
- Line: "Most of it we'll do together, right now."
- Five rows, each with a status (Done, To do or Not checked yet):
  1. "Meta access" · "Your Page and ad account, shared through one link. And a card on the ad account: your ad spend goes to Meta directly." · ticks: Access · Card
  2. "Mahara OS" · "Sign in, then connect WhatsApp and Google Calendar, so bookings land in your real calendar." · ticks: Signed in · WhatsApp · Calendar
  3. "Your content" · "Before your Blueprint call: photos and videos in your Drive folder. Finished projects, work in progress, your team on site. Don't filter. We will." · link to {links.drive}
  4. "Past enquiries" · "Have a list of old enquiries? Send it, and we'll agree whether to call them."
  5. "The Academy" · "Courses for you and your team: your offer, closing your projects, your team and operations. Join, and start with the onboarding course."

**Slots**
- Statuses: `kickoff` setup items (card, Facebook access, Mahara OS access, WhatsApp synced, Google Calendar), `kickoff.pre_existing`, and the Academy line, each judged by `SETUP_DONE`.
- The CSM flips a status on the canvas as each step finishes; it writes `prep.access` with an audit row. The kickoff form stays the record.
- Before the kickoff is filed, every row reads "Not checked yet". Content reads "Not checked yet" until the CSM ticks it.
- Links: Leadsie, `links.portal`, `links.drive` and the Academy, copied from the notes window into the group, in the deck's language: "Meta access (one link): {url}" · "Your Drive folder: {url}" · "The Academy: {url}" · "Mahara OS: {url}" · "Install Mahara OS on your phone: {url}".

**Notes**
- Do rows 1 and 2 now, on this call, and tick each one as it finishes. Most clients leave the onboarding call with these still open, and that is what delays a launch.
- Content: say it once, here. The more they upload before the Blueprint, the better the first ads.
- Past enquiries: no promise. Agree on the Blueprint call or in the group whether we call them.
- Anything left open: agree who does it and by when, and write it in the kickoff form.
- Don't link this list to the contract or to any guarantee.

**DWY**
- Row 2 becomes "Your CRM" · "Sign in, and connect your calendar, so bookings land in your real calendar." · ticks: Signed in · Calendar. It shows the Mahara OS row instead only when `prep.dwy_os_approved` is set.
- Add row 6: "Your callers' phones" · "Install the LeadConnector app, sign in and turn on alerts."

**Sources:** OCF (Leadsie, WhatsApp connection, Mahara OS sign-in, Google Calendar, content to Drive, reactivation of old leads, Academy), KF and `clientBrief.ts` `SETUP` (the status fields), PS §3 and §8 (Meta access not done for any of 5 kickoffs, card not funded for 3 of 4, calendar not connected for 4 of 5), O2L Day 4 (the content wording), CTX §3 (ad spend is paid straight to Meta), SD `CLOSING_TOUR` academy (the six courses), OM phase 5 (the client watches the course; Mahara does not train their team), MOS (the DWY flow in Mahara OS sits behind per-client approval), DWY SOP §2 (lead alerts), GR (the guarantee terms are never framed here).

## O7 · `next`

**Title:** What to expect, and what's next
**Time:** 1.5 minutes

**On screen (stop 1)**
- Title: "What to expect, and what's next"
- One row of two statements (DESIGN 9.7):
  1. "Your first ads"
     - Templates Approved: "Starter ads go live first, from our ready templates for {prep.service_focus}. Your own ads, made from your content, follow."
     - Waiting On Client, Wants To See Them First, or no answer: "Starter ads can go live first, from our ready templates for {prep.service_focus}. Your own ads, made from your content, follow." ("can", not "go": no answer is not approval. The condition itself is the line under all three, so it is not said twice.)
     - Declined: "Your own ads, made from your content, go live first."
     - Under all three: "Your first ads go live only once you've approved them."
     - Without `prep.starter_pack`, "for {prep.service_focus}" is left out of the first two variants: "Starter ads go live first, from our ready templates."
  2. "The first weeks are a test" · "Your red lines stay fixed. Tell us now what we must never say or show. Everything else, we test." Below it, the red lines the CSM types live as the client says them (two or three), in amber.
- Next step band: "Next: your Brand Blueprint call · 45 minutes with our creative director: your brand, your offer, your first ad scripts." Then {next.blueprint} once booked.

**On screen (stop 2, optional):** "Your starter ads", tagged once "Starter, from our templates", then "Our ready templates for {prep.service_focus}, under your Page name and logo." (no pack: "Our ready templates, under your Page name and logo."). The L3 phone component (Instagram feed and Reels) with the starter ads under their Page name and logo. Shown only when `prep.starter_pack` is set and starter creatives exist for {prep.service_focus}. No upload or swap here; that is L3.

**Slots:** `kickoff.templated` picks the variant. `prep.service_focus`, `prep.starter_pack`. `prep.red_lines` (typed live; the prep view reminds the CSM to copy them to the card's Do's & Don'ts). `next.blueprint` (Book button in the notes window). `ads.*` kind starter (stop 2).

**Notes**
- Most clients want to see the starter ads first (3 of 4 recent kickoffs). If they do, go to stop 2.
- Approval names the ads, the offer and the Page they run under. No answer is not approval.
- Red lines: type them in their words ("never show prices"). They come back on the launch call.
- Book the Blueprint before you hang up.
- **Temp check:** "Anything you're unsure about before we book the Blueprint?"

**DWY:** same.

**Sources:** FCL (templates are ready but not every service has an accurate pack; approval must name the asset, offer and identity; no response is not approval; templates are never shown as the client's own work), KF (templated ads status), PS §3 (3 of 4 kickoffs "Wants To See Them First"), PEA (red lines are fixed, everything else is tested), OM and PS §2 (the 45-minute Blueprint with the creative director produces the Brand DNA, the offer and the first scripts).

---

# Launch deck

Ten slides, about 22 minutes of a 30-minute slot, so there is room for questions. Visual first. The journey slide is the signature.

## L1 · `cover`

**Title:** {client.name} goes live
**Time:** 1 minute

**On screen**
- {client.logo}
- Eyebrow: "Launch call · {today}"
- Title: "{client.name} goes live". When `{go_live}` has already passed (starter ads running), "{client.name} is live".
- Date, large: {go_live}
- Line: "Everything your customers will see, before they see it." When `{go_live}` has passed: "Everything your customers see, and what happens next."
- A thin strip of the O5 road under the date, paved up to "Launch call · Today". A picture, no other words.
- Footer: "{csm.first} · Your client success manager"
- Ground: `prep.cover_creative` (a creative marked custom) at its own size inside a phone on the end half of the slide. Without one, the faint journey lanes (DESIGN 8.1). A starter creative is never used here.

**Slots:** `client.logo`, `client.name`, `go_live` (no date if missing; the title stays), `prep.cover_creative`, `csm.first`.

**Notes**
- Frame it: "About 25 minutes. What goes live, what happens when someone enquires, and what we need from you. Stop me anytime."
- Ask for their full attention for those minutes.
- If starter ads are already running, say so plainly and use the call to show the whole picture.
- Skip the introduction if you ran their onboarding call.

**DWY:** same.

**Sources:** LCF (the four goals of the call, the first-two-minutes frame), OM (20 to 30 minutes), FCL (a launch can come before the launch call; template imagery is never shown as the client's brand).

## L2 · `journey` (signature)

**Title:** Your customer's journey
**Time:** 2.5 minutes

**On screen**
- Title: "Your customer's journey"
- Line: "From your ad to your meeting, step by step."
- One path with seven stops, drawn in three lanes: your customer, our team, you (DESIGN 6). Each stop lights in turn, with this client's own asset beside it.

**Stops**

| # | Row name | Owner | Line | Picture | Slots and fallback |
|---|---|---|---|---|---|
| 1 | Sees your ad | Your customer | "They see your ad in their feed." | Their first ad in an Instagram feed phone, with their Page name and logo | `ads.*` (first ready ad). Fallback: the frame with the logo and "Your ad goes here". |
| 2 | Answers your questions | Your customer | "A few short questions about their project, then your thank-you screen." When the ad opens WhatsApp: "They message you on WhatsApp. The chat opens with their first message ready to send." | Their form's question screen in a phone, or their landing page, or (WhatsApp) the chat with their first message waiting to send, tagged "Example wording" | `funnel.*` once confirmed. Fallback: the drawn example form, tagged "Example form". |
| 3 | We call | Our team | "We call during working hours, 10 to 6, Saturday to Thursday. New enquiries go to the top of the list. Anything that comes in at night is called from 10 the next working morning." Chip: "Up to 4 tries over 3 working days". Small line: "Not every enquiry books. Some can't be reached, some aren't a fit. Our caller notes why, and we go through it with you at check-ins." | The queue card (DESIGN 6.5), tagged Example | UAE zone note from the data map. |
| 4 | Booked, confirmed, reminded | Our team | "The serious ones are booked in, confirmed on WhatsApp and reminded before the meeting." With `prep.booking_video`: "The serious ones are booked in, confirmed on WhatsApp with a short video about you, and reminded before the meeting." | Five dots on a short line, each named in a word or two from L6's timeline (the full timeline is on L6) | `booking_video` defaults to off. |
| 5 | Lands with you | You | "Once it's confirmed, it lands in your calendar and in Mahara OS, and you get a WhatsApp alert." | The drawn calendar entry (DESIGN 6.5), tagged Example | If the kickoff says Google Calendar is not connected, an amber line: "Connect Google Calendar in Mahara OS so bookings land there." |
| 6 | You meet | You | "You hold the meeting: {form.consult_types}." Then the fork: "Didn't show? Ours. We call to rebook." · "Came, and thinking it over? Yours. Follow up, then mark it." | The fork's two cards, each with its mark (the lanes' rebook mark on ours); a dotted line returns to the "Our team" lane, its node named "Didn't show?" (the no-show has one name everywhere: the CRM's stage is "Didn't show") | `form.consult_types` fallback: "at your office, at their home, or online". |
| 7 | You mark it | You | "You mark how it went, in a few taps." | `portal-outcome` thumbnail, cropped to the form, Demo workspace | |

Stops 1, 2, 4 and 7 open up on later slides (L3, L5, L6 and L7), so their lines stay short. Stops 3, 5 and 6 carry their full facts here and nowhere else.

**Notes**
- Walk the stops with the arrow keys. Let each one land before you speak. The mini rail on the next slides makes the callback; don't announce it.
- At stop 3, say the hours plainly and don't promise faster. If they ask why not at night: the team works 10 to 6, Saturday to Thursday, and night enquiries are among the first calls of the next working morning.
- At stop 6, point at the dotted line: the no-show comes back to us.
- **Temp check** after stop 7: "Any step here you'd want done differently?"

**DWY variant (stops that change).** Stops 3 and 4 move into the "You" lane.

| # | Row name | Line |
|---|---|---|
| 3 | Your team calls | "A new-enquiry alert reaches your callers' phones and your WhatsApp group. Call as soon as it arrives. Up to 4 tries over 3 working days." |
| 4 | Your team books | "Book on the right calendar. The confirmation goes out by itself." |
| 5 | Lands with you | "It lands in your calendar and your CRM, with your caller's notes." |
| 6 | You meet | Fork: "Didn't show? The follow-up messages start by themselves." · "Came, and thinking it over? Follow up, then move it to the right stage." The dotted line stays in the "You" lane. |
| 7 | You mark it | "Your team moves it to the right stage in the CRM, the same day." |

**Sources:** CPM (the client-side steps, the WhatsApp alert, the split after the meeting), DOM and CCD (10:00 to 18:00 Saturday to Thursday, Friday off, new enquiries to the top of the queue, the 4-try ladder, a reason noted on every lost enquiry, 45% of enquiries with no verified dial, median first dial 163 working minutes), LAF (Main bookings notify the client; Provisional bookings are internal until confirmed), BR (WhatsApp confirmation on booking), PS §2 and §4 (thank-you video on booking, consultation types), CRF ("results fine but unhappy" when expectations are off), DWY SOP §2 to §5 (alerts, calendars, CRM stages), MOS (the DWY flow in Mahara OS needs per-client approval), DEC 2026-10-17 (DWY enquiries also go to the client's group).

## L3 · `ads`

**Title:** Your ads
**Time:** 3 minutes

**On screen**
- Eyebrow: "Your customer sees this"
- Title: "Your ads", with the tag "Preview"
- Line: "We can show any of your creatives in the phones, right now." With nothing in the tray yet (the tray says "We're finishing your first ads"), it becomes "How your ads will look on your customers' phones.", never a promise of "right now".
- Three phone frames, side by side:
  - Instagram feed
  - Instagram Stories and Reels
  - Facebook feed

  Each frame shows {page name}, the avatar, "Sponsored", the primary text, the creative, the headline and the call to action.
- Tray: "Your creatives", with two tabs: "Uploaded" · "From your Meta ads". The count sits beside what it counts: beside the title when there is one list, beside each tab when there are two.
- Starter ads are named once, in the foot under the phones: "Previews of starter ads, from our templates. Meta fits each ad to the screen it shows on." (in focus, the tag "Starter, from our templates" once). On a tray thumbnail, the short form "Template".
- A tray thumbnail on a phone says which: "Feed" · "Reels" · "Facebook feed".
- The leader on "Sponsored" quotes the word as the phone shows it: "Marked {word}".
- Only with `prep.platforms_planned`: "Planned next: {platforms}".

**Slots**
- `ads.*`: placement comes from the aspect ratio and can be edited in prep. Primary text, headline, CTA and language come from the row or the Meta ad.
- Missing text is left out, never invented (an Instagram caption keeps only the Page name).
- Page name: `prep.page_name`, then `kickoff.page_name`, then `client.name`.
- CTA labels as Meta writes them: Learn more · Get quote · Book now · Contact us · Sign up · Send WhatsApp message · Apply now.
- Frames follow Meta placements. `kickoff.platforms` records what was chosen, not what runs, so other platforms show only when the CSM ticks `platforms_planned`.

**Interaction (DESIGN 10)**
- Click a tray item to put it in the phone that suits its shape, or in the phone in focus.
- Add a file from the notes window: it shows on the phone at once and saves behind it (CSM-gated). A file over 150 MB is shown but not saved.
- A swap keeps the phone's text, button and app language unless the new creative has its own.
- "Remove" (notes window) hides an ad from the deck only. Nothing here changes their Meta account.
- Mark their pick with M or the star in the notes window. It is starred on L4.

**Notes**
- Let them choose: "Which one would stop you scrolling?" Mark it.
- Swap one live, so they see how each creative looks in the feed.
- A wrong fact (a price, a service, an area): write it down; we fix it.
- A preference: that's the next slide.
- This preview isn't approval.

**DWY:** same.

**Arabic pass:** use Meta's own Arabic labels for "Sponsored" and the CTAs.

**Sources:** CEO brief (upload and swap their ads, show what they will look like), FCL (templates labelled, never shown as the client's work; preview is not approval; the identity the ad runs under; Meta review may take longer than a swap), PS §3 (3 of 4 want to see the ads first), scout csm §2 and §E (Meta stills, paused ads, the upload design), PS §1 (almost everything runs on Meta: client_leads Meta 7,250, TikTok 16, Google 1).

## L4 · `creative-freedom`

**Title:** Your red lines are fixed. The rest, we test.
**Time:** 3 minutes

**On screen:** title "Your red lines are fixed. The rest, we test." (no eyebrow since the composition pass of 2026-10-20), then one layout that builds in three stops, concession first (DESIGN 8.4).

**Stops**

| # | Panel | Copy | Picture |
|---|---|---|---|
| 1 | Your page stays yours | Lead: "Ads show in the feed, marked Sponsored, to people who don't know you yet. They don't appear on your page." Foot line: "The polished work belongs in your page's own posts." | The L3 feed phone, with a leader on "Sponsored" |
| 2 | Fixed: your red lines | {dosDonts} as "Always…" and "Never…" lines. When a red line came from O7: "You told us: {red line}." Then: "We never cross these. You approve every fact, price and claim. Anything wrong or off-brand, we fix." | The amber panel. Fallback: "No red lines written yet. Tell us now and we'll add them to your card." |
| 3 | Open: everything else we test | Chips: Angles · Hooks · Formats · Thumbnails · Who's on camera. Their L3 pick, starred: "Your pick runs too, beside the ones you'd skip. The numbers tell us which work." Foot line, across under both columns: "You approve your ads in the group." then the footer. ("An ad waiting for the perfect version earns nothing while it waits." is said, not shown: see Notes.) | The panel, with their starred creative as a thumbnail |
| 4 (optional) | How a test runs | Caption: "One campaign, 20 versions side by side. Some stay on, some go off." | 20 neutral tiles with on/off toggles, 11 lit and 9 dimmed. No thumbnails, no columns, no money. Tagged "Illustration" |

After stop 3:
- Footer, on the foot line after the approval: "Prefer something different later? Ask, and we'll launch it too."
- Once the CSM records the client's yes: a quiet stamp, "Agreed to test this way · {date}". Nothing shows before that.

**Slots:** `dosDonts`, `prep.red_lines`, `prep.their_pick` (without one, the star line reads "The ones you'd pick run too, beside the ones you'd skip."), `prep.creative_agreed_at`, written with an audit row from the notes window ("We agree to test this way") or the A key. The stamp records the conversation; it is not a contract term.

**Notes**
- Concede first: their page, then their red lines, then the ask.
- The close, in your own words: "You came to us for performance. We'd rather protect that than protect a look."
- Ask: "Anything else we must never say or show?" Add it to their card's Do's & Don'ts after the call.
- They ask for changes in the group, and we answer with the reason.
- A content plan for their page is a separate conversation. Don't promise it here.
- If they want to hold an ad back until it's perfect: "An ad waiting for the perfect version earns nothing while it waits." (Said, not on the slide: the open column already carries the chips, their pick and the approval.)
- **Temp check:** "Can we agree to test this way?" Record it only when they say yes.

**DWY:** same.

**Sources:** CEO brief (set the expectation of creative flexibility), PEA (paid ads are dark posts and never reach the grid, which defuses the objection on its own; concede the real cases first; volume is the mechanism; polish belongs in organic content; wrong or off-brand gets fixed, a preference gets launched; the close line), FCL (approval covers the pack, its copy variants and allowed adaptation; Meta review may take longer), SD `ADS_TOUR` account stop (one campaign with 20 ads, 11 running: the shape the tiles illustrate), LCF (trust the process, decide on data not taste), the Do's & Don'ts card field, WC ("what we're testing", never "the bet").

## L5 · `form`

**Title:** Your form
**Time:** 1.5 minutes

**On screen**
- Eyebrow: "Your customer sees this"
- Title: "Your form"
- Line: "What they answer before we call. Questions marked 'Filters' screen out people who aren't a fit." DWY: "What they answer before your team calls. Questions marked 'Filters' screen out people who aren't a fit."
- One phone, screen by screen, walked with the arrow keys.
- Gate questions carry the teal tag "Filters".
- When the destination is a website: the label "Your page" and the page in the phone (a screenshot from prep, or the live page).

**Stops (the phone's screens)**
1. Opening · {funnel.headline}
2. The questions · each {label} with its options, gates tagged
3. The thank-you screen · "Then your thank-you screen, and a welcome message." With `prep.welcome_video`: "Then your thank-you screen, and a welcome message with a short video about you." The screen is their form's thank-you, or the default: "Thank you. Our team will call you during working hours." A video frame shows only when `welcome_video` is on.

**Slots**
- `funnel.*` once `prep.form_confirmed`, with `prep` questions overriding.
- No confirmed form and no prep questions: the slide is hidden by default, and prep says why. If the CSM shows it anyway, the phone draws the example form (DESIGN 7.5), tagged "Example form", with the line "We're finishing yours."
- When `funnel.kind` is WhatsApp, the line becomes: "Your ad opens a WhatsApp chat." Check the destination with the media buyer before the call. The phone shows the chat with the message the ad fills in, waiting to send, tagged "Example wording": "Hi, I saw your ad. I'd like to know more about {service}." (no service: "Hi, I saw your ad and I'd like to know more."). Beside it, "What happens next": 1. "Their first message is ready in the chat. They tap send." 2. "It arrives on your WhatsApp." 3. "Our team calls them during working hours." (DWY: "Your team calls them.")

**Notes**
- Read the filter questions out: "This is the first filter. The call is the second."
- Check the facts with them: service names, areas, wording.
- If they want more questions: every extra question also loses some good people. We add one when the enquiries show we need it.

**DWY:** same.

**Sources:** scout csm (the funnels source and its fields, `FormPreview` and `leadForm.ts`; the account-name match is fuzzy), PEA (friction: add a question only once the enquiries are proven wrong), DESIGN 14 (the default thank-you).

## L6 · `call`

**Title:** How we'll speak to your customers
**Time:** 4 minutes

**On screen**
- Eyebrow: "Our team does this"
- Title: "How we'll speak to your customers", with the tag "Example written from our script"
- Line: "{client.name} · {prep.service_focus}"
- Label, always visible: "The customer in it is made up." (the tag already says where the call came from, so the label does not say it again). The tag shows while the call plays; stops 7 and 8 carry their own tags ("Example wording", "Example") instead, so the screen never has two.
- Stage rail: The opening · Their goal · The details · What sets you apart · The booking · Locking it in. Each stage lights as the call reaches it.
- Call clock, 0:00 to 4:51.
- Two-sided transcript. The Arabic line sits above its English subtitle. In the Arabic deck the subtitle can be switched off.
- Legend: "Words in teal came from your files."
- Stop 7, after the call:
  - The WhatsApp confirmation from {client.name}, labelled "Example wording" (EXAMPLE-CALL.md)
  - A heading, "What we do before the meeting", over the timeline: Booked: a WhatsApp confirmation · The day before: a reminder · A confirmation call · 2 hours before: an SMS · The meeting
- Stop 8, what lands with you: the appointment as it reaches them, tagged Example: "New appointment" · Abu Fahad · {day}, {time} · {place} · {service}, then "Our caller's notes": "Planning it for six months, wants to start soon. Budget: {band.note}. {pain note}" Caption: "Our caller's notes come with it."
- The call card reads "Calling for {client.name}".
- Small line under the transcript, only when a slot is marked "To give us" (one sentence about the chips, never two):
  - With `prep.call_guide_checked`: "Your caller's facts come from your call guide in Mahara OS. Check it, and fill in anything marked 'To give us'."
  - Without it: "Send us anything marked 'To give us' in the group, and we'll add it to your call guide."

**Stops:** one per stage (1 to 6), the confirmation and reminders (7), what lands with you (8). The full script, its slots and the pain variants are in [Appendix A](#appendix-a-the-example-call) and `EXAMPLE-CALL.md`.

**Slots:** see Appendix A. Notes window: a dialect switch (Kuwaiti or Saudi), pause, replay. `prep.call_guide_checked` is ticked in prep once the CSM has seen that the guide page exists and is the one the dialer reads (`knowledge_base_page`).

**Notes**
- "This is the script we use, with your details in it. Our caller speaks as your appointments team."
- Point at the teal words. Ask for anything marked "To give us".
- If they'd rather the caller share a starting price, ask them to add it to the guide. The script doesn't quote prices it doesn't have.
- At stop 7, the reminders: say them once, as what we do before the meeting.
- At stop 8: "Everything the caller learned comes to you, so you walk in knowing the project."
- "You'll hear your own real calls in Mahara OS. I'll show you next."
- Never play a recording of another client's call.
- **Temp check:** "Is that how you'd want your customers spoken to? Anything we should never say?"

**DWY variant**
- Title: "How your team should call"
- Label: "The customer in it is made up. The full script is in the playbook we give you."
- The call card's Arabic reads اتصال باسم {client.name} (نتصل باسم would say we call); the English stays "Calling for {client.name}".
- The stage rail and the transcript stay the same.
- Stop 7: "Book on the right calendar, and the confirmation goes out by itself." Timeline heading "Before the meeting": Booked: a confirmation · Reminders before the meeting · Provisional bookings: your team calls 48 and 24 hours before · The meeting
- Stop 8: the same card in the CRM, its notes headed "Your caller's notes", captioned "It lands in your CRM."
- Links in the notes window: their calling playbook (the DWY SOP copy on their card) and the sample script (`SCRIPTS_DOC`).

**Sources:** CS (sections 01 to 06, and the 07 answers to "how much does it cost?" and "I don't have a budget yet"), FW (prices, experience and guarantees come only from the client's guide; no deposits unless the client's policy says so), PB (the confirmation call: the evening before for morning meetings, the morning of for afternoon ones; 48-hour call for provisional slots), BR (WhatsApp confirmation on booking, a reminder the day before, an SMS 2 hours before; the confirmation's structure), EX (the median booking call is 291 seconds, used for pacing only; no consent exists to play real calls), CCD (a mandatory note on every call outcome; "Feedback for the client" posted to the portal per appointment), SD `CALLS_TOUR` stages (names adapted for clients), KB (the call guide lives in the client's portal Knowledge area; the new-client automation is not yet observed on a genuinely new form; an edited starter page gets a separate review page), DWY SOP §4.

## L7 · `portal`

**Title:** Mahara OS, your portal
**Time:** 2.5 minutes

**On screen**
- Eyebrow: "You do this"
- Title: "Mahara OS, your portal"
- Tag on every screen: "Demo workspace"

**Stops**

| # | Stop | Copy | Picture |
|---|---|---|---|
| 1 | Where things stand | "Your next appointments, and anything waiting on you." | `portal-overview` |
| 2 | Your calls, recorded | "Listen back to the calls we make for you, in Mahara OS." | `portal-calls` |
| 3 | On your phone | "Install it like an app." | `mahara-mobile-{lang}.mp4` |
| 4 | Your number-one job: mark every meeting | The job as the stop's heading, then "A few taps, the same day.", then its three questions as three taps in order: "Did they come?" · "Did you quote?" · "Did you win?" Footer: "What isn't marked can't be improved." | Drawn, no screenshot: the outcome form is shown once, on L2 stop 7 |

The slide ends on stop 4.

**Slots:** static pictures. The install link and `links.portal` are copied from the notes window, in the deck's language: "Mahara OS: {url}" · "Install it on your phone: {url}".

**Notes**
- If they haven't signed in yet, do it now.
- Slow down on stop 4. It's the job clients most often drop: only 30% of recent appointments have attendance marked.
- Why it matters: the outcomes show which ads bring real projects, so we put more behind those.
- The portal can remind them after each appointment to mark it.
- If they already use the report sheet, the two stay in step.

**DWY variant**
- Stop 2 is hidden.
- Until `prep.dwy_os_approved` is set, stops 1 and 3 are hidden too, the title is "Your CRM", and stop 4 is drawn as the CRM stage list instead of a Mahara OS screen.
- Stop 4 becomes "Your number-one job: keep every stage true" · "Move each meeting to the right stage in the CRM the same day: didn't show, showed, quote sent, closed."

**Sources:** SD `PORTAL_TOUR` (the masked screens, outcome in two taps, the outcome's why), PS §8 (only 30% of recent appointments have attendance marked), PS §4 and §5 (installable, calls with playback "when available", the outcome fields, a reminder an hour after the appointment, the sheet stays the record and portal saves sync to it), CCD (only Maqsam calls carry recordings; "outcome only" saves have none), LCF (the #1 job; "what isn't tracked can't be improved"), CSMT (a message after every appointment asking for the status), NL (the leads, results and ads screens are left out), MOS, DWY SOP §5.

## L8 · `your-part`

**Title:** Your part
**Time:** 1 minute

**On screen**
- Title: "Your part"
- Line: "Your five jobs, in one place."
- The five jobs on one grid with the title, three across: each the job in one short line and why it matters under it (no column head). Two carry a picture under their words (DESIGN 8.8): three of their creatives under job 1 (only with three or more), and a calendar day with one hour blocked, "Busy", under job 5:

| # | Picture | Job | Why it matters |
|---|---|---|---|
| 1 | The ad tray (L3) | Leave the ads running through the first weeks | Ads need time before we can tell which ones work. |
| 2 | None | Mark every meeting, the same day | Your outcomes show which ads bring real projects. |
| 3 | None | Keep your Drive folder fed | Fresh projects keep your ads from tiring. |
| 4 | None | Keep the offer steady while we test | Want to change it? Ask in the group first. A new offer mid-test starts the test again. If you ask first, we can plan it in. |
| 5 | A blocked-out calendar slot | Block busy times and holidays in your calendar | Our callers book into the times you leave free. |

**Slots:** none.

**Notes**
- Sixty seconds: "Your five jobs in one place. I'll send this card to the group."
- After the call, send this card in the group as the recap.
- A slot outside their hours, a holiday and a service detail are the questions our callers ask most.
- They don't need to answer on Fridays or in the evening.
- **Temp check:** "Which of these will be hardest for your team?"

**DWY:** tile 2 becomes "Call fast, note every try, keep every stage true" · "Interest fades, and a missing note means nobody knows what happened." No picture (only rows 1 and 5 carry one). Tile 5's why becomes "Your team books into the times you leave free." (their own team books, never "our callers"). Notes: "Their own callers ask those questions and book into the free times; the group answers them."

**Sources:** the old onboarding template's "roadblocks" (the structure), PS §8 (the client's jobs; only 30% of recent appointments have attendance marked; footage is scarce; the questions the call centre needs answered), CRF (goes quiet in weeks 3 to 4, outcomes stop being filled), LCF (block busy time in Google Calendar), PEA (ads fatigue), CSMT (keep the folder full), DWY SOP §2 and §6 (speed, a note before every stage move).

## L9 · `first-90-days`

**Title:** Your first 90 days
**Time:** 1.5 minutes

**On screen**
- Title: "Your first 90 days"
- Top line: "Your 90-day goal, in your words: {form.goal90}", with the footnote "A target, not a promise of results."
- A timeline from {go_live} to day 90, which ends the axis on its own dashed line, named "Day 90" with its date (the week heads stop at day 77, so none sits on it):
  - "Weeks 1 and 2 · Finding what works" (a bar, no sentence); its dashed open end is labelled "Can run longer"
  - "Your first check-in · a week or two in" · {next.checkin}
  - "Then every two weeks" · "20 to 30 minutes on Zoom: what's working, and what we're changing." (keyed with the check-in diamond)
  - "At 30, 60 and 90 days, that check-in looks back over the month." (keyed with the ringed diamond)
- Milestones, unlit at launch and never dated: First booking · First attended appointment · First won project
- Footer: "Dates depend on your market, your offer and your follow-up. We track them with you."

**Slots:** `form.goal90` (with `prep.goals`; the line is hidden while the goal holds a lead or appointment count the CSM has not cleared, copy rule 10), `go_live`, `next.checkin`.

**Notes**
- No numbers promised. Never give a date for a milestone.
- Some first weeks are busy and some are quiet. Either way, we're finding what their market responds to.
- Updates come in the group as things happen.
- Check-ins: a laptop, somewhere quiet, not in the car. The next one is booked at the end of each.
- **Temp check:** "Does this rhythm work for you?"

**DWY:** same. The first booking is their team's.

**Sources:** the lead's decision (the first check-in at day 7 to 14, then every two weeks), O2L Day 14 (a call every two weeks, updates in the group as things happen), CSMT "When Ads Launch" (20 to 30 minutes on Zoom, somewhere quiet with a laptop), PS §2 and §7 (30, 60 and 90-day marks in the portal journey; no SOP defines a separate review meeting; milestones), SD `MILESTONES`, FCL PLAN (drop "the first weeks are always slowest"), PS §3 (measured first booking about 4 days after launch: single source, so not printed), GR.

## L10 · `green-light`

**Title:** Before we go live
**Time:** 2 minutes

**On screen**
- Label and title: "Before we go live"
- Housekeeping cards:
  - "Meta's first charges on your card are small. That's normal. Tell your bank so it doesn't block them."
  - "Comments on your ads are yours to answer. Not sure what to say? Ask in the group."
  - "We reply 10 to 6, Saturday to Thursday." (UAE zone per the data map.) This card shows only when `prep.onboarding_presented_at` is empty. If this client saw the onboarding deck, O3 already said it.
- The question, large: "Happy for us to go live?"
- Once booked: "Your first check-in · {next.checkin}"

**Slots:** `prep.onboarding_presented_at` (written when the onboarding deck is presented for this client). `next.checkin` (Book button in the notes window, kind checkin).

**Notes**
- Questions first, then ask for the green light in those words.
- Book the first check-in before you hang up, a week or two after go-live.
- If they hesitate, find the one thing and solve it now, or agree a date to solve it.
- Say the awkward thing: "If anything worries you at any point, tell me. The partners who do best tell us the good and the bad."
- After the call, send the "Your part" card in the group as the one short recap, not the long launch message.

**DWY:** same.

**Sources:** LCF (housekeeping: small first Meta charges, comments on ads are the client's; ask for the green light; book the next meeting at the end), CSMT "When Ads Launch" (say the awkward thing), PS §13 (the launch call replaces the long launch message and the day 6 to 8 messages; one recap after).

---

# Appendix A: the example call

Used by L6. Scripted from the dialer's real booking script (`config/call-script.json`, verified 2026-09-09) and its framework (`public/framework.js`). It is never a real recording. The customer ("Abu Fahad") is fictional, and the caller is never named: she opens as "the appointments team at {Company}". `EXAMPLE-CALL.md` holds both Arabic dialects, the pain variants, the budget bands and the male-caller swaps.

## Slots

Filled slots are highlighted in teal. A missing slot shows a dashed "To give us: …" chip in its place.

| Slot | Source | When missing |
|---|---|---|
| `{Company}` | `client.name` (Arabic name from `ghl_clients.client_name` in the Arabic deck) | Never missing. |
| `{service}` | `prep.service_focus`, then `kickoff.advertised`, then `form.number_one` | "To give us: the service we're advertising" |
| `{project}` | `prep.project`, then the service family table in the data map | "your project" |
| `{engineer}` | The consultant's name in the client's call guide (Call Center Hub, `knowledge_base_page`), then `form.engineers` | "our engineer", plus "To give us: who holds the consultation?" |
| `{free}` | `form.free_consult`: yes gives "a free consultation", no gives "a consultation" | "a consultation", plus "To give us: is the first consultation free?" |
| `{place}` | `form.consult_types`, first match: "at our office", "at your home", "online" | "To give us: where you hold consultations" |
| `{selling point}` | `prep.selling_point`, typed from their Brand DNA, offer (`editor_clients.offer`) or call guide. Prep shows it beside the pain variant so the two match. | "To give us: what makes you different, in one line" |
| `{instagram}` | `form.instagram` (handle only) | The 4:35 bubble is dropped. |
| `{day}`, `{time}` | The first working day two days ahead, inside `form.hours`. The time is 4 pm, moved to the client's last afternoon hour when they close earlier. | Two days ahead, Sunday to Thursday, 4 pm. |
| `{band}`, `{band.answer}`, `{band.note}` | `prep.budget_band`, else `EXAMPLE-CALL.md` by country and scale | The script's figures, no currency. |
| Pain variant | `prep.pain`: delays (default), design, or cost. Changes the 1:46, 2:05, 2:17 and 3:16 lines and stop 8's note. | Delays. |
| Dialect | `prep.dialect`, then `client.country` (SA gives Saudi; KW, QA, BH and AE give Kuwaiti), then `form.areas` (a Saudi city gives Saudi) | Kuwaiti, the script's own dialect. Switchable in the notes window. |

## The script (pain variant: delays)

English subtitles, final. Lines over about 20 words are split into two bubbles at the sentence break (DESIGN 11.2). Lines marked "new" are the fictional customer's or connective lines with no script source.

| Time | Who | Stage | English subtitle | Source |
|---|---|---|---|---|
| 0:00 | Caller | The opening | Assalamu alaikum. Am I speaking with Abu Fahad? | §01 |
| 0:04 | Customer | | Yes, speaking. | new |
| 0:08 | Caller | | Hello, this is the appointments team at {Company}. How are you today? | §01, with the coordinator line folded in |
| 0:13 | Customer | | Good, thank God. | new |
| 0:17 | Caller | | I saw the enquiry you sent us about {service}. | §01 |
| 0:24 | Caller | | I wanted to give you a quick idea. Is now a good time? | §01 |
| 0:30 | Customer | | Yes, go ahead. | new |
| 0:34 | Caller | Their goal | So I can help you properly, I'd like to understand what you have in mind. | §02 |
| 0:41 | Caller | | What matters most to you in {project}? | §02 |
| 0:49 | Customer | | That it's done right this time, and that it's to our taste. | new |
| 1:00 | Caller | | And what would make you say the project was a success? | FW 02 |
| 1:09 | Customer | | Finished on time, with no surprises on the cost. | new |
| 1:21 | Caller | The details | That makes sense. How long have you been planning it? | §03 |
| 1:27 | Customer | | About six months. We'd like to start soon. | new |
| 1:37 | Caller | | Have you worked with a design or build company before, or is this the first time? | §03 |
| 1:46 | Customer | | Once, two years ago. They finished four months late. | new |
| 1:57 | Caller | | Where did it go wrong: the design, the work itself, or after handover? | §03 |
| 2:05 | Customer | | During the work. We never knew what was happening on site. | new |
| 2:17 | Caller | | So this time you want to know where things stand, step by step. | §03, the communication question as a summary |
| 2:24 | Customer | | Exactly. | new |
| 2:30 | Caller | | And on budget, do you have a rough figure in mind? | §03 |
| 2:37 | Customer | | Honestly, I'd like to know what it costs first. | new |
| 2:44 | Caller | | Fair question. The price depends on the details, the materials and the space. | §07 "How much does it cost?" |
| 2:51 | Caller | | That's why you sit with {engineer}: you get an accurate quote, not a guess over the phone. | §07 |
| 2:59 | Caller | | Roughly, are you thinking {band}? | §07 "I don't have a budget yet" |
| 3:08 | Customer | | {band.answer} | new |
| 3:16 | Caller | What sets you apart | I have the full picture. You want {project} done right, on time, and to know where things stand. | §04 opening |
| 3:25 | Caller | | At {Company}, {selling point}. | FW 04, one point from the client's own material |
| 3:35 | Customer | | That's exactly what I need. | new |
| 3:41 | Caller | The booking | I'd like you to meet {engineer}, to go through {project} in detail. Shall we book you {free}? | §05 |
| 3:54 | Customer | | Yes, let's do it. | new |
| 3:57 | Caller | | We have {day}, morning or afternoon. Which suits you? | §05 |
| 4:04 | Customer | | Afternoon. | new |
| 4:07 | Caller | | Done: {day} at {time}, {place}. Just to be sure, can you definitely make it? Nothing that might stop you? | §05, the booking and the double tie-down |
| 4:23 | Customer | | No, I'll be there. | new |
| 4:29 | Caller | Locking it in | Your appointment is confirmed for {day} at {time}. You'll get a WhatsApp with all the details. | §06 and §05's confirmation message |
| 4:35 | Caller | | Before then, have a look at our projects on Instagram: {instagram}. | §06 |
| 4:40 | Customer | | I will. Thank you. | new |
| 4:46 | Caller | | Thank you, Abu Fahad. We look forward to seeing you. | §06 |
| 4:51 | | | Call ends | |

**The pain variants** (lines that change, English):

| Time | Design | Cost |
|---|---|---|
| 1:46 | Once, two years ago. What they built didn't look like the drawings. | Once, two years ago. The final bill came in far above the quote. |
| 2:05 | In the design. We approved one thing and got another. | During the work. Every week there was a new extra cost. |
| 2:17 | So this time you want what you approve on paper to be what gets built. | So this time you want a clear price before you start, and no surprises. |
| 3:16 | I have the full picture. You want {project} done right, and built the way you approved it. | I have the full picture. You want {project} done right, with a clear price and no surprises. |
| Stop 8 note | Last time, what was built didn't match the drawings. | Last time, the final bill came in far above the quote. |

The delays variant's stop 8 note is "Their last company finished four months late."

**Left out on purpose:**
- §04's «نضمن لك السعر، الوقت، وجودة التنفيذ» and «ساعدنا مئات العائلات». These are claims made on the client's behalf, and they appear only if the client's own guide says them.
- §05's «بيقدر يرسم لك خريطة طريق واضحة» and any promise about what the consultation will give the customer.
- §05's deposit lines. Mahara does not take deposits, and the client's policy decides.
- The "you're sure? no-shows look bad on me" phrasing from §05. It is kept as the plain double tie-down.

**The confirmation (stop 7).** Drawn in the live template's structure: an opening line, then the date, the time and the location, then a closing line. Wording and digits are in `EXAMPLE-CALL.md`. It is labelled "Example wording" until the live template text replaces it (open question 7).

**The timeline (stop 7).** Booked: a WhatsApp confirmation · The day before: a reminder · A confirmation call · 2 hours before: an SMS · The meeting.

**Pacing.** The clock runs to 4:51 because the median booked call is 291 seconds (39 calls). This is used only to pace the animation and is never printed. The clock jumps to each bubble's timestamp (DESIGN 11.4).

---

# Merged and removed

## From the old launch template ("AI-ROI Audit Call")

- **Kept:**
  - the agenda-first opening, now L1's frame in the notes;
  - "the next 90 days", now L9;
  - "quick feedback loops", now L4 (changes asked in the group) and L10 (say the awkward thing).
- **Removed:** the AI urgency section, the "examples in our agency" slides, the profit, headcount and churn figures, and "confirm the remaining investment". None of it is about this client's launch, the figures are another company's, and money talk does not belong on a launch call.

## From the old onboarding template ("Aesthetic Accelerator")

- **"What is the program"** became O3, as the team in their WhatsApp group.
- **"Accelerator access":**
  - Slack is removed: clients are not in Slack, and the WhatsApp group replaces it (O3).
  - Skool became the Premium Projects Academy (O6).
  - "Bi-weekly check-ins" moved to L9.
- **"Most common roadblocks"** was merged into L8, "Your part", as five jobs with why each matters:
  - "Not using Slack" became the group tile.
  - "Not watching the trainings" moved to O6, as the Academy row.
  - "Not treating ads like a science project" became L4.
  - "Thinking we just run ads" and "not running our proven process" are dropped. They read as blaming the client, and L4 and L8 carry the real asks.
- **Removed:**
  - the "low failure rate" line;
  - the named trainer;
  - "hundreds of medical spas" and "millions spent";
  - "expect the first ad to fail", too negative, replaced by "the first weeks are a test";
  - "patient sales team training": Mahara does not train the client's team (OM phase 5);
  - "hit our monthly projections": a results promise.
- **"Most vital milestones"** (8 items) was split:
  - before launch, into O5's six stops;
  - after launch, into L9's three milestones with no dates or numbers.

## From the sales deck

- **`JOURNEY` (5 stops)** became L2 (7 stops), from the client's side:
  - "A call within 5 minutes" and the MIT 100× line are removed (copy rule 1).
  - Its screenshots (`jr-*`) are not used: they show other clients and a real customer (copy rule 11). Every stop is drawn from this client's data.
  - The landing-page stop shows only when the client really has a page; most run on Meta forms.
  - The welcome and booking videos became prep toggles.
- **`CALLS_TOUR`:**
  - "stages" is reused on L6, renamed for clients: "The pre-pitch" became "What sets you apart", and "Locking the decision" became "Locking it in".
  - "calendar" (booking details) became L6 stop 8, drawn with a fictional customer. The Slack frame it used is not shown.
  - "script" (a knowledge base per firm) became L6's call-guide line.
  - "who" (3+ years, 50+ interviews, 4 trainings a week) is dropped. It is sales proof, the client has already bought, and it isn't needed to set expectations.
  - "listen" (the real recording) is dropped: there is no consent, and another client's brand would be exposed. The scripted call replaces it.
  - "nothing" (four follow-ups, same-day no-show call, "came but didn't sign? we follow up") is replaced by "up to 4 tries over 3 working days" and the fork on L2 stop 6.
- **`ADS_TOUR`:**
  - "account" (20 ads, 11 on, 9 off) became L4's optional proof, drawn as neutral tiles. The screenshots show daily budgets, spend, a cost per result, other clients' ads and faces, so they are not used.
  - Targeting, platforms, the market picker, portfolio, brief and offer are dropped: they are sales proof, and the client lived the Blueprint.
- **`CLOSING_TOUR`:**
  - The academy became O6 row 5, with the real course names.
  - "Weekly 1:1 check-in calls" is corrected to every two weeks (L9).
  - Mastery and the reviewed-calls tracker are dropped.
- **`PORTAL_TOUR`:**
  - Overview, calls and outcome are kept (L7), and the phone film is added as a stop.
  - "Every lead, and the ad that brought it", "Your results, in money" and "Every ad" are dropped: they show leads and cost per lead (copy rule 3).
- **`TIMELINE`** ("Days 1 to 7", "leads in 7 to 10 days", "cost per lead comes down") is replaced by O5 and L9, with no promised times and no cost per lead.
- **Also removed:**
  - **`INCLUDED`**: "within five minutes" and "a weekly consulting call" are removed; the rest is covered by O3.
  - **`NEXT_STEPS`**: the deposit and "live within 7 days" are removed.
  - **The speed slide (21×)** is removed.
  - **Proof** (stories, reviews, #1, 70+ firms) is removed: the client has already bought.
- **FAQ answers moved into notes:** "Can we listen to the calls?" (L6, L7) and "Do leads book themselves?" (L2, by showing it).

## From Mahara's own framework docs and templates

- **Onboarding Call Framework (16 steps):**
  - Only the steps a client needs to see became slides: goals, the team, one service, the road, access, starter ads, red lines, the next call.
  - Rapport, the agreement, the kickoff read-back, the WhatsApp people, payment, the upsell and projections stay in the talk track.
  - "Realistic is 2 to 4 projects a month" is kept off the slides, and the notes tell the CSM not to quote a number.
- **Launch Call Framework:**
  - The four goals shape L1 to L10.
  - "What if they don't like the ads" became L4.
  - Blocking busy time became L8.
  - The #1 job became L7.
  - Cadence became L9.
  - Housekeeping and the green light became L10.
  - Temp checks are in the notes.
  - "Up to 8 follow-ups" is replaced by 4 tries over 3 working days.
  - "5x to 10x ROI" is removed (copy rule 2).
- **CSM "When Ads Launch" message:**
  - Feedback anytime went to L4 and L10. Check-ins every two weeks went to L9. Tracking went to L7, as the portal. Keep sending content went to L8. Say the awkward thing went to L10.
  - "Month one is always the slowest" is replaced (FCL PLAN).
  - After the launch call, the "Your part" card replaces the long message.
- **CSM day 8 message:** "The call centre handles every lead seven days a week" is not used. The hours are Saturday to Thursday.
- **Client Process Map:** "we call the same day" and "we confirm twice, 48h and 24h" are not used (the second is true only for provisional bookings). "A no-show is ours, someone who showed is yours" is kept (L2 stop 6).

## Deliberate overlaps (kept, and why)

- **"The first weeks are a test"** is planted on O7 with the red lines and paid off on L4, in the client's own words. L9 shows only the time window, as a bar.
- **Content:** O6 is the first upload, for the Blueprint. L8 is keeping the folder fed after launch, against ad fatigue.
- **The outcome:** it is named on L2 stop 7, shown on L7 and kept as a tile on L8. L8 repeats it on purpose, because it is the job clients most often drop (30% marked).
- **Group hours:** stated on O3. The L10 card shows only when this client never saw the onboarding deck (most clients in onboarding today passed their onboarding call before these decks existed).
- **The goal:** read on O2, shown again at the top of L9, so the promise to track it is kept where the tracking is planned.

---

# Open questions for the CEO

Each one names the default used in this copy.

1. **The sales deck still promises speed.** It says "A call within 5 minutes", "Every lead called within five minutes", 21× and 100×, and callcenter.maharamedia.com says the same. The official figures for 20 Sep to 19 Oct are a median of 163 working minutes to the first dial and 1.8% dialled within 2 working minutes. So a client hears one thing on the sales call and another on the launch call. **Default:** the launch deck uses the fixed hours wording and the sales deck is untouched (out of scope here). Fix the sales deck and the public page to match?
2. **Weekly against every two weeks.** The sales deck promises "Weekly 1:1 check-in calls" and "a weekly consulting call". **Default:** every two weeks after the first check-in, as decided. Correct the sales deck too?
3. **Who follows up a customer who came and is deciding.** As decided, it is the client's, which matches the Client Process Map. But the sales deck says "Came but didn't sign? We follow up", and the dialer has an attended follow-up script and a "Client handover". **Default:** the client's, on L2 stop 6. Should the deck mention that our callers may also check in after a meeting?
4. **Where outcomes are marked.** The "When Ads Launch" message says the tracking sheet, the portal has the outcome form, and the sheet is still the authoritative record. **Default:** the Mahara OS outcome form on screen, with "the two stay in step" in the notes.
5. **The steps before the meeting are not uniform.** In the last 30 days there were about 50 confirmation calls against about 166 bookings. The day-before reminder buttons are live on 8 accounts. 40 of 47 no-show attempts ended lost. **Default:** the decided wording, as "what we do", with no "every". Comfortable showing "a confirmation call" in the sequence at that coverage?
6. **Welcome and booking videos.** Who records them, and which clients have them, is unconfirmed. **Default:** prep toggles, off. The copy says "a welcome message" until the CSM turns a video on.
7. **The real WhatsApp confirmation text has never been read word for word.** Its structure is known from a live message (an opening line, the date, the time, a location link, a closing line, the date in Latin digits). **Default:** the bubble follows that structure with our wording, labelled "Example wording". Share the live template so the bubble can match it exactly?
8. **"Month one is always the slowest"** is in the CSM templates and the performance arguments. The fast-launch plan drops it, and the measured first booking is about 4 days after launch (single source). **Default:** "the first weeks are a test", and "some first weeks are busy, some quiet" in the notes. Retire the line in csm-templates, along with the day-8 "seven days a week"?
9. **The Launch Call Framework doc** still says "Our goal is to get you a 5x-10x ROI" and "follow up up to 8 times". The Context Pack says about 8 attempts over 10 days. **Default:** neither appears; 4 tries over 3 working days. Correct the doc so CSMs don't read the old lines aloud?
10. **Starter ads under Mahara's shared identity.** The fast-launch guide allows starter ads to run under a shared Instagram and Page. If that is in use, the mockups on L3 and O7 would show the wrong Page name. **Default:** the client's own Page name from the kickoff, overridable in prep. Is the shared identity live for any client?
11. **The launch call as a gate.** The fast-launch guide says not to hold a ready campaign for a scheduled launch call, and the Onboarding Map puts the call before go-live. **Default:** the cover and O5 read true either way ("is live", "everything that's going live").
12. **The portal shows leads and cost per lead** on its Ads and results pages, and "lead" in the headings of the calls and outcome screens, while client messages never quote them. **Default:** the deck leaves the Ads and results screens out and crops the headings where it can. Should CSMs be ready to explain them, or should the portal hide them for clients?
13. **Hours at the edges of the week.** Thursday-evening and Friday enquiries wait for Saturday, and one of the two callers works 12 to 4 on Saturdays. **Default:** "called from 10 the next working morning". Is that true on a Saturday, or should the line say "the next working day"?
14. **Money goals on O2 and L9.** These are the client's own figures, read back to them. **Default:** shown as they wrote them, each card hideable in prep. Show the money, or the words only?
15. **The projections step on the onboarding call** (calculator.maharamedia.com, "realistic is 2 to 4 projects a month") anchors a result. **Default:** it is not on any slide, and the notes say not to quote a number. Keep the projections step in the call at all?
16. **Dialect and currency for the 30 clients with no country.** **Default:** taken from the service areas, else Kuwaiti with no currency word, switchable in the notes window.
17. **One call, two names.** The sales deck calls it "the kickoff call" (مكالمة البداية). **Default:** "onboarding call" / مكالمة التعريف, as on the Onboarding Map.
18. **DWY outcomes and Mahara OS.** The DWY SOP has their team move CRM stages, `serviceModel` says DWY gets no sheet, and the DWY flow in Mahara OS still needs per-client approval. **Default:** CRM stages on L7 for DWY, and the Mahara OS rows hidden until `dwy_os_approved`. Should DWY clients use the Mahara OS outcome form once approved?
19. **Platforms beyond Meta.** L3 draws only Meta placements, and the kickoff's platforms are choices, not campaigns. **Default:** no line, unless the CSM ticks "Planned next". Build Snapchat and TikTok frames?
20. **Real calls already in public use without consent.** The sales deck's recording (Wistia ti2alygqn0) and callcenter.maharamedia.com's six real calls have no consent record, and on 2026-10-07 the public page showed a lead's name and phone. **Default:** none of it is used in these decks. Take them down or mask them?
21. **What the client's own booking alert says.** Main bookings notify the client; whether that alert, or the Mahara OS appointment, carries the project, timing and budget is not confirmed (the only evidence is an internal Slack message). **Default:** L2 stop 5 says only that it lands with a WhatsApp alert, and L6 stop 8 shows "our caller's notes", tagged Example. Confirm what the client receives?
22. **How new ads reach the client for approval.** No source names a review link or a review date. **Default:** "You approve your ads in the group." Is there a link and a date we can promise?
23. **Which services have a starter pack today.** **Default:** O7 names the service only when prep confirms a pack, and the optional starter-ads stop shows only then.

---

# Source key

| Code | Source |
|---|---|
| BR | Snapshot workflow "3. Booking Router & Notifications" (966abbc0): WhatsApp confirmation on booking, reminder 1 day before, SMS 2 hours before. Read by the example-call scout. |
| CCD | Memory `call-centre-data.md` and the example-call scout §3 and §4: the shift, priority, the measured first-dial figures, 45% with no verified dial, only Maqsam calls carry recordings |
| CPM | mahara-context `systems/Projects/Client Process Map.md` |
| CRF | mahara-context `skills/meta/mahara-client-comms/references/churn-red-flags.md` |
| CS | Dialer `config/call-script.json`, "Call Center Script", Google Doc 1rZETe8O…, verified 2026-09-09 |
| CSMT | mahara-context `client-comms/csm-templates.md`, "When Ads Launch" |
| CTX | mahara-context `context/Mahara_Media_Context_Pack.md` §3, through the process scout |
| DEC | mahara-context `context/DECISIONS.md`, 2026-10-17 (DWY enquiries also go to the client's group), through the process scout |
| DOM | Dialer `src/domain.mjs`: working hours, `LADDER` and `nextLadder` (4 tries over 3 days, Day 2 and 3 at 09:00 on the next calendar day), hot events to the top of the queue |
| DWY SOP | mahara-context `systems/Projects/DWY - Client Dialing SOP (Template).md` |
| EX | The example-call scout: consent and privacy (§5), call length (§3) |
| FCL | mahara-context `tools/fast-client-launch/OPERATING-GUIDE.md` and `PLAN.md` |
| FW | Dialer `public/framework.js` |
| GR | Memory `guarantee-rule.md` |
| KB | mahara-context `context/projects/call-center-knowledge-base.md` (the guide lives in the client's portal Knowledge page, and the portal reads and edits it; an edited starter page gets a separate review page; a genuinely new form not yet observed) |
| KF | Kickoff form tG7dnxBn, and the `KICKOFF` and `SETUP` patterns in `apps/client-success-cockpit/src/lib/clientBrief.ts` |
| LAF | mahara-context `systems/Mahara OS V2/02 - Lead & Appointment Flow.md` (Main calendar notifies the client; Provisional and Callback are internal only) |
| LCF | "Launch Call Process & Framework", Google Doc 1kTq3cEn…, through the CSM scout |
| MOS | mahara-context `context/projects/mahara-os.md`, 3 October 2026 (the DWY flow in Mahara OS sits behind per-client approval) |
| NL | Memory `client-messages-no-leads.md` |
| O2L | mahara-context `client-comms/onboarding-to-launch-csm.md` |
| OCF | "Onboarding Call Framework", Google Doc 1JN4oTUo…, through the CSM scout |
| OF | Onboarding form KFRCXPFx, and the `GOALS` patterns in `clientBrief.ts` |
| OM | mahara-context `systems/Projects/Onboarding Map.md` (phases 2 to 5 sent to the group; phase 6 for DFY only; phase 5 correction) |
| PB | Dialer `public/call-playbooks.js` `confirmationCadence`, through the example-call scout |
| PEA | mahara-context `skills/meta/mahara-client-comms/references/performance-education-arguments.md` |
| PS | The process scout's fact sheet, sections as numbered there |
| RN | Memory `team-docs-roles-not-names.md` |
| SD | The sales deck: `apps/sales-cockpit/src/deck/content.ts`, `proof.ts`, `tour.ts` at c846fd5e |
| WC | mahara-context `skills/meta/mahara-client-comms/references/what-to-cut-from-client-copy.md` |

---

# Revision notes

Revised 2026-10-19 against the critique (claims, flow and design lenses). All four files changed together; English and Arabic are in step, and the example call is the same in `CONTENT.md`, `CONTENT-AR.md` and `EXAMPLE-CALL.md`.

**Musts, all fixed**
- Other clients' material is gone. Every `jr-*`, `cc-*`, `ads-account` and `ads-twenty-*` picture is removed and banned by name (copy rule 11). The form, thank-you, queue, confirmation, booking and test proof are drawn from this client's data or as tagged examples. `DESIGN.md` 16.2 is binding for media.
- One home per fact: the [decision table](#decision-table-binding-for-both-files) rules every fact the two specs placed differently, and `DESIGN.md` 8.0 points to it.
- "The numbers decide" is said once, on L4. L3's footer is gone, L9 is a bar labelled "Finding what works", L8 row 1 is the action only, and O7's teaser became the red-lines ask.
- "Your part" is a five-tile checklist with "Why it matters" lines, doubles as the recap card, and now sits before the 90 days (L7, L8 your part, L9 the 90 days, L10). The Arabic head is دوركم.
- The deck never leaves on Esc. The cover uses only a custom creative, at its own size in a phone, else the faint lanes.

**Shoulds accepted** (in brief): the journey is seven stops lit by owner, about 2.5 minutes, and the deck is about 22 minutes. Claims were corrected: the next working morning, 3 working days, no "just now", your calls recorded, before the meeting, the approval scope, the swap is a preview, planned platforms, the 30, 60 and 90-day check-ins, the exact form match with a CSM tick, DWY's CRM, the starter pack named only when it exists, and "lands with you" without unverified fields. L4 concedes first. O3 is the team as their WhatsApp group, with the hours. O7 can show the starter ads. L6 ends on what lands with the client and says that not every enquiry books. The call has pain variants and per-country budget bands. Several Arabic words changed (اللي يميزكم، لين، الاختبار، نحتاجه منكم and others). DESIGN took the wider lanes, the tray-first upload, state held in the shell, signed URLs, the avatar order, 22 px tags, the faint-lanes onboarding cover and pacing by line length.

**Rejected or changed, and why**
- **L4 proof from the client's own tray** (flow): drawn as neutral tiles instead, as the claims and design lenses ask. Dimming their real creatives before launch reads as a verdict on ads that haven't run, and a client with two creatives can't fill the grid.
- **The proof caption** (claims): "The numbers decide which stay on" became "Some stay on, some go off", so L4 says "the numbers decide" once, as the flow lens asks. The lit and dimmed tiles carry the rest.
- **Reminders on the journey** (design's recommended pick): they live on L6 after the call (flow's pick). The call's last line promises the WhatsApp, so the confirmation lands as its payoff, and the journey stays at 2.5 minutes. The design lens's reason, the dotted return line, applies to the no-show fork, which stays on the journey.
- **The lanes on O3** (design): O3 is the WhatsApp group (flow). The lanes mean "who handles this enquiry", which pays off only on the launch journey. The group is what the client joins that day, and it carries the hours. The faint lanes still open the onboarding cover, so the shape is seen first there.
- **The CSM named in O3's group** (flow): by role. The lead put the CSM's name on the cover only.
- **The "We agree" button** (flow wanted the wording): no button on the canvas (design). The wording moves into the stamp and the notes-window button.
- **"We fix the same day"** (flow, on L4): "the same day" dropped. It is a speed promise that the media buyer's queue and Meta review can break, the point the claims lens makes about the swap.
- **"A review link with a date"** (flow, on L4): no source names one, so the line reads "You approve your ads in the group", and open question 22 asks.
- **"Try any of your creatives in the phones"** (claims): "We can show any of your creatives in the phones", because the client cannot click.
- **«كورس البداية» for the onboarding course** (flow): "The start" is a different Academy course, so the Arabic gives the course its own name, Onboarding.
- **O7 without "the first weeks are a test"** (flow): the lead listed it for O7, so the heading stays, now carrying the red-lines ask instead of a teaser.
- **The Academy on O3** (lead's list): it moves to O6 row 5 only, so it is said once, with what it is.

**Also fixed while in there:** the English `{project}` values say "your"; the English call uses `{time}`; 2:51 uses `{engineer}` so design studios fit; a missing Instagram handle drops its bubble; unknown access reads "Not checked yet"; `{next.*}` shows nothing until booked.

---

# Humanizer pass

Run 2026-10-19 over every English on-screen string, presenter note and fallback in this file and over the English subtitles in `EXAMPLE-CALL.md`, against the humanizer skill and Hallmark's `copy.md`. No fact, slot, copy rule or decision changed. The copy was already plain: the scan found no em dashes, curly quotes, exclamation marks or banned words (seamless, elevate, unlock, empower and the rest), so the pass is small. The kinds of change:

- **Slogan cadence removed.** O3's "one team, in one group" became a plain sentence naming who is in the group.
- **Verbs first.** O1's agenda went from "Your launch service, chosen" style labels to "Choose your launch service", under "Before we hang up, we'll:". This also matches the Arabic, which was already verb-first.
- **Active voice.** "Your first ads are being finished" became "We're finishing your first ads", and "Yours is being finished" became "We're finishing yours". Two notes went active as well (L4 "They ask for changes in the group", L10 "agree a date to solve it").
- **Vague or marketing words made concrete.** O4 "speaks to one kind of customer" became "are all written for one kind of customer", which also drops an "every" that copy rule 4 would trip on. L4 "your page's own content" became "your page's own posts". L6 "we'll complete with you" became "we'll fill in with you".
- **Inflated claim swapped for a sourced fact.** L7's note "the one habit that decides how the next months go" became the measured gap: only 30% of recent appointments have attendance marked (PS §8, now in L7's sources).
- **Stock phrases out.** L10 "the highs and the lows" became "the good and the bad" (the Arabic already said الزين والشين). The 2:17 subtitle "every step of the way" became "step by step", closer to خطوة بخطوة, in this file and in both variants in `EXAMPLE-CALL.md`.
- **Elided strings written out.** The two video variants (L2 stop 4, L5 stop 3) were fragments that opened on three dots, so a build could have shown the dots on the canvas. Both are now full sentences.
- **Small fixes.** L8 tile 4's dangling "Asked first, we can plan it in" became "If you ask first, we can plan it in". Also "the next one" on O4, "their time" in O1's notes, and O5's road metaphor in the notes became "we send the next one to their WhatsApp group".

**Kept on purpose.** The fixed calling line (copy rule 1) and every pinned wording in the decision table. The sourced lines that sound like slogans but come from Mahara's own frameworks: "What isn't marked can't be improved" (LCF), "An ad waiting for the perfect version earns nothing while it waits" and the L4 close (PEA), and "Don't filter. We will." (O2L). Hallmark's curly quotes and em dashes are not used, because copy rule 9 (plain quotes, no em dashes) is binding here.

**Arabic.** `CONTENT-AR.md` mirrors each English change in its English column. The Arabic changed only where the meaning moved: O3's `team.line` (no longer "one team") and L7's stop 4 spoken line (now "this is the job most often forgotten"). Both were written under the voice skill, and `team.line` stays in slide-level white Gulf Arabic.

**`DESIGN.md` is untouched.** Its wireframes still quote three of the old strings (O1's agenda, O3's line and L6's legend). Per its own line 21, the final words are in this file.

---

# Composition pass (2026-10-20)

The slides were recomposed so each has its own structure and one primary (DESIGN 19.11). Where a composition needed fewer or split words, the copy changed here, in `CONTENT-AR.md` and in `content.ts` together. No fact, slot or decision changed.

- **O2, nothing from the form:** the title "Your goals, in your words" is gone; the question is the slide's one heading.
- **O5:** the launch call's line is split in two. Its caption is its date once booked, else "20 to 30 minutes"; "We walk you through everything that's going live." sits under it. A passed step with no date on file reads "Done" (the status word the deck already uses).
- **L4:** no eyebrow ("Creative freedom" sat over a title that says it). Stop 1's words are cut to one lead ("Ads show in the feed, marked Sponsored, to people who don't know you yet. They don't appear on your page.") and a foot line ("The polished work belongs in your page's own posts."). "They're made for people who don't know you yet" folds into the lead. The approval loses "Once you have, we test versions of them side by side." (the title says the rest is tested, and the pick line says how), and the footer loses its second "in the group": the two now read as one foot line, "You approve your ads in the group. Prefer something different later? Ask, and we'll launch it too."
- **L7 stop 4:** no screenshot and no amber tag. Its sentence is set as its parts: "A few taps, the same day." under the job, and the three questions as three taps ("Did they come?" · "Did you quote?" · "Did you win?"). The stop's full copy line stays the record of the wording.
- **L8:** no "Why it matters" column head (each job carries its own why, so nothing heads a column).

