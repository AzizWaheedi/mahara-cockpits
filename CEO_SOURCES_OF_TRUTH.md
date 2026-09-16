# Mahara CEO cockpit: where every number actually comes from

Written 2026-09-16. Everything below was checked against live data on that day, not copied from an earlier document.

**This document replaces CEO_COCKPIT_PLAN.md on two things: which system is the source of truth for each number, and the unit economics.** That plan was written on 2026-09-14 and much of what it marked "unverified" has now been verified, some of it the other way round. Keep [CEO_COCKPIT_PLAN.md](./CEO_COCKPIT_PLAN.md) for the full catalog of 232 metrics and their IDs. Where the two disagree, this one is right.

What was checked: the B2B dashboard database, the Creative Triage database, the ClickUp client board, the Convex cockpit deployments, the Google Sheets the cockpit reads, and the Typeform forms. Where something could not be checked, or where two checks disagreed, it says so.

---

## 1. The one page answer

### Your front end, meaning your own marketing and sales

**The B2B dashboard database is the source of truth, and it is the healthiest part of the business.** Every number from the first ad impression to the signed contract lives in one place and the cockpit reads all of it correctly today: 4,931 leads since 2026-06-18, 2,578 sales calls since 2025-10-12, 48 signed deals since 2026-04-01, and Meta ad spend by day since 2026-03-13. September so far: $2,070 of lead generation spend, 140 leads at $14.79 each, 62 intro calls booked, 10 demos booked, 2 closes, $12,000 contracted.

Two real gaps sit inside that. The 16 deals signed in April have no contract value recorded, so April reads as zero money from a month that actually signed the most clients of any month. And the rep scorecard, which is the only place a closer's personal numbers live, failed on the cockpit's last run with a permission error, so the reps table on your screen is empty right now even though the data behind it is fine.

### Your back end, meaning delivery, the call centre and client success

**Your summary was "the backend is basically ClickUp and the database", and that is about three quarters right.** It needs one correction and one addition.

The correction: ClickUp is the source of truth for **who a client is and what stage they are in**, and nothing else. The money fields on those cards are not a source of truth. The LTV field is filled on 17 cards out of 65 and is a number you typed once from memory, not a running total. The Payment Method field is filled on zero cards out of 65. Churn Date, Churn Reason, Churn Type and Paused On are each filled on exactly one card, and that one card is the internal test card from 2026-09-14. So when you ask ClickUp why a client left or how much they paid, it has no answer for any real client.

The addition: for delivery numbers, the truth is not in ClickUp at all, it is in the **Creative Triage database**. Client ad spend, leads and bookings per client per day live there, 11,684 daily rows going back to 2026-03-13. So does the call centre, and that is your single deepest record of anything: 13,836 dialer calls going back to 2025-06-23, fifteen months. The call centre is the best measured part of the company.

So the accurate version is: **ClickUp for who the client is, Creative Triage for what was delivered to them, the B2B database for how they were won and what they paid through Whop, and nothing at all for what they paid any other way.**

### The one sentence that matters most

Roughly forty percent of your cash never touches Whop, and no system anywhere records it. That single hole blocks cash collected, lifetime value, gross margin, and your one to four target. Everything else in this document is smaller than that.

---

## 2. What is the source of truth, domain by domain

### 2.1 Your own marketing and sales (the front end)

| Number | Source of truth | Exact place | History today | Trust | Fix if not |
|---|---|---|---|---|---|
| Leads generated | B2B database | `public.leads`, dated by `created_at` | 4,931 rows, 2026-06-18 to 2026-09-15, 3 months | Yes | None needed. Note leads include WhatsApp, organic and manual contacts, not only ad leads |
| Cost per lead, ad spend, impressions, clicks | B2B database | `public.meta_ad_snapshots`, by `date` | 11,684 ad rows equivalent, spend by month from 2026-03 to today | Yes | None needed. Retargeting is reported separately from lead generation spend, so never add them twice |
| Intro calls booked and shown | B2B database | `public.calls` | 2,578 rows, 2025-10-12 to 2026-09-16, 11 months | Yes | None needed |
| Demo show rate | B2B database | `public.calls` status | Same 11 months | **Partial** | 10 of 16 demos due this month have no outcome marked, and the dashboard counts an unmarked past call as a show, so the published show rate of 62.5% is too high. Someone has to mark demo outcomes |
| Deals signed and contracted value | B2B database | `public.closed_deals.contracted_revenue`, dated by `submitted_at` | 48 deals, 2026-04-01 to 2026-09-12, 6 months, $181,500 | **Partial** | Value is missing on all 16 April deals. Everything from May onward is complete |
| Payment plan agreed at signing | B2B database | `public.closed_deals.payment_structure` | 47 of 48 deals filled | Yes | None needed. This is more reliable than the ClickUp Payment Plan field and should be the cross-check |
| New MRR at signing | **Nothing. The column exists and is empty** | `public.closed_deals.new_mrr` | Zero values ever written, all 48 rows | **No** | Either make it required on the closing form or delete it and work MRR out from the payment plan and contract value |
| Closer and setter performance | B2B database, but it is not reaching your screen | `public.b2b_rep_scorecard()` joined to `public.sales_reps` | 9 reps on file, works when run directly: Ahmed 15 booked 9 shown 1 close, Tahrir 71 booked 38 shown, Aziz 1 close, Ghanim 1 shown | **Partial** | The cockpit's own database login was refused on the last run with a permission error while the same query runs fine with a full login. This is a database permission to grant, not a data problem. Your reps table is blank until someone grants it |
| Monthly revenue target | B2B database | `public.monthly_targets` where metric is revenue | 8 months, 2026-01 to 2026-08. **No row for September 2026** | **Partial** | Add the September row or the pace tile stays dead. Also settle the size: this table says $13,000 a month and your own notes say $100,000 a month, an eight times difference |

