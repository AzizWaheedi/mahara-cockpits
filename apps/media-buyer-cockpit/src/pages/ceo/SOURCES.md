# Where every number on the CEO cockpit comes from

One line per number: what it is, where it is read from, what it leaves out. Updated 2026-09-21 after Aziz's review (leads by the ROAS tags, speed to lead on Maqsam, the cash chain, the EOD sheet).

The cockpit recomputes every section every 15 minutes on the production Convex deployment. Days are Kuwait days. When a section fails, the screen keeps the last good numbers and says so.

## The seven places numbers come from

1. **B2B GoHighLevel, through the B2B Supabase database** (project `flwboeijllbtrufxkhts`). Mahara's own funnel: contacts and their tags become `leads`, calendar appointments become `calls`, the closer's Typeform becomes `closed_deals`. Synced every 15 minutes.
2. **Meta Ads, through the same B2B database** (`meta_ad_snapshots`): spend, impressions, clicks per ad per day for Mahara's own account.
3. **Maqsam, through the same B2B database** (`maqsam_calls`): the setters' phone calls.
4. **Whop and Tap**: card payments. Whop lands in the B2B database (`whop_payments`); Tap is read from Tap's API directly.
5. **Creative Triage Supabase** (project `bldgtotkfmhoxmlzowdx`): the clients' side. Each client's Meta account per day, each client's GoHighLevel appointments and opportunities, the clients' Maqsam dialer, and the hand-kept roster (`cockpit_people`).
6. **ClickUp, the Clients – Mahara list**: the client cards, with the hand-typed billing fields (MRR, LTV, payment plan, paused on, churn date).
7. **Google**: Instagram and Facebook through the Meta Graph API, YouTube through its Data API, and (once shared) the EOD Reports sheet.

## Growth (Frontend, Marketing, Sales tabs)

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **Leads** | GoHighLevel contacts tagged `roas-qualified` or `roas-unqualified`, dated by the day the contact was created. When a contact has both, it counts as qualified. | Contacts tagged `roas-unprepared` ("not ready") and contacts with no ROAS tag are shown next to the number and never counted. The dashboard's older count (every contact flagged as a lead) is kept for comparison as `raw.leads`. |
| **Cost per lead** | Lead-gen ad spend ÷ leads (above). | Retargeting spend is never in it. Because leads are now the tagged ones only, this reads higher than the dashboard's cost per lead. |
| **Lead-gen ad spend** | Meta snapshots for campaigns whose name does not say `hiring`/`recruit` (excluded) or `hammer them`/`retarget`/`remarket` (retargeting). | Meta's own reporting day; nothing from client accounts. |
| **Retargeting spend** | The same snapshots, the campaigns whose name says retarget/remarket/hammer them. | Shown beside, never inside, any cost per lead. |
| **Speed to lead** | For each lead, the minutes from its creation to the first Maqsam call with it (any direction), matched by the CRM contact or the last eight digits of the phone. The number shown is the median over leads that were called. | Leads never called on Maqsam are counted beside it ("22 of 71 called"), not inside it. WhatsApp first contact does not count. |
| **Intros booked, demos booked** | GoHighLevel appointments (`calls`), by the day they were booked. | — |
| **Intros shown, demos shown** | Appointments on the day they were for, once that time has passed, with status `showed`, or `confirmed`/`invalid` and past. This is the dashboard's rule and Aziz's: confirmed or showed counts as shown. | An appointment nobody updated counts as shown until it is marked otherwise. |
| **Show rates** | Shown ÷ due (appointments whose time has passed). | — |
| **Intros advanced, intro → demo** | A shown intro whose contact has a demo booked after the intro. | — |
| **Signed, contracted, cash collected, new MRR** | The closer's Typeform (the New Client Form), on the day it was submitted: contracted revenue, cash collected at signing (the deposit), new MRR. | This is what the closer typed. The rest of the cash is not on this form (see Money). |
| **Close rate** | Signed ÷ demos qualified (showed, or confirmed and past). `close_rate_all` uses demos shown. | — |
| **Cost per demo, CAC, ROAS** | Spend ÷ demos shown; spend ÷ signed; contracted ÷ spend. | ROAS is on contracted value, not cash. |
| **Cost to win a customer** (Frontend) | (Lead-gen spend + retargeting spend) ÷ signed. | Differs from the dashboard's CAC, which is lead-gen only. |
| **Reps scorecard** | The dashboard's `b2b_rep_scorecard`, joined to `sales_reps`. | The read-only database role is refused this function, so the Sales tab shows no rep rows. |
| **Daily series** (365 days) | Spend, leads (ROAS rule), bookings and signed deals per day from the tables above. | — |

