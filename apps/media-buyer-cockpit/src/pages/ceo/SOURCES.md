# Where every number on the CEO cockpit comes from

Written 2026-09-21 from the code as shipped, so Aziz can check each source once instead of each metric. Read it top down: the systems, then the baseline numbers each system gives (nothing derived), then how every number on screen is built from those baselines, then what to distrust.

## 1. The shape of it

Twelve sections are computed on the production Convex deployment (`adorable-seahorse-418`) every 15 minutes by `convex/ceo/refresh.ts` (`refreshAll`, each section in parallel with a 150-second budget; a failed section keeps its last good payload). Each adapter lives in `convex/ceo/adapters/`, its result is stored as one document in the `ceoSections` table, and the screen reads all of them through `ceo/queries:today`. Days are Kuwait days (UTC+3); the B2B SQL says `Asia/Riyadh`, which is the same offset.

The systems, and which sections read them:

| System | What it is | Read by |
|---|---|---|
| B2B Supabase `flwboeijllbtrufxkhts` | Mahara's own funnel. Fed every 15 minutes: `meta_ad_snapshots` from Meta Ads, `calls` from GHL appointments, `leads` from GHL contacts (ad attribution resolved from GHL custom fields against Meta names by `b2b_fill_lead_attribution`), `closed_deals` from the closer's Typeform, `eod_reports` from the EOD Typeform, `maqsam_calls`, `whop_payments` from Whop, `transfers` and `expenses` from the bank CSV, `monthly_targets`, `sales_reps`, `assets`, `mahara_portal_documents` (Mahara OS) | Money, Growth (Frontend, Marketing, Sales), Ads, Team, Portal, Assets, Machine, Content (cadence) |
| Creative Triage Supabase `bldgtotkfmhoxmlzowdx` | Clients' delivery. `ads_daily_snapshots` per client ad account (Meta, one row per campaign per day), `appointments` per GHL location, `client_leads`, `client_opportunities` (GHL pipelines), `clients`, `ghl_clients`, `ghl_client_ad_accounts`, `mahara_reporting.facts` (the Maqsam dialer import), and the hand-kept `cockpit_people`, `cockpit_posts`, `cockpit_channels`, `cockpit_payer_clients` | Delivery, Calls, Client success, Team & payroll, Posting |
| ClickUp list `901816559981` (Clients – Mahara) | The client cards: status, launch date, CSM, service mode, happiness, and the billing fields (MRR, LTV, payment plan, churn date, paused on) | Client success, Money (MRR), Delivery (launches) |
| Meta Graph API v21 (`META_SYSTEM_TOKEN`) | Own ad account `act_746108264865897` status and balance; Facebook Page `587094101153861`; Instagram `17841473441237528` | Ads (account), Content |
| YouTube Data API v3 (service account) | Channel `maharamedia`: statistics and the 12 newest uploads | Content |
| Tap API (`TAP_SECRET_KEY`) | Captured charges | Money (Tap rail) |
| Convex tables of this app | `campaigns`, `dailyStats`, `bookingEvents`, `metaTree` (the media buyer sync), `ceoManualPayments`, `eodReports`, `ceoClientBilling`, `ceoDaily`, `cronRuns`, `sourceHealth`, `aiJobs` | Delivery (fallback), Money (hand payments), Team, Machine |

## 2. Baseline numbers, by system

A baseline is a number read straight from a system and not built from anything else on the cockpit. Windows are Kuwait days; "today" is the server's Kuwait day.

### 2.1 B2B Supabase, Mahara's own funnel

