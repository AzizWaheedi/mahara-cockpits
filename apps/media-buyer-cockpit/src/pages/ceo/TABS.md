# CEO cockpit tabs: the build contract

This file is the contract. Every tab agent builds against it and should never
have to guess which number goes where.

Tab order, agreed with Aziz:

`Today, Frontend, Marketing, Sales, Backend, Delivery, Calls, Client success, Management, Money, Machine`

Frontend is the curated rollup of Marketing and Sales, ending in cash won.
Backend is the curated rollup of Delivery, Calls and Client success.

## 1. How to read this file

Every metric is written as `section.path.to.field`, the exact dotted path into
the payload types in `convex/ceo/payloads.ts`. A tab reads it as:

```ts
const growth = sections.growth;           // the section wrapper (ok, error, computedAt)
const g = growth?.payload ?? null;        // the typed payload, null when not computed
```

Anything marked **NO SOURCE YET** must not be rendered as a number. Either
leave it off the tab, or show `n/a` with the note that says what is missing.

## 2. Tab keys are not section keys

| Tab key (`?tab=`) | Tab file | Section key it reads most |
| --- | --- | --- |
| `today` | `TodayTab.tsx` | all of them |
| `frontend` | `FrontendTab.tsx` | `growth`, `money` |
| `marketing` | `MarketingTab.tsx` | `growth` |
| `sales` | `SalesTab.tsx` | `growth`, `money` |
| `backend` | `BackendTab.tsx` | `delivery`, `calls`, `clients` |
| `delivery` | `DeliveryTab.tsx` | `delivery` |
| `calls` | `CallsTab.tsx` | `calls` |
| `client-success` | `ClientSuccessTab.tsx` | `clients`, `portal` |
| `management` | `ManagementTab.tsx` | `team` |
| `money` | `MoneyTab.tsx` | `money`, `expenses` |
| `machine` | `MachineTab.tsx` | `machine` |

The backend section keys did **not** change. The Client success tab still reads
`sections.clients`, and the Management tab still reads `sections.team`. Only the
tab key, the label and the file name changed. Do not rename the section keys:
the adapters, the stored rows and the daily history all use the old names.

## 3. Rules every tab follows

1. Plain language. No em dashes anywhere, in code, comments or on screen.
2. Never show a fabricated number. If a source is missing, show `n/a` (use
   `Value` / `Na` from `@/components/ceo/Na`) plus an honest note saying what is
   missing. A real zero is `0`; a number the source cannot give is `null`.
3. Every caveat the reader needs in order to read the number correctly belongs
   in a note on the card that carries the number, not at the foot of the page.
   Route `payload.notes` per card the way `MoneyTab.tsx` does with `NOTE_ROUTES`.
4. Money is USD dollars. Days are Kuwait days (UTC+3), `YYYY-MM-DD`. Rates are
   fractions 0..1, never percents.
5. Read the kit files in `src/components/ceo/` before using them. Do not invent
   props. The kit is: `SectionCard, StatTile, HeroFigure, Delta, StatusChip,
   Notes, Sparkline, Meter, FunnelStrip, TimeSeriesChart, ColumnChart, BarList,
   DataTable, FeedList, TrustPills, CeoTabs, EmptyState, RefreshButton,
   FilterChips, ShowMore, Hint, Na, format.ts, useCeo.ts, chartKit.tsx`.
6. Wrap each card in `SectionCard` with its `section=` so a failed refresh shows
   the stale banner and the last good numbers instead of a blank.
7. Only touch the files you own. Do not reformat files another agent owns.

## 4. Backend work: what landed, and what is still owed

- **`expenses` section: shipped.** `convex/ceo/adapters/expenses.ts` is live and
  registered in `convex/ceo/registry.ts`, right after `money`.
- **Cash rails, including Tap: shipped.** The money adapter always fills
  `money.rails` now, with a Whop rail, a Tap rail and a total over the connected
  rails. `rails` is still typed **optional** on purpose: the section store keeps
  the last good payload across a deploy, so a screen can still meet a payload
  written before the adapter shipped. Never read `p.rails.total` directly. Read
  the headline through `cashHeadline` in `src/components/ceo/metrics.ts`, which
  falls back to `money.cash.*` and returns the note saying the number is Whop
  only. Tap stays `connected: false` until `TAP_SECRET_KEY` is set on the
  deployment; that is a supported state, not an error.
- **`GrowthTab.tsx`: deleted.** Marketing and Sales carry everything it showed.
- **Still owed: Tap as an outside feed.** TABS.md asked for Tap in
  `machine.feeds[]`. It is not there. Tap health reaches the screen as a source
  stamp on the `money` section instead, which the Machine tab's CEO sections
  card shows. Adding it to `machine.feeds[]` would mean a second Tap call on
  every refresh, so it was left out on purpose. Decide before changing it.

## 4a. The shared rules a metric must go through

A metric that appears on more than one tab reads its rule from the kit, so the
rollup and the department tab can never drift apart:

- `src/components/ceo/windows.ts` holds `WINDOW_KEYS`, `WINDOW_LABEL`,
  `COMPARE_WITH`, `WINDOW_CHIPS` and `range()`. Frontend, Marketing and Sales
  all use them, so the same chip covers the same days on all three.
- `src/components/ceo/metrics.ts` holds `cashHeadline()` (the one headline cash
  number and its label, used by Today, Frontend and Money) and `highRiskCount`,
  `mediumRiskCount`, `isLiveClient` (used by the tab badge, the status line,
  Backend and Client success).
- `src/components/ceo/metrics.ts` also holds `SHOW_RATE` and `INTRO_SHOW_RATE`,
  the dashboard's show rates with one label and rule each, printed to one
  decimal with `pct1` from `format.ts`. There is no second show rate.
  `CLOSE_RATE.format` and `INTRO_TO_DEMO.format` print those two dashboard
  rates to one decimal as well, so every funnel rate reads as the dashboard
  rounds it (14.3%, 18.4%).
- `src/components/ceo/TargetMeter.tsx` holds `TARGET_LABELS`, `targetKind()` and
  the meter itself, used by Frontend, Sales and Money.
- `src/components/ceo/format.ts` holds `shiftMonth` and `daysInMonth`.
- `src/components/ceo/TabLink.tsx` is the header link into a detail tab.

## 4b. Naming the two pools of ad money

The cockpit carries two different pools and they are never added:

- **Lead-gen ad spend**: Mahara's own money, `growth.windows.<w>.spend` and
  `expenses.ownAdSpend`. Labelled "Lead-gen ad spend" on Today, Frontend,
  Marketing and Money.
- **Client ad spend**: client media, `delivery.*.spend` and
  `expenses.clientAdSpend`. Labelled "Client ad spend" on Today, Backend,
  Delivery and Money.

Never label either one plain "Ad spend" or plain "Spend".

## 5. Sections available to every tab

Each section's `label` reads as the tab it feeds (`growth` is "Marketing and
sales", `clients` is "Client success", `team` is "Management"), because that
label is what the header's stale pill and the Machine tab print.

