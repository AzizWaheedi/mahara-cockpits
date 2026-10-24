# Launch desk: the launch and relaunch mechanics (map)

Branch `launch-desk-1024`, worktree `deck-answers-1020`, read on 2026-10-24 at about 13:00 Kuwait.
Reads only: Supabase SELECTs (sq.py), ClickUp GETs, one Composio Meta GET (refused: the Composio Facebook connection has no ads permission, so every Meta fact below comes from the Meta mirror tables the native workers fill, `cockpit_meta_*`, fetched today at 12:07 Kuwait). Nothing was written anywhere.

---

## 0. The answer on one screen

- **Why ARCWANI and Liwan vanished.** The Ads section and every client write in the cockpit hang off `cockpit_campaigns`. The native publish keeps a campaign there only while it spent $0.50 or more in the last 7 days (`hermes/cockpit-sync/calculator.ts:2614`, `if (a.spend < 0.5) continue`). Both accounts owe Meta (account_status 3 since about 17 Oct), nothing spends, so all three of their campaign rows are `source_deleted`. With no live row, `cockpit_media_scope` raises "Campaign is missing or ambiguous" and `cockpit_build_scope` raises "The client ad account is missing or ambiguous". **Their cards were not removed** (Liwan's two Ads Management cards are still open and say Live; ARCWANI's is marked complete). The scope is what disappeared.
- **No write path today can start or restart a client from its ad account.** Every client write is keyed by a campaign name in `cockpit_campaigns` (media API) or by a client tag with a live campaign row (client build). Nothing is keyed by client plus ad account.
- **ARCWANI and Liwan cannot be relaunched as they are, even after a payment.** Both accounts are compromised: people outside Mahara made campaigns there, some under Mahara's own naming. Liwan has about $7,260 a day switched on and waiting, every dollar of it made by an outsider ("Jonathan Rbn"; one campaign is named `Liwan |MAHARA|10\9`). ARCWANI has about $1,074 a day of outsiders' budgets waiting next to Mahara's own $35 campaign. Meta refuses every change on a status-3 account, pausing included, so all of it goes live the minute the client pays. The CEO's own open task for ARCWANI is "Create clean ad account" (new business portfolio, then relaunch).
- **The smallest solid flow** is one account-scoped path in `cockpit-media-api` (a new `cockpit_media_account_scope` RPC and a `cockpit_launches` record), a readiness read that names every blocker in a plain sentence, and three plans, all PAUSED-first with a separate Switch on press:
  1. **Switch back on**: a paused campaign Mahara made, on a healthy account.
  2. **Copy the best past campaign**: a new paused campaign, its ad sets and its ads rebuilt from the best Mahara campaign on the same account. Onto a new clean account it becomes a rebuild with re-uploaded media and the Page's same lead form.
  3. **New client**: from the Brand Blueprint part 1 answers and the kickoff (account, Page, service, budget, destination), the starter pack or the client's Drive files, a lead form from a template, the same paused build.
- **"Live" means spending, not switched on.** SAFAD's campaign is switched on with five active ads on a healthy account and has spent nothing since 16 Oct. The desk hands a client to the Ads section on its first impressions (the next 15-minute native publish then lists it), and raises an alarm when a switched-on launch has no impressions after 24 hours.

---

## 1. What it takes to go live (the inputs)