| Baseline | Exact read | Window | Gaps |
|---|---|---|---|
| Leads | `public.leads` where `is_lead`, dated `lead_created_at` | per window | Only contacts the sync marked as leads |
| Ad-attributed leads, qualified, disqualified | Same table with `ad_id is not null`; qualified = `stage_name ~* 'Demo Booked\|CONFIRMED\|Closed\|Hot Lead'`; disqualified = `stage_name ilike '%disqualif%'` | per window | Attribution is resolved from GHL custom fields; 224 of 310 leads in the 30 days to 20 Sept carried an ad id |
| Spend, impressions, clicks, link clicks, frequency | `public.meta_ad_snapshots` summed by day, ad, ad set or campaign; frequency is `max`, never summed | per window | `b2b_campaign_type(campaign_name)`: `hiring\|recruit` is excluded, `hammer them\|retarget\|remarket` is retargeting, everything else is lead gen. The account row on the Ads tab and every growth tile are **lead gen only**; retargeting spend is carried beside them |
| Intro and demo calls: booked, due, shown, qualified, disqualified, cancelled, scheduled | `public.calls` (`call_type` intro or demo, `status`, `booked_at`, `start_at`). Booked counts on `booked_at`; due = `start_at <= now()`; **shown = `showed`, or `confirmed`/`invalid` with the call time passed**; qualified = `showed` or `confirmed` past; disqualified = `invalid` past; the rest count on `start_at` | per window | A confirmed call whose time has passed counts as shown until someone marks it otherwise; this is the dashboard's rule and Aziz's ("confirmed or showed counts as shown") |
| Intros advanced | Shown intros whose contact has a demo with `booked_at >= intro.start_at` | per window | — |
| Signed, contracted, cash collected, new MRR | `public.closed_deals`: `count(*)`, `sum(contracted_revenue)`, `sum(cash_collected)`, `sum(new_mrr)`, dated `submitted_at` | per window | **Typed by the closer on the form**, not payments |
| Speed to lead (B2B) | Median minutes from `lead_created_at` to the first call `booked_at` on the same contact | per window | Only leads that got a call |
| Whop cash per day | `public.whop_payments` `sum(net_amount)` by `paid_on` where `status='paid' and currency='usd'` | 180 days | **Net of refunds** on the charge day; processor fees not deducted |
| Whop refunds | `sum(refunded_amount)` dated `refunded_at` | month to date, 90 days | A refund's month can differ from its charge's month |
| Failed charges | `status='open'` rows in 30 days with no later paid row on the same `membership_id` | 30 days | Per attempt; one payer can appear twice |
| Deal-to-cash tie | `public.b2b_deal_cash()`: per deal the closer's `cash_collected`, the ledger transfers, and Whop `net_amount` where `deal_response_id` matches | all time | The only link is the payer's email against the closing form: 42 of 124 paid rows link; the transfers side is always empty |
| Rep scorecard | `public.b2b_rep_scorecard(from, to)` joined to `public.sales_reps` (`ghl_user_id` for setters, `closer_aliases` for closers) | month to date | **Execute is refused to the read-only role**, so the Sales tab shows no rep rows |
| Stalled deals, action queue, pacing | `public.b2b_stalled_deals(today-120, today, 14)`, `public.b2b_action_queue(1)`, `public.b2b_pacing_pipeline(monthStart, today)` | as named | The stalled rows are a capped sample |
| Targets | `public.monthly_targets`: `metric`, `projection` for the latest `period_month` at or before this month | month | If the latest month is older than this month, no targets show |
| Expenses | `public.expenses` (bank CSV, hand-loaded): `amount_usd`, `category`, `vendor`, `incurred_at`; rows matching `%unload%` are unloads | latest loaded month | USD only; the KWD rate is inferred by testing 3.248 and 3.25 against the rows, not the cockpit's 3.26; missing months are gaps |
| Transfers | `public.transfers` by `received_at` | month | Never counted as cash in |
| EOD filings | `eod_reports` and `team_eod_reports` by `report_date` (a filing before 04:00 belongs to the previous working day; Friday is skipped) | 31 days | Two people with the same first name and role read as one |
| Assets | `public.assets`, `b2b_asset_coverage()`, `b2b_asset_performance()` | all | 4 sends against 203 assets: anecdote, not ranking |
| Mahara OS state | `public.mahara_portal_documents` keys `__state__`, `directory.json`, `client-access.json`, `health.json`, `backup-status.json`, `appointments.json` | snapshot | Sessions are deleted at expiry, so "no visit" is not "never" |
| Feed freshness | `public.sync_state` plus `max()` timestamps on the fed tables; `b2b_sync_health()` expects meta, ghl_calls, leads, typeform, typeform_eod, maqsam_calls every 15 minutes | live | — |

