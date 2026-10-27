# Upsell studio: the backend

Three migrations on Creative Triage (`bldgtotkfmhoxmlzowdx`), applied in this order, each one `BEGIN … COMMIT` and safe to apply twice:

1. `supabase/migrations/20261026u_upsell_catalog.sql`: the catalog, the settings, the client copy check and the audit.
2. `supabase/migrations/20261026v_upsell_offer_decks.sql`: offer decks on the decks' engine, captures, site checks, wins, the gate, sources, status and pitches.
3. `supabase/migrations/20261026w_upsell_proposals.sql`: proposals, views, the door's status and every door function.

Then `20261026x_upsell_catalog_copy.sql` (the content builder's copy).

Before deploying the Edge reads, apply `20261027011000_upsell_monitor_web.sql`. This independent migration was generated with the Supabase CLI and replaces only the native monitor's receipt filter. It is based on the live base body read on 26 October (md5 `6610301bdcef1ddcc4bd1ee284cef9ea`) and checks both the body and ACL before proceeding. The base remains owner-only; the service-role wrapper is untouched. Site/logo/thumbnail observations and oEmbed 401/403/404 are excluded. oEmbed unknown, NULL status, 429 and 500 remain visible. No receipts change.

These changes have not been applied by this continuation. Ship applies u, v, w, x in that order, plus the independent monitor migration before the Edge reads. The monitor migration must stop if the live body or grants have changed.

Tests run on PGlite on the VPS:

```
vrun.sh apps/media-buyer-cockpit 'bun test scripts/upsell-'
```

| test file | what it proves | tests |
|---|---|---|
| `apps/media-buyer-cockpit/scripts/upsell-catalog-supabase.test.ts` | seed, grants, catalog read and set, settings, the copy shape check, 75 copy-problem lines | 18 |
| `apps/media-buyer-cockpit/scripts/upsell-decks-supabase.test.ts` | guards, old decks unchanged, every offer prep key, price rules, 12 + 7 slots, offer videos, captures (with the copy check on their caption and search) and their read policy, the site verdict | 23 |
| `apps/media-buyer-cockpit/scripts/upsell-gate-supabase.test.ts` | each gate reason alone and its plain source label, wins, renewal window (plan and launch + 90 texts), last-call patterns, sources and status (a stored price the list moved past), pitches (the same offer's deck stays open), the video link (no door link without a video), the pitch log | 21 |
| `apps/media-buyer-cockpit/scripts/upsell-proposals-supabase.test.ts` | create, save, every send refusal (a line marked unedited that is not the catalog's, a capture's own caption and search, a catalog line left in the other language), a language switch, the CEO card's line (plain warnings, no list price yet), the freeze (captions included), update link, mark (and the card's objection and follow-up), the door, views, preview, PublicProposal, the grants census of all three files, a service key update, a third apply | 27 |

`apps/media-buyer-cockpit/scripts/lib/upsellTestDb.ts` stands the database up for these four files and for the content and proposal builders' tests. See "The test harness" at the end.

## Rules every object follows

- **Tables.** Row security is on and there are no policies. `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`, then `GRANT SELECT, INSERT, UPDATE … TO service_role`. Nobody gets DELETE or TRUNCATE. The two identity sequences of v and the one of w are revoked from the browser roles too.
- **Functions.** Every new function is `SECURITY DEFINER SET search_path = ''`, except `cockpit_client_copy_problems` (IMMUTABLE, SECURITY INVOKER). The four kinds:
  - browser: `REVOKE ALL FROM PUBLIC, anon, service_role; GRANT EXECUTE TO authenticated`. Each runs `cockpit_csm_client_gate(task)` first, or `cockpit_csm_actor()` (a client success seat or the CEO) when there is no client.
  - door and the purge: `REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role`.
  - internal helpers, CHECK helpers and the trigger: revoked from all four roles.
  - the copy check: revoked from PUBLIC and anon, granted to authenticated and service_role.
- **Errors.** `42501` no access, `22023` a bad value (one plain sentence that says what to do), `40001` a stale revision ("Someone else saved this. Read it again."). The replaced deck functions keep their own messages and codes.
- **Audit.** One trigger function, `cockpit_upsell_audit()`, writes one `cockpit_audit_log` row per write to the catalog, settings, files, wins, pitches and proposals, with `source_app 'client-success'`. The action comes from the transaction-local `cockpit.upsell_action`, and the CEO card's sentence from `cockpit.upsell_line` (stored in `metadata.line`). `metadata` also holds `op`, `task_id`, `offer_key`, `changed` (the top-level keys the write changed) and `database_role`. A proposal row records only the changed keys; `sent_content` is recorded on send and on update link only. Site checks, views and the door's status are never audited. Offer prep writes go through the decks' own `cockpit_csm_deck_audit`.
- **Days are Kuwait days.** The database clock is UTC, three hours behind Kuwait. Every date rule in v and w (today, "in the last 30 days", a date in the future, the gate's windows, the offer date, the page's date and its expiry) uses `cockpit_upsell_today()`, and every day label of a moment uses `cockpit_upsell_kday(ts)` (both in u). The harness's fixtures start from the Kuwait day too (`KW_TODAY`), so the tests hold between 21:00 and 24:00 UTC.
- **Missing is never zero.** A missing figure is `null`, never `0`, and comes with a sentence where the CSM sees it (`fx.note`, the gate texts, `site.note`, the video link `note`).
- **Numbers say where they came from.** Gate checks carry `source` and `at`; the sheet figure carries `from` and `window`; the rate carries `from`.
- **Never in the JSON a client or a CSM page reads:** leads, cost per lead, spend or a budget. The test scans every key of the gate, sources and status for `lead|cpl|spend|budget`.

## 1. The catalog and settings (u)

### Tables

`cockpit_upsell_catalog`: one row per offer.

| column | rule |
|---|---|
| `offer_key` | PK, one of `website`, `second_campaign`, `seo_geo`, `smm`, `ugc`, `closer`, `cameraman` |
| `sort` | unique, 1..7 (website 1, second_campaign 2, seo_geo 3, smm 4, cameraman 5, ugc 6, closer 7) |
| `parts` | 1..3 of `{key ^[a-z_]{2,20}$, cadence one_time\|monthly\|per_day\|per_90_days, amount number\|null, hint number}`; keys unique; dollars 1..1,000,000 with at most 2 decimals; `amount null` = no price yet |
| `locked`, `split_allowed` | booleans |
| `split_parts` | null or two dollar amounts |
| `min_months` | null or 1..24 |
| `waits_on` | null or 1..160 characters |
| `copy` | `{}` or `{en: C, ar: C}`, checked by `cockpit_upsell_copy_ok(copy, parts, offer_key)` (constraint `cockpit_upsell_catalog_copy`) |
| `revision`, `updated_at`, `updated_by` | the revision guard and who changed it last |

The seed (applied once, `updated_by 'migration'`, audited as `upsellCatalog.seed`), every amount blank:

| offer | parts (key, cadence, hint) | other |
|---|---|---|
| website | build one_time 2000; care monthly 200 | |
| second_campaign | monthly monthly 500 | waits on "Deck and video follow the website." |
| seo_geo | program per_90_days 5000 | locked, split allowed, split 2500 + 2500, waits on "Needs a delivery owner, a fulfilment list and proof." |
| smm | monthly monthly 1000 | waits on the same as seo_geo |
| cameraman | day per_day 800 | waits on "Needs a cameraman listed for the client's city." |
| ugc | package one_time 3500 | waits on "Needs real UGC videos we produced." |
| closer | placement one_time 4000; management monthly 750 | min_months 3, waits on "Needs a named recruiter." |

`cockpit_upsell_settings`: `whatsapp_number` (8..15 digits), `valid_days` (7..90), `door_live` (`true`/`false`). Seeded `valid_days 30`, `door_live false`. `whatsapp_number` stays absent, so the client page shows no Yes button.

### The copy shape (for the content builder's migration x)

Each language `C` has exactly these keys (and `platforms` for smm only, required there):

| key | shape |
|---|---|
| `name`, `deckTitle` | text, not blank, ≤40 |
| `line` | ≤200 |
| `terms` | ≤200 |
| `timing` | ≤160 |
| `button` | ≤40 |
| `cta` | ≤80 (the Yes button's WhatsApp message) |
| `close` | ≤120 |
| `parts` | `{<partKey>: text ≤120}` naming exactly the catalog's parts |
| `get` | 1..8 of `{key, text ≤200}` |
| `need` | 0..4 of `{key, text ≤80}` |
| `steps` | 1..6 of `{key, text ≤160}` |
| `why` | 1..3 of `{key, label ≤60, text ≤400}` |
| `work` | 0..6 of `{key, label ≤60, url https://… ≤308}` (empty in the pilot) |
| `platforms` | `{instagram, tiktok, snapchat, facebook}`, each text ≤120 (smm only) |

List keys are `^[a-z0-9_]{1,30}$` and unique in their list. `get`, `need`, `steps` and `why` carry the same keys in the same order in `en` and `ar`. A new proposal joins the `steps` texts with new lines and keeps whole steps within 400 characters, so keep the joined steps under 400.

### Functions

| function | who | does |
|---|---|---|
| `cockpit_client_copy_problems(p_text text, p_money_ok boolean DEFAULT false) → jsonb` | authenticated, service_role | `[{rule, match, why, block}]`, one per rule that hits, in this order: `promise`, `free_work`, `result_guarantee` (ported from `hermes/sales-desk/desk/validate.py`, with its negation exemption: "We do not guarantee results" passes), `mention` (block false), `outcome`, `performance_number`, `metric_word` (CPL, ROAS, CPA, cost per lead by name), `internal_word` (our own words: CSM, ad spend or spend on ads, a list, regular or original price; in Arabic الصرف الإعلاني, الإنفاق الإعلاني, السعر الأصلي or الرسمي; "Spend a day on site" and "a listing" pass), `money` (skipped with `p_money_ok`), `lead_word` (whole word only, never "leader"; in Arabic ليد and ليدز, with a one-letter prefix only on ليدز so the name وليد passes, and never ليد after a lighting or screen word, so "إضاءة ليد" passes), `upsell_word` (upsell, renewal; in Arabic only "تجديد" followed by contract, subscription, programme, package or plan, with or without a one-letter prefix such as "وتجديد العقد", because "التجديد" is also renovation), `discount` (discount, "20% off", special price; خصم, خصومات, تخفيضات, تخفيض with a price word, سعر خاص), `em_dash` (an em dash, a horizontal bar, or a spaced en dash; "2025–2026" passes). Arabic-Indic digits read as digits; Arabic diacritics and the tatweel are dropped first. |
| `cockpit_upsell_catalog_read() → jsonb` | a client success seat or the CEO | `{rows:[{offerKey, sort, parts, locked, splitAllowed, splitParts, minMonths, waitsOn, copy, revision, updatedAt, updatedBy}], settings:{whatsappNumber, validDays, doorLive}, videos:[{deck, slotKey, lang, provider, url, embedUrl, posterUrl, title, durationSeconds, revision}], isCeo, at}`. `videos` are the offer decks' recorded slots (with the revision a save needs). |
| `cockpit_upsell_catalog_set(p_offer text, p_patch jsonb, p_base_revision integer) → jsonb` | the CEO only (42501 "Only the CEO changes the price list.") | Patch keys `parts` ([{key, amount\|null}], existing keys only), `locked`, `split_allowed`, `split_parts`, `waits_on`. A split must add up to a single-part price when that price is set. Bumps the revision; audited `upsellCatalog.set` with a line like "Website build: blank to 2,000, by the CEO". An unchanged patch returns `changed:false` and writes nothing. |
| `cockpit_upsell_setting_set(p_key text, p_value text) → jsonb` | the CEO only | Blank removes the WhatsApp number. Returns the settings plus `changed`. Lines: "WhatsApp number for the client page changed, by the CEO", "Proposals stay open 45 days (was 30), by the CEO", "Video links now count views, by the CEO". |

Internal: `cockpit_upsell_usd_ok`, `cockpit_upsell_parts_ok`, `cockpit_upsell_split_ok`, `cockpit_upsell_copy_text_ok`, `cockpit_upsell_copy_ok`, `cockpit_upsell_audit` (trigger), `cockpit_upsell_offer_name`, `cockpit_upsell_part_name` ("Website care plan", never a raw key), `cockpit_upsell_clause`, `cockpit_upsell_today` and `cockpit_upsell_kday` (the Kuwait day), `cockpit_upsell_money`, `cockpit_upsell_catalog_json`, `cockpit_upsell_settings_json`, `cockpit_upsell_list_of`.

The five CHECK helpers above (`usd_ok`, `parts_ok`, `split_ok`, `copy_text_ok`, `copy_ok`) are granted to the service key, and so are w's two (`cockpit_upsell_proposal_content_ok`, `cockpit_upsell_price_ok`): every table's SELECT, INSERT and UPDATE grant to the service key works, its checks hold, and the audit trigger records the write. The browser still writes only through the definer functions.

## 2. Offer decks, captures, site checks, wins, the gate and pitches (v)

### Guards (run before anything changes)

| function | live `md5(prosrc)` on 26 Oct | this file's body (LF / CRLF) |
|---|---|---|
| `cockpit_csm_deck_prep_save(text,text,jsonb)` | `e6b8e4d80bd8dd30498ebc1b5ab92859` | `73b22af7…` / `ae54595f…` |
| `cockpit_csm_deck_video_slots()` | `9f670ba72f102080504a1a348d5c9309` | `a5543c7b…` / `73941846…` |
| `cockpit_csm_deck_videos_read(text)` | `e645051690f2f32543e4da89beecb890` | `6f3e17f7…` / `9530d058…` |
| `cockpit_csm_deck_video_save(text,text,text,text,text,integer,integer)` | `eeaf74c7b6fd1ec12db44e26d59c6848` | `51ec4657…` / `797f0927…` |
| `cockpit_csm_deck_video_clear(text,text,text,integer)` | `df961267904ba26d2bb9e425fae40d92` | `04fa7586…` / `8943572d…` |

The live md5s were re-read on 26 Oct before writing and match the repo's deck files exactly (the harness builds the same bodies). Any other body raises "… is not the definition this file was written against (prosrc md5 …)". The two constraints `cockpit_csm_deck_prep_deck_check` and `cockpit_csm_deck_videos_deck_check` must still be `CHECK ((deck = ANY (ARRAY['onboarding'::text, 'launch'::text])))` or this file's own. They are dropped and re-added as `deck IN ('onboarding','launch') OR deck ~ '^offer_(website|second_campaign|seo_geo|smm|ugc|closer|cameraman)$'`.

Relied on, not replaced (the catalog test asserts their signatures): `cockpit_csm_client_gate` (`1ebce3b7…`), `cockpit_csm_deck_video_parse` (`1fe84413…`), `cockpit_csm_launch_ad_reserve` (`4ce83fdb…`), `cockpit_csm_launch_ad_accept` (`7cb50038…`), `cockpit_is_ceo` (`e6a2e530…`), `cockpit_csm_actor` (`9e0fc31c…`), `cockpit_pay_usd_per`.

### Replaced deck functions (same signatures, same grants)

- `cockpit_csm_deck_prep_save`: onboarding and launch run exactly as before (messages and codes included). `offer_<key>` decks send each key to `cockpit_csm_offer_prep_value`, keep `presented_at`'s first stamp, and run the price rules after the merge whenever the save touches `opening_price` or `opening_reason` (so a later list change never blocks an unrelated save). Any other deck still gets "Choose the onboarding or the launch deck".
- `cockpit_csm_deck_video_slots`: the same 12 in the same order, then `offer_website:demo`, `offer_second_campaign:demo`, `offer_seo_geo:demo`, `offer_smm:demo`, `offer_cameraman:demo`, `offer_ugc:demo`, `offer_closer:demo`. `present/videos.ts` keeps its 12.
- `cockpit_csm_deck_videos_read`, `cockpit_csm_deck_video_save`, `cockpit_csm_deck_video_clear`: accept offer decks. Saving or clearing an offer deck's video is CEO only (42501 "Only the CEO changes an offer's video."). Every client success seat reads them.

### Offer prep keys

The line `-- OFFER_PREP_KEYS: …` in v names them for `src/present/offer/prepKeys.ts`; a test checks it against the function's own `WHEN` list. A null value (or blank text, or an empty list) removes the key. Every refusal is 22023.

| key | accepts |
|---|---|
| `language` | `en`, `ar` |
| `dialect` | `kw`, `sa` |
| `site_url` | `https://` with a real host name, ≤300; no user, port or IP address |
| `site_thin` | boolean |
| `captures` | ≤3 of `{id, mark?}`; ids are this client's ready captures, each once; `mark {x,y,w,h}` numbers 0..1, w and h ≥0.04, inside the picture |
| `goal_pick` | `goal90`, `goal12_24`, `challenges`, `why`, `typed` |
| `goal_typed` | text ≤300 |
| `goal_typed_on` | YYYY-MM-DD, not in the future |
| `example_stills` | ≤3 ids of this client's ready pictures in the ads tray (`cockpit_csm_launch_ads`) |
| `example_colors` | ≤3 `#rrggbb`, stored lower case, deduplicated |
| `opening_price` | `{partKey: dollars}` naming every catalog part |
| `opening_reason` | text ≤140 |
| `project_value` | `{amount >0 ≤100,000,000, currency KWD\|SAR\|AED\|QAR\|BHD\|OMR\|USD, from typed\|onboarding, said_on?}` |
| `payment_link` | `https://whop.com/checkout/<3..80>/` or `https://invoice.ecom.io/…` (≤326) |
| `client_asked` | `{words 3..300, on}` with `on` in the last 30 days |
| `hidden_slides`, `shown_slides` | the decks' existing rule |
| `presented_at` | `true` stamps the server's time (first stamp kept), `false` clears |

Price rules after the merge: the website needs both build and care; a locked offer with a blank list refuses with "This price is locked. The CEO sets it on Money > Offers."; a locked offer opens at its list exactly ("SEO and GEO, 90 days: locked at the list price (5,000)."); below a set list needs `opening_reason` ("Website build: below the list price (2,000). Add a one-line reason."). With no list set, any price passes. A missing part names them all: "Type the opening price for the website build and the website care plan." Every sentence names the part by `cockpit_upsell_part_name`, never its key.

A save checks the price rules only when it touches the opening price or its reason. When the CEO later sets, raises or locks the list, a stored opening price can stop passing: `cockpit_csm_offer_status` then counts the offer as `no_price` and `cockpit_csm_offer_sources` carries the sentence in `priceProblem` (null when it passes), so prep says what to fix.

### Captures

`cockpit_upsell_files(id, request_id unique, task_id, kind 'capture', status uploading|ready|removed, storage_path = <taskId>/<id>.<jpg|png|webp> unique, mime, bytes 1..10,485,760, width, height, file_name, searched_as ≤80, captured_on, caption ≤120, created_by uuid, created_by_email, created_at, ready_at, updated_at, updated_by, removed_at, purged_at)` with the ready, removed and purged consistency checks copied from `cockpit_csm_launch_ads`.

Bucket `cockpit-upsell-files`: private, 10,485,760 bytes, JPEG, PNG and WebP. One policy, `cockpit_upsell_files_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'cockpit-upsell-files' AND public.cockpit_upsell_object_allowed(name))`. No write policy: the Edge Function signs uploads with the service key.

| function | who | does |
|---|---|---|
| `cockpit_upsell_file_reserve(p_request_id uuid, p_task_id text, p_kind text, p_mime text, p_bytes bigint, p_width int, p_height int, p_file_name text, p_captured_on date, p_searched_as text)` | browser | `{id, path, kind, mime, bytes, status}`. The same request id returns the same row for the same seat and file (42501 otherwise). `captured_on` today or within a year. `searched_as` shows on the deck and the proposal, so a blocking copy problem refuses it with 22023 ('Searched as: Says lead. Say enquiry or client. ("leads")'). At most 20 unfinished uploads per client an hour and 100 captures per client. Audited `upsellFiles.reserve`. |
| `cockpit_upsell_file_accept(p_task_id, p_id)` | browser, the seat that reserved it | Storage's `size` and `mimetype` must match. Audited `upsellFiles.ready`. A second accept is a no-op. |
| `cockpit_upsell_file_update(p_task_id, p_id, p_patch)` | browser | `searched_as`, `caption`, `captured_on`. The caption and the search go through the client copy check like reserve's search ("The caption: …"). Audited `upsellFiles.update`. |
| `cockpit_upsell_file_remove(p_task_id, p_id)` | browser | Status removed (the row stays). Audited `upsellFiles.remove`. |
| `cockpit_upsell_files_read(p_task_id)` | browser | `{rows:[{id, kind, status, mime, bytes, width, height, fileName, searchedAs, capturedOn, caption, createdAt, createdBy, path}]}`, ready only, newest day first. |
| `cockpit_upsell_files_stale(p_task_id)` | browser | `[{id, path}]`: removed and not yet purged, or unfinished for a day, ≤50. For the Edge Function's sweep. |
| `cockpit_upsell_file_purged(p_task_id, p_ids uuid[])` | service_role only | After the bytes are deleted: marks those rows removed and purged, returns the count. Audited `upsellFiles.purge` (the actor is the session user). |
| `cockpit_upsell_object_allowed(p_name)` | browser (the policy) | True only for a ready capture of a client the seat may open. Never raises. |

### Wins and site checks

- `cockpit_upsell_wins(id identity, task_id, text 3..200, won_on, created_by_email, created_at)`.
- `cockpit_upsell_win_mark(p_task_id, p_text, p_won_on) → {id, taskId, text, wonOn, createdBy, createdAt}`: within the last 30 days, never ahead. Audited `upsellWin.mark` with "Win ticked for <client>: <text> (<day>)".
- `cockpit_client_site_checks(id identity, task_id, url ≤300, source card|onboarding|prep, status ok|parked|expired|dns|tls|http_error|timeout|redirect_offsite|instagram|empty|refused, http_status, final_url ≤500, title ≤200, checked_at, checked_by_email)`. Never audited.
- `cockpit_client_site_check_record(p_task_id, p_url, p_source, p_result {status, httpStatus, finalUrl, title}) → {check, verdict}`: at most 6 per client an hour ("Checked 6 times this hour. Try again later."). The title and final address are trimmed to their caps, never refused.
- `cockpit_client_site_verdict(p_task_id)` (internal) `→ {verdict, urls:[{url, from}], checks (newest 10), disagree, instagramOnly, note, firstFailAt, lastFailAt}`. Addresses come from `editor_clients.website` (card), `cockpit_client_onboarding.links.website` (onboarding) and the website deck's `site_url` (prep), compared without scheme, `www.` or a trailing slash. Only checks of addresses on file count, and a `refused` check counts for neither side.
  - `none_on_file`: no address anywhere.
  - `not_checked`: no counting check yet ("Site not checked yet. Run the site check.").
  - `ok`: the latest check worked.
  - `failing`: one failure, or failures less than 20 hours apart.
  - `broken`: failures at least 20 hours apart since the last working check, the latest a failure ("No working site, checked twice, 26 and 27 Oct.").

### The gate: `cockpit_csm_offer_gate(p_task_id) → jsonb` (browser)

Reads the client as `cockpit_csm_projection_client` does (the roster row merged with overrides confirmed after its sync) and returns:

```
{ok, taskId, checkedAt,
 reasons:[{key, text, source, at}],   failing checks, in this order
 passed:[{key, text, source, at}],
 win:{kind: quotation|signed|csm_tick|null, on, text},
 renewal:{date, from: plan|launch_plus_90|null},
 lastOffer:{kind: pitch|proposal, offer, on}|null}
```

| key | fails when | source |
|---|---|---|
| `not_active` | stage is not Active (any case), or stage or happiness says paused, stopped, cancelled or ghosted | ClickUp card |
| `too_new` | live 30 days or fewer, or no launch date ("No launch date on the card. Add it in ClickUp.") | ClickUp card |
| `no_win` | no quotation in the last 30 days, no signed project on any day (`cockpit_client_days` through `ghl_clients.clickup_id`), and no CSM tick in 30 days | Client sheet (a quotation or a signed project), Win ticked in the cockpit (a tick), Client sheet and ticked wins (none) |
| `not_happy` | happiness is not Happy or Very Happy (anchored, so "Unhappy" fails) | ClickUp card |
| `happiness_stale` | no override with happiness confirmed and no held or showed call in the last 14 days; the text gives the last date and says what to do | Happiness confirmed in the cockpit (`cockpit_csm_client_overrides`), else Call log (`cockpit_csm_calls`) |
| `red` | level red | ClickUp card |
| `pause_required` | `pauseRequired` true | ClickUp card |
| `raised_on_last_call` | a sentence of the latest held or showed call's summary matches ESCALATION, PROBLEM or MONEY_WORDS (ported from `src/lib/clientBrief.ts`, `\b` as `\y`); quoted, ≤160 characters, with the call's day | Call log (`cockpit_csm_calls`) |
| `recent_offer` | a pitch of any offer, or a proposal sent, in the last 30 days: "Website offered on 12 Oct, on a call. The next offer can open from 12 Nov." (or "in a proposal"); passed: "Last offer on 12 Oct." or "No offer made yet." | Offer log (`cockpit_upsell_pitches`), or Proposals (`cockpit_upsell_proposals`) when the last offer was a proposal |
| `renewal_window` | today is from 30 days before the renewal to 30 days after it and no outcome (renewed, resold, not_this_cycle, lost) is recorded on the plan. The date is the latest `cockpit_csm_renewal_plans.renewal_date`, else launch + 90. With a plan: "Renewal is due 15 Nov. Offers wait until the renewal plan has an outcome, or until 16 Dec." Without one the text says the date is a guess: "No renewal plan on file, so renewal counts as launch + 90 days: 15 Nov. Offers wait until 16 Dec." Both add "The website can ride in the renewal as the free care-plan month." | Renewal plan (`cockpit_csm_renewal_plans`), or Launch date + 90 days |

The win shown is the most recent of the three (a tie goes to the quotation, then the signed project).

Every `source` is a plain label the CSM reads on the refusal screen and the picker: ClickUp card, Client sheet, Win ticked in the cockpit, Client sheet and ticked wins, Happiness confirmed in the cockpit, Call log, Offer log, Proposals, Renewal plan, Launch date + 90 days. Never a table name (the test checks that no label carries an underscore or the word upsell). The table behind each label is in brackets above. `project.sheet.from` and `fx.from` keep the contract's names.

**The same offer's own talk (a departure from the contract's literal `recent_offer`).** The gate itself stays as written: any offer in 30 days fails `recent_offer`, and `cockpit_csm_offer_status` (the picker and the Hot list) reads it so. But for one offer's deck, pitch and proposal, a `recent_offer` whose `lastOffer.offer` is that same offer is the same talk, not a reason (`cockpit_upsell_gate_reasons(gate, offer)`, one internal helper). The first pitch is saved during the call (the "Held full price" tap), so without this the notes window, a reload and every follow-up on a "not now" would be refused for 30 days. `cockpit_csm_offer_sources` works out its mode from these reasons, `cockpit_upsell_pitch_save` its mode and its "(gate not passed)" note, and `cockpit_upsell_proposal_warnings` its warnings. Another offer's deck stays refused.

### Sources and status (browser)

`cockpit_csm_offer_sources(p_task_id, p_offer)`:

```
{mode: proactive|client_asked|refused, gate,
 catalog: row|null (null when refused),
 prep: {overrides, revision, updatedAt, updatedBy}|null,
 files: [ready captures],
 site: the verdict,
 project: {onboarding: {answer ≤600, answeredOn}|null,
           sheet: {usd, closes, withValue, from:'cockpit_client_days', window:'180 days'}|null},
 goals: {goal90, goal12_24, challenges, why}: each {answer ≤600, answeredOn}|null,
 country, currency, fx: {usdPer|null, from:'cockpit_pay_usd_per', note|null},
 pitches: [this offer's, newest first, ≤10], heldFullRecently, doorLive, at}
```

- `proactive` when the gate has no reason for this offer (a recent offer of this same offer does not count, above); `client_asked` when it has one but prep's `client_asked` is still within 30 days; else `refused`.
- `priceProblem`: the price rules' sentence for the stored opening price, or null.
- `project.onboarding` is the onboarding form's services and price question (ref `d976036f…`); `goals` are its questions `791b99b8…` (90 days), `f4b96a9b…` (12 to 24 months), `fcf43e6a…` (top 3 challenges) and `7426c6c5…` (why they joined), each dated by the form's `submitted_at`. No other answer (phones, emails) leaves.
- `sheet.usd` is the average signed project with a value over 180 days (revenue ÷ closes with a value); null when there is none.
- Currency by country: KW KWD, SA SAR, AE AED, QA (and the roster's QT) QAR, BH BHD, OM OMR, else USD. BHD and OMR have no fixed rate: `usdPer` is null and `note` says the figure stays in US dollars.

`cockpit_csm_offer_status(p_task_id)`:

```
{gate:{ok, reasons}, thisMonth: offerKey|null, thisMonthWhy: text|null,
 offers:[{key, fit:{ok|null, why}, ready:{ok, missing:[no_capture|capture_old|no_price|no_payment_link]}, waitsOn, lastPitch:{on, answer, mode}|null}], at}
```

- Website fit: `ok:true` when the site is broken ("No working site, checked twice, 26 and 27 Oct"), none on file ("No website on file") or ticked thin; `ok:null` when not checked or failing once; `ok:false` when it works. The other six: `ok:null` with what they wait on.
- `capture_old`: the newest capture is more than 7 days old. `no_price`: the list is blank and prep has no opening price, the offer is locked with a blank list, or the stored opening price no longer passes the price rules.
- `thisMonth`: the first offer in written order that fits and waits on nothing, only when the gate passes. Otherwise `thisMonthWhy` says "Not this month: <first reason>" or "No offer fits yet: <why>."

### Pitches

`cockpit_upsell_pitches(id, request_id unique, task_id, offer_key → catalog, pitched_on, csm_email, mode proactive|client_asked, client_words, client_asked_on, gate, list_price, opening_price, opening_reason, held_full, final_price, final_reason, split, answer yes_paid|yes_unpaid|not_now|no, follow_up_on, no_reason, payment_link, lang, video_code ^[a-hj-km-np-z2-9]{10}$ unique, revision, created_at, updated_at, updated_by)`.

| function | does |
|---|---|
| `cockpit_upsell_pitch_save(p_task_id, p_offer, p_request_id uuid, p_patch jsonb, p_base_revision int)` | The first save (revision 0 or null) creates the row and stamps the gate (`{ok, checkedAt, reasons:[{key, text}], win}`), the list price, the opening price (prep's, else the list when fully set), the reason, the payment link, the language (prep's, else en), the mode and the client's words. It never refuses for the gate. Patch keys `held_full`, `final_price` (every part), `final_reason`, `split`, `answer`, `follow_up_on`, `no_reason`. Rules: a final price below the opening needs held full price and a reason; a locked offer's final price is its list; the split needs `split_allowed` and held full price; not now needs a follow-up date within 120 days; no needs a reason. The mode is the deck's: `client_asked` only when the gate has a reason for this offer and prep's ask still counts. Returns the row, `videoUrl` and `changed`. Audited `upsellPitch.create` / `upsellPitch.save` with lines like "Website offered to Acme Interiors; Opening price 1,800 + 200 below list 2,000 + 200: Second site for them" ("(they asked)" or "(gate not passed)" after the client when so) and "Held full price; Final price 1,500 + 200 below opening 1,800 + 200: Cash flow this month". |
| `cockpit_upsell_pitches_read(p_task_id)` | `{rows}` newest first. |
| `cockpit_upsell_pitch_log(p_month date)` | `{month:'YYYY-MM', rows:[{id, taskId, clientName, offerKey, pitchedOn, csm, mode, listPrice, openingPrice, openingReason, finalPrice, finalReason, answer, followUpOn}]}`: every client for the CEO, a CSM's own clients (`cockpit_client_allowed`). |
| `cockpit_upsell_pitch_video(p_id uuid)` | `{url, counted, note?}`. With no offer video in the pitch's language (or `any`): `{url: null, counted: false, note: "No Arabic video saved for this offer yet. The CEO adds it on Money > Offers."}`, whatever `door_live` says, because the door would only answer unknown. With one: `https://offer.maharamedia.com/v/<code>` with `counted:true` when `door_live`, else the video's own link with `counted:false`. |

Video codes and proposal codes come from `cockpit_upsell_code(n)`: `gen_random_uuid()` bytes (version and variant bytes skipped, bytes ≥248 skipped so each of the 31 characters is equally likely).

## 3. Proposals, views and the door (w)

### Tables

`cockpit_upsell_proposals`: as the contract, plus these constraints:
- `content` passes `cockpit_upsell_proposal_content_ok(content, offer_key)` (ProposalContent v1, below) and is ≤64 KB.
- `price` passes `cockpit_upsell_price_ok` (`{parts:{partKey: dollars}, split: boolean}`).
- Sent once means sent for good: `sent_at`, `code`, `sent_content`, `sent_price`, `sent_lang` and `sent_by` are all set or all null. A draft is never sent; accepted and not now need a send; not now needs the objection and the follow-up date; the preview hash and its expiry go together.

`cockpit_upsell_views(id identity, proposal_id or pitch_id (exactly one), kind open|play|cta|video (video for pitches only), at, device, ip_hash, device_kind)`. A device id, hashed address or device kind not in its shape is stored as null, never refused.

`cockpit_upsell_door_status(route p|event|v PK, last_ok_at, last_error_at, sentence ≤200)`.

### ProposalContent v1 (checked by the database)

```
{ "v": 1,
  "logo": {"on": boolean, "adId": uuid|null},
  "video": {"kind": "default"} | {"kind": "custom", "url": <passes cockpit_csm_deck_video_parse>, "posterUrl": <a deck poster host>|null, "title": ≤40|null, "checkedAt": ISO time},
  "found": [{"fileId": uuid, "caption": ≤120}] (≤3, unique),
  "why": {"trigger": key|null, "text": ≤400, "edited": boolean},
  "get": [{"key", "text": ≤200, "hidden": boolean, "edited": boolean}] (≤8, unique keys),
  "platforms": ["instagram", …] for smm (Instagram always in) | null for every other offer,
  "steps": {"text": ≤400, "edited": boolean},
  "button": {"text": ≤40, "edited": boolean},
  "showCsm": boolean }
```

No other key (so a draft can never carry its own `frozen`). Typed text refuses control and direction characters (new lines pass). On save the server also checks that each `fileId` is a ready capture of this client, `adId` a ready logo of this client, every `get` key and the `why` trigger are the offer's.

### The freeze

Send and update link store `sent_content = content || {frozen}`, where `frozen` holds what the page shows from the catalog at that moment: `title` (copy deckTitle), `parts` ([{key, label, cadence}] in catalog order), `terms`, `timing`, `validUntil`, `work`, `split` (the catalog's split when split is allowed), `video` (the resolved video: `{provider, embedUrl, posterUrl, title}` or null), `csmFirstName` (the sender's), `cta`, and `found` ([{fileId, path, caption, capturedOn, searchedAs}], each caption the typed one else the file's own, exactly as the send checked them). The door builds the page from `sent_content`, `sent_price` and `sent_lang` only, so a later list change, copy change, caption change or draft edit never alters a sent page; the live capture row only drops a capture removed since. Two things stay live: the WhatsApp number in the button (contact, not content) and the logo (the client's own picture with no words; a frozen path could name a verified logo since replaced or a file since removed, so the page shows the client's current logo or none).

### PublicProposal: `cockpit_upsell_public_json(p_row, p_content, p_price)` (internal, the only builder)

- `frozen` from `p_content` when present (the door), else worked out live (the preview and the parity test).
- `title`, `investment.terms`, `timing`, `work`: from `frozen`.
- `logo`: when `logo.on`: `adId` gives `{bucket:'cockpit-launch-ads', path, alt: client name}` for a ready logo of this client, null gives the latest verified logo `{bucket:'cockpit-client-logos', path, alt}`; null when off or missing.
- `csmFirstName`: `frozen.csmFirstName` when `showCsm`, else null. The first name is the seat's own name (never an address), else the team list's, capitalised when all lower case.
- `date`: the send day (`sent_at`, as a Kuwait day), or today for a draft. `validUntil`: the frozen send date for the sent page, the editable date for draft previews. Saving a draft date cannot close, reopen or change the sent page. Update link replaces the snapshot after validation.
- `video`: `frozen.video` (never the provider page `url`).
- `found`: each `fileId` that is still a ready capture of this client: `{bucket:'cockpit-upsell-files', path, caption (the typed one, else the file's), capturedOn, searchedAs}`. Sent: caption, day and search come from `frozen.found`. A draft: worked out live (`cockpit_upsell_found_live`).
- `why`, `steps`: the typed text, null when blank. `get`: the texts of lines not hidden and not blank.
- `investment.parts`: `[{label, amountUsd, cadence}]` for the parts that have a price. `investment.split`: `frozen.split` only when `price.split` is true.
- `button`: `{text, whatsapp}`; `whatsapp` is `https://wa.me/<digits>` plus `?text=<cta>` when the CTA is set, or null without a number. The CTA is percent-encoded per RFC 3986 (every byte except `A-Z a-z 0-9 - . _ ~`). In TypeScript that is `encodeURIComponent(s).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase())`.
- Never: the list price, the price reason, ids, emails, the task id as a key, warnings, views, the code or the revision (a recursive key scan in the test).

### Browser functions

| function | does |
|---|---|
| `cockpit_upsell_proposal_create(p_task_id, p_offer, p_lang, p_request_id uuid) → {proposal, warnings}` | Prefills from the catalog copy in that language: the first `why`, every `get` line shown, the steps joined, the button, the default video, the verified logo on when there is one, `showCsm` true, `valid_until = today + valid_days`, the price set to the list where it is set. Warnings are the gate's failing reasons and never stop a draft. The same request id returns the same draft (another seat or client gets 42501). Audited `upsellProposal.create`. |
| `cockpit_upsell_proposal_save(p_id uuid, p_patch jsonb, p_base_revision int)` | Patch keys `content`, `lang`, `price`, `price_reason`, `valid_until` (within a year; 'Pick a "Valid until" date within a year.'). Drafts always save; the copy problems of typed lines come back in `problems` and never stop a save. A language switch on its own (`lang` without `content`) swaps every line that is still the old language's catalog text for the new language's text for the same key (`why` by its trigger, each `get` line by its key, the joined steps, the button; `cockpit_upsell_content_relang`); typed lines stay as typed. A save after sending sets `updated_after_send`. Archived proposals refuse. |
| `cockpit_upsell_proposal_send(p_id uuid, p_base_revision int, p_via text, p_ack text[]) → {code, url, status, revision, problems}` | `p_via` must be `copy`. Refuses with 22023, the first problem as the message and every blocking problem as JSON in the error's DETAIL (`[{field, rule, text, block}]`), in this order: no video in that language; per shown line, a catalog line still in the other language (`wrong_language`: "What you get, line 1: still in English. Write it in Arabic.") and any blocking copy problem on a typed line (labelled as the page labels it: Why this, for you; What you get, line N; How it runs; The button; What we found, picture N); an unpriced part ("Type a price for the website care plan."); below list with no reason ("Website build: below the list price (2,000). Add a one-line reason."); a locked price off its list (or a blank locked list); a split without split allowed or without full price held ("The split shows only after full price was held: on a call, or in a proposal sent at full price, in the last 60 days."); a past date ('"Valid until" has passed. Pick a new date.'); nothing shown under What you get; no button words; a gate warning not in `p_ack`. A recent offer of this same offer (its pitch or this proposal) is not a warning. On success: the freeze, the code (once), status `link_copied` (accepted and not now keep their status), `warnings_passed` = the ticked current warnings, and the non-blocking problems (mentions) in `problems`. `p_via` other than `copy`: '"Copy link" is the only way to send for now.' Audited `upsellProposal.send` with a plain sentence for the CEO card: "Proposal for Website sent at 1,800 + 200 (list 2,000 + 200): Second site for them, warnings ticked: no win in 30 days, happiness not confirmed in 14 days". The ticked warnings are in words, in the gate's order (not active, live 30 days or less, no win in 30 days, not happy, happiness not confirmed in 14 days, at red, pause needed, raised on the last call, offered in the last 30 days, near renewal), and a list that is still blank reads "(no list price yet)", never "(list blank + blank)". |
| `cockpit_upsell_proposal_update_link(p_id, p_base_revision, p_ack)` | The same checks and a new freeze on the same code; clears `updated_after_send`. Needs a code ("Copy the link once first."). Audited `upsellProposal.updateLink`. |
| `cockpit_upsell_proposal_mark(p_id, p_status, p_objection, p_follow_up_on, p_base_revision)` | `accepted`, `not_now` (objection and a follow-up date in 120 days) or `archived`. Accepted and not now need the link sent first. Audited `upsellProposal.mark`. |
| `cockpit_upsell_proposals_read(p_task_id) → {rows:[{id, offerKey, lang, status, opened, expired, updatedAfterSend, sentAt, validUntil, objection, followUpOn, code, revision, updatedAt}]}` | `opened` is null for a draft, else `{devices, visits, lastAt, played, pressedYes, known}`; `known` is false when the door's `p` route has never reported working, or failed after the send ("Opens unknown"). `expired` is worked out: sent or link copied, and past its frozen date. The card's `validUntil` is that same frozen date, while the full builder row keeps the editable draft date. `objection` and `followUpOn` are a "not now" answer's (null otherwise), so the card can say "Not now: After Ramadan, follow up 12 Nov" without opening the proposal. |
| `cockpit_upsell_proposal_get(p_id)` | The full row (with `url`, `sentContent`, `sentPrice` and the rest), plus `listNow`, `warnings`, `heldFull`, `videoReady` and `problems`. |
| `cockpit_upsell_proposal_public(p_id, p_content DEFAULT NULL, p_price DEFAULT NULL)` | PublicProposal for the draft as typed (the builder may pass its unsaved content and price, checked for shape). |
| `cockpit_upsell_proposal_preview(p_id) → {url, until}` | A random 24-character token; only its sha256 is stored, for 30 minutes. `https://offer.maharamedia.com/<code>?pv=<token>`. Needs a code ("Copy the link once, then open the live page."). Not an edit: the revision stays. |

**What counts as a typed line.** The server decides, never the browser's `edited` flag: a shown line is checked whenever its trimmed text is not the catalog's own text for the same key in the proposal's language (`why` against the reason its `trigger` names, each shown `get` line against its key, `steps` against the catalog's steps joined as a new proposal joins them, the button against the catalog's button). Catalog lines are not checked again, as the contract asks; a line sent as `edited:false` with other words ("We guarantee 10 new projects") is checked like any typed line and refused at send. A shown line that is the other language's catalog text for the same key (and not this language's) is a blocking `wrong_language` problem, on save as a problem and at send as a refusal, so a page never goes out with Arabic chrome around English lines. What we found is always checked: each shown capture's caption (the typed one, else the file's own) and what it was searched as (`found.N`, `found.N.searchedAs`), and a custom video's title.

### Door functions (service_role only)

| function | does |
|---|---|
| `cockpit_upsell_door_open(p_code, p_device, p_ip_hash, p_device_kind, p_preview) → {state, proposal, contact:{whatsapp}}` | `unknown` for a bad or unknown code or a draft, `archived`, `expired` (past its frozen date, unless the live preview token is given), else `open` with the frozen PublicProposal. Counts an `open` unless the preview token matches and is unexpired. Deletes this proposal's views older than 90 days. |
| `cockpit_upsell_door_event(p_code, p_kind, p_device, p_ip_hash, p_device_kind) → void` | `play` or `cta` (22023 otherwise). An unknown, unsent or archived code is ignored. |
| `cockpit_upsell_door_video(p_code, p_device, p_ip_hash, p_device_kind) → {state, url}` | The pitch by its 10-character code: the offer's video link in the pitch's language and one counted `video` view; `unknown` with no url otherwise. Deletes that pitch's views older than 90 days. |
| `cockpit_upsell_door_status_set(p_route, p_ok, p_sentence) → void` | Writes when the route's state changes, or at most once a minute while it holds. A failure keeps its sentence (≤200). |

## For the builders after me

- **edge.** Upload chain: `cockpit_upsell_file_reserve`, sign, upload, `cockpit_upsell_file_accept`, all as the user. The list sweep reads `cockpit_upsell_files_stale(taskId)` as the user, deletes the bytes with the service key, then calls `cockpit_upsell_file_purged(taskId, ids)` with the service key (it is service_role only). Record site checks with `cockpit_client_site_check_record` as the user; the `refused` status means the check was not made and counts for neither verdict. The door calls the four door functions with the service key; `door_open`'s `*.path` values are for signing.
- **content.** Migration x must pass `cockpit_upsell_catalog_copy` (the shape table above). Keep the joined steps under 400 characters. `cockpit_client_copy_problems` is callable by the service key and every seat; Investment lines use `p_money_ok = true`. Since 26 Oct it also blocks a discount in English or Arabic (`discount`), our own words (`internal_word`: CSM, ad spend, a list or original price) and a spaced en dash used as a dash (`em_dash`), and lets وليد and "إضاءة ليد" through. The client copy says "your account manager", never CSM. The catalog's own lines are not re-checked at send, so x's test should run every catalog line through it.
- **deck.** `OFFER_PREP_KEYS` is the comment line in v. `cockpit_csm_offer_sources` adds `goals`, `fx.note`, `project.sheet.withValue`, and the site verdict adds `firstFailAt` and `lastFailAt`. Offer videos are saved with `cockpit_csm_deck_video_save('offer_website','demo',lang,…)` by the CEO; `cockpit_upsell_catalog_read().videos` carries their revisions.
- **proposal.** `publicProposal.ts` must follow the PublicProposal rules above exactly, including the `frozen` fallback and the RFC 3986 encoding of the CTA. `cockpit_upsell_proposal_public(id, content, price)` is the server side of the parity test. Switch the language with a `lang`-only save and use the content it returns (the catalog lines come back in the new language); a `wrong_language` problem names a line left behind. The server's labels match the page's: Why this, for you; What you get; How it runs; Valid until; "Copy link". `proposals_read` rows carry `objection` and `followUpOn` for the card's "Not now" line.

## Open points for the CEO

- **The renewal window and launch + 90.** With no renewal plan on file (0 rows today), the renewal is launch + 90, and offers pause from day 60. A client is then open for an offer from day 31 to day 59, and again after day 120. The contract's `full` fixture (Active 64 days) sits inside that pause. Recording renewal plans with their real dates, or a different default, would change this.
- **What the last call raises (kept as the contract has it).** `raised_on_last_call` refuses on a sentence matching ESCALATION, PROBLEM or MONEY_WORDS from `clientBrief.ts`, as the contract and the plan ("No escalation or problem in the last call's takeaways") ask. In `clientBrief.ts` PROBLEM only marks a follow-up. The 26 Oct review's read-only check of live data (not repeated here) found that 6 of the 7 Active clients whose last held call has a summary would be refused, each on a generic PROBLEM word (مشكلة, مشكلات, issues, سيئة). Left as written; the decision is the CEO's. The suggested change: refuse only on ESCALATION and MONEY_WORDS, and show a PROBLEM match as a non-blocking passed note ('Mentioned on the last call, 20 Oct: "..."') so the CSM still sees it.
- **The service key writes directly when it must.** The service key has SELECT, INSERT and UPDATE on every new table (as the contract asks) and EXECUTE on every CHECK helper those tables call, so a direct write passes the same checks and leaves the same audit row (the proposals test proves an update). Browser writes still go only through the functions.

## The test harness

`upsellTestDb({through?: 'base'|'u'|'v'|'w'|'x', twice?: boolean})` builds an isolated PostgreSQL with Supabase's default privileges on:

- the real client gate (20261006c), seat rule (20260927a), roster tables (20260927v), `cockpit_client_allowed` and `cockpit_csm_actor` (20260926m), name key (20261012c), `cockpit_pay_usd_per` (20261018a), the read models (20260927s/w/x) and the verified logos table (20261003a);
- cut-down stand-ins with the live column names (checked 26 Oct): `cockpit_campaigns`, `cockpit_ads`, `cockpit_media_daily_stats`, `ghl_clients`, `editor_clients`, `cockpit_client_onboarding`, `cockpit_csm_calls` (with `summary`), `cockpit_csm_client_overrides`, `cockpit_csm_renewal_plans`, `cockpit_client_days`, `cockpit_people` and the dialer's caller rows; a storage schema with row security on `storage.objects`;
- the seven deck files in production's order (20261019120000, 20261020090000, 20261020120000, 20261020160000, 20261020160100, 20261020160200, 20261020160300). The harness's five replaced bodies have exactly the live md5s;
- then u, v, w and x (when the file exists), each applied twice unless `twice: false`. The default `through` is x when it exists, else w.

Fixtures start from the Kuwait day (`KW_TODAY`, exported). Nine seats (`SEATS`, `EMAILS`), three invented clients (`TASKS`: Acme Interiors passes the gate as seeded; Beta Build is Saudi, done with you, with no win; Cedar Homes is stopped, in Bahrain). `upsellHelpers(db)` gives `one`, `rows`, `failure` (with the error's code, message and detail), `svc` (as the service key), `owner`, `audits`, `putObject` and `capture` (a ready capture through reserve, the object and accept). `setClient(db, 'A', patch, launchDaysAgo)` changes a roster row in place.

## Continuation checks, 26 October

`upsell-proposals-supabase.test.ts` now covers draft validity edits that must not alter or reopen a sent page, draft preview parity, and Update link replacing the date. `upsell-monitor-supabase.test.ts` covers all three receipt ledgers, NULL-safe oEmbed handling, unchanged non-provider checks, owner-only base grants, an untouched service-role wrapper, repeated application and body/ACL drift guards. These added tests are queued for the coordinated VPS run; their results must be recorded before ship.


## All seven presentations, 27 October 2026

`20261027115820_offer_presentations_readiness.sql` is an additive follow-up, not a rewrite of the deployed pilot migrations. It refuses replacement-function body or grant drift, supports a repeat application and creates no table or public RPC. `cockpit_upsell_offer_readiness(text,text)` is a private helper; the existing scoped source/status RPCs call it.

- `cockpit_csm_offer_sources` adds `ready: {ok, missing}` and `waitsOn: string|null`, matching the picker. Fresh captures are required for Website and Google/AI search only. Price/payment requirements and the actual client eligibility gate are unchanged. No automated fit is invented for the other six offers.
- Closer prep adds `recruiter_name`, a trimmed private name of 3–120 characters. It is accepted only for Closer placement and remains in the existing scoped prep/audit record. Missing names produce `no_recruiter`. Starting a presentation stamp, creating a pitch or sending/updating a proposal link requires the name on the server, including client-asked mode. Existing pitch records remain editable. Preparation and draft previews remain available. The exact seeded recruiter hold resolves per client after a name is supplied; a different CEO-entered hold is preserved.
- Manual SEO/SMM fulfilment and cameraman-location holds remain visible without creating new eligibility rules. SEO/GEO stays locked, and no reference hint becomes a price. Only the exact obsolete second-campaign pilot note and the UGC missing-examples note are cleared by the migration.
- UGC `copy.en/ar.work[]` gets three user-authorized, ready Wistia examples: Khalda `qlwysqfu2g`, Castello `btp2dokvjr`, and AlKhalil `nix1oq0h3a`. The migration validates providers/copy and refuses to replace a different existing work list. Only those two work arrays change; other catalog copy and CEO settings stay intact. Each actual change increments its revision and leaves an audit row.
- The existing proposal snapshot freezes these samples' labels and URLs on Send/Update link. Existing sent proposals are not changed. Public `work: [{label,url}]` and ProposalContent v1 remain the same; frontend rendering decides whether an allowlisted sample is an inline player. The recruiter name never joins the public allowlist.

Verification is the named isolated PGlite file `apps/media-buyer-cockpit/scripts/offer-presentations-supabase.test.ts`, plus the existing gate/proposal/public/schema parity suites. All fixture records are fictional, and tests call no provider.
