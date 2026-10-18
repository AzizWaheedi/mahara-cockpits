# Pay plans: commission and bonuses on Team & payroll

Aziz (the CEO), 2026-10-18, on the CEO cockpit's Team & payroll tab: the call
centre agent gets "$5 per sold client appointment and $20 per closed client
appointment. Add to the other options, which is a closed client deal"; the
media buyer gets a bonus "if the client's average cost per lead" is in a band;
the client success manager's contract section 7; the creative strategist's
churn bonus, cost-per-lead bonus with guardrails and SMM commission; the
systems manager "$200 per fully built-out system and $400 per huge built-out
system". "We can also track the cost per booking because I'm thinking about
incentivizing the creative director on cost per booking instead of cost per
lead. Maybe even adding that to [the media buyer]. Just make it really easy to
add to the team and payroll ... add these for now but keep the bases the same."
Then, the same day: "credit the commission to the payroll as well if he set
and closed the appointment as well. And the closer also gets a $250 bonus if
it's a pay and fall [paid in full]", with the closer's cash credited from every
payment source (contract `docs/money/MONEY-ATTRIBUTION.md`).

This file is the contract. Names are final; change them here first.
Research: `hw-notes/pay_*.md`, `hw-notes/money_*.md`, reviews in
`hw-notes/pay_contract_review.md` (2026-10-18).

**Fixtures and tests use made-up people and clients only** ("Agent One",
"Client A", `@example.test`). No real name, client or `@maharamedia.com` in any
new fixture, stub or assertion.

## 1. Decisions (defaults chosen, reported to the CEO after)

1. **Bases do not change.** `cockpit_people.monthly_cost`, `cockpit_pay_history`
   and the Hours & pay approval stay as they are. Everything here is added on
   top. The CSM's $2,000 is his base; the creative strategist's roster base
   stays although her contract text says $1,000. A paused person's base is
   held back for the paused days in the pay month, as the roster and Hours &
   pay hold it back (fix of 2026-10-18): without an approved Hours & pay figure
   the roster base is pro-rated to the days not paused, and so is a ramp
   guarantee; the receipt says "Paused 1 Oct to 31 Oct: the $1,100 roster base
   is held back". The stored figures are untouched.
