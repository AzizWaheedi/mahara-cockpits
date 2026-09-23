# Where every number on the CEO cockpit comes from

One line per number: what it is, where it is read from, what it leaves out. Updated 2026-09-21 three times: after Aziz's review (leads by the ROAS tags, speed to lead on Maqsam, the cash chain, the EOD sheet), after his twelve-point spec for the marketing and sales numbers, and after his twenty-point second batch (money, delivery, calls, team, client success, timeframes, design).

The cockpit recomputes every section every 15 minutes on the production Convex deployment. Days are Kuwait days. When a section fails, the screen keeps the last good numbers and says so.

**Every number also lands in Supabase.** Each refresh writes to Creative Triage: `cockpit_sections` (the whole payload of every section, as jsonb), `cockpit_metric_definitions` (one row per metric: label, plain definition, source, what it leaves out, unit) and `cockpit_metric_values` (one row per metric, scope, window and day: `company`, `client:<clickup id>` or `person:<name>`; windows today, yesterday, last7, mtd, lastMonth, last30, last90, 12m, all, snapshot). Join values to definitions on `metric`; a null value means not measurable that day, never zero. The registry is `convex/ceo/metricRegistry.ts`.

**Timeframes.** Frontend, Marketing and Sales carry one timeframe control (7 days, 30 days, this month, last month, 90 days, 6 months, 12 months, everything, or two dates) and rebuild every tile from the daily series for those days: each count is a sum of days and each rate a quotient of sums. This month, last month and 7 days use the server's own windows, which carry the exact median and the confirmed share. Delivery, Calls and Money carry a timeframe card built the same way from their daily series.

## The seven places numbers come from

1. **B2B GoHighLevel, through the B2B Supabase database** (project `flwboeijllbtrufxkhts`). Mahara's own funnel: contacts and their tags become `leads`, calendar appointments become `calls`, the closer's Typeform becomes `closed_deals`. Synced every 15 minutes.
2. **Meta Ads, through the same B2B database** (`meta_ad_snapshots`): spend, impressions, clicks per ad per day for Mahara's own account.
3. **Maqsam, through the same B2B database** (`maqsam_calls`): the setters' phone calls.
4. **Whop and Tap**: card payments. Whop lands in the B2B database (`whop_payments`); Tap lands in Creative Triage (`cockpit_tap_charges`) through the Supabase Edge Function `tap-charges-sync`, which runs every 15 minutes with the Tap key held as a Supabase secret. Nothing on Convex holds a Tap key.
5. **Creative Triage Supabase** (project `bldgtotkfmhoxmlzowdx`): the clients' side. Each client's Meta account per day, each client's GoHighLevel appointments and opportunities, the clients' Maqsam dialer, and the hand-kept roster (`cockpit_people`).
6. **ClickUp, the Clients – Mahara list**: the client cards, with the hand-typed billing fields (MRR, LTV, payment plan, paused on, churn date).
7. **Google**: Instagram and Facebook through the Meta Graph API, YouTube through its Data API, and (once shared) the EOD Reports sheet.
8. **The bank**: CBK has no API, so the CBK Online CSV export or the bank's PDF statement of each account and card is uploaded on the Money tab and parsed by the cockpit (`cockpit_bank_lines`, `cockpit_statements` in Creative Triage). Aziz (2026-09-21): nothing makes it automatic, the upload is the way.
9. **Mahara OS**: the client portal's outcomes (`portal_data.appointment_outcomes` in Creative Triage): attendance, deal won or lost, quotation, project value, as the client recorded them.
10. **Typeform**: the closer's New Client Form (into the B2B database) and the Client Extension Form `gqBcyK6g` (read directly).

