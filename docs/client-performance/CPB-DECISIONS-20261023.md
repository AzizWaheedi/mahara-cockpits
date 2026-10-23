# Cost per booking: the CEO's five decisions of 23 Oct 2026, the build contract

Aziz answered the build 2 questions on 23 Oct 2026. This contract turns the five answers, and three
defaults the lead session set, into one build: who owns which file, the rule each surface follows,
the migrations and the native release, the numbers every surface must read after the ship (read
live on 23 Oct), the ship order with its checks and rollback, and what still needs a person.
Builders read it; only the contract agent edits it.

Base: worktree `~/mahara-worktrees/currency`, branch `currency-budgets`, HEAD `352508d3` (equal to
GitHub main when this run started). Production: native release `0f85cpb2` on the VPS
(`~/cockpit-native-current`); the media buyer, client success and creative apps at `0f856a91`;
`clickup-writeback` version 12 (KPI writes off behind `CLICKUP_WRITEBACK_APPLY_KPI`, its health
says ok=false on purpose); migrations through `20261022z` applied, plus `20261023a` and four
unrelated migrations other sessions applied today. Earlier records: `CPB-20261021.md` (sections 7
to 9), `CPB-AUDIT-20261021.md`, `CPB-BUILD2-CONTRACT.md` (its section 1 is the ownership table
reused here), `SOURCES.md` and `apps/media-buyer-cockpit/src/pages/ceo/SOURCES.md`.

Nothing here is committed, applied, deployed or released by a builder. Supabase, Meta, ClickUp,
GoHighLevel and the VPS stay read only until the ship step.

Not in scope: the board's "$0 judged good" cell, the show-rate counting gap, the Expenses
"Refresh now" copy's own list filter, the `clientBrief.ts` evidence cut, Art Vision's look-alike
ad, the R12 canary and switch, and the CSM decks (`apps/client-success-cockpit/src/present/**`,
another session).

How we know it works: every number in section 5 reads as written on production after the step
that moves it (section 6), each migration's replaced body has the md5 its file names, each test
named here passes one file at a time, and the release copies match `BASES.txt`.

---

## 0. The decisions and the defaults

| # | Aziz, 23 Oct 2026 (verbatim) | Built as |
| --- | --- | --- |
| D0a | "Yes" | SAFAD's two outsider ads go on the compromise list (`public.cockpit_excluded_ads`, the list of `20261010a` and `20261021b`) and in the worker's list: ad `120254791600360066` (campaign `120254791600340066`, ad set `120254791600350066`, made 13 Oct by "Mercedes Garcia", Egypt, $375.10 spent 13 to 15 Oct, 0 leads) and ad `120254896955290066` (campaign `120254896955270066`, ad set `120254896955280066`, made 20 Oct by "Lucas J Ortiz", Saudi Arabia, $0 spent), account `act_774492648699300`. The second campaign id was read from `cockpit_meta_ads` on 23 Oct; the board needs it. |
| 2 | "No keep the CPL but ignore CPB" | A done-with-you client (service mode DWY; today only نهوض نجد) keeps its spend and leads in its own cost per lead and in every portfolio cost per lead. Its own cost per booking, its floor, its cost per shown booking and its booking rate read "Done with you", with no number, status or dot. Its spend leaves every portfolio cost per booking numerator and its stored bookings leave the denominator; the screen names what it left out. |
| 3 | "$80" | ClickUp's "911" on Cost Per Booking starts over $80 (was over $90, 1.5 x the $60 gate). Named `CPB_911` in `clickup-writeback/rules.ts`, valued from `CPB_BAD` in `kpi.ts`, never typed as 80. No other threshold moves. |
| 4 | "Depends on how much spend if 2x target cpl then yes bad if below that then not enough data" | Spend with zero leads is bad once the spend reaches 2 x the cost per lead target, and "not enough data" (too few) below that, on every surface that gives such a verdict. The target is the client's own CPL line where the surface can read it (the board and CEO Delivery), else the `kpi.ts` gate: `NO_LEAD_MULTIPLE` (2) x `CPL_GATE` ($15) = $30, always computed. |
| 5 | "triple edge is a old churned client" | Triple Edge Building Construction (Meta account `act_2002793296961811`; Aziz wrote "Contracting", the account is named "Construction") is a churned client. A new hand table, `public.cockpit_churned_ad_accounts`, says so. It leaves the live client rows, statuses and "clients off track"; its spend stays in company spend, leads and cost per lead (as Pidco's does) and is named as a churned client's account wherever it appears. |

Lead-session defaults, built here:
- **(a) D0e is built.** The existing, never-applied `supabase/migrations/20261021d_excluded_ads_stats_leftovers.sql`
  still applies cleanly (checked 23 Oct: advisory lock `(1835102821,1)` is the one
  `cockpit_native_media_publish` takes; the newest published plan's `tables.dailyStats` is an
  array with no listed ad (797 rows at 15:07); the feed count equals the table (1492 at 15:05);
  `20261021b`'s two ads are listed). It is used unchanged. It reads the whole list, so run after
  `20261023p` and one published cycle of the new release it also archives SAFAD's 8 rows. No
  separate SAFAD media-stats migration is written (the D0a map's "q" step is folded into it).
- **(b) Listed ads leave the worker's winners archive and market lens.** It is a small filter in two
  files (worker group, W3).
- **(c) Pidco's and Triple Edge's October spend facts go to Aziz** (section 9), not into any rule.

Defaults this contract takes (Aziz's standing "stop asking" rule; each is in section 9 so he can
change it):
- **Decision 2, which cells.** Only cells built on bookings Mahara would make read "Done with you":
  cost per booking (confirmed and all), its floor, cost per shown booking at 60%, booking rate
  (confirmed, provisional, any), and Pulse's bookings and cost-per-booking blocks (half weight, as
  for any block Pulse cannot judge). Show rate, attendance, no outcome, close rate, quotes, closes
  and ROAS stay judged: they judge the meetings that exist, not the cost of a booking.
- **Decision 4, which line.** The board and CEO Delivery read the client's own line
  (`cockpit_board_targets`, scope `client:<clickup id>`, then `defaults`, then the gate). The worker,
  the EOD, CSM Diagnosis, the Ads filters, the CSM ads meter, ClickUp and the CEO's own-ads tab use
  2 x the `kpi.ts` gate and say "2 x the $15 gate" in their note. `cockpit_board_targets` holds 0
  rows on 23 Oct, so every line is $30 today.
- **Decision 4, CEO wording.** "Not enough data" shows as a watch on CEO Delivery with the flag
  `tooFew`, so it counts in "Clients on watch", never in "Clients off track".

---

## 1. Rules as built, with every edge case decided

### 1.1 D0a: SAFAD's outsider ads on the compromise list

Rule: an ad on `public.cockpit_excluded_ads` never counts on any screen: spend, leads, cost per
lead, cost per booking, impressions, clicks, CPM, CPC, Budget/day, Budget used, pay facts and any
verdict. The match is the Meta ad id alone, never a name (Khalida's listed campaign is also called
"New Engagement Campaign").

- Readers that already filter the list live by ad id need no change: `cockpit_board_rows`, `_read`,
  `_tree`, `_budget_cells`, `_budget_list` (and through them `cockpit_board_client`,
  `cockpit_board_lever_context`, `cockpit_dictionary_numbers`), `cockpit_pay_facts_ads`,
  `cockpit_media_client_range`, `cockpit_csm_client_ads`, the snapshot trigger
  `cockpit_skip_excluded_ad_snapshot` (enabled `O`), and the CEO refresh (`triage.js` `adRowsCte`,
  live in 0f85cpb2).
- Readers of raw rows (`ads_daily_snapshots`, `cockpit_media_daily_stats`) follow once the rows are
  archived: `20261023p` archives the snapshots, `20261021d` the media rows.
- The worker carries its own copy (`EXCLUDED_AD_IDS`, 21 ids, live md5 `4fccf85f` equals main). It
  goes to 23 so the worker never sends these ads again. Note: the newest published plans (since
  01:00 on 23 Oct) already carry no row of ad `...360066`, because SAFAD's only Mahara campaign row
  went `source_deleted` then; the 00:45 run carried 7 of its rows. The list protects against the
  card coming back.

Edge cases, decided:
1. **The board keeps the whole ad account minus listed ads (D0d unchanged).** Both outsider
   campaigns hold only listed ads, so the board treats them as outsiders' campaigns: their
   budget-days ($620 a day on 13 to 19 Oct, $555 on 20 Oct) leave Budget used and Budget/day.
   Ad `...290066` has no ad-day row; the board's rule (`NOT EXISTS` an unlisted ad) still takes its
   campaign out, which is why its campaign id must be on its list row.
2. **SAFAD's outsider spend in the D0d "off board" figures.** Once listed it is no longer "off
   board" (the client's own or an unknown campaign); it is "on the compromise list".
   `cockpit_media_client_range` moves the amount from `offBoardSpend` to `excludedSpend` (the page
   reads "$375.09 on ads on the compromise list is left out" for 14 to 20 Oct); the worker's
   `ads7d.offBoardSpend` stops counting it; the board no longer counts it in SAFAD's row.
3. **Frequency.** Reach is per account. For a window that includes 13 to 15 Oct, SAFAD's frequency
   becomes the impression-weighted daily frequency of its own ads, with the `20261021a` note.
4. **Cost per lead.** The board's CPL counts lead-campaign spend only, so it does not move (14 to 20
   Oct: $15.71 / 3 = $5.24). Every CPL computed as all spend over leads falls, CEO Delivery's
   included. Decision 2's "keep the CPL" is not touched: the outsider had 0 leads.
5. **Bookings** do not move: no booking ties to these ads.
6. **Missing is never zero.** Rows are archived, never zeroed. A day with only listed spend reads as
   no spend for that ad, never as a written $0.
7. **History** (`cockpit_metric_values` captures, posted EODs, lever evidence, the audit log) keeps
   what was shown. Only new reads move.

### 1.2 Decision 2: done with you

Who is done with you: `upper(btrim(cockpit_board_clients.service_mode)) = 'DWY'` in SQL (the
board's `v_dwy`); in JS `/^\s*(dwy|done with you)\b/i` on the service mode the code already reads
(CEO triage `service_mode`, board row first then `ghl_clients`, which can be lowercase; the worker's
card Service Mode; CSM `serviceModel`). Today's mode applies to every window, past ones included:
there is no mode history. A blank mode is not DWY.

One change outside the five decisions, accepted: the live board's `v_dwy := r.service_mode = 'DWY'`
was NULL for a blank mode, which skipped the golden rule (`IF NOT v_dwy AND ...`) and wrote
`clientCalls: null`. `20261023r` makes it `coalesce(upper(btrim(r.service_mode)) = 'DWY', false)`, so
a blank-mode row now runs the golden rule (a cost per lead marked off beside a good cost per booking
reads watch with the golden-rule note) and writes `clientCalls: false`. On 23 Oct 7 board rows have a
blank mode, all out of Active (6 Cancelled, 1 "Removed from sheet"), so no live row moves.

A. The client's own figures, every window, every screen:
1. Cost per booking (confirmed and all bookings), its "at least" floor ("$192+"), cost per shown
   booking at 60%, and booking rate (lead to booking: confirmed, provisional, any) read
   "Done with you", with no value, no status and no dot. Note text: "Done with you: the client books
   its own meetings, so its cost per booking and booking rate are not judged."
   - Board cell shape, as the `clientCalls` precedent: `{v: null, status: 'not_measured', note,
     clientBooks: true}`; the app shows "Done with you" when `clientBooks` is set. Every reader that
     treats `not_measured` as a data gap treats `clientBooks` as "by rule", never "missing".
   - CEO payload: those fields are null and `bookingsWhy` carries the sentence.
2. **A DWY client with GoHighLevel bookings** is still never judged on bookings: the CEO's
   `weBook = bookings > 0 || DFY` becomes `weBook = !isDwy && (bookings > 0 || DFY)`, and its
   `cplOnly` is always "dwy". Its stored bookings stay on screen as facts (the board's Bookings
   cell; the CEO row already reads "Done with you" there) and leave every portfolio denominator.
3. Status is judged on cost per lead alone (Decision 4's line for no leads). The board's first
   break skips cost per booking and booking rate; the golden rule never applies (`IF NOT v_dwy`
   stays), so the CPL cell keeps its own status.
4. Unchanged: spend, Meta and CRM leads, CPL, booking counts as facts, show rate, attendance, no
   outcome, close rate, quotes, closes, ROAS.
5. Pulse: the cost-per-booking block (15) and the bookings block (35) score half weight (7.5 and
   17.5), as Pulse already does for a block it cannot judge. نهوض نجد: 28 "bad" becomes about 53
   "watch", and its risk loses "Pulse health 28 of 100" (score 5 to 3).
6. Its spend is never listed as "not measured" or "bookings not stored"; it is named as done with
   you.

B. Portfolio figures:
1. Every portfolio cost per booking leaves out DWY: no spend from DWY ad accounts in the numerator,
   no confirmed or provisional bookings stored on DWY locations in the denominator. This covers CEO
   Delivery's yesterday, last 7, previous 7 and month, the daily series (`spendMeasured`,
   `confirmed`, `provisional`), Today, Backend, the timeframe cards, Goals (`clientCpb`,
   `clientBookings`), the EOD 7-day total and the Active totals written in `SOURCES.md`. The
   board's totals line has no cost per booking total (`boardColumns.portfolio()`), so nothing
   moves there.
2. Each window names the left-out spend: `doneWithYou: [{client, spend}]` on `DeliveryWindow`,
   `spendDoneWithYou` on `DeliveryDay`, a done-with-you bucket in `EodTotals`. Screen copy, for
   example: "$205.05 of نهوض نجد's spend is left out: done with you, the client books its own
   meetings."
3. The "over all spend it would read" aside adds back only spend that is not measured, never DWY
   spend.
4. Portfolio CPL, spend and leads keep DWY: the CEO Cost per lead tile, the board totals CPL, the
   EOD average CPL, the pay CPL pool.
5. Company booking counts used as the cost-per-booking denominator also leave DWY out (the CEO
   Bookings tile, "Client bookings made yesterday", Backend confirmed bookings, the series chart).
   They are 0 today. A DWY client that books in GoHighLevel would make the CEO count read below the
   board's Bookings sum; each such screen says why.

Edge cases, decided: a mixed card (one DWY account, one DFY) is excluded per account in portfolio
sums and keeps today's card rule for its row (none live); a cancelled DWY client leaves its row by
the gone rule and its spend is named as done with you in windows; DWY spend on days with no stored
count is named as done with you; per-client metric values for a DWY row (`delivery.bookings`,
`bookings_confirmed`, `cpb`, `cpb_confirmed`, `book_rate*`) are no longer written (nulls are
skipped) and the company `delivery.cpb` and `cpb_confirmed` values step down on ship day, which
their definitions say; a listed ad on a DWY account leaves all spend (D0a wins).

Already compliant, no change: pay (`cockpit_pay_facts_ads` / pool: DWY out of the cost-per-booking
pool, in the CPL pool), ClickUp (DWY cards get CPL only), the client page
(`cockpit_media_client_range`: "Done with you"), CSM Diagnosis, the CSM performance page and Ads
tab, the creative app, the worker's `ads7d` (bookings null with "Done with you", spend kept).

### 1.3 Decision 3: ClickUp's "911" starts over $80

In `supabase/functions/clickup-writeback`, Cost Per Booking column only
(field `3adfc8f2-dad8-4a09-ac3c-76d2043efec9`, option "911" `ac7434d7-36ad-4cd8-a8af-61379577816d`):
- The value judged: bookings over 0 and spend of $1 or more: `cents(spend / bookings)`; 0 bookings
  and `cents(spend)` over `CPB_GATE`: `cents(spend)`. `cents` is `Math.round(x * 100) / 100`.
- Bands: up to 0.75 x gate ($45.00) "Above KPI"; up to the gate ($60.00) "At KPI"; up to `CPB_911`
  ($80.00) "Below KPI"; over it "911".
- `rules.ts`: `import { CPB_BAD, CPB_GATE, CPL_BAD, CPL_GATE } from
  "../../../apps/media-buyer-cockpit/src/lib/kpi.ts"`; re-export the two gates (the redeclared
  `CPL_GATE = 15` and `CPB_GATE = 60` go); `export const CPB_911 = CPB_BAD` with the comment
  "Aziz, 23 Oct 2026 (cost per booking decisions, 3): ClickUp's "911" on Cost Per Booking starts over
  $80, the cockpit's bad line. It was 1.5 x the $60 gate ($90), the Convex scale.";
  `export const CPL_911 = CPL_BAD` ($22.50, unchanged); `kpiBand(value, gate, critical)` takes the
  critical line as a required third argument; `cpbBand` and `cplBand` wrap it.
Edge cases, decided: exactly $80.00 is "Below KPI", $80.004 rounds to $80.00 (Below), $80.005 rounds
to $80.01 (911); 0 bookings on $60.00 or less stays "too early to judge" and the column is left;
0 bookings on $60.01 to $80.00 is "Below KPI", on $80.01 or more "911"; bookings on under $1 of
spend: not judged; bookings unknown (DWY, no GoHighLevel, a failed read): no booking column
written; two sources disagree: card skipped; several campaigns on a card: summed; no per-client
target (house gates, as today); a missing "911" option holds the column and Last Updated; the
decision log path never sets bands; writes still need `CLICKUP_WRITEBACK_APPLY_KPI` to be exactly
"true".
Other $90 or 1.5 x gate lines found, reported and NOT changed (section 8): the worker's learning
"bleeding" override (`calculator.ts` CPB over `CPB_GATE * 1.5` or 0 bookings over $90, live
`calculator.ts` about line 3461; Convex copy `convex/sync.ts:2697`), `CPL_BAD` = 1.5 x gate in five
copies, the CPL 1.5 x kills in `calculator.ts:1845`, `cockpit-ceo-api/windows.ts:488`,
`b2bAds.js:538` and `clients.js:292` (risk "CPL over 1.5x"), the Convex `writeback.ts` original and
`convexGolden.ts` (the record of it).

### 1.4 Decision 4: spend with no leads

`NO_LEAD_MULTIPLE = 2` with Aziz's words, exported from `apps/media-buyer-cockpit/src/lib/kpi.ts`
(and its byte-identical CSM copy) with `noLeadLine(cplTarget = CPL_GATE) = NO_LEAD_MULTIPLE *
cplTarget`. Copies that cannot import (`hermes/ceo-refresh/native/constants.js`,
`hermes/cockpit-sync/constants.ts`) declare it with "Keep in step with src/lib/kpi.ts" and a parity
test. `clickup-writeback` and `cockpit-ceo-api` import it from `kpi.ts`. SQL computes `2 *
(p_targets->'cpl'->>'good')::numeric`. The line is never written as 30 or 20.

1. **No lead** means leads are known and equal 0. Unknown leads (null, not read, no lead-form rows)
   stay "not measured" with no verdict, never zero. A row with leads above 0 is judged on its cost
   per lead as today ($15 gate, $22.50 `CPL_BAD`).
2. **Which spend:** the spend the surface divides for its cost per lead, in USD, rounded to the cent
   before comparing: board, lead-campaign spend; CEO, the client's 7-day spend; worker, the
   campaign's or ad's 7-day spend; EOD and CSM, the client's 7-day spend from the media sync (`spend`,
   never `bookedSpend`); Ads filters, the row's spend for the range; ClickUp, the card's ledger spend
   over the media-sync window. The line does not scale with the window's length.
3. **The line:** 2 x the target. Board: `p_targets->'cpl'->>'good'` (client, then board default,
   then official $15). CEO Delivery: the same lookup read from `cockpit_board_targets` (the read-only
   role reads it; it cannot execute `cockpit_board_default_targets()`), else `CPL_GATE`. Everywhere
   else 2 x `CPL_GATE`. A board target that is null keeps "too few".
4. **At or over the line: bad.** $30.00 is bad, $29.99 is not. Board CPL cell "off" (atLeast kept);
   CEO `cplBad` true; worker kill when there is no booking; `belowKpi` true when bookings are
   unknown or none; Ads "Critical" on; CSM constraint `no_leads` (owner: Media buyer); ClickUp Cost
   Per Lead "911"; CEO risk +2 "no lead on $X in 7 days"; CEO own ads kill.
5. **Above $0 and under the line: not enough data.** Board "too_few" (hollow ring, "$11.09+"); CEO
   never bad on leads, status from the booking rules, row flag `tooFew: true` and the note "Too few to
   judge: no lead yet on $X, under $30 (2 x the $15 cost per lead line)"; worker hold, rank 16,
   "$X spent and no lead yet in 7 days: not enough data. The verdict comes at $30 (2 x the $15
   gate)."; not out of KPI; nothing raised in CSM; no risk points; no Critical; ClickUp CPL columns
   left with a "too few to judge" note; CSM meter neutral dot.
