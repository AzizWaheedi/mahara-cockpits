# Cost per booking, build 2: the contract (22 Oct 2026)

Aziz, 21 Oct: "make sure it shows the cost per booking correctly for all". The audit is
`docs/client-performance/CPB-AUDIT-20261021.md` (R1 to R20). Build 1 shipped today (ship note
`docs/client-performance/CPB-20261021.md`). This contract fixes, for the seven builders who work in
parallel next, who owns which file, every interface between them, the numbers each item must
produce, and the ship order. Builders read it; nobody but the contract agent edits it.

Base: worktree `~/mahara-worktrees/currency`, branch `currency-budgets` at `a1c030ee`. GitHub main
is `61beb995` (one commit later: `src/pages/ceo/TABS.md` and `src/pages/ceo/moneyImport.tsx`, an
Ecom label unrelated to this work; the ceo group leaves both lines alone so the merge before the
ship is clean). Nothing here is committed, applied, deployed or released by a builder.

Decisions as defaults: D0a (SAFAD outsider ads) is NOT built and the ids stay off every list.
D0b as recommended (shipped in build 1). D0c: Atlantis's qualification calendar is not a booking
calendar. D0d: the board keeps the whole ad account; every other screen counts Mahara's campaigns
and says "Mahara's campaigns only". R12 stays a dry run and reports ok=false. ClickUp's "911" band
stays at $90 (1.5 x the gate, `rules.ts` `kpiBand` unchanged) until Aziz decides otherwise.

---

## 1. Groups and the files each owns

No file is in two groups. A builder that needs a change in a file it does not own names it in its
final report under "Needs from <group>" and does not edit it.

| Group | Owns (create or edit) | Items |
|---|---|---|
| **ceo** | `hermes/ceo-refresh/**`; `apps/media-buyer-cockpit/src/pages/ceo/**` (SOURCES.md and TABS.md included); `apps/media-buyer-cockpit/src/types/ceo/**`; `apps/media-buyer-cockpit/src/components/ceo/**` (should need no change; additive only, the media buyer pages import it); `apps/media-buyer-cockpit/convex/ceo/**` (the TS twin `convex/ceo/adapters/delivery.ts` that `delivery-rates.test.ts` imports); tests `apps/media-buyer-cockpit/scripts/delivery-rates.test.ts`, `scripts/ceo-*.test.ts(x)`, `scripts/money-*.test.ts(x)` | R2, R3 (CEO half), R5 (CEO `clientStatus`), R10, R17, R19 (CEO SOURCES.md) |
| **worker** | `hermes/cockpit-sync/**`; root `scripts/native-*.test.ts` and `scripts/lib/nativeFeedDb.ts`; the N2 release copy `~/mahara-worktrees/hw-notes/rel-cpb-n2/files/hermes/cockpit-sync/**` (new folder) | R8 (producer), R16 (worker part, none expected), R20 (counts), overnight window, `accountId` on daily rows |
| **sql** | new `supabase/migrations/20261022w_media_week.sql`, `20261022x_media_client_range.sql`, `20261022y_board_cpl_golden_rule.sql`, `20261022z_clickup_kpi_inputs.sql`; new tests `apps/media-buyer-cockpit/scripts/media-week-supabase.test.ts`, `media-client-range-supabase.test.ts`, `board-cpl-golden-rule-supabase.test.ts`, `clickup-kpi-inputs-supabase.test.ts`; the existing tests that pin a function it replaces: `scripts/media-statistics-supabase.test.ts`, `scripts/winner-saves-supabase.test.ts`, `scripts/board-api-supabase.test.ts` (only where the CPL cap changes an expectation) | R5 (board), R8 (RPC), R12 (inputs), winner saves, overnight window (SQL side) |
| **media-buyer** | `apps/media-buyer-cockpit/**` except the ceo and sql paths above and `scripts/creative-source-models.test.ts`; plus, in `apps/client-success-cockpit`: `src/lib/csmDiagnosis.ts`, `scripts/csm-diagnosis.test.ts`, and both copies of the pinned files `src/lib/kpi.ts` and `src/lib/reportPeriod.ts` (byte for byte, only if touched) | R4 help text, R8 (client page, CSM Diagnosis), R16 rest (EOD roll-up), overnight window (app side) |
| **clickup** | `supabase/functions/clickup-writeback/**` (code and tests) | R12 |
| **creative** | `apps/creative-director-cockpit/**`; `apps/media-buyer-cockpit/scripts/creative-source-models.test.ts` (it imports the creative app) | R8 (creative), R20 |
| **docs** | `docs/client-performance/SOURCES.md`; in `docs/client-performance/CPB-20261021.md` a new section 7 "Build 2" and the State cells of the section 2 table for the items in this contract | R19 (client performance), R4 rule text, ship note |

Why the split differs from the brief:
- **CSM Diagnosis lives in the client success app**, which no group owned. It goes to media-buyer
  because `kpi.ts` and `reportPeriod.ts` are pinned identical across the two apps by
  `scripts/check-shared.sh`, so one group must own both copies of those anyway.