### 2.2 Creative Triage Supabase, the clients

| Baseline | Exact read | Window | Gaps |
|---|---|---|---|
| Client spend and platform leads | `public.ads_daily_snapshots` `sum(spend)`, `sum(leads)` by `client_id` and `date` (the ad account's reporting day), joined to `clients`, `ghl_client_ad_accounts`, `ghl_clients` | 180 days | Converted with the fixed table `USD_PER` (KWD 3.26, AED 0.2723, SAR 0.2666, QAR 0.2747); a currency not in the table is **excluded**, not taken at 1:1; Mahara's own accounts dropped; an account with no client card stays in the totals but has no row |
| Client bookings | `public.appointments` dated by `start_at` (the day the meeting is for), only calendars whose name matches `appointment calendar\|main appointment`; `future` = `start_at > now()`; showed and no-show by status `showed`/`noshow` or the `attended` flag, cancelled and invalid never counted, unknown outcome neither | 180 days | The client fills the outcome; most do not |
| Client closes | `public.client_opportunities` where `status='won'`, dated `coalesce(last_stage_change_at, updated_at)` | 180 days | 20 won across every client since January against 8,268 open: reads low by construction |
| Running campaigns per client | Distinct `campaign_id` in `ads_daily_snapshots` with `spend > 0` in the last three days | 3 days | — |
| Dialer calls | `mahara_reporting.facts` where `source='maqsam' and kind='call'`: a dial is `type='outbound'` with one agent; connected is `state='completed' and duration > 0`; talk is `duration` on connected calls; over 90 seconds counted apart; day by `ts` in Kuwait | 30 days (hours for today) | Connected can include voicemail; only the Maqsam accounts the dialer imports |
| Lead-linked dials | The same dials joined to the newest `client_leads` row with the same digits-only phone, for clients with `service_mode='DFY'` and status Active, Launching or Paused | 7 days, not before 2026-09-12 | Blank service mode is excluded and named |
| Pulse inputs per client | Appointments 28 and 90 days by `booked_at`, attendance by `start_at`, leads 28 days against the 28 before, spend 90 days, open and stalled opportunities (`last_stage_change_at < today-21`) | 28 / 90 days | The spend SQL carries its own rates (SAR 3.75, AED 3.6725, QAR 3.64), not `USD_PER` |
| Payroll roster | `cockpit_people` through PostgREST with the service key: `monthly_cost`, `currency`, `commission_basis`, `commission_rate`, `is_sales`, `active` | current | Hand-kept; nothing in the stack knows who works here |

### 2.3 ClickUp, the client cards

| Baseline | Exact read | Gaps |
|---|---|---|
| Card status, launch date, next payment, happiness, CSM, service mode | Custom fields `9368ca9e…` (status), `2e744484…` (launch date), `669ae046…` (next payment), `4e3924e3…` (happiness), `68ff84db…` (CSM), `fccfc09c…` (service, DFY/DWY); synced into the Convex `clients` table every 10 minutes by day; DEFCON from the 1-1 Call Notes form field `ff7970f7…` | The stage `SALES TEAM TO CONTACT` is excluded |
| Billing fields | MRR `48eb6023…`, LTV `11d70e58…`, payment plan `17d17129…`, payment method `665e5754…`, contract status, renewal, signup, paused on `930c49eb…`, churn date `42429a6e…`, churn reason, churn type, closer, lead source; written to `ceoClientBilling` by the CSM sync; money fields converted with `USD_PER` by the field's currency | **Typed by hand on the card**, not measured; a blank is missing, never zero |

### 2.4 Meta Graph, YouTube, Tap

| Baseline | Exact read | Gaps |
|---|---|---|
| Own ad account | `GET /act_746108264865897` fields `account_status, disable_reason, balance, currency, amount_spent, spend_cap` | Status 3 = unsettled; balance is in cents |
| Facebook Page | `GET /587094101153861` (`followers_count`, else `fan_count`); insights `page_views_total`, `page_post_engagements`, `page_daily_follows_unique` with the Page token from `me/accounts` | Insights come back empty for this page, shown as missing |
| Instagram | `GET /17841473441237528` (`followers_count`, `media_count`); `/insights` `reach, accounts_engaged` per day for 28 days (since is midnight UTC); `/media?limit=24` newest posts with `like_count`, `comments_count`; per post `/insights` `views, reach, saved, shares, total_interactions` | 24 newest posts only |
| YouTube | `channels?forHandle=maharamedia` (`subscriberCount, viewCount, videoCount`); `playlistItems?maxResults=12`; `videos` statistics per upload | 12 newest uploads only; the whole block is null if the API is disabled |
| Publishing cadence | `public.assets` where `asset_type in ('youtube_video','reel')` by `published_at`, 28 and 90 days | Uses Postgres `current_date` (UTC), not the Kuwait day |
| Tap charges | `POST /v2/charges/list` with `type=CHARGE`, `status=CAPTURED`, 30-day chunks, up to 40 pages, 60-second budget, converted with `USD_PER` | **No refunds are read**: Tap is gross, Whop is net. Test-mode and unknown-currency charges dropped; no key means no rail |

### 2.5 This app's own Convex tables

| Baseline | Exact read | Gaps |
|---|---|---|
| Hand-logged payments | `ceoManualPayments` where not deleted (`day`, `amountUsd`, `clientName`, `clickupTaskId`, `rail`), 12 months, `usdPerUnit` frozen at write time | Only what was typed; a refund is a deleted row |
| Board campaigns | `campaigns` on board and not internal; `dailyStats` per campaign per day (31 days, cap 3,000); `bookingEvents` deduplicated; `metaTree` statuses | Only campaigns carrying an Ads Management card; `bookings7d` only where the client's GHL was read |
| Cockpit EODs | `eodReports` for media buyer and CSM (32 days) | The media buyer form has no email, so it defaults to Nada |
| Health ledger | `cronRuns` per job (`sync` every 10 min, CEO refresh 15, Hermes relay 1) and `sourceHealth` for 15 sources: meta, clickup, sheets, docs, calendar, ghl, fathom, slack, bridge_csm, bridge_creative, whapi, resend, jobs, previews, hermes | A source with no reading is not counted as failing |
| Hermes queue | `aiJobs` by status | — |

## 3. How each screen builds its numbers

Formulas are in terms of the baselines above. Where a formula sits inside a B2B function, the function is named; the bodies of `b2b_window_metrics` and `b2b_marketing_ads` were read from the database on 2026-09-21 and are quoted where it matters.

### Money

- **Cash collected this month** = the sum of the month-to-date figure of every **connected** rail (Whop, Tap, hand-logged). If any connected rail failed to read, the total is missing rather than short. `cash` on its own is Whop only, and `rails.whop` is the same money: never add a rail to the total.
- **Cash per day** = the per-rail day maps summed; the series holds 180 days; the heroes show the last 90. Today is partial.
- **Vs the same days last month** = `(mtd − lastMonthToDate) / |lastMonthToDate|`, last month cut at the same day of month.
- **Projected month** = `mtd / dayOfMonth × daysInMonth` (straight line), per rail and in total; early in the day it reads low because today counts as a whole day.
- **Refunds** = Whop refunds month to date and over 90 days. Never subtracted again: Whop cash is already net.
- **Contracted this month** = closer-form `contracted_revenue` this month + hand-logged deals that do not match a closer-form deal in the same month. Targets compare the closer-form part only.
- **Deal cash tie** = Whop cash whose `deal_response_id` matches a deal, against the unlinked rest; "no linked cash" is not "unpaid".
- **12-month series** = Whop cash, refunds, closer-form contracted and deals per month, with hand cash and hand contracted as separate series.
- **Targets and pace** = `monthly_targets.projection` against the actual from `b2b_window_metrics(monthStart, today)` (revenue = contracted this month, signed = deals this month); pace = `actual / dayOfMonth × daysInMonth`.
- **MRR groups** = card stage → active, paused, gone (`Stopped`, `CANCELLED ONBOARDING`), sales (`SALES TEAM TO CONTACT`), pipeline (the rest). Recurring = MRR on cards whose Payment Plan is not `paid in full | split pay | one-off | upfront`; a blank plan is unclassified. **Groups are never summed.**
- **LTV** = the card's LTV field (a typed number). The computed LTV in `ltv.ts` is baseline + hand-logged payments after the baseline day, on active and pipeline cards only, and deliberately excludes Whop cash.
- **Expenses by category** = the latest loaded bank month grouped by category, unloads included in the category rows; `spend` (money out) = total − unloads. Profit and margin are **always null today** because `REVENUE_IS_COMPLETE` is false in `expenses.ts`. Payroll from the roster is not in the P&L.

### Frontend, Marketing, Sales (growth)

Every tile is a key of `b2b_window_metrics(from, to, null)` renamed: `signed` → closes, `revenue` → contracted, `cash_collected` → cash. Inside that function, per window:

- `cost_per_lead` = lead-gen spend / leads; `cost_per_demo` = spend / demos shown; `cost_per_demo_booked` = spend / demos booked; `cac` = spend / signed; `roas` = contracted / spend.
- `intro_show_rate` = intros shown / intros due; `demo_show_rate` = demos shown / demos due; `close_rate` = signed / **demos qualified**; `close_rate_all` = signed / demos shown; `intro_to_demo` = intros advanced / intros shown; `lead_to_demo` = demos scheduled / leads.
- Windows: yesterday, last 7 days, the 7 before, month to date, last month to the same day, last month.
- Cockpit-only additions: **cost to win a customer** on Frontend = (lead-gen spend + retargeting spend) / closes, which is not the dashboard's `cac`; Marketing's **booked calls** = intros booked + demos booked and **lead to booked** = that / leads, which can exceed 100% because bookings and leads are dated differently; Sales' **average contract** = contracted / closes and **upfront share** = cash / contracted.
- The daily series (365 days) is read straight from the tables: spend from lead-gen campaigns, leads, bookings (intro + demo by `booked_at`), closes.
- Winning ads and top ads come from `b2b_marketing_ads` over 90 and 7 days.

### Ads (Mahara's own account)

The tab reads the same B2B tables with its own SQL, per ad, ad set and campaign, for 7 and 30 days, and was checked ad by ad against `b2b_marketing_ads` on 2026-09-20 (identical spend, leads, CPL, demos booked, sales, revenue, ROAS) and against `b2b_window_metrics` on the account row (spend $4,355.22, impressions 360,187, link clicks 3,810 for 22 Aug to 20 Sep). Since 2026-09-21 the call counts are dated exactly the way `b2b_window_metrics` dates them.

- Per row: `cpm` = spend / impressions × 1000; `ctr` = link clicks / impressions; `cpc` = spend / link clicks; `cpl` = spend / **CRM** leads (Meta's own lead count is shown beside it); `qualifiedPct` = qualified / leads; `bookRate` = intros booked / leads; `introShowRate` = intros shown / intros due; `introToDemo` = intros advanced / intros shown; `demoShowRate` = demos shown / demos due; `costPerDemo` = spend / demos shown; `closeRate` = closes / demos shown; `closeRateQualified` = closes / demos qualified; `cac` = spend / closes; `roas` = contracted / spend; `cashRoas` = cash / spend.
- Roll-ups sum counts and spend; frequency is the worst child.
- The account row is lead-gen campaigns only; retargeting spend sits beside it; **coverage** says how many CRM leads and deals in the window carry an ad id at all.
- **Verdict**, in order: not running → off; no spend in 7 days → no delivery; 7-day spend ≥ $30 with no lead → kill; 7-day CPL over $22.50 → kill; frequency ≥ 2.5 → fatiguing; 30-day leads ≥ 8 and no intro booked → leads do not book (setter); 30-day intros shown ≥ 5 and no demo → intros do not convert (setter); 30-day demos shown ≥ 3 and no close → demos do not close (closer); 7-day CPL over $15 → hold; else scale.
- **Constraint** = the stage whose 30-day conversion is furthest below the account's, with minimum denominators (500 impressions, 30 link clicks, 8 leads, 5 intros booked, 5 intros shown, 3 demos shown) and a gap of at least 20%.
- **People** = the setter with the most intro calls on the ad in 30 days (`sales_reps.ghl_user_id`) with their shown/due, and the closer with the most signed deals (`closed_deals.closer`).

### Delivery

- Spend, leads, bookings per window come from Triage (board tables only as a fallback, with a warning). Bookings = appointments due, so future ones are excluded and named. `cpl` = spend / leads; `cpb` = spend / bookings.
- **Client status**: no spend → no data; no leads or CPL over $22.50 → bad; CPL ≤ $15 and (the client books its own or CPB ≤ $60) → good; else watch.
- **Running** (per client) = campaigns with spend in the last three days. The company-level "running" on the same tab is the Meta tree's ACTIVE ads, else spend today with data through yesterday: two different definitions.
- **Rates over 30 days**: lead to booking = bookings / platform leads; show rate = showed / (showed + no-show) on past meetings; close rate = closes / showed. Gates 25%, 75%, 20% from `constants.ts`, the same ones the client reports use.
- **Launches**: in flight = cards in the onboarding bucket; stuck = onboarding older than 7 days since the card was created.

### Calls

- Dials, connected, connect rate = connected / dials, talk minutes, average talk = talk / connected, conversations over 90 seconds; windows today, yesterday, last 7, the 7 before.
- **Speed to lead** = median minutes from a DFY lead's creation to the first outbound dial to its phone, on called leads only; the share within 5 minutes likewise. Only since 2026-09-12.
- Per agent from the call's first agent name; per client over 7 days with `callsPerLead` = dials / leads called.

### Client success

- **Buckets**: onboarding; management → active; inactive → paused if the stage matches `pause|freeze|hold`, else churned; then the stage regexes.
- **Risk score**: unhappy words on the card 3; silent over 14 days 2 (8 to 14 days 1); payment overdue with no live extension 2; active with no board campaign 2, or active with no leads in 7 days 2; CPL over $22.50 1; Pulse bad 2; portal access but no visit in 14 days 1; DEFCON 1 or 2 → 2. High is 5 or more, medium 3 to 4. **Clients needing attention** on Today is the count of high.
- **Pulse** (the cockpit's own copy of the rubric, since Pulse stores no score): bookings 35 × min(1, appointments 28d / 10), zero if none or the last booking is over 21 days old; leads 20 × min(1, this 28 days / the 28 before); attendance 15 × attended / known (7.5 if unknown); cost 15 × min(1, 60 / cost per appointment) (7.5 with no spend); pipeline 15 × (1 − stalled / open) (7.5 with none open). Good ≥ 75, bad < 30.
- **Churn**: a launched client that stops is churn; one that stops before its launch date is lost before launch. Term end = launch + 90 days; past it the client counts churned **unless a payment on any rail is dated after the term end**. The loss is dated at the term end or the first day the cockpit's own daily history saw the churned bucket, so stops before mid-September are undated. Churn rate = churned this month / launched clients at the start of the month; withheld with a reason when the month is incomplete.

### Team & payroll, Management

- EOD due/filed/late/missed over the last 14 working days per person, from the B2B and cockpit filings, minus days a person was paused or gone.
- **Payroll a month** = Σ `monthly_cost × USD_PER[currency]` over active people; a floor while anyone is uncosted, and those are named.
- **Commission** is stored as a rule (basis + rate) and shown in words; **no payout is computed anywhere yet**, because nothing joins the roster to the sales reps in the CRM.

### Content

- Instagram normal = the median of `views` (else reach) over the 24 posts read; a post's multiple = its views / that normal. YouTube normal = the median of views per day of age over the 12 newest uploads. **Performing best** = up to six per platform by multiple. Published in 28 days is a floor once the page size is hit.

### Machine

- Failing jobs = ledger rows with `ok === false`; stale = older than max(3 × cadence, 45 minutes); a source fails after 3 consecutive failures; outside feeds judged on the B2B `sync_state` and Triage `cron` run details.

### Today's sentence

Up to four clauses: cash pace over connected rails (level within ±2%), clients at high risk, CPL over $15 (delivery, last 7 days), machine checks failing, dials today.

## 4. What to distrust, in order of size

1. **Contracted, closes and cash on the growth tabs are the closer's typed form**, not money that landed. The Money tab's cash is the money; the tie between the two is an email match that links 42 of 124 Whop payments.
2. **MRR, LTV, churn date and paused date are typed on ClickUp cards.** A blank is missing, not zero, and the groups are never summed because who counts as a client is still undecided.
3. **Tap is gross and Whop is net**; processor fees are in neither. Refund months can differ from charge months.
4. **Profit and margin are null on purpose** until revenue is declared complete; payroll is not in the P&L; the bank import's KWD rate (3.248 or 3.25) is not the cockpit's 3.26.
5. **Client closes are opportunities marked won in the client's CRM** (20 in total since January); the client sheets' `Closed?` column is the other source and is filled on 14% of rows. Close rate reads low either way.
6. **Attendance is filled by the client**; an unknown outcome is neither a show nor a no-show, so show rates cover only the meetings someone updated.
7. **Churn history starts mid-September**: stops before then are undated and excluded, and the rate is withheld whenever the month is incomplete.
8. **The rep scorecard is refused** to the read-only database role, so the Sales tab has no per-rep rows; the Ads tab's setter and closer come from its own join instead.
9. **Two "running" definitions** sit on the Delivery tab (Meta ACTIVE at company level, spend in three days per client), and **two cost-to-win figures** exist (the dashboard's `cac` on lead gen only; Frontend's includes retargeting).
10. **Currency tables differ**: `USD_PER` (KWD 3.26, AED 0.2723, SAR 0.2666, QAR 0.2747) for spend, payments and payroll; the Pulse SQL's own SAR 3.75, AED 3.6725, QAR 3.64; the bank import's inferred KWD.
11. **Sampling caps**: 24 Instagram posts, 12 YouTube uploads, 6 top ads, 24 winning ads, a capped stalled-deals sample, 3,000 board grain rows.
12. **Dating differences**: bookings on the day booked, calls on the day held, deals on the day the form was submitted, cash on the charge day, Meta spend on the ad account's reporting day. Comparing a rate across two of these is not comparing like with like.

## 5. Changed by this audit (2026-09-21)

- The 90-day refunds and average-contract figures had widened to 180 days on 2026-09-20 with the cash series; they are 90 days again.
- The Ads tab's call counts are now dated the way the dashboard dates them; before, every count sat on the booking day, so its show rate was not the dashboard's show rate.
- The growth series comment said 60 days; it is 365.