6. **No spend** ($0, or the worker's under-$1 "no delivery") is unchanged. The CEO risk keeps +2 for
   an active client with $0 spend and no leads, reworded "no spend and no leads in 7 days".
7. **With bookings and no lead:** at or over the line the cost per lead counts as over `CPL_BAD`
   (grid column 3): a known booking cost within $60 holds or watches under the golden rule; $60 to
   $80 is kill or bad (the worker's hold becomes kill; the CEO already reads bad); over $80 kill or
   bad. Under the line bookings alone judge, never scale or good.
8. **DWY:** judged on cost per lead only, with the same line.
9. **Unpriced spend:** only the priced part is judged; at or over the line "off (at least)", under it
   "too few"; all of it unpriced: not measured.
10. **A client whose target CPL was changed:** the board and CEO Delivery move with it (2 x the new
    line); the other surfaces stay at 2 x $15 and their notes say "2 x the $15 gate". None is set
    today.
11. Golden rule and first break unchanged.

### 1.5 Decision 5: Triple Edge is a churned client

Today Triple Edge has no live ClickUp card (its only card, `86ex3n15w` "Triple Edge", is archived in
Monday Import > hidden > Client Onboarding, "needs contacting", made 17 Jan 2026), no GoHighLevel
location, no `ghl_client_ad_accounts`, `cockpit_board_clients` or `cockpit_board_account_ties` row,
and no churn-register row (`cockpit_churn_departures` holds 0 rows). Its `public.clients` row
(`d23173c3-1536-47f7-902b-0ef55f42e824`, active, not hidden) is what the Meta feed and the CEO read.

Source of a client's status, per ad account:
1. The first live tie decides, as today: a board row listing the account, else the GoHighLevel tie
   and that location's board row or registry.
2. Only when none exists is `public.cockpit_churned_ad_accounts` read: name `client_name`, status
   "Churned".
3. `clients.hidden_from_dashboard` still drops an account before any of this; it is not used for
   Triple Edge because it drops the spend silently. `clients.is_active` is not touched either:
   setting it false stops the feed writing the snapshots the CEO reads.

Where it shows:
- CEO Delivery: no client row, no status, out of the status chips, Today's 7-day table, Backend's
  "Clients off track" and "clients with spend", and the per-client metrics. Its spend stays in
  company spend, leads and CPL. It is never measured for cost per booking (no board location). In
  every window where it spent it is named in `notMeasured` with "This is a churned client's ad
  account, so its bookings are not read.", and in the month's lost-client note as "(churned)". It
  leaves the "tied to no client card" note (Art Vision stays there).
- Board: "Not in these totals" labels it "churned client" (reason `churned`); its `notLinked` entry
  goes (it comes from `cockpit_meta_ad_days_status()`).
- Meta ad-days notes (CEO Machine, board freshness): named as "Triple Edge Building Construction is
  Churned" under "Spent for a cancelled, stopped or churned client", never "Not linked to a client".
  The doctor's existing line "Spent in the last 2 days for a cancelled or stopped client: ... (...,
  Churned)" is left as worded (`run.ts` unchanged, no Edge Function deploy).
- Money and Expenses "client ad spend" totals keep its $16.71 of October, as they keep Pidco's.

Edge cases, decided: a live tie wins over the churned row (delete the row by migration if the
client returns); a churned account with $0 in a window is named nowhere in it; an untied account not
on the list keeps "tied to no client card or board row"; a missing or unreadable table fails the
triage read and Delivery keeps its labelled fallback, never zeros (ship the table first); the churn
register, ClickUp and Meta are not written; Triple Edge's spend in a portfolio CPL stays in, as
Pidco's does.

### 1.6 Defaults (a) and (b): leftover media rows, winners archive and market lens

- `20261021d` archives every listed ad's rows from `cockpit_media_daily_stats` (into
  `ads_daily_snapshots_excluded_archive` with `_table = 'cockpit_media_daily_stats'`), restates
  `cockpit_media_feed_state.source_rows` under the publish's own lock, and writes one audit row with
  amounts only in `before`. After `20261023p` and one published cycle of N3 it moves 47 rows,
  $3,452.64 (today's count): the 10 Oct leftovers of 39 rows, $3,077.54, 24 Sep to 9 Oct (Munshaat
  Khalida `act_1275190574533155` $1,243.28, Liwan `act_1938709086836136` $1,133.48, Ideal Elite
  `act_1009665871644699` $578.62, RM Designs `act_985366551096162` $122.16), plus SAFAD's 8 rows,
  $375.10. The feed count goes from 1492 to 1445 at the 15:05 count.
- Worker: `marketProducer.ts` drops listed creatives from a play, takes their spend and leads out
  of the play's totals, and skips an ad set left with no unlisted spend; `winners.ts` never archives
  a listed ad and drops listed ids from the archive it returns. The publish replaces the source
  tables by set (`DELETE ... WHERE NOT source_id IN (...)`), so the next published cycle removes
  them. Today that is 3 winners in the creative `winnersArchive` (Khalida `120246795745520088`
  $1,287, 173 leads; Liwan `120246624477980705` $801, 58 leads; Khalida `120247012327250088` $167, 72
  leads) and the listed ad sets in `marketPlays`, SAFAD's outsider ad set `120254791600350066`
  ($375.10, 0 leads) among them. `winner_ads` and `cockpit_winner_saves` hold no listed ad (checked).

---

## 2. Groups, the files each owns, and the items (build order)

The build 2 table (`CPB-BUILD2-CONTRACT.md` section 1) is reused, with three changes: `excludedAds.ts`
(worker) and `cockpit_excluded_ads` (sql) are now in scope; `supabase/functions/cockpit-ceo-api/windows.ts`
and its test go to ceo; the root `RUNBOOK.md` goes to docs. No file is in two groups. A builder that
needs a change in a file it does not own names it in its final report under "Needs from <group>" and
does not edit it. The creative group has no work: its readers follow the worker and the CEO payload.

Build order: **sql, media-buyer, worker, ceo, clickup, docs.** media-buyer goes second because its M1
(`kpi.ts`) is the one interface other groups import (ceo app code, `clickup-writeback`,
`cockpit-ceo-api`). A group that starts before M1 lands writes against this interface, byte for byte:

```ts
// apps/media-buyer-cockpit/src/lib/kpi.ts and apps/client-success-cockpit/src/lib/kpi.ts (identical), after CPL_BAD:
/**
 * Spend with no lead, Aziz, 23 Oct 2026 (cost per booking decisions, 4): "Depends on how much
 * spend if 2x target cpl then yes bad if below that then not enough data". At or over the line
 * it is bad; above $0 and under it, too few to judge. Keep in step with
 * hermes/ceo-refresh/native/constants.js and hermes/cockpit-sync/constants.ts.
 */
export const NO_LEAD_MULTIPLE = 2;
/** The no-lead line for a cost per lead target: 2 x the client's line, else 2 x the $15 gate. */
export function noLeadLine(cplTarget: number = CPL_GATE): number {
  return NO_LEAD_MULTIPLE * cplTarget;
}
```
Every surface compares `Math.round(spend * 100) / 100 >= noLeadLine(target)` and never types 30.

| Group | Owns (create or edit) | Items |
|---|---|---|
| **sql** | new `supabase/migrations/20261023p_exclude_safad_unauthorized_ads.sql`, `20261023q_churned_ad_accounts.sql`, `20261023r_board_done_with_you.sql`, `20261023s_board_cpl_no_lead.sql`, `20261023t_board_read_churned.sql`, `20261023u_meta_ad_days_churned.sql` (`v` and `w` stay free); `20261021d_excluded_ads_stats_leftovers.sql` (applied unchanged, never edited); new tests `apps/media-buyer-cockpit/scripts/excluded-ads-safad-supabase.test.ts`, `churned-ad-accounts-supabase.test.ts`, `board-done-with-you-supabase.test.ts`, `board-cpl-no-lead-supabase.test.ts`; the existing tests that pin a body it replaces: `scripts/board-api-supabase.test.ts`, `scripts/meta-ad-days-supabase.test.ts`, `scripts/board-cpl-golden-rule-supabase.test.ts`, `scripts/excluded-ads-supabase.test.ts`; the rollback dumps under `~/.cache/mahara-ship/rollback/` | S1 to S7 |
| **media-buyer** | `apps/media-buyer-cockpit/**` except the ceo and sql paths and `scripts/creative-source-models.test.ts` (creative, no work); in `apps/client-success-cockpit`: `src/lib/kpi.ts` (byte for byte with the media buyer copy), `src/lib/csmDiagnosis.ts`, `scripts/csm-diagnosis.test.ts`, `src/components/ClientAds.tsx` and a new `scripts/client-ads-meter.test.ts` | M1 to M6 |
| **worker** | `hermes/cockpit-sync/**`; root `scripts/native-*.test.ts`; the release copies `~/mahara-worktrees/hw-notes/rel-cpb-d3/files/hermes/cockpit-sync/**` and their rows in `rel-cpb-d3/BASES.txt` | W1 to W4 |
| **ceo** | `hermes/ceo-refresh/**`; `apps/media-buyer-cockpit/src/pages/ceo/**` (its `SOURCES.md` included); `apps/media-buyer-cockpit/src/types/ceo/**`; `apps/media-buyer-cockpit/convex/ceo/**` (the TS twins the tests import); `apps/media-buyer-cockpit/scripts/delivery-rates.test.ts` and `scripts/ceo-*.test.ts(x)`; `supabase/functions/cockpit-ceo-api/windows.ts` and `windows.test.ts`; the release copies `rel-cpb-d3/files/hermes/ceo-refresh/**` and their rows in `BASES.txt` | C1 to C6 |
| **clickup** | `supabase/functions/clickup-writeback/**` except `convexGolden.ts` (a record, never edited) | K1, K2 |
| **docs** | `docs/client-performance/SOURCES.md`; a new section 10 at the end of `docs/client-performance/CPB-20261021.md` (earlier sections are history); the root `RUNBOOK.md` | X1 to X3 |

This file belongs to the contract agent. Nobody touches `cockpit_native_mirrors`,
`cockpit_native_media_publish`, `cockpit_native_grain_key`, `cockpit_meta_ad_days_apply`,
`hermes/cockpit-guardian`, `HANDOFF.md`, `apps/client-success-cockpit/src/present/**`,
`apps/media-buyer-cockpit/convex/excludedAds.ts` or `convex/sync.ts`.

Every test runs one file at a time (`bun test <file>`), never a whole suite: the Mac is short of
memory and disk. No new dependency, no copy of the repo.

### 2.1 sql (migration detail in section 3)

- **S1** `20261023p` (D0a): lists SAFAD's two ads and archives their snapshots.
- **S2** `20261023q` (Decision 5): the table `public.cockpit_churned_ad_accounts` with Triple Edge's row.
- **S3** `20261023r` (Decision 2): "Done with you" cells in `cockpit_board_rows` and `cockpit_board_tree`, and the dictionary text.
- **S4** `20261023s` (Decision 4): the zero-lead branch of `cockpit_board_ad_cells`.
- **S5** `20261023t` (Decision 5): the "churned" reason in `cockpit_board_read`.
- **S6** `20261023u` (Decision 5): the churned list in the three Meta ad-days note functions.
- **S7** (default a) `20261021d` applied unchanged after N3 has published one cycle. Test only: in
  `excluded-ads-safad-supabase.test.ts`, run S1 then `20261021d` and check it archives SAFAD's 8 media rows
  together with the leftovers, restates `source_rows`, writes one audit row with amounts only in `before`, and
  a rerun writes nothing.