## Ads tab (Mahara's own account)

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **Per ad: spend, impressions, clicks, link clicks, frequency** | Meta snapshots summed per ad for 7 and 30 days; frequency is the worst child, never summed. | — |
| **Per ad: leads, fit, not ready** | CRM contacts attributed to the ad, by the ROAS rule: leads = qualified + unqualified; fit = qualified ÷ leads; not ready = `roas-unprepared`. Meta's own lead count is shown beside it. | A contact with no attribution is not on this tab at all: the coverage line says how many CRM leads and deals carry an ad. |
| **Per ad: the funnel** (intros, demos, shows, signed, contracted, cash) | The same `calls` and `closed_deals` tables filtered to the ad, dated exactly as the dashboard dates them. | — |
| **Verdict** | Rules on the last 7 days for money (no delivery, kill over $22.50 per lead, hold over $15, fatiguing at frequency 2.5) and the last 30 for the funnel (leads that do not book, intros that do not convert, demos that do not close). | — |
| **Setter, closer** | The setter with the most intro calls on the ad (`sales_reps.ghl_user_id`), the closer with the most signed deals (`closed_deals.closer`). | One of each per ad. |
| **Account status, balance** | Meta Graph API on `act_746108264865897`. | — |

## Money tab

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **Cash collected this month** | Whop payments (net of refunds, by charge day) + Tap captured charges + hand-logged payments, each a separate rail, summed. | Tap refunds are not read (Tap is gross). Processor fees are in neither. Bank transfers are never counted as cash in. |
| **The cash chain of one deal** | Deposit at signing: the closer's form (`cash_collected`). Rest of the cash: meant to be collected on the onboarding call and recorded on the CSM's kickoff form. Confirmation: Whop, Tap or the bank transfer. | **The kickoff form has no field for the amount collected yet** (flagged 2026-04-30, still open), and its answers only land as a ClickUp comment. Until it exists, the cockpit ties cash to deals through Whop and the bank ledger only: 42 of 124 Whop payments link to a deal. |
| **Contracted this month** | The closer's form, plus hand-logged deals that do not match a closer-form deal. | Typed, not paid. |
| **Refunds** | Whop refunds by refund day (month to date, 90 days). | Whop only. |
| **Projected month** | Cash so far ÷ days so far × days in the month. | Reads low early in a day. |
| **Targets** | `monthly_targets` in the B2B database, latest month on record, against the dashboard's window function. | No targets if the latest month is old. |
| **MRR on the books** | ClickUp card fields, grouped by stage: active, paused, gone, sales list, pipeline. Recurring = cards whose payment plan is not paid-in-full / split pay / one-off / upfront. | Typed by hand. Blank means missing, not zero. Groups are never summed. |
| **Average LTV** | The LTV field on the cards, averaged over cards that have one. | Typed, not computed from payments. |
| **Expenses** | The bank CSV loaded into `expenses`, by category, latest loaded month; unloads excluded from "money out". | KWD converted at an inferred 3.248/3.25, not the cockpit's 3.26. Profit and margin stay empty until revenue is declared complete. Payroll is not in it. |

## Delivery tab (clients)

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **Spend, leads per client** | Each client's Meta account per day in Creative Triage (`ads_daily_snapshots`), converted to USD with the fixed table (KWD 3.26, AED 0.2723, SAR 0.2666, QAR 0.2747). | A currency not in the table is left out entirely. Mahara's own accounts are dropped. |
| **Bookings** | The client's GoHighLevel appointments on their main appointment calendar, by the day the meeting is for, future ones excluded. | Only clients whose booking calendar Mahara can read. |
| **Show rate** | Meetings whose day has passed with status showed ÷ (showed + no-show). | A meeting nobody updated is neither. Most clients do not update. |
| **Close rate** | Opportunities the client's own CRM marked won ÷ showed. | 20 wins marked across every client since January: reads low by construction. |
| **Lead to booking** | Bookings ÷ platform leads. | — |
| **Running** | Campaigns with spend in the last three days. | The company-level "running" above the table is Meta's ACTIVE status instead. |
| **Client status** | Good within $15 per lead and $60 per booking; bad with no leads or over $22.50 per lead; watch otherwise. | — |

