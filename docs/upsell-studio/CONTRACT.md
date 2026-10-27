> Interface contract, preserved from the continuation notes on 27 October 2026. Read SHIP.md for current verification and release status.

# Upsell Studio: build contract (pilot, 26 Oct 2026)

Scope is the PLAN's amendment 6: the WEBSITE offer end to end. That means the catalog with all 7 offers seeded, the gate, the Offers tab, the website deck with prep and notes, the Hot list row, the pitch log, the proposal builder with the client's page and its door, and the website video. Second campaign follows later on the same factory and is not built here.

Sources, in the order they win:
1. The CEO's 26 Oct words, quoted in the task.
2. PLAN.md's AMENDMENTS.
3. PLAN.md's body.
4. This contract.

Where this contract departs from the plan's body, section 1 says so and gives the reason.

Worktree: `/Users/abdulazizwaheedi/mahara-worktrees/billing-pending` (branch `upsell-studio`, base `054c5992`). GitHub main is already at `22542426` (Forms Stage 1), which changed `AuthenticatedAppRoutes.tsx` and `cockpit-csm-api/tools.ts`. Keep shared edits as small insertions away from those hunks, so they re-apply cleanly on main.

## 0. Rules every builder follows

- **Hard limits.** Never commit, push, apply a migration, deploy, ship or upload to Wistia. Never write to Supabase, ClickUp, GoHighLevel, Meta or Slack.
- **Supabase reads.** Read only, with this command:

  ```
  composio execute SUPABASE_BETA_RUN_SQL_QUERY -d @file.json < /dev/null
  ```

  The file holds `{"ref":"bldgtotkfmhoxmlzowdx","read_only":true,"query":...}`. A large answer is written to `outputFilePath`: read that file, then delete it. Never print secrets or contact details.
- **Where things run.** Edit files on the Mac. Run every type check, lint, test, build, dev server, harness, screenshot and render on the VPS through `/Users/abdulazizwaheedi/mahara-worktrees/hw-notes/upsell-studio/vrun.sh <dir> '<cmd>'`. Never run tsc, bun test, vite, biome, playwright or a render on the Mac.
- **vrun syncs with `--delete`.** Anything generated inside `~/upsell-build/repo` that is not on the Mac gets wiped on the next sync. `node_modules`, `dist`, `.vercel` and `tmp` are excluded, so those survive.
  - Media goes in `~/upsell-build/media/`.
  - Shots go in `<app>/tmp/` on the VPS, then get copied back with scp.
- **Mac disk and scratch.**
  - Check `df -h /` before every heavy step. Under 0.8 GB free: stop and report.
  - Scratch lives only in `hw-notes/upsell-studio/scratch/`, and stays small.
  - `scratch/live/*.sql` holds the live function bodies read on 26 Oct, each headed by its `md5(prosrc)`.
- **Shared code.**
  - `apps/client-success-cockpit/src/present/**` is shared with other sessions.
  - New code goes in new files: `src/present/offer/**`, `src/pages/money/offers/**`, `src/dev/offer/**`.
  - A shared file is touched only at the insertion points this contract lists, with the fewest lines that work.
  - No refactors, no renames, no reformatting of other people's code.
- **Design.** Before any screen, load the design skills, then write a short design plan (tokens, type, layout, one signature element) at the top of your doc in `docs/upsell-studio/`. Then build.
  - `MC=/Users/abdulazizwaheedi/Documents/Codex/2026-10-13/https-github-com-azizwaheedi-mahara-context/work/mahara-context` (newest checkout on this Mac, 13 Oct). If it looks stale, read the current file from GitHub `AzizWaheedi/mahara-context`. Never push to it.
  - Load `$MC/skills/frontend-design/SKILL.md` and Hallmark (`~/.cache/mahara-ship/skills/hallmark/SKILL.md`).
  - Hallmark's six pre-emit scores must all be 4 or more. Run the 58-gate slop test on the VPS screenshots before you hand back.
  - Inside the cockpit, use the CS cockpit's own kit: `src/components/kit.tsx` (PageHeader, StatTile, Chip/Dot tones, Pill, Kicker, Fold), `src/components/ui/*`, `src/lib/format.ts`, `--mahara-teal`, Geist, and `docs/DESIGN.md`.
  - Nothing may look AI-made: no gradient, glow, shadow lift or looping motion, and no icons in circles.
  - Copy is plain and active, with no em dashes, and never uses "unlock", "seamless", "upsell" or "lead" in client copy. Run the humanizer pass on all copy.
- **Arabic.**
  - Arabic is written only under `$MC/skills/aziz-kuwaiti-voice` (SKILL.md and references/master-context.md). It is written fresh, never translated.
  - Slides use white Gulf Arabic with no dialect-only words.
  - Spoken lines in the notes are Saudi for Saudi clients and Kuwaiti otherwise (`dialectFor` in `src/present/callScript.ts`).
  - Arabic sets in IBM Plex Sans Arabic, with a mirrored layout. Digits follow `present/figure.ts`.
- **Never on a client's screen, page, video or message:**
  - upsell, renewal, lead, CPL, spend, or a budget figure;
  - a list price, a struck-out price or a discount;
  - a promised result or a guarantee;
  - the words "account manager" replaced by "CSM" (client copy says "your account manager").
- **Missing is never zero.** An empty slot hides its line and says, where only the CSM sees it, what to do next.
- **Numbers.** Every number says where it came from.
- **Rules that carry over from the plan.**
  - Never an AI version of Aziz: his closing clip is his real footage.
  - A generated person never poses as a client or customer.
  - Real screenshots stay real wherever they show a gap.
  - No client's work without their written OK. A fictional demo firm tagged "Example" stands in until then.

## 1. Decisions this contract makes (departures from the plan's body)

1. **Prices.**
   - All 7 list prices start blank. The doc's price is a one-click hint (the CEO's words: "Don't put a set price yet").
   - There is no floor, no price asks table and no CEO approval (amendment 3). A price below list needs a one-line reason, and it is logged.
   - A locked offer (SEO and GEO) must use the list price exactly, and the lock is CEO only.