- Tests, one file each:
  - `excluded-ads-safad-supabase.test.ts` (model: `excluded-ads-supabase.test.ts`, same stubs and the
    20260927j/x and 20261009m chain), in this order: before S1, `20261021d` archives only the 21-list rows
    (it reads the list live) and leaves SAFAD's; S1 refuses with the trigger switched off; S1
    lists both ids with campaign `120254791600340066` / `120254896955270066` and account `act_774492648699300`,
    archives the snapshots, writes one audit row, a rerun changes nothing; `20261021d` refuses while the newest
    plan carries `...360066` or a row is stamped after the run; refuses on a feed count out of step; archives,
    restates `source_rows`, and a rerun changes nothing; no audit row carries an amount in `after`; one
    board-function case: a listed ad with budget-days but no ad-day rows (the Lucas shape) takes its
    campaign's $555 out of Budget used.
  - `churned-ad-accounts-supabase.test.ts`: S2 twice on PGlite (row security on, no policies, grants as
    stated, the seed once), then S5 and S6 over it (below).
  - `board-done-with-you-supabase.test.ts`: S3 with a DWY client holding 0 and 3 GoHighLevel bookings, a DFY
    client unchanged, the golden rule unchanged for both, the tree's campaign, ad set and ad cells.
  - `board-cpl-no-lead-supabase.test.ts`: S4 at $11.09 too_few, $29.99 too_few, $30.00 off, a client target
    of $20 (39.99 too_few, 40.00 off), a null target too_few, the golden rule with a good booking turning
    off into watch, the tree's ad rows.
  - Existing pins: `board-api-supabase.test.ts` (the comment at about line 1522 says why $30 is off; the
    offBoard case near 2629 to 2673 gains a listed churned account that reads reason "churned" with the
    list's client name, and limited seats still get null; EXECUTE expectations stay ''),
    `meta-ad-days-supabase.test.ts` (the pinned strings at about 569, 2117 and 2122 to 2135 move to
    "Spent for a cancelled, stopped or churned client"; add a listed-account case),
    `board-cpl-golden-rule-supabase.test.ts` (its DWY client keeps its CPL status; add that its
    costPerBooking cell carries `clientBooks`).
- Rollback dumps (read only, from the live bodies, written before S1 is applied):
  `~/.cache/mahara-ship/rollback/<function>.before-<migration>.sql` for every body in section 3, each
  restating owner, `SET search_path`, SECURITY DEFINER where the live one has it, and the live ACL. Each
  dump is tested on PGlite after its migration (the build 2 method).

### 2.2 media-buyer

- **M1** (Decision 4) `kpi.ts`, both copies byte for byte: the interface above. `belowKpi` takes an optional
  `leadSpend7d` (defaults to `spend7d`); with `leads7d <= 0`: `cents(leadSpend7d) < noLeadLine()` returns false
  (too few), bookings null or undefined returns true, otherwise the grid as today. Run `scripts/check-shared.sh`.
  New `scripts/kpi-no-lead.test.ts`: 0, 11.09, 29.99 not out of KPI; 30.00 and 41.65 out; leads above 0 unchanged.
- **M2** (Decision 2) board display. `src/lib/boardClient.ts` Cell schema gains `clientBooks: z.boolean().nullable().optional()`
  next to `clientCalls`; `src/pages/performance/cells.tsx` `emptyWords` returns "Done with you" when it is set
  (the CellHelp already prints the note); `src/lib/boardColumns.ts` `firstBreak` also drops `leadToBooking`
  for serviceMode "DWY" or any cell with `clientBooks`. نهوض نجد then reads "On target" (CPL good; show rate,
  quotes, closes and ROAS too few or not filled in). `portfolio()` is unchanged: it has no cost per booking
  total. Test: `scripts/board-screen.test.tsx`, the DWY case near line 470, extended.
- **M3** (Decision 5) `src/pages/performance/PerformancePage.tsx` `OFF_BOARD_REASON` gains
  `churned: "churned client"`; the offBoard comment in `boardClient.ts` names "a churned client's account".
  Test in `board-screen.test.tsx`.
- **M4** (Decisions 2 and 4) `src/lib/eodRollup.ts`: `costedSpend` returns 0 for a DWY client; a
  `doneWithYou: { clients: string[]; spend: number }` bucket in `EodTotals`, kept out of `notRead`;
  `bookingsLine` reads "Bookings (7d): 57 · cost per booking $43.98 ($205.05 of one done-with-you client's spend
  is left out of the cost: it books its own meetings)"; the average CPL keeps DWY. `clientBelowKpi` passes
  `leadSpend7d: f.spend` (never `bookedSpend`); a zero-lead line reads "no lead on $X". Test
  `scripts/eod-rollup.test.ts`: the 14 to 20 fixture moves from $55.45 to $51.52 where it models نهوض نجد's
  spend, Madana leaves the 14 to 20 "Clients out of KPI" list (line near 280), plus a named DWY test.
- **M5** (Decision 4) `src/lib/adsFilters.ts` "Critical": `n.leads === 0 && cents(n.spend ?? 0) >= noLeadLine()`
  (the literal 20 goes); `scripts/ads-filters.test.ts` adds 29.99 off and 30.00 on. `src/components/VerdictPlaybook.tsx`:
  "No lead on $30 or more (2 x the $15 gate): Kill, or Hold when earlier leads book within $60. Under $30: Hold,
  not enough data." with the amounts from `noLeadLine()`. `src/dev/adsPageFixture.ts` Lantern: spend $24 so it
  stays the "too early" story.
- **M6** (Decision 4) client success: `src/lib/csmDiagnosis.ts` raises a `no_leads` constraint when
  `leads7 === 0 && cents(spend7) >= noLeadLine()` for DFY and DWY and `cpb_high` was not already raised
  (title "No leads from $X spent {span}", diagnosis "the ads, not the calls", fixes: submit a test lead, check
  the form and pixel, raise a ticket; owner Media buyer); nothing under the line. Tests in
  `scripts/csm-diagnosis.test.ts`: 11.09 healthy, 30.00 raised, 45 DFY raised, 45 DWY raised.
  `src/components/ClientAds.tsx` Meter: red only when the amounts are USD and `cents(t.spend) >= noLeadLine()`;
  under it a neutral dot and "No leads yet from $X: too few to judge"; a non-USD amount gets no tone. New
  `scripts/client-ads-meter.test.ts`.

### 2.3 worker

- **W1** (D0a) `hermes/cockpit-sync/excludedAds.ts`: `EXCLUDED_AD_IDS` gains `'120254791600360066'` (comment:
  New Engagement Campaign, made 13 Oct by "Mercedes Garcia", Egypt) and `'120254896955290066'` (comment: made
  20 Oct by "Lucas J Ortiz", Saudi Arabia), 23 in all; the header names 20261023p. `excludedAds.test.ts`:
  expect 23, add `listedBy('20261023p_exclude_safad_unauthorized_ads.sql')` to `fromTable`, and pin both SAFAD
  ids by exact match while a neighbouring id stays counted. `client-week.test.ts`: keep the `x1` case (an
  unlisted off-board campaign) and add one with the real ids under "New Engagement Campaign": spend 15.71,
  offBoardSpend 0, costPerBooking 7.86. Readers that follow with no code change: `calculator.ts` ads7d and
  dailyStats, `creativeProducer.ts`, `csmProfileCalculations.ts`.