### 2.2 Client delivery (the back end, what clients get)

| Number | Source of truth | Exact place | History today | Trust | Fix if not |
|---|---|---|---|---|---|
| Client ad spend, leads, cost per lead | Creative Triage database | `public.ads_daily_snapshots` joined to `public.clients`, converted to dollars | 11,684 daily rows, 2026-03-13 to 2026-09-16, 6 months | Yes | None needed. September month to date across all clients: $4,470.85 spent, 348 leads, $12.85 per lead |
| Bookings and cost per booking | GHL through the media buyer sync | GHL appointments for Done For You clients | Live, month to date 57 bookings at $69.97 each | **Partial** | Bookings only exist for 12 of the 13 clients with spend, because one has no working GHL connection. Also the sync only reads appointments up to now, so a booking made for next week is invisible until that day arrives and the most recent days always read low |
| Whether spend is on the board | Media buyer ads board plus Meta | Ads Management board | Live | **Partial** | $512 spent in the last 7 days sits on 6 campaigns that have no card on the board and is not in any of your numbers. Also, a campaign taken off the board loses its last 30 days of ad rows at the next sync, so past totals can silently drop |
| Launch on time | ClickUp card created date | Client card creation, launch tasks on the ads boards | Live, 7 launches in flight | **Partial** | 5 are stuck past the 7 day line, the oldest 80 days: Qatar Technology 80 days, Render 49, Ghazzawi.sa 44, Marble and more 34, Alkhalil 27. Four of the five are stuck because no open launch task exists on the board, and Render has no ad account recorded at all |
| Is client ad money your cost | Settled: **it is not** | Compared Meta spend on your own account against the bank line | Verified for June 2026 | Yes | Your bank shows $3,807.82 of ad spend in June, your own lead generation Meta spend was $3,686.61, and client media for the same month was $10,993.10. So the bank line is your own marketing. Client media must never enter your costs |

### 2.3 The call centre

| Number | Source of truth | Exact place | History today | Trust | Fix if not |
|---|---|---|---|---|---|
| Dials, connections, talk time | Creative Triage dialer store | `mahara_reporting.facts`, source maqsam, kind call | **13,836 calls, 2025-06-23 to 2026-09-15, fifteen months.** The deepest history in the business | Yes | None needed. Last 7 days: 254 dials, 159 connected, 62.6% connect rate, 313 talk minutes, 53 conversations over 90 seconds |
| Speed to lead | Same store joined to GHL leads | Dialer calls matched to lead phone numbers | **Starts 2026-09-12 only**, the first day calls carried the lead phone | **Partial** | Four days of history. Current reading is a median of 733 minutes and only 1.25% of leads called within 5 minutes, off a sample of 80. That is a real and bad number, but it is four days old, so watch it before acting on it |
| Leads not called at all | Same | Leads with no matching call | Since 2026-09-12 | Yes | 43 of 157 leads from Done For You clients are more than a day old with no call. These are deliberately left out of the speed to lead median, so the median flatters you |
| Which client a call belongs to | Same, matched by phone | Lead phone on the call record | Since 2026-09-12 | **Partial** | Two clients have a blank Service Mode so their leads are excluded entirely: Ardon and Olivar Design. A CSM filling that field fixes it |
| Agent coverage | Dialer accounts | 3 Maqsam accounts the dialer imports | Live | **Partial** | Only 3 accounts are imported. A new agent is invisible until the dialer adds their account. Also one account, Abdulaziz's, mostly takes inbound calls, so its row is not a dialing shift and should not be scored as one |
| The old Maqsam import in the B2B database | **Do not use it** | `public.maqsam_client_calls` | Stops 2026-07-18 | **No** | It is a one off import, two months stale, and is not what the live numbers come from |

### 2.4 Clients, churn and client success

