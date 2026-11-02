# Upsell studio: the content

Every client-facing word the upsell studio adds, in English and Gulf Arabic: the seven offers' catalog copy, the website deck's canvas and talk track, the website video's narration and labels, the decks' shared chrome and the offer page's own strings. Built 26 Oct 2026 from the CEO's upsells doc, menu and backend program, PLAN.md (its amendments first) and CONTRACT.md section 3.3.

This builder makes no screen, so there is no design plan here: the canvas lines are sized for the deck's type scale (CONTRACT 5.8: at most 90 characters English, 110 Arabic, titles 40), and the deck and proposal builders set them.

Nothing here reaches a client until the CEO approves the Arabic in one batch: [ARABIC-FOR-APPROVAL.md](ARABIC-FOR-APPROVAL.md).

## Files

| file | holds | read by |
|---|---|---|
| `supabase/migrations/20261026x_upsell_catalog_copy.sql` | `cockpit_upsell_catalog.copy` for all seven offers, `{en, ar}` | the proposal builder and page, the Offers tab, the picker, the deck (get, need, close) |
| `apps/client-success-cockpit/src/present/offer/content/types.ts` | `OfferNotesCopy`, `OfferSlideCopy`, `OfferDeckCopy`, `OfferVideoCopy`, `OfferFact`, `OfferChromeKey`, and the slot list | deck, video |
| `.../content/shared.ts` | `OFFER_CHROME` | deck, video |
| `.../content/website.ts` | `WEBSITE_DECK`, `WEBSITE_SLIDES`, `WEBSITE_KEY_SLIDES`, `WEBSITE_STOPS`, `WEBSITE_GET_KEYS`, `WEBSITE_NEED_KEYS` | deck |
| `.../content/websiteVideo.ts` | `WEBSITE_VIDEO` | video |
| `sites/offer/strings.js` | `STRINGS` for the offer page | the page (`core.js`), the cockpit preview (`?raw`), the tests |
| `apps/client-success-cockpit/scripts/offer-copy.test.ts` | the structure and form test | |
| `apps/media-buyer-cockpit/scripts/upsell-copy-supabase.test.ts` | every line through `cockpit_client_copy_problems`, and the migration | |
| `docs/upsell-studio/ARABIC-FOR-APPROVAL.md` | every Arabic line beside its English, numbered, generated from the files above | the CEO |

## The rules every line keeps

| rule | where it is enforced |
|---|---|
| No promise, guarantee, outcome, performance number, ad metric, lead word, upsell or renewal word, discount, em dash; money only on the bill | `cockpit_client_copy_problems` (20261026u), run on every line by `upsell-copy-supabase.test.ts`; the x migration itself refuses any catalog line it blocks |
| No mention warning either (guarantee, free) | the same test expects zero problems of any kind |
| "Your account manager", never CSM, client success manager or a name | `offer-copy.test.ts` |
| No call centre, appointment, booking, "turn up" or "come to the meeting" line in the deck, the video, the offer page or any offer's catalog copy, since all of them go to every client pitched, done-with-you clients included (PLAN, Done with you). Cameraman day alone may book: it books a filming day | `offer-copy.test.ts` (paths `deck.`, `video.`, `strings.` and `catalog.` except `catalog.cameraman.`), which also proves the rule catches the lines it rewrote |
| None of the humanizer's banned words; no exclamation marks, curly quotes or guillemets | `offer-copy.test.ts` |
| Every key in both languages; catalog list keys the same and in the same order | `offer-copy.test.ts`, and the table's own check `cockpit_upsell_copy_ok` |
| Arabic: Arabic-Indic digits, never ٬ or a lone ٠, no digit or slot glued to بـ or لـ, no quotes around Arabic words | `offer-copy.test.ts` |
| Arabic on screen and on the page is white Gulf: no Kuwaiti-only or Saudi-only words | `offer-copy.test.ts` |
| Saudi spoken lines carry no Kuwaiti-only words, and the other way round | `offer-copy.test.ts` |
| تمام never طيب, never مقاول (voice skill) | `offer-copy.test.ts` |
| Every Arabic line is on the approval sheet, as written | `offer-copy.test.ts` |

