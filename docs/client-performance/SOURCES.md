# Client Performance board: sources of truth

Every column of the shared Client Performance board, where its number comes
from, what it is checked against, the exact rule, how fresh it is, what it
covers today, what is still wrong and who fixes it. At the end, the
second-source check of 16 October 2026, client by metric.

The CEO asked for this on 16 October 2026: "check the numbers and even make it
better and more accurate the data and tell me all sources of truth". Three
read-only checks compared the stored numbers with Meta, the dialer's own
report, the lead sync watch, each client's own tracking sheet (read live in
Google Sheets) and the ClickUp client roster. What they found is fixed in four
migrations, one Edge Function change and two worker changes (see "What
changed on 16 October"); what needs a person is listed under "What is left".

On 21 October 2026 the CEO asked: "make sure it shows the cost per booking
correctly for all". The audit of that day
(`docs/client-performance/CPB-AUDIT-20261021.md`) found the board the closest
surface and twenty faults across the cockpits (R1 to R20); the fixes are
recorded in `docs/client-performance/CPB-20261021.md`. The rule every screen
is checked against is "Cost per booking" below, with "Lead to booking" and
"ROAS" beside it, and "What changed on 21 and 22 October" lists what moved.

On 23 October 2026 the CEO answered the five questions build 2 left open
(`docs/client-performance/CPB-DECISIONS-20261023.md`). SAFAD's two
outsider ads go on the compromise list (D0a). A done-with-you client keeps its
cost per lead but is never judged on cost per booking, and its spend leaves
every portfolio cost per booking (decision 2). ClickUp's "911" starts over $80
(decision 3). Spend with no lead is off at 2 x the cost per lead line and too
few to judge under it (decision 4). Triple Edge is a churned client
(decision 5). "What changed on 23 October" lists what moves; section 10 of
`CPB-20261021.md` records the ship.

Roles, not names: the CEO, client success, the media buyer, the systems
manager, the call-centre lead, and the board team (the team building the
board's read functions and screen).

## How the numbers flow

| Source | Read by | Stored in |
| --- | --- | --- |
| Meta Marketing API (Graph v25.0, Mahara's business 767701513092162, the system-user token) | Edge Function `meta-ad-days`: hourly at minute 7, nightly at 03:20 Kuwait | `cockpit_meta_ad_days` (one row per ad per ad-account day), `cockpit_meta_reach` (reach over windows), `cockpit_meta_lead_ids` (lead ids and times only) |
| Meta budgets (`act_<id>/campaigns` with its ad sets and ads' statuses; `act_<id>/activities` for the days before) | the same `meta-ad-days`: budgets every hour, 5 minutes after the run starts, for the accounts that spent and every account tied to an Active client; the history nightly (14 days) and on a backfill; every run's listing of the accounts with no spend | `cockpit_meta_budgets` (now), `cockpit_meta_budget_days` (per campaign per account day, switched on), `cockpit_meta_budget_account_days` (which account days were read), `cockpit_meta_account_state` (status, spending limit or prepaid balance), `cockpit_meta_spend_reads` (the account days whose spend Meta answered, $0 included); on the board through `cockpit_board_budget_cells` and `cockpit_board_budget_list` (2026-10-17) |
| GoHighLevel contacts and appointments | `mahara-ghl-leads` (:35) and `mahara-ghl-appointments` (:20) | `client_leads`, `appointments`, `ghl_calendars` |
| The dialer (call-centre console and Maqsam) | its own syncs | `mahara_reporting` views (`call_center_events`, `cc_results`, `cc_attempts`, `sheet_snapshots`), `mahara_console` |
| Each client's tracking sheet | the dialer's sheet reader (about every 4 minutes) and the CSM copy (native feed, every 15 minutes) | `mahara_reporting.sheet_snapshots`, `cockpit_csm_sources` clientProfiles |
| The client portal (outcomes the client types) | portal sync | `portal_data.appointment_outcomes` |
| ClickUp client cards (the CSM roster) | native feed | `cockpit_csm_sources` table `clients` |
| All of the business sources above | `cockpit_board_facts_refresh` inside the database, at minutes 2 and 32 (3 days, since 19 Oct `20261019141000_board_facts_schedule.sql`) and 03:50 Kuwait (120 days) | `cockpit_board_clients` (the client spine), `cockpit_client_days` (per client per Kuwait day), `cockpit_client_now` (the call centre now) |

## Rules every column follows

- **Missing is never zero.** NULL means no source could say (a failed read, a
  client who does not fill the field, a day after a sync's last read, a
  client the dialer does not serve). 0 means a source read the day and found
  nothing. The board must show NULL as "unknown" or a dash, never as 0, and
  never colour it against a target.
- **Two calendars.** Ad numbers use each ad account's own day (Meta counts
  them that way; Atlantis's account is on Los Angeles time, 10 hours behind
  Kuwait in October and 11 from November). CRM, booking, sheet and call numbers use Kuwait days.
- **Windows.** The five reach windows (last 7, 14 and 30 days, this month,
  last month) end today, the way the cockpits' reporting periods count them.
  `last_7_full` and `last_30_full` end yesterday, the last complete day. A
  board that shows full days must sum ad-days and CRM days over the same days
  as the reach row it shows.
  Cost per booking and ROAS pair spend with the facts to yesterday on each
  ad account's own clock (see Cost per booking), so on "Last 7" they cover
  6 ad days and on "Last 30" 29.
- **Today is "so far".** Every source on a day carries `partial: true` while
  its last read is before the day ended. Show "so far, as of HH:MM Kuwait"
  and no rates or target colours on a partial day. The dialer's dials are
  read live by each refresh, so its `as_of` is the refresh's read, and the
  newest saved attempt is kept apart as `lastAttemptAt` (activity, not a
  read). The portal's outcomes carry no `partial`: their `as_of` is the
  client's latest report.
- **Ratios are ratios of sums** over the same rows, never averages of daily
  or per-account ratios.
- **A stale source never lowers a closed day**; a complete read may, and the
  refresh's audit row lists each drop.
- **Ads on the compromise list never count** (since 21 Oct 2026,
  `20261021a_board_skip_excluded_ads.sql`). `cockpit_excluded_ads` lists the
  ads that outsiders placed during the October 2026 Meta compromise: 23 ads
  since 23 Oct (`20261010a`, `20261021b` and `20261023p`, which adds SAFAD's
  two, decision D0a; 21 before), the same 23 as the worker's
  `EXCLUDED_AD_IDS`. They are
  matched on the ad id alone, as the media sync (`withoutExcludedAds`) and the
  dashboard feed's snapshot trigger match them: Meta's ad ids are unique, so
  the account the list writes beside an ad does not matter. They leave every
  ad figure: the rows, the tree, the spend outside the rows, Budget used's
  campaign-days and the pay facts. So the board reads below Meta's account
  total in Ads Manager by the listed ads' spend. Meta reads reach per
  account, so one ad cannot be taken out of it: when a listed ad delivered on
  a client's accounts in the time frame, the client row leaves Meta's reach
  out, and its frequency is the impression-weighted daily frequency of the
  client's own ads, with a note that says why (see Frequency). A new
  outsider's ad counts until it is listed: add it in a migration, together
  with `EXCLUDED_AD_IDS` in `hermes/cockpit-sync/excludedAds.ts`.
  - **An outsiders' campaign** is one the list names whose stored ads are all
    on it. Its budget leaves the sums in Budget/day and Budget used with its
    spend, but while it is switched on it is never hidden. Budget/day's note
    says it ("2 outsiders' campaigns on the compromise list are switched on
    at $7,260.00 a day, not counted: switch them off in Meta.") and the cell
    carries `outsiders` (`campaigns`, `budget`, `atLeast`). The board's budget
    line names the client first, under "Outsiders' campaigns switched on". The
    client page's budget list keeps the campaign as a row flagged off, with
    its daily budget in the words and no figures. One on a lifetime budget
    stays in that table too, "(a lifetime budget)" in its words and no
    lifetime figures, never in the client's own "On a lifetime budget" list.
    A campaign that also runs a client's own ad is the client's and keeps its
    budget.
  - **The ad account is read as Meta runs it.** An outsiders' campaign
    switched on keeps its account "in use", so a payment due or a closed
    account is still said. The days of spending limit or prepaid balance left
    count its budget too, because Meta spends the limit on it.
  - **Checked on live data on 21 Oct**, in a transaction that was rolled back.
    Khalida's September spend went from $594.09 to $404.26 (−$189.83).
    October to the 20th went from $1,704.74 to $262.44 (−$1,442.30). Liwan
    went from $1,063.77 to $946.94 in September and from $1,379.53 to $194.58
    in October. ARCWANI went from $832.63 to $791.81 and from $418.97 to
    $151.40. Each equals the store's own sum without the listed ads.
  - **Budget/day.** Liwan's went from $7,260 to $0. Its note now says "2
    outsiders' campaigns on the compromise list are switched on at $7,260.00
    a day", the total only, beside "Account unsettled: payment needed"; the
    client page's budget list shows each ($6,220 and $1,040 a day).
    ARCWANI's went from $1,109 to $35, and its note says 1 outsider's
    campaign is switched on at $1,074.00 a day. Both accounts still read
    "Account unsettled".
  - **Frequency, 1 to 21 Oct.** Meta's reach for Liwan's accounts covered
    460,096 impressions, and the client's own ads made 7,119 of them to
    yesterday, so about 98% were the outsiders'. ARCWANI: 123,783 and 7,418
    (about 94%). Khalida: 106,650 and 7,963 (about 91%). So the rows no
    longer use it: Liwan 1.30 -> 1.12, ARCWANI 1.28 -> 1.12, Khalida 1.19 ->
    1.08, each the client's own ads' average daily frequency (checked live in
    a rolled-back transaction).
  - **Spend outside the rows.** Ideal Elite's $578.62 is an outsider's
    campaign on the list, and Rm decor's $127.38 is a listed ad ("What is
    left" below). Both leave it.
  - **All Active clients' October spend to the 20th** went from $10,578.42 to
    $7,683.60 (Khalida −$1,442.30, Liwan −$1,184.95, ARCWANI −$267.57).
  - **Listed by `20261021b` (21 Oct, 15:44 Kuwait).** Khalida's "29/8 -
    Copy" (ad 120247012327250088, $70.91, a $9,220 daily budget) and "New
    Engagement Campaign" (ad 120247083365360088, $0 stored, $525 a day) are
    on the list, so Khalida's October to the 20th reads $191.53 and Budget
    used 34.2% ($191.53 / $560; the board as the CEO seat on 23 Oct). It
    read $262.44 and 0.56% ($262.44 / $47,185) before.
  - **SAFAD's two outsider ads (decision D0a, 23 Oct,
    `20261023p_exclude_safad_unauthorized_ads.sql`).** On account
    act_774492648699300: ad 120254791600360066 (campaign 120254791600340066,
    "New Engagement Campaign", made 13 Oct by "Mercedes Garcia", Egypt,
    $375.10 on 13 to 15 Oct, no form lead) and ad 120254896955290066
    (campaign 120254896955270066, made 20 Oct by "Lucas J Ortiz", Saudi
    Arabia, no spend). The CEO's answer: "Yes". Both campaigns hold only
    listed ads, so they are outsiders' campaigns: their budget-days ($620 a
    day on 13 to 19 Oct, $555 on 20 Oct) leave Budget used and Budget/day.
    The second ad has no ad-day row, so its list row names its campaign for
    the board to take that campaign out. Listed, SAFAD reads $15.71 / 2 =
    $7.86 for 14 to 20 Oct (was $390.80 / 2 = $195.40, off) and $308.69 / 3
    = $102.90 for 1 to 20 Oct (was $683.79 / 3 = $227.93); Budget used for
    14 to 20 Oct 7.48% ($15.71 of $210, was 8.71% of $4,485) and its
    impressions 2,762 (were 484,890). Its cost per lead does not move
    ($15.71 / 3 = $5.24: the outsiders' ads had no form lead). The migration
    archives their 8 creative-dashboard rows ($375.10); `20261021d`, run once
    the worker's release (N3) has published one cycle, archives the media
    data's rows of every listed ad.

## Column by column

### Client list and status

- **Source of truth:** the ClickUp client card's stage (the CSM roster,
  `cockpit_csm_sources` table `clients`), joined on the card's task id.
  Stored in `cockpit_board_clients.status`.
- **Checked against:** the client registry (`ghl_clients.status`, kept beside
  it in `registry_status`) and the churn log.
- **Rule:** Active is Active. Brand Blueprint Booked, LAUNCH BOOKED, Ready For
  Launch and Needs Contacting are Launching. Paused is Paused. Stopped is
  Stopped (no new days), except where the registry already says Cancelled,
  which is kept. A location with no card uses the registry's status.
- **Freshness:** the roster every 15 minutes; the spine on every facts
  refresh (minutes 2 and 32).
- **On the board (since 17 Oct, `20261017090000_board_active_only.sql`):** only
  clients whose card says Active (18 on 17 Oct). Launching, Paused, Stopped
  and Ghosting clients are off the board; their spend is named under "Not in
  these totals" (reason not_active, with the status). One client's page,
  opened by its link, still reads any client not cancelled.
- **Coverage on 16 Oct:** 54 cards, 18 Active (17 in the registry: Shades was
  Launching there).
- **Gaps:** the registry disagreed with the card on 7 clients (Shades,
  Olivar Design, Uvan and Evan, شركة كيسان, Greystone; Kazak and Prime
  Project Solutions have no card). Fixed: the card wins and
  `cockpit_board_facts_doctor()->'spine'` lists `registryDisagrees` and
  `noCard`. Fixing the registry rows: client success.

### Service mode (done for you, done with you)

- **Source of truth:** the ClickUp card's service; the registry's
  `service_mode` where the card has none.
- **Rule:** DWY means the call centre does not call the client's leads: its
  dials, leads called and waiting figures are not applicable (stored NULL,
  shown as a dash). Since 23 Oct (decision 2) a DWY client is also never
  judged on cost per booking or booking rate, and its spend leaves every
  portfolio cost per booking (Cost per booking, Lead to booking). Done with
  you is `upper(btrim(service_mode)) = 'DWY'` on the board's client row; a
  blank mode is not, and today's mode applies to every window (there is no
  mode history).
- **Coverage:** 17 of 17 active agree (16 DFY, نهوض نجد DWY). Six non-active
  clients were blank in the registry and DFY on the card; fixed.

### Ad accounts tied to a client

- **Source of truth:** `cockpit_board_clients.ad_account_ids` and
  `ad_account_ties`, refreshed with the facts.
- **Rule:** a hand tie in `cockpit_board_account_ties` (cockpit-owned, each
  row with its evidence, added only in a migration) first; then
  `clients.ghl_location_id`, `ghl_client_ad_accounts`, and the client name
  (the board card's name, then the account's name) matched to one registry
  client that is not cancelled; last (since 16 Oct) the registry's own ad
  account field `ghl_clients.meta_ad_account`: a known account id written in
  it, or a name equal to exactly one Meta account's name. Accounts hidden on
  purpose (a hidden clients row) and Mahara's own two accounts are left out,
  unless tied by hand. A hand row marked `kept_out` names an account that is
  the client's but stays out of its figures: no rule ties it, and
  `meta-ad-days` lists it as "Hidden on purpose", not "Not linked".
- **The registry field, checked on live data:** it gives 19 ties; 18 agree
  with the tie already made, and the 19th is Shades, which no other step
  reached.
- **Checked against:** Meta, each account's owning business and promoted Page
  (GET only); the CRM, `client_leads.ad_id` at each location joined to
  `cockpit_meta_ad_days.ad_id` (no ad id of one client was found at
  another).
- **Coverage after the hand ties:** every spending active client has its
  accounts tied except Professional Touch, whose account is not shared with
  Mahara's business.
- **Hand ties added on 16 Oct** (`20261016210200_board_account_ties.sql`):
  Shades 762687672022667 (account and campaign names, registry account name);
  Ardon 718146936708597 (was tied by the card name only); Pidco
  134992869555229 and AEA Designs 854779610674376, both cancelled, for the
  history.
- **Kept out on purpose:** Alkhalil's SAR account 640644143620696. It sits in
  the client's own Meta business, but all 13 of its campaigns are the
  client's Instagram post boosts (2021 to the one since 12 Oct), none
  Mahara's; Mahara's Alkhalil work runs on 1649852845764859. Tied, it would
  have moved Alkhalil's 9 to 15 Oct spend from $94.30 to $174.06, impressions
  from 5,890 to 28,590, link CTR from 1.73% to 0.48% and CPM from $16.01 to
  $6.09. Its row is `kept_out`; set it to tied only if the media buyer
  confirms Mahara manages the account.
- **A churned client's account (decision 5, 23 Oct):** Triple Edge Building
  Construction 2002793296961811. The CEO: "triple edge is a old churned
  client". Its only ClickUp card (86ex3n15w) is archived, and it has no
  GoHighLevel location, no board row and no hand tie. A hand table,
  `public.cockpit_churned_ad_accounts` (`20261023q_churned_ad_accounts.sql`),
  names it; rows are added or removed only by a migration, with the evidence
  in the row (RUNBOOK.md, Meta ad-days). It is read only when no live tie
  exists: a board row, a hand tie or a GoHighLevel tie always wins, so a
  client who comes back reads as live once it is tied again; its row is then
  deleted in a migration. The account is in no client's figures; the board names its spend under "Not in these
  totals" as "churned client" (`20261023t`), the Meta ad-days notes under
  "Spent for a cancelled, stopped or churned client" (`20261023u`), never
  "Not linked to a client", and CEO Delivery leaves it out of its client rows,
  statuses and "Clients off track" and names its spend as a churned client's
  (native release N3). Its spend stays in company spend, leads and cost per
  lead, as a cancelled client's does: $11.13 on 11 to 18 Aug and $16.71 in
  October 2026, on Meta Page "Promote" campaigns (read only on 23 Oct).
  `clients.hidden_from_dashboard` and `clients.is_active` are left as they
  are: either would drop its spend silently.
- **Left out on purpose (unsure):** Art Vision 750052678056652 (no client
  record), ريبالو/ORB 827972432407411 (hidden; probably the Ocean Home
  owner's other brand). See "What is left".

### TikTok

- **Source of truth:** stored TikTok advertisers or accounts (`clients`,
  `ghl_clients.tiktok_ad_account`) and the card's Ads Platform.
- **Rule:** a flagged client's spend, CPL, cost per booking and ROAS are "Meta
  only": no TikTok spend is read anywhere. Cost per booking then divides Meta
  spend by every confirmed booking, the ones TikTok bought included, so it
  reads low while TikTok spends; the row's note says "Meta only".
- **Gaps:** Joe and Sera is flagged (a stored TikTok advertiser) while its card
  says Facebook/Meta; نهوض نجد's card says Tiktok and is now flagged. Client
  success confirms both.

### Spend (account currency and USD)

- **Source of truth:** `cockpit_meta_ad_days.spend` and `spend_usd`.
- **Checked against:** Meta account insights for the same account days
  (16 Oct: 27 accounts over 30 and 7 days, equal to the cent apart from one
  cent still settling on SAFAD and Shades; the 90-day backfill equal on 32
  accounts).
- **Rule:** spend as Meta reports it. `spend_usd = spend x` the cockpit's
  fixed rate: USD 1, KWD 3.26, AED 0.2723, SAR 0.2666, QAR 0.2747. A currency
  with no rate leaves `spend_usd` NULL, never 1 to 1. Never take spend from
  `cockpit_media_daily_stats` (it holds board-card campaigns only: 13% short
  over 30 days). The media buyer's client page reads it on purpose for
  Mahara's campaigns only, and says so (see Cost per booking).
- **Freshness:** hourly (yesterday and today); the nightly run reads the last
  28 days again because Meta settles them.
- **Coverage:** every account shared with Mahara's business that spent;
  Mahara's own account left out.
- **Gaps:** SAR and QAR rates are rounded (0.03% and 0.01% low; about $0.50 in
  30 days). Fix if wanted: the pegs 0.266667 and 0.274725 in `tap.js`
  USD_PER, `calculator.ts` FX and both SQL rate functions together (the
  tests pin them): systems manager. Professional Touch's account cannot be
  read. TikTok is not read.

### Daily budget and budget used

The CEO, 17 October 2026: "the daily budget of all the campaigns in the
account and then how much is actually being spent. Sometimes the campaign
isnt spending as much as the budget, or its not spending enough." Three Ads
columns sit after Spend: **Budget/day** and **Spend/day** (in the column
picker) and **Budget used** (a key column, judged). Each client's page has a
"Budget and spend" part between No outcome and the campaign tree.

- **Source of truth:** Meta's own budgets, read by `meta-ad-days` with the
  system-user token (GET only, Graph v25.0, a receipt per call):
  `act_<id>/campaigns` with each campaign's ad sets and its ads' statuses,
  every hour, into `cockpit_meta_budgets` (now, replaced whole at each read)
  and `cockpit_meta_budget_days` (one row per campaign per day on the ad
  account's own clock, the same calendar as `cockpit_meta_ad_days.day`). Meta
  writes budgets in the currency's minor units: they are divided by Meta's
  currency offset, exactly Meta's table (100 for USD, SAR, QAR, AED, BHD,
  VES...; 1 for JPY, KRW and the other currencies without minor units; KWD,
  OMR, LKR and MAD are not in Meta's table and are refused with a sentence,
  never assumed) and turned into USD at the cockpit's fixed rates
  (`cockpit_meta_ad_days_usd_per`; no rate: NULL, never 1 to 1). Spend is the
  Spend column's own, `cockpit_meta_ad_days.spend_usd`.
- **Checked against:** Ads Manager on Khalda, Shades and Pidco on 17 Oct
  (the parser reproduced each campaign's budget and level; Shades' 11 ended
  "ACTIVE" campaigns are correctly off), and `cockpit_campaigns.raw_data`
  for the board-card campaigns (Khalda's campaign budget $30 on both). The
  board's formulas are pinned on invented days in
  `board-api-supabase.test.ts`. Not yet checked on production: the budget
  tables are not applied (see "To make it live" below).
- **What counts as a budget (switched on):** a campaign whose status is
  ACTIVE, whose start has passed and end has not, and with at least one ad
  set the same (status ACTIVE, inside its schedule). Blocked or not: a
  campaign held back by its ads (with issues, not approved yet), by an
  unsettled or disabled account, by a spending limit or a prepaid balance
  used up is the CEO's "budget set, not spending", so it counts and shows a
  low Budget used with the reason. A campaign waiting for its start (its
  own, or every ad set switched on starts later) is not switched on yet: it
  is listed as "Starts 20 Oct", with no dot and not as a problem. An
  outsiders' campaign on the compromise list never counts: it is said
  instead (see "Ads on the compromise list never count" above).
- **Which budget:** CBO (a campaign budget) is the campaign's own budget.
  ABO (ad set budgets) is the sum of the ad sets switched on, delivering or
  not. A paused or ended ad set never counts (the media sync in
  `calculator.ts` sums every ad set when none is active: not here). Meta's
  string "0" is no budget. What is left today (`budget_remaining`) is the
  campaign's own on CBO and its counted ad sets' own on ABO (Meta's
  campaign-level figure is not their sum). A campaign waiting for its start
  shows the budget it will run on then (on ABO, its ad sets switched on or
  waiting), counted only from its start.
- **Delivering (the reason, never the filter):** the account's Meta status
  is 1 (active) or 9 (grace period), its spending limit or prepaid balance
  is not used up, the campaign and the ad set are ACTIVE and running, and
  at least one ad under it is ACTIVE. Otherwise the reason is said:
  "Account unsettled: payment needed", "Spending limit reached", "Prepaid
  balance used up: add funds", "Ads with issues", "Ads not approved yet",
  "Ended", "Paused" and the like.
- **Rule, Budget/day:** the daily budgets of the campaigns switched on now
  on the client's linked accounts, in USD; the budget now, whatever the time
  frame. Not judged. The note says how many of them are not delivering and
  why, each reason its own sentence ("1 of them is not delivering ($1,104.00
  a day). Ads with issues."; an account's own reason is said once, with the
  account's name), the lifetime budgets left out, the campaigns waiting for
  their start, and the ad accounts that need action in Meta's words. No
  campaign switched on is $0 with that sentence; budgets switched on only in
  a currency with no fixed USD rate are not measured, with the amount in
  their currency, never $0; an account whose budgets were never read is
  named ("Budgets for act_X (name) have not been read", with why when the
  last run knows: Mahara's business does not list it, or its read failed),
  never $0; one read more than 3 hours ago is named with the time.
- **Rule, Spend/day:** the Spend cell / the days that Spend covers (from the
  first day the Meta store holds, or the time frame's first day if later,
  to yesterday), with Spend's own floor (+) and partial note. Not judged.
- **Rule, Budget used:** the sum of spend / the sum of daily budgets over the
  (campaign, account day) pairs of the ad window, each day before its
  account's own today, where the campaign was switched on with a daily
  budget at any read (or moment, for the history) of that day. The day's
  budget is the highest daily budget it was switched on with that day
  (`max_switched_on_budget_usd`), so a campaign paused at noon keeps the
  budget it spent that morning against, CBO and ABO alike; a budget changed
  during the day is said. A pair with no ad-day rows is $0 only when the
  account's spend that day is known: ad-day rows that day for any of its
  campaigns, a finished `days` read covering it, or the business listing
  that found no spend on the account over a window covering it, read after
  the day had ended on the account's clock (`cockpit_meta_spend_reads`). So
  a new or blocked account that spent nothing shows 0%, off. Otherwise the
  pair is left out and said ("1 campaign-day with a daily budget is left
  out: the spend of X was not read those days"). Judged against
  `budget_used`: good at 90% and above, watch to 70%, off under 70%, judged
  from 3 days with a budget (set 2026-10-17 as a starting aim; the CEO or an
  admin can change it in Edit targets). Above 110% is a note, never a
  status. A linked account whose budgets were never read is named apart
  and makes the figure partial; the known days are counted over the
  accounts that were read, never "0 of N days". An account whose budgets
  start after the others' (added later, or its history not read) is said in
  its own sentence ("Budgets for act_X are known from 17 Oct 2026") and
  makes the figure partial; a day is known when every account whose budgets
  had started by then has it. A history day switched on whose budget the
  activity log does not show is left out and said. The help names the
  campaigns switched on but not delivering, their budgets and why, and the
  account that needs action, so the reason a budget is not spent is there
  without opening Budget/day.
- **Yesterday:** each account's own yesterday (the Los Angeles account's
  lags Kuwait's until about 10:00 Kuwait time), whatever the time frame:
  spend and budget of the campaign-days switched on with a daily budget,
  and the campaigns that spent nothing on a running budget ("1 campaign
  spent nothing yesterday"). A budget whose spend is not known yet is said
  so, never "nothing spent". One day is shown, never judged.
- **Meta's pacing rule:** Meta may spend up to 75% over a daily budget on one
  day, and no more than 7 times the daily budget in a week (Meta's pricing
  page, https://www.facebook.com/business/ads/pricing, read 17 Oct 2026; Jon
  Loomer dates Meta's in-product wording to November 2023). Meta's developer
  Budgets page still says 25%, which is out of date; the Help Center's "About
  daily budgets" page returned no text; that the week runs Sunday to Saturday
  is a third-party claim only. This is why the time frame is judged and a
  single day is not.
- **History:** from the first hourly read, every read day is stored as it
  was read (`source snapshot`, verified). The days before, any whole day no
  read covers, and on a read day the campaigns no read saw switched on (one
  paused before the day's first read), are rebuilt from Meta's activity log
  (`act_<id>/activities`: budget changes, campaign and ad set run status,
  account status) backwards from the live budgets (`source activity`), with
  the same switched-on rule. The log does not follow the ads, so these rows
  say nothing about delivery (`delivering` NULL). A row is `verified` only
  when the campaign's own chain of changes ends at its live budget and
  status; a budget whose earlier value Meta logs as 0 (or not a daily
  budget) is unknown on the days before, never $0, and not verified; an end
  time at midnight ends the day before. Pausing a campaign, or every ad set
  of an ABO one, is not a budget change; a change is a switched-on budget
  unlike another the day was switched on with. Budget used names the unverified
  campaign-days it counts. A day with no row in
  `cockpit_meta_budget_account_days` was not read: its budgets are unknown,
  and Budget used is partial ("Over the 6 of 9 days whose budgets are
  known. Budgets are stored from ...").
- **Accounts:** Meta's status in its own words, capitals kept: 2 and 201
  "Account disabled", 3 "Account unsettled: payment needed", 7 "Account
  under risk review", 8 "Payment being settled", 9 "In grace period: payment
  due", 100 "Account closing", 101 "Account closed", anything else "Meta
  account status N". On a postpaid account the spending limit and what is
  left of it; on a prepaid account (`is_prepay_account`) the same two fields
  are the funds added and the balance left, so the page says "Prepaid
  balance: $10.81 left (under a day of budget)" and never "Spending limit
  reached". An amount spent that Meta did not give, with a limit set, is
  unknown, never $0 spent.
- **The page:** every campaign switched on now, delivering or not, including
  one that spent $0 (the tree lists only campaigns with ad numbers), with
  Budget/day, Spent yesterday, Used yesterday, Spend/day and Budget used for
  the time frame, flagged first in words with a dot ("Spent nothing since 15
  Oct", "Under its budget in these days", "Ads with issues", "Account
  unsettled: payment needed"), those waiting for their start last with no
  dot; lifetime budgets listed apart with what is left and the end date, no
  percentage; campaigns switched off now that spent in the time frame
  summed; each account's status and its spending limit or prepaid balance,
  with how many days of the budgets switched on now that is. An account
  never read says why when the last run knows (Mahara's business does not
  list it, or its read failed), and the page says the budgets are read
  every hour only when nothing stops that.
- **The board's line:** under the no-outcome line, only when something needs
  action, naming who (up to three clients per issue, then "and N more"):
  clients whose campaigns spent nothing yesterday on a running budget or
  are switched on but not delivering, clients under their budget in the
  time frame, an account that needs a payment or cannot run, an account at
  or within a day of its spending limit or the end of its prepaid balance,
  and one with a payment due in its grace period (Meta status 9: it still
  delivers, so its flag is a warning, not a stop).
  "Khalda and Shades spent nothing yesterday on a running budget; Ardon's
  account has less than a day of spending limit left." It sorts the clients
  by Budget used, lowest first; an account's issue is also flagged beside
  its client's Budget used and Budget/day, with the words in their help.
- **Columns:** Budget used joined the key columns on 2026-10-17. A pick of
  columns saved before then gets it once (a version is stored with the
  pick); after the viewer takes it out, it stays out.
- **Freshness:** hourly, with a state of its own: a budgets or history read
  that fails is said in the run's note and in `status().budgets` (lastRun,
  failing, unlisted) and never makes the run partial for the ad numbers.
  The board says "Budgets were last read at HH:MM Kuwait time" when the
  newest budget read is over 3 hours old, and says so when no budget was
  ever read.
- **Leaves out:** lifetime budgets (no daily figure; listed apart), a
  campaign's ad set minimum and maximum spend under a campaign budget, bid
  caps, and budgets in a currency with no fixed USD rate (left out and
  said). An account tied to an Active client that Mahara's business does
  not list cannot be read (named on the board and in the run's note).
  Before the first listing that covers a day, a campaign on an account that
  spent nothing has no known spend for that day, so the day is left out and
  said. TikTok is not read.

### Impressions

- **Source of truth:** `cockpit_meta_ad_days.impressions`, summed over
  ad-days. **Checked against:** Meta account insights (equal on all 27
  accounts). **Freshness:** hourly; the latest day settles for a day or two.

### Reach

- **Source of truth:** `cockpit_meta_reach`, read from Meta's own
  `time_ranges` per account (hourly), campaign, ad set and ad (nightly);
  a client's row is the sum of its accounts.
- **Checked against:** Meta account insights `reach` over the same range
  (equal for every account with no delivery today).
- **Rule:** never add daily reach. A client with two or more accounts is a
  sum, and the note says a person reached by both counts twice. The client's
  reach is NULL, with the account named, when an account failed its read,
  still holds an earlier day's windows, or delivered in the window and has not
  been read for it yet.
- **Freshness:** account and client rows hourly for the accounts that spent in
  the last two days; every account that delivered in any window nightly.
- **Gaps fixed on 16 Oct:** Marble and more's 30-day reach summed one account
  of two with no note; ARCWANI and Liwan had no client row at all. Both now
  read "unknown, waits for the nightly run" until the nightly run. Windows
  with the same days (last 7 days and this month on the 7th of a month) were
  refused or written as 0; now read once and written to both.

### Frequency

- **Source of truth:** impressions / reach of the same `cockpit_meta_reach`
  row. Never an average or the maximum of daily frequency
  (`cockpit_meta_ad_days.frequency` is per ad-day, for display only).
- **Checked against:** Meta's frequency for the same range (equal).
- **Gaps:** for a two-account client the reach is a sum, so frequency reads a
  little low.
- **Compromise list (since 21 Oct 2026):** Meta's reach is per account, so it
  counts the outsiders' ads on the compromise list too. When a listed ad had
  impressions on a client's accounts in the time frame, the client row does
  not use the reach: it shows the impression-weighted daily frequency of the
  client's own ads (`basis: average_daily`), and the note says "Meta's reach
  for these ad accounts also counts the outsiders' ads on the compromise
  list, so it is not used: this is the average daily frequency of the
  client's own ads." The tree's campaign, ad set and ad reach is each node's
  own; the listed nodes are not shown.

### Link clicks, link CTR, CPC, CPM

- **Source of truth:** `cockpit_meta_ad_days.link_clicks` (Meta
  `inline_link_clicks`; the tap that opens an instant form counts),
  `impressions` and `spend_usd`.
- **Rule:** link CTR = sum(link_clicks) / sum(impressions), shown from 1,000
  impressions; CPC = sum(spend_usd) / sum(link_clicks); CPM = sum(spend_usd) /
  sum(impressions) x 1000.
- **Checked against:** Meta `inline_link_click_ctr`, `cost_per_inline_link_click`
  and `cpm` (times the fixed rate): equal to two decimals for every client.

### Leads (from lead campaigns)

- **Source of truth:** `cockpit_meta_ad_days.leads`.
- **Rule:** only on OUTCOME_LEADS and LEAD_GENERATION campaigns: Meta's lead
  action less its messaging leads. NULL on every other objective and on chat
  ad sets (destination WhatsApp, Messenger, Instagram Direct). Instant-form
  leads and website (pixel) leads both count; `destination_type` tells them
  apart (Atlantis: 38 instant form + 4 website over 30 days). Label it "Leads
  from lead campaigns", not "instant form".
- **Checked against:** Meta ad set insights by destination (equal on all 27
  accounts), and Meta's Leads API lead by lead (ids and times only) for 10
  clients.
- **Freshness:** hourly; nightly 28-day re-read (attribution settles).
- **Gaps:** Ardon's Page gives Mahara no lead access, so its leads cannot be
  matched lead by lead.

### Meta's lead action (all objectives)

- **Source of truth:** `cockpit_meta_ad_days.lead_actions`: Meta's "lead" on
  any objective, WhatsApp and Messenger leads and engagement-campaign leads
  included. Only for matching Ads Manager's account total; never the board's
  lead count (Khalida 48 against 10 form leads, ARCWANI 53 against 31, Pidco
  12 against 8).

### Cost per lead

- **Rule:** sum(spend_usd where leads is not NULL) / sum(leads): only the
  spend of rows that can have form leads, so engagement, sales and chat ad
  sets stay out (Pidco: $60.31 / 8 = $7.54, not $553 / 12). Target $15 (the
  KPI gate, imported from `kpi.ts`): good up to $15, a watch up to $22.50
  (`CPL_BAD`, 1.5 x the gate), off above (`cockpit_board_default_targets`,
  `cpl`). A client's own line replaces them (`cockpit_board_targets_map`).
- **No form lead yet (decision 4, 23 Oct,
  `20261023s_board_cpl_no_lead.sql`):** the CEO: "Depends on how much spend
  if 2x target cpl then yes bad if below that then not enough data". With
  leads known and none, the cell is off once the lead-campaign spend, rounded
  to the cent, reaches 2 x the client's cost per lead line, and too few to
  judge under it. The line is computed, never typed: 2 x the client's own
  line, else the board's default, else the $15 gate (`NO_LEAD_MULTIPLE` and
  `noLeadLine()` in `kpi.ts`; the board computes 2 x
  `p_targets->'cpl'->>'good'`). `cockpit_board_targets` holds no row on 23
  Oct, so the line is $30.00 for every client: $30.00 is off, $29.99 too few.
  The cell keeps its "at least" ("$11.09+") and its note says the amounts:
  "No form lead yet for $11.09 of lead-campaign spend: under $30.00 (2 x the
  $15.00 cost per lead line), too few to judge." Unknown leads (no lead-form
  rows) stay not measured, never 0; with spend in a currency with no fixed
  rate only the priced part is judged. CEO Delivery reads the same line from
  `cockpit_board_targets`, and so do the CEO's client risk points
  (`noLeadLineOf` in `clients.js`). The media sync, the EOD, CSM Diagnosis,
  the Ads "Critical" filter and the Verdict Playbook, the CSM ads meter,
  ClickUp and the CEO's own-ads verdicts (`KILL_FLOOR` in `b2bAds.js` and
  `cockpit-ceo-api` `windows.ts`) use 2 x the $15 gate (`NO_LEAD_MULTIPLE` x
  `CPL_GATE`, `noLeadLine()` in the apps and ClickUp). The media sync, CSM
  Diagnosis, ClickUp, the Verdict Playbook and the CEO's own-ads hold print
  the line as 2 x the $15 gate beside the verdict; the EOD names the client
  with its spend ("<client> (no lead on $X)"), the CSM ads meter says "too
  few to judge" under the line, and the Ads filter shows no line.
  Before it a cost per lead with no lead was judged as a floor on the $15 and
  $22.50 lines, and the CEO read Madana's $11.09 with no lead as bad where
  the board read too few. Client page tree, 16 to 22 Oct: Alkhalil's video ad
  (120251783300360190, $24.10) goes from off and شركة العلا's Ad_2
  (120252006050440391, $17.32) from watch to too few; the four ads with no
  lead on $30 or more stay off.
- **Checked against:** Meta ad set spend and leads on lead-campaign ad sets.
- **Gaps:** for bulk-uploaded clients (Ardon, نهوض نجد) take leads from Meta,
  not the CRM, for cost per lead.

### Meta leads not in the CRM

- **Source of truth (new):** `cockpit_meta_lead_ids` (the nightly run reads
  each lead ad's lead ids and times, never a name, phone or answer) and
  `cockpit_meta_leads_not_in_crm(from, to)`.
- **Rule:** one lead to one contact, per ad, over the Kuwait days. Meta's
  leads and the ad's CRM contacts (not deleted) go in time order. First each
  lead takes the earliest free contact created within 10 minutes of it. Then
  each lead still alone takes the earliest free contact from 10 minutes before
  it to a day after it (a late sync). The leads of the two days before the
  window and of the day after it take part, so a contact of the next day's
  lead pairs with that lead and never covers a lead of the window that did not
  arrive. A client's "not in the CRM" is its window leads left without a
  contact.
- **Unknown, never 0:** the function returns metaLeads, inCrm and notInCrm
  NULL with a note when an account with form leads in the window has never
  been read, when the window starts before the lead ids held for an account
  (`cockpit_meta_lead_id_cover.covered_from`: 31 days before the first nightly
  read), or when Meta shows none of the client's lead ads (no lead access on
  the Page: Ardon). With some ads unread, or a window that runs past the last
  nightly read (today), the numbers stand with a note.
- **Kept:** each nightly run reads the last 31 days and adds to what is held,
  so the history grows from the first nightly run. Lead ids older than 180
  days are deleted.
- **Checked against:** the check's lead-by-lead match on 16 Oct: about 19
  form leads in 30 days never became contacts (Arcturus 5 of 83, Atlantis 3
  of 38, Liwan 3 of 19, SAFAD 3 of 49, Castello 2 of 69, City Wood 2 of 48,
  Khalida 1 of 10). On 16 Oct the rule was re-run on Arcturus's Meta lead
  ids and contact times. It gives 5 of 83 over 16 Sep to 15 Oct (2 on 7 Oct,
  2 on 8 Oct, 1 on 9 Oct) and 1 of 23 over 9 to 15 Oct, equal to the check.
  The first version counted contacts up to a day after the window and gave
  1 and 0.
- **Gaps:** website (pixel) leads are not in Meta's Leads API, so metaLeads
  can be under the ad-days leads (Atlantis 4). A bulk upload more than a day
  late counts as not in the CRM (Ardon, نهوض نجد). The guardian should flag a
  client above 0 for two days: systems manager.

### Landing page views and opt-in rate

- **Source of truth:** `cockpit_meta_ad_days.landing_page_views`; NULL when
  Meta lists none (instant forms have no landing page).
- **Rule:** website opt-in = leads / landing page views on website ad sets;
  the client row's opt-in = leads / link clicks (from 50 link clicks).
- **Checked against:** Meta account insights (equal: Khalida 146, Atlantis
  101, Liwan 51, Ideal Elite 31).

### Funnel of a campaign (media buyer client page, 20261026s)

- **Source of truth:** `cockpit_meta_ad_days.destination_type` and
  `objective` per ad set, read by `cockpit_media_campaign_funnels` for the
  campaigns in the cockpit's campaign list (`cockpit_media_campaign_allowed`)
  and, since 20261026u, for a campaign with a card in the current board
  snapshot (`boardCards`) of a client the seat may see, matched by the card's
  tag.
- **Rule:** `ON_AD` = instant form; a WhatsApp, Messenger or Instagram DM
  destination is that chat; a lead objective with any other destination is a
  website (Meta reports `UNDEFINED` for website lead campaigns), named "Lead
  page" for a client that has one; a lead objective with no destination is
  "Funnel not known"; any other objective is "Other ads". A campaign counts
  whole under the funnel it spent most on; a second funnel with 10% or more
  of its spend is named on the line.
- **The numbers:** each funnel line adds up the client page's own campaign
  figures (the tracker sheet), so the lines add up to the page's totals.
  Meta's figures only decide the funnel.
- **Checked against:** Merge Studio, 27 Sep to 25 Oct 2026: the instant form
  campaign has $323.51 and 37 leads in both the tracker sheet and
  `cockpit_meta_ad_days`.
- **Known gaps:** the campaign list counts full days only (through yesterday)
  and skips a campaign with under $0.50 in those 7 days, so a campaign that
  first spent today is in no funnel line until the next morning update
  (Merge Studio's web campaign on 26 Oct, card made at 17:36). The Lead page
  shows Meta's clicks for it, today included, and says it has no full day in
  the numbers above yet (20261026u). Triple Edge's `LEAD_GENERATION` campaign
  reports `UNDEFINED` with no landing page views and reads as website ($19.91,
  Aug to Oct 2026).

### Lead page visits from ads (20261026s)

- **Source of truth:** `cockpit_page_form_events` (Edge Function
  `page-form-events`), counted by `cockpit_page_form_funnel`.
- **Rule:** a visit is from an ad when its link carries `ad_id` or
  `campaign_id`, or `utm_medium=paid` with a numeric campaign or ad id in
  `utm_campaign` or `utm_content`. Meta adds these parameters to website ads
  by itself. Before 20261026s only `ad_id` counted, so Merge Studio's 10 ad
  visits on 26 Oct read as 0.
- **Beside it:** Meta's link clicks and landing page views on the client's
  website campaigns, same days, from `cockpit_meta_ad_days`. They run a little
  above the page's own visits: some people leave before the page loads.

### Video: hook rate, plays, retention, ThruPlays, hold rate

- **Source of truth:** `cockpit_meta_ad_days.video_3s` (actions video_view),
  `video_plays` (every start), `video_p25` to `video_p100`, `thruplays`.
- **Rule:** hook rate = sum(video_3s) / sum(impressions) over video rows only;
  retention at each mark = sum(video_pXX) / sum(video_plays), never divided by
  3-second plays; hold rate = sum(thruplays) / sum(video_3s), and its target
  must use the same formula (the repo's 40-50% table is p50 / 3-second
  viewers). NULL on a row that is not a video; 0 on a video row with none.
- **Checked against:** Meta account insights video fields (equal on all
  accounts, 30 and 7 days).
- **Gaps:** no agreed hook or hold targets. Generic 20% lines would turn most
  clients red; set them from Mahara's own spread: the media buyer and the CEO.

### Ad account day and time zone

- **Source of truth:** `cockpit_meta_ad_days.day` and `account_timezone`.
- **Rule:** ad days are each account's own calendar. Atlantis (Los Angeles):
  its day runs 10:00 to 10:00 Kuwait time in October; the board says so on
  its row, and for 7 days or fewer compares ad-led ratios with CRM leads by
  the account's day.

### Ad account status (billing, disabled)

- **Source of truth (new on the board's status read):**
  `cockpit_meta_ad_days_status()` gives each account's Meta `account_status`
  (from the latest run that listed it in the last 3 days) with a word, its
  client's status, its last day with spend, and two lists:
  `cancelledDelivering` (spent in the last 2 days for a cancelled, stopped
  or churned client; churned means listed in `cockpit_churned_ad_accounts`
  with no live tie, since `20261023u`) and `billingStopped` (tied to a live
  client, Meta status not active).
- **Checked against:** `mahara-ad-billing-watchdog` (every 5 minutes).
- **On 16 Oct:** ARCWANI (no delivery since 9 Oct), Liwan (since 12 Oct),
  Ocean Home, SAFAD and شركة العلا are unsettled (status 3); marblemore1 is
  disabled. The board should show "Billing unsettled: delivery stopped 9 Oct"
  beside the client: board team. Settling billing: client success.

### CRM leads

- **Source of truth:** `client_leads` (GoHighLevel contacts), stored as
  `cockpit_client_days.crm_leads`.
- **Rule:** not deleted, by the Kuwait day the contact was created, WhatsApp
  chats left out (tagged "inbound whatsapp" with no ad and no campaign,
  DECISIONS 2026-10-15). Instagram and Messenger DMs stay in (the call centre
  calls them; only the WhatsApp tag was taken out).
- **Checked against:** the dialer's report (equal for all 17 active clients
  once its WhatsApp chats are added back: Alkhalil 3, ARCWANI 16, SAFAD 3,
  Khalida 19) and the lead sync watch (equal 10 to 15 Oct).
- **Freshness:** lead sync hourly at :35; behind after 3 hours.
- **Gaps:** bulk uploads put the upload's day on the contact (Ardon 28 Sep and
  13 Oct, نهوض نجد 6 Oct); the day's note now names them.

### CRM ad leads and DM contacts

- **Source of truth:** `cockpit_client_days.crm_ad_leads` and
  `crm_dm_contacts`.
- **Rule (fixed 16 Oct):** an ad lead has an ad id, or a Facebook Ads source
  or ad click id in its attribution (`adSource`, `utmFbclid`, `fbc`). A Meta
  channel contact with none of them is a DM (`crm_dm_contacts`), never an ad
  lead. Before the fix the Meta channel alone counted (98 DMs at active
  clients in 30 days; Ocean Home 139 against Meta's 115).
- **Checked against:** Meta form leads for the client's accounts: after the
  fix Ocean Home 115 = 115, Alkhalil 57 = 57, City Wood 48 = 48, شركة العلا
  108 against 107.
- **Use:** the delivery check against Meta's leads, and "Meta leads not in the
  CRM" lead by lead. Cost per lead uses Meta's leads.
- **Open decision:** whether DMs should leave CRM leads like WhatsApp chats:
  the CEO with the systems manager.

### Confirmed bookings

- **Source of truth:** `appointments` (GoHighLevel sync at :20), stored as
  `confirmed_bookings`.
- **Rule (since 21 Oct, `20261021l_board_booking_rule.sql`):** main and online
  calendars, by the Kuwait day the booking was made, minus:
  - cancelled and invalid bookings and Google Calendar copies;
  - the call centre's call-back bookings (dialer outcome CALLBACK), always: a
    call back is the call centre's own follow-up, not the lead's booking;
  - a booking the call centre rescheduled (outcome RESCHEDULE), only while the
    booking it moved (`originalAppointmentId`) is still a counted main or
    online booking: a meeting moved is not a new booking, but once the first
    one is gone the new one is the lead's only booking. A RESCHEDULE that
    names no original is kept. Until 21 Oct every RESCHEDULE was dropped,
    which lost SAFAD's 20 Oct booking: the lead booked through the call
    centre at 14:45 Kuwait (`hncsfdNodMEdkVNW3245`), the booking was moved 10
    minutes later and GoHighLevel deleted the first, so
    `MxRYJYyO64JjX7lL7kMc` is the lead's only booking.
    `cockpit_board_replaced_booking_ids` holds this rule (decision D0b);
  - a booking GoHighLevel no longer holds (`cockpit_board_gone_booking_ids`,
    the interim fix for audit item R7): the dialer's inventory of GoHighLevel
    says it is gone and last saw it no later than a day after its meeting, the
    appointments sync has not seen it since either, nothing marks it showed,
    and it is not a booking the call centre moved while its new booking
    stands. Four October bookings left this way: Alkhalil
    `JTAbzlPF8oImhx5skXu0` (11 Oct), Ardon `QSzpJTdcRtTdgvQsNIy3` (12 Oct),
    Ocean Home `PSGg0w3jaCymxMgzB1I0` (12 Oct) and Shades
    `3BtZov0FxDGP4PMhbJr0` (18 Oct); in September ARCWANI 2 (21 to 19) and
    Atlantis 1 (20 to 19), so approved September pay months move with them.

  No calendar is dropped by its name. Atlantis's "Project Review &
  Qualification Call" calendar is not a main or online calendar, so the
  bookings on it are not counted (decision D0c, the default of 21 Oct: see
  "What is left"). Meetings due, shows and no-shows are not changed by the
  gone check.
- **A read that fails never stops the bookings:** if the gone check cannot be
  worked out, nothing is gone; if the call centre's rule cannot, the rule of
  16 Oct stands (every RESCHEDULE and CALLBACK booking left out); the
  appointments source says which. Only when the dialer's attempts cannot be
  read at all does the appointments source fail, and the figures stored
  before are kept.
- **The campaign tree** on the client page leaves out the same bookings
  since 21 Oct (`20261021m_board_tree_booking_rule.sql`); see Cost per
  booking.
- **Checked against:**
  - the dialer's report (16 Oct: board 170 against the dialer's 176 over 30
    days, every difference traced: the dialer keeps bookings cancelled later
    and bookings GoHighLevel no longer holds);
  - the media sync's booking events (`cockpit_media_booking_events`), read
    only on 23 Oct at about 01:15 Kuwait: equal to the board client by client
    for every Active client, 49 bookings over 14 to 20 Oct and 101 over 1 to
    20 Oct. The board's 103 for 1 to 20 Oct adds Professional Touch's 2, which
    the media sync cannot place on a campaign (its ad account is not shared
    with Mahara's business).
- **The media sync counts the same bookings since 22 Oct.** The native
  release e4c0cpb1 put the board's rule into `hermes/cockpit-sync`
  `calculator.ts`: main and online calendars only (`calendarKind`, the
  board's calendar kinds), call-backs always out and a reschedule out only
  while its original counts (`dialerReplacedBookingIds`, read from the dialer
  once a run). A reschedule whose original GoHighLevel deleted but the
  appointments table still counts is dated on the day the lead booked the
  original, the day the board counts it. The media sync reads GoHighLevel
  live, so a booking GoHighLevel no longer holds is never in it. A dialer
  read that fails stops that run's publish, so the last publish stands; an
  answer it cannot use keeps every booking for that run and logs "dialer
  bookings unreadable". The 16 Oct change this section described before was
  not released until then: the live worker kept counting Atlantis's
  call-back bookings until 22 Oct (audit R4). Checked on 23 Oct: the six
  Atlantis bookings the old worker counted (`dmO7mzPQ5RXH4PrVCSBL`,
  `9tubP2ZbEbtrz7RvqRlg`, `ErVaQM4THKjBgFaoZoau`, `c67BHPSdhgymy0lQnHzf`,
  `s3UnXy4fY1xp6RMYAJgh`, `opVzfk4564vQL7uG7gUZ`) are not in the media sync's
  events; SAFAD `MxRYJYyO64JjX7lL7kMc` is, on 20 Oct; Arcturus
  `l1Ar6ZhyTqKN4baJush0` is dated 22 Sep.
- **Gaps:** the appointments sync never marks a row it stops receiving, so a
  booking GoHighLevel deletes stays "confirmed" there until the gone check
  takes it out; the sync should mark it itself (`ghl-appointments-sync`, not
  built): systems manager. The dialer's appointment facts never learn that
  GoHighLevel dropped a booking, and its RESCHEDULE should cancel the old
  appointment: systems manager (dialer).

### Provisional bookings

- **Source of truth:** `appointments`, the dialer's verified bookings and its
  GoHighLevel appointment facts, newest version, on a not-confirmed,
  provisional or tentative calendar (triage.js rule), by booking day, minus
  Google copies by id and by contact and start time.
- **Checked against:** the dialer's report (equal except its Google copies:
  Atlantis 16, mergestudio 6).
- **Gaps:** provisional meetings never reach meetings due (the appointments
  sync does not carry that calendar). No effect today.

### Cost per booking

- **Source of truth:** the board's cell (`cockpit_board_rows`,
  `costPerBooking`): spend from `cockpit_meta_ad_days.spend_usd` on the
  client's linked ad accounts, divided by `cockpit_client_days.confirmed_bookings`
  (Confirmed bookings above). Every other screen that shows a client's cost
  per booking is checked against it; where one differs, and why, is written
  below (No booking, no spend; the table of other screens; Mahara's
  campaigns only).
- **Rule:** the sum of spend over the sum of confirmed bookings, over the same
  days: a ratio of sums, never an average of daily costs.
  - **Paired days, to yesterday on each account's clock.** The days run from
    the time frame's first day (never before the Meta store's first day) to
    the earlier of yesterday in Kuwait and the last finished day of every
    linked ad account on its own clock (`cockpit_board_ad_cover`, `pairFrom`
    and `pairTo`). Spend is on each account's day and bookings on Kuwait days,
    paired by date. Atlantis's account keeps Los Angeles time, so until 10:00
    Kuwait (11:00 from November) its yesterday is Kuwait's day before
    yesterday and its cost per booking stops a day earlier. Today never
    counts: a booking lands the moment it is made, while Meta's spend for
    today is not in yet.
  - **Spend only on days with stored bookings.** A day whose confirmed
    bookings are not stored (a failed appointments read, a day before the
    facts) leaves both halves: its spend is never divided by bookings nobody
    counted. When that leaves fewer days than the time frame's ad days, the
    note says "Over the N of M days where both are known."
  - **The whole ad account.** Every campaign on the client's linked accounts
    counts, stopped ones and the client's own included (Shades' pre-launch
    engagement campaign, $90.07 on 1 to 5 Oct: decision D0d keeps it on the
    board); ads on the compromise list never do. The media buyer's screens
    count Mahara's campaigns only and say so (below).
  - **Confirmed only, by the day booked.** Provisional bookings are never
    divided by; a figure that divides by both must say "incl. provisional".
    A booking is dated by the Kuwait day it was made, never its meeting day:
    the meeting day is right for meetings due and the show rate, never for
    cost per booking (CEO Delivery counted by meeting day until build 2,
    audit R2).
  - **Lines:** good up to $60, a watch up to $80, off above
    (`cockpit_board_default_targets`, `cost_per_booking`: `kpi.ts` `CPB_GATE`
    and `CPB_BAD`, held equal by `board-api-supabase.test.ts`, "the default
    targets"). A board or client target replaces them and the cell says which
    (`cockpit_board_targets_map`, `source`). The line judges the cents the
    cell shows: $60.40 is over $60, and $60.004 shows "$60" and is not.
    The CEO's "Well over the $60 gate" chip starts at $75 (25% over), a
    scale it states in its hint; over 14 to 20 Oct no client read between
    $75 and $80.
- **No booking, no spend, "at least" and n/a:**
  - Spend and no confirmed booking: the cost is not known, but it is at least
    the spend (`atLeast`, note "No confirmed booking yet for $233.36 of
    spend."). The board's cell shows the spend with a + and the dot of its
    line (`cells.tsx` `CellContent`; the help reads "at least $233"): up to
    $60 too few to judge, a hollow ring (Madana "$11.09+", 14 to 20 Oct);
    over $60 a watch and over $80 off (Alkhalil "$233+"; a done-with-you
    client reads "Done with you" instead, below).
    The media buyer's screens say the same floor in words (`costTone.ts`
    `cpbDisplay`): "None yet" up to $60, "None on $233" in the grid's colour
    over it, and the Ads page counts it in its "Cost per booking over $60"
    filter (`adsFilters.ts`). The board has no such filter, and its totals
    line has no cost per booking.
  - Confirmed bookings and no spend on the paired days (the accounts did not
    deliver, or a prepaid balance ran out): the board divides anyway and
    shows "$0", judged good (one day each, read only on 23 Oct:
    mergestudio.kw 19 Oct, 1 booking; Atlantis 18 Oct; شركة العلا 18 Oct;
    Ocean Home 15 Oct, 2; Castello 26 Sep; Marble and more 29 Sep). Those
    bookings came from ads that spent before the time frame, so $0 is not
    what they cost. The media buyer, the client range read and the CEO read
    n/a with the reason: the media buyer "Nothing was spent in this range: these bookings came from ads
    that spent before it." (`cpbDisplay`), the client range read null with
    "No spend on Mahara's campaigns is counted for these days, so there is
    no cost per booking.", the CEO "No spend on the days the board stores
    bookings." (`deliveryCost.ts`). The board is the one that differs (gap
    below).
  - Some spend in a currency with no fixed USD rate: the cost is at least
    what the priced spend gives, judged as a floor; all of it unpriced: n/a.
  - Not measured, never $0, with the reason in the note: no Meta ad account
    linked (Professional Touch, whose account is not shared with Mahara's
    business), a time frame of today only ("Ad numbers end yesterday"), no
    day over on every linked account's clock, no stored bookings, or no day
    with both.
  - No spend and no booking: too few to judge, "No spend and no confirmed
    booking in these days."
- **Windows:** "Last 7" and "Last 30" end today, so cost per booking covers 6
  and 29 ad days in them; `last_7_full` and `last_30_full` cover 7 and 30.
  The picker and the cell's help say so.
- **Done with you (decision 2, 23 Oct):** the CEO: "No keep the CPL but
  ignore CPB". نهوض نجد books its own meetings, so its cost per booking is not
  Mahara's to judge. Since `20261023r_board_done_with_you.sql` the board's
  cost per booking, its floor and the booking rate read "Done with you", with
  no value, status or dot, whatever GoHighLevel holds (the cell is
  `{v: null, status: "not_measured", clientBooks: true}`, note "Done with
  you: the client books its own meetings, so its cost per booking and booking
  rate are not judged."; `cells.tsx` shows the words). Its campaign tree's
  cost per booking reads the same. Its status is judged on cost per lead
  alone (the golden rule never applies to it), and the first break skips
  cost per booking and booking rate (`boardColumns.ts` `firstBreak`), so for
  14 to 20 Oct it reads "On target" (was "Off at booking rate"). Its spend
  and leads stay in its own cost per lead and in every portfolio cost per
  lead. Its spend leaves every portfolio cost per booking, and any booking
  stored on its location leaves the denominator (none today); each portfolio
  figure names the amount it leaves out (CEO Delivery, Today, Backend, Goals,
  the timeframe cards and the EOD). Its booking counts stay on screen as
  facts. The CEO, the media buyer's client read, CSM and ClickUp read it the
  same way.
- **The golden rule (build 2, `20261022y_board_cpl_golden_rule.sql`):** when
  a client's cost per booking is good and not a floor, a cost per lead that
  would be off is a watch, with the note "Cost per booking is within the $60
  gate, so a cost per lead over $15 is a watch line, not off (the golden
  rule)." Both amounts are the client's own lines. Atlantis, 14 to 20 Oct:
  $43.63 a booking (good) and $34.91 a lead, off until this ships, a watch
  after it; the first break then reads "Off at ROAS". `kpi.ts` `belowKpi` (the
  media buyer and the EOD, since 22 Oct) and the CEO's `clientStatus` (build
  2) follow the same rule.
- **The campaign tree (client page):** campaign, ad set and ad rows count a
  booking under the ad whose id its appointment carries (`appointments.ad_id`),
  by the facts' rule (`20261021m`: call-backs, moved bookings whose first
  still counts and bookings GoHighLevel no longer holds left out), made on the
  same paired days, and divide the ad's spend on those days ("Confirmed
  bookings with this ad id and spend over the same days"). A booking with no
  ad id is in the client row only, so the tree's rows need not add up to the
  client row; since 21 Oct no campaign shows more bookings than its client.
- **Checked against** (read only on 23 Oct at about 01:15 Kuwait: the board's
  own read, `cockpit_board_rows`, against the sources below; 14 to 20 Oct and
  1 to 20 Oct are over on every account's clock):
  - the audit's truth table (`CPB-AUDIT-20261021.md` section 1: GoHighLevel's
    appointments recounted, spend from the Meta store, itself checked against
    Meta's account insights): equal for every Active client in both windows.
  - 14 to 20 Oct: Alkhalil no booking on $233.36 (off); Arcturus $242.48 / 4
    = $60.62 (watch); Ardon $201.90 / 5 = $40.38; Atlantis $174.53 / 4 =
    $43.63; Castello $268.48 / 1 (off); City Wood $354.00 / 3 = $118.00 (off);
    Marble and more $204.23 / 4 = $51.06; mergestudio.kw $134.69 / 8 =
    $16.84; Ocean Home $235.87 / 9 = $26.21; SAFAD $390.80 / 2 = $195.40
    (off); Shades $203.63 / 4 = $50.91; شركة العلا $153.13 / 4 = $38.28;
    Khalida $91.62 / 1 (off); Madana no booking on $11.09 (too few to
    judge); نهوض نجد no booking on $192.33 (off; done with you, above).
    Active clients: $3,092.14 / 49 = $63.10 (with the 3 provisional, $59.46),
    the sum of the cells. That spend includes نهوض نجد's $192.33, a client
    that books its own meetings, so none of its bookings are in the 49.
  - **14 to 20 Oct after the 23 Oct decisions:** SAFAD $15.71 / 2 = $7.86
    (good; D0a lists the outsiders' $375.09) and نهوض نجد "Done with you"
    (decision 2); every other cell as above. Active clients: **$2,524.72 / 49
    = $51.52** (with the 3 provisional, $48.55), the sum of the cells with
    نهوض نجد's $192.33 left out (done with you) and SAFAD's listed ads out.
    D0a alone gives $2,717.05 / 49 = $55.45; leaving out نهوض نجد alone,
    $2,899.81 / 49 = $59.18. Read again as the CEO seat at 20:55 Kuwait on 23
    Oct (not committed): $3,092.14 / 49 before the decisions, $2,899.81
    without نهوض نجد, so $2,524.72 once SAFAD's $375.09 is out.
  - 1 to 20 Oct: Alkhalil no booking on $367.34; Arcturus $56.29 (14); ARCWANI
    $151.40 (1); Ardon $138.06 (6); Atlantis $111.96 (5); Castello $333.83
    (2); City Wood $224.88 (3); Liwan $194.58 (1); Marble and more $52.34 (4);
    mergestudio.kw $22.04 (11); Ocean Home $27.87 (27); SAFAD $227.93 (3);
    Shades $73.43 (4); شركة العلا $33.37 (19); Khalida $191.53 (1); Madana
    no booking on $11.09; نهوض نجد no booking on $533.33 (done with you).
    Active clients: $7,783.36 / 101 = $77.06 (Professional Touch's 2 bookings
    left out: its spend is not known). نهوض نجد's $533.33 is in it.
  - **1 to 20 Oct after the 23 Oct decisions:** SAFAD $308.69 / 3 = $102.90
    (off; was $227.93) and نهوض نجد "Done with you". Active clients:
    **$6,874.93 / 101 = $68.07**, نهوض نجد's $533.33 left out (done with you)
    and SAFAD's $375.10 on listed ads out. D0a alone gives $7,408.26 / 101 =
    $73.35. Read again at 20:55 Kuwait: $7,783.36 / 101 before, $7,250.03
    without نهوض نجد.
  - **16 to 22 Oct after the 23 Oct decisions** (the board as the CEO seat at
    14:30 Kuwait on 23 Oct): Active clients **$2,541.09 / 57 = $44.58**,
    نهوض نجد's $205.15 left out (it read $2,746.24 / 57 = $48.18 with it, the
    sum of the cells, as the 20:55 read gives it; the contract's section 5
    has $2,746.23; D0a moves nothing in these days). Read again at 20:55 Kuwait: Castello's
    confirmed bookings for these days went from 4 to 3, so $2,541.09 / 56 =
    $45.38. The rule did not change; a booking left the count.
  - the media sync's booking events: equal client by client (Confirmed
    bookings above).
  - Mahara's campaigns in the media data (`cockpit_media_daily_stats`, one
    row per ad and day, stopped campaigns included): equal to the board's
    spend for every Active client in both windows except Shades in 1 to 20
    Oct (the client's own $90.07, decision D0d). Before D0a SAFAD differed
    too (an outsider's "New Engagement Campaign" on its account, $375.09 in
    14 to 20 Oct and $375.10 in 1 to 20 Oct); once its ads are listed the
    board leaves them out as well. So the Active clients on Mahara's
    campaigns read $2,524.72 / 49 = $51.52 for 14 to 20 Oct with نهوض نجد's
    $192.33 left out: the board's Active total, the CEO's series for those
    days and the EOD's 7-day total read the same figure.
- **Gaps:**
  - The board's cell reads "$0", judged good, for bookings made on days with
    no spend (above). It should read n/a with the reason, as the media
    buyer, the client range read and the CEO do: board team
    (`cockpit_board_rows`).
  - Professional Touch's note says "No Meta ad account is linked to this
    client." when the account exists and is not shared with Mahara's
    business (audit section 5, item 9): board team.

**Where other screens differ, and what they say** (audit section 5; build 2
items in section 7 of `CPB-20261021.md`):

| Screen | Per | Spend | Bookings | Days | Label on screen |
| --- | --- | --- | --- | --- | --- |
| Board client row, pay facts | client | whole ad account (`cockpit_meta_ad_days`) | confirmed, board rule | paired, to yesterday on each account's clock | the cell's note |
| Board campaign tree | campaign, ad set, ad | the ad's | confirmed with that ad id | the same paired days | "with this ad id" |
| Media buyer campaign rows, decisions, ClickUp cards, and the EOD lines until build 2 | campaign | the campaign's, media sync | the media sync's, same rule since 22 Oct | the media sync's 7 days | the campaign's name |
| Media buyer client page (build 2) | client | Mahara's campaigns only, stopped ones included | the board's confirmed | to `cockpit_media_week` `through` | "Mahara's campaigns only, stopped ones included; the Client Performance board counts the whole ad account." |
| CSM Ads tab | client, by campaign name | the client's campaigns in the media data, stopped ones included | the media sync's | the period | "Spend, leads and clicks come from Meta, for Mahara's campaigns only (stopped ones included). The Client Performance board counts the whole ad account, so its spend can be higher." (`ClientAds.tsx`, 23 Oct) |
| CSM Diagnosis, creative "Performance, last 7d", EOD client lines (build 2) | client | Mahara's campaigns, stopped ones included (`ads7d`) | `ads7d` | the media sync's 7 days | Mahara's campaigns, stopped ones included, and the days |
| CSM Results tab | client | the campaigns listed | the client's sheet | the period, by sheet day | "from their sheet" |
| CEO Delivery, Today, Backend (build 2) | client | whole ad account; since 23 Oct a done-with-you client's spend leaves the portfolio figure, named beside it | confirmed, from the board's tables, by the day booked | the CEO's time frames (CEO `SOURCES.md`) | "Cost per confirmed booking" |
| ClickUp Cost Per Booking | card | the campaign's | the media sync's | the media sync's 7 days | four bands at $45, $60 and $80 (911 over the cockpit's $80 line, decision 3, 23 Oct; it was $90, 1.5 x the gate); a dry run |

Two cases read differently on the board than on the other screens (No
booking, no spend, above): no booking on spend is "$233+" on the board and
"None on $233" on the media buyer's screens, the same floor in other words;
bookings with no spend are "$0", judged good, on the board and n/a with the
reason on the media buyer's screens, the client range read and the CEO's.

**The media sync's 7 days (`cockpit_media_week`, build 2).** The media
buyer's campaign rows, the EOD, the decisions, CSM Diagnosis, the creative
dashboard and ClickUp's columns read the media sync's 7 days, not the board.
The worker ends them on the last day the tracker sheet has spend for
(`sevenDayWindow` `until7`; the Meta rows' last day when the sheet is more
than two days behind), one end for every client in one publish, and starts
them six days earlier (`since7`). Bookings stop on the same day. From
midnight to about 06:00 Kuwait, before the sheet fills yesterday, the end is
the day before yesterday; then it moves to yesterday. Build 2 publishes that
window with each client's figures (`ads7d` on the client links, the CSM
profiles and the creative clients) and gives it to every SQL reader through
`public.cockpit_media_week()` (`20261022w_media_week.sql`): `from`,
`through` and `source`, "media sync" from the newest ready publish, else
"media data" (the last day of `cockpit_media_daily_stats`, never after
Kuwait's yesterday, `from` null) until the worker publishes it. The media
buyer's coverage read returns it as `bookingsThrough`, so a range read counts
spend, leads and bookings through that one day and names it;
`cockpit_winner_numbers` stops a winner's spend and bookings there (the
preview of "CityWood v1" over 1 to 21 Oct, as read on 21 Oct: 3 bookings at
$38.22, where it read 7 at $16.38, four of them made on 21 Oct after the
spend); the client range read and ClickUp's inputs read it too. The board
and the CEO cockpit do not: the board pairs each client's own accounts to
yesterday, and the CEO stops at yesterday, or runs to today so far for This
month on Delivery and Backend (CEO `SOURCES.md`).

Winner saves stored before build 2 are not rewritten. Read only on 23 Oct,
each of the ten in `cockpit_winner_saves` was recounted with today's booking
events for its ad and window, to the day before it was saved (the last day
its spend could hold: each save's spend equals its ad's spend to that day).
Three hold a booking made on the day they were saved, after their spend
stopped: Marble and more "ad-1" (52563107240566) and "ad-4"
(52563116347566), saved 17 Oct over 11 to 17 Oct, 1 booking each on $20.25
and $46.57, none once capped; Ocean Home's "HousingBuildReview" video
(120255258731900230), saved 20 Oct over 1 Sep to 20 Oct, 3 at $33.22, 2 at
$49.83 once capped. "CityWood v1" (120249959303660590) was saved over 19 to
21 Oct with 3 at $23.22, equal to its capped recount; the 7 at $16.38 was the
1 to 21 Oct preview, never a save.

**Mahara's campaigns only (the media buyer's client page, build 2).**
`cockpit_media_client_range(p_start, p_end, p_accounts)`
(`20261022x_media_client_range.sql`) gives one client's figures for any range,
the client found the way the board finds it (its ad accounts in
`cockpit_board_clients`), with one difference it states: spend and leads are
Mahara's campaigns only (a campaign that has, or had, a card on the Ads
Management board), stopped and deleted ones included, from
`cockpit_media_daily_stats`, one row per ad and day. The rest of the same
accounts is `offBoardSpend`, named beside the total, never in it; ads on the
compromise list are `excludedSpend`, out of both. Bookings are the board's
confirmed bookings for the client's location over the same days
(`mediaBookings`, the media sync's count, is the second source), n/a with the
reason for a done-with-you client or a day not stored. Every figure stops on
`cockpit_media_week()`'s `through` and starts no earlier than 24 Sep 2026,
the first day the cockpit's campaign list can tell Mahara's campaigns from a
client's own. The page says "Mahara's campaigns only, stopped ones included;
the Client Performance board counts the whole ad account." Over the same
days it equals the board wherever every campaign on the account is Mahara's.
On 1 to 20 Oct, a window over on every account's clock, it differs for
Shades only: $203.63 / 4 = $50.91 against the board's $293.71 / 4 = $73.43
(the client's own pre-launch campaign, $90.07, decision D0d), which the page
names as spent outside Mahara's campaigns (`offBoardSpend`). SAFAD differed
until 23 Oct: $308.69 / 3 = $102.90 against the board's $683.79 / 3 =
$227.93, the outsiders' campaign ($375.10) named as off board. Once D0a lists
those ads the board reads $308.69 / 3 = $102.90 too, and the page moves the
amount from `offBoardSpend` to `excludedSpend`: "$375 on ads on the
compromise list is left out." (`money()` shows whole dollars from $100 up;
`excludedSpend` is 375.10 for 1 to 20 Oct and 375.09 for 14 to 20 Oct; 16 to
22 Oct holds none). It also differs from the board, by design, when:
- **The days differ.** It stops every client on `cockpit_media_week()`'s
  `through`: from midnight until the sheet fills, the day before yesterday,
  where the board pairs to yesterday. Atlantis's account keeps Los Angeles
  time, so until 10:00 Kuwait the board stops it a day earlier; this read
  stops it with everyone else. It never counts before 24 Sep 2026, where the
  board counts from the Meta store's first day.
- **A day's bookings are not stored.** Bookings and cost per booking are
  null, "Bookings are not stored for N of the M days."; the board pairs the
  stored days and says "Over the N of M days where both are known."
- **Meta holds a Mahara campaign on days the media data lacks.** The cost
  per booking is null and the note names the amount; the board counts
  Meta's rows.
- **Bookings came on days with no spend.** Null with the reason, where the
  board shows "$0" (No booking, no spend, above).
- **Done with you.** Bookings are n/a, "Done with you: the client books its
  own meetings." The board showed the floor until 23 Oct (نهوض نجد "$533+",
  1 to 20 Oct); since decision 2 it reads "Done with you" too, so the two
  agree.