2. **"Sold" is read as "shown"** (the roster note says "$5 per shown client
   appointment and $20 per closed deal our client gets"). Two bases join the
   commission options (the literal ask): `per_client_appt_shown` and
   `per_client_deal_closed`. The agents move from `other` + note to these two
   lines. If "sold" means booked, September would pay $505 and $275 instead of
   $135 and $95: the facts carry `booked` per agent so a later
   `per_client_appt_booked` basis needs no new data work (reported).
3. **Everything else is a pay plan**: a list of parts. A plan belongs to a role
   (everyone with that role follows it) or to one person (an own plan, or
   "follow the role plan" from a month). Plans are versioned by month
   (`from_month`, the 1st) and never rewrite an approved month. A role plan
   may carry `commission` defaults: when a person's commission lines differ
   from their role plan's, the month says so and offers "Apply the role's
   commission"; picking a role in Add someone or on the row pre-fills them.
4. **Band reading: a band runs until the next band starts.** Whole-number
   ranges as said cover the whole number: "$10–12" covers up to $12.99,
   "1–4% churn" up to 4.99%. A band written "up to X" before an "above X" band
   includes X. **The top paid band ends at the number given when nothing is
   given above it**: $15.40 pays the media buyer $0; 12.5% logo churn pays the
   strategist $0. The server rounds the value first (money to the cent,
   percent to 0.01) and picks. $12.45 pays the media buyer $200; 1 of 22
   (4.55%) pays the CSM $1,500.
5. **"The client's average cost per lead" is pooled**: lead-campaign spend /
   Meta form leads over the month's clients (the board's own rule, "ratios of
   sums"). One bonus a month. On all spend October would read $17.37 ($0)
   instead of $12.45 ($200); the input note shows non-lead spend so moving
   budget out of lead campaigns is visible.
6. **Cost per booking is tracked every month** (all spend / confirmed bookings,
   board rule) beside cost per lead, and any band part switches to it with one
   select; switching suggests the bands × 4 ($60 / $15 gates) and saves nothing
   until the CEO confirms.
7. **Missing is never zero.** An unknown input is `n/a` with the reason; the
   month shows "at least $lowest" where `lowest` subtracts the worst band of
   every missing band part (the CSM's −$250 included) from `known`, which
   holds everything settled, the amount a waiting line or part has settled
   included; while a person's lines differ from the role plan's, each priced
   line counts at the lower of the two rates. So `lowest` ≤ `known`. A rule
   outcome of $0 always says why.
8. **What the data cannot see is typed by the CEO**, one audited entry per
   item, and the contract's general conditions are enforced: renewals,
   reactivations, upsells, recurring services and referrals need a client, a
   cleared date in the month and an evidence reference (a payment id or a
   signed contract id); Google reviews need a link and a posted date and are
   listed for a 30-day check. Measures whose sources disagree (churn,
   qualifying clients, owned creative, closes seen only on a client sheet, who
   set a deal, a paid-in-full under 99%) are **proposed** with the list behind
   them and **confirmed** by the CEO. One action, "Nothing else for
   [month]", sets every typed part still waiting to none.
9. **Earned month and pay month.** Counted in the month earned (cleared,
   shown, closed); the screen says "Earned in October, paid with November's
   payroll". A month can be approved from the 3rd of the next month. An
   approved person-month is shown from its frozen result, with any drift since
   approval ("Changed since approval: +$20, 1 show marked 6 Nov. Add to
   November") pre-filling an adjustment in a later month. A figure approved
   with an amount that cannot be read now (its facts failed) is `unread`,
   never a change to $0: `deltaUsd` is null, the receipt says the change is
   not known, and nothing is pre-filled.
10. **Who a bonus covers.** The media buyer's covers every client in the
    month. The creative strategist's cost-per-lead bonus covers only clients
    whose running creative she owns: a monthly confirmation
    `owned_creative:<personId>`, proposed from creative script tasks assigned
    to her, last month's list carried forward as the pre-fill.
11. **The CSM's ramp guarantee** is `{amount: 1200, days: 60}` from each
    person's own start, a confirmation `ramp_start:<personId>` (pre-filled from
    the roster's added day; never `started_on`, which pro-rates base pay). It
    compares base + the per-client-over-20 part (contract 7.1/7.2). With a
    $2,000 base it reads "Not needed". Seed: the current CSM 2026-10-02.
12. **Plan amounts are USD.** A non-USD base converts at `USD_PER`.
13. **SMM commission**: 0% in month 1, 10% in months 2–6, 5% from month 7 (the
    contract's "from month 7 onward"), pro-rated to a mid-month cancel date;
    recurring services 20% in month 1, 5% after, ending on cancel or a lapse
    over 30 days.
14. **The closer** (from `docs/money/MONEY-ATTRIBUTION.md`): commission lines
    `closed_cash` 10% and `set_cash` 5% are now **measured**: cash cleared in
    the month on deals the person closed / set, from every rail, up to the
    contract value within 120 days of signing. A deal he set and closed earns
    both. **$250 paid-in-full bonus** once per deal he closed, in the month the
    deal's cash reaches 99% of its contract within 45 days of signing (90–99%
    waits for `pif:<responseId>`). Who set a deal: the CEO's confirmation, else
    the form's setter and the last intro before signing when they agree (or
    only one exists); when they disagree it waits.
15. **Commission lines and role are versioned** like pay: a change is dated to
    the 1st of the Kuwait month, so a past month keeps the lines and role it
    had. A new person's lines and role are dated from the month they started
    (`least(started_on, today)`, the rule base pay follows), so someone added
    after their start month has them for the months they worked.

## 2. Plans seeded on go-live (from October 2026)

Role keys are `cockpit_people.role` (stored btrim, matched lower(btrim())).

```jsonc
// Media buyer
{"version":1,"parts":[
 {"key":"cpl_bonus","kind":"band","label":"Bonus by cost per lead","metric":"cpl","covers":"all_clients",
  "bands":[{"upTo":8,"inclusive":false,"amount":400},{"upTo":10,"inclusive":false,"amount":300},
           {"upTo":13,"inclusive":false,"amount":200},{"upTo":15,"inclusive":true,"amount":100},
           {"upTo":null,"amount":0}]}]}

// Creative strategist
{"version":1,"parts":[
 {"key":"churn_bonus","kind":"band","label":"Bonus by last month's churn","metric":"logo_churn_prior",
  "bands":[{"upTo":5,"inclusive":false,"amount":1200},{"upTo":8,"inclusive":false,"amount":700},
           {"upTo":10,"inclusive":false,"amount":300},{"upTo":12,"inclusive":true,"amount":150},
           {"upTo":null,"amount":0}]},
 {"key":"cpl_bonus","kind":"band","label":"Bonus by cost per lead","metric":"cpl","covers":"owned_creative",
  "guard":{"minClients":5,"minSpendUsd":500,"excludeDays":14},
  "bands":[{"upTo":10,"inclusive":false,"amount":300},{"upTo":13,"inclusive":false,"amount":200},
           {"upTo":15,"inclusive":false,"amount":100},{"upTo":null,"amount":0}]},
 {"key":"smm","kind":"share","label":"Social media management commission","of":"smm_revenue",
  "steps":[{"fromMonth":1,"rate":0},{"fromMonth":2,"rate":0.10},{"fromMonth":7,"rate":0.05}],
  "ends":{"onCancel":true},"prorateOnCancel":true}]}

// Client success manager
{"version":1,"parts":[
 {"key":"over_20","kind":"per_above","label":"Per qualifying client over 20","measure":"qualifying_clients","over":20,"amount":50},
 {"key":"ramp","kind":"floor","label":"Ramp guarantee","amount":1200,"days":60},
 {"key":"retention","kind":"band","label":"Retention bonus by churn","metric":"csm_churn",
  "bands":[{"upTo":0,"inclusive":true,"amount":2000},{"upTo":5,"inclusive":false,"amount":1500},
           {"upTo":9,"inclusive":false,"amount":1000},{"upTo":11,"inclusive":false,"amount":500},
           {"upTo":13,"inclusive":false,"amount":250},{"upTo":15,"inclusive":true,"amount":0},
           {"upTo":null,"amount":-250}]},
 {"key":"renewals","kind":"per_event","label":"Renewals","event":"renewal","amount":300},
 {"key":"reactivations","kind":"per_event","label":"Reactivations","event":"reactivation","amount":300},
 {"key":"upsells","kind":"share","label":"Backend upsells","of":"upsell_cash","steps":[{"fromMonth":1,"rate":0.10}]},
 {"key":"recurring","kind":"share","label":"Recurring services","of":"recurring_revenue",
  "steps":[{"fromMonth":1,"rate":0.20},{"fromMonth":2,"rate":0.05}],"ends":{"onCancel":true,"lapseDays":30}},
 {"key":"referrals","kind":"per_event","label":"Referrals","event":"referral","amount":250},
 {"key":"video_testimonials","kind":"per_event","label":"Video testimonials","event":"video_testimonial","amount":150},
 {"key":"google_reviews","kind":"per_event","label":"Google reviews","event":"google_review","amount":75},
 {"key":"podcasts","kind":"per_event","label":"Podcast case studies","event":"podcast_case_study","amount":250}]}

// Systems manager
{"version":1,"parts":[
 {"key":"systems","kind":"per_event","label":"Fully built-out systems","event":"system_built","amount":200},
 {"key":"systems_large","kind":"per_event","label":"Huge built-out systems","event":"system_built_large","amount":400}]}

// Call centre agent
{"version":1,"parts":[],"commission":[{"basis":"per_client_appt_shown","rate":5},{"basis":"per_client_deal_closed","rate":20}]}

// Closer
{"version":1,"parts":[
 {"key":"pif","kind":"per_event","label":"Paid-in-full bonus","event":"pif_deal_closed","amount":250}],
 "commission":[{"basis":"closed_cash","rate":0.10},{"basis":"set_cash","rate":0.05}]}
```

Seeding (`docs/pay/seed-2026-10.sql`, run as the CEO through the RPCs, after
the migrations): the six role plans from 2026-10-01; confirmation
`ramp_start:<CSM id>` = 2026-10-02. The two agents' commission lines move to
the new bases **only after** the web bundle that knows them is live (§11).

## 3. Plan JSON (version 1)

```ts
type Plan = { version: 1; parts: Part[]; commission?: {basis: CommissionBasis; rate: number}[] /* role plans only, ≤ 2 */ };
type Part = BandPart | PerEventPart | SharePart | PerAbovePart | FloorPart;
// every part: key (^[a-z][a-z0-9_]{0,39}$, unique), kind, label (1..80)
type BandPart = { kind:"band"; metric:"cpl"|"cpb"|"logo_churn_prior"|"csm_churn";
  covers?: "all_clients"|"owned_creative";      // cpl/cpb only; default all_clients
  bands: {upTo:number|null; inclusive?:boolean; amount:number}[];  // inclusive REQUIRED (boolean) when upTo is a number
  guard?: {minClients?:number; minSpendUsd?:number; excludeDays?:number} };   // cpl/cpb only
type PerEventPart = { kind:"per_event"; event:EventKey; amount:number; eventLabel?:string /* custom only */ };
type SharePart = { kind:"share"; of:"upsell_cash"|"recurring_revenue"|"smm_revenue"|"custom_cash";
  steps:{fromMonth:number; rate:number}[]; ends?:{onCancel:boolean; lapseDays?:number}; prorateOnCancel?:boolean };
type PerAbovePart = { kind:"per_above"; measure:"qualifying_clients"; over:number; amount:number };
type FloorPart = { kind:"floor"; amount:number; days:number };
type EventKey = // typed by the CEO:
  "renewal"|"reactivation"|"referral"|"video_testimonial"|"google_review"|"podcast_case_study"
  |"system_built"|"system_built_large"|"custom"
  // counted by the cockpit:
  |"pif_deal_closed";
```

Validation, one set of sentences in SQL `cockpit_pay_plan_check(plan, is_role)`
and TS `checkPlan(plan, {isRole})`, tested against one shared table of plans:
- **Unknown keys are refused** at plan, part, band, guard, step and ends level.
- ≤ 20 parts; keys unique; label required; amounts finite, |amount| ≤ 100,000.
- band: 2..10 bands; every band but the last has a number `upTo` and a boolean
  `inclusive`, strictly ascending; the last has `upTo: null`; churn metrics
  upTo in 0..100, money metrics upTo > 0; `covers` and `guard` only on cpl/cpb;
  minClients 1..100, minSpendUsd 0..100,000, excludeDays 0..90; negative
  amounts allowed; at most one band part per metric+covers.
- per_event: amount ≥ 0; `custom` needs `eventLabel`; `pif_deal_closed` at most once.
- share: 1..6 steps, first fromMonth 1, strictly ascending, rate 0..1;
  lapseDays 1..365.
- per_above: over 0..1,000, amount ≥ 0. floor: amount > 0, days 1..366; ≤ 1 floor.
- `commission`: role plans only, ≤ 2 lines, bases from `COMMISSION_BASES`
  except none/other, share rates 0..1, the two bases different.

Band pick: SQL `cockpit_pay_band_pick(bands, value)` rounds (money 2 dp, pct
2 dp, half away from zero) then takes the first band with a number `upTo` and
`inclusive ? v <= upTo : v < upTo`, else the last band. TS `pickBand` does
**not** round: it takes the server's already-rounded `input.value`; for an
unsaved draft it rounds a decimal string half away from zero. Shared vectors:
12.45, 15.00, 15.40, 4.55, 15.01, 0, 9.995, 12.995, 14.995, 4.995.

## 4. What each part and line reads in a month

| Part / line | Input | Source | States |
|---|---|---|---|
| band `cpl`, covers all | pooled lead-campaign spend / Meta leads over the month's measured clients | `cockpit_pay_facts_ads` | no client with leads → `missing` |
| band `cpl`, covers owned_creative | the same over the confirmed owned set, then the guard: clients with ≥ minSpendUsd **all** spend in the month, each client's days before creative start + excludeDays dropped; < minClients left → `not_met` ($0, reasons named) | ads facts + confirmation `owned_creative:<personId>` (month M) | no confirmation → `missing` (proposal shown) |
| band `cpb` | pooled all spend / confirmed bookings over clients whose spend is measured and whose bookings are stored for every day (DWY out; each left-out client named with why) | ads facts | 0 bookings with spend → `missing` |
| band `logo_churn_prior` | the **previous** month's company logo churn % | confirmation `logo_churn` under month M−1; proposal `cockpit_pay_facts_clients(M−1)` | none → `missing` |
| band `csm_churn` | this month's mid-programme churn % of the person's book | confirmation `csm_churn:<personId>` under M; proposal from clients facts | none → `missing`; book matches no card → `missing` ("No client card names <name> as CSM") |
| per_event (typed) | Σ non-void entries' quantity | `cockpit_pay_entries` | no entry → `missing` ("Waiting for your count") until an entry or "Nothing else" |
| per_event `pif_deal_closed` | the person's earned PIF deals in M | `cockpit_pay_facts_sales` | any `waiting` PIF → `waiting`; ledger not written → `missing`; a PIF in M whose closer keys to nobody → `waiting` |
| share | Σ cash × rate(step for engagementMonth) × proration | entries | as typed per_event |
| per_above | confirmed count (`qualifying:<personId>`), or the data's upper bound when the book is non-empty and the bound ≤ over (then $0, measured) | clients facts | else `missing` |
| floor | max(0, amount − (base + per_above)) for months overlapping [start, start + days − 1] | confirmation `ramp_start:<personId>` | no start → `missing` ("Type the contract start"); base unknown → `missing` |
| line `per_client_appt_shown` | the agent's shows (method B) | `cockpit_pay_facts_calls` | measured; unmarked meetings named, never counted; no email on the roster, or one shared with someone else → `missing` (nothing can be credited to them) |
| line `per_client_deal_closed` | the agent's confirmed closes, one per (client, contact) a month: portal won confirms; a sheet-only close needs `close:<appointmentId>` | calls facts | unconfirmed close → `waiting` |
| line `closed_cash` | rate × Σ cleared deal cash in M on deals the person closed | `cockpit_pay_facts_sales` | measured; deal ledger not written (`cashThrough` null or `ledgerReady` false) → `missing`; a deal with cash in M whose closer keys to nobody (`unkeyed`) → `waiting` for every closed-cash line, with the names |
| line `set_cash` | rate × Σ cleared deal cash in M on deals the person set | sales facts + `setter:<responseId>` | a deal of theirs with a disagreeing or unknown setter → `waiting`; ledger not written → `missing`; a deal with cash in M whose setter keys to nobody and waits on nobody → `waiting` for every set-cash line |
| other lines (intros, demos, signed, contract, MRR) | not measured here | — | `not_here`: listed, left out, named in `notPriced` |
| adjustment (built in) | signed amountUsd with a note (and `fromMonth` when it corrects an approved month) | entries | known |

**Confirmations and the month they affect**: `logo_churn`@M affects M+1 for
people with a `logo_churn_prior` part; `csm_churn:<id>`@M, `qualifying:<id>`@M,
`owned_creative:<id>`@M, `ramp_start:<id>` (any month: stored under the start
month) affect that person; `close:<appointmentId>`@M affects the credited
agent in the meeting's month (the month must match the appointment's);
`setter:<responseId>` and `pif:<responseId>`@M affect the deal's closer and
setter in the months whose cash or PIF reads them: from the month of the
deal's first payment (money counts from 7 days before the form, a CEO tie
from any day) to 4 months after signing. A confirmation that would change an
approved person-month is refused.

