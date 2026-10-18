# Money attribution: front-end cash from every source, and who it is credited to

Aziz (the CEO), 2026-10-18: "For the sales section of the CEO cockpit, I think
the frontend cash is wrong. Instead of the kickoff form, ... also have
backlogs of other sources of truth. For example, people have not only paid the
deposit. Just now, we got the $5,500 payment from the new client as well. Just
make sure and make it easy for me to attribute any of the money coming in, so
we can see. For example, Abdulrahman Al Ansari: it's credited to Ahmed Abu
Sheba because he's the one that closed the deal, so it wouldn't be in the CSM.
It's for the closer himself. The closer is specifically for cash collected as
their commission, and Turkey [Turki], the guy named Turkey who paid $500 and
$1,500, is called Madana. Attribute to that, and it's Ahmed the closer. Make it
easy for me to see who it was attributed to and all that stuff as well."

This file is the contract; the pay side is `docs/pay/PAY-PLANS.md` §1.14 and
§4.4. Research: `hw-notes/money_pipeline.md`, `money_cases.md`,
`money_commission.md`, `money_gaps.md` (2026-10-18). Fixtures and tests use
made-up people, clients and payment ids only.

## 1. Rules

1. **A deal's money is the closer's.** A payment tied to a signed, not-voided
   closer-form deal (`cockpit_sales_deals`, B2B `closed_deals`) counts from 7
   days before the form. Until the deal's running tied cash reaches
   `contracted_revenue`, and at most 120 days after signing, it is
   `side='front_end'`, credited to `deal.closer` with `personRole='closer'`:
   the part of the money up to the typed `cash_collected` is the deposit
   (`depositUsd` on the row, `deposit_usd` in the ledger) and the rest the
   remainder, so one paid-in-full payment is both; a payment that carries
   deposit money is `kind='deposit'`, every later one `kind='remainder'`
   (no deposit typed: the first payment is the deposit). Totals and the Sales
   split add `depositUsd`, never a whole payment by its kind.
   Beyond the contract or the 120 days it is `back_end`, the card's CSM's.
   Money paid up to 120 days before the 12 months is read too, only so a deal
   signed then counts what was already paid against its contract; it is never
   published (fix of 2026-10-18).
   This replaces the 2026-09-21 rule that sent the rest of a new deal's cash
   (inside 45 days, 20 on monthly) to the deal's CSM. Renewals
   (`billing_reason='subscription_cycle'`) follow the same cap.
2. **A card match inside a deal's term is that deal's money.** When a payment
   matches a client card (login email, payer tie, card name, typed card) and
   the card has a deal signed within 120 days whose contract is not yet
   collected, the payment is that deal's (rule 1).
3. **The CEO's tie wins.** A tie (section 3) is read before every automatic
   match: payment tie, then payer tie, then Whop's own deal link, then email,
   then name, then card. A tied row carries `matchedBy='ceo'` and
   `{note, setBy, setAt}`. A payer tie to a deal reaches that payer's money
   from 7 days before the deal's form (rule 1): anything paid earlier belongs
   to an earlier engagement, stays with the automatic rules, and the run names
   it (`ties.beforeDeal`, a note on Transactions). A tie on the one payment
   takes it whatever its day.
4. **Names never decide on their own.** A payer tie keys on the payer's email
   or the exact payer key, never a first name alone (`ceo-sources-of-truth`:
   the "Dena" lesson).
5. **Every credited row says who and why**: person (as written), role
   (closer / CSM), `matchedBy` in words ("Whop's link to the deal", "payer
   email", "card name", "your tie"), and the deal or card it rests on.
6. **Front-end cash on the Sales tab** = paid front-end money (rule 1) by
   payment day, from every rail (Whop, Tap, bank, manual), excluding webinar
   deals. The typed deposit and the kickoff form's amount are shown beside it
   as "typed, not money" and never added. The tile says when money was last
   attributed; over 2 hours old it says the figure may be behind. Missing is
   never zero.

Effects on recorded rows (all re-credited on the next refresh, because the
ledger is rewritten every run): Makers' $5,500 (Whop `pay_soEOcvcTa3GRWD`, 17
Oct, payer "Abdulrahman Alansary") moves from the CSM to the closer and
completes Makers' paid in full; Ardon's $1,500 (Sep) moves to its closer;
August's and July's "kickoff" rows move to their deals' closers; ocean home's
Tap $5,528.96 and mergestudio's Tap $5,496.36 become front end (rule 2).

## 2. Code (both copies change together, with a parity test)