2. **Capture files** (dated screenshots of a client's gap) get their own table, `cockpit_upsell_files`, and a private bucket, `cockpit-upsell-files`. They do not get a new kind in `cockpit_csm_launch_ads`.
   - Reason: the launch tray parses `kind` with strict enums in three places (`present/sources.ts` zod, `cockpit-csm-api/launchAds.ts`, `hermes/editor-desk/desk/deck_import.py`). A new kind would break the tray.
   - Client logos still use the existing `logo` kind in `cockpit_csm_launch_ads`, which needs no change.
3. **Offer prep keys** are checked by a new `cockpit_csm_offer_prep_value`. `cockpit_csm_deck_prep_save` routes offer decks to it. The 12k-character `cockpit_csm_deck_prep_value` stays untouched.
4. **Offer video slots** are `offer_<key>:demo`, in en and ar. They are added to `cockpit_csm_deck_video_slots()` in SQL but **not** to `present/videos.ts` VIDEO_SLOTS. `scripts/deck-videos.test.tsx` pins those to exactly 12 from the 20261020 migration.
   - Offer decks get their own registry, `src/present/offer/videos.ts`.
   - Saving or clearing an offer video is CEO only.
5. **The win** (amendment 1) is any one of these, with no shown appointment:
   - a quotation in the last 30 days (`cockpit_client_days.quotations > 0`, through `ghl_clients.clickup_id -> location_id`);
   - a signed project on record (`closes > 0` on any day);
   - the CSM's "They've had a win", typed, dated within 30 days and audited.
6. **The renewal date** comes from the latest `cockpit_csm_renewal_plans.renewal_date` for the card, else `launchDate + 90 days`. The table has 0 rows today, and client rows carry no renewalDate.
   - Offers pause from 30 days before that date until an outcome is recorded (renewed, resold, not_this_cycle or lost).
   - The pause also ends 30 days after the date if no outcome is ever recorded, so it never blocks forever.
7. **Proof.** joeandsera.com, greystonegcc.framer.website and euphoriainteriors.ae stay off every screen (the plan's Proof section beats its Proposals section). The proposal's "Work we've done" seeds empty and hides when empty.
8. **Proposals.**
   - No "Accept and pay", no Whop plan creation and no "Send on WhatsApp" in the pilot. Copy link is the only way out, and the WhatsApp send button stays absent.
   - A proposal below list needs a one-line reason, the same rule as the deck's opening price.
   - The split (SEO only) appears only after full price was held: a pitch with `held_full` for that offer in the last 60 days, or a proposal sent at full price.
9. **The proposal preview** in the cockpit is a sandboxed `srcdoc` iframe. It is built from the offer site's own files, imported with `?raw`, so the preview and the client's page cannot drift. The cockpit's CSP needs no change.
   - The cockpit deploys as a standalone app. Byte-identical public renderer copies live under `proposal/page/`, imported with `?raw`. `scripts/offer-page-sync.mjs --check`, the shared check and a regression test reject drift from `sites/offer`. No Vite filesystem allowance is needed.
10. **Logo candidates** come from three places only: the verified logo (`cockpit_client_logos`), the deck's uploaded logo, and icons found on the client's own site by the site check. Meta, Brand DNA, ClickUp attachments and Instagram come later.
11. **Hot list.** The pilot adds one offer row to the client page's Hot list card. The company Hot list tab (`csmHotList.ts`) is unchanged until Second campaign.

## 2. Names and keys (shared by every builder)

- **Offer keys** (catalog primary key, URL segment), in the written order used for "this month's offer":
  1. `website`
  2. `second_campaign`
  3. `seo_geo`
  4. `smm`
  5. `cameraman`
  6. `ugc`
  7. `closer`
- **Deck kinds.**
  - The database accepts all seven `offer_<key>`. The front end builds only `offer_website`: `BUILT_OFFER_DECKS = ["offer_website"]`.
  - `DeckKind` becomes `"onboarding" | "launch" | "blueprint" | "offer_website"`.
- **Routes in the CS cockpit** (base `/client-success`):
  - `/clients/:key/present/offer/:offer`: the deck. `?view=prep` gives prep, and `/notes` gives the notes window.
  - `/clients/:key/proposals/new?offer=<key>`: creates a draft, then replaces the URL with the draft's address.
  - `/clients/:key/proposals/:id`: the builder.
  - `/money?tab=offers`: the price list, the videos, the settings and the pitch log.
  - The word "upsell" never appears in a route, a title or on the canvas.
  - The deck tab reads `<Client>: your website` (content key `WEBSITE_DECK.tab`).
- **Website slide ids, in order:**
  - `saw`: What we saw, Rev A. Stops: `capture`, `cloud`, `ask`.
  - `matters`: Why it matters for you. Stops: `words`, `tie`.
  - `get`: What you get, Rev B. Stops: `drawn`, one per catalog `get` line, then `need`.
  - `investment`: Stops: `bill`, `beside`, `ask`.
  - `next`: Stops: `commit`, `close`.
  - Key slides, hidden until their key: `runs` (H), `proof` (P, hidden until the offer has cleared proof; until then one main-programme testimonial labelled "From our main programme"), `video` (V).
- **Video slots:** `offer_website:demo` in en and ar, plus `offer_<key>:demo` for the other six (allowed by the database, unused).
- **Prep keys for offer decks** (`OFFER_PREP_KEYS`, identical in `src/present/offer/prepKeys.ts` and `cockpit_csm_offer_prep_value`):

  | key | value | rule |
  |---|---|---|
  | `language` | `"en"` or `"ar"` | |
  | `dialect` | `"kw"` or `"sa"` | |
  | `site_url` | `https://` URL | ≤300, no user, port or IP literal |
  | `site_thin` | boolean | the CSM's "thin site" tick |
  | `captures` | array ≤3 of `{id: uuid, mark?: {x,y,w,h}}` | ids are ready `capture` rows of this task; mark values 0..1, w and h ≥0.04 |
  | `goal_pick` | `"goal90"`, `"goal12_24"`, `"challenges"`, `"why"` or `"typed"` | |
  | `goal_typed` | text ≤300 | |
  | `goal_typed_on` | `YYYY-MM-DD` | not in the future |
  | `example_stills` | array ≤3 of uuid | ready `cockpit_csm_launch_ads` image rows of this task |
  | `example_colors` | array ≤3 of `#rrggbb` | |
  | `opening_price` | `{"<partKey>": number}` | USD, 1..1,000,000, ≤2 decimals, every catalog part present |
  | `opening_reason` | text 1..140 | required when any part is below a set list price |
  | `project_value` | `{amount: number, currency: KWD/SAR/AED/QAR/BHD/OMR/USD, from: "typed" or "onboarding", said_on?: date}` | amount >0, ≤100,000,000 |
  | `payment_link` | `^https://whop\.com/checkout/[A-Za-z0-9_-]{3,80}/?$` or `^https://invoice\.ecom\.io/[^\s<>"']{1,300}$` | |
  | `client_asked` | `{words: text 3..300, on: date}` | `on` is within the last 30 days and not in the future |
  | `hidden_slides`, `shown_slides` | lists of slide ids | the existing rule |
  | `presented_at` | stamp | the server sets it, and the first stamp is kept |

  Cross-key rules, checked in prep save after the merge:
  - Website needs both `build` and `care` when any price is typed.
  - A locked offer's opening price equals the list price, and a locked offer with a blank list refuses with "This price is locked. The CEO sets it on Money > Offers."
  - Below list needs `opening_reason`.
- **Capture file kind:** `capture`. MIME types: image/jpeg, image/png or image/webp, ≤10 MB. Path: `<taskId>/<id>.<ext>` in bucket `cockpit-upsell-files`.
- **Gate reason keys** (exact): `not_active`, `too_new`, `no_win`, `not_happy`, `happiness_stale`, `red`, `pause_required`, `raised_on_last_call`, `recent_offer`, `renewal_window`.
- **Pitch answers:** `yes_paid`, `yes_unpaid`, `not_now` (follow-up date required), `no` (reason required). Modes: `proactive`, `client_asked`.
- **Proposal statuses:** `draft`, `sent`, `link_copied`, `accepted`, `not_now`, `archived`. Opened and Expired are worked out, never stored. "Paid" comes in the second build.
- **View kinds:** `open`, `play`, `cta`, `video`.
- **Short codes:** the proposal code is `^[a-hj-km-np-z2-9]{12}$`, and the pitch video code is `^[a-hj-km-np-z2-9]{10}$`. Both are random, from `gen_random_uuid()` bytes.
- **Currency.** "Their currency" uses `public.cockpit_pay_usd_per(currency)`, the pay plan's fixed rates: KWD 3.26, AED 0.2723, SAR 0.2666, QAR 0.2747. BHD and OMR are not covered, so the figure stays in USD with a note. Prep names the rate and its source.

## 3. Builders, in order, and the files each one owns

No file belongs to two builders. A shared file appears only under its one owner's "Edits".

### 3.1 db: migrations and PGlite tests

Owns:
- `supabase/migrations/20261026u_upsell_catalog.sql`
- `supabase/migrations/20261026v_upsell_offer_decks.sql`
- `supabase/migrations/20261026w_upsell_proposals.sql`
- `apps/media-buyer-cockpit/scripts/lib/upsellTestDb.ts`: stands up `cockpitTestDb({supabaseDefaultPrivileges:true})` with the real gate (the same files `csm-decks-supabase.test.ts` cuts in), cut-down stand-ins with live column names (`cockpit_csm_sources`, `cockpit_csm_source_state`, `cockpit_csm_client_overrides`, `ghl_clients`, `cockpit_client_days`, `cockpit_csm_calls`, `cockpit_csm_renewal_plans`, `cockpit_client_logos`, `cockpit_client_onboarding`, `editor_clients`, the storage stand-in), the 20261019/20261020 deck migrations, then u, v, w, and x when it exists. Exported for content and proposal tests.
- `apps/media-buyer-cockpit/scripts/upsell-catalog-supabase.test.ts`
- `apps/media-buyer-cockpit/scripts/upsell-decks-supabase.test.ts`
- `apps/media-buyer-cockpit/scripts/upsell-gate-supabase.test.ts`
- `apps/media-buyer-cockpit/scripts/upsell-proposals-supabase.test.ts`
- `docs/upsell-studio/BACKEND.md`: every table, function, grant, guard and test.

Edits to shared files: none.

### 3.2 edge: Edge Function code (on-demand checks, uploads, the door)

Owns:
- `supabase/functions/cockpit-csm-api/upsell.ts`: the router. Exports `UPSELL_OPERATIONS`, `runUpsell(client, admin, input, env)` and `UpsellError(message, status)`.
- `supabase/functions/cockpit-csm-api/upsellSite.ts`: the site check and logo candidates from HTML.
- `supabase/functions/cockpit-csm-api/upsellVideo.ts`: the anonymous video link check.
- `supabase/functions/cockpit-csm-api/upsellLogo.ts`: logo find and pick, including the byte checks and EXIF strip.
- `supabase/functions/cockpit-csm-api/upsellFiles.ts`: the capture upload chain, modelled on `launchAds.ts` (copied and adapted, not imported).
- `supabase/functions/cockpit-csm-api/upsell.test.ts`, `upsellSite.test.ts`, `upsellVideo.test.ts`, `upsellLogo.test.ts`, `upsellFiles.test.ts`
- `supabase/functions/offer-door/index.ts`, `handler.ts`, `door.ts`, `handler.test.ts`, `door.test.ts`, `README.md`, `deno.json`
- `docs/upsell-studio/EDGE.md`

Edits:
- `supabase/functions/cockpit-csm-api/index.ts`: one import, plus one block shaped like the `LAUNCH_AD_OPERATIONS` block: a verified sign-in, then `runUpsell`. At most 8 lines, placed after the launch-ads block.
- `supabase/functions/cockpit-csm-api/tools.ts`: append `webTools` after the last export (main added `slackTools` at the end, so append below it). Existing exports are not changed.

### 3.3 content: client copy (English and Gulf Arabic) and the website talk track

Owns:
- `supabase/migrations/20261026x_upsell_catalog_copy.sql`: copy for all 7 offers.
- `apps/client-success-cockpit/src/present/offer/content/types.ts`
- `apps/client-success-cockpit/src/present/offer/content/shared.ts`: `OFFER_CHROME`.
- `apps/client-success-cockpit/src/present/offer/content/website.ts`: `WEBSITE_DECK`.
- `apps/client-success-cockpit/src/present/offer/content/websiteVideo.ts`: `WEBSITE_VIDEO`.
- `sites/offer/strings.js`: the client page's own lines.
- `apps/client-success-cockpit/scripts/offer-copy.test.ts`: structure checks.
- `apps/media-buyer-cockpit/scripts/upsell-copy-supabase.test.ts`: every client line through `cockpit_client_copy_problems`.
- `docs/upsell-studio/CONTENT.md`
- `docs/upsell-studio/ARABIC-FOR-APPROVAL.md`: every new Arabic line, beside its English, for the CEO's one-batch approval.

Edits to shared files: none.

### 3.4 art: the website art set (shared by deck, video and proposal)

Owns:
- `tools/offer-art/**`: package.json with exact versions, `higgsfield.ts` (keys read by name), `prompts.website.json`, `grade.ts` (ffmpeg grade to the palette), `export.ts` (webp exports at sizes), `doctor.ts` and `README.md`.
- `apps/client-success-cockpit/src/present/offer/art/index.ts`: the `ART` manifest.
- `apps/client-success-cockpit/src/present/offer/art/icons.tsx`: `OfferIcon`, drawn as SVG by code, never generated.
- `apps/client-success-cockpit/src/present/offer/art/website/*.webp`
- `sites/offer/art/website/*` (webp and `icons.svg` sprite)
- `docs/upsell-studio/ART.md`

Masters (not in git) live on the VPS in `~/upsell-build/media/art/website/`.

Edits to shared files: none.

### 3.5 deck: the website deck kind, prep, notes, picker, Hot list row and Offers tab

Owns (all new):
- In `apps/client-success-cockpit/src/present/offer/`:
  - `kinds.ts`, `prepKeys.ts`, `price.ts`, `sources.ts`, `load.ts`, `useOffer.ts`, `videos.ts`
  - `websiteDeck.tsx`, `slides/RevisionCloud.tsx`, `slides/Capture.tsx`, `slides/SiteSketch.tsx`, `slides/Bill.tsx`, `slides/ReturnCard.tsx`, `slides/Commit.tsx`
  - `OfferNotes.tsx`, `OfferPrep.tsx`, `OfferRefused.tsx`, `OfferPicker.tsx`, `OfferPickerItem.tsx`, `OfferPresentPage.tsx`, `offer.css`
- `apps/client-success-cockpit/src/pages/money/offers/OffersTab.tsx`, `PriceRow.tsx`, `OfferVideos.tsx`, `OfferSettings.tsx`, `PitchLog.tsx`, `OfferHotRow.tsx`, `LogPitchDialog.tsx`
- `apps/client-success-cockpit/offer-harness.html`, `src/dev/offerHarness.tsx`, `src/dev/offer/fixtures.ts`
- In `apps/client-success-cockpit/scripts/`: `deck-offer-website.test.tsx`, `deck-offer-price.test.ts`, `deck-offer-prep.test.ts`, `offer-picker.test.tsx`, `offers-tab.test.tsx`, `offer-hot-row.test.tsx`, `offer-shots.mjs`
- `docs/upsell-studio/DECK.md`

Edits (insertion points only):

| file | change |
|---|---|
| `src/present/sources.ts` | `DeckKind` adds `\| OfferDeckKind` (import type from `./offer/kinds`). `prepRow.deck` enum becomes `z.string()` (2 lines). |
| `src/present/decks.ts` | `DECKS.offer_website: websiteSlides`, `TARGET_MINUTES.offer_website: 8` (plus the import). |
| `src/present/deckContext.ts` | `offer?: OfferModel \| null` on `SlideCtx` (1 line plus the import). |
| `src/present/useDeckModel.ts` | Initial prep includes `offer_website: {}`. `Loaded.prep` gains `offer_website?: Overrides`. Savers are made for `onboarding`, `launch` and `offer_website`. `setPrep` keeps blueprint's bypass. `flush`, the online retry and the unmount flush go over all savers. |
| `src/present/prep.ts` | `...OFFER_PREP_KEYS` spread into `PREP_KEYS` (1 line plus the import). |
| `src/present/PresentApp.tsx` | `const offer = useOffer({enabled: isOfferDeck(deck), ...})`. `base` gets `...(isOfferDeck(deck) ? {offer} : {})`. When `offer.refused`, render `<OfferRefused>` before the views. |
| `src/present/PresentPage.tsx` | `io.load` gets an offer branch (`loadOfferDeck`). The guard accepts `isOfferDeck(deck)`. `presentUrls` builds `/present/offer/<key>` addresses. `book` and `kickoff` stay undefined for offer decks. |
| `src/present/NotesWindow.tsx` | `DECK_NAME[deck]` works through the new `content.ts` entry. The controls branch gains `isOfferDeck(deck) ? <OfferNotes …/>` before the launch branch. `CallGuideLine` and "This client's service model" are skipped for offer decks. |
| `src/present/PrepView.tsx` | Gains an `isOfferDeck(deck) ? <OfferPrep …/>` branch beside BlueprintPrep. The sister-deck link and DWY block are skipped for offer decks. |
| `src/present/content.ts` | `DECK_NAME`'s key type widens and gains `offer_website: WEBSITE_DECK.name`. |
| `src/present/PresentButton.tsx` | One `<OfferPickerItem taskId={taskId} />` in the dropdown. The picker's data loads only when it opens. |
| `src/practice/practiceClient.ts`, `src/dev/presentHarness.tsx` | `offer_website: {}` in each `Record<DeckKind, Overrides>` store (1 line each). |

### 3.6 proposal: the builder with live preview, the client's page and the cockpit wiring

Owns (all new):
- In `apps/client-success-cockpit/src/pages/money/offers/proposal/`: `ProposalBuilder.tsx`, `ProposalPreview.tsx`, `srcdoc.ts`, `proposalSources.ts`, `proposalContent.ts`, `publicProposal.ts`, `ProposalCard.tsx`, `ProposalsCard.tsx`, `MakeProposalButton.tsx`
- `apps/client-success-cockpit/src/pages/money/offers/ProposalPage.tsx`
- `sites/offer/**` except `strings.js` (content) and `art/**` (art): `index.html`, `offer.js`, `core.js`, `offer.css`, `noscript.css`, `vercel.json`, `README.md`, `dev-door.ts`, `core.test.js`, `offer.test.js`, and `logo.png`, `mark.png`, `favicon.png`, `apple-touch-icon.png`, `og.png` copied from `sites/call-link`.
- `apps/client-success-cockpit/proposal-harness.html`, `src/dev/proposalHarness.tsx`, `src/dev/offer/proposalFixtures.ts`
- `apps/client-success-cockpit/scripts/proposal-builder.test.tsx`, `proposal-srcdoc.test.ts`, `proposal-shots.mjs`
- `apps/media-buyer-cockpit/scripts/upsell-public-parity.test.ts`
- `docs/upsell-studio/PROPOSALS.md`

Edits (wiring, insertion points only):
- `src/auth/authenticated/AuthenticatedAppRoutes.tsx`: inside the `RoleRoute role="csm"` deck block, put the two offer deck routes **before** `/clients/:key/present/:deck`. Each renders `<OfferPresentPage>` (or `<OfferPresentPage notes>`) inside `DeckRouteBoundary` and `Suspense`. Add one lazy route `/clients/:key/proposals/:id` (and `new`) inside AppLayout's CSM block, rendering `ProposalPage`.
- `src/pages/CsmPage.tsx`:
  - `<MakeProposalButton taskId={String(c.taskId)} />` right after `<PresentButton …/>` (around line 1944).
  - `<OfferHotRow c={c} />` as the first child of the client Money tab's "Hot list" `SectionCard` (around line 2579).
  - `<ProposalsCard taskId={String(c.taskId)} />` right after that card.
- `src/pages/MoneyPage.tsx`: `{ key: "offers", label: "Offers" }` in `TABS`, and `{tab === "offers" ? <OffersTab /> : null}` (lazy).
- `apps/client-success-cockpit/vite.config.ts`: `server: { fs: { allow: [searchForWorkspaceRoot(process.cwd()), path.resolve(import.meta.dirname, "../../sites/offer")] } }`.

### 3.7 video: the website demo video (English and Gulf Arabic cuts)

Owns:
- `tools/offer-video/**`: HyperFrames project, demo-firm site source, capture scripts, casting and voice scripts, music bed script, `render.sh`, checks, `manifest.schema.json` and `README.md`.
- `docs/upsell-studio/VIDEO.md`

Edits to shared files: none. It reads `content/websiteVideo.ts`, `art/` and the deck harness.

The full spec is in section 8.

## 4. Migrations

### 4.1 Names

- Free on GitHub main on 26 Oct (checked with `git fetch origin main` and `git ls-tree`, every local worktree, and live `supabase_migrations.schema_migrations`). The only 20261026 letter used is `n`; the timestamped `20261026150000` and `20261026151000` files sort before any letter.
- Use `20261026u`, `20261026v`, `20261026w` (db) and `20261026x` (content). They apply in that order.
- Each file is one `BEGIN … COMMIT`, applies twice without error, and touches only what it names.

### 4.2 md5 guards

Read live on 26 Oct. Re-read them with a read-only query before writing each file; if any differs, rebase on the new live body and record the new md5.

| function (identity args) | live `md5(prosrc)` | replaced in | change |
|---|---|---|---|
| `cockpit_csm_deck_prep_save(text,text,jsonb)` | `e6b8e4d80bd8dd30498ebc1b5ab92859` | v | accepts offer decks; offer keys go to `cockpit_csm_offer_prep_value`; cross-key price rules; `presented_at` stamp kept |
| `cockpit_csm_deck_video_slots()` | `9f670ba72f102080504a1a348d5c9309` | v | the same 12 entries in the same order, then 7 `offer_<key>:demo` |
| `cockpit_csm_deck_videos_read(text)` | `e645051690f2f32543e4da89beecb890` | v | accepts offer decks |
| `cockpit_csm_deck_video_save(text,text,text,text,text,integer,integer)` | `eeaf74c7b6fd1ec12db44e26d59c6848` | v | accepts offer decks; offer decks need `cockpit_is_ceo()` (42501 "Only the CEO changes an offer's video.") |
| `cockpit_csm_deck_video_clear(text,text,text,integer)` | `df961267904ba26d2bb9e425fae40d92` | v | the same as save |

Guard pattern (as in `20261026150000_exception_alerts.sql`): a `DO $guard$` block accepts the live md5, or this file's own body md5 with LF or CRLF endings; anything else raises "… is not the definition this file was written against".

Two constraints are dropped and re-added: `cockpit_csm_deck_prep_deck_check` and `cockpit_csm_deck_videos_deck_check`. A guard first checks that `pg_get_constraintdef` still equals `CHECK ((deck = ANY (ARRAY['onboarding'::text, 'launch'::text])))`. The new check is `deck IN ('onboarding','launch') OR deck ~ '^offer_(website|second_campaign|seo_geo|smm|ugc|closer|cameraman)$'`.

Relied on, not replaced: `cockpit_csm_client_gate` (`1ebce3b7…`), `cockpit_csm_deck_video_parse` (`1fe84413…`), `cockpit_csm_launch_ad_reserve` (`4ce83fdb…`), `cockpit_csm_launch_ad_accept` (`7cb50038…`), `cockpit_is_ceo` (`e6a2e530…`), `cockpit_csm_actor` (`9e0fc31c…`), `cockpit_pay_usd_per`. The tests assert they exist with those signatures.

### 4.3 Grants, restated in the same file

Replaced functions keep their live grants exactly:
- `prep_save`, `videos_read`, `video_save`, `video_clear`: `REVOKE ALL … FROM PUBLIC, anon, service_role; GRANT EXECUTE … TO authenticated`.
- `video_slots` and `video_slot_ok`: `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`.

New tables:
- `ENABLE ROW LEVEL SECURITY`.
- `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`.
- `GRANT SELECT, INSERT, UPDATE … TO service_role`. No DELETE and no TRUNCATE, except `cockpit_upsell_views`, where the purge runs inside a definer function.

New functions:
- Every function is `SECURITY DEFINER SET search_path = ''`.
- Browser-facing ones: `REVOKE ALL FROM PUBLIC, anon, service_role; GRANT EXECUTE TO authenticated`.
- Door ones: `REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role`.
- Internal helpers: revoked from all four.
- `cockpit_client_copy_problems`: IMMUTABLE, `SECURITY INVOKER`, granted to authenticated and service_role.

Storage: bucket `cockpit-upsell-files` is private, 10,485,760 bytes, and takes image/jpeg, image/png and image/webp. One read policy: `cockpit_upsell_files_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id='cockpit-upsell-files' AND public.cockpit_upsell_object_allowed(name))`. It mirrors `cockpit_csm_launch_object_allowed`, never raises, and uses the client gate.

### 4.4 Audit

- One trigger function, `cockpit_upsell_audit()`, writes one `cockpit_audit_log` row per write, with `source_app 'client-success'` and the action from the transaction-local `cockpit.upsell_action`.
- It is attached to: catalog, settings, files, wins, pitches and proposals.
- Proposal rows record only the changed top-level keys, the way the deck prep audit records changed keys. `sent_content` is recorded on send only.
- `metadata.line` holds a plain sentence for the CEO card, for example "Website build: blank to 2,000, by the CEO" or "Opening price 1,800 below list 2,000: <reason>".
- The prep audit is the existing `cockpit_csm_deck_audit`, which already covers offer decks.
- No audit on `cockpit_client_site_checks`, `cockpit_upsell_views` or `cockpit_upsell_door_status`.

## 5. Interfaces

Every function below calls `cockpit_csm_client_gate(task_id)` first, unless it says otherwise. Error codes:
- `42501`: no access.
- `22023`: a bad value. Messages are plain and say what to do.
- `40001`: a stale revision ("Someone else saved this. Read it again.").

### 5.1 Catalog and settings (20261026u)

```
cockpit_upsell_catalog(
  offer_key text PRIMARY KEY CHECK (offer_key IN ('website','second_campaign','seo_geo','smm','ugc','closer','cameraman')),
  sort smallint NOT NULL UNIQUE,                    -- website 1, second_campaign 2, seo_geo 3, smm 4, cameraman 5, ugc 6, closer 7
  parts jsonb NOT NULL CHECK (public.cockpit_upsell_parts_ok(parts)),
  locked boolean NOT NULL DEFAULT false,
  split_allowed boolean NOT NULL DEFAULT false,
  split_parts jsonb CHECK (split_parts IS NULL OR jsonb_typeof(split_parts)='array'),
  min_months smallint CHECK (min_months IS NULL OR min_months BETWEEN 1 AND 24),
  waits_on text CHECK (waits_on IS NULL OR char_length(waits_on) BETWEEN 1 AND 160),
  copy jsonb NOT NULL DEFAULT '{}' CHECK (public.cockpit_upsell_copy_ok(copy)),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL CHECK (btrim(updated_by) <> ''))
cockpit_upsell_settings(key text PRIMARY KEY CHECK (key IN ('whatsapp_number','valid_days','door_live')),
  value text NOT NULL CHECK (char_length(value) BETWEEN 1 AND 40), updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL)
```

`parts`:
- An array of 1 to 3 items, each `{key ^[a-z_]{2,20}$, cadence: one_time|monthly|per_day|per_90_days, amount: numeric|null, hint: numeric}`.
- Keys are unique. `amount` null means "no price yet". `hint` is the doc's price.

Seed (every `amount` null, `updated_by 'migration'`):

| offer | parts (key cadence hint) | other columns |
|---|---|---|
| `website` | build one_time 2000; care monthly 200 | |
| `second_campaign` | monthly monthly 500 | waits_on "Deck and video follow the website." |
| `seo_geo` | program per_90_days 5000 | locked true, split_allowed true, split_parts `[2500,2500]`, waits_on "Needs a delivery owner, a fulfilment list and proof." |
| `smm` | monthly monthly 1000 | waits_on as seo_geo |
| `cameraman` | day per_day 800 | waits_on "Needs a cameraman listed for the client's city." |
| `ugc` | package one_time 3500 | waits_on "Needs real UGC videos we produced." |
| `closer` | placement one_time 4000; management monthly 750 | min_months 3, waits_on "Needs a named recruiter." |

Settings seed: `valid_days '30'`, `door_live 'false'`. `whatsapp_number` stays absent, so the page shows no Yes button and says to message the account manager.

`copy`:
- Either `'{}'` (unseeded) or `{"en": C, "ar": C}`.
- C has these keys, with caps checked by `cockpit_upsell_copy_ok`:
  - `name` ≤40
  - `deckTitle` ≤40
  - `line` ≤200
  - `parts`: `{<partKey>: ≤120}` for every catalog part
  - `terms` ≤200
  - `timing` ≤160
  - `get`: [{`key`, `text` ≤200}] 1..8
  - `need`: [{`key`, `text` ≤80}] 0..4
  - `steps`: [{`key`, `text` ≤160}] 1..6
  - `why`: [{`key`, `label` ≤60, `text` ≤400}] 1..3
  - `button` ≤40
  - `cta` ≤80
  - `close` ≤120
  - `work`: [{`key`, `label`, `url`}] 0..6 (empty in the seed)
  - `platforms`: `{instagram,tiktok,snapchat,facebook}` (smm only)
- `en` and `ar` must have the same keys. The `get`, `need`, `steps` and `why` keys must match between languages.

Functions:
- `cockpit_client_copy_problems(p_text text, p_money_ok boolean DEFAULT false) RETURNS jsonb`. Returns `[{rule, match, why, block}]`. Rules, each in English and Arabic:
  - `promise`, `free_work`, `result_guarantee`: ported from `hermes/sales-desk/desk/validate.py` PROMISE, FREE_WORK and RESULT_GUARANTEED.
  - `mention`: from MENTION, with `block:false`.
  - `outcome`: show rate, close rate, more appointments/meetings/clients, page one, rank first/#1, appear in ChatGPT, turn up and sign, and the Arabic equivalents.
  - `performance_number`: a number beside leads, appointments, bookings, CPL, ROAS, spend, budget, show or close rate.
  - `money`: a currency amount or `$`, unless `p_money_ok`.
  - `lead_word`: whole-word "lead" or "leads" (and "ليد" or "ليدز").
  - `upsell_word`: upsell or renewal.
  - `em_dash`: `—`.
- `cockpit_upsell_catalog_read() RETURNS jsonb`. Needs `cockpit_csm_actor()` (a CSM or the CEO). Returns `{rows:[{offerKey, sort, parts, locked, splitAllowed, splitParts, minMonths, waitsOn, copy, revision, updatedAt, updatedBy}], settings:{whatsappNumber|null, validDays, doorLive}, videos:[{deck, slotKey, lang, provider, url, embedUrl, posterUrl, title}], isCeo, at}`.
- `cockpit_upsell_catalog_set(p_offer text, p_patch jsonb, p_base_revision integer) RETURNS jsonb` (the row).
  - Only `cockpit_is_ceo()` may call it; anyone else gets 42501 "Only the CEO changes the price list."
  - Patch keys: `parts` ([{key, amount|null}] for existing keys only), `locked`, `split_allowed`, `split_parts`, `waits_on`.
  - Bumps the revision and audits as `upsellCatalog.set` with `metadata.line`.
- `cockpit_upsell_setting_set(p_key text, p_value text) RETURNS jsonb`. CEO only.
  - `whatsapp_number` is `^[0-9]{8,15}$`. `valid_days` is 7..90. `door_live` is `true` or `false`.

### 5.2 Offer decks, files, site checks, wins, gate and pitches (20261026v)

```
cockpit_upsell_files(id uuid PK, request_id uuid UNIQUE NOT NULL, task_id text CHECK (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  kind text NOT NULL CHECK (kind IN ('capture')), status text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading','ready','removed')),
  storage_path text UNIQUE NOT NULL (= task_id||'/'||id||'.'||ext), mime text CHECK (mime IN ('image/jpeg','image/png','image/webp')),
  bytes bigint CHECK (bytes BETWEEN 1 AND 10485760), width int, height int, file_name text (1..200),
  searched_as text (1..80), captured_on date NOT NULL, caption text (1..120),
  created_by uuid, created_by_email text NOT NULL, created_at, ready_at, removed_at, purged_at,
  plus the ready, removed and purged consistency checks copied from cockpit_csm_launch_ads)
cockpit_upsell_wins(id bigint identity PK, task_id text, text text CHECK (char_length BETWEEN 3 AND 200), won_on date NOT NULL,
  created_by_email text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())
cockpit_client_site_checks(id bigint identity PK, task_id text, url text (1..300), source text CHECK (source IN ('card','onboarding','prep')),
  status text CHECK (status IN ('ok','parked','expired','dns','tls','http_error','timeout','redirect_offsite','instagram','empty','refused')),
  http_status int, final_url text (≤500), title text (≤200), checked_at timestamptz NOT NULL DEFAULT now(), checked_by_email text NOT NULL)
cockpit_upsell_pitches(id uuid PK DEFAULT gen_random_uuid(), request_id uuid UNIQUE NOT NULL, task_id text, offer_key text REFERENCES cockpit_upsell_catalog,
  pitched_on date NOT NULL, csm_email text NOT NULL, mode text CHECK (mode IN ('proactive','client_asked')),
  client_words text (3..300), client_asked_on date, gate jsonb NOT NULL, list_price jsonb NOT NULL, opening_price jsonb, opening_reason text (≤140),
  held_full boolean NOT NULL DEFAULT false, final_price jsonb, final_reason text (≤140), split boolean NOT NULL DEFAULT false,
  answer text CHECK (answer IN ('yes_paid','yes_unpaid','not_now','no')), follow_up_on date, no_reason text (≤200),
  payment_link text (≤500), lang text CHECK (lang IN ('en','ar')), video_code text UNIQUE NOT NULL CHECK (video_code ~ '^[a-hj-km-np-z2-9]{10}$'),
  revision int NOT NULL DEFAULT 1, created_at, updated_at, updated_by)
```

Functions:

- `cockpit_csm_offer_prep_value(p_task_id text, p_offer text, p_key text, p_value jsonb) RETURNS jsonb`. Internal. Applies the key rules in section 2. A null value removes the key.

- `cockpit_csm_deck_prep_save(p_task_id, p_deck, p_patch)`. Same signature and return shape (`{deck, overrides, revision, updatedAt, updatedBy, changed}`) for every deck.

- **Capture files.**
  - `cockpit_upsell_file_reserve(p_request_id uuid, p_task_id text, p_kind text, p_mime text, p_bytes bigint, p_width int, p_height int, p_file_name text, p_captured_on date, p_searched_as text) RETURNS jsonb {id, path, kind, mime, bytes}`. The same request id returns the same row for the same seat and file. At most 20 uploading rows per task.
  - `cockpit_upsell_file_accept(p_task_id text, p_id uuid) RETURNS jsonb`. Checks `storage.objects` size and mimetype, then sets the row ready (audited).
  - `cockpit_upsell_file_update(p_task_id text, p_id uuid, p_patch jsonb) RETURNS jsonb`. Keys: `searched_as`, `captured_on`, `caption`.
  - `cockpit_upsell_file_remove(p_task_id text, p_id uuid) RETURNS jsonb`.
  - `cockpit_upsell_files_read(p_task_id text) RETURNS jsonb {rows:[{id, kind, mime, bytes, width, height, fileName, searchedAs, capturedOn, caption, createdAt, path}]}`.
  - `cockpit_upsell_file_purged(p_task_id text, p_ids uuid[]) RETURNS integer`. service_role only.
  - `cockpit_upsell_object_allowed(p_name text) RETURNS boolean`.

- `cockpit_upsell_win_mark(p_task_id text, p_text text, p_won_on date) RETURNS jsonb`. `won_on` is within the last 30 days and not in the future. Audited `upsellWin.mark`.

- **Site checks.**
  - `cockpit_client_site_check_record(p_task_id text, p_url text, p_source text, p_result jsonb) RETURNS jsonb {check, verdict}`.
    - `p_result` is `{status, httpStatus, finalUrl, title}` from the edge.
    - At most 6 checks per task per hour. More raises 22023 "Checked 6 times this hour. Try again later."
  - `cockpit_client_site_verdict(p_task_id text) RETURNS jsonb {verdict, urls, checks, disagree, instagramOnly, note}`. Internal.
    - `urls`: [{url, from: card|onboarding|prep}], from `editor_clients.website`, `cockpit_client_onboarding.links.website` and prep `site_url`.
    - `verdict` is one of:
      - `none_on_file`: no URL anywhere.
      - `not_checked`.
      - `ok`: the latest check was ok.
      - `failing`: one failure, or failures less than 20 hours apart.
      - `broken`: at least 2 failed checks at least 20 hours apart, the latest failed, and no ok since the first of them.
    - The UI words: `not_checked` reads "Site not checked yet", never "No site".

- `cockpit_csm_offer_gate(p_task_id text) RETURNS jsonb`. It reads the client the way `cockpit_csm_projection_client` does (sources merged with confirmed overrides) and returns:

  ```
  {ok, taskId, checkedAt,
   reasons:[{key, text, source, at}],          -- failing checks only, in the key order of section 2
   passed:[{key, text, source, at}],
   win:{kind: 'quotation'|'signed'|'csm_tick'|null, on, text},
   renewal:{date, from: 'plan'|'launch_plus_90'|null},
   lastOffer:{kind: 'pitch'|'proposal', offer, on}|null}
  ```

  The checks:
  - `not_active`: stage ≠ Active (case-insensitive), or paused, stopped, cancelled or ghosted.
  - `too_new`: `liveDays` ≤30, or unknown ("No launch date on the card. Add it in ClickUp.").
  - `no_win`: decision 5.
  - `not_happy`: happiness is not Happy or Very Happy, case-insensitive and never "unhappy".
  - `happiness_stale`: no override confirmed in the last 14 days and no held or showed `cockpit_csm_calls` row in the last 14 days. The text says the date it was last confirmed and what to do.
  - `red`: `level = 'red'`.
  - `pause_required`: `pauseRequired` is true.
  - `raised_on_last_call`: the latest held or showed call's `summary` matches ESCALATION, PROBLEM or MONEY_WORDS, ported from `src/lib/clientBrief.ts` lines 499–506 with `\b` turned into `\y`. The text quotes the matched sentence (≤160 characters) and the call date.
  - `recent_offer`: a pitch for any offer `pitched_on` within 30 days, or any proposal sent within 30 days. The text names the next open date.
  - `renewal_window`: decision 6. The text adds "The website can ride in the renewal as the free care-plan month."
  - It never returns leads, CPL, spend or budgets.

- `cockpit_csm_offer_sources(p_task_id text, p_offer text) RETURNS jsonb`.

  ```
  {mode: 'proactive'|'client_asked'|'refused', gate,
   catalog: row|null,                        -- null when refused
   prep: {overrides, revision, updatedAt, updatedBy}|null,
   files: [...cockpit_upsell_files_read rows],
   site: cockpit_client_site_verdict,
   project: {onboarding: {answer ≤600, answeredOn}|null,
             sheet: {usd, closes, from:'cockpit_client_days', window:'180 days'}|null},
   country, currency, fx: {usdPer|null, from:'cockpit_pay_usd_per'},
   pitches: [this offer's pitches, newest first, ≤10],
   heldFullRecently: boolean,
   doorLive: boolean, at}
  ```

  - The mode is `client_asked` when the gate fails but prep has a valid `client_asked`.
  - Refused still returns `gate`, `prep` (so the CSM can type `client_asked`), `site` and `files`.

- `cockpit_csm_offer_status(p_task_id text) RETURNS jsonb`. For the picker and the Hot list row.

  ```
  {gate:{ok, reasons},
   thisMonth: offerKey|null, thisMonthWhy: text|null,
   offers:[{key, fit:{ok|null, why}, ready:{ok, missing:['no_capture'|'capture_old'|'no_price'|'no_payment_link']}, waitsOn, lastPitch}]}
  ```

  - Website fit, with `why` worded like "No working site, checked twice, 26 and 27 Oct":
    - `ok:true` when the site verdict is `broken`, or `none_on_file`, or prep `site_thin`;
    - `ok:null` when `not_checked`;
    - `ok:false` when `ok`.
  - The other six offers get `fit.ok:null` with `waits_on`.
  - `capture_old` means the newest capture is more than 7 days old.

- **Pitches.**
  - `cockpit_upsell_pitch_save(p_task_id text, p_offer text, p_request_id uuid, p_patch jsonb, p_base_revision integer) RETURNS jsonb` (the row plus `videoUrl`).
    - The first save creates the row and stamps `gate`, `list_price`, `opening_price`, `opening_reason`, `payment_link`, `lang`, `mode` and `client_words` from the gate and prep.
    - Patch keys: `held_full`, `final_price`, `final_reason`, `split`, `answer`, `follow_up_on`, `no_reason`.
    - Rules:
      - a final price below the opening price needs `held_full` and `final_reason`;
      - `split` needs `split_allowed` and `held_full`;
      - a locked offer's final price equals the list;
      - `not_now` needs a follow-up date within 120 days;
      - `no` needs `no_reason`.
    - It never refuses for the gate (it stores the flags).
  - `cockpit_upsell_pitches_read(p_task_id text) RETURNS jsonb`.
  - `cockpit_upsell_pitch_log(p_month date) RETURNS jsonb`. The CEO gets every client; a CSM gets their own (`cockpit_client_allowed`). Rows: `{id, taskId, clientName, offerKey, pitchedOn, csm, mode, listPrice, openingPrice, openingReason, finalPrice, finalReason, answer, followUpOn}`.
  - `cockpit_upsell_pitch_video(p_id uuid) RETURNS jsonb {url, counted}`.
    - When `door_live` is true: `https://offer.maharamedia.com/v/<video_code>` with `counted:true`.
    - Otherwise: the offer's Wistia link for the pitch's language, with `counted:false`.

### 5.3 Proposals, views and the door (20261026w)

```
cockpit_upsell_proposals(id uuid PK DEFAULT gen_random_uuid(), request_id uuid UNIQUE NOT NULL, task_id text, client_name text NOT NULL,
  offer_key text REFERENCES cockpit_upsell_catalog, lang text CHECK (lang IN ('en','ar')),
  content jsonb NOT NULL CHECK (octet_length(content::text) <= 65536),          -- ProposalContent below, checked by cockpit_upsell_proposal_content_ok
  price jsonb NOT NULL DEFAULT '{"parts":{},"split":false}', price_reason text (≤140), list_price jsonb NOT NULL,
  valid_until date NOT NULL, code text UNIQUE CHECK (code ~ '^[a-hj-km-np-z2-9]{12}$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','link_copied','accepted','not_now','archived')),
  sent_content jsonb, sent_price jsonb, sent_list_price jsonb, sent_lang text, sent_rev int, sent_at timestamptz, sent_by text, updated_after_send boolean NOT NULL DEFAULT false,
  objection text (≤200), follow_up_on date, warnings_passed text[] NOT NULL DEFAULT '{}',
  preview_hash text, preview_until timestamptz,
  revision int NOT NULL DEFAULT 1, created_at, created_by, updated_at, updated_by)
cockpit_upsell_views(id bigint identity PK, proposal_id uuid REFERENCES cockpit_upsell_proposals, pitch_id uuid REFERENCES cockpit_upsell_pitches,
  kind text CHECK (kind IN ('open','play','cta','video')), at timestamptz NOT NULL DEFAULT now(),
  device text CHECK (device ~ '^[A-Za-z0-9_-]{8,64}$'), ip_hash text CHECK (ip_hash ~ '^[0-9a-f]{64}$'), device_kind text CHECK (device_kind IN ('phone','tablet','computer')),
  CHECK (num_nonnulls(proposal_id, pitch_id) = 1))
cockpit_upsell_door_status(route text PRIMARY KEY CHECK (route IN ('p','event','v')), last_ok_at timestamptz, last_error_at timestamptz, sentence text (≤200))
```

**ProposalContent** (`content`, `v:1`). The proposal builder writes it, and the database checks it:

```
{ "v": 1,
  "logo": {"on": boolean, "adId": uuid|null},              // adId: a ready cockpit_csm_launch_ads row, kind logo, of this task; null = the verified logo
  "video": {"kind": "default"} | {"kind": "custom", "url": text (passes cockpit_csm_deck_video_parse), "posterUrl": https|null, "title": text≤40|null, "checkedAt": iso},
  "found": [{"fileId": uuid, "caption": text≤120}],         // ≤3 ready capture files of this task
  "why": {"trigger": copy.why key|null, "text": text≤400, "edited": boolean},
  "get": [{"key": copy.get key, "text": text≤200, "hidden": boolean, "edited": boolean}],
  "platforms": ["instagram","tiktok","snapchat","facebook"] | null,   // smm only, instagram always in
  "steps": {"text": text≤400, "edited": boolean},
  "button": {"text": text≤40, "edited": boolean},
  "showCsm": boolean }
```

Price: `price = {"parts": {"<partKey>": number}, "split": boolean}`, plus `price_reason`.

**PublicProposal**, the only shape that leaves the server for a client. The door returns it, and so does `cockpit_upsell_proposal_public`. Both build it through one internal function, `cockpit_upsell_public_json(p_row cockpit_upsell_proposals, p_content jsonb, p_price jsonb)`. Storage paths come back in `*.path`, and the caller signs them.

```
{ "lang": "en"|"ar", "offer": key, "title": copy.deckTitle, "clientName": text,
  "logo": {"bucket": text, "path": text, "alt": text} | null,
  "csmFirstName": text|null, "date": "YYYY-MM-DD", "validUntil": "YYYY-MM-DD",
  "video": {"provider": text, "embedUrl": text, "posterUrl": text|null, "title": text|null} | null,
  "found": [{"bucket":"cockpit-upsell-files","path": text, "caption": text, "capturedOn": date, "searchedAs": text|null}],
  "why": text|null, "get": [text], "platforms": [text]|null, "work": [{"label","url"}],
  "steps": text|null, "timing": text|null,
  "investment": {"parts": [{"label": text, "amountUsd": number, "cadence": text}], "terms": text, "split": [number,number]|null},
  "button": {"text": text, "whatsapp": "https://wa.me/<digits>?text=<copy.cta, url-encoded>" | null} }
```

It never includes: the list price, the reason, internal ids, emails, the task id, warnings or views.

Functions (browser-facing, client gate first):
- `cockpit_upsell_proposal_create(p_task_id text, p_offer text, p_lang text, p_request_id uuid) RETURNS jsonb {proposal, warnings}`. It prefills from catalog copy in that language:
  - the first `why` entry;
  - every `get` line, shown;
  - `steps` joined;
  - `button`;
  - the default video;
  - `valid_until = today + valid_days`;
  - the price set to the list where it is set.
  - `warnings` are the offer gate's failing reasons. They are non-blocking.
- `cockpit_upsell_proposal_save(p_id uuid, p_patch jsonb, p_base_revision integer) RETURNS jsonb`. Patch keys: `content`, `lang`, `price`, `price_reason`, `valid_until`. A save after send sets `updated_after_send`. Drafts always save, even with copy problems.
- `cockpit_upsell_proposal_send(p_id uuid, p_base_revision integer, p_via text CHECK IN ('copy'), p_ack text[]) RETURNS jsonb {code, url, status, problems}`. It refuses (22023) and names the line and the reason when:
  - there is no video in that language;
  - `cockpit_client_copy_problems` blocks on any field with `edited:true` (catalog lines are not checked again);
  - a price is below list with no reason;
  - a locked price is off the list;
  - the split is on without full price held;
  - `valid_until` is in the past;
  - a current warning is missing from `p_ack` (ticks are stored in `warnings_passed` and audited).
  - On success it freezes `sent_content`, `sent_price`, `sent_list_price`, `sent_lang`, `sent_rev` and `sent_at`, sets `code` (once) and the status `link_copied`.
  - `url` is `https://offer.maharamedia.com/<code>`.
- `cockpit_upsell_proposal_update_link(p_id uuid, p_base_revision integer, p_ack text[]) RETURNS jsonb`. Re-runs the send checks, re-freezes, clears `updated_after_send`, and audits `upsellProposal.updateLink`. The card then says "Updated after sending".
- `cockpit_upsell_proposal_mark(p_id uuid, p_status text CHECK IN ('accepted','not_now','archived'), p_objection text, p_follow_up_on date, p_base_revision integer) RETURNS jsonb`. `not_now` needs an objection and a follow-up date.
- `cockpit_upsell_proposals_read(p_task_id text) RETURNS jsonb {rows:[{id, offerKey, lang, status, opened:{devices, visits, lastAt, played, pressedYes, known}, expired, updatedAfterSend, sentAt, validUntil, code, revision, updatedAt}]}`. `known` is false when `cockpit_upsell_door_status` has `last_error_at > sent_at`, or no `last_ok_at` at all; then the card says "Opens unknown".
- `cockpit_upsell_proposal_get(p_id uuid) RETURNS jsonb`: the full row for the builder.
- `cockpit_upsell_proposal_public(p_id uuid, p_content jsonb DEFAULT NULL, p_price jsonb DEFAULT NULL) RETURNS jsonb`: PublicProposal for the draft as typed, for the parity test and the server preview.
- `cockpit_upsell_proposal_preview(p_id uuid) RETURNS jsonb {url, until}`. A random 24-character token stores only its sha256, valid for 30 minutes. The URL is `https://offer.maharamedia.com/<code>?pv=<token>`. Needs a code (sent at least once); otherwise 22023 "Copy the link once, then open the live page."

Door functions (service_role only):
- `cockpit_upsell_door_open(p_code text, p_device text, p_ip_hash text, p_device_kind text, p_preview text) RETURNS jsonb {state:'open'|'expired'|'archived'|'unknown', proposal: PublicProposal|null, contact:{whatsapp: digits|null}}`.
  - Built from `sent_content`, `sent_price` and `sent_lang`.
  - It records an `open` unless `p_preview` matches `preview_hash` and is still valid.
  - It purges this proposal's views older than 90 days.
- `cockpit_upsell_door_event(p_code text, p_kind text, p_device text, p_ip_hash text, p_device_kind text) RETURNS void`. Kinds `play` and `cta`. An unknown code is ignored.
- `cockpit_upsell_door_video(p_code text, p_device text, p_ip_hash text, p_device_kind text) RETURNS jsonb {state, url}`. It looks the pitch up by `video_code`, records `video`, and returns the offer's video `url` (the provider page link) in the pitch's language.
- `cockpit_upsell_door_status_set(p_route text, p_ok boolean, p_sentence text) RETURNS void`. It writes when the state changes, or at most once a minute.

### 5.4 Edge operations (`cockpit-csm-api`, POST `{operation, args, requestId?}`)

Every operation:
- checks the user's sign-in (`auth.getUser`);
- calls RPCs as the user, so the gate decides;
- uses the service key only for Storage signing and for `cockpit_csm_provider_health` rows;
- sends every outside fetch through `tools.ts webTools`.

`webTools(health, request=fetch)` has the method `get(url, {purpose:'site'|'oembed'|'logo'|'thumbnail', maxBytes, timeoutMs, accept?})` and returns `{status, finalUrl, headers, body: Uint8Array, redirects: string[]}`.
- Only https on port 443, plus http for `site` with an upgrade attempt.
- It refuses user info, IP literals, `localhost`, `*.local`, `*.internal` and `metadata.*`.
- It follows at most 5 redirects, re-checking each hop.
- It reads at most `maxBytes`.
- Health rows go to `cockpit_csm_provider_health`: `{provider:'web', method:'GET', resource:'<purpose>:<host>', phase:'intent'|'response'|'unknown', http_status}`. Host only, never a path or query. A row that cannot be saved throws before the call leaves.

| operation | args | returns |
|---|---|---|
| `upsell.siteCheck` | `{taskId, url?}` | `{checks:[{url, source, status, httpStatus, finalUrl, title}], verdict, logoCandidates:[{url, kind:'og'\|'apple'\|'icon'\|'header', width?, height?}]}` |
| `upsell.videoCheck` | `{url}` | `{ok, provider, url, embedUrl, title, durationSeconds, posterUrl, refusal?}` |
| `upsell.logoFind` | `{taskId}` | `{candidates:[{source:'verified'\|'upload'\|'site', url, adId?, width?, height?}]}` |
| `upsell.logoPick` | `{taskId, url}` | the `LaunchAd` row |
| `upsellFiles.reserve` | `{taskId, kind:'capture', mime, bytes, width, height, fileName, capturedOn, searchedAs?}` | `{id, path, uploadUrl, token}` |
| `upsellFiles.ready` | `{taskId, id}` | the row |
| `upsellFiles.list` | `{taskId}` | rows with 3600 s signed `url`; removed and day-old unfinished uploads are swept |
| `upsellFiles.remove` | `{taskId, id}` | the row |

Operation details:
- `upsell.siteCheck`: checks each known URL (`url` given, plus card, onboarding and prep), then records each result through `cockpit_client_site_check_record`.
- `upsell.videoCheck`: parses through RPC `cockpit_csm_deck_video_parse`, then makes an anonymous check:
  - YouTube, Vimeo, Loom and Wistia oEmbed. A 401, 403 or 404 means private or not found.
  - Drive: a cookieless `drive.google.com/thumbnail?id=` fetch. A redirect to sign-in means private.
  - The refusal sentence is "This video is private. Set it to anyone with the link." Vimeo restricted to certain domains gets "This Vimeo video plays only on certain sites. Add offer.maharamedia.com to its allowed domains."
  - `posterUrl` only from the deck poster hosts (cdn.loom.com, embed-ssl.wistia.com, i.vimeocdn.com, i.ytimg.com), else null.
- `upsell.logoPick`: fetches the bytes and checks them:
  - PNG, JPEG or WebP only. SVG, GIF, animated WebP (`ANIM`) and APNG (`acTL`) are refused.
  - At most 2 MB; between 64x64 and 4000x4000.
  - EXIF and XMP are stripped from the bytes: JPEG APP1, PNG eXIf/tEXt/iTXt/zTXt, and WebP EXIF/XMP with the RIFF size and VP8X flags fixed.
  - Then it reserves (`cockpit_csm_launch_ad_reserve` as the user, kind `logo`), uploads with a non-upserting signed URL, and accepts (as the user).
  - It never writes `cockpit_client_logos`.

### 5.5 The door (`supabase/functions/offer-door`, `verify_jwt=false`)

It imports `isPreviewBot`, `deviceOf`, `clientIp`, `limitNet`, `ipHash`, `deviceIdOk` and `RateLimiter` from `../sales-live/door.ts`, and `fetchWithin` from `../sales-live/util.ts`. It copies nothing.

| route | who calls it | answers |
|---|---|---|
| `GET /p/{code}?d={device}&pv={token}` | the offer page script | Origin check: `OFFER_SITE_URL` (default `https://offer.maharamedia.com`) or localhost. Rate limits as sales-live: 30 a minute per salted address and device, 120 per address. Answers `cockpit_upsell_door_open`'s JSON with every `path` replaced by a 600 s signed URL (verified logos via their public bucket URL). Preview bots get `{state:'unknown'}` and are not counted. `Cache-Control: no-store`. |
| `POST /p/{code}/event` | the page | Body `{kind:'play'\|'cta', d}`, ≤1 KB. Answers 204. |
| `GET /v/{code}` | WhatsApp link (rewritten by the site) | 302 to the video page, or to `OFFER_SITE_URL/?gone=1`. No client data in any URL. Records `video`. |
| `GET /health` | the doctor | `{ok, routes:{p, event, v}}`, with missing secrets named, never their values. |

- Secrets, read by name: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OFFER_IP_SALT`, and optionally `OFFER_SITE_URL`. A missing one closes its route with a 503 and a plain sentence, and writes `cockpit_upsell_door_status`.
- Headers: CSP `default-src 'none'`, `X-Robots-Tag: noindex`.

### 5.6 The offer site (`sites/offer`, static, no build, served at `offer.maharamedia.com`)

- `vercel.json`:
  - `/{code}` rewrites to `index.html`, and `/v/:code` redirects to `https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/offer-door/v/:code`.
  - CSP: `default-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://bldgtotkfmhoxmlzowdx.supabase.co https://cdn.loom.com https://embed-ssl.wistia.com https://i.vimeocdn.com https://i.ytimg.com; frame-src https://www.loom.com https://www.youtube-nocookie.com https://fast.wistia.net https://player.vimeo.com https://drive.google.com; connect-src https://bldgtotkfmhoxmlzowdx.supabase.co; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`.
  - Plus `noindex`, `no-referrer` and `nosniff`.
- `core.js` exports `render(publicProposal, strings, opts) -> HTML string` and `stateView(state, strings, contact)`. It is pure and tested.
- `offer.js`:
  - Reads the code, keeps a device id in `localStorage` `mm-offer-device`, asks the door, and renders.
  - The video shows as a poster with a play button. The provider iframe loads only on press, so no cookies are set before play. Pressing play posts `play`, and Yes posts `cta` before opening `wa.me`.
  - Preview mode, when `window.__OFFER_PREVIEW__` is true, never calls the door. It renders `{type:'offer:preview', proposal, strings}` messages from `window.parent` only.
- Print layout: `@media print` prints the link as text.
- Link previews (`og.png` and static meta) never name the client or the price.

### 5.7 Front-end modules other builders import

- **`src/present/offer/kinds.ts`** (deck): `OFFER_KEYS`, `type OfferKey`, `OFFER_ORDER`, `type OfferDeckKind = "offer_website"`, `BUILT_OFFER_DECKS`, `isOfferDeck(x): x is OfferDeckKind`, `offerOfDeck`, `deckOfOffer`, `offerDeckUrl(taskId, key, view?)`, `proposalNewUrl(taskId, key)`, `proposalUrl(taskId, id)`.
- **`src/present/offer/sources.ts`** (deck), zod-checked:
  - `readCatalog`, `saveCatalog`, `saveSetting`, `readOfferSources`, `readOfferStatus`, `savePitch`, `readPitchLog`, `pitchVideo`, `markWin`, `listUpsellFiles`, `uploadUpsellFile`, `updateUpsellFile`, `removeUpsellFile`, `runSiteCheck`;
  - types `CatalogRow`, `Gate`, `OfferStatus`, `OfferSources`, `UpsellFile`.
- **`src/present/offer/price.ts`** (deck), pure:
  - `listOf(row)`, `openingOf(row, prep)`, `belowList`, `firstYearUsd(parts, row)`, `inCurrency(usd, currency, usdPer)`, `formatMoney(n, currency, lang)`, `CADENCE: Record<cadence, L>`.
  - "This, first year" is one-time parts plus 12 times the monthly parts. Per-day and per-90-days parts are shown alone.
- **`src/present/offer/content/types.ts`** (content):
  - `OfferNotesCopy {say:string[]; sayKw:string[]; saySa:string[]; push?:string[]; pushKw?:string[]; pushSa?:string[]}`.
  - `OfferSlideCopy {title:L; stops: Record<string, L>; notes: OfferNotesCopy}`.
  - `OfferDeckCopy {name:L; tab:L; slides: Record<slideId, OfferSlideCopy>; branches: {no_site, broken, working_on_it}: OfferNotesCopy; objections: {busy, burned, expensive}: OfferNotesCopy; price:{hold, lower, split}: OfferNotesCopy; whatsapp:{en:string; kw:string; sa:string} with slots {video} {next} {name}; facts:[{text, source, year, country:'any'|'KW'|'SA'|'AE'|'QA'|'BH'}]}`.
  - `OfferVideoCopy {beats:[{id:'hook'|'gap'|'what'|'need'|'return', start:number, end:number, vo:L, labels:{en:string[]; ar:string[]}}], closing:L}`.
- **`OFFER_CHROME`** (content), keys:
  - `revA`, `revB`, `captured` ("Captured {date}"), `searchedAs`, `example` ("Example, drawn for {name}"), `yourFigure`, `fromAnswer` ("Your answer, {date}"), `fromSheet`, `item`, `description`, `terms`, `dollars`, `paidInFull`, `typicalProject`, `thisFirstYear`, `howMany`, `weNeed`, `commitTitle`, `fromMainProgramme`, `oneTime`, `monthly`, `perDay`, `per90`.
- **`ART`** (art):
  - `Record<OfferKey, {hero:string|null; heroAlt:L; backgrounds:{id:string; url:string}[]; motion:string|null} | null>`.
  - `OfferIcon({name, size?, tone?:'ink'|'teal'|'leak'})`, with names `pages`, `portfolio`, `whatsapp`, `form`, `tracking`, `care`, `logo`, `photos`, `services`, `search`, `cloud`.
  - Size budget per offer: hero ≤250 KB, each background ≤150 KB, total ≤800 KB.
- **`sites/offer/strings.js`** (content): `export const STRINGS = {en, ar}` with keys:
  - `proposalFor`, `preparedBy`, `validUntil`, `found`, `why`, `get`, `work`, `runs`, `investment`, `dollars`, `split`, `paidInFull`, `oneTime`, `monthly`, `perDay`, `per90`, `example`, `captured`, `searchedAs`, `play`, `playNote`, `printLink`;
  - `states.{loading, expired, archived, unknown, busy, error, videoGone}`, `messageUs`.

### 5.8 Design tokens (deck and proposal page; the proposal page uses the navy and teal brand)

- Deep Space `#091333` (ground), Deep `#060d24` (capture well), Panel `#0e1a42` (bill), Teal `#00cfc8` (ours: Rev B, the lit step), Ink `#f2f6fa` (theirs: Rev A, their words and numbers), Amber `--dk-leak #f5b84b` (only "What we need from you"), line strong `rgba(255,255,255,.22)`.
- Motion: `--dko-cloud-ms: 640ms` and `--dko-issue-ms: 420ms`. Classes start `.dko-`.
- Type: Geist 700 and 400 at 56/30/24, Geist Mono for labels of record, IBM Plex Sans Arabic one step larger. Floors are 24 px English and 26 px Arabic, with at most five sizes per slide.
- The signature is the revision cloud, twice per deck. It is a 3 px scalloped line drawn in 640 ms, with the revision letter in a corner triangle. It mirrors in Arabic, and the letters stay Latin.
- The proposal page's signature is the video at the top, framed by the client's name, with "What we found" under it.

## 6. Tests per builder (all run on the VPS through vrun.sh)

**db**: `vrun.sh apps/media-buyer-cockpit 'bun test scripts/upsell-'`
- Catalog:
  - the seven rows, all amounts null, the hints;
  - set is CEO only (42501 for csm, buyer and anon);
  - a revision conflict gives 40001;
  - the audit `metadata.line` text;
  - settings checks.
- Copy problems: a table of at least 40 English and Arabic cases, including MENTION as a warning only, `p_money_ok`, and whole-word lead (no hit on "leader" or "leading").
- Decks:
  - the md5 guard refuses a wrong body (alter a body, expect the raise);
  - the onboarding and launch prep and video behaviour is unchanged (re-run the key cases of `csm-decks-supabase.test.ts` against the new bodies);
  - each offer prep key accepts and refuses per section 2;
  - the locked and below-list rules;
  - `presented_at` keeps its first stamp;
  - the 12+7 slots in order;
  - offer video save and clear are CEO only;
  - deck check constraints refuse `offer_nope`.
- Files: reserve idempotency; accept checks storage metadata; the read policy hides other clients' files; remove; purge.
- Site verdict: none_on_file, not_checked, one fail gives failing, two fails 19 h apart give failing, two fails 21 h apart give broken, ok after a fail gives ok, and the hourly cap.
- Gate:
  - every reason key alone, then all passing;
  - win by quotation in the last 30 days, by signed close on any day, and by CSM tick; the tick refused at 31 days;
  - the renewal window from a plan and from launch+90, cleared by an outcome and ended 30 days after;
  - the last-call patterns in English and Arabic;
  - no leads, CPL, spend or budget keys anywhere in the JSON.
- Sources and status: refused, client_asked and proactive modes; website fit wording; ready missing pieces; `capture_old` at 8 days.
- Pitches: the create stamps; the held, split, locked, not_now and no rules; the video URL with `door_live` false and true.
- Proposals:
  - create prefill;
  - save revision;
  - each send refusal named;
  - the freeze (a later catalog or price change does not alter the sent page);
  - update link;
  - mark;
  - expiry worked out;
  - the preview token not counted;
  - door functions service_role only (42501 for authenticated and anon);
  - views not audited;
  - purge at 90 days;
  - PublicProposal never contains forbidden keys (a recursive key scan for `reason`, `list`, `email`, `taskId`, `warnings`).
- Grants: every new table has RLS on, no anon or authenticated privileges, and service_role without DELETE. Every new function's ACL matches section 4.3. Each file applies twice.

**edge**: `vrun.sh . 'bun test supabase/functions/offer-door supabase/functions/cockpit-csm-api/upsell'`
- webTools:
  - SSRF refusals;
  - redirect re-checks;
  - the byte cap;
  - every path writes intent then response or unknown health rows, with the host only;
  - a failed health write stops the call.
- Site classification from saved HTML fixtures: GoDaddy, Sedo and Dan parked pages, Squarespace expired, Wix unpublished, cPanel default, Instagram redirect, empty, DNS, TLS, timeout and 404. Plus logo candidate parsing.
- Video: per provider, public gives ok and 401, 403 or 404 gives the refusal; Drive sign-in redirect; Vimeo domain lock; poster host filter.
- Logo: SVG, GIF, animated WebP and APNG refused; the 2 MB and size caps; EXIF stripped (the bytes no longer contain `Exif`); the reserve, upload and accept order.
- Files: the reserve, upload and ready flow with the stand-in bucket; the list signs and sweeps.
- Door:
  - routes and origin;
  - rate limits;
  - bots not counted;
  - preview not counted;
  - states;
  - 302 targets carry no client data;
  - headers;
  - missing secrets give a 503 with the name only;
  - status rows written on change only.

**content**:
- `vrun.sh apps/client-success-cockpit 'bun test scripts/offer-copy.test.ts'`:
  - every key exists in en and ar, and catalog `get`, `need`, `steps` and `why` keys match;
  - Arabic lines contain Arabic script;
  - no em dash;
  - none of the humanizer's banned words (unlock, seamless, elevate, leverage, journey, game-changer);
  - slide titles ≤40 characters; slides ≤5 type sizes, so the content gives no long canvas lines (each canvas line ≤90 characters English, ≤110 Arabic);
  - the slide ids match section 2;
  - the WhatsApp templates have `{video}` and `{next}`;
  - the video beats tile 0 to 60 s without gaps.
- `vrun.sh apps/media-buyer-cockpit 'bun test scripts/upsell-copy-supabase.test.ts'`:
  - every catalog string, every canvas and notes line of `WEBSITE_DECK`, every `WEBSITE_VIDEO` line and every `STRINGS` value pass `cockpit_client_copy_problems` with no blocking rule;
  - the Investment-only money lines pass with `p_money_ok`;
  - the copy migration applies on top of u, v and w and refuses to overwrite a non-empty copy that differs from its own.

**art**: `vrun.sh tools/offer-art 'bun run doctor && bun run check'`
- Each export exists, is within its size budget and has the right dimensions.
- The palette check: the mean hue and lightness of each background stays within the deep-space range, with no pixel brighter than Ink.
- No faces: images are generated only from prompts that name no people, and that is reviewed by eye on the contact sheet.
- `art/index.ts` paths exist.

**deck**: `vrun.sh apps/client-success-cockpit 'npx tsc -b && bunx biome check src/present/offer src/pages/money/offers src/dev/offer && bun test scripts/deck-offer scripts/offer-'`, then the regression run `bun test scripts/deck-` (every existing deck test still passes).
- The step order per slide.
- The canvas copy check: render every slide and stop to static markup for each fixture and language, then assert no forbidden words or figures (upsell, renewal, lead, CPL, spend, budget, list, discount, guarantee, "page one").
- No lower price ever reaches the canvas: set `held_full` with a lower final price in live state, then scan every slide's markup for that number in both digit forms.
- The split stays hidden until held.
- The gate refusal screen lists the reasons, and "Client asked" saves and reopens.
- `OFFER_PREP_KEYS` equals the key list parsed from `20261026v`.
- Price math: first year, currency, BHD stays in USD.
- The picker shows this month's offer on top and the others under Later with why.
- The Hot row shows Ready or the missing pieces.
- The Offers tab: a CSM sees it read-only; the CEO edits and saves on Enter or blur only, never per key; the hint is one click.
- `offer-shots.mjs`, run on the VPS with the harness on port 5311, captures 5 fixtures × en/ar × 1920x1080 and 1366x768 × every slide and stop, plus notes and prep once each, plus the 1366 shots at 0.67 scale. The same overlap checks as `deck-shots.mjs`. PNGs go back to `hw-notes/upsell-studio/shots/deck/`.

**proposal**: `vrun.sh apps/client-success-cockpit 'npx tsc -b && bun test scripts/proposal-'`, `vrun.sh . 'bun test sites/offer'` and `vrun.sh apps/media-buyer-cockpit 'bun test scripts/upsell-public-parity.test.ts'`
- The builder:
  - fields save themselves (600 ms after typing, at once for ticks);
  - a revision conflict shows the plain sentence;
  - copy problems show inline, and only Send is refused;
  - Send is refused without a video;
  - the warnings need ticks;
  - a private custom video is refused with the exact sentence.
- Preview: the srcdoc contains exactly the bytes of `sites/offer/core.js`, `offer.css` and `strings.js`; the preview never calls the door; the phone and desktop switch.
- Site: `render()` in English and Arabic; RTL; every state view; no cookie or storage before play other than the device id; the print layout prints the link; Yes posts `cta`, then opens `wa.me`.
- Parity: `publicProposal.ts` and `cockpit_upsell_public_json` give equal JSON on the 5 fixtures.
- `proposal-shots.mjs` captures the builder at 1440 wide, and the page at 390 and 1280 in en and ar, for draft preview, open, expired, archived and unknown. Shots go to `hw-notes/upsell-studio/shots/proposal/`.

**video**: see section 8, "Checks".

## 7. Harness fixtures

These live in `src/dev/offer/fixtures.ts` (deck), and `proposalFixtures.ts` builds on them. Every name is invented and is never a real client's. Each fixture is a full `Loaded` plus `OfferSources` and `OfferStatus`. Saves stay in memory.

| fixture | who | what it proves |
|---|---|---|
| `full` | Kuwait, English deck, Kuwaiti notes, done for you, Active 64 days, happy (confirmed 5 days ago), win = quotation 12 days ago | site on card parked, failed 26 and 27 Oct, so `broken`. Two captures (their parked page; Google for their name, searched as Kuwait City) with a gap mark. Goal90 and challenges with dates. Project value 18,000 KWD from onboarding, answered 3 Sep. List 2,000 and 200, opening = list. Whop link. Verified logo. Three example stills. Videos en and ar set. No pitches. Every slide and stop full. |
| `sparse` | UAE, English | No captures, goals, project value, logo or payment link. Site not checked. List set. Slide 1 hidden with prep saying "Take a capture of their site, or their name on Google". Slide 4 asks for "Your figure" live. The Hot row lists its missing pieces. Nothing reads 0. |
| `dwy` | Done with you | No appointment or call-centre line anywhere (canvas, notes, prep, WhatsApp text). |
| `noprice` | Bahrain | List blank and no opening price: slide 4 hidden, prep says "No price yet. Type the opening price, or the CEO sets the list on Money > Offers", the Hot row says "No price". BHD stays in USD with the note. |
| `saudi` | Saudi Arabia, Arabic deck, Saudi notes (`dialect sa`), SAR | Arabic onboarding answers. A mirrored layout, Arabic-Indic digits, Latin revision letters, IBM Plex Sans Arabic, slide 4 in SAR at 0.2666. |
| `refused` (extra) | gate fails `no_win` and `recent_offer` | The refusal screen and the "Client asked" form. |
| `asked` (extra) | gate fails, `client_asked` set | Opens in `client_asked` mode. The notes say so. The canvas never does. |

Harness addresses (VPS):
- Deck: `http://127.0.0.1:5311/client-success/offer-harness.html?fixture=full&lang=en&view=present|notes|prep|picker|hotrow|offers&slide=saw&stop=0&still=1&role=csm|ceo`.
- Proposal: `http://127.0.0.1:5312/client-success/proposal-harness.html?fixture=full&view=builder|page&state=draft|open|expired|archived|unknown&w=390|1280&lang=en|ar`.
- Offer site: `bun sites/offer/dev-door.ts`, port 5421, then `http://127.0.0.1:5421/<code>?door=open|expired|archived|unknown|busy|slow|error`.

Start each in the background with a timeout, for example:

```
vrun.sh apps/client-success-cockpit 'timeout 1200 bunx vite --port 5311 --strictPort --host 127.0.0.1 > /tmp/upsell-5311.log 2>&1 &'
```

Check `ss -ltn` first, and capture with the VPS Playwright (`apps/client-success-cockpit/node_modules`, playwright 1.64.1, chromium headless shell 1193).

## 8. The website video spec

Owned by the video builder and built in `tools/offer-video/`. Media lives on the VPS in `~/upsell-build/media/video/website/`.

- **Length and format.**
  - Exactly 60.0 s (±0.1).
  - 16:9, 1920x1080, 30 fps, H.264 High, yuv420p, +faststart.
  - AAC-LC 48 kHz stereo 192 kbps.
  - Integrated loudness -15 LUFS (allowed -16 to -14), true peak ≤ -1.0 dBTP, voice 6 to 9 LU over the bed.
- **Two cuts.**
  - `website-en.mp4`.
  - `website-ar.mp4`, rebuilt right to left and never subtitled: mirrored layout, Arabic labels in IBM Plex Sans Arabic, Arabic-Indic digits, mirrored revision cloud with Latin letters, regional Gulf wording written under the voice skill (content builder's `WEBSITE_VIDEO`).
  - Each cut gets a poster (`website-en-poster.jpg`, `website-ar-poster.jpg`, 1920x1080, in the deck palette) and a sidecar WebVTT (`.vtt`). Captions are burned into the main cuts, since WhatsApp plays muted. A clean pair without burned captions is also rendered.
- **The five beats.** Timings are the same in both cuts. The VO lines are `WEBSITE_VIDEO.beats[*].vo`.

  | beat | time | what is shown | spoken line |
  |---|---|---|---|
  | hook | 0.0–5.0 | A phone (the deck's `Phone` frame) shows an Example ad, one of Mahara's own example scenes, tagged "Example ad". A thumb taps it, and the firm's name is typed into a plain search field, not branded. | "Someone sees your ad. Then they search your name." |
  | gap | 5.0–15.0 | What their customer finds today, shown for real: Chrome's own "This site can't be reached" page for the demo firm's reserved `.example` domain, captured by Playwright on the VPS. Rev A's ink cloud draws around it in 640 ms, then holds still, with the "Example" tag. A real Google results capture is used only if one clean try from the VPS shows no consent or bot page. Never bypass a bot check. | |
  | what | 15.0–35.0 | The demo firm's bilingual site, built page by page from `tools/offer-video/demo-site/`: home, projects (portfolio), one project, services, the WhatsApp button, the enquiry form, and a small "tracking" mark. Desktop and phone, with one EN to AR switch. One diagram grows: the six-page sitemap drawn as a drawing's title block, ending in Rev B's teal cloud around the finished home page. | |
  | need | 35.0–45.0 | Three amber labels with leader lines on the real site, never a bullet slide: "Your logo", "Photos of your projects", "Your list of services". | |
  | return | 45.0–60.0 | 45–52: the deck's empty card, captured from the deck harness (`fixture=noprice`, slide `investment`, stop `beside`, still), with "Your typical project" and "This" and no figures. Then 52–60: Aziz's real 8 s clip, "Your account manager will walk you through it." | "How many projects would pay for this? Your account manager works it out with your numbers." |

  - No price and no invented figure anywhere.
  - End frame: the Mahara teal and white lockup for dark.
- **Aziz's closing clip** is real footage only. It is taken from `~/upsell-build/media/real/aziz-close-{en,ar}.mp4` when present (trimmed to 8.0 s, graded, his face never altered).
  - Until he records it, the slot is a still card: the Mahara mark and the line as text, read by the narrator, who never poses as Aziz.
  - `manifest.json` then says `closing: "placeholder"`, so nobody sends the cut by mistake.
- **The art set.**
  - Reuse the art builder's website set from `~/upsell-build/media/art/website/`: hero still, three backgrounds, and `OfferIcon` SVGs (pages, portfolio, whatsapp, form, tracking, care, logo, photos, services, search, cloud).
  - Add at most 2 Kling motion clips (Higgsfield `kling-video/v3.0/std/image-to-video`, locked camera, slow dolly, 5 s) from the hero, for the beat changes.
  - Stills come from Higgsfield GPT Image (`marketing-studio/image/sunburst` at `https://api.higgsfield.ai`, as in `hermes/salma/salma.py` lines 682–930).
  - Everything is graded to Deep Space `#091333`, Deep `#060d24`, Panel `#0e1a42`, Teal `#00cfc8`, Ink `#f2f6fa` and Amber `#f5b84b` with `npx hyperframes media-treatment`, never CSS filters.
  - No people in any generated image. Real screens are never generated. The demo firm is tagged "Example" on every frame it appears in.
- **The demo firm.** One fictional Gulf design and build firm, with an English and Arabic name chosen by the builder. Before using the name, search it and confirm it is not a real Gulf firm, and record that search in the manifest.
  - Its site uses Mahara's own example scenes (`src/present/assets/examples/*`, from Mahara's own Higgsfield run, no client's work).
  - Its domain is `<name>.example`.
- **Voice casting.**
  - ElevenLabs is first choice (`ELEVENLABS_API_KEY`); Higgsfield voices are the backup. Never a clone of Aziz's voice and never his name.
  - From the ElevenLabs voice library (`GET /v1/shared-voices`), pick 3 Arabic voices: Gulf, Khaleeji, Kuwaiti or Saudi accent, male, professional narration, calm.
  - Pick 3 English voices that match: warm, measured, mid-low, neutral international.
  - Add only those 6 to the account.
  - Render one 12 s audition each (the hook and the return line) with `eleven_multilingual_v2` (or `eleven_v3` where the account has it). Arabic text is set with diacritics only where the voice skill says, and `mp3_44100_192` output.
  - Auditions go to `media/video/casting/{en,ar}/candidate-{1,2,3}.mp3`, plus `casting.json` (voice id, name, accent and labels, never a key).
  - The first cuts use candidate 1 per language and say so. Re-voicing is one command: `bun run voice -- --lang ar --voice <id>`.
  - Captions are timed from `/with-timestamps`.
- **Music.** One instrumental bed, 60 s, calm, low tempo, from ElevenLabs' music API if the account's plan includes commercial use (its terms and the plan are recorded in the manifest). Otherwise there is no music and only subtle room tone. The bed is ducked under the voice.
- **Tools.**
  - HyperFrames pinned exactly at `hyperframes@0.8.203` in `tools/offer-video/package.json` (no caret).
  - Fonts are local and pinned: `geist@1.8.2` and `@fontsource/ibm-plex-sans-arabic@5.3.0`. The VPS has neither installed system-wide.
  - Playwright from the CS cockpit's `node_modules` for captures.
  - Use the hyperframes and hyperframes-cli skills' loop: `lint`, then `check --json` with every error fixed, then `snapshot --review` with each scene read, then `render --quality delivery`.
- **Render host.** The VPS, `hermes@187.77.156.166`. The doctor check on 26 Oct read:
  - ffmpeg 6.1.1, node v22.22.1, 27 GB free disk, 15 GB RAM, 4 cores;
  - Playwright chromium headless shell 1193;
  - ELEVENLABS_API_KEY, HIGGSFIELD_ID, HIGGSFIELD_SECRET and WISTIA_API_TOKEN present by name in `/opt/data/bibi/api-keys.env`.

  `bun run doctor` re-checks all of that (plus 5 GB free and `npx hyperframes doctor --json` `.ok`) before any render, and stops with a plain sentence if anything is missing. Keys are read by name and never printed or copied.
- **Where the files go.**
  - VPS: `~/upsell-build/media/video/website/v<N>/`, holding both cuts, the clean pair, the posters, the `.vtt` files, `contact-sheet.png` and `manifest.json`. The manifest records md5s, durations, LUFS and true peak, voice ids, HyperFrames and font versions, Higgsfield job ids, music source and terms, closing status, the demo firm search, and the copy-check result.
  - Mac: `/Users/abdulazizwaheedi/mahara-worktrees/hw-notes/upsell-studio/video/website/v<N>/`, holding the posters, 960x540 proxies (≤6 MB each), the casting MP3s, `manifest.json` and the contact sheet. No masters on the Mac.
  - Git: only `tools/offer-video/**` source.
  - Later, at ship and with the CEO's OK: Wistia folder "Offer videos", replaced in place so links never change, then saved to slot `offer_website:demo` per language on Money > Offers.
- **Checks** (`bun run check`, all must pass):
  - ffprobe duration 60.0±0.1, 1920x1080, 30 fps, the codecs above;
  - `ffmpeg -af ebur128` gives -15±1 LUFS and true peak ≤ -1.0;
  - the poster exists;
  - captions sit within the 90% safe area;
  - the contact sheet of frames at 2.5, 10, 25, 40, 50 and 56 s per cut, looked at by eye (the Arabic frames must be mirrored with the cloud on the correct side);
  - every VO line and on-screen label passes `cockpit_client_copy_problems` (PGlite) before the render;
  - no forbidden word, price or figure on screen;
  - the Hallmark slop test on the six frames.

## 9. Ports, paths, order of work

- **Ports.** Deck harness 5311, proposal harness 5312, offer site dev door 5421, demo-firm site 5431, HyperFrames preview 5441. Check `ss -ltn` before starting.
- **Shots.** `hw-notes/upsell-studio/shots/{deck,proposal,offers,art,video}/`.
- **Order.**
  1. db
  2. edge
  3. content
  4. art
  5. deck
  6. proposal (which also wires the cockpit)
  7. video
- **Reading earlier builders' work.** Each builder reads the files of the builders before it, and changes none of them. A gap in an earlier interface is reported back, not patched in someone else's file.

## 10. Not in scope, and how we know it works

**Not in scope:**
- Second campaign and the other five decks.
- The CEO card in the CEO cockpit.
- Payment tags and pay-entry product tags.
- Accept and pay, and Whop plan creation.
- Send on WhatsApp.
- The company Hot list tab rules.
- The renewal deck.
- 9:16 cuts.
- Wistia upload.
- Any deploy, migration apply or ship.
- The reliability-monitor profile entry for `offer-door`, which is added at ship.

**How we know it works:**
- Every test in section 6 passes on the VPS, and the existing deck tests still pass.
- `tsc -b` and biome are clean.
- The CEO walks the website deck in the harness, slide by slide, on the `full` and `saudi` fixtures.
- The proposal builder's preview redraws as you type, and the client page renders the same at 390 and 1280.
- Both video cuts pass the checks, and their posters and proxies are on the Mac.
- The Arabic approval sheet is ready for the CEO's one batch.