- **The SQL tests live in `apps/media-buyer-cockpit/scripts`** (the PGlite harness
  `scripts/lib/cockpitTestDb.ts` is there), so the sql group owns the named test files inside the
  media buyer app. The media buyer group must not create files with those names.
- **The CEO code reaches outside `src/pages/ceo`**: payload types in `src/types/ceo`, the Convex TS
  twin of `clientStatus` that `delivery-rates.test.ts` imports, and the CEO tests in `scripts/`.
- **`creative-source-models.test.ts`** sits in the media buyer app but tests the creative app.
- `docs/client-performance/CPB-BUILD2-CONTRACT.md` (this file) belongs to the contract agent.

Nobody touches: `cockpit_native_mirrors`, `cockpit_native_media_publish`,
`cockpit_native_grain_key`, `cockpit_meta_ad_days_apply`, `excludedAds.ts` and
`cockpit_excluded_ads` (D0a not built), `hermes/cockpit-guardian`, `HANDOFF.md`.

---

## 2. Interfaces

### 2.1 `ads7d`: the client's 7 days, published by the worker (N2)

One object per client, computed once in `calculator.ts` and attached, identical, to three rows the
worker already publishes. All three are free JSON rows; no SQL change is needed to carry it.

| Home (published table) | Row matched by | Read by |
|---|---|---|
| media `clientLinks` (`cockpit_media_sources`, table_name `clientLinks`; built in `creativeProducer.ts`) | the client card (`taskId`, name, aliases) | media-buyer (EOD roll-up, client page 7 days), sql (`cockpit_media_week()`) |
| csm `clientProfiles` (`cockpit_csm_sources`) | `clientName` | media-buyer (`csmDiagnosis.ts`) |
| creative `clients` (`cockpit_creative_sources`) | `taskId` / name, copied from the profile in `collectCreative` as `daily` already is | creative (`creativeSourceModels.ts`) |

```ts
type ClientWeek = {
  from: string;            // YYYY-MM-DD, the worker's since7
  through: string;         // YYYY-MM-DD, the worker's until7: the sheet's last spend day,
                           // one end for every client in one publish (sevenDayWindow)
  accounts: string[];      // Meta ad account ids, digits only (no "act_"), sorted
  spend: number;           // USD to the cent: Mahara's campaigns on the client's accounts,
                           // from..through inclusive, stopped campaigns included (their spend
                           // in the window, usually 0), ads on the compromise list never in
  leads: number;           // Meta leads on the same rows
  offBoardSpend: number;   // USD on campaigns of these accounts with no Ads Management card
                           // in this publish (verdict "off board": the client's own or
                           // outsiders'): left out of `spend`, given for the "Mahara's
                           // campaigns only" note; 0 when none
  bookings: number | null; // confirmed bookings made from..through (main and online calendars,
                           // call-backs out, a reschedule out while its original counts),
                           // every campaign included, stopped or off the board;
                           // null = not read (see bookingsWhy), never 0
  bookingsWhy?: string;    // one plain sentence when bookings is null: DWY, no GoHighLevel
                           // connection, the read failed, or no main or online calendar
  costPerBooking: number | null; // spend / bookings to the cent when bookings > 0, else null
  showed: number | null;   // of those bookings: GoHighLevel status showed
  noShows: number | null;  // of those bookings: status no-show
  due: number | null;      // of those bookings: meeting time passed, not cancelled
  campaigns: {             // every campaign that spent or booked in the window
    campaignName: string;
    spend: number;         // USD to the cent
    leads: number;
    bookings: number | null; // placed booking rows (placeBookings) in the window
    live: boolean;         // true when the campaign is in this publish's `campaigns` rows
  }[];
  source: "media sync";
};
```

Rules: rows are deduplicated by (Meta ad id, day) before summing (the Shades 14\10 to 17\10 rename
repeated $70.00). A client with no ad account gets no `ads7d` key at all. Absent `ads7d` (older
publish, or no account) means "not published": readers fall back to what they show today, with
today's label, and never print 0. A show rate is `showed / (showed + noShows)` when that sum is
above 0, else null with "not marked yet", never 0%.

**Worker traps (must hold):**
- Never add a key to `campaigns` or `ads` rows. `cockpit_native_mirrors` (20261008h line 83) raises
  "Untracked raw annotation changed" on the second publish where a non-listed key changes value, and
  the media publish then fails every cycle.
- Never leave a helper table in `captured.tables` (for example to carry the window from `syncOnce`
  to the producers). Any media key outside the 17 known tables raises "Unknown media.X output"
  (20260927x line 293). Carry it in memory or delete it before `prepareTables`.
- Stamp `accountId` (digits only) on every `dailyStats` row (main `:2037`). The grain key ignores it.
  The first N2 publish rewrites about 30 days of daily rows once, so expect a one-time burst of
  audit rows (the 20261008h dedup skips unchanged rows afterwards).
