# Where every number on the CEO cockpit comes from

One line per number: what it is, where it is read from, what it leaves out. Rewritten 2026-10-11 for what runs after Convex was retired (the cutover of 2026-10-07): every "where it comes from" below names the CEO worker in `hermes/ceo-refresh/native` or the Edge Function `supabase/functions/cockpit-ceo-api`. The CEO asked for this page (2026-09-21): "Gather all the sources of truth … How are we getting them exactly?", then "Make it a bit more simple for me". The "Changed on" sections at the end are dated history; they name files as they were then.

## The short version

- **Your own marketing and sales**: the B2B database (GoHighLevel, Meta, Maqsam, Whop, the closer's form), project `flwboeijllbtrufxkhts`, read only.
- **Your clients' delivery**: Creative Triage (`bldgtotkfmhoxmlzowdx`): the clients' Meta spend and leads (`cockpit_media_daily_stats`), their GoHighLevel appointments, the call centre's report, Mahara OS outcomes.
- **Who a client is and what they pay on paper**: the ClickUp cards (Clients – Mahara), mirrored into Creative Triage.
- **Money that actually arrived**: Whop, Tap, the CBK statements you upload, and payments logged by hand.
- **The team**: the roster (`cockpit_people`), the EOD forms, Hubstaff and Timetastic.
- A number the source cannot give is shown as n/a and says why. Missing is never zero.

## What runs now

- **The CEO worker** (`hermes/ceo-refresh`, on the VPS) computes the 14 sections (money, expenses, growth, webinar, b2bAds, delivery, calls, clients, team, hiring, portal, assets, organic, machine) every 15 minutes, at :00, :15, :30 and :45, under one lock. It reads with read-only SQL through the Supabase management API, one adapter per section in `native/adapters/<section>.js`, and publishes through `cockpit_ceo_refresh_publish`. A section is published only when every source it read is ok; a section that fails keeps its last good numbers and the screen says when they were computed. The definitions of the stored metrics are `native/metrics.ts`.
- **The publish** writes, in one transaction in Creative Triage: `cockpit_sections` (each section's whole payload), `cockpit_metric_definitions` (label, definition, source, what it leaves out, unit), `cockpit_metric_values` (one row per metric, scope, window and day), `cockpit_metric_days` (one point per metric, scope and Kuwait day) and `cockpit_client_payments` (every payment tied to a client card). Join values to definitions on `metric`; a null value means not measurable that day.
- **The CEO API** (`supabase/functions/cockpit-ceo-api`, an Edge Function that only the CEO's session can call): the "Refresh now" button for Money and Expenses (`finance/`), the statement upload (`bank.ts`, PDF read with unpdf), the payer mapping, custom date ranges (`windows.ts`) and Meta reach and frequency (`frequency.ts`).
- **Every change the CEO makes** goes through `cockpit_ceo_action` or a named `cockpit_ceo_*` function, gated on his own session, and leaves a `cockpit_audit_log` row.
- **Jobs inside Supabase** (Edge Functions on pg_cron, each with a row in `cockpit_sync_state`): `tap-charges-sync` (every 15 minutes), `billing-sync`, `onboarding-sync`, `ceo-extensions-sync` (hourly at :47), `cockpit-hours-sync` (hourly at :17, nightly at 02:40, and the morning note at 09:05), `hiring-sync`, `sales-mirror`, `webinar-events`, `comment-watch`, `tracking-audit`.
- Days are Kuwait days.

**Timeframes.** Every tab with a number that has a time dimension carries one timeframe bar (7 days, 30 days, this month, last month, 90 days, 6 months, 12 months, everything, or two dates) and rebuilds its windowed numbers from the section's daily series: each count is a sum of days and each rate a quotient of sums. Since 2026-10-11 that includes Client success, Today, Management (the EOD counts) and Recruiting, as well as Frontend, Marketing, Sales, Delivery, Calls and Money. Status lines are rules, not windows, and keep their wording: "silent over 7 days", "due in 7 days", a portal session's expiry. Team & payroll keeps its month picker because pay is monthly.

## The places numbers come from

1. **B2B GoHighLevel, through the B2B Supabase database** (`flwboeijllbtrufxkhts`). Mahara's own funnel: contacts and their tags become `leads`, calendar appointments become `calls`, the closer's Typeform becomes `closed_deals`. Synced every 15 minutes.
2. **Meta Ads, through the same B2B database** (`meta_ad_snapshots`): spend, impressions, clicks and link clicks per ad per day for Mahara's own account. Every CTR the cockpit shows is link CTR, link clicks divided by impressions.
3. **Maqsam, through the same B2B database** (`maqsam_calls`): the setters' phone calls.
4. **Whop and Tap**: card payments. Whop lands in the B2B database (`whop_payments`); Tap lands in Creative Triage (`cockpit_tap_charges`) through `tap-charges-sync`, with the Tap key held as a Supabase secret.
5. **Creative Triage** (`bldgtotkfmhoxmlzowdx`): the clients' side. Each client's Meta spend and leads per ad per day (`cockpit_media_daily_stats`, written by the media sync), their GoHighLevel appointments and opportunities, the call centre report (`mahara_call_center_report` and `mahara_reporting.*`), and the hand-kept roster (`cockpit_people`).
6. **ClickUp, the Clients – Mahara list**: the client cards, with the hand-typed billing fields (MRR, LTV, payment plan, paused on, churn date), mirrored by `billing-sync` into `cockpit_billing_accounts` and `cockpit_client_billing_days`.
7. **Google and Meta Graph**: Instagram and Facebook, YouTube through its Data API, and (once shared) the EOD Reports sheet.
8. **The bank**: CBK has no API, so the CBK Online CSV export or the PDF statement of each account and card is uploaded on the Money tab and parsed by the cockpit (`cockpit_statements`, `cockpit_bank_lines`). The CEO (2026-09-21): nothing makes it automatic; the upload is the way.
9. **Mahara OS**: the client portal's outcomes (`portal_data.appointment_outcomes`): attendance, deal won or lost, quotation, project value, as the client recorded them.
10. **Typeform**: the closer's New Client Form (into the B2B database), the CSM's kickoff form `tG7dnxBn` and the onboarding forms (into `cockpit_client_onboarding` by `onboarding-sync`), and the Client Extension Form `gqBcyK6g`.
11. **Hubstaff and Timetastic**: tracked time and leave, read by `cockpit-hours-sync` into `cockpit_hubstaff_days`, `cockpit_timetastic_days` and `cockpit_timetastic_bookings`.

## Voided deals

B2B does not drop a voided deal: `closed_deals` keeps the row and `record_voids` marks it (`entity = 'closed_deal'`, `record_id` = the deal's `response_id`). B2B's own functions count every row, voided or not: `b2b_window_metrics`, `b2b_rep_scorecard`, `b2b_marketing_ads`, `b2b_pacing_pipeline`, `b2b_action_queue`, `b2b_deal_cash` and `b2b_asset_performance`. The cockpit leaves voided deals out of every number, with one rule in `hermes/ceo-refresh/native/voids.js` (the Edge copy is `cockpit-ceo-api/finance/voids.ts`):

- Every direct read of `closed_deals` adds `NOT_VOIDED(alias)`.
- A number read from one of those functions has the voided deals of the same window taken off, dated and attributed the way the function does it, and every rate built on it is worked out again with the function's own formulas. Each growth window keeps B2B's own figure beside it (`voidedOut.b2b`).
- A Whop payment tied to a voided deal counts as tied to no deal.

## Growth (Frontend, Marketing, Sales tabs)

`native/adapters/growth.js`.

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **Leads** | GoHighLevel contacts tagged `roas-qualified` or `roas-unqualified`, dated by the day the contact was created. A contact with both counts as qualified. | Contacts tagged `roas-unprepared` ("not ready") and contacts with no ROAS tag are shown next to the number and never counted. |
| **Cost per lead** | Lead-gen ad spend ÷ leads. | Retargeting spend is never in it. |
| **Lead-gen ad spend** | Meta snapshots for campaigns whose name does not say `hiring`/`recruit` (excluded) or `hammer them`/`retarget`/`remarket` (retargeting). | Nothing from client accounts. |
| **Retargeting spend** | The same snapshots, the campaigns whose name says retarget, remarket or hammer them. | Shown beside, never inside, any cost per lead. |
| **Speed to lead** | For each lead, the minutes from its creation to the first Maqsam call with it by a sales rep on the roster, matched by the CRM contact or the last eight digits of the phone. The median over leads that were called. | A call by a call-centre agent never counts. Leads never called are counted beside it. WhatsApp first contact does not count. |
| **Where leads come from** | Ads when the contact carries an ad id; organic when it carries none and the source, a tag or the attribution says inbound WhatsApp, Instagram DM, YouTube, referral or organic; otherwise ads, labelled assumed. | GoHighLevel's first-touch attribution is empty on most contacts. |
| **Lead to booked call** | Leads created in the window with at least one intro or demo booked against their contact, over leads. Per lead, never per booking. | The booked-call counts beside it are dated by booking day. |
| **Intros booked, demos booked** | GoHighLevel appointments (`calls`), by the day they were booked. | — |
| **Intros shown, demos shown** | Appointments on the day they were for, once that time has passed, with status `showed`, or `confirmed`/`invalid` and past. The CEO's rule: confirmed or showed counts as shown. | An appointment nobody updated counts as shown until it is marked otherwise. |
| **Show rates** | Shown ÷ due, for intros and for demos. Due = appointments whose time has passed, cancelled and no-show included. | Cancelled and future calls are never in the numerator. |
| **Cancel rates** (three tiles on Sales since 2026-10-11) | Intro cancel rate = intros cancelled ÷ intros scheduled; demo cancel rate = demos cancelled ÷ demos scheduled; total cancel rate over both. Cancelled is the appointment status; scheduled is every call on the calendar in the window, by call day. Each tile says "n of m scheduled". | — |
| **Intros advanced, intro → demo** | A shown intro whose contact has a demo booked after the intro. | — |
| **Signed, contracted, cash collected, new MRR** | The closer's New Client Form, on the day it was submitted. `b2b_window_metrics` for the window, less its voided deals. | What the closer typed. Voided deals. |
| **Close rate** | Signed ÷ every demo shown. | A deal can be signed after the window its demo sat in, so it can pass 100%. |
| **Qualified close rate** | Signed ÷ demos qualified (demos shown minus the calls marked invalid). | — |
| **Front-end cash** | Deposit + kickoff cash. The deposit is what the closer typed on the New Client Form for deals signed in the window. The kickoff cash is the "Payment Amount" the CSM fills in at the end of the kickoff form (Typeform `tG7dnxBn`, copied by `onboarding-sync` into `cockpit_client_onboarding.forms.kickoff.payment`), dated by the day the form was sent and read as USD. The tile says "deposit $X + kickoff $Y, Z% confirmed on a rail". | Voided deals. Kickoff cash is read from 4 Oct 2026, the first response that carries the amount; before that it is "not read", never zero. The field has no currency. A kickoff is confirmed when a payment the Money section tied to the same client card arrived on Whop, Tap or a bank transfer within 3 days and 5% of the amount (`native/manualMatch.js`); an unconfirmed kickoff still counts, with the confirmed share beside it, the same as the deposit. |
| **Front-end ROAS** (the main one) | Front-end cash ÷ lead-gen spend. | — |
| **Contracted ROAS** | Contracted ÷ lead-gen spend. | Signed money, not collected money. |
| **Front-end cash per call** | Front-end cash ÷ intros booked, intros shown, demos booked, demos shown, in the same window. | Each stage is dated by its own event. |
| **Cost per demo, CAC** | Spend ÷ demos shown; spend ÷ signed. | Voided deals. |
| **Reach and frequency** | Read from Meta for the chosen timeframe (`cockpit-ceo-api/frequency.ts`), lead-gen and retargeting campaigns separately; reach is distinct people for the whole window. | Never added up from daily rows. |
| **Reps scorecard** | `b2b_rep_scorecard`, joined to `sales_reps`, less the voided deals it counts. | — |
| **Proposals** (Sales tab, since 2026-10-11) | `cockpit_sales_proposals` in Creative Triage, read with the CEO's own session: status, closer, lead, created, sent, updated; each row opens `/sales/proposal/<id>` in the sales cockpit. | Proposals are drafted by closers from a lead in the sales cockpit. |
| **Daily series** (365 days) | Spend, leads, bookings, signed deals, deposits and kickoff cash per day from the tables above. | Voided deals. |

## Frontend tab: the call funnel and the webinar funnel

Two funnels, never mixed. `hermes/ceo-refresh/native/webinarSql.js` is the one rule for what is the webinar's; the call funnel subtracts exactly that and the webinar section (`native/adapters/webinar.js`) counts exactly that.

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **What is the webinar's** | A contact tagged `webby-*`; their calls and signed deals count for the webinar from the moment they registered. Campaigns whose name says webinar, webby, training, تدريب or ويبينار. | Registration time is approximate for an older contact. |
| **Call funnel** | `b2b_window_metrics` for the window, less its voided deals and the webinar's share, every rate recomputed. | — |
| **Webinar funnel** | Per session (the `webby-mmm-yyyy` round tag): Meta spend, impressions, link clicks and link CTR; reach and frequency; registrations from HighLevel; booked, held, closes, contracted and cash by the call funnel's rules. Zoom attendance, the gift survey, reminders and objections come from `hermes/webinar-pull` into `cockpit_webinar_*`; the landing page's own events from the Edge Function `webinar-events` into `cockpit_webinar_page_events`. | Voided deals. Zoom guests carry a name only and are not tied to a registrant. Email opens and clicks are in Kit, not read. |

## Ads tab (Mahara's own account)

`native/adapters/b2bAds.js` and `native/linkCtr.js`.

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **Per ad: spend, impressions, clicks, link clicks, frequency** | Meta snapshots summed per ad for 7 and 30 days; frequency is the worst child, never summed. | — |
| **Link CTR and CPC** | Link CTR = link clicks ÷ impressions; CPC = spend ÷ link clicks. The same for ad sets, campaigns, the account and a custom range (`cockpit-ceo-api/windows.ts`). | A link-click count that is not known makes them n/a, never 0. Retargeting clicks are mostly not link clicks, so retargeting link CTR reads near 0. |
| **Per ad: leads, fit, not ready** | CRM contacts attributed to the ad, by the ROAS rule. Meta's own lead count beside it. | A contact with no attribution is not on this tab. |
| **Per ad: the funnel** | `calls` and `closed_deals` filtered to the ad. | Voided deals. |
| **Verdict** | Rules on the last 7 days for money (kill over $22.50 per lead, hold over $15, fatiguing at frequency 2.5) and the last 30 for the funnel. | — |
| **Account status, balance** | Meta Graph API on `act_746108264865897`. | — |

## Money tab

`native/adapters/money.js`; the "Refresh now" copy is `cockpit-ceo-api/finance/adapters/money.ts`.

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **Cash collected this month** | Whop payments (net of refunds, by charge day) + client payments on the uploaded bank statements + Tap charges no settlement line covers + hand-logged payments no statement line covers, each a separate rail, summed. | Tap refunds are not read. Processor fees are in none. A Tap charge and its bank settlement are one payment. A hand-logged transfer a statement line shows counts once, on the bank: within 3 days and 5% is the same money; a cheque up to 14 days after it was received. |
| **Bank statements** | The CBK Online CSV export or the PDF statement, uploaded on the Money tab, parsed by `cockpit-ceo-api/bank.ts` and saved by `cockpit_ceo_action('bankImport.commit')`: the running balance proves every row, every line gets a kind, and a line already held (same day, amount and running balance, in either format) is skipped. | Whop payouts are never cash. **Days since the newest statement is on the tab. Past 7 days it is a warning, and Money and Expenses still publish** (the CEO, A109: "warn past 7 days"); the bank rail and the expense lines stop at the newest statement's last day. Before 2026-10-11 a stale statement stopped both sections, which is why they did not refresh after 8 Oct. A statement dated after today is refused. |
| **Refunds** | Whop refunds by refund day + refunds logged by hand. | Tap refunds. |
| **Expenses on the statements** | Statement debits by month and category, with the exclusion list taken out (a card or a vendor fragment marked personal). | Excluded lines still show on the Transactions tab. The card that counts is the CBK control card (5370…4348). |
| **The cash chain of one deal** | Deposit at signing: the closer's form. Rest of the cash: the kickoff form's "Payment Amount" (see Front-end cash). Confirmation: Whop, Tap or a bank transfer. | The kickoff amount exists on the form from 4 Oct 2026. |
| **Front end, back end, the person** (every payment in) | Each Whop payment, Tap charge, bank transfer and hand-logged payment of the last 12 months is tied to a deal or a client card, then split front end (the closer's deposit, then the CSM's rest of the cash inside the 45-day window, 20 on a monthly plan) or back end. | A payment that matches nothing is "not attributed" and listed with its payer on the Transactions tab. Bank transfers carry no email, so they tie by name only. |
| **Transactions tab** | Every payment in with its verdict, every statement line with its kind (changeable by hand), refunds and bank expenses. | Capped at 1,500 lines. |
| **Projected MRR, collection rate, average retainer** | Projected MRR = the MRR field added up over active cards on a recurring plan; collection rate = cash attributed to those clients this month, every rail, over it; average retainer = the mean MRR over the same cards. Kept per month in `cockpit_metric_days` (`money.book.projected`, `money.book.collected`, dated the 1st), and the history reads those points. September 2026 was imported from the retired Convex store: projected $14,332, collected $4,068 (28.4%), equal to the Convex-era mirror `cockpit_metric_values` of 30 Sep. | Typed MRR; a month with no attributed payment reads 0%. |
| **LTV per client** (the plan the CEO chose, "Number two") | The card's baseline plus every payment tied to that card since. The baseline is the card's **earliest** `money.ltv.card` point in `cockpit_metric_days`: 24 cards from 19 Sep 2026 and two first seen on 7 Oct, imported from Convex (`scripts/import-ltv-baselines.py`, each checked against the Convex-era mirror, 26 of 26 equal); a card that appears later gets its first point the day the worker first sees it. The preview (`cockpit_ceo_action('ltv.preview')`) lists each card in onboarding or active with baseline, payments since and the target; the apply (`cockpit-media-api` `ceo.ltv.apply`) writes the ClickUp LTV field. | Paused, stopped, cancelled and internal cards. The preview is refused until finance totals are reconciled (the first good Money publish sets them) and Money was published in the last 24 hours; the card on the Money tab says so in the server's words. Money nobody tied to a client. |
| **Contracted this month** | The closer's form, plus hand-logged deals that do not match a closer-form deal. | Typed, not paid. Voided deals. |
| **Projected month** | Cash so far ÷ days so far × days in the month. | Reads low early in a day. |
| **Targets** | `monthly_targets` in the B2B database, latest month on record. The `ctr` target is scored as link CTR (`cockpit-ceo-api/finance/targets.ts`). | The latest targets on file are for August. |
| **MRR on the books** | ClickUp card fields, grouped by stage. Recurring = cards whose payment plan is not paid in full, split pay, one-off or upfront. | Typed by hand. Blank means missing, not zero. |
| **Expenses section** (`native/adapters/expenses.js`) | The month's statement lines on the CBK control card, by category, with the exclusion list; client media from `cockpit_media_daily_stats` (see Delivery); EOD filers from `eod_reports`. | Revenue is a floor, so profit stays empty. The "Refresh now" copy (`cockpit-ceo-api/finance/adapters/expenses.ts`) still reads the older hand-loaded `expenses` import in the B2B database for its expense groups; its client media figure reads `cockpit_media_daily_stats` since 2026-10-11. |

## Billing tab (and the client success cockpit's Billing page)

One sheet in both cockpits (`components/billing/BillingSheet.tsx`, rules in `src/lib/billingCore.ts`, the same files in both apps), fed by `billing-sync`.

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **Every row** | The Clients – Mahara cards in ClickUp (list 901816559981), mirrored into `cockpit_billing_accounts` by `billing-sync`, on "Read ClickUp again", and on every edit. On the books = active, paused or pipeline. | Cards on the sales list, gone cards and Mahara's own cards. |
| **Due in 7 days, Late** | The Next Payment Amount and Date on each active card. | Paused clients are never late. A card with no date is counted under "No method set". |
| **What to do** | The Billing And Invoice Reminders SOP's ladder. | A paused card with no Paused On reads "stamp one". |
| **LTV** | The LTV plan above. | Money nobody tied to a client. |
| **Money not tied to a client** | Payments of the last 12 months the Money section could not attribute, grouped by payer. Tying a payer writes `cockpit_payer_clients`. | Counts from the next refresh. |
| **Waiting for the ledger** | `cockpit_billing_inbox`: payments a success manager or Maher logged, taken into `cockpit_manual_payments` at the next refresh. | Card and Whop payments arrive on their own feed. |
| **Billing log** | `cockpit_billing_events`. | Changes typed straight into ClickUp have no log line. |

## Delivery tab (clients)

`native/adapters/delivery.js` over `native/data/triage.js`.

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **Spend, leads per client** | `cockpit_media_daily_stats` in Creative Triage (one row per ad per day, written by the media sync, spend already in USD). It has no client id, so each row is tied to a client through its campaign name in `cockpit_campaigns` (the newest row; campaigns deleted at Meta are kept for the tie), that campaign's Meta ad account, and the client whose `meta_ad_account_id` is that account (`mediaClientDaysSql`). The same read feeds Money's client media, Expenses' client media, the Client success pulse and the "Refresh now" path. The feed must be marked ready in `cockpit_media_feed_state` with as many rows as it holds. | The old `ads_daily_snapshots` stopped on 2 Oct 2026; it is read, frozen, only for days before the new table's first day (13 Aug 2026), converted at the fixed rates (KWD 3.26, AED 0.2723, SAR 0.2666, QAR 0.2747). A campaign that ties to no client is named in a note, never dropped silently. Mahara's own accounts are dropped. The feed carries the campaigns the media buyer cockpit tracks: for 1–30 Sep it reads $8,773.94 where the old table, converted, read $10,472.85 (it lacks four clients' September campaigns, among them حول العمران, Joe and Sera, plus decor and ريبالو). |
| **Bookings, three ways** | Total = provisional + online + main calendars; confirmed = online + main; provisional = the provisional calendar alone. By the day the meeting is for. Main and online come from `appointments`; **provisional comes from the call centre report's own source since 2026-10-11** (the records behind `mahara_reporting.cc_appointments`), only calendars whose name says not confirmed, provisional or tentative ("Not Confirmed Appointments" today), tied to the client through the location. | The provisional calendar never reached `appointments`, so it read 0 before. Reschedule, follow-up and callback calendars are held out and named. |
| **Lead to booking, three ways** | Confirmed bookings ÷ platform leads (the main one), provisional ÷ leads, any ÷ leads. | — |
| **Show rate** | Showed ÷ (showed + no-show) on meetings whose day has passed. | A meeting nobody recorded is neither. |
| **Close rate** | Deals marked won by the client in Mahara OS outcomes ÷ shown appointments, last 30 days. The tab says how many past appointments have no outcome, per client, and lists them. | Mahara OS outcomes start on 2026-09-18. |
| **Client status** | Good = cost per lead at most $15, cost per confirmed booking at most $60 and show rate at least 60%; bad = cost per booking over $80 or cost per lead over $22.50; watch otherwise. | 60% is the one show rate line for clients. |

## Calls tab (the clients' dialer)

`native/adapters/calls.js` reads `public.mahara_call_center_report`, the same read as the power dialer.

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **Shared scorecard** | Overall, caller, client and daily results for one Kuwait date range, up to 93 days. | Unknown is not zero. |
| **Dials / actual calls** | Dials are saved dispositions with a note, by save date. Actual calls are verified Maqsam outbound calls. | Connected can include voicemail. |
| **Speed to lead** | Working time from creation to the first verified dial, on that caller's schedule. | Untouched leads stay in the all-lead denominator. |
| **Confirmed / provisional bookings** | New main or online bookings are confirmed; provisional calendars are counted apart. By booking creation date. | Delivery counts by meeting day, so the two need not match. |
| **Shows / no-shows / closed projects** | The client sheets' outcome snapshots. | Currencies are never added together. |

## Client success tab

`native/adapters/clients.js`.

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **Buckets** | ClickUp card status: onboarding, active, paused, churned. | — |
| **Leads 7d, CPL 7d, bookings 7d per client** (any window since 2026-10-11) | Each row's daily series (`rows[].daily`, 180 days): spend and leads from the same media history as Delivery, bookings from the booking events tied to the client's campaigns, each campaign reaching the card by its client tag, tags or client name (campaigns taken off the board included); rebuilt for the chosen window. | Future appointments are left out of the per-day bookings, so a window can differ from the 7-day column, which is the client's whole GoHighLevel count. A portal "seen" count works only for windows that end today; an earlier end says it is not kept per day. |
| **Risk score** | Points for unhappy words on the card, silence over 14 days, an overdue payment, no campaign or no leads, cost per lead over $22.50, a bad Pulse, no portal visit, DEFCON 1 or 2. High is 5 or more. | — |
| **Churn** (Client success and Backend) | **The client success Churn page's register** (`cockpit_churn_months` and `cockpit_churn_departures`), rolled up by the client success rule (`apps/client-success-cockpit/src/lib/churnCore.ts`): a client lost before day 90 from launch, over the clients active at the start of the month; the rolling three months beside it. September 2026: 1 lost of 22. The roster-history figure stays as a cross-check line. | A month not in the register says so and asks for it on the Churn page; it is never 0%. |
| **Extensions** | The Client Extension Form (Typeform `gqBcyK6g`): weeks granted per client, per day (`extensions.grantRows`), the clock starting at submission. **The ClickUp field "Current extension (weeks)" is written automatically every hour at :47** by `ceo-extensions-sync` from the same form the Make extension scenario fires on, only values that changed, each write in `cockpit_ceo_extension_field_writes` and the audit log; the button writes them now. | The Make scenario itself is not changed. When the job runs as a dry run, the card says automatic writes are off. |
| **LTV and MRR per client** | The card's LTV and MRR fields, in USD (read as numbers since 2026-10-11; they read n/a before). | Typed. |
| **Time to first launch** | Days from the card's creation to its Launch Date. | Cards created after their Launch Date are named and left out. |
| **Average retainer** | Mean MRR over active cards on a recurring plan. | Paid-in-full and split-pay cards. |

## Team & payroll, Management

`native/adapters/team.js`; the roster and pay are `cockpit_people` and the `cockpit_ceo_people_*` functions.

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **End of days** | The cockpit's EOD form (`cockpit_eod_reports`, 180 days kept per person as `eodDays` so any window can be counted) plus the B2B `eod_reports` and `team_eod_reports`. **The CEO's rule: the EOD Reports sheet is the source of truth.** | The sheet `1EhPp7x0jZfV8dNjUvmuWv_alNvduMGpe_COjUAB13bw` is not shared with the cockpit's service account yet. |
| **Payroll a month** | `cockpit_people`: monthly cost × the fixed currency table, over active people. | A floor while anyone is uncosted; those are named. |
| **Commission** (two lines per person since 2026-10-11) | Each person carries up to two commission lines, each "what it is paid on" and a rate (`commission_basis`/`commission_rate` and `commission2_basis`/`commission2_rate`). The bases: a share of cash or contracts closed or set, MRR managed, or an amount per intro shown, per **qualified intro shown**, per demo shown, per signed deal, or per **fully closed deal** (a closer-form deal that is not voided). The setter's rule (the CEO, 27 Sep): "$500 base $10 per showed qualfiwedd appointment $50 per closed deal". The closer's: 10% of cash collected. | Next month's qualified intros shown is the plan's intros shown × the qualified share of the last 90 days, labelled as an estimate. |
| **Working hours per person** | `cockpit_people.schedule`. | — |
| **Hours and pay** | Hubstaff tracked time and Timetastic leave (`cockpit-hours-sync`), against each person's schedule and terms. "Not tracking now" lists people required to track (their terms, else the role default: call centre and media buyer) who are not tracking now. **The morning note** (since 2026-10-11, off until the CEO switches it on in Hours and pay): at 09:05 Kuwait, one Slack message to the CEO only, listing who was required to track yesterday and did not (working day on their schedule, no Timetastic leave or public holiday, no decision already logged, nothing in Hubstaff), from `cockpit_hours_nudge_list`; each run is a `cockpit_sync_state` row (`hours-nudge`) and an audit row, and the Slack calls are receipted in `cockpit_hours_provider_health`. | When Hubstaff has not been read since the day ended, nobody is listed and the run says so. |

## Content tab

`native/adapters/organic.js`.

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **Instagram** | Meta Graph API: followers, reach and engaged accounts over 28 days, the 24 newest posts. | 24 posts only. |
| **YouTube** | YouTube Data API: subscribers, views, the 12 newest uploads. | 12 uploads only. |
| **Performing best** | Each post's views ÷ the platform's median. | The median is over the posts read. |

## Recruiting tab

`native/adapters/hiring.js` over `cockpit_hiring_candidates`, `cockpit_hiring_events` and `cockpit_hiring_meta`.

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **Candidates, and every stage count** | `cockpit_hiring_candidates` in Creative Triage, mirrored every ten minutes from the GoHighLevel sub-account "MaharaMedia Hiring" (`2FMeC6zxqelIG07OViBj`), one board per role (Media buyer, Client success manager, Sales closer (B2B), Sales setter (B2B), Call centre agent, Video editor), ten stages each: Application, Disqualified, Loom request, Group interview, One-to-one interview (Aziz's words, 2026-10-11; the boards say "One to one interview" until `scripts/hiring/ghl_hiring_stages.py --apply` renames them in place, and both names are read), Job offer, Bench, Hired, Fired, Churn. Each stage carries a win probability and the funnel flags so the board reads as a funnel. HighLevel's API has no stage colour: a stage carries only its position, the two funnel flags and its win probability. Since 2026-10-07 the mirror is the Edge Function `hiring-sync` (job `mirror`, pg_cron every ten minutes) instead of Convex. | Contact details are not mirrored on purpose. Every row links to the card in GoHighLevel, where the email and phone live. |
| **Applications** | The five careers Typeforms, read every thirty minutes (`zo1Zm6u6` media buyer, `oW8CWRhi` client success, `rqv3Fkts` sales rep, `jYTRw2Sx` call centre, `tigKbFlO` video editor) by `hiring-sync` job `intake` (at :08 and :38). Each becomes a contact and a card at Application, with the whole questionnaire attached to the contact as a note that ends "Form response <id>". Each form remembers the responses it filed (`cockpit_hiring_meta` `intake:<form>`, carried over from Convex), a contact that already holds a response gets no second note, a contact with a card on the board keeps that one card, and a form another importer files live (PR #31's `cockpit_hiring_intake_sources`) is left to it. The first intake run after the switch-on is a dry run on purpose; its plan is in `cockpit_hiring_runs.result`. | No form had a webhook before this, so nothing had ever left Typeform. Applicant source is not on any form, so it reads "Careers page" unless the form asks. Nothing filed between 2026-10-03 and the switch-on until the first live run catches up, up to 50 per form per run. The two Tally forms (closer, call centre) are not read. |
| **Applied, hired** (any window since 2026-10-11) | `hiring.appliedByDay` and `hiring.hiredByDay`, over every candidate, not only the live ones. An applicant is dated by `cockpit_hiring_candidates.applied_at`, a hire by the day the card moved to Hired. | `applied_at` is the day the candidate reached the board: 253 of the 255 on it were imported from Typeform on 22 Sep 2026, so a window before 22 Sep reads 0 applied and 22 Sep reads 253 (checked 2026-10-11). Their Typeform submission days are not carried over. |
| **Scores** | Typed by Aziz on the tab, out of ten, per stage: application, Loom, group interview, one-to-one, test project. Written to the GoHighLevel contact so the card agrees with the cockpit. The total is the mean of the scores given. | A score is not a decision. Nothing moves on a score alone. |
| **Days in stage, stale** | `stage_since`, reset whenever the card moves. Stale is more than the engine's stale line, seven days by default. | A card imported from form history starts its clock at import, not at application. |
| **Conversion and time to offer** | Hired over applied per role, and the median days from application to the offer date on the card. | Both read low until a full cohort has been through; the imported history has no stage moves behind it. |
| **The messages** | The engine composes from the role's GoHighLevel custom values (test project, Loom request, compensation, daily responsibilities, position video, job post, apply link) so Aziz edits them there, not in code. Every message goes out on email and on SMS, with WhatsApp tried only when the SMS rail refuses. Every send is a row in `cockpit_hiring_events`. | It is disarmed until Aziz arms it: disarmed, every message is written down and nothing is sent. The offer message is switched off by default even when armed. The same six messages also exist as GoHighLevel workflows (36, all drafts until the CEO publishes them); arm one or the other, never both. Those workflows send email, then SMS, then WhatsApp once Meta approves each role's template (`docs/hiring/ghl-hiring-phase-b.js` v4): GoHighLevel cannot branch on a failed SMS, so there the WhatsApp backup goes after the SMS rather than only when it fails. |
| **Headhunt, "Find people for this role"** | The button under each role's funnel writes `cockpit_hiring_meta` `headhunt-request:<role>` through `hiring-api` (`headhunt`, CEO only, audited as `hiring.headhunt`). The VPS answers it from its five-minute `radar.py pending` run (`radar/hiring.py answer_requests`, three tries), and the answer lands in `headhunt:<role>`: five searches to run today, what good looks like, what to skip, a first message and a follow-up. The tab reads both through `hiring-api` `headhunts` and checks every 15 seconds while a request waits. | It finds where to look, not people: nobody is contacted and no profile is read. One request per role at a time; a request held more than 30 minutes can be asked again. |
| **The recruiting agent** | Runs on the VPS (`hermes/ideation-radar`, `radar.py hiring`, every 30 minutes) on the language model keys that box already holds, cheapest first. It reads the application out of `cockpit_hiring_applications`, scores it against the role's scorecard published in `cockpit_hiring_meta`, and writes `agent_score`, `agent_verdict`, `agent_note` and `agent_asks` onto the candidate row. It learns from the gap between its score and Aziz's, keeping disagreements of two points or more. | It proposes only. It never moves a card and never sends a message. It needs no key on the cockpit's deployment. |

## Goals tab

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **A target's actual** | The published sections, read for the plan's first day to yesterday by `src/types/ceo/scoreboard.ts`. | A number the source cannot give is n/a, never zero. |
| **Call centre: new client leads, bookings made, lead to booking** | `public.mahara_call_center_report` for exactly the plan's days. | Provisional and unclassified bookings. |
| **Next month's plan** | Worked out in the browser from the inputs (`goalsModel.ts`), each target with a note saying how. | — |

## Costs tab

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **Software, other overhead, other marketing** | `cockpit_cost_lines`, edited on the page, in USD at the fixed rates. | Cancelled and paused lines. |
| **Last charge** | The newest CBK statement line in the last 120 days whose reference contains the line's match word. | Other cards. |
| **Payroll** | Everyone working on the roster: pay a month plus **both** commission lines priced on the chosen plan's targets (`costsModel.ts`). Last month's base pay is each person's approved figure from Hours and pay. | Commission written as "other, see the note" cannot be priced and is named. |
| **Last month on the statements** | `cockpit_bank_lines` for the previous month, to the newest day uploaded. | Months not uploaded yet. |

## Machine tab

| Number | Where it comes from |
|---|---|
| **Status** | Failing checks from the cockpit's health ledger (three fails in a row is an alert), the jobs and the B2B feeds (`sync_state`), **and, since 2026-10-11, the CEO sections themselves**: when any section in `cockpit_sections` has `ok = false`, the line says "2 CEO sections failing (Money; Expenses and P&L)", with semicolons because a label can carry its own "and", and never "Everything is running". The Today strip says the same thing (`machineState.ts`, `sectionsFailing`). |
| **Changes and bugs** | `cockpit_feedback`, shown to the CEO (his session, `isCeo`), through `cockpit_ceo_action('feedback.*')`, each change audited. The Deploy button marks queued rows dispatched. The scheduled scan (`scripts/ops/cockpit-feedback-scan.SKILL.md`, three times a day while the Claude app is open) reads and writes the queue with SQL through Composio, never Convex, and every state change it makes writes a `feedback.scan` audit row. |

## Waiting on the CEO

1. **Statements every week.** Upload the CBK account and control-card statements on the Money tab. Past 7 days the tab warns; it still publishes.
2. **The EOD sheet.** Share `1EhPp7x0jZfV8dNjUvmuWv_alNvduMGpe_COjUAB13bw` with `claude@studied-handler-508106-m5.iam.gserviceaccount.com` (viewer).
3. **Hours terms.** Confirm each agent's hours terms and the first month paid by hours; a Hubstaff seat for the media buyer, linked in Connections; and the team running Hubstaff daily (the morning note only reports).
4. **Unattributed payers.** Tie the payers on "Money not tied to a client" once Money publishes again; each tie is the CEO's call.
5. **Content attribution.** Tag non-ad contacts, and add a contact id or "how did you find us" to the closer form.

## Changed on 2026-10-11: after the Convex retirement

Rewritten for the native worker and the CEO API (above), and these numbers changed. The worker changes go live with the next native release on the VPS, the screens with the next ship of the media buyer cockpit, and the two migrations and Edge changes when they are applied and deployed.

- **Money and Expenses publish with an old statement.** They had not refreshed since 8 Oct 01:35 because a statement over 7 days old stopped both sections, and 261 finance jobs failed. Now it is a warning. The card statement of 2 Oct was checked for import (`scripts/import-cbk-statements.ts`, dry run): 185 lines, 1 Sep to 2 Oct, printed totals equal to the lines (debits 6,320.160 KWD, credits 6,090.000), every running balance proven, opening 341.417 plus the lines equal to the closing 111.257; 138 of its lines are the 1–21 Sep lines already held, one for one, so 47 lines are new. After it the newest statement ends 2 Oct. The other file, `ACCOUNT_STATEMENT_DETAILS_1791292639700.pdf`, is a receipt for one incoming transfer, not a statement; the cockpit's parser refuses it, and the payment it shows is already on the Money tab as a hand-logged deposit.
- **Delivery reads the live media table** (`cockpit_media_daily_stats`) through the campaign tie, in dollars as stored. Checked: 25 Sep to 1 Oct, 10 of 15 accounts identical to the cent with the old table (the SAR account 831.43 SAR there, $221.66 here); 4–10 Oct, the 14 active campaigns sum to $2,402.43 in both the daily feed and Meta's own 7-day spend on `cockpit_campaigns`, 14 of 14 to the cent. October to the 10th: $6,081.26 over 14 clients, every campaign tied.
- **Provisional bookings** come from the call centre report's source: 11 Sep to 10 Oct, 28 by creation day, equal client by client to `mahara_call_center_report`'s `provisionalBookings` (28).
- **LTV and MRR per client and the average retainer** read as numbers (they were n/a: the worker returned the database's numbers as text).
- **LTV baselines and September's book** imported from Convex: 26 baselines (none existed on 18 Sep in Convex; 24 are 19 Sep), and projected $14,332 / collected $4,068 for September; 28 of 28 equal the Convex-era mirror.
- **Kickoff cash** joins the deposit in front-end cash, from 4 Oct. Today two cards carry it: مدانة العمرانية $1,500 (4 Oct, not yet seen on a rail) and Shades $0 (8 Oct).
- **Churn on Backend** reads the Churn page's register; **cancel rates** are three tiles; **Proposals** are on Sales; **Machine** counts failing CEO sections; **two commission lines** per person; **the extension field** is written every hour; **the morning hours note** exists, off; **the changes-and-bugs queue** shows for the CEO and its scan runs on Supabase.

## Changed on 2026-10-08: CTR is link CTR

The CEO: "I need the ctr metric on the ads in ceo cockpit to be link ctr not normal ctr". Every CTR in the cockpit is now link CTR, link clicks divided by impressions, labelled "Link CTR" with the hint "Link clicks divided by impressions. Not CTR (all).", the media buyer cockpit's words.

- **Ads tab**: already computed link CTR; the label said "CTR" and now says "Link CTR". Link clicks that are not known would read n/a, never 0.
- **Webinar funnel**: the round's "Clicks and CTR" tile showed all clicks at CTR (all) and now shows link clicks at Link CTR; the per-ad table's CTR column is now Link CTR.
- **Targets**: the `ctr` target was scored on CTR (all) and is now scored on link CTR. Lead-gen, checked against a plain sum of `meta_ad_snapshots` on 2026-10-08: August 1.79% → 1.06%, September 1.73% → 1.08%, October to the 8th 3.08% → 1.96%. The stored targets were not changed.
- **Winning ads** (growth payload): `ctr` was CTR (all) in percent; it is now `linkClicks` and `linkCtr` as a fraction.
- **Supabase**: the webinar's link CTR lands in `cockpit_metric_values` as `webinar.link_ctr`.

## Changed on 2026-09-27: voided deals left out

Before and after for August 2026, both read from B2B on 2026-09-27 with the cockpit's own code (then `convex/ceo/voids.ts`), and checked against a plain count of `closed_deals` less `record_voids`:

- Closes 12 → 10, contracted $69,000 → $61,000, cash (deposit) $6,500 → $5,000, front-end cash $6,500 → $5,000; close rate 25.5% → 21.3%, qualified close rate 26.1% → 21.7%, CAC $478.39 → $574.06, contracted ROAS 12.02x → 10.63x, front-end ROAS 1.13x → 0.87x.
- The rep scorecard loses its August row for Aziz (2 closes, $8,000, $1,500, no calls). Signed deals with no ad 18 → 16. The 90-day average contract $5,850 → $6,055.56.
- Every window without a voided deal is unchanged.

## Changed on 2026-09-21 (three passes)

- Cash collected includes the bank (the CBK upload), Whop payouts, Tap settlements and own transfers are never cash, refunds can be logged by hand, expenses come off the statements with an editable exclusion list, and days since the last statement warns past 7.
- Delivery counts bookings three ways and lead to booking three ways, judges close rate on Mahara OS outcomes, lists past appointments with no outcome, and uses the CEO's status rule.
- Speed to lead on working hours, on the Calls and Marketing tabs.
- Leads are the ROAS tags (71 leads month to date against the dashboard's 142 on 2026-09-21); speed to lead is the first Maqsam call by a sales rep; show rates, both close rates and the cancel rates are the dashboard's own counts; lead to booked call is per lead; reach and frequency are read live from Meta per timeframe.
- Every payment in over 12 months has a side (front end, back end, or not attributed), and every section and metric land in Supabase each refresh.