- **Native** (writer of the published money and growth sections):
  `hermes/ceo-refresh/native/adapters/money.js` — `attributePayments` gets
  rules 1–3, reads ties from the snapshot (`rowsFor(snapshot, "ties")`), fixes
  the `nearest()` sign (gap = payment − deal, as the TS copy), keeps
  `dealResponseId` on transactions and client payments, emits `dealPayments`,
  and is exported for the parity test. `adapters/growth.js` — front-end cash
  from the paid deal ledger (rule 6): `frontEndCash.total` = paid; new fields
  `paid`, `paidDeposit`, `paidRemainder`, `byRail`, `typed{deposit, kickoff}`,
  `typedNotSeen` (listed, not added), daily `frontEndPaid`, `roasCash` =
  paid / spend, `attributedAt`. `native/metrics.ts` texts (no "CSM" for the
  front end). `hermes/ceo-refresh/native-series.test.ts` updated.
- **Edge copy** (`supabase/functions/cockpit-ceo-api/finance/attribution.ts`,
  `adapters/money.ts`, `context.ts`): the same rules and ties (read through the
  same snapshot), full names (not first names), dealPayments, and the client
  cards built as native builds them: every billing card first, then the alias
  names, with logins and payers (`context.ts`, then `attribution.ts`
  `cardRefs`; native `cardReferences`). "Refresh now" publishes this copy, so
  it must match native. Repoint
  `apps/media-buyer-cockpit/scripts/attribution.test.ts` at the Edge file and
  add `scripts/money-attribution-parity.test.ts` running both copies on the
  same made-up fixtures (deposit then rest → closer; card match in term →
  front end; contract cap → back end; 120 days → back end; a payment tie; a
  payer-email tie; a not-client tie; a subscription cycle; two deals for one
  email → nearest by payment − deal; a payer tie with a payment 30 days
  before the form → left to the automatic rules; a paid-in-full payment →
  deposit and remainder; the card lists from one snapshot, and a billing-only
  card matched in its deal's term → front end). The same test also runs both
  whole money adapters on one made-up snapshot and compares every payment
  in, the client payments and the deal ledger, so the inputs match too: deals
  read in form order (`order by submitted_at`), every payer, deal, closer,
  card, bank reference and hand-logged client name cleaned by one rule
  (`cleanText`, exported by both copies), Tap emails in lower case, a debit
  classed as a client payment and a hand-logged entry dated after today
  left out, and a Tap charge a settlement line covers still attributed (the
  settlement credits nobody).
- **Browser** (`apps/media-buyer-cockpit/src`):
  - `pages/ceo/TransactionsTab.tsx`: every money-in row shows "Credited to
    <person> (closer|CSM) · <why>" and an **Attribute** action opening a sheet:
    tie this payment (or every payment from this payer) to a signed deal
    (searchable list: business, closer, signed day, contract, collected so
    far), to a client card, or "not client money"; note required; shows what
    the tie will credit before saving; "Remove the tie". `MATCH_LABEL` gains
    `ceo: "your tie"`. Copy that says the rest of the cash is the CSM's goes.
  - `pages/ceo/moneyPayers.tsx` (Money tab "Who these payers are"): "A signed
    deal" beside the card choice, writing a payer tie.
  - `pages/ceo/MoneyTab.tsx`: the front-end split copy (closer, not CSM).
  - `pages/ceo/SalesTab.tsx`, `FrontendTab.tsx`, `components/ceo/timeframe.ts`,
    `components/ceo/metrics.ts`: the tile reads paid front-end cash, shows
    "typed, not money" beside it, the attributed-at time, and a "By closer"
    line; custom ranges rebuild from daily `frontEndPaid`.
  - `pages/ceo/SOURCES.md` rows 68, 118, 119 rewritten.
  - The tie call goes through `src/lib/ceoMoneyClient.ts`
    (`client.rpc("cockpit_ceo_payment_tie")` / `("cockpit_ceo_payment_untie")`
    literals) and `api.ceo.money.{tie, untie}` (writes). After a tie the sheet
    says "Tied. It shows after the next money refresh (about 15 minutes). Last
    refresh hh:mm." and does **not** call Refresh now. Until the section
    publishes again, the ties saved in the session (`credit.ts` `PendingTie`)
    mark every row they cover ("Tied by you to <deal> · shows after the next
    refresh"; a payer tie marks every row from that payer, on Transactions and
    on the payer list), and the sheet opened again shows the tie under "Now"
    with "Remove the tie". On a phone the credit cell wraps beside the day and
    the amount, and a row resting on nothing says who paid.

## 3. Database (`supabase/migrations/20261018c_money_ties_deal_payments.sql`)

House style as `docs/pay/PAY-PLANS.md` §5 (BEGIN/COMMIT, safe twice, SECURITY
DEFINER `SET search_path=''`, RLS on with no policy, revoke tables and
sequences from PUBLIC/anon/authenticated/service_role then `GRANT SELECT TO
service_role`, CEO RPCs granted to authenticated only, internals to nobody,
loads in PGlite).

- `cockpit_payment_ties(id bigserial pk, payment_id text check (payment_id ~
  '^(whop|tap|transfer|bank|manual):[A-Za-z0-9_.-]+$'), payer_email text,
  payer_key text, deal_response_id text, clickup_task_id text, not_client
  boolean not null default false, note text not null check (length(btrim(note))
  between 3 and 500), evidence text, set_by text not null, set_at timestamptz
  not null default now(), cleared_by text, cleared_at timestamptz,
  cleared_reason text)`; exactly one scope (payment_id | payer_email |
  payer_key), exactly one target (deal_response_id | clickup_task_id |
  not_client); partial unique indexes on the live row per scope (`where
  cleared_at is null`, emails lower(btrim)). Append-only: delete and truncate
  refused; update only sets `cleared_*` once.
- `cockpit_deal_payments(payment_id text primary key, deal_response_id text not
  null, day date not null, usd numeric not null, rail text not null, kind text
  not null check in ('deposit','remainder'), deposit_usd numeric not null
  default 0 check (0 ≤ deposit_usd ≤ usd), matched_by text not null, tie_id
  bigint, payer text, active boolean not null default true, source_refresh_id
  uuid, recorded_at timestamptz not null default now())`; index (day) where
  active, (deal_response_id) where active.
- `cockpit_ceo_payment_tie(p jsonb)`: gate `public.cockpit_hours_ceo_email()`;
  payload `{paymentId?|payerEmail?|payerKey?, dealResponseId?|clickupTaskId?|
  notClient?, note, evidence?}`, unknown keys refused. Refuses with a sentence:
  the payment is not in the last published money transactions (`cockpit_sections`
  key `money`, `payload.attribution.transactions`, direction in) or the source
  tables ("That payment is not in the ledger yet; refresh Money first."); the
  deal is missing or voided; the card is unknown; a payer key shorter than 6
  letters or a single word ("Tie by email or the full payer name."). Clears the
  live row of the same scope, inserts the new one, bumps
  `cockpit_manual_payment_state.revision` (so a running refresh fails its
  fence and the next picks the tie up). Audit `money.tie` with ids only.
  Returns `{ok, id}`.
- `cockpit_ceo_payment_untie({id, reason})`: same gate, clears, bumps the
  revision, audit `money.untie`.
- `cockpit_ceo_refresh_finance_snapshot()` (live definition + one key):
  `'ties'` = live ties as JSON.
- `cockpit_finish_finance_refresh(uuid, jsonb, text)` (live definition + one
  block): when `p_output ? 'dealPayments'`, deactivate the last 11 months of
  `cockpit_deal_payments` and upsert from it, in the same transaction as
  `cockpit_client_payments`; without the key, leave the table alone. A row
  without `deposit_usd` (a worker from before the split) is all deposit on a
  deposit row and none on a remainder; one outside 0 to `usd` is refused.
- Add both tables and the RPCs to `docs/preserve/supabase-manifest.json`
  (section `money_ties`) and to `scripts/verify-preserved.py`;
  `hermes/ceo-refresh/smoke.ts` checks `cockpit_deal_payments`.

Tests: `apps/media-buyer-cockpit/scripts/money-ties-supabase.test.ts` (PGlite,
default privileges on): gates on both RPCs (anon, non-CEO admin, revoked →
42501); tables, sequences unreachable; append-only guard; refusals; revision
bump; audit without amounts; snapshot carries ties; finish refresh writes and
deactivates deal payments only when the key is present; applies twice.

## 4. Ship order and data steps

1. Apply `20261018c` (before any native release: native `rowsFor` throws on a
   missing snapshot key).
2. Native release (`hw-notes` release pattern: stage, doctors, dry run, canary
   under the lock, link swap); diff live `money.js`/`growth.js` against main
   before cutting it.
3. Edge copy: `cockpit-ceo-api` through `scripts/dev/deploy_tree.py` (bundle,
   dry run, deploy, read back `verify_jwt`).
4. Web ship.
5. As the CEO, through `cockpit_ceo_payment_tie`: Turki AlDossary's payer
   email → the Madana deal (note: "The CEO, 2026-10-18: Turki who paid $500 and
   $1,500 is Madana; closer Ahmed"). No tie is needed for Makers: Whop links
   the $5,500 to the Makers deal by email, and rule 1 credits the closer.
6. Verify on production after one refresh: Makers $5,500 front end, credited to
   the closer, kind remainder; Turki's $2,000 front end on Madana, credited to
   the closer; Sales front-end cash for October equals the paid deal ledger
   (scout figure to the 18th: $12,358.80 before the Madana tie, $14,358.80
   after it with Turki's $2,000) with typed amounts beside it;
   `cockpit_deal_payments` rows match the published transactions.