| Number | Source of truth | Exact place | History today | Trust | Fix if not |
|---|---|---|---|---|---|
| Who is a client and what stage | ClickUp | List 901816559981, Client Status field | 65 cards live: 15 Active, 5 Paused, 23 Stopped, 15 to be contacted, 4 Ready For Launch, 2 Launch Booked, 1 Brand Blueprint Booked | Yes | Three tidy ups block a clean count: North Gulf Systems is on the board twice, Zeiad Playing Account is an internal account marked Active, and the internal test card from 2026-09-14 is being counted as a churned client |
| Who is churning, named and dated | Client success cockpit daily roster | `rosterDays` table, one row per day | **8 days, 2026-09-09 to 2026-09-16, no gaps** | **Partial** | It works and it is honest, but history starts 8 days ago. Comparing yesterday to today recovers exactly two real changes ever recorded: Decor Plus went from Launch Booked to Stopped on 2026-09-10, and Greystone Contracting went from Onboarding Booked to Paused on 2026-09-10 |
| The churn event log the cockpit was supposed to keep | **Broken. The table is empty and cannot fill itself** | `churnEvents` in the client success cockpit | **0 rows** | **No** | The code compares today against the newest row it can find, but today's row is created just after midnight and then updated all day, so it ends up comparing today against itself and stops before writing anything. Any status change made during a working day is silently swallowed. The fix is small: compare against yesterday's row instead. Until then pause days, extensions and same day losses can never be counted |
| When a client actually left | **Nothing** | ClickUp Churn Date field | Filled on 1 of 65 cards, and that one is the internal test card | **No** | 22 real stopped clients have no leaving date of any kind. The card's own last updated date is useless too, because a bulk edit on 2026-09-14 touched every card. This is a 22 cell typing job that unlocks tenure, average client life and any cohort view |
| Why a client left | **Nothing** | ClickUp Churn Reason field, plus the termination survey | Filled on 1 of 65. The survey has 3 responses ever, all tests, two of them yours from March | **No** | The automation works, it was proven end to end on 2026-09-14, it has just never run on a real client. Make the survey compulsory on every exit, then somebody backfills the 22 historic ones from memory and the payment sheet |
| Paused clients and how long they have been paused | ClickUp for the fact, **nothing for the clock** | Client Status Paused; Paused On field | 5 clients paused: AIVE designs, Olivar Design, Greystone Contracting, Uvan and Evan, شركة كيسان. Paused On filled on **zero** of them | **No** | Your rule is that a pause over 14 days ends the engagement, and there is no clock running on any of the five. The only pause start anyone can prove is Greystone, from the daily roster, 6 days as of today. Olivar Design's own Resume On date of 2026-09-03 passed 13 days ago and it is still paused |
| Extensions granted | Typeform extension form | Form gqBcyK6g | **Live for 164 days. 2 responses, both tests.** Real extensions on record: zero | **No** | Two things. First, CSMs have to actually submit it. Second, the cockpit matches extensions to clients by comparing typed names, which matched nothing even on the one test row. The form now carries the ClickUp card id as a hidden field and 64 of 65 cards carry a pre filled link, so switching the match to the card id is a small verified fix |
| Renewals at 90 days | **Nothing anywhere** | No form, no field, no table, in any system | Zero recorded, ever | **No** | There is no renewal form in the whole Typeform workspace, no renewal list in ClickUp, and no renewal column in either database. The Next Contract Renewal field is filled on 1 of 65 cards and that card is a stopped client with a date seven months in the past |
| When the 90 day term ends | ClickUp Launch Date plus 90 days | Launch Date field | Filled on 32 of 65 cards, dates 2026-04-01 to 2026-09-13 | **Partial** | Only 4 live clients are past day 90 today: Joe and Sera at 141 days, نهوض نجد at 127, شركة كيسان at 132, Olivar Design at 92. Twelve more cross day 90 in the next two months. **Never use the Days Since Launch columns on the board, they are broken**: a client launched 3 days ago reads 1,351 days |
| Client health and risk | Cockpit's own scoring | Pulse inputs, ClickUp happiness, payment dates, ad performance | Live | **Partial** | The score works but happiness is stale on exits: 6 of the 23 stopped cards still read Happy or Very Happy. Also 8 active or onboarding clients have no Last Contact date so silence cannot be judged for them |
| Portal usage | Mahara OS portal | `mahara_portal_documents` directory | Live, 18 sessions, 14 people, 11 clients | **Partial** | The portal deletes sessions when they expire, so there is no login history at all, only a snapshot of right now. Also 23 cancelled clients still have portal access |

### 2.5 Money