## Growth (Frontend, Marketing, Sales tabs)

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **Leads** | GoHighLevel contacts tagged `roas-qualified` or `roas-unqualified`, dated by the day the contact was created. When a contact has both, it counts as qualified. | Contacts tagged `roas-unprepared` ("not ready") and contacts with no ROAS tag are shown next to the number and never counted. The dashboard's older count (every contact flagged as a lead) is kept for comparison as `raw.leads`. |
| **Cost per lead** | Lead-gen ad spend ÷ leads (above). | Retargeting spend is never in it. Because leads are now the tagged ones only, this reads higher than the dashboard's cost per lead. |
| **Lead-gen ad spend** | Meta snapshots for campaigns whose name does not say `hiring`/`recruit` (excluded) or `hammer them`/`retarget`/`remarket` (retargeting). | Meta's own reporting day; nothing from client accounts. |
| **Retargeting spend** | The same snapshots, the campaigns whose name says retarget/remarket/hammer them. | Shown beside, never inside, any cost per lead. |
| **Speed to lead** | For each lead, the minutes from its creation to the first Maqsam call with it made by a sales rep on the roster (`maqsam_calls.sales_rep_id` on `sales_reps`, role setter, closer or both), matched by the CRM contact or the last eight digits of the phone. The number shown is the median over leads that were called. | A call by a call-centre agent never counts. Leads never called are counted beside it ("22 of 71 called · 49 never called"), not inside it. WhatsApp first contact does not count. |
| **Where leads come from** | Ads when the contact carries an ad id (or GoHighLevel's attribution carries one as `mediumId`); organic when it carries none and the source, a tag or the attribution medium says inbound WhatsApp, Instagram DM, YouTube, referral or organic; otherwise ads, labelled assumed. | GoHighLevel's first-touch attribution is `{}` on most contacts, so a true first click needs UTMs on the forms and the WhatsApp link, or a "how did you find us" answer. |
| **Lead to booked call** | Leads created in the window with at least one intro or demo booked against their contact, ever, over leads. Per lead, never per booking. | The booked-call counts beside it are dated by booking day, a different clock. |
| **Intros booked, demos booked** | GoHighLevel appointments (`calls`), by the day they were booked. | — |
| **Intros shown, demos shown** | Appointments on the day they were for, once that time has passed, with status `showed`, or `confirmed`/`invalid` and past. This is the dashboard's rule and Aziz's: confirmed or showed counts as shown. | An appointment nobody updated counts as shown until it is marked otherwise. |
| **Show rates** | Intro show rate = intros shown ÷ intros due; demo show rate = demos shown ÷ demos due. Due = appointments whose time has passed, cancelled and no-show included. Shown = showed, or confirmed or invalid once past. | Cancelled and future calls are never in the numerator. A past demo nobody updated stays "confirmed" and counts as shown until it is marked no-show. |
| **Cancel rates** | Intro cancel rate = intros cancelled ÷ intros scheduled; demo cancel rate = demos cancelled ÷ demos scheduled; total over both. Cancelled is the appointment status; scheduled is every call on the calendar in the window, by call day. | — |
| **Intros advanced, intro → demo** | A shown intro whose contact has a demo booked after the intro. | — |
| **Signed, contracted, cash collected, new MRR** | The closer's Typeform (the New Client Form), on the day it was submitted: contracted revenue, cash collected at signing (the deposit), new MRR. | This is what the closer typed. The rest of the cash is not on this form (see Money). |
| **Close rate** | Signed ÷ every demo shown (the dashboard's `close_rate_all`). | A deal can be signed after the window its demo sat in, so it can pass 100%. |
| **Qualified close rate** | Signed ÷ demos qualified, which is demos shown minus the calls marked invalid (the dashboard's `close_rate`). | — |
| **Front-end cash** | The deposit the closer typed on the New Client Form for deals signed in the window, plus the kickoff cash the CSM collects on the onboarding call. | The kickoff form is not read yet, so this is the deposit alone and reads low. The share confirmed is what a Whop payment (tied by response id, or by the payer's email within 60 days) or a bank transfer on record backs; Tap is not checked on this tab. |
| **Front-end ROAS** (the main one) | Front-end cash ÷ lead-gen spend. | Reads low until kickoff cash is read. |
| **Contracted ROAS** | Contracted ÷ lead-gen spend (the dashboard's `roas`). | Signed money, not collected money. |
| **Front-end cash per call** | Front-end cash ÷ intros booked, ÷ intros shown, ÷ demos booked, ÷ demos shown, all in the same window. | Each stage is dated by its own event. |
| **Cost per demo, CAC** | Spend ÷ demos shown; spend ÷ signed. | — |
| **Reach and frequency** | Read from Meta for the timeframe chosen on the card, for the lead-gen campaigns and the retargeting campaigns separately: account-level insights filtered to the campaign ids, so reach is distinct people for the whole window. Campaigns are sorted by name the way the dashboard sorts them (hiring and recruit left out; hammer them, retarget and remarket are retargeting). | Never added up from daily rows. A new timeframe is read once and kept three hours. |
| **Cost to win a customer** (Frontend) | (Lead-gen spend + retargeting spend) ÷ signed. | Differs from the dashboard's CAC, which is lead-gen only. |
| **Reps scorecard** | The dashboard's `b2b_rep_scorecard`, joined to `sales_reps`. | The read-only database role is refused this function, so the Sales tab shows no rep rows. |
| **Daily series** (365 days) | Spend, leads (ROAS rule), bookings and signed deals per day from the tables above. | — |

## Frontend tab: the call funnel and the webinar funnel (2026-09-23)

Two funnels, never mixed. `convex/ceo/webinarSql.ts` is the one rule for what is the webinar's; the call funnel subtracts exactly that and the webinar section counts exactly that.

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **What is the webinar's** | A contact tagged `webby-*` (the WEBBY workflows tag every registrant). Their calls and signed deals count for the webinar from the moment they registered: the later of the contact's creation and three weeks before their session (the Webinar Datetime field). Campaigns whose name says webinar, webby, training, تدريب or ويبينار, or that lt_events names. | Registration time is approximate for an older contact: the CRM keeps no time for when a tag was added. |
| **Call funnel** | `b2b_window_metrics` for the window, less the webinar's share computed with the same filters, every rate recomputed with the dashboard's formulas. The daily series, ROAS leads, speed to lead, front-end cash, top and winning ads and lead sources leave the webinar out too. | Proven on 2026-09-23: identical to before across all windows and 40 days while the webinar has nothing; with a stand-in tag, total = part + rest for every count. |
| **Webinar funnel** | Per session (the `webby-mmm-yyyy` round tag): Meta spend, impressions, clicks, CTR from the B2B snapshots of webinar campaigns; reach and frequency from one Meta insights call per round; registrations from HighLevel; booked, held, closes, contracted and cash with the call funnel's rules; speed to first contact on Maqsam. **Since 2026-09-23, `hermes/webinar-pull` (hourly, VPS) reads Zoom and the gift survey into Creative Triage** (`cockpit_webinar_*`): attendance is Zoom's people in the room, our team (the Zoom account's users and @maharamedia.com) left out, a Zoom session tied to the round whose Webinar Datetime it started within 2 hours before to 4 after; watch time with rejoins merged; concurrent attendance counted at the middle of each minute; retention at a pitch is the people present over the peak; pitch 1 is the densest three minutes of "1" chat lines (3 or more) unless a time is set on the screen; drop-offs leave out the last two minutes; stay to end is who is in the room two minutes before the last person left; on time is a first join within 3 minutes of the Webinar Datetime. **Qualified** (Aziz: "qualification in the form after also before they book a call") is the booking form's roas tag when there is one (roas-qualified wins over unqualified), else the gift survey's yearly net profit at $100K or more, the call funnel's line. Survey responses are tied to registrants by contact id, email, then the phone's last eight digits; never by name. Bookings by pitch link: `utm_content=pitch1` / `pitch2` on the booking link, which HighLevel keeps on the contact's attribution. **The landing and thank-you pages' own events** (sites/webinar/mm-track.js → Edge Function `webinar-events` → `cockpit_webinar_page_events`, only rows from webinar.maharamedia.com count): visitors are distinct random browser ids, each placed in the round of the next session after their first visit; page conversion is HighLevel's registrations over those visitors; form started is a click into the form; form sent is GHL's lead-collected message; "registered on the page" is thank-you page views, the second source for HighLevel's count; join-link clicks are `/live` opens from a day before to three hours after the start; pitch link clicks are `/p1` and `/p2` opens from an hour before the start to two days after. Repeat registrants carry two round tags or more; "missed it, booked anyway" (the brief's non-attendee salvage) needs attendees tied to registrants. **Reminders**: HighLevel's messages to each registrant since registering, read into `cockpit_webinar_messages` every six hours; read counts as delivered. **Objections**: each registrant's Fathom sales calls, tagged once by deepseek-flash into fixed categories. Targets are the Live Training tracking brief's (6 Aug 2026). | Zoom has no registration, so guests carry a name only and are counted but not tied to a registrant: attendee to booked, show rate by lead time and by ad stay n/a until most attendees are tied (registration on, or signed-in emails), and the `webby-attended` tag still counts where somebody tagged. A booking made after another tracked link overwrote the contact's last attribution loses its pitch. A visitor who blocks site storage counts again on each visit; ad-blockers can stop the page's events entirely, so the page undercounts a little. Email reminder opens and clicks are in Kit, not read. The survey asks yearly profit, years in the market and type of work, not role or city. |

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
| **Cash collected this month** | Whop payments (net of refunds, by charge day) + client payments on the uploaded bank statements + Tap charges (from `cockpit_tap_charges`, filled by the Supabase job) no settlement line covers + hand-logged payments no statement line covers, each a separate rail, summed. | Tap refunds are not read. Processor fees are in none. A Tap charge and its bank settlement are one payment: the bank line counts, Tap confirms. A hand-logged transfer a statement line shows counts once, on the bank: a line within 3 days and 5% of the amount is the same money, and for a cheque a line up to 14 days after it was received, because a cheque reaches the statement when it clears (2026-09-23). Tap reads as not connected until the job has succeeded in the last three hours. |
| **Bank statements** | The CBK Online CSV export (preamble, a Date, Amount, Balance, Reference, TRSH_NUMBER table, footer totals) or the bank's PDF statement (read on the server with pdf.js; one block per transaction, the running balance proves every row against the opening balance, a row that does not reconcile is reported) uploaded on the Money tab. Every line gets a kind: client payment, Whop payout, transfer into Whop, Tap settlement, own transfer (card top-ups, unloads, Weyay), refund received, expense, bank fee, excluded, unknown. Lines already held (same day, amount and running balance, in either format) are skipped. | Whop payouts are never cash (the payments behind them already count on Whop); the cockpit matches each payout to the run of Whop payments within 3% and 14 days and says how many matched. The tab shows days since the newest statement and warns past 7. |
| **Refunds** | Whop refunds by refund day + refunds logged by hand (a manual entry of kind refund, which comes off the manual rail on its day). | Tap refunds. |
| **Expenses on the statements** | Statement debits by month and category (ads, software, courses, labour, bank fees, other, by the reference), with the exclusion list taken out: a card (the masked account) or a vendor (a fragment of the reference) marked personal. | Excluded lines still show on the Transactions tab. The P&L half still reads Muhammed's `expenses` import until the two are reconciled. Aziz (2026-09-21): the card that counts is the CBK control card (5370…4348), not the client ad spend card; its statement carries no Whop spend at all. Transfers to named people from the card are labour, transfers to Aziz himself are own transfers. |
| **The cash chain of one deal** | Deposit at signing: the closer's form (`cash_collected`). Rest of the cash: meant to be collected on the onboarding call and recorded on the CSM's kickoff form. Confirmation: Whop, Tap or the bank transfer. | **The kickoff form has no field for the amount collected yet** (flagged 2026-04-30, still open), and its answers only land as a ClickUp comment. Until it exists, the rest of the cash is judged from the rails (next row). |
| **Front end, back end, the person** (every payment in) | Each Whop payment (net), Tap charge, bank transfer and hand-logged payment of the last 12 months is tied to a deal (Whop's own link, the payer's email on the closer form, or the business or client name on it) or to a client card (a portal login, the hand-kept payer mapping, the card's names, or the card chosen when it was logged). Tied to a deal and inside its front-end window (45 days, 20 on a monthly plan): the first money up to the typed deposit is front end, the closer's; what follows is the rest of the cash, front end, the CSM named on the deal. After the window, or tied to a card only: back end, that client's CSM. | A payment that matches nothing is "not attributed" and listed on the Transactions tab with its payer. A Whop subscription cycle is never a deposit. Tap is in it only when the deployment has a live Tap key (it does not today). Bank transfers carry no email, so they tie by name only. |
| **Transactions tab** | Every payment in with the row above's verdict, every statement line with its kind (and a control to change it by hand), refunds logged by hand, Whop refunds and the bank expenses. | Capped at 1,500 lines. |
| **Projected MRR, collection rate, average retainer** | Projected MRR = the MRR field added up over active cards on a recurring plan; collection rate = cash attributed to those clients this month, every rail, over it; average retainer = the mean over the same cards. Kept per month in `ceoDaily` (`money.book.projected`, `money.book.collected`) from September 2026 on. | Typed MRR; a month with no attributed payment reads 0%. |
| **The client's LTV table** | Every payment attributed to a client card is mirrored to `cockpit_client_payments` (one row per payment) and feeds the LTV plan: the card's earliest LTV figure plus attributed payments since, written to the ClickUp LTV field from the Money tab. | The write is manual, one button. |
| **Contracted this month** | The closer's form, plus hand-logged deals that do not match a closer-form deal. | Typed, not paid. |
| **Refunds** | Whop refunds by refund day (month to date, 90 days). | Whop only. |
| **Projected month** | Cash so far ÷ days so far × days in the month. | Reads low early in a day. |
| **Targets** | `monthly_targets` in the B2B database, latest month on record, against the dashboard's window function; the leads, cost per lead and lead-to-demo actuals are recomputed on the ROAS rule. | The latest targets are for August, so September shows none. |
| **MRR on the books** | ClickUp card fields, grouped by stage: active, paused, gone, sales list, pipeline. Recurring = cards whose payment plan is not paid-in-full / split pay / one-off / upfront. | Typed by hand. Blank means missing, not zero. Groups are never summed. |
| **Average LTV** | The LTV field on the cards, averaged over cards that have one. | Typed, not computed from payments. |
| **Expenses** | The bank CSV loaded into `expenses`, by category, latest loaded month; unloads excluded from "money out". | KWD converted at an inferred 3.248/3.25, not the cockpit's 3.26. Profit and margin stay empty until revenue is declared complete. Payroll is not in it. |

## Billing tab (and the client success cockpit's Billing page)

One sheet in both cockpits (`components/billing/BillingSheet.tsx`, rules in
`convex/billingCore.ts`, the same files in both apps). Added 2026-09-23.

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **Every row** | The Clients - Mahara cards in ClickUp (list 901816559981), mirrored into `cockpit_billing_accounts` (Creative Triage) at every CEO refresh, on "Read ClickUp again" in either cockpit, and on every edit. On the books = Client Status active, paused or pipeline. | Cards on the sales list, gone cards and Mahara's own cards. |
| **Due in 7 days, Late** | The Next Payment Amount and Date typed on each active card, due today to 7 days out, or past. | Paused clients are never late. A card with no date is counted under "No method set" as "with no payment date", not as zero. Checked on 2026-09-23 against Maher's own scan: every difference was a client his exact-day rungs had stopped firing for (25 days late, never paused), since added to his scan. |
| **What to do** | The Billing And Invoice Reminders SOP's ladder, the same as Maher's: 4–7 days out confirm the method, 3 days out send the invoice, the day, day 1, day 2 is a call, day 3 pause, day 15 churn; paused clients are counted from Paused On. | A paused card with no Paused On reads "stamp one": the fifteen-day clock cannot start. |
| **LTV** | The LTV plan (`ceo/ltv.ts`): the card's LTV on 21 Sep plus every payment tied to the client since. The client success page shows the card's LTV field. | Money nobody tied to a client; tie it on the tab's "Money not tied to a client" card. |
| **Money not tied to a client** | Payments in over the last 12 months that the money section could not attribute, grouped by payer. Tying a payer writes `cockpit_payer_clients`, so every payment from them counts for that client from the next refresh. | The first refresh after tying. |
| **Waiting for the ledger** | `cockpit_billing_inbox`: payments a success manager or Maher logged. The CEO refresh takes each into `ceoManualPayments` (dropping one already logged that day) and writes back ingested, duplicate or rejected. | Card and Whop payments: they arrive on their own feed and are refused here. |
| **Billing log** | `cockpit_billing_events`: every change made from either cockpit or by Maher, who and why. | Changes typed straight into ClickUp show on the row at the next mirror but have no log line. |

## Delivery tab (clients)

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **Spend, leads per client** | Each client's Meta account per day in Creative Triage (`ads_daily_snapshots`), converted to USD with the fixed table (KWD 3.26, AED 0.2723, SAR 0.2666, QAR 0.2747). | A currency not in the table is left out entirely. Mahara's own accounts are dropped. |
| **Bookings, three ways** | Total = the provisional calendar + the online calendar + the main calendars (Main Appointment Calendar, In Office, In Home); confirmed = online + main; provisional = the provisional calendar alone. By the day the meeting is for, future ones excluded. An appointment with no client id is tied through its GoHighLevel location when that location maps to one client. | The provisional calendar exists on 46 locations and has produced no row in Creative Triage yet, so provisional reads 0 until the sync covers it. Reschedule, follow-up and callback calendars are held out and named. Four Arabic-named calendars belong to a location with no client card and are excluded. |
| **Lead to booking, three ways** | Confirmed bookings ÷ platform leads (the main one), provisional ÷ leads, any ÷ leads, over the last 30 days. | — |
| **Show rate** | Showed ÷ (showed + no-show) on meetings whose day has passed: status showed or no-show, else the client sheet's attendance, else the Mahara OS attendance. | A meeting nobody recorded is neither. |
| **Close rate** | Deals marked won by the client in Mahara OS outcomes ÷ shown appointments, last 30 days. The tab says how many past appointments have no outcome, per client, and lists them (day, calendar, CRM status). | Mahara OS outcomes start on 2026-09-18; 4 wins so far, on May to July appointments, so every close rate reads 0% today. |
| **Running** | Campaigns with spend in the last three days. | The company-level "running" above the table is Meta's ACTIVE status instead. |
| **Client status** | Good = cost per lead at most $15, cost per confirmed booking at most $60 and show rate at least 60%; bad = cost per booking over $80 or cost per lead over $22.50; watch otherwise, a show rate under 60% or an unknown one included. The hint shows what a shown booking would cost at a 60% show rate (cost per confirmed booking ÷ 0.6). | Aziz (2026-09-21): 60% is the one show rate line for clients; there is no 40. |

## Calls tab (the clients' dialer)

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **Dials, connected, talk time** | The Maqsam dialer import in Creative Triage (`mahara_reporting.facts`): outbound calls with one agent; connected = completed with duration. | Connected can include voicemail. Only the accounts the dialer imports. |
| **Gap between calls** | For each agent, the time from one outbound call ending to their next one starting, on the same Kuwait day, counted in working minutes only (`mahara_reporting.facts`, source maqsam). The median leads because one long break drags a mean; the count of gaps over 30 minutes is the part to act on. | An overnight or a weekend is never idle time. A gap longer than a full working day is left out: that is a day off or a break in the import. It needs two calls by the same agent on the same day, so a one call day has no gap. |
| **Speed to lead (clients)** | For DFY clients' leads, the first outbound dial to the lead's phone. Two clocks: the plain clock, and the working clock, where the time starts at the later of the lead's creation and the next working window and only working minutes count. Working hours live in `cockpit_settings` (key `working_hours`), editable on the tab; the default is 10:00 to 18:00 Asia/Kuwait, Saturday to Thursday. | Only since 2026-09-12. A call before the clock starts counts as 0 minutes. |

## Client success tab

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **Buckets** | ClickUp card status: onboarding, active, paused (stage says pause/freeze/hold), churned. | — |
| **Risk score** | Points for unhappy words on the card, silence over 14 days, an overdue payment, no campaign or no leads, cost per lead over $22.50, a bad Pulse, no portal visit, DEFCON 1 or 2. High is 5 or more. | — |
| **Churn this month** | A launched client that stopped (term = launch + 90 days; past the term it counts churned unless a payment on any rail landed after it) ÷ launched clients at the start of the month. | ClickUp keeps no stage history, so stops before mid-September are undated and left out; the rate is withheld when the month is incomplete. |
| **Extensions** | The Client Extension Form (Typeform `gqBcyK6g`): weeks granted per client in the month and in total, the clock starting at submission; matched to the card by name. The cockpit writes the live extension to the ClickUp Number field "Current extension (weeks)" after each form sync (only values that changed), and a button sends every value. | The form has two responses ever, both internal tests. The cockpit finds the field by name on the Clients list once it exists (ClickUp's API cannot create one); `CLICKUP_EXTENSION_FIELD` overrides the lookup. |
| **LTV and MRR per client** | The card's LTV and MRR fields, in USD, on the roster. | Typed. |
| **Time to first launch** | Days from the ClickUp card's creation to its Launch Date, per client, mean and median over launched clients; first launch only. | Cards created after their Launch Date are named and left out. |
| **Average retainer** | Mean MRR over active cards on a recurring plan. | Paid-in-full and split-pay cards are excluded. |

## Team & payroll, Management

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **End of days** | Today: the B2B database's `eod_reports` and `team_eod_reports` (the Typeforms) plus this app's own EOD form. **Aziz's rule: the EOD Reports sheet on Google Sheets is the source of truth.** | The sheet (`1K10In9fyYa_hN7X4z_HGcCuoxGBRZoF4q7Z0r2SalZE`) is not yet shared with the cockpit's service account; the read is built and waiting. |
| **Payroll a month** | `cockpit_people`: monthly cost × the fixed currency table, over active people. | A floor while anyone is uncosted; those are named. |
| **Commission** | A rule per person: what it is paid on, then the rate. | No payout is computed yet: nothing links the roster to the CRM's sales reps. |
| **Working hours per person** | `cockpit_people.schedule`: days and times per weekday plus per-day exceptions, edited on the row. | Shown and stored only; nothing is computed from it yet. |

## Content tab

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **Instagram** | Meta Graph API: followers, reach and engaged accounts over 28 days, the 24 newest posts with views, reach, saves, shares. | 24 posts only. |
| **YouTube** | YouTube Data API: subscribers, views, the 12 newest uploads. | 12 uploads only. |
| **Performing best** | Each post's views ÷ the platform's median, six per platform. | The median is over the posts read, not the whole account. |

## Recruiting tab

The one funnel Mahara runs on repeat, for five roles. Built 2026-09-22.

| Number | Where it comes from | What it leaves out |
|---|---|---|
| **Candidates, and every stage count** | `cockpit_hiring_candidates` in Creative Triage, mirrored every ten minutes from the GoHighLevel sub-account "MaharaMedia Hiring" (`2FMeC6zxqelIG07OViBj`), one board per role (Media buyer, Client success manager, Sales closer (B2B), Sales setter (B2B), Call centre agent, Video editor), ten stages each: Application, Disqualified, Loom request, Group interview, One to one interview, Job offer, Bench, Hired, Fired, Churn. Each stage carries a win probability so the board reads as a funnel; stage colours are not in GoHighLevel's API. | Contact details are not mirrored on purpose. Every row links to the card in GoHighLevel, where the email and phone live. |
| **Applications** | The five careers Typeforms, read every thirty minutes (`zo1Zm6u6` media buyer, `oW8CWRhi` client success, `rqv3Fkts` sales rep, `jYTRw2Sx` call centre, `tigKbFlO` video editor). Each becomes a contact and a card at Application, with the whole questionnaire attached to the contact as a note. | No form had a webhook before this, so nothing had ever left Typeform. Applicant source is not on any form, so it reads "Careers page" unless the form asks. |
| **Scores** | Typed by Aziz on the tab, out of ten, per stage: application, Loom, group interview, one-to-one, test project. Written to the GoHighLevel contact so the card agrees with the cockpit. The total is the mean of the scores given. | A score is not a decision. Nothing moves on a score alone. |
| **Days in stage, stale** | `stage_since`, reset whenever the card moves. Stale is more than the engine's stale line, seven days by default. | A card imported from form history starts its clock at import, not at application. |
| **Conversion and time to offer** | Hired over applied per role, and the median days from application to the offer date on the card. | Both read low until a full cohort has been through; the imported history has no stage moves behind it. |
| **The messages** | The engine composes from the role's GoHighLevel custom values (test project, Loom request, compensation, daily responsibilities, position video, job post, apply link) so Aziz edits them there, not in code. Every message goes out on email and on SMS, with WhatsApp tried only when the SMS rail refuses. Every send is a row in `cockpit_hiring_events`. | It is disarmed until Aziz arms it: disarmed, every message is written down and nothing is sent. The offer message is switched off by default even when armed. The same six messages also exist as GoHighLevel workflows; arm one or the other, never both. |
| **The recruiting agent** | Runs on the VPS (`hermes/ideation-radar`, `radar.py hiring`, every 30 minutes) on the language model keys that box already holds, cheapest first. It reads the application out of `cockpit_hiring_applications`, scores it against the role's scorecard published in `cockpit_hiring_meta`, and writes `agent_score`, `agent_verdict`, `agent_note` and `agent_asks` onto the candidate row. It learns from the gap between its score and Aziz's, keeping disagreements of two points or more. | It proposes only. It never moves a card and never sends a message. It needs no key on the cockpit's deployment. |

## Machine tab

| Number | Where it comes from |
|---|---|
| **Failing checks** | This app's health ledger: every outside call notes ok or fail per source; three fails in a row is an alert. Feeds are judged on the B2B `sync_state` and the Triage cron runs. |

## Things only Aziz can settle

3. **Statements.** Settled 2026-09-21: nothing at CBK makes it automatic, so the upload stays (CSV or PDF). A mailbox parser or a Shortcut that forwards CBK's transaction SMS to a Supabase function would make it live; both wait on Aziz.
4. **The card.** Settled 2026-09-21: expenses are the debits on the CBK control card, the one not called client ad spend. The client ad spend card is never an expense.
5. **The show-rate line.** Settled 2026-09-21: one line, 60%, for clients. A client with no attendance recorded still cannot read as good.
6. **The extension field on ClickUp** (see the Client success row), and the Tap key: add `TAP_SECRET_KEY` under Edge Functions, Secrets, in the Supabase dashboard for Creative Triage; the `tap-charges-sync` job then fills the table within 15 minutes.
7. **The sales rep form.** Settled 2026-09-22: two boards, closer and setter. Everyone answers the one closer's form and lands on the closer board; Aziz starts the ones who are not ready yet on the setter track and moves them up when they are, from the Recruiting tab. The form itself still cannot tell the two apart, so the decision is his on every candidate.
8. **The video editor.** Five questions, no careers page of its own, last touched 2026-06-27 while the other four were rebuilt on 2026-09-07. It asks for no CV, no location and no start date.
9. **Where applicants come from.** No form carries a hidden source field, so a channel cannot be judged on hires. Adding one is a form change.
10. **Who sends candidate messages.** Settled 2026-09-22: GoHighLevel does, from the 36 published workflows. The cockpit's own engine stands down entirely so nobody is messaged twice. To take sending back, switch the sender to the cockpit on the Recruiting tab.

## Two things only Aziz can settle (from the first pass)

1. **The rest of the cash.** Add two fields to the kickoff form (collected at kickoff: yes/no, and the amount) and have Make write them somewhere structured. The cleanest landing is a row in the B2B `transfers` table linked to the deal, because the cockpit already counts that ledger as confirmed cash.
2. **The EOD sheet.** Share `1K10In9fyYa_hN7X4z_HGcCuoxGBRZoF4q7Z0r2SalZE` with `claude@studied-handler-508106-m5.iam.gserviceaccount.com` (viewer), and confirm it is the sheet that pulls in everyone's end of day. The read is built; the Team tab switches to it once it can see the tabs.

## Changed on 2026-09-21, third pass (the twenty-point batch)

- Cash collected now includes the bank: the CBK Online CSV upload on the Money tab, parsed and verified on a real statement (120 lines, totals reconcile to the footer). Whop payouts, Tap settlements and Mahara's own transfers are never cash. Refunds can be logged by hand. Expenses come off the statements by category with an editable exclusion list. Days since the last statement is on the tab and warns past 7.
- Delivery counts bookings three ways and lead to booking three ways, judges close rate on Mahara OS outcomes, lists past appointments with no outcome, and uses Aziz's status rule. Last 7 full days: 42 bookings, all confirmed; cost per confirmed booking $61.77.
- Speed to lead on working hours, on the Calls tab (5 h 37 min working against 16 h 38 min on the plain clock, last 7 days) and on the Marketing tab (4.2 h working against 20.5 h, month to date), with the hours editable on the Calls tab.
- Working hours per person on the Team tab; extensions, LTV, time to first launch (43 days on average, median 26, over 34 clients) and average retainer ($1,541.50 over 8 cards) on Client success; projected MRR ($12,332) and collection rate on the Backend tab.
- Every payment attributed to a client feeds `cockpit_client_payments` and the LTV write; every section and every metric land in Supabase each refresh.
- One timeframe control per tab; notes folded under one line; four to six tiles per card with a facts line for the rest.

## Changed on 2026-09-21, second pass (the twelve-point spec)

- Speed to lead now counts only calls by a sales rep on the roster. Month to date it is unchanged (22 of 71 leads called, median 20.5 hours) because every Maqsam call on record is a rep's.
- Show rates, both close rates and the three cancel rates are the dashboard's own counts, put on tiles: month to date, demo show rate 62.5%, intro show rate 53.5%, close rate 20% on all demos shown and 20% on qualified demos, cancellations 2.3% (0 of 71 intros, 2 of 16 demos).
- Front-end ROAS is 0.48x month to date ($1,000 of deposits on $2,070 of lead-gen spend) against a contracted ROAS of 5.8x. Last month: 1.13x against 12.0x. The gap is the kickoff cash nobody records yet.
- Lead to booked call is per lead: 55 of 71 leads this month (77.5%), 202 of 266 last month (75.9%).
- Where leads come from: month to date 65 ads, 1 organic, 5 assumed ads. The GoHighLevel attribution field is empty on most contacts.
- Reach and frequency are read live from Meta per timeframe: August, lead-gen 3.6x over 167,625 people, retargeting 22.1x over 2,125 people.
- Every payment in over 12 months has a side: $41,482 front end ($24,950 deposits, $16,532 rest of the cash), $19,597 back end, $98,344 not attributed across 82 payments, mostly Whop payers paying under a personal name that matches no form email and no card. The Money tab's payer mapping card is where those get tied. Tap money joins once the live key is set on the deployment.

## Changed on 2026-09-21

- Leads are the ROAS tags. Month to date this gives 71 leads (23 qualified, 48 unqualified) against the dashboard's 142, so cost per lead reads $29.16 instead of $14.58; 33 contacts are not ready and 64 have no ROAS tag yet.
- Speed to lead is the first Maqsam call: month to date, 22 of the 71 leads have one, a median 20.5 hours after creation, none within five minutes. Either the team's first touch is on WhatsApp, or the Maqsam import covers only part of the team. Worth checking before reading it as performance.
- The Ads tab dates calls the way the dashboard does; the 90-day refund and average-contract figures are 90 days again.