| Section key | Payload type | What it carries |
| --- | --- | --- |
| `money` | `MoneyPayload` | Whop cash, cash rails, deals, refunds, failed checkouts, targets, the legacy one month expense summary |
| `expenses` | `ExpensesPayload` | The P&L: software, overhead, labour, lead-gen ad spend, profit |
| `growth` | `GrowthPayload` | Mahara's own funnel: spend, leads, calls, closes, reps, ads, lead sources |
| `delivery` | `DeliveryPayload` | Client media buying: spend, leads, bookings, campaigns, launches, account issues |
| `calls` | `CallsPayload` | The call centre: dials, connections, talk time, agents, per client, speed to lead |
| `clients` | `ClientsPayload` | The client roster, health, Pulse and risk scores |
| `team` | `TeamPayload` | People, EOD discipline, the live feed |
| `portal` | `PortalPayload` | The Mahara OS client portal |
| `machine` | `MachinePayload` | Cockpit jobs, data sources, Hermes, outside feeds |

---

# Tab 1: Today

**File:** `TodayTab.tsx`. **Status:** built, keeps its current file.

Only three things changed: the funnel card's link now opens Frontend, the
clients card links to Client success, and the team cards link to Management.

Cards and their fields, as built today:

| Card | Shows | Payload fields |
| --- | --- | --- |
| Cash hero | Cash today, month to date, projection, pace vs last month | `money.cash.today`, `money.cash.mtd`, `money.cash.projectedMonth`, `money.cash.lastMonthToDate`, `money.cash.daily`, `money.month`, `money.dayOfMonth`, `money.daysInMonth` |
| Deals and refunds | Deals signed, contracted value, refunds, failed checkouts | `money.deals.mtd`, `money.deals.contractedMtd`, `money.refunds.mtd`, `money.failedCharges.count30d`, `money.failedCharges.amount30d` |
| Targets | The month's targets against actuals | `money.targets.month`, `money.targets.items[]` |
| Growth funnel | Spend to closes for the month | `growth.windows.mtd.*` |
| Delivery | Client spend, leads, cost per lead, bookings | `delivery.mtd.*`, `delivery.last7.*`, `delivery.gates.*` |
| Delivery by client | Clients over the gates | `delivery.clients[]` |
| Calls | Dials and connections so far today | `calls.today.*` |
| Clients | Who needs attention | `clients.counts.*`, `clients.atRisk[]` |
| Team today | Who acted, EOD state | `team.people[]` |
| Live feed | The last events across the company | `team.feed[]` |
| Machine strip | Sync age, failing jobs, failing feeds, Hermes | `machine.syncAgeMin`, `machine.staleJobs`, `machine.failingJobs`, `machine.failingSources`, `machine.hermes`, `machine.feeds[]` |

The cash hero reads `cashHeadline` from `src/components/ceo/metrics.ts`, so it
shows the total over the connected rails and names the scope in its own label,
the same number and the same words as Frontend and Money.

---

# Tab 2: Frontend

**File:** `FrontendTab.tsx` (stub). **Reads:** `sections.growth`, `sections.money`.

The curated rollup of Marketing and Sales. One story: money in, money out,
what it cost, ending in cash won. No rep table and no ad table here, those live
on the detail tabs.

`<w>` below is one of `yesterday | last7 | prevLast7 | mtd | lastMonthToDate | lastMonth`.
The tab picks one window with `FilterChips` and compares it to its natural pair
(`last7` against `prevLast7`, `mtd` against `lastMonthToDate`).

### Card 1: Cash won (the hero)

| What it shows | Payload field |
| --- | --- |
| Cash month to date, all rails | `money.rails.total.mtd` |
| Whop cash month to date | `money.rails.whop.mtd` |
| Tap cash month to date | `money.rails.tap.mtd` (null while `money.rails.tap.connected` is false, show `n/a`) |
| Which rails are connected | `money.rails.whop.connected`, `money.rails.tap.connected` |
| Cash today, all rails | `money.rails.total.today` |
| Cash yesterday, all rails | `money.rails.total.yesterday` |
| Pace against last month at the same point | `money.rails.total.lastMonthToDate` |
| Whole of last month | `money.rails.total.lastMonth` |
| Straight line projection for the month | `money.rails.total.projectedMonth` |
| 90 day cash sparkline | `money.rails.total.daily[]` (`{date, value}`) |
| Month name and how far through it we are | `money.month`, `money.dayOfMonth`, `money.daysInMonth` |
| Refunds this month | `money.rails.total.refundsMtd`, and `money.refunds.mtd` for the Whop only figure |

`money.rails` is optional and is `undefined` until the money adapter fills it,
so every read goes through `m.rails?.` and every path above can be absent.

Fallback while the rails work is not on the backend: use `money.cash.mtd`,
`money.cash.today`, `money.cash.yesterday`, `money.cash.lastMonthToDate`,
`money.cash.lastMonth`, `money.cash.projectedMonth`, `money.cash.daily` and say
in a note that this is Whop only.

### Card 2: The whole funnel, one window at a time

| What it shows | Payload field |
| --- | --- |
| Lead-gen ad spend | `growth.windows.<w>.spend` |
| Leads | `growth.windows.<w>.leads` |
| Cost per lead | `growth.windows.<w>.cpl` |
| Intro calls booked | `growth.windows.<w>.introsBooked` |
| Demos booked | `growth.windows.<w>.demosBooked` |
| Intro to demo (the step into demos booked) | `growth.windows.<w>.introToDemo` |
| Demos shown | `growth.windows.<w>.demosShown` |
| Demo show rate | `growth.windows.<w>.demoShowRate` |
| Closes | `growth.windows.<w>.closes` |
| Close rate | `growth.windows.<w>.closeRate` |
| Contracted value signed | `growth.windows.<w>.contracted` |
| Cash typed on the closer form | `growth.windows.<w>.cash` |
| The window's own dates | `growth.windows.<w>.from`, `growth.windows.<w>.to` |

Use `FunnelStrip` for the stage to stage drop. The cash typed on the closer form
is **not** the same money as `money.cash.*`: it is what the closer typed, not
what was collected. Say so in a note on this card, every time both appear.

### Card 3: What it costs

| What it shows | Payload field |
| --- | --- |
| Cost to win a customer | `COST_TO_WIN.of(growth.windows.<w>)` in `metrics.ts`: lead-gen plus retargeting spend over closes. Not `growth.windows.<w>.cac`, which is the dashboard's lead-gen only figure |
| Return on ad spend | `growth.windows.<w>.roas` |
| Cost per lead | `growth.windows.<w>.cpl` |
| Average contract value, last 90 days | `money.deals.avgContract90d` |
| Deals signed this month | `money.deals.mtd` against `money.deals.lastMonth` |
| Contracted value this month | `contractedHeadline(money)` in `metrics.ts`: `money.deals.contractedMtd` plus `money.deals.manualContractedMtd` (hand-logged deals), against the same for last month |

### Card 4: Trend

| What it shows | Payload field |
| --- | --- |
| Spend by day, last 60 days | `growth.daily[].spend` with `growth.daily[].date` |
| Leads by day | `growth.daily[].leads` |
| Calls booked by day | `growth.daily[].booked` |
| Closes by day | `growth.daily[].closes` |
| Cash by day, last 90 days | `money.rails.total.daily[]` |