| Number | Source of truth | Exact place | History today | Trust | Fix if not |
|---|---|---|---|---|---|
| Cash collected through Whop | B2B database | `public.whop_payments`, net amount where status is paid, dated by `paid_on` | 182 rows, 124 paid. $117,052.01 net over 2025-09-14 to 2026-09-12, thirteen months | Yes | Correct for what it covers. Exclude the eight $1 test payments on your own two email addresses |
| Cash collected, all rails | **Nothing. Roughly 40% of your money is invisible** | Would belong in `public.transfers`, which has the right shape and no client payments in it | Zero rows of off Whop client cash, ever | **No** | August is the only month with both numbers, and Whop's $22,333 is about 60% of the hand kept total. 21 of your 48 signed deals, worth $86,500 of contract value, have no Whop payment of any kind. Someone has to log every Tap link, bank transfer and cheque the day it arrives |
| Refunds | B2B database | `public.whop_payments.refunded_amount` | Exactly 2 refunds in 13 months, $1,266 in April and $1,666 in August, $2,932 total | Yes | Fine today. It will break the first time a refund crosses into a new month, because the cash is booked back on the original charge day |
| Failed and open charges | B2B database | `public.whop_payments` where status is open | 58 rows, $96,363, across 20 payers. Last 30 days: 2 charges, $3,000, both on Ardon | Yes | Show the 30 day number, never the $96,363. That figure is mostly the same failed charges retried over and over and would read as money owed by a factor of ten too high |
| MRR | ClickUp, and the cockpit does not read it at all | Custom field 48eb6023 on the client list | Filled on 20 of 27 live cards, $35,331 total. On Active only, 14 of 15 filled, $23,665 | **Partial** | Three things. Nothing in the whole codebase reads this field, so it is not on your screen. Seven live cards are blank including two brand new signings, Ardon and mergestudio.kw. And 15 of the 27 live clients are on Paid In Full or Split Pay, which are not monthly money, so adding the field up mixes recurring and one off cash |
| MRR over time, and net revenue retention | **Nothing. No system stores MRR by day** | Would be the cockpit's daily table | The daily table holds 26 metrics for exactly 2 days, 2026-09-15 and 2026-09-16, and none of them is MRR | **No** | The plan assumed a snapshots table existed. It was never built. Cheapest fix that unlocks the most: add the MRR total to the daily writer that already runs every 15 minutes. First real month to month comparison lands one month later, so the sooner it starts the better |
| Lifetime value per client | ClickUp LTV field, and it is not a lifetime, it is a number you typed once | Custom field 11d70e58 | Filled on 17 of 65 cards, $55,499 total, all entered around 2026-09-13 | **No** | Checked against Whop: 4 of the 17 agree exactly, 3 are badly out, and 8 have no Whop payment at all. Meanwhile your biggest real payer ever, AMHECO at $8,479, has an empty LTV field, as do Life Depth, Render, AEA Designs and Mass Design |
| Company expenses | B2B database, one month only | `public.expenses` | 126 rows, **June 2026 only**, last loaded 2026-07-06, $42,744.69 | **Partial** | Of that total, $20,462 is card top up lines that are money moved, not money spent, so real June spend was $22,282. There is no rent, no utilities, no accounting, no legal and no government fee line anywhere. One month means no trend and no run rate |
| Payroll | **Nothing** | The expenses "salaries" line is a bank label, not a payroll | 23 rows, $8,122, June only, and the only two vendors are Payoneer and a card top up service | **No** | Most of those rows are $6 to $39 card top ups. Only two lines of $3,248 look like actual wages. No person, no role, no rate, no client. A monthly file of person, role, cost and month, about 8 rows a month, is the whole ask |
| Which person works on which client | **Nothing** | Checked ClickUp time tracking, the cockpit's member records, and the EOD reports | ClickUp time tracking returned **zero entries** for the whole workspace across June to September. The cockpit's member records have an empty client list on every row | **No** | Either switch ClickUp time tracking on, or accept one monthly sheet of person, month, client and rough percentage of time. Without one of the two there is no per client cost, ever |
| Invoices and money owed | Churn Tracker sheet, and the cockpit cannot read it | Tab 07 Invoice Register | 14 invoices, $32,745, 16/07/2026 to 01/09/2026, so 7 weeks and it stops 15 days ago | **Partial** | It is the only invoice ledger that exists and the only money source already carrying a ClickUp card id on every row. Currently pending: $10,747 across six invoices. Its notes column is also where $12,500 of off Whop cash is written down in plain English |

### 2.6 The machine, meaning is the data arriving

| Thing | State today | What it costs you |
|---|---|---|
| All eight cockpit sections | All reporting healthy, refreshed 2026-09-16 | Nothing. The plumbing works |
| Google Sheets reading | **Failing.** The last error is a 404, meaning a sheet the cockpit asks for no longer exists at that address | Any number that was meant to come from a sheet is missing, not zero |
| Churn Tracker workbook | **The cockpit is locked out.** The cockpit's own service account gets permission denied, while it reads the DATABASE sheet fine with the same login | Your monthly revenue history, the payment log, the invoice register and the referrals tab are all invisible to the cockpit. This is one share click to fix |
| Instagram assets feed | Broken since 2026-09-06 | Creative asset numbers are 10 days stale |
| Wistia feed | Broken since 2026-08-09, server returning an internal error | Video numbers are 5 weeks stale |
| Fathom calls feed | Broken since 2026-09-12, returning access refused | Call recording and call analysis numbers stopped 4 days ago |
| Creative Triage scheduled jobs | Recovered, but there were 26 failed runs in the last 24 hours | Numbers were unreliable during the 2026-09-15 outage. Also worth knowing: a job marked succeeded only means the call went out, not that the sync worked |
| Board KPI columns job | Last ran 527 minutes ago, about 9 hours | Board numbers are most of a day behind |

---

## 3. Unit economics: the numbers you asked for

Read this section knowing one thing up front. Every revenue figure here is a **floor**, because off Whop cash is not recorded. Every cost figure here is **incomplete**, because there is no payroll. So the honest output is a range, and the width of that range is itself the finding.

### 3.1 Revenue

**Recommended definition:** dollars actually received in a Kuwait calendar month, after refunds, before the payment processor takes its cut.

**Best number today:** Whop paid cash, $117,052.01 net over thirteen months, 2025-09-14 to 2026-09-12. By month: April $16,531, May $12,998, June $11,949, July $14,864, August $22,333, September to the 12th $4,000.

**Confidence: partial, and specifically about 60% complete.** August is the only month where a hand kept total exists to compare against, and Whop is about 60% of it. Two separate tabs in your own Churn Tracker disagree with each other about August by $2,499, so even the hand kept version is not settled.