### 4.1 Call centre (method B, `cockpit_pay_facts_calls`)

Ported from `hw-notes/tmp-pay/m_appt_q2.sql`, schema-qualified (search_path
''). Sources: `public.cockpit_people`, `ghl_clients`, `client_leads`,
`appointments`, `ghl_calendars`; `mahara_reporting.facts`, `sheet_snapshots`;
`mahara_console.attempts`; `portal_data.appointments`, `appointment_outcomes`;
optional `public.mahara_call_center_report`. Only `appointments.start_at` is
windowed (Kuwait month, ≤ now()); the sheet results, `project_rank`, dialer
receipts and the central sheet are read over all time. Each due main/online/
provisional appointment (not cancelled/invalid, no Google copy) is credited to:
the dialer's verified BOOKED receipt (reschedules walked back), else the
central sheet caller, else the client-sheet caller at the same contact and
time. A `CONFLICT` booker or a booker with no `cockpit_people` row goes to
`unattributed` with why. Show = board rule; unmarked is neither. Close = first
closed meeting per contact on the client sheet (no conflict) or a portal won
deal, counted once per (location, contact) per month, evidence `portal` when a
portal win exists. `booked` per agent = confirmed bookings by booking day.
Scorecard: called with `p_to = least(month end, Kuwait today)`, skipped when
the month has not started; its figures are shown, **never hashed**.
Live reference: September 27 / 19 shows, 0 / 1 closes; 2 shows unattributed.