### Card 5: Targets

| What it shows | Payload field |
| --- | --- |
| The month the targets belong to | `money.targets.month` |
| Each target and its actual | `money.targets.items[].metric`, `.target`, `.actual` |

Targets whose month is not the current month must say so. `money.targets.items[].actual`
is null for metrics with no actual: show `n/a`, never 0.

### NO SOURCE YET on Frontend

- **Handoff time from lead to booked call.** Needs a per lead first-booking
  timestamp. `growth` carries counts by day, not per lead timing.
- **Open pipeline value.** No table anywhere holds unclosed B2B opportunities
  with a value. `closed_deals` is only signed deals.
- **Customer lifetime value and payback period.** Needs a per customer revenue
  history keyed to the deal. Whop payments are not joined to `closed_deals`.
- **Cash won against cash contracted.** `money.deals.contractedMtd` is the
  promise and `money.cash.mtd` is the collection, but nothing links a Whop
  payment to the deal that produced it, so a collection rate cannot be computed.

---

# Tab 3: Marketing

**File:** `MarketingTab.tsx` (stub). **Reads:** `sections.growth`.

B2B marketing for Mahara itself: spend, leads and booked calls. Everything from
the booked call onward belongs on Sales.

### Card 1: Spend and leads

| What it shows | Payload field |
| --- | --- |
| Lead-gen spend | `growth.windows.<w>.spend` |
| Leads | `growth.windows.<w>.leads` |
| Cost per lead | `growth.windows.<w>.cpl` |
| Retargeting spend, on top of lead-gen | `growth.windows.<w>.raw.spend_retargeting` |
| The window's dates | `growth.windows.<w>.from`, `.to` |

`growth.windows.<w>.spend` excludes retargeting. `raw.spend_retargeting` is the
retargeting money and is currently computed but never rendered anywhere, so this
card is its first home. Note that the two are different money and are not summed
into `cpl`.

### Card 2: Calls booked and cost per call

