# Launch: the build spec

Spec, 2026-10-24, for branch `launch-desk-1024` (from `origin/main` f0f2dc6c). It is built from three read-only maps made the same day: the code map, the per-client map and the launch-mechanics map (`docs/media-launch/maps/code-map.md`, `clients-map.md`, `launch-map.md`). It also draws on `docs/DESIGN.md`, the frontend-design skill, the Hallmark slop test, and the memory notes meta-ads-writes, meta-budget-currency, media-buyer-change-sync, ads-account-page and ads-filters-follow-range. People are named by role. Clients are named only where the CEO named them or where a client's state is the reason for a rule. Client money stays out of this document.

Nothing in this spec is built, applied, deployed or sent. Every write outside Supabase goes through `cockpit-media-api`'s existing gated path. A server switch keeps that path at plan-only until the CEO turns it on.

---

## 0. What this is, in one screen

| | Decision |
|---|---|
| The ask | The CEO wants a section where a media buyer can see every client they may launch: clients in onboarding, clients ready to launch, and Active or paused clients with nothing running (ARCWANI and Liwan). It should also find any Active client on ClickUp, even one whose ads card is gone. From there the media buyer launches or relaunches on the client's own ad account. A client moves to the main Ads section as soon as it is live, and Ads also shows the paused clients. |
| Why ARCWANI and Liwan vanished | Their cards were not removed. The Ads list only keeps a campaign that spent at least $0.50 over the last 7 days (`hermes/cockpit-sync/calculator.ts:2614`). Both accounts owe Meta, so nothing spends, the rows are retired, and every screen and write path keys on a live `cockpit_campaigns` row. The desk is built so that it never depends on spend. |
| Where it lives | A fourth place in the media buyer rail, **Launch** (`/launch`), between Today and Ads. A client's own page is `/launch?client=<clickup id>`, so reload and back work, the same as `/ads?account=`. |
| Who appears | Every client on the client board (`cockpit_board_clients`, the mirror of ClickUp "Clients - Mahara" 901816559981) that is not Cancelled and that the seat may see. They sit in four lanes: **In onboarding**, **Ready to launch**, **Nothing running** and **Waiting for first spend**. A fifth station, **In Ads**, links out. A search finds any client, including Stopped and Ghosting ones, which are search-only and read-only. |
| The signature | **The launch line**: the page's contents bar drawn as the real pipeline. Five stations with counts sit on one track. A dashed orange return arc runs from In Ads back to Nothing running, labelled "No spend for 7 days", which is the $0.50 rule made visible. Tapping a station scrolls to its lane. |
| The flow | Pick a client. See its account plate, what blocks a launch, its past campaigns and its brief. Choose a route: **Switch back on**, **Copy the best campaign**, **Move to a clean account**, or **Launch new**. **Check with Meta** runs a rehearsal that creates nothing. **Create it paused** builds everything PAUSED. **Switch on** is a second press with its own preview. The launch then waits for its first impressions and moves to Ads. |
| Writes | Seven new operations in `cockpit-media-api` (`launch.*`). They use the existing scope re-check, intent row, one write per step with a read-back, receipt, `cockpit_finish_media_action` audit row and provider health ledger. Unsettled, disabled, closed and access-gone accounts are refused **before any intent row**, with a plain sentence that names who fixes it. Budgets are typed in dollars and converted to the account's currency by `currency.ts`. |
| Plan-only switch | A new server secret, `LAUNCH_APPLY`, starts unset. While it is unset, every `launch.*` write answers with the plan, even with `apply:true`. In the browser, `?rehearse=1` forces plan-only for any seat. |
| Into Ads | "Live" means first impressions on the new campaign id (`cockpit_meta_ad_days`, hourly), not switched on. A live launch shows at once under **Just launched** at the top of the Ads Running tab, and the panel's tools work through a launch fallback in `cockpit_media_scope`. The row hides itself when the native sync lists the campaign. Ads also gets a third tab, **Nothing running**, which holds the same clients as the desk's lane. |
| Backend | One migration with 2 tables, 1 read function, 1 scope function, 1 action function, 1 service function, a replaced `cockpit_media_scope` (one added branch) and a replaced `cockpit_media_action_effects` (launch branches), with grants. One new file in `cockpit-media-api`, and one fallback in `clickup-writeback`'s `cardFor`. No worker change. |

### 0.1 Corrections to the brief, carried from the maps