- **W2** (Decision 4) `constants.ts` gains `NO_LEAD_MULTIPLE = 2` ("Keep in step with src/lib/kpi.ts") and
  `calculator.ts` changes, the same diff in the worktree file and in `rel-cpb-d3/files/.../calculator.ts`:
  - `judge`, `leads === 0`: no booking and `cents(spend) >= NO_LEAD_MULTIPLE * CPL_GATE` kills ("$X spent and no
    lead in 7 days."); under it holds, rank 16, "$X spent and no lead yet in 7 days: not enough data. The
    verdict comes at $30 (2 x the $15 gate)." With earlier bookings and spend under the line: hold as now. At
    or over the line the cost per lead counts as over `CPL_BAD` on the grid (cost per booking $60 or less
    hold; $60 to $80 kill, was hold; over $80 kill). Under $1 is "no delivery", unchanged.
  - `diagnose`: no lead at or over the line always gives "Landing page or tracking" before the too-early return;
    the literal 50 goes.
  - learning "bleeding": add `leads7d === 0 && spend7d >= line`. The `CPB_GATE * 1.5` and $90 parts stay (section 8).
  - checklist: count `leads7d === 0 && spend7d >= line`, label "Campaigns with no lead after $30 of spend".
  - `verdicts.test.ts`: `v(150,0,2)` becomes kill; add 11.09 hold, 29.99 hold, 30.00 kill, 41.65 kill.
- **W3** (default b) `winners.ts` `archiveWinners`: skip a creative whose `adId` is listed (`isExcludedAd`) and
  drop listed ids from the archive it returns (the CEO's rule: a listed ad never counts on any screen); nothing
  else is removed. `marketProducer.ts` `collectMarket`: drop listed creatives from a play, take their spend
  and leads out of the play's totals (CPL recomputed), and skip an ad set left with no unlisted spend. New
  `hermes/cockpit-sync/listed-ads-market.test.ts`. Today this removes 3 creative winners (Khalida
  `120246795745520088` $1,287, 173 leads; Liwan `120246624477980705` $801, 58 leads; Khalida
  `120247012327250088` $167, 72 leads) and trims the 18 `marketPlays` ad sets that hold a listed creative (6
  accounts: Khalida, Liwan, Ideal Elite, RM Designs, ARCWANI and SAFAD; $4,296.24 and 382 leads as plays today),
  SAFAD's outsider ad set `120254791600350066` ($375.10, 0 leads, shown as "Safad Consulting") among them; a play
  keeps its unlisted creatives. `winner_ads` and `cockpit_winner_saves` hold no listed ad.
- **W4** the release copies (section 4) and an "N3" section in `hermes/cockpit-sync/RUNBOOK.md` (live copy,
  edited by hand): the list holds 23 ids, the no-lead line, the winners and market filter, and the order
  S1, N3, one published cycle, `20261021d`. Run `verdicts.test.ts`, `excludedAds.test.ts`,
  `client-week.test.ts` and the new test against the release copy as `rel-cpb/live-test` did, one at a time.

### 2.4 ceo

- **C1** (Decision 2, payload) `data/deliveryClients.js`: `bookingLedger` derives `dwyLocs` (booking-day rows
  whose service mode is DWY) and `dwyAccounts` (triage clients whose `serviceMode` matches
  `/^\s*(dwy|done with you)\b/i`); `measuredSpend` skips DWY accounts and returns `doneWithYou: [{client, spend}]`;
  `deliveryWindow` and `deliveryDaily` count confirmed and provisional over tied locations minus `dwyLocs`
  and add `doneWithYou` / `spendDoneWithYou`; spend, leads and cpl still count every client.
  `adapters/delivery.js` rows: `isDwy` from the same regex; `weBook = !isDwy && (bookings > 0 || DFY)`;
  `cplOnly = isDwy ? "dwy" : today's rule`; for DWY `bookings7d`, `provisional7d`, `confirmed7d`, `cpb7d`,
  `cpbConfirmed7d`, `costPerShownAt60` and `rates30.bookRate*` are null and `bookingsWhy` is "Done with you: the
  client books its own meetings, so its cost per booking and booking rate are not judged." `metrics.ts`:
  the `delivery.cpb`, `delivery.cpb_confirmed` and `delivery.book_rate*` definitions add "done-with-you
  clients' spend and bookings (they book their own meetings), from 23 Oct 2026"; nulls are already skipped.
  Tests: `data/deliveryClients.test.ts`, `data/deliveryBookings.test.ts` (a DWY account with spend and 2 stored
  bookings out of `spendMeasured` and `confirmed`, in spend, leads and cpl), `adapters/delivery.test.ts` (the
  DWY case near 205 with a stored booking).
- **C2** (Decision 2, notes and screens) `delivery.js` notes (about 218, 359, 764 to 769): DWY is judged on
  cost per lead alone whatever GoHighLevel holds, its spend is out of the company cost per booking, and each
  window names the amount. `src/types/ceo/payloads.ts`: `doneWithYou?: {client: string; spend: number}[]` on
  `DeliveryWindow`, `spendDoneWithYou?: number | null` on `DeliveryDay`. `src/types/ceo/scoreboard.ts`: the
  `clientCpb` definition names DWY. `deliveryCost.ts`: comment, plus `doneWithYouOf(w)`. `DeliveryTab.tsx`:
  the cost-per-booking and Bookings hints name the left-out amount; the bookRate cell shows `DWY_BOOKINGS`
  when `cplOnlyOf(r) === "dwy"`. `deliveryStatus.ts`: "A Done With You client is judged on cost per lead
  alone, whatever bookings GoHighLevel holds for it, and its spend is left out of every company cost per
  booking." `TodayTab.tsx`, `BackendTab.tsx`, `timeframeCards.tsx`: each cost-per-booking hint adds
  "done-with-you clients left out (they book their own meetings)". Test `scripts/ceo-delivery-cost.test.ts`
  (fixtures move from $63.10 to $59.18 where they model DWY spend; the expectations near 351 to 373 take the
  new copy).
- **C3** (Decision 2, Pulse) `adapters/clients.js`: `pulseSql` adds `g.service_mode`; for a DWY row the
  bookings block scores 17.5 and the cost-per-booking block 7.5 (half weight, as for any block Pulse cannot
  judge). نهوض نجد: 28 "bad" becomes about 53 "watch", and its risk loses "Pulse health 28 of 100" (score 5 to
  3). Add a `pulseOf` case to `hermes/ceo-refresh/native-series.test.ts`.
- **C4** (Decision 4) `constants.js` gains `NO_LEAD_MULTIPLE = 2` (edit the live copy by hand: live lacks
  main's show-rate lines). `data/triage.js` reads the CPL lines once per run:
  `select scope_key, good from public.cockpit_board_targets where metric = 'cpl' and (scope_key = 'defaults' or scope_key like 'client:%')`.
  `delivery.js`: per row `cplLine = client good ?? defaults good ?? CPL_GATE` and
  `noLeadLine = NO_LEAD_MULTIPLE * cplLine`, carried on the row; `clientStatus` takes `x.noLeadLine` (default
  `NO_LEAD_MULTIPLE * CPL_GATE`): `noLead = x.leads === 0` (unknown leads are never "no lead"),
  `noLeadBad = noLead && cents(x.spend) >= x.noLeadLine`, `cplBad = noLeadBad || (x.leads > 0 && x.cpl > CPL_BAD)`;
  `tooEarly` uses the same `cplBad`; rows and the board fallback carry `tooFew = spend > 0 && noLead && !noLeadBad`.
  The TS twin `convex/ceo/adapters/delivery.ts` gets the same edit. `clients.js` `riskOf`: with `leads7d === 0`,
  +2 "no lead on $X in 7 days" only when `spend7d >= 2 x CPL_GATE`; $0 spend keeps +2 as "no spend and no leads
  in 7 days"; between, no points (twin `convex/ceo/adapters/clients.ts`). `b2bAds.js` and the twin `b2bAds.ts`,
  and `supabase/functions/cockpit-ceo-api/windows.ts`: `KILL_FLOOR = NO_LEAD_MULTIPLE * CPL_GATE` compared on
  cents, hold reason "... no lead yet: not enough data. The verdict comes at $30 (2 x the $15 gate)."
  App: `payloads.ts` rows gain `tooFew?: boolean` and `noLeadLine?: number`; `DeliveryTab.tsx` kill hint "No lead
  after $30 of spend (2 x the $15 gate), or ...", hold hint "or no lead yet on under $30 (not enough data)",
  row note "Too few to judge: no lead yet on $X, under $Y (2 x the $Z cost per lead line)." from the row's own
  line, combined with the booking sentence when `tooEarly` is also set, and nothing when the payload has no
  `tooFew`; `deliveryStatus.ts` bad and watch texts and `cplOnlyRule` take the same two clauses.
  Tests: `scripts/delivery-rates.test.ts` (Madana 11.09 watch with `tooEarly`; 29.99 watch; 30.00 bad; DWY and
  not-measured at 11.09 watch; cost per booking 70 with 0 leads on 70 bad; a client line of $20 gives 39.99
  watch and 40.00 bad; 11.09 and 29.99 in the parity spends; `NO_LEAD_MULTIPLE` equal in both `kpi.ts`
  copies and `constants.js`), `hermes/ceo-refresh/b2bAds-data.test.ts` (pinned text near 450),
  `supabase/functions/cockpit-ceo-api/windows.test.ts` (near 266), `native-series.test.ts` (risk).
- **C5** (Decision 5) `data/triage.js` `clientTiesSql`: `left join public.cockpit_churned_ad_accounts f on
  f.account_id = nullif(replace(coalesce(c.meta_ad_account_id,''),'act_',''),'')`, name
  `coalesce(ba.client_name, bg.client_name, g.client_name, f.client_name)`, status
  `coalesce(ba.status, bg.status, g.status, f.status)` (a live tie wins). `clientDelivery` `unmapped` adds
  `&& !GONE_STATUS.test(c.status ?? "")`. `deliveryClients.js` `notMeasuredWhy`, inside `!locs.length`, first:
  a status matching `/churn/i` returns "This is a churned client's ad account, so its bookings are not read."
  `delivery.js`: no row logic change (the gone rule drops it); the lost-client note reads "$X of this month's
  spend is on N lost clients (cancelled, stopped or churned), and it brought in L leads: Pidco Group
  (cancelled), Triple Edge Building Construction (churned). That money is inside the totals above, and these
  clients are not in the clients table. Without them the month reads $Y and M leads." (singular forms keep the
  it/them switch). Tests: `adapters/delivery.test.ts` (182 to 226), `data/deliveryBookings.test.ts` (fixture
  20 to 40; 78 to 81, 99, 183): rename the untied fixture "Art Vision", add a churned account (no row, no
  status, "(churned)" in the lost note, out of the untied note, the churned sentence in `last7.notMeasured`,
  `spendMeasured` and `cpbConfirmed` unchanged); `data/triage.test.ts`: the table in the PGlite schema, an
  untied account on the list reads "Churned" with the list's name, a board or GoHighLevel tie wins.
  `ceo-delivery-cost.test.ts` fixture text near 108 to 118.
- **C6** `apps/media-buyer-cockpit/src/pages/ceo/SOURCES.md`: a "Changed on 2026-10-23" section with the five
  rules and the before and after figures of section 5 (headline 14 to 20 Oct $63.10 to $51.52); rows 102
  (Verdict), 151 (spend note: Triple Edge "(churned)"; the Refresh now copy relies on the two archives for
  SAFAD), 153 and 157 (Client status: DWY always on cost per lead; churned list), 179 (risk), 304. History
  stays. And the release copies (section 4), tested against `rel-cpb-d3/files` one file at a time.

### 2.5 clickup

- **K1** (Decision 3) `rules.ts`: `import { CPB_BAD, CPB_GATE, CPL_BAD, CPL_GATE } from "../../../apps/media-buyer-cockpit/src/lib/kpi.ts"`;
  re-export the two gates (the redeclared 15 and 60 go); `export const CPB_911 = CPB_BAD` with the comment of
  1.3; `export const CPL_911 = CPL_BAD`; `kpiBand(value, gate, critical)` with a required third argument;
  `cpbBand` and `cplBand`. Header: the one intended difference from the Convex original is the $80 line.
  `kpi.ts`: `cplBand` at about 288, `cpbBand` at about 339 and 341, the import, one header sentence.
  `rules.test.ts`: the Convex record still matches `kpiBand(v, CPB_GATE, CPB_GATE * 1.5)` (labelled "the
  Convex scale before decision 3"); `CPB_911 === 80 === CPB_BAD`; `cpbBand` 45 Above, 45.01 At, 60 At,
  60.01 Below, 80 Below, 80.01 911, 90 911, 90.01 911; `cplBand` 22.5 Below, 22.51 911. `kpi.test.ts`: lines
  near 97, 152, 232, 250 use the band helpers; Khalida 14\10 $80.27 (near 450) and Ardon $81.23 and Atlantis
  19\10 "0 on $86.25" (near 732, 737) become "911"; the title says "$45 / $60 / $80"; near 261 "Between the $60
  gate and the $80 line" with 0 bookings on $80.00 "Below KPI" and on $80.01 "911"; a 16 to 22 Oct case from
  run cab17996: Arcturus 3\9 $172.14 / 2 is "911". `convexGolden.ts` stays byte for byte.
- **K2** (Decision 4, after K1 in the same files) `kpi.ts` cost per lead block (about 282 to 293): no lead on
  `cents(ledger.spend) >= noLeadLine()` writes Cost Per Lead "911" with the note "No lead on $X from {days}: $30
  or more (2 x the $15 cost per lead gate), so Cost Per Lead is 911."; a blank CPL (7d) stays blank and an old
  number is held; under the line the columns are left with "... too few to judge". `NO_LEAD_MULTIPLE` comes from
  `kpi.ts`. Tests in `kpi.test.ts`: $74.31 with no lead gives 911; $29.99 leaves the columns.

### 2.6 docs

- **X1** `docs/client-performance/SOURCES.md`: the list rule (70 to 84: 23 ads); SAFAD and the Active totals
  (849 to 886) with section 5's figures, each total naming نهوض نجد's spend as left out; the client range
  (963 to 975, 992 to 993); Lead to booking DWY (1016 to 1018); Cost per lead (517 to 520: the $45 text goes,
  the 2 x line comes in); "Left out on purpose (unsure): Triple Edge" (210) becomes churned; the ClickUp row
  (908): "four bands at $45, $60 and $80 (911 over the cockpit's $80 line, decision 3, 23 Oct); a dry run";
  "What is left" (1348 to 1354): close D0a, Decision 2, the 911 half, Decision 4 and Triple Edge as decided on
  23 Oct; keep `CLICKUP_WRITEBACK_APPLY_KPI` open for the systems manager.
- **X2** `docs/client-performance/CPB-20261021.md` new section 10 "The CEO's decisions of 23 Oct": what each
  step shipped, the checks of section 6 with their results, the rollback; 8.5 items 1 to 4 are answered
  there, not by editing 8.5.
- **X3** root `RUNBOOK.md`: row near 1169 ("Not linked to a client") adds "a former client with no card gets a
  `cockpit_churned_ad_accounts` row in a migration, with evidence"; row near 1176 reads "cancelled, stopped or
  churned" (a churned account is switched off or removed from Mahara's business); a new row for the table
  (rows added or removed only by migration with evidence; delete the row if the client returns).

---

## 3. Migrations: names, order, guards and grants

Live bodies read on 23 Oct at about 15:05 Kuwait (`md5(prosrc)`, the build 2 method; `pg_get_functiondef`
md5 in brackets where a map quoted it). Every file is one transaction with `SET LOCAL lock_timeout = '5s'`.
Every file that replaces a body refuses unless the live `md5(prosrc)` is either the value below or the md5
of the body the file itself writes (so a second run is a no-op, not a refusal); the new md5 is recorded in
the file's header once the PGlite test passes. Each restates the owner's grants exactly as they are live.
Names `20261023v_` and `20261023w_` stay free. GitHub main holds `20261023a` (twice: `csm_form_sends` and
`ecom_events_signature`) and four timestamped feedback migrations (`20261023104525` to `20261023111458`) that touch
none of these bodies; `b` to `o` are left to other sessions.

| Order | File | Decision | What it does | Replaces (live md5, security, ACL) |
|---|---|---|---|---|
| 1 | `20261023p_exclude_safad_unauthorized_ads.sql` | D0a | Lists both ads, archives their snapshot rows, one audit row | no body |
| 2 | `20261023q_churned_ad_accounts.sql` | 5 | Creates the churned-accounts table with Triple Edge's row | no body |
| 3 | `20261023r_board_done_with_you.sql` | 2 | "Done with you" cells on the board row and tree; dictionary text | `cockpit_board_rows` `48b398196dbdd9eb9737239882d73fb5`, definer, `postgres` only; `cockpit_board_tree` `0c3652110bc32d89d7884fa14ce0a505`, definer, `postgres` only; `cockpit_dictionary_definitions` `307d4a6df3bfbc5e1380ee5abdeeb5e4`, invoker, `postgres` and `service_role` |
| 4 | `20261023s_board_cpl_no_lead.sql` | 4 | The zero-lead CPL status on the 2 x line | `cockpit_board_ad_cells` `ee9b65892cd1a772109dfc3b318a6a17` (def `e43f153d3ca4877d489a5616f815cc48`), invoker, `postgres` only |
| 5 | `20261023t_board_read_churned.sql` | 5 | "churned" reason in "Not in these totals" | `cockpit_board_read` `b526537e282839af372d2c1f75c9e291`, definer, `postgres` and `authenticated` |
| 6 | `20261023u_meta_ad_days_churned.sql` | 5 | Churned accounts named in the Meta ad-days notes, out of "Not linked" | `cockpit_meta_ad_days_finish` `4eaec242a7c5f6eef2b648679cfeacdb`, definer, `postgres` only; `cockpit_meta_ad_days_inputs` `41434eea3236bf3c00450bdca0574b69`, definer, `postgres` and `service_role`; `cockpit_meta_ad_days_status` `83f802620ce19710e8f73bd9d8747cc1`, definer, `postgres` and `service_role` |
| N3, one cycle | native release (section 4), then one published media cycle | | | |
| 7 | `20261021d_excluded_ads_stats_leftovers.sql` (existing, unchanged) | D0e, D0a | Archives every listed ad's `cockpit_media_daily_stats` rows under the publish's lock and restates the feed count | no body |

All of them keep `SET search_path = ''` and name every object in full (`public.cockpit_churned_ad_accounts`).

**1. `20261023p_exclude_safad_unauthorized_ads.sql`** (model: `20261021b`).
- `LOCK TABLE public.ads_daily_snapshots IN SHARE ROW EXCLUSIVE MODE`. Refuses when `cockpit_excluded_ads` or
  `ads_daily_snapshots_excluded_archive` is missing, or the trigger `cockpit_skip_excluded_ad_snapshot` is
  missing or not enabled `O`/`A` (live: `O`).
- Inserts, `ON CONFLICT (ad_id) DO NOTHING`, in the `('<ad>', 'act_<account>', ...)` form the worker test reads:
  - `('120254791600360066', 'act_774492648699300', '120254791600340066', 'unauthorized_meta_incident_2026_10', 'aziz@maharamedia.com')`
  - `('120254896955290066', 'act_774492648699300', '120254896955270066', 'unauthorized_meta_incident_2026_10', 'aziz@maharamedia.com')`
  The second campaign id was read from `cockpit_meta_ads` on 23 Oct (both ads sit in campaigns called "New
  Engagement Campaign"); the board needs it to take Lucas's $555 budget-day out.
- Archives (`DELETE ... RETURNING` into the archive) every `ads_daily_snapshots` row of the two ads: 8 rows,
  $375.10 on 23 Oct.
- One `cockpit_audit_log` row only when something changed: action `media.excluded_ads.add`, entity
  `migration 20261023p`; `before` {listed 21, snapshots {rows, spend}}; `after` {listed 23, added, snapshots_archived,
  ads with account and campaign}, no amounts; `metadata`: client SAFAD (ClickUp 86ewvnqgz, location
  7eAfjIoYYguSmDaLSz78), `sanctioned_by` "CEO, 2026-10-23", and the evidence from `cockpit_csm_meta_activities`:
  "Mercedes García" made campaign `...340066` on 13 Oct at 22:51:06 Kuwait (Egypt, $620 a day, Replies) and the ad
  at 22:53:43, paused it 14 Oct 10:46 and switched it on at 22:58, Nada Al Saed paused it 19 Oct 21:33; "Lucas J
  Ortiz" made campaign `...270066` on 20 Oct at 00:31:53 (Saudi Arabia, $555 a day, Replies) and the ad at 00:36:07
  ("Update required", issue 1487220), Nada paused it 20 Oct 12:57; Meta store: `...360066` $0.01 on 13 Oct,
  $228.26 on 14 Oct, $146.83 on 15 Oct, $375.10, 0 leads, 482,139 impressions; `...290066` no ad-day row.
- Rollback file (written, run only on a rollback): `~/.cache/mahara-ship/rollback/20261023p.undo.sql` deletes the
  two list rows, puts the archived snapshot rows of the two ads back from `row_data`, and writes one
  `media.excluded_ads.remove` audit row.

**2. `20261023q_churned_ad_accounts.sql`.**
- `CREATE TABLE IF NOT EXISTS public.cockpit_churned_ad_accounts`: `account_id text PRIMARY KEY CHECK (account_id ~ '^[0-9]{5,25}$')`,
  `client_name text NOT NULL CHECK (btrim(client_name) <> '')`, `status text NOT NULL DEFAULT 'Churned' CHECK (status = 'Churned')`,
  `evidence text NOT NULL CHECK (btrim(evidence) <> '')`, `added_by text NOT NULL`, `added_at timestamptz NOT NULL DEFAULT now()`;
  a table comment saying rows are added or removed only by migration, with evidence, and a live tie wins.
- `ENABLE ROW LEVEL SECURITY` with no policies; `REVOKE ALL ... FROM PUBLIC, anon, authenticated`;
  `GRANT SELECT ... TO service_role`. The CEO worker reads it as `supabase_read_only_user`, which bypasses row
  security (checked live), so it needs nothing more; the definer functions of S5 and S6 read it as owner.
- Seed, `ON CONFLICT (account_id) DO NOTHING`: `'2002793296961811'`, `'Triple Edge Building Construction'`,
  added_by `'aziz@maharamedia.com, decision 5, 23 Oct 2026'`, evidence: Aziz on 23 Oct 2026, "triple edge is a old
  churned client"; its only ClickUp card is `86ex3n15w`, archived in Monday Import > hidden > Client Onboarding,
  "needs contacting", made 17 Jan 2026; no GoHighLevel location and no board row; Meta lifetime spend $27.84:
  $11.13 on 11 to 18 Aug and $16.71 on 14 to 22 Oct 2026, on Meta Page Promote campaigns; checked 23 Oct 2026.
- One audit row when the seed was added: action `clients.churned_account.add`, entity `migration 20261023q`,
  `after` {account_id, client_name}, no amounts.
- Rollback: only after N3 is rolled back and S5 and S6 are undone (they read it): `DROP TABLE public.cockpit_churned_ad_accounts`.

**3. `20261023r_board_done_with_you.sql`.**
- `cockpit_board_rows`: when `v_dwy`, `leadToBooking` and `costPerBooking` become
  `jsonb_build_object('v', NULL, 'status', 'not_measured', 'note', 'Done with you: the client books its own meetings, so its cost per booking and booking rate are not judged.', 'clientBooks', true)`,
  whatever GoHighLevel holds; the row note becomes "Done With You: the client calls its own leads and books its
  own meetings."; the golden-rule block keeps `IF NOT v_dwy`; Bookings, show rate and the rest are unchanged.
- `cockpit_board_tree`: reads `service_mode` from `public.cockpit_board_clients` by `p_location` (no signature
  change); for DWY every campaign, ad set and ad `costPerBooking` is the same cell; bookings counts stay.
- `cockpit_dictionary_definitions`: the `cost_per_booking` leaves-out text adds "A done-with-you client (it books its
  own meetings): no cost per booking, and its spend is out of every portfolio cost per booking."
  `cockpit_dictionary_numbers` copies the board cell and follows with no change.
- Grants restated: rows and tree `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` (owner only);
  dictionary definitions `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role`.

**4. `20261023s_board_cpl_no_lead.sql`.** Only the zero-lead branch of `cockpit_board_ad_cells` changes;
`cockpit_board_floor_status` stays (the cost per booking, ROAS and CPL-with-leads floors use it).
- Status: no `p_targets->'cpl'->>'good'` gives `too_few`; `round(lead_spend, 2) >= 2 * good` gives `off`;
  anything else `too_few`. `atLeast` and `partial` are kept.
- Note, amounts computed from the target: "No form lead yet for $X of lead-campaign spend: $30.00 or more with no
  lead is off (2 x the $15.00 cost per lead line)." or "...: under $30.00 (2 x the $15.00 cost per lead line), too
  few to judge."
- Grants restated: `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` (the board-api test expects '').

**5. `20261023t_board_read_churned.sql`.** In the whole-board off-board block:
`LEFT JOIN public.cockpit_churned_ad_accounts f ON f.account_id = x.account_id`,
`client = coalesce(o.client_name, k.client_name, f.client_name)`, reason order `kept_out`, `cancelled`,
`not_active`, `churned` (`f.account_id IS NOT NULL`), else `not_tied`. Totals, rows and limited seats (null)
are unchanged. Grants: `REVOKE ALL ... FROM PUBLIC, anon, service_role; GRANT EXECUTE ... TO authenticated`.

**6. `20261023u_meta_ad_days_churned.sql`.**
- `cockpit_meta_ad_days_finish`: `v_not_linked` leaves out listed accounts; `v_gone` adds unlinked listed
  accounts as "<client_name> is Churned"; the label becomes "Spent for a cancelled, stopped or churned client: ...".
- `cockpit_meta_ad_days_inputs`: `notLinked` leaves out listed accounts.
- `cockpit_meta_ad_days_status`: `v_accounts` takes `clientName` and `clientStatus` 'Churned' from the list when no
  tie exists; `notLinked` leaves them out; `cancelledDelivering` also takes `clientStatus` 'Churned' with
  `spend2d > 0`; `billingStopped` stays linked-only.
- Not touched: `cockpit_meta_ad_days_ties`, `_hidden`, `_begin`, `_apply`, `cockpit_meta_feed_run` (ties and
  hidden decide which accounts the dashboard feed writes; changing them could drop Triple Edge's spend silently).
- Grants: finish owner only; inputs and status `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role`.
- `supabase/functions/meta-ad-days/run.ts` is unchanged; its doctor names the account through `cancelledDelivering`.

**7. `20261021d_excluded_ads_stats_leftovers.sql`**, unchanged (checked 23 Oct at about 15:05 Kuwait: neither it
nor S1 has an audit row; the newest published plan, run `482af3dd` at 15:07, has 797 `dailyStats` rows and none of
a listed or SAFAD ad; feed count 1492 equals the table's 1492). It refuses until the newest published plan and
every row stamped after that run's start are free of every listed ad, so after S1 it also waits for the worker
list (N3). It archives into `ads_daily_snapshots_excluded_archive` with `_table = 'cockpit_media_daily_stats'`
under `pg_advisory_xact_lock(1835102821, 1)`, the lock `cockpit_native_media_publish` takes, and restates
`cockpit_media_feed_state.source_rows`. Today it would move 47 rows, $3,452.64: the 10 Oct leftovers, 39 rows,
$3,077.54, 24 Sep to 9 Oct (its header says 8 Oct; Liwan runs to 9 Oct) (Munshaat Khalida $1,243.28, Liwan $1,133.48, Ideal Elite $578.62, RM Designs $122.16),
and SAFAD's 8 rows, $375.10. If a media cycle is calculating while it runs it fails once ("Source revision
conflict"); run it again after the cycle.

---

## 4. Release N3: the copies the worker and ceo groups stage

Folder `~/mahara-worktrees/hw-notes/rel-cpb-d3/`:
- `base/<repo path>`: the live file, copied with `scp` from `hermes@187.77.156.166:cockpit-native-current/<repo path>`
  (release `0f85cpb2`) on 23 Oct and checked again at about 15:20 Kuwait. Never edited.
- `files/<repo path>`: the same live file plus only this run's diff. Today `files/` equals `base/`; the group that
  owns a file edits it and rewrites its "staged" md5 in `BASES.txt`.
- `BASES.txt`: per file, the group, the live md5, the worktree md5, the staged md5 and the items.

| Path | Group | Live md5 (0f85cpb2) | Worktree (352508d3) | Items |
|---|---|---|---|---|
| `hermes/cockpit-sync/excludedAds.ts` | worker | `4fccf85f35e098a3aa3b5ebf3d3556df` | same | W1 |
| `hermes/cockpit-sync/calculator.ts` | worker | `23c8e3b2c296c8cc2bf78a849a41ef8b` | `7c7c73ff` (main's unreleased lostNotes lines) | W2 |
| `hermes/cockpit-sync/constants.ts` | worker | `93bc6a5513ad102832147399eb832955` | same | W2 |
| `hermes/cockpit-sync/marketProducer.ts` | worker | `c16ee745e6f1a908b873e0cd3bbabb0e` | same | W3 |
| `hermes/cockpit-sync/winners.ts` | worker | `07eaa2dc13d8b75353b60ce34741e909` | same | W3 |
| `hermes/cockpit-sync/RUNBOOK.md` | worker | `c845a94837570b303aed7f4c47d74921` | `a33c39c8` (main's native-prune paragraph) | W4 |
| `hermes/ceo-refresh/native/data/triage.js` | ceo | `6f9bb3693191c152da89a6d42d81846d` | same | C4, C5 |
| `hermes/ceo-refresh/native/data/deliveryClients.js` | ceo | `bfca770c86cf274787e6fea32c79b120` | same | C1, C5 |
| `hermes/ceo-refresh/native/adapters/delivery.js` | ceo | `3881547f97f9f44a1fda01b0d78cdc4c` | same | C1, C2, C4, C5 |
| `hermes/ceo-refresh/native/adapters/clients.js` | ceo | `baff8cd1b9938377e288559721bd6252` | same | C3, C4 |
| `hermes/ceo-refresh/native/adapters/b2bAds.js` | ceo | `41b840e8fcfb1f28b9aacfeb9e568762` | same | C4 |
| `hermes/ceo-refresh/native/constants.js` | ceo | `b12a2f65f762ed68789abd4a2cfb24c2` | `af89240b` (main's SHOW_RATE_AIM, live still has SHOW_RATE_GATE 75) | C4 |
| `hermes/ceo-refresh/native/metrics.ts` | ceo | `d91bdd308bb4e01664c9922d81f4c9e3` | same | C1 |

Rules:
- Where live differs from main (`calculator.ts`, `RUNBOOK.md`, `constants.js`), the group makes the same edit
  twice, in the worktree and by hand in `files/`. Main's whole file never ships: `calculator.ts` would import
  `./lostNotes`, which the release lacks, and `constants.js` would drop the `SHOW_RATE_GATE` the live files read.
- `diff -u base/<path> files/<path>` must carry the same hunks as `git diff <path>` in the worktree (line offsets
  aside). The reviewer checks it per file.
- Each group runs its hermes tests against the release copy as `rel-cpb/live-test` did, one file at a time.
- Tests and the root `RUNBOOK.md` never ship in the release; no file outside this table ships.

The release itself (ship step N3): copy `~/.cockpit-native-releases/0f85cpb2` to a new release named after the
shipped main commit (as `0f85cpb2` was), refuse unless every live md5 on the VPS still equals the "live" column,
overlay `files/`, check every staged md5, write `release-note.json` (base `0f85cpb2`, the replaced paths, "live
files plus the 23 Oct decisions; calculator.ts without main's unreleased lostNotes lines"), then the checks of
section 6.

---

## 5. What every surface must read after the ship

Read live on 23 Oct 2026: the board through `cockpit_board_read` as the CEO seat at about 14:30 Kuwait (in a
transaction never committed); CEO Delivery from `cockpit_sections` 'delivery' computed 14:22; the clients
section 14:37; the media sync's `ads7d` and the ClickUp dry runs of 13:05 and 14:05; the Meta ad-day rows.
"After" figures are arithmetic on those rows under the five rules: a read-only seat cannot insert a list row
even in a rolled-back transaction. Where a figure depends on the day it is read (CEO last 7, month to date),
the window is named so the check reads the same days.

### 5.1 The board, per client (Active clients)

Every row not marked "Moved by" reads exactly what it reads today. Decision 4 changes no client row in these
windows (no Active client had zero form leads between $15 and $30); Decision 5 changes no row (Triple Edge was
never a board row); Decision 3 is ClickUp only.


**14 to 20 Oct** (board read as the CEO seat, 14:30 Kuwait)

| Client | Spend | Leads, CPL (status) | Confirmed | Booking rate | Cost per booking after (status) | Moved by |
| --- | --- | --- | --- | --- | --- | --- |
| Alkhalil | $233.36 | 17, $13.73 (good) | 0 | 0% (off) | none on $233.36 (off) |  |
| Arcturus | $242.48 | 39, $6.22 (good) | 4 | 10% (off) | $242.48 / 4 = $60.62 (watch) |  |
| ARCWANI | $0.00 | not measured | 0 | n/a (too few) | no spend, no booking (too few) |  |
| Ardon | $201.90 | 11, $18.35 (watch) | 5 | 45.45% (good) | $201.90 / 5 = $40.38 (good) |  |
| Atlantis | $174.53 | 5, $34.91 (watch) | 4 | 50% (too few) | $174.53 / 4 = $43.63 (good) |  |
| Castello | $268.48 | 20, $13.42 (good) | 1 | 4.35% (off) | $268.48 / 1 = $268.48 (off) |  |
| City Wood | $354.00 | 32, $11.06 (good) | 3 | 10% (off) | $354.00 / 3 = $118.00 (off) |  |
| Joe and Sera | $0.00 | not measured | 0 | n/a (too few) | no spend, no booking (too few) |  |
| Liwan | $0.00 | not measured | 0 | 0% (too few) | no spend, no booking (too few) |  |
| Marble and more | $204.23 | 20, $10.21 (good) | 4 | 20% (watch) | $204.23 / 4 = $51.06 (good) |  |
| mergestudio.kw | $134.69 | 14, $9.62 (good) | 8 | 57.14% (good) | $134.69 / 8 = $16.84 (good) |  |
| Ocean Home | $235.87 | 27, $8.74 (good) | 9 | 28.13% (good) | $235.87 / 9 = $26.21 (good) |  |
| Professional Touch | n/a | not measured | 0 | n/a (too few) | not measured |  |
| SAFAD | $15.71 (was $390.80) | 3, $5.24 (good) | 2 | 66.67% (too few) | $15.71 / 2 = $7.86 (good) | D0a (was $390.80 / 2 = $195.40 off) |
| Shades | $203.63 | 24, $8.48 (good) | 4 | 16.67% (off) | $203.63 / 4 = $50.91 (good) |  |
| شركة العلا | $153.13 | 14, $10.94 (good) | 4 | 20% (watch) | $153.13 / 4 = $38.28 (good) |  |
| شركة منشآت خالدة | $91.62 | 6, $15.27 (watch) | 1 | 16.67% (too few) | $91.62 / 1 = $91.62 (off) |  |
| مدانة العمرانية | $11.09 | 0 on $11.09 (too few) | 0 | 0% (too few) | none on $11.09 (too few) |  |
| نهوض نجد | $192.33 | 16, $12.02 (good) | 0 | Done with you | Done with you | Decision 2 (was "$192.33+" off, booking rate 0% off) |

Active total after: $2,524.72 / 49 = $51.52

**1 to 20 Oct** (board read as the CEO seat, 14:30 Kuwait)

| Client | Spend | Leads, CPL (status) | Confirmed | Booking rate | Cost per booking after (status) | Moved by |
| --- | --- | --- | --- | --- | --- | --- |
| Alkhalil | $367.34 | 26, $14.13 (good) | 0 | 0% (off) | none on $367.34 (off) |  |
| Arcturus | $788.02 | 85, $9.27 (good) | 14 | 16.67% (off) | $788.02 / 14 = $56.29 (good) |  |
| ARCWANI | $151.40 | 6, $25.23 (off) | 1 | 16.67% (too few) | $151.40 / 1 = $151.40 (off) |  |
| Ardon | $828.34 | 62, $13.36 (good) | 6 | 9.68% (off) | $828.34 / 6 = $138.06 (off) |  |
| Atlantis | $559.78 | 24, $23.32 (off) | 5 | 17.24% (off) | $559.78 / 5 = $111.96 (off) |  |
| Castello | $667.65 | 66, $10.12 (good) | 2 | 2.74% (off) | $667.65 / 2 = $333.83 (off) |  |
| City Wood | $674.63 | 51, $13.23 (good) | 3 | 6% (off) | $674.63 / 3 = $224.88 (off) |  |
| Joe and Sera | $0.00 | not measured | 0 | n/a (too few) | no spend, no booking (too few) |  |
| Liwan | $194.58 | 8, $24.32 (off) | 1 | 12.5% (too few) | $194.58 / 1 = $194.58 (off) |  |
| Marble and more | $209.36 | 20, $10.47 (good) | 4 | 20% (watch) | $209.36 / 4 = $52.34 (good) |  |
| mergestudio.kw | $242.46 | 24, $10.10 (good) | 11 | 44% (good) | $242.46 / 11 = $22.04 (good) |  |
| Ocean Home | $752.39 | 81, $9.29 (good) | 27 | 28.42% (good) | $752.39 / 27 = $27.87 (good) |  |
| Professional Touch | n/a | not measured | 2 | 5.26% (off) | not measured |  |
| SAFAD | $308.69 (was $683.79) | 27, $11.43 (good) | 3 | 11.11% (off) | $308.69 / 3 = $102.90 (off) | D0a (was $683.79 / 3 = $227.93 off) |
| Shades | $293.71 | 24, $8.48 (good) | 4 | 9.09% (off) | $293.71 / 4 = $73.43 (watch) |  |
| شركة العلا | $633.96 | 60, $10.57 (good) | 19 | 23.46% (watch) | $633.96 / 19 = $33.37 (good) |  |
| شركة منشآت خالدة | $191.53 | 8, $23.94 (off) | 1 | 12.5% (too few) | $191.53 / 1 = $191.53 (off) |  |
| مدانة العمرانية | $11.09 | 0 on $11.09 (too few) | 0 | 0% (off) | none on $11.09 (too few) |  |
| نهوض نجد | $533.33 | 41, $13.01 (good) | 0 | Done with you | Done with you | Decision 2 (was "$533.33+" off, booking rate 0% off) |

Active total after: $6,874.93 / 101 = $68.07

**16 to 22 Oct** (board read as the CEO seat, 14:30 Kuwait)

| Client | Spend | Leads, CPL (status) | Confirmed | Booking rate | Cost per booking after (status) | Moved by |
| --- | --- | --- | --- | --- | --- | --- |
| Alkhalil | $252.44 | 23, $10.98 (good) | 0 | 0% (off) | none on $252.44 (off) |  |
| Arcturus | $172.14 | 32, $5.38 (good) | 2 | 6.06% (off) | $172.14 / 2 = $86.07 (off) |  |
| ARCWANI | $0.00 | not measured | 0 | n/a (too few) | no spend, no booking (too few) |  |
| Ardon | $174.15 | 5, $34.83 (off) | 1 | 25% (too few) | $174.15 / 1 = $174.15 (off) |  |
| Atlantis | $197.26 | 9, $21.92 (watch) | 5 | 45.45% (good) | $197.26 / 5 = $39.45 (good) |  |
| Castello | $269.53 | 19, $14.19 (good) | 4 | 19.05% (watch) | $269.53 / 4 = $67.38 (watch) |  |
| City Wood | $304.89 | 36, $8.47 (good) | 9 | 27.27% (good) | $304.89 / 9 = $33.88 (good) |  |
| Joe and Sera | $0.00 | not measured | 0 | n/a (too few) | no spend, no booking (too few) |  |
| Liwan | $0.00 | not measured | 0 | n/a (too few) | no spend, no booking (too few) |  |
| Marble and more | $150.72 | 11, $13.70 (good) | 5 | 45.45% (good) | $150.72 / 5 = $30.14 (good) |  |
| mergestudio.kw | $156.24 | 19, $8.22 (good) | 7 | 36.84% (good) | $156.24 / 7 = $22.32 (good) |  |
| Ocean Home | $289.09 | 28, $10.32 (good) | 9 | 28.13% (good) | $289.09 / 9 = $32.12 (good) |  |
| Professional Touch | n/a | not measured | 0 | n/a (too few) | not measured |  |
| SAFAD | $0.49 | 0 on $0.49 (too few) | 1 | n/a (too few) | $0.49 / 1 = $0.49 (good) |  |
| Shades | $218.15 | 30, $7.27 (good) | 7 | 21.21% (watch) | $218.15 / 7 = $31.16 (good) |  |
| شركة العلا | $182.23 | 14, $13.02 (good) | 5 | 23.81% (watch) | $182.23 / 5 = $36.45 (good) |  |
| شركة منشآت خالدة | $106.30 | 2, $53.15 (watch) | 2 | 100% (too few) | $106.30 / 2 = $53.15 (good) |  |
| مدانة العمرانية | $67.46 | 2, $33.73 (off) | 0 | 0% (too few) | none on $67.46 (watch) |  |
| نهوض نجد | $205.15 | 17, $12.07 (good) | 0 | Done with you | Done with you | Decision 2 (was "$205.15+" off, booking rate 0% off) |

Active total after: $2,541.09 / 57 = $44.58

Other board cells that move:
- SAFAD's Budget used: 14 to 20 Oct 8.71% ($390.80 of $4,485) becomes 7.48% ($15.71 of $210); 1 to 20 Oct 12.58%
  becomes 57.16% ($308.69 of $540); 16 to 22 Oct 0.02% (of $3,260) becomes 0.22% (of $225). The two outsider
  campaigns are paused, so no Budget/day note names them; the client page budget list flags them "outsider" with
  no figures.
- SAFAD 14 to 20 Oct: impressions 484,890 become 2,762, CPM $0.81 becomes $5.69, CPC $0.10 becomes $1.96 (8 link
  clicks); frequency becomes the impression-weighted daily frequency of its own ads, with the `20261021a` note.
- نهوض نجد: "First break" reads "On target" (was "Off at booking rate"); its campaign tree's cost per booking reads
  "Done with you" (was "at least $192.33", off, for 14 to 20 Oct).
- "Not in these totals" (whole-board seats), totals unchanged: 14 to 20 Oct $306.77 on 3 accounts (Pidco Group
  $200.23 cancelled client; Alkhalil's SAR account $91.92 kept out; Triple Edge Building Construction $14.62, now
  "churned client", was "not tied to a client"); 1 to 20 Oct $664.14 (Pidco $521.06; Alkhalil SAR $128.45; Triple
  Edge $14.62 churned client); 16 to 22 Oct $289.65 (Pidco $201.64; Alkhalil SAR $78.27; Triple Edge $9.74
  churned client). The board's "Not linked" line (Triple Edge, USD 2.09) is gone.
- Client page tree, 16 to 22 Oct (Decision 4): Alkhalil's video ad `120251783300360190` $24.10 with no lead,
  off, becomes too few; Ola's (شركة العلا) Ad_2 `120252006050440391` $17.32, watch, becomes too few. Ads with
  no lead on $30 or more stay off (Khalida ad-2 $42.72, Atlantis 7\10 ad-1 $37.83, Madana ad-1 $32.11, Khalida
  ad-1 $31.59); ads at $15 or less stay too few.

### 5.2 Portfolio cost per booking, every surface

| Window | Now | D0a only | All five decisions | Surfaces that must read the last column |
|---|---|---|---|---|
| 14 to 20 Oct | $3,092.14 / 49 = $63.10 | $2,717.05 / 49 = $55.45 | **$2,524.72 / 49 = $51.52** | board Active total (SOURCES.md), CEO Delivery series, CEO SOURCES.md headline, EOD 7-day total (Mahara's campaigns: $2,717.05 / 49 = $55.45 becomes $51.52) |
| 1 to 20 Oct | $7,783.36 / 101 = $77.06 | $7,408.26 / 101 = $73.35 | **$6,874.93 / 101 = $68.07** | board Active total, CEO series |
| 16 to 22 Oct | $2,746.13 / 57 = $48.18 (board $2,746.23) | unchanged | **$2,541.09 / 57 = $44.58** (CEO $2,541.08) | board Active total, CEO last 7 when it is these days, Today's 7-day line; EOD (Mahara's campaigns) $2,711.81 / 57 = $47.58 becomes **$2,506.76 / 57 = $43.98** |
| 9 to 15 Oct | $2,823.28 / 37 = $76.30 | $2,448.18 / 37 = $66.17 | **$2,274.70 / 37 = $61.48** | CEO previous 7 when it is these days |
| 22 Oct | $366.32 / 10 = $36.63 | unchanged | **$338.24 / 10 = $33.82** | CEO yesterday when it is 22 Oct |
| 1 to 22 Oct | $8,590.55 / 123 = $69.84 | $8,215.45 / 123 = $66.79 | **$7,622.44 / 123 = $61.97** | Goals "Client cost per confirmed booking", October to 22 Oct |
| 23 Sep to 22 Oct | $11,726.07 / 183 = $64.08 | $11,350.97 / 183 = $62.03 | **$10,537.89 / 183 = $57.58** | the 30-day timeframe card when it is these days |

The CEO series for 14 to 20 and 1 to 20 Oct sums to the board's figures to the cent; for 1 to 22 Oct it is
$8,590.55 against the board's $8,590.64. The left-out amounts each surface names: نهوض نجد (done with you)
$192.33 (14 to 20), $533.33 (1 to 20), $205.05 CEO / $205.15 board (16 to 22), $173.48 (9 to 15), $28.08 (22 Oct),
$593.01 (1 to 22); SAFAD's listed ads $375.09 (14 to 20) and $375.10 (any window holding 13 to 15 Oct).
Booking denominators do not move: no listed ad and no done-with-you location holds a stored booking.

### 5.3 CEO Delivery and the tabs that read it

- Portfolio cost per lead keeps done-with-you and churned spend; only D0a moves it: 14 to 20 Oct $3,306.99 / 258
  = $12.82 becomes $2,931.90 / 258 = $11.36; 1 to 20 Oct $8,319.04 / 626 = $13.29 becomes $7,943.94 / 626 = $12.69;
  9 to 15 Oct $3,028.64 / 205 = $14.77 becomes $2,653.54 / 205 = $12.94; 16 to 22 Oct $2,957.51 / 250 = $11.83,
  unchanged.
- Client rows, 16 to 22 Oct: 16 rows become 15 (Triple Edge leaves: Decision 5). "Clients off track" 5 (Alkhalil,
  Ardon, Arcturus, مدانة, Triple Edge) becomes 4 "of 15 clients with spend" on Backend (Madana stays off: 2 leads at
  $33.73, a cost per lead over $22.50, not this rule). نهوض نجد stays good on its CPL ($12.06); its Lead to booking
  reads "Done with you" (was 0%).
- 14 to 20 Oct (as computed on 21 Oct): Madana ($11.09, no lead) reads watch with `tooFew` and `tooEarly` and the
  note "Too few to judge: no lead yet on $11.09, under $30.00 (2 x the $15.00 cost per lead line).", out of "Clients
  off track"; Triple Edge's row ($14.62, 2 leads) is gone.
- Notes: Triple Edge's `notMeasured` reason reads "This is a churned client's ad account, so its bookings are not
  read." ($9.74 in 16 to 22, $6.97 in 9 to 15, $16.71 this month); the untied note lists only Art Vision; the lost-
  client note reads "$627 of this month's spend is on 2 lost clients (cancelled, stopped or churned), and it brought
  in 13 leads: Pidco Group (cancelled), Triple Edge Building Construction (churned) ... Without them the month reads
  $8,741 and 688 leads." (amounts from the 13:09 payload; they move with the month).
- Each window names نهوض نجد's left-out spend; the "over all spend it would read" aside for 16 to 22 Oct becomes
  $2,752.46 / 57 = $48.29 (it adds back only unmeasured spend: Pidco $201.64 and Triple Edge $9.74).
- Today, Backend, timeframe cards and Goals follow the payload (5.2). Yesterday's bookings stay 10; the Bookings
  tiles do not move.
- Pulse (clients section): نهوض نجد 28 "bad" becomes about 53 "watch"; its risk loses "Pulse health 28 of 100"
  (score 5 to 3, reasons "payment 16 days overdue" and "no portal visit on record" stay).
- Risk "no leads in 7 days": no active client has 0 leads in 7 days on 23 Oct, so nothing moves today.
- Per-client metric values for نهوض نجد's bookings, cost per booking and booking rates stop being written; the
  company `delivery.cpb` and `cpb_confirmed` values step down on ship day.

### 5.4 Client page, client range, CSM and creative

- `cockpit_media_client_range`, SAFAD: 14 to 20 Oct $15.71 / 2 = $7.86 (unchanged), `offBoardSpend` $375.09 becomes
  0 and `excludedSpend` $0 becomes $375.09 ("$375.09 on ads on the compromise list is left out"); 1 to 20 Oct $308.69
  / 3 = $102.90 with $375.10 moving the same way; 16 to 22 Oct $0.49 / 1, unchanged. نهوض نجد reads "Done with you"
  as today. The client page differs from the board for Shades only (its own campaign, $90.07 off board 1 to 20 Oct).
- CSM Diagnosis: Madana 14 to 20 Oct healthy (unchanged); 16 to 22 Oct Madana `cpb_high` (unchanged, it has 2 leads);
  no client is raised for no leads today. CSM Ads meter: a client with no lead under $30 shows a neutral dot.
- Creative: SAFAD "No leads on $0.49" (unchanged, no verdict). The Playbook and market suggestions lose the listed
  ad sets and the 3 listed winners (W3).

### 5.5 ClickUp plan (dry run; nothing reaches ClickUp while `CLICKUP_WRITEBACK_APPLY_KPI` is off)

- 16 to 22 Oct (run cab17996 at 13:05 and 83543d2b at 14:05): 79 writes on 17 cards becomes **80 writes on 17
  cards**. Arcturus 3\9 ($172.14 / 2 = $86.07) Cost Per Booking "Below KPI" becomes "911" (Decision 3; its write was
  already planned); monshaat-mahara-20\10 (`z8xmdvjt0g`, no lead on $74.31) gains Cost Per Lead "911" (Decision 4).
  Atlantis 7\10 (0 on $76.65), Monshaat 20\10 (0 on $74.31) and Madana 20\10 (0 on $67.46) stay "Below KPI".
  نهوض نجد gets no booking column. The health text is unchanged and still ok=false.
- 14 to 20 Oct (ledgers): Khalida 14\10 ($80.27 / 1) becomes "911"; Madana (0 leads on $11.09) and Monshaat (0 on
  $11.35) keep their CPL columns with "too few to judge".
- 15 to 21 Oct (the `kpi.test.ts` fixture): Ardon ($162.47 / 2 = $81.23) and Atlantis 19\10 (0 on $86.25) become "911".

### 5.6 Worker verdicts, media rows and notes

- 16 to 22 Oct ad verdicts (media sync 13:52): 9 of 13 zero-lead ads go from kill to hold (Alkhalil video
  `120251783300360190` $24.10, Ola Ad_2 `120252006050440391` $17.32, Marble ad-2 `52563114467166` $14.96, Atlantis
  19\10 ad-SC3 `52522396896516` $7.60, Shades ad-3 `120250846749930703` $4.01, نهوض نجد ad-1 `120256186386660569`
  $2.29, Atlantis ad-1 `52522396895916` $1.77, Atlantis 7\10 ad-SC3 `52520718438516` $1.67, Castello Ad-4
  `52564255843366` $1.26); 4 stay kill ($42.72, $37.83, $32.11, $31.59); Marble ad-3 ($4.23, one earlier booking)
  stays hold; campaign monshaat-mahara-20\10 ($74.31) stays kill. 14 to 20 Oct: madana-mahara-20\10 ($11.09) kill
  becomes hold.
- EOD "Clients out of KPI" for 14 to 20 Oct: Alkhalil, Arcturus, Castello, City Wood, Khalida, Madana becomes the
  same list without Madana. 16 to 22 Oct unchanged (Madana listed on its cost per lead).
- Media rows after step 7: `cockpit_media_daily_stats` holds 0 rows of any listed ad; the feed count drops by 47
  (1492 to 1445 at the 15:05 count); the archive gains 47 media rows ($3,452.64) and, from step 1, 8 snapshot rows
  ($375.10); `ads_daily_snapshots` holds 0 rows of the two SAFAD ads; `cockpit_excluded_ads` holds 23 rows.
- Meta ad-days notes (CEO Machine): "Spent for a cancelled, stopped or churned client: Pidco Group for Construction
  (134992869555229, Pidco Group is Cancelled, SAR ...), Triple Edge Building Construction (2002793296961811, Triple
  Edge Building Construction is Churned, USD ...)"; no "Not linked to a client" line.

---

## 6. Ship order, checks after each step, rollback

Nothing below is done by a builder. The lead session ships it after review, on the CEO's 23 Oct decisions.

**Step 0, prepare.**
1. Review each group's diff against sections 1 to 4; check `BASES.txt` (staged md5s, and `diff -u base files`
   equal to the worktree diffs).
2. Commit on `currency-budgets` (never reset or move HEAD in a shared checkout). Merge GitHub main (`72cf2e5a`
   when checked; it added appointment feedback and touches `scripts/board-screen.test.tsx`, `AccountView.tsx`,
   `CockpitPage.tsx`, `performance/ClientPanel.tsx`, the CSM `ClientPerformancePage.tsx` and
   `scripts/check-shared.sh`: keep both sides). Run `tsc -b` and biome in the media buyer and client success
   apps, `scripts/check-shared.sh`, and every test file of section 2, one at a time. Push to GitHub main from a
   throwaway worktree (ship.sh refuses a commit main lacks), then delete that worktree.
3. Right before step 1, read again: the nine `md5(prosrc)` values of section 3, `to_regclass('public.cockpit_churned_ad_accounts')`
   (null), `count(*)` of `cockpit_excluded_ads` (21), the release link (`0f85cpb2`) and the 13 live md5s of
   section 4. Stop on any change and rebase the changed body or file first.
4. The rollback dumps and undo files of section 3 sit in `~/.cache/mahara-ship/rollback/`.

**Step 1, migrations 1 to 6** through the CEO's Composio Supabase connection, each one transaction, in order:

| # | File | Check after it (production) |
|---|---|---|
| 1 | `20261023p` | `cockpit_excluded_ads` 23 rows; 0 `ads_daily_snapshots` rows of the two ads; archive +8 snapshot rows, $375.10; one `media.excluded_ads.add` audit row; board 14 to 20 Oct SAFAD $15.71 / 2 = $7.86 good, Budget used 7.48%; client range 14 to 20 Oct `excludedSpend` $375.09, `offBoardSpend` 0; the next CEO cycle (15 minutes) reads 9 to 15 Oct measured $2,448.18 |
| 2 | `20261023q` | table present, row security on, no policy, `service_role` SELECT only; 1 row; one audit row |
| 3 | `20261023r` | the three new md5s, ACLs as before; board 14 to 20 and 16 to 22 Oct: نهوض نجد cost per booking and booking rate `not_measured` with `clientBooks`; every other cost per booking as in 5.1 |
| 4 | `20261023s` | new md5, ACL owner only; client rows as in 5.1; tree 16 to 22 Oct: Alkhalil's video ad and Ola's Ad_2 too few |
| 5 | `20261023t` | new md5, EXECUTE for `authenticated`; "Not in these totals" names Triple Edge "churned"; totals $306.77 / $664.14 / $289.65 unchanged |
| 6 | `20261023u` | three new md5s, ACLs as before; `cockpit_meta_ad_days_status()` `notLinked` empty; the next hourly meta-ad-days note uses the new label |

Rollback, in reverse: the dumps for 6, 5, 4 and 3; the table of 2 is dropped only after step 2 below is rolled
back; `20261023p.undo.sql` for 1.

**Step 2, native release N3** (section 4) on `0f85cpb2`.
- Refuse on any live md5 not in `BASES.txt`. Run the sync doctor and the CEO doctor.
- Sync dry run: the plan's `dailyStats` holds no row of the 23 listed ads; no table drops to 0; `marketPlays` has no
  ad set `120254791600350066`; `winnersArchive` has none of the 3 listed winners; verdicts for the sync's window
  follow 5.6.
- CEO dry run (needs step 1's table): Delivery has no Triple Edge row, نهوض نجد's booking fields are null with the
  done-with-you sentence and each window carries `doneWithYou`; rows carry `tooFew` and `noLeadLine`; the clients
  section scores نهوض نجد about 53.
- Canary under the lock (it needs `ceo_safe`; space attempts, Meta answers 403 to back-to-back dry runs), then swap
  the link (`ln -s`, then `mv -T`).
- Checks: the next published media cycle succeeds; Delivery for the day's last 7 equals the board's Active total
  for the same days with نهوض نجد out (method of 5.2); "Clients off track" per 5.3; the Machine notes per 5.6.
- Rollback: point the link at `0f85cpb2`; the next cycles publish the old figures. The old release does not read
  the new table, so step 1 can stay.

**Step 3, migration 7** (`20261021d`), once N3 has published one media cycle.
- Check: one `media.excluded_ads.stats_archived` audit row (amounts only in `before`); no `cockpit_media_daily_stats`
  row of a listed ad; `source_rows` equals the table count; 47 rows and $3,452.64 archived at today's count.
- If it says "Source revision conflict", a cycle was calculating: run it again after the cycle. After a Composio
  timeout, read the audit log before re-running (it is idempotent).
- Rollback: `~/.cache/mahara-ship/rollback/20261021d.undo.sql` (written by sql) puts the rows back from the archive
  (`_table = 'cockpit_media_daily_stats'`) under the same lock and restates `source_rows`; run only with the worker
  list rolled back too, or the next cycle's check would be meaningless.

**Step 4, apps.** `scripts/ship.sh` the media buyer (with the CEO tabs), then client success (VITE Supabase env as
in the Vercel memory note; check the live bundle name). The creative app has no change.
- Checks: the board reads "Done with you" for نهوض نجد's cost per booking and booking rate and "On target" for its
  first break; "churned client" in "Not in these totals"; the EOD preview's bookings line names the done-with-you
  amount ($43.98 for 16 to 22 Oct, or the day's window); CEO Delivery, Today, Backend, timeframe and Goals hints
  name the left-out spend and read 5.2's figures for their windows; the Ads "Critical" filter and the Verdict
  Playbook text; CSM Diagnosis and the CSM ads meter.
- Between step 1 and this step the old board app shows "n/a" for نهوض نجد's two cells (it does not know
  `clientBooks`) and the raw word "churned"; ship it right after step 2.
- Rollback: promote each app's previous Vercel deployment, then check the live bundle.

**Step 5, Edge Functions.**
- `clickup-writeback` version 13: bundleOnly dry run first (the import outside the folder bundles as
  `cockpit-ceo-api/windows.ts` does); deploy; keep version 12 (`352508d3`'s folder) for rollback. Check: the next
  hourly run is ok=false with "Dry run: 80 writes planned on 17 cards" for 16 to 22 Oct (or the day's window), Arcturus
  3\9 Cost Per Booking "911", monshaat Cost Per Lead "911", nothing written.
- `cockpit-ceo-api` (C4's `windows.ts`): first read the deployed version and confirm its source equals main's
  folder apart from this change; if it does not, leave `windows.ts` for the next deploy of that function and say
  so. Check: a CEO custom range on Mahara's own ads shows the "not enough data" hold reason under $30. Rollback:
  the previous version.

**Step 6, docs.** X1 to X3 and C6 go in the same commit as step 4. Record the session in mahara-context
`shared/sessions/`.

---

## 7. Checks each group runs before handing back

- Every test named in its items, one file at a time; for TypeScript apps `tsc -b` (never `bun run typecheck`,
  which skips `src`) and biome on the touched app; `scripts/check-shared.sh` after any `kpi.ts` change.
- sql: each migration applied twice on PGlite, the second run a no-op; the md5 guard refuses a changed body; the
  new body's md5 written into the file header; the rollback dump applied after the migration restores the old md5
  and ACL.
- worker and ceo: the same tests against `rel-cpb-d3/files` (copy the test next to the release copy in a scratch
  folder under the scratchpad, run it, delete the scratch folder); the "staged" column of `BASES.txt` updated.
- Copy in every changed string is plain and active, with no em dash, and every dollar line is computed from
  `kpi.ts` or the target, never typed as 30, 20 or 80.

---

## 8. Left alone on purpose, and the other $90 lines

Reported, not changed (Decision 3 moves only ClickUp's Cost Per Booking "911"):
- The worker's learning "bleeding" override: cost per booking over `CPB_GATE * 1.5` ($90) or 0 bookings on more
  than $90 keeps a campaign's findings during the 3 learning days (`calculator.ts` about 3467 to 3470, live about
  3461 to 3463; Convex copy `convex/sync.ts:2697`). A 1.5 x gate line, not the ClickUp band; the audit rejected
  moving it (MB-D11). W2 only adds the zero-lead case.
- `CPL_BAD = CPL_GATE * 1.5` ($22.50) in both `kpi.ts` copies, `calculator.ts:1638`, `convex/ceo/adapters/delivery.ts:76`,
  `delivery.js:60`; the CPL 1.5 x kills in `calculator.ts:1845`, `cockpit-ceo-api/windows.ts:488`, `b2bAds.js:538`;
  the risk point "CPL over 1.5x" in `clients.js:292`. ClickUp's Cost Per Lead "911" already equals `CPL_BAD`.
- `apps/media-buyer-cockpit/convex/writeback.ts` (the paused Convex original) and `clickup-writeback/convexGolden.ts`
  (its record, 90 Below KPI, 90.01 911).
- The cockpit's own $80 line (`CPB_BAD`, `cockpit_board_default_targets` 60 / 80, `cockpit_dictionary_numbers`): ClickUp
  joins it; nothing there moves.
- `adsFilters.ts` "No bookings" (`bookings === 0 && spend > 20`): about bookings, not leads; its literal 20 stays.
- `public.cockpit_media_live_campaigns()` (live `md5(prosrc)` `02474bb33799562330321c96af7e9234`, read by
  `mediaSourceClient.ts:137`): it re-applies the 3-day learning override in SQL for a campaign changed from the
  cockpit, with `bleeding := coalesce(c.cpl,0) > 30 OR costPerBooking > 90`. Its 30 is a typed 2 x gate, its 90 the
  1.5 x gate line above (not ClickUp's band), and it has neither the worker's "0 bookings on more than $90" part nor
  decision 4's no-lead clause (a no-lead campaign has a null cpl, so it never bleeds there, and the worker's
  "Landing page or tracking" finding is cut back to the learning note). No live impact on 23 Oct: the only zero-lead
  campaign, monshaat-mahara-20\10 ($74.31), has no cockpit learning start. Follow-up: a `20261023v` migration (or the
  next free slot) adds the no-lead clause as `NO_LEAD_MULTIPLE x CPL_GATE` (2 x 15, never a typed 30) and the 0-booking
  part (10.8).
- The CEO "Well over $60 gate" chip at +25% ($75), `callCentre.ts:703`, `ProjectionsKit.tsx:272`,
  `cockpit-guardian/checks/sections.py:81` (90 minutes, not $90): unrelated.

Left alone for the five decisions:
- `cockpit_meta_ad_days_apply`, `cockpit_native_media_publish`, `cockpit_native_mirrors`,
  `cockpit_native_grain_key` (hard limit): the Meta store keeps every ad and readers filter by ad id; the publish
  never deletes daily rows, which is why step 3 archives under its lock.
- Board, pay, client-range and CSM-ads functions that read the list live by ad id (`cockpit_board_budget_cells`
  `5792afdb`, `_budget_list` `183c8d6f`, `cockpit_pay_facts_ads` `880f2046`, `cockpit_media_client_range` `2f4af674`,
  `cockpit_csm_client_ads`): no new bodies.
- `cockpit_board_floor_status`, `cockpit_board_targets_map`, `cockpit_board_default_targets`, the golden-rule block's
  DWY handling, the optIn cell, `cockpit_board_budget_clocks`, `cockpit_meta_ad_days_status`'s `billingStopped`,
  `cockpit_board_facts_refresh` (no facts re-run: `cockpit_client_days` stores no spend and no lead or booking ties
  to the outsider ads).
- `cockpit_meta_budgets`, `cockpit_meta_budget_days`, `cockpit_meta_ads`, `cockpit_csm_meta_activities` rows of the
  outsider ads: the evidence, and how the board names outsiders' campaigns.
- The churn register (`cockpit_churn_departures`, `cockpit_churn_months`), Backend's Churn tile, the ClickUp card
  `86ex3n15w`, and `public.clients` row `d23173c3-...` for Triple Edge (`is_active` false would stop the feed writing
  the snapshots the CEO reads; `hidden_from_dashboard` would drop its spend silently); `cockpit_board_account_ties`
  and `cockpit_board_clients` (both need a GoHighLevel location).
- Pay (`cockpit_pay_facts_ads`, pool and band input): DWY is already out of the cost-per-booking pool and in the CPL
  pool; ClickUp already gives a DWY card CPL only; the client page, CSM Diagnosis, the CSM performance page and Ads
  tab, and the creative app already read "Done with you".
- `boardColumns.portfolio()`: no cost per booking total; its Bookings and Show rate sums stay facts.
- Money and Expenses "client ad spend" totals keep Triple Edge's and Pidco's spend (lost clients stay in company
  totals, named with a "without them" figure). The Expenses "Refresh now" Edge Function copy
  (`cockpit-ceo-api/finance/adapters/expenses.ts`) has no list filter; after steps 1 and 3 SAFAD's rows are gone from
  what it reads. Hardening it stays with the systems manager.
- The worker's launch watch, `offBoardCampaigns`, `trackingIssues` and the creative market lens for Triple Edge's and
  Pidco's campaigns: a follow-up to skip cancelled, stopped and churned accounts (section 9). Until then Triple Edge
  still reads as a live client to act on there (10.8, named to Aziz in 10.7).
- `public.cockpit_dictionary_numbers` (live `6277ef71ac5d05f1f75ca86e37826db7`): it passes the board's cost per
  booking status through, so after `20261023r` نهوض نجد's `cost_per_booking_status` reads `not_measured` and the
  `clientBooks` marker is dropped (1.2 A.1 says such readers treat it as "by rule"). No caller in the apps, hermes or
  the Edge Functions on 23 Oct. Follow-up: a dictionary migration passes `done_with_you` when the cell carries
  `clientBooks`.
- `supabase/functions/meta-ad-days/run.ts:835`: once `20261023u` adds Churned to `cancelledDelivering`, the doctor's
  line "Spent in the last 2 days for a cancelled or stopped client" also names Triple Edge "(..., Churned)". The SQL
  label moves to "cancelled, stopped or churned"; the Edge Function's words change with its next deploy (1.5: no
  Edge Function deploy here; an undeployed source edit would leave main apart from what runs).
- Decision 4's client line outside the board and CEO Delivery: the worker, the EOD, the Ads filters, CSM and ClickUp
  always use 2 x the $15 gate, and the CEO's `cplTargetsOf` (`triage.js`) skips a client row whose good line is null
  and falls back to the default or the gate, where `cockpit_board_targets_map` returns null ("too few"). Latent:
  `cockpit_board_targets` holds 0 rows on 23 Oct, so every line is $30 and no surface disagrees. Revisit only if a
  client cost per lead line is ever set.
- `apps/media-buyer-cockpit/convex/excludedAds.ts` (19 ids, Convex retired), every Convex twin not named in
  section 2, the CSM decks, history (`cockpit_metric_values` captures, posted EODs, lever evidence, the audit log),
  and the dated records `CPB-AUDIT-20261021.md`, `CPB-BUILD2-CONTRACT.md` and sections 1 to 9 of `CPB-20261021.md`.
- Fixture tests with SAFAD outsider amounts on made-up ids (`client-week.test.ts` `x1`, `client-range.test.ts:198`,
  `eod-rollup.test.ts:115`, `board-screen.test.tsx:438`, `meta-ad-days/budgets.test.ts:227`) keep passing; the real-id
  case is added beside them.

---

## 9. What still needs a person

**Aziz (CEO)**: the `forAziz` list returned with this contract (facts and the defaults he can change).

**Media buyer**
1. Confirm in one line that Mahara's business-level access to SAFAD's ad account `act_774492648699300` is intact
   after "Ju-manji" removed the outsiders and the person-level roles at 00:37 on 20 Oct (Nada's later edits show
   Mahara still works there).
2. SAFAD's only Mahara campaign row, "Safad | MAHARA | 16-8", went `source_deleted` at 00:51 on 23 Oct, so SAFAD
   has no Ads Management card: the ClickUp plan dropped its card `86eyn6c1f` without naming it, while the board
   shows $0.49 and 1 booking on 20 Oct. Say whether the card was retired on purpose.
3. Before KPI writes go on: Arcturus 3\9 goes from its 7 Oct "Above KPI" (8 bookings) straight to "911" ($86.07,
   2 bookings), and monshaat's Cost Per Lead to "911". After N3, 9 ads move from kill to hold (5.6) and an ad with
   no new lead on $30 or more whose earlier leads book at $60 to $80 each becomes a kill.
4. Triple Edge's two campaigns and Pidco's three still appear in the launch watch ("Fill the new-campaign form so
   the card exists") and the weekly Tracking backlog until the worker skips cancelled, stopped and churned
   accounts (a follow-up, not in this build).

**Systems manager (Muhammed)**
1. `CLICKUP_WRITEBACK_APPLY_KPI`: the one-card canary and the switch, as in build 2 (unchanged by this build).
2. The Expenses "Refresh now" copy's own list filter (unowned since build 2).

**Client success**
1. Whether Triple Edge's ad account leaves Mahara's Meta business (767701513092162); it still spent in October.
2. Pidco Group: either the client is back (fix its registry status and card) or someone runs ads for a cancelled
   client.

**Docs follow-up (not checked here)**: the "Cockpit SOPs" Google Docs and the team KPI deck may describe ClickUp's
bands or "spend with no leads" in words; the SOP pipeline in mahara-context `tools/cockpit-sops` updates them in place.

---

## 10. Final check and the ship order (checker, 23 Oct 2026, 21:22 to 21:40 Kuwait)

This section is the last word before the ship. Where it differs from section 6, this section wins. Nothing here was
committed, pushed, applied, deployed or released; Supabase and the VPS were read only.

### 10.1 Checks

| Check | Where | Result |
| --- | --- | --- |
| `npx tsc -b` | media buyer, client success, creative (worktree and trial merge) | pass, all six runs |
| `bunx biome check --line-ending=auto src` | the same three apps, both trees | 0 errors (61, 33 and 72 warnings, the same on the trial merge) |
| `scripts/check-shared.sh` | both trees | "shared files are in step" |
| Tests, one file at a time | worktree, 129 files (every file the groups touched or that pins a changed function or module, all of `hermes/cockpit-sync`, `hermes/ceo-refresh`, `clickup-writeback` and `cockpit-ceo-api`) | all pass but one intermittent test (10.2). `ceo-delivery-cost` (25) and `delivery-rates` (36) need `VITE_SUPABASE_URL=https://bldgtotkfmhoxmlzowdx.supabase.co` and a placeholder anon key, or they fail on import |
| New migration tests | `excluded-ads-safad` 8, `churned-ad-accounts` 15, `board-done-with-you` 14, `board-cpl-no-lead` 17, `board-api` 85, `meta-ad-days` 41, `board-cpl-golden-rule` 11, `excluded-ads` 8 | pass; each file applies its migration twice (the second run changes nothing) and proves the md5 guard refuses |
| Trial merge with GitHub main `16dc5540` | throwaway worktree, our 67 changed and 15 new paths laid on main with `git apply -3` | no conflict (`board-screen.test.tsx` and `CockpitPage.tsx`, changed on both sides, merged cleanly); tsc, biome and check-shared pass; 133 test files pass, main's 5 feedback tests included (a fresh checkout needs `convex/_generated` linked in, or 6 Convex tests fail on import); worktree removed, disk back to 16 GB free |
| Migration guards against live, read at 21:27 | `md5(prosrc)` of the nine bodies the files replace | all nine equal the guards' base values: rows `48b39819`, tree `0c365211`, dictionary definitions `307d4a6d`, lever context `d05e1b38`, ad cells `ee9b6589`, board read `b526537e`, finish `4eaec242`, inputs `41434eea`, status `83f80262`; owners, security and ACLs as the files restate |
| New body md5s | computed from each file's own text | equal the header and the guard's second value: rows `26c4f6db`, tree `2d35c796`, dictionary `6e88042d`, lever context `d9cfdda6`, ad cells `4bd7436b`, board read `a44e997f`, finish `8b3a0449`, inputs `2f7386ba`, status `398d86c9` |
| Rollback dumps | `~/.cache/mahara-ship/rollback/<function>.before-<stem>.sql`, nine files | each body's md5 equals live now; on PGlite each puts back the body, owner, definer, config and ACL, the guarded drop file then drops the table, both undo files rerun safely and the migrations apply again (3 of 3; the sql group's scratch test predates the lever context dump, the checker's copy adds it) |
| Live state | read at 21:33 | `cockpit_excluded_ads` 21 rows; `cockpit_churned_ad_accounts` absent; no migration named `20261023p` to `u` applied or on main |
| Release copies | `rel-cpb-d3`, 13 files | each `base/` md5 equals the VPS now (release link `0f85cpb2`, read over ssh); `files/` equals the staged md5; `patch` of the worktree diff onto `base/` gives `files/` exactly for 12 files; `constants.js` differs from main only by main's `SHOW_RATE_AIM` block, so it is proved by block: `files/` minus the 9 added lines equals `base/`, and they sit after `export const CPB_BAD = 80;` as in the worktree. New imports resolve inside the release |

### 10.2 Failures that also fail on main

- `scripts/native-feed.test.ts`, "actual finite importer publishes nonempty CSM human history ...". It runs `python`, which this
  Mac lacks (only `python3`), so it fails the same way on a clean checkout of main `16dc5540`. With `python` on the PATH it is
  intermittent: 1 failure in 12 runs on clean main, and about 1 in 4 on ours, with `scope_complete` false. The build's only
  edit to the file is the market window's fields in another test, which passes. Not a ship blocker.

### 10.3 Fixed in this check

- `hermes/cockpit-sync/RUNBOOK.md` (worktree and the release copy): it named "the sql group's listed-winners migration (slot
  `20261023v`)" and put it in the ship order, but nobody wrote that migration. It now says the migration is a follow-up that
  is not in this ship. The staged md5 in `BASES.txt` is now `e77d790cb46940a5f5bda51267e8be09`, and the patch proof holds.

### 10.4 Found and not fixed (follow-ups, none blocks the ship)

1. Default (b) is half built. Listed ads leave the market lens and are never added to the winners archive, but the 3 listed
   winners already archived (Khalida `120246795745520088` $1,287 and 173 leads, Liwan `120246624477980705` $801 and 58,
   Khalida `120247012327250088` $167 and 72) stay, because `cockpit_native_media_publish` refuses a plan that drops one and
   no migration removes them. Section 6 step 2's check "winnersArchive has none of the 3 listed winners" cannot pass; 10.6
   uses the check that can.
2. Section 3 lists eight bodies. `20261023r` also replaces `cockpit_board_lever_context`; 10.6 reads nine.
3. Section 5's figures for days ending 22 Oct are stale: Castello now has 3 confirmed bookings for 16 to 22 Oct (was 4) and
   22 Oct has 9 (was 10). 10.5 has today's figures.
4. `cockpit_clickup_writeback_inputs` passes no `serviceMode`, so نهوض نجد's ClickUp card gets the general "no 7-day booking
   count" note, not the "Done with you" one. The writes are right (no booking column). A one-line sql follow-up.

### 10.5 Numbers after the ship, read live at 21:22 to 21:33

Board read as the CEO seat (never committed), SAFAD's listed spend from `cockpit_meta_ad_days`, the CEO sections computed at
21:22. "After" removes SAFAD's listed spend and نهوض نجد's spend from the cost per booking; bookings do not move.

| Window | Now | After | Done with you left out | SAFAD listed left out | Against section 5 |
| --- | --- | --- | --- | --- | --- |
| 14 to 20 Oct | $3,092.14 / 49 = $63.10 | **$2,524.72 / 49 = $51.52** | $192.33 | $375.09 | equal |
| 1 to 20 Oct | $7,783.36 / 101 = $77.06 | **$6,874.93 / 101 = $68.07** | $533.33 | $375.10 | equal |
| 9 to 15 Oct | $2,823.28 / 37 = $76.30 | **$2,274.70 / 37 = $61.48** | $173.48 | $375.10 | equal |
| 16 to 22 Oct | $2,746.24 / 56 = $49.04 | **$2,541.09 / 56 = $45.38** | $205.15 | none | was $44.58 on 57 (Castello 3, not 4) |
| 22 Oct | $366.43 / 9 = $40.71 | **$338.25 / 9 = $37.58** | $28.18 | none | was $33.82 on 10 |
| 1 to 22 Oct | $8,590.65 / 122 = $70.42 | **$7,622.44 / 122 = $62.48** | $593.11 | $375.10 | was $61.97 on 123 |
| 23 Sep to 22 Oct | $11,726.18 / 182 = $64.43 | **$10,537.90 / 182 = $57.90** | $813.18 | $375.10 | was $57.58 on 183 |

Which surfaces agree, and which differ on purpose:
- **Agree to the cent:** the board's Active total; CEO Delivery's last 7, yesterday and previous 7 (its 21:22 payload holds
  $2,746.24 / 56, $366.43 / 9 and $2,823.28 / 37, the board's own figures) and the series, Today's 7-day line, Backend, Goals
  (1 to 22 Oct) and the timeframe cards, each for its own days. The EOD's 7-day total reads Mahara's campaigns only (D0d, said
  on the EOD); for 16 to 22 Oct it also gives $2,541.09 / 56 = $45.38 and names نهوض نجد's $205.15.
- **Differ on purpose, labelled on screen:** CEO cost per lead keeps done-with-you and churned spend and drops only SAFAD's
  listed ads (9 to 15 Oct $3,028.64 / 205 = $14.77 becomes $12.94; 16 to 22 Oct $11.83 unchanged). CEO's "over all spend it
  would read" aside for 16 to 22 Oct becomes $2,752.50 / 56 = $49.15 (adds back Pidco $201.67 and Triple Edge $9.74, done with
  you still out). The client page and client range count Mahara's campaigns (Shades differs, as before).
- **Board per client:** only نهوض نجد moves in 16 to 22 Oct ("Done with you" for cost per booking and booking rate, first break
  "On target"); SAFAD 14 to 20 Oct $15.71 / 2 = $7.86 good (was $390.80 / 2 off) and 1 to 20 Oct $308.69 / 3 = $102.90 off.
  Tree, 16 to 22 Oct: Alkhalil's video ad ($24.10, off) and Ola's Ad_2 ($17.32, watch) become too few.
- **Not in these totals** (totals unchanged): 14 to 20 Oct $306.77, 1 to 20 Oct $664.14, 16 to 22 Oct $289.69 (Pidco $201.67,
  Alkhalil SAR $78.27, Triple Edge $9.74 "churned client"). The "Not linked" line (Triple Edge, USD 2.09) goes after `u`.
- **CEO Delivery, 16 to 22 Oct:** 16 client rows become 15; "Clients off track" 6 becomes 5 (Castello $89.84, Alkhalil,
  Ardon, Arcturus, مدانة); نهوض نجد stays good on its $12.07 cost per lead. Pulse for نهوض نجد 28 bad becomes 53 watch. The
  lost-client note names 2 lost clients ($628.38 Pidco cancelled plus $16.71 Triple Edge churned, about $645 this month); the
  untied note names Art Vision only.
- **Client range, SAFAD:** `offBoardSpend` $375.09 (14 to 20) and $375.10 (1 to 20) move to `excludedSpend`; the page reads
  "$375 on ads on the compromise list is left out."
- **Worker, 16 to 22 Oct** (media sync rows read 21:33): 4 zero-lead ads stay kill ($42.72, $37.83, $32.11, $31.59); 8 go from
  kill to hold (Alkhalil $24.10, Ola $17.32, Marble ad-2 $14.96, Shades $4.01, نهوض نجد $2.29, Atlantis $1.77, Atlantis 7\10
  $1.67, Castello $1.26); Marble ad-3 $4.23 stays hold; SAFAD $0.49 is under $1 (no delivery); campaign monshaat $74.31 stays kill.
- **ClickUp dry run:** 80 writes on 17 cards (the clickup group's replay of the 20:22 inputs), Arcturus Cost Per Booking "911",
  monshaat Cost Per Lead "911", nothing written.
- **Media rows, step 4 below:** 47 rows, $3,452.64 at the 15:05 count; read the count again before running.

### 10.6 Ship order (supersedes section 6)

**Step 0, commit and push.**
1. In `~/mahara-worktrees/currency`, commit every changed and new path (69 changed, 15 new, this contract included; 10.8 added `BoardGrid.tsx` and `ad-billing-strip.test.ts` to the 67) on
   `currency-budgets`. Never reset or move HEAD in a shared checkout.
2. Merge GitHub main (`16dc5540` at 21:40; the trial merge had no conflict). Run `tsc -b` and biome in the three apps,
   `scripts/check-shared.sh`, and the test files of 10.1 one at a time.
3. Push to GitHub main from a throwaway worktree, then delete it.
4. Right before step 2, read again: the nine `md5(prosrc)` of 10.1, `to_regclass('public.cockpit_churned_ad_accounts')`
   (null), `cockpit_excluded_ads` (21), the release link (`0f85cpb2`) and the 13 live md5s of `BASES.txt`. Stop on any change.
- Rollback: nothing is live yet.

**Step 1, apps first** (moved ahead of the migrations: the new apps read today's database correctly, since a cell without
`clientBooks` and a payload without `doneWithYou` read as before, so the "n/a" window of section 6 step 4 never opens).
`scripts/ship.sh` the media buyer (with the CEO tabs), then client success, with the VITE Supabase env; the creative app has
no change.
- Checks: each live bundle name; the board loads; the EOD preview names the done-with-you amount (16 to 22 Oct: $45.38 on 56,
  $205.15 named); the Ads "Critical" filter and the Verdict Playbook text; CSM Diagnosis and the CSM ads meter.
- Rollback: promote each app's previous Vercel deployment and check the live bundle.

**Step 2, migrations `20261023p`, `q`, `r`, `s`, `t`, `u`**, one transaction each, in order, through the CEO's Composio
Supabase connection. Checks as section 6 step 1, with these md5s: `r` leaves four new bodies (rows `26c4f6db`, tree `2d35c796`,
dictionary definitions `6e88042d`, lever context `d9cfdda6`, which keeps EXECUTE for authenticated); `s` `4bd7436b`; `t`
`a44e997f` (EXECUTE for authenticated); `u` finish `8b3a0449`, inputs `2f7386ba`, status `398d86c9`. After `r` the board reads
"Done with you" for نهوض نجد at once, since step 1 shipped the app.
- Rollback, in reverse: the dumps for `u`, `t`, `s` and `r` (four for `r`), then the drop file for `q` (it refuses while a
  function still reads the table, and only after step 3 is rolled back), then `20261023p.undo.sql`.

**Step 3, native release N3** on `0f85cpb2` (section 4). Refuse on any live md5 not in `BASES.txt`; run the sync and CEO doctors.
- Sync dry run: `dailyStats` holds no row of the 23 listed ads; no table drops to 0; `marketPlays` has no ad set
  `120254791600350066` and no listed creative; `winnersArchive` still holds all its rows (52 on 23 Oct), the 3 listed ones
  unchanged, and gains no listed ad; zero-lead ads under $30 hold and at $30 or more kill.
- CEO dry run (needs step 2's table): no Triple Edge row; نهوض نجد's booking fields null with the done-with-you sentence; each
  window carries `doneWithYou`; rows carry `tooFew` and `noLeadLine`; the clients section scores نهوض نجد 53.
- Canary under the lock (needs `ceo_safe`; space attempts against Meta 403s), then swap the link (`ln -s`, then `mv -T`).
- Checks: the next media cycle publishes (no "Winner archive cannot delete history"); Delivery's last 7 equals the board's
  Active total after for the same days (10.5); "Clients off track" 5 of 15 for 16 to 22 Oct; the Machine notes say
  "Spent for a cancelled, stopped or churned client" with Triple Edge "is Churned" and no "Not linked" line.
- Rollback: point the link at `0f85cpb2`. Step 2 can stay (the old release does not read the new table).

**Step 4, migration `20261021d`**, once N3 has published one media cycle. Checks and rollback as section 6 step 3
(`20261021d.undo.sql`, only with the worker list rolled back too).

**Step 5, Edge Functions.** `clickup-writeback` version 13: bundleOnly dry run first (`rules.ts` now imports
`apps/media-buyer-cockpit/src/lib/kpi.ts`; `comment-watch` imports `rules.ts`, so its next deploy bundles it too), then deploy
and keep version 12 for rollback. Check: the next hourly run is ok=false with "Dry run: 80 writes planned on 17 cards" for 16 to
22 Oct (or the day's window), nothing written. `cockpit-ceo-api` (`windows.ts`): compare the deployed source with main's
folder first; deploy only if they match apart from this change; check a custom range on Mahara's own ads shows the "not enough
data" hold under $30. Rollback: the previous version of each.

**Step 6, record.** The docs ship in step 0's commit. Record the session in mahara-context `shared/sessions/`.

### 10.7 What needs a person

- **Aziz:** nothing blocks the ship. Three things to know: the 3 listed winners stay visible in the creative winners archive
  until a follow-up migration removes them (10.4.1), and until then the media buyer's AI copy assistant can still pick them
  as examples of ads that brought cheap leads when it drafts new ad copy (10.9, row 11); the 16 to 22 Oct cost per booking reads $45.38, not the $44.58 written
  earlier, because Castello's fourth booking for those days is no longer stored; and Triple Edge leaves the client rows,
  statuses and "clients off track", but the media buyer's launch watch ("Fill the new-campaign form so the card exists"),
  the Ads page's off-board rows (verdict "off board", the "Critical" filter, "Add to Ads Management board"), the weekly
  tracking backlog (two "No URL parameters" issues) and the creative market lens (two plays) still show its two small
  campaigns ($8 and $2 in 7 days) as a live client's until the worker skips cancelled, stopped and churned accounts
  (a follow-up, 10.8).
- **A builder (follow-ups):** the listed-winners migration; an `isExcludedAd` filter on the archive in `generateAssistDraft`
  (`hermes/media-native/tools.ts`, a release file, 10.9 row 11); `serviceMode` in `cockpit_clickup_writeback_inputs`; the
  `native-feed` importer test's `python` call and its intermittent failure.
- **Systems manager, media buyer and client success:** the items of section 9, unchanged.

### 10.8 The completeness check's gaps (23 Oct, after 10.6)

Each gap was read again first: the three live bodies have the md5s the check named (`cockpit_media_live_campaigns`
`02474bb3`, `cockpit_dictionary_numbers` `6277ef71`, `cockpit_clickup_writeback_inputs` `224ee97a`, none reads
`service_mode` or `clientBooks`), and `cockpit_board_targets` holds 0 rows. Nothing below changes a figure in 10.5.

| # | Gap | Done |
| --- | --- | --- |
| 1 | `cockpit_media_live_campaigns` re-applies the learning override with `cpl > 30 OR costPerBooking > 90`, no no-lead clause (decision 4; an unreported $90 line for decision 3) | Follow-up, not in this ship: listed in section 8; a later migration (slot `20261023v` if still free) adds the clause as 2 x 15, computed. No live impact today |
| 2 | The worker still shows Triple Edge as a live client (launch watch, off-board rows, tracking backlog, market lens) | Follow-up, as section 8 and section 9 (media buyer 4) already said; now named to Aziz in 10.7 |
| 3 | `20261023r`'s `v_dwy` reads a blank mode as false (was NULL), so blank-mode rows run the golden rule and write `clientCalls: false` | Accepted and written down in 1.2; only non-Active rows have a blank mode |
| 4 | The EOD's over-the-gate line lists no-lead clients under "CPL above $15", with bare names on the form | Fixed: one label for the report and the form, `overCplGateLabel()` in `eodRollup.ts`, reads "Any client with a 7-day CPL over $15, or no lead on $30 or more" (both amounts from `kpi.ts`); the form names a no-lead campaign with its spend through `overCplGateName()` ("<client> (no lead on $74.31)"), as the report names a client. Tests: `eod-rollup.test.ts` (34 pass), `ad-billing-strip.test.ts` (33 pass) |
| 5 | `cockpit_dictionary_numbers` reports نهوض نجد's cost per booking status as `not_measured` | Follow-up in a dictionary migration (section 8); no caller today |
| 6 | The board's aria-label says "Cost per booking: not measured" on a done-with-you cell | Fixed: `cellWords` in `BoardGrid.tsx` says "Done with you" (and "Client calls") as the grid shows it. Test: `board-screen.test.tsx` checks both labels (57 pass) |
| 7 | `cockpit_clickup_writeback_inputs` passes no `serviceMode` | Follow-up, unchanged (10.4.4); the writes are right |
| 8 | Only the board and CEO Delivery read a client's own CPL line; `cplTargetsOf` and `cockpit_board_targets_map` differ on a null good line | Latent, the contract's default (section 0); written in section 8. Revisit if a client line is ever set |
| 9 | `SOURCES.md` said "3 listed winners leave the creative archive" | Fixed: the row now says no listed ad joins the archive and the 3 already in it stay until a follow-up migration, as 10.4.1 |
| 10 | `meta-ad-days/run.ts:835` says "cancelled or stopped" for a churned client | Follow-up with the next `meta-ad-days` deploy (section 8); not edited, so main keeps matching the deployed function |

Checks after these fixes, run one file at a time in `~/mahara-worktrees/currency`: `eod-rollup.test.ts`,
`ad-billing-strip.test.ts`, `board-screen.test.tsx`; `npx tsc -b` and `bunx biome check --line-ending=auto src` in the
media buyer app; `scripts/check-shared.sh`. No file under `hermes/` changed, so the release copies and `BASES.txt` are
unchanged.

### 10.9 The second completeness check's gaps (23 Oct, after 10.8)

Each gap was read again first. Aziz asked to ship now, and both gaps are follow-ups that the check itself called no ship
blocker, so neither changes code, a test, a figure in 10.5 or a release file.

| # | Gap | Done |
| --- | --- | --- |
| 11 | The media buyer's AI copy assistant (`generateAssistDraft` in `hermes/media-native/tools.ts`, native job `assist.run`) takes the creative `winnersArchive`, keeps saved and auto winners, sorts by cost per lead and puts up to 8 in the prompt with no compromise-list filter (`tools.ts` imports only `../cockpit-sync/metaMedia`). The 3 listed winners stay in that archive (10.4.1), and Khalida `120247012327250088` ($167, 72 leads, about $2.32 a lead) is among the cheapest. `hermes/cockpit-sync/stills.ts` and `capture.ts` also read the archive and take stills of archived winners | Follow-up, not in this ship: an `isExcludedAd` filter on the archive in `generateAssistDraft` (with a `mediaNative.test.ts` case), or the listed-winners migration (10.4.1), closes it. `tools.ts` runs from the native release: the cron's `run-media-native.py` runs `hermes/media-native/run.sh` inside `~/cockpit-native-current` (there is no `/opt/mahara-cockpits` on the VPS, whatever `hermes/media-native/runbook.md` says), and the live `~/cockpit-native-current/hermes/media-native/tools.ts` has md5 `97dbbb0ffedda977b5ac674c39fece82`, equal to main (read over ssh 23 Oct). So the filter ships as a release file next to the staged `excludedAds.ts`, with its own `BASES.txt` row. Named to Aziz in 10.7 |
| 12 | The Convex twins keep the old words and one old rule: `convex/ceo/adapters/delivery.ts` says spend with no leads counts as a bad cost per lead and "A Done With You client with no bookings is judged on cost per lead alone" (its status note), and its row builder keeps `weBook = bookings > 0 or DFY`, so a done-with-you client with GoHighLevel bookings would be judged on them there; `convex/ceo/adapters/clients.ts` keeps "no leads in 7 days 2" in its risk legend | Left as they are, on purpose. Convex is retired and nothing live runs these files. The twins carry only the C4 logic the tests import (`clientStatus`, `tooEarly`, `tooFew` and `riskOf`, and the kill floor in `b2bAds.ts`); the done-with-you rows, the churned rule and every note the CEO reads come from the native adapters in `hermes/ceo-refresh/native/adapters/`, which ship in N3. Anyone who revives a twin starts from the native adapter, not from the twin's notes |

Nothing was run again for 11 and 12: no code, test or release file changed, so the checks of 10.1 and 10.8, the release
copies and `BASES.txt` stand.

## 11. Shipped (23 Oct 2026, 22:40 to 23:35 Kuwait)

The lead session shipped 10.6 from main `fa4f66cc` (build `7471dd88` merged with main `16dc5540`, no conflict; tsc,
biome, check-shared and every test file of 10.1 passed on the merge). Live fingerprints, the list (21), the churned table
(absent), the release link (`0f85cpb2`) and the 13 live release md5s were read again first: unchanged.

| Step | What went live | Checked on production |
| --- | --- | --- |
| 1 | media buyer and client success at `fa4f66cc` | ship.sh verified both live bundles |
| 2 | `20261023p` to `u` | 23 listed ads, 0 snapshot rows of SAFAD's two ads; churned table with row security, no policy, `service_role` SELECT only, 1 row; the nine bodies carry the new md5s with ACLs as before. Board 14 to 20 Oct: SAFAD $7.86 good; نهوض نجد cost per booking and booking rate `not_measured` with `clientBooks`; Madana too few "under $30.00 (2 x the $15.00 ...)"; Triple Edge "churned" in Not in these totals; Active (done with you out) $2,524.72 / 49 = $51.52 |
| 3 | native release `fa4fcpb3` on `0f85cpb2` | doctor, sync dry run (no listed ad in `dailyStats`; SAFAD's ad set out of `marketPlays`; `winnersArchive` 52), CEO dry run (14 sections). The first canary failed on "supabase-management provider did not confirm" in seven CEO sections right after the dry runs (regular cycles on `0f85cpb2` stayed ok); a canary-only retry with the base and staged-file checks passed at 20:31Z. CEO Delivery 16 to 22 Oct: $2,541.09 / 56 = $45.38; 22 Oct $37.58; 9 to 15 Oct $61.48; 15 rows, no Triple Edge, 5 bad; نهوض نجد "Done with you" with $205.15 named |
| 4 | `20261021d` | one `media.excluded_ads.stats_archived` audit row: 47 rows, $3,452.64; 0 listed rows left; feed count 1,445 equals the table |
| 5 | `clickup-writeback` v13 (verify_jwt off, as before); `cockpit-ceo-api` v26 (verify_jwt on, as before; since its 22 Oct deploy only this build changed its folder and `kpi.ts`) | one run of the scheduled KPI job: ok=false, "Dry run: 80 writes planned on 17 cards, nothing written to ClickUp", 16 to 22 Oct; Arcturus 3\9 Cost Per Booking "911" |

Still open after the ship (10.8 and 10.9): the three listed winners stay in the archive and the copy assistant can quote them;
the tracking backlog still lists five outsider ads; `cockpit_media_live_campaigns` keeps a typed 30 and 90; the worker
still shows Triple Edge's two campaigns in the launch watch and off-board rows; the ClickUp inputs pass no service mode.
Rollback, unchanged from 10.6: the link back to `0f85cpb2`; the dumps in `~/.cache/mahara-ship/rollback/`; the previous
Vercel deployments; `clickup-writeback` v12 and `cockpit-ceo-api` v25 by redeploying `352508d3`'s folders.