- `calculator.ts` for the release: build on
  `~/mahara-worktrees/hw-notes/rel-cpb/files/hermes/cockpit-sync/calculator.ts` (md5 3d7e2251, live
  as release e4c0cpb1), never on main's file whole: main imports `./lostNotes`, which the live
  release lacks. Put the result and every other changed worker file in
  `~/mahara-worktrees/hw-notes/rel-cpb-n2/files/hermes/cockpit-sync/` and run the worker tests
  against that copy as `rel-cpb/live-test` did. `csmProducer.ts`, `creativeProducer.ts`,
  `csmProfileCalculations.ts` and `worker.ts` are identical on main and live today.

### 2.2 The 7-day window, one source for everyone

The worker's `through` above is the day every booking count stops. SQL reads it with one helper,
and every consumer uses that helper or the coverage read.

`public.cockpit_media_week() RETURNS jsonb`, in `20261022w_media_week.sql`:
- `{"from": date|null, "through": date, "source": "media sync"|"media data"}`.
- `media sync`: `max(data->'ads7d'->>'through')` and `min(...->>'from')` over the `clientLinks` rows
  of the current ready snapshot (`cockpit_media_source_state.source_snapshot_at`), dates validated
  `^\d{4}-\d{2}-\d{2}$`.
- `media data` (before N2, or no row carries `ads7d`): `through = least(max(day) of
  cockpit_media_daily_stats, Kuwait yesterday)`, `from = null`.
- `LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''`; `REVOKE ALL ... FROM PUBLIC, anon,
  authenticated`; `GRANT EXECUTE ... TO service_role`. Called only from definer functions.

### 2.3 `cockpit_media_statistics` coverage gains `bookingsThrough` (20261022w)

Replaces the live function (prosrc md5 `d800cf97035c9b261e72b6b02a0a41f4`, body = 20261010c).
Only the `coverage` branch changes: it returns
`{"first", "last", "rows": null, "bookingsThrough": <week.through>, "weekFrom": <week.from>,
"weekSource": <week.source>}`. Grants unchanged (authenticated, service_role).

Media buyer side (`mediaStatsClient.ts` `mediaDataThrough`): use `bookingsThrough` when present,
else `last` capped at yesterday. When a range runs past that day, the range read counts spend,
leads and bookings through it (one paired end, as the worker does), and the page names the day.
A range wholly after it keeps the build 1 behaviour (bookings counted, spend and cost "n/a" with
the reason).

### 2.4 `cockpit_winner_numbers` caps bookings (20261022w)

Replaces the live function (prosrc md5 `cbbacd4df63c8af8bda56918bda4d1f6`, body = 20260927q). Spend
rows and booking rows are both counted from `p_start` to `least(p_end, week.through)`; the stats
JSON gains `"through": <that day>`. Grants unchanged (service_role, postgres; never authenticated).
Saved rows already in `cockpit_winner_saves` are not rewritten; the sql builder lists, read only,
the saves whose stored bookings exceed a capped recount (CityWood v1 at least) in its report, and
docs names them.

### 2.5 `cockpit_media_client_range` (20261022x, new)

```
public.cockpit_media_client_range(p_start date, p_end date, p_accounts text[] DEFAULT NULL)
RETURNS jsonb  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
REVOKE ALL FROM PUBLIC, anon, authenticated;  GRANT EXECUTE TO authenticated;
```
- Gate: `cockpit_has_role('media_buyer') OR cockpit_has_role('admin') OR cockpit_is_ceo()`, else
  42501 "Verified media-buyer access required". A client row is visible to a restricted seat when
  one of its campaigns passes `cockpit_media_campaign_allowed`. Range: `p_start <= p_end`, under
  400 days, else "Choose a valid range of at most 400 days".
- `p_accounts`: digits or `act_` ids; NULL means every client the seat may read that has spend or
  bookings in the range.
- Clients come from `cockpit_board_clients` (one row per location: `clickup_id`, `client_name`,
  `service_mode`, `status`, `ad_account_ids`). An account on two rows counts once, under the first
  `location_id`, and `why` says so.
- `through = least(p_end, cockpit_media_week()->>'through')`. If `through < p_start` every figure
  is null with why "Meta's numbers for these days are not in yet."