**What makes it solid:** one person logs every Tap, bank and cheque payment the day it lands, into `public.transfers`, which already has exactly the right columns and is sitting empty. Then cash is Whop plus transfers, and it is a real number for the first time.

### 3.2 Churn

**Recommended definition:** a launched client who stops paying and does not come back, counted against launched clients only. Clients who leave before launch are a sales and onboarding problem, not a retention one, and should be counted separately.

**Best number today:** September logo churn is **1 out of 22, which is 4.5%**, computed from the daily roster. But the one client lost, Decor Plus, was never launched. **On launched clients, September churn so far is zero.**

**Confidence: partial.** The daily roster is honest and has no gaps, but it starts 2026-09-09, so no complete month exists yet. October 2026 will be the first month you can publish without an asterisk. There is no usable monthly churn history at all before September: your Churn Tracker has data in three month rows out of twelve, and its January row contradicts its own payment log in the same workbook.

**Revenue churn is not computable at all.** 21 of the 23 stopped clients have no MRR recorded on the card, so adding up lost MRR returns $3,333, which would be wrong by construction.

**What makes it solid:** three things, in order. Fix the churn event log so changes made during a working day stop being swallowed. Fill Churn Date on the 22 stopped cards. Stop clearing MRR when a client leaves, freeze it instead.

### 3.3 Extensions

**Recommended definition:** a CSM formally granting extra time, logged on the extension form, matched to a client by ClickUp card id, covering from the submission date forward by the chosen number of weeks.

**Best number today: zero, in 164 days.** The form has two responses ever and both are tests, one saying "Test / Test / lol" and one from the 2026-09-14 internal test.

**Confidence: high that the number is zero, and that is the problem.** Zero here means nobody filled the form, not that no client was extended. The operational reality is that a CSM grants an extension by moving the Next Payment Date on the card, and ClickUp keeps no field history, so that move leaves no trace anyone can recover.

This has a live cost right now. The cockpit refuses to tell a CSM to pause a client if a valid extension exists. Since no extension ever exists, three clients are currently being flagged for pausing with no protection.

**What makes it solid:** switch the match from typed names to the hidden card id, which is already on the form and already on 64 of 65 cards. Then make the form the only accepted way to stop a pause.

### 3.4 Lifetime value

**Recommended definition:** total cash received from a client across their whole relationship, from first payment to last.

**Best number today: there are three, and the spread between them is the story.**

| Reading | Per client | What it is |
|---|---|---|
| Contract value at signing | **$5,671.88** | $181,500 across the 32 deals that recorded a value. What you were promised |
| Your LTV field | **$3,264.65** | $55,499 across 17 cards. What you believe you collected |
| Whop cash actually seen | **$1,560.59** mean, $1,000 median | $117,044 across 75 real payers. What can be proved |

**Confidence: low, and the reason is precise.** Only 47 of 116 paid Whop rows, worth 47% of the cash, can be matched to a client card at all. The match is by email address, and email is not a stable identity: the same client pays under two addresses in at least two cases, and the card email differs from the paying email in at least two more. On top of that, 47 of 75 payers made exactly one payment and 60 of 75 paid inside a single calendar month, while 27 clients are live and the MRR field adds to $35,331 a month. Second month money is going somewhere Whop cannot see.

**What makes it solid:** a ClickUp card id on every payment row. The payments tab in your DATABASE sheet already has a Clickup ID column and it is already filled on the 17 rows in there. It just has no real payments in it yet.

### 3.5 CAC against lifetime gross profit, and your one to four target

**Recommended definition of CAC:** all money spent to win a new client in a month, divided by clients signed that month. That means ad spend plus the cost of the people who sell. See decision 5 below.

**CAC on ad spend alone, which is what can be computed today:**

| Month | Ad spend | Clients signed | Cost per client |
|---|---|---|---|
| April 2026 | $1,937.18 | 16 | $121.07 |
| May 2026 | $2,965.63 | 9 | $329.51 |
| June 2026 | $3,686.61 | 5 | $737.32 |
| July 2026 | $4,957.63 | 6 | $826.27 |
| August 2026 | $6,091.81 | 10 | $609.18 |
| September to the 16th | $2,154.08 | 2 | $1,077.04 |
| **Six months blended** | **$21,792.94** | **48** | **$454.02** |

Read that column downward. Your cost to win a client has gone from $121 in April to $1,077 this month, while ad spend has tripled. Some of that is September being half over, but the trend across June, July and August is real. And there is no lead generation campaign running in Meta at all right now: the last day with lead generation spend was 2026-09-09, a week ago.

**Now the ratio.** Gross profit needs a margin, and no delivery cost exists to compute one, so this uses your own 60% target as a stated assumption.

| Using this as lifetime revenue | Gross profit at 60% | Against $454 CAC | Verdict |
|---|---|---|---|
| Contract value, $5,672 | $3,403 | **1 to 7.5** | Comfortably past target, if clients pay their contracts |
| Your LTV field, $3,265 | $1,959 | **1 to 4.3** | Right at your target |
| Whop cash proved, $1,561 | $936 | **1 to 2.1** | Half of target |

**The honest answer: you are somewhere between 1 to 2 and 1 to 7.5, most likely near 1 to 4.3, and the width of that range is entirely the off Whop cash hole.**