## Calls tab (the clients' dialer)

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **Dials, connected, talk time** | The Maqsam dialer import in Creative Triage (`mahara_reporting.facts`): outbound calls with one agent; connected = completed with duration. | Connected can include voicemail. Only the accounts the dialer imports. |
| **Speed to lead (clients)** | For DFY clients' leads, the first outbound dial to the lead's phone. | Only since 2026-09-12. |

## Client success tab

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **Buckets** | ClickUp card status: onboarding, active, paused (stage says pause/freeze/hold), churned. | — |
| **Risk score** | Points for unhappy words on the card, silence over 14 days, an overdue payment, no campaign or no leads, cost per lead over $22.50, a bad Pulse, no portal visit, DEFCON 1 or 2. High is 5 or more. | — |
| **Churn this month** | A launched client that stopped (term = launch + 90 days; past the term it counts churned unless a payment on any rail landed after it) ÷ launched clients at the start of the month. | ClickUp keeps no stage history, so stops before mid-September are undated and left out; the rate is withheld when the month is incomplete. |

## Team & payroll, Management

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **End of days** | Today: the B2B database's `eod_reports` and `team_eod_reports` (the Typeforms) plus this app's own EOD form. **Aziz's rule: the EOD Reports sheet on Google Sheets is the source of truth.** | The sheet (`1K10In9fyYa_hN7X4z_HGcCuoxGBRZoF4q7Z0r2SalZE`) is not yet shared with the cockpit's service account; the read is built and waiting. |
| **Payroll a month** | `cockpit_people`: monthly cost × the fixed currency table, over active people. | A floor while anyone is uncosted; those are named. |
| **Commission** | A rule per person: what it is paid on, then the rate. | No payout is computed yet: nothing links the roster to the CRM's sales reps. |

## Content tab

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **Instagram** | Meta Graph API: followers, reach and engaged accounts over 28 days, the 24 newest posts with views, reach, saves, shares. | 24 posts only. |
| **YouTube** | YouTube Data API: subscribers, views, the 12 newest uploads. | 12 uploads only. |
| **Performing best** | Each post's views ÷ the platform's median, six per platform. | The median is over the posts read, not the whole account. |

## Machine tab

| Number | Where it comes from |
|---|---|
| **Failing checks** | This app's health ledger: every outside call notes ok or fail per source; three fails in a row is an alert. Feeds are judged on the B2B `sync_state` and the Triage cron runs. |

## Two things only Aziz can settle

1. **The rest of the cash.** Add two fields to the kickoff form (collected at kickoff: yes/no, and the amount) and have Make write them somewhere structured. The cleanest landing is a row in the B2B `transfers` table linked to the deal, because the cockpit already counts that ledger as confirmed cash.
2. **The EOD sheet.** Share `1K10In9fyYa_hN7X4z_HGcCuoxGBRZoF4q7Z0r2SalZE` with `claude@studied-handler-508106-m5.iam.gserviceaccount.com` (viewer), and confirm it is the sheet that pulls in everyone's end of day. The read is built; the Team tab switches to it once it can see the tabs.

## Changed on 2026-09-21

- Leads are the ROAS tags. Month to date this gives 71 leads (23 qualified, 48 unqualified) against the dashboard's 142, so cost per lead reads $29.16 instead of $14.58; 33 contacts are not ready and 64 have no ROAS tag yet.
- Speed to lead is the first Maqsam call: month to date, 22 of the 71 leads have one, a median 20.5 hours after creation, none within five minutes. Either the team's first touch is on WhatsApp, or the Maqsam import covers only part of the team. Worth checking before reading it as performance.
- The Ads tab dates calls the way the dashboard does; the 90-day refund and average-contract figures are 90 days again.