1. The per-client ads cards (Ad Status, Advertising Cities, Daily Ad Spend) are on **Ads Managment `901817774521`**. **Marketing / ADs `901816723196`** holds the "{card} - New Client Campaign Launch 🚀" tasks that Blueprint "Send to media" creates.
2. No Active client is missing its ClickUp client card. What is missing is the **ads card** (ARCWANI's was closed in a bulk action on 21 Oct) or the **launch task** (0 open today).
3. The hourly account mirror `cockpit_meta_account_state` covers 26 accounts. Some readable accounts are missing from it, so a missing row means **not known**, never fine. The client page reads status from Meta itself.
4. ARCWANI and Liwan cannot be relaunched on their current accounts, even after the client pays. Outsiders made campaigns there (one under Mahara's own naming), and those campaigns go live the moment the balance is paid. The desk refuses a relaunch there and offers the clean-account route. That route is the CEO's own open task for ARCWANI.

---

## 1. Who appears, and where

### 1.1 The client universe

The source is `cockpit_board_clients`, with every status except `Cancelled` and `Removed from sheet`. Each client row is then joined with:

| Fact | Source | Note |
|---|---|---|
| Board status, card stage, service mode | `cockpit_board_clients.status`, `card_stage`, `service_mode` | The row shows the **card's stage** and says it is the card's. The board and the registry disagree on 6 clients, and the registry status appears only in the client page's details. |
| Ad accounts | `ad_account_ids`, `ad_account_ties`, plus `cockpit_board_account_ties` rows for the client's location that are not `kept_out` | The tie table is read directly so that an account linked from the desk counts at once, before the spine's 30-minute refresh. |
| Account status, currency, fetched at | `cockpit_meta_account_state` | Missing row: status `null`, words "Not in Meta's hourly read". |
| Account name | `cockpit_meta_ad_days.account_name` (newest) | Accounts that never spent have no name here. The client page reads the name from Meta. |
| Last ran | `max(day)` where `spend > 0` in `cockpit_meta_ad_days` for the client's accounts | "Never" when there are rows but no spend. "Not known" when there are no rows. |
| In Ads | live `cockpit_campaigns` rows (`NOT source_deleted`) on the client's accounts, or with the client's name | The same rule `cockpit_media_live_campaigns()` uses. |
| Switched-on budgets on the account | `cockpit_meta_budgets` where `effective_status = 'ACTIVE'` at the level that holds the budget | Shown only as a warning on an unpaid account. |
| Who made each campaign | `cockpit_csm_meta_activities` (create events, `actor_name`) joined to the new `cockpit_meta_people` | Unknown creator = **not ours**. Names on campaigns are never proof. |
| Ads cards | media feed `boardCards` (Ads Managment, closed cards included), matched by client tag | Open or closed, with Ad Status and name. |
| Launch task | media feed `onboardings` (open "New Client Campaign Launch" tasks, top level only) | The ~100 orphan subtasks under completed launch tasks are ignored, as the sync ignores them. |
| Onboarding | `cockpit_client_onboarding` (`in_onboarding`, `client_status`, `onboarding_call_on`, `launch_on`, `handover.daily_budget`) | |
| Brief | `cockpit_blueprints.parts->'1'` (sent stamp) and part 1 answers: `service`, `daily_budget`, `destination`, `identity`, `starter`, `pack_url`, `red_lines` | Media buyers cannot read `cockpit_blueprints` today. The read returns **part 1 only**, never parts 2 and 3. |
| Starter pack | `cockpit_blueprint_settings` `pack.<service>` | Empty for every service today. |
| Caller (DFY only) | an active `mahara_console.metadata` `access:agent:*` row whose `locationIds` hold the client's location (the board-facts pattern, `20261016111157_board_facts.sql:905`) | If that schema cannot be read, the check says "Caller not checked here". It never says none. |
| Launches | the new `cockpit_launches` | See 3.1. |

### 1.2 The lanes (one rule, in SQL)

The read function computes the lane, so the desk, the Ads tab and the server all agree. Clients are tested in this order and the first match wins. The Waiting lane lists **launches**, so a client in Ads that is launching a second campaign shows there as well.

| Lane | Rule | Today (maps, 24 Oct) |
|---|---|---|
| **Waiting for first spend** | a `cockpit_launches` row in state `built` or `switched_on` whose campaign has no live `cockpit_campaigns` row | 0 |
| **In Ads** (station only) | at least one live campaign row | 14 |
| **Ready to launch** | (board status `Launching`, or `in_onboarding`, or Active with no live rows) **and** (Blueprint part 1 sent **or** an open launch task) | 0 (Smmim's card says Ready For Launch but no brief or task exists, so it stays In onboarding and says so) |
| **In onboarding** | board status `Launching` or `in_onboarding = true`, and not ready | 8 (4 at an active stage, 4 GHOSTED, folded) |
| **Nothing running** | board status `Active` or `Paused`, no live rows, no waiting launch, not ready | 6: ARCWANI, Liwan, Joe and Sera, AIVE (all four accounts owe Meta), SAFAD (healthy, not spending), Professional Touch (no account) |
| Search only | `Stopped`, `Ghosting` | 5 |

A client that leaves Ads (no spend for 7 days) lands in Nothing running on the next read without anyone doing anything. The return arc on the line shows this.

### 1.3 What each row says

Every row has the same five parts, in this order:

1. **Client**: logo, name, and one muted line with the card stage and service mode, for example "Active on the client board · Done for you". A client with no card on Clients - Mahara says "No ClickUp card, from the client registry".
2. **Ad account(s)**: one line per account, with a status dot, words, the last six digits in mono, and the currency when it is not USD. Several accounts are listed, so Khalida's two accounts both show.
3. **Last ran**: a mono date, "Never" or "Not known".
4. **What blocks it**: the first blocker's short form, plus "and 2 more" when there are more. A row with nothing blocking says "Nothing blocks a launch".
5. **The one next action**: a single outline button, or a muted sentence naming who owns the next step when it is someone else's. Each row has exactly one.

Status words reuse the Ads billing strip's labels (`src/lib/adBillingStrip.ts`), so the same account reads the same everywhere:

| Meta `account_status` | Words | Tone |
|---|---|---|
| 1 | Active | good |
| 3 | Unpaid balance | critical |
| 2 | Account disabled | critical |
| 100, 101 | Account closed | critical |
| 9 | Payment grace period | warning |
| 7, 8 | Payment under review | warning |
| no mirror row | Not in Meta's hourly read | neutral |
| Meta #200 on read (client page) | Access gone | critical |
| no account tied | No ad account linked | neutral |

Next actions use the same verbs through the whole flow:

| Situation | Next action |
|---|---|
| Healthy account, a paused campaign Mahara made | **Relaunch** |
| Healthy account, no Mahara campaign to copy, brief in | **Launch** |
| No account, or the only account is disabled or closed | **Link an ad account** |
| Unpaid or compromised account | **Move to a clean account** (opens the attach step). When only unpaid, the line instead says "Waiting on the client to pay Meta" |
| Healthy, switched on, no impressions | **Check why it is not spending** |
| Onboarding, brief not sent | "Waiting on the creative director's Blueprint part 1", plus **Open** |
| Built, not switched on | **Switch on** |
| Switched on over 24 hours, no impressions | **Check why it is not spending** (critical tone) |
| In Ads (search result) | **Open in Ads**. The client page still offers Launch another |
| Stopped or Ghosting (search result) | "Stopped on the client board. The CSM marks it Active before a relaunch." Read-only. |

Onboarding rows also list what is still missing before launch, as quiet chips: **Blueprint part 1**, **Ad account**, **Page access**, **Caller**, **Starter pack**. Only the missing ones show.

### 1.4 In the Ads section

Changes are small, and nothing moves in the Running table except one group at its top.

1. **A third tab, "Nothing running"**, sits between Running and Off the board (`CockpitPage.tsx:1182` grows `"nothing"`, and the tab bar at :3344). It holds the desk's Nothing running lane, read from the same function, in the same `LaunchRow` with `compact`. Its count is the lane's count. Each row's action goes to `/launch?client=`. The tab exists because "Off the board" means the card says Paused, Dead Campaign or Lost Client. ARCWANI's and Liwan's cards say Live, so putting them there would be wrong.
2. **"Just launched"**, at the top of the Running table, holds launches that are live (first impressions) but not yet in `cockpit_campaigns`. A row opens the shared `campaignPanel` with a campaign built from the launch record (`launchRows()` in `mediaSourceModels.ts`, `justLaunched: true`). It shows today's impressions, spend and leads from `cockpit_meta_ad_days`. Range numbers stay blank and say "Numbers start with the next sync". The panel keeps StatusToggle, EditPanel (budget, new ads, new creative), FunnelLine and the card tools, and hides the parts that need the sync (LostLeads, the range trend). The group hides a launch once a live campaign row with the same `meta_campaign_id` exists.
3. **The account page with no campaigns** (`clientPagePlan`, `clientRange.ts:437`) gets one action on its empty state: **Relaunch in Launch**, which goes to `/launch?client=`.
4. Today's "New client launches" panel (`Onboardings.tsx`) stays. Each row gets **Open in Launch** in place of the build button it never showed.

### 1.5 Navigation

- `AppSidebar.tsx` `navItems`: add `{ href: "/launch", label: "Launch", icon: Rocket, role: "media_buyer" }` between Today and Ads.
- `MobileTabBar.tsx` (the media buyer branch, :82): add Launch between Today and Ads (5 tabs).
- `CommandPalette.tsx`: add the Launch place, plus each client as "Launch: {client}" (the palette's search already lists clients).
- `AuthenticatedAppRoutes.tsx`: `RoleRoute role="media_buyer"` at `/launch` → `LaunchPage`. The media buyer's home stays `/dashboard`.
- None of these files is byte-pinned (`scripts/check-shared.sh` pins `cockpits.ts`, `clarity.ts`, the SOP file and others, not the nav).

---

## 2. The launch and relaunch flow

### 2.1 The client page (`/launch?client=<clickup id>`)

Header: a breadcrumb "Launch / {client}", the h1 client name, and one muted line with board status, service mode and the card. Actions on the right: **Open in ClickUp** (ArrowUpRight) and **Open in Ads** when the client is in Ads.

The right column reads; the left column acts:

- **Ad account** (the account plate): name, id in mono, status with the sentence, currency, last ran, funding (from readiness), switched-on budgets waiting (on an unpaid account), outsiders (when any). With two or more accounts, a segmented control picks the account the page works on (default: the healthy account that ran last). With none, the attach step shows here.
- **Brief**: Blueprint part 1 (service, daily budget, destination, publishing identity, starter ads yes or no, pack, red lines) with when it was sent and by which role, and a link to the launch task when one is open. With no brief: "No Brand Blueprint yet. The creative director sends part 1 after the Blueprint call."
- **Cards**: the client card on Clients - Mahara, and each Ads Managment card with its Ad Status, open or closed.
- **What blocks a launch** (left, top): the readiness checklist (2.3), one line per check with a lamp, the sentence, who fixes it and, when the fix is ours, its action.
- **How to go live**: four route cards in a radio group. A route that cannot run on this account is disabled, with its one-line reason.
- **Past campaigns on this account**: name, made by (Mahara, outsider, not known), status now, last ran, leads and cost per lead over 120 days, and **Use this one**. The default pick is the Mahara campaign with the most leads under the $15 gate in 120 days, else the lowest cost per lead with 3 or more leads (`kpi.ts`, imported, never redeclared).
- **The plan**: the numbered steps of the chosen route (2.5), the budget field, **Check with Meta** (outline) and the page's one teal primary, **Create it paused**. After a build, the primary becomes **Switch on**, with its own preview.

### 2.2 The four routes

| Route | When it is offered | What it builds | Operation |
|---|---|---|---|
| **Switch back on** | healthy account, a PAUSED campaign whose creator is Mahara, no outsiders' objects switched on | No new objects. Optional budget change, then the ticked ads, ad sets and the campaign ACTIVE, campaign last, each read back. The card's Ad Status is set to Live, or a card is made when none matches. | `launch.switchOn` |
| **Copy the best campaign** | healthy account with a Mahara campaign to copy (the default for a relaunch) | A new PAUSED campaign, one PAUSED ad set copied from the source's best ad set, and up to 6 PAUSED ads reusing the source ads' creative ids. Then the Ads Managment card. | `launch.copy` |
| **Move to a clean account** | the client has a second linked account that is healthy; offered first when the current one is compromised, unpaid, disabled or closed | The same as Copy, onto the other account. Images are copied with `adimages` `copy_from {source_account_id, hash}`, videos uploaded with `advideos` `file_url` from the source video's `source`, and creatives rebuilt on the same Page with the Page's same lead form (forms belong to the Page). Custom and lookalike audiences are stripped. No creative id from the old account is reused. | `launch.rebuild` |
| **Launch new** | brief in, healthy account, Page access, media in the account's library | From Blueprint part 1 and the kickoff: campaign, ad set (geo and age from the card's Advertising Cities or the kickoff area, Advantage+ audience, no interest ids), ads from the imported starter pack or the client's Drive files, copy from `launch.copyIdeas` (the client build prompt, approved by the media buyer), the lead form reused or created from the template. Then the card. | `launch.new` |

Names follow the team's own form: `{client} |MAHARA| {d}\{m}`, using the Kuwait date. When that name already exists on the account (a Meta GET), the build adds " b", then " c". Names are display only, and every step keys on Meta ids, because Liwan has three campaigns with one name.

The card is made **with** the build, as its last step, named exactly as the campaign and tagged with the client's tag (from the client's existing cards, else as `board.addToBoard` tags it). Its Ad Status is Paused, and Switch on sets it to Live. The sync matches cards by name first, and "one card, one campaign" lets the campaign named on the card win, so the new campaign keeps its card. The body builder is factored out of `core.ts`'s `board.addToBoard` branch as `boardCardBody(name, tag, adStatus, cities)`, and both use it.

### 2.3 Readiness (`launch.readiness`, a read)

It runs live Meta GETs through `tools.ts`, so they land in the health ledger:

- `act_X?fields=name,account_status,disable_reason,currency,is_prepay_account,balance,spend_cap,amount_spent,funding_source_details,business`
- `act_X/campaigns?fields=id,name,status,effective_status,objective,daily_budget,lifetime_budget,created_time&limit=200`
- `act_X/activities?fields=actor_name,event_type,object_id,object_type,event_time&limit=500` for the create events, falling back to the `cockpit_csm_meta_activities` mirror
- the source ads' `object_story_spec.page_id`, and `funnel.ts`'s `pages()` to check the Page token
- for a switched-on launch with no impressions, `ads?fields=effective_status,ad_review_feedback`

It returns `checks[]` (`{key, state: ok|warn|block|unknown, sentence, owner, fix}`), `candidates[]`, `routes{}` (each with `available` and `reason`), `budget{contractedUsd, source, capUsd, currency}`, and `applyEnabled` (whether `LAUNCH_APPLY` is set). Missing is said, never zero. Each sentence is refused **before any intent row** when its state is `block`:

| Key | Sentence | Owner | State |
|---|---|---|---|
| `no_account` | No ad account is linked to this client. Get the client to share one with Mahara's business, then link it here. | the CSM | block |
| `unpaid` | The client owes Meta a payment. Meta refuses every change on this account, pausing included, until the client pays in Ads Manager. | the client, through the CSM | block |
| `disabled` | Meta has disabled this ad account. Nothing can run on it until the client's appeal is accepted. Link another account to launch now. | the client | block |
| `closed` | This ad account is closed. Link another account for this client. | the media buyer | block |
| `access_gone` | Meta says this account is no longer shared with Mahara. Ask the client to share it with Mahara's business again. | the client, through the CSM | block |
| `grace` | Meta could not charge this account. Ads still run for now; ask the client to fix the payment method. | the client | warn |
| `review` | Meta is reviewing a payment on this account. Ads may stop until it clears. | the client | warn |
| `no_funding` | This account has no way to pay. Ask the client to add a card in Ads Manager. | the client | block (Switch on), warn (build) |
| `prepay_empty` | The prepaid balance is used up. Ask the client to add funds in Ads Manager. | the client | block (Switch on), warn (build) |
| `outsiders` | People outside Mahara made campaigns on this account and {n} of them are switched on. Relaunching here lets them run too. Move the client to a clean ad account first. | the media buyer | block (Switch back on, Copy) |
| `waiting_budgets` | {n} campaigns are switched on here and go live the moment the client pays: {names}. | the media buyer | warn |
| `name_collision` | {n} campaigns on this account are called "{name}". The cockpit tells them apart by Meta id; the Ads list merges them until one is renamed. | the media buyer | warn |
| `currency` | This ad account is in {cur}. The cockpit sets budgets in USD, SAR, QAR or AED only; change it in Ads Manager. | the media buyer | block |
| `not_ours` | The cockpit cannot show that Mahara made this campaign, so it will not switch it on. Copy a Mahara campaign instead. | the media buyer | block (Switch back on) |
| `page_access` | Meta will not let Mahara advertise for the Page "{name}". Ask the client to give Mahara's business the Advertiser role on it. | the client, through the CSM | block |
| `no_caller` (DFY) | No caller is assigned to {client} yet, so new enquiries cannot be called within 5 minutes. Assign one in the dialer first. | the call centre | block (Switch on), warn (build) |
| `no_brief` | The creative director has not sent Blueprint part 1 yet. | the creative director | block (Launch new) |
| `no_pack` | No starter pack is set for {service}. The creative director sets it in the creative cockpit's Settings. | the creative director | block (Launch new with starter ads) |
| `media_not_imported` | The starter pack is not in this ad account yet. Import it first. Action: **Import the pack** (the existing native `assist.enqueue` kind `creative`). | the media buyer | block (Launch new) |
| `stopped` | Stopped on the client board. The CSM marks the client Active before a relaunch. | the CSM | block |
| `not_spending` | Switched on {n} hours ago with no impressions. Check the account's payment method and the ads' review status. Plus the funding and review read. | the media buyer | warn, critical after 24 h |
| `not_checkable` | Meta cannot check this plan until the account is paid. This is the plan only. | | info |

`explainMeta` (`metaCreative.ts`) gains 4841021 (the unpaid account's write refusal, mapped to the `unpaid` sentence) and #200 access errors (mapped to `access_gone`). This also fixes the raw Meta error the existing media writes show today.

### 2.4 Budgets

- The field holds typed dollars per day. The default is the contracted amount: the Ads Managment card's **Daily Ad Spend**, else Blueprint 1.6 `daily_budget`, else the kickoff `handover.daily_budget`. The field names its source.
- Bounds: at least $5. A media buyer seat may set at most **2x the contracted amount**, or **$100** when no contracted amount exists. The CEO may set up to $5,000. Admin seats follow the media buyer cap.
- The value is converted with `accountCurrency` and `usdToBudget` (`currency.ts`). The field shows the conversion in words: "$25 a day, sent to Meta as SAR 93.76". KWD and other currencies are refused (`currency`).
- The budget sits where the source holds it. A CBO source gets the campaign's `daily_budget`, and its ad set carries no budget and no bid strategy. Otherwise the ad set's `daily_budget` is set, with `bid_strategy: LOWEST_COST_WITHOUT_CAP`. Lifetime budgets are refused, as `edit.setAdSetBudget` refuses them.
- Switch back on keeps the source's budget unless the media buyer changes it, and the same caps apply.

### 2.5 The plan, the rehearsal and the presses

Each route's plan is a `MultiPlan` (`core.ts`), so `executePlan` runs it with `$stepN.id` references, preconditions and a read-back for every created object. The page shows each step as one numbered line in plain words, for example "Create the campaign "ARCWANI |MAHARA| 25\10", paused" or "Copy 4 ads from "ARCWANI-MAHARA-29\8", paused". The numbers are a true sequence, because the steps run in that order.

1. **Open the client page.** `launch.readiness` runs. Blocks show before any plan.
2. **Choose a route, a source campaign and a budget.** The plan is built from GETs only (`apply` omitted). The answer is `{ok:false, dryRun:true, plan}` and the steps show as "Planned".
3. **Check with Meta** (outline) re-prepares with `check: true`. Each create body is sent with `execution_options=["validate_only"]`, which creates nothing (memory meta-ads-writes). The campaign body is checked on the account. The ad set body is checked against the source campaign id, and each ad body against the source ad set id, because the new ids exist only after the press, and the step says so. Meta's answers go into `plan.check`: "Meta checked this" or Meta's words through `explainMeta`. On an unpaid account the check is skipped and `not_checkable` shows. As the existing gate in `index.ts` does, a plan whose `check.ready !== true` is never applied.
4. **Create it paused** (teal) sends `apply: true` with a UUID request id. The scope is re-run. The intent row is inserted with `campaign_name` set to the new campaign's name, so the action message and the ClickUp change log can name it. The steps execute and the receipt is settled. The migration's effects trigger writes `cockpit_launches` (state `built`) **from the confirmed receipt only**. Toast: "Created, paused".
5. **Switch on** (teal, appears once a built launch exists) has its own preview, which states the budget in words and the objects that will run. Then it applies `launch.switchOn` with `launch` (the launch id): ads, then ad sets, then the campaign ACTIVE, and the card's Ad Status Live. The state becomes `switched_on`. Toast: "Switched on".
6. **Waiting for first spend.** The launch shows in the Waiting lane: "Switched on 14:05, no impressions yet. Meta's numbers are read every hour." On the first `cockpit_meta_ad_days` row with impressions on the campaign id, the read marks it live. It leaves the desk and shows under **Just launched** in Ads. After 24 hours with no impressions, the row turns critical with `not_spending`.
7. **Discard** (a built launch only, quiet ghost button) marks the launch discarded through `cockpit_launch_action('discard')`. The paused Meta objects stay as they are, and the result names them: "The paused campaign stays in Ads Manager; nothing was deleted."

While `LAUNCH_APPLY` is unset, or on `?rehearse=1`, step 4 and step 5 show the plan and the banner "Rehearsal: this is the plan only. Launch writes are switched off on the server." The teal button reads **Create it paused (rehearsal)**, and pressing it shows the dry-run plan.

### 2.6 ARCWANI, Liwan and SAFAD, concretely

- **ARCWANI**: Nothing running. The account plate shows "Unpaid balance", outsiders and switched-on campaigns waiting. Switch back on and Copy are disabled ("outsiders"). The next action is **Move to a clean account**. Once the client shares the clean account with Mahara's business 767701513092162, the media buyer links it (`launch.attachAccount`), then runs **Move to a clean account** from "ARCWANI-MAHARA-29\8" with the card's contracted budget, then Switch on. The old account stays as it is, and the desk shows its waiting campaigns as a warning, never as a target.
- **Liwan**: the same route. The plate also shows `name_collision`. If the client pays on the old account instead, the billing watch sees the recovery, and the desk still refuses a relaunch there while outsiders' objects are switched on. Pausing those is a plan a person presses in Ads Manager or in a later version (Not in v1).
- **SAFAD**: Nothing running, healthy, its Mahara campaign switched on. The next action is **Check why it is not spending**, which reads funding and the ads' review status. When both are clean, the media buyer can Switch back on with a budget change. This is the first real test of the flow once `LAUNCH_APPLY` is on.
- **Professional Touch**: **Link an ad account**. The attach step lists visible accounts that are not tied to any client, sorted by name likeness, and says plainly when there are none: "No account shared with Mahara looks like this client's. Ask the CSM to get it shared."

### 2.7 Linking an account (`launch.attachAccount`)

- Preview: GET `act_X?fields=name,account_status,currency,business`, and confirm that the account is in Mahara's business listing (the same listing `meta-ad-days` reads). It also confirms the account is not tied to another location and not `kept_out`.
- Apply: an intent row, then the service function `cockpit_launch_attach(p_action_id, p_location, p_account, p_evidence)`. That function upserts `cockpit_board_account_ties` (`added_by`, evidence `{metaName, business, readAt, by}`) and writes an audit row. The edge function then finishes the media action, which writes the second audit row and the receipt. No other team's table is written, as with the board's own ties (`20261016210200_board_account_ties.sql`).
- The desk's read sees the tie at once. The spine picks it up on its next refresh, and `meta-ad-days` ties the account on its next hourly run.

---

## 3. Backend

### 3.1 The migration, `supabase/migrations/20261024b_media_launch_desk.sql`

Row security and grants are in the same file. It is safe to apply twice. It refuses to run unless `20261024a_brand_blueprints.sql` and `20261016210000_board_facts_checked.sql` are present. The live definitions of `cockpit_media_scope` and `cockpit_media_action_effects` (the latter last replaced in `20261010b_cockpit_lead_form_changes.sql`) are read with `pg_get_functiondef` and kept as rollback copies in `~/.cache/mahara-ship/rollback/` before the build replaces them.

**Tables**

- `cockpit_launches`
  - columns: `id uuid pk default gen_random_uuid()`, `clickup_id text not null`, `location_id text`, `client_name text not null`, `account_id text not null check (account_id ~ '^\d{5,}$')`, `kind text check (kind in ('switch_on','copy','rebuild','new'))`, `source_account_id text`, `source_campaign_id text`, `campaign_name text not null`, `budget_usd numeric`, `budget_level text check (budget_level in ('campaign','adset'))`, `state text not null check (state in ('built','switched_on','reconcile','discarded'))`, `meta_campaign_id text`, `meta_adset_ids text[]`, `meta_ad_ids text[]`, `card_task_id text`, `build_action_id uuid references cockpit_media_actions(id)`, `switch_action_id uuid references cockpit_media_actions(id)`, `created_by uuid`, `created_by_email text`, `created_at`, `updated_at`, `switched_on_at timestamptz`
  - unique `(meta_campaign_id)` where not null
  - `live` and `in_ads` are **computed in the read**, never stored
  - RLS on, no policies for `authenticated`. `REVOKE ALL FROM PUBLIC, anon, authenticated`. `GRANT SELECT, INSERT, UPDATE TO service_role`.
- `cockpit_meta_people`
  - columns: `actor_name text pk` (spelled as Meta's activity log spells it), `kind text check (kind in ('mahara','client','outsider'))`, `note text`, `added_by text`, `added_at timestamptz`
  - seeded with Mahara's own people and the system users, the list the launch map records
  - RLS on, service role only. Edited by migration in v1. Read only by the functions below.

**Functions** (all `SECURITY DEFINER SET search_path = ''`, revoked from `PUBLIC, anon`)

| Function | For | Does |
|---|---|---|
| `cockpit_launch_pipeline(p_clickup_id text DEFAULT NULL) RETURNS jsonb` | `authenticated` | Requires confirmed active membership with `media_buyer`, `admin` or the founder (the same test as `cockpit_media_scope`). Filters clients by `m.clients` (empty = all), as the media scope does. Without an argument it returns `{asOf, sources:{board, accounts, onboarding, media, blueprints: {at, ok}}, lanes:{onboarding, ready, nothing, waiting, inAds}, clients:[row]}`, with the lane, the account facts, the first blocker and the next action computed from the mirrors (1.1 to 1.3). With an argument it returns that one client in full: every account, cards, launch task, Blueprint part 1 answers, the 120-day campaign ranking from `cockpit_meta_ad_days` (excluded ads and outsiders' campaigns marked), the switched-on budgets, and its launches with `live`, `firstImpressionAt` and `inAds`. Stopped and Ghosting clients come back with `lane: null` and `readOnly: true`. Cancelled clients never come back. |
| `cockpit_media_account_scope(p_operation text, p_clickup_id text, p_account text, p_launch uuid DEFAULT NULL) RETURNS jsonb` | `authenticated` | The scope for every `launch.*` op. It checks membership and role as above, then the client on the board (writes need `Active`, `Paused` or `Launching`; `launch.readiness` also allows `Stopped` and `Ghosting`), then that the account is the client's (`ad_account_ids` or a non-kept-out tie, or for `launch.attachAccount` that it is tied to no other location), then seat client access. It refuses the op from the mirror when the account is 3, 2, 100 or 101, with the sentence from 2.3. Readiness then re-reads the status live. With `p_launch`, the launch must belong to this client and account and be in a state the op allows (`switchOn`: `built`; `discard`: `built`). The function returns `{actor, client, clickupId, locationId, account, founder, admin, boardStatus, serviceMode, contractedUsd, launch:{id, metaCampaignId, metaAdsetIds, metaAdIds, cardTaskId}}`. `index.ts` re-runs it before every non-GET call (the health hook) and before apply, unchanged. |
| `cockpit_launch_action(p_action text, p_args jsonb) RETURNS jsonb` | `authenticated` | `discard` only in v1. Same gate. `built` becomes `discarded`, with an audit row (`cockpit_audit_log`, `source_app 'media-buyer'`, `action 'launch.discard'`). |
| `cockpit_launch_attach(p_action_id uuid, p_location text, p_account text, p_evidence jsonb) RETURNS jsonb` | `service_role` | Requires a pending `cockpit_media_actions` row with that id and operation `launch.attachAccount`. Upserts the tie and writes an audit row. |
| `cockpit_media_scope(text, text)` (replaced) | unchanged grants | The live body plus one branch. When no live campaign row has the name, the operation is campaign-scoped (`control.setStatus`, `edit.*`, `board.setAdStatus`, `board.setAdvertisingCities`, `funnel.read`, `forms.*`), and exactly one `cockpit_launches` row in `built` or `switched_on` has that `campaign_name`, it returns the scope from the launch (`campaign`, `account`, `task = card_task_id`, `client`, `campaignName`, `launch`) after the same seat checks. Two such launches raise "Campaign is missing or ambiguous; refresh the campaign source". Nothing else in the function changes. |
| `cockpit_media_action_effects()` (replaced) | trigger, unchanged | The live body plus launch branches, following its b2bLaunch draft pattern. On `confirmed`: `launch.copy`, `launch.rebuild` and `launch.new` insert `cockpit_launches` (state `built`). Ids come from `NEW.result` only and must look like Meta ids, or the trigger raises, as the b2b branch does. `launch.switchOn` updates the launch to `switched_on` (or inserts a `switch_on` launch for an existing campaign) and sets `switched_on_at`. Each state change writes one `cockpit_audit_log` row. On `reconcile`, a launch build marks its launch `reconcile` with "Launch outcome needs reconciliation. Do not launch again." The note list gains: `launch.switchOn` "Switched the campaign on", `launch.copy` "Created a paused copy of the campaign", `launch.rebuild` "Rebuilt the campaign on a clean ad account, paused", `launch.new` "Created the launch campaign, paused", `launch.attachAccount` "Linked the ad account to the client". All of them except attach count as `learning`, so these messages reach the ClickUp change log (`provider_action`). |

### 3.2 `cockpit-media-api`

- **New file `launchDesk.ts`**: `LAUNCH_DESK_OPERATIONS`, `prepareReadiness`, `prepareSwitchOn`, `prepareCopy`, `prepareRebuild`, `prepareNew`, `prepareAttach`, `copyIdeasForClient`, and `launchGuards(checks, route)`, which returns the first `block` sentence. It reuses `cleanTargeting` (`b2b.ts`), `copyableSpec`, `setCopy` and `destinationLink` (`metaCreative.ts`), `accountCurrency` and `usdToBudget`, the creative upload steps (`creative.ts`), `pages()` and `withForm` (`funnel.ts`), `executePlan` (`execute.ts`), and `assertObjectScope`, keyed on the scope account. Every Meta object a step touches is read first and checked against `scope.account` (and `scope.launch` for switch-on).
- **`core.ts`**: add the seven ops to `OPERATIONS` and route `launch.*` to `launchDesk.ts`. Factor out `boardCardBody` (2.2).
- **`index.ts`** gets four small changes:
  1. `scopeCall` calls `cockpit_media_account_scope` for `launch.*`.
  2. `LAUNCH_APPLY !== 'on'` turns any `launch.*` write into the dry-run answer, with the message from 2.5.
  3. The intent row's `campaign_name` comes from `plan.result.campaignName` for launch ops.
  4. `launch.attachAccount` follows the `board.dismissOffBoard` branch shape: Meta GETs, an intent row, `cockpit_launch_attach`, then finish.
- **`metaCreative.ts`**: `explainMeta` gains 4841021 and #200 (2.3).
- **The model**: `launch.copyIdeas` calls `model.ts` with the client build prompt, moved from `cockpit-creative-api/build.ts` into a shared module both functions bundle. It returns 3 to 5 variants that the media buyer approves into the plan.

`OPERATIONS` count: `launch.readiness`, `launch.copyIdeas` (reads), and `launch.switchOn`, `launch.copy`, `launch.rebuild`, `launch.new`, `launch.attachAccount` (writes). In the browser, `cockpitApi.ts` adds the reads to `MEDIA_READS` and the writes to `MEDIA_WRITES`. `mediaActionsClient.ts` keeps its durable request id. A new `launchClient.ts` calls the RPCs and passes `apply: false` for previews and `check: true` for Check with Meta.

### 3.3 The ClickUp change log

`clickup-writeback/rules.ts` `cardFor(campaignName, campaigns)` gains two fallbacks, in order: the launch's `card_task_id` (read from `cockpit_launches` by campaign name), then the client's card on Clients - Mahara 901816559981 (`cockpit_board_clients.clickup_id`). The run mode stays as it is (`log` = `apply_limited`). No new task is ever created by the writeback. The launch's own card step makes the card.

### 3.4 What is reused, not rebuilt

The intent row, scope re-check, receipt, reconcile and health ledger (`index.ts`, `tools.ts`); `executePlan`; the currency helpers; the card body; the creative upload; Page tokens and lead forms; the native creative import (`assist.run` kind `creative`); `cockpit_finish_media_action`; and the writeback queue. The client build in `cockpit-creative-api` (USD only, no ads) is not used by the desk and is left as it is (see 6.2).

---

## 4. Design plan

### 4.1 Subject, audience, the page's one job

The subject is Mahara's client book, seen from the media buyer's desk: who is about to go live, who stopped, and why. The audience is a media buyer at a laptop (1440) or a wide screen (1920), and the CEO reading over their shoulder. The page's one job is to get each client from "not spending" to its first impressions without a ClickUp scavenger hunt.

### 4.2 Tokens (the cockpit's own system, extended, never a second palette)

| Token | Value (dark, the default) | Use |
|---|---|---|
| `--background` | Deep Space `#091333` | canvas |
| `--card` | `#0f1b45` | lanes, plate, plan |
| `--mahara-teal` / `--primary` | `#00CFC8` | the line's live segment, the station being read, focus, the one primary per view, the In Ads terminal (with `glow-teal`) |
| `--ceo-warning` | `#fb923c` | warnings, and the return arc |
| `--ceo-critical` | `#f87171` | blocks (unpaid, disabled, closed, access gone) |
| `--success` | emerald-400 | Active, Meta checked |
| new `--launch-track` | `color-mix(in oklch, var(--foreground) 14%, transparent)` | the track and empty station rings |
| new `--launch-return` | `color-mix(in oklch, var(--ceo-warning) 55%, transparent)` | the dashed return arc |

The new tokens live in `src/components/launch/launch.css`, with light values derived the same way. Colour sits on dots, rings and icons, never on words. Royal Blue appears only inside the terminal node's 135deg gradient.

### 4.3 Type

Geist for everything and Geist Mono for small uppercase labels, ids and dates, as `docs/DESIGN.md` says. The repo's brand rule wins over the skill's "characterful display face", so the personality comes from scale and the mono station labels:

- station counts: Geist 24px semibold, tabular
- station labels: Geist Mono 11px uppercase, letter-spacing 0.08em, muted
- station rules: 13px muted, one line
- page h1: `text-2xl font-semibold tracking-tight`
- lane title: 15px semibold with its count
- lane rule: 13px muted, 4px under the title
- row name: 14px medium
- row facts: 13px
- account ids and dates: Geist Mono 12px

Headings are never italic, and everything is sentence case.

### 4.4 Layout

```
1440 (content ≈ 1120 with the rail open)
┌───────────────────────────────────────────────────────────────────────────────┐
│ Launch                                                    [ Find any client ⌕ ]│
│ Every client you can launch or relaunch, from onboarding to first spend.       │
├───────────────────────────────────────────────────────────────────────────────┤
│        ╭────────── NO SPEND FOR 7 DAYS ───────────────────────────────╮        │  ← return arc
│  ○─────────────○─────────────●──────────────○──────────────────◉ ›    │        │  ← the launch line (sticky)
│  8            0             6             0                 14              │
│  IN ONBOARDING READY TO LAUNCH NOTHING RUNNING WAITING FOR SPEND IN ADS        │
├───────────────────────────────────────────────────────────────────────────────┤
│ In onboarding 4 · Card at Blueprint booked or later                           │
│ ─────────────────────────────────────────────────────────────────────────── │
│ ▢ Client           │ Ad account          │ Last ran │ Still missing  │ Next   │
│ ▢ Makers           │ No ad account linked│ Never    │ Part 1 · Acct  │ Open › │
│ … Ghosted (4)  Show                                                         │
│                                                                               │
│ Ready to launch 0 · Blueprint part 1 sent or a launch task open               │
│   (empty state)                                                               │
│                                                                               │
│ Nothing running 6 · Active or paused, no spend in 7 days                      │
│ ▢ ARCWANI          │ ● Unpaid balance …8250 │ 9 Oct │ Outsiders on it │[Move to a clean account]│
│ ▢ SAFAD            │ ● Active …9300       │ 20 Oct │ Not spending    │[Check why…]│
│ …                                                                             │
│ Waiting for first spend 0 · Created or switched on, no spend yet              │
└───────────────────────────────────────────────────────────────────────────────┘
```

- **1440**: the page root is `max-w-[1440px]` (a wide data page). Lanes are stacked full-width cards (`space-y-6`). Each row is a five-column grid: `minmax(0,1.3fr) minmax(0,1.3fr) 7rem minmax(0,1.5fr) auto`. Each lane shows its first 5 rows and "Show the other N". The ghosted onboarding clients fold into one line.
- **1920**: the same root, centered (content 1440). The lane card is a size container. From `@[72rem]` a sixth column, **Ads card** (the card's name and Ad Status, or "No ads card"), appears between Last ran and What blocks it, and the line's station rules show in full. The client page's past campaigns table gains the made-by, ad sets and active ads columns.
- **The client page**: at 1440, a `grid-cols-12 gap-6` with the plan on the left (8 columns) and the account plate, brief and cards on the right (4). At 1920 the same split, wider. Below 1024 the right column comes first, then the plan.
- **Below 1024** (the `docs/DESIGN.md` check at 390 and 820): the line becomes a sideways-scrolling row of five compact station chips (count and label, the arc hidden, with a note under Nothing running: "includes clients that left Ads"). Rows stack: name, account line, last ran with the blocker, then the action at full width. There is no sideways page scroll.

### 4.5 The signature: the launch line

- A 2px track crosses the strip, with five stations on a five-column grid. A station with clients has a teal ring, an empty one a track-coloured ring. The station whose lane is being read is a filled teal lamp, the rail's own `.cockpit-nav-lamp` motif laid on its side.
- The **In Ads** terminal is filled teal with `glow-teal`, the page's one featured element. It shows the count of clients in Ads and a trailing ChevronRight to `/ads`.
- The **return arc** is an inline SVG path from In Ads back over the track to Nothing running: dashed 1.5px `--launch-return`, with the mono label "NO SPEND FOR 7 DAYS" at its crest. It is the one place the page shows that clients fall back from Ads, which is the reason the CEO asked for the desk.
- The strip is the page's contents bar (`docs/DESIGN.md`, Pages). It sticks under the shell with an opaque background (`linear-gradient(var(--accent), var(--accent)), var(--card)`). Each station is a button that scrolls to its lane (`aria-controls`) with a visible teal focus ring, and an IntersectionObserver lights the station being read, as `ResultsLayout.tsx` does.

### 4.6 Motion

There is one moment. On the first load in a session, the track's live segment draws from the first station to the last occupied one, 320ms ease-out (stroke-dashoffset). When a press confirms, that client's row fades and slides 8px toward the next lane (200ms) and the counts update. `prefers-reduced-motion`: neither runs. Nothing loops and nothing pulses.

### 4.7 Empty and error states (plain words)

| Where | Text |
|---|---|
| The read failed | "The launch list could not load. Refresh the page; if it stays, the client board sync may be down." Action: **Refresh** |
| A source is stale | The page's one status line: "Client board read 2 hours ago" (only when over 1 hour; the media feed's own `cockpit_media_source_state` age, likewise) |
| The seat has no clients | "Your seat has no clients yet. Ask the CEO to add them in Team." |
| In onboarding, empty | "No client is in onboarding. A client appears here when its card moves to Brand Blueprint booked." |
| Ready to launch, empty | "No launch brief is waiting. A client lands here when the creative director sends Blueprint part 1, or a launch task opens on Marketing / ADs." |
| Nothing running, empty | "Every active client has a campaign running." |
| Waiting, empty | "No launch is waiting for its first spend." |
| Readiness failed | "Meta did not answer for this account: {explainMeta words}. Nothing can be checked or created until it does." Action: **Check again** |
| No past campaigns | "No campaign has run on this account in 120 days. Launch new from the brief." |
| No visible account to link | "No account shared with Mahara looks like this client's. Ask the CSM to get it shared." |
| Plan refused by Meta | the step's line in critical tone with Meta's words. "Create it paused" stays disabled: "Meta refused part of this plan. Change it, then check again." |
| Receipt in reconcile | "This launch may have reached Meta. Do not launch again; the CEO reconciles it." (the existing reconcile wording) |

### 4.8 Critique of the plan, and what changed

- The first draft was a four-column kanban with stat tiles above it ("8 / 0 / 6 / 0"). That is the template answer: the big-number tile row, plus columns about 220px wide at 1440, where five facts per row would wrap into a mess. **Changed:** the tiles became the launch line, which carries the counts and the sequence once. The columns became stacked lanes, whose rows read like a table.
- The line could have read as decorative "subway" chrome. **Kept**, because every station is a lane, its numbers are real counts from one read, and the return arc encodes a true rule found in the code, not an ornament.
- Numbered steps appear only in the plan, where order is the execution order.
- Hallmark gates checked at build time: honest copy (no invented numbers; fixtures are labelled made-up), locked tokens (every colour from a named token), no re-drawn chrome, no italic headings, 320 to 768 responsiveness, and a pre-emit critique stamped in `launch.css` (`/* Hallmark · pre-emit critique: P_ H_ E_ S_ R_ V_ */`) after the screenshots. Humanizer runs over the English copy.

---

## 5. Tests, fixtures and verification

### 5.1 Tests (synthetic fixtures, no client data, fakes for every provider)

**PGlite**, `apps/media-buyer-cockpit/scripts/launch-desk-supabase.test.ts`, on the real migrations in production order via `scripts/lib/cockpitTestDb.ts`:
- the migration applies twice
- `authenticated` cannot SELECT `cockpit_launches` or `cockpit_meta_people`, and can EXECUTE the pipeline, the scope and the action function. `anon` can do neither.
- the lane rule for each fixture state in 5.2, including "a missing account state row is `null`, never 1", "Stopped is search-only", "Cancelled is absent" and "a client in Ads with a waiting launch shows in both"
- seat filtering by `m.clients`, and refusal without membership or the media buyer role
- scope refusals: account not the client's; a client Stopped for writes; a `p_launch` of another client; an unpaid account refused with the exact sentence
- the effects trigger: a launch is created only on `confirmed`, only from `result` ids, raises on a non-Meta id, writes one audit row per state change, marks `reconcile`, and adds the action message notes
- the `cockpit_media_scope` launch fallback, plus a regression run of the existing scope cases unchanged
- `cockpit_launch_attach` refuses without a pending action row

**Deno, fake `Provider`**, `supabase/functions/cockpit-media-api/launchDesk.test.ts`. The provider shifts canned rows and throws on any unexpected call, so "no POST" is proven:
- readiness wording for statuses 1, 2, 3, 7, 9, 100 and 101, #200, a missing row, no funding, prepay empty, outsiders, a name collision and a missing caller
- refusals fire before any non-GET call
- switch on runs ads, then ad sets, then the campaign last, refuses an outsider's or unknown-creator campaign, and refuses an excluded ad
- copy creates PAUSED bodies only, follows the CBO rule (no ad set budget or bid), sends cleaned targeting, converts SAR ($30 → 11253), refuses KWD, refuses a media buyer over 2x the contract or $100 without one, allows the founder, and adds the name suffix on a collision
- rebuild reuses no source creative id, copies images with `copy_from`, strips custom audiences, and keeps the same Page and lead form
- new builds from a brief fixture
- `check: true` sends `validate_only`, and `check.ready = false` blocks apply
- `LAUNCH_APPLY` unset returns a dry run even with `apply: true`
- a read-back failure stops the plan and leaves `reconcile`, and no write is retried
- the card step's body (name equals the campaign, tag, Ad Status Paused)
- `explainMeta` maps 4841021 and #200

**Other tests**:
- `clickup-writeback`: `cardFor` falls back to the launch card, then to the client card.
- Bun, pure, `scripts/launch-model.test.ts`: status words, next action per situation, lane sort (launchable first, then waiting on others, then no account), budget words, contracted-budget source order.
- Bun, render, `scripts/launch-screen.test.tsx`: every empty and error state's text; every row has exactly one action; one teal primary per view; the Ads "Nothing running" tab count equals the lane; "Just launched" hides once the campaign row exists.
- Unchanged and re-run: `ads-filters.test.ts`, `client-range.test.ts`, `campaign-builds-supabase.test.ts`, `board-screen.test.tsx`. Run each file on its own.

### 5.2 Harness fixture states

New files: `src/dev/launchHarness.ts` and `launchFixture.ts`. They answer `cockpit_launch_pipeline` and `cockpit_launch_action`, and stub `functions.invoke('cockpit-media-api')` for `launch.*` with dry-run plans, confirmed receipts and refusals (the pattern of `boardHarness.ts:38-130`). `adsPageHarness.ts` gains the pipeline RPC and the same invoke stub for the new Ads tab and the Just launched group. Entry: `harness.html?path=/launch&fixture=<state>`, plus `?path=/launch%3Fclient%3D<id>` and `&rehearse=1`. The clients are made up (for example "Harbour Fitout", "Dune Interiors") and labelled so.

| # | State | Shows |
|---|---|---|
| 1 | `onboarding-booked` | missing chips: part 1, account, caller |
| 2 | `onboarding-ghosted` ×4 | folded line |
| 3 | `ready-brief` | part 1 in, healthy account, caller, pack: **Launch** |
| 4 | `ready-no-account` | **Link an ad account** |
| 5 | `paused-unpaid-compromised` | unpaid, outsiders, waiting campaigns: **Move to a clean account** |
| 6 | `paused-unpaid-collision` | two campaigns with one name |
| 7 | `paused-healthy-not-spending` | **Check why it is not spending** |
| 8 | `paused-healthy-relaunch` | a paused Mahara campaign: **Relaunch** |
| 9 | `active-no-account` | **Link an ad account**, no likely account |
| 10 | `not-in-hourly-read` | "Not in Meta's hourly read"; the client page reads it live |
| 11 | `sar-account` | the budget conversion in words |
| 12 | `kwd-account` | the currency block |
| 13 | `two-accounts` | the account picker |
| 14 | `waiting-built` | **Switch on** |
| 15 | `waiting-fresh` | switched on 2 h ago |
| 16 | `waiting-stuck` | 26 h, critical |
| 17 | `just-launched` | the Ads Running "Just launched" group and panel |
| 18 | `stopped` | search-only, read-only |
| 19 | `no-clients` | the seat empty state |
| 20 | `read-failed` | the error state |
| 21 | `apply-off` | the rehearsal banner, plan-only presses |
| 22 | `meta-refused` | a refused step, apply disabled |
| 23 | `empty-lanes` | each lane's empty state |

### 5.3 How we know it works, with no Meta or ClickUp write

1. `tsc -b` in `apps/media-buyer-cockpit`. Then the bun tests file by file, the deno tests in `cockpit-media-api` and `clickup-writeback`, and the PGlite tests. `scripts/check-shared.sh` passes and no pinned file is touched.
2. Harness shots of every state in 5.2 at 1440x900 and 1920x1080, plus 390 and 820 for the `docs/DESIGN.md` check. Dark, JPEG quality 75, system Chrome. Each is read, then deleted. Hallmark slop test and the pre-emit stamp follow.
3. A live check of the read, after the shipper applies the migration (the builder never applies it). Run the pipeline's lane query read-only and compare its counts with the maps: In onboarding 8, Ready 0, Nothing running 6 (the six named in 1.2), Waiting 0, In Ads 14, where In Ads equals the distinct clients behind `cockpit_media_live_campaigns()`. That is the second source.
4. A live plan check, GETs only. With `LAUNCH_APPLY` unset, call `launch.readiness` and `launch.copy` without `apply` and **without `check`** for a healthy account (SAFAD) and an unpaid one (ARCWANI). The first shows a plan from GETs. The second is refused with the `unpaid` and `outsiders` sentences before any intent row. `cockpit_media_actions` gains no row, and `cockpit_media_provider_health` shows GETs only.
5. Check with Meta (`validate_only`) is tested with fakes only in this build. Its first live run, and the first real launch, wait for the CEO to set `LAUNCH_APPLY` (6.3).
6. ClickUp: the card and change-log steps appear only in plans and in fake-provider tests. The writeback's `cardFor` fallback is tested with fixtures.

---

## 6. Shipping, scope and defaults

### 6.1 Build order

1. The migration and its PGlite tests.
2. `launchDesk.ts`, the `core.ts` and `index.ts` changes, `explainMeta`, and the deno tests.
3. `launchClient.ts` and `launchModel.ts`, with tests.
4. The Launch page, client page and launch line, the harness, and shots.
5. The Ads tab, the Just launched group, the account page action, the nav, and the Today link.
6. The `clickup-writeback` fallback.
7. The verification in 5.3.

### 6.2 Not in scope (v1)

- Changing the $0.50 rule or `sync.store` in `hermes/cockpit-sync`. That needs a native release. The desk and the Just launched group cover the gap instead.
- Pausing outsiders' objects on a compromised account from the cockpit. Meta refuses writes there until payment anyway.
- WhatsApp as a destination. Interest targeting by name. Using another client's winners as media.
- A Slack alarm for a stuck launch (v1 shows it on the desk and in Ads).
- An editor screen for `cockpit_meta_people` (edited by migration).
- Account names in `cockpit_meta_account_state` (a worker change).
- Fixing the old client build's USD-only and no-ads gaps in `cockpit-creative-api`. The desk replaces it for every client. Retiring BuildPanel's "Launch it paused" is a follow-up.
- Automatic actions when a client pays: the desk prepares the plan, and a person presses it.

### 6.3 Ship steps (for the person who ships; the builder runs none)

Apply the migration. Deploy `cockpit-media-api` and `clickup-writeback` with `LAUNCH_APPLY` unset. Ship the media buyer app with `scripts/ship.sh`. Run 5.3 step 3 on production. When the CEO approves, set `LAUNCH_APPLY=on` and run SAFAD's switch-on as the first real launch. Log the defaults below in mahara-context `context/DECISIONS.md` and record the session.

### 6.4 Defaults the CEO can correct

1. Launch is a fourth place in the rail (`/launch`), not a tab inside Ads.
2. Ready to launch needs Blueprint part 1 or an open launch task. A card stage of "Ready For Launch" alone does not count.
3. Stopped and Ghosting clients are search-only and read-only until the CSM marks them Active.
4. A relaunch is refused on an account where outsiders' campaigns are switched on, and the desk offers the clean-account route. An unknown creator counts as not ours.
5. Budget defaults to the contracted daily amount. A media buyer seat may go to 2x that, or $100 a day when none is contracted. The CEO may go to $5,000.
6. Everything is created PAUSED. Switch on is a second press with its own preview, and it runs ads, ad sets, then the campaign.
7. "Live" means first impressions, not switched on. More than 24 hours without impressions turns the row critical.
8. A launch makes its own Ads Managment card, named exactly as the campaign, Ad Status Paused until Switch on.
9. Campaign names follow `{client} |MAHARA| {d}\{m}`, with a letter added on a collision.
10. Writes stay plan-only until `LAUNCH_APPLY` is set on the server.
11. Ads gets a "Nothing running" tab. "Off the board" keeps its meaning (the card says off).
