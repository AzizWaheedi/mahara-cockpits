# CSM decks: English content

The onboarding deck and the launch deck the client success manager presents from a client's page in the client success cockpit. This file holds the final English copy, the data each slot pulls, the presenter notes and the source behind every claim. The Arabic copy is in `CONTENT-AR.md`, written under `mahara-context/skills/aziz-kuwaiti-voice` in the warm-professional client register and Saudi-safe. The example call is in `EXAMPLE-CALL.md`.

Written 2026-10-19 from the scout reports (`deck-scouts.md`), the old template decks, the sales deck (`apps/sales-cockpit/src/deck/content.ts`, `proof.ts`, `tour.ts`), mahara-context and the memory notes. The lead's decisions are followed as given. Revised the same day after the critique, again on 2026-10-20 with the CEO's answers to open questions 1 to 3, and again on 2026-10-20 against Mahara's own Gamma decks (the CEO: "The launch deck is missing a lot of the expectation setting, such as going through the sales training and the piece of the pie"): see [From the Gamma decks](#from-the-gamma-decks-ceo-2026-10-20) and [Revision notes](#revision-notes) at the end. The launch deck now has thirteen slides; slide numbers in sections dated before that pass use the old ten-slide numbering. Revised once more on 2026-10-20 for the CEO's request of the same day: creative flexibility as a full expectation on L3 (five stops), a short plant on O7, and a video slot for each main part of both decks ([Video slots](#video-slots-ceo-2026-10-20); the backend is in `VIDEOS.md`). The deck keeps thirteen slides. Revised again on 2026-10-20 by the spec review of that pass, with two requests the CEO made during the build (seed the calendar-blocking Loom; show the Academy's Project Closing Mastery screenshots, masked): see the last entry of [Revision notes](#revision-notes).

## How to read this

- `{slot}` is filled from data. Each slot is defined once in the [data map](#data-map), with its fallback. A slide lists only the slots it uses, plus anything specific to that slide.
- **On screen** is exactly what shows on the canvas. Everything on the canvas is visible on the Zoom share. **Notes** live only in the notes window.
- **Each fact has one home across both decks.** The [decision table](#decision-table-binding-for-both-files) names it. `DESIGN.md` follows that table wherever the two files once disagreed.
- **Temp check** marks the question the CSM asks to check the client is still with them. The launch framework asks for one every 3 to 4 slides.
- **Sources** gives the fact source for every claim on the slide. The codes are in the [source key](#source-key) at the end.

## Copy rules (pin these in the deck's copy test)

1. **The 5-minute call, always with the hours.** The CEO, 2026-10-20: "keep it 5 mins for all". The 5-minute promise the sales deck and the call-centre page make is said in the launch deck too. Wherever a CSM deck says how fast we call a new enquiry, it says "within 5 minutes", always beside "during working hours". On its home, L2 stop 3, the line also gives the hours (10 to 6, Saturday to Thursday; for the UAE, "10 to 6 Saudi time (11 to 7 in the UAE)") and the night rule ("Anything that comes in at night is called from 10 the next working morning."), and the notes of both slides that say it (L2 and L5) give the night rule. The calling line is fixed: "We call new enquiries within 5 minutes during working hours, 10 to 6, Saturday to Thursday. Anything that comes in at night is called from 10 the next working morning." Then "Up to 4 tries over 3 working days." Done with you, their own team's line is "Call within 5 minutes." "Within 5 minutes" is the only speed the decks state. For our calls it never appears without "during working hours" (L5's WhatsApp step and the default thank-you screen say exactly "within 5 minutes during working hours"). Done with you, their own team's lines ("Call within 5 minutes." and L10's calling job, "Call new enquiries within 5 minutes, and note every try") carry no hours, because the hours are theirs. Still banned: the 21× and 100× statistics, "instantly", "same day" for our calls or our fixes, and any results promise (rule 2).
2. **No results promise.** No ROI, no multiples, no "fill your calendar", no project or appointment counts, no guarantee of any kind. The 7-day satisfaction guarantee never appears.
3. **No leads, no cost per lead, no budgets in money.** On screen and in the notes, the person who responds is "a customer" or "an enquiry", never "a lead". The only money on screen is what the client wrote themselves (their goals) and the fictional customer's budget band in the example call. One accepted exception: the reused Mahara OS screens carry the portal's own headings ("Calls with your leads", "Did the lead attend?"). That is product UI; crop below the heading wherever the crop keeps the screen readable.
4. **No "every" and no "always" for process steps.** Say what we do. The reminder sequence is "what we do before the meeting". "Every" is allowed only for the client's own job ("mark every meeting").
5. **Rhythm:** the CEO, 2026-10-20: "for both put weekly-biweekly cause it depends on how long theyve been with us and what the offer". After the first check-in (a week or two after go-live, unchanged), check-ins are "weekly or every two weeks", with the reason "depending on your plan and how long you've been with us" wherever it fits, and always in the presenter notes. Never one of the two alone for the rhythm. The same holds in the sales deck ("for both"). Never "seven days a week".
6. **Who follows up:** the CEO, 2026-10-20: "We will call them to follow up to rebook but also the client has the most context and should follow up as well". A no-show is ours: we call to rebook. A customer who came and is thinking it over is shared, done for you: our caller calls them to follow up, and the client follows up too, because they know the customer best. The client still marks the outcome. Done with you is unchanged: their own team makes the calls and the follow-up.
7. **Words:** "Meta" for the company and the platform. "Facebook" only inside "Facebook Page" and "Facebook feed". "Appointments" or "meetings", never "site visits". "Customer" for the client's buyer. Never "contractor", "agency", "B2B", "patient", "deposit", "Slack" or "pod".
8. **Names:** the presenting CSM's first name on the two covers only. Everyone else is a role: the creative director, the media buyer, the systems team, your caller. The caller in the example call is never named.
9. **Form:** sentence case. No exclamation marks. No em dashes. Plain quotes.
10. **Free-text answers from the forms** are cleaned before they show: phone numbers and emails are removed, prices are removed from service chips, and any line that mentions lead counts, appointment counts, a guarantee or a refund is held back until the CSM edits it in prep.
11. **No other client's material, ever.** No screenshot or recording that shows another client's name, brand, ads, customers, messages or staff. These sales-deck assets are banned in both decks, and the copy test fails on their names: `jr-form-1`, `jr-form-2`, `jr-form-3`, `jr-thanks-phone`, `jr-landing*`, `jr-confirm`, `jr-booked`, `jr-slack`, every `cc-*`, `ads-account`, `ads-twenty-on`, `ads-twenty-off`. (2026-10-20, the CEO) `pcm-academy` and `pcm-lesson` are used only as masked copies in the client success app (`src/present/assets/pcm-academy-masked.webp`, `pcm-lesson-masked.webp`), made from the sales deck's files, which stay untouched (byte-pinned). In the classroom shot, the figure on the Project Closing Mastery cover is blurred and its title kept. In the lesson shot, the top bar is cropped off (the member's avatar and the counts), the outline ends on "04: Uncertainty Objections" (cropped above "05: Closing Deposits", rule 7, since the visual review), and the video frame's slide is blurred (another client's name, in Latin and Arabic). The copy test fails on the unmasked names in the client success app. Anything the customer sees or receives is drawn in deck tokens from this client's data, or drawn as a labelled example. The rule covers the video slots too (2026-10-20): a slot holds Mahara's own recordings only, and a recording that shows another client's name, ads, customers or calendar never goes in one.

## Decision table (binding for both files)

Where `CONTENT.md` and `DESIGN.md` gave the same fact different homes, this table rules. `DESIGN.md` section 8.0 points here.

| Fact or piece | Its one home | Elsewhere, only as |
|---|---|---|
| The call within 5 minutes with the working hours and the night rule, the list, the tries, "not every enquiry books" | L2 stop 3, with the queue card (the card shows the list) | L5's line and thank-you screen say "within 5 minutes during working hours"; L6 plays a call; the mini rail lights stop 3 |
| The WhatsApp confirmation and the reminders | L6 stop 7, after the call | L2 stop 4: one line and five dots, each named in a word or two from L6's timeline (four done with you; the provisional bookings' dot carries its whole line). L7's pie names "Reminders and rebooking" as ours |
| Before the meeting, the messages come from us (one voice to the customer) | L6 stop 7, under the timeline's heading, done for you (the spec review, 2026-10-20) | L10's notes keep only the after-meeting half |
| It lands with the client: calendar, Mahara OS, the WhatsApp alerts (new bookings, cancellations and changes) | L2 stop 5 | L6 stop 8 shows what it carries (the caller's notes) |
| A no-show is ours; a customer thinking it over is followed up by both of us (done for you), and the client marks it | L2 stop 6, the fork, drawn | L9 stop 4: "mark it, the same day", the late check, and that the mark lets us call to rebook. L10: the client's follow-up as one job; its why keeps 'Our caller checks in too.' so the six-jobs card, pasted alone as the group recap, still says the follow-up is shared |
| Who does what, as a share: our three pieces of the work and their one (the meeting and the close), the two roads, "marketing without sales won't grow your business" | L7 (2026-10-20) | L2's lanes show who does each step; L10 lists their jobs. Done with you, the pie splits in halves |
| The sales training: Project Closing Mastery before the first meetings, who takes it, their deals at the check-ins | L8 (2026-10-20) | O6 row 5 is joining the Academy; L11's notes say their deals come to the check-ins |
| The thank-you screen | L5 stop 3 | L2 stop 2 names it in its line |
| What their ads look like, and the swap | L4 | L2 stop 1: one picture |
| The ads' job: their page shows their brand, the ads are there to bring in business (CEO, 2026-10-20) | L3 stop 1 | L4's notes send a preference to L3 |
| We test a lot, fast; most ads get switched off, and that is how the ones that work are found; the numbers decide | L3 stop 2, the field of ad tiles switching off (the field arrives all lit at stop 1; since 2026-10-20 a core stop, no longer the optional proof) | O7 plants it with the red lines ("Your ads are there to bring in business, not to look like your page. We test many ads, fast. Small style changes go into the next round, so your launch keeps moving."); L10's week-to-week job is the action only; L11 is a bar labelled "Finding what works", with "Usually slower, while the ads find your audience." |
| Your input comes first: ideas, a new offer, a new price or a change go in the group before we make the next round | L3 stop 3 | O7's notes, before any ad exists: their ideas, the offer and the facts go into the Blueprint call, or in the group before it |
| Keep the offer steady while we test | L3 stop 3, on screen (since 2026-10-20; it was L3's notes, and before that "Your part") | |
| Red lines | Asked on O7, shown on L3 stop 3 | |
| The check after the ads are made: facts, prices and claims; small style changes go into the next round, so the launch doesn't wait | L3 stop 4 | O7, before any ad exists: "They go live only once you've approved the facts, prices and claims in them." and "Small style changes go into the next round". L4's notes point back to it before the phones ("As we just agreed"): a wrong fact is fixed before it goes live, the rest waits for the next round. L3 comes before L4 since the fixer's round, so the agreement is drawn before the first look |
| More content means more ads to test | L3 stop 5, the why | O6 row 3 is the first upload, before the Blueprint; L10's Drive job is the job, with its own why (fresh projects keep the ads from tiring) |
| The pushback handle, tied to the client's own 90-day goal | L3's notes, the pushback block | The notes window's "Copy reply" on L3, for pushback that comes in the group |
| What was agreed about testing, in writing | The "How we test your ads" line of the group recap (L10's "Copy for the group", also on L13 and after the deck closes) | L3's stamp records the yes in the cockpit; the handle points the client to the line in the group |
| A video for a main part: one slot per part, an empty slot shows nothing on the canvas | The [video slots](#video-slots-ceo-2026-10-20) registry | The recap's "Missed something on the call? Watch:" block (the launch group recap on L10 and L13 and after the deck closes; O6's links) |
| Marking outcomes: came or not, quoted, won with the project's value, a line on why | L9 stop 4, the slide's last stop | L2 stop 7: one picture. L10: one job |
| A customer who cancels or moves the meeting with the client directly: tell us in the group; we change the reminders or call to rebook, never both | L9 stop 4 (2026-10-20; one line again since the fixer's round, which kept the "or") | |
| Open slots (at least 10, at different times) and blocking a day off by the hour | L10, with the calendar week (2026-10-20) | |
| Check-in rhythm: the first a week or two after go-live, then weekly or every two weeks, depending on the plan and how long the client has been with us | L11 | O3, L8 and L13 carry no cadence (L8 says "at your check-ins"; L13's notes book only the first check-in) |
| Money: the ad account's card (first charges, kept funded, tell us first) and payments to us (the dates in the agreement) | L12, "Good to know", under its "Money" head (2026-10-20) | The launch recap's money line, sent every time until the `payments` video is recorded |
| The first weeks are usually slower; leave the ads running | L11's bar | The launch recap's first-weeks line, sent every time until the `first-90-days` video is recorded |
| Group hours and the reply time (within 2 working hours) | O3, at the foot | L12's replies row only when the onboarding deck was never presented |
| The Brand Blueprint, described | O7, the next-step band | O5 stop 4: the name and the booked date |
| Content before the Blueprint | O6 row 3 | |
| The Academy: joining it | O6 row 5 | L8 opens the one course for their meetings; L10's group recap ends with its link |
| "Your one point of contact" | O3 | |
| A laptop, somewhere quiet | L11 notes (check-ins) | |
| An unknown access status | "Not checked yet" | |
| The caller | Unnamed: "the appointments team at {Company}" | |
| The call clock | 0:00 to 4:51, this file's times; "On the call" while it runs, "Call length" over 4:51 once it ends (the visual review: "Call ended" read as a clock time beside "Wednesday, 4 pm") | |
| Call stage 4 | "What sets you apart" | |
| Agreement on L3 | Recorded from the notes window or the A key, after stop 4; a quiet stamp appears after. No button on the canvas | |
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
| `{form.*}` | Onboarding form KFRCXPFx (`forms.onboarding.answers`), read with the `GOALS` patterns and `formAnswer()` in `clientBrief.ts`: `goal90` ("90 Days"), `goal12_24` ("12-24 months"), `challenges` ("TOP 3 challenges"), `why` ("motivated you to join"), `number_one` ("#1 service"), `ideal_project`, `services` (services and prices), `consult_types`, `engineers`, `free_consult`, `instagram`, `areas`, `hours` | Each slide gives its own fallback. `goal90` also picks and fills L3's pushback lines in the notes and its "Copy reply" (2026-10-20), with the same rule as L11, prep's edit first: shown, then the line says the goal; on file but held back while it counts enquiries or appointments, then the line names "what you want from your first 90 days" without saying it; none, then the plain line. |
| `{kickoff.*}` | Kickoff form tG7dnxBn (`forms.kickoff`), read with the `KICKOFF` and `SETUP` patterns in `clientBrief.ts`: `advertised` service, `platforms`, `page_name` ("name of the Facebook page"), `templated` status (Approved, Declined, Waiting On Client, Wants To See Them First), the setup items (card, Facebook access, Mahara OS access, WhatsApp synced, Google Calendar) judged by `SETUP_DONE`, and `pre_existing` leads | The kickoff form is filled on the onboarding call, so before it is filed every setup item reads "Not checked yet". Missing is never shown as done or as to do. |
| `{prep.*}` | New `cockpit_csm_deck_prep` (task_id, deck) `overrides`: `service_focus`, `starter_pack` (the service has a ready starter pack), `goals`, `page_name`, `go_live`, `cover_creative` (a creative marked custom), `dialect`, `project`, `selling_point`, `pain` (delays, design or cost), `budget_band`, `welcome_video`, `booking_video`, `access` (live ticks), `red_lines` (typed on O7), `their_pick` (marked on L4), `form_confirmed` (the Meta form id the CSM ticked as theirs), `call_guide_checked`, `platforms_planned`, `dwy_os_approved`, `creative_agreed_at`, `onboarding_presented_at`, `hidden_slides` | Each slot falls back to the source in its row. `welcome_video` and `booking_video` stay as they are (2026-10-20): they say whether the client's own messages to their customer carry a video about the client (L5 stop 3, L2 stop 4), which is not a deck video. The prep toggle for L3's old optional proof stop (`test-proof` in `shown_slides`) is retired: the field is a core stop now, and a saved `test-proof` is ignored. |
| `{videos.*}` | New `cockpit_csm_deck_videos` (one row per deck, slot and language), read through `cockpit_csm_deck_videos_read` (`VIDEOS.md`): the link, the embed address, the provider, an optional title, the length | A slot with no row in the deck's language and none for any language shows nothing on the canvas, and reads "Not recorded yet" in the notes window and prep. When the read fails, the notes and prep say "Videos could not be read", never "Not recorded yet". A row the browser refuses (its link fails the shape check, `VIDEOS.md` 7) shows nothing on the canvas and reads "This video's link was refused. Save it again in prep.", never "Not recorded yet". |
| `{ads.*}` | New `cockpit_csm_launch_ads` (uploads, with placement, primary text, headline, CTA, language, kind starter or custom), plus `cockpit_csm_client_ads` (built Meta ads, paused ones included) with stills from `cockpit-ad-stills` | Empty phone frames with the logo and Page name, and "We're finishing your first ads". |
| `{funnel.*}` | `cockpit_creative_sources` (table_name `funnels`) through `cockpit_csm_deck_sources`, matched by the exact Meta form id (or ad account id) from this client's own campaigns, never by account name: `kind` (Instant form, WhatsApp, website), `headline`, `questions[{label, options, isGate}]`, `followUpUrl`, the thank-you text | Shown only after the CSM ticks "This is their form" in prep (`prep.form_confirmed`). Then questions typed in prep. Then the drawn example form (DESIGN 7.5), tagged "Example form". Never a real client's screen. |
| `{dosDonts}` | The ClickUp card field "Do's & Don'ts", read through `fetchClientProfile` and `parseDosDonts` (DO and DON'T items only; NOTES never show) | `prep.red_lines` from O7. Else "No red lines written yet. Tell us now and we'll add them to your card." |
| `{links.drive}`, `{links.portal}` | `kit.links` | Drive: "Your folder link is pinned in your WhatsApp group." Portal: portal.maharamedia.com. |
| `{band}`, `{band.answer}`, `{band.note}` | The fictional customer's budget band in the example call: `prep.budget_band`, else the table in `EXAMPLE-CALL.md` by `client.country` (riyals, dinars, dirhams) and the service family's scale | No currency word, the script's own figures. |
| Static links | Leadsie app.leadsie.com/connect/maharamedia/manage (OCF), Academy skool.com/premium-projects-academy-3669 (SD `LINKS.academy`), portal install portal.maharamedia.com/install (SD `LINKS.portalInstall`) | |
| Reused pictures | Only these, copied from the sales deck assets: `portal-overview`, `portal-calls`, `portal-outcome` (EN and AR, Demo workspace), the phone film `mahara-mobile-{lang}.mp4`, and since 2026-10-20 (the CEO) masked copies of `pcm-academy` and `pcm-lesson` on L8 (copy rule 11 says how they are masked), tagged "Academy screenshot". (The `meeting-table` render is no longer used: a generic render read as AI on the client's screen, so journey stop 6 draws the meeting's two outcomes instead, 2026-10-20.) | |
| Drawn pieces | In deck tokens, each tagged (DESIGN 5.4): the WhatsApp group (O3), the queue card (L2 stop 3), the calendar entry (L2 stop 5), the example form and the default thank-you (L2, L5), the WhatsApp confirmation and the reminder timeline (L6 stop 7), the appointment with the caller's notes (L6 stop 8), the field of ad tiles (L3 stops 1 to 5, tagged Illustration). Untagged diagrams, since 2026-10-20: the pie and the two roads (L7), the Academy's course list (L8), the calendar week (L10) | |

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

**Calling hours in the client's own time.** Kuwait, Saudi Arabia, Qatar and Bahrain share the call centre's clock, so the line stays as written. For the UAE (and Oman), add the zone wherever hours show (O3, L2 stop 3, L12's replies row): "10 to 6 Saudi time (11 to 7 in the UAE)".

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

**Video slot:** `welcome` ("Welcome to Mahara"), seeded with the onboarding welcome video. See [Video slots](#video-slots-ceo-2026-10-20).

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
- Line, one line: "Everyone who works on your account is in this one group." (the fixer's round, 2026-10-20: the two-line line listed the roles the rows under it name)
- Drawn as the group they are about to join (DESIGN 9.3): a header with {client.logo} and "Your WhatsApp group", then one row per role, each with what that person messages them about:
  1. "Your client success manager" · "Your one point of contact, for anything."
  2. "The creative director" · "Your brand, your scripts and your ads."
  3. "The media buyer" · "Your campaigns."
  4. "The systems team" · "Mahara OS and your calendar."
  5. "Your caller" · "Questions from the calls: your hours, a holiday, a service detail."
- Foot: "We reply within 2 working hours, 10 to 6, Saturday to Thursday. If something worries you, we call you." (UAE zone per the data map: "We reply within 2 working hours, 10 to 6 Saudi time (11 to 7 in the UAE), Saturday to Thursday.") "Within 2 working hours" added 2026-10-20 (LEAD decision 7, from the Gamma launch deck).

**Slots:** `client.logo`, `client.country` (the UAE suffix), `client.mode` (DWY variant only).

**Notes**
- One sentence per role. Each person messages them about one thing; anything else goes to you.
- Roles, not names. Your own name is on the cover.
- Friday is off. Messages after 6 are answered the next working day. "2 working hours" counts only the hours we work: a message at 5:30 may be answered the next morning.
- Check the group now: whoever handles their schedule and whoever meets the customers should both be in it. Add anyone missing before you move on. (Added 2026-10-20: the Gamma onboarding deck's "WhatsApp group confirmation" and OCF step 5.)

**DWY:** the line is the same (it names no call centre), and row 5 becomes "New-enquiry alerts" · "New enquiries arrive here too, for your callers."

**Sources:** CTX §3 and OCF (the pillars: ads and funnel, appointment conversion, 1-1 support; step 5, the scheduling and consultation people in the group), LCF and PS §9 (one group with the team, hours 10 to 6, Friday off, concerns get a call), GL and LEAD decision 7 (a reply within 2 working hours), GO (WhatsApp group confirmation), PS §8 (the questions the call centre asks), DEC 2026-10-17 (DWY enquiries also go to the client's group), RN.

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
  5. Launch call · {next.launch}, else "About 45 minutes" (was "20 to 30 minutes" until 2026-10-20: the launch deck grew to thirteen slides, about 27 minutes before questions) · then "We walk you through everything that's going live."
  6. First appointments · "After go-live"
- Footer: "Each call is booked at the end of the one before."

**Slots**
- The lit stop comes from the client's stage: on the onboarding call it is always stop 3. If the deck is opened later, Brand Blueprint Booked lights stop 4, and LAUNCH BOOKED or Ready For Launch lights stop 5.
- `next.blueprint`, `next.launch`: a date shows only when the call is booked. Fallback: no date (the launch call says how long it takes instead, "About 45 minutes": CJ's 45 minutes; open question 25). Never an estimate. A step already passed with no date on file reads "Done".

**Notes**
- Stop 4 is the Brand Blueprint call. Name it here; slide 7 says what it is.
- Don't give a launch date unless it's booked. It depends on access, content and approvals.
- As each step finishes, we send the next one to their WhatsApp group.

**DWY:** same on screen. Notes: "Steps 2 to 5 arrive in the group; the first appointments step is yours to run."

**Arabic pass:** reuse the Onboarding Map's own Arabic stop names exactly: توقيع العقد، نموذج التعريف بالنشاط، مكالمة التعريف، بناء الهوية والعرض، مكالمة الإطلاق، أول المواعيد.

**Sources:** OM (the six stops, the launch call's length as 20 to 30 minutes, now superseded by CJ's 45 minutes, phases 2 to 5 sent to the group, phase 6 for DFY only, booking-copy rule), PS §3 (measured signup to launch: median 25 days, so no date is promised).

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
  5. "The Academy" · "Courses for you and your team: your offer, closing your projects, your team and operations. Join, and start with the introduction." (Since the spec review of 2026-10-20: the Academy marks its first course "START HERE", AC.)

**Slots**
- Statuses: `kickoff` setup items (card, Facebook access, Mahara OS access, WhatsApp synced, Google Calendar), `kickoff.pre_existing`, and the Academy line, each judged by `SETUP_DONE`.
- The CSM flips a status on the canvas as each step finishes; it writes `prep.access` with an audit row. The kickoff form stays the record.
- Before the kickoff is filed, every row reads "Not checked yet". Content reads "Not checked yet" until the CSM ticks it.
- Links: Leadsie, `links.portal`, `links.drive` and the Academy, copied from the notes window into the group, in the deck's language: "Meta access (one link): {url}" · "Your Drive folder: {url}" · "The Academy: {url}" · "Mahara OS: {url}" · "Install Mahara OS on your phone: {url}". Since 2026-10-20 the block ends with the onboarding deck's recorded videos, under "Missed something on the call? Watch:" ([Video slots](#video-slots-ceo-2026-10-20)). Until the `testing` video is recorded and shown for this client, one line stands in for O7's plant between the links and the videos (score round 2): "Your ads are there to bring in business. We test many ads, fast, and small style changes go into the next round. Send your red lines in the group." It goes once the video does.
- **Video slots:** `meta-access` ("Meta access") and `whatsapp-calendar` ("WhatsApp and calendar"), both seeded with the Loom guides on Mahara OS's list of guides (MOS, "Guides and video deliverables"). Done with you, `whatsapp-calendar` shows only once `prep.dwy_os_approved` is set (the guide is for Mahara OS).

**Notes**
- Do rows 1 and 2 now, on this call, and tick each one as it finishes. Most clients leave the onboarding call with these still open, and that is what delays a launch.
- Content: say it once, here. The more they upload before the Blueprint, the better the first ads.
- Past enquiries: no promise. Agree on the Blueprint call or in the group whether we call them.
- Anything left open: agree who does it and by when, and write it in the kickoff form.
- Don't link this list to the contract or to any guarantee.

**DWY**
- Row 2 becomes "Your CRM" · "Sign in, and connect your calendar, so bookings land in your real calendar." · ticks: Signed in · Calendar. It shows the Mahara OS row instead only when `prep.dwy_os_approved` is set.
- Add row 6: "Your callers' phones" · "Install the LeadConnector app, sign in and turn on alerts."

**Sources:** OCF (Leadsie, WhatsApp connection, Mahara OS sign-in, Google Calendar, content to Drive, reactivation of old leads, Academy), KF and `clientBrief.ts` `SETUP` (the status fields), PS §3 and §8 (Meta access not done for any of 5 kickoffs, card not funded for 3 of 4, calendar not connected for 4 of 5), O2L Day 4 (the content wording), CTX §3 (ad spend is paid straight to Meta), SD `CLOSING_TOUR` academy (the six courses), AC (the first course, Introduction, is marked START HERE), OM phase 5 (the client watches the course; Mahara does not train their team), MOS (the DWY flow in Mahara OS sits behind per-client approval), DWY SOP §2 (lead alerts), GR (the guarantee terms are never framed here).

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
     - Under all three: "They go live only once you've approved the facts, prices and claims in them." (Changed by the spec review of 2026-10-20: it read "…only once you've approved them.", an open-ended approval L3 then had to narrow. O7 is the only point before any ad exists, so the check is set small here.)
     - Without `prep.starter_pack`, "for {prep.service_focus}" is left out of the first two variants: "Starter ads go live first, from our ready templates."
     - Mid-sentence, a common-noun service keeps sentence case (score round 2): "templates for kitchens", not "for Kitchens". A name whose only capital is its first letter is lowered; one with another capital (a brand) stays as typed. Stop 2's line does the same.
     - The Arabic deck names the service by `prep.service_focus_ar` (typed on O4, the field the launch deck reads too). A service on file only in Latin letters is left unnamed there, as the no-pack variant, so an Arabic line never carries "Kitchens" (the fixer's round, 2026-10-20; the journey's queue card keeps a name in the other script off its rows the same way). Prep says so: "The Arabic deck leaves "{service}" unnamed on this slide. Type its Arabic name on slide 4 to name it."
  2. "The first weeks are a test", then three lines (score round 2: one four-sentence block at body size read dense beside the band's larger head): "Your ads are there to bring in business, not to look like your page." at the body's size, in ink; "We test many ads, fast. Small style changes go into the next round, so your launch keeps moving." small, in ink-2; and the ask, small, in ink, right over the list it fills: "Your red lines stay fixed: tell us now what we must never say or show." Below it, the red lines the CSM types live as the client says them (two or three), in amber. (Changed twice on 2026-10-20 for the CEO's creative flexibility: it read "Your red lines stay fixed. Tell us now what we must never say or show. Everything else, we test.", then "We test many ads and keep your launch moving. …"; the spec review planted the small check as well, so the client hears it before any ad exists. DESIGN 9.7 checks the fit.)
- Next step band: "Next: your Brand Blueprint call · 45 minutes with our creative director: your brand, your offer, your first ad scripts." Then {next.blueprint} once booked.

**On screen (stop 2, optional):** "Your starter ads", tagged once "Starter, from our templates", then "Our ready templates for {prep.service_focus}, under your Page name and logo." (no pack: "Our ready templates, under your Page name and logo."). The L4 phone component (Instagram feed and Reels) with the starter ads under their Page name and logo. Shown only when `prep.starter_pack` is set and starter creatives exist for {prep.service_focus}. No upload or swap here; that is L4.

**Slots:** `kickoff.templated` picks the variant. `prep.service_focus`, `prep.starter_pack`. `prep.red_lines` (typed live; the prep view reminds the CSM to copy them to the card's Do's & Don'ts). `next.blueprint` (Book button in the notes window). `ads.*` kind starter (stop 2).

**Video slot:** `testing` ("Why we test so many ads"), both modes. The same recording as the launch deck's `testing` slot (save the one link to both keys). Not recorded yet. O7 is the onboarding deck's last slide, the one most often rushed, and its plant is the only creative-flexibility line the client hears before any ad exists, so a client the CSM ran out of time with still gets it in O6's "Links for the group".

**Notes**
- Most clients want to see the starter ads first (3 of 4 recent kickoffs). If they do, go to stop 2.
- Approval of starter ads names the ads, the offer and the Page they run under (FCL); what the client checks in an ad is the facts, prices and claims. No answer is not approval.
- Red lines: type them in their words ("never show prices"). They come back on the launch call.
- The testing, in one breath: "We make a lot of ads and switch most of them off, so we can find the ones that work. Your red lines are the part that never changes." Plant it and move on: the launch call sets the rest, and the red lines you type now are what you'll go back to if they push back there.
- Before we make anything: their ideas, the offer and the facts (prices, services, areas) go into the Blueprint call, or in the group before it. That is the easy way to shape the ads before they exist.
- Book the Blueprint before you hang up.
- **Temp check:** "Anything you're unsure about before we book the Blueprint?"

**DWY:** same.

**Sources:** FCL (templates are ready but not every service has an accurate pack; approval must name the asset, offer and identity; no response is not approval; templates are never shown as the client's own work), KF (templated ads status), PS §3 (3 of 4 kickoffs "Wants To See Them First"), PEA (red lines are fixed, everything else is tested), OM and PS §2 (the 45-minute Blueprint with the creative director produces the Brand DNA, the offer and the first scripts), CEO 2026-10-20 (creative flexibility: test a lot, fast; set it before the ads exist; a smooth way to ask before we create; the check as small as possible) and CV (set the guard rails before it becomes an issue; the red lines agreed on the onboarding call are what the launch call goes back to).

---

# Launch deck

Thirteen slides since 2026-10-20 (it was ten), about 28 minutes of a call booked for about 45 (27 until L3 became five stops the same day; L8's two screenshot stops add half a minute), so there is room for questions and the sign-in. Eight slides carry a video slot ([Video slots](#video-slots-ceo-2026-10-20)), so a part the CSM skips for time can still be watched. Visual first. The journey slide is the signature; the partnership pie (L7) is the second drawing the client remembers. The order: L1 cover, L2 journey, L4 ads, L3 creative freedom, L5 form, L6 call, L7 partnership, L8 training, L9 portal, L10 your part, L11 first 90 days, L12 good to know ("Before we go live"), L13 green light.

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
- Frame it: "About 45 minutes, with time for your questions. What goes live, what happens when someone enquires, who does what, and what we need from you. Stop me anytime." (Was "About 25 minutes" until the Gamma pass of 2026-10-20.)
- Ask for their full attention for those minutes.
- If starter ads are already running, say so plainly and use the call to show the whole picture.
- Skip the introduction if you ran their onboarding call.

**DWY:** same.

**Sources:** LCF (the four goals of the call, the first-two-minutes frame), CJ (the launch call is 45 minutes; OM's 20 to 30 is superseded since the deck grew), FCL (a launch can come before the launch call; template imagery is never shown as the client's brand).

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
| 3 | We call | Our team | "We call new enquiries within 5 minutes during working hours, 10 to 6, Saturday to Thursday. Anything that comes in at night is called from 10 the next working morning." "5 minutes" is underlined in teal, as L5's thank-you band marks it, so the promise reads the same on both slides (score round 2). Chip: "Up to 4 tries over 3 working days". Small line: "Not every enquiry books. Some can't be reached, some aren't a fit. Our caller notes why, and we go through it with you at check-ins." | The queue card (DESIGN 6.5), tagged Example: it shows the list, the new enquiry first. Each row names its own service from `prep.services` (`prep.services_ar` in Arabic); a row past the list leaves its service out, never repeats the first (score round 2) | UAE: "We call new enquiries within 5 minutes during working hours, 10 to 6 Saudi time (11 to 7 in the UAE), Saturday to Thursday. Anything that comes in at night is called from 10 the next working morning." |
| 4 | Booked, confirmed, reminded | Our team | "The serious ones are booked in, confirmed on WhatsApp and reminded before the meeting." With `prep.booking_video`: "The serious ones are booked in, confirmed on WhatsApp with a short video about you, and reminded before the meeting." | Five dots on a short line, each named in a word or two from L6's timeline (the full timeline is on L6). Every row leads with its time in bold ("Booked", "The day before", "Before the meeting", "2 hours before") and the meeting, the end, is bold whole (the fixer's round, 2026-10-20) | `booking_video` defaults to off. |
| 5 | Lands with you | You | "Once it's confirmed, it lands in your calendar and in Mahara OS. WhatsApp alerts tell you about new bookings, cancellations and changes." (changed 2026-10-20, LEAD decision 5: it said "and you get a WhatsApp alert") | The drawn calendar entry (DESIGN 6.5), tagged Example | If the kickoff says Google Calendar is not connected, an amber line: "Connect Google Calendar in Mahara OS so bookings land there." |
| 6 | You meet | You | "You hold the meeting: {form.consult_types}." Then the fork: "Didn't show? Ours. We call to rebook." · "Came, still thinking it over? Both of us. We call to follow up, and so do you: you know them best. Then mark it." | The fork's two ends, each node on its name's first line, each with its mark (the lanes' rebook mark on ours: a ring with a circular arrow, its head drawn, the same in the lanes, here and on L9 stop 4); a dotted line returns to the "Our team" lane, its node named "Didn't show?" (the no-show has one name everywhere: the CRM's stage is "Didn't show") | `form.consult_types` fallback: "at your office, at their home, or online". |
| 7 | You mark it | You | "You mark how it went, in a few taps." | `portal-outcome`, cropped to the form's two parts (attended or not, where the deal stands) in one frame, the empty band and rule between them cut out so the form reads about a tenth larger, Demo workspace | |

Stops 1, 2, 4 and 7 open up on later slides (L4, L5, L6 and L9), so their lines stay short. Stops 3, 5 and 6 carry their full facts here and nowhere else. Stop 6's meeting is where L7's pie hands the client their piece, and L8 lights it on the mini rail.

**Notes**
- Walk the stops with the arrow keys. Let each one land before you speak. The mini rail on the next slides makes the callback; don't announce it.
- At stop 3, say it plainly: we call new enquiries within 5 minutes during working hours, 10 to 6, Saturday to Thursday (11 to 7 for a UAE client), and anything that comes in at night is called from 10 the next working morning. Then up to 4 tries over 3 working days.
- At stop 6, point at the dotted line: a no-show comes back to us, and we call to rebook.
- Someone who came and is thinking it over is followed up by both sides: our caller calls them, and the client follows up too, because they met the customer and know them best. The client still marks the outcome.
- **Temp check** after stop 7: "Any step here you'd want done differently?"

**DWY variant (stops that change).** Stops 3 and 4 move into the "You" lane. Notes: their team calls within 5 minutes of the alert, and books; the no-show line and the follow-up of someone thinking it over stay in their lane too.

| # | Row name | Line |
|---|---|---|
| 3 | Your team calls | "A new-enquiry alert reaches your callers' phones and your WhatsApp group. Call within 5 minutes. Up to 4 tries over 3 working days." |
| 4 | Your team books | "Book on the right calendar. The confirmation goes out by itself." |
| 5 | Lands with you | "It lands in your calendar and your CRM, with your caller's notes." |
| 6 | You meet | Fork: "Didn't show? The follow-up messages start by themselves." · "Came, still thinking it over? Follow up, then move it to the right stage." The dotted line stays in the "You" lane. (Unchanged by the CEO's answer of 2026-10-20: done with you, their own team makes the calls.) |
| 7 | You mark it | "Your team moves it to the right stage in the CRM, the same day." |

**Video slot:** `start-to-finish` ("How it works, start to finish"), done for you only: a done-with-you journey would need its own recording. Not recorded yet.

**Sources:** CEO (the call within 5 minutes during working hours, for all; the shared follow-up after a meeting, done for you), CPM (the client-side steps, the WhatsApp alert, the no-show is ours), DOM and CCD (10:00 to 18:00 Saturday to Thursday, Friday off, new enquiries to the top of the queue, the 4-try ladder, a reason noted on every lost enquiry, 45% of enquiries with no verified dial, median first dial 163 working minutes: the measured figures behind open question 1, unchanged by its answer), LAF (Main bookings notify the client; Provisional bookings are internal until confirmed), BR (WhatsApp confirmation on booking), PS §2 and §4 (thank-you video on booking, consultation types), CRF ("results fine but unhappy" when expectations are off), DWY SOP §2 to §5 (alerts, calendars, CRM stages), MOS (the DWY flow in Mahara OS needs per-client approval), DEC 2026-10-17 (DWY enquiries also go to the client's group).

## L3 · `creative-freedom` (creative flexibility, reworked 2026-10-20)

**Title:** Your red lines are fixed. The rest, we test.
**Time:** 3 minutes (2.5 until 2026-10-20: the optional proof became a core stop, and two stops were added)

The CEO, 2026-10-20: "Creative flexibility is a big expectation", with "a smooth way for them to ask before they create it", and the check after "as small as possible", because the more volume we test, the better the ads. O7 sets it before any ad exists; this slide sets it in full before the ads go live. Since the fixer's round (2026-10-20) it comes before the ads slide, not after it: the guard rails are agreed before the client sees a single ad, which is the coach's point the CEO adopted (the first look is when the small-change requests start), and L4's notes point back to it ("As we just agreed").

**One slide, five stops** (the lead offered one slide or two). One drawing, the field of ad tiles, carries all five stops (DESIGN 21.1): it arrives all lit, and each press changes one thing in a picture that stays put, so the slide holds the five calmly. Two slides would split the field from the deal it explains, and make the deck fourteen slides.

**On screen:** the title (H2, unchanged, no eyebrow) over two columns: the stop's words on the start side under the stop's name (H3), and the field on the end side, tagged "Illustration" from stop 1.

**Stops**

| # | Name (H3) | Words | Picture |
|---|---|---|---|
| 1 | Your ads have one job | "Your page shows your brand. Your ads are there to bring in business: enquiries from people who don't know you yet." Small line: "They show in people's feeds, marked Sponsored, not as posts on your page." (the fixer's round: "never on your page" was an absolute a client could test against their own Page when a page post is promoted) | The field of ad tiles, all eighteen lit: many versions, before any test. Tagged "Illustration" |
| 2 | We test a lot, fast | "We make many versions and switch most of them off. That's how we find the few that work." Small line: "Each one tries something different: the hook, the angle, the format or who's on camera." Then: "Your pick runs too, beside the ones you'd skip. The numbers tell us which work." | At the press, fifteen tiles switch off and three stay lit. When their pick is marked (in prep, or on L4 in an earlier pass), its picture runs on one of the three lit tiles, with the star: the sentence is drawn, not only said |
| 3 | Your input comes first | The amber panel, "Fixed: your red lines": two groups headed "Never" and "Always" (score round 2: "You told us:" had headed the card's DON'Ts too). Under "Never", the lines typed on O7 first, each with a small "you told us" after it in ink-3, then the card's DON'Ts; under "Always", the card's DO items (and a typed line that starts "Always"). A card line in the other script than the deck's (an English Do's & Don'ts line in the Arabic deck) goes under a third head, "From your card", quoted as written, never mixed into the deck's groups. A line typed on O7 and then copied to the card (as prep asks) shows once, as theirs. Then "We never cross these." Under the panel: "Ideas, a new offer, a new price, something to change? Send it in the group before we make the next round." Small line: "Keep your offer steady while a test runs. A new offer starts the test again." | The field rests. Under it, the next round, drawn ahead (dotted), named "Next round" |
| 4 | Then a quick check, not a redesign | The stop's hero, one line under its name: "Facts · Prices · Claims", and under it, small, "You check these in the group before an ad goes live." Then: "Small style changes go into the next round, so your launch doesn't wait." (The fixer's round merged the two small lines that said the same thing.) | One tile of the next round drawn solid, named "Your style change" |
| 5 | Keep the content coming | "Send new photos and videos of your projects whenever you can. More content means more ads to test." Small line: "Your folder link is pinned in your WhatsApp group." | The next round fills: its tiles are made |

After stop 4, once the CSM records the client's yes: the quiet stamp "Agreed to test this way · {date}" on the title row, at its end edge, in the text face (not the mono tags'), on any stop. Nothing shows before that.

**Left the canvas on 2026-10-20**, and where each went: "The polished work belongs in your page's own posts." (stop 1's notes); the "Open: everything else we test" column and its five chips (stop 2's small line names four, and "Thumbnails" is said); "Anything wrong or off-brand, we fix." (stop 4's notes, which say what counts); "Prefer something different later? Ask, and we'll launch it too." (stop 4 says it with the reason, a style change goes into the next round, and the notes keep PEA's "a preference gets launched" as the way out: their version runs beside the others in the next round); the optional "How a test runs" stop and its caption "One campaign, 20 versions side by side. Some stay on, some go off." (now stops 1 and 2, with no count: "20" was one real account's snapshot, and "most switch off" is the CEO's point, not that ratio). "Keep the offer steady" moved from the notes to stop 3, as the lead asked. Since the spec review the same day, stop 1's feed phone is gone too: the ads slide shows the feed, and the field, the slide's own picture, now arrives with the slide. The fixer's round took off stop 4's "You approve your ads in the group." (merged into the check's line) and stop 2's thumbnail beside the words (their pick now runs on a lit tile).

**Slots:** `dosDonts`, `prep.red_lines`, `prep.their_pick` (without one, stop 2's line reads "The ones you'd pick run too, beside the ones you'd skip. The numbers tell us which work."), `prep.creative_agreed_at` (written with an audit row from the notes window, "We agree to test this way", or the A key; the stamp records the conversation, not a contract term), `form.goal90` with `prep.goals` (notes and the "Copy reply" only). The goal picks one of three pushback lines, `{goalAsk}`: (a) a goal shown under L11's rule fills `{goal}`; (b) a goal on file but held back, because it counts enquiries or appointments, gives the line that names their goal without saying it; (c) no goal at all gives the plain line. Stop 5 never shows the Drive link itself; its line says where the link is.

**Video slot:** `testing` ("Why we test so many ads"), both modes. Not recorded yet, and the first to record (open question 31). The onboarding deck's `testing` slot (O7) takes the same recording.

**Notes**
- Stop 1: "Your brand matters, and your page is where it shows. It stays as polished as you like. The ads have a different goal: revenue for your business, not looking like your page. They're for people who don't know you yet." The polished work belongs in their page's own posts. A content plan for their page is a separate conversation; don't promise it here. (The on-screen copy stays as it is.)
- Stop 2: say it before they see it happen. Most ads get switched off; that's how testing works, not a sign that something went wrong. No numbers: no win rate, no "one in ten", no count of ads a month. If their pick is already marked, its picture is on one of the lit tiles, with the star; if not, they choose one on the next slide. If they ask what changes from one version to the next: the hook, the angle, the format, the thumbnail, who's on camera.
- Stop 3: concede first. Read their red lines out, then ask: "Anything else we must never say or show?" Add it to their card's Do's & Don'ts after the call. Then the smooth way to ask: ideas, a new offer, a new price or a change go in the group before we make the next round, so they are in the ads from the start, and we answer with the reason.
- Stop 3, the offer: "Want to change the offer? Ask in the group first. A new offer mid-test starts the test again; if you ask first, we can plan it in."
- Stop 4, set it before they see the ads, in your own words: "On the next slide you'll see your ads, and you'll want to change small things. We'll keep those for the next round, so your launch doesn't wait."
- Stop 4: a wrong fact, price or claim is different: we fix it before the ad goes live. So is anything that breaks their red lines or gets their name, logo or colours wrong. Any matter of taste, small or large, goes into the next round.
- Stop 4, why it stays small: "An ad held back for a small change is an ad we're not testing, and testing more is how we find the ones that work." The same holds for the rounds after launch.
- **If they push back**, now or when the ads reach the group (the notes window keeps these lines, and the four after the reply below, under one "If they push back" disclosure, apart from the stop-by-stop track, which is grouped under the five stops' names with the current stop open):
  1. Go back to what you both agreed: their red lines from the onboarding call, and the quick check agreed on this call (the "How we test your ads" line in the group recap). "Let me pull up what we agreed."
  2. Then, warmly: "The last thing we want is to hold your launch for a small change."
  3. Then ask {goalAsk}:
     - (a) Goal shown: "You told us your goal is "{goal}". What matters more: this one change, or getting the ads live so we can get there?" The goal is quoted, never spliced into the sentence, so a goal written as "We want…" still reads; the notes window sets it on its own line (see below).
     - (b) Goal on file but held back: "You told us what you want from your first 90 days. What matters more: this one change, or getting the ads live so we can work towards it?"
     - (c) No goal at all: "What matters more to you: this one change, or getting the ads live?"
  4. After their answer: "Great, let's get them live. Your change goes into the next round." Then write the change in the group, so they see it kept.
  5. If the change still matters more to them and it is a matter of taste: "Then we'll make your version too and run it beside the others in the next round. The numbers tell us which works." Never hold the launch for it.
  Never "we won't do it": the change isn't refused, it waits for the next round. A wrong fact, price or claim is not pushback: fix it before the ad goes live.
- **Pushback in the group, after the call:** the notes window's "Copy reply" on this slide (and in prep's slide 3 panel) copies one line in the deck's language, picked like `{goalAsk}`:
  - (a) "Thanks, noted. You told us your goal is "{goal}", so we'd rather not hold your ads for a small style change: it goes into the next round. If a fact, price or claim is wrong, tell us and we'll fix it before the ad goes live."
  - (b) "Thanks, noted. You told us what you want from your first 90 days, so we'd rather not hold your ads for a small style change: it goes into the next round. If a fact, price or claim is wrong, tell us and we'll fix it before the ad goes live."
  - (c) "Thanks, noted. We'd rather not hold your ads for a small style change: it goes into the next round. If a fact, price or claim is wrong, tell us and we'll fix it before the ad goes live."
- Don't back it with numbers: no count of clients, no results, no "after working with X clients".
- If they want to hold an ad back until it's perfect: "An ad waiting for the perfect version earns nothing while it waits."
- The close, in your own words: "You came to us for performance. We'd rather protect that than protect a look."
- Stop 5: content is said once here, with the why; slide 10 has it as a job. The more they send, the more versions we can make.
- **Temp check:** "Can we agree to test this way?" Record it only when they say yes.

**DWY:** same on screen. Notes: "Your team runs the calls, but the ads work the same way: your red lines, the quick check and the next round are the same."

**Changed by the fixer's round (2026-10-20):** the slide moved before the ads (it was after them); stop 1's small line lost its absolute; stop 2 draws their pick on a lit tile; stop 4's three words are its hero and its two small lines are one; the notes window groups the notes by stop and folds the pushback handle.

**Changed by the spec review of creative flexibility (2026-10-20):** the field is the picture from stop 1, arriving all lit, and stop 2 is the switch-off alone (DESIGN 21.1); stop 3 names a new price among the inputs; stop 4's check is one line, "Facts · Prices · Claims"; the stamp sits at the words column's end edge. In the notes: stop 1 says the CEO's contrast plainly; stop 4 says why the check stays small and what counts as more than taste (red lines, their name, logo or colours); the pushback goes back to both agreements (the red lines, and the quick check now written in the group recap), opens warmly, asks with one of three goal lines, closes, offers their version in the next round as the way out, and has a written reply for the group.

**Sources:** CEO 2026-10-20 (creative flexibility is a big expectation; a smooth way to ask before we create; the check as small as possible because volume finds the better ads; most ads get switched off, so we test more and faster; keep sending new content; "you do have a brand on social media … but that's not the goal. The goal is to drive revenue to the business"), CV (set the guard rails before it becomes an issue: on the launch call, before the ads go live, say they will want small changes and that we favour speed; on pushback, go back to what was agreed, say the last thing you want is to delay their launch, ask what matters more, the edit or the outcome they named, and on their answer "let's get them live"; used for the method only, its numbers and its "we won't do it" are left out), LEAD 2026-10-20 (the five stops, the field, the handle tied to {form.goal90}, the offer on stop 3 or 4), PEA (paid ads are dark posts and never reach the grid; concede the real cases first; volume is the mechanism; polish belongs in organic content; wrong or off-brand gets fixed, a preference gets launched; the close line), FCL (approval covers the pack, its copy variants and allowed adaptation; Meta review may take longer), LCF (trust the process, decide on data, not taste), the Do's & Don'ts card field, WC ("what we're testing", never "the bet"), PS §8 and LEAD decision 4 (the offer kept steady while we test), CSMT (keep the folder full), O2L Day 4 (photos and videos of their projects).

## L4 · `ads`

**Title:** Your ads
**Time:** 2.5 minutes (3 until the spec review of 2026-10-20, which gave 30 seconds to L10)

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
- Mark their pick with M or the star in the notes window. It is starred here, and on L3's lit tile when the deck goes back to it.

**Notes**
- Point back before you show them: "As we just agreed: a wrong fact, price or claim we fix before it goes live, and the rest goes into the next round. Tell me as we go." (The spec review of 2026-10-20 put the guard rail before the review; the fixer's round moved the whole agreement, L3, before this slide.)
- Let them choose: "Which one would stop you scrolling?" Mark it. Their pick runs beside the others, as the slide before said.
- Swap one live, so they see how each creative looks in the feed.
- A wrong fact (a price, a service, an area): write it down; we fix it before it goes live.
- A preference: write it down for the next round, as you just agreed.
- This preview isn't approval.

**DWY:** same.

**Arabic pass:** use Meta's own Arabic labels for "Sponsored" and the CTAs.

**Sources:** CEO brief (upload and swap their ads, show what they will look like), FCL (templates labelled, never shown as the client's work; preview is not approval; the identity the ad runs under; Meta review may take longer than a swap), PS §3 (3 of 4 want to see the ads first), scout csm §2 and §E (Meta stills, paused ads, the upload design), PS §1 (almost everything runs on Meta: client_leads Meta 7,250, TikTok 16, Google 1).

## L5 · `form`

**Title:** Your form
**Time:** 1.5 minutes

**On screen**
- Eyebrow: "Your customer sees this"
- Title: "Your form"
- Line: "What they answer before we call. Questions marked 'Filters' screen out people who aren't a fit." DWY: "What they answer before your team calls. Questions marked 'Filters' screen out people who aren't a fit."
- One phone, screen by screen, walked with the arrow keys.
- Gate questions carry the word "Filters" in teal (a word, not a pill).
- When the destination is a website: the label "Your page" and the page in the phone (a screenshot from prep, or the live page).

**Stops (the phone's screens)**
1. Opening · {funnel.headline}
2. The questions · each {label} with its options, gates tagged
3. The thank-you screen · "Then your thank-you screen, and a welcome message." With `prep.welcome_video`: "Then your thank-you screen, and a welcome message with a short video about you." Done for you, the same line goes on: "Our team calls them within 5 minutes during working hours." (the visual review, 2026-10-20: the promise sat only inside the phone, too small to read on a Zoom share; done with you, the line stops after the message). The screen is their form's thank-you, or the default: "Thank you. Our team will call you within 5 minutes during working hours." A video frame shows only when `welcome_video` is on.

**Slots**
- `funnel.*` once `prep.form_confirmed`, with `prep` questions overriding.
- No confirmed form and no prep questions: the slide is hidden by default, and prep says why. If the CSM shows it anyway, the phone draws the example form (DESIGN 7.5), tagged "Example form", with the line "We're finishing yours."
- When `funnel.kind` is WhatsApp, the line becomes: "Your ad opens a WhatsApp chat." Check the destination with the media buyer before the call. The phone shows the chat with the message the ad fills in, waiting to send, tagged "Example wording": "Hi, I saw your ad. I'd like to know more about {service}." (no service: "Hi, I saw your ad and I'd like to know more."). Beside it, "What happens next": 1. "Their first message is ready in the chat. They tap send." 2. "It arrives on your WhatsApp." 3. "Our team calls them within 5 minutes during working hours." (DWY: "Your team calls them.")

**Notes**
- Read the filter questions out: "This is the first filter. The call is the second."
- Check the facts with them: service names, areas, wording.
- If they want more questions: every extra question also loses some good people. We add one when the enquiries show we need it.
- The thank-you screen and the WhatsApp steps promise the call within 5 minutes during working hours, the same promise as the journey. A customer who writes at night sees "during working hours" and is called from 10 the next working morning.

**DWY:** same.

**Sources:** scout csm (the funnels source and its fields, `FormPreview` and `leadForm.ts`; the account-name match is fuzzy), PEA (friction: add a question only once the enquiries are proven wrong), DESIGN 14 (the default thank-you), CEO (the 5 minutes, said with the working hours).

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
- Stop 7, after the call (score round 2: the transcript goes here, since the call card already says the call ended; its faded last line was a fourth thing to sort):
  - The WhatsApp confirmation from {client.name}, labelled "Example wording" (EXAMPLE-CALL.md)
  - A heading, "What we do before the meeting", over the timeline: Booked · a WhatsApp confirmation · The day before · a reminder · Before the meeting · a call to confirm · 2 hours before · an SMS · The meeting (each row leads with its when; the meeting ends it in bold; the fixer's round, 2026-10-20)
  - Under the heading, one line in ink-2 (the spec review, 2026-10-20; the launch call SOP's third expectation): "Before the meeting, the messages come from us, so your customer hears one voice." Done for you only.
- Stop 8, what lands with you: the appointment as it reaches them, tagged Example: "New appointment" · Abu Fahad · {day}, {time} · {place} · {service}, then "Our caller's notes": "Planning it for six months, wants to start soon. Budget: {band.note}. {pain note}" Over the cards, the stop's lead: "Everything our caller learned lands with you." (the fixer's round: the caption under the card repeated the notes' own label), and the call card and the appointment sit together in the middle of the room above the rail. Once the call has ended, the call card's length is in the deck's digits (٤:٥١ in Arabic); the running clock keeps Latin digits (DESIGN 13.4).
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
- At stop 7, the reminders: say them once, as what we do before the meeting. Then the line under the heading: ask them not to message the customer from their own WhatsApp before the meeting. Two voices confuse the customer. (Moved here from L10's notes, 2026-10-20.)
- At stop 8: "Everything the caller learned comes to you, so you walk in knowing the project."
- "You'll hear your own real calls in Mahara OS." (Since 2026-10-20 the portal is three slides on, after the partnership and the training, so the note no longer says "I'll show you next".)
- Never play a recording of another client's call.
- **Temp check:** "Is that how you'd want your customers spoken to? Anything we should never say?"

**DWY variant**
- Title: "How your team should call"
- Label: "The customer in it is made up. The full script is in the playbook we give you."
- The call card's Arabic reads اتصال باسم {client.name} (نتصل باسم would say we call); the English stays "Calling for {client.name}".
- The stage rail and the transcript stay the same.
- Stop 7: "Book on the right calendar, and the confirmation goes out by itself." Timeline heading "Before the meeting": Booked: a confirmation · Reminders before the meeting · Provisional bookings: your team calls 48 and 24 hours before · The meeting. No one-voice line: their own team sends the messages.
- Stop 8: the same card in the CRM, its notes headed "Your caller's notes", its lead "It lands in your CRM."
- Links in the notes window: their calling playbook (the DWY SOP copy on their card) and the sample script (`SCRIPTS_DOC`).

**Video slot:** `call-team` ("How our call team works"), done for you only: done with you, their own team calls. Not recorded yet. Never a recording of a real customer call (EX: no consent exists).

**Sources:** CS (sections 01 to 06, and the 07 answers to "how much does it cost?" and "I don't have a budget yet"), FW (prices, experience and guarantees come only from the client's guide; no deposits unless the client's policy says so), PB (the confirmation call: the evening before for morning meetings, the morning of for afternoon ones; 48-hour call for provisional slots), BR (WhatsApp confirmation on booking, a reminder the day before, an SMS 2 hours before; the confirmation's structure), EX (the median booking call is 291 seconds, used for pacing only; no consent exists to play real calls), CCD (a mandatory note on every call outcome; "Feedback for the client" posted to the portal per appointment), SD `CALLS_TOUR` stages (names adapted for clients), KB (the call guide lives in the client's portal Knowledge area; the new-client automation is not yet observed on a genuinely new form; an edited starter page gets a separate review page), LCF (the launch call SOP's expectations: the customer should not get messages from the client's own WhatsApp before the meeting), DWY SOP §4.

## L7 · `partnership` (new, 2026-10-20)

**Title:** We bring them to your door. You win the project.
**Time:** 2.5 minutes

The CEO's "piece of the pie" (the Gamma launch deck's "You do / We do" and "Paid ad vs referral" pictures), redrawn in deck tokens. It comes straight after the call, where the slide before ended on what lands with the client, so the split follows the moment the booking reaches them.

**On screen**
- No eyebrow. The title is set in two lines and arrives in two stops: "We bring them to your door." (stop 1, in our teal) and "You win the project." (stop 2, in ink).
- The pie (DESIGN 20.3), as the Gamma draws it: two pieces. Ours is one piece, three quarters of the disc; theirs is the last quarter, pulled out of the pie. One cut between them, no percentages, no numbers, no legend box.
- Beside our piece, under the owner name "Our team" (teal, set as the journey's lane heads), the three things it holds, in a short stack with one leader into the piece. Beside theirs, "You" (ink) over its one name, with one leader. Two leaders on the slide, not four.

**Stops**

| # | What changes | Copy |
|---|---|---|
| 1 | Title line 1. The pie, whole: our piece lit and named, theirs drawn quiet in its place, unnamed | Title line 1: "We bring them to your door." Under "Our team": "Ads and enquiries" · "Calls and bookings" · "Reminders and rebooking" |
| 2 | Title line 2. Their piece is lit and pulled out of the pie | Title line 2: "You win the project." Under "You": "The meeting and the close" |
| 3 | The pie gives way to the two roads (DESIGN 20.4), and a caption under the title | Road 1: "An enquiry from your ad", its reasons written on its own bends, "Meeting you for the first time" over its first crest and "Comparing you with others" over its last crest (the fixer's round, 2026-10-20: the line under the road's name sat away from the drawing that says it; score round 2: under a later dip it sat nearer the referral road than its own bend) Road 2: "A referral" · "Already trusts you." Both roads end at "Your meeting", then "Signed project". Caption: "The enquiries we bring take the longer road." |
| 4 | One line under a hairline at the foot. On the roads, the meeting and the signed project light in the client's ink | "We can't close for you. We can help you get better at it." |

**Slots:** `client.mode` (the done-with-you pie and title). Nothing else: the slide is the same for every client, on purpose.

**Notes**
- Stop 1: "This piece is ours: the ads and the enquiries, the calls and the bookings, the reminders, and rebooking anyone who doesn't show."
- Stop 2: "This piece is yours, and it's the one that pays: the meeting and the close." Let it land. This is the CEO's piece of the pie.
- Stop 3: "Someone who comes through a referral already trusts you. Someone from an ad is meeting you for the first time and comparing you with others. Expect more questions, more follow-up and a longer road to a signature."
- Don't put a number on it: no close rate, no "most sales come after the third contact", no count of the firms they compare, and never "three quarters of the work".
- Stop 4: "Marketing without sales won't grow your business. We bring them to the door, and we can't sign them for you." The next slide is how we help.
- When a client later says the enquiries are poor, come back to this slide: a customer from an ad is a different sale from a referral.
- **Temp check:** "Anything here you thought was ours?"

**DWY variant**
- Title: "We bring you the enquiries." (stop 1, teal) · "Your team books them and wins the project." (stop 2, ink). Each line stays on one line at 1920 x 1080 in English and Arabic; `deck-shots.mjs` fails a shot where it wraps.
- The pie splits by owner, in halves (the spec review, 2026-10-20): ours is the end half, twelve to six, under "Our team": "Ads and enquiries" and "Confirmations and reminders" (the messages that go out by themselves). Theirs is the start half, six to twelve, under "Your team": "Calls and bookings" and "The meeting and the close", drawn ahead at stop 1 and pulled out together at stop 2. Journey order lives on L2's lanes, not on the pie.
- Stops 3 and 4 are the same.
- Notes: "Your team holds half the work: the calls and bookings, and the meeting and the close. The ads, the enquiries and the messages that go out by themselves are ours."

**Video slot:** `winning` ("Your part in winning the project"): the pie, the two roads, and why the people who meet the customers take Project Closing Mastery before the first meetings. It covers the training slide too, which has no slot of its own. Done for you only (the done-with-you pie splits in halves). Not recorded yet.

**Changed by the spec review (2026-10-20):** the pie is two pieces, not four equal ones (four with a leader each is the stock segmented-cycle infographic, and clockwise journey order read as a loop back to the ads); the roads lost "A longer road" and "A shorter road" (the drawing and the caption say it); stop 4 shows one line, and "Marketing without sales won't grow your business." is said; done with you, the pie splits by owner in halves.

**Sources:** GL ("Important to know": marketing without sales won't help you grow, closing cold enquiries is harder than referrals, we can bring them through the door but can't close them; the "You do / We do" pie, We do: leads, bookings, shows, You do: closes; the "Paid ad vs referral" picture, its two roads to the same meeting), OCF step 11 (referrals against cold enquiries: they don't already know, like and trust you) and its frame (marketing without sales won't get them to their goal), CJ (the lead quality myth; "if leads are showing and qualified, it is a closing problem"), CPM and CEO (a no-show is ours to rebook), DWY SOP §2 to §5 (their team calls and books; confirmations and no-show messages go out by themselves), LEAD (decision 1).

## L8 · `training` (new, 2026-10-20)

**Title:** Your sales training
**Time:** 2 minutes (1.5 until the spec review of 2026-10-20 added the Academy's two screenshots)

**On screen**
- Title: "Your sales training"
- Lead, across the slide: "Enquiries from ads are meeting you for the first time. This course shows you how to win them." (the fixer's round, 2026-10-20: the slide now says why; it read "The course for your meetings, in the Premium Projects Academy.") Over the course list, its small label: "Premium Projects Academy".
- The six courses as a list, in the Academy's own order and with its own numbers (the client finds them that way in the Academy): 1 "Introduction" · 2 "Onboarding" · 3 "Google optimisation" · 4 "Offer creation" · 5 "Project Closing Mastery" · 6 "Team and operations". The quiet rows are the number and the name only. Course 5 is lit, its name at H3, and opens into what it teaches: a small label "What it teaches" over a short line with four nodes, "The consultation" · "The proposal" · "The objections" · "The close". These are the sales deck's summary of the course, not its section names, and the label says so.
- Beside the list, one thing at a time (three stops; the list stays put on all three):
  1. The Academy's classroom, as the sales deck shows it (masked, copy rule 11), tagged "Academy screenshot". Project Closing Mastery's tile is ringed in teal, and a short leader runs from the lit course on the list to the screenshot's edge, level with the course's name (the fixer's round; score round 2: run on along the gap between the tiles' rows, it lay on the neighbouring tile's edge, so the wrong course looked ringed). The teal ring alone marks the tile.
  2. A Project Closing Mastery lesson, as the sales deck shows it (masked: the top bar cropped off, the video's slide blurred), tagged "Academy screenshot", cropped to the course outline (down to its first objection) and the lesson's title, the cut in the video's dark ground so no word is cut, and drawn about 1.3 times larger (the fixer's round: the section names, "07: Objections 101" and "01: 'It's too expensive'", are the proof). Its course outline opens on "01: Sales Crash Course".
  3. Two short statements:
     1. "Before your first meetings" · "Everyone who meets your customers or sends the quotes watches it, starting with the sales crash course."
     2. "Your real deals" · "At your check-ins, we go through your meetings with you: what closed, and what to change."
     Then the foot: "The link is in your WhatsApp group."
- Mini rail: stop 6, "You meet", lit.
- The screenshots' alt text: "The Academy's six courses" and "A lesson inside Project Closing Mastery" (the sales deck's, the second made exact).

**Slots:** none on the canvas. The notes window copies "The Academy: {url}" (`GROUP_LINKS.academy`, `LINKS.academy`) for the CSM to paste into the group.

**Notes**
- Stop 1, the classroom: "This is the Academy as you'll see it. The course for your meetings is the fifth one, Project Closing Mastery."
- Stop 2, the lesson: "Inside, it opens on the sales crash course. Start there."
- Why it matters, in your words: a referral already trusts them; a customer from an ad needs a proper consultation and a quote they can compare.
- Stop 3: ask who meets the customers and who sends the quotes. Those people take the course.
- Copy the Academy link into the group now, from the notes window.
- Inside Project Closing Mastery, as the Academy names its sections: a sales crash course (start there), objections, follow-ups and bonus lessons (the no-show protocol is one of them). The four words on the slide are what the course walks them through, not its section names.
- Its follow-ups section: "It's for the ones thinking it over, which you now share with us."
- The Academy is self-paced. We don't run training sessions for their staff; their deals come to the check-ins, and you can offer a call on a stuck deal.
- No promise about results: don't say the course makes them close more.
- If they say they already sell well: "Good. This is for customers from ads, who don't know you yet. Most firms are used to referrals."
- **Temp check:** "Who on your team will watch it first?"

**DWY:** same. Their callers' script and playbook are on L6; this slide is for whoever meets the customers.

**Video slot:** none. The course is the video here, and its link is already in the recap's course line; a slot would say the same link twice. The partnership slot (L7) says why the course comes before the first meetings.

**Pictures:** The Academy's classroom (masked) and a Project Closing Mastery lesson (masked), as the sales deck shows them, beside the course list. Tagged as Academy screenshots. The CEO, 2026-10-20: "add screenshots of the project closing mastery in skool as well same as the sales pitch deck". The masked copies live in the client success app (copy rule 11 says what is blurred or cropped); the sales deck's own files stay untouched. The course list stays drawn (DESIGN 20.5): it is what the client reads on a shared screen, and the screenshots show it is real.

**Changed by the spec review (2026-10-20):** the four words are labelled "What it teaches" (they are not the course's sections, so "starting with the consultation" pointed at a section that doesn't exist); "when" and "who" became one statement, ending on where to start, the sales crash course; the lead names the course once instead of repeating the list ("Six courses…"); the quiet rows lost their rings, and the lit course is the one primary at H3.

**Sources:** CEO 2026-10-20 (the Project Closing Mastery screenshots, as the sales deck uses them, with anything that shows another client's brand or a member's face or name blurred or cropped), SD `CLOSING_TOUR` (the six courses; Project Closing Mastery summed up as the consultation, the proposal, the objections and the close: drawn as what it teaches; its two screenshots), SD FAQ "Who teaches it?" (the Academy and a consulting call on their actual deals, weekly or every two weeks), AC (the Academy's classroom read 2026-10-20: the courses' order and names, and Project Closing Mastery's sections, 01 Sales Crash Course, 02 Objections, 03 Follow Ups, 04 Bonuses, one bonus the No Show Protocol), OCF step 11 (the sales training link; cold enquiries against referrals), GO (the "Skipping Project Closing Mastery" roadblock; "Comprehensive Sales & Closing Mastery"), CJ (M1 and M2: the client goes through the Academy before launch; "not committed to the Academy" is a red flag; a closing problem goes to the Project Closing Mastery module), OM phase 5 (the client watches the course; Mahara does not train their team), LEAD (decision 2).

## L9 · `portal`

**Title:** Mahara OS, your portal
**Time:** 2.5 minutes

**On screen**
- Eyebrow: "You do this"
- Title: "Mahara OS, your portal", on one line across the slide (the fixer's round: in its old 480 px column it broke in two)
- Tag on every screen: "Demo workspace"

**Stops**

| # | Stop | Copy | Picture |
|---|---|---|---|
| 1 | Where things stand | "Your next appointments, and anything waiting on you." | `portal-overview`, the demo row's pending list ending at "Your feedback" (its "Lead quality" and the item after it masked, copy rule 3; the picture is the sales deck's, byte-pinned, so the mask is drawn, never an edit). The Arabic row ends the same way, at ملاحظاتك, its جودة العميل and كيف سار الموعد masked too (score round 2: only the English was) |
| 2 | Your calls, recorded | "Listen back to the calls we make for you, in Mahara OS." | `portal-calls`, drawn at 880 px, about three quarters of the overview's width (score round 2: its waveform was caught mid-draw, so at 1080 it read soft beside the deck's own type), by the stop's words |
| 3 | On your phone | "Install it like an app." Under it, small, in ink-2, the install address: "portal.maharamedia.com/install" (score round 2), the link the group gets | `mahara-mobile-{lang}.mp4`, its still the overview at full contrast (the haze of the capture lifted), the phone about 840 px tall, its middle at about 60% of the width (score round 2: pinned to the end margin, it left a dead middle 900 px wide) |
| 4 | Your number-one job: mark every meeting | The job as the stop's heading, on one line, then "A few taps, the same day.", then the three taps in order, each with a one-line caption (changed 2026-10-20, cut to one line each by the spec review): "Did they come?" · "Running late isn't a no-show." "Did you quote?" · "Sent it later? Update it then." "Did you win?" · "Add the value, or a line on why." The taps are numbered 1, 2, 3 in their rings. Then, under a hairline, on its own row with the lanes' rebook mark: "Cancelled or moved with you directly? Tell us in the group: we change the reminders or call to rebook." (one line, the fixer's round) Footer: "What isn't marked can't be improved." | Drawn, no screenshot: the outcome form is shown once, on L2 stop 7 |

The slide ends on stop 4.

**Slots:** static pictures. The install link and `links.portal` are copied from the notes window, in the deck's language: "Mahara OS: {url}" · "Install it on your phone: {url}".

**Notes**
- If they haven't signed in yet, do it now.
- Ask who meets the customers and will mark the meetings. If it isn't the person signed in, add them now: Settings, then Your team & access. (Added by the spec review, 2026-10-20: the launch call SOP's first step.)
- Slow down on stop 4. It's the job clients most often drop: only 30% of recent appointments have attendance marked.
- A no-show: a customer running late isn't a no-show yet, so check first. Once they're marked, we call to rebook.
- The value is required when they mark a win (the outcome form asks for it). "A line on why" is the outcome form's own box: one honest sentence ("wants to compare three quotes") helps more than "thinking".
- A customer who cancels or moves the meeting with them directly: we only know if they tell us, and the reminders would go out for the old time. Moved, we change the reminders to the new time; cancelled, our caller calls to rebook. Never both: a moved meeting is already booked.
- The portal can remind them after each appointment to mark it.
- If they already use the report sheet, the two stay in step.

**DWY variant**
- Stop 2 is hidden.
- Until `prep.dwy_os_approved` is set, stops 1 and 3 are hidden too, the title is "Your CRM", and stop 4 is drawn as the CRM stage list instead of a Mahara OS screen.
- Stop 4 becomes "Your number-one job: keep every stage true" · "Move each meeting to the right stage in the CRM the same day: didn't show, showed, quote sent, closed." Then one line: "Not there? Check they're not just running late before you move it." (The stage list above names Didn't show; written into the sentence, the stage's capital broke sentence case.) The cancelled-or-moved row is not shown: their own team rebooks.

**Video slot:** `portal-guide` ("The Mahara OS guide"), seeded with the Mahara OS client guide in English and in Arabic (13 chapters each, MOS). Done with you, it shows only once `prep.dwy_os_approved` is set.

**Sources:** SD `PORTAL_TOUR` (the masked screens, outcome in two taps, the outcome's why), PS §8 (only 30% of recent appointments have attendance marked), PS §4 and §5 (installable, calls with playback "when available", the outcome fields, a reminder an hour after the appointment, the sheet stays the record and portal saves sync to it), the `portal-outcome` screen (attendance, quotation, deal status, "Project value (USD), required", "Tell us about the conversation"), CCD (only Maqsam calls carry recordings; "outcome only" saves have none), LCF (the #1 job; "what isn't tracked can't be improved"), GL ("Communication is key, let us know": no-shows, check they're not just late; cancellations, we reschedule; rescheduling, we update our reminders; the new customer's value), LCF (the launch call SOP's step 1: add their teammates to Mahara OS, Settings, Your team & access), CJ (outcomes that come back one word; "they need to think" notes), CSMT (a message after every appointment asking for the status), NL (the leads, results and ads screens are left out), MOS, DWY SOP §5, LEAD (decision 3).

## L10 · `your-part`

**Title:** Your six jobs, in one place
**Time:** 2 minutes (1 until the spec review of 2026-10-20: it is the only home of the open slots, the day off and the client's own system)

**On screen**
- Title, one line, no separate lead: "Your six jobs, in one place" (since the spec review of 2026-10-20; "Your part" with "Your six jobs, in one place." under it said the same thing twice, and "your part" competed with the pie's "You" piece three slides before).
- Six jobs, at most (LEAD decision 4), grouped by when they happen, two under each head (DESIGN 20.7). Each is the job in one short line and why it matters under it. Two carry a picture: a calendar week under "Before your meetings" (three rows of hours, eleven open; score round 2: four rows ran the column 250 px past the others), with a key on its "Day off" line naming the dark cells once, "Blocked", and three of their project pictures under "Keep your Drive folder fed", the job they illustrate (only with three or more; the fixer's round, 2026-10-20: they sat under "Leave the ads running", and a lone "Busy" on one cell read as one blocked hour).

| Head | Job | Why it matters | Picture |
|---|---|---|---|
| Before your meetings | Keep at least 10 open slots, at different times | Our callers book into them. On a day off, block each hour, not one all-day event. | A calendar week: open slots at different times, a few hours blocked, and a day off blocked hour by hour; on its "Day off" line, at its start, the key, "Blocked" |
| Before your meetings | Add each booking to your own system | If your team plans in other software, the booking goes there too, so nobody books over it. | None |
| After each meeting | Mark every meeting the same day, with the value when you win | Your outcomes show which ads bring real projects. | None |
| After each meeting | Follow up the ones thinking it over, and book the second meeting | You send the quote and set the second meeting. Our caller checks in too. | None |
| Week to week | Leave the ads running through the first weeks | Pausing early ends the test before it tells us anything. | None |
| Week to week | Keep your Drive folder fed | Fresh projects keep your ads from tiring. | Three of their project pictures |

Left this slide on 2026-10-20: "Keep the offer steady while we test" (now said on L3, in its notes) and "Block busy times and holidays in your calendar" (folded into the open-slots job and its picture).

**Slots:** none.

**Notes**
- "Three of these are new today: the open slots, a day off blocked by the hour (point at the calendar week) and your own system. Slow down there. The rest you've already heard."
- After the call, send this card in the group as the recap: the notes window's "Copy for the group" posts the title; then, while the `start-to-finish`, `call-team` and `winning` videos are not all recorded and shown for this client (score round 2: a client who missed the journey, the call or the pie had nothing to catch up from), "Who does what: we bring the enquiries, call them within 5 minutes during working hours, book and remind them, and rebook anyone who doesn't show. You hold the meeting and win the project." (done with you: "Who does what: we bring the enquiries. Your team calls them within 5 minutes and books them on the right calendar, and the confirmation goes out by itself. You hold the meeting and win the project."); then the six jobs under their three heads; then, since the spec review of 2026-10-20, the testing line, "How we test your ads: your red lines stay fixed, your ideas go in the group before the next round, you check the facts, prices and claims before an ad goes live, and small style changes go into the next round so your launch doesn't wait. New photos and videos help: send them whenever you can." (the fixer's round added the rule the pushback is about, and the content ask); then, every time (the fixer's round, until the `payments` and `first-90-days` videos exist), the money line, "Keep your ad card funded. Your payments to us are on the dates in your agreement.", and the first-weeks line, "The first weeks are usually slower while the ads find your audience. Leave them running."; then the course line, "Before your first meetings: Project Closing Mastery in the Academy: {academy url}", so the training goes into the recap too; then the videos (below). The testing line puts L3's agreement in writing, so the CSM has it to point to when the ads reach the group. The same button is on L13's notes and on the notes window once the deck closes, so the recap goes out even when the call ran out of time before this slide.
- Open slots: the more of their opening hours we can book into, the sooner a customer finds a time. Ten is the floor.
- A day off: block the working hours as busy, not an all-day event. Calendars can miss an all-day block, and we'd book into it. We once booked over a client's own appointments because a day was blocked the wrong way, and the client left.
- After a meeting, the follow-up is theirs and ours (before it, the messages are ours: slide 6).
- A slot outside their hours, a holiday and a service detail are the questions our callers ask most.
- They don't need to answer on Fridays or in the evening.
- **Temp check:** "Which of these will be hardest for your team?"

**DWY** (regrouped by the spec review, 2026-10-20, so no calling job sits under "After each meeting")
- Before your meetings: the open slots, its why "Your team books into them. On a day off, block each hour, not one all-day event."; and, in place of "Add each booking to your own system" (their own team already books), "Call new enquiries within 5 minutes, and note every try" · "Interest fades, and a missing note means nobody knows what happened."
- After each meeting: "Move each meeting to the right stage the same day" · "Your stages show which ads bring real projects."; and the follow-up job, its why only "You send the quote and set the second meeting." (their own team makes the calls).
- Week to week: the same two jobs.
- Notes: "Their own callers ask those questions and book into the free times; the group answers them."

**Video slot:** `calendar-hours` ("Blocking hours in your calendar"), both modes. Seeded with Mahara's own Loom on blocking calendar times (the CEO, 2026-10-20: "embed the loom of how to block your calendar as well"), any language. It is the video the Gamma launch deck embeds on "Blocking Calendar Times"; open question 30 asks for it to be watched once, with the other seeds, for another client's calendar.

**Also since 2026-10-20 (creative flexibility):** the recap the notes window copies ends, after the course line, with the launch deck's recorded videos under "Missed something on the call? Watch:", and (the spec review) carries the testing line before the course line. The Drive job's why stays its own ("Fresh projects keep your ads from tiring."); L3 stop 5 gave the other why, more content for more tests, so the notes don't say it again here.

**Changed by the spec review (2026-10-20):** the title is the one line; job 1's why is cut to two sentences ("calendars can miss an all-day block" moved to the notes; the calendar week shows the rule); head 3 is "Week to week" (it was "Through the first weeks", said again word for word in its own job, and the Drive job is not a first-weeks job); the ads why no longer restates L3's "The numbers tell us which work"; the follow-up why no longer restates L2 stop 6; the note "before the meeting, leave the messages to us" moved to L6 stop 7, on screen.

**Sources:** GL ("Appointment management": a minimum of 10 slots at varied times, better to book any time they're open; "Blocking calendar times": never block the whole day, Google may not count a fully blocked day; "Your responsibilities": book on your system, schedule follow-ups and second appointments, update Mahara OS), LCF (the client who churned over a wrongly blocked calendar), CJ (M4: not enough availability pushes bookings two weeks out; aim to book within 5 days), the old onboarding template's "roadblocks" (the structure), PS §8 (the client's jobs; only 30% of recent appointments have attendance marked; footage is scarce; the questions the call centre needs answered), CRF (goes quiet in weeks 3 to 4, outcomes stop being filled), PEA (ads fatigue; pausing early ends a test), CSMT (keep the folder full), CEO (the shared follow-up, done for you), DWY SOP §2 and §6 (speed, a note before every stage move), LEAD (decision 4).

## L11 · `first-90-days`

**Title:** Your first 90 days
**Time:** 1.5 minutes

**On screen**
- Title: "Your first 90 days"
- Top line: "Your 90-day goal, in your words: {form.goal90}", with the footnote "A target, not a promise of results."
- A timeline from {go_live} to day 90, which ends the axis on its own dashed line, named "Day 90" with its date (the week heads stop at day 77, so none sits on it):
  - "Weeks 1 and 2 · Finding what works" (a bar), with one line under its label (changed 2026-10-20): "Usually slower, while the ads find your audience." Its dashed open end is labelled "Can run longer".
  - "Your first check-in · a week or two in" · {next.checkin}
  - "Then weekly or every two weeks" · "20 to 30 minutes on Zoom: what's working, and what we're changing." (keyed with its one mark: every check-in after the first is a small open diamond, whichever rhythm it falls on; the fixer's round dropped the solid one, which the key gave the same rule as the open one; since score round 2 the weeks between, there only on a weekly rhythm, are drawn in ink-3, so the axis shows both rhythms the key says, with no glyph added to the key), then the reason as its own line under it, in ink-2: "Depending on your plan and how long you've been with us." If a layout check shows the line does not fit, it is shortened without losing either part (the plan, the time with us), and the notes always say it. The rhythm is never shown as one of the two alone.
  - "Around 30, 60 and 90 days, that check-in looks back over the month." (keyed with the ringed diamond, the only other mark; the first check-in is open at full size, with its own words)
- Milestones, unlit at launch and never dated: First booking · First attended appointment · First won project
- Footer: "Dates depend on your market, your offer and your follow-up. We track them with you."

**Slots:** `form.goal90` (with `prep.goals`; the line is hidden while the goal holds a lead or appointment count the CSM has not cleared, copy rule 10), `go_live`, `next.checkin`.

**Notes**
- No numbers promised. Never give a date for a milestone.
- Weeks 1 and 2 are usually slower while the ads find their audience. Some start busy. Either way, we're finding what their market responds to.
- Updates come in the group as things happen.
- The rhythm, both and why: "After the first one, weekly or every two weeks, depending on your plan and how long you've been with us." Never promise one of the two alone.
- Their deals come to these check-ins too (L8).
- Check-ins: a laptop, somewhere quiet, not in the car. The next one is booked at the end of each.
- **Temp check:** "Does this rhythm work for you?"

**DWY:** same. The first booking is their team's.

**Video slot:** `first-90-days` ("Your first 90 days"), both modes. Not recorded yet. Added by the spec review of 2026-10-20: this slide sits at the end of the call, the part most often rushed, and sets the expectation most tied to churn (the first two weeks are usually slower); the first check-in comes a week or two after go-live, after the slow start has already been felt, so it cannot stand in for the slide. The recording keeps the slide's rules: no numbers, no dates for milestones, and the rhythm always with its reason.

**Sources:** the lead's decision (the first check-in at day 7 to 14), CEO (then weekly or every two weeks, by the plan and how long the client has been with us), O2L Day 14 (a call every two weeks, updates in the group as things happen), CSMT "When Ads Launch" (20 to 30 minutes on Zoom, somewhere quiet with a laptop), PS §2 and §7 (30, 60 and 90-day marks in the portal journey; no SOP defines a separate review meeting; milestones), SD `MILESTONES`, GL ("Expect the first two weeks to be slower as campaigns ramp up"; "testing and finding the right audience"), LCF ("first two weeks are the slowest"), FCL PLAN (drop "the first weeks are always slowest": hence "usually", never "always"), PS §3 (measured first booking about 4 days after launch: single source, so not printed), GR, LEAD (decision 6).

## L12 · `good-to-know` (new, 2026-10-20)

**Title:** Good to know (the fixer's round, 2026-10-20: "Before we go live" did not fit the comments and replies rows, which run on after it)
**Time:** 1.5 minutes

The housekeeping that was L10's first stop, with the money and reply facts from the Gamma launch deck added. Together they are five items, more than three calm cards on the green light, so they take their own slide just before it (LEAD decision 7), and the green light keeps only the question.

**On screen**
- Title: "Good to know"
- Ruled rows, each a short head and its line, under two small heads: "Money" (rows 1 to 3) and "Messages" (rows 4 and 5). Each money row's do-this is set in ink inside its ink-2 line (score round 2), so it reads at a glance: "Tell your bank", "Tell us first", "On the dates in your agreement.":
  1. "Meta's first charges" · "Small at first, and that's normal. Tell your bank so it doesn't block them."
  2. "Keep your ad card funded" · "A failed payment stops your ads. Repeated ones can get the account restricted and reset what the ads have learned. Running low? Tell us first, and we'll pause the ads safely."
  3. "Your payments to us" · "On the dates in your agreement. If one fails, the ads, our calls and Mahara OS pause until it's sorted."
  4. "Comments on your ads" · "Yours to answer. Not sure what to say? Ask in the group."
  5. "Our replies" · "In the group within 2 working hours, 10 to 6, Saturday to Thursday." (UAE zone per the data map.) This row shows only when `prep.onboarding_presented_at` is empty: if this client saw the onboarding deck, O3 already said it.

**Slots:** `prep.onboarding_presented_at`, `client.country` (the UAE zone), `client.mode`.

**Notes**
- Say the money rows once, plainly. No amounts on screen or aloud.
- The ad account's card: the whole month's ad spend should be on it. Running low: they tell us in the group, and the media buyer pauses the campaign before a payment fails.
- Payments to us: "the dates in your agreement". Never "monthly from today": plans differ.
- If the replies row shows, add that Friday is off and that 2 working hours count only the hours we work.
- **Temp check:** "Anything on money or messages you'd like to check before we go live?"

**DWY:** row 3's line becomes "On the dates in your agreement. If one fails, the ads and the systems we run for you pause until it's sorted." (no calls of ours).

**Video slot:** `payments` ("How payments work"): the ad account's card and the payments to us, with no amounts. Both modes. Not recorded yet.

**Sources:** LCF (housekeeping: small first Meta charges, tell the bank; comments on ads are the client's), GL ("Important to know": failed payments can get accounts banned from advertising and reset what the ads learned; failed payments pause the ads, automations, software and appointments; tell us when funds run low so we pause first; the group as the primary channel with a reply within 2 business hours; 10 to 6), CJ (a card that keeps declining: the whole monthly ad spend on the card; remind them of the launch call's platform-ban slide), PS §1 (almost everything runs on Meta), DOM and PS §9 (10 to 6, Saturday to Thursday, Friday off), LEAD (decision 7).

## L13 · `green-light`

**Title:** Happy for us to go live?
**Time:** 1 minute

**On screen**
- The question, large: "Happy for us to go live?"
- The journey's rail drawn large and fully lit, ending at "Go-live", with the date once there is one.
- Once booked: "Your first check-in · {next.checkin}"
- One stop. The housekeeping that was this slide's first stop is L12.

**Slots:** `next.checkin` (Book button in the notes window, kind checkin), `go_live`.

**Notes**
- Questions first, then ask for the green light in those words.
- Book the first check-in before you hang up, a week or two after go-live.
- If they hesitate, find the one thing and solve it now, or agree a date to solve it.
- Say the awkward thing: "If anything worries you at any point, tell me. The partners who do best tell us the good and the bad."
- After the call, send the recap in the group. "Copy for the group" is here too (the six jobs, how we test your ads, the course, the videos), so it goes out even if you didn't reach slide 10. It is the one short recap, not the long launch message.

**DWY:** same.

**Sources:** LCF (ask for the green light; book the next meeting at the end), CSMT "When Ads Launch" (say the awkward thing), PS §13 (the launch call replaces the long launch message and the day 6 to 8 messages; one recap after), GL (the closing "Launch" slide).

---

# Video slots (CEO, 2026-10-20)

The CEO, 2026-10-20: "There should be placeholders for the videos", for when the CSM forgets a part or runs out of time on the call. Each main part of both decks gets a slot. A slot is filled when its video is recorded, and six videos Mahara already has fill five slots on day one (the Mahara OS guide in both languages). The registry below is the one list: the code keeps it as `VIDEO_SLOTS` (`src/present/videos.ts`) and the migration keeps the same twelve keys in `cockpit_csm_deck_video_slots()` (`VIDEOS.md` 3); a test fails when the two differ.

**How a slot shows**
- **Filled:** a quiet control on the canvas, "Watch: {title} · {m:ss}" (DESIGN 21.2), shown only while the presenter's chrome is awake (the CSM moves the mouse) or while it has keyboard focus, so a video the CSM skips is never advertised on the client's screen. No length on file: the title alone, never "0:00". Pressing it, V, or the notes window's "Play on screen" plays the video over the slide; Esc closes it and never leaves the deck. The client hears about the video from the CSM and gets its link in the recap.
- **Empty:** nothing on the canvas. The notes window and prep say "Not recorded yet."
- **Language:** the deck's language first, then a recording for any language. A recording in the other language never shows on the canvas or in the recap; the notes window offers it to the CSM by name ("Not recorded in Arabic yet. The English one:" with Play on screen and Copy link).
- **Done with you:** a slot marked done for you shows nothing on a done-with-you client's deck, and the notes window says why in one line.
- **Skipped for time:** on every slide with a filled slot shown for this client, the notes window's Video block ends with "If you skip this, say the video is in your group." It is said once, there, instead of in each slide's notes.
- **Whose videos:** Mahara's own recordings only (copy rule 11), hosted on Loom, YouTube, Wistia, Vimeo or Google Drive (`VIDEOS.md` 3 has the exact links the server takes).
- **Shared:** a slot is the same for every client. A link saved in one client's prep shows on every client's deck of that kind, and prep says so beside the field.

**The registry**

| Deck | Slot key | Slide | Title | What it covers | Shown for | Day one |
|---|---|---|---|---|---|---|
| onboarding | `welcome` | O1 `welcome` | Welcome to Mahara | Mahara's onboarding welcome video | Both | Seeded: Wistia `up0z6n691k`, any language, 2:28 |
| onboarding | `meta-access` | O6 `this-week` | Meta access | Sharing the Page and the ad account through the one link | Both | Seeded: Loom `e2d83bff…8989`, any language, 1:34 |
| onboarding | `whatsapp-calendar` | O6 `this-week` | WhatsApp and calendar | Connecting WhatsApp and Google Calendar in Mahara OS | Done for you; done with you once `prep.dwy_os_approved` is set | Seeded: Loom `4ddc5519…a701`, any language, 3:51 |
| onboarding | `testing` | O7 `next` | Why we test so many ads | The same recording as the launch deck's `testing`: the ads' job, the volume, input first, the quick check, the content | Both | Not recorded yet (save the one recording to both keys) |
| launch | `start-to-finish` | L2 `journey` | How it works, start to finish | The seven stops, from their ad to the mark after the meeting: the call within 5 minutes during working hours (with the hours and the night rule), the booking and the reminders, what lands with them, the fork | Done for you | Not recorded yet |
| launch | `testing` | L3 `creative-freedom` | Why we test so many ads | The five stops: the ads' job, the volume, their input first, the quick check, the content | Both | Not recorded yet |
| launch | `call-team` | L6 `call` | How our call team works | How our callers speak for them: the script's stages, the call guide, the WhatsApp confirmation and what we do before the meeting. Never a real customer's call | Done for you | Not recorded yet |
| launch | `winning` | L7 `partnership` | Your part in winning the project | The pie, the two roads, and why whoever meets the customers takes Project Closing Mastery before the first meetings (it covers L8 too) | Done for you | Not recorded yet |
| launch | `portal-guide` | L9 `portal` | The Mahara OS guide | Mahara OS for clients, 13 chapters | Done for you; done with you once `prep.dwy_os_approved` is set | Seeded: Wistia `lxlse6ckhf` (English, 4:37) and `hyuxh7skjv` (Arabic, 4:45) |
| launch | `calendar-hours` | L10 `your-part` | Blocking hours in your calendar | Blocking calendar times, the hours and not the whole day (the Gamma launch deck's own video) | Both | Seeded: Loom `6aa67297…7768`, any language, 0:11 |
| launch | `first-90-days` | L11 `first-90-days` | Your first 90 days | Weeks 1 and 2 usually slower while the ads find the audience, the first check-in, then weekly or every two weeks (with the reason), the 30, 60 and 90-day look-backs; no numbers, no dates for milestones | Both | Not recorded yet |
| launch | `payments` | L12 `good-to-know` | How payments work | The ad account's card (the first charges, keeping it funded, telling us first) and the payments to us on the agreement's dates. No amounts | Both | Not recorded yet |

The Arabic titles are in `CONTENT-AR.md`. A title typed in prep (at most 40 characters) replaces the slot's title for that recording only. The day-one lengths are the providers' own (`VIDEOS.md` 6).

**No slot, on purpose:** the slides about this client alone (O2 goals, O4 one service, L4 their ads, L5 their form); the slides another slot already covers (O5: the onboarding deck stays short, and the launch call walks the road; L8: the course is the video, its link is in the recap, and `winning` says why it comes first); O3, the group they are joining; and the launch cover and the green light (L1, L13).

**The recap.** Both group texts end with the deck's recorded videos, in slide order, under one line, in the deck's language:

```text
Missed something on the call? Watch:
- {title}: {url}
- {title}: {url}
```

- Launch: after the course line of the launch recap ("Copy for the group"), with one blank line before it. The recap is offered on L10's notes, on L13's notes, and in the notes window once the deck closes, so it goes out even when the call never reached L10. Onboarding: at the end of O6's "Links for the group", also offered once the deck closes.
- Only slots that are filled and shown for this client, recorded in the deck's language or for any language. With none, the block is left out: never "Watch:" with nothing under it. A row the browser refused is left out too.
- The link is the one people open (`VIDEOS.md`), filled without Arabic isolates so it stays one clickable run in WhatsApp, as the other group links are.

**In the notes window and prep** (cockpit UI, English): "Not recorded yet." · "Not recorded in Arabic yet. The English one:" · "Done with you: not shown, because this video shows how we work done for you." · "Not shown until Mahara OS is approved for this client." · "Videos could not be read: {reason}. The deck shows none." · "This video's link was refused. Save it again in prep." · "If you skip this, say the video is in your group." · "Opening on screen" · "On screen, not started. Click play in the deck window." · "Playing on screen" · "Esc, V or Close closes it; a deck key closes it too." · "Zoom: while it plays, tick 'Optimize for video clip' in the share's More menu. Untick it after, or the slides blur." · "Untick 'Optimize for video clip' now." · "Shared by every client's deck: a link saved here shows on every launch deck." · "Mahara's own recordings only. Nothing that shows another client." · "Add a link".

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
  - "the next 90 days", now L11;
  - "quick feedback loops", now L3 (changes asked in the group) and L13 (say the awkward thing).
- **Removed:** the AI urgency section, the "examples in our agency" slides, the profit, headcount and churn figures, and "confirm the remaining investment". None of it is about this client's launch, the figures are another company's, and money talk does not belong on a launch call.

## From the old onboarding template ("Aesthetic Accelerator")

- **"What is the program"** became O3, as the team in their WhatsApp group.
- **"Accelerator access":**
  - Slack is removed: clients are not in Slack, and the WhatsApp group replaces it (O3).
  - Skool became the Premium Projects Academy (O6).
  - "Bi-weekly check-ins" moved to L11, which now says "weekly or every two weeks" (CEO, 2026-10-20).
- **"Most common roadblocks"** was merged into L10, "Your part", as five jobs (six since 2026-10-20) with why each matters:
  - "Not using Slack" became the group tile.
  - "Not watching the trainings" moved to O6, as the Academy row.
  - "Not treating ads like a science project" became L3.
  - "Thinking we just run ads" and "not running our proven process" are dropped. They read as blaming the client, and L3 and L10 carry the real asks.
- **Removed:**
  - the "low failure rate" line;
  - the named trainer;
  - "hundreds of medical spas" and "millions spent";
  - "expect the first ad to fail", too negative, replaced by "the first weeks are a test";
  - "patient sales team training": Mahara does not train the client's team (OM phase 5);
  - "hit our monthly projections": a results promise.
- **"Most vital milestones"** (8 items) was split:
  - before launch, into O5's six stops;
  - after launch, into L11's three milestones with no dates or numbers.

## From the Gamma decks (CEO, 2026-10-20)

The CEO, 2026-10-20: "The launch deck is missing a lot of the expectation setting, such as going through the sales training and the piece of the pie. If you look at the Gamma presentation that we already had, what we do versus what you do, and a lot of the expectations are missing." Two of Mahara's own Gamma decks were read on 2026-10-20: the launch deck ("Launch Call Presentation", linked from the Launch Call Process & Framework and the Client Journey SOP) and the onboarding deck ("Welcome to the Premium Projects Program"). The older "Pre-Launch Review" is the dental copy of the launch deck (patients, deposits, a Google Sheet) and adds nothing for these clients.

Every item and picture in both is placed below: **kept** (our deck already says it, in its own words), **changed** (it says it, corrected or sharpened), **new** (added on 2026-10-20) or **left out** (with the reason, and what the deck says instead). Where a Gamma line disagrees with a verified system fact, the fact stays and the row says so. The lead's decisions are cited as LEAD 1 to 9.

**Counts.** Launch Gamma: 42 items (12 kept, 13 changed, 17 new) and 6 pictures (2 kept, 2 new as drawings, 2 left out; the calendar video moved from left out to kept with the CEO's request of 2026-10-20). Onboarding Gamma: 23 items (11 kept, 6 changed, 3 new, 3 left out). The 20 claims left out on purpose, inside items that are otherwise placed, are listed in their own table.

### The launch Gamma, item by item

| # | Gamma slide · item | Status | Where it lives now | Why |
|---|---|---|---|---|
| 1 | Cover · "Pre Launch Review" | Kept | L1 | |
| 2 | "What we will cover": customer journey, booking process, client communication | Changed | L1 notes, the frame | The frame now names who does what and the call's length |
| 3 | Customer journey 1 · sees the ad, fills out the form | Kept | L2 stops 1 and 2 | |
| 4 | Customer journey 2 · a call from the team in business hours | Changed | L2 stop 3 | Within 5 minutes during working hours, with the hours and the night rule (copy rule 1); the Gamma's 10 minutes is left out |
| 5 | Customer journey 3 · booked for a consultation if qualified | Kept | L2 stop 4 | |
| 6 | Tracking · Mahara OS shows leads, appointments and results | Changed | L9 stops 1 to 3 | The leads and results screens stay out (copy rule 3) |
| 7 | Appointment feedback · outcome, deal status and value | Changed | L9 stop 4, L10 | The value is now asked ("Did you win?" · "Add the value, or a line on why."), with a line on why when they didn't sign (LEAD 3) |
| 8 | Monthly reporting · a monthly results call | Changed | L11 | No separate monthly call exists in any SOP: the check-ins at 30, 60 and 90 days look back over the month |
| 9 | Our call centre · multiple contact attempts | Changed | L2 stop 3, the chip | Up to 4 tries over 3 working days (DOM); the Gamma's 8 is left out |
| 10 | Our call centre · engineering knowledge: projects, prices, alternatives | Changed | L6, the call-guide line | The caller's facts and any starting price come from their own call guide (FW); no "experts" claim |
| 11 | Our call centre · trained on the client's business | Kept | L6 call guide, O3's caller row | |
| 12 | The golden call · rapport, the pain, the solution, the booking | Kept | L6, the six stages and the example call | |
| 13 | Appointment management · at least 10 slots at varied times | New | L10, "Keep at least 10 open slots, at different times" | LEAD 4 |
| 14 | Appointment management · notifications on WhatsApp | Changed | L2 stop 5 | Now names new bookings, cancellations and changes (LEAD 5) |
| 15 | Appointment management · reminders the day before and the same day | Changed | L6 stop 7 | The verified sequence: a WhatsApp confirmation, a reminder the day before, a confirmation call, an SMS 2 hours before (BR) |
| 16 | Blocking calendar times · never block the whole day | New | L10, the open-slots job and its calendar week | "On a day off, block the hours, not the whole day" (LEAD 4; LCF's churned client) |
| 17 | Your responsibilities · book on your system | New | L10, "Add each booking to your own system" | LEAD 4 |
| 18 | Your responsibilities · schedule follow-ups and second appointments | New | L10, "Follow up the ones thinking it over, and book the second meeting" | The fork on L2 stop 6 already shares the follow-up (CEO); L10 adds it as their job |
| 19 | Your responsibilities · update Mahara OS after each appointment | Kept | L9 stop 4, L10 | |
| 20 | Your responsibilities · convert leads into projects | Changed | L7, their piece of the pie | "The meeting and the close" |
| 21 | "First month is always the slowest" · expect the first two weeks to be slower | Changed | L11, weeks 1 and 2 | "Usually slower, while the ads find your audience" (LEAD 6); "always" is out (FCL PLAN) |
| 22 | We will be nurturing leads | Kept | L2 stop 3, the tries | |
| 23 | Testing and finding the right audience | Kept | L3 | |
| 24 | Let us know · when someone shows (so we target similar people) | Changed | L9 stop 4, "Did they come?" | The reason given is the deck's own: the outcomes show which ads bring real projects |
| 25 | Let us know · no-shows: we reschedule, check they're not just late | New | L9 stop 4 | The late check, and that the mark lets us call to rebook (LEAD 3) |
| 26 | Let us know · cancellations: we reschedule | New | L9 stop 4, its own row | "Cancelled or moved with you directly? Tell us in the group." Then "Cancelled: we call to rebook." |
| 27 | Let us know · rescheduling: we update our reminders | New | L9 stop 4, the same row | "Moved: we change the reminders." Kept apart from the cancellation since the spec review, so a moved meeting is never rebooked a third time |
| 28 | Let us know · the new customer's value | New | L9 stop 4, "Did you win?" | The outcome form requires it for a win |
| 29 | "Paid ad vs referral leads" (the slide) | New | L7 stop 3 | The two roads, redrawn (LEAD 1) |
| 30 | Types of messages · new appointments; cancellations and reschedules | Changed | L2 stop 5 | One line, beside the calendar entry |
| 31 | Your Mahara OS dashboard · record every outcome; "the quality of your submissions" | Kept | L9 stop 4 and its footer | "What isn't marked can't be improved." |
| 32 | Important to know · a partnership: marketing without sales won't help you grow | New | L7 stop 4 | LEAD 1 |
| 33 | Important to know · why we're big on sales training; cold enquiries are harder than referrals | New | L7 stop 3, L8 | LEAD 1 and 2 |
| 34 | Important to know · we bring them through the door, we can't close them for you, we support you | New | L7's title and stop 4 | "We can't close for you. We can help you get better at it." |
| 35 | You do · closes. We do · leads, bookings, shows | New | L7 stops 1 and 2, the pie | One piece of ours named three ways, one of theirs; leads became enquiries (copy rule 3); "shows" became "Reminders and rebooking", what we do, not a result |
| 36 | Important to know · platform bans and reset learning after failed payments | New | L12 row 2 | Meta only, and "can get the account restricted" (LEAD 7) |
| 37 | Important to know · failed payments pause ads, automations, software and appointments | New | L12 row 3 | "The ads, our calls and Mahara OS pause until it's sorted" (LEAD 7) |
| 38 | Important to know · tell us when funds run low, so we pause | New | L12 row 2 | "Running low? Tell us first, and we'll pause the ads safely." |
| 39 | Communication · the WhatsApp group, a reply within 2 business hours | New | O3's foot, L12's replies row | "Within 2 working hours" (LEAD 7) |
| 40 | Communication · 10 AM to 6 PM KSA | Kept | O3, L2 stop 3, L12 | Saturday to Thursday, not Sunday (DOM, PS §9) |
| 41 | Communication · weekly or bi-weekly calls | Kept | L11 | Weekly or every two weeks, with the reason (copy rule 5) |
| 42 | "LAUNCH!" | Kept | L13, the question | No exclamation mark (copy rule 9) |

### Its pictures

| Picture | Status | Where it lives now | Why |
|---|---|---|---|
| The pie: three quarters "We do", one quarter "You" pulled out | New, redrawn | L7 stops 1 and 2 (DESIGN 20.3) | The CEO's "piece of the pie", in deck tokens: our one piece and their quarter pulled out, as the Gamma draws it, no percentages |
| The two roads: a winding paid-ad road and a straight referral road to the same meeting | New, redrawn | L7 stop 3 (DESIGN 20.4) | In the journey's line language, not clip art; "comparing you to 5 others" became "comparing you with others", and "harder and longer" and "easier and faster" are left to the drawing and the caption ("The enquiries we bring take the longer road.") |
| Three phone screenshots of the WhatsApp alerts | Left out | The words on L2 stop 5 | Not checked for other clients' data, and what the client's own alert carries is not confirmed (open question 21) |
| A phone screenshot of the appointment notification | Left out | L2 stop 5, L6 stop 8 (drawn, tagged Example) | Same reason |
| Mahara OS dashboard screenshots | Kept | L9 | Our own Demo workspace screens, tagged |
| The video on blocking calendar time | Kept | The `calendar-hours` video slot (L10), beside the drawn calendar week | The CEO asked for it on 2026-10-20 ("embed the loom of how to block your calendar as well"); checked with the other seeds under open question 30 |

### The onboarding Gamma, item by item

Decision 8 asks the onboarding deck to stay short, so only what is missing and important was added: the reply time and a check of who is in the group. The rest already lives in the onboarding deck, lives on the launch deck, or is left out with its reason.

| # | Gamma item | Status | Where it lives now | Why |
|---|---|---|---|---|
| 1 | "Welcome to the Premium Projects Program" | Kept | O1 | |
| 2 | "Your complete partnership for predictable, high-value project acquisition" | Left out | | A results promise (copy rule 2) |
| 3 | How it works · we handle your project acquisition: the ads and the funnel | Kept | O3 (the creative director, the media buyer), the launch deck | "AI-powered" and "the definitive choice" are left out |
| 4 | How it works · Sales and Closing Mastery training and guidance | Changed | O6 row 5 (join), L8 (the course for their meetings) | The training is on the launch deck, when the meetings are days away |
| 5 | How it works · your CSM, bi-weekly check-ins, reports, optimisation | Changed | O3's first row, L11 | Weekly or every two weeks (copy rule 5); the onboarding deck carries no cadence |
| 6 | Access point · Mahara OS, signed in with the registered email | Kept | O6 row 2 | |
| 7 | Access point · the WhatsApp group | Kept | O3 | |
| 8 | Access point · weekly or bi-weekly strategy calls on Zoom | Kept | L11 | |
| 9 | Roadblock · not treating acquisition as a predictable science | Changed | O7 "The first weeks are a test", L3 | "Predictable" is left out |
| 10 | Roadblock · not using WhatsApp for urgent communication | Changed | O3's foot | Now with the reply time: "We reply within 2 working hours, 10 to 6, Saturday to Thursday. If something worries you, we call you." |
| 11 | Roadblock · skipping Project Closing Mastery | New | L8 | LEAD 2 |
| 12 | Roadblock · misunderstanding our partnership | New | L7 | LEAD 1 |
| 13 | Roadblock · not following the Project Filter Funnel process | Changed | L3 and L5 (the red lines fixed, the rest tested; the form's filters) | The product name is left out: the client sees the form and its "Filters" |
| 14 | Roadmap 1 and 2 · onboarding call, Brand Blueprint call | Kept | O5 stops 3 and 4 | |
| 15 | Roadmap 3 · campaign setup and sales training: "train your team on our Project Closing framework" | Changed | O5 stop 5, L8 | The course trains them; Mahara does not run staff training (OM phase 5) |
| 16 | Roadmap 4 · launch and activation | Kept | O5 stop 5, L13 | |
| 17 | Roadmap 5 · first qualified bookings | Kept | O5 stop 6, L11's milestones | |
| 18 | Roadmap 6, 8 and 9 · lead gen stabilisation, campaign optimisation, scale and expand | Left out | | Stages with no definition and no date; L11's milestones and check-ins carry what comes after launch |
| 19 | Roadmap 7 · hit monthly projections | Left out | | A results promise (copy rule 2) |
| 20 | Let's get started · ad account access | Kept | O6 row 1 | |
| 21 | Let's get started · WhatsApp connected through Mahara OS | Kept | O6 row 2 | |
| 22 | Let's get started · WhatsApp group confirmation | New | O3 notes | "Check the group now: whoever handles their schedule and whoever meets the customers" (OCF step 5) |
| 23 | Let's get started · all business details correct | Kept | The kickoff form in the CSM's own tab | Talk track, not a slide |

### Left out on purpose

| Gamma claim | Where it was | Why it is out | What the decks say instead |
|---|---|---|---|
| "We contact leads up to 8 times" | Launch, "Our call centre" | The dialer's ladder is 4 tries over 3 working days (DOM) | "Up to 4 tries over 3 working days" (L2 stop 3) |
| "80% of sales come after the 3rd contact" (said twice) | Launch, "Our call centre" and "First month" | No source | Nothing; no statistic without a source |
| "Within 10 minutes" | Launch, "The customer journey" | The CEO's answer: 5 minutes for all | "Within 5 minutes during working hours" (L2 stop 3) |
| "Sunday to Thursday" | Launch, "Communication" | The hours are Saturday to Thursday (DOM, PS §9) | "10 to 6, Saturday to Thursday" |
| "Our AI system", "AI-Powered Engineer Ads", "reset the AI data" | Launch, "Let us know"; onboarding, "How it works"; launch, "Important to know" | A claim we don't make to clients, and not how Meta works in plain words | "What the ads have learned" (L12); "Your outcomes show which ads bring real projects" (L9, L10) |
| "We can bring you TONS of customers" | Launch, "Important to know" | A results promise (copy rule 2) | "We bring them to your door" (L7) |
| "Hit monthly projections" | Onboarding, roadmap 7 | A results promise (copy rule 2) | L11's milestones, in order and never dated |
| "A monthly call to discuss last month's results" | Launch, "Tracking & reporting" | No SOP defines a monthly review meeting | "At 30, 60 and 90 days, that check-in looks back over the month" (L11) |
| "Comparing you to 5 others" | Launch, the roads picture | No source for 5 | "Comparing you with others" (L7) |
| "Easier & faster" for referrals | Launch, the roads picture | A speed claim about their sales | The straight road, drawn (L7) |
| "Experts know projects, prices, and alternative services" | Launch, "Our call centre" | Prices and claims come only from their call guide (FW) | L6's call-guide line |
| "The subscription renews every month from today" | Launch, "Important to know" | Plans differ | "On the dates in your agreement" (L12) |
| "Meta, TikTok and Snapchat can ban accounts" | Launch, "Important to know" | Almost everything runs on Meta (PS §1), and "restricted" is what Meta does first | "Repeated ones can get the account restricted" (L12) |
| "First month is always the SLOWEST" | Launch, its heading | "Always" is not true (FCL PLAN; first booking measured about 4 days after launch) | "Usually slower" (L11) |
| "More leads mean more appointments" | Launch, "First month" | Reads as a results promise | Nothing |
| Reminders "on the same day" | Launch, "Appointment management" | The verified sequence ends with an SMS 2 hours before (BR) | L6 stop 7 |
| "Predictable, high-value project acquisition", "the definitive choice" | Onboarding, the welcome and "How it works" | Results and positioning claims | Nothing |
| "Lead gen stabilization", "Campaign optimization", "Scale & expand" | Onboarding, the roadmap | No definition, no date | L11's check-ins and milestones |
| "Leads" throughout | Both | Copy rule 3 | "Enquiries", "customers" |
| "LAUNCH!" and the other exclamation marks | Both | Copy rule 9 | "Happy for us to go live?" (L13) |

### Also checked against the launch call SOP

The Launch Call Process & Framework (LCF) and the launch call SOP behind the Gamma add three expectations the Gamma doesn't show. "They should not message our leads on their WhatsApp" is on L6 stop 7 since the spec review (done for you: "Before the meeting, the messages come from us, so your customer hears one voice."), reconciled with the CEO's shared follow-up: before the meeting the messages are ours, after it they follow up the ones thinking it over (L10). "First two weeks are the slowest" is L11's new line. "We'll get back to you within 24 hours" (LCF and OCF) disagrees with the Gamma's 2 business hours; the decks follow LEAD 7 and open question 26 asks the CEO to confirm the team can keep it.

## From the sales deck

- **`JOURNEY` (5 stops)** became L2 (7 stops), from the client's side:
  - "A call within 5 minutes" is kept, as stop 3's "within 5 minutes during working hours", always with the hours and the night rule (copy rule 1, CEO 2026-10-20). The MIT 100× line is removed.
  - Its screenshots (`jr-*`) are not used: they show other clients and a real customer (copy rule 11). Every stop is drawn from this client's data.
  - The landing-page stop shows only when the client really has a page; most run on Meta forms.
  - The welcome and booking videos became prep toggles.
- **`CALLS_TOUR`:**
  - "stages" is reused on L6, renamed for clients: "The pre-pitch" became "What sets you apart", and "Locking the decision" became "Locking it in".
  - "calendar" (booking details) became L6 stop 8, drawn with a fictional customer. The Slack frame it used is not shown.
  - "script" (a knowledge base per firm) became L6's call-guide line.
  - "who" (3+ years, 50+ interviews, 4 trainings a week) is dropped. It is sales proof, the client has already bought, and it isn't needed to set expectations.
  - "listen" (the real recording) is dropped: there is no consent, and another client's brand would be exposed. The scripted call replaces it.
  - "nothing" (four follow-ups, same-day no-show call, "came but didn't sign? we follow up") is replaced by "up to 4 tries over 3 working days" and the fork on L2 stop 6. Since the CEO's answer of 2026-10-20 the fork's "Both of us" agrees with "Came but didn't sign? We follow up.", which the sales deck keeps. The same-day no-show call is still not said: "same day" stays banned for our calls (copy rule 1).
- **`ADS_TOUR`:**
  - "account" (20 ads, 11 on, 9 off) became L3's optional proof, drawn as neutral tiles. The screenshots show daily budgets, spend, a cost per result, other clients' ads and faces, so they are not used. Since 2026-10-20 the tiles are L3's core stop 2, where most switch off (the CEO's point), and the 20 and the 11 are no longer drawn or said.
  - Targeting, platforms, the market picker, portfolio, brief and offer are dropped: they are sales proof, and the client lived the Blueprint.
- **`CLOSING_TOUR`:**
  - The academy became O6 row 5, with the real course names.
  - "Weekly 1:1 check-in calls" became "1:1 check-in calls", "weekly or every two weeks with your success manager, depending on your plan and how long you've been with us", in the sales deck itself (CEO, 2026-10-20: "for both"). L11 says the same rhythm.
  - Mastery came back on 2026-10-20 as L8 (the CEO: "going through the sales training"), drawn from its real course names; since the CEO's second request the same day its two screenshots (`pcm-academy`, `pcm-lesson`) are shown beside the list as masked copies (copy rule 11). The reviewed-calls tracker stays out: the client marks outcomes, and their deals come to the check-ins.
- **`PORTAL_TOUR`:**
  - Overview, calls and outcome are kept (L9), and the phone film is added as a stop.
  - "Every lead, and the ad that brought it", "Your results, in money" and "Every ad" are dropped: they show leads and cost per lead (copy rule 3).
- **`TIMELINE`** ("Days 1 to 7", "leads in 7 to 10 days", "cost per lead comes down") is replaced by O5 and L11, with no promised times and no cost per lead.
- **Also removed:**
  - **`INCLUDED`**: "Every lead called within five minutes" is not copied (it says "lead"; the 5 minutes is on L2 stop 3, with the hours). The sales deck's consulting call now reads "weekly or every two weeks" there; the CSM decks carry the rhythm only as L11's check-ins. The rest is covered by O3.
  - **`NEXT_STEPS`**: the deposit and "live within 7 days" are removed.
  - **The speed slide (21×)** is removed.
  - **Proof** (stories, reviews, #1, 70+ firms) is removed: the client has already bought.
- **FAQ answers moved into notes:** "Can we listen to the calls?" (L6, L9) and "Do leads book themselves?" (L2, by showing it).

## From Mahara's own framework docs and templates

- **Onboarding Call Framework (16 steps):**
  - Only the steps a client needs to see became slides: goals, the team, one service, the road, access, starter ads, red lines, the next call.
  - Rapport, the agreement, the kickoff read-back, the WhatsApp people, payment, the upsell and projections stay in the talk track.
  - "Realistic is 2 to 4 projects a month" is kept off the slides, and the notes tell the CSM not to quote a number.
- **Launch Call Framework:**
  - The four goals shape L1 to L13.
  - "What if they don't like the ads" became L3.
  - Blocking busy time became L10.
  - The #1 job became L9.
  - Cadence became L11.
  - Housekeeping became L12 and the green light L13.
  - Temp checks are in the notes.
  - "Up to 8 follow-ups" is replaced by 4 tries over 3 working days.
  - "5x to 10x ROI" is removed (copy rule 2).
- **CSM "When Ads Launch" message:**
  - Feedback anytime went to L3 and L13. Check-ins went to L11, now weekly or every two weeks. Tracking went to L9, as the portal. Keep sending content went to L10. Say the awkward thing went to L13.
  - "Month one is always the slowest" is replaced (FCL PLAN).
  - After the launch call, the "Your part" card replaces the long message.
- **CSM day 8 message:** "The call centre handles every lead seven days a week" is not used. The hours are Saturday to Thursday.
- **Client Process Map:** "we call the same day" and "we confirm twice, 48h and 24h" are not used (the second is true only for provisional bookings). "A no-show is ours" is kept (L2 stop 6). "Someone who showed is yours" became shared, done for you (CEO, 2026-10-20): our caller follows up too, and the client still follows up and marks it.

## Deliberate overlaps (kept, and why)

- **"The first weeks are a test"** is planted on O7 with the red lines and paid off on L3, in the client's own words. L11 shows only the time window, as a bar, and since 2026-10-20 says the first two weeks are usually slower.
- **Content:** O6 is the first upload, for the Blueprint. L3 stop 5 says why it keeps mattering after launch (more content, more ads to test), and L10 is keeping the folder fed, as a job, against ad fatigue (2026-10-20).
- **The outcome:** it is named on L2 stop 7, shown on L9 and kept as one job on L10. L10 repeats it on purpose, because it is the job clients most often drop (30% marked).
- **Group hours:** stated on O3. L12's replies row shows only when this client never saw the onboarding deck (most clients in onboarding today passed their onboarding call before these decks existed).
- **The goal:** read on O2, shown again at the top of L11, so the promise to track it is kept where the tracking is planned.

---

# Open questions for the CEO

Each one names the default used in this copy. Questions 1 to 3 were answered by the CEO on 2026-10-20 and question 8 by the lead the same day; questions 24 to 29 came with the Gamma pass, 30 to 33 with creative flexibility and the video slots, and 34 with its spec review. The rest are open.

1. **The sales deck still promises speed.** It says "A call within 5 minutes", "Every lead called within five minutes", 21× and 100×, and callcenter.maharamedia.com says the same. The official figures for 20 Sep to 19 Oct are a median of 163 working minutes to the first dial and 1.8% dialled within 2 working minutes. So a client hears one thing on the sales call and another on the launch call. **Default:** the launch deck uses the fixed hours wording and the sales deck is untouched (out of scope here). Fix the sales deck and the public page to match?
   **Answered 2026-10-20** (slide numbers here are the ten-slide deck's: L8 is now L10, L9 is L11): "keep it 5 mins for all". The 5-minute promise stays in the sales deck and on the call-centre page, and the launch deck now says it too: L2 stop 3 ("We call new enquiries within 5 minutes during working hours, 10 to 6, Saturday to Thursday. Anything that comes in at night is called from 10 the next working morning."), the DWY stop 3 ("Call within 5 minutes.") and L8's DWY tile, L5's WhatsApp step and the default thank-you screen: our lines always with the working hours, and stop 3 (and L5's notes) also with the night rule; done with you, their own team's lines carry no hours. Copy rule 1 is rewritten; the 21× and 100× figures, "instantly" and "same day" for our calls stay out of the CSM decks. The measured figures above are unchanged.
2. **Weekly against every two weeks.** The sales deck promises "Weekly 1:1 check-in calls" and "a weekly consulting call". **Default:** every two weeks after the first check-in, as decided. Correct the sales deck too?
   **Answered 2026-10-20:** "for both put weekly-biweekly cause it depends on how long theyve been with us and what the offer". L9 now reads "Then weekly or every two weeks", with "Depending on your plan and how long you've been with us." on its own line under it and in the notes. The sales deck changes too: its check-ins item is "1:1 check-in calls", "Weekly or every two weeks with your success manager, depending on your plan and how long you've been with us: the numbers, the calls, the next move.", and its consulting-call lines say "weekly or every two weeks". Copy rule 5 is rewritten. The first check-in, a week or two after go-live, is unchanged.
3. **Who follows up a customer who came and is deciding.** As decided, it is the client's, which matches the Client Process Map. But the sales deck says "Came but didn't sign? We follow up", and the dialer has an attended follow-up script and a "Client handover". **Default:** the client's, on L2 stop 6. Should the deck mention that our callers may also check in after a meeting?
   **Answered 2026-10-20:** "We will call them to follow up to rebook but also the client has the most context and should follow up as well". A no-show stays ours: we call to rebook. A customer who came and is thinking it over is now followed up by both, done for you: L2 stop 6 reads "Came, and thinking it over? Both of us. We call to follow up, and so do you: you know them best. Then mark it." The client still marks the outcome. Done with you is unchanged: their own team makes the calls. The sales deck's "Came but didn't sign? We follow up." is true under this answer and stays. Copy rule 6 is rewritten.
4. **Where outcomes are marked.** The "When Ads Launch" message says the tracking sheet, the portal has the outcome form, and the sheet is still the authoritative record. **Default:** the Mahara OS outcome form on screen, with "the two stay in step" in the notes.
5. **The steps before the meeting are not uniform.** In the last 30 days there were about 50 confirmation calls against about 166 bookings. The day-before reminder buttons are live on 8 accounts. 40 of 47 no-show attempts ended lost. **Default:** the decided wording, as "what we do", with no "every". Comfortable showing "a confirmation call" in the sequence at that coverage?
6. **Welcome and booking videos.** Who records them, and which clients have them, is unconfirmed. **Default:** prep toggles, off. The copy says "a welcome message" until the CSM turns a video on.
7. **The real WhatsApp confirmation text has never been read word for word.** Its structure is known from a live message (an opening line, the date, the time, a location link, a closing line, the date in Latin digits). **Default:** the bubble follows that structure with our wording, labelled "Example wording". Share the live template so the bubble can match it exactly?
8. **"Month one is always the slowest"** is in the CSM templates and the performance arguments. The fast-launch plan drops it, and the measured first booking is about 4 days after launch (single source). **Default:** "the first weeks are a test", and "some first weeks are busy, some quiet" in the notes. Retire the line in csm-templates, along with the day-8 "seven days a week"?
   **Settled 2026-10-20 (LEAD decision 6, from the Gamma launch deck's "expect the first two weeks to be slower"):** L11's weeks 1 and 2 carry "Usually slower, while the ads find your audience." "Usually", never "always". The csm-templates line is still to retire.
9. **The Launch Call Framework doc** still says "Our goal is to get you a 5x-10x ROI" and "follow up up to 8 times". The Context Pack says about 8 attempts over 10 days. **Default:** neither appears; 4 tries over 3 working days. Correct the doc so CSMs don't read the old lines aloud?
10. **Starter ads under Mahara's shared identity.** The fast-launch guide allows starter ads to run under a shared Instagram and Page. If that is in use, the mockups on L4 and O7 would show the wrong Page name. **Default:** the client's own Page name from the kickoff, overridable in prep. Is the shared identity live for any client?
11. **The launch call as a gate.** The fast-launch guide says not to hold a ready campaign for a scheduled launch call, and the Onboarding Map puts the call before go-live. **Default:** the cover and O5 read true either way ("is live", "everything that's going live").
12. **The portal shows leads and cost per lead** on its Ads and results pages, and "lead" in the headings of the calls and outcome screens, while client messages never quote them. **Default:** the deck leaves the Ads and results screens out and crops the headings where it can. Should CSMs be ready to explain them, or should the portal hide them for clients?
13. **Hours at the edges of the week.** Thursday-evening and Friday enquiries wait for Saturday, and one of the two callers works 12 to 4 on Saturdays. **Default:** "called from 10 the next working morning". Is that true on a Saturday, or should the line say "the next working day"?
14. **Money goals on O2 and L11.** These are the client's own figures, read back to them. **Default:** shown as they wrote them, each card hideable in prep. Show the money, or the words only?
15. **The projections step on the onboarding call** (calculator.maharamedia.com, "realistic is 2 to 4 projects a month") anchors a result. **Default:** it is not on any slide, and the notes say not to quote a number. Keep the projections step in the call at all?
16. **Dialect and currency for the 30 clients with no country.** **Default:** taken from the service areas, else Kuwaiti with no currency word, switchable in the notes window.
17. **One call, two names.** The sales deck calls it "the kickoff call" (مكالمة البداية). **Default:** "onboarding call" / مكالمة التعريف, as on the Onboarding Map.
18. **DWY outcomes and Mahara OS.** The DWY SOP has their team move CRM stages, `serviceModel` says DWY gets no sheet, and the DWY flow in Mahara OS still needs per-client approval. **Default:** CRM stages on L9 for DWY, and the Mahara OS rows hidden until `dwy_os_approved`. Should DWY clients use the Mahara OS outcome form once approved?
19. **Platforms beyond Meta.** L4 draws only Meta placements, and the kickoff's platforms are choices, not campaigns. **Default:** no line, unless the CSM ticks "Planned next". Build Snapchat and TikTok frames?
20. **Real calls already in public use without consent.** The sales deck's recording (Wistia ti2alygqn0) and callcenter.maharamedia.com's six real calls have no consent record, and on 2026-10-07 the public page showed a lead's name and phone. **Default:** none of it is used in these decks. Take them down or mask them?
21. **What the client's own booking alert says.** Main bookings notify the client; whether that alert, or the Mahara OS appointment, carries the project, timing and budget is not confirmed (the only evidence is an internal Slack message). **Default:** L2 stop 5 says it lands with WhatsApp alerts for new bookings, cancellations and changes (the Gamma launch deck and LCF say so; since 2026-10-20), and L6 stop 8 shows "our caller's notes", tagged Example. Confirm what the client receives?
22. **How new ads reach the client for approval.** No source names a review link or a review date. **Default:** "You approve your ads in the group." Is there a link and a date we can promise?
23. **Which services have a starter pack today.** **Default:** O7 names the service only when prep confirms a pack, and the optional starter-ads stop shows only then.
24. **The consulting call on their deals.** The sales deck promises "a consulting call on your actual deals, weekly or every two weeks"; no SOP names a call apart from the check-ins. **Default:** it is the check-in: L8 says "At your check-ins, we go through your meetings with you", with no cadence (L11 holds it), and the notes let the CSM offer a call on a stuck deal (CJ). Is it a separate call?
25. **How long the launch call is.** The Onboarding Map says 20 to 30 minutes, the Client Journey SOP 45 and LCF 45 to 60. The deck is now about 27 minutes before questions. **Default:** O5 says "About 45 minutes" and L1's frame says the same. Is the booking calendar's launch slot 45 minutes?
26. **The reply time.** The Gamma launch deck says a reply within 2 business hours; LCF and OCF say 24 hours. **Default:** "within 2 working hours" on O3 and L12 (LEAD decision 7). Can the team keep it, and should the framework docs change to match?
27. **Ten open slots, over what window.** The Gamma launch deck asks for "a minimum of 10 dedicated spots with varied times" and names no window. **Default:** "at least 10 open slots, at different times", no window, and the notes say more of their opening hours is better. A week, or the next two weeks?
28. **Which course to start with.** O6 said "start with the onboarding course"; the Academy marks "01: Introduction [START HERE]"; the SOP's milestones say "intro and key content".
   **Settled 2026-10-20 by AC (the spec review):** O6 says "Join, and start with the introduction." Inside Project Closing Mastery, L8 starts them on its sales crash course.
29. **What the client's payment to us pauses.** The Gamma says ads, automations, software access and appointments. **Default:** "the ads, our calls and Mahara OS pause until it's sorted" (done with you: "the ads and the systems we run for you"). Is Mahara OS access really paused, and is anything else?
30. **The six seeded videos** (creative flexibility and video slots, 2026-10-20; the sixth added by the CEO the same day). Five are Mahara's guides (MOS, "Guides and video deliverables"); the sixth is the calendar-blocking Loom the Gamma launch deck embeds, seeded because the CEO asked ("embed the loom of how to block your calendar as well"). Their spoken language is not recorded for four of them (the Mahara OS guides' own titles say English and Arabic), and none has been checked against copy rule 11 for this use. The calendar Loom is 11 seconds long and titled "Untitled design 2" on Loom (oEmbed, 2026-10-20): watch it once before the ship, for another client's calendar or name. **Default:** the welcome video, the two Loom guides and the calendar Loom are seeded for any language, the Mahara OS guide as English and Arabic, and all six show on the canvas. Which language does each speak, and does any show another client's account, ads or calendar?
31. **Who records the seven empty slots, and in what order** (six recordings: the two `testing` slots take one). **Default:** they read "Not recorded yet" until a link is saved in prep; `testing` (creative flexibility) first, as the newest expectation, saved to both decks, then `first-90-days`, `start-to-finish` and `call-team`. One recording per language, or one for both?
32. **Who may save a video link.** A link saved in one client's prep shows on every client's deck. **Default:** any active CSM seat or the CEO, as the lead asked, each save with an audit row and the saver's email on the row. Should it be the CEO or the CSM lead only?
33. **The pushback line reads the client's 90-day goal back to them** (L3's notes and its "Copy reply"), which may be a money figure in their own words. **Default:** said as they wrote it (copy rule 3 allows their own goals); while the goal counts enquiries or appointments, the line names "what you want from your first 90 days" without saying it. Comfortable with the CSM saying a revenue goal aloud there, and writing it in the group?
34. **Does the creative team ask the client in the group before it makes a new round?** (The spec review, 2026-10-20.) L3 stop 3 asks the client to send ideas "before we make the next round", which leaves them to guess when that is. **Default:** not said. If yes, stop 3's line becomes "We ask you in the group before we make the next round: ideas, a new offer, a new price, something to change."

---

# Source key

| Code | Source |
|---|---|
| BR | Snapshot workflow "3. Booking Router & Notifications" (966abbc0): WhatsApp confirmation on booking, reminder 1 day before, SMS 2 hours before. Read by the example-call scout. |
| CEO | Aziz's answers to open questions 1 to 3, 2026-10-20 (quoted under [Open questions](#open-questions-for-the-ceo) and in copy rules 1, 5 and 6), his request of the same day to add the Gamma decks' expectation setting, the sales training and the piece of the pie, and his dictated request of the same day for creative flexibility and video placeholders (the lead's brief `gamma/creative-flexibility-brief.txt`, with the lead's reading of the dictation) |
| CV | The video the CEO pointed to with that request (a coach on handling clients' small edits, 14:30 to 17:30), as the lead's brief paraphrases it: set the expectation before it becomes an issue, on the launch call before the ads go live; on pushback, go back to what was agreed on the onboarding call ("let me pull it up"), say the last thing you want is to delay their launch and the outcome they named, ask what matters more, the edit or that outcome, and on their answer, "let's get them live". Used for the method only; its client counts, its revenue figures and its "we won't do it" are left out |
| AC | The Premium Projects Academy's classroom, as the sales deck's `pcm-academy` and `pcm-lesson` screenshots show it, read 2026-10-20: six courses in order (Introduction [START HERE], Onboarding, Google Optimization, Offer Creation, Project Closing Mastery, Team & Operations) and Project Closing Mastery's sections (01 Sales Crash Course, 02 Objections, 03 Follow Ups, 04 Bonuses, one bonus the No Show Protocol). Read for facts; since 2026-10-20 (the CEO) shown on L8 as masked copies (copy rule 11) |
| CJ | "Client Journey SOP", Google Doc, read 2026-10-20 (the call lengths, the milestones M1 to M6, the problems tables: the lead quality myth, the declining card, outcomes one word long) |
| GL | Mahara's Gamma deck "Launch Call Presentation" (gamma.app/docs/Launch-Call-Presentation-5svlg7ouf118pgo), read 2026-10-20, with its two pictures (the pie, the two roads) |
| GO | Mahara's Gamma deck "Welcome to the Premium Projects Program" (gamma.app/docs/Welcome-to-the-Premium-Projects-Program-tjjm02dj2i7dy0v), read 2026-10-20 |
| LEAD | The lead's decisions 1 to 9 for the Gamma pass, 2026-10-20 (the new partnership and training slides, the portal's "tell us" set, "Your part" at six jobs, the alerts, the slower first weeks, payments and replies, the onboarding check, the list left out) |
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
- "The numbers decide" is said once, on L3. L4's footer is gone, L9 is a bar labelled "Finding what works", L8 row 1 is the action only, and O7's teaser became the red-lines ask.
- "Your part" is a five-tile checklist with "Why it matters" lines, doubles as the recap card, and now sits before the 90 days (L7, L8 your part, L9 the 90 days, L10). The Arabic head is دوركم.
- The deck never leaves on Esc. The cover uses only a custom creative, at its own size in a phone, else the faint lanes.

**Shoulds accepted** (in brief): the journey is seven stops lit by owner, about 2.5 minutes, and the deck is about 22 minutes. Claims were corrected: the next working morning, 3 working days, no "just now", your calls recorded, before the meeting, the approval scope, the swap is a preview, planned platforms, the 30, 60 and 90-day check-ins, the exact form match with a CSM tick, DWY's CRM, the starter pack named only when it exists, and "lands with you" without unverified fields. L3 concedes first. O3 is the team as their WhatsApp group, with the hours. O7 can show the starter ads. L6 ends on what lands with the client and says that not every enquiry books. The call has pain variants and per-country budget bands. Several Arabic words changed (اللي يميزكم، لين، الاختبار، نحتاجه منكم and others). DESIGN took the wider lanes, the tray-first upload, state held in the shell, signed URLs, the avatar order, 22 px tags, the faint-lanes onboarding cover and pacing by line length.

**Rejected or changed, and why**
- **L3 proof from the client's own tray** (flow): drawn as neutral tiles instead, as the claims and design lenses ask. Dimming their real creatives before launch reads as a verdict on ads that haven't run, and a client with two creatives can't fill the grid.
- **The proof caption** (claims): "The numbers decide which stay on" became "Some stay on, some go off", so L3 says "the numbers decide" once, as the flow lens asks. The lit and dimmed tiles carry the rest.
- **Reminders on the journey** (design's recommended pick): they live on L6 after the call (flow's pick). The call's last line promises the WhatsApp, so the confirmation lands as its payoff, and the journey stays at 2.5 minutes. The design lens's reason, the dotted return line, applies to the no-show fork, which stays on the journey.
- **The lanes on O3** (design): O3 is the WhatsApp group (flow). The lanes mean "who handles this enquiry", which pays off only on the launch journey. The group is what the client joins that day, and it carries the hours. The faint lanes still open the onboarding cover, so the shape is seen first there.
- **The CSM named in O3's group** (flow): by role. The lead put the CSM's name on the cover only.
- **The "We agree" button** (flow wanted the wording): no button on the canvas (design). The wording moves into the stamp and the notes-window button.
- **"We fix the same day"** (flow, on L3): "the same day" dropped. It is a speed promise that the media buyer's queue and Meta review can break, the point the claims lens makes about the swap.
- **"A review link with a date"** (flow, on L3): no source names one, so the line reads "You approve your ads in the group", and open question 22 asks.
- **"Try any of your creatives in the phones"** (claims): "We can show any of your creatives in the phones", because the client cannot click.
- **«كورس البداية» for the onboarding course** (flow): "The start" is a different Academy course, so the Arabic gives the course its own name, Onboarding.
- **O7 without "the first weeks are a test"** (flow): the lead listed it for O7, so the heading stays, now carrying the red-lines ask instead of a teaser.
- **The Academy on O3** (lead's list): it moves to O6 row 5 only, so it is said once, with what it is.

**Also fixed while in there:** the English `{project}` values say "your"; the English call uses `{time}`; 2:51 uses `{engineer}` so design studios fit; a missing Instagram handle drops its bubble; unknown access reads "Not checked yet"; `{next.*}` shows nothing until booked.

**2026-10-20, the CEO's answers to open questions 1 to 3.** Copy rules 1, 5 and 6 are rewritten to his words. The launch deck now says we call new enquiries within 5 minutes (L2 stop 3 and its UAE line, the DWY stop 3 and L8's DWY tile 2, L5's WhatsApp step and the default thank-you): our lines always with the working hours, and stop 3 (and L5's notes) also with the night rule; done with you, their own team's lines carry no hours, because the hours are theirs. "New enquiries go to the top of the list" left stop 3's line; the queue card still shows the list. The check-in rhythm is "weekly or every two weeks", with "Depending on your plan and how long you've been with us." on its own line under L9's key and in its notes; the first check-in is unchanged. The fork's "came, and thinking it over" end is "Both of us" done for you; DWY is unchanged. The decision table's three rows, L2's notes and sources, L5, L8's DWY tile, L9, the merged-and-removed lines and the source key (CEO) follow. `CONTENT-AR.md` and `DESIGN.md` (section 19.13) changed with them, and the code takes the same English strings; the copy test's rules 1, 5 and 6 (`deck-copy.test.ts`) move to the new rules with it. `EXAMPLE-CALL.md` stated none of the old rules and is unchanged. After the check the same day: L5's notes gained the night rule, the Arabic stop 3 notes give a UAE client's hours, the done-with-you queue chip reads "Your team" (the stop's words say how fast), and L9 draws the weeks between as smaller open diamonds, so the unbooked first check-in keeps its own look.

**2026-10-20, the Gamma pass.** The CEO asked for the expectation setting in Mahara's own Gamma decks: the sales training, the piece of the pie, what we do against what they do. Every item and picture in both Gamma decks is placed in [From the Gamma decks](#from-the-gamma-decks-ceo-2026-10-20). The launch deck goes from ten slides to thirteen: L7 `partnership` and L8 `training` are new after the call, the portal becomes L9 (its number-one job now carries the "tell us" set), "Your part" becomes L10 (six jobs, grouped by when), the 90 days L11 (weeks 1 and 2 "usually slower"), L12 `good-to-know` is new ("Before we go live": the money rows and the housekeeping that was the green light's first stop) and the green light is L13, the question alone. Journey stop 5 names the alerts (new bookings, cancellations and changes); "Keep the offer steady" moved to L3's notes. The onboarding deck gains only the reply time on O3 ("within 2 working hours") and a note to check who is in the group; O5's launch call reads "About 45 minutes". The decision table, the data map, copy rules 1 and 11, the merged-and-removed lines, the open questions (8 settled; 24 to 29 new) and the source key (AC, CJ, GL, GO, LEAD) follow, and `CONTENT-AR.md` and `DESIGN.md` (section 20) changed with them.

**2026-10-20, the spec review.** Eighteen findings on the Gamma pass were applied before the build, in this file, `CONTENT-AR.md` and `DESIGN.md` (20.14 lists them):
- L7: the pie is two pieces (ours three quarters, theirs one quarter pulled out), with two leaders; done with you it splits by owner in halves, theirs pulled together; the roads lost their length labels; stop 4 shows one line and "Marketing without sales won't grow your business." is said.
- L8: the four words are labelled "What it teaches"; "when" and "who" are one statement, ending on the sales crash course; the lead names the course once; AC lists the course's real sections; the follow-ups section is in the notes.
- L9: one-line captions under the three taps; "Moved: we change the reminders. Cancelled: we call to rebook."; the "why it matters" note left (its one home is L10); a note to add whoever meets the customers to Mahara OS.
- L10: the title is the one line "Your six jobs, in one place"; job 1's why is two sentences; head 3 is "Week to week"; the ads and follow-up whys no longer restate other slides; done with you, the calling job is under "Before your meetings" and the marking job is "Move each meeting to the right stage the same day"; the recap ends with the course link; 2 minutes, with 30 seconds each from L4 and L3.
- L6 stop 7, done for you: "Before the meeting, the messages come from us, so your customer hears one voice."
- O6: "Join, and start with the introduction." (open question 28 settled).

Two findings asked for different wordings of the done-with-you regroup of L10; this file takes "Call new enquiries within 5 minutes, and note every try" and "Move each meeting to the right stage the same day" · "Your stages show which ads bring real projects.", the pair that came with its Arabic. The finding on L12's payment rows reached the build cut off after "nobody has confirmed that Mahara OS access paus…", so its fix is not known: row 3 keeps LEAD decision 7's wording ("the ads, our calls and Mahara OS pause until it's sorted", which GL also states) and open question 29 stays open.

Where the copy differs from the lead's nine decisions, and why:
- **The pie is our one piece, named three ways** ("Ads and enquiries", "Calls and bookings", "Reminders and rebooking"), and theirs, "The meeting and the close" (four equal pieces until the spec review), so nothing is a percentage. "Reminders so they show up" became "Reminders and rebooking": what we do, not a result we promise, and the no-show rebook is ours.
- **The title arrives in two stops** ("We bring them to your door." with our pieces, then "You win the project." as theirs pulls out), so the presenter says the split in the order the drawing shows it.
- **Done with you, the pie is two halves, split by owner:** ours holds the ads and enquiries and the confirmations and reminders that go out by themselves (DWY SOP), theirs the calls and bookings and the meeting and the close, pulled out together. One quarter would have hidden the automations we run for them; three would have claimed the calls.
- **The roads** carry no "harder and longer" or "easier and faster" (no speed claim about their sales; since the spec review, no length labels at all), and say "comparing you with others", not 5.
- **The partnership line** is "We can't close for you. We can help you get better at it.", plainer than "we're here to help them get better at it" (the humanizer pass).
- **The consulting call carries no cadence on L8.** It says "At your check-ins, we go through your meetings with you"; the rhythm keeps its one home on L11, so the deck doesn't say "weekly or every two weeks" twice three slides apart. Open question 24 asks whether it is a separate call.
- **The course list keeps the Academy's own order,** with Project Closing Mastery lit, not moved to the top: the client finds the courses in that order, and the Academy itself marks Introduction "START HERE" (open question 28), so the slide never says "start with" Project Closing Mastery. Its screenshots are not reused (copy rule 11).
- **The portal's set gained two lines the lead didn't list:** "Quote sent later? Update it then." (a quote often goes out days after the meeting) and "Not yet: a line on why." (the outcome form's own box; the Client Journey SOP's outcomes that come back one word long). "We call to rebook" is said as what the mark lets us do, so the no-show keeps its home on L2 stop 6.
- **"Your part" is grouped by when** (before your meetings, after each meeting, week to week), two jobs each, instead of six equal cells, which would be the stock feature grid (DESIGN 20.7). "Never block a whole day" reads "On a day off, block the hours, not the whole day", because a day off is the case it is about. "Put each booking in your own system" is said for teams that plan in other software, since the booking already lands in their calendar.
- **The payments and replies take their own slide** (L12), because with the existing three they are five items, more than three calm cards. L12 takes the title "Before we go live" with the housekeeping it already headed, and the green light keeps only the question. The replies row still shows only for a client who never saw the onboarding deck (group hours keep their one home on O3).
- **The launch call's length moved** on O5 and in L1's frame to "About 45 minutes" (the Client Journey SOP's length): the deck is about 27 minutes before questions, so "20 to 30 minutes" was no longer true. Open question 25.
- **"Keep the offer steady" is said, not shown,** on L3: its foot line already carries the approval and "Prefer something different later?".
- **L6's last note** drops "I'll show you next": the portal is now three slides on.

**2026-10-20, creative flexibility and video slots.** The CEO's request of the same day, read from the lead's brief (his words, the lead's reading of the dictation, a paraphrase of the coach's segment he pointed to, the lead's direction and five existing videos). L3 is rewritten as five stops (the ads' job, the volume, their input first, a quick check, the content), with the field of ad tiles as its picture from stop 2, the pushback handle in the notes tied to the client's own 90-day goal, and 3 minutes; O7's red-lines line plants it in one sentence; a [video slot](#video-slots-ceo-2026-10-20) registry covers both decks, with the recap's "Missed something on the call? Watch:" block; the decision table, the data map (`{videos.*}`, `goal90` in L3's notes), copy rule 11, L10's notes, the merged-and-removed lines, the open questions (30 to 33) and the source key (CEO, CV) follow. `CONTENT-AR.md`, `DESIGN.md` (section 21) and the new `VIDEOS.md` (the backend contract) changed with them.

Where this differs from the lead's direction, and why:
- **One slide, not two.** The field carries stops 2 to 5, so each press changes one thing in one picture; two slides would split the field from the deal it explains and add a fourteenth slide.
- **The title stays** "Your red lines are fixed. The rest, we test.": the five stops unpack it, its Arabic is approved, and the stamp ("Agreed to test this way") keeps its words.
- **"Keep the offer steady" is on screen at stop 3** (the lead allowed 3 or 4): the offer is input, and input comes before we make the next round.
- **The field has no count.** The old caption's "20 versions" was one real account's snapshot (11 of 20 on), which says "some stay on"; the CEO's point is that most switch off, so the field is tagged Illustration and nothing on it is a number.
- **Stop 4's notes add what off-brand means** (it breaks their red lines or their Brand DNA, so we fix it before it goes live) beside "a matter of taste goes into the next round", so "small style changes wait" is never read as "we ignore your brand".
- **The training slide has no slot.** The lead listed "partnership + training"; the course itself is the training video and its link is in the recap, so `winning` on L7 covers why the course comes first.
- **Some slots are done for you only** (the journey, the call, the partnership) or wait for Mahara OS approval (the guide, WhatsApp and calendar): a recording of the done-for-you way would show a done-with-you client the wrong steps.
- **`welcome_video` and `booking_video` are kept, not folded or retired.** They say whether the client's own messages to their customers carry a video about the client (L5's thank-you, L2 stop 4), which is a fact about their funnel, not a deck video; the server's prep list keeps both keys, so saved rows stay valid, and prep's Videos section says where they live. Open question 6 still covers them.
- **The O7 plant is one sentence plus one spoken line**, and O7 gets no video slot, so the onboarding deck stays as short as it was.
- **The deck is about 28 minutes** (L3 went from 2.5 to 3), and the notes window's target moves with it.

**2026-10-20, the spec review of creative flexibility and the video slots.** The thirty-six findings on that pass that reached this revision (the list arrived cut off inside the thirty-sixth, on the player's messages; DESIGN 21.10 says how it was read), and two requests the CEO made while the pass was being built, applied before the parallel build (backend: the migration and its test; frontend: the deck), in this file, `CONTENT-AR.md`, `DESIGN.md` (21.10 lists every finding and where it went) and `VIDEOS.md`, which is now the final contract.
- **The CEO's two requests.** The calendar-blocking Loom is seeded on `calendar-hours` (six seeds, five slots filled on day one); the copy rule that refused it was inconsistent with the five other seeds, none of which had been checked either (open question 30 now covers all six). Project Closing Mastery's two Skool screenshots are on L8 as masked copies (copy rule 11 rewritten), as two stops before the statements.
- **Set before the ads exist.** O7's approval line names the facts, prices and claims, its testing line plants the small check, and its notes send ideas, the offer and the facts to the Blueprint call or the group before it. L3's intro no longer claims to come before the ads exist. L4's notes set the guard rail before the phones.
- **Two new slots.** `onboarding:testing` on O7 (the same recording as the launch deck's `testing`) and `launch:first-90-days` on L11. Twelve slots in all.
- **The handle, in writing and warmer.** The recap gains "How we test your ads", so the quick check agreed on L3 is in the group; the handle goes back to both agreements, opens with "The last thing we want is to hold your launch for a small change.", asks with one of three goal lines (shown, held back, none), closes, offers their version in the next round as the way out, and has a "Copy reply" for pushback in the group. Stop 4's notes give the CEO's reason for a small check (volume) and say what counts as more than taste.
- **The recap reaches the client even when time runs out:** "Copy for the group" is on L13's notes and on the notes window once the deck closes.
- **L3's picture:** the field arrives all lit at stop 1 and switches off at stop 2's press (no timer); the feed phone left the slide.

Where this pass departs from a finding, and why (each is also in DESIGN 21.10):
- **"If you skip this, say the video is in your group."** is said once, in the notes window's Video block on every slide with a filled slot, not copied into each slide's notes: one home, and it never shows for an empty slot, where there is no video to point to.
- **The "Copy reply"** is also in prep's slide 4 panel (slide 3 since the fixer's round), because pushback in the group comes after the call, when the notes window is closed.
- **L8 is three stops,** not one with two pictures: the classroom, then the lesson, then the two statements. Two screenshots side by side at the end column's width would be unreadable on a share, and the slide ends on the ask (who watches it first).
- **The read takes its deck.** The finding asked every function to refuse a null deck; the read used null for "both decks", which no window needs (each reads its own deck), so the read now requires it too.

---

# Humanizer pass

Run 2026-10-19 over every English on-screen string, presenter note and fallback in this file and over the English subtitles in `EXAMPLE-CALL.md`, against the humanizer skill and Hallmark's `copy.md`. No fact, slot, copy rule or decision changed. The copy was already plain: the scan found no em dashes, curly quotes, exclamation marks or banned words (seamless, elevate, unlock, empower and the rest), so the pass is small. The kinds of change:

- **Slogan cadence removed.** O3's "one team, in one group" became a plain sentence naming who is in the group.
- **Verbs first.** O1's agenda went from "Your launch service, chosen" style labels to "Choose your launch service", under "Before we hang up, we'll:". This also matches the Arabic, which was already verb-first.
- **Active voice.** "Your first ads are being finished" became "We're finishing your first ads", and "Yours is being finished" became "We're finishing yours". Two notes went active as well (L3 "They ask for changes in the group", L10 "agree a date to solve it").
- **Vague or marketing words made concrete.** O4 "speaks to one kind of customer" became "are all written for one kind of customer", which also drops an "every" that copy rule 4 would trip on. L3 "your page's own content" became "your page's own posts". L6 "we'll complete with you" became "we'll fill in with you".
- **Inflated claim swapped for a sourced fact.** L7's note "the one habit that decides how the next months go" became the measured gap: only 30% of recent appointments have attendance marked (PS §8, now in L7's sources).
- **Stock phrases out.** L10 "the highs and the lows" became "the good and the bad" (the Arabic already said الزين والشين). The 2:17 subtitle "every step of the way" became "step by step", closer to خطوة بخطوة, in this file and in both variants in `EXAMPLE-CALL.md`.
- **Elided strings written out.** The two video variants (L2 stop 4, L5 stop 3) were fragments that opened on three dots, so a build could have shown the dots on the canvas. Both are now full sentences.
- **Small fixes.** L8 tile 4's dangling "Asked first, we can plan it in" became "If you ask first, we can plan it in". Also "the next one" on O4, "their time" in O1's notes, and O5's road metaphor in the notes became "we send the next one to their WhatsApp group".

**Kept on purpose.** The fixed calling line (copy rule 1) and every pinned wording in the decision table. The sourced lines that sound like slogans but come from Mahara's own frameworks: "What isn't marked can't be improved" (LCF), "An ad waiting for the perfect version earns nothing while it waits" and the L3 close (PEA), and "Don't filter. We will." (O2L). Hallmark's curly quotes and em dashes are not used, because copy rule 9 (plain quotes, no em dashes) is binding here.

**Arabic.** `CONTENT-AR.md` mirrors each English change in its English column. The Arabic changed only where the meaning moved: O3's `team.line` (no longer "one team") and L7's stop 4 spoken line (now "this is the job most often forgotten"). Both were written under the voice skill, and `team.line` stays in slide-level white Gulf Arabic.

**`DESIGN.md` is untouched.** Its wireframes still quote three of the old strings (O1's agenda, O3's line and L6's legend). Per its own line 21, the final words are in this file.

---

# Composition pass (2026-10-20)

The slides were recomposed so each has its own structure and one primary (DESIGN 19.11). Where a composition needed fewer or split words, the copy changed here, in `CONTENT-AR.md` and in `content.ts` together. No fact, slot or decision changed.

- **O2, nothing from the form:** the title "Your goals, in your words" is gone; the question is the slide's one heading.
- **O5:** the launch call's line is split in two. Its caption is its date once booked, else "20 to 30 minutes"; "We walk you through everything that's going live." sits under it. A passed step with no date on file reads "Done" (the status word the deck already uses).
- **L3:** no eyebrow ("Creative freedom" sat over a title that says it). Stop 1's words are cut to one lead ("Ads show in the feed, marked Sponsored, to people who don't know you yet. They don't appear on your page.") and a foot line ("The polished work belongs in your page's own posts."). "They're made for people who don't know you yet" folds into the lead. The approval loses "Once you have, we test versions of them side by side." (the title says the rest is tested, and the pick line says how), and the footer loses its second "in the group": the two now read as one foot line, "You approve your ads in the group. Prefer something different later? Ask, and we'll launch it too."
- **L7 stop 4:** no screenshot and no amber tag. Its sentence is set as its parts: "A few taps, the same day." under the job, and the three questions as three taps ("Did they come?" · "Did you quote?" · "Did you win?"). The stop's full copy line stays the record of the wording.
- **L8:** no "Why it matters" column head (each job carries its own why, so nothing heads a column).


---

# Humanizer pass on the Gamma copy (2026-10-20)

Run over every new or changed English line of the Gamma pass (on screen, notes, fallbacks: L2 stop 5, L3's notes, L7 to L13, O3, O5) against the humanizer skill. The scan found no em dashes, curly quotes, exclamation marks or AI vocabulary (crucial, key, ensure, seamless, delve and the rest), and "every" or "always" only in the client's own jobs ("mark every meeting") and in quoted sources. What changed from the lead's and the Gamma's wording, and why:

- **Service-desk phrasing out.** "We're here to help them get better at it" became "We can help you get better at it." "Keep us informed if you don't have enough funds" became "Running low? Tell us first, and we'll pause the ads safely."
- **Implied results out.** "Reminders so they show up" became "Reminders and rebooking" (what we do). "Easier & faster" and "Harder & longer" became "A shorter road" and "A longer road". "More leads mean more appointments" was cut.
- **Jargon to plain words.** "As campaigns ramp up" became "while the ads find your audience". "Might reset the AI data" became "reset what the ads have learned". "Comprehensive Sales & Closing Mastery" became "The one for your meetings is Project Closing Mastery."
- **Instructions given a reason.** "Book them on your project management software" became "If your team plans in other software, the booking goes there too, so nobody books over it." "Don't block the entire day" became "On a day off, block your working hours, not the whole day: calendars can miss an all-day block, and we'd book into it."
- **An invented anecdote and threshold removed in review.** A draft note said a client "lost a month" to a wrongly blocked day, and that "ten minutes late isn't a no-show". LCF says only that a client left after we booked over their appointments, and no source sets a lateness threshold, so the notes say exactly that.
- **The word "lead" kept out of the notes** (copy rule 3): the SOP's "lead quality myth" is cited in the sources, not said.

**Kept on purpose.** "We bring them to your door. You win the project." (the lead's direction; two plain sentences, and the drawing makes the split). "Marketing without sales won't grow your business." (the Gamma's and OCF's own point, said once). The three-item lists that are real lists: our three pieces of the pie (the Gamma's three "we do" items), and "the ads, our calls and Mahara OS" (what a failed payment pauses).

---

# Humanizer pass on creative flexibility and the video slots (2026-10-20)

Run over every new or changed English line (L3's five stops, its notes and fallbacks, O7's line and note, the slot titles, the recap block, the notes-window and prep lines in [Video slots](#video-slots-ceo-2026-10-20)) against the humanizer skill and Hallmark's `copy.md`. The scan found no em dashes, curly quotes, exclamation marks, "leads" or AI vocabulary (the doc's own "key part" became "main part"), and "every" or "always" only in the red lines' "Always…" lead, in quoted sources and in the prep line about every client's deck. What changed from the brief's and the lead's wording, and why:

- **Jargon and hype to plain words.** "Your ads are there to bring enquiries and revenue" became "Your ads are there to bring in business: enquiries from people who don't know you yet." (the CEO's "drive revenue to the business", in a firm owner's words, and no number implied). "That is how the winners are found" became "That's how we find the few that work." (active, and "winners" read as a promise).
- **Passive to active.** "Most ads get switched off" on the canvas became "We make many versions and switch most of them off." The notes keep the passive once, where the subject is the ads, not us.
- **What we vary, made concrete.** The five chips (Angles · Hooks · Formats · Thumbnails · Who's on camera) became one line, "Each one tries something different: the hook, the angle, the format or who's on camera.", so the field says why there are so many.
- **The handle in Mahara's voice.** The coach's "we're not going to do it" and "after working with X clients" are gone. Kept: set it before they ask ("When you see your ads, you'll want to change small things. We'll keep those for the next round, so your launch doesn't wait."), go back to the onboarding call's red lines, then the client's own goal: "You told us the goal is {goal}. What matters more: this one change, or getting the ads live so we can get there?"
- **Slot titles are what the video is, not the slide's title again.** "The Mahara OS guide", not "Mahara OS, your portal"; "Why we test so many ads", not "Creative freedom"; the two on O6 are short ("Meta access", "WhatsApp and calendar") so both fit one control.

**Kept on purpose.** "Then a quick check, not a redesign": the lead's phrase and the slide's one contrast, which says what the check is not. "Your input comes first" and "Keep the content coming": plain, and the stops' names in the notes window. "Missed something on the call? Watch:": the lead's line, a real question the client would ask.


---

# Humanizer pass on the spec review's lines (2026-10-20)

Run over every new or changed English line of the spec review (O7's approval and testing lines and its note, L4's first note, L3's stop 3 line and notes, the three goal lines, the warm opener and close, the way out, the "Copy reply" variants, the recap's testing line, L8's screenshot notes and alt text, L11's slot, L13's note, the new notes-window lines) against the humanizer skill and Hallmark's `copy.md`. The scan found no em dashes, curly quotes, exclamation marks, "leads", AI vocabulary, or "every" or "always" for our process steps. What changed from the findings' wording, and why:

- **No line said twice on one slide.** L3 stop 1's note kept "It stays as polished as you like." and dropped "Your page is your brand", which the new opening ("Your brand matters, and your page is where it shows.") already says.
- **The held-back goal says what it is without saying it:** "You told us what you want from your first 90 days." The client recognises their own goal; the CSM never reads out an enquiry count.
- **The way out is plain, not a concession speech:** "Then we'll make your version too and run it beside the others in the next round. The numbers tell us which works."
- **The reply in the group is two sentences of what happens next,** with "Thanks, noted." in front and nothing about policy.

**Kept on purpose.** The findings' own lines where they were already plain: "The last thing we want is to hold your launch for a small change.", "Great, let's get them live. Your change goes into the next round.", "How we test your ads: …" (a real three-part list: the red lines, the input, the check).


---

# Visual and language review of creative flexibility and the video slots (2026-10-20)

Applied the same day, with `CONTENT-AR.md`, `DESIGN.md` and `VIDEOS.md` in step. The English lines below went through the humanizer skill: plain, active, no em dashes, no exclamation marks, no "every" or "always" for our steps, no "leads".

- **L3, the goal in the pushback** is quoted, never spliced: "You told us your goal is "{goal}". What matters more: …", and the same in "Copy reply". A goal written as "We want…" read as broken grammar inside our sentence, and "Copy reply" pastes it into the client's group. The notes window sets the goal on its own line, isolated, under "Their goal, in their words:", between the question's two halves, so an English goal never wraps inside an Arabic line.
- **L3's talk track follows the stop:** the notes window steps back the lines for the other stops and brings the current stop's first line into view on each press. The Arabic cues now name their stop too, "(Stop 3, the offer)", as `CONTENT-AR.md` already did.
- **L3 on the canvas:** the red-lines panel is the deck's own panel with an amber hairline (the amber wash rendered grey); "Facts · Prices · Claims" is set larger than the sentence under it; the stamp moved to the title row; a red line in the other script keeps the panel's direction, its words isolated, as on O7.
- **L5's thank-you stop** says the call at the slide's size, done for you: "Then your thank-you screen, and a welcome message. Our team calls them within 5 minutes during working hours." The promise was only inside the phone.
- **L6's clock** reads "Call length" over 4:51 once the call ends ("Call ended" read as a time beside "Wednesday, 4 pm").
- **L7's ad road** winds in rounded hairpins of different depths, not a square wave.
- **L8:** the four parts get even room (220 px columns); the lesson shot ends above "05: Closing Deposits" (rule 7).
- **L10's open-slots why** matches its picture: "On a day off, block each hour, not one all-day event."
- **L11's ringed check-ins** fall on the four-week grid, so the legend reads "Around 30, 60 and 90 days, …".
- **O7's approval line** no longer repeats its head: "They go live only once you've approved the facts, prices and claims in them."
- **The hours** ("10 to 6", "١٠ صباحاً إلى ٦ مساءً") never break inside on any slide.
- **The video control** has one grammar, "Watch:" then the items, for one video or two, and the player's veil is opaque.
- **Kept:** L2 stop 3's calling line as copy rule 1 fixes it (a two-line cut would drop "during working hours"); the calendar Loom's 0:11 (Loom's own oEmbed says 11.1 s); the portal screenshots, which are byte-pinned to the sales deck, so "Lead quality" (product UI, rule 3) and the soft calls shot are re-made at the source if at all.

---

# The fixer's round, score round 1 (2026-10-20)

Every slide the score round put under 4 brought to at least 4, and the cheap clear wins applied. `CONTENT-AR.md`, `DESIGN.md` (21.12) and the code are in step. The new English lines went through the humanizer skill: plain, active, sentence case, no em dashes, no "every" or "always" for our steps, no "leads".

- **Order:** creative freedom is L3 and the ads L4, so the guard rails are agreed before the first look (the coach's point the CEO adopted). Every `L3` and `L4` in these files, older notes included, now follows the new order. The ads slide's notes point back: "As we just agreed".
- **O3:** one line, "Everyone who works on your account is in this one group.", the same in both service models.
- **O7:** the testing line opens with the ads' job, "Your ads are there to bring in business, not to look like your page." The Arabic deck names the service only in Arabic (`service_focus_ar`) and leaves a Latin-only name unnamed, with a prep note.
- **L2:** every row of stop 4's dots leads with its time ("Before the meeting · a call to confirm"); "Came, still thinking it over?"; the fork's nodes sit on their names; one rebook mark with an arrowhead; stop 7's form in two pieces, larger.
- **L3:** stop 1's small line lost its absolute ("They show in people's feeds, marked Sponsored, not as posts on your page."); their pick runs on a lit tile; stop 4 says "You check these in the group before an ad goes live." once; the notes group by stop and fold the pushback.
- **L6 stop 8:** "Everything our caller learned lands with you." leads the cards; the clock is in the deck's digits.
- **L7:** the ad road's reasons are written on its bends.
- **L8:** the lead says why ("Enquiries from ads are meeting you for the first time. This course is how you win them.", reworded in score round 2); the Academy is named over the list; the course's tile is ringed; the lesson is cropped larger.
- **L9:** the title on one line; the phone at the end margin, about 840 px; "Lead quality" masked; the taps numbered; the moved line on one line ("we change the reminders or call to rebook").
- **L10:** the pictures under the Drive job; the dark cells keyed once, "Blocked".
- **L11:** one glyph for the rhythm, one for the look back.
- **L12:** "Good to know", under "Money" and "Messages".
- **The recap:** the testing line carries the style-change rule and the content ask; the money and first-weeks lines go out every time until their videos are recorded.
- **Not done here, and why:** a dark-mode re-capture of Mahara OS (it needs a sign-in to a demo workspace; the screens were made crisper instead); an Arabic version of each card Do's & Don'ts line in prep (it needs a new prep key on the server, which is the backend's migration); kitchen-interior starter pictures for the harness (no such picture exists in the repo); moving "Leave the ads running" into the middle column (it is a week-to-week job). Recording the `testing`, `payments` and `first-90-days` videos is still the team's.

---

# The fixer's round, score round 2 (2026-10-20)

Every slide score round 2 put under 4 brought to at least 4, and the cheap clear wins applied. `CONTENT-AR.md`, `DESIGN.md` (21.13) and the code are in step. The new English lines went through the humanizer, the Arabic ones through the voice skill's client register.

- **L2:** stop 3's "5 minutes" is underlined in teal, as L5's band marks it; the queue card names each row's own service (`prep.services_ar` in Arabic) and leaves a row's service out rather than repeat the first. Stop 6's words sit at the stage's top, where stops 3 and 5 set theirs, and the fork alone is level with "You meet"; the fork ends above the lanes' foot in Arabic too.
- **L3:** the red-lines panel is headed "Never" and "Always"; the lines typed on O7 carry a small "you told us"; in the Arabic deck the card's English lines sit under "من ملفكم" (From your card), quoted, and prep says so. Stop 5's words sit on stops 3 and 4's anchor. The stamp is in the text face.
- **L5:** the thank-you stop has no leader: the band's highlight and its underlined "5 minutes" pair it with the phone's message.
- **L6 stop 7:** the transcript goes; the reminders and the confirmation start level with the call card, which rests where stop 8 keeps it; every reminder is one line.
- **L7:** in Arabic the roads sit 49 px lower, under the taller header (the first crest's words had been drawn on the caption); "Comparing you with others" is over the last crest.
- **L8:** "This course shows you how to win them." (it read "This course is how you win them.", close to a results promise; the Arabic already said "يعلمكم كيف"); the leader ends at the screenshot's edge and the ring alone marks the tile.
- **L9:** the Arabic overview is masked like the English; the recorded call is drawn at 880 px; stop 3 shows the install address and the phone in from the margin.
- **L10:** the calendar week has three rows (eleven open slots), its key on the "Day off" line.
- **L11:** the in-between check-ins are drawn in ink-3.
- **L12:** each money row's do-this is in ink.
- **O3:** the Arabic reply hours never strand "من" at a line's end.
- **O7:** the plant is three lines (the ads' job, the volume, the ask over the list); "templates for kitchens" in sentence case.
- **The recaps:** the launch recap carries "Who does what: …" until the `start-to-finish`, `call-team` and `winning` videos are recorded and shown; O6's links carry O7's plant until the `testing` video is.
- **The chrome and the notes window:** one space in "Back to {client}"; the video block leads with "If you skip this, say the video is in your group."
- **Not done here, and why:** a typed Arabic line for each card Do's & Don'ts item (`dos_donts_ar`) still needs the server to keep the key, which is the backend agent's migration; until then the panel quotes the English lines under "من ملفكم". Journey stop 5's calendar stays four hours (cropped, its entry would leave the lit row's line). Training stop 3's statements stay at the list's top (level with the lit course, they would run past the foot).
