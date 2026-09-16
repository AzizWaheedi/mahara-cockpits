# Mahara CEO Cockpit: Build Plan

## Why this design

The CEO area lives inside cockpit.maharamedia.com as a `/ceo` route and a new `convex/ceo/` module on the portal deployment. That deployment is the media buyer Convex app (adorable-seahorse-418). It already has sign-in, seats, `health.runJob` and the bridge doors to the client success and creative apps. Nothing new needs hosting.

It is also the only cockpit that holds integration credentials. Today it reads Meta, ClickUp, GHL, Google Sheets, Typeform, Fathom and TRI, and it sends to Slack. It does not hold every credential the CEO view needs. It has no Maqsam key, no Whop or Tap credential and no read path into Mahara OS. Its access to the B2B Supabase project is unverified.

The data has to be fixed before the screen. Today most numbers are overwritten every sync, clients are joined by name, and actions are saved against a seat, not a person. So the backend adds four things before any screen exists:

- **A metric registry.** Each number has one definition, in code.
- **A daily snapshot per company, client, campaign and person.** Every number gets history.
- **A unified activity ledger.** Every action gets an actor and a time.
- **One client key: the ClickUp task id.** Through an alias table, it joins a client across ClickUp, GHL, Meta, the dialer, Whop and the portal.

The child apps change a little. They store the signed-in person on every write and add bridge reads (3.1).

Every value carries a trust level, so a thin or stale number never looks healthy. Money, call centre, EOD and portal data arrive through adapters. Each adapter starts with an access probe, and a source that fails its probe shows "not connected", never 0. Ten decisions from Aziz (section 6) settle who sees money, which clients count, the official gates and which data may be copied. Until then, seeded targets keep their conflicts on record (3.3), and metrics whose definition is open carry "definition pending".

The frontend comes last. It reads only precomputed tables, so the one-screen overview stays fast and consistent.

### How to read this plan

- **Status codes:**
  - NOW = computed in code today. "NOW, but broken" means it is computed but wrong, and the reason follows.
  - DERIVE = can be computed from data the cockpits already read, or from tables this plan adds (snapshots, ledger). It also covers a new read through a credential or bridge MB already holds, where access is already proven: another ClickUp list, a TRI table over the existing read-only SQL, or a child bridge read. Those rows note the new read in their status.
  - NEW = needs a source, field or credential the cockpits do not have.
- **Status qualifiers:**
  - "(probe)" = the source exists, but access from MB is untested. An access probe must pass first.
  - "(field)" = a new field must be added.
  - "waits on X" = the metric needs metric X, which is itself NEW.
  - "forward only" = history starts on ship day.
- **References:**
  - "decision N" = an item in section 6.
  - "Phase N" = a backend build phase in section 4.
  - A target written "A vs B: decision 3" is a conflict that the decision settles. The seed value is in 3.3.
- **IDs are stable.** Metrics added after review sit at the end of their group, so IDs are not always in reading order.
- **Convex deployments:**
  - **MB** = media buyer Convex prod (adorable-seahorse-418). This is the portal.
  - **CS** = client success Convex prod (impressive-dinosaur-375).
  - **CR** = creative director Convex prod (colorful-wombat-644).