Plain quotes, not curly: the cockpit's decks already settled this (blueprint and deck copy tests), and the humanizer agrees.

## 1. The catalog copy (20261026x)

Each offer's `copy` is `{en: C, ar: C}` with exactly the keys `cockpit_upsell_copy_ok` wants (BACKEND.md "The copy shape"): `name`, `deckTitle`, `line`, `parts` (one bill line per seeded part), `terms`, `timing`, `get`, `need`, `steps`, `why` (key, label, text), `button`, `cta`, `close`, `work` (empty: nothing we built is cleared to show, CONTRACT decision 7), and `platforms` for social media.

What each key is for:
- `name`: the offer in the Offers tab, the picker and the deck's notes. `deckTitle`: the proposal page's title.
- `line`: one sentence for the picker and the Offers tab.
- `parts`: the bill of quantities' description column and the page's investment lines.
- `terms`, `timing`: under the bill. Timing is counted from payment and content, never a calendar date and never a result. Second campaign and UGC have no timeline in the doc, so their timing names what starts the clock (approval of the ads, of the script).
- `get`, `need`, `steps`: the proposal's lists. The website's `get` keys are the deck's slide 3 stops and the art builder's icon names (`pages`, `portfolio`, `whatsapp`, `form`, `tracking`, `care`); its `need` keys are `logo`, `photos`, `services`.
- `why`: the proposal's "Why this, for you" triggers. The account manager picks one and may edit it; the first is the default.
- `button`, `cta`, `close`: the page's Yes button, the WhatsApp message it opens, and the closing question on the deck's slide 5.

Per offer, from the doc with the plan's cuts:
- Website: the build plus the care plan, always together; "two weeks after we have your content".
- Second campaign: "a daily amount for the new service's ads, paid to Meta from your card", with no figure and without the word budget; never "covers ad spend up to 3,000".
- SEO and GEO: named "Google and AI search" on screen (no bare GEO); "If you have no site, we build one into it", never itemised; the pages, profile and listings stay theirs; the terms say a site we build moves to its monthly care on day 91 (PLAN, What is specific to each offer). None of the cut lines ("almost nobody in the Gulf", "working for clients here", "turn up and sign", "a separate source of appointments").
- Social media: reels "a bonus, never a promise"; platforms named in both languages.
- Cameraman day: the three months is "the aim", stated as such.
- UGC: named "Presenter videos"; the presenter never poses as the owner (the `face` trigger says the presenter speaks for the firm in their dialect, nothing more); no "thirty percent better". The doc's "follow-ups for new leads and new bookings" is "Two follow-up videos to send people after they enquire" (فيديوين متابعة ترسلونهم للناس بعد ما يستفسرون): no lead and no booking.
- Closer placement: the free replacement as a contract clause about the hire ("we recruit a replacement at no cost"), no hire date, no "pays for it several times over".

### How the migration behaves

1. A guard refuses to run before 20261026u.
2. It runs every string through `cockpit_client_copy_problems(text, false)` and refuses the whole file, naming each path and rule, if any line is blocked.
3. It reads every offer's current copy. Blank (`{}`) is written; equal to this file is left alone (so it applies twice, or a third time, with nothing written); anything else refuses the whole file with "The client copy for <offers> was changed after this file was written. Read it, then write the change in a new migration."
4. Each write bumps the revision, sets `updated_by 'migration'`, and leaves one audit row `upsellCatalog.copy` with the line "Website: client copy written in English and Arabic".

It creates no table or function and grants nothing. The CEO's price list cannot carry copy (`cockpit_upsell_catalog_set` refuses a `copy` key), so after this file is applied, any change to the words (the CEO's Arabic edits included) is a new migration that expects this file's copy as the current one.