One more thing you should see, clearly labelled as a made up illustration because no payroll data exists. If the people who sell cost roughly $6,000 a month, that is about $33,000 over these six months, and total acquisition cost becomes $54,793 across 48 clients, or **$1,141 per client**. The three ratios then become 1 to 3.0, 1 to 1.7 and 1 to 0.8. **The answer flips from healthy to underwater on a number nobody has written down.** That is why the payroll file matters more than it sounds.

**What makes this solid:** the off Whop payment log, and a monthly payroll file. Those two alone turn every figure in this section from a range into a number.

### 3.6 Gross margin per client

**Not computable today, for any single client, not even approximately.** The revenue side is 47% attributable and is a floor. The cost side has no payroll, no time records, one month of company spend, and a salaries line that is actually a bank label.

**Recommendation until that changes:** show cash received per client from Whop, labelled as a floor, alongside how long they have been a client. If a profit number is demanded, apply **one company wide assumed margin**, printed in words on the tile: "gross profit shown at an assumed 60% margin. Mahara has no per client cost source, so this is an assumption, not a measurement." Do not let the assumed margin vary between clients, because nothing in the data varies between clients. Your 60% target is a goal and must never be presented as a measurement.

---

## 4. What is broken right now, and what it costs you

Ordered by how much it stands between you and a real number.

### The big ones, which need somebody to start filling data in

**1. Off Whop cash is recorded nowhere.** About 40% of your money. It blocks cash collected, lifetime value, gross margin, receivables, and the one to four ratio. 21 of 48 signed deals, $86,500 of contract value, have zero Whop payments. Documented examples sitting in your invoice notes right now: Ocean Home paid $6,000 with only $500 on Whop, City Wood the same, منشآت خالدة has no Whop record at all and paid $4,500. That is $12,500 written down in prose in a sheet the cockpit cannot read. **Fix: one named person writes one row per payment the day it lands, into `public.transfers`. The table exists and is empty.**

**2. There is no payroll anywhere.** No person, no role, no cost. It blocks gross margin, real CAC, and cost per client entirely. **Fix: one file a month, person, role, monthly cost, month. About 8 rows.**

**3. Nobody records who works on which client.** ClickUp time tracking returned zero entries across the whole workspace for June through September. **Fix: switch time tracking on, or accept a monthly sheet of person, month, client, rough percentage.**

**4. Churn Date is empty on 22 of 23 stopped clients.** Tenure, average client life, cohort views and revenue churn all depend on it. **Fix: 22 cells, one afternoon.**

**5. Churn Reason is empty on every real client.** The survey automation works and was proven on 2026-09-14, it has just never run on a live exit. **Fix: make the survey compulsory on exit, then backfill the 22.**

**6. Paused On is empty on all five paused clients.** Your 14 day pause rule has no clock running on anybody. Olivar Design's own resume date passed 13 days ago and it is still paused. **Fix: date the five by hand, then make the pause form compulsory.**

**7. Payment Method is filled on zero of 65 cards.** Never once set. This is the cheapest possible fix for the whole off Whop problem, one dropdown click per client, and it would immediately tell you which 27 live clients pay by Tap, bank or cheque. **Until it is filled, do not put a payment mix tile on the screen, it would render as one empty bar.**

**8. MRR is blank on 7 of 27 live cards** including two brand new signings with signed contracts, Ardon and mergestudio.kw. **Fix: fill seven cells.**

### The quick technical fixes

**9. Share the Churn Tracker with the cockpit's service account.** One click. Three separate checks confirmed permission denied on `claude@studied-handler-508106-m5.iam.gserviceaccount.com` while the DATABASE sheet reads fine with the same login. It unlocks your revenue history, payment log, invoice register and referrals tab.

**10. Grant the cockpit's database login access to the rep scorecard.** Your closer and setter table is blank on screen today purely because of this. The same query returns four reps instantly with a full login.

**11. Fix the churn event log.** The code compares today's roster against the newest row it can find, which after the first sync each day is today's own row, so it stops before writing anything. Comparing against yesterday instead is a small change and it unlocks pause clocks, extension counts and same day loss detection.

**12. Match extensions by ClickUp card id, not by typed name.** The current name matching found nothing even on the one test row, and it has a second flaw: a four character floor means a short card name could be swallowed by an unrelated form entry. The card id is already hidden on the form and pre filled on 64 of 65 cards.

**13. Add the September 2026 revenue target.** The pace tile is dead this month without it.

**14. Fix the Google Sheets 404.** A sheet the cockpit asks for is gone or renamed.

**15. Three dead feeds:** Instagram assets since 2026-09-06, Wistia since 2026-08-09, Fathom since 2026-09-12.

**16. Six campaigns spending $512 a week are not on the ads board**, so that money is invisible in every delivery number.

**17. Board tidy up:** North Gulf Systems is on the board twice, Zeiad Playing Account is an internal account marked Active, the 2026-09-14 test card is being counted as a churned client, three Creative Triage rows point at ClickUp ids that are not real cards including one whose id is the text "11", and eleven clients your sheet marks cancelled are still parked in the sales stage on the board. That last one fully explains the "32 cancelled versus 23 stopped" mismatch you have been seeing. **The portal's cancelled count is not a churn count and should never be shown as one.**