- **ClickUp:** **CU <id>** = a custom field on ClickUp Clients - Mahara (list 901816559981). Billing and lifecycle field ids are in 3.7 A. Others cited here in full: Last POC e183f2ce-8b7a-491a-b160-2287a247758b, Last Call 032203ad-e327-4d76-a0ce-c07496da6486, Next POC c48c1323-ca6a-465f-84cb-8c24f0f62df3, Sheet Link e6da13ae-6498-44a1-b7dd-9c6198500aa9.
- **Sheets:**
  - **DB** = DATABASE - MAHARA sheet 1_0Nv-IFvzhH4NBNh1dxCUm6Ryp414ctM_8EO5QORBF0. Tabs used: Client Data, Payments, Appointments, New Leads.
  - **Client Data** = the DB tab Client Data (col C ClickUp id, D GHL location, I Sheet Link, J Snap account, K Meta account, L TikTok account, R Service Mode).
  - **MD** = Master Dashboard - Mahara sheet 1pBEyClUxPLc4-RdXR8gZ0MxsLkLLFkWJwkiVqVf2rro (tabs data_fb, data_TT, data_Snap, data_Google, Main Dashboard #2, CRM Dashboard).
  - **CT** = Churn Tracker MaharaMedia 2026 sheet 1p8CAd5pL9zKjc1mZ73Gc_hoj4NSWHfFPs4FoC_WuBUU (tabs 01 Churn Tracker, 02 Payment Log, 04 Referrals, Upsells, Reviews, 07 Invoice Register).
  - **EODWB** = EOD Reports workbook 1EhPp7x0jZfV8dNjUvmuWv_alNvduMGpe_COjUAB13bw.
  - **CCD** = Call Center Dashboard sheet 10TUlF04zEyTtpJYjY_ekrj-ugiBscfqLX4US1EyBlSQ. Its RAW DATA and LEADS TO CALL tabs and its dashboard numbers are cross-checks, never sources (3.7 C). Two tabs are read directly, because nothing else holds their data: DIALED BUT NOT A CONTACT (CALL-27) and Input Values (the 30-dial working day in B5 for CALL-16; the empty pay inputs B7 and B8 for CALL-20).
  - **Stat sheet** = each client's report sheet (Sheet Link, CU e6da13ae). The client fills in show, quote, close and revenue.
- **Supabase and APIs:**
  - **B2B** = Mahara B2B Supabase flwboeijllbtrufxkhts. Access is unverified; copying its data is decision 5.
  - **TRI** = Creative Triage Supabase bldgtotkfmhoxmlzowdx. MB already has read-only SQL to it.
  - **DIAL** = the Mahara dialer's two stores inside TRI:
    - the reporting store (RPC `mahara_reporting`, namespace production): normalised Maqsam calls, GHL contacts, opportunities and appointments, call-to-location links and booking credits;
    - the console store (`mahara_console_store`): dial attempts, dispositions and confirmation touches.

    The dialer computes its numbers (connection rate, over-90 calls, speed, failure rate, quality counters) in its own Node code. The stores do not return them, so Phase 5 ports those formulas (3.7 C). Each store needs its own probe.
  - **MQ** = Maqsam API (api.mq.maqsam.com). MB has no Maqsam key yet (decision 6).
- **Time:**
  - **sync** = every 10 min from 06:00 to 22:00 Kuwait, hourly overnight.
  - **dial sync** = the dialer's reporting sync cadence. It is not documented, so Phase 5 measures it. MQ pulls run every 15 min from 06:00 to 23:00, hourly overnight.
  - **account day** = an ad account's own reporting day. Ad rows keep it and are never re-bucketed to Kuwait days (3.10).
  - All other days are Kuwait days (UTC+3). The work week runs Saturday to Thursday.
- **Owners:** CEO; MB (media buyer); CSM; CD (creative director); ED (video editors); AG (call centre agents); CCL (call centre lead); SYS (systems manager); closers and setters (Mahara's own sales team).

## 1. What the CEO cockpit is for

Each question names the metrics that answer it and when they go live. Most go live in a phase named in section 4. A metric that no phase names goes live once its source or input exists, and the cell says what it waits on. A tile that is not live yet shows "not connected" and its phase or missing input, never an empty 0.

### Daily (the Today screen, under 2 minutes)

| Question | Decision it drives | Metrics | Live from |
|---|---|---|---|
| Is money coming in, and who has not paid? | Chase, pause or extend a client | MON-01, MON-02, MON-06, MON-07, MON-08, MON-14, MON-16 | MON-06, MON-07, MON-08 in Phase 1; MON-16 in Phase 2; MON-01, MON-02, MON-14 in Phase 3 |
| Is ad spend producing leads and bookings at the gates? | Kill, fix or scale campaigns | DEL-01 to DEL-08, DEL-10, DEL-11 | Phase 1, on grain and bookings fixed in Phase 0 |
| Are leads called fast, and do calls become bookings? | Push the call centre or change shifts | CALL-01, CALL-02, CALL-05, CALL-06 | Phase 5 (decision 6). Until then these tiles read "not connected, Phase 5". |
| Which clients are about to leave, and why? | Who gets a leadership call today | OUT-05, CS-02, CS-22, OUT-14 | CS-02, CS-22, OUT-14 in Phase 1; OUT-05 in Phase 4 |
| What did each person do, and is anyone blocked? | Unblock, redirect or follow up | TEAM-01, TEAM-03, TEAM-04, TEAM-12 | TEAM-01, TEAM-03 in Phase 2 (names from Phase 0); TEAM-04, TEAM-12 in Phase 6 |
| Can today's numbers be trusted? | Act on a tile or ignore it | SYS-01, SYS-03, SYS-07, SYS-16 | Phase 1 |

### Weekly (Saturday review of the Saturday-to-Thursday week)

The preliminary pack freezes on Friday. The final pack follows on Sunday and lists every value that moved.

| Question | Decision it drives | Metrics | Live from |
|---|---|---|---|
| Where does each client's funnel leak? | Fix the process of the stage owner | Funnel (3.11), OUT-22, OUT-07, OUT-19, OUT-08, OUT-13 | OUT-07, OUT-08 in Phase 1; the funnel (period mode), OUT-13, OUT-19 and OUT-22 in Phase 4; cohort mode in Phase 5 |
| Is each role hitting its numbers? | Coach, reassign or hire | TEAM-08, TEAM-09 | Phase 6 |
| Did last week's decisions work? | Keep or reverse them | DEL-20, DEL-30, review commitments | Review commitments in Phase 7 (`closeWeek`, `ceo.review`). No phase names DEL-20 or DEL-30: DEL-20 goes live once the `ceo.outcomes7d` job writes `metricAfter7d`, and DEL-30 once its formula over the MB `decisions` rows (which exist today) is added to the registry. |
| Is creative keeping up with fatigue? | Reprioritise creative work | CR-03, CR-06, CR-10, CR-12 | CR-03 in Phase 1; the rest in Phase 6 |
| Are launches on time? | Fix onboarding | DEL-15, DEL-16, DEL-17, DEL-27 | DEL-15, DEL-27 in Phase 1; DEL-16, DEL-17 in Phase 4 |
| Which data problems block decisions? | Assign the fixes | SYS-13, SYS-14, SYS-18, `ceoDataIssues` | Phase 1; SYS-18 in Phase 4 |

### Monthly (month close on the 4th)

| Question | Decision it drives | Metrics | Live from |
|---|---|---|---|
| Cash against goal; how MRR moved | Pricing, collections, spend | MON-01, MON-05, MON-11, MON-12 | MON-05 in Phase 1; the rest in Phase 3 (decisions 1, 4 and 5) |
| Churn, and why | Retention changes; CSM bonus | OUT-02, OUT-03, MON-19 | OUT-02, OUT-03 in Phase 1 (definition pending until decision 4); MON-19 in Phase 3 |
| Unit economics | Marketing budget, hiring | MON-13, SAL-07, SAL-08, MON-20 to MON-24 | MON-13 in Phase 3; SAL-07, SAL-08 in Phase 8 (decision 8). MON-20 to MON-24 stay empty until a cost source exists. |
| Client ROI and the guarantee | Renewals, case studies | OUT-10, OUT-12, OUT-13, OUT-17 | OUT-10, OUT-12, OUT-13 in Phase 4. No phase names OUT-17: it goes live once MON-01 (Phase 3) is live. |
| Next month's targets | Set `ceoTargets` | All targets (3.3) | Seeded in Phase 1; set at month close from Phase 7 |

## 2. Metric catalog

The catalog is version 1 of the registry (3.2). Grain and freshness share one column. Status says what exists today. Section 4 names the phase that turns on most metrics. A metric that no phase names goes live once its source or input exists; until then its tile shows "not connected" and what it waits on.

### 2.1 Money (CEO-only)

Every money metric has `visibility: "ceo"` and is stripped for any other caller (3.12). Who holds the `ceo` role is decision 1. The paying, MRR, cash and churn definitions are decision 4. Copying B2B data into MB is decision 5.

| ID | Metric | Definition and formula | Source of truth | Grain; freshness | Owner | Target | Status |
|---|---|---|---|---|---|---|---|
| MON-01 | Cash collected | Whop `net_amount` where status is paid, by `paid_at` (+03). Add Payments tab rows whose Method is not Whop, deduped on Reference. Rows marked Baseline never count as cash in a month. | B2B `whop_payments`; DB tab Payments (gid 1586289433: Date, Clickup ID, Amount USD, Gross Charged, Method, Reference, Logged By) | Payment, day, month; 15 min (Whop), hourly (Payments tab) | CEO | $100,000 a month (USER.md) | NEW (probe: B2B access and the Payments tab, which is documented but not verified). Tap, bank and check cash exists only when the decision 4 owner logs it. |
| MON-02 | Cash pace | MON-01 / (goal x days elapsed / days in month) | MON-01 + `ceoTargets` | Day | CEO | 100% | NEW (waits on MON-01) |
| MON-03 | New vs back-end cash | New = payments linked to a `closed_deals` row signed that month. Back-end = everything else. | B2B `whop_payments`, `closed_deals` (57 of 182 payments linked, by email only) | Month; 15 min | CEO | Sept plan: $59,400 new cash; $16,665-25,000 back-end | NEW (probe; low link rate) |
| MON-04 | Refunds | Sum of `refunded_amount` by month | B2B `whop_payments`; CT tab 02 Payment Log (Refunds) as a cross-check | Payment; 15 min | CEO | none | NEW (probe) |
| MON-05 | MRR book | Sum of monthly MRR over paying clients. The paying rule and the conversion of Paid in full, Split Pay, ramp and performance plans follow decision 4. | CU 48eb6023 MRR; CU 17d17129 Payment Plan | Client, day; sync | CEO | none set | DERIVE (not read today; filled on about 22 of 54 clients in the context export). MRR vs New MRR mismatches open data issues. |
| MON-06 | Clients past due | Non-dead clients where today minus Next Payment Date >= 1 | CU 669ae046; `csmSync.ts buildCsmSnapshot` (`paymentDue`, `pastDue`) | Client; sync | CSM | 0 (3 on 2026-09-14) | NOW (a live client with no Next Payment Date is never counted) |
| MON-07 | Pause required | Past due >= 3 days with no live extension | `csmSync.ts pauseRequired`; Typeform gqBcyK6g | Client; sync | CSM | 0 | NOW (extensions are matched to clients by fuzzy name) |
| MON-08 | Overdue amount | Sum of Next Payment Amount over the MON-06 clients | CU f071ee8f + 669ae046 | Client; sync | CEO | $0 | DERIVE (billing adapter, 3.7 A) |
| MON-09 | Cash due in the next 30 and 90 days | Next Payment Amount by Next Payment Date, projected by Payment Plan with the decision 4 conversion | CU f071ee8f, 669ae046, 17d17129; Launch Date 2e744484 | Client; sync | CEO | none | DERIVE. Never use formula fields: TODAY() is broken. The private wind-down cash model stays out of v1 (decision 1). |
| MON-10 | Plan and payment rail mix | Count and MRR by Payment Plan and by Payment Method | CU 17d17129, 665e5754 | Client; sync | CEO | none | DERIVE (Payment Method was empty on the card checked, and its Payment Plan disagreed with the closer note) |
| MON-11 | Churned MRR | Sum of MRR of clients lost in the month, under the decision 4 churn rule | `ceoSnapshots` client attrs (MRR, stage); CT tab 01 "Lost MRR" for older months | Month; daily | CEO | none | DERIVE from snapshots (from snapshot start); NEW (probe) for the CT history (CT was read only through the retired Viktor bridge). Churn Date, Reason and Type are empty on every card. |
| MON-12 | MRR bridge and net revenue retention | Bridge = start + new + expansion - contraction - churned. NRR = (start + expansion - contraction - churned) / start. | `ceoSnapshots` client MRR by day | Month | CEO | none | DERIVE (first real month comes after one full month of snapshots) |
| MON-13 | LTV per client | Sum of Amount USD by Clickup ID, Baseline rows included | CU 11d70e58 LTV (a mirror, readable today); DB Payments tab | Client; sync (ClickUp), hourly (tab) | CEO | CPA to lifetime gross profit at least 1:4 | DERIVE (ClickUp mirror); NEW (probe) for the Payments tab ledger. It holds Baseline rows only (17 clients, $55,499), so there is no monthly history before 2026-09-14. |
| MON-14 | Failed card charges | Payers with open charges and no settled payment. This is not every open charge. | B2B `whop_payments` | Payer; 15 min | CSM | 0 | NEW (probe). Open charge counts disagree: 58 ($96,363) in the money map vs 56 ($93,363) in the company context (data issue). |
| MON-15 | Receivables on signed deals | Contracted minus max(form cash, ledger cash + Whop cash), kept when >= $1 | B2B RPC `b2b_deal_cash` | Deal; 15 min | CEO | none | NEW (probe) |
| MON-16 | Charges not confirmed | Past-due clients whose Billing note holds WHOP-CHARGE and whose Next Payment Date has not moved | CU f9bdf6b8 (Billing note), 669ae046; Make scenarios Billing - Charge Due 9585364 (daily 09:00, posts to #csm-general) and Confirm Charge 9585358 (moves Next Payment Date forward a month); the #csm-general Charge Due posts as a cross-check (probe) | Client; sync | CSM | 0 | DERIVE (needs the ClickUp field diffs from Phase 2) |
| MON-17 | Contract coverage | Live clients with both Contract Link and Contract Status set | CU 10b41484, ac976d4a (the Contract dropdown 91e9e408 overlaps them) | Client; sync | CSM | Every live client | DERIVE (26 of 62 cards had no link on 2026-09-01) |
| MON-18 | Upsell and referral revenue | Cash collected on upsells; revenue from signed referrals | CT tab 04; Typeforms VP3zmaj2, IVHO9BMC, cKItPZVI, bAmbMKM2 | Event; hourly | CSM | none | NEW (probe). CT was read only through the retired Viktor bridge, and no backend reads these forms. |
| MON-19 | CSM pay cost | Base + retention band + commissions + penalties | `csmMoney.ts computePay` (browser code today); CS `moneyGoals` (0 rows) | CSM, month | CEO | Churn under 10% for the bonus | DERIVE (port `computePay` to the backend). Counts are typed by hand, and the retention band reads OUT-02, which is broken. Base pay is $1,200 in code vs $1,500 in memory notes (data issue). |
| MON-20 | Operating expenses and net cash | Cash in minus expenses, by category | B2B `expenses` (June 2026 only); `transfers` (last row 2026-06-28) | Month; manual | CEO | none | NEW (no live cost ledger; decision 5 keeps expenses and transfers out by default) |
| MON-21 | Gross margin per client | (Fees - allocated delivery cost) / fees | No cost allocation or payroll source exists | Client, month | CEO | 60%+ (business.md) | NEW |
| MON-22 | Revenue per team member | Cash / headcount | No headcount source (`members` is portal access, not HR) | Month | CEO | none | NEW |
| MON-23 | Maqsam cost per dial | Maqsam invoice / dials | Card statements ($1,343 in Aug 2026) + CALL-01 | Month | CEO | none | NEW (cost is manual) |
| MON-24 | CAC payback period | CAC / monthly gross profit per new client | SAL-07 + MON-05 + MON-21 | Cohort month | CEO | none | NEW (no cost source for gross profit) |

### 2.2 Sales and growth (Mahara's own funnel; shown only if decision 8 says sales are running)

The README says sales stopped, yet `closed_deals` has 2 September deals and Meta spend continued ($2,154, Sep 1-13). Decision 8 settles this before Phase 8. Every row except SAL-01 and SAL-15 needs B2B access (decision 5). SAL-15 reads the separate Closer Tracker sheet.

| ID | Metric | Definition and formula | Source of truth | Grain; freshness | Owner | Target | Status |
|---|---|---|---|---|---|---|---|
| SAL-01 | Mahara ad spend, leads, CPL | Spend / leads on act_746108264865897 | Meta insights through the existing `META_SYSTEM_TOKEN`, stored in a CEO-only table. The MB sync drops this account on purpose (`sync.ts INTERNAL_ACCOUNTS`). B2B `meta_ad_snapshots` is a cross-check. | Ad, account day (Los Angeles); sync | CEO | CPL $6-9; bookable lead <= $15; Sept budget $6,000 | DERIVE (existing Meta integration; never summed with client spend) |
| SAL-02 | B2B leads | `is_lead` = true, by `lead_created_at` (+03) | B2B `leads`; RPC `b2b_window_metrics` | Day; 15 min | CEO | `monthly_targets` (runs to Aug 2026) | NEW (probe) |
| SAL-03 | Intros and demos booked, scheduled, shown | Booked by `booked_at`; scheduled by `start_at`; shown = showed, or confirmed or invalid once past; show rate = shown / due (every past call, cancelled and no-show included) | B2B `calls`; `b2b_window_metrics` | Call; 15 min | Closers, setters | Intro show 70%; demo show 80% | NEW (probe) |
| SAL-04 | Funnel rates | Lead to intro; intro to demo = intros shown whose contact then booked a demo / intros shown (`intro_to_demo`) | `b2b_window_metrics` | Window | CEO | 80%; 55-60% | NEW (probe) |
| SAL-05 | Signed deals and contracted revenue | Count and sum of `closed_deals` by `submitted_at` | B2B `closed_deals` (Typeform BTzMwXiw) | Deal; 15 min | Closers | Sept plan: 20 deals, $120,000 | NEW (probe). April contracted revenue is null, and `new_mrr` is null on all 48 rows. |
| SAL-06 | Close rate | Signed / qualified demos (demos shown, leaving out calls marked invalid; different cohorts, so it can pass 100%) | `b2b_window_metrics` | Window | CEO | 20-25% | NEW (probe) |
| SAL-07 | CAC and cost per call | Ads-only spend / signed (`cac`); spend / demos shown (`cost_per_demo`); spend / demos booked (`cost_per_demo_booked`); cost per intro is not returned by any B2B function, and the cockpit shows spend / intros shown as its own sum | `b2b_window_metrics` | Month | CEO | CPA <= $315; intro <= $20; live demo <= $75 | NEW (probe). Ads only, not fully loaded. August CAC was $605. Not settled: whether the $20 intro target divides by intros booked or intros shown, because the `cost_per_intro` row in `monthly_targets` has no matching B2B function. |
| SAL-08 | Cash and contracted ROAS | Cash / spend; contracted / spend | `b2b_marketing_window` | Month | CEO | Cash 3-4x; contracted 5-8x | NEW (probe). `cash_collected` holds only the ~$500 fee, so cash ROAS understates. |
| SAL-09 | Pacing and pipeline coverage | Projected signed deals; weighted open demos / gap to target | `b2b_pacing_pipeline` | Month | CEO | Coverage >= 3x | NEW (probe) |
| SAL-10 | Rep scorecard | Show rate, demos, closes, revenue per rep | `b2b_rep_scorecard`; `sales_reps`; SAL-15 as a cross-check | Rep, week | CEO | none | NEW (probe) |
| SAL-11 | Stalled deals | Warm opportunities untouched for 14+ days | `b2b_stalled_deals` | Opportunity | Closers | 0 | NEW (probe) |
| SAL-12 | B2B speed to lead | Median minutes from lead created to first call booked | `b2b_window_metrics` | Window | Setters | none | NEW (probe) |
| SAL-13 | Attribution coverage | Share of leads and demos with an ad id | `b2b_channel_coverage` | Window | CEO | none | NEW (probe) |
| SAL-14 | Sales EOD | Rep and setter EODs filed | B2B `eod_reports`, `team_eod_reports` | Person, day | Closers, setters | Every working day | NEW (probe) |
| SAL-15 | Closer daily activity | Scheduled calls, live calls, offers, deposits, closes, cash and contracted revenue per rep per day | Closer Tracker 2026 sheet 1UB7SK9W_W6BT8pmqCCNjLZ00VZX0VFh4QmlvGfwYTiY (one tab per rep; Dashboard Feed A:E) | Rep, day; manual | Closers | none | NEW (probe; typed by hand). Its close counts disagreed with the New Client Form (3 vs 7 in April). |
| SAL-16 | Deal and call corrections | Edits and voids of deals and calls, by editor | B2B `record_edits` (`edited_by`), `record_voids` | Event; 15 min | CEO | none | NEW (probe). The editor name is picked under a shared password. |
| SAL-17 | Sales call activity | Maqsam calls per setter with the transcribed share; recorded sales calls per rep | B2B `maqsam_calls` (roster in `sales_reps.maqsam_email`), `fathom_calls` (`recorded_by_email`) | Rep, day; 15 min | Closers, setters | none | NEW (probe). It also cross-checks that setters stay out of call centre metrics (3.7 C). |

### 2.3 Delivery and media buying

Ad rows keep each ad account's reporting day (3.10). Meta is the only live ad feed: the Snap, TikTok and Google feeds are dead (DEL-26), and some clients have no Meta access (DEL-31). GHL bookings exist for DFY clients only, and which clients are DFY is decision 2. The official gates and the booking definition are decision 3.

| ID | Metric | Definition and formula | Source of truth | Grain; freshness | Owner | Target | Status |
|---|---|---|---|---|---|---|---|
| DEL-01 | Ad spend (USD) | Sum of spend after the static FX table | MB `dailyStats.spend` (data_fb, Meta fallback) | Day x campaign x ad set x ad, account day; sync | MB | none | NOW (clearGrain deletes grain; fixed in Phase 0) |
| DEL-02 | Leads | Sum of leads (data_fb col F; Meta `action_type` lead) | MB `dailyStats.leads` | Same | MB | none | NOW (the sheet, the Meta fallback and the playbook count leads differently) |
| DEL-03 | Cost per lead | Sum(spend) / sum(leads) | `dailyStats`; `campaigns.cpl` (7 days) | Company, client, campaign; sync | MB | $15 (kpi.ts) vs $20 (constraints checklist, csmDiagnosis): decision 3 | NOW |
| DEL-04 | Spend and leads today | Values on each campaign's latest reported day | `campaigns.spendToday`, `leadsToday`, `dataThrough` | Campaign; sync | MB | none | NOW (days differ by campaign) |
| DEL-05 | Campaigns over gate and on kill | Count of CPL > gate; count of kill verdicts (CPL > 1.5x gate, or 0 leads) | `campaigns.verdict`, `rank`, `reason` | Campaign; sync | MB | 0 | NOW (verdicts move with the decision 3 gate) |
| DEL-06 | Bookings (GHL) | Non-cancelled GHL events, dated by booking day (`dateAdded`). Excludes Not Confirmed, callback, reschedule and personal calendars. DFY only. | MB `bookingEvents` | Client, day; sync | AG | none | NOW (duplicates, and a fetch window that misses future appointments; both fixed in Phase 0). Only 262 of 3,452 rows carry an ad id. |
| DEL-07 | Cost per booking | Spend / bookings in the same window | `dailyStats` + `bookingEvents`; `stats.ts computeRange`; `campaigns.costPerBooking` | Company, client; sync. The campaign 7-day value divides campaign spend by all of the client's bookings, so it is shown but never summed. | MB | $80 (sync.ts) vs under $60 (README): decision 3 | NOW (duplicates deflate it until Phase 0) |
| DEL-08 | Lead to booking rate (GHL) | Bookings / leads x 100, same window | `campaigns.bookingRate`; `stats.ts` | Client; sync. Campaign values use client bookings. | MB, AG | 25% | NOW (unit bug in `diagnose`, fixed in Phase 0). The stat sheet version is OUT-21. |
| DEL-09 | Verdict mix and history | Campaigns by verdict per day | `campaigns.verdict` copied into `ceoSnapshots` attrs | Campaign, day; daily | MB | none | DERIVE (overwritten every sync today) |
| DEL-10 | Wasted spend | Spend on campaigns with $50+ and 0 leads, plus spend on kill verdicts | `sync.ts diagnose` rule over `campaigns` | Campaign; sync | MB | $0 | NOW (point in time); DERIVE (history) |
| DEL-11 | Accounts blocked or card declined | Meta `account_status` 3, 2, 9, 100/101, 7/8 | `campaigns.accountIssue` | Ad account; sync | MB | 0 | NOW |
| DEL-12 | Link CTR, CPM, opt-in, frequency | As in `sync.ts` and `stats.ts finish`; impression and click minimums apply | `campaigns`, `ads`, `dailyStats` | Campaign, ad; sync | MB | CTR floor 0.3%; frequency 2.5; opt-in 2% | NOW |
| DEL-13 | Budget vs contract | Meta daily budget vs the card's Daily Ad Spend | `campaigns.budgetDaily`, `contractedBudget` | Campaign; sync | MB | Floor $30 a day ($50 a day per ad set in the checklist) | NOW |
| DEL-14 | Off-board spend | Spend on campaigns with no card | MB `offBoardCampaigns.spend7d` | Campaign; sync | MB | $0 | NOW (8 rows) |
| DEL-15 | Launch watch issues | Launching clients with missing account, missing task, or live while pre-launch | MB `launchWatch`; `stats.ts launchSummary` | Client; sync | MB | 0 | NOW (reads the previous cycle's onboardings) |
| DEL-16 | Days to launch | Launch Date minus Signup Date. When Signup Date is blank, the card's `date_created` is used and labelled. | CU 03968cf6, 2e744484; task `date_created` (`csmSync.ts signupDays`) | Client; sync | CSM, MB | 7 days | DERIVE (the Signup Date fill rate is unknown; SYS-14 shows it) |
| DEL-17 | Days from launch to first booking | First booking date minus Launch Date | `bookingEvents` + CU 2e744484; TRI `appointments` for older launches | Client; daily | MB, AG | 7 days | DERIVE. `bookingEvents` is DFY-only and starts about 2026-08-13, so launches before August wait on the Phase 4 TRI backfill. |
| DEL-18 | Tracking issues | Live ads with no URL parameters or no lead form | MB `trackingIssues` (322 rows) | Ad, client; daily | MB | 0 | NOW (no trend kept; audits only accounts in `marketPlays`) |
| DEL-19 | Spend matched to a client | Spend with a `clientKey` / all spend | `dailyStats` + `ceoAliases` | Day | SYS | 90%+ | DERIVE |
| DEL-20 | Decision outcomes after 7 days | CPL at decision vs CPL 7 days later | MB `decisions.metricAtDecision`, `metricAfter7d` | Decision | MB | none | DERIVE (`metricAfter7d` is never written today; `ceo.outcomes7d` writes it) |
| DEL-21 | Media buying changes | Toggles, budgets, builds, board status, Meta changes by actor | MB `manualChanges`, `campaignChat`, `adChanges` (7 days, 400-row cap) | Event; sync | MB | none | NOW (cockpit rows have no person until the Phase 0 attribution fix, decision 7) |
| DEL-22 | Days since last change | Learning (changed under 3 days ago); review due at 7+ days | `campaigns.lastChangeAt`, `daysSinceTouch` | Campaign; sync | MB | Review at 7 days | NOW |
| DEL-23 | Lost leads by reason | Lost Leads pipeline opportunities by stage name | MB `campaigns.lost` (100 cap); CS `clientProfiles.lost` (40 cap) | Client; sync | AG, CSM | none | NOW (capped; copied onto every campaign of the client, so never summed across campaigns) |
| DEL-24 | Accounts per media buyer | Spending client campaigns per media buyer | `campaigns` + a campaign owner field, which does not exist; media buyers from the `ceoPeople` person spine (`members`, STATIC map) | Person; daily | CEO | 40-60 accounts (comp plan) | NEW (field: no campaign or card names its media buyer) |
| DEL-25 | Winners | Live winners over 7 days, and the archive | `cockpit.ts winners`; MB `winnersArchive` | Ad; sync | MB, CD | Live: CPL <= $15 and spend >= $45. Archive: CPL <= $15 and spend >= $100. | NOW (archive not converted to USD) |
| DEL-26 | Non-Meta ad spend and leads | Spend and leads on Snap, TikTok and Google per client | MD tabs data_TT, data_Snap, data_Google; Client Data cols J (Snap) and L (TikTok) | Client, day; daily | MB | none | NEW (probe). The feeds are dead since 2026-08-22, so spend tiles carry the "Meta only" label. |
| DEL-27 | Launch checklist and cadence | Done / total checklist items per open launch task; launch day of each new campaign (Day N of 3) | MB `onboardings` (`cockpit.ts onboardings`); `campaigns.daysLive` | Launch task, campaign; sync | MB, CSM | Launch watch for the first 3 days | NOW (4 rows; no completion time per item; history from snapshots) |
| DEL-28 | Median day rate and days live | 30-day spend / days with rows (a mean on active days, despite the name); days since first spend | `campaigns.medianDayRate`, `daysLive`, `firstSpend` | Campaign; sync | MB | Floor $30 a day | NOW (days live is measured inside the 30-day window, so it tops out near 30) |
| DEL-29 | Cockpit ad actions | Budget raises and cut-worst-ad actions run from the cockpit, by person | `execute.ts runAction`, logged as `campaign.action` in `ceoActivity` (3.6) | Action; 1 min | MB | Raise at most +25% a step; never below $30 a day | DERIVE (counted from Phase 2) |
| DEL-30 | Rules overridden | Media buyer decisions of kind alternative, rerouted or left, grouped by the recommended action, over 30 days | MB `decisions` (`kind`, `action`, `reason`) | Rule, 30 days; daily | MB, CEO | A rule overridden 3 times gets changed (onboarding_launch_cockpits.md) | DERIVE (about 11 rows; no rule id is stored, so rows group by action text; `removeDecision` and `undoDecision` hard-delete rows) |
| DEL-31 | CRM-only client results | Leads in CRM, appointments, shows and closes for clients without Meta access | MD tabs CRM Dashboard and Main Dashboard #2 | Client, range; hourly | MB, CSM | none | NEW (probe). Covers clients such as Brilliant Touch, Ghazzawi.sa, Marble and more, Qatar Technology and Render. MD revenue col Q is unreliable. |

### 2.4 Call centre

Apart from CALL-08 (its stat sheet part) and CALL-17, none of these metrics is stored in Convex today. DIAL is the primary source and MQ is the completeness check (decision 6). Decision 6 also confirms which Maqsam accounts are call centre agents and which are setters. The dialer computes its numbers in its own code, so Phase 5 ports those formulas (3.7 C). Metrics that need attempts, dispositions or confirmation touches read the DIAL console store; if its probe fails they read "not connected", never 0. DWY clients dial their own leads, so they have no call data. Clients with a blank Service Mode stay out of call metrics until the CSM fills their Service Mode (decision 2).

| ID | Metric | Definition and formula | Source of truth | Grain; freshness | Owner | Target | Status |
|---|---|---|---|---|---|---|---|
| CALL-01 | Dials per agent | Outbound calls with exactly one agent, per agent per day | DIAL reporting store calls (dialer formula `caller.dials`, ported); MQ `GET /v3/calls` | Agent x client x day; dial sync (MQ every 15 min from 06:00 to 23:00, hourly overnight) | AG | 150/day (dialer) vs 100 (comp plan): decision 3 | NEW (probe) |
| CALL-02 | Connect rate (pickup) | Completed calls with duration > 0, divided by dials. A connection may be voicemail. | DIAL calls (dialer formula `connectionRate`, ported); CCD Pickup % as a cross-check | Agent, client; dial sync | AG | 35% | NEW (probe) |
| CALL-03 | Talk time | Total and average seconds on connected calls | DIAL calls (dialer formula `talkSeconds`, ported); MQ duration | Agent, client; dial sync | AG | none | NEW (probe) |
| CALL-04 | Conversations | Calls over 90 s; convo % = those / answers | DIAL calls (dialer formula `over90`, ported); CCD convo % as a cross-check | Agent, client; dial sync | AG | 25%, but the checklist counts calls over 120 s: decision 3 (default 90 s) | NEW (probe) |
| CALL-05 | Speed to lead | Median minutes from lead created to first dial, shown with sample size | DIAL console store attempts (`leadCreatedAt` to `startedAt`); if that probe fails, reporting store GHL contact `createdAt` to the first call | Lead, client, day; dial sync | AG | 5 min; 2 min for hot leads (dialer) | NEW (probe). The sheet tracker reads 0 on 88 of 113 rows and wraps at 60 min. |
| CALL-06 | Leads not called after 24h | Leads over 24h old with no call; called %; age of oldest uncalled | DIAL reporting store GHL contacts + calls; cross-check DB New Leads col D and CCD LEADS TO CALL cell E1 | Client, live; dial sync | CCL | 0 | NEW (probe) |
| CALL-07 | Attempts per lead | Distinct dials per lead before it moves to Lost | DIAL console store attempts + GHL New Leads pipeline stage | Lead; dial sync | AG | 4 over 3 days (pipeline) vs 9 (checklist): decision 3 | NEW (probe: console store) |
| CALL-08 | Bookings per agent | Booking credits per agent; stat sheet rows by Caller | DIAL booking credits; stat sheet col E (`csmProfiles.ts appointmentRows`) | Agent, day; dial sync / 25 min | AG | 6-9 a day per CSR | DERIVE (sheet); NEW (probe) for the dialer |
| CALL-09 | Bookings with no agent | Share of bookings with a blank agent | DIAL booking credits (dialer counter `quality.unattributedBookings`, ported); DB Appointments Agent column | Client, month | CCL | 0 (7.7% in the sheet: 33 of 427) | NEW (probe) |
| CALL-10 | Dispositions and lost reasons | Closed attempts by outcome, each with its note | DIAL console store attempts | Attempt; dial sync | AG | Every call dispositioned | NEW (probe: console store) |
| CALL-11 | Show rate by confirmation cadence | Show rate grouped by 48h and 24h confirmation touches | DIAL console store confirmation touches (`confirmation:{appointmentId}`) | Appointment; dial sync | AG | Confirm at 48h and at 24h | NEW (probe: console store) |
| CALL-12 | Call-to-client attribution | Calls resolved to a client / all calls | DIAL call-to-location links; CCD RAW DATA col K as a cross-check | Day; dial sync | SYS | Above the sheet's 47% (6,685 of 14,252) | NEW (probe) |
| CALL-13 | Dial failure rate | Rejected dispatches / dispatched, with reasons | DIAL console store attempts (dialer formula `failureRate`, ported); DialBridge Log `maqsam_response` | Agent, 30 days | CCL | none | NEW (probe: console store and DialBridge Log) |
| CALL-14 | Missed inbound calls from leads | Inbound no_answer or abandoned calls matched to a lead by phone key | MQ calls (direction inbound) | Call; 15 min from 06:00 to 23:00, hourly overnight | AG | 0 unreturned | NEW (Maqsam keys, decision 6). Make 8842754 only posted to Slack and is marked inactive. |
| CALL-15 | Agent availability | Available or absent, with away reason | MQ `GET /v1/agents/page/{n}` | Agent, live | CCL | none | NEW (Maqsam keys, decision 6) |
| CALL-16 | Valid working days | Days with >= 30 dials | CALL-01; the 30-dial threshold from CCD Input Values B5 | Agent, month | CCL | 30 dials counts as a day | NEW (waits on CALL-01) |
| CALL-17 | Provisional bookings and callbacks | Not Confirmed calendar events; callback events | CS `clientProfiles.provisional` | Client; sync | AG | none | NOW (count capped at 25; fixed in Phase 0) |
| CALL-18 | CSR EOD filed | One Client Sales Rep EOD per agent per working day | Typeform lEQhfNCi; EODWB tab Client Sales Rep | Agent, day; 15 min from 18:00 to 02:00, hourly otherwise | AG | Every working day | NEW (probe). No EOD form or EODWB tab is read by any backend today. |
| CALL-19 | Call centre tasks overdue | Open tasks past due | ClickUp list 901816723206 | Task; hourly | CCL | 0 | DERIVE (new read with the ClickUp access MB already uses; the cockpit only writes tasks to this list today) |
| CALL-20 | Agent cost and profit | Salary + commission vs bookings | CCD Input Values B7, B8 (both empty) | Agent, month | CEO | CSR plan: $650 base + $5/show + $20/close | NEW |
| CALL-21 | Dial share and team volume | Each agent's share of all dials; team median dials per day | DIAL calls; DialBridge Log `agent_email` and CCD RAW DATA agent as cross-checks | Agent, team, week; dial sync | CCL | 150-250 dials per agent a day on a working dialer | NEW (probe). A one-off check found one agent made 86% of dials. |
| CALL-22 | Average call gap | (Last call time - first call time) / (calls - 1), per agent per working day | DIAL call timestamps; CCD CALLER STATS col F as a cross-check (it spans nights and weekends) | Agent, day; dial sync | CCL | none | NEW (probe) |
| CALL-23 | Caller-ID routing accuracy | Share of dials whose caller ID country code matches the destination country | DialBridge Log 1zooa3gdhQs25AlScS5aQ5YdkuiKstQLGY-X91Nwzni0 (`caller_used` vs `phone_digits`) | Country, week; hourly | CCL | 100% | NEW (probe). Only dials placed with the button are logged. A one-off check found 100% over 3,310 dials. |
| CALL-24 | Call outcome mix | Counts of answered, no answer, busy, failed, blocked, other and inbound calls | DIAL calls (dialer counters `noAnswer`, `busy`, `failed`, `blocked`, ported); CCD Answers and No Answers as a cross-check | Agent, client; dial sync | AG | none | NEW (probe) |
| CALL-25 | Dials per lead and per booking | Dials / leads created in the period; dials / bookings created in the period | DIAL calls, GHL contacts and appointments; CCD as a cross-check | Client, agent, period; dial sync | CCL | none | NEW (probe) |
| CALL-26 | Booking rate from conversations (ABR) | Bookings created in the period / conversations over 90 s | DIAL booking credits + CALL-04; CCD ABR % as a cross-check | Client, agent, period; dial sync | AG | 30% pickup to booking (comp model) | NEW (probe) |
| CALL-27 | Dialed but not a contact | Dials that did not resolve to a contact, per agent | CCD tab DIALED BUT NOT A CONTACT; CCD CALLER STATS col AE as a cross-check | Agent, period; twice a day | CCL | none | NEW (probe). CCD is the only place this is counted. |
| CALL-28 | Unusable numbers and old backlog | Leads with a blank, 1-digit or too-short phone; leads never dialled that are older than 30 days | DB New Leads col D; DIAL GHL contacts + calls | Client; daily | CCL | 0 | NEW (probe). One-off checks found 14 of 2,369 unusable numbers and 37 old uncalled leads (oldest 102 days). |
| CALL-29 | Dialer opportunity outcomes | GHL opportunities won or lost in the period; won value; win rate = won / (won + lost) | DIAL reporting store opportunities (dialer formula `won`, `lost`, `wonValue`, ported) | Client, month; dial sync | CSM | none | NEW (probe). GHL monetary values are in each location's currency, not USD. |
| CALL-30 | Same-day no-show callbacks | No-shows that got a call to the same lead on the same day / all no-shows | Stat sheet rows with Show = N, matched by phone key to MQ calls or DIAL console store attempts | Appointment, week; daily | AG | Every no-show called back the same day | NEW (probe). Nothing measures this promise today, and GHL show status is never set. |
| CALL-31 | Watch Shift claims | Watch Shift items (reminders, callbacks, no-shows, lead replies) claimed with a checkmark reply, and the time to claim | Slack #watch-shift history (posts from Make 8850419) | Item, day; hourly | AG | none | NEW (probe). The checkmark is the only claim record. |

### 2.5 Client outcomes and retention

Show, quote, close and revenue come from each client's stat sheet, filled in by the client, so fill rates are low. Sheets show $ for every currency, so revenue is summed only across clients with a confirmed currency (3.7 D). Formulas and the client closed revenue source are decision 3; paying and churn rules are decision 4.

| ID | Metric | Definition and formula | Source of truth | Grain; freshness | Owner | Target | Status |
|---|---|---|---|---|---|---|---|
| OUT-01 | Paying clients | Roster clients in a paying state | CS `rosterDays.paying` (`csmSync.ts payingState`) | Day; daily | CEO | none | NOW. It counts pre-launch clients as paying (21 paying vs 14 Active on 2026-09-14). Decision 4 changes the rule. |
| OUT-02 | Monthly logo churn | Lost / paying on the first roster day of the month. Lost = stopped, cancelled, removed, or paused past the limit. Decision 4 excludes term completions at day 90+. | CS `csm.ts churnThisMonth` | Month; daily | CSM, CEO | 10% (code) vs 12% (USER.md): decision 4 | NOW, but broken: `churnEvents` is empty, so paused days are never known, paused clients never cross the churn line, and extension and pause counts read 0. Exact only from 2026-09-09. |
| OUT-03 | Lost clients and reasons | Named lost clients with Churn Reason and Churn Type | `churnThisMonth.lostClients`; CU 796f25e7, a121f39a; termination survey knIe4eF3 | Client; daily | CSM | none | NOW (names); NEW (reasons are empty on every card; the survey has no Make scenario) |
| OUT-04 | Paused clients and days paused | Today minus Paused On | CU 930c49eb | Client; sync | CSM | Churn at 14 days (code) vs 15 (billing script): decision 4 | DERIVE |
| OUT-05 | Client risk score | Weighted signals, 0-100, with top reasons (3.11) | `ceoSnapshots` inputs | Client, day; sync | CSM | Red >= 50 | DERIVE (weights are a proposal, calibrated in Phase 4) |
| OUT-06 | Appointments booked (sheet) | Stat sheet rows with an appointment date | `csmProfiles.ts summarise` | Client, month; 25 min | AG | none | NOW. The creative feed counts rows with a name in col A instead (`fanout.ts readStatSheet`), so both are shown (data issue). |
| OUT-07 | Show rate | Shows / (shows + no-shows) x 100. Coverage = decided / past booked. | Stat sheet col J | Client, week, month; 25 min | CSM | 75% | NOW. Coverage is shown per client. GHL show status is never set, and DB Appointments Showed? is filled on only 32% of rows. |
| OUT-08 | Close rate | Closes / shows (decision 3) | Stat sheet col L | Client, month; 25 min | CSM | 20-30% | NOW (the creative cockpit divides by quotes instead; DB Appointments Closed? is filled on 14% of rows) |
| OUT-09 | Appointments with no outcome | Past 2+ days with blank Show, or Show = Y and Closed blank | `csmProfiles.ts staleRows`, `unknownOutcome` | Client; 25 min | CSM | 0 | NOW |
| OUT-10 | Client revenue and average deal | Sum and mean of Total Customer Revenue on closed rows, in each client's currency. Portal Project Value (USD) replaces it once portal outcomes cover a client (decision 3). | Stat sheet Total Customer Revenue, found by header (col N in code, col M in one layout doc); DB Appointments col BO | Client, month; 25 min | CSM | $10,000+ renovations; $40,000+ full builds; $5,000+ interior only | DERIVE for the stat sheet revenue column (never read today); NEW (probe) for DB Appointments col BO (Phase 4 probe). Currency comes from the DIAL GHL location or the Client Data Country column. |
| OUT-11 | Quotes, deposits, CSAT | Counts of Y in cols K and G; mean of col M | `csmProfiles.ts summarise` | Client, month; 25 min | CSM | none (the quote target sits on OUT-19) | NOW (deposits and CSAT are computed but not displayed) |
| OUT-12 | Client ROI | Client revenue / (ad spend + Mahara fee) | OUT-10 + `dailyStats` + CU MRR | Client, month; daily | CSM | none | DERIVE (low coverage; confirmed currency only) |
| OUT-13 | Guarantee progress | Non-cancelled bookings since Launch Date vs 30 in 90 days, with pace | `bookingEvents` + CU 2e744484; TRI `appointments` for older launches | Client; sync | CSM | 30 in 90 days | DERIVE. "Qualified" has no field, so all non-cancelled bookings count. DFY only. Launches before August wait on the Phase 4 TRI backfill. |
| OUT-14 | Happiness mix and changes | Count per Client Happiness value; day-over-day changes | CU 4e3924e3 + `ceoSnapshots` attrs | Client; sync | CSM | none | NOW (mix); DERIVE (changes) |
| OUT-15 | Pulse health tier (cross-check) | Pulse rubric: appointments 35, leads 20, attendance 15, cost efficiency 15, pipeline movement 15 | Pulse RPC `pulse_client_health` on TRI | Client, day | CSM | 75+ fine; under 30 urgent | NEW (probe; runs outside the cockpit; used to calibrate OUT-05) |
| OUT-16 | Term end and renewal due | Launch Date + 90 days; Next Contract Renewal | CU 2e744484, eaa2caf3 | Client; sync | CSM | Renewal talk before day 90 | DERIVE |
| OUT-17 | 90-day renewals | Clients past day 90 with a new payment | `ceoSnapshots` + `ceoPayments` | Client, month | CSM | none | NEW (waits on MON-01) |
| OUT-18 | Pipeline position of leads | Leads of a period by current Main Pipeline stage | TRI `client_leads` + `client_opportunities` | Client, period; hourly | CSM | none | DERIVE (new read over the existing read-only SQL to TRI, which today queries only ad tables; about 27-28 sub-accounts) |
| OUT-19 | Quotation rate | Quotes / shows | Stat sheet col K (`csmProfiles.ts summarise`) | Client, month; 25 min | CSM | 50%+ same-day quotes (constraints checklist; timing is not captured) | DERIVE |
| OUT-20 | Cancellation rate | Cancelled / appointments booked | Stat sheet Dashboard tab (Cancelled, Cancellation Rate) | Client, month; hourly | CSM | Under 10% | NEW (probe) |
| OUT-21 | Lead to booking rate (sheet) | Stat sheet booked / Meta leads over this and last month; needs 10+ leads | `reportDocs.ts constraintsFor`; `csmDiagnosis.ts` (browser); `csmProfiles.ts byAd` | Client, 2 months; sync | CSM, AG | 25% | NOW. Only 14 of 49 clients have matched Meta leads; the rest fall back to sheet row counts, so trust is partial. |
| OUT-22 | Constraint diagnosis | The first failing constraint, in order: no_sheet, sheet_not_filled, nothing_live, cpl_high, booking_rate, show_rate, close_rate, macro_offer, silence. DWY clients skip the sheet and funnel constraints. | `csmDiagnosis.ts diagnose` (browser); `reportDocs.ts constraintsFor` (MB) | Client; sync | CSM, MB | No failing constraint | DERIVE. Phase 4 ports both into one shared function used by CS, report docs and CEO. Gates follow decision 3. nothing_live counts only for a client with a confirmed meta_account alias. |
| OUT-23 | Performance by ad (sheet) | Per ad: leads, booked, shows, no-shows, closes, unknown, book rate, show rate, close rate; top 12 for 2 months and all time | `csmProfiles.ts byAd` (stat sheet Ad column) | Client x ad; sync | CSM, MB, CD | none | NOW. It is the only link from an ad to a close. Ads are keyed by the name typed in the sheet. |
| OUT-24 | Book trends by group | Last 90 days: leads, spend and CPL per day; booked and show rate per ISO week; for the active, onboarding and paused groups | CS `csm.ts buildPerformanceOverview` (`trendByGroup`, `weeklyByGroup`) | Company, day and week; sync | CSM | none | NOW (read through `ceoFacts`) |

### 2.6 Client success operations

Most cadence rules run in CS browser code today, so the plan moves them to the backend. Last POC, Last Call and Next POC are thinly filled; how they are kept filled is decision 9.

| ID | Metric | Definition and formula | Source of truth | Grain; freshness | Owner | Target | Status |
|---|---|---|---|---|---|---|---|
| CS-01 | Clients needing action today | Rank under 40 and level not green | CS `csm.ts totals.dueToday` | Snapshot; sync | CSM | 0 | NOW |
| CS-02 | Silent clients | Today minus Last POC, at 7+ and 14+ days | CU e183f2ce (`silentDays`) | Client; sync | CSM | 14+ days = call today | NOW (Last POC set on 18 of 49) |
| CS-03 | Message cadence compliance | Managed clients not overdue / managed clients | `csmTemplates.ts cadence` (browser code today) | Client, day; sync | CSM | Daily in onboarding, every 2 days while ramping, 3x a week after | DERIVE (move the rule server-side) |
| CS-04 | Check-in call overdue | Call gap of 7+ days in the first 30 days live, else 14+ | `csmTemplates.ts cadence` (browser code today) over CU 032203ad (`csmSync.ts buildCsmSnapshot callDays`). The backend `csmSync.ts instruct` has only a 14-day call rule. | Client; sync | CSM | Weekly, then every 2 weeks | NOW, but broken: Last Call is empty on 49 of 49, so every managed client reads overdue (decision 9). DERIVE (move the rule server-side). |
| CS-05 | Next call booked | A future Next POC or a future calendar event | CU c48c1323; CS `calendarEvents` | Client; sync | CSM | 95%+ of check-ins end with the next call booked | NOW (Next POC on 12 of 49; no calendar event is matched to a client) |
| CS-06 | Monthly reports due and logged | `reportDue`; act kind report | CU "Last report sent"; CS outbox | Client; sync | CSM | Every Active client every 30 days | NOW |
| CS-07 | Weekly reports sent | One report per client per ISO week | A cockpit report action with its ISO week (decision 9); #csm-general bot posts (`report-{ghlLocationId}-{YYYY}-Wnn`) as a cross-check | Client, week | CSM | Every client every Thursday | NEW (field: weekly report action, decision 9). The Slack posts (probe) show requests, not delivery. |
| CS-08 | Report docs built | Requests with `builtAt` set | CS `reportDocs` | Request; 3 min | CSM | none | DERIVE (new bridge read) |
| CS-09 | Loose ends | csmSync loose count | CS `csm.ts totals.loose` | Client; sync | CSM | Cleared before 18:00 | NOW |
| CS-10 | CS tasks overdue | Client Success tasks past due | CS `csTasks` (list 901816723211) | Task; sync | CSM | 0 | NOW |
| CS-11 | Commitments outstanding | Lines from the latest call note not yet handled | `csmSync.ts commitments` | Client; sync | CSM | Each becomes a task | NOW |
| CS-12 | WhatsApp waiting on us | Now minus `waitingSince` | CS `waThreads` | Thread, live | CSM | Reply within 2-4h | NOW (0 rows in prod) |
| CS-13 | Average reply time | Client message to our reply | GHL conversations (only 10-12 messages kept per thread) | Thread, CSM | CSM | 2-4h | NEW (message events must be stored) |
| CS-14 | Data gaps per client | Gap keys (token, sheet, Meta access, board...) | `csmProfiles.ts gapsFor`; CS `gaps.ts` | Client; sync | SYS | 0 | NOW |
| CS-15 | Hot conversations this month | Upsell, referral and review decisions logged | CS `decisions`, `hotList` | Client, month | CSM | One per eligible client a month | DERIVE (bridge read) |
| CS-16 | Extensions granted | Live extensions | `csmSync.ts liveExtension` (Typeform gqBcyK6g) | Client, month; sync | CSM | -$50 penalty without a valid reason | NOW (matched by fuzzy name; the monthly count in `churnThisMonth` reads 0 while `churnEvents` is empty) |
| CS-17 | Onboarding spine day | Day 0-14 since signup; missed message days | `csmOnboardingSpine.ts` (browser code); card `date_created` | Client; sync | CSM | Message daily for 14 days | DERIVE (move the rule server-side) |
| CS-18 | Client calls scheduled | Calendar events by kind (onboarding, blueprint, launch, check-in). Held vs no-show is not tracked. | CS `calendarEvents` (Mahara GHL Client Account calendars) | Event; comms feed | CSM, CD | none | NOW (0 of 16 matched to a client; event kind unset) |
| CS-19 | Recorded client calls | Fathom calls matched in the last 30 days | CS `clientProfiles.calls` | Client; sync | CSM | 1 per 30 days | NOW (matched by name) |
| CS-20 | 1-1 call notes missing | Last Call set and no Typeform note after it | `csmSync.ts noteMissing` (Typeform fRokTITH) | Client; sync | CSM | 0 | NOW, but broken: it never fires because Last Call is empty. Decision 9. |
| CS-21 | Clients per CSM | Managed clients by assigned CSM | CS `clients.csmAssigned` | CSM; sync | CEO | 45 | NOW |
| CS-22 | DEFCON, call priority and comms level | Latest DEFCON and call priority from the 1-1 call notes form; the Comms Level dropdown | `csmSync.ts defcon`, `callPriority` (Typeform fRokTITH); CU a41bb123 Comms Level | Client; sync | CSM | Comms Level hint: Meh at 14 days silent, Danger at 30 | NOW (current values only; history starts with snapshots; danger values are mapped at risk score calibration) |
| CS-23 | Roster mix | Total clients; new signups (stage Needs Contacting); healthy (level green); buckets (management, onboarding, inactive); performance groups (active, onboarding, paused, churned) | CS `csm.ts buildSnapshot` totals; `buildPerformanceOverview` group rule | Snapshot; sync | CSM | Welcome call the same day for a new signup | NOW. Stage rules are duplicated with different regexes across the apps (data issue). |
| CS-24 | Hot list eligibility and pipeline | Clients eligible for an upsell, referral or review talk, and hot list rows by lead type and status. Two rules exist (snapshot: Active, 14+ days live, Happy or Very Happy, nothing logged this month; page: review, podcast or referral at over 30 days live, not red, not pause required, happy; second service at over 45 days, not red; budget increase at over 60 days, not red, happy) | CS `clients.hot`; `csmHotList.ts` (browser); CS `hotList` (0 rows; amount is free text) | Client, month | CSM | One upsell, referral or review conversation per client a month | NOW (snapshot rule); DERIVE (port the page rule). The two rules disagree (data issue). |
| CS-25 | Four Rs counts | Renewals, referrals signed, video testimonials, Google 5-star reviews, podcast case studies per month | Commission Typeforms ETEynRgb, bAmbMKM2 and siblings; CT tab 04; CS `decisions` | CSM, month | CSM | Commission rates in csmMoney.ts | NEW (probe) |

### 2.7 Creative

| ID | Metric | Definition and formula | Source of truth | Grain; freshness | Owner | Target | Status |
|---|---|---|---|---|---|---|---|
| CR-01 | Brand DNA open, oldest | Open brandDNA tasks; max age in days | CR `creativeTasks` (ClickUp 901818016338); `creative.ts buildSnapshot` | Task, client; sync | CD | Red at 21 days | NOW |
| CR-02 | Scripts open and stale | Open script requests; stale at 3+ days | Same | Task; sync | CD | Stale at 3 days (UI red at 7) | NOW |
| CR-03 | Videos open, overdue, by stage | Open jobs; jobs past due date | CR `videoJobs` (ClickUp 901816720767) | Job; sync | CD, ED | 0 overdue | NOW (34 of 37 jobs cancelled) |
| CR-04 | Editor workload | Open, overdue and next due per editor | `videoJobs.editors` | Editor; sync | ED | none | NOW |
| CR-05 | Approvals waiting on the CD | Jobs in client review, internal review, or update required | `creative.ts awaitingHisMove` | Job; sync | CD | none | NOW |
| CR-06 | Script and Brand DNA turnaround | Done time minus created time | ClickUp `date_done`, `date_closed` on Media/Creative tasks (fetched, mapped in Phase 0) | Task; sync | CD | none documented | DERIVE |
| CR-07 | Editor throughput and on-time rate | Video jobs reaching a done stage per editor per week; share done by due date | `ceoWorkItems` status diffs on Video Pipeline (no completion time exists, so forward only from ship day); Typeform WH3cPCVq optional | Editor, week; daily | ED | 60 approved videos a month | DERIVE (forward only). The Typeform part is NEW (probe). Edited link is empty on 37 of 37. |
| CR-08 | Video quality score | Weighted evaluation score | Video Performance Tracker 1z2cq84hmnyMK--dClM7rJp_tZvhQ8CWYibr8rHDxo2E, tab Evaluations | Video; weekly | ED | Excellent >= 85%, good >= 70% | NEW (probe; manual) |
| CR-09 | Scripts completed (self-reported) | Daily count in the CD EOD | EODWB tab Creative Director; Typeform wzm1gzEz | Day; hourly | CD | none | NEW (probe) |
| CR-10 | Creative refresh cadence | Days since the newest ad's first spend day | `dailyStats` first date per `metaAdId` per client | Client; daily | CD, MB | 7-14 days | DERIVE. Grain starts 2026-08-13, so older ads show "on or before 2026-08-13" until backfill. |
| CR-11 | New ads launched | Distinct `metaAdId` with first spend in the month | `dailyStats` | Client, month; daily | CD | About 10 quality videos a month | DERIVE (same history limit) |
| CR-12 | Fatigue with nothing queued | Clients with frequency >= 2.5 and no open script or video | MB `ads` + `creativeTasks` + `videoJobs` | Client; sync | CD | 0 | DERIVE |
| CR-13 | Creative sign-offs | Brand DNA closed, offer step closed, blueprint submitted | `creative.ts buildSnapshot` | Client; sync | CD | All done before ads run | NOW, but broken: subtasks never ticked; blueprints 0 rows |
| CR-14 | Docs missing | Live clients without both Brand DNA and Offer Cheat Sheet | `clients.ts buildRoster docsMissing` | Client; sync | CD | 0 | NOW |
| CR-15 | Script queue | Rows by priority and type | `creative.ts buildScriptQueue` | Client; sync | CD | none | NOW |
| CR-16 | Touchpoints owed | max(0, 2 - touches this week) | CR `touchLog` | Client, week | CD | 2 per active client a week | NOW (0 rows) |
| CR-17 | Winners with transcripts | Winners with a transcript / winners | `winnersArchive.transcript` | Company; sync | CD | none | NOW (0 of 26) |
| CR-18 | Forms with no gating question | Instant forms with 0 gates and spend | CR `funnels` | Destination; sync | CD | 3-5 questions | NOW |
| CR-19 | Playbook plays and creative patterns | Plays by service line, city, play type and interests (Proven, Worked once, Expensive); spend, leads, CPL by format, CTA, copy trait and language | MB and CR `marketPlays`; `market.ts playbook`, `creativePatterns`, `dimensions` | Play, pattern; weekly | CD, MB | CPL $15, min spend $100 | NOW (raw account currency, no FX) |
| CR-20 | Client heat score | brandDnaOldestDays + scriptsStale x 5 + videosOverdue x 5 + postsLate x 2 + burningAds x 3 | `creative.ts buildSnapshot clients[].heat` | Client; sync | CD | none | NOW |
| CR-21 | Scripting calendar and suggestions | Planned, unplanned and overdue items; proactive script suggestions | `creative.ts buildCalendar` | Day, client; sync | CD | none | NOW. Stopped clients can fill suggestion slots. |
| CR-22 | Social posts planned, late, uncovered | Open posts ahead; late posts; clients with no upcoming post | CR `contentPosts` (ClickUp 901818697220) | Client; sync | CD | none | NOW (0 real posts; service status unknown) |
| CR-23 | Drive folder coverage | Clients with a scripts subfolder and a footage subfolder | CR `clients.driveScripts`, `driveFootage` | Client; 6 h | CD | Every live client | DERIVE (stored, only logged today) |
| CR-24 | Footage received and scripts written | New files per client footage or scripts folder per week | Google Drive file listing | Client, week | CD | none | NEW (only subfolder names are scanned) |
| CR-25 | Time in client review and revision loops | Days in client review; passes through update required | `ceoWorkItems` status diffs | Job | CD | none | DERIVE (forward only; ClickUp time-in-status is not read) |
| CR-26 | Creative outbox latency and failures | createdAt to settledAt; failed share; attempts | CR `creativeOutbox` (0 rows) | Action, day | SYS | Lands within a minute (UI copy) | DERIVE (new bridge read; today the bridge returns pending rows only) |

### 2.8 Team and accountability

| ID | Metric | Definition and formula | Source of truth | Grain; freshness | Owner | Target | Status |
|---|---|---|---|---|---|---|---|
| TEAM-01 | Actions per person | Ledger events by actor and verb family | `ceoActivity` (3.6) | Person, day; 1-10 min | Each person | none | NEW (field: actor email, Phase 0). Role-level counts are DERIVE. |
| TEAM-02 | First and last action time | Earliest and latest ledger `at` per working day | `ceoActivity` | Person, day | Each person | Schedule Sat-Thu 10:00-18:00 | NEW (field, Phase 0) |
| TEAM-03 | Live change feed | All ledger events with before and after values | `ceoActivity` | Event; 1 min | CEO | none | DERIVE (events exist; names only after Phase 0) |
| TEAM-04 | EOD filed on time | Filed by 22:00 Kuwait on the working day. A filing between 00:00 and 04:00 counts for the previous working day and is late. | Convex `eodReports` (MB; CS and CR via bridge) for cockpit roles; EODWB role tabs and role Typeforms (KID8Jm6C, faOCAtH3, lEQhfNCi, JtRAjtsU, FSC0XwCg, wzm1gzEz, WH3cPCVq, BfnrbVWJ, x0FWfEpA) for other roles; B2B `eod_reports`, `team_eod_reports` | Person, day; hourly | Each person | Every working day | NEW (probe for sheets, forms and B2B). CSM EODs never reach EODWB (export drain dead), so CSMs are read from CS Convex only. |
| TEAM-05 | EOD energy and stress | Self-reported scores over time | CS and CR `eodReports`; Typeform grades | Person, day | CEO | none | DERIVE (Convex rows; 0 today). Typeform part NEW (probe). CEO-only. |
| TEAM-06 | Checklist completion | Done / total per role per day | `checks` on MB, CS, CR | Role, day | Each role | All done | NOW (MB); DERIVE (CS, CR bridge). No person until Phase 0. |
| TEAM-07 | Last seen and sign-ins | `members.lastSeenAt`; `authSessions` rows per user per deployment | MB `members`; `authSessions` + `users` on each deployment | Person | CEO | none | DERIVE (partial: MB and admin visits leave no trace) |
| TEAM-08 | Role scorecards | MB: DEL-03, DEL-05, DEL-10, DEL-21, TEAM-12. CSM: OUT-02, CS-02, CS-05, CS-06, MON-06, CS-12. CD: CR-01, CR-02, CR-12, CR-16. ED: CR-04, CR-07, CR-08. AG: CALL-01, CALL-02, CALL-05, CALL-08, CALL-10. All cards: TEAM-04. | Section 2 sources | Person, week | CEO | Role targets (3.3) | DERIVE at role level; per person needs Phase 0 and each input's status |
| TEAM-09 | Capacity lines | Clients per CSM; accounts per media buyer; dials per agent; open videos per editor | CS `clients.csmAssigned`; DEL-24; CALL-01; `videoJobs.editors` | Role, week | CEO | 45; 40-60; 150 a day; 60 a month | DERIVE (CSM, editors); NEW (media buyer owner field, calls) |
| TEAM-10 | Hermes throughput, failures, latency | Jobs done and failed by kind; median and p90 of `doneAt - createdAt` | MB `aiJobs`; `askAi.ts health` | Job, day | SYS | Claim TTL 20 min; chat gives up at 30 min | DERIVE |
| TEAM-11 | Hermes Meta actions | Count and ok share by method | MB `agentActions` | Action | MB, SYS | Budget +25% max per step; create paused | NOW |
| TEAM-12 | Waiting on leadership | Unanswered questions to leadership; fix requests marked needs_human | MB `campaignChat` (kind question, status sent); CS `asks`; `aiJobs` fix_request results | Item, live | CEO | 0 older than 24h (proposed) | DERIVE |
| TEAM-13 | Client card comments by author | Comments per ClickUp author per day | MB `clientComments.by` | Person, day; 15 min | All | none | NOW |
| TEAM-14 | ClickUp tasks overdue by assignee | Overdue tasks per assignee across department lists | Lists 901816723190, 901816723196, 901816723206, 901816723211, 901818016338 | Person; hourly | Each | 0 | DERIVE (the source map confirms these lists are reachable; two are new reads) |
| TEAM-15 | Recorded calls hosted | Fathom calls by host | CS `clientProfiles.calls[].host` | Person; sync | CSM, CD | none | NOW (name match) |
| TEAM-16 | Time tracked | Hours per person | Hubstaff (no integration) | Person, day | CEO | none | NEW |
| TEAM-17 | Assist requests | Queue depth, status and timings; requester | MB `assistRequests` (requestedBy is a user id); `assist.ts queueDepth` | Request; live | MB | Working over 20 min is requeued | NOW |
| TEAM-18 | EOD delivery state | MB: slackTs, attempts, error on the 1/5/15/60/240 min ladder. CS: exportedAt, exportError (never set; the drain lives only in the dead Viktor bridge). | MB `eodReports`; CS `eodReports` | EOD | SYS | Delivered same day | NOW (MB); DERIVE (CS bridge) |
| TEAM-19 | Plan items turned into tasks | planItems confirmed / total | MB and CS `planItems` | Role, day | Each role | All confirmed | DERIVE (0 rows) |
| TEAM-20 | Personal calendars connected | calendarLinks by status per owner | `calendarLinks` on MB, CS, CR | Person | Each | Linked and ok | DERIVE (1 creative link, in error) |
| TEAM-21 | Active days per person | Working days with at least one signed-in ledger event (decision 7) | `ceoActivity` | Person, month | CEO | none | NEW (field, Phase 0) |
| TEAM-22 | Hermes chat failure rate | Failed user messages / all user messages | `hermesChat` status on MB, CS, CR; `aiJobs` kind chat | Cockpit, day | SYS | none | DERIVE (users can clear threads; CS keeps 60). 5 of 21 MB rows failed. |
| TEAM-23 | Systems shipped | Validated systems per month (works repeatedly, SOP + Loom, adopted, 30-day clawback) | ClickUp Operations/Tech 901816723190; Systems Manager EOD | Month | SYS | 2-3 a month | NEW (no "validated" field) |
| TEAM-24 | Founder deep work hours | Hours of deep work per day | CEO Deep Work hourly form | Day | CEO | 4 hours a day | NEW (tracker sheet id not recorded; daemon state unverified). CEO-only. |
| TEAM-25 | Media buyer comp tier | Portfolio-average CPL tier ($14-17, $11-13, $9-10, $8 or less) | DEL-03 by media buyer | Person, month | CEO | Comp plan tiers | NEW (needs DEL-24 owner field) |
| TEAM-26 | EOD quality and strikes (cross-check) | On time, late (after 22:00), missed, under 50 words; strikes | EOD Radar sheet 1qD9UQrvYdXJUDnN7thq7HgzQ9ZV6SjOOjylB4CJ7raI | Person, day | CEO | Every working day | NEW (probe; running state unverified) |

### 2.9 Client portal engagement (Mahara OS)

Mahara OS has no read API for other services. No real client has saved an outcome yet, so expect near-zero values until a pilot runs.

| ID | Metric | Definition and formula | Source of truth | Grain; freshness | Owner | Target | Status |
|---|---|---|---|---|---|---|---|
| POR-01 | Outcomes submitted | Rows with Portal Updated At set / past appointments | DB tab Appointments (gid 2056166843) col BR; join on col R (appointment id) and col AL (location id) | Appointment, client; hourly | CSM | none | NEW (probe) |
| POR-02 | Lead quality average | Mean of the parsed "Lead quality (1-10): n" label | Appointments col BQ "Client Feedback (Portal)" (label format from portal `src/lib/feedback.ts`) | Client, ad, agent; hourly | CSM | none | NEW (probe); text parse |
| POR-03 | Portal deal status and project value | Deal Status (Portal); sum of Project Value (USD) on won deals | Appointments cols BS, BO | Appointment, client; hourly | CSM | See OUT-10 | NEW (probe) |
| POR-04 | Workspaces with access | Clients with at least one principal | Mahara OS `client-access.json` in `mahara_portal_documents` | Client | CSM | Every active client (proposed) | NEW (no export) |
| POR-05 | Client sign-ins and days since last visit | Distinct client users with a new session; days since last session | Mahara OS `__state__.sessions` (deleted at expiry) | User, client, day | CSM | none | NEW (needs a durable login log and an export) |
| POR-06 | Follow-up requests to the call centre | Requests by status (queued, delivered, failed) | Mahara OS `__state__.followups` | Request | AG | none | NEW |
| POR-07 | Onboarding complete | Agreement signed and onboarding form submitted | CU ac976d4a, 10b41484; portal `onboarding-state.ts` | Client; sync | CSM | Done before launch | DERIVE (ClickUp); NEW (portal verdict) |
| POR-08 | Client admin edits | Access, knowledge and branding audit events | Mahara OS `__state__.audit` | Event | CSM | none | NEW |
| POR-09 | Reason not closed and "How did it go?" | Free text per appointment, shown on the client page and in reviews | Appointments col BQ labelled text | Appointment | CSM | none | NEW (probe) |
| POR-10 | Portal bookings and ad CPA (cross-check) | Portal booking count (excludes deleted, callback, provisional and Not Confirmed) and spend / bookings per ad | Portal `src/lib/booking-metrics.ts bookingsInPeriod`, `reporting.ts adMetrics` | Client, ad, period | MB | none | NEW (no export) |

### 2.10 Machine health and data trust

| ID | Metric | Definition and formula | Source of truth | Grain; freshness | Owner | Target | Status |
|---|---|---|---|---|---|---|---|
| SYS-01 | Last sync age and problems | Now minus the newest `syncRuns` row with an empty role; problem count | MB `syncRuns`; `portal.ts overview` | Run; sync | SYS | Fresh within 45 min in the day | NOW (`cockpit.ts buildSnapshot` reads the CSM row; fixed in Phase 0) |
| SYS-02 | Newest data date per source | Latest data date, not read time | `campaigns.dataThrough`; adapter facts (`paid_at`, newest call) | Source | SYS | Per SLA (3.10) | DERIVE |
| SYS-03 | Source failures | Sources with a failure streak > 0 | MB `sourceHealth`; `health.ts sources` | Source; per call | SYS | Alert at 3 in a row | NOW (6 of 14 sources never write a row) |
| SYS-04 | Late or failing jobs | Late when now - at > max(3 x everyMin, 45 min) | MB `cronRuns`; `health.ts staleJobs` | Job | SYS | 0 | NOW (fanout untracked; likely false alarms overnight) |
| SYS-05 | Cockpit smoke status | Failing screen checks per app | MB `cockpitHealth` | App; 15 min | SYS | All ok | NOW |
| SYS-06 | CS and CR feed freshness | CS health rows; CR stale tables | CS `syncRuns` kind health; CR `sync.ts buildFreshness` | Feed; 15 min | SYS | 45 min | NOW (CR note dropped by `portal.overview`) |
| SYS-07 | Hermes queue and heartbeat | Queued, claimed, last poll | MB `aiJobs`; `sourceHealth` hermes; `askAi.ts waiting` | Live | SYS | Queued <= 5; poll within 10 min | NOW |
| SYS-08 | Outbox backlog | Unsent, in backoff, given up, per cockpit | MB `outbox`; CS `outbox`; CR `creativeOutbox` | Row; 1 min | SYS | 0 given up | DERIVE (children need a bridge read) |
| SYS-09 | Sync coverage | Campaigns with a Meta id; preview coverage | `syncRuns.health` | Run | SYS | Previews 80%+ | NOW |
| SYS-10 | Alerts raised | Alerts in 24h and 7 days | MB `alerts` | Alert | SYS | none | NOW |
| SYS-11 | Uptime and time to recover | Share of ok runs per job and source; minutes from first failure to next ok | `ceoHealthEvents` (append-only) | Job, source, day | SYS | none | NEW (starts on ship day) |
| SYS-12 | Booking duplicates | Rows sharing a GHL event id (new rows) or the composite key (old rows) | MB `bookingEvents` | Day | SYS | 0 | NEW (field: GHL event id, Phase 0) |
| SYS-13 | Identity coverage | Active clients mapped to ClickUp id, GHL location, Meta account, stat sheet, dialer location; unmatched aliases | `gaps.ts` counts; `ceoAliases` | Client; hourly | SYS | 100% of Active | DERIVE |
| SYS-14 | Field fill rates | Fill % of MRR, Next Payment Date, Last POC, Last Call, Happiness, Service Mode, Signup Date; Show and Closed on stat sheets | `ceoClientBilling`, CS `clients`, `clientProfiles` | Field; daily | SYS, CSM | Rising week on week (proposed) | DERIVE |
| SYS-15 | Read caps | Last data_fb row vs A3:Y11005; Client Data rows vs A1:S200 | `sync.ts` ranges | Run | SYS | Below cap | DERIVE |
| SYS-16 | Metric trust coverage | Share of registry metrics at each trust level | `ceoSnapshots` trust | Day | SYS | No broken headline tile | DERIVE |
| SYS-17 | Non-Meta feed status | Newest row date in data_TT, data_Snap, data_Google | MD tabs | Source; daily | SYS | Within 1 day | NEW (probe) |
| SYS-18 | GHL mirror agreement | Bookings per client per week: `bookingEvents` vs TRI `appointments` (Client Panel definition: counted calendars, booking date, not callback, not Not Confirmed, not cancelled or invalid) | MB `bookingEvents`; TRI `appointments` | Client, week; daily | SYS | Gap under 5% (proposed) | DERIVE |

## 3. Backend architecture (built first)

### 3.1 Where it lives and how data flows

- **One module, one deployment.** Everything goes in `convex/ceo/` on MB. CEO tables are never bridged to CS or CR.
- **Children do change, but not much.**
  - Phase 0: CS and CR store the signed-in person on writes and change their EOD keys.
  - Later: CS and CR gain bridge reads: `ceoFacts`, `ceoActivitySince`, outbox history, calendar links.
  - When a bridge payload changes, ship the children first.
- **Screens read only prepared data.** CEO queries read precomputed tables. No query calls an outside system or scans a raw table.
- **Table access bypasses the function gate.** Anyone with MB prod dashboard access, a deploy key, or `bunx convex data --prod` can read CEO tables, and `requireCeo` does not stop them. So:
  - Decision 1 settles who keeps that access.
  - Money rows stay minimal: payer emails are stored as hashes, and no card or bank data is ever stored.
  - A registry check fails the ship if any Hermes context function reads a `ceo*` table.

```
Outside systems (Meta, data_fb, ClickUp, GHL, stat sheets, Typeform, B2B, DB Payments tab,
DIAL or MQ, DB Appointments portal columns, TRI)
  |- existing sync + fanout (fixed in Phase 0) -> campaigns, dailyStats, bookingEvents, clients, clientProfiles
  |- ceo adapters (billing, money, calls, EOD, portal) -> ceoClientBilling, ceoPayments, ceoDeals, ceoCallDaily, ceoEodDaily, ceoOutcomes
  |- ClickUp diffs inside fanout -> ceoWorkItems + ceoActivity (field and status changes)
  |- cockpit mutations, child bridge reads, importers -> ceoActivity
  v
ceo.capture / ceo.live / ceo.closeDay / ceo.restate (registry formulas)
  -> ceoSnapshots (value + trust per metric, per scope, per day) -> ceoCards, ceoAlerts
  v
ceo.* queries (CEO gate) -> /ceo screens
```

**Files created in Phase 1**
- `convex/ceo/`: `registry.ts`, `formulas.ts`, `targets.ts`, `keys.ts`, `capture.ts`, `snapshot.ts`, `trust.ts`, `cards.ts`, `gate.ts`, `queries.ts`, `inspect.ts`
- `convex/ceo/adapters/billing.ts`
- New tables in `convex/schema.ts`
- New jobs in `health.ts JOBS` and `crons.ts`
- A registry check step in `scripts/ship.sh`

### 3.2 Metric registry

```ts
export type MetricDef = {
  id: string;                        // "DEL-03"
  group: "money"|"sales"|"delivery"|"calls"|"outcomes"|"cs"|"creative"|"team"|"portal"|"machine";
  label: string; doc: string;        // plain-English definition shown on the info card
  unit: "usd"|"count"|"pct"|"minutes"|"days"|"score";
  kind: "flow"|"stock";              // flows can be restated and backfilled; stocks freeze at day close
  rollup: "sum"|"ratio"|"last"|"avg"|"median";
  scopes: ("company"|"client"|"campaign"|"person")[];
  dayBasis: "account_day"|"kuwait_day"; // account_day for ad rows (3.10)
  sources: string[];                 // same keys as sourceHealth names
  formula: keyof typeof FORMULAS;    // one pure function: live, day close, rollups, backfill
  owner: "ceo"|"media_buyer"|"csm"|"creative"|"editor"|"agent"|"call_lead"|"systems";
  visibility: "ceo"|"leadership";    // money, pay, margin, EOD energy/stress, deep work are "ceo"
  target?: { key: string; direction: "atMost"|"atLeast" };
  coverage?: { of: string; ok: number; partial: number };
  knownIssues?: string[];            // ceoDataIssues keys that cap trust
  status: "now"|"derive"|"new"|"new_probe";
  liveFromPhase: number;
  defVersion: number;
};
```

**Rules**
- **Ratios keep their parts.** Store numerator and denominator. Weekly and monthly values are sum(n) / sum(d), never an average of daily ratios.
- **Registry check.** `scripts/ship.sh` today runs only `bunx biome check convex src` and no tests. Phase 1 adds a step after lint that runs a registry check script. The ship fails when:
  - a metric has no source, owner or visibility;
  - a `now` metric has no formula; or
  - a Hermes context function reads a `ceo*` table.
- **Versioning.** A formula change bumps `defVersion`. Stored values keep the version they were computed with. Each change is written to a registry changelog that the metric drawer shows.
- **One set of gates (Phase 7).** Today the gates are scattered: `sync.ts CPL_GATE` and `CPB_GATE`, `src/lib/kpi.ts`, `csmDiagnosis.ts GATES`, `reportDocs.ts GATES`, `csmMoney.ts CHURN_TARGET`. Phase 7 moves them all to `ceoTargets`, pushed to CS and CR the same way `members` is pushed, after decision 3.

### 3.3 Targets

`ceoTargets {key, scope, value, direction, warnAt, provenance, conflict, setBy, effectiveFrom}` holds every target. Aziz changes targets without a deploy, and each change is logged.

**Import sources.** Monthly company targets are imported as provenance once their probes pass:
- PPS Performance Dashboard TARGET rows (1leL582Rkam-pYIilQY7vS-zrhSl64H9j2MiNT5YHxp4)
- The June 2026 KPIs Doc (1Jp1Q3DWbMgDRgSCon-cyLqlBhK8jdIzThhDHWThTztU)
- B2B `monthly_targets` (runs to Aug 2026)

**Seeds (until decision 3):**

| Key | Seed | Provenance | Conflict to resolve |
|---|---|---|---|
| cpl_gate | $15 | kpi.ts (Aziz, 2026-09-03), README | $20 in constraints checklist and csmDiagnosis; $40 client-approval line (2026-09-12 meeting) |
| cpb_gate | $80 | sync.ts CPB_GATE, constraints checklist | Under $60 in README |
| booking_rate | 25% | README, reportDocs GATES | 20% business-knowledge.md; 60% in sync.ts (unit bug) |
| show_rate | 75% | README, csmDiagnosis | 70% csm-templates |
| close_rate | 20% (band 20-30%) | README, GATES.closeRate | CR divides by quotes |
| quote_rate | 50% | constraints checklist ("same-day") | Timing not captured |
| cancellation_rate | Under 10% | constraints checklist | none |
| pickup | 35% | README, constraints checklist | 30% comp model; alert under 60% client-comms-guide |
| speed_to_lead | 5 min | constraints checklist | 2 min for hot leads (dialer) |
| dials_per_agent_day | 150 | dialer `service.mjs` | 100 comp model; 150-250 SKILL |
| attempts_per_lead | 4 over 3 days | GHL pipeline ladder | 9 in checklist; about 8 over 10 days in context pack |
| churn_month | 10% | csmMoney.ts CHURN_TARGET | 12% USER.md |
| pause_to_churn_days | 14 | csm.ts PAUSE_IS_CHURN_DAYS | 15 in status_stamp.py |
| cash_month | $100,000 | USER.md | none |
| launch_days; first_booking_days | 7; 7 | onboarding-to-launch SOP | none |
| guarantee | 30 appointments in 90 days | context pack | none |
| budget_floor; frequency; link_ctr | $30/day; 2.5; 0.3% | sync.ts | $50/day per ad set in checklist |
| live_winner; archive_winner | spend >= $45; spend >= $100 (both CPL <= $15) | cockpit.ts winners; market.ts | none |
| reply_time | 2-4 h | client comms rules | none |
| eod_on_time | 22:00 Kuwait | EOD Radar rules | none |
| csm_base_pay | $1,200 + $50 per client over 20 | csmMoney.ts | $1,500 in memory/2026-05-30.md |
| clients_per_csm; mb_accounts; editor_videos_month; systems_month; deep_work | 45; 40-60; 60; 2-3; 4 h/day | comp plans, work-form checklist | none |
| creative_refresh_days | 14 (band 7-14) | locked SOP gates | 7-10 in checklist |

**Proposed thresholds with no source** (accepted or changed in decision 3):
- Charge not confirmed: older than 1 day
- Save client: up 2+ places
- Guarantee checkpoint: day 45
- Kill not actioned: after 1 working day
- Blocked on leadership: 24 h
- Quiet hours: 23:00-08:00
- Reconciliation gap: 5%
- EOD missing card: 2 working days

### 3.4 Entity keys

**Client key: the ClickUp task id in Clients - Mahara.** It already joins three places: Client Data col C, Typeform `onboarding_client_id`, and the Client Account contact field "Client ID" (Csj6vsVH3wSRseT3OkMU).

**Population**
- The spine holds every Clients - Mahara task. CR shows 64, including 15 "SALES TEAM TO CONTACT".
- CS drops rows with no stage and no CSM, plus the playing account (49 rows).
- Client Data holds about 60 rows.
- Which of these count in CEO lists, and how blank Service Mode is treated, is decision 2.

**Alias table.** `ceoAliases {entityType, entityKey, system, value, method: id|name_exact|name_fuzzy|manual, confidence, firstSeenAt, lastSeenAt, confirmedBy}`, indexed by (system, value) and by entityKey.

| System | Value | Learned from | Method |
|---|---|---|---|
| ghl_location | GHL location id | Client Data col D. The same id is the Mahara OS client id, TRI `ghl_clients.location_id`, DB Appointments col AL and the dialer's locationId. | id |
| meta_account | Meta ad account id + timezone | Client Data col K name match, then pinned by id. Timezone comes from adding `timezone_name` to the existing ad account read. | id after pin |
| meta_campaign | Meta campaign id | `campaigns` Meta ids; resolved from `metaAdId` on grain rows (Phase 0) | id |
| ads_card_tag | Ads Managment client tag | Board sync | id |
| stat_sheet | Sheet id | CU e6da13ae or Client Data col I | id |
| payer_email_hash | Hash of Whop and form email | B2B `closed_deals`, `whop_payments` | name until confirmed |
| display_name | Normalised names | Client Data, CS roster, Fathom titles, extension form text | name |

**Matching rules**
- An id match beats a confirmed match, which beats a name match.
- Any metric using a name match drops to partial trust.
- Unmatched values go to a review queue on `/ceo/data`.
- **Campaign keys (Phase 0).** `dailyStats` and `bookingEvents` gain `metaCampaignId`, so a rename no longer breaks history.
- **Client keys (Phase 4).** `clientKey` is added to `campaigns`, `dailyStats` and `bookingEvents`. `sync.ts ghlByClient` and `csmProfiles.ts accountFor` then stop joining by name.

**Person key: primary email.** People live in `ceoPeople {personKey, name, roles, team, seat, active, human}`. Their other identities are rows in `ceoAliases`:
- Second emails (Aziz's two addresses merge into one person) and `users.email` on each deployment
- ClickUp user id and username
- Meta actor name (`adChanges.actor`)
- Maqsam agent email and GHL `assignedUserId`
- Slack id and DB Agent Data agent number
- Stat sheet Caller name and Fathom host
- B2B `sales_reps.closer_aliases`; video editor names

**Seeds**
- `members` and the `roles.ts` STATIC map. The STATIC map carries both CS addresses, and it gives Aziz's two addresses the media_buyer role too, so that seat is always shared.
- `clickupMembers`, once `sync.storeMembers` is called.
- The call centre roster confirmed in decision 6.
- `videoJobs.editors`.

**Non-human actors:** hermes, system, make, billing_agent.

**`active` is set by hand**, because no HR source exists.

### 3.5 Storage

| Table | One row per | Holds | Why |
|---|---|---|---|
| `ceoSnapshots` | Day x scope (company, client, campaign, person) x key | `values[metricId] = {v, n, d, trust, coverage}`; `attrs` (stage, bucket, verdict, reason, board status, account issue, budget, happiness, DEFCON, plan, MRR, next payment, CSM, risk tier); `sourcesAsOf`; `revision`; `defVersions`; `final` | History for every metric and for state that is overwritten today. About 110-130 documents a day: 1 company, up to about 65 clients, 25-40 campaigns, 15-20 people. Each holds up to about 200 values (tens of KB). Indexes `by_scope_date`, `by_date_scope`. |
| `ceoTargets` | Target x scope | See 3.3 | Editable targets |
| `ceoAliases`, `ceoPeople` | Alias; person | See 3.4 | Joins |
| `ceoActivity` | Event | See 3.6 | Ledger |
| `ceoWorkItems` | ClickUp task | List, status, assignees, due date, created, doneAt, lastSeen, tracked field values | Turnaround; status and field diffs |
| `ceoClientBilling` | Client | Allowlisted money and lifecycle fields (3.7 A) | CEO-only money inputs |
| `ceoPayments` | Payment (Whop id or Payments tab Reference) | Source, clientKey, net USD, gross, refunded, method, paidAt, status, isBaseline, payerEmailHash | Cash |
| `ceoDeals` | `closed_deals` id | Closer, clientKey, contracted, cash at signing, lead source, submittedAt | Sales; new cash |
| `ceoCallDaily` | Day x agent x client | Dials, connected, talk seconds, over-90s calls, booked, failed, speed median and sample, attribution method | Call metrics. Raw calls stay in DIAL or MQ. |
| `ceoOutcomes` | clientKey x appointment id | Show, quote, closed, revenue, currency, portal deal status, project value, lead quality, portal updated at | Outcomes; portal |
| `ceoEodDaily` | Day x person | Role, source, submittedAt, onTime, energy, stress | Accountability |
| `ceoHealthEvents` | Job or source state flip | Name, direction, at, error | Uptime; time to recover |
| `ceoDataIssues` | Known defect or unmatched entity | Key, severity (info, partial, broken), metricIds, evidence, owner role, opened, resolved | Trust reasons |
| `ceoCards`, `ceoAlerts` | Open decision card; alert | Rule, scope, evidence, severity, dedupe signature, first and last seen, acknowledged by, resolved | Overview queue; alerts |
| `ceoReviews` | ISO week or month | Preliminary and final frozen payloads, notes, commitments with owner and due date | Review mode |
| `ceoCursors`, `ceoBackfill`, `ceoLeases` | Source cursor; backfill job; lease on a table and date range | Cursor, rows written, last error, done; lease holder and expiry | Idempotent pulls; resumable backfill; keeps backfill and sync from writing the same grain |

**Snapshot rules**
- **Flows** (spend, leads, bookings, dials, cash) are restated when a source rewrites a date. data_fb rewrites 30 days. Each change bumps `revision`.
- **Stocks** (past due, stage, queue depth, risk) freeze at day close.
- **Final.** A day becomes `final` at D+3.

### 3.6 Unified activity ledger

```ts
ceoActivity: defineTable({
  at: v.number(),
  actorKey: v.string(),       // personKey | hermes | system | make | billing_agent | unknown
  actorRaw: v.optional(v.string()),
  attribution: v.string(),    // signed_in | external_actor | correlated | role_only | none
  role: v.optional(v.string()),
  app: v.string(),            // media_buyer | csm | creative | portal | clickup | meta | dialer | whop | hermes | billing
  verb: v.string(),
  clientKey: v.optional(v.string()),
  subjectType: v.optional(v.string()), subjectId: v.optional(v.string()),
  summary: v.string(), before: v.optional(v.any()), after: v.optional(v.any()),
  sourceTable: v.string(), sourceId: v.string(),   // unique pair, so re-runs never duplicate
}).index("by_source", ["sourceTable", "sourceId"]).index("by_at", ["at"])
  .index("by_actor_at", ["actorKey", "at"]).index("by_client_at", ["clientKey", "at"]),
```

**Attribution values**

| Value | Meaning |
|---|---|
| signed_in | The actor comes from the signed-in user. |
| external_actor | The source system names the actor (Meta actor, ClickUp comment author, Maqsam agent email). |
| correlated | An automation matched by evidence: a ClickUp field change in the same sync window as a BILLING_ comment on that card, or a Payments tab "Logged By" row for that client, is credited to billing_agent. The billing agent posts under Aziz's ClickUp user, so it is never credited to Aziz. |
| role_only | Only the seat is known. |
| none | Nothing is known. |

No row is ever credited to a person by guessing. The media buyer seat is shared (Aziz's two addresses also hold it), and CS has two addresses.

**Verbs**

| Area | Verbs |
|---|---|
| Media buying | `decision.*`; `campaign.toggle`, `campaign.budget`, `campaign.build`, `campaign.board_status`, `campaign.cities`; `campaign.action` (execute.ts); `meta.change`; `question.to_leadership`; `assist.request` |
| Clients | `client.touchpoint`, `client.call`, `client.next_call`, `client.stage`, `client.happiness`, `client.report_sent`, `client.upsell`, `client.left`; `whatsapp.reply_sent` |
| Tasks and routines | `task.status`, `task.done`, `field.change`; `video.request`, `script.plan`; `check.done`, `eod.filed`, `plan.items`; `card.comment`; `calendar.linked` |
| Calls, sales, money | `calls.hourly`; `deal.signed`; `payment.received` |
| Hermes | `hermes.question` (count only), `hermes.meta_call`, `hermes.job_failed` |
| Admin and CEO | `member.edit`; `target.set`, `card.ack`, `finance_view` |

**Writers**

1. **Portal mutations** call `logActivity(ctx, ...)` in the same transaction, with the actor from the signed-in `users.email`:
   - `cockpit.ts`: `decide`, `logManualChange`, `toggleCheck`, `saveEod`, `addPlanItems`, `requestBuild`, `launchBuild`, `askForDetail`, `sendFeedback`
   - `control.ts recordToggle`, `edit.ts logIt`, `execute.ts runAction`
   - `board.ts`: `setAdStatus`, `setAdvertisingCities`, `setCardStatus`, off-board dismissals
   - `chat.ts ask`, `assist.ts enqueue`
   - `portal.ts`: `upsertMember`, `removeMember`
2. **Child apps** add a bridge read `ceoActivitySince({cursor})` to `ingest.ts runBridge`. MB pulls it every minute, next to `outboxDrains.drainAll`.
   - CS returns: decisions, settled outbox rows, usage, checks, eodReports, planItems, reportDocs, asks, looseDismissed, hotList, calendarLinks.
   - CR returns: creativeOutbox, touchLog, checks, eodReports, planItems, calendarLinks.
3. **Importers on MB tables** (each with a cursor):
   - `adChanges` with the Meta actor, copied before the 7-day window drops it
   - `clientComments.by`, skipping comments starting with BILLING_ or CLOSER:
   - `agentActions` and `aiJobs`. The person who asked Hermes is found through jobId, then `chatRelay`, then `hermesChat.thread`.
4. **ClickUp diffs inside fanout.** Clients - Mahara cards and creative, video and CS tasks are compared with `ceoWorkItems`. Each difference becomes a `field.change` or `task.status` row with before and after values. The actor is `none` unless the `correlated` rule applies, because the ClickUp API does not say who edited. History for stage, MRR, Next Payment Date and video status starts on ship day.
5. **Adapters** write:
   - `eod.filed` from the EOD sources
   - `deal.signed` from `closed_deals`
   - dispositions from the console store, when readable
   - Whop payments and Payments tab rows
   - calls rolled up per agent per hour ("42 dials, 11 connects, 38 talk min, 2 booked")

**Attribution fix (Phase 0)**
- **MB:** store the signed-in email on `decisions.byEmail`, `usage.email`, `manualChanges.by`, `campaignDrafts.by`, `campaignChat.authorName`, `offBoardDismissals.by`, `eodReports.email`, and a new `checks.doneBy`.
- **CS:** `csm.act` sets `decisions.byEmail` and `usage.email`; outbox rows get a `by` field (WhatsApp sends included); `checks.doneBy`.
- **CR:** `touchLog.doneBy`, `checks.doneBy`, `planItems.by`. `creativeOutbox.by` already exists.
- **EOD keys:**
  - MB and CS key `eodReports` by role + day + email.
  - CR has no role field, so it keys by day + email, and `saveEod` stops using `.unique()` by day.
  - MB saves and reads under the same working day. Today `saveEod` writes under `eodWorkingDay` but lookups use `kuwaitToday`.
- **Older rows** import as `role_only`.

### 3.7 Integration adapters

**Every adapter**
- runs through `health.runJob`;
- writes its own `sourceHealth` row with `dataAsOf`;
- upserts by natural key;
- never copies denylisted data;
- starts with a one-line access probe, and phase acceptance requires that probe to pass.

**A. ClickUp billing and lifecycle fields**
- `ceo/adapters/billing.ts` receives the raw Clients - Mahara tasks that `csmSync.ts` already fetches. It is a separate internal function that writes only `ceoClientBilling`.
- `buildCsmSnapshot` and its outputs stay unchanged: the MB `clients` table and the CS bridge payload.

| Field | Id |
|---|---|
| MRR | 48eb6023-8944-4404-9e30-b01fc8a38256 |
| LTV | 11d70e58-20e7-4ff0-85c6-51de42f044d2 |
| Next Payment Amount | f071ee8f-b7ce-49e8-899b-6bef649d86ba |
| Next Payment Date | 669ae046-bf82-4b59-80d5-bf25d6b57ef3 |
| Payment Plan | 17d17129-43c4-441b-a55c-6eca83b9f776 |
| Payment Method | 665e5754-b9c6-4776-9386-111ad221dead |
| Billing note (markers such as WHOP-CHARGE only) | f9bdf6b8-44de-4821-b804-52ca55d8d724 |
| Contract Status; Contract Link; Contract dropdown | ac976d4a-409b-441c-8c13-4b0e73a0c12f; 10b41484-c70d-4295-aab9-06a30443a3a2; 91e9e408-5673-4d8c-96c5-b557f2803b86 |
| Next Contract Renewal | eaa2caf3-899d-4072-beb3-72ef3c0427f1 |
| Signup Date; Launch Date | 03968cf6-dac1-43b6-8f02-cef999af2bbb; 2e744484-f581-4c37-962a-023c4de23729 |
| Paused On; Churn Date | 930c49eb-9374-410c-801f-9aa81fff4944; 42429a6e-5cba-4a3b-964d-2b493315421b |
| Churn Reason; Churn Type | 796f25e7-7e63-4d08-9ec4-41c58a5b57ca; a121f39a-f8a4-41f5-905e-a735ee729071 |
| Closer; Lead Source | 63af118b-bb16-48ba-9ddb-d0185b32fb23; e993c247-2b0e-4543-bcd8-7e1ed02f65fa |
| Daily Budget; Client Happiness; Comms Level | 539743c2-b6cd-4eeb-bf2f-abaf64769a5e; 4e3924e3-4898-4e98-aca1-cc1ac3015b73; a41bb123-95a9-408c-adb8-908afd3b453c |

Never read the "GHL API Key" card field. Never read formula fields such as Payment Health (92444a3b-e0fd-43b0-9a7c-25a2dd97f777) or Days Since Launch.

**B. Money**

1. **B2B Supabase**
   - **Tool change.** Add a `projectId` argument to `tools.ts supabaseQuery`, allowlisted to bldgtotkfmhoxmlzowdx and flwboeijllbtrufxkhts.
   - **Probe.** `select count(*) from whop_payments` with the existing `SUPABASE_ACCESS_TOKEN`. Both projects are in org bafhmyginudkdcotcsbg.
   - **Production use.** The management API was not built as a poller, so each pull runs one query per table, backs off on errors, and falls back to a read-only database credential issued by the project owner.
   - **Tables:** `whop_payments`, `closed_deals`, `expenses`, `transfers`, `meta_ad_snapshots`, `calls`, `leads`, `sales_reps`, `monthly_targets`, `eod_reports`, `team_eod_reports`, `record_edits`, `record_voids`, `maqsam_calls`, `fathom_calls`, `sync_state`.
   - **RPCs:** `b2b_deal_cash`, `b2b_window_metrics`, `b2b_rep_scorecard`, `b2b_pacing_pipeline`, `b2b_stalled_deals`, `b2b_channel_coverage`, `b2b_marketing_window`.
   - **Emails** are hashed on ingest.
   - **Scope** of what gets copied follows decision 5.
2. **DB Payments tab (gid 1586289433).** Read with the existing service account, limited to that tab's range. Rows marked Baseline get `isBaseline` and never count as cash in a month.
3. **Churn Tracker tabs 01, 02, 04 and 07.** Read-only, labelled manual, used for history and cross-checks.
4. **Whop direct and Tap.** Reading Whop directly needs a Whop key on MB and is planned only if B2B access is refused. Tap has no integration, so off-Whop cash is always manual: a data issue plus the owner named in decision 4.

**C. Call centre** (decision 6)

1. **DIAL reporting store (preferred)**
   - **Probe:**
     - List the store's tables.
     - Call `mahara_reporting` for namespace production and the current month.
     - Read `mahara_reporting_sync` job status to measure the sync cadence and set the SLA.
   - **Formulas.** The dialer computes its metrics in Node. Before porting, copy its readable source (`owned-reporting.mjs`, `service.mjs`, `domain.mjs`, `reporting-sync.mjs`) from the temporary `/private/tmp/mahara-storage-recovery` copy into a read-only reference folder in this repo, with the maintainer's agreement. Then port the dials, connection, talk, over-90, speed, booking-credit, quality-counter and won/lost formulas into `formulas.ts`, citing the file they came from.
   - **Store** day x agent x client rows in `ceoCallDaily`.
   - **Map** dialer locationId to `ghl_location` (exact) and agent email to people.
   - **Currency.** GHL locations in the store carry currency and timezone, which feeds per-client currency for OUT-10.
2. **DIAL console store.** A separate probe of `mahara_console_store`. If attempts and dispositions are not readable, CALL-07, CALL-10, CALL-11 and CALL-13 stay "not connected", and CALL-05 uses the reporting-store definition.
3. **MQ**
   - **Credentials.** Add `MAQSAM_ACCESS_KEY` and `MAQSAM_SECRET` to the MB env.
   - **Endpoints.** `GET /v1/agents/page/{n}` and `GET /v3/calls?email&start_time&end_time&page`.
   - **Paging.** Use `page` only (offset is ignored). Re-read with a 72-hour overlap; back off on 429.
   - **Keep only:** call id, agent email, direction, state, timestamp, duration, and a phone key (last 8 digits). No recordings, transcripts or names.
   - **Attribution.** Match the phone key against DIAL GHL contacts, or DB New Leads col D (probe), flagged as a phone match.
4. **Setter exclusion** uses the `ceoPeople` roster from decision 6. B2B `sales_reps.maqsam_email` and `maqsam_calls` are a cross-check only, once Phase 3 access exists.
5. **CCD RAW DATA and LEADS TO CALL** are cross-checks, not sources: about 47% attribution, pulled about twice a day, and a date range typed by hand.

**D. Client portal and outcomes**

1. **Stat sheets.**
   - Read the Total Customer Revenue column by header name inside the A1:P600 range `csmProfiles.ts` already fetches.
   - Probe the Dashboard tab for Cancelled.
   - One-time backfill of every month tab.
   - Per-client currency comes from the DIAL store's GHL location currency when available, else from the Client Data Country column. Amounts in an unconfirmed currency are never summed across clients.
2. **DB tab Appointments (gid 2056166843), hourly.**
   - Columns A, B, P, R, AL.
   - Portal columns: BO Project Value (USD), BP Quotation Given (Portal), BQ Client Feedback (Portal), BR Portal Updated At, BS Deal Status (Portal).
   - Parse lead quality, "How did it go?" and "Reason not closed" from the labelled text in BQ.
3. **MD tabs CRM Dashboard and Main Dashboard #2** (probe), for CRM-only clients (DEL-31).
4. **TRI tables** `client_leads`, `client_opportunities`, `appointments` for pipeline position, booking backfill and SYS-18.
5. **Later (blocked): a signed read-only export route in Mahara OS** returning grants, a durable login log, outcome receipts, follow-ups, audit counts and portal booking counts. Blocked on the portal source moving into git and a login log being added.

**E. EOD**

| Order | Source | Covers |
|---|---|---|
| 1 | Convex `eodReports`: MB local, CS and CR through `ceoActivitySince` | Cockpit roles. CSMs come only from here, because CS EODs never reach EODWB. |
| 2 | EODWB role tabs (probe) | Roles without a cockpit: Client Sales Rep, Video Editors, Systems Manager, Executive Assistant, Sales Rep, Setter, Creative Director |
| 3 | Role Typeforms (probe) | Fallback for missing rows |
| 4 | B2B `eod_reports`, `team_eod_reports` | Only after Phase 3 access |
| 5 | EOD Radar sheet (probe) | Cross-check |

**F. Child facts.** A new bridge read `ceoFacts` reuses each child's own logic, so there is one definition:
- **CS:** `churnThisMonth`, the latest `rosterDays` row, `buildSnapshot` totals, `buildPerformanceOverview` trends, gaps counts, the `waThreads` waiting summary, outbox counts by state.
- **CR:** per-client `buildSnapshot` counts and heat, editors, `buildCalendar` counts, script queue sizes, `creativeOutbox` counts by state.

**G. Other sources**
- **ClickUp creative lists** 901818016338 and 901816720767: paginated, with `date_done`, `date_closed` and creator mapped (Phase 0).
- **Department lists** 901816723190, 901816723196, 901816723206, 901816723211 for overdue tasks by assignee.
- **Video Performance Tracker** (probe), weekly.
- **MD tabs data_TT, data_Snap, data_Google** (probe) for SYS-17 and DEL-26.
- **DialBridge Log** 1zooa3gdhQs25AlScS5aQ5YdkuiKstQLGY-X91Nwzni0 (probe) for CALL-13 and CALL-23.
- **Slack #csm-general and #watch-shift history** (probe). The backend only sends to Slack today.

**Denylist.** Never stored in any `ceo` table:
- the ClickUp "GHL API Key" field and Client Data col E tokens
- lead names and phone numbers from `clientProfiles.lost.leads`
- bank details from billing-invoices.md
- Client Card Info form (Uju17Z13) data
- call recordings and transcripts
- payer emails in clear text

### 3.8 Compute jobs and schedules

All jobs are registered in `health.ts JOBS` with an accurate `everyMin`. Times are Kuwait (UTC+3).

| Job | When | Does |
|---|---|---|
| `ceo.capture` | End of every `runFanout` | Copies client signals, runs the billing adapter and ClickUp diffs, marks dirty scopes |
| `ceo.live` | After capture; every 15 min 06:00-23:00 | Today's snapshot rows for dirty scopes, with trust, risk and cards |
| `ceo.activity.pull` | Every 1 min | Child `ceoActivitySince`; MB importers |
| `ceo.money.pull` | Every 15 min; Payments tab hourly | B2B pulls and RPCs |
| `ceo.calls.pull` | Every 15 min 06:00-23:00, hourly otherwise | DIAL (at its measured cadence) and MQ, with a 72-hour overlap |
| `ceo.eod.pull` | Every 15 min 18:00-02:00, hourly otherwise | EOD sources into `ceoEodDaily` |
| `ceo.portal.pull` | Hourly | Appointments BO:BS, Dashboard tabs, MD CRM tabs |
| `ceo.closeDay` | 23:55 | Freezes the day's stocks |
| `ceo.restate` | 06:15, after the first morning sync | Recomputes flows for D-1 to D-3; marks D-3 final |
| `ceo.outcomes7d` | 00:30 | Writes `decisions.metricAfter7d` |
| `ceo.quality` | 03:30 | Runs 3.10 checks into `ceoDataIssues` |
| `ceo.alerts` | Every 15 min | Evaluates rules, dedupes, sends Slack DMs through `health.ts` notify |
| `ceo.closeWeek` | Friday 01:00 (preliminary); Sunday 06:30 (final, after restate makes Thursday final) | Freezes the week into `ceoReviews`; the final pack lists every value that moved |
| `ceo.closeMonth` | 4th of the month, 07:00, after restate makes the last day final | Month values, churn, MRR bridge |
| `ceo.backfill` | Chained steps from 00:00 to 05:00 | Backfill (3.9). Takes a `ceoLeases` lease on the table and date range; the sync waits for or skips a leased range. |
| `ceo.prune` | 04:00 | Retention (3.14) |

**Limits**
- Read by index and date range only; split large reads into scheduled steps.
- Never call `.collect()` on `aiJobs`, `agentActions`, `dailyStats` or `ceoActivity`.
- Write a snapshot only when its hash changed.

### 3.9 Backfill strategy

| Data | Back to | Method | Label |
|---|---|---|---|
| Client spend and leads | As far as data_fb holds | Rebuild `dailyStats` by (ad account, reporting day) with `metaCampaignId`, under a lease. Accounts missing from the sheet come from Meta insights, one account per overnight step. | backfill (static FX; row 11005 read cap) |
| Bookings | 2026-03-01 | Old `bookingEvents` duplicates removed by composite key. Older bookings come from TRI `appointments` (booked after 2026-03-01), mapped to the cockpit booking definition. | backfill |
| Show, quote, close, revenue, cancellations | Jan 26 month tab | One-time read of every stat sheet month tab and Dashboard tab | backfill; low fill |
| Stage and churn | 2026-09-09 exact | `rosterDays`. Earlier months from CT tab 01 (January and part of August). | manual before September |
| Cash | 2025-09 | Full `whop_payments` | verified |
| Off-Whop cash | Aug 2026 | Payments tab rows entered by the decision 4 owner. Earlier months from CT 02 where typed. | manual |
| Deals | April 2026 | `closed_deals` (April contracted revenue is null) | backfill; flagged |
| Calls | All history in DIAL, else 180 days of MQ | Monthly windows, paged | backfill until import coverage is measured |
| EOD | 2026-08-05 (EODWB rebuild) | EODWB tabs, B2B EOD tables, Typeform history | backfill |
| Team activity | Existing rows | `decisions`, `manualChanges`, `campaignChat`, `agentActions`, CS decisions | role_only |
| Meta changes | 7 days | `adChanges` | exact actor |
| Creative first spend | 2026-08-13 | Ads older than the grain show "on or before 2026-08-13" until the ad grain backfill runs | partial |
| ClickUp field history, video completions, health uptime, portal sessions | None possible | Starts on ship day | none |

**Rules**
- Every backfill job is an idempotent upsert with a dry-run count mode.
- A backfill is accepted only after it matches live data on an overlap window.
- Backfills write flows and facts, never stocks.

### 3.10 Trust, freshness and data quality

**Trust levels.** The worst failing check wins.

| Level | Rule | UI |
|---|---|---|
| high | Fresh within SLA, coverage >= 90%, no open defect | Plain value |
| partial | Coverage 60-90%, a name-match join, or an open partial defect | Value + coverage % |
| low | Coverage under 60% | Greyed value + reason |
| stale | Newest data older than SLA (up to 2x) | Value + age |
| broken | An open broken defect | Value hidden; reason shown |
| none | No source, or stale beyond 2x SLA | "No data" + what is needed; never 0 |

Labels shown next to the value that do not lower trust: backfill, manual, definition pending, Meta only, account day.

**Day basis.** Ad rows keep each account's reporting day. `ceo.quality` lists accounts whose `timezone_name` is not UTC+3, and tiles that mix UTC+3 and UTC+4 accounts carry the "account day" label. Mahara's own Los Angeles account is kept in its own CEO-only table and never summed with client spend.

**Freshness SLAs.** Checked against the newest data date. Add `dataAsOf` and `slaMin` to `sourceHealth`.

| Source | SLA |
|---|---|
| data_fb and Meta | 45 min day, 90 min night |
| GHL, ClickUp | 45 min |
| Stat sheets, Client Data | 60 min |
| B2B, MQ, EOD | 45 min in working hours |
| DIAL | Measured cadence x 2 (set in Phase 5) |
| Payments tab, portal columns, MD CRM tabs | 2 h |
| CCD | 14 h |
| `marketPlays` | 8 days |
| Churn Tracker | 35 days (manual) |

**Coverage inputs**
- Spend matched to a client (DEL-19)
- DFY clients with a working GHL token (gaps `ghl_token`)
- Show and close fill (OUT-09)
- MRR fill; Next Payment Date on live clients
- Call attribution (CALL-12)
- Bookings with an ad id; Last POC fill
- Clients with matched ad leads (14 of 49)
- Service Mode fill

**Seeded `ceoDataIssues`.** Each lists the metrics it downgrades and closes itself when its check passes.
- **Pipeline bugs:**
  - clearGrain deletes grain
  - `bookingEvents` duplicates, and the booking window missing future appointments
  - booking rate unit bug; `syncRuns` role bug; provisional count capped at 25
  - fanout missing from `cronRuns`
  - lost leads capped at 100 and copied onto every campaign
  - Hermes `contextFor` sends campaign fields that do not exist
- **Empty or dead sources:**
  - GHL show status never set (all 3,452 rows confirmed)
  - Last Call empty on 49 of 49; `churnEvents` empty
  - Payment Health formula broken; Closed? never Y in DB Appointments
  - Service Mode blank on 20 clients, MOFAG unresolved
  - Video Pipeline edited link empty; `waThreads` empty
  - Snap, TikTok and Google feeds dead since 2026-08-22
  - CSM EOD export dead
  - Viktor bridge features dead: CS `kpi`, `appointments`, `nextCallAt`, `reportNudge`
- **Conflicting rules or figures:**
  - Two hot list rules disagree
  - Two stat sheet booked definitions
  - Stat sheet revenue column (N in code, M in one layout doc)
  - Client revenue shown as $ for every currency
  - CSM base pay $1,200 vs $1,500
  - Whop open charges 56 ($93,363) vs 58 ($96,363)
  - CT 02 lists 15 active clients vs 14 Active on the CS roster
  - Dialer import coverage unmeasured
  - Off-Whop cash is manual
- **Formula, currency and read limits:**
  - Speed-to-lead MOD formula
  - `marketPlays` and winners not in USD
  - data_fb read cap at row 11005; Client Data read cap at 200 rows

**Daily reconciliations.** A gap over 5% (proposed) opens an issue.
- `bookingEvents` duplicate keys (composite and event id)
- `dailyStats` D-7 row count dropped without a restatement
- Whop net per month vs CT 02 Total Revenue; Whop open charge count vs the B2B app figure
- `closed_deals` count vs CU Signup Date count
- Stat sheet booked (both definitions) vs GHL bookings, per client
- `bookingEvents` vs TRI `appointments` per client per week (SYS-18)
- DIAL dials vs MQ outbound, per agent
- MRR vs Next Payment Amount vs closer-note New MRR; Payment Plan vs the closer note
- CT 02 active count vs roster Active
- Ad accounts in a currency missing from the FX table
- Child feeds stale
- Registry sources with no `sourceHealth` row

### 3.11 Funnel, risk score and decision cards

**Funnel (DFY clients).** DWY clients stop at leads and are judged on CPL only. Clients with blank Service Mode are excluded from the funnel and listed.

| Stage | Metric | Target |
|---|---|---|
| Spend | DEL-01 | none |
| Leads | DEL-02 | CPL gate |
| Called within 24h | CALL-06 | 100% |
| Connected | CALL-02 | 35% |
| Booked | DEL-06 (GHL) or OUT-06 (sheet) | 25% of leads |
| Showed | OUT-07 | 75% |
| Quoted | OUT-19 | 50% |
| Closed | OUT-08 | 20% |
| Client revenue | OUT-10 | none |

**Two modes**
- **Period:** counts dated inside the range. Never labelled a conversion.
- **Cohort:** leads of a period, followed forward (Phase 5).

**The leak is one rule.** Phase 4 ports `csmDiagnosis.ts diagnose` and `reportDocs.ts constraintsFor` into one shared backend function (OUT-22). The CS cockpit, the report docs and the CEO funnel all call it. The leak shown is the first failing constraint in that order. A stage below partial trust is shown but never named the leak.

**Client risk score (OUT-05).** 0-100, higher is more at risk.
- **Weights are a proposal**, calibrated against a backtest report (Phase 4) and Pulse tiers.
- **A missing input adds no points and lowers trust.** It never counts as healthy.

| Block (cap) | Signals and points | Source |
|---|---|---|
| Money (25) | Past due 3+ days: 25; 1-2 days: 15; live client with no Next Payment Date: 5 | MON-06, MON-07 |
| Results (30) | Spending with no booking in 21 days: 20 (Pulse "urgent"); 7-day CPL over 1.5x gate: 10; bookings in the last 14 days down over 50% vs the prior 14: 10 | DEL-03, DEL-06 |
| Relationship (25) | Silent 14+ days: 15 (7+ days: 8); happiness At Risk: 20, Neutral: 5; latest DEFCON or Comms Level in a danger value (value list mapped at calibration): 10; risk lines in comment digests within 14 days: 5; no recorded call in 30 days: 5 | CS-02, OUT-14, CS-22, `clientComments`, CS-19 |
| Lifecycle (10) | Term end within 14 days and no renewal: 10; paused: 10 | OUT-16, OUT-04 |
| Delivery (10) | Nothing live on an active client: 10 (only when the client has a confirmed meta_account alias); account blocked: 5; tracking issues: 3 | OUT-22 nothing_live, DEL-11, DEL-18 |

Tiers: red >= 50, amber 25-49, green under 25. Each score lists its top 3 signals, each with one evidence line.

**Decision cards.** Thresholds marked "proposed" are confirmed in decision 3.

| Card | Rule | Threshold source |
|---|---|---|
| Pause client | `pauseRequired` is true | csmSync instruct (day 3) |
| Failed charge | MON-14 > 0 | Whop |
| Charge not confirmed | MON-16 older than 1 day | proposed |
| Save client | Red tier, new or up 2+ places | proposed |
| Guarantee at risk | By day 45, projected bookings at day 90 under 30 | Context pack guarantee; checkpoint proposed |
| Waste | $50+ spend and 0 leads | sync.ts diagnose |
| Account blocked | DEL-11 > 0 | Meta account_status |
| Leads uncalled | CALL-06 > 0 | CCD definition |
| Show rate | OUT-07 under 75% with 8+ decided appointments | csmDiagnosis |
| Kill not actioned | Kill verdict older than 1 working day with no decision or change | proposed |
| Rule overridden | DEL-30 rule overridden 3+ times in 30 days | onboarding_launch_cockpits.md |
| EOD missing | 2 working days missed | EOD Radar rule; window proposed |
| Blocked on leadership | TEAM-12 item open 24h+ | proposed |
| Overload | Role past its TEAM-09 capacity line | comp plans |
| Machine | Sync stale, source streak of 3, or Hermes queue over 5 | health.ts, AdminPage |

Cards close themselves when their condition clears. Every acknowledgement is logged.

### 3.12 Access control

- **New `ceo` role.** Add it in `portal.ts ROLES`, `roles.ts` HOME (routes to `/ceo`) and `accessFor` (all clients, read-only), AdminPage `ROLE_META`, and `src/components/RoleRoute.tsx`.
- **Granting.** Only through `members` rows, never the STATIC fallback. The holders come from decision 1 (default: Aziz's two addresses, each admin + ceo). The children's `roles.ts` do not change.
- **Gate every function.** Every `ceo.*` function calls `requireCeo(ctx)`. Values with `visibility: "ceo"` are stripped for any other caller, including a plain admin. Admin alone keeps machine health and team activity on the existing Admin page.
- **Audit finance reads.** Every finance read is logged as `finance_view`.
- **Dashboard access.** The MB prod Convex dashboard access list and deploy keys are reviewed in decision 1, because they bypass the gate.
- **Team screens** keep saying "leadership", never the founder's name.

### 3.13 Query API

| Function | Args | Returns |
|---|---|---|
| `ceo.overview` | date? | Trust bar; decision cards; tiles `{metricId, v, target, band, delta7d, delta30d, trust, asOf, spark30, drillTo, liveFromPhase}`; funnel strip; top 5 at risk; team today; last 20 activity rows |
| `ceo.metric` | id, scope, key?, from, to, period | Series with `n`, `d`, trust and revision per point; definition card and changelog; sources and clocks |
| `ceo.breakdown` | id, by (client, person, campaign, agent), date or range | Ranked rows with trust |
| `ceo.funnel` | scope, key?, range, mode | Stages, rates, targets, trust, leak (from the shared diagnose function) |
| `ceo.clients` | filter, sort | One row per client (columns in 5.3) |
| `ceo.client` | clientKey, range | 360 view of one client |
| `ceo.campaign` | metaCampaignId, range | Snapshot history, changes, decisions with 7-day outcomes |
| `ceo.team`; `ceo.person` | range; personKey, range | Scorecards, EOD, checklist, open work, activity |
| `ceo.feed` | cursor, actor, app, verb, clientKey, since | Paginated ledger with grouping keys |
| `ceo.money` | month | Cash by rail and week, MRR bridge, overdue ladder, forward cash, LTV, receivables |
| `ceo.calls`; `ceo.creative`; `ceo.cs` | range | Agents and queues; creative throughput; CS cadence |
| `ceo.machine`; `ceo.dataQuality` | none | Health, adapters, uptime; issues, source clocks, alias queue |
| `ceo.alerts`; `ceo.review` | state; period | Alert list; preliminary and final packs with notes |
| `ceo.inspect` (internal) | metricId? | Every registry metric with status, trust, value and source clocks. Run with `bunx convex run` for acceptance checks; the Data page reuses it in F3. |
| Mutations | varies | `setTarget`, `ackCard`, `ackAlert`, `confirmAlias`, `confirmPerson`, `saveReviewNote` (all logged) |

### 3.14 Performance and retention

- **Kept forever:** `ceoSnapshots`, `ceoPayments`, `ceoDeals`, `ceoOutcomes`.
- **`ceoActivity`:** 400 days. After that, only the daily counts in person snapshots remain.
- **`syncRuns`:** 30 days.
- **`aiJobs`:** status and timestamps kept; prompt and result trimmed after 30 days.
- **Scans.** Where the CEO area depends on `portal.ts overview`, its full `.collect()` scans (aiJobs, agentActions, campaigns, members) become indexed reads.

## 4. Backend build phases

Effort is focused engineer-days and includes checks against prod data. Every phase ships through `scripts/ship.sh`, with the smoke check green before each deploy. When a bridge payload or child schema changes, ship CS and CR first.

### Phase 0: Stop losing history and attribution (6-9 days)

**Scope and acceptance checks**

| # | Scope | Acceptance check |
|---|---|---|
| 0.1 | **Grain.** `sync.clearGrain` and `storeGrain` rewrite by (ad account, reporting day) for every account in the current read, covering all spending campaigns (on-board, off-board, paused), not only on-board campaigns with $0.5+. Add `metaCampaignId` to `dailyStats`, resolved from `metaAdId` through `metaTree`, else a Meta ad lookup. Rows with an unresolved ad id keep the name key and are counted in a data issue. Add indexes `by_date` and `by_campaignId_date`. | A campaign whose 7-day spend fell under $0.50 still has its last 30 days after two more syncs. For one paused campaign, a stored past-day row equals the data_fb sheet row for that day after the next sync. For yesterday, total `dailyStats` spend equals the data_fb total after FX, within $1, for accounts in the read. No (date, metaAdId) pair appears twice. |
| 0.2 | **Bookings.** Add `ghlEventId` to `bookingEvents` and upsert on it. One-off removal of old duplicates by composite key (campaignName, client, date, appointmentDate, status, adId). Fetch events booked in the last 30 days whatever their appointment date. Add `metaCampaignId`. Bump `defVersion` on DEL-06, DEL-07, DEL-08 and open a data issue: "booking window changed on <date>; earlier days undercount future appointments". | No two rows share the composite key or `ghlEventId`. The booking that appeared 26 times is one row. For one DFY client, a GHL event with `dateAdded` in the last 7 days and a future `startTime` appears in `bookingEvents`. |
| 0.3 | **Wrong sync row.** `cockpit.ts buildSnapshot` and `chat.ts activity` filter `syncRuns` by role. | The media buyer cockpit's last-sync time equals the newest `syncRuns` row with an empty role. |
| 0.4 | **Booking rate unit bug.** `diagnose` compares the percent value against the booking_rate target. | Unit test: a fixture at 20% fires "Lead to booking" with evidence "20%"; 30% does not. |
| 0.5 | **Provisional cap.** `csmProfiles.ts provisionalFor` counts before slicing to 25. | Unit test with 30 Not Confirmed events returns 30. Any prod client above 25 shows its true count. |
| 0.6 | **Untracked jobs.** Run `runFanout`, `feedCsm`, `feedCreative`, `feedComms`, `pushMembers` through `health.runJob`. Fix the overnight `staleJobs` false alarm. Add `note("whapi")` in `outboxDrains.ts sendWhatsapp`. | `cronRuns` has rows for all five after one sync. On the dev deployment, a forced creative bridge failure raises an alert after 3 runs. No "jobs" alert fires between 22:00 and 06:00 over two nights. A `whapi` row exists in `sourceHealth` after a dev send. |
| 0.7 | **ClickUp pagination.** Paginate `fanout.ts gatherClients` and `gatherCreative`. Map `date_done`, `date_closed` and creator. | Unit test with a two-page mock returns both pages. CR `creativeTasks` count equals ClickUp's all-page count for list 901818016338. The 30 complete tasks have non-null `doneAt`. |
| 0.8 | **Hermes pickup time.** Add `aiJobs.firstClaimedAt`. | On dev, a job reclaimed after the TTL keeps its first claim time. New prod jobs have it set. |
| 0.9 | **People directory.** Call `sync.storeMembers`. | `clickupMembers` has more than 0 rows. |
| 0.10 | **Attribution** on MB, CS and CR writes, as listed in 3.6. CS and CR ship first. | The media buyer seat toggles an ad set: `manualChanges` and `campaignChat` carry that person's email. A CS touchpoint carries the CSM's email on `decisions` and the outbox row. A CR touchpoint carries `doneBy`. |
| 0.11 | **EOD keys.** MB and CS: role + day + email. CR: day + email. MB saves and reads under the same working day. | In CS and in CR, two different people file an EOD on the same day and both rows exist. An MB EOD saved at 01:00 shows on screen and can be retried. |
| 0.12 | **`churnEvents` investigation.** Deliverable: the root cause written down, plus either a fix or an open data issue naming the cause. | If fixed: the next roster status flip writes a `churnEvents` row. If not: the data issue exists with its cause. |
| 0.13 | **Hermes context.** `hermes.ts contextFor` sends the real verdict and findings fields. | A Hermes chat job about a campaign carries its verdict and findings in the context. |

**Unlocks:** history worth keeping, and a named person on every new action from this day on.

### Phase 1: Foundations and every NOW metric (8-10 days)

**Scope, in order**

1. **Tables and role.** Add `ceoTargets`, `ceoAliases`, `ceoPeople`, `ceoSnapshots`, `ceoDataIssues`, `ceoCards`, `ceoCursors`, `ceoClientBilling`, `ceoLeases`. Add the `ceo` role and `gate.ts requireCeo`. Add a seed mutation for the 3.3 targets.
2. **Spines.** `keys.ts` builds the client spine from every Clients - Mahara task plus Client Data (col C task id, col D location, col K Meta account, col I sheet). The person spine comes from `members`, the STATIC map and `clickupMembers`. The unmatched review queue opens.
3. **Child facts.** Add `ceoFacts` to CS and CR `ingest.ts runBridge` and deploy the children.
4. **Metrics.** `registry.ts` and `formulas.ts` for every NOW metric in DEL, OUT, CS, CR (through `ceoFacts`), plus MON-06, MON-07, TEAM-06, TEAM-11, TEAM-13, TEAM-17, TEAM-18 and SYS. The billing adapter (3.7 A) turns on MON-05, MON-08 to MON-10 and MON-17.
5. **Paying rule.** If decision 4 is made, apply its paying rule in CS `csmSync.ts payingState` (child first). If not, OUT-01 and OUT-02 carry "definition pending".
6. **Compute.** `capture.ts` hooked to the end of `runFanout`. `snapshot.ts` with `ceo.live`, `closeDay`, `restate`. `trust.ts`: `dataAsOf` and `slaMin` on `sourceHealth`, the seeded `ceoDataIssues`, and `timezone_name` on the ad account read.
7. **Cards, queries, checks.** First cards: pause client, waste, account blocked, machine. Queries: `ceo.overview`, `ceo.metric`, `ceo.breakdown`, `ceo.machine`, `ceo.inspect`. The registry check step in `scripts/ship.sh`.

**Unlocks:** revenue-at-risk and waste cards on day one, plus history for every existing number.

**Acceptance checks**
- **Client spine.** Every Clients - Mahara task (64 in CR) is in the spine. Every Client Data row and every CS row (49) maps to a spine key or sits in the unmatched queue with a reason.
- **Alias coverage.** `ceo.inspect` reports alias coverage per system for Active clients (ghl_location, meta_account, stat_sheet). The missing counts equal `gaps.ts` counts read at the same moment.
- **Campaigns.** Every `campaigns` row (14) and `offBoardCampaigns` row (8) maps to a client or sits in the unmatched queue.
- **Spend.** Yesterday's company spend in `ceoSnapshots` equals the `dailyStats` sum for that reporting day, within $1.
- **Past due.** Past-due count equals CS `totals.pastDue` at the same moment. Each past-due client's overdue amount equals its Next Payment Amount on the ClickUp card read in the same run.
- **MRR fill.** MON-05 shows its fill rate and lists paying clients with blank MRR.
- **No money leaks.** A schema diff shows no MRR, LTV, amount, plan or method field on the MB `clients` table. A captured CS bridge payload contains none of those fields.
- **History.** After three nights, `ceo.metric` returns three closed days with verdict attrs for every campaign.
- **Staleness.** Pushing a source's `dataAsOf` past its SLA flips its metrics to stale, with a reason.
- **Child facts.** CS `churnThisMonth` read through `ceoFacts` equals the value on the CS money screen at the same time.
- **Access.** A media_buyer-only seat and a plain admin seat both get an access error from `ceo.overview`.
- **Registry check.** The ship fails when a registry metric has no owner, and when a Hermes context function reads a `ceo*` table (test fixtures).

### Phase 2: Activity ledger and live feed (5-6 days)

**Scope**
- `ceoActivity`, `ceoWorkItems` and `logActivity` in the 3.6 mutations
- CS and CR `ceoActivitySince` (children first)
- Importers for `adChanges`, `clientComments`, `agentActions`, `aiJobs`
- ClickUp field and status diffs, with the `correlated` billing agent rule
- Import of existing rows as `role_only`
- Queries: `ceo.feed`, `ceo.team`, `ceo.person`
- MON-16

**Unlocks:** what each person did today, and the full media buyer change history.

**Acceptance checks**
- **Live feed.** A budget change in the media buyer cockpit appears in `ceo.feed` within 60 seconds, `signed_in`, with before and after amounts. A CS touchpoint by a named CSM appears `signed_in` within 2 minutes.
- **Meta changes.** A Meta change made in Ads Manager appears with the Meta actor name after the next sync, provided the `ad_account_activities` read for that account contains it (checked at test time, because of the 400-row cap). The row is still there 8 days later.
- **ClickUp changes.** A Client Status change made directly in ClickUp appears as `field.change` within one fanout.
- **Billing agent.** An LTV change made by the billing agent, alongside a BILLING_ comment on the same card, is credited to billing_agent as `correlated`, not to Aziz.
- **Idempotent.** Running every importer twice leaves row counts unchanged.
- **Complete import.** Imported row counts equal the counts of `agentActions`, `campaignChat`, MB `decisions` and CS `decisions` read at import time.

### Phase 3: Money (4-6 days; needs decisions 1, 4 and 5)

**Scope**
- B2B probe and pulls into `ceoPayments` and `ceoDeals`
- Payments tab adapter with Baseline flag
- Churn Tracker reads
- Metrics: MON-01 to MON-04, MON-11 to MON-15, MON-18, MON-19 (ported `computePay`)
- `ceo.money`, with money stripped for non-CEO callers
- Whop and deals backfill

**Unlocks:** cash against goal, overdue dollars, the MRR book, LTV and failed charges.

**Acceptance checks**
- **Probes.** B2B and Payments tab probes pass, or the fallback credential is in place.
- **Whop totals.** All-time paid Whop net in `ceoPayments` is within $1 of the `whop_payments` sum read at the same time. August 2026 Whop net is $22,333.01.
- **No Baseline cash.** September cash does not change when the 17 Baseline rows are flagged on or off. Every month's cash equals Whop net plus non-Baseline Payments rows.
- **August total.** Once the decision 4 owner has entered the August off-Whop rows ($11,000, $500, $1,333), August cash is $35,166.01.
- **LTV.** The ClickUp LTV mirror total and the Payments tab Baseline total ($55,499 across 17 clients) are both reported, with any difference listed by client.
- **Past due.** The past-due clients show amounts from f071ee8f.
- **Failed charges.** MON-14 shows its count next to the B2B app figure, with the read date.
- **Access.** An admin-only seat cannot read `ceo.money`.
- **Denylist test.** No token, card field, bank detail or clear-text payer email appears in any `ceo` table.

### Phase 4: Client outcomes, risk and portal columns (6-8 days)

**Scope**
- Stat sheet month tab and Dashboard tab backfill; revenue by header; per-client currency
- Appointments BO:BS probe and adapter; MD CRM tab probe
- TRI booking backfill and pipeline position, under a lease
- `clientKey` on `campaigns`, `dailyStats`, `bookingEvents`, replacing the name joins
- The shared diagnose function (OUT-22), used by CS, report docs and CEO (children first)
- Metrics: OUT-04, OUT-05, OUT-10, OUT-12, OUT-13, OUT-16, OUT-18 to OUT-20, DEL-16, DEL-17, DEL-31, POR-01 to POR-03, POR-09, SYS-18
- `ceo.funnel` in period mode
- Save-client, guarantee and show-rate cards

**Unlocks:** which client to save and why, guarantee exposure, client ROI and cancellation rate.

**Acceptance checks**
- **Sheet totals.** For 3 sampled clients, one month's booked, shows and closes computed from a stat sheet read captured in the test run equal that sheet's Dashboard tab values read in the same run. Any difference is explained by the two booked definitions, and both are shown.
- **Revenue column.** Found by header on every sheet. Sheets without the header are listed as a data issue. One client's revenue sum equals its Dashboard Revenue in the same captured read.
- **Currency.** No revenue total mixes clients with unconfirmed currency.
- **Risk score.** Recomputing each client's score from stored inputs equals the stored score. Every red-tier client has at least one evidence line. The nothing_live signal fires only for clients with a confirmed meta_account alias.
- **Backtest.** A report lists each client lost since 2026-09-09 with its daily score over its last 14 days, and the weights used are logged. Aziz's review of the red tier is recorded as a separate sign-off.
- **One diagnose rule.** The shared function returns the same constraint list as the old `reportDocs.ts constraintsFor` for all 49 profiles, and as `csmDiagnosis.ts` on the same inputs.
- **Probes.** The Appointments probe reads col BR. The Dashboard tab probe reads Cancelled.
- **Older launches.** DEL-17 is non-null for clients launched before August that have TRI appointments.
- **Lease.** After an overnight TRI backfill, no `bookingEvents` composite key is duplicated, and a sync that started during a leased step left no duplicate rows.
- **Campaign keys.** No `metaCampaignId` maps to two `clientKey` values.

### Phase 5: Call centre (7-9 days; needs decision 6)

**Scope**
- Copy the dialer reference source
- DIAL reporting store and console store probes
- MQ keys and adapter; `ceoCallDaily`
- Agent-to-person mapping from the decision 6 roster
- Metrics: CALL-01 to CALL-16 and CALL-21 to CALL-31, where their probes pass
- Call stages of the funnel; cohort mode
- Uncalled-lead card; call backfill

**Unlocks:** the missing middle of the funnel, and agent accountability.

**Acceptance checks**
- **Probes.** The reporting store tables are listed. `mahara_reporting_sync` job status is read, and the DIAL SLA is set from the measured cadence.
- **Against the dialer.** Yesterday's dials and connect rate per named CSR are within 2% of the dialer admin reporting screen, read by a dialer admin at the same time.
- **Against Maqsam.** MQ outbound count for the same day is within 5% of DIAL, or an import-coverage data issue opens.
- **Setters excluded.** No setter account from the decision 6 roster appears in `ceoCallDaily`.
- **Speed to lead.** Shows sample size, and shows values over 60 minutes on days when waits exceeded an hour.
- **Attribution.** CALL-12 is reported against the sheet's 47%.
- **Freshness.** A test dial appears in MQ-based counts within 15 minutes, and in DIAL counts after the next dialer reporting sync.
- **Cohort funnel.** No cohort conversion is above 100%.
- **Failed console probe.** If the console store probe fails, CALL-07, CALL-10, CALL-11 and CALL-13 tiles read "not connected" with the reason, never 0.

### Phase 6: Creative, team scorecards, EOD, Hermes and health history (5-6 days)

**Scope**
- CR-06, CR-07, CR-09 to CR-12, CR-23, CR-25, CR-26
- EOD adapter: TEAM-04, TEAM-05, CALL-18
- TEAM-08 to TEAM-10, TEAM-12, TEAM-14, TEAM-19, TEAM-20, TEAM-22
- `ceoHealthEvents` (SYS-11); SYS-08 through child bridge reads
- Team cards

**Unlocks:** throughput, turnaround, capacity against targets, and EOD accountability.

**Acceptance checks**
- **Turnaround.** Non-null for the 30 complete `creativeTasks`. A video job moved to live in ClickUp shows as a completion after the next fanout.
- **EOD compliance, last 14 days.**
  - 3 spot-checked non-CSM people match their EODWB rows.
  - Each CSM matches CS `eodReports`.
  - A unit test proves a CSM is never marked missed because EODWB lacks the row.
- **On-time boundary.** A filing at 23:00 counts as late. A filing at 01:00 counts for the previous working day and is late.
- **Health events.** A forced source failure writes exactly one fail event and one recover event, with the right time to recover.
- **Hermes latency.** 7-day median and p90 of `doneAt - createdAt` are within 10% of a hand calculation from `aiJobs` on the same rows.
- **Outbox backlog.** Per-cockpit counts equal the counts returned by the child bridge reads at the same time.

### Phase 7: Alerts, reviews, gate unification, API hardening (4-5 days)

**Scope**
- `ceo.alerts` with Slack DM; remaining decision cards
- `closeWeek` (preliminary and final), `closeMonth`, `ceoReviews`, `ceo.review`
- 3.10 reconciliations
- Query payload limits; indexed rewrites of `portal.ts overview` scans
- Gate unification (3.2), after decision 3, children first

**Acceptance checks**
- **Alerts.** A forced breach raises one alert and one DM, does not repeat over 3 compute runs, and clears once fixed.
- **Weekly packs.** The Friday preliminary pack does not change when live metrics are recomputed. The Sunday final pack lists every value that moved since Friday.
- **Speed.** `ceo.overview` returns in under 1 second.
- **Gate unification.** With `ceoTargets` set to today's code constants:
  - the MB verdict distribution across campaigns is identical before and after the switch;
  - CS diagnosis output is identical for all profiles;
  - the CSM pay calculation is unchanged.

  A single target change then reaches CS and CR within one push.

### Phase 8: Sales, backfill completion, retention, portal export (4-6 days, plus blocked items; needs decision 8)

**Scope**
- SAL-01 to SAL-17 behind a sales flag
- Remaining ad grain backfill
- `ceo.prune`
- The Mahara OS export for POR-04 to POR-08 and POR-10, only once the portal source is in git

**Acceptance checks**
- **SAL-01.** August 2026 Mahara spend from the Meta read equals B2B `meta_ad_snapshots` ($6,091.81) within 1%. Both use Los Angeles days.
- **Deals.** August 2026 shows 10 deals, $61,000 contracted and a $605 CAC. September 1-13 shows 2 deals and $12,000.
- **Separation.** The client `campaigns` table still has 0 internal rows.
- **Backfill.** Backfilled spend for 2026-09-01 to 09-13 is within 1% of live `dailyStats`. No (date, metaAdId) duplicate exists after the backfill.
- **Weekly CPL** equals total spend / total leads.
- **Prune** leaves exactly 30 days of `syncRuns`.

**Totals.** Backend is about 49-65 engineer-days.
- Phases 3, 4 and 5 can run in parallel after Phase 2, once their decisions are made. Phase 5 depends on the decision 6 roster, not on B2B access.
- Frontend work starts once Phases 0 to 4 pass acceptance.
- Tiles are driven by the registry, so later phases light up tiles without screen changes.

## 5. Frontend plan (built after the backend)

### 5.1 Principles and layout

- **Location.** `/ceo` routes live in the existing portal app and reuse its charts, dark mode, layout and sync strip. Visible to the `ceo` role only.
- **Routes:**
  - Main: `/ceo` (Today), `/ceo/money`, `/ceo/funnel`, `/ceo/clients`, `/ceo/clients/:clientKey`, `/ceo/team`, `/ceo/team/:personKey`
  - Departments: `/ceo/media`, `/ceo/calls`, `/ceo/cs`, `/ceo/creative`, `/ceo/sales`
  - Detail and tools: `/ceo/campaigns/:id`, `/ceo/metrics/:id`, `/ceo/feed`, `/ceo/alerts`, `/ceo/review/:period`, `/ceo/data`
- **Every number uses one `MetricTile`.** The tile shows value, target band, delta, 30-day sparkline, and a `TrustChip`; it cannot render without the chip. Clicking opens a drawer with definition, formula, changelog, sources and clocks, day basis, open issues, history, and breakdowns by client and person.
- **Unknown is never zero.** A missing number shows "no data" with the reason. A tile whose source is not built yet shows "not connected" and the phase that turns it on.
- **Shareable views.** Range and filters live in the URL.
- **Phone.** Today works at phone width.

### 5.2 Today (the one screen)

```
[Trust bar: data as of 10:40 | 1 source stale | 3 metrics low trust | Hermes ok]      [Alerts 4]
MONEY     Cash MTD vs pace | Overdue $ and clients | MRR book | Churn MTD
DELIVERY  Spend yday | Leads yday | CPL 7d vs gate | Bookings yday | CPB 7d vs gate | Wasted spend
CALLS     Speed to lead | Uncalled 24h+ | Dials per agent vs target | Connect rate   ("not connected, Phase 5" until live)
FUNNEL    spend > leads > called > connected > booked > showed > quoted > closed > client revenue (leak marked)
DECISIONS WAITING (ranked cards, each with evidence, owner and a link)  | LIVE FEED (last 20)
CLIENTS AT RISK (top 5, with reasons)                                  | TEAM TODAY (EOD, actions, overdue)
MACHINE   Sync age | Sources failing | Jobs late | Hermes queue | Smoke
```

On a phone, rows stack into one column.

### 5.3 Drill-downs

**Main path:** company, then group screen, then person or client, then campaign, then ad set or ad (the existing `stats.ts` range view).

**Second path:** a funnel stage, then clients ranked by gap to target, then the person who owns that stage for that client.

| Screen | Content |
|---|---|
| Money | MRR bridge; cash by rail and week against goal; overdue ladder (day 1-2, day 3+, pause); forward 90-day cash; LTV table; failed charges; receivables; data issues for plan mismatches |
| Funnel | Company and client toggle; period and cohort toggle; client x stage heat map; time between stages; filters for service, country and DFY/DWY |
| Clients | One row per client: stage, months live, DFY/DWY, MRR, next payment, spend, leads, CPL, called within 24h %, bookings, CPB, show %, close %, cancellation %, guarantee pace, last contact, DEFCON, last report, portal activity, risk. Sorted by risk; filtered by population, CSM and tier. CRM-only and Meta-only clients are marked. |
| Client page | Header (stage, CSM, DFY or DWY, MRR, days live, risk and reasons); funnel strip with the diagnose constraint; 90-day trends; guarantee bar; campaigns; performance by ad (OUT-23); call centre; CS timeline; creative work; portal outcomes and feedback text; data gaps; the feed filtered to this client |
| Team and person | One card per role; person scorecard against targets; 14-day strip (EOD, checklist, key number); open and overdue work; decisions with 7-day outcomes; the person's feed; capacity panel |
| Media buying | Portfolio trend; verdict mix over time; wasted spend; blocked accounts; launches and checklist progress; rules overridden; the media buyer lens of the feed |
| Call centre | Agent table; queue; speed-to-lead distribution; attempts; outcomes by client; Watch Shift claims; attribution trust |
| Client success | Due today, silent clients, reports, check-ins, commitments, DEFCON, hot list |
| Creative | Queues, editor workload, turnaround, time in review, refresh cadence, fatigue with nothing queued, playbook |
| Sales | Hidden unless decision 8 says sales are running |
| Data | `ceo.inspect` registry view with trust, `ceoDataIssues` with owners, source clocks, alias review queue |

### 5.4 Live change feed

- **Full-screen and live.** Reactive, paginated, grouped by hour. Filters: person, app, verb, client.
- **Presets:**
  - "Media buyer today": decisions, toggles, budgets, cities, board status, builds, cockpit ad actions, every Meta change by actor, Hermes Meta calls, with before and after values
  - "Client changes in ClickUp"
  - "Money events"
  - "Hermes actions"
- **Badges on every row.** Attribution (signed in, Meta user, correlated automation, role only, unknown) and source (cockpit, Ads Manager, ClickUp, Hermes, billing agent). Nothing is silently credited to anyone.
- **Collapsing.** Repeated changes by one actor on one subject within 30 minutes collapse into one line.
- **"Since I last looked" marker**, stored per viewer on the server.
- **Highlighted rows:**
  - budget steps over +25%
  - campaign or ad set toggles; new launches
  - board status set to Dead Campaign or Lost Client
  - Hermes POST or DELETE calls
  - Meta changes by an actor not on the team
  - client stage changes; Next Payment Date moves

### 5.5 Alerts

- **Inbox** sorted by severity, with acknowledge and snooze. Each alert links to its entity and the rule that fired it.
- **Firing rule.** Rules come from the registry and fire only after 2 consecutive computes.
- **Immediate Slack DM** for:
  - pause required; account blocked
  - $50+ spend with no leads
  - leads uncalled after 24h (from Phase 5)
  - an active client with no booking in 21 days
  - sync, source or Hermes outage
- **Daily digest** at 09:00 Kuwait for everything else.
- **Quiet hours.** No DMs from 23:00 to 08:00, except machine outages (proposed, decision 3).

### 5.6 Weekly review mode and monthly close

**Weekly review.** Saturday opens the preliminary pack. The final pack follows on Sunday, with every value that moved listed at the top. It runs as a guided agenda:
1. Scoreboard against targets and last week
2. Biggest movers
3. Clients saved, lost and newly at risk
4. Funnel leak by stage and client (diagnose constraints)
5. Role scorecards and capacity
6. Decisions, their 7-day outcomes, and rules overridden
7. Launches and creative
8. Data issues opened and closed
9. Notes and commitments with owner and due date

Next week's pack opens with last week's commitments and whether their metrics moved. The pack prints to PDF.

**Monthly close.** Adds cash against target, the MRR bridge, named churn with reasons, LTV, unit economics (with empty margin and payback tiles until a cost source exists), and setting next month's `ceoTargets` with an effective date.

### 5.7 Frontend phases

- **F1 (5-7 days):** Today, decision cards, metric drawer, Clients table and client page, feed.
- **F2 (5-7 days):** Money, Funnel, Media buying, Call centre, Team and person pages.
- **F3 (4-5 days):** Client success, Creative, Sales, Data page, alerts inbox, weekly and monthly review, phone polish.

## 6. Decisions needed from Aziz

1. **Who is the CEO user, and who can see money?**
   - **Blocks:** the Phase 1 gate and Phase 3.
   - **Default:**
     - The `ceo` role goes on Aziz's two addresses only.
     - Admin alone sees machine health and team activity.
     - List everyone with MB prod Convex dashboard access or a deploy key, and remove anyone who should not see money, because table access bypasses the gate.
     - The private wind-down cash model, Month in Review and September Plan docs stay out of v1.
2. **Which clients count, and are they DFY or DWY?**
   - **Blocks:** spine counts, funnel, call metrics, guarantee.
   - **Default:**
     - CEO lists count every Clients - Mahara task except the playing account. "SALES TEAM TO CONTACT" rows appear only under a pre-sale filter.
     - DFY/DWY comes from Client Data col R.
     - The CSM fills the 20 blank Service Mode values and resolves MOFAG in week 1. Until then blank means unknown, excluded from funnel and call metrics and listed.
3. **Official gates, formulas and definitions.**
   - **Blocks:** stored verdicts (kill at 1.5x gate), DEL-05, DEL-10, risk points, the CPL and CPB status bands written back to ClickUp, and after Phase 7 the team cockpits' recommendations. It does not block data collection.
   - **Default gates:** CPL $15; cost per booking $80; booking rate 25%; conversation 90 seconds; speed to lead median, target 5 minutes; 150 dials per agent a day; 4 attempts over 3 days.
   - **Default formulas:** for client stat sheets (OUT-07, OUT-08), show rate = shows / (shows + no-shows), shown with coverage; close rate = closes / shows. Mahara's own funnel follows SAL-03 and SAL-06 instead, as the B2B dashboard's `b2b_window_metrics` computes them (settled 2026-09-16): show rate = shown / due, and close rate = signed / qualified demos.
   - **Default client closed revenue:** stat sheet "Total Customer Revenue" until portal outcomes cover a client, then portal Project Value (USD).
   - **Default bookings:** the cockpit GHL rule, with TRI Client Panel and portal counts as reconciliations.
   - **Also:** accept or change the proposed thresholds listed in 3.3.
4. **Money definitions.**
   - **Blocks:** Phase 3, MON-05, MON-09, MON-11, MON-12 and the churn figures.
   - **Paying:** launched and not Stopped, Paused or Cancelled. Pre-launch clients are not paying. This also changes the CSM retention bonus base.
   - **MRR:** the ClickUp MRR field, with plans converted as:
     - Monthly = MRR
     - Paid in full = contract value / 3
     - Split Pay (2x) = total / 3
     - "1.0K Start / $2K Months After" = the amount due that month
     - Performance ($3k/$3k) = fixed part only

     MRR vs New MRR and Payment Plan vs closer note mismatches show as data issues for the CSM to fix.
   - **Cash:** Whop net plus non-Baseline Payments tab rows. Name one owner who logs every Tap, bank and check payment in the Payments tab within 2 working days.
   - **Churn:** target 10%; a pause becomes churn at 14 days; term completions at day 90+ are excluded from churn and tracked as "term complete", per the Churn Type rule.
5. **May B2B data be copied into the portal deployment?**
   - **Blocks:** Phases 3 and 8, and the B2B EOD source.
   - **The question.** Whop payments, deals, sales funnel, rep, EOD, expense and transfer data would sit in MB, where anyone with dashboard access can read it.
   - **Default:** yes for payments, deals, sales funnel and EOD; no for expenses and transfers until the decision 1 access list is confirmed. Engineering runs the access probe. If it is denied, the B2B project owner issues a read-only credential.
6. **Call centre roster and where agents dial.**
   - **Blocks:** Phase 5.
   - **Default:**
     - Aziz confirms which Maqsam accounts are client call centre agents (Lama, Daniya; is Oways one?), which are setters, and whether a call centre lead exists.
     - Confirm whether agents dial only through dialer.maharamedia.com.
     - Source: DIAL primary, plus read-only Maqsam keys on MB for the completeness check.
     - Engineering asks the dialer maintainer to allow read-only access to the dialer stores.
7. **Named attribution.**
   - **Blocks:** Phase 0 attribution and every per-person metric.
   - **Default:**
     - Store the signed-in person on every cockpit action from now on, and tell the team the purpose before release.
     - No guessing for past rows.
     - An "active day" is any day with a signed-in action.
8. **Roster and sales status.**
   - **Blocks:** scorecards, capacity lines, Phase 8.
   - **Default:** Aziz confirms one list in week 1: CSM of record, active editors, remaining closers and setters.
   - **Sales status.** `closed_deals` shows 2 deals in September and Meta spend continued ($2,154, Sep 1-13), so say whether sales are paused or running before Phase 8. Sales screens stay hidden if paused.
9. **Client success process fields.**
   - **Blocks:** CS-04, CS-07, CS-20, TEAM-04 for CSMs, and the call signals in the risk score.
   - **Default:**
     - CSMs keep Last Call filled through the cockpit call action.
     - The weekly Thursday report is a separate obligation, logged as a cockpit report action with its ISO week, instead of relying on the #csm-general post.
     - Port the CSM EOD export (EODWB and #eods-csms) into MB outbox drains.
     - Do not port the other Viktor bridge features (CS `kpi`, `appointments`, `nextCallAt`, `reportNudge`) in v1.
10. **Mahara OS export.**
    - **Blocks:** POR-04 to POR-08 and POR-10 only.
    - **Default:** use the DB Appointments portal columns now. Build a signed read-only export and a durable login log after the portal source is moved into git.

## 7. Risks and unknowns

| Risk | Impact | Mitigation |
|---|---|---|
| Access is unverified: B2B project, dialer reporting and console stores, Maqsam keys, and sheet tabs (Payments, Appointments, Dashboard tabs, MD CRM and platform tabs, Churn Tracker, CCD, EODWB, Video tracker, EOD Radar), Slack history, most Typeforms | Money, call, EOD and portal phases slip | Every adapter starts with a probe; statuses say NEW (probe); fall back to read-only keys or Maqsam |
| CEO money tables sit in MB, readable through the Convex dashboard, CLI and deploy keys | Finance reaches people it should not | Decision 1 access review; hashed payer emails; no card or bank data; ship check stopping Hermes context from reading `ceo*` tables |
| The Supabase management API used as a 15-minute production poller | Rate limits or revoked access break money and call pulls | One query per table per pull, backoff, freshness flags, fallback to read-only database credentials |
| Thin fields: Last POC 18 of 49; Last Call 0 of 49; Next POC 12 of 49; Showed? 32%; Closed? 14%; MRR about 22 of 54; Service Mode blank on 20; ad leads matched for 14 of 49 | Early screens look empty or misleading | Trust chips with coverage; fill-rate metrics (SYS-14); data issues with owners; decisions 2 and 9 |
| Short history: no ClickUp field history, churn exact only from 2026-09-09, grain from 2026-08-13, portal sessions deleted, no video completion times | No month-over-month MRR, churn or turnaround before snapshots mature | Snapshots from Phase 1; history start dates labelled; exact churn from 1 October |
| Fragile upstream code: dialer source is iCloud dataless with only a temporary `/private/tmp` copy; Mahara OS has no git or CI; billing agent runs off-repo on the Hermes VPS in dry run | Adapters or ported formulas break without warning | Copy the dialer reference source first; read stores and sheets only; freshness flips to none on failure; ask for repos before building exports |
| Ported dialer formulas drift from the dialer's own screens | Two call numbers disagree | Daily reconciliation against the dialer admin screen and Maqsam; the formula file cites its source |
| Conflicting definitions and targets across docs, sheets, dialer and three cockpits | Two answers to one question erode trust | One `ceoTargets` table pushed to all cockpits (Phase 7); one shared diagnose function (Phase 4); provenance on every definition card |
| Name-based joins; billing agent posting as Aziz; ClickUp field edits have no actor | Wrong client or person credited | Alias table with methods and review queue; trust downgrades; `correlated` rule for the billing agent; `none` otherwise |
| Attribution starts only at Phase 0, and the media buyer and CS seats are shared | Past actions stay role-only | Label `role_only`; never guess |
| Snap, TikTok and Google feeds dead; some clients have no Meta access | Spend and funnel undercount for those clients | "Meta only" and "CRM-only" labels; DEL-26, DEL-31, SYS-17 |
| Client revenue sheets show $ for every currency; GHL monetary values are not USD | Wrong ROI and revenue totals | Per-client currency from dialer GHL locations or Country; no cross-client totals in unconfirmed currency |
| Dialer is new (v0.6.4, one stuck attempt, unmeasured import coverage); sheet attribution about 47% | Wrong call numbers | 7-day reconciliation with Maqsam and the admin screen |
| Sensitive data next to needed data: GHL tokens (Client Data col E, card field), lead phones in `clientProfiles.lost.leads`, bank details in docs | A leak into new tables | Field allowlists, denylist test, `ceo` gate, finance reads logged |
| Team sees named tracking as surveillance | Pushback or gaming | Explain the purpose first; score outcomes, not keystrokes |
| Convex read limits: unpruned `aiJobs`, `alerts`, `usage`, `campaignChat`; full scans in `portal.overview`; `take(30000)` in `stats.ts` | Slow or failing queries | Indexed snapshot reads; Phase 7 rewrites; Phase 8 pruning |
| Day basis and restatements: account timezones differ (UTC+3, UTC+4, Los Angeles); Meta and sheets restate for days | Off-by-one-day totals; weekly packs move | Account-day labels; rows final at D+3; preliminary and final weekly packs |
| Backfill and overnight sync writing the same tables | Duplicate or deleted grain | `ceoLeases`; acceptance checks for duplicates after backfills |
| Read caps and currency: data_fb to row 11005, Client Data to 200 rows, static FX, winners and playbook not in USD | Silent truncation or currency errors | Read-cap and FX checks in `ceo.quality` |
| Unclear business facts: sales "stopped" vs September deals; $5,000 vs $6,000 for 90 days; Make 8842754 both active and inactive; CSM base pay $1,200 vs $1,500 | Wrong growth, pay or call assumptions | Decisions 4 and 8; data issues; do not rely on these until confirmed |
| No source for payroll, headcount, per-client cost, Hubstaff, Tap, founder deep work tracker | Margin, payback, revenue per person, deep work stay empty | MON-20 to MON-24, TEAM-16 and TEAM-24 stay NEW until a source exists |