- **Spend and leads**: `cockpit_media_daily_stats` rows from `p_start` to `through`, tied to an
  account by `data->>'accountId'`, else the campaign's newest `cockpit_campaigns.meta_account_id`
  (deleted rows included, `act_` stripped). Only Mahara's campaigns: a campaign name that has, or
  had, a card (`coalesce(raw_data->>'taskId', task_id)` set on any of its rows); the rest is
  `offBoardSpend`. Rows of ads in `cockpit_excluded_ads` are out and summed in `excludedSpend`.
  Deduplicated by (`coalesce(data->>'metaAdId', campaign_name || '|' || data->>'adName')`, day),
  newest `imported_at` kept. Internal (Mahara's own) campaigns never count.
- **Bookings**: the board's rule, `sum(cockpit_client_days.confirmed_bookings)` over `p_start` to
  `through` for the location. Null when any of those days has no row or a null count (why "Bookings
  are not stored for N of the M days."), or for DWY (why "Done with you: the client books its own
  meetings."). `mediaBookings` is the second source: the media sync's booking events of the same
  campaigns and days (`cockpit_media_booking_events`), null when the feed is not ready.

Returns:
```json
{"from": "2026-10-01", "to": "2026-10-21", "through": "2026-10-20", "throughSource": "media sync",
 "clients": [{
   "clickupId": "86eyurepc", "locationId": "...", "name": "Ardon", "serviceMode": "DFY",
   "status": "Active", "accounts": ["718146936708597"],
   "spend": 828.34, "leads": 31, "offBoardSpend": 0, "excludedSpend": 0,
   "campaigns": [{"campaignName": "...", "spend": 828.34, "leads": 31, "bookings": 6, "live": true}],
   "bookings": 6, "days": 20, "storedDays": 20, "mediaBookings": 6,
   "costPerBooking": 138.06, "why": null}],
 "unmatched": [{"account": "123", "campaigns": ["..."], "spend": 12.5}]}
```
The values above show the shape only (Ardon's leads and campaign split are made up); the expected
numbers are in section 3. Units: USD to the cent, counts as integers, null never 0. `costPerBooking` = spend / bookings when
both are known and bookings > 0, else null (the screen then uses `cpbDisplay`).

### 2.6 `cockpit_board_rows` caps the CPL status (20261022y)

Replaces the live function (prosrc md5 `a57b69e6ce597aa531d445ace118f008`, body = 20261021a). After
the `costPerBooking` cell is built: when its status is `good` and it carries no `atLeast`, and the
`cpl` cell's status is `bad`, set the `cpl` status to `watch` and append the note "Cost per booking
is within the $60 gate, so a cost per lead over $15 is a watch line, not off (the golden rule)."
Nothing else changes: DWY rows, unknown or floor costs per booking, and every other cell keep
today's status. No new key, no new column. `cockpit_board_read` and its grants are untouched.

### 2.7 `cockpit_clickup_writeback_inputs` additions (20261022z)

Replaces the live function (prosrc md5 `2e98bd0efe32770de5555fa3163f1266`, body = 20261009f).
Additive only; every existing key stays as it is:
- top level: `weekFrom` (date or null), `weekThrough` (date), `weekSource` from `cockpit_media_week()`;
- with `p_with_stats`: `bookingsByCampaign` `[{campaignName, day, booked}]` from
  `cockpit_media_booking_events` grouped by campaign and day, and the `daily` and `bookings` reads
  start at `today - 10` (was `today - 8`) so an overnight window that starts 9 days back is covered.
Grants unchanged (service_role).

### 2.8 ClickUp KPI push (clickup group, uses 2.7)

- Window: `weekFrom` to `weekThrough` from the inputs. When `weekFrom` is null the plan is refused:
  "The media sync has not published its 7-day window yet, so nothing was planned."
- Ledger check per card by `campaignName`: the card's rows' `spend7d` and `leads7d` against
  `daily` over the window, and the sum of the rows' `bookings7d` against the sum of
  `bookingsByCampaign` over the window for the card's campaigns. Sum, never `Math.max`.
- Bookings above 0: write Bookings (7d) and Cost Per Booking = `kpiBand(spend / bookings, CPB_GATE)`.
- 0 bookings and spend over `CPB_GATE`: write Bookings (7d) 0 and `kpiBand(spend, CPB_GATE)`.
- 0 bookings and spend up to `CPB_GATE`: write Bookings (7d) 0, leave Cost Per Booking, note "too
  early to judge".
- Bookings unknown (`bookings7d` absent): no booking column is written; the note says why.
- Last Updated is stamped only when every column of that card was written or already right.
- New switch `CLICKUP_WRITEBACK_APPLY_KPI`, read by `runKpi` only: KPI writes need it to be exactly
  "true"; `CLICKUP_WRITEBACK_APPLY` alone no longer writes KPI columns; `CLICKUP_WRITEBACK_ONLY_TASKS`
  still narrows. `runDoctor` reports the KPI mode.
- While KPI writes are off the run finishes `ok=false` (so `cockpit_sync_state`
  `clickup-writeback:kpi` reads ok=false through `cockpit_clickup_writeback_finish`) with the note
  "Dry run: N writes planned on M cards, nothing written to ClickUp. The board still shows numbers
  last updated <oldest Last Updated on the board's cards>."

### 2.9 CEO payload (ceo group, internal, listed for review)

`DeliveryWindow` (src/types/ceo/payloads.ts and the refresh) keeps every key and fills:
`confirmed: number` (board confirmed bookings of measured clients), `provisional: number`,
`spendMeasured: number` (spend of the clients whose bookings are measured), `cpbConfirmed: number |
null` (= spendMeasured / confirmed), `notMeasured: {client: string; spend: number; why: string}[]`.
`bookings` stays confirmed + provisional for older screens. The `daily` series gains
`confirmed: number | null`, `provisional: number | null`, `spendMeasured: number | null` (null =
no board row that day). Every CEO tab divides by `confirmed` through one helper in
`src/pages/ceo/` (moved out of `DeliveryTab.tsx` `cpbConfirmedOf`), labelled "Cost per confirmed
booking". A payload stored before N2 (no `confirmed` in `daily`) reads "n/a: this refresh predates
the confirmed count", never the old figure under the new label. `hermes/cockpit-guardian` reads only
`delivery.last_ok`; keep it.

### 2.10 CEO reads of the board tables (no new SQL)

The CEO refresh reads, through its read-only SQL, `public.cockpit_client_days` (`location_id`,
`day`, `confirmed_bookings`, `provisional_bookings`, `sources->'appointments'`) joined to
`public.cockpit_board_clients` (`location_id`, `clickup_id`, `ad_account_ids`, `client_name`,
`service_mode`, `status`). NULL count or a missing row = not measured. Booking day, Kuwait. A read
that returns no row for any card in the window is a failed source (the section keeps its last good
payload), never zero bookings. Both tables have row security and grant SELECT only to service_role:
the N2 dry run must show rows from this read before the canary.

### 2.11 EOD text (media-buyer; read by the CSM's `clientBrief.ts` `eodParts`)

Keep each out-of-KPI line starting "• {client name}" and the heading containing "OUT OF KPI". In
lines you rewrite, use " - " in place of the em dash (U+2014) they carry today; `EOD_LABEL` and `eodParts` accept a
hyphen, and `KPI_LINE` still matches "cost per" and "$". Do not change `clientBrief.ts`.

### 2.12 Migration files, live bodies and order

| File | Replaces (live prosrc md5 on 22 Oct) | Creates | Before |
|---|---|---|---|
| `20261022w_media_week.sql` | `cockpit_media_statistics(text,text,date,date)` d800cf97...; `cockpit_winner_numbers(text,text,date,date)` cbbacd4d... | `cockpit_media_week()` | x, z |
| `20261022x_media_client_range.sql` | none | `cockpit_media_client_range(date,date,text[])` | media buyer ship |
| `20261022y_board_cpl_golden_rule.sql` | `cockpit_board_rows(date,date,text,jsonb)` a57b69e6... | none | none |
| `20261022z_clickup_kpi_inputs.sql` | `cockpit_clickup_writeback_inputs(boolean)` 2e98bd0e... | none | the R12 Edge Function deploy |

Each file: takes the body from the live `pg_get_functiondef` (read with `composio execute
SUPABASE_BETA_RUN_SQL_QUERY`, stdin closed), refuses with "<fn> is not the definition this file was
written against (prosrc md5 %). Re-read the live definition and rebase this file" unless the live
md5 is the one above or the file's own, keeps SECURITY DEFINER, `search_path`, owner and every grant,
restates REVOKE and GRANT, runs in one transaction with `SET LOCAL lock_timeout = '5s'`, applies
twice cleanly, and has its `*-supabase.test.ts` that applies it twice on PGlite over the chain the
function needs (as `board-booking-rule-supabase.test.ts` does). `cockpit_media_client_range`,
`cockpit_media_week` and `cockpit_media_bookings_through` do not exist live (checked 22 Oct). No new
table is planned; if one becomes necessary it gets row security and its grant in the same file.

---

## 3. The items: owner, what to build, the numbers it must produce

Numbers are the audit's for 14 to 20 Oct (7d) and 1 to 20 Oct (MTD), as read on 21 Oct, with D0a
not listed. A check on a later day uses the same rule over the window of that day and compares
with the board for the same days; a difference is named, never hidden.

### R2. CEO Delivery counts bookings (ceo)
Booking reader per 2.10; confirmed and provisional per card by booking day; client rows tied to
`cockpit_board_clients` by ad account first, GHL tie as fallback (Mass Design); the `future` split
dropped in the four readers; meeting day kept only for meetings due and show rate; "not measured"
for clients and days the board does not hold (Pidco, Triple Edge, stopped-client days). Rewrite
`delivery.js` notes, `DeliveryTab.tsx:440`, `metrics.ts` definitions, CEO `SOURCES.md` lines 152
and 167 (meeting day to booking day).
Expected, last7 = 14 to 20 Oct:
- Headline cost per confirmed booking over measured clients: $3,092.14 / 49 = **$63.10**; the note
  names $214.85 on Pidco and Triple Edge whose bookings are not measured (all spend over 49 would be
  $3,306.98 / 49 = $67.49).
- Yesterday (20 Oct): 18 bookings made, $446.70 / 18 = **$24.82** (was 6 meetings, $74.45).
- MTD has no Google copies and no cancelled bookings; provisional MTD equals the board's (7, not 26).
- Clients: Alkhalil no booking on $233.36; Arcturus **$60.62 (4)**; Ardon **$40.38 (5)** on card
  86eyurepc (no longer row "718146936708597"), and it gets its `client:86eyurepc` metric; Castello
  **$268.48 (1)**; City Wood **$118.00 (3)**; Marble **$51.06 (4)**; mergestudio **$16.84 (8)**;
  Shades **$50.91 (4)**; شركة العلا **$38.28 (4)**; Khalida **$91.62 (1)**; Atlantis **$43.63 (4)**.
- Pidco (card status cancelled) is no longer a live "bad" client and is in the cancelled-spend note.
- 30-day card: Alkhalil's 27 Sep pair counts once (/226, not /227).

### R3, CEO half. Compromise list out of the CEO's ad rows (ceo)
`triage.js` `adRowsCte`: `AND NOT EXISTS (SELECT 1 FROM public.cockpit_excluded_ads x WHERE x.ad_id
= coalesce(nullif(d.data->>'metaAdId',''), d.source_id))` in `live`, and on `a.ad_id` in `old`.
Expected: MTD spend falls by the $2,464.96 of listed ads in 1 to 20 Oct and the 30 days by $3,077.54;
on the old booking count Backend MTD reads $54.52 "Within" (was $69.92) and Delivery This month
$65.10; 14 to 20 Oct is unchanged (clean).

### R5. Golden rule (ceo for `clientStatus`, sql for the board)
CEO `clientStatus` (native `delivery.js` and the TS twin, same rule), clients we book for:
- cost per confirmed booking known and up to $60: good when CPL up to $15 and show rate at least
  60%, else watch; a CPL over $22.50 is at most watch;
- known and over $60: bad when over $80 or CPL over $22.50, else watch;
- confirmed bookings 0 (measured): spend counts as the cost per booking: over $80 bad, $60 to $80
  watch (bad if CPL over $22.50), up to $60 too early (bad only if CPL over $22.50 or no leads);
- bookings not measured: judged on CPL as today, and the row says bookings are not measured;
- DWY unchanged (CPL only).
Tests: `delivery-rates.test.ts:200` becomes watch, `:210` stays bad; rewrite `delivery.js` lines
49 to 64 and 140, `DeliveryTab.tsx` 72 to 84 and 461, `BackendTab.tsx` 536 and 546.
Board per 2.6.
Expected: CEO Atlantis **Watch** ($43.63, CPL $34.91) and out of Backend's "Clients off track";
Alkhalil **Bad** (no booking on $233.36); City Wood, Castello, Khalida **Bad**; Arcturus **Watch**.
Board, Atlantis 14 to 20 Oct: CPL cell **watch** with the note, cost per booking $43.63 good, first
break "Off at ROAS".

### R10. One cost per booking in the CEO cockpit (ceo)
Per 2.9 on Today (`TodayTab.tsx` 739 to 746, 827 to 879), Backend (497 to 517), timeframe card
(`timeframeCards.tsx` 64 to 67, 99 to 108), scoreboard (`src/types/ceo/scoreboard.ts` 344 to 353)
and Goals. Expected: Today's 7-day tile equals Delivery's last7 (**$63.10, 49 confirmed**); Backend
MTD equals Delivery's MTD; week-on-week arrows on Today, Backend and Delivery have the same sign;
every label reads "Cost per confirmed booking".

### R17. "Frozen since 2 Oct" (ceo)
Reword `delivery.js:138` (and the comments `triage.js` 123, 167, 197, 213, 372), `money.js:869` and
`:911`, `clients.js:1549`, `metrics.ts:79` and `:743`: `ads_daily_snapshots` has been fed every 10
minutes by the Meta dashboard feed since 18 Oct and fills ad-days the media table lacks (14 to 20 Oct:
$589.94, of it SAFAD's outsider campaign $375.09, Pidco $200.23, Triple Edge $14.62). Recheck
`delivery.js:689` (`frozenRows > 0` is now always true). Expected: no "frozen since 2 Oct" string
anywhere in `hermes/ceo-refresh` or the published `delivery` section.

### R8. Client-level sums include stopped campaigns (worker, sql, media-buyer, creative)
- worker: `ads7d` per 2.1; `adLeads.daily` in the CSM profile (`csmProfileCalculations.ts` 787 to
  799, 822 to 823; `csmProducer.ts` 305 to 306) keyed by the client's accounts, stopped campaigns
  included; `accountId` on daily rows.
- sql: `cockpit_media_client_range` per 2.5.
- media-buyer: `AccountView.tsx` totals from the RPC for every range, labelled "Mahara's campaigns
  only; the Client Performance board counts the whole ad account" with `offBoardSpend` named when
  above 0; the client list shows clients with spend in the range and no live campaign, and their
  page opens; `csmDiagnosis.ts` reads `p.ads7d` (fallback to today's sum, today's label).
- creative: the client's 7-day spend, bookings and cost per booking from `client.ads7d` (fallback
  as today).
Expected:
- MB client page MTD (1 to 20 Oct): Khalida **$191.53 (1)** (was $91.62); Castello **$667.65 / 2 =
  $333.83** (booking QjlLjW81WbovegxJlIB2 on stopped 9\9 counted); Atlantis spend **$559.78**, 5
  bookings, **$111.96**; نهوض نجد spend **$533.33**, bookings n/a (DWY); ARCWANI **$151.40 (1)** and
  Liwan **$194.58 (1)** open; Shades **$203.64 / 4 = $50.91** with $90.07 named as off-board; SAFAD
  **$308.69 / 3 = $102.90** with $375.10 named as off-board.
- 14 to 20 Oct (RPC and `ads7d` alike): City Wood $354.00 / 3 = $118.00; Arcturus $242.48 / 4 =
  $60.62; Atlantis $174.53 / 4 = $43.63 (booking 09f9iAy7nJZyhleRzHTU on stopped 13\9 counted);
  Ardon $201.90 / 5 = $40.38; Marble $204.23 / 4 = $51.06; mergestudio $134.69 / 8 = $16.84; Ocean
  $235.87 / 9 = $26.21; Shades $203.63 / 4 = $50.91; Castello $268.48 / 1; Khalida $91.62 / 1;
  SAFAD $15.71 / 2 = $7.86; Alkhalil 0 bookings on $233.36.
- CSM Diagnosis and creative "Performance, last 7d", Atlantis: **$43.63 (4)**, not $58.18.
- CSM Results This month: ARCWANI point 3 Oct **$20.20**, Liwan 11 Oct **$36.98**, Castello 3 Oct
  **$27.31** (charts no longer empty or missing the day).
- `mediaBookings` equals `bookings` for every Active client; any difference is named in the report.

### R16, rest. EOD per client (media-buyer)
`CockpitPage.tsx`: the 7-day totals and "Clients out of KPI" come from `clientLinks[].ads7d`
(fallback: today's campaign sum, labelled per campaign); one line per client with the client's
figure and the worst campaign named; `belowKpi` applied to the client totals; excluded ads out (they
already are); cents under $100; touchpoints sum instead of `Math.max` (`:1306`); decision evidence
reads "{campaign}: {reason}" (`:1598`). Format per 2.11.
Expected (14 to 20 Oct): "Bookings (7d): 49 · cost per booking $55.45" ($2,717.05 / 49; the line
names DWY spend as left out if it is); each client once; Castello by its client figure **$268.48**
naming 6\10; Khalida once at **$91.62**; Atlantis not listed; Alkhalil "no booking on $233".

### R20. Creative show rate (worker counts, creative screen)
Worker: `showed`, `noShows`, `due` in `ads7d`. Creative: `DashboardPage.tsx:1244` and
`creativeSourceModels.ts` 1893, 2012 to 2013, 2053 to 2056 read them per client (the one global
`showDataAvailable` switch goes). Expected: Shades **50% (1 of 2 marked)** on the audit's data; the
nine clients with nothing marked (Arcturus, Atlantis, Castello, City Wood, mergestudio, Ocean, SAFAD,
شركة العلا, Khalida) read "not marked yet", never "0% show".

### R4 help text (media-buyer, docs)
`boardColumns.ts` `confirmedBookings.how`: "Main and online calendar bookings made on these days.
Cancelled, invalid, Google Calendar copies, the call centre's call-back bookings and rescheduled
bookings whose original still counts are left out." docs: `SOURCES.md` 629 to 647, 640 to 643
(now true on live since e4c0cpb1), 870.

### R12. ClickUp push rebuilt, still a dry run (clickup, sql)
Per 2.7 and 2.8. Expected dry-run plan on the 14 to 20 Oct numbers (bands at $45 / $60 / $90):
City Wood 3, **911**; Castello 6\10 1, **911**; Castello 19\10 0 on $43.12, Cost Per Booking left
("too early"); Marble 4, **At KPI**; mergestudio 8, **Above KPI**; Ocean 9, **Above KPI**; Shades
17\10 4, **At KPI**; Atlantis 7\10 3, **Above KPI**; Arcturus 4, **Below KPI**; Ardon 5, **Above
KPI**; SAFAD 2, **Above KPI**; Khalida 14\10 1, **Below KPI** ($80.27); Alkhalil 0 on $233.36,
**911**. Castello's two cards and Atlantis 7\10 are no longer skipped. Health: `clickup-writeback:kpi`
ok=false with the dry-run sentence naming 7 Oct as the oldest Last Updated. Nothing is written.

### R19. SOURCES.md (docs; CEO half by ceo)
`docs/client-performance/SOURCES.md`: "### Cost per booking" between Provisional bookings and
Meetings due (the rule; paired days to yesterday on each account's clock; spend only on days with
stored bookings; floors, "at least" and "not measured"; gates from `kpi.ts`; the tree's ad-id rule;
"Checked against" with this build's numbers), the same for lead to booking and ROAS, cost per booking
in the TikTok rule (:208), D0c recorded at :920, the media buyer's "Mahara's campaigns only" and the
client-range RPC, and the 7-day window (`cockpit_media_week`). CEO `SOURCES.md` by ceo (R2, R5,
R10, R17 rows).

### Winner saves cap (sql)
Per 2.4. Expected: preview of "CityWood v1", 1 to 21 Oct as read on 21 Oct: **3 bookings, $38.22**
(was 7 at $16.38), equal to the panel. Existing saves are listed, not rewritten.

### Overnight window (worker, sql, media-buyer)
Per 2.1 to 2.3. Expected: from 00:00 to about 06:00 Kuwait on day D, before the sheet fills, the
coverage read returns `bookingsThrough` = D-2 and `weekSource` "media sync"; the media buyer's Month
to date counts spend, leads and bookings through D-2 and says so; after the sheet fills it moves to
D-1. In daytime nothing changes from build 1.

---

## 4. Ship order and production checks

| Step | What | Vehicle | Check on production |
|---|---|---|---|
| S1 | `20261022w`, `20261022x`, `20261022y`, `20261022z` (sql). All safe before N2: `cockpit_media_week()` falls back to the media data until `ads7d` appears, and the inputs only gain keys | MIG | md5 of each replaced prosrc equals the file's own; grants unchanged (`aclexplode`); coverage returns `bookingsThrough` with `weekSource` "media data"; `cockpit_board_read` 14 to 20 Oct: Atlantis CPL watch; the RPC returns the 2.5 shape for Khalida MTD $191.53 |
| N2 | Native release on top of live e4c0cpb1: `hermes/cockpit-sync` (from `rel-cpb-n2`) and `hermes/ceo-refresh` (R2, R3, R5, R10, R17). Doctors, dry run, canary under the lock; the CEO canary needs `ceo_safe` | NR | Every `clientLinks`, `clientProfiles` and creative `clients` row with an account carries `ads7d` with one shared `from` and `through`; the publish after the next sheet fill also succeeds; coverage `weekSource` turns "media sync"; Delivery last7 per client equals the board's confirmed for the same days; no "frozen since 2 Oct" in the section; the board-table read returned rows in the dry run |
| A1 | Apps through `scripts/ship.sh`: media buyer (CEO tabs ride in it) and client success together (`check-shared.sh` pins `kpi.ts` and `reportPeriod.ts`), then creative | APP | §3 numbers on the client page, EOD preview, board help text, CEO Today/Backend/Delivery agreement, CSM Diagnosis, creative show rate; every reader falls back cleanly where `ads7d` is absent |
| R12 | `clickup-writeback` Edge Function (needs 20261022z) | EF | One dry run: ok=false with the sentence, the plan in §3, 0 written. The one-card canary and `CLICKUP_WRITEBACK_APPLY_KPI` wait for Muhammed |
| D | `SOURCES.md` and the ship note, committed with A1 | docs | Text matches what shipped |

Rollback: each migration ships its rollback dump of the live definition and grants (as build 1 did,
under `~/.cache/mahara-ship/rollback/`), `cockpit_media_client_range` and `cockpit_media_week` are
dropped after the functions that call them are restored; N2 by pointing the link back at e4c0cpb1;
apps by promoting the previous Vercel deployment; the Edge Function by redeploying its previous
version.

---

## 5. Checks each group runs (from the worktree root)

- **ceo**: `cd apps/media-buyer-cockpit && npx tsc -b`; `bun test scripts/delivery-rates.test.ts`
  and each CEO test it touched, one file at a time; in `hermes/ceo-refresh` each `*.test.ts` and
  `native/**/*.test.ts` one at a time; `bunx biome check --line-ending=auto --diagnostic-level=error
  src` in the media buyer app. Report the main-against-live differences of every changed
  `hermes/ceo-refresh` file (live copies from 421666e4 are in `hw-notes/cpb/live/`: `data_triage.js`,
  `adapters_delivery.js`, `data_deliveryClients.js`, `metrics.ts`; main's `triage.js` carries the
  unreleased 21 Oct card fold), so N2 knows what it ships.
- **worker**: `bun test hermes/cockpit-sync/<file>.test.ts` one at a time, in the worktree and
  against the `rel-cpb-n2` copy; `bun test scripts/native-feed.test.ts` (one known failure: needs
  `python`); no new biome errors in changed hunks (HEAD already carries format errors in these files).
- **sql**: `cd apps/media-buyer-cockpit && bun test scripts/<file>-supabase.test.ts` for each new and
  each touched test, one at a time; every file applies twice; Supabase stays read only.
- **media-buyer**: `npx tsc -b` and biome `src` in the media buyer and client success apps; `bun test`
  per touched test file; `bash scripts/check-shared.sh` if a pinned file changed.
- **clickup**: in `supabase/functions/clickup-writeback`, `bun test kpi.test.ts`, `run.test.ts`,
  `rules.test.ts`, `migration.test.ts`, one at a time.
- **creative**: `npx tsc -b`, `bun test` per test file in `apps/creative-director-cockpit/scripts`,
  `bun test apps/media-buyer-cockpit/scripts/creative-source-models.test.ts`, biome `src`.
- **docs**: no em dashes; every number quoted names its window and source.

Everyone: gates come from `kpi.ts`, `constants.ts`, `constants.js` or `rules.ts`, never redeclared or
called a placeholder; missing reads "n/a" with a plain reason, never 0; every number names where it
came from and what it leaves out; plain words; no em dashes in code, comments or UI text; no
environment value read or printed; no deploy, commit, push, migration apply or release.

## 6. Not in this build

D0a rows (SAFAD outsider ads), the `ghl-appointments-sync` fix for R7, the optional R6 `parse.ts`
change, the board day-cell note for SAFAD 20 Oct, the creative app's own `playbook.ts` gate copies,
the guardian's age-only KPI check, switching any ClickUp write on, and the "911" line at $80.