**18. Never use the Days Since Launch columns on the ClickUp board.** A client launched three days ago reads 1,351 days. Work the term out from the Launch Date in code.

---

## 5. Decisions only you can make

Each one has a recommended default. **Aziz decided four of these on 2026-09-16, recorded below. The rest still stand open.**

### Decided on 2026-09-16

| Decision | What Aziz chose | What gets built |
|---|---|---|
| 1. Churn rule | Logo churn, launched clients only (the recommended default) | A client counts as churned only after they launch and then stop. Losses before launch are reported separately as lost before launch. September launched churn is zero. |
| 4. Completed 90 day term | **Churn unless renewed**, which is NOT the recommended default | A completed term is not automatically a success. The client counts as churned at term end unless a renewal is recorded. See the renewal rule below, which is what makes this computable. |
| 5. What counts in CAC | **Ad spend only, permanently**, which is NOT the recommended default | CAC is Meta spend divided by clients signed. Every place it appears carries the label "ad spend only, the cost of the people who sell is not included", so the 1 to 4 ratio is never read as the full picture. |
| Manual payments | Cash only, with an optional deal field | A hand entered payment adds to cash collected. If it is a new deal, the contract value can be entered alongside it and adds to contracted. The two never double count. |

**The renewal rule, forced by decision 4.** Nothing in any system records a renewal today: there is no renewal form, no renewal field and no renewal table. Taken literally, "churn unless renewed" would mark about twelve of the fourteen active clients as churned within two months, which would be false. So renewal is evidenced by money: **any payment dated after the client's term end counts as the renewal**, from Whop, from Tap or hand entered. This is the only renewal evidence that exists. It is imperfect in two known ways, both of which must stay visible on screen: a client who renews but pays late looks churned until the payment lands, and a client paying in instalments against the original contract can look renewed when they are not. A real renewal form or a renewal date field on the client card would replace this rule and should be treated as the fix worth doing.

### Still open

### Decision 1: the churn rule

**Recommended default: logo churn only, counted on launched clients.** A client counts as churned when they stop paying and do not resume. Clients lost before launch are reported separately as "lost before launch", which is a sales and onboarding number, not a retention one.

Why: both September losses, Decor Plus and Greystone Contracting, were pre launch. Under this rule September launched churn is zero and pre launch losses are two, which is a truer picture than a blended 4.5%.

Revenue churn stays switched off until MRR is filled and frozen at exit.

### Decision 2: the paying rule, meaning who counts as a client

**Recommended default: Client Status is Active or Paused, and the card has a Launch Date. That is 18 clients today.**

Why: the cockpit currently counts 21 to 22 as paying because it treats every stage that is not an exit stage as paying, which sweeps in Launch Booked, Ready For Launch and Brand Blueprint Booked. Only 14 clients are actually Active. Eighteen is the honest middle: it counts paused clients, who are still on the books, and excludes clients who have not started.

### Decision 3: how a paused client is treated

**Recommended default: paused counts as a client for 14 days, then counts as churned. The clock starts on the day the roster saw them turn Paused.**

Why: the 14 day rule is already in your code and your pause form already tells the client that a pause over 14 days ends the engagement. One internal document says 15 days, which should be corrected to 14 for consistency.

Today this gives: Greystone Contracting paused 6 days, not yet over the line. The other four have no known pause start. **Recommendation: date those four by hand this week, otherwise they sit in limbo forever.** Note that your pause form also makes the client agree the 90 day term keeps running during a pause, which is worth keeping in mind because it means a paused client can quietly reach term end and leave without ever being counted.

### Decision 4: how a completed 90 day term is treated

**Recommended default: a client who stops at or after day 90 from their Launch Date has completed the term and does not count as churn. A client who stops before day 90 counts as churn. A client with no Launch Date can never be a term completion.**

Why this is urgent: twelve of your fourteen active clients cross day 90 within the next two months. This rule decides which side of the churn line each of them lands on, and right now nothing decides it.

Be aware this rule has a real business consequence, not just a reporting one. Under it, a client who finishes the term and quietly leaves shows up nowhere as a loss. If you want that visible, the answer is a renewal rate sitting next to churn, and that needs a renewal event, which is decision 5's neighbour and does not exist yet.

### Decision 5: what counts in CAC

**Recommended default: CAC includes all Meta spend, meaning lead generation plus retargeting, plus the fully loaded monthly cost of everyone whose job is selling, meaning closers and setters. It does not include delivery staff, tools, or client media.**

Why: ad spend alone gives $454 per client. That number is real but it flatters you, because your closers and setters are a genuine cost of winning a client. Until a payroll file exists, publish the ad only figure with the words "ad spend only, sales payroll not included" printed on the tile, so nobody mistakes it for the full picture.

### Decision 6: the gross margin assumption

**Recommended default: 60%, one number for the whole company, printed on the tile as an assumption.**

Why: 60% is your own stated target, so using it is at least consistent with how you already think about the business. But it is a goal, not a measurement, and nothing in the data supports varying it per client. The tile should read: "gross profit shown at an assumed 60% margin. Mahara has no per client cost source, so this is an assumption, not a measurement."

Once payroll and a time split exist, this comes out and a measured margin goes in.

### Three smaller ones worth settling at the same time

**Does MRR include paused clients?** Recommended yes, consistent with decision 2, and shown as a separate line so you can see it.

