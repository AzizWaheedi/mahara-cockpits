# Launch desk: code map of the media buyer cockpit (2026-10-24)

Worktree `/Users/abdulazizwaheedi/mahara-cockpits/.claude/worktrees/deck-answers-1020`, branch `launch-desk-1024` (f0f2dc6c), tree clean.
Everything here was read from code. Live Supabase facts come from read-only `sq.py` selects, and the two ClickUp list names from ClickUp GETs. Nothing was written anywhere.

---

## 0. Headline findings (read these first)

1. **Why ARCWANI and Liwan vanished from Ads.** Their cards were NOT removed. On the Ads Management board, ARCWANI's card "ARCWANI-MAHARA-29\8" is **Live**. Liwan has three cards: "|MAHARA|21\9" is Live, and 20\8 and 10\9 are Paused. Both ad accounts are Meta `account_status` 3 (unsettled) in `cockpit_meta_account_state` (fetched 2026-10-24 13:07). Nothing delivers, so the sync emits **no campaign row** for them. The publish then marks their `cockpit_campaigns` rows `source_deleted`: ARCWANI has 0 live and 1 deleted, Liwan 0 live and 2 deleted. Every screen and every write path keys on a live `cockpit_campaigns` row, so they disappear everywhere.
2. **The exact client-inclusion rule for the Ads list**, end to end:
   - (a) **Source rows** (`hermes/cockpit-sync/calculator.ts`): the per-ad, per-day rows of the tracker Google Sheet `1pBEy…` (30 days), plus Meta rows for any ad account the sheet lacks (`metaRowsForMissingAccounts`). These are aggregated by **campaign name**.
   - (b) **A campaign becomes a row** only if its spend over the 7 complete days (`since7..until7`, ending on the sheet's last day) is **at least $0.50** (`if (a.spend < 0.5) continue;`, calculator.ts:2614), and its account is not `maharamedia`.
   - (c) **`onBoard = Boolean(task)`**, where `task` is one of these, in order:
     - a card on ClickUp **Ads Managment** list `901817774521` whose normalized name equals the campaign name;
     - else a card tagged with the client. The client comes from the Client Data sheet's `Ad Account - Meta`, matched by account **name**.
     - else a tag that starts with the campaign name's first word (5+ characters).
   - (d) **One card, one campaign** (calculator.ts:3244-3273). When two campaigns match the same card, the one named on the card wins, else the one that spent most. The others get `onBoard=false`.
   - (e) **`sync.store`** (`hermes/cockpit-sync/capture.ts:33-36`): `tables.campaigns = campaigns.filter(onBoard)`. These become `cockpit_campaigns` through `cockpit_native_media_publish`/`cockpit_native_mirrors`. A row that is absent from the new set gets `source_deleted=true`. Off-board rows with `spend7d>0` that were not dismissed become `offBoardCampaigns`.
   - (f) **Browser read** (`cockpit_media_live_campaigns()`): every `cockpit_campaigns` row with `NOT source_deleted` that the seat may see (`cockpit_ask_ai_owner_allowed`).
   - (g) **Ads tabs** (CockpitPage.tsx:434-437, 1531-1543):
     - `isParked` means the board's `Ad Status` is Paused, Dead Campaign or Lost Client, AND the campaign is not running on Meta (meta tree status, else spend on the last day or the day before).
     - **Running** = not parked. **Off the board** = parked.
   - **Consequence:** a client with no spend over 7 days, whether paused, unsettled, new or relaunching, has **no row on either tab**, whatever its card says.
3. **No launch tool works for a client without a live campaign row.**
   - `cockpit_build_scope(p_tag)` needs exactly one distinct ad account among the client's live `cockpit_campaigns` rows, and copies the settings from one of those campaigns' ad sets.
   - `cockpit_media_scope(op, campaign)` needs exactly one live row with that campaign name. The exceptions are `board.addToBoard` and `board.dismissOffBoard`, which use the off-board feed, so they still need spend.
   - The account page `/ads?account=X&adAccounts=…` opens for such a client (R8, 2026-10-22), but it is read-only: BuildPanel and EditPanel render only inside a campaign panel.
4. **The "launching" rule** (calculator.ts:2961-2981, 3043-3117; capture.ts:13-14):
   - **Onboardings** = every task whose name matches `/new client campaign launch/i` and whose status is not complete, closed or done. The search covers the Ads Managment list `901817774521` and the Marketing / ADs list `901816723196` (`include_closed=false`, `subtasks=false`).
   - The client is the part of the task name before " - New Client". The checklist comes from the task's subtasks' checklists. The ad account comes from Client Data, by name, then resolved against Meta's account names.
   - The Brand Blueprint "Send to media" creates `"{card} - New Client Campaign Launch 🚀"` on **Marketing / ADs** `901816723196` from template `t-86ex8xaf1` (`apps/client-success-cockpit/src/present/blueprintBrief.ts:13-14,240`). So the rule reads Blueprint tasks.
   - **Live now: `onboardings` = 0 rows, `launchWatch` = 1 row** (snapshot 2026-10-24 12:35+03).
   - The Today page renders `<Onboardings />` with no `onBuild`, so its "Build the campaign" button never shows.
5. **The client build is narrower than its name.** `cockpit-creative-api` `launchBuild`:
   - creates only a **campaign and an ad set**, both PAUSED. No ads are made: "Attach the creative files in Ads Manager".
   - refuses an ad account whose Meta `account_status` is not 1. This is the only pre-write account-status gate in the media paths.
   - **refuses any currency but USD** and sends `daily_budget: dailyBudget*100`, not `usdToBudget`, so SAR and QAR clients cannot launch.
   - names the campaign `"{client} |MAHARA|YYYY-MM-DD"`. No ClickUp card has that name, so the new campaign joins Ads only by tag match, and then loses the "one card, one campaign" contest to the card's named campaign unless it spends more.
   - has never run natively: `cockpit_media_actions` has no `cockpit.requestBuild` or `cockpit.launchBuild` rows.
6. **The best existing relaunch pattern** is the CEO's `ceo.b2bLaunch.*` (`supabase/functions/cockpit-media-api/launch.ts`):
   - campaign → ad set → ads cloned from winners + copy variants, all PAUSED;
   - `usdToBudget` with an account-currency check, and `cleanTargeting`;
   - draft table, atomic launch claim, reconcile on interruption.
   - **But** it is founder-only and pinned to Mahara's own account `746108264865897` (`cockpit_media_scope` → `{account:'746108264865897',founder:true}`).
7. **Corrections to the brief's KNOWN list.**
   - The per-client ads cards (Ad Status, Advertising Cities, Daily Ad Spend fields) live on **"Ads Managment" `901817774521`** (space "Mahara Client Database").
   - **"Marketing / ADs" `901816723196`** (space "Team - Maharamedia") holds her task list and the launch tasks. Its statuses: to do, in progress, review required, pending, complete (done), cancelled (closed).
   - `cockpit_board_clients` also has 1 row "Removed from sheet". Active is 19: 18 Active/Active plus 1 Active/registry Paused.

---

## 1. Routes and nav (media buyer seat)

- `src/auth/authenticated/AuthenticatedAppRoutes.tsx`: `RoleRoute role="media_buyer"` → `/dashboard` (TodayPage), `/ads` (AdsPage), `/eod`, `/playbook|/ideation|/swipe` (Library). `/performance` and `/team` are for every seat. `/admin`, `/ceo` and `/data` are admin only.
- Nav (three places, "simplification audit" 2026-10-06):
  - `src/components/AppSidebar.tsx:54-76` (`navItems`)
  - `src/components/MobileTabBar.tsx:84-110`
  - `src/components/CommandPalette.tsx:50-60`
  - `src/auth/supabaseAccess.ts:16` (media_buyer home `/dashboard`)
  - A new Launch place means touching all four, or keeping it a tab or part of `/ads`.
- `src/pages/index.ts` re-exports `AdsPage, TodayPage, EndOfDayPage` from `CockpitPage.tsx`.

## 2. Ads section, `src/pages/CockpitPage.tsx` (3,919 lines)

- `Cockpit({view})` (line 983) is all three screens. `useMediaBuyerSnapshot(auth.client, auth.clients)` gives `snap`.
- **Snapshot sources** (`src/lib/mediaSourceClient.ts:readMediaSnapshot`):
  - RPC `cockpit_media_source_read()`: 17 imported feed tables in `cockpit_media_sources`, verified by `cockpit_media_source_state`. They are inbox, clientLinks, clientComments, boardCards, offBoardCampaigns, manualChanges, adChanges, metaTree, clickupMembers, clientPrefs, feedback, syncRuns, onboardings, launchWatch, trackingIssues, marketPlays and campaignChat. Per-seat client filtering is done on `client_names`.
  - RPC `cockpit_media_live_campaigns()`: the campaigns.
  - `from('cockpit_ads').eq('source_deleted',false)`
  - RPC `cockpit_media_preferences()`
  - These are then built by `buildSnapshot` in `src/lib/mediaSourceModels.ts`.
- **Ads layout** (`view==="ads"`, lines 3862-3906):
  - With no `?account`: `tiles`, `LeadSyncStrip`, `TrackingIssues`, `sweep`, `board`.
  - With `?account=`: `AccountView`.
  - `AdBillingWatch` sits above both, except on an account page.
- **`board`** (3335-3762):
  - Tabs Running / Off the board (`adsTab`).
  - `RangePicker` (`?range=`, saved per device).
  - `ADS_FILTERS` chips (`src/lib/adsFilters.ts`, ranged).
  - Table grouped by client, with rows opening `campaignPanel(c, where)` (line 2691; the same panel the account page uses).
  - Under Running: **`ClientsNotListed`** (clients that spent or booked in the range with no Running row, an Open button to the account page) and **`OffBoardCampaigns`** ("Spending but not on the ClickUp board": `board.addToBoard` / `board.dismissOffBoard`).
  - Under Off: **`BoardView`** (every Ads Managment card, 60 now, with tabs Not live / Live / All, an `AdStatusPicker`, a `CityPicker` and a ClickUp link). No launch and no open from there.
- **Board view statuses now:** Paused 33, Live 23, Dead Campaign 2, Account Disabled 1, none 1. "Account Disabled" is not in `OFF_STATUSES`.
- **`flagFor`** (1717-1755): account issue (billing strip), "Board says X, still on Meta", "Nothing delivering on Meta", "Card name out of date".
- **Campaign panel tools** (inside `campaignPanel`):
  - `AdStatusPicker` → `board.setAdStatus`
  - `RenameCardButton` → `board.renameCard`
  - `CityPicker` → `board.setAdvertisingCities`
  - `FunnelLine` (funnel.read / forms.publish / forms.switch)
  - `CampaignChangesResults` (`cockpit.logManualChange`)
  - `StatusToggle` → `control.setStatus`
  - `EditPanel`
  - `CampaignChat` (`chat.ask`)
  - `RequestCreativeButton` (creativeRequests.request, in the creative API)
  - `LostLeads`
  - **`BuildPanel`** (`clientTag=c.clientTag ?? c.accountName`, `accountId=c.metaAccountId`)
  - `LiveInMeta` (table only)
  - the reroute and leave modes
  - `execute.runAction` (line 1020) for executable recommendations.
- `ClientsNotListed` rule (`src/lib/clientRange.ts:263`): the client's spend or bookings in the range are above 0, AND none of its accounts are among the Running campaigns' `metaAccountId`, AND its name is not among the Running names. A client with 0 spend and 0 bookings in the range is never listed.

## 3. Account page, `src/components/AccountView.tsx` (1,395 lines)

- URL: `/ads?account=<client>&adAccounts=<ids>&range=&campaign=` (`setAccountView`, CockpitPage:1069).
- Props: the campaigns filtered by `clientOf(c)===accountView`, the meta tree, and `renderPanel=c=>campaignPanel(c,{inAccount:true})`.
- Totals come from `stats.clientRange` → RPC `cockpit_media_client_range(p_start,p_end,p_accounts)`. Migration `20261022x_media_client_range.sql`; its client list is `cockpit_board_clients` by `ad_account_ids`. Stopped campaigns are included.
- With no listed campaigns it shows numbers and EmptyStates only (`clientPagePlan` in clientRange.ts:437). **No build, launch or switch tools.**

## 4. Existing launch and relaunch tools

| Tool | Where (UI → API) | What it writes | Gate / limits |
|---|---|---|---|
| Build a campaign (draft) | `BuildPanel.tsx` → `api.cockpit.requestBuild` → `campaignBuildsClient.ts` → `cockpit-creative-api` `requestBuild` → `build.ts:runBuild/prepareBuild` | Supabase `cockpit_campaign_drafts` (status building→ready) plus a model call (copy). It reads Meta ad sets of `scope.campaign` (GET) | `cockpit_build_scope(clientTag)`: media_buyer or CEO, exactly one live account for the tag, `cockpit_client_allowed`. The browser always sends `apply:true` (a server dry run exists for `apply!==true`) |
| Launch the draft | `BuildPanel` "Launch it paused" → `launchBuild` → `launchBuildPlan` | **Meta**: POST `act_X/campaigns` and `act_X/adsets`, both PAUSED, read back. No ads | `account_status===1`, **USD only**, budget `*100`. Draft claim ready→launching→launched. `cockpit_media_actions` op `cockpit.launchBuild` (triggers a learning message) |
| Drafts list / save copy / discard | `buildsFor/saveVariants/discardBuild` → RPC `cockpit_build_action` | Supabase drafts. Audit trigger `cockpit_build_audit` → `cockpit_audit_log` | same scope |
| Add ad set (duplicate) | `EditPanel` → `edit.duplicateAdSet` | **Meta** POST `act_X/adsets` PAUSED (copies targeting etc. and fixes explore_home; budget copied or converted) | campaign scope |
| New ads from an existing one (copy variants) | `EditPanel` → `edit.newAdsFromExisting` | **Meta** `adcreatives` + `ads` PAUSED (or clones of chosen ads) | campaign scope, ≤10 clones, ≤5 variants |
| New creative into a campaign | `EditPanel` → `edit.addCreativeToCampaign` | **Meta** `advideos`/`adimages` (HTTPS URL only; Drive refused → assist worker) + creative + ad PAUSED | campaign scope |
| Budget | `EditPanel` → `edit.setAdSetBudget` | **Meta** daily_budget (CBO routed to the campaign; lifetime refused). `usdToBudget(account currency)` | campaign scope |
| On/off | `StatusToggle` → `control.setStatus` | **Meta** status | campaign scope, object must be on scope account/campaign |
| Recommendation | `execute.runAction` | **Meta**: pause the campaign, raise ≤25% (≥$30 floor), or pause the worst ad (never the last live one) | campaign scope, precondition re-read |
| Add card to board | `OffBoardCampaigns` → `board.addToBoard` | **ClickUp** POST `list/901817774521/task` with the client tag and Ad Status | off-board feed hit (needs 7-day spend), seat client access |
| Ad Status / Cities / Rename card | `AdStatusPicker`, `CityPicker`, `RenameCardButton` | **ClickUp** field POST/DELETE, task PUT | campaign scope (card must be on 901817774521) |
| "Set this launch up with me" | `Onboardings.tsx:LaunchWithMe` → `useAssist("launch")` → native write `assist.enqueue` → `hermes/media-native` `assist.run` kind launch | Drafts copy. May **upload creatives into the client's Meta asset library** (no campaign, ad set or ad). Lists the steps | native source scope (onboardings/launchWatch/boardCards verified) |
| CEO B2B launch | `ceo.b2bLaunch.build/save/discard/launch` (`launch.ts`), CEO Ads tab | **Meta** campaign → ad set → ads PAUSED on `746108264865897` | founder only, fixed account |

- Built 2026-09-19 onward:
  - Drive creatives (assistWorker, Convex era)
  - CEO Ads launch (8955e3b)
  - ad account page (2026-09-27)
  - change sync (2026-10-06)
  - funnel forms (2026-10-10)
  - lead page forms (2026-10-22)
  - client range / ClientsNotListed (2026-10-22, R8)
  - Blueprint "Send to media" launch task (f0f2dc6c)

## 5. Change sync to ClickUp (Supabase native)

- `supabase/functions/clickup-writeback/` (queue.ts, rules.ts, run.ts, kpi.ts, billing.ts, dosdonts.ts), from migration `20261009f_clickup_writeback_native.sql`.
- Kinds: decision, manual_change, provider_action, tracking_backlog. **provider_action** = `cockpit_campaign_action_messages` joined to `cockpit_media_actions` (trigger `cockpit_clickup_writeback_enqueue_trigger('provider_action')`). These messages exist for confirmed ops: `cockpit.launchBuild`, `execute.runAction`, `control.setStatus`, `edit.*`, `cockpit.askForDetail` (migration u:109-129).
- **Card choice** `cardFor(campaignName, campaigns)` (rules.ts:165): the campaign's own `taskId`, else the biggest-spending sibling by client name or tag. Both need the campaign in the campaigns list.
- **Live mode** (`cockpit_clickup_writeback_runs`, last 2 days): `log` = `apply_limited`, `kpi` = `dry_run`, `dosdonts` = `dry_run`. Delivery is gated by the secret `CLICKUP_WRITEBACK_APPLY`. A dry run records `planned`.
- Does NOT create missing board tasks, by design. Only explicit `board.addToBoard` does.

## 6. Harness pages and fixtures

- `vite.harness.config.ts`: port **5179**, `bun run harness`.
  - Aliases `convex/react` → `src/dev/convexStub.ts`, `@/auth/SupabaseAuthProvider` → `src/dev/authHarness.ts` (a made-up CEO session), and `hoursModel` → its harness.
  - Defines a placeholder Supabase key, so there are no real reads.
- `harness.html` → `src/dev/harness.tsx`:
  - MemoryRouter at `?path=/ads?...` (or `?tab=` for CEO tabs).
  - Installs `install*Harness(getCockpitSupabaseClient())`, which monkey-patch `client.rpc`, `client.from` and `client.functions.invoke`.
  - `setFixtures({...portalFixtures(), ...tmp/harness/fixtures.json})`.
- `src/dev/adsPageHarness.ts` + `adsPageFixture.ts` (Ads page): answers the RPCs
  - `cockpit_get_daily_checks`, `cockpit_personal_eod`, `cockpit_media_source_read`, `cockpit_media_live_campaigns`, `cockpit_media_preferences`
  - `cockpit_media_statistics` (range/campaignTrend/portfolioTrend/coverage), `cockpit_media_client_range`, `cockpit_media_campaign_history`
  - `cockpit_build_action`, `cockpit_winner_saved_in`, `cockpit_get_client_logos`, `cockpit_ad_billing_panel`
  - `cockpit_media_native_read`/`_catalog_read` (incl. `cockpit.onboardings`, `cockpit.launchWatch`)
  - tables `cockpit_decisions`, `cockpit_plan_items`, `cockpit_lead_sync_status`, `cockpit_ads`
  - **It does not stub `functions.invoke('cockpit-media-api'|'cockpit-creative-api')`.** A Launch desk harness needs that added (pattern: `boardHarness.ts:38-130`, `ceoHarness.ts:277-290`).
  - Params: `&through=1&delay=` (ads-filters-follow-range).
- `src/dev/portalFixtures.ts`: Convex-named fixtures for the media buyer screens (e.g. `winnerSaves:preview`).
- `funnel-harness.html` → `src/dev/funnelHarness.tsx`. `page-form-harness.html` → `src/dev/pageFormHarness.tsx`. `ad-billing-harness.html` → `src/dev/adBillingHarness.tsx`.
- Other harness modules: `boardHarness.ts`/`boardFixture.ts` (/performance), `callCentreHarness.ts`, `billingFixture.ts`, `resultsHarness.ts`, `dataViewHarness.ts`, `hoursHarness.ts`, `ceoHarness.ts`.
- Tests:
  - `apps/media-buyer-cockpit/scripts/*.test.ts` (bun; PGlite via `scripts/lib/cockpitTestDb.ts`, which runs the real migrations; run files one by one)
  - `supabase/functions/cockpit-media-api/*.test.ts` (fake `Provider` that shifts canned rows and throws on an unexpected call)
  - `hermes/cockpit-sync/*.test.ts`
  - Relevant: `ads-filters.test.ts`, `campaign-builds-supabase.test.ts`, `client-range.test.ts`, `media-client-range-supabase.test.ts`, `board-screen.test.tsx`, `build.e2e.ts`, `supabase/functions/cockpit-creative-api/build.test.ts`.

## 7. `supabase/functions/cockpit-media-api`: every browser-callable op

- **Entry:** `index.ts`.
  - POST `{operation,args,apply?,requestId?}` with the user JWT. Checks `auth.getUser`.
  - `OPERATIONS` (core.ts:15). Scope RPC per op (below).
- **Write flow:**
  - `prepare` makes **GETs only**.
  - `apply!==true` → `{ok:false,dryRun:true,plan,message:'Preview only…'}`.
  - On `apply:true`:
    - needs a UUID;
    - re-checks the scope;
    - inserts the intent `cockpit_media_actions` (`state` pending);
    - `executePlan` runs each step once, with no retry. Each step does a precondition GET (optional), the write, then a read-back GET with `confirmed()`.
    - `cockpit_finish_media_action` updates the board cache in `cockpit_campaigns.raw_data`, **inserts `cockpit_audit_log`** and sets the state confirmed.
    - On error the state becomes `reconcile`.
  - Every provider call (GETs too) appends `cockpit_media_provider_health` intent/response/unknown, with no tokens (`tools.ts`).
  - Before every non-GET intent, the health hook re-runs the scope and aborts if it changed.
  - A plan with `check.ready!==true` (a Meta rehearsal refused) is never applied.
- **Browser:** `src/lib/mediaActionsClient.ts` (`MEDIA_WRITES` always `apply:true`, request id kept in localStorage). `src/lib/cockpitApi.ts:124-158,377-421` routes.

| Op | Provider writes | Scope / gate |
|---|---|---|
| `board.adStatusOptions`, `board.advertisingCityOptions` | none (ClickUp GET of list fields) | media_buyer/admin/founder |
| `board.setAdStatus`, `board.setAdvertisingCities` | ClickUp field POST/DELETE on the 901817774521 card | live campaign row, card on that list |
| `board.renameCard` | ClickUp PUT task name | live campaign row |
| `board.addToBoard` | ClickUp POST task on 901817774521 (tag = client, Ad Status) | off-board feed hit (1 exact), seat access, no existing card |
| `board.dismissOffBoard` | none (Supabase `cockpit_dismiss_offboard`, audited) | off-board feed hit |
| `control.setStatus` | Meta POST status | live campaign row, object on scope account (+campaign) |
| `edit.setAdSetBudget` | Meta daily_budget (currency-converted) | same |
| `edit.duplicateAdSet` | Meta POST adsets PAUSED | same |
| `edit.newAdsFromExisting`, `edit.addCreativeToCampaign` | Meta adimages/advideos/adcreatives/ads PAUSED (`creative.ts`) | same |
| `execute.runAction` | Meta pause / budget / pause the worst ad (`execute.ts`) | same + `precondition`, `liveAdsGuard` |
| `funnel.read` | none (read) | campaign scope |
| `forms.publish`, `forms.switch` | Meta: new lead form on the Page (Page token) + creative swaps on ads (`funnel.ts`) | campaign scope; `check` rehearsal |
| `pageForms.read/publish/switch/funnel` | Supabase storage page file + record (`pageForms.ts`) | `cockpit_page_form_scope` |
| `previews.fresh` | none (Meta preview GET + `cockpit_ad_preview_cache_save`) | `cockpit_ad_preview_scope` |
| `cockpit.askForDetail` | ClickUp comment (+ read-back) | `cockpit_media_task_scope` |
| `edit.askViktorFor` | Slack DM (`ALERT_SLACK_TO`) | `cockpit_media_request_scope` |
| `comms.sendReply` | GoHighLevel WhatsApp message (`whatsapp.ts`) | its own RPCs |
| `ceo.b2bControl.setStatus`, `ceo.b2bManage.*` (`b2b.ts`, `creative.ts` for createAds) | Meta on 746108264865897 | founder only |
| `ceo.b2bManage.copyIdeas` | model only | founder |
| `ceo.b2bLaunch.list/build/save/discard/launch` (`launch.ts`) | build = model + `cockpit_ad_drafts`; launch = Meta campaign/adset/ads PAUSED | founder; `cockpit_b2b_draft_action`, `cockpit_claim_b2b_launch` |
| `ceo.ltv.apply` (`ltv.ts`) | ClickUp card fields | founder; server preview `cockpit_ceo_action('ltv.preview')` |

- **No op in this function pre-checks Meta `account_status`.** An unsettled client account is refused by Meta itself (200/4841021 or #2490592) after the intent row. Only the creative-API build launch checks `account_status===1` first.
- **Live `cockpit_media_actions` counts:**

  | Op | Confirmed | Reconcile |
  |---|---|---|
  | `ceo.b2bControl.setStatus` | 14 | 0 |
  | `edit.addCreativeToCampaign` | 7 | 3 |
  | `control.setStatus` | 5 | 0 |
  | `edit.setAdSetBudget` | 3 | 0 |
  | `board.setAdStatus` | 2 | 0 |
  | `execute.runAction` | 1 | 0 |
  | `board.setAdvertisingCities` | 1 | 0 |
  | `ceo.b2bManage.setBudget` | 1 | 0 |
  | `edit.askViktorFor` | 0 | 1 |

  There are no build or launch rows.

## 8. Supabase objects (live definitions checked by md5/defs on 2026-10-24)

- `cockpit_media_scope(text,text)`: the live body equals migration `20260927u` (founder emails are hardcoded: aziz@ and awaheedi2008@).
- `cockpit_build_scope(text)` and `cockpit_build_action`: `20260927r`, restored identically in `20261007c`.
- `cockpit_media_live_campaigns()`: `20260927u:149`. `cockpit_media_source_read()`: `20260927w`. `cockpit_finish_media_action`: writes `cockpit_audit_log`.
- `cockpit_media_client_range(date,date,text[])`: `20261022x`.
- `cockpit_media_native_catalog_read` (onboardings/launchWatch/winners) and `cockpit_media_native_read`: `20261004d/e`.
- **Table access for `authenticated`** (RLS on all):
  - `cockpit_campaigns` SELECT yes; `cockpit_ads` SELECT yes.
  - `cockpit_board_clients`, `cockpit_client_onboarding`, `cockpit_meta_account_state`, `cockpit_campaign_drafts`: **no SELECT**.
  - So a Launch desk needs a new SECURITY DEFINER read RPC, with its grants in the same migration.
- Columns:
  - `cockpit_board_clients`: location_id, clickup_id, client_name, status, service_mode, ad_account_ids[], ad_account_ties jsonb, tiktok, updated_at, registry_status, card_stage.
  - `cockpit_meta_account_state`: account_id, account_status, disable_reason, spend_cap, amount_spent, is_prepay, currency, currency_offset, usd_rate, fetched_at, run_id. Filled by the `meta-ad-days` edge function (`accounts.ts`), migration `20261017100000_meta_budgets.sql`.
  - `cockpit_client_onboarding`: clickup_task_id, client_name, clickup_status, client_status, in_onboarding, csm, signup_on, onboarding_call_on, launch_on, links, handover, sales_transcript, forms, card_updated_at, seen_at, synced_at.
  - `cockpit_campaign_drafts`: id uuid, source_id, client_tag, client_name, account_id, data jsonb, status (building/ready/failed/launching/launched/discarded), created_by, created_at, updated_at.

## 9. Live client universe (counts only)

- **`cockpit_board_clients`, status/registry:**

  | status / registry_status | Clients | With ad accounts |
  |---|---|---|
  | Active / Active | 18 | 17 |
  | Active / Paused | 1 | 1 |
  | Launching / Launching | 8 | 1 |
  | Paused / Paused | 1 | 1 |
  | Stopped / Paused | 2 | 2 |
  | Stopped / Ghosting | 1 | 1 |
  | Ghosting / Ghosting | 2 | 0 |
  | Cancelled / Cancelled | 34 | 17 |
  | Removed from sheet | 1 | 0 |

- **Active clients with 0 live `cockpit_campaigns` rows:**
  - ARCWANI (Meta 3)
  - Joe and Sera Company (Meta 3)
  - Liwan (Meta 3)
  - SAFAD Consultant Engineering (Meta 1; its spend is an outsider campaign, per cpb decisions)
  - Professional Touch Company (no ad account)
- **Launching:** all 8 have 0 rows. 7 of them have no ad account linked; Qatar Technology has one, with no Meta state row.
- **Paused / Stopped:** AIVE designs, Olivar Design, Uvan and Evan, and Kisan each have 1 account, 0 rows, and no Meta state row (likely among the 24 accounts removed from the Business Manager on 2026-10-23).
- Live `cockpit_campaigns`: 17 rows across 14 clients.
- **`cockpit_meta_account_state`:** status 1 ×18, 2 ×1, 3 ×5, 101 ×2.
- **`cockpit_client_onboarding`:**
  - in_onboarding = true: 8 (Brand Blueprint Booked 3, GHOSTED 4, Ready For Launch 1)
  - in_onboarding = false: 62
- **Media feeds** (snapshot 2026-10-24 12:35+03): boardCards 60, clientLinks 69, launchWatch 1, offBoardCampaigns 1, **onboardings 0**.

## 10. What a Launch desk must solve (gaps, from the code)

1. **A client universe that does not depend on spend.**
   - Join `cockpit_board_clients` (Active, Launching, Paused, Stopped; ad_account_ids) with `cockpit_meta_account_state` (status/currency/fetched_at), `cockpit_client_onboarding` (in_onboarding, stage, launch_on), the Ads Managment cards (feed `boardCards`, by tag), the launch tasks (feed `onboardings`) and the last live/deleted `cockpit_campaigns` row per account (the source campaign to copy settings from).
   - Today nothing reads these together for the media buyer, and she cannot SELECT the first three.
2. **A scope that can name a client and an account, not a live campaign.**
   - `cockpit_build_scope` and `cockpit_media_scope` both require a live row.
   - A new `cockpit_media_launch_scope(p_location|p_clickup, p_account)` must:
     - check that the account is in `ad_account_ids`;
     - check seat access (`cockpit_client_allowed`/members.clients);
     - check that Meta status is 1 (refuse 3 and 2 with a plain sentence);
     - check a supported currency (USD/SAR/QAR/AED via `currency.ts`; KWD refused);
     - re-check all of this before each write.
3. **A relaunch plan that makes ads, in any supported currency.**
   - Reuse the b2bLaunch shape (campaign → ad set → ads PAUSED, clones of the client's own past winners + approved copy, `usdToBudget`, `cleanTargeting`) on the client's account.
   - Source settings come from the client's newest ad set on that account (Meta GET), not from a live cockpit row.
   - The launch draft table is `cockpit_campaign_drafts`, or a sibling.
4. **A rehearsal before apply.** `execution_options=["validate_only"]` on each create (memory meta-ads-writes) as `plan.check`. The existing `check.ready` gate in index.ts refuses an apply that Meta rejected in the rehearsal. The UI shows the plan only.
5. **Naming and cards, so "live goes to Ads" happens.**
   - Name the campaign after a card, or create or rename the card. `board.addToBoard` today needs the off-board feed, so it only works after spend.
   - Otherwise the sync keeps the new campaign off the Ads list, or off-board.
   - A campaign also needs at least $0.50 of 7-day spend before it shows at all. A PAUSED launch never reaches Ads until it is switched on and spends. The desk has to hold it, under "Launched, paused, waiting for first spend", until the next sync (every 15 min) shows it.
6. **Sync visibility of paused clients on Ads** (the CEO's second ask). Two options:
   - change the $0.50 7-day rule or `sync.store` to keep carded clients with no spend. This is a native-release change in hermes/cockpit-sync and needs a release, not just a ship;
   - or render the Launch desk's paused or unsettled clients as a band in `/ads`.
7. **The audit trail of a new op:**
   - `cockpit_media_actions` + `cockpit_media_provider_health` + `cockpit_audit_log` (through `cockpit_finish_media_action` or its own insert; note that creative-API `runBuild` writes no `cockpit_audit_log` row itself; only the draft trigger does);
   - a provider_action message, so the ClickUp writeback posts it.
   - `cardFor` needs the campaign in the campaigns list, so a card-less launch posts nowhere. That needs an explicit fallback to the client card on `901816559981`.
8. **Harness:** add `functions.invoke` stubs for the new ops and fixtures for the new read RPC to `adsPageHarness.ts`/`adsPageFixture.ts`. Do not touch the byte-pinned files: `kpi.ts`, `search.ts`, `reportPeriod.ts`, `clientUpdate.ts`, `projections*`, `cockpits.ts`, `clarity.ts`, `Foreplay`/ideation/swipe pages, `callCentre.ts`, `convex/foreplay.ts`, `convex/adAsIdea.ts`, `convex/lostNotes.ts`, `ui/dialog.tsx` (scripts/check-shared.sh).

---

## 11. File list (one line each)

### apps/media-buyer-cockpit
- `src/pages/CockpitPage.tsx`: Today/Ads/EOD in one component. The Ads board, tabs, filters, campaign panel, OffBoardCampaigns, BoardView, account-page wiring.
- `src/components/AccountView.tsx`: the client page `/ads?account=`. Totals from `cockpit_media_client_range`, ad wall, campaigns through `campaignPanel`.
- `src/components/ClientsNotListed.tsx`: "Spent in this range, no campaign running here", with an Open-to-account-page button.
- `src/components/BuildPanel.tsx`: draft → copy review → "Launch it paused" (creative API requestBuild/launchBuild).
- `src/components/EditPanel.tsx`: add ad set, new ads from existing, new creative, budget, ask Viktor.
- `src/components/Onboardings.tsx`: "New client launches" on Today. Onboardings + launchWatch, checklist, "Do it with me" (assist launch).
- `src/components/StatusToggle.tsx`: on/off switch → `control.setStatus`.
- `src/components/CityPicker.tsx`: Advertising Cities → `board.setAdvertisingCities`.
- `src/components/AdBillingWatch.tsx` + `src/lib/adBillingStrip.ts`: payment-problem strip and `accountIssueFlag` (account status words).
- `src/components/CampaignChangesResults.tsx`: typed change log (`cockpit.logManualChange`) and change results.
- `src/components/CampaignChat.tsx`: ask Viktor/Aziz about a campaign (native `chat.ask`).
- `src/components/RequestCreativeButton.tsx`: creative request (creative API `request`).
- `src/components/funnel/*`: FunnelSheet/FormEditor/ChangeReview, lead form publish and switch.
- `src/components/pageform/*`: the client's own lead page form editor.
- `src/components/useAssist.ts`: native assist queue hook (copy/creative/launch).
- `src/components/RangePicker.tsx`, `CampaignRange.tsx`: range pickers.
- `src/components/ClientLogo.tsx`, `src/lib/clientLogosClient.ts`: logos.
- `src/components/ceo/{SectionCard,StatTile,StatusChip,EmptyState,format.ts,...}`: the CEO kit to reuse.
- `src/lib/cockpitApi.ts`: the `api.*` dispatcher (MEDIA_READS/WRITES, stats, clientRange, builds, native).
- `src/lib/board.ts`: re-exports `api`/`useAction`.
- `src/lib/mediaActionsClient.ts`: invokes `cockpit-media-api` (apply plus a durable request id).
- `src/lib/campaignBuildsClient.ts`: `cockpit_build_action` RPC and `cockpit-creative-api` requestBuild/launchBuild.
- `src/lib/mediaNativeClient.ts`: native reads/writes (`cockpit_media_native_read`/`_catalog_read`/write).
- `src/lib/mediaSourceClient.ts`: snapshot reads (`cockpit_media_source_read`, `cockpit_media_live_campaigns`, `cockpit_ads`).
- `src/lib/mediaSourceModels.ts`: `buildSnapshot`, `buildOnboardings`, `buildLaunchWatch` (pure).
- `src/lib/useMediaBuyerSnapshot.ts`: the snapshot hook with checks, decisions, EOD.
- `src/lib/clientRange.ts`: client range types, `clientsWithoutCampaigns`, `clientPagePlan`, `adAccountsParam`.
- `src/lib/adsFilters.ts`: Ads filters (ranged).
- `src/lib/mediaStatsClient.ts`: `stats.range/coverage/trends` (`cockpit_media_statistics`).
- `src/lib/range.ts`: ranges (Last N days end yesterday).
- `src/lib/audiences.ts`: service lines and ad set recommendations for BuildPanel.
- `src/lib/optionalWinners.ts`, `winnerSavesClient.ts`: winners for builds and Save as winner.
- `src/lib/eodRollup.ts`, `costTone.ts`, `kpi.ts` (pinned): gates and wording.
- `src/dev/harness.tsx`, `adsPageHarness.ts`, `adsPageFixture.ts`, `portalFixtures.ts`, `convexStub.ts`, `authHarness.ts`, `boardHarness.ts`: harness (see section 6).
- `harness.html`, `funnel-harness.html`, `page-form-harness.html`, `ad-billing-harness.html`, `vite.harness.config.ts`: harness entry points (port 5179).
- `scripts/lib/cockpitTestDb.ts`: PGlite with the real migrations, for the `*-supabase.test.ts` files.
- `convex/*`: the paused Convex-era originals (sync.ts, board.ts, builder.ts, edit.ts, control.ts, writeback.ts). Reference only.

### supabase/functions
- `cockpit-media-api/index.ts`: entry, scope, dry run, intent, execute, finish, reconcile.
- `cockpit-media-api/core.ts`: OPERATIONS, board/ClickUp plans, status/budget/duplicate plans, `confirmed`, `assertObjectScope`, `ADS_LIST=901817774521`.
- `cockpit-media-api/execute.ts`: `executePlan` (one write per step, read-back) and `prepareRecommendation`.
- `cockpit-media-api/creative.ts`: ad/creative creation plans (PAUSED).
- `cockpit-media-api/metaCreative.ts`: copyable creative spec, `setCopy`, `destinationLink`.
- `cockpit-media-api/launch.ts`: CEO b2bLaunch draft build and launch plan (campaign/adset/ads PAUSED).
- `cockpit-media-api/b2b.ts`: CEO account manage ops, `cleanTargeting`.
- `cockpit-media-api/currency.ts`: `usdToBudget`/`budgetToUsd` (USD/SAR/QAR/AED; KWD refused).
- `cockpit-media-api/tools.ts`: provider transport (Meta/ClickUp/Slack/GHL/Make) and health receipts.
- `cockpit-media-api/funnel.ts`, `pageForms.ts`, `preview.ts`, `slack.ts`, `whatsapp.ts`, `ltv.ts`, `model.ts`, `copy.ts`: see the op table.
- `cockpit-media-api/*.test.ts`: fake-provider and PGlite tests.
- `cockpit-creative-api/build.ts`: client campaign build (`validateBuild`, `prepareBuild`, `launchBuildPlan`, `runBuild`).
- `cockpit-creative-api/index.ts`: routes requestBuild/launchBuild, creative requests, Blueprint rehearse and members.
- `cockpit-creative-api/blueprint.ts`: Blueprint "Send to media" (launch task from template on 901816723196).
- `clickup-writeback/*`: native change log to ClickUp (queue, rules/cardFor, KPI, Do's & Don'ts, billing).
- `meta-ad-days/*`: Meta account state, budgets, ad days (fills `cockpit_meta_account_state`).

### hermes
- `hermes/cockpit-sync/calculator.ts`: the media sync: tracker + Meta rows, the $0.50 7-day rule, card matching, the launching rule, launch watch, off-board.
- `hermes/cockpit-sync/capture.ts`: maps the calculator's mutations to feed tables (`sync.store` keeps onBoard only).
- `hermes/cockpit-sync/worker.ts`: publishes the feed tables (campaigns, ads, metaTree, boardCards, offBoardCampaigns, onboardings, launchWatch…).
- `hermes/media-native/worker.ts`, `tools.ts`, `runbook.md`: native queue (chat.deliver, assist.run copy/creative/launch, calendar.refresh).

### supabase/migrations (key)
- `20260927g_cockpit_media_actions.sql`: `cockpit_media_actions`, provider health, first scope.
- `20260927r_cockpit_campaign_builds.sql`: drafts, `cockpit_build_scope`, `cockpit_build_action`, audit trigger.
- `20260927u_cockpit_media_workflows.sql`: current `cockpit_media_scope`, b2b drafts, action messages, `cockpit_media_live_campaigns`, task scope.
- `20260927w_media_read_models.sql`: `cockpit_media_sources`/`_state`, `cockpit_media_source_read`.
- `20260927x_cockpit_native_media_sync.sql`, `20261008h_…`, `20261022p_…`: native publish/mirrors (source_deleted).
- `20261004d/e_media_native_*`: native reads/writes, worker contracts.
- `20261009f_clickup_writeback_native.sql`: writeback queue and triggers.
- `20261017100000_meta_budgets.sql`: `cockpit_meta_account_state`, budgets.
- `20261022x_media_client_range.sql`: client range read.