| What it shows | Payload field |
| --- | --- |
| Intro calls booked | `growth.windows.<w>.introsBooked` |
| Demos booked | `growth.windows.<w>.demosBooked` |
| Lead to booked call rate | derive: `(introsBooked + demosBooked) / leads`, name the rule in a note |
| Cost per intro shown | derive: `spend / raw.intros_shown`, worked out in the cockpit from two dashboard figures (no B2B function returns a cost per intro), null when there are no intros shown |
| Cost per demo shown | `growth.windows.<w>.costPerDemo` (the dashboard's `cost_per_demo`) |
| Cost per demo booked | `growth.windows.<w>.costPerDemoBooked` (the dashboard's `cost_per_demo_booked`) |

The lead to booked call rate dates the lead and the booking on the day each
happened, so a lead created on Monday and booked on Thursday lands in two
different days. That caveat must be in a note on this card. Cost per demo shown
and cost per demo booked are the dashboard's own figures and must be labelled so.
Cost per intro shown is the cockpit's sum over the dashboard's spend and intros
shown, and must not be labelled as the dashboard's.

### Card 3: Ads, last 7 days

| What it shows | Payload field |
| --- | --- |
| Ad name | `growth.topAds[].name` |
| Spend | `growth.topAds[].spend` |
| Leads | `growth.topAds[].leads` |
| Cost per lead | `growth.topAds[].cpl` |

Top 6 by spend, retargeting included, which is the opposite rule from the window
spend above. Say so in a note.

### Card 4: Where leads come from

| What it shows | Payload field |
| --- | --- |
| Lead source, month to date | `growth.leadSources[].source` |
| Leads from that source | `growth.leadSources[].leads` |

Use `BarList`. Top 10; a blank source reads `(none)`.

### Card 5: Trend, last 60 days

| What it shows | Payload field |
| --- | --- |
| Day | `growth.daily[].date` |
| Spend | `growth.daily[].spend` |
| Leads | `growth.daily[].leads` |
| Calls booked | `growth.daily[].booked` |

### Notes this tab must carry

Take them from `growth.notes[]` and route the ones about leads, spend, ads and
sources to this tab (the rest belong on Sales). At minimum: what counts as a
lead, that retargeting is excluded from the headline spend, the per stage
dating rule, the top ad rule, and whether there is an active lead-gen campaign.

### NO SOURCE YET on Marketing

- **Impressions, clicks, click through rate, cost per click, frequency.** The
  cockpit reads `meta_ad_snapshots` for spend and leads only. A Meta insights
  pull with those columns would be needed.
- **Landing page views and landing page conversion rate.** No web analytics
  source is connected to the cockpit at all.
- **Organic, content, email and social performance.** Nothing in either Supabase
  project holds them.
- **Creative level performance (hook rate, thumbstop, video views).** Not in
  `meta_ad_snapshots` and not in the Creative Triage project.
- **Attribution from a lead back to the ad that made it.** `growth.topAds[].leads`
  attributes leads to ads inside the B2B dashboard function. Nothing exposes the
  per lead ad id to the cockpit, so a funnel by ad cannot be drawn.

---

# Tab 4: Sales

**File:** `SalesTab.tsx` (stub). **Reads:** `sections.growth`, `sections.money`.

Mahara's own sales: from a booked call to a signed deal.

### Card 1: Calls

| What it shows | Payload field |
| --- | --- |
| Demos booked | `growth.windows.<w>.demosBooked` |
| Demos shown | `growth.windows.<w>.demosShown` |
| Demo show rate | `growth.windows.<w>.demoShowRate` |
| Intro show rate | `growth.windows.<w>.introShowRate` |
| Demos due | `growth.windows.<w>.raw.demos_due` |
| Past demos still marked confirmed | `growth.windows.<w>.demosStillConfirmed` |
| Intro calls booked | `growth.windows.<w>.introsBooked` |

The show rule, settled by Aziz on 2026-09-16 ("if it's confirmed or shown, it's
counted as shown") and applied by the dashboard's `b2b_window_metrics`: a call
counts as shown when it is marked showed, or marked confirmed or invalid once
its time has passed. Show rate is calls shown over calls due, and due is every
call whose time has passed in the window, cancelled and no-show included. A
future call is in neither count. One show rate only; it must equal the
dashboard's, printed to one decimal (62.5% for September 1 to 16). Past demos
still marked confirmed is a record-keeping count, shown as a plain line under
the rate and as an info note, never a warning: those demos count as shown, so a
demo that did not happen has to be marked no-show in GHL.

### Card 2: Closing

| What it shows | Payload field |
| --- | --- |
| Closes | `growth.windows.<w>.closes` |
| Close rate | `growth.windows.<w>.closeRate` |
| Contracted value | `growth.windows.<w>.contracted` |
| Cash typed on the form | `growth.windows.<w>.cash` |
| Deals signed this month | `money.deals.mtd` |
| Deals signed last month | `money.deals.lastMonth` |
| Contracted this month | `contractedHeadline(money).value`: closer form plus hand-logged deal values |
| Contracted last month | `contractedHeadline(money).lastMonth` |
| Intro to demo (the funnel step into demos booked) | `growth.windows.<w>.introToDemo` |
| Average contract, last 90 days | `money.deals.avgContract90d` |

`closeRate` is the dashboard's `close_rate`: deals signed over qualified demos
(demos counted as shown, leaving out calls marked invalid). It can pass 100% in
a short window because a close can land after the window the demo sat in. Note
it.
`growth.windows.<w>.cash` is what the closer typed, never Whop cash. Note it.

### Card 3: Reps, month to date

| What it shows | Payload field |
| --- | --- |
| Rep name | `growth.reps[].name` |
| Role | `growth.reps[].role` |
| Calls booked on their calendar | `growth.reps[].booked` |
| Calls shown | `growth.reps[].shown` |
| Closes | `growth.reps[].closes` |
| Close rate | `growth.reps[].closeRate` |
| Contracted value | `growth.reps[].contracted` |
| Cash collected on their closes | `growth.reps[].cash` |

Use `DataTable`. Booked and shown are credited by calendar, closes by the closer
named on the form, so the two can disagree for the same person. Note it.

### Card 4: Deals, newest 10

| What it shows | Payload field |
| --- | --- |
| Day signed | `money.deals.recent[].date` |
| Client business | `money.deals.recent[].business` |
| Closer | `money.deals.recent[].closer` |
| Contracted value | `money.deals.recent[].contracted` |
| Upfront cash typed | `money.deals.recent[].cash` |
| Payment plan | `money.deals.recent[].plan` |

Any of `business`, `closer`, `contracted`, `cash`, `plan` can be null: show
`n/a`, never 0 and never a blank cell.

### Card 5: Targets that belong to sales

Filter `money.targets.items[]` to the sales metrics (`SALES_TARGET_METRICS`:
signed, revenue, cash collected, demos shown, close rate, demo show rate) and
show `metric`, `target`, `actual`. A show rate target prints to one decimal,
like the show rate tile. Leave the marketing
targets to the Marketing tab and the whole list to Money.

### NO SOURCE YET on Sales

- **Open pipeline: opportunities, stage, value, age.** Nothing in the B2B
  project holds unclosed deals. `closed_deals` is signed deals only.
- **Sales cycle length.** Needs a first touch date on the deal. `closed_deals`
  carries only `submitted_at`.
- **Speed to first contact on a B2B lead.** The speed to lead numbers in
  `calls.speedToLead` are the client call centre, not Mahara's own sales.
- **Per rep quota or target.** `monthly_targets` is company wide with no rep column.
- **Call recordings, talk ratio, objection handling.** Fathom is synced as a feed
  but no per call sales metric reaches the cockpit.
- **Follow up discipline on a lost or no show call.** No outcome or task table.

---

# Tab 5: Backend

**File:** `BackendTab.tsx` (stub). **Reads:** `sections.delivery`, `sections.calls`, `sections.clients`.

Service delivery in total, from all three delivery departments: media buying,
the call centre and client success. One view, headline numbers only. The detail
stays on the Delivery, Calls and Client success tabs, and every card links to
its own tab.

### Card 1: Media buying

| What it shows | Payload field |
| --- | --- |
| Client ad spend, month to date | `delivery.mtd.spend` |
| Leads | `delivery.mtd.leads` |
| Cost per lead | `delivery.mtd.cpl` |
| Bookings | `delivery.mtd.bookings` |
| Cost per booking | `delivery.mtd.cpb` |
| The same for the last 7 days | `delivery.last7.*` |
| The 7 days before that, for the delta | `delivery.prevLast7.*` |
| The cost per lead gate | `delivery.gates.cpl` |
| The cost per booking gate | `delivery.gates.cpb` |
| Campaigns running | `delivery.campaigns.running` |
| Clients whose delivery is bad | count `delivery.clients[]` where `status === "bad"` |
| Clients on watch | count `delivery.clients[]` where `status === "watch"` |

The gates are plan defaults until Aziz sets the official ones. That caveat must
be on this card wherever a gate decides a colour.

### Card 2: Call centre

| What it shows | Payload field |
| --- | --- |
| Dials today | `calls.today.dials` |
| Connected today | `calls.today.connected` |
| Connect rate today | `calls.today.connectRate` |
| Talk minutes today | `calls.today.talkMinutes` |
| Conversations of 90 seconds or more today | `calls.today.conversations90s` |
| The same for the last 7 days | `calls.last7.*` |
| The 7 days before, for the delta | `calls.prevLast7.*` |
| Median minutes to first call | `calls.speedToLead.medianMinutes7d` |
| Share called within 5 minutes | `calls.speedToLead.within5minShare7d` |
| How many leads that median covers | `calls.speedToLead.sample` |
| First day the number can cover | `calls.speedToLead.since` |
| Newest call in the store | `calls.lastCallAt` |

Speed to lead counts only leads that were actually called, so an uncalled lead
never lengthens the median. That caveat belongs on this card.

### Card 3: Client success

| What it shows | Payload field |
| --- | --- |
| Active clients | `clients.counts.active` |
| Onboarding | `clients.counts.onboarding` |
| Paused | `clients.counts.paused` |
| Churned | `clients.counts.churned` |
| Total on the roster | `clients.counts.total` |
| Who needs attention, at most 8 | `clients.atRisk[]` with `.name`, `.risk.level`, `.risk.reasons[]`, `.silentDays`, `.csm` |
| High risk count, for the card badge | count `clients.rows[]` where `risk.level === "high"` and `bucket` is active or onboarding |

Use the same high risk rule as `CeoPage.tsx` `tabsFor` and `statusSentence.ts`,
so the badge, the sentence and this card never disagree.

### Card 4: What is stuck

| What it shows | Payload field |
| --- | --- |
| Launches in flight | `delivery.launches.inFlight` |
| Launches past the 7 day target | `delivery.launches.stuck[]` with `.client`, `.days`, `.blocker` |
| Blocked or flagged ad accounts | `delivery.accountIssues[]` with `.client`, `.issue` |
| Running campaigns the board says are off | `delivery.campaigns.boardOffButRunning` |
| Campaigns spending with no board card | `delivery.campaigns.spendingNotOnBoard` |
| Running campaigns by verdict | `delivery.campaigns.verdicts` (`Record<string, number>`, e.g. scale, hold, kill) |

### NO SOURCE YET on Backend

- **One delivery health score across the three departments.** There is no agreed
  weighting. Pulse (`clients.rows[].pulse.score`) covers client success only and
  is the cockpit's own rule, not a company standard.
- **Creative production throughput.** The creative department has no metric in
  any source the cockpit reads. The Creative Triage project holds leads,
  appointments, ad spend and rosters, not creative output.
- **Service level on a client request.** No ticket or request table exists.
- **Delivery cost per client (labour time on an account).** Hubstaff appears in
  the expense import as a vendor line only. No time data reaches the cockpit.
- **Retention and churn rate over time.** `clients.counts.churned` is a snapshot
  of the roster today, not a churn rate. A dated churn event would be needed.

---

# Tab 6: Delivery

**File:** `DeliveryTab.tsx`. **Status:** built, unchanged. **Reads:** `sections.delivery`.

Every field in `DeliveryPayload` is already rendered: the four windows
(`yesterday`, `last7`, `prevLast7`, `mtd`), `daily[]`, `gates`, `campaigns`,
`clients[]`, `launches`, `accountIssues[]` and `notes[]`. No new work is owed
here beyond keeping it working.

---

# Tab 7: Calls

**File:** `CallsTab.tsx`. **Status:** built, unchanged. **Reads:** `sections.calls`.

Already rendered: the four windows, `daily[]` (dials and connected),
`byAgent[]`, `byHourToday[]`, `perClient7d[]`, `speedToLead`, `lastCallAt`,
`notes[]`.

Computed but not rendered, free to use if a card wants them:
`calls.daily[].conversations90s`, `calls.byAgent[].today.avgTalkSec`,
`calls.byAgent[].today.conversations90s`, `calls.byAgent[].last7.avgTalkSec`,
`calls.byAgent[].last7.conversations90s`.

---

# Tab 8: Client success

**File:** `ClientSuccessTab.tsx` (was `ClientsTab.tsx`). **Status:** built and extended.
**Reads:** `sections.clients`, `sections.portal`.

Already rendered: `clients.counts.*`, `clients.atRisk[]`, `clients.rows[]`
(name, clickupTaskId, stage, bucket, csm, service, happiness, silentDays,
leads7d, cpl7d, bookings7d, pulse, portalLastSeenAt, risk, latestUpdate),
`clients.notes[]`, and the whole `portal` payload in its own card.

Computed but not rendered, free to use:
`clients.rows[].lastContactAt` (epoch ms of the later of Last POC and Last Call;
the table shows `silentDays` instead) and `clients.rows[].paymentDue` (the next
payment date on the ClickUp card).

### NO SOURCE YET on Client success

- **Revenue per client and MRR.** The ClickUp client card has MRR, LTV and Next
  Payment Amount fields, but the cockpit's `clients` adapter does not read them
  and no payment is joined to a client. Adding them is a `clients` adapter change.
- **Churn reason.** No field records why a client left.

---

# Tab 9: Management

**File:** `ManagementTab.tsx` (was `TeamTab.tsx`). **Status:** built and extended.
**Reads:** `sections.team`.

Already rendered: `team.people[]` (key, name, role, eodYesterday, eod14,
lastActiveAt, actionsToday, energy), `team.feed[]` (through `FeedList`, which
renders `actor` and `subject`), `team.notes[]`.

Aziz asked for "all departments" on this tab. The only department signal that
exists is `team.people[].role` (Media buyer, Account manager, Creative director,
sales roles and so on). Group the people list by role and label the groups as
departments, and say in a note that the grouping is derived from each person's
role, not from a department field.

### NO SOURCE YET on Management

- **An explicit department per person.** No table carries one. Roles are the only
  signal and some people have none.
- **Head count, start date, contract type, pay.** Nothing in either Supabase
  project, in ClickUp or in any sheet the cockpit reads carries them.
- **Hours worked or utilisation.** Hubstaff is a vendor line in the expense
  import only. No time data reaches the cockpit.
- **Holidays.** The EOD rule treats Friday as off and knows no public holidays,
  so a holiday reads as a missed EOD. That caveat is already in `team.notes[]`
  and must stay on screen.

---

# Tab 10: Money

**File:** `MoneyTab.tsx`. **Status:** built for cash, needs the rails and the whole P&L.
**Reads:** `sections.money`, `sections.expenses`.

Two halves. Cash in, which exists today, and the P&L, which is new.

## Half A: Cash in

Already built and to be kept: `money.cash.*`, `money.monthly[]`,
`money.refunds.*`, `money.deals.*`, `money.failedCharges.*`, `money.targets.*`,
`money.expenses.*`, `money.notes[]`.

### New card: Cash by rail

| What it shows | Payload field |
| --- | --- |
| Rail name | `money.rails.whop.label`, `money.rails.tap.label`, `money.rails.total.label` |
| Is the rail connected | `money.rails.<rail>.connected` |
| Cash today | `money.rails.<rail>.today` |
| Cash yesterday | `money.rails.<rail>.yesterday` |
| Cash month to date | `money.rails.<rail>.mtd` |
| Last month to the same day | `money.rails.<rail>.lastMonthToDate` |
| Whole of last month | `money.rails.<rail>.lastMonth` |
| Projection for the month | `money.rails.<rail>.projectedMonth` |
| Refunds this month | `money.rails.<rail>.refundsMtd` |
| 90 day trend | `money.rails.<rail>.daily[]` |
| Newest payment on the rail | `money.rails.<rail>.lastPaymentAt` |

`money.rails` is optional: when it is `undefined` the whole card is replaced by
the existing Whop cash card plus a note saying the rails are not computed yet.

`rails.total` sums the connected rails only. Whenever `rails.tap.connected` is
false the card must say in plain words that Tap is not connected yet and that
the total is Whop alone, so the total is never read as the whole business.
A rail that is not connected shows `n/a` on every number, never 0.

Note that `money.cash.*` and `money.rails.whop.*` are the same Whop money in two
places. Never add them together.

## Half B: The P&L

Every number here comes from `sections.expenses`. Until the adapter ships, the
whole half is one `SectionCard` with `section={sections.expenses}` showing the
"Not computed yet" empty state, which is correct and honest.

**The month goes in the card heading**, e.g. "Expenses, June 2026". At the time
of writing the expense table holds one month only, imported once, so nobody must
read it as current.

### Card: The month this covers

| What it shows | Payload field |
| --- | --- |
| The month | `expenses.month` |
| Every month that has rows | `expenses.monthsLoaded[]` |
| When the rows were imported | `expenses.importedAt` |
| The fixed KWD to USD rate used | `expenses.fxUsdPerKwd` |

If `expenses.monthsLoaded.length <= 1`, draw no trend, no run rate, no month on
month delta and no projection. Say so on the card.

### Card: Software

| What it shows | Payload field |
| --- | --- |
| Tool spend worth showing | `expenses.software.amount` |
| The raw category total behind it | `expenses.software.headline` |
| What was taken out and why | `expenses.software.excluded[]` (`{label, amount}`) |
| Vendors inside the figure | `expenses.software.vendors[]` (`{vendor, amount, rows, category, reclass}`) |
| How far to trust it | `expenses.software.quality` |
| The sentence to show beside it | `expenses.software.why` |

If the headline is shown at all, `amount` must be shown beside it, never alone.
Bank lines and one off course purchases sit inside the raw software category and
are not software.

### Card: Overhead

Same six fields on `expenses.overhead.*`. Expect `quality` to be `"missing"` and
`amount` to be null: there is no rent, utility, phone, insurance, accounting or
government fee line in the source. Show `n/a` plus `expenses.overhead.why`, and
show `expenses.unloads` separately, labelled money moved to a card rather than
money spent, so it is never mistaken for a cost.

### Card: Labour

Same six fields on `expenses.labour.*`. Expect `quality` to be `"floor"`: the
payee on every line is a bank rail, never a person. Show
`expenses.peopleFilingEods` beside it so the gap is visible, and show
`expenses.labour.why`.

**Never derive** cost per head, payroll as a share of revenue, or margin from
this number.

### Card: Ad spend, two different pools

| What it shows | Payload field |
| --- | --- |
| Mahara's own lead-gen spend in the expense import | `expenses.ownAdSpend.amount` |
| Its vendors | `expenses.ownAdSpend.vendors[]` |
| Client media spend for the same month | `expenses.clientAdSpend.amount` |
| How many clients that covers | `expenses.clientAdSpend.clients` |

These are different money. Mahara's own lead-gen spend is the same money as
`growth.windows.*.spend`, so it is counted once and never twice. Client media is
a delivery cost carried against each client and is never part of company
overhead. Neither is ever added to the other. Say all of this on the card.

### Card: Totals and profit

| What it shows | Payload field |
| --- | --- |
| Total of every row in the month | `expenses.total` |
| What was actually spent | `expenses.spend` |
| Card unloads inside `total` | `expenses.unloads` |
| Every category as imported | `expenses.byCategory[]` (`{category, amount, rows}`) |
| Cash in for the same month | `expenses.revenue` |
| Profit | `expenses.profit.amount` |
| Margin | `expenses.profit.margin` |
| Why profit is null | `expenses.profit.why` |

Prefer `expenses.spend` over `expenses.total` as the headline, because the total
includes card unloads that are not costs. When `expenses.profit.amount` is null,
show `n/a` and print `expenses.profit.why` next to it. Do not compute a profit
in the tab from `revenue - spend`: the adapter decides when that subtraction is
honest, and the tab must respect that decision.

### The old expense fields on `money`

`money.expenses.month`, `money.expenses.total` and `money.expenses.byCategory[]`
are the existing one month summary the Money tab already renders. Once
`sections.expenses` is live, the P&L cards read `expenses.*` and the old
`money.expenses` card comes off the tab. Until then it stays, unchanged.

### NO SOURCE YET on Money

- **Rent, utilities, phone, internet, insurance, accounting, legal, licences,
  government fees, office, travel, equipment.** No such vendor line exists in
  the source at all, so overhead cannot be shown.
- **Payroll by person, contractor rates, employer costs.** Nothing links a
  payment to a person. `sales_reps`, `team_eod_reports` and `eod_reports` carry
  no pay column, and the ClickUp client list has no salary field.
- **Any month other than the one loaded.** A repeating bank import would be
  needed, not the single load the table holds.
- **A per tool subscription total, a renewal date, a seat count, a run rate.**
  The vendor field is the bank card descriptor, so one tool appears under
  several names and nothing marks a line as recurring.
- **Tap cash.** Needs `TAP_SECRET_KEY` on the deployment. Until then
  `money.rails.tap.connected` is false, every Tap number is null, and the screen
  says Tap is not connected.
- **Tap refunds.** A second Tap endpoint, and the units question on a refund
  amount has to be settled against one real refund first. Ship Tap cash with
  `money.rails.tap.refundsMtd` null and a note saying Tap refunds are not read.
- **Fees.** Neither Whop nor Tap fees are deducted anywhere, so cash is gross of
  processor fees. That caveat is already in `money.notes[]` and must stay.

---

# Tab 11: Machine

**File:** `MachineTab.tsx`. **Status:** built, unchanged. **Reads:** `sections.machine`.

Already rendered in full: `syncAgeMin`, `jobs[]`, `failingJobs`, `staleJobs`,
`sources[]`, `failingSources`, `hermes`, `feeds[]`, `notes[]`, plus the CEO
sections card that retries a single section.

`expenses` is already registered in this tab's `SECTION_NAMES` record as
"Expenses and P&L", so the CEO sections card lists it as not computed yet until
the adapter ships. That is the only edit this tab needed for the restructure.

When the Tap fetch lands it must appear here too, as an outside feed in
`machine.feeds[]` with `project` set once the adapter reports it.

---

# Writes (2026-09-16)

Until this pass the CEO cockpit only read. This section is the contract for its
first writes. The decisions behind it are in
`CEO_SOURCES_OF_TRUTH.md`, "Decided on 2026-09-16", and they are binding.

## W1. The rules every CEO write follows

1. **One door.** Every write is a public `authenticatedMutation` (from
   `convex/functions.ts`) whose handler is one call to `ceoWrite(ctx, ...)` from
   `convex/ceo/writeGuard.ts`. Never call `ctx.db.insert` or `ctx.db.patch` on a
   CEO table outside `ceoWrite`, and never build a raw `mutation` (the PHI check
   blocks the deploy).
2. **The CEO check is the read check.** `ceoWrite` runs `requireCeo` from
   `convex/ceo/gate.ts` before anything else, the same call every CEO query
   makes. Do not write another auth check.
3. **Every argument is validated.** `v.*` validators on every arg, using the
   shared ones from `writeGuard.ts` (`vTeamStatus`, `vManualCurrency`,
   `vManualRail`, which are taken from the schema so they cannot drift), plus
   the assert helpers for what a validator cannot say: `assertKuwaitDay`,
   `assertPersonKey`, `usdAtWrite`, `cleanText`. Refusals throw one plain
   sentence; nothing is written.
4. **Who and when.** `ceoWrite` hands the callback `w.by` (the CEO's email),
   `w.at` (epoch ms) and `w.day` (Kuwait day). They go on the row
   (`setBy`/`setAt`, `addedBy`/`addedAt`, `deletedBy`/`deletedAt`) and on the
   audit row, so both carry the same instant.
5. **Audit trail, same transaction.** The callback returns
   `{ result, audit, refresh }`. `audit` is required (one entry or more) and is
   written to `ceoAudit` in the same transaction, so a change never lands
   without its trail. The shape follows the cockpit's existing human change log
   (`manualChanges.what/by/at` and the `campaignChat` action rows written by
   `chat.logInternal` and `control.recordToggle`), but in its own table:
   `manualChanges` and `campaignChat` are keyed by campaign and the Management
   feed reads them as media buying work, so a CEO change must never land there.
6. **Convex only.** No CEO write calls Supabase, ClickUp, Whop, Tap or any
   outside system. The CEO tables are Convex tables and nothing else.
7. **The screen catches up by itself.** `refresh: [...]` schedules the same
   background recompute as "Refresh now" for the named sections (backend keys,
   not tab keys). The tab shows a toast such as "Logged. Totals update in about
   a minute." It never adds the entry into a total itself.
8. **Money is never hard deleted.** A payment is removed by setting `deletedAt`
   and `deletedBy`. A correction is a removal plus a new entry.
9. **Payloads carry no emails.** `setBy`, `addedBy` and `deletedBy` leave the
   backend through `writerLabel()` ("Aziz"). Typed notes and client names are
   masked for emails and phone numbers on the way out, the way the team feed's
   `clean()` does.

### The `writeGuard.ts` API

```ts
ceoWrite<T>(ctx, write: (w: { by; at; day }) => Promise<{
  result: T;
  audit: CeoAuditEntry | CeoAuditEntry[];   // at least one
  refresh?: CeoSectionKey[];                 // e.g. ["money", "clients"]
}>): Promise<T>

type CeoAuditEntry = {
  action: string;          // "<feature>.<verb>": "teamStatus.set", "manualPayment.add"
  table: "ceoTeamStatus" | "ceoManualPayments";
  rowId: string;           // the row id; the person key for ceoTeamStatus
  what: string;            // one plain sentence
  before?: unknown;        // the row before (system fields dropped)
  after?: unknown;         // the row after
};

auditTrail(ctx, { table?, rowId?, limit? }): Promise<CeoAuditRow[]>  // runs requireCeo itself
writerLabel(email): string                                           // "Aziz"
vTeamStatus, vManualCurrency, vManualRail                            // v.* validators from the schema
TeamStatus, ManualCurrency, ManualRail                               // their TS types
MANUAL_RAIL_LABEL                                                    // "bank transfer", "cheque", ...
assertKuwaitDay(day, label, { notBefore?, notAfter? }): string
assertPersonKey(key): string                                         // TeamPerson.key format
cleanText(s, max?): string | undefined                               // trimmed, one line, no em dashes
usdAtWrite(amount, currency, label?): { amount; usd; usdPerUnit }    // USD_PER from data/tap.ts
MANUAL_MAX_AMOUNT                                                    // 1,000,000 in the typed currency
CeoMutationCtx, CeoQueryCtx, CeoSectionKey, CeoWriteTable, CeoWriter
```

`writeGuard.ts` registers no Convex function. A feature that wants a history
list writes its own `authenticatedQuery` and returns `auditTrail(ctx, ...)`.

## W2. The tables (`convex/schema.ts`)

### `ceoTeamStatus`, one row per person

| Field | Type | Meaning |
| --- | --- | --- |
| `personKey` | string | `TeamPerson.key` exactly: `"<role>:<first>"`, the raw role key plus the lower case letters of the first name (`media_buyer:nada`, `sales_setter:ali`). Index `by_person`. |
| `status` | `"active" \| "paused" \| "left"` | No row means active. Setting a person back to active keeps the row with status `active`. |
| `since` | string | Kuwait day the status took effect. |
| `note` | string, optional | One line from Aziz. |
| `setBy`, `setAt` | string, number | From `w.by`, `w.at`. |

### `ceoManualPayments`, one row per hand-logged payment

| Field | Type | Meaning |
| --- | --- | --- |
| `day` | string | Kuwait day the money was received. |
| `amount`, `currency` | number, `"USD" \| "KWD"` | As typed. Above 0, at most 1,000,000, at most three decimals. |
| `amountUsd`, `usdPerUnit` | number, number | From `usdAtWrite` at write time (the fixed `USD_PER` table money.ts uses, 1 KWD = $3.26). The rate is kept so history never moves. |
| `clientName` | string | As typed. |
| `clickupTaskId` | string, optional | The ClickUp client card, when picked from the roster. This is what ties the payment to a client for the renewal rule. |
| `rail` | `"bank_transfer" \| "cheque" \| "cash" \| "tap" \| "other"` | How it arrived. |
| `dealContracted`, `dealContractedUsd` | number, optional | A new deal's contract value, same currency and rate as the payment. Adds to contracted, never to cash. |
| `note` | string, optional | One line. |
| `addedBy`, `addedAt` | string, number | From `w.by`, `w.at`. |
| `deletedAt`, `deletedBy` | optional | The soft delete. Every total reads rows with no `deletedAt` only. |

Indexes: `by_day` (`day`), `by_deleted_day` (`deletedAt`, `day`; read live rows
with `q.eq("deletedAt", undefined).gte("day", from)`), `by_task_day`
(`clickupTaskId`, `day`; one client's payments for the renewal rule).

### `ceoAudit`, one row per CEO change (added because the features need it)

`action`, `table`, `rowId`, `what`, `before?`, `after?`, `by`, `at`. Indexes
`by_at` (the newest changes) and `by_row` (`table`, `rowId`, `at`; one
payment's or one person's history). Written only by `ceoWrite`.

## W3. The mutations to build

### Management: `convex/ceo/teamStatus.ts`

| Function | Args | Does |
| --- | --- | --- |
| `set` (mutation) | `personKey: v.string()`, `status: vTeamStatus`, `since: v.string()`, `note: v.optional(v.string())` | `assertPersonKey`, `assertKuwaitDay(since, "Since", { notBefore: "2025-01-01", notAfter: <today + 31 days> })`, `cleanText(note, 300)`. Upsert by `by_person`. Audit `teamStatus.set`, `rowId` = person key, `before`/`after` = the row, `what` like "Marked Nada (Media buyer) as paused from 2026-09-16". `refresh: ["team"]`. Returns `null`. |
| `history` (query, optional) | `personKey: v.string()` | `auditTrail(ctx, { table: "ceoTeamStatus", rowId: personKey, limit: 20 })`. |

Backend reads: `convex/ceo/data/team.ts` returns the `ceoTeamStatus` rows;
`convex/ceo/adapters/team.ts` applies them (W4).

### Money: `convex/ceo/manualPayments.ts`

| Function | Args | Does |
| --- | --- | --- |
| `add` (mutation) | `day: v.string()`, `amount: v.number()`, `currency: vManualCurrency`, `clientName: v.string()`, `clickupTaskId: v.optional(v.string())`, `rail: vManualRail`, `dealContracted: v.optional(v.number())`, `note: v.optional(v.string())` | `assertKuwaitDay(day, "Day received", { notBefore: "2025-01-01", notAfter: w.day })`, `usdAtWrite(amount, currency)`, `usdAtWrite(dealContracted, currency, "The deal value")` when given, `cleanText(clientName, 120)` required, `cleanText(note, 500)`, `clickupTaskId` must be a card in the Convex `clients` table. Insert. Audit `manualPayment.add` with `after`, `what` like "Logged $1,500.00 (460.125 KWD) by bank transfer from Ardon, 2026-09-15". `refresh: ["money", "clients"]`. Returns the id. |
| `remove` (mutation) | `id: v.id("ceoManualPayments")`, `reason: v.optional(v.string())` | Refuses a missing or already removed row. Sets `deletedAt: w.at`, `deletedBy: w.by`. Audit `manualPayment.remove` with `before`/`after` and the reason in `what`. `refresh: ["money", "clients"]`. |
| `restore` (mutation) | `id: v.id("ceoManualPayments")` | Refuses a row that is not removed. Clears `deletedAt` and `deletedBy`. Audit `manualPayment.restore`. `refresh: ["money", "clients"]`. |
| `clientOptions` (query) | none | `requireCeo`, then `{ name, clickupTaskId, bucket }` for every card in the Convex `clients` table, for the client picker. |
| `history` (query, optional) | `id: v.id("ceoManualPayments")` | `auditTrail(ctx, { table: "ceoManualPayments", rowId: id })`. |

There is no edit. A wrong entry is removed and entered again, both audited.

Backend reads: a new `convex/ceo/data/money.ts` (`internalQuery load`) returns
the live entries of the last 400 days (`by_deleted_day`) and this month's
removed ones; `convex/ceo/adapters/money.ts` builds the manual rail, the entry
list and the duplicates (W4). `convex/ceo/data/clients.ts` also returns the live
entries that carry a `clickupTaskId`, for the renewal rule.

## W4. Payload additions (`convex/ceo/payloads.ts`)

Every new field is **optional** in the type, for the same reason `money.rails`
is: the store keeps the last good payload across a deploy, so a screen can meet
one written before the adapter filled the field. Read every one with `?.` and
show n/a, never 0, when it is absent.

### `team` (Management)

| Field | Meaning |
| --- | --- |
| `team.people[]` | **Now people active today only.** Paused and left people move out, so every EOD judgement (Today's team card, missed EOD counts) skips them. A pause or leave dated ahead stays here, with its status and date, until it starts. Management and Today lay `teamStatus.list` over it (`src/pages/ceo/teamRoster.ts`), so a change shows before the recompute lands. |
| `team.inactive[]` | Paused and left people, `TeamPerson` shape, paused first, then newest `statusSince`. A status row is listed even with no filing in 30 days. A left person drops off 30 days after `statusSince`, unless they filed an EOD after leaving (a warn note names them). |
| `team.people[].status`, `.statusSince`, `.statusNote`, `.statusSetAt` | The hand-set status, on both lists. Missing status reads as `"active"`. |
| `eodYesterday`, `eod14` | For a paused or left person only working days before `statusSince` are due; from `statusSince` on it is "not due". |

### `money` (Money, Today, Frontend, Sales)

| Field | Meaning |
| --- | --- |
| `money.rails.manual` | A `CashRail` built from live hand entries, by `day`, at `amountUsd`. `connected` is true once any live entry exists; before that every number is null. `refundsMtd` is always null. `lastPaymentAt` is Kuwait midnight of the newest entry's day. |
| `money.rails.total` | Now Whop plus Tap plus manual, over the connected rails. Possible duplicates are still inside it. |
| `money.manualEntries[]` | `ManualPaymentRow`: this month's entries, live and removed (`deletedAt` set), newest first. `id` is what `remove` and `restore` take. `possibleDuplicate` flags a live entry that is in the list below. |
| `money.possibleDuplicates[]` | `PossibleDuplicate`: a live entry of the last 90 days and a Whop or Tap payment at most 3 days apart, amounts within 5% of the larger, similar client name (Tap has no name in the cockpit's read, so day and amount only, and `why` says so). A manual deal value is also checked against closer form deals. Never removed automatically; a warn note names the count and the dollars. |
| `money.deals.manualMtd`, `.manualContractedMtd`, `.manualContractedLastMonth` | Hand-logged deals. `deals.mtd` and `deals.contractedMtd` stay closer form only (the targets compare against them). The contracted headline is `contractedMtd + manualContractedMtd`, shown as two lines. |
| `money.monthly[].manualCash`, `.manualContracted` | The same per month, beside the Whop `cash` and closer form `contracted`. |
| `money.cash.*` | **Unchanged**, still Whop only. |

Notes the money adapter must write: the manual rail is only what was typed in,
so a transfer nobody logged is missing, not zero; hand entries are converted at
the fixed rate stored on each row; possible duplicates are counted until removed.

### `clients` (Client success, Backend)

`clients.churn` (`ChurnPayload`), under decisions 1 and 4 and the renewal rule:

| Field | Meaning |
| --- | --- |
| `churn.month` | The Kuwait month the month lists cover. |
| `churn.churnedThisMonth[]` | `ChurnClient`: launched clients (Launch Date set) lost this month, logo churn. Includes term ended with no renewal payment when the term end is this month. `reason` is `"stopped"` or `"term-ended-no-renewal"`; `day` dates the loss. |
| `churn.lostBeforeLaunchThisMonth[]` | Clients with no Launch Date lost this month. Never churn, never in the rate. |
| `churn.renewalDueSoon[]` | `TermClient`: launched clients whose term end (Launch Date + 90 days) is today to today + 15 days, soonest first. |
| `churn.termEndedRenewed[]` | Past term end with a payment on any rail dated after it; `renewal` is that payment (`rail`, `day`, `amountUsd`, `matchedBy`). |
| `churn.termEndedNoRenewal[]` | Past term end, no such payment, counted as churned, each named. `cardBucket` shows when the card still says Active. |
| `churn.launchedAtMonthStart`, `churn.rate`, `churn.rateWhy` | The logo churn rate and its denominator, or null with the reason. |
| `churn.complete` | False while the cockpit's own daily history does not cover the whole month. The card says "partial". |
| `churn.notes[]` | Must include, and the card must show: a late payer looks churned until the payment lands; instalments on the original contract can look like a renewal; a payment before the term end is not a renewal; a payment counts only when it can be tied to the client (Tap charges carry no client, so only a hand entry with a ClickUp client counts for Tap). |
| `clients.rows[].launchDate`, `.termEnd`, `.termState` | Per client: `"in-term"`, `"renewed"`, `"no-renewal"` or `"not-launched"`. |

How a stop is dated: the clients adapter writes one daily point per client,
metric `clients.bucket`, scope `client:<ClickUp task id>`, value 0 active,
1 onboarding, 2 paused, 3 churned. The first day a client reads 3 is its stop
day. A stopped client with no such day (stopped before the history began) is
not in the month lists and is counted in a note. `clients.counts.churned`
stays the roster snapshot it always was.

## W5. Which tab shows what

| Tab | New on it | Reads |
| --- | --- | --- |
| Management | A status control per person (active, paused, left, since, note) calling `teamStatus.set`; a separate "Paused and left" card; the change history if wanted | `team.people[]`, `team.inactive[]`, `.status*`, `teamStatus.history` |
| Money | A "Log a payment" form (`manualPayments.add`, client picker from `clientOptions`); a Manual row in Cash by rail; a "Hand-logged this month" card with remove and restore; a "Possible duplicates" card; contracted shown as closer form plus hand-logged | `money.rails.manual`, `money.manualEntries[]`, `money.possibleDuplicates[]`, `money.deals.manual*`, `money.monthly[].manual*` |
| Today, Frontend | Nothing new to build: the cash hero reads `cashHeadline`, whose total now includes the manual rail | `money.rails.total` |
| Sales | Optional: a hand-logged contracted line under the closer form figure | `money.deals.manualContractedMtd` |
| Client success | A churn card (churned this month, lost before launch, rate, partial flag) and a term card (renewal due soon, term ended and renewed with its payment, term ended with no renewal), each client named, with `churn.notes` on the card | `clients.churn`, `clients.rows[].termState` |
| Backend | Optional: logo churn this month and lost before launch on the Client success card | `clients.churn.churnedThisMonth`, `.lostBeforeLaunchThisMonth` |

**Owed in the shared kit:** `cashHeadline()` in `src/components/ceo/metrics.ts`
names the scope "all connected rails" only when Tap is connected and "Whop
only" otherwise. Once `rails.manual` is connected the total is no longer Whop
only, so its `scope` must name the connected rails ("Whop and hand-logged",
"Whop, Tap and hand-logged"). Whoever builds the Money half owns that change,
and Today, Frontend and Money pick it up together.

This section supersedes two NO SOURCE YET lines above: "Retention and churn
rate over time" (Backend) now has a partial source in `clients.churn`, and
"Cash won against cash contracted" (Frontend) is still not computable, because
a hand entry ties cash to a client, not to a deal.