Never take a client's spend for the board from `cockpit_media_daily_stats`
(see Spend): this read takes Mahara's campaigns from it on purpose, and says
so.

### Lead to booking (booking rate)

- **Source of truth:** the board's cell (`cockpit_board_rows`,
  `leadToBooking`): `cockpit_client_days.confirmed_bookings` over
  `cockpit_client_days.crm_leads`.
- **Rule:** confirmed bookings / CRM leads, both by the Kuwait day they were
  made, summed over the days where both are known (a lead sync outage is not
  a 0); a ratio of sums. Both are CRM numbers on Kuwait days, so nothing is
  paired to an ad account's clock, and today counts "so far". CRM leads keep
  Instagram and Messenger chats and leave WhatsApp chats out (CRM leads
  above), so the rate is not bookings over Meta's form leads.
- **Lines:** good at 25% or more (`kpi.ts` `BOOKING_RATE_GATE`), a watch
  from 17.5% (approved 16 Oct), off under it; under 10 CRM leads the rate is
  shown and called too few (`cockpit_board_default_targets`,
  `lead_to_booking`, held equal to `kpi.ts` by `board-api-supabase.test.ts`).
- **n/a:** either figure not stored ("not measured" with the source's note),
  no day with both, or no CRM lead in the time frame (too few).
- **Done with you (decision 2, 23 Oct):** the call centre does not book for
  نهوض نجد, so since `20261023r` its rate reads "Done with you", with no value,
  status or dot (`clientBooks`, as its cost per booking), and the first break
  skips it. Before, it read 0% from GoHighLevel (0 of 13 CRM leads, 14 to 20
  Oct), judged off, so the client read "Off at booking rate".
- **Checked against** (14 to 20 Oct, read only on 23 Oct): the bookings are
  the confirmed bookings above, equal to the media sync's client by client;
  the CRM leads were checked against the dialer's report on 16 Oct. Rates:
  mergestudio.kw 8 / 14 = 57.14% and Ardon 5 / 11 = 45.45% (good); Ocean
  Home 9 / 32 = 28.13% (good); Marble and more 4 / 20 and شركة العلا 4 / 20
  = 20.00% (watch); Shades 4 / 24 = 16.67%, Arcturus 4 / 40 and City Wood 3 /
  30 = 10.00%, Castello 1 / 23 = 4.35% and Alkhalil 0 / 22 (off); Atlantis 4
  / 8, SAFAD 2 / 3 and Khalida 1 / 6 too few.

### Meetings due

- **Source of truth:** `appointments`, main, online and provisional kinds,
  stored as `meetings_due`.
- **Rule:** by the Kuwait meeting day, time passed, not cancelled or invalid,
  not a Google copy, and (since 16 Oct) not a booking the contact replaced
  before its time with no mark anywhere and no row on the client's sheet
  (GoHighLevel leaves the old one confirmed). The day's note counts those.
- **Checked against:** the client's own sheet, read live in Google Sheets. After
  the fix Alkhalil 7 = 7 and Atlantis 10 = 10; Ardon 4 against 3 (its sheet
  starts in October), Professional Touch 5 against 4 and شركة العلا 37
  against 36 are real (a contact who rebooked after the meeting time).
- **Gaps:** upstream, the dialer's RESCHEDULE flow should cancel the old
  GoHighLevel appointment: systems manager (dialer).

### Shows, no-shows, show rate

- **Source of truth:** CRM status showed or noshow, then the client sheet's
  mark (the CRM copy `appointments.attended`, else the dialer's sheet row at
  the same contact and time, else, since 16 Oct, the contact's only sheet row
  that Kuwait day for the contact's only meeting that day), then the portal.
- **Rule:** unmarked is never a no-show; a day whose due meetings are all
  unmarked is NULL. Show rate = shows / (shows + no-shows); the client line is
  60%, under it is a watch.
- **Checked against:** the client sheets' Show column and the dialer's report
  (equal; after the fix Atlantis 6/3 = 6/3).
- **Gaps:** شركة العلا leaves Show blank on 35 of 36 sheet rows and Ocean Home
  on 30 of 31; Castello, mergestudio and Professional Touch mark none. Ask
  them to fill it: client success.

### Appointments with no outcome

- **Rule:** a due meeting with no portal outcome at any revision and no sheet
  mark. **Checked against:** sheet rows with Show blank and no portal outcome;
  five meetings read raw. After the fix Alkhalil 1 and Atlantis 1, equal to
  the sheet. Ocean Home 30 and شركة العلا 36 are real.

### Quotations and quotation rate

- **Source of truth:** the client sheet's Quotation column (column K) through
  the CSM copy, and the portal's quotation; the larger per day.
- **Rule:** by meeting day. The board's quotation rate = quotations / shows,
  summed over the days both are known; target 50% of shows (the constraints
  checklist). NULL when the client fills neither source, and (since 16 Oct) on
  a day whose due meetings have no quotation answer. `quotation_answers`
  (Y + N) tells a "no" from a blank and is known once the copy keeps N
  (`quoteKeepsN`, the native feed release after 16 Oct); the board's read
  carries it as its own figure (`quotationAnswers`), never as the rate's
  denominator, so a client who marks only Y does not read 100%.
- **Checked against:** the client sheets read live (Arcturus 12 Y and 14 N: a
  46% rate the board could not show).
- **Gaps:** six clients leave Quotation blank on every row (Ardon, Castello,
  Marble and more, mergestudio, Professional Touch, شركة العلا): client
  success. SAFAD's sheet says Y where its portal says no for the same two
  meetings (the sheet wins as the larger).

### Closes, revenue, AOV, close rate

- **Source of truth:** the client sheet's Closed (Y, N, P) and value columns
  through the dialer's `cc_results` (the first closed meeting per contact, no
  conflict), and the portal's won deals, one deal counted once.
- **Rule:** by meeting day; USD only at the fixed rates, an unknown currency
  left out and counted (`sources.sheet.unpricedCloses`). A day whose due
  meetings have no deal answer is NULL, not 0 (31 client-days read 0 before;
  Ocean Home's October rows are blank).
- **Close rate (the gate):** closes / shows, as `reportPeriod.ts` computes it,
  judged against `CLOSE_RATE_GATE` = 20% in `kpi.ts` (the checklist's 20% of
  shown appointments). Never color closes / closes_answered against that gate.
- **Won, pending, lost (new on 16 Oct):** `closes_pending` and `closes_lost`
  (meetings marked pending or lost, one per contact, not a contact closed that
  day) and `closes_answered` (meetings with a deal answer; a sheet win counts
  on the contact's first closed meeting only, as closes does). The board shows
  them as a breakdown beside closes: "won 0, pending 25, lost 1" (Arcturus).
  All three are NULL on a day whose closes are NULL, and NULL for a client
  whose sheet and portal never mark a deal lost or pending. A client who marks
  wins only (Ocean Home's single Y) would otherwise read answered = won, a
  100% rate by construction.
- **Checked against:** the sheets read live and the portal: 1 close in 30 days
  (Ocean Home, USD 67,000 on both), equal.
- **Gaps:** seven clients fill no closes source: client success.

### ROAS

- **Source of truth:** the board's cell (`cockpit_board_rows`, `roas`):
  revenue (`cockpit_client_days.revenue_usd`, closed deal values by meeting
  day at the fixed rates; see Closes) over spend
  (`cockpit_meta_ad_days.spend_usd`).
- **Rule:** revenue / spend, both summed over cost per booking's paired days
  (to yesterday on each account's clock) on which the facts know the
  client's closed deals; a ratio of sums. Revenue is by meeting day and spend
  by the day it was spent, so over a week ROAS sets this week's spend against
  meetings from earlier leads: read it over 30 days or more.
- **Lines:** good at 20x or more, a watch from 10x, off under it
  (`cockpit_board_default_targets`, `roas`, approved 16 Oct; `kpi.ts` holds
  no ROAS gate).
- **"At least" and n/a:**
  - a closed deal with no value in a known currency: ROAS is at least the
    figure, good when that is already good, else not measured;
  - the client records no closed deals: not filled in, "The client does not
    record closed deals.";
  - some spend in a currency with no fixed USD rate, no paired day, or no
    spend on the days closed deals are known ("No ad spend in these days."):
    not measured, never 0x;
  - a TikTok-flagged client: Meta spend only (TikTok above).
- **Checked against:** its two halves are checked where they are kept
  (revenue against the client sheets and the portal under Closes, spend under
  Cost per booking). Read only on 23 Oct: no closed deal is stored for an
  Active client from 1 to 20 Oct (0 closes, $0.00 revenue). So on 14 to 20
  Oct a client that records closed deals and spent on the days they are
  known reads 0.00x (off): Alkhalil, Arcturus, Atlantis, City Wood, SAFAD,
  شركة العلا and Khalida. A client that records none reads "Not filled in":
  Ardon, Castello, Marble and more, mergestudio.kw, Shades, Madana, نهوض نجد
  and Professional Touch. Nothing spent on the days its deals are known
  reads n/a, "No ad spend in these days.", never 0x: ARCWANI, Joe and Sera,
  Liwan, and Ocean Home, whose closed deals are known only on 16 Oct, a day
  its account did not deliver. On 1 to 20 Oct ARCWANI, Liwan and Ocean Home
  read 0.00x too, and only Joe and Sera reads n/a. The one close of the 16
  Oct check (Ocean Home, USD 67,000) is dated 22 Sep.

### Lead quality

- **Source of truth:** the portal's latest revision per appointment, scores 1
  to 10 only; average = sum / count. **Checked against:** a recount from the
  raw outcomes (equal). **Coverage:** 7 clients, 14 scores in 30 days.

### Official dials

- **Source of truth:** the dialer's saved outcomes with a note
  (`call_center_events` kind outcome), by the Kuwait day saved.
- **Checked against:** `mahara_call_center_report` dials (equal for all 17).
- **Rule (fixed 16 Oct):** NULL for a client the dialer does not list (15
  such clients read 0 on every day), and NULL for a done-with-you client the
  dialer lists (نهوض نجد read 0 on all 120 days); the day's `sources.dialer`
  says which, with state `none`.
- **Gaps:** a dial is a saved outcome, not a Maqsam call: one caller saved 798
  outcomes against 530 provider calls in 30 days. See "Leads contacted".

### Leads called

- **Source of truth:** `call_center_events` leads with a verified Maqsam first
  dial, by lead creation day, WhatsApp chats left out.
- **Checked against:** the dialer's report `leadsDialed` (equal for all 17).
- **Rule:** NULL, never 0, for a client the dialer does not list and for a
  done-with-you client, as dials.
- **Freshness:** as current as the oldest Maqsam call job of the client's
  assigned callers (behind after 3 hours or an error).

### Leads contacted (the 90% line)

- **Source of truth:** `cockpit_client_now`, the last 30 Kuwait days,
  dialable GCC leads older than one working hour.
- **Rule:** `touched_30d` is `cockpit_client_calls` waiting `touched` (a
  Maqsam call by contact, a call to the phone under another lead, or a saved
  attempt): the rule of the waiting list, no longer the 90% line on the board
  or on the client pages. New on 16 Oct: `verified_called_30d` (a Maqsam call
  only, the client pages' waiting `called`) and `outcome_only_30d` (touched by
  a saved outcome alone, their `outcomeOnly`); `board-facts-supabase.test.ts`
  asserts both equal over the same days. Since
  `20261016220000_board_read_checked.sql` the board's Leads contacted is
  verified / callable, judged against the 90% line; the touched share and the
  outcome-only count stay in the cell and its note ("38 more have a saved
  outcome but no Maqsam call, so they are not counted (95% if they were)").
  Since `20261016230000_client_calls_maqsam_line.sql` the client success and
  media buyer client pages judge the line the same way: `cockpit_client_calls`
  waiting `called` / `callable`, with `outcomeOnly` said beside it ("17 more
  have a saved outcome but no Maqsam call, so they do not count"). Their
  waiting list keeps the touched rule: a lead with a saved outcome is not
  listed as waiting, and the first Waiting now row words it by what it counts
  ("has a Maqsam call or a saved outcome"), never as "called or messaged".
  DWY clients store no waiting figures.
- **Dates:** the rule is the same, the dates are not. The board counts the
  last 30 Kuwait days; a client page counts the dates picked on it (client
  success opens on this month to date, the media buyer on the account page's
  range). The page's share equals the board's Leads contacted only on "30
  days" (today and the 29 days before). The board's figure is also as of its
  last 30-minute run, while the page reads live.
- **Checked against:** Maqsam outbound calls with saved attempts left out:
  City Wood 95% touched against 57% called, شركة العلا 95% against 80%,
  Marble 100% against 76%, Arcturus 99% against 89%, Khalida 100% against
  57%, mergestudio 94% against 81%. Six clients flip from pass to fail on the
  90% line. Professional Touch's 64% is real (31 waiting, the oldest from 29
  Sep).
- **Gaps:** almost all outcome-only touches are on clients of one caller. The
  call-centre lead asks whether that caller dials from a line Maqsam does not
  see.

### Median first call (working seconds)

- **Source of truth:** `call_center_events` lead speed (the caller's Team &
  Payroll hours), median over 30 days. **Checked against:** the dialer's
  report `medianSpeedSeconds` (equal). **Gaps:** breaks and schedule changes
  are not recorded.

### Assigned caller

- **Source of truth:** the dialer's access list (`mahara_console.metadata`
  access:agent, active, with the location), kept when the account's role is
  agent. **Checked against:** who saved the dials (100% from the assigned
  caller for all 16 DFY clients).

### Tracking sheet link

- **Source of truth:** the ClickUp card's Sheet Link. **Checked against:**
  `ghl_clients.sheet_link`, `portal_data.workspaces` and the dialer's
  `sheet_snapshots.sheet_id`: 17 of 17 active agree.
- **Gap fixed:** the dialer stores only filled rows, so an empty month tab
  read as a missing tab (Khalida's October). The note now says "Its Oct 26 tab
  has no rows yet".

### Freshness of each source

| Source | Where the board reads its time | Behind when |
| --- | --- | --- |
| Meta ad numbers | `cockpit_sync_state` meta-ad-days-hourly / -nightly, `cockpit_meta_ad_days_status()` per account | suggested: the hourly run's last ok over 2 hours ago; an account failing its read |
| CRM leads | `lead_sync_state` per location (`sources.leads.as_of`) | 3 hours, or a failed run |
| Appointments | `appointment_sync_state` (`sources.appointments.as_of`) | 3 hours, or a failed run |
| Provisional bookings | `mahara_reporting.sync_jobs` appointments_recent `last_success` | 3 hours, or an error |
| Calls and leads called | `sync_jobs` kind calls, the oldest job of the assigned callers | 3 hours, or an error |
| Client sheets | `sheet_snapshots.checked_at` and `error`; the CSM copy's `performanceSyncedAt` | 3 hours, or an error |
| Portal outcomes | the latest client report (`sources.outcomes.as_of`) | not a read time: no "behind" |
| The facts | `cockpit_sync_state` board-facts and `cockpit_board_facts_doctor()` | 2 hours; the 120-day fill 26 hours |
| The media sync's 7 days (build 2) | `cockpit_media_week()`: `through` and `source` ("media sync" once the worker publishes `ads7d`, else "media data") | `through` before the day before yesterday, or "media data" after the worker's first publish of `ads7d` |

On 16 Oct at 16:30 Kuwait every source was fresh: lead sync 15:35, appointments
16:20, the dialer's appointment and call jobs 16:25 to 16:27, sheets 16:22 to
16:27, the CSM copy 16:10, meta-ad-days hourly 16:12, the facts 16:10.

## What changed on 16 October

| Found | Fixed in | Effect |
| --- | --- | --- |
| The board judged Leads contacted on saved outcomes as well as Maqsam calls | `20261016220000_board_read_checked.sql` | verified / callable on the 90% line: City Wood 95% to 57%, Marble and more 100% to 76%, شركة العلا 95% to 80%, mergestudio 94% to 81%, Arcturus 99% to 89%, Khalida 100% to 57% |
| Spend on accounts no client row carries was silently outside the totals | same | `offBoard` on the read and a "Not in these totals" line under the totals (whole-board seats): $1,712 on 10 accounts over 16 Sep to 15 Oct |
| Won, pending and lost not on the board | same | the Closes cell and its note ("Won 0, still pending 23, lost 1"), the totals' "N pending" |
| DMs inside CRM leads not said | same | the CRM leads cell counts them (`dms`) and says so |
| DMs counted as CRM ad leads | `20261016210000_board_facts_checked.sql` | Ocean Home 139 to 115, Alkhalil 75 to 57, City Wood 52 to 48; DMs in `crm_dm_contacts` |
| Status and service from the registry, not ClickUp | same | Shades Active; three lost clients Stopped; doctor lists disagreements |
| Spending accounts no tie reached | same, and `20261016210200_board_account_ties.sql` | Shades, Ardon, Pidco, AEA tied with evidence; Alkhalil's SAR account (the client's own post boosts) kept out and named; the registry's own ad account field read as the last tie |
| Bookings replaced before their time still due | same | Alkhalil 8 to 7, Atlantis 12 to 10 meetings due |
| RESCHEDULE and CALLBACK bookings counted as bookings | same | Alkhalil 8 to 7, Arcturus 29 to 28 confirmed |
| A sheet mark lost when the CRM moved the meeting | same | Atlantis shows 5 to 6 |
| Pending and lost deals not kept | same | `closes_pending`, `closes_lost`, `closes_answered` as a breakdown; NULL for a client who marks wins only; the gate's close rate stays closes / shows |
| 0 closes and quotations on unreported days | same | NULL on those days |
| Quotation N dropped | same, and `hermes/cockpit-sync/csmProviders.ts` | answers known after the native feed release |
| Dials 0 for clients the dialer does not list | same | NULL with a note |
| Saved outcomes counted as contact | same | `verified_called_30d`, `outcome_only_30d`; DWY stores no waiting figures |
| Today read as complete | same | `partial` on every source of a day not yet over |
| Stale notes on old days after one failed read | same | the 30-minute run fills the 120 days again when the source reads again |
| Bulk uploads unnamed | same | the day's leads note and `bulkImport` |
| The call centre's CALLBACK bookings counted by the media sync | `calculator.ts` | dropped by their ids, as the facts do; no calendar dropped by its name. Not released until 22 Oct (release e4c0cpb1, with the rule of 21 Oct): see What changed on 21 and 22 October |
| An empty month tab called missing | same | "Its Oct 26 tab has no rows yet" |
| The doctor's plain-word problems could not be added | same | typed as text |
| A client's reach summed part of its accounts | `20261016210100_meta_ad_days_checked.sql` | Marble, ARCWANI, Liwan read "unknown" until the nightly run |
| No full-day reach windows | same | `last_7_full`, `last_30_full` |
| Hidden accounts called "not linked" | same | "Hidden on purpose" |
| No word for billing or cancelled-client spend | same, and the doctor in `meta-ad-days` | `billingStopped`, `cancelledDelivering` |
| The doctor's "not linked" list always empty | same, and `run.ts` | the accounts are sent with their names |
| Reach windows on the same days refused or 0 | `meta-ad-days` `parse.ts`, `run.ts` | each span read once, written to both |
| Lead ids never kept | `20261016210100_meta_ad_days_checked.sql`, `run.ts` | `cockpit_meta_lead_ids`, `cockpit_meta_leads_not_in_crm` |
| The client pages judged the 90% line on saved outcomes as well as Maqsam calls (City Wood 57% on the board, 95% on its page) | `20261016230000_client_calls_maqsam_line.sql`, `callCentre.ts` and `CallCentreSection.tsx` in client success and media buyer | waiting `called` / `callable` on the 90% line, `outcomeOnly` said beside it; touched, callable and the waiting list unchanged |

To make it live, in order (systems manager, the lead session):
1. Apply `20261016210000_board_facts_checked.sql`.
2. Apply `20261016210100_meta_ad_days_checked.sql` and deploy `meta-ad-days`
   (either order).
3. Apply `20261016210200_board_account_ties.sql`.
4. `select public.cockpit_board_facts_run('nightly');` once, then
   `select public.cockpit_board_facts_doctor();`.
5. Post `{"job":"doctor"}` to `meta-ad-days`; the next hourly run ties the new
   accounts, and the nightly run (03:20 Kuwait) reads every account's reach
   and the lead ids.
6. Release the native feed (`hermes/cockpit-sync`) so the CSM copy keeps
   quotation N and the media sync drops the call centre's RESCHEDULE and
   CALLBACK bookings by id.
7. Apply `20261016230000_client_calls_maqsam_line.sql` (it replaces only
   `cockpit_client_calls`) and ship client success and media buyer, in either
   order: a page on a read without `called` keeps the touched share.

Budgets on the board (2026-10-17), in order (systems manager):
1. Apply `20261017100000_meta_budgets.sql` and deploy `meta-ad-days`
   (either order), then post `{"job":"doctor"}` and `{"job":"backfill","days":45}`.
2. Apply `20261017100100_board_budgets.sql` (it needs the first), then ship
   the media buyer cockpit. Until the first hourly budgets read, the board
   says the budgets have not been read and the three columns name the
   accounts not read yet (n/a, never $0).
3. After a day of hourly reads, check on production: Khalda's ABO blocked by
   its ads counts its $1,104 a day at 0% with "Ads with issues"; a prepaid
   account (mergestudio.kw) reads "Prepaid balance"; City Wood, Ardon and
   Castello (no ad-day rows) read a Budget used from the listing's $0 days,
   not n/a.

## What changed on 21 and 22 October

The cost per booking audit of 21 Oct (`CPB-AUDIT-20261021.md`) and its two
builds (`CPB-20261021.md`). Shipped on 22 Oct unless the row says build 2.

| Found | Fixed in | Effect |
| --- | --- | --- |
| Every RESCHEDULE booking dropped, so a lead whose first booking GoHighLevel deleted had none (R4, D0b) | `20261021l_board_booking_rule.sql` | SAFAD 14 to 20 Oct: 1 to 2 bookings, $390.80 / 2 = $195.40 |
| Bookings GoHighLevel no longer holds still counted (R7) | same, the interim gone check | 1 to 20 Oct: Ardon 7 to 6 ($138.06), Ocean Home 28 to 27 ($27.87), Shades 5 to 4, Alkhalil 1 to 0 (no booking on $367.34) |
| The campaign tree kept call-backs, moved bookings and gone bookings, so a campaign could show more bookings than its client (R4) | `20261021m_board_tree_booking_rule.sql` | 22 Sep to 21 Oct: Alkhalil 'ALKHALIL- MAHRA-15\9' 6 to 4, Arcturus 'Arcturus-Mahara-3\9' 26 to 25 ($43.41) |
| A Meta zero read could replace a settled ad-day (R6) | `20261021k_meta_ad_days_zero_reads.sql` | none today: Atlantis 19 Oct healed itself to $15.38 on the 22 Oct nightly |
| The CSM Ads tab counted ads on the compromise list (R3) | `20261021j_csm_client_ads_excluded.sql` | 1 to 20 Oct: Liwan $1,211.23 to $194.58, Khalida $1,244.98 to $191.53 |
| The media sync counted the call centre's call-backs, every calendar except a short list of names, and bookings made today against spend to yesterday (R1, R4, R13) | native release e4c0cpb1, `calculator.ts` | the media sync's bookings equal the board's client by client (Confirmed bookings); its 7 days end on the sheet's last spend day |
| The first break never named cost per booking (R14); no booking on more than $60 read an untoned "n/a" (R15) | `boardColumns.ts`, `costTone.ts` | 14 to 20 Oct: SAFAD and Khalida read "Off at cost per booking"; City Wood, Castello, Arcturus and Alkhalil, whose cost per booking is off or a watch too, read "Off at booking rate", which comes first (City Wood 3 / 30 = 10%). On the media buyer's Ads page Alkhalil reads "None on $233" in red; the board shows "$233+" with the off dot |
| The board's cost per lead judged alone while cost per booking was good (R5) | build 2: `20261022y_board_cpl_golden_rule.sql` | Atlantis 14 to 20 Oct: cost per lead off to watch, first break "Off at ROAS" |
| The Bookings help never said call-backs and moved bookings are left out (R4) | build 2: `boardColumns.ts` | "Main and online calendar bookings made on these days. Cancelled, invalid, Google Calendar copies, the call centre's call-back bookings and rescheduled bookings whose original still counts are left out." |
| No single 7-day end for the SQL readers; the media buyer's range reads ended on the newest day of any account, so overnight a sheet account counted a day of bookings past its spend (R1) | build 2: `20261022w_media_week.sql` | `cockpit_media_week()`, `bookingsThrough` on the coverage read, winner numbers capped (the 1 to 21 Oct preview of "CityWood v1": 3 bookings at $38.22, not 7 at $16.38); three saves stored before hold a booking made after their spend, named under Cost per booking |
| The media buyer's client page summed only the campaigns still listed (R8) | build 2: `20261022x_media_client_range.sql`, `AccountView.tsx` | 1 to 20 Oct: Khalida $91.62 to $191.53 (1); Castello $333.83 (2); ARCWANI and Liwan open |
| No cost per booking rule written down (R19) | this file | Cost per booking, Lead to booking, ROAS above |

## What changed on 23 October

The CEO's answers of 23 Oct 2026 to the questions build 2 left open, built
from `CPB-DECISIONS-20261023.md` (rules in its section 1, the figures every
surface must read in its section 5, the ship order in its section 6). The
figures below are the board read as the CEO seat at 14:30 Kuwait on 23 Oct;
what shipped and how it was checked is section 10 of `CPB-20261021.md`.

| Decided | Built in | Effect |
| --- | --- | --- |
| D0a, "Yes": SAFAD's two outsider ads go on the compromise list | `20261023p_exclude_safad_unauthorized_ads.sql`; the worker's `EXCLUDED_AD_IDS` (native release N3); `20261021d_excluded_ads_stats_leftovers.sql` after N3's first published cycle | the list holds 23 ads. SAFAD 14 to 20 Oct $390.80 / 2 = $195.40 (off) becomes $15.71 / 2 = $7.86 (good); 1 to 20 Oct $227.93 becomes $102.90; Budget used 14 to 20 Oct 8.71% becomes 7.48%. 8 creative-dashboard rows ($375.10) and, after N3, 47 media rows ($3,452.64 at the 23 Oct count: the 10 Oct leftovers and SAFAD's 8) go to the archive |
| 2, "No keep the CPL but ignore CPB": a done-with-you client keeps its cost per lead and is never judged on cost per booking | `20261023r_board_done_with_you.sql`; `boardColumns.ts`, `boardClient.ts`, `cells.tsx`, `eodRollup.ts`; the CEO refresh (N3) and its tabs | نهوض نجد's cost per booking and booking rate read "Done with you", its first break "On target". Its spend leaves every portfolio cost per booking and is named: Active clients 14 to 20 Oct **$51.52** (was $63.10; $55.45 after D0a alone, $59.18 after decision 2 alone), 1 to 20 Oct **$68.07** (was $77.06; $73.35 after D0a alone, $71.78 after decision 2 alone), 16 to 22 Oct **$44.58** (was $48.18, decision 2 alone). Its cost per lead ($12.02, 14 to 20 Oct) and every portfolio cost per lead keep it |
| 3, "$80": ClickUp's "911" on Cost Per Booking starts over $80 | `clickup-writeback` `rules.ts` (`CPB_911 = CPB_BAD`, from `kpi.ts`) and `kpi.ts` | four bands at $45, $60 and $80 (was $90). Dry run 16 to 22 Oct: Arcturus 3\9 ($172.14 / 2 = $86.07) goes from "Below KPI" to "911"; 79 writes on 17 cards become 80 with decision 4. Nothing reaches ClickUp while `CLICKUP_WRITEBACK_APPLY_KPI` is off |
| 4, "Depends on how much spend if 2x target cpl then yes bad if below that then not enough data" | `20261023s_board_cpl_no_lead.sql`; `kpi.ts` `NO_LEAD_MULTIPLE`, `noLeadLine()`, `belowKpi`; the worker's `calculator.ts` (N3); the CEO refresh (N3); `eodRollup.ts`, `adsFilters.ts`, `VerdictPlaybook.tsx`; CSM `csmDiagnosis.ts` and `ClientAds.tsx`; `clickup-writeback` `kpi.ts` | no form lead on 2 x the cost per lead line ($30.00 today) or more is off, under it too few to judge (Cost per lead). Madana, 14 to 20 Oct, no lead on $11.09: too few on the board (unchanged), a watch with "Too few to judge" on CEO Delivery (was bad), out of the EOD's "Clients out of KPI". The EOD's over-the-gate line reads "Any client with a 7-day CPL over $15, or no lead on $30 or more" and names a client or campaign with no lead on the line with its spend ("<client> (no lead on $74.31)" for monshaat-mahara-20\10); before the build such clients were never on it, since they have no cost per lead. 16 to 22 Oct: 9 of 13 zero-lead ads go from kill to hold in the media sync; monshaat-mahara-20\10 (no lead on $74.31) gets ClickUp Cost Per Lead "911" |
| 5, "triple edge is a old churned client" | `20261023q_churned_ad_accounts.sql` (`cockpit_churned_ad_accounts`), `20261023t_board_read_churned.sql`, `20261023u_meta_ad_days_churned.sql`; `PerformancePage.tsx`; the CEO refresh (N3) | "Not in these totals" names Triple Edge Building Construction "churned client" ($14.62 in 14 to 20 and 1 to 20 Oct, $9.74 in 16 to 22 Oct; the totals do not move); the board's "Not linked" line is gone; the Meta ad-days note names it under "Spent for a cancelled, stopped or churned client". CEO Delivery 16 to 22 Oct: 16 client rows become 15 and Triple Edge leaves "Clients off track" (5 becomes 4 in the 14:22 payload; 6 becomes 5 in the 20:53 one, where Castello holds 3 bookings for those days, not 4, and reads $269.53 / 3 = $89.84, bad); its spend stays in company spend, leads and cost per lead |
| Default (b): listed ads leave the winners archive and the market lens | the worker's `winners.ts` and `marketProducer.ts` (N3) | No listed ad joins the creative winners archive; the 3 listed winners already in it (Khalida `120246795745520088` and `120247012327250088`, Liwan `120246624477980705`) stay until a follow-up migration removes them, because the media publish refuses a plan that deletes archive history. The 18 market ad sets holding a listed creative lose it, SAFAD's outsiders' ad set among them |

Closed from "What is left" by these decisions: SAFAD's outsider ads (D0a);
the done-with-you cells and the done-with-you spend in the portfolio cost per
booking (decision 2); whether ClickUp's "911" starts at $80 (decision 3);
Triple Edge (decision 5). Spend with no lead (decision 4) was open in
`CPB-20261021.md` 8.5. The switch `CLICKUP_WRITEBACK_APPLY_KPI` stays open.

## What is left, and who does it

| What | Who |
| --- | --- |
| Shades's lead form "Shades\|mahara\|14\10" is not connected to its GoHighLevel location (newest contact 8 Oct; 3 to 4 form leads since 14 Oct never arrived). Connect it, send one test lead, re-send the missing ones. | Media buyer |
| Professional Touch's ad account is not shared with Mahara's business 767701513092162: ask the client to share it and give the system user ads_read; then add a hand tie and run a backfill for that account. Until then spend is "unknown", never $0. | CEO, then systems manager |
| Cancelled clients' accounts spent $1,507 in 30 days (Ideal Elite $578.62 on an outsider's campaign on the compromise list, not Mahara's, so the board leaves it out since 21 Oct; Pidco $553.00 still delivering, AEA, Rm decor, حول العمران, MOFAG). Confirm each client's status; switch delivery off where the client is gone; decide whether to remove Pidco's account from Mahara's business. | Client success, media buyer, CEO |
| Alkhalil's SAR account 640644143620696 is kept out of Alkhalil's figures (only the client's own Instagram post boosts). If Mahara does manage it, set its `kept_out` to false in a migration with the evidence. | Media buyer, then systems manager |
| Atlantis's "Project Review & Qualification Call" calendar (`GfUwbVvlYJjHSSauPwVB`) also takes leads' own bookings (3 of 5). Decision D0c, the default since 21 Oct: it is not a booking calendar, and the board and the media sync (release e4c0cpb1) both leave it out. If client success says it books, allow it by its calendar id in the worker and the board together (Atlantis would read $34.91 for 14 to 20 Oct and $79.97 for 1 to 20 Oct, audit section 1); if it does not, the booking page should not offer it. | Client success, then systems manager |
| SAFAD's outsider ads are decided (D0a, 23 Oct). Confirm in one line that Mahara's business access to SAFAD's account act_774492648699300 is intact after the outsiders and the person-level roles were removed on 20 Oct. SAFAD's only Mahara campaign row ("Safad \| MAHARA \| 16-8") went `source_deleted` at 00:51 on 23 Oct, so it has no Ads Management card and ClickUp's plan dropped card 86eyn6c1f without naming it: say whether the card was retired on purpose. | Media buyer |
| The board's cost per booking reads "$0", judged good, when confirmed bookings land on days with no spend (mergestudio.kw 19 Oct, Atlantis and شركة العلا 18 Oct, Ocean Home 15 Oct). Read n/a with the reason, as the media buyer, the client range read and the CEO do (Cost per booking). | Board team |
| The appointments sync never marks the bookings it stops receiving; the board's gone check is the interim (R7). | Systems manager |
| ClickUp's Bookings (7d) and Cost Per Booking stay a dry run after build 2 (`clickup-writeback:kpi` reads ok=false and says why). Switching `CLICKUP_WRITEBACK_APPLY_KPI` on needs the systems manager's approval, after the one-card canary. The "911" line is decided (over $80, decision 3 of 23 Oct). Before the switch, the media buyer knows Arcturus 3\9 goes from its 7 Oct "Above KPI" straight to "911" and monshaat's Cost Per Lead to "911". | Systems manager |
| Triple Edge is a churned client (decision 5, 23 Oct; Ad accounts tied to a client). Whether its ad account leaves Mahara's Meta business (767701513092162): it still spent in October. Its two campaigns, and Pidco's three, still appear in the worker's launch watch and the weekly tracking backlog until the worker skips cancelled, stopped and churned accounts. | Client success; the worker's owner for the skip |
| Art Vision (spent $25.67, no client record) and ريبالو/ORB (hidden; Ocean Home's owner's other brand?): name, hide or remove. | Client success, CEO |
| Ardon's Page gives Mahara no lead access, so its leads cannot be matched lead by lead. | CEO asks the client |
| ARCWANI, Liwan, Ocean Home, SAFAD and شركة العلا accounts are unsettled (billing); marblemore1 is disabled. | Client success |
| شركة العلا and Ocean Home leave the Show column blank; six clients leave Quotation and Closed blank. | Client success |
| Confirm نهوض نجد's ad platform (its card says Tiktok) and Joe and Sera's (flagged TikTok, card says Meta). | Client success |
| One caller's leads are "touched" by saved outcomes with no Maqsam call. | Call-centre lead |
| Whether Instagram and Messenger DMs should leave CRM leads like WhatsApp chats. | CEO, systems manager |
| The dialer: RESCHEDULE should cancel the old GoHighLevel appointment; its appointment facts should learn when GoHighLevel drops a booking; its sheet reader could keep column K as a second quotation source; the copy of sheet marks onto `appointments.attended` should take the same moved-time fallback as the facts. | Systems manager (dialer) |
| The board, still to read (done on 16 Oct: NULL as unknown, the 90% line on `verified_called_30d`, close rate = closes / shows with won, pending and lost beside it, cost per lead from Meta's leads, spend outside the rows as "Not in these totals", each account's own clock, a dash for DWY call-centre figures): "so far, as of" on a partial today; full-day windows by default; the billing reason from `billingStopped`; "Meta leads not in the CRM" from `cockpit_meta_leads_not_in_crm` on the client page, once the first nightly run (03:20 Kuwait) has stored Meta's lead ids. | Board team |
| Flag a client whose "Meta leads not in the CRM" is above 0 for two days. | Systems manager (cockpit guardian) |
| The SAR and QAR pegs in the fixed rates (about $0.50 in 30 days). | Systems manager, optional |
| Hook and hold targets from Mahara's own spread; one KPI set (`kpi.ts` or the October plan). | Media buyer, CEO |
| Composio's HighLevel connections are expired, so GoHighLevel could not be read as a third source. | CEO, optional |

## Second-source check, 16 October 2026

Run on 16 Oct 2026 between 16:07 and 16:50 Kuwait, read only. Windows: 30 days
= 16 Sep to 15 Oct, 7 days = 9 to 15 Oct (full days) unless a row says
otherwise. Ad numbers are in USD at the fixed rates. "Stored" is what the board's
tables held at the time; "Independent" is the second source; "After the fixes"
is the stored figure the 16 Oct corrections give, recounted read-only on live
data (blank where nothing changes).

### A. Meta ad numbers (stored `cockpit_meta_ad_days`, `cockpit_meta_reach`; independent Meta Graph v25.0 GET)

| Client | Metric | Stored | Independent | Match | Note, after the fixes |
| --- | --- | --- | --- | --- | --- |
| Alkhalil | spend / impressions / link clicks, 30d, 7d | 644.12 / 28,426 / 563; 94.30 / 5,890 / 102 | same | yes | |
| Alkhalil | link CTR / CPC / CPM, 30d, 7d | 1.98% / $1.14 / $22.66; 1.73% / $0.92 / $16.01 | same | yes | |
| Alkhalil | form leads / lead action, 30d, 7d | 57 / 57; 4 / 4 | same | yes | |
| Alkhalil | video 3s / plays / ThruPlays / p25 / p50 / p75 / p100, 30d | 2,915 / 26,933 / 580 / 1,230 / 548 / 403 / 200 | same | yes | 7d equal too |
| Alkhalil | reach / impressions / frequency, last_30, last_7 (to today) | 20,748 / 32,384 / 1.56; 9,288 / 10,552 / 1.14 | 21,000 / 32,713 / 1.56; 9,606 / 10,881 / 1.13 | yes | gap is today's delivery between the two reads |
| Alkhalil | CRM ad leads vs Meta form leads, 30d, 7d | 75; 7 | 57; 4 | no | 18 Instagram DMs counted. After: 57 |
| Arcturus Construction | spend / impressions / link clicks, 30d, 7d | 993.65 / 61,788 / 1,391; 257.65 / 17,633 / 407 | same | yes | |
| Arcturus Construction | link CTR / CPC / CPM, 30d, 7d | 2.25% / $0.71 / $16.08; 2.31% / $0.63 / $14.61 | same | yes | |
| Arcturus Construction | form leads / lead action, 30d, 7d | 83 / 83; 23 / 23 | same | yes | |
| Arcturus Construction | video fields, 30d, 7d | 9,038 / 58,515 / 2,124 / 2,967 / 1,552 / 823 / 468 | same | yes | |
| Arcturus Construction | reach / impressions / frequency, last_30, last_7 | 28,655 / 67,036 / 2.34; 12,694 / 21,364 / 1.68 | 28,867 / 67,312 / 2.33; 12,919 / 21,640 / 1.68 | yes | today's delivery |
| Arcturus Construction | CRM ad leads vs Meta form leads, 30d, 7d | 82; 22 | 83; 23 | no | 5 Meta leads never became contacts (7 to 9 Oct); 4 DMs counted. After: 78 |
| ARCWANI | spend / impressions / link clicks, 30d, 7d | 859.08 / 146,514 / 2,088; 126.43 / 51,744 / 527 | same | yes | no delivery since 9 Oct (unsettled billing) |
| ARCWANI | link CTR / CPC / CPM, 30d, 7d | 1.43% / $0.41 / $5.86; 1.02% / $0.24 / $2.44 | same | yes | |
| ARCWANI | form leads / lead action, 30d, 7d | 31 / 53; 0 / 0 | 31 / 53; none | yes | 22 lead actions from an Engagement campaign |
| ARCWANI | video fields, 30d, 7d | 4,246 / 28,152 / 674 / 810 / 409 / 556 / 150 | same | yes | |
| ARCWANI | reach, last_30, last_7 | no client row | 106,233 / 144,862 / 1.36; no delivery | no | After: a row reading "unknown, waits for the nightly run" until it runs |
| ARCWANI | CRM ad leads vs Meta form leads, 30d, 7d | 32; 0 | 31; none | no | all 31 matched; one contact's lead is outside the window. After: 32 |
| Ardon | spend / impressions / link clicks, 30d, 7d | 887.83 / 180,822 / 991; 320.92 / 72,618 / 410 | same | yes | SAR 3,330.21 at 0.2666 ($888.06 at the peg) |
| Ardon | link CTR / CPC / CPM, 30d, 7d | 0.55% / $0.90 / $4.91; 0.56% / $0.78 / $4.42 | same | yes | |
| Ardon | form leads / lead action, 30d, 7d | 79 / 79; 21 / 21 | same | yes | |
| Ardon | video fields, 30d, 7d | 27,923 / 168,859 / 5,439 / 5,887 / 2,450 / 1,303 / 570 | same | yes | |
| Ardon | reach, last_30, last_7 | 98,073 / 188,356 / 1.92; 50,303 / 71,677 / 1.42 | 98,191 / 188,606 / 1.92; 50,492 / 71,927 / 1.42 | yes | today's delivery |
| Ardon | CRM ad leads vs Meta form leads, 30d, 7d | 81; 29 | 79; 21 | no | bulk uploads on 28 Sep and 13 Oct; no lead access on its Page. After: 76 |
| Atlantis Contracting | spend / impressions / link clicks, 30d, 7d | 930.33 / 25,234 / 334; 152.28 / 5,655 / 60 | same | yes | account on Los Angeles days |
| Atlantis Contracting | link CTR / CPC / CPM, 30d, 7d | 1.32% / $2.79 / $36.87; 1.06% / $2.54 / $26.93 | same | yes | |
| Atlantis Contracting | form leads / lead action, 30d, 7d; LPV | 42 / 42; 2 / 2; 101 | same | yes | 38 instant form + 4 website |
| Atlantis Contracting | video fields, 30d, 7d | 2,621 / 13,324 / 556 / 857 / 405 / 218 / 123 | same | yes | |
| Atlantis Contracting | reach, last_30, last_7 | 11,910 / 25,030 / 2.10; 2,990 / 4,927 / 1.65 | 11,915 / 25,075 / 2.10; 3,012 / 4,972 / 1.65 | yes | today's delivery |
| Atlantis Contracting | CRM ad leads vs Meta form leads, 30d, 7d | 46; 3 | 42; 2 | no | 3 form leads never became contacts; 6 DMs counted. After: 40 |
| Castello Industries | spend / impressions / link clicks, 30d, 7d | 946.89 / 111,629 / 462; 269.47 / 65,859 / 207 | same | yes | second account closed, spent nothing |
| Castello Industries | link CTR / CPC / CPM, 30d, 7d | 0.41% / $2.05 / $8.48; 0.31% / $1.30 / $4.09 | same | yes | |
| Castello Industries | form leads / lead action, 30d, 7d | 69 / 69; 34 / 34 | same | yes | |
| Castello Industries | video fields, 30d, 7d | 10,617 / 94,337 / 2,095 / 4,597 / 2,228 / 1,342 / 953 | same | yes | |
| Castello Industries | reach, last_30, last_7 | 47,607 / 114,230 / 2.40; 29,350 / 62,044 / 2.11 | 47,701 / 114,348 / 2.40; 29,453 / 62,162 / 2.11 | yes | today's delivery |
| Castello Industries | CRM ad leads vs Meta form leads, 30d, 7d | 79; 37 | 69; 34 | no | 2 never became contacts; 13 DMs counted. After: 66 |
| City Wood | spend / impressions / link clicks, 30d, 7d | 946.96 / 47,366 / 438; 152.00 / 10,189 / 90 | same | yes | second account closed |
| City Wood | link CTR / CPC / CPM, 30d, 7d | 0.92% / $2.16 / $19.99; 0.88% / $1.69 / $14.92 | same | yes | |
| City Wood | form leads / lead action, 30d, 7d | 48 / 48; 7 / 7 | same | yes | |
| City Wood | video fields, 30d, 7d | 5,890 / 42,727 / 1,382 / 2,028 / 950 / 534 / 318 | same | yes | |
| City Wood | reach, last_30, last_7 | 30,826 / 51,855 / 1.68; 9,243 / 12,251 / 1.33 | 30,986 / 52,013 / 1.68; 9,330 / 12,409 / 1.33 | yes | today's delivery |
| City Wood | CRM ad leads vs Meta form leads, 30d, 7d | 52; 8 | 48; 7 | no | 2 never became contacts; 5 DMs counted. After: 48 |
| Joe and Sera Company | spend, 30d, 7d | 0; 0 | 0.00; 0.00 | yes | last spend 11 Sep; also runs TikTok (not read) |
| Liwan | spend / impressions / link clicks, 30d, 7d | 1,893.87 / 473,975 / 3,405; 268.94 / 4,174 / 93 | same | yes | no delivery since 12 Oct (unsettled) |
| Liwan | link CTR / CPC / CPM, 30d, 7d | 0.72% / $0.56 / $4.00; 2.23% / $2.89 / $64.43 | same | yes | |
| Liwan | form leads / lead action, 30d, 7d; LPV | 19 / 20; 4 / 4; 51 | same | yes | 1 WhatsApp lead from Engagement |
| Liwan | video fields, 30d, 7d | 3,082 / 17,402 / 645 / 1,030 / 525 / 363 / 191 | same | yes | |
| Liwan | reach, last_30, last_7 | no client row | 360,759 / 472,739 / 1.31; 2,830 / 3,526 / 1.25 | no | After: "unknown, waits for the nightly run" |
| Liwan | CRM ad leads vs Meta form leads, 30d, 7d | 17; 3 | 19; 4 | no | 3 never became contacts; 2 DMs counted. After: 15 |
| Marble and more | spend / impressions / link clicks, 30d, 7d | 228.44 / 12,171 / 106; 65.54 / 4,035 / 36 | same | yes | two accounts (marblemore1 disabled) |
| Marble and more | link CTR / CPC / CPM, 30d, 7d | 0.87% / $2.16 / $18.77; 0.89% / $1.82 / $16.24 | same | yes | |
| Marble and more | form leads / lead action, 30d, 7d | 26 / 26; 9 / 9 | same | yes | |
| Marble and more | video fields, 30d, 7d | 3,023 / 11,757 / 680 / 1,571 / 774 / 451 / 247 | same | yes | |
| Marble and more | reach, last_30 | 3,604 / 5,673 / 1.57 | 8,063 / 13,871 / 1.72 | no | one account of two, no note. After: "unknown, waits for the nightly run", then the two-account sum |
| Marble and more | reach, last_7 | 3,604 / 5,673 / 1.57 | 3,635 / 5,735 / 1.58 | yes | |
| Marble and more | CRM ad leads vs Meta form leads, 30d, 7d | 26; 9 | 26; 9 | yes | |
| mergestudio.kw | spend / impressions / link clicks, 30d, 7d | 154.12 / 5,692 / 93; 153.76 / 5,637 / 93 | same | yes | |
| mergestudio.kw | link CTR / CPC / CPM, 30d, 7d | 1.63% / $1.66 / $27.08; 1.65% / $1.65 / $27.28 | same | yes | |
| mergestudio.kw | form leads / lead action, 30d, 7d | 16 / 16; 16 / 16 | same | yes | |
| mergestudio.kw | video fields, 30d, 7d | 1,049 / 5,295 / 228 / 337 / 158 / 87 / 55 | same | yes | |
| mergestudio.kw | reach, last_30, last_7 | 3,881 / 6,555 / 1.69; 3,845 / 6,500 / 1.69 | 3,904 / 6,590 / 1.69; 3,868 / 6,535 / 1.69 | yes | today's delivery |
| mergestudio.kw | CRM ad leads vs Meta form leads, 30d, 7d | 16; 16 | 16; 16 | yes | |
| Ocean Home | spend / impressions / link clicks, 30d, 7d | 1,128.74 / 63,858 / 748; 228.94 / 12,498 / 128 | same | yes | unsettled billing |
| Ocean Home | link CTR / CPC / CPM, 30d, 7d | 1.17% / $1.51 / $17.68; 1.02% / $1.79 / $18.32 | same | yes | |
| Ocean Home | form leads / lead action, 30d, 7d | 115 / 115; 21 / 21 | same | yes | |
| Ocean Home | video fields, 30d, 7d | 13,932 / 58,430 / 4,282 / 11,056 / 6,463 / 4,475 / 2,748 | same | yes | |
| Ocean Home | reach, last_30, last_7 | 20,036 / 61,459 / 3.07; 5,866 / 10,131 / 1.73 | same | yes | |
| Ocean Home | CRM ad leads vs Meta form leads, 30d, 7d | 139; 28 | 115; 21 | no | 24 Instagram DMs counted. After: 115 |
| Professional Touch Company | spend, impressions, clicks, video | none: no account tied | unknown: Meta says the ads cannot be loaded | no | the account is not shared with Mahara's business |
| SAFAD Consultant Engineering | spend / impressions / link clicks, 30d, 7d | 883.42 / 551,066 / 4,142; 507.69 / 502,143 / 3,799 | 883.43 / 551,072 / 4,142; 507.70 / 502,149 / 3,799 | no | Meta added 6 impressions to 15 Oct after the read; the nightly re-read settles it |
| SAFAD Consultant Engineering | link CTR / CPC / CPM, 30d, 7d | 0.75% / $0.21 / $1.60; 0.76% / $0.13 / $1.01 | same | yes | |
| SAFAD Consultant Engineering | form leads / lead action, 30d, 7d | 49 / 49; 15 / 15 | same | yes | |
| SAFAD Consultant Engineering | video fields, 30d, 7d | 8,548 / 63,434 / 1,434 / 4,220 / 1,451 / 798 / 467 | same | yes | |
| SAFAD Consultant Engineering | reach, last_30, last_7 | 412,228 / 545,726 / 1.32; 383,856 / 497,690 / 1.30 | 412,228 / 545,732 / 1.32; 383,856 / 497,696 / 1.30 | yes | |
| SAFAD Consultant Engineering | CRM ad leads vs Meta form leads, 30d, 7d | 49; 16 | 49; 15 | no | equal by chance: 3 never became contacts, 3 DMs counted. After: 46 |
| شركة العلا | spend / impressions / link clicks, 30d, 7d | 1,000.55 / 34,773 / 666; 238.10 / 8,133 / 150 | same | yes | unsettled billing |
| شركة العلا | link CTR / CPC / CPM, 30d, 7d | 1.92% / $1.50 / $28.77; 1.84% / $1.59 / $29.28 | same | yes | |
| شركة العلا | form leads / lead action, 30d, 7d | 107 / 107; 19 / 19 | same | yes | |
| شركة العلا | video fields, 30d, 7d | 8,614 / 31,664 / 2,672 / 3,623 / 1,747 / 968 / 450 | same | yes | |
| شركة العلا | reach, last_30, last_7 | 12,527 / 33,728 / 2.69; 4,353 / 6,883 / 1.58 | same | yes | |
| شركة العلا | CRM ad leads vs Meta form leads, 30d, 7d | 122; 26 | 107; 19 | no | 15 DMs counted. After: 108 |
| شركة منشآت خالدة | spend / impressions / link clicks, 30d, 7d | 1,983.36 / 111,374 / 1,279; 388.96 / 55,035 / 601 | same | yes | campaign level equal too |
| شركة منشآت خالدة | link CTR / CPC / CPM, 30d, 7d | 1.15% / $1.55 / $17.81; 1.09% / $0.65 / $7.07 | same | yes | |
| شركة منشآت خالدة | form leads / lead action, 30d, 7d; LPV | 10 / 48; 4 / 4; 146 | same | yes | 38 WhatsApp leads from Engagement campaigns |
| شركة منشآت خالدة | video fields, 30d, 7d | 1,794 / 10,685 / 363 / 537 / 269 / 165 / 88 | same | yes | |
| شركة منشآت خالدة | reach, last_30, last_7 | 92,283 / 111,613 / 1.21; 2,399 / 2,749 / 1.15 | same | yes | |
| شركة منشآت خالدة | CRM ad leads vs Meta form leads, 30d, 7d | 9; 4 | 10; 4 | no | 1 never became a contact. After: 9 |
| نهوض نجد | spend / impressions / link clicks, 30d, 7d | 799.19 / 24,032 / 242; 173.48 / 5,470 / 69 | same | yes | |
| نهوض نجد | link CTR / CPC / CPM, 30d, 7d | 1.01% / $3.30 / $33.26; 1.26% / $2.51 / $31.71 | same | yes | |
| نهوض نجد | form leads / lead action, 30d, 7d | 67 / 67; 13 / 13 | same | yes | |
| نهوض نجد | video fields, 30d, 7d | 4,629 / 21,859 / 1,340 / 2,501 / 1,293 / 761 / 417 | same | yes | |
| نهوض نجد | reach, last_30, last_7 | 10,726 / 23,701 / 2.21; 3,408 / 5,299 / 1.55 | 10,726 / 23,723 / 2.21; 3,416 / 5,321 / 1.56 | yes | today's delivery |
| نهوض نجد | CRM ad leads vs Meta form leads, 30d, 7d | 58; 10 | 67; 13 | no | bulk upload on 6 Oct; 9 not contacts in the window |
| Ideal Elite (cancelled) | spend / impressions / link clicks, 30d | 578.62 / 5,281 / 106 | same | yes | ran 24 Sep to 7 Oct, 0 leads; an outsider's campaign on the compromise list, not Mahara's (corrected 21 Oct) |
| Ideal Elite (cancelled) | form leads / lead action; LPV | none / 0; 31 | 0 / none; 31 | yes | |
| MOFAG (cancelled) | spend / impressions / link clicks, 30d | 31.48 / 883 / 27 | same | yes | QAR at 0.2747 |
| MOFAG (cancelled) | form leads, video | 4 / 4; 142 / 810 / 40 / 48 / 28 / 19 / 14 | same | yes | |
| Rm decor (cancelled) | spend / impressions / link clicks, 30d | 127.38 / 1,724 / 31 | same | yes | |
| حول العمران (cancelled) | spend / impressions / link clicks, 30d | 108.62 / 8,535 / 33 | same | yes | |
| حول العمران (cancelled) | form leads, video | 6 / 6; 1,139 / 7,734 / 202 / 693 / 338 / 197 / 121 | same | yes | |
| AEA Designs (cancelled) | spend / impressions / link clicks, 30d | 109.04 / 3,041 / 31 | same | yes | After: tied by hand for the history |
| Art Vision (no client) | spend / impressions / link clicks, 30d; lead action | 25.67 / 11,531 / 79; 6 | same | yes | WhatsApp Engagement only |
| Alkhalil SAR account 640644143620696 | spend / impressions / link clicks, 30d, 7d | 79.76 / 22,700 / 35 | same | yes | After: kept out of Alkhalil's figures (the client's own post boosts), named "Hidden on purpose" |
| Shades | spend / impressions / link clicks, 30d, 7d | 446.84 / 80,612 / 544; 46.70 / 15,401 / 74 | 446.85 / 80,614 / 544; 46.71 / 15,403 / 74 | no | 2 impressions still settling. After: tied to Shades by hand |
| Shades | form leads / lead action, 30d, 7d | 3 / 3; 3 / 3 | same | yes | none reached GoHighLevel |
| Pidco (cancelled) | spend / impressions / link clicks, 30d, 7d | 553.00 / 55,151 / 473; 198.39 / 27,352 / 195 | same | yes | After: tied for the history; named as delivering for a cancelled client |
| Pidco (cancelled) | form leads / lead action, 30d, 7d | 8 / 12; 8 / 8 | same | yes | 4 WhatsApp leads kept out of form leads |
| ريبالو / ORB (hidden) | spend / impressions / link clicks, 30d | 91.91 / 4,932 / 21 | same | yes | After: named "Hidden on purpose" |
| Triple Edge (no location) | spend / impressions / link clicks | 6.97 / 5,821 / 28 | 6.97 / 5,822 / 28 | no | 1 impression still settling |
| All 32 accounts, 90-day backfill | spend and impressions per account | equal to the cent except Shades and SAFAD | Shades SAR 4,871.53 / 282,027; SAFAD $1,730.72 / 667,248 | yes | the latest days were still settling |

### B. Business numbers (stored `cockpit_client_days`, `cockpit_client_now`; independent the dialer's report, the client sheets read live, the portal, the media sync)

| Client | Metric | Stored | Independent | Match | Note, after the fixes |
| --- | --- | --- | --- | --- | --- |
| Alkhalil | CRM leads | 76 | 76 (79 less 3 WhatsApp chats) | yes | |
| Alkhalil | confirmed bookings | 8 | dialer 7, media 5 | no | a RESCHEDULE booking counted. After: 7 |
| Alkhalil | provisional bookings | 3 | 3 | yes | |
| Alkhalil | meetings due | 8 | 7 sheet rows | no | the replaced booking still due. After: 7 |
| Alkhalil | shows / no-shows | 3/3 | 2/3 on the sheet | no | the portal's show on a meeting the sheet left blank: the rule's order, correct |
| Alkhalil | no outcome | 2 | 1 | no | After: 1 |
| Alkhalil | quotations | 2 | 2 (sheet Y 1, N 1) | yes | |
| Alkhalil | closes / revenue | 0 / $0 | 0 | yes | |
| Alkhalil | lead quality | 3 scores, average 6.7 | same | yes | |
| Alkhalil | dials / leads called | 100 / 51 | same | yes | |
| Alkhalil | leads contacted (30d) | 55/55 | 55/55 called | yes | |
| Arcturus Construction | CRM leads | 86 | 86 | yes | |
| Arcturus Construction | confirmed bookings | 29 | dialer 29, media 28 | yes | equal by two opposite differences. After: 28 (the RESCHEDULE booking left out) |
| Arcturus Construction | provisional / meetings due | 1 / 29 | 1 / 29 sheet rows | yes | |
| Arcturus Construction | shows / no-shows / no outcome | 17/9 / 3 | same | yes | |
| Arcturus Construction | quotations | 12 | 12 (Y 12, N 14) | yes | After the native release: answers 26, rate 46% |
| Arcturus Construction | closes / revenue | 0 / $0 | 0 won, 25 pending, 1 lost | yes | After: pending and lost kept |
| Arcturus Construction | dials / leads called | 165 / 52 | same | yes | |
| Arcturus Construction | leads contacted (30d) | 73/74 (99%) | 66/74 called (89%) | no | After: verified 66, outcome only 7 |
| ARCWANI | CRM leads | 34 | 34 (50 less 16 chats) | yes | |
| ARCWANI | confirmed / provisional / meetings due | 9 / 0 / 12 | 9 / 0 / 12 | yes | |
| ARCWANI | shows / no-shows / no outcome | 5/2 / 5 | same | yes | |
| ARCWANI | quotations / closes | 4 / 0 | 4 (Y 4, N 1) / 0 (P 3, N 2) | yes | |
| ARCWANI | dials / leads called / contacted | 81 / 15 / 29 of 32 | same | yes | |
| Ardon | CRM leads / confirmed / provisional | 81 / 9 / 1 | same | yes | |
| Ardon | meetings due / no outcome | 4 / 1 | 3 sheet rows / 0 | no | a 16 Sep meeting before its sheet starts: correct |
| Ardon | shows / no-shows | 1/2 | same | yes | |
| Ardon | quotations / closes | NULL / NULL | columns blank | yes | |
| Ardon | dials / leads called / contacted | 100 / 50 / 52 of 63 | same | yes | |
| Atlantis Contracting | CRM leads / confirmed | 50 / 11 | 50 / dialer 11, media 14 | yes | media counted the qualification calendar: 2 CALLBACK bookings (now dropped by id) and 3 leads' own bookings, which the board does not count (main and online calendars only) |
| Atlantis Contracting | provisional | 1 | dialer 17 | no | the dialer counts 16 Google copies: correct |
| Atlantis Contracting | meetings due | 12 | 10 sheet rows | no | two replaced bookings. After: 10 |
| Atlantis Contracting | shows / no-shows | 5/3 | 6/3 | no | the CRM moved one meeting's time. After: 6/3 |
| Atlantis Contracting | no outcome | 4 | 1 | no | After: 1 |
| Atlantis Contracting | quotations / closes | 5 / 0 | 5 / 0 (P 2, N 3) | yes | |
| Atlantis Contracting | lead quality | 3 scores, average 7.7 | same | yes | |
| Atlantis Contracting | dials / leads called / contacted | 64 / 29 / 33 of 37 | same | yes | |
| Castello Industries | CRM leads / confirmed / meetings due | 79 / 4 / 4 | same | yes | |
| Castello Industries | shows / no outcome | NULL / 4 | no marks / 4 | yes | |
| Castello Industries | quotations / closes | NULL / NULL | columns blank | yes | |
| Castello Industries | dials / leads called / contacted | 106 / 45 / 45 of 45 | same | yes | |
| City Wood | CRM leads / confirmed | 52 / 6 | 52 / dialer 7 | no | the dialer counts a booking GoHighLevel dropped: the board is right |
| City Wood | meetings due / shows / no outcome | 6 / 1/5 / 0 | same | yes | |
| City Wood | quotations / closes / lead quality | 2 / 0 / 2 scores, 3.0 | same | yes | |
| City Wood | dials / leads called | 108 / 18 | same | yes | |
| City Wood | leads contacted (30d) | 42/44 (95%) | 25/44 called (57%) | no | 17 touched by a saved outcome only. After: verified 25 |
| Joe and Sera Company | all business figures | 0 | 0 | yes | dials 17 (16 by the assigned caller, 1 by the CEO) |
| Liwan | CRM leads / confirmed / meetings due | 18 / 4 / 6 | same | yes | |
| Liwan | shows / no outcome / quotations / closes | 1/1 / 4 / 0 / 0 | same | yes | |
| Liwan | dials / leads called / contacted | 52 / 11 / 14 of 14 | same | yes | |
| Marble and more | CRM leads / confirmed / meetings due | 26 / 6 / 6 | same | yes | |
| Marble and more | shows / no outcome / lead quality | 2/2 / 2 / 2 scores, 4.5 | same | yes | |
| Marble and more | dials / leads called | 45 / 12 | same | yes | |
| Marble and more | leads contacted (30d) | 21/21 (100%) | 16/21 called (76%) | no | After: verified 16 |
| mergestudio.kw | CRM leads / confirmed / meetings due | 18 / 6 / 2 | same | yes | |
| mergestudio.kw | provisional | 0 | dialer 6 | no | the dialer counts Google copies: correct |
| mergestudio.kw | shows / no outcome | NULL / 2 | no marks / 2 | yes | |
| mergestudio.kw | dials / leads called | 29 / 9 | same | yes | |
| mergestudio.kw | leads contacted (30d) | 15/16 (94%) | 13/16 called (81%) | no | After: verified 13 |
| Ocean Home | CRM leads / provisional | 139 / 4 | same | yes | |
| Ocean Home | confirmed bookings | 30 | dialer 31 | no | the dialer counts a booking GoHighLevel dropped: the board is right |
| Ocean Home | meetings due / shows | 31 / 1/0 | 31 sheet rows / 1/0 | yes | rows differ, totals agree |
| Ocean Home | no outcome | 30 | 30 | yes | the client leaves Show blank |
| Ocean Home | quotations / closes / revenue | 1 / 1 / $67,000 | same | yes | |
| Ocean Home | dials / leads called / contacted | 209 / 102 / 105 of 109 | same | yes | |
| Professional Touch Company | CRM leads / confirmed | 100 / 4 | 100 / dialer 4 | yes | no ad account tied |
| Professional Touch Company | meetings due / no outcome | 5 / 5 | 4 sheet rows / 4 | no | one contact rebooked after the meeting: correct |
| Professional Touch Company | dials / leads called | 115 / 58 | same | yes | |
| Professional Touch Company | leads contacted (30d) | 56/87 (64%) | 55/87 called (63%) | yes | 31 waiting, the oldest from 29 Sep |
| SAFAD Consultant Engineering | CRM leads / confirmed / meetings due | 50 / 4 / 3 | same | yes | |
| SAFAD Consultant Engineering | shows / no outcome / quotations | 2/0 / 1 / 2 | same | yes | the sheet says Y where the portal says no |
| SAFAD Consultant Engineering | dials / leads called / contacted | 107 / 42 / 39 of 42 | same | yes | |
| شركة العلا | CRM leads / provisional | 126 / 0 | same | yes | |
| شركة العلا | confirmed bookings | 40 | dialer 42 | no | the dialer counts two bookings GoHighLevel dropped: the board is right |
| شركة العلا | meetings due / no outcome | 37 / 36 | 36 sheet rows / 35 | no | a contact who rebooked the next day: correct |
| شركة العلا | shows / quotations / lead quality | 1/0 / 0 / 1 score, 6 | same | yes | |
| شركة العلا | dials / leads called | 262 / 83 | same | yes | |
| شركة العلا | leads contacted (30d) | 100/105 (95%) | 84/105 called (80%) | no | After: verified 84 |
| شركة منشآت خالدة | CRM leads | 11 | 11 (30 less 19 chats) | yes | |
| شركة منشآت خالدة | bookings, meetings, outcomes | 0 | 0 | yes | |
| شركة منشآت خالدة | dials / leads called | 37 / 4 | same | yes | |
| شركة منشآت خالدة | leads contacted (30d) | 7/7 | 4/7 called | no | After: verified 4 |
| نهوض نجد (DWY) | CRM leads / dials / leads called | 58 / 0 / 0 | same | yes | After: waiting figures not stored (done with you) |

### C. The client spine, ties and freshness (stored `cockpit_board_clients`, `cockpit_meta_reach`, the facts' sources; independent the ClickUp roster, the registry, Meta, the client sheets)

| Client | Metric | Stored | Independent | Match | Note, after the fixes |
| --- | --- | --- | --- | --- | --- |
| All clients | active clients | 17 (registry) | 18 Active ClickUp cards | no | After: 18 (the card) |
| Shades | status | Launching | Active on its card since 4 Oct | no | After: Active |
| Olivar Design | status | Paused | Stopped since 20 Sep (churn log: lost) | no | After: Stopped, no new days |
| Uvan and Evan | status | Ghosting | Stopped since 20 Sep | no | After: Stopped |
| شركة كيسان | status | Paused | Stopped since 20 Sep | no | After: Stopped |
| Greystone Contracting | status | Launching | Paused on its card | no | After: Paused |
| Kazak; Prime Project Solutions | status | Ghosting, every CRM figure NULL | no ClickUp card | no | After: the registry's word, named by the doctor as noCard |
| Pidco Group | on the board | Cancelled, no card, not tied | ads live: SAR 2,178.99 in 30 days | no | After: tied for the history, named as delivering for a cancelled client |
| 16 DFY and نهوض نجد | service mode | 16 DFY, 1 DWY | same on the cards | yes | |
| Six non-active clients | service mode | blank | DFY on the cards | no | After: DFY |
| Shades | ad accounts | none | act 762687672022667, lead campaign since 14 Oct | no | After: tied by hand |
| Shades | CRM leads 14 to 16 Oct | 0, 0, 0 | Meta form leads 1, 2, 1 | no | the lead form is not connected to GoHighLevel |
| Alkhalil | ad accounts | 1 | 2 (same Meta business) | no | After: 1 tied; the SAR account holds only the client's own post boosts, so it is kept out and named |
| Marble, City Wood, Castello, Ardon | two-account clients | 2 each | lead sync watch agrees (15 of 15) | yes | |
| Professional Touch Company | ad accounts | none | not shared with Mahara's business | yes | spend must read unknown |
| Joe and Sera; نهوض نجد | TikTok flag | true; false | cards say Meta; Tiktok | no | After: نهوض نجد flagged from its card; Joe and Sera to confirm |
| Atlantis, Castello, Shades, Alkhalil's second account | Meta spend per day, 12 to 16 Oct | closed days as stored | equal to the cent on closed days | yes | today lags the hourly read by about 25 minutes |
| Marble and more | client reach last_30 | 5,673 impressions, no note | 13,809 impressions in the store across both accounts | no | After: unknown until the nightly run |
| ARCWANI; Liwan | client reach | no row | 144,862 and 472,739 impressions in 30 days | no | After: a row reading unknown |
| All 17 active | sheet link | the dialer's sheet id | card = registry = portal = dialer for 17 of 17 | yes | |
| Castello Industries | closes and quotations with blank columns | NULL every October day | Sep and Oct tabs blank | yes | |
| Ocean Home | closes and quotations on unreported days | 0 on 18 days | October tab blank on Show, Quotation and Closed | no | After: NULL on those days |
| شركة منشآت خالدة | sheet month note | "holds the month tabs Jul, Aug, Sep 2026" | every tab exists; October empty | no | After: "Its Oct 26 tab has no rows yet" |
| 15 clients outside the dialer | dials | 0 on all 120 days | not in the dialer's client list | no | After: NULL with a note |
| All 17 active | source freshness at 16:30 | every source ok | every sync fresh, every cron active | yes | |
| Atlantis Contracting | day boundary | Meta on Los Angeles days, CRM on Kuwait days | 9 of 50 CRM leads fall on another date on Meta's clock | no | the board's note on its row: board team |
| نهوض نجد (DWY) | leads waiting | 53 untouched, share 0.0185 | the call centre does not call this client | no | After: NULL |