**How do Paid In Full and Split Pay convert to MRR?** Recommended: contract value divided by 3 for a 90 day programme, divided by 2 for split pay. Fifteen of your 27 live clients are on one of these, so adding the raw MRR field today mixes recurring and one off money.

**Is the LTV field cash collected or contract value?** Right now it is used as both, contract value on the paid in full clients and cash on others, and it cannot be both. Recommended: it means cash collected, and the contract value already lives in the closed deals table.

---

## 6. What to build first

### Build now, because the data behind it is trustworthy today

1. **Your own marketing and sales funnel, end to end.** Leads, cost per lead, intro calls, demos, closes, contracted value. Six months of history, one clean source, already read correctly. This is the strongest thing you have and it should be the first screen you trust. Add the rep scorecard the moment the database permission is granted.
2. **The call centre.** Fifteen months of dial history, the deepest record in the business. Dials, connect rate, talk time, conversations over 90 seconds. Show speed to lead with a clear "four days of history" label next to it, because the current reading, a 733 minute median and 1.25% within five minutes, is bad enough to act on but young enough to misread.
3. **Client delivery per client.** Spend, leads, cost per lead, bookings, cost per booking, six months of daily history. Flag the $512 a week that is off the board and the one client with no booking data rather than hiding them.
4. **Cash from Whop, labelled honestly.** Thirteen months, correct, and already labelled "Whop only, bank transfers, Tap and cheques are not live" on the current screen. Keep that label. Do not remove it until transfers are real.
5. **Launches stuck.** Five clients past the seven day line, one at 80 days. This is real, visible and actionable today.
6. **The machine panel.** Which feeds are broken and how stale each number is. You already have it and it is already telling you the truth.

### Start collecting now, show in about a month

7. **The daily MRR total**, written into the table that already runs every 15 minutes. It costs almost nothing to add and the first month to month comparison lands one month after you start. Starting today is the whole decision.
8. **Logo churn from the daily roster**, marked partial until October 2026, which is the first complete month.
9. **A daily snapshot of the card fields that carry the contract:** Launch Date, Next Payment Date, MRR, Client Status. ClickUp keeps no history and never will, so anything not snapshotted is gone. This is the same mechanism churn needs and it is the only way a renewal rate ever gets a denominator.

### Defer until somebody is filling data in

10. **Cash collected across all rails.** Waits on the transfers log and a named owner.
11. **Lifetime value and gross margin per client.** Waits on payment rows carrying a card id, plus payroll, plus a time split.
12. **Churn reasons and the mid term versus completed term split.** Waits on Churn Date and the exit survey becoming compulsory.
13. **Extensions and renewals.** Waits on the card id match, one real form submission, and a decision about where a renewal is recorded at all.
14. **Payment mix by rail.** Waits on a field that is currently filled on zero of 65 cards. It would render as one empty bar today.
15. **Receivables on signed deals.** The database function works and returns $142,385 of open receivable, but **that figure must not be shown.** It counts a contract signed last week as overdue money when it is simply not due yet, and it misses payments where the paying email differs from the deal email.

---

## Where the checks disagreed, and what was not checked

Honesty about the edges, so nothing here reads as more certain than it is.

- **The two Churn Tracker tabs contradict each other.** Tab 01 says August revenue was $35,166. Tab 02 says $37,665. Both disagree with Whop's $22,333. Tab 01's year to date total of $55,166 is impossible against tab 02's own April to August sum of $88,642. Neither can be treated as authoritative until you say which one is.
- **The Churn Tracker also disagrees with Whop in the other direction.** It shows $0.00 for January through March 2026 where Whop shows $18,833 actually collected. So the sheet is not a complete ledger either, and neither side reconciles to the other.
- **A $43,370 bank import in June has never been explained.** Twenty rows in the transfers table, all June, all one card reference, no client names, against Whop's June total of $11,949. That is 3.6 times larger and nobody has reconciled it. It may be the Tap rail hiding in plain sight, which would be good news, or it may be something else entirely.
- **The rep scorecard permission failure could not be fully diagnosed.** The cockpit's last run returned permission denied. The identical query run with a full database login returns four reps immediately. So it is the cockpit's own login that lacks access, but exactly which grant is missing was not confirmed.
- **Launch Date does not match when billing actually starts.** Twelve of the thirteen launched clients whose email matches a Whop payer were paying before their recorded Launch Date, three of them by three to four months. Either launch dates are reset on re-signing, or billing starts at signup. Nobody knows which, and it means day 90 currently measures the current delivery run rather than the contract.
- **Two payments could not be settled.** A $5,500 balance for Something Studio, which is probably the same client as mergestudio.kw, exists only in the ClickUp LTV field and nowhere else. And a $1,500 payment for Ardon that may have come in by Tap is already sitting in Whop, dated 2026-09-08, with the LTV field matching the Whop total exactly. Either the rail is misremembered, or a second $1,500 arrived off Whop and is recorded nowhere. Settling these two directly would be worth ten minutes.
- **Not checked at all:** Tap's own system, since the cockpit holds no Tap credential. The bank directly. Anything in Slack. Whop's processing fees, which do not exist as a column anywhere, meaning every cash figure on your screen is 2 to 5% higher than what reaches your bank.