| Input | Where it comes from today | Relaunch | New client | State now |
|---|---|---|---|---|
| Client | `cockpit_board_clients` (ClickUp "Clients - Mahara" 901816559981): status, registry_status, card_stage, service_mode, location_id, clickup_id | yes | yes | Active 19, Launching 8, Paused 1 (AIVE), Stopped 3, Ghosting 2, Cancelled 34 |
| Ad account | `cockpit_board_clients.ad_account_ids` and `ad_account_ties` (matched by `ghl_client_ad_accounts` or `clients.ghl_location_id`) | the tied account | kickoff field "ad account name" (`e4b9dbd3`), resolved to an id against the accounts Mahara can see | 17 of 19 Active have one; **0 of 8 Launching** have a visible one (Qatar Technology's tie points at an account Mahara cannot see) |
| Account health | `cockpit_meta_account_state` (status, disable_reason, currency, is_prepay) | must be 1 | must be 1 | 17 healthy (1), 5 unsettled (3: Alkhalil, ARCWANI, Joe and Sera, Liwan, Marble and more), 1 disabled (2), 1 in grace (9, Castello), 2 closed (101) |
| Funding | Meta `funding_source_details`, `balance`, `spend_cap` (not mirrored) | read before Switch on | read before Switch on | SAFAD: status 1, switched on, 0 impressions since 16 Oct, cause not readable from the mirror |
| Currency | `cockpit_meta_account_state.currency`; writes go through `currency.ts` (`usdToBudget`, refuse anything but USD/SAR/QAR/AED) | yes | yes | 21 USD, 6 SAR among visible accounts (Ardon, Shades, Pidco, one unheld) |
| Page (publishing identity) | past creatives' `object_story_spec.page_id`; Blueprint 1.8 `identity` (their Page or ours); kickoff Page name (`940f494c`) | from the source ads | needs a Page id and a Page token (`funnel.ts pages()`) | Sept note: the system user was not an Advertiser on Liwan's and Safad's Pages; not re-checked (no Meta token here) |
| Destination | lead form (`call_to_action.value.lead_gen_form_id`), landing page (page forms), WhatsApp | the source ads keep theirs | Blueprint 1.7: `lead_form` or `landing_page` only | lead form create (`forms.publish`) is built and checked with Meta but has never run live |
| Audience | source ad set `targeting` (`cleanTargeting`), Advertising Cities on the card, `audiences.ts` plans | copied | geo + age from the card's cities or the kickoff area | `audiences.ts` uses nine sub-trades, not the five main services; interests are names, not Meta ids |
| Creatives | the client's past ads (creative ids), the starter pack (Blueprint settings `pack.<service>`), the client's Drive (`assist.run` kind `creative` imports into the account), winners (`cockpit.winners`) | creative ids reused on the same account | pack or Drive, imported into the account first | **no starter pack is set for any service** (settings hold only `close_route`); 0 Blueprints saved |
| Copy | the source ads' text; `writeCopy` (Mahara's own prompt) or the client build prompt (`cockpit-creative-api/build.ts`) | reused | client build prompt with the brief, red lines and do's and don'ts | the client build path has 0 drafts ever (`cockpit_campaign_drafts` empty) |
| Budget | card "Daily Ad Spend" (contracted, Ads Management), kickoff daily budget (`handover.daily_budget`), Blueprint 1.6 | typed dollars, converted | typed dollars, converted | Liwan card $30, ARCWANI card $25 |
| Brief | Blueprint part 1 "Send to media" creates `{card} - New Client Campaign Launch 🚀` on 901816723196 with the brief (SPEC 3.3) | n/a | yes | all 45 launch tasks on the list are status "complete"; the native `onboardings` feed holds 0 rows |
| Call centre | DFY: an assigned caller (`mahara_console.metadata` `access:agent:*` with the client's GHL location); DWY: the client's own team | must exist | must exist | every Active DFY client has a caller; **none of the 8 Launching clients has one** |
| Lead flow to the CRM | `cockpit_lead_sync_status` (hermes/lead-sync-watch, reads only clients in `cockpit_campaigns`) | resumes once the client is back in `cockpit_campaigns` | unknown until the first lead | paused clients drop out of the watch with their campaign rows |
| Ads board card | Ads Management 901817774521; the native publish joins campaigns to cards by name, then by client tag (closed cards included) | existing card (by name or tag) | a new card, tagged with the client | `board.addToBoard` only works for a campaign already spending off the board |

---

## 2. What the system can already do

### 2.1 On client accounts (cockpit-media-api, scope `cockpit_media_scope(operation, campaignName)`)

Every one needs one live `cockpit_campaigns` row with that exact campaign name.

| Operation | Does | Notes |
|---|---|---|
| `control.setStatus` | campaign, ad set or ad ACTIVE/PAUSED, read back | used 5 times; this is the only "switch on" |
| `edit.setAdSetBudget` | daily budget at the level that holds it, typed dollars to account minor units | refuses lifetime budgets |
| `edit.duplicateAdSet` | a PAUSED copy of an ad set inside the same campaign (targeting cleaned, promoted object, destination, attribution, bid) | no ads; no new campaign |
| `edit.newAdsFromExisting` | PAUSED ads cloned by creative id, or new copy on the source spec | keeps Page, CTA and lead form |
| `edit.addCreativeToCampaign` | a new PAUSED ad from an HTTPS video or image URL, or an uploaded id/hash, on the source ad's spec | Drive links refused here (the native worker imports them); 7 confirmed, 3 in reconcile |
| `forms.publish`, `forms.switch`, `funnel.read` | new lead form on the Page (Page token), new creatives, swap per ad; check with Meta first | first live form create never done |
| `execute.runAction` | pause, raise at most 25%, cut the worst ad | |
| `board.addToBoard` | an Ads Management card for an off-board campaign | the campaign must be in the off-board feed, which needs spend |
| `board.setAdStatus`, `setAdvertisingCities`, `renameCard` | card fields | |

### 2.2 The client build (cockpit-creative-api `requestBuild`/`launchBuild`, scope `cockpit_build_scope(clientTag)`)

- Builds AI copy from the brief, the client's do's and don'ts and the settings of the client's cheapest live ad set.
- Launch creates a PAUSED campaign (`{client} |MAHARA|{YYYY-MM-DD}`, OUTCOME_LEADS) and a PAUSED ad set. **No ads**: the note says "Attach the creative files in Ads Manager before turning it on."
- Refuses unless `account_status` is 1, with the words "The client ad account is not available for this launch".
- Refuses any account not in USD and writes `dailyBudget*100`, so it bypasses the currency rule (Ardon and Shades, both SAR, are refused).
- Needs a live campaign row for the client tag, so it cannot start a client with nothing running.
- Never used: 0 drafts.

### 2.3 On Mahara's own account only (founder seat, account 746108264865897)

- `ceo.b2bLaunch.list/build/save/discard/launch`: drafts in `cockpit_ad_drafts`, settings from the best ad set of the same kind over 90 days, copy variants, then campaign, ad set and ads PAUSED in one multi-step plan with an atomic draft claim. **This is the most complete launch in the codebase.**
- `ceo.b2bManage.*`: rename, budget, schedule, audience, createAdset, duplicateAdset (with its ads), createAds.

### 2.4 The shared machinery every new path should reuse

- `index.ts`: preview by default; `apply:true` needs a UUID; an intent row in `cockpit_media_actions` before any provider write; the scope re-read before every non-GET (`health` hook); receipts in `cockpit_media_provider_health`; `cockpit_finish_media_action` finalises and writes `cockpit_audit_log`; a failed multi-step plan stops and lands in `reconcile`.
- `execute.ts executePlan`: `$stepN.id` references, read-back of every created object, preconditions, guards.
- `currency.ts`, `core.ts accountCurrency`: dollars in, minor units out, refuse unknown currencies.
- `metaCreative.ts`: `copyableSpec`, `setCopy`, `destinationLink`, `explainMeta`.
- `b2b.ts cleanTargeting`: the explore and reels placement fix.
- `funnel.ts pages()`, `withForm`, `leadForm.ts`: Page tokens and lead forms.
- hermes/media-native `assist.run` kind `creative`: Drive file or folder into the account's library as image hashes and video ids, resumable.
- hermes/ad-billing-guard: account status every 5 minutes, recovery after two healthy reads 4 minutes apart.
- `clickup-writeback`: change comments on the ads card and the CSM card.

---

## 3. The guardrails, each as the sentence the desk shows

| Check | Source | Sentence (refuse before any intent row) |
|---|---|---|
| Status 3, unsettled | `cockpit_meta_account_state`, re-read from Meta in the plan | "This ad account owes Meta a payment. Meta refuses every change on it, pausing included, until the client pays in Ads Manager." |
| Status 2, disabled | same, plus disable_reason | "Meta has disabled this ad account. Nothing can run on it until the client's appeal is accepted." |
| Status 101 or 100, closed | same | "This ad account is closed. Choose another account for this client." |
| Status 9, grace | same | warn, never refuse: "Meta could not charge this account. Ads still run for now; ask the client to fix the payment method." |
| Status 7 or 8, under review | same | warn: "Meta is reviewing a payment on this account." |
| No funding source, or prepay with no balance | Meta GET `funding_source_details,is_prepay_account,balance` | "This account has no way to pay. Ask the client to add a card in Ads Manager." |
| Compromised | `cockpit_csm_meta_activities` (creator of each object) and `cockpit_excluded_ads` | "People outside Mahara made campaigns on this account ({names}) and {n} of them are switched on. Relaunching here would let them run too. Move the client to a clean ad account first." |
| Budgets waiting to go live | `cockpit_meta_budgets`, `effective_status = 'ACTIVE'` at the level that holds the budget (not `switched_on`, which ignores a paused parent) | "${amount} a day is switched on here and goes live the moment the client pays: {list}." |
| Currency | `accountCurrency` | "This ad account is in {cur}. Change the budget in Ads Manager." (KWD and other currencies) |
| Budget size | the card's Daily Ad Spend, then the kickoff daily budget | default to the contracted amount; refuse a media buyer seat above 2x contracted (founder may) |
| PAUSED first | every create body | campaign, ad sets and ads created PAUSED; Switch on is a second press with its own preview |
| Page access | `pages()` token read | "Meta will not let us advertise for the Page '{name}'. Ask the client to give MaharaMedia's business the Advertiser role on it." |
| Call centre (DFY) | `access:agent:*` locationIds | "No caller is assigned to {client} yet, so we cannot call new enquiries within 5 minutes. Assign one in the dialer first." |
| Call centre (DWY) | service_mode | no caller needed; the brief says their own team calls |
| Rehearsal on an unsettled account | Meta `validate_only` also refuses on status 3 (#2490592, seen on Mahara's own account) | "Meta cannot check this plan until the account is paid. This is the plan only." |

Today a refused write on an unsettled client account surfaces raw: `meta rejected the request (400 code 200/4841021): The ad account status is not eligible for write operations`. `explainMeta` maps 2490592 but not 4841021, and the general media actions never call it. No client write pre-checks the account status except the unused client build.

---

## 4. The relaunch candidates, as the data stands

| Client | Account | Status | Live campaign rows | Best Mahara campaign (Meta mirror, last 120 days) | Blocker |
|---|---|---|---|---|---|
| ARCWANI | 1034584029438250 (USD) | 3 | 0 of 1 | `ARCWANI-MAHARA-29\8`, made by Saleh, 71 leads at $14.19, still switched on at $35 a day | unsettled; compromised (two outsiders, $1,074 a day of theirs waiting); CEO task "Create clean ad account" (new portfolio, Mahara's portfolio had hit its account limit on 17 Oct; 24 accounts were removed on 23 Oct, so re-check) |
| Liwan | 1938709086836136 (USD) | 3 | 0 of 2 | `Liwan |MAHARA|13\7` (42 leads, $26.93) or `21\9` (12 leads, $34.22), both paused; all above the $15 line | unsettled; compromised (outsider "Jonathan Rbn" made $7,260 a day of switched-on budgets, one campaign named `Liwan |MAHARA|10\9`; three campaigns share that name) |
| SAFAD | 774492648699300 (USD) | 1 | 0 of 1 | `Safad | MAHARA | 16-8`, 148 leads at $9.16, switched on, 5 active ads | no impressions since 16 Oct with nothing paused: read funding and ad review before calling it live; outsiders' two ads already listed and excluded |
| Joe and Sera | 955658453671990 (USD) | 3 | never had one | `JOE&SERA|MHARA|11\8` switched on, $40 a day waiting | unsettled |
| Alkhalil | 1649852845764859 (USD) | 3 | 1 | | unsettled; a second account 640644143620696 (SAR, unheld by any client) is spending with no card, an Instagram post boost under Alkhalil's projects |
| Professional Touch | none | | | | no ad account tied |
| 8 Launching clients | none visible | | | | no account shared with Mahara, no caller, no Blueprint, no pack |

The launch watch's only row today is that unheld SAR account 640644143620696.

---

## 5. The gaps between "pick any client" and "live"

1. **No account scope.** `cockpit_media_scope` resolves a campaign name; `cockpit_build_scope` needs a live campaign row. Needed: `cockpit_media_account_scope(p_clickup_id, p_account)` that reads the client from `cockpit_board_clients`, requires the account in its `ad_account_ids` (or ties), checks `cockpit_client_allowed`, and returns `{actor, client, clickupId, account, founder}`. Ops then check every Meta object's `account_id` against it, and "is it ours" instead of "is it this campaign".
2. **No "is it ours" test.** Names are not proof (an outsider used `Liwan |MAHARA|10\9`). Use the activity log's creator against Mahara's Meta people (Saleh Attale, Nada Al Saed, Muhammed Burhan, Abdulaziz Waheedi, the system user "Claude", MaharaMedia), kept as a Supabase table, not code, plus `cockpit_excluded_ads`. A campaign with no creator event in the mirror is "unknown", not ours.
3. **Names collide.** Liwan has three campaigns named `Liwan |MAHARA|10\9`. `cockpit_media_scope` refuses ambiguity by name. The new path keys every object by Meta id.
4. **A new campaign has no scope until it spends.** The worker writes it to `cockpit_campaigns` only after $0.50 of spend in 7 days and a board card. So a campaign the cockpit creates paused cannot be switched on from the cockpit. The launch record (`cockpit_launches`, Meta ids taken only from the confirmed receipt) has to be the scope for Switch on and for the first edits.
5. **No card for a campaign that has not spent.** `board.addToBoard` reads the off-board feed, which needs spend. Needed: create the Ads Management card from the launch record (name = campaign name, tag = the client's tag, Ad Status Live at Switch on, Advertising Cities), or reuse the client's existing card. The worker matches by name, then tag, closed cards included.
6. **No whole-campaign copy on client accounts.** Only ad set copies inside a campaign. Needed: campaign PAUSED, then each source ad set (budget at the right level, CBO ad sets carry no budget or bid), then each ad from its creative id. Meta's `POST /{campaign}/copies` (deep copy, `status_option=PAUSED`) is one call but has a limit on synchronous child objects; check it with `validate_only` before choosing it over the hand-built steps, which already have read-backs.
7. **Cross-account rebuild is not possible by id.** Creative ids, video ids and image hashes belong to the old account. Onto a clean account: re-upload media (video `source` URL or the Drive original, image `url`) into the new account, rebuild the story spec on the same Page, and reuse the Page's lead form (forms belong to the Page, not the ad account). Strip custom and lookalike audiences from copied targeting.
8. **No attach-an-account step.** New clients and ARCWANI's clean account need: the client shares the account with business 767701513092162, the account appears in the visible list, then a tie is written (`ghl_client_ad_accounts`, in Supabase, gated and audited). The worker's name resolver (launch watch) can propose the match from the kickoff's account name.
9. **No account names in the account mirror.** `cockpit_meta_account_state` has no name; names come from `cockpit_meta_ad_days` (only accounts that ever spent). Add the name to the state row.
10. **No pre-check of account status or funding** on client writes, and no plain sentence for 4841021 (section 3).
11. **The client build skips the currency rule** and creates no ads (section 2.2).
12. **New-client inputs are empty.** No starter pack in Settings for any of the five services; no Blueprint saved; no Launching client has an account shared or a caller assigned.
13. **Audiences.** `audiences.ts` uses nine sub-trades, against the rule that the five main services are the only service names. For v1 use geo plus age with Advantage+ audience, or the targeting of the client's own past ad set; no interest ids.
14. **Paused clients drop out of the lead sync watch** (it reads `cockpit_campaigns`). It returns by itself once the relaunch spends.
15. **"Switched on" is not "live".** SAFAD shows why. The desk's Live rule: first impressions on the new campaign id in `cockpit_meta_ad_days`, else after 24 hours an alarm with the funding and review reads.
16. **The onboarding feed is empty** (`onboardings` 0 rows; every launch task on 901816723196 is "complete"). The desk's "Ready to launch" list should come from `cockpit_board_clients` (Launching and card_stage) and `cockpit_blueprints.parts.1`, not from open launch tasks alone. Media buyer seats cannot read `cockpit_blueprints` today (gate: creative, CSM, admin, founder); add a read-only part 1 summary for media buyers.

---

## 6. The smallest solid flow (recommended)

### 6.1 Data (one migration, grants and row security in it)

- `cockpit_launches`: id uuid, clickup_id, client_name, account_id, kind (`switch_on`, `copy`, `rebuild`, `new`), source_campaign_id, plan jsonb, state (`draft`, `built`, `switched_on`, `live`, `reconcile`, `discarded`), meta_campaign_id, meta_adset_ids, meta_ad_ids (from confirmed receipts only), card_task_id, created_by, timestamps. Service role writes; seats read their allowed clients through an RPC. One `cockpit_audit_log` row per state change.
- `cockpit_meta_people`: actor name, role (`mahara`, `client`, `outsider`), set by admins; the "is it ours" test reads it.
- `cockpit_media_account_scope(p_clickup_id, p_account)` and `cockpit_launch_scope(p_launch)`, SECURITY DEFINER, same membership and client checks as `cockpit_media_scope`.
- Add `account_name` to `cockpit_meta_account_state` (worker change).

### 6.2 Operations (cockpit-media-api, through the existing intent, receipt and read-back path)

| Operation | Read or write | What it does |
|---|---|---|
| `launch.readiness` | read | One answer per client: account (status sentence, currency, funding, compromise, waiting budgets), Page token, lead form, caller, card, best Mahara campaigns (from `cockpit_meta_ad_days`, ranked by leads at the lowest cost per lead, excluded ads out, outsiders out), Blueprint part 1 if any. Missing is said, never zero. |
| `launch.switchOn` | write | A paused campaign Mahara made: optional budget (typed dollars, contracted default, 2x cap), then ad sets and ads it needs, then the campaign ACTIVE, each read back. Refused on any guard in section 3. |
| `launch.copy` | write | A new PAUSED campaign named `{Client} |MAHARA| {d\m}`, its ad sets and ads rebuilt from the chosen Mahara campaign on the same account (creative ids reused, targeting cleaned, budget at the source's level). Second press: Switch on. |
| `launch.rebuild` | write | The same onto another account of the same client: media re-uploaded, specs rebuilt on the same Page, the Page's lead form reused. |
| `launch.new` | write | From Blueprint part 1 (service, budget, destination, identity, pack) and the kickoff (account, Page): media imported from the pack or Drive by the native worker first (`assist.run` kind `creative`), a lead form from a template if the Page has none (`forms.publish`'s create step), copy from the client build prompt, then the same PAUSED build. |
| `launch.card` | write | Create or reuse the Ads Management card for the launch (name, client tag, Ad Status, cities). |
| `launch.attachAccount` | Supabase write | Tie a visible account to the client after the name match is confirmed by a person. |

Every write op: preview by default (the plan, worded); `apply:true` with a UUID; refuses when any guard fails; on an unsettled account the preview says Meta cannot check it yet; on a healthy account the preview runs `validate_only` on each create body and shows Meta's answer.

### 6.3 From desk to Ads

1. Pick any Active, Paused or Launching client (allowed for the seat).
2. Readiness shows what blocks it, each with who fixes it (client pays, client shares the account or the Page, CSM assigns a caller, creative director sets the pack).
3. Build (switch on, copy, rebuild, new). All PAUSED. Receipt holds the ids.
4. Card made or reused; the change goes to the ads card and the CSM card (clickup-writeback).
5. Switch on, its own press and preview.
6. Waiting for first impressions (shown on the desk). First spend on the new campaign id: the desk marks it Live and links to `/ads?account=`; the next native publish (every 15 minutes) lists it in the Ads section with write scope through `cockpit_campaigns` again. No impressions after 24 hours: an alarm with the funding and review reads.

### 6.4 ARCWANI and Liwan, concretely

- **ARCWANI:** follow the CEO's task. When the clean account is shared with Mahara, attach it, then `launch.rebuild` from `ARCWANI-MAHARA-29\8` (the Page's lead form, its media re-uploaded, $25 card budget by default), then Switch on. The old account stays as it is; the desk shows its waiting budgets as a warning, never as a relaunch target.
- **Liwan:** the desk refuses a relaunch on 1938709086836136 (unsettled and compromised, outsiders' $7,260 a day waiting) and offers the same clean-account route. If the client pays on the old account instead, the ad billing watch sees the recovery; the desk then shows a ready plan that pauses the outsiders' objects first, for a person to press, before any switch on.
- **SAFAD** (healthy account, nothing delivering): readiness reads funding and the ads' review status; if clean, `launch.switchOn` on `Safad | MAHARA | 16-8` is the first real test of the flow.

### 6.5 Tests (fakes only)

- PGlite: the two scope RPCs (membership revoked, client not allowed, account not the client's, launch scope from a confirmed receipt only).
- Plans with a fake provider: PAUSED bodies; budget in SAR minor units; refusals for status 2, 3, 101, KWD, an outsider's campaign, an excluded ad, a 2x budget from a media buyer seat; CBO ad sets without budget; cleaned targeting; cross-account rebuild with no reused creative id; read-back failure stops the plan and leaves `reconcile`; no write retried.
- The readiness wording for each guard.

---

## 7. Left out of v1, and why

- **WhatsApp destination.** The Blueprint offers only lead form and landing page, and the 5-minute call promise runs on form leads through the CRM and the dialer.
- **Interest targeting by name.** Needs Meta interest ids (a search read per name); geo, age and Advantage+ audience, or the client's own past targeting, cover v1.
- **Another client's winners as media.** Their files belong to that client's account and brand; winners stay as copy and angle examples only. The starter pack is Mahara's own and is the media for new clients.
- **Automatic actions on payment.** The desk prepares the plan when the ad billing watch sees a recovery; a person presses it.

---

## 8. Evidence (all reads)

- `cockpit_board_clients`: statuses and accounts per client; ARCWANI and Liwan Active, DFY, one account each.
- `cockpit_campaigns`: ARCWANI `ARCWANI-MAHARA-29\8` deleted (synced 16 Oct), Liwan `10\9` (10 Oct) and `21\9` (18 Oct) deleted, SAFAD `16-8` deleted (23 Oct).
- `cockpit_meta_account_state` fetched 12:07 Kuwait: both accounts status 3, USD.
- `cockpit_meta_budgets` and `cockpit_csm_meta_activities`: the switched-on budgets and who made them.
- `cockpit_meta_ad_days`: the 120-day campaign ranking.
- ClickUp: cards 86eyt006q (complete, Live), 86eywnyvh and z8xmdve863 (to do, Live); task z8xmdvhzuf "Arcwani | Create clean ad account" (pending); every launch task on 901816723196 complete.
- `cockpit_blueprints` 0 rows; `cockpit_blueprint_settings` only `close_route`; `cockpit_campaign_drafts` 0 rows; `cockpit_media_actions` shows buyers use setStatus, budgets and addCreative, never a build.
- Code: `supabase/functions/cockpit-media-api/{index,core,execute,launch,b2b,creative,currency,funnel,metaCreative}.ts`, `supabase/functions/cockpit-creative-api/build.ts`, `supabase/migrations/20260927u_cockpit_media_workflows.sql` (media scope), `20261007c_cockpit_rpc_restore.sql` (build scope), `20261024a_brand_blueprints.sql`, `hermes/cockpit-sync/calculator.ts` (7-day gate, card join, launch watch), `hermes/media-native/runbook.md`, `docs/brand-blueprint/SPEC.md` 1.2 and 3.3, `docs/ad-billing-guard/README.md`.