### 4.2 Ads (`cockpit_pay_facts_ads`, from `month_final.sql`)

Clients = cards Active on ≥ 1 `rosterDays` snapshot in the month joined to
`cockpit_board_clients` by ClickUp id (a roster key with no board row is listed
`notMeasured: 'no board row'`). Spend, lead spend, Meta leads from
`cockpit_meta_ad_days` (`account_id = ANY(ad_account_ids)`, day in month, day <
today on the account's clock); bookings from `cockpit_client_days` with
`day < Kuwait today`. Per client `unpricedRows` (spend > 0, spend_usd null) and
`nullBookingDays`; either > 0 sets `notMeasured` for that measure and drops the
client from that pool. Creative start = card `launchDate`, else first
lead-campaign spend day. `nonLeadSpendUsd` per client and pooled. References:
September pooled CPL $13.83 (698 leads), CPB $57.78 (153 bookings, the
unshared-account client out); guarded (all clients) $14.92 over 11.

### 4.3 Clients (`cockpit_pay_facts_clients`)

Sources: `cockpit_csm_sources` (`rosterDays`, `churnEvents`, `clients`),
`cockpit_client_billing_days`, `cockpit_people`, `cockpit_pay_entries`
(renewals, for term starts), `cockpit_creative_sources` (`creativeTasks` script
tasks, for owned creative).
- **Start set** = cards Active or Paused on the last snapshot before the month
  (else the month's first snapshot, said so), the same set for the company and
  each CSM book. A lost card counts in the % only when it is in the start set;
  other losses are listed "lost, not in the start count".
- **Lost** = `churnEvents` kind lost dated in the month; plus **candidates**:
  start-set cards with a billing row in the month whose next_payment_date is
  more than 14 days past, or Paused more than 14 days. Each loss/candidate
  carries `startStatus`, `termStart` (later of launchDate and the latest
  renewal entry for the client: an entry with a count above 0 on a part that
  is a `renewal` event in its person's plan for that month, whatever the
  part's key), `dayOfTerm`, `midProgramme` (day < 90; null
  when no launch date), `cardChurnType` (latest `cockpit_client_billing_days`
  row, null when none), `csm`, `why`.
- **Book** = cards whose `csmAssigned` matches the person's name (unique
  lower(btrim)); cards with no or an unmatched CSM get their own row. The note
  says the book is today's CSM field.
- **Qualifying upper bound** = book cards Active on every snapshot of the last
  30 days to min(month end, today), minus cards whose billing row dated
  min(month end, today) exists with next_payment_date before that date; cards
  with no row stay in, counted "payment not checked"; `paymentCheckedOn`.
- **Owned creative proposal** = clients active in the month with a script task
  assigned to the person (unique lower(btrim) name; else a one-word ClickUp
  name that is a word of exactly one person's name, so "Sabry" finds "Ahmed
  Sabry" and a first name two people share finds nobody); others listed "no
  script task on record". Assignee names that match nobody are named in the
  note.

### 4.4 Sales (`cockpit_pay_facts_sales`)

Reads `cockpit_deal_payments` (active rows; written by the finance refresh, see
the money contract), `cockpit_sales_deals` (not voided), the people chain
(name → `cockpit_sales_reps` closer_aliases ∪ display_name, lower(btrim) →
`cockpit_sales_people.b2b_rep_id` → email → `cockpit_people`, **no active
filter**), setter evidence (`cockpit_sales_deals.setter`, the latest
pre-signing intro on the deal's B2B contact id, else the unique phone8 lead),
confirmations `setter:<responseId>` (`{personId|null}`) and
`pif:<responseId>` (`{earned:boolean}`). Shape:
`{from, to, cashThrough, ledgerReady, deals:[{responseId, signedDay, business, plan, contracted,
depositTyped, closer:{name, personId}, setter:{name, personId, source, disagree},
payments:[{paymentId, rail, day, usd, matchedBy}], cashInMonth, cashToDate,
pif:{state:'earned'|'waiting'|'no', day, shortUsd}}], people:[{personId,
closedCashUsd, setCashUsd, setWaiting:[], pifDeals:[], pifWaiting:[]}],
unkeyed:[{responseId, name, role}], note}`. `ledgerReady` is true once the
Money section carries its own count of the deal ledger
(`attribution.dealLedger`, the Sales tile's rule); with it false, or
`cashThrough` null, pay reads no deal cash (missing, never $0).
References (with the Turki → Madana tie): the closer's October to the 18th
$8,750 closed cash ($875), $6,000 set ($300), 1 PIF (Makers, 17 Oct) $250.

## 5. Database

Migrations: `20261018a_ceo_pay_plans.sql` (core), `20261018b_ceo_pay_facts.sql`
(facts, plpgsql). House style: `BEGIN; … COMMIT;`, safe twice, SECURITY DEFINER
`SET search_path=''`, loads in PGlite.

**Grants (all four tables, all sequences, all functions):** tables: RLS on, no
policy, `REVOKE ALL FROM PUBLIC, anon, authenticated, service_role`, `GRANT
SELECT TO service_role`. Sequences: `REVOKE ALL FROM PUBLIC, anon,
authenticated, service_role`. CEO RPCs: `REVOKE ALL … FROM PUBLIC, anon,
authenticated, service_role; GRANT EXECUTE … TO authenticated`. Internal and
facts functions and trigger functions: `REVOKE ALL … FROM PUBLIC, anon,
authenticated, service_role`, no grant. Guards: `BEFORE DELETE` (row) and
`BEFORE TRUNCATE` (statement) on `cockpit_pay_plans`, `cockpit_pay_entries`,
`cockpit_pay_months` reusing `public.cockpit_hours_refuse_delete()`; entries:
`BEFORE UPDATE` lets only `voided_at/voided_by/void_reason` go null → set once;
months: only approved → withdrawn with `withdrawn_*` set once, withdrawn rows
immutable.

**Every pay write RPC** (plan_save, entry_save, entry_void, none_rest,
confirm, approve, withdraw) starts with the gate `public.cockpit_hours_ceo_email()`
then `PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_pay',0))`, before
any check. Audit `public.cockpit_hours_audit(action, entity, id, after, actor)`;
`after` carries ids, months, kinds and keys, **never an amount**.

### 5.1 `20261018a` (core)

- `cockpit_people` CHECKs (both lines) gain `per_client_appt_shown`,
  `per_client_deal_closed`.
- `cockpit_commission_history(person_id, from_month, basis, rate, basis2, rate2,
  recorded_by, recorded_at)` and `cockpit_role_history(person_id, from_month,
  role, recorded_by, recorded_at)`, unique (person_id, from_month), seeded with
  every person's current values from 2026-01-01; AFTER INSERT/UPDATE OF
  commission_basis, commission_rate, commission2_basis, commission2_rate, role
  triggers upsert the row for the 1st of the Kuwait month. `cockpit_pay_compute`
  reads the values in force on the month's last day.
- `cockpit_pay_plans(id bigserial pk, role text, person_id bigint references
  cockpit_people(id), from_month date not null (day 1), plan jsonb, note text,
  set_by text not null, set_at timestamptz default now())`; exactly one of
  role/person; role stored btrim, non-empty, plan not null; unique
  (lower(btrim(role)), from_month) and (person_id, from_month). Person row with
  plan null = follow the role plan from that month.
- `cockpit_pay_entries(id bigserial pk, person_id bigint not null references
  cockpit_people(id), month date not null (day 1), part_key text not null,
  quantity numeric, cash_usd numeric, amount_usd numeric, engagement_month int,
  client text, product text, cleared_on date, posted_on date, cancelled_on date,
  evidence_ref text, evidence text, note text, from_month date, entered_by text
  not null, entered_at timestamptz default now(), voided_at, voided_by,
  void_reason)`.
- `cockpit_pay_confirmations(id bigserial pk, month date not null, key text not
  null, value jsonb not null, note text, set_by text not null, set_at
  timestamptz default now(), unique(month, key))`.
- `cockpit_pay_months(id bigserial pk, person_id bigint not null, month date not
  null, status text not null check in ('approved','withdrawn'), base_usd
  numeric, commission_usd numeric, parts_usd numeric not null, total_usd
  numeric, not_priced jsonb not null default '[]', result jsonb not null,
  result_hash text not null, approved_by text not null, approved_at timestamptz
  not null default now(), withdrawn_by, withdrawn_at, withdraw_reason)`; unique
  (person_id, month) where status='approved'; lock trigger.
- Internal: `cockpit_pay_plan_check(jsonb, boolean) returns text`,
  `cockpit_pay_band_pick(jsonb, numeric) returns jsonb` ({index, amount}),
  `cockpit_pay_plan_for(bigint, date) returns jsonb` ({source:'own'|'role'|
  'none', planId, fromMonth, plan, role}), `cockpit_pay_people_in(date) returns
  setof bigint` (not a bot; employed on ≥ 1 day of the month by
  `cockpit_employment_periods` or `ended_on`/`paused_on` inside it; with a plan
  or a non-none line in force; plus anyone approved or with a non-void entry in
  the month), `cockpit_pay_last_approved(bigint) returns date`,
  `cockpit_pay_settle_day(date) returns date` (3rd of next month),
  `cockpit_pay_compute(date) returns jsonb` (section 6).
- CEO RPCs (payload jsonb, camelCase, unknown keys refused):
  - `cockpit_ceo_pay_plans_list()` → `{plans:[{id, role, personId, fromMonth,
    plan, note, setBy, setAt}], roles:[text], people:[{id, name, role, active}],
    lastApproved:[{personId, month}], approvedPlanIds:[id]}`.
  - `cockpit_ceo_pay_plan_save({role?|personId?, fromMonth, plan|null, note?})`
    → `{ok, id}`. Refuses: the check sentence; not a 1st; on or before the last
    approved month of anyone it affects now or in any approved month that used
    that role plan ("October is approved for Agent One. Plans can change from
    November."); replacing a row referenced by a non-withdrawn approval; unknown
    person; empty role. Same scope+month replaces (`pay.planFix`), else inserts
    (`pay.planSave`).
  - `cockpit_ceo_pay_entry_save({personId, month, partKey, quantity?, cashUsd?,
    amountUsd?, engagementMonth?, client?, product?, clearedOn?, postedOn?,
    cancelledOn?, evidenceRef?, evidence?, note?, fromMonth?})` → `{ok, id}`.
    partKey a typed part of the person's plan for the month, or `adjustment`.
    per_event: integer quantity (negative only with a note: a clawback); share:
    cashUsd ≥ 0 and engagementMonth ≥ 1 when > 1 step; renewals,
    reactivations, upsells, recurring, referrals: client + clearedOn in the
    month ("Cleared on 3 Nov: add it to November.") + evidenceRef; google
    review: evidence link + postedOn; a residual (engagementMonth ≥ 2) is
    refused after the client's cancelledOn or a lapse over lapseDays; adjustment:
    amountUsd ≠ 0 + note; refused in an approved month ("October is approved.
    Add it to November as an adjustment."). Audit `pay.entry`.
  - `cockpit_ceo_pay_entry_void({id, reason})`. Audit `pay.entryVoid`.
  - `cockpit_ceo_pay_none_rest({personId, month})` → `{ok, parts:int}`: a zero
    entry for every typed part still missing. Audit `pay.noneRest`.
  - `cockpit_ceo_pay_confirm({month, key, value, note?})`. Keys and values:
    `logo_churn`, `csm_churn:<id>` `{lost:int, activeAtStart:int>0, clients:[]}`;
    `qualifying:<id>` `{count:int}`; `owned_creative:<id>` `{clients:[clickupId]}`;
    `ramp_start:<id>` `{day:'YYYY-MM-DD'}`; `close:<appointmentId>`
    `{confirmed:boolean}`; `setter:<responseId>` `{personId:int|null}`;
    `pif:<responseId>` `{earned:boolean}`. `value: null` removes. Audit
    `pay.confirm`.
  - `cockpit_ceo_pay_month(p_month date)` → section 6.
  - `cockpit_ceo_pay_month_approve({month, people:[{personId, totalUsd,
    resultHash}]})` → `{ok, approved, existing, refused:[{personId, sentence}]}`.
    Duplicate personIds refused; a person with a non-withdrawn approval of the
    same hash is `existing`; otherwise must be `ready`, the total and hash must
    match the recompute ("The figures changed since you opened the month.
    Reload and check again."), and today ≥ the settle day ("Approve October
    from 3 November."). Stores the frozen result (plan JSON, inputs, evidence
    ids: credited appointment ids, deal ids and payment ids, clients behind
    each band, entry ids). Audit `pay.approve` per person.
  - `cockpit_ceo_pay_month_withdraw({personId, month, reason})`; refused while
    a non-void adjustment with `fromMonth = month` sits in an approved later
    month ("Withdraw November first."). Audit `pay.withdraw`.
  - `cockpit_ceo_pay_costs()` → `{months:[{personId, month, commissionUsd,
    partsUsd, notPriced}]}` (approved, last 3 months).

### 5.2 `20261018b` (facts)

`cockpit_pay_facts_calls(p_from date, p_to date)`, `cockpit_pay_facts_ads(p_from
date, p_to date, p_exclude_days int)`, `cockpit_pay_facts_clients(p_month date)`,
`cockpit_pay_facts_sales(p_from date, p_to date)` — shapes in §4 and:
- calls: `{from, to, agents:[{email, personId, name, due, shows, noShows,
  unmarked, booked, showsBy:{console, central, sheet}, closes:[{appointmentId,
  locationId, client, contactId, meetingAt, evidence, value, currency}]}],
  unattributed:{due, shows, items:[{appointmentId, client, meetingAt, why}]},
  scorecard:{to, callers:[{name, email, shows, closed}]}|null, scorecardNote}`.
- ads: `{from, to, adThrough, excludeDays, clients:[{clickupId, locationId, name,
  serviceMode, activeDays, creativeStart, spendUsd, leadSpendUsd,
  nonLeadSpendUsd, leads, bookings, cpl, cpb, unpricedRows, nullBookingDays,
  after:{spendUsd, leadSpendUsd, leads, bookings}, notMeasured:{cpl, cpb}}],
  pooled:{clients, leadSpendUsd, nonLeadSpendUsd, leads, cpl, spendUsd,
  bookings, cpb, cpbClients, outOfCpl:[{name, why}], outOfCpb:[{name, why}]}, note}`.
- clients: `{month, snapshots:{first, last, startFrom}, logo:{startSet,
  lost:[…], candidates:[…], notInStart:[…], proposal:{lost, activeAtStart,
  pct}}, byCsm:[{personId, name, startSet, lost, candidates, proposal,
  qualifying:{upperBound, clients, paymentNotChecked, checkedFrom, checkedTo,
  paymentCheckedOn}}], ownedCreative:[{personId, name, clients:[{clickupId,
  name}], others:[{clickupId, name}]}], note}`.

## 6. The month (`cockpit_ceo_pay_month`)

```jsonc
{ "month":"2026-10-01", "today":"…", "closed":false, "settleDay":"2026-11-03",
  "facts": {"ads":{…}, "adsGuarded":{"14":{…}}, "calls":{…}, "clients":{…}, "clientsPrior":{…}, "sales":{…}},
  "people": [ {
    "personId":1, "name":"…", "role":"…", "currency":"USD",
    "base": {"usd":700, "amount":700, "source":"roster"|"hours_approved", "paused"?:{"days":31, "of":31, "from":"2026-10-01", "to":"2026-10-31", "fullUsd":1100, "heldUsd":1100}} | {"usd":null, "source":"none", "note":"No base set"},
    "plan": {"source":"role"|"own"|"none", "planId":3, "fromMonth":"2026-10-01", "role":"…"},
    "roleCommission": {"matches":true} | {"matches":false, "sentence":"…", "lines":[…]},
    "commission": [ {"line":1, "basis":"…", "rate":5, "quantity":27, "baseUsd":null, "amountUsd":135, "state":"measured"|"waiting"|"not_here", "note":"…", "evidence":[ids]} ],
    // a waiting set-cash line: "waiting":[{"responseId", "business", "state", "form", "intro"}] (form and intro null when nobody on record set it)
    "parts": [ {"key":"…", "kind":"band", "label":"…", "input":{"value":12.45, "unit":"usd"|"pct"|"count"|"cash", "state":"measured"|"confirmed"|"typed"|"missing"|"not_met"|"waiting", "source":"…", "note":"…", "proposal":{…},
                "confirmed":{…} /* the stored confirmation it read */, "alsoTracked":{"metric":"cpb", "over":"every_client"|"same", "value":103, "state":"measured", "note":null},
                "waiting":[{"responseId", "business", "shortUsd", "day"}] /* a paid-in-full at 90 to 99% */},
                "band":{"index":2}, "amountUsd":200, "state":"known"|"missing"|"not_met"|"waiting" } ],
    "entries": [ … ], "reviewsToCheck": [ {"entryId", "postedOn", "checkBy"} ],
    "knownUsd": 900, "lowestUsd": 650, "totalUsd": 900 | null, "missing": ["…"], "notPriced": ["closed_contract"],
    "status": "in_progress"|"waiting"|"ready"|"approved",
    "approval": {"approvedAt", "approvedBy", "totalUsd", "frozen":{…}} | null,
    "sinceApproval": {"deltaUsd":20 | null, "unread":false, "changes":[{"what":"…", "frozen":…, "now":…, "unread":false, "items":[…]}]} | null,
    "resultHash": "md5 of the canonical paid inputs and amounts only" } ],
  "notOnAPlan": [ {"personId", "name", "role", "why"} ],
  "notes": ["Earned in October, paid with November's payroll.", "…"] }
```

`totalUsd` = base + measured commission + parts + floor top-up, only when
nothing is missing or waiting and the base is known; else null with `knownUsd`,
`lowestUsd` and the `missing` sentences. A person whose lines are all
`not_here` and who has no parts is listed but never `ready`. The hash covers
plan id, part inputs and states, band indexes, quantities, entry ids and
amounts — never scorecard figures or notes. `status` `ready` needs: the month
closed (today ≥ settle day), nothing missing or waiting, base known.

## 7. Browser code (apps/media-buyer-cockpit)

- `src/types/ceo/payPlan.ts`: types; `PART_KINDS`, `BAND_METRICS`, `EVENTS`
  (typed vs counted), `SHARE_OF`; `checkPlan`; `pickBand`; `planSentence`;
  `partSentence`; `suggestBands(bands, from, to)` (× / ÷ `CPB_GATE/CPL_GATE`
  from `src/lib/kpi.ts`); `ROLE_PLANS_2026_10` (§2).
- `src/types/ceo/commission.ts`: the two bases ("per client appointment that
  shows up" / "Per client appointment shown"; "per deal our client closes
  (confirmed)" / "Per closed client deal"). `costsModel.ts` `BASIS_ON` maps them
  to new Projection keys `clientApptsShown` / `clientDealsClosed` (null today:
  unpriced and named).
- `src/lib/ceoPeopleModel.ts`: `basisOf` keeps an unknown basis as an explicit
  unknown (shown "Unknown rule: <value>", never saved back as none);
  `TeamTab` never sends a line it cannot read.
- `src/lib/ceoPayClient.ts`: `client.rpc("cockpit_ceo_pay_…")` literals, zod
  `.passthrough()`. `src/lib/cockpitApi.ts`: `api.ceo.pay.{list, month, costs}`
  reads; `savePlan, entry, voidEntry, noneRest, confirm, approve, withdraw`
  writes.
- `src/dev/hoursHarness.ts`: made-up fixtures for every `cockpit_ceo_pay_*`.

## 8. Screens (Team & payroll; design plan `hw-notes/pay_design.md`)

Load `mahara-context/skills/frontend-design/SKILL.md` first. The CEO kit only;
phone first; sheets scroll inside; `pt-safe`; 40 px touch.

1. **Pay plans card** (`src/pages/ceo/pay/PayPlansCard.tsx`, JSX between Hours
   and pay and On the team): one row per role plan ("Media buyer · bonus by cost
   per lead, up to $400 · 1 person · from Oct 2026 ›"), "Plan for a role".
2. **Pay plan sheet** (`PayPlanSheet.tsx`): person scope first offers "Follows
   the <role> plan · role / Own plan"; parts as cards with an editor per kind;
   "Add a part" (grouped select); "Applies from [month]" + "Fix a typo";
   "Save the pay plan" → "Pay plan saved."; server sentences as errors.
3. **Band ruler** (`BandRuler.tsx`, the signature element): track over the
   metric, segments with payouts, Mono edges, this month's tick (server value),
   deduction band muted with a critical dot, `role="img"` + `aria-label`;
   band rows with an "includes" toggle on each edge; "Paid on [Cost per lead ▾]"
   with the × 4 switch dialog (a name that says the old metric is renamed:
   "Bonus by cost per lead" → "Bonus by cost per booking"); "Also tracked:
   cost per booking $X this month, not paid on." over every client for a part
   that counts every client, else over the same clients and guard
   (`input.alsoTracked`). After a switch the ruler's tick is the month's value
   on the new metric, never the old one's.
4. **Row**: commission lines keep their editor (new bases listed); one line
   under them: plan sentence + "Edit pay plan"/"Add a pay plan"; picking a role
   pre-fills commission from the role plan. Add someone: "Media buyer plan
   applies: …" and the pre-fill.
5. **Pay for [month] card** (`PayMonthCard.tsx`, after On the team): month
   chips (this month + 3 back). Per person a receipt: base, each line and part
   with input, source and state, entries, total ("at least $lowest" + `A floor`
   chip), status chip. In place: "Add a count" (`PayEntryDialog`), "Nothing else
   for [month]", "Confirm" (`PayConfirmDialog`, numbers editable, list behind
   the proposal, tick/untick candidates), "Confirm close" / "Not a close",
   "Confirm setter", "Apply the role's commission", "Approve [month]" (sends
   totals and hashes; shows refused sentences), "Withdraw". Approved people
   show the frozen receipt plus "Changed since approval" with "Add to [month]".
   Folded "Where these numbers come from": ads per client (CPL, CPB, non-lead
   spend), call centre per agent with the scorecard beside it, churn lists,
   deals and payments behind the closer's lines, each source's `note` list,
   the names that match nobody (`sales.unkeyed`) and the money tied to no
   deal (`sales.unattributed`). The headline is "Complete for N of M" with
   "At least, for everyone" until every month is known ("So far" while the
   month runs, "Total" once closed), said in a sentence, never a hover. Pay
   figures keep their cents. "Change" on a confirmed measure starts from the
   confirmation; owned creative pre-fills last month's list. Approve names
   who is not in it and why. General-conditions sentence
   only on receipts with the parts it governs.
6. **Roster tiles**: "On commission" counts lines or a plan.
7. **Costs**: closed month adds approved commission and parts and names
   `notPriced`; the estimate adds each person's latest approved parts as an
   estimate and names people with a plan but no approved month.

## 9. Tests (add each new file to `scripts/verify-cutover-readiness.py`
`RELEVANT_TEST_FILES` and to the made-up-fixtures pin in `hours-screens.test.ts`)

- `scripts/ceo-pay-plans-supabase.test.ts` (PGlite, default privileges on):
  gates (anon, non-CEO admin, revoked → 42501) on every RPC; tables,
  sequences, internals unreachable by anon/authenticated and not writable or
  executable by service_role; delete/truncate refused; entries update guard;
  plan check sentences (unknown keys, missing inclusive); role/own/follow
  resolution and history of lines and role; approved-month refusals for plan,
  entry, confirm, withdraw; band vectors (§3); not_met; missing stays null and
  `lowestUsd`; floor by ramp_start; approve ready/existing/refused/settle day;
  frozen result + drift; leaver still listed; audit rows carry no amount;
  applies twice. Facts stubbed.
- `scripts/ceo-pay-facts-supabase.test.ts`: the four facts functions over stub
  sources (dialer receipt, central caller, sheet caller, portal won, unmarked,
  reschedule, CONFLICT; ads guard exclusion, unpriced row, null booking day, no
  board row; a loss from Paused, a non-payment candidate, a loss in a renewed
  term, an unmatched CSM; a deal set and closed by one person, a disagreeing
  setter, a PIF at 99% and at 95%).
- `scripts/pay-plan-model.test.ts`: `checkPlan` = SQL checker on a shared
  table; `pickBand` = SQL pick on the shared vectors; `planSentence`;
  `suggestBands`; seeds pass.
- `scripts/pay-screens.test.tsx`: sheet, ruler, month card, dialogs; payloads;
  copy for missing, not_met, waiting, approved, drift.
- Updated: `ceo-fixes-screens`, `costs-model`, `hours-screens`,
  `ceo-people-supabase`, root `scripts/ceo-commission-lines.test.ts`.

## 10. Records

`src/pages/ceo/SOURCES.md` rows; `RUNBOOK.md` "Hours, leave and pay"
(approving a pay month, settle day, adjustments, switching a bonus to cost per
booking); `docs/preserve/supabase-manifest.json` section `pay_plans` (state,
tables, functions, ceo_functions, triggers, pg_cron [], edge_functions []) plus
`('pay_plans','pay-plans')` in `scripts/verify-preserved.py` SECTIONS and its
steps list.

## 11. Go-live order

1. Apply `20261018c` (money ties and deal ledger, money contract), then
   `20261018a`, then `20261018b`; record each in
   `supabase_migrations.schema_migrations`; read back definitions and ACLs.
2. Native money release and the Edge copy (money contract).
3. Seed the six role plans and the CSM's ramp start as the CEO.
4. Ship `scripts/ship.sh media-buyer` (and `client-success` for the CSM
   estimator); verify the live bundle; reload the installed app.
5. Then move the two agents' commission lines to the new bases.
6. Verify as the CEO on production: September and October compute; the
   references in §4 match; nobody is approved.