## 2. The website deck (`WEBSITE_DECK`)

| slide | title | stops, in order | lines (picked by the client's data) |
|---|---|---|---|
| `saw` | What we saw | `capture`, `cloud`, `ask` | `cloud_none`, `cloud_broken`, `cloud_thin` (the note on the cloud by site verdict or prep's thin tick); `ask_site` (the ask when the capture is their own site) |
| `matters` | Why it matters for you | `words`, `tie` | `goal90`, `goal12_24`, `challenges`, `why`, `typed` (the label above their words, by prep's `goal_pick`); `words_empty` (no answer on file: the slide asks instead) |
| `get` | What you get | `drawn`, then the six get keys, then `need` | `drawn_plain` (the first stop when prep has no logo or no example stills); `sketch_home`, `sketch_projects`, `sketch_services`, `sketch_about`, `sketch_contact`, `sketch_whatsapp`, `sketch_enquire` (the drawn site's own words, singular in Arabic because they speak to the client's customer) |
| `investment` | The investment | `bill`, `beside`, `ask` | `first_year` (what "This, first year" adds up), `project_ask` (no project value on file). The `beside` notes line follows the value's source: `(beside, from your answer)`, `(beside, from your sheet)` or `(beside, no figure on file)` |
| `next` | Next step | `commit`, `close` | `plan` ("A plan for the work, not a promise of results") |
| `runs` (H) | How it runs | `steps` | `us`, `you` |
| `proof` (P) | Firms we work with | `quote` | (the tag is `OFFER_CHROME.fromMainProgramme`) |
| `video` (V) | The website, in one minute | `play` | |

`WEBSITE_STOPS` is the stop order the deck walks. `next.stops.close` equals the catalog's website `close` (pinned by the test).

### The talk track

- Every slide has `say` (English), `sayKw` (Kuwaiti) and `saySa` (Saudi). `dialectFor` in `callScript.ts` picks the Arabic one. `next` also has `push`, `pushKw`, `pushSa` for "if they push back".
- A line opens with its stop in brackets, "(capture)", or a case, "(No site)"; a whole line in brackets is a direction to the CSM. Neither is said aloud, and the notes window may group by the bracket.
- `branches` (`no_site`, `broken`, `working_on_it`): what to say for each answer to slide 1's question (the doc's step 1 to 2).
- `objections` (`busy`, `burned`, `expensive`): the doc's three reasons, each ending with where to go next.
- `price`: `hold` (says the price again and goes back to their project; tells the CSM to tap Held full price before any lower number), `lower` (only after Held full price, with the reason typed; said, never shown, with the new payment link), `split` (the website has no split: hold full price).
- The doc's step 5 ("More people actually turn up, and more of them sign") and every lead and call-centre line are cut (PLAN Proof table). Step 3's reframe sits on slide 2, rewritten without "lead", and says what the film says: "Everyone who sees your ad looks you up first. What they find in the next thirty seconds decides whether they get in touch, or quietly go cold." (It said "come to the meeting" until the evening of 26 Oct; a meeting a done-with-you client never had booked through us is not theirs to hear.)

### Slots

`{name}` (the client's name; in the WhatsApp message, the CSM's own first name signing off), `{date}`, `{city}`, `{build}`, `{care}`, `{final}`, `{project}`, `{video}`, `{next}`, `{url}`. The price slots appear in notes only and take the figure with its unit as `formatMoney` writes it; the test pins that no canvas line carries one.

### The WhatsApp message

Three versions (`en`, `kw`, `sa`), each with `{video}`, `{next}` and `{name}`: thanks, the one-minute video to watch again or send to partners, the agreed next step, and the CSM's first name. No price and no lead.

### Outside facts

For the notes only, each with source, year and where it was measured. Each was checked against a second source on 26 Oct 2026:
- Fogg and others, Stanford with Consumer WebWatch, 2002: design and look in 46.1% of credibility comments (2,684 people, US).
- Lindgaard and others, Behaviour & Information Technology, 2006, reported by Nature: visual appeal judged within about 50 ms (lab study, Canada). Worded as visual appeal, which is what the study measured.
- CSA Research with Kantar, 2020: 76% of online shoppers prefer product information in their own language (8,709 shoppers, 29 countries).

The plan's BrightLocal 2026 figure (54% visit the site after reading reviews) could not be found in BrightLocal's published summary, so it is left out. None of the facts is a Gulf figure, so all are `country: "any"` and say where they were measured.

## 3. The website video (`WEBSITE_VIDEO`)

| beat | seconds | narration starts | on screen (`labels`, every word the film sets, in the order it lands) |
|---|---|---|---|
| hook | 0 to 5 | "Someone sees your ad." | Example, Example ad, Hosh Design & Build, and the feed post's own Sponsored and Learn more (مُموَّل، معرفة المزيد, as the platform writes them) |
| gap | 5 to 15 | "What they find in the next thirty seconds…" | Example, Captured {date}, 30 seconds (a dimension on the error page), The page doesn't open |
| what | 15 to 35 | "We build you a site." | Example, Six pages, Arabic and English, the title block, the six pages, WhatsApp, Enquiry form, Tracking, Care |
| need | 35 to 45 | "Three things from you." | Example, What we need from you, the three things, 2 weeks from your content |
| return | 45 to 60 | "How many projects would pay for this?" | Example, Bill of quantities, Item, Description, Quantity, Your typical project, This, your numbers: a drawn schedule with no price column and no figure |

`poster` is the still before play: "Your website, in Arabic and English" (موقعكم، بالعربي والإنجليزي). The closing line is the CEO's own: "Your account manager will walk you through it." In Arabic it names the team, فريق نجاح العملاء.

Apart from the capture's own date, the only digits in the film's words are "2 weeks" and "30 seconds", both said in the narration too; the test refuses any other.

The narration is the script v1 with its two booking lines rewritten on 26 Oct, because one cut goes to every client and done-with-you clients never hear an appointment line:

| film line | was | now |
|---|---|---|
| en-2a | "...decides whether they turn up, or quietly go cold." | "...decides whether they get in touch, or quietly go cold." |
| en-3e | "The link goes with the booking confirmation, so they see your work before they meet you." | "Send the link before a first meeting, so they see your work before they meet you." |
| ar-2b | هو اللي يقرر إذا بيحضر الموعد، ولا بيختفي بهدوء. | هو اللي يقرر إذا بيتواصل معكم، ولا بيختفي بهدوء. |
| ar-3e | والرابط يوصل مع تأكيد الموعد… | وترسلون الرابط قبل أول اجتماع… |

The video builder has written all four into `tools/offer-video/film/lines.json`, and the narration test passes against it. The English draft voice still says the old two lines (lines.json keeps them as `voiced`), so the English cut is not sendable until it is voiced again.

The labels were brought in line with the v4 film on the evening of 26 Oct: the film had drawn words this file did not hold (the feed post's two words, "30 seconds", "Six pages", "Arabic and English", the schedule's title and columns, "your numbers", the poster), so the CEO could not approve them. They are all here now, through the copy check and on the approval sheet. Two film words still differ from this file (the kicker and one apostrophe), and the film follows this file (section 7, video). The rest differ only in form: the film sets "Example." with a full stop before "Captured {date}", and writes the closing's ".." as a comma on screen.

## 4. Chrome and the page's strings

`OFFER_CHROME` has the contract's 23 keys. `dollars` is the one label allowed to name a currency (the bill's money column), and the database test proves it is refused without `p_money_ok` and passes with it. The revision letters stay Latin in Arabic (Rev A, Rev B), as Gulf drawings write them. "Example, drawn for {name}" drops the name in Arabic (مثال، رسمناه لكم), since a name after لـ reads badly. "Your typical project" is مشروعكم المعتاد (was مشروع معتاد عندكم): shorter, the English word for word, and what the film already shows.

`STRINGS` has the contract's keys in both languages with the same slots, plus `states.videoGone` (EDGE.md item 5): a video link that has ended lands on the page's front with `?gone=1` and reads "This video link has ended. Message your account manager for a new one." (رابط الفيديو هذا ما عاد يشتغل. راسلوا فريق نجاح العملاء، ويرسلون لكم رابط جديد.). Because a closed video link lands on `?error=1`, `states.error` now names the page, not the proposal: "This page didn't load. Refresh it, or message your account manager." (ما قدرنا نفتح الصفحة. حدّثوها، أو راسلوا فريق نجاح العملاء.). `preparedBy` in Arabic is من إعداد {name}، فريق نجاح العملاء: a noun, because a verb (جهّزه) would make the account manager a man. The expired and archived states are the plan's own words: "This proposal has expired. Message your account manager for a new one." and "This proposal is no longer active. Message your account manager."

## 5. The Arabic

- Written fresh under mahara-context's `aziz-kuwaiti-voice` (SKILL.md v3.26, current with GitHub on 26 Oct, and references/master-context.md), following the CS decks' Arabic decisions (docs/csm-decks/CONTENT-AR.md): the client in the plural, white Gulf on screen, نبدي not نبدأ in Kuwaiti, تمام never طيب, no مقاول, loanwords in Arabic script where people say them (واتساب، سكربت، بوست، ريلز), money as دولار, Arabic-Indic digits with no thousands mark.
- The proposal is عرض سعر (decision 12). "Your account manager" is فريق نجاح العملاء (decision 8; the sales deck's مدير حسابك is the alternative, for the CEO).
- Cameraman day uses مصور. The voice skill bars a cameraman for now; the plan's default 12 lifts that for this offer, so the approval sheet asks the CEO to confirm, and the skill's line needs the same edit in mahara-context.
- Saudi lines use وش، كذا، في and نبدأ; Kuwaiti lines use شنو، جذي، ب and نبدي.

## 6. Tests and checks (all on the VPS through vrun.sh, evening of 26 Oct 2026)

| command | result |
|---|---|
| `apps/client-success-cockpit: bun test scripts/offer-copy.test.ts` | 32 pass, 0 fail (1,269 expects), the narration test included |
| `apps/media-buyer-cockpit: bun test scripts/upsell-copy-supabase.test.ts` | 12 pass, 0 fail: every line, the new ones named, comes back from `cockpit_client_copy_problems` with no problem at all, warnings included, under the db builder's current rules (`internal_word` and `discount` among them) |
| `apps/media-buyer-cockpit: bun test scripts/upsell-catalog-supabase.test.ts`, `-decks-`, `-gate-`, `-proposals-`, one file at a time, with this x | 18, 23, 21, 27 pass, 0 fail |
| `npx tsc -b` in both apps | clean |
| the two test files type-checked from a config outside the repo (each app's tsconfig covers `src` only): `hw-notes/upsell-studio/scratch/content-tsc.sh` | clean |
| `bunx biome check --line-ending=auto` on every file listed above | clean |
| `bunx biome check --line-ending=auto src`, media buyer | no errors (65 warnings, none in these files) |
| `bunx biome check --line-ending=auto src`, CS cockpit | one error, not in these files: the formatter wants `src/present/offer/art/icons.tsx` (the art builder's) rewrapped |
| `bash scripts/check-shared.sh` | shared files are in step |

The approval sheet is generated, never typed: `hw-notes/upsell-studio/scratch/gen-approval.ts`, copied to the VPS as `~/upsell-build/gen-approval.ts` and run with `vrun.sh . 'bun ~/upsell-build/gen-approval.ts'` into a scratch file, then copied over `docs/upsell-studio/ARABIC-FOR-APPROVAL.md` (514 numbered rows and lines). Rerun it after any change to the words; the structure test fails until it is.

## 7. For the builders after this one

**deck**
- Read slide titles, stop lines and variants from `WEBSITE_DECK.slides[id]`, in `WEBSITE_STOPS[id]` order; `DECK_NAME.offer_website` is `WEBSITE_DECK.name`; the tab is `WEBSITE_DECK.tab`.
- Slide 3's get lines on the canvas are the stop lines (short); the catalog's `get` texts are the proposal's (long). The need lines on the canvas come from the catalog's `need`.
- Pick `saw.lines.cloud_*` by the site verdict (`broken`: `cloud_broken`; `none_on_file`: `cloud_none`; prep `site_thin`: `cloud_thin`). A `failing` result needs a second check before the deck calls the site broken. Use `ask_site` when the capture is their own site.
- Slide 3's first stop: show `get.stops.drawn` ("with your logo and your projects") only when prep has a logo and at least one `example_stills`. Otherwise show `get.lines.drawn_plain` ("A first sketch, drawn for you") and the notes line that opens "(drawn, no logo or no photos on file)". The other "(drawn)" line goes with `drawn`.
- Slide 4's `beside` notes line follows the source of the value on the canvas: "(beside, from your answer)" for the onboarding answer or a value prep typed with a date, "(beside, from your sheet)" when it is `project.sheet` (tagged `OFFER_CHROME.fromSheet`), and "(beside, no figure on file)" when the CSM types it live. Show only the one that matches.
- Fill `{build}`, `{care}`, `{final}` and `{project}` in the notes only. Show `price.lower` only after Held full price; `price.split` is guidance that the website has no split.
- The WhatsApp `{name}` is the presenting CSM's first name.

**proposal**
- `STRINGS.proposalFor` takes the client's name; `preparedBy` takes the account manager's first name (only when `showCsm`).
- The page's front reads the door's three flags, each to its own sentence: `?gone=1` to `states.videoGone`, `?busy=1` to `states.busy`, `?error=1` to `states.error` (EDGE.md item 5).
- The page's platform names come from the catalog's `platforms`.
- `upsellTestDb()` applies x by default, so a fixture that reads the catalog sees real copy unless it sets its own.

**video** (needs from the video builder, in `tools/offer-video/film/`)
- The need beat's kicker: `build.py` COPY `kicker` is still المطلوب منكم. It should be `OFFER_CHROME.weNeed.ar`, اللي نحتاجه منكم, the deck's own words (approval sheet choice 6).
- The gap beat's note: COPY `note` has a curly apostrophe ("The page doesn’t open"). It should be the straight one in `WEBSITE_VIDEO.beats[1].labels.en`, as every other line here.
- The English voice: en-2a and en-3e still say the old booking words (their `voiced` field). Voice them again before the English cut is sent.
- Every other word the v4 film draws (COPY and COPY4) now matches `WEBSITE_VIDEO.beats[*].labels` and `poster`. A word added to the film from here goes into `websiteVideo.ts` first, so it reaches the copy check and the approval sheet.

**art**
- `bunx biome check src` in the CS cockpit fails on the formatter alone in `src/present/offer/art/icons.tsx` (`arrowHead`'s two arrays and `cycle`'s signature want wrapping). `bunx biome format --write` on that one file fixes it.

**orchestrator** (the contract, 5.7)
- `sites/offer/strings.js` `states` gains `videoGone` (EDGE.md item 5).
- `OfferVideoCopy` gains `poster: L`, the still's one line.

## Open

- The CEO's one-batch approval of the Arabic (ARABIC-FOR-APPROVAL.md), with its eight choices.
- The voice skill's cameraman line, in mahara-context (not pushed from here).
- The BrightLocal figure, if the CEO wants it back: it needs the survey's own page.
