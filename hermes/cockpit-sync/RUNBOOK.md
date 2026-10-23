# Native cockpit feed worker

## Status and boundaries

The native feed is live. It runs every 15 minutes under `flock` from `/home/hermes/cockpit-native-current`, not a checkout. The live cron line is:

```cron
*/15 * * * * /usr/bin/flock -n /home/hermes/.cockpit-native-state/native-source-ceo.lock /usr/bin/python3 /home/hermes/.cockpit-native-state/run-source-ceo-cycle.py >> /home/hermes/.cockpit-native-state/native-cron.log 2>&1
```

The CSM calls worker is separate (`hermes/csm-calls/RUNBOOK.md`) and does not add provider reads to this feed.

`worker.ts` is a finite process, not a daemon. It calculates media, CSM, creative, market, winner archive and still-image results without a Convex server import. Only `--apply` claims a lease, uploads images, or publishes. It never sends customer messages or changes campaigns.

| Owner | Runtime contract |
|---|---|
| Creative Triage `bldgtotkfmhoxmlzowdx` | All cockpit writes, audit, media provider health, storage |
| B2B `flwboeijllbtrufxkhts` | Read-only source; this worker has no B2B write route |
| Native media | `cockpit_native_media_runs`, one bounded 30-minute claim |
| Existing monitor | `status='published'` and `published_at`; bootstrap does not advance freshness |
| Canonical media/CSM/creative feeds | Existing `20260927w/v/s` source rows: `table_name`, `source_id`, `client_names`, `data`, `source_snapshot_at` |
| Source readiness | Every canonical table must have `ready`, a snapshot stamp and an exact count; mixed stamps fail |

The migration also uses the real domain campaign/ad projections, statistics grains, checklist schema and `cockpit_media_provider_health`. Apply it after the existing identity, checklist (`e/f`), domain, CSM-state, media-action/workflow, statistics, reconciliation and `s/v/w` migrations. It does not replace or weaken consumer access gates.

## Named keys

`SUPABASE_URL` must be `https://bldgtotkfmhoxmlzowdx.supabase.co`.

Required names: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`, `META_SYSTEM_TOKEN`, `CLICKUP_API_TOKEN`, `GOOGLE_APPLICATION_CREDENTIALS`, `TYPEFORM_TOKEN`, `FATHOM_API_KEY`, `GHL_CLIENT_PIT`. The last key reads Mahara's client-call location. Client profile tokens still come from the verified Client Data sheet. Google uses read-only Sheets, Drive and Calendar scopes. `CSM_CALENDAR_IDS` and `CREATIVE_CALENDAR_IDS` explicitly select shared Google calendars. Credential identity must match the native calendar configuration. Never put keys, credentials, reports, snapshots or inventories in Git.

## Harmless checks for the parent

These use isolated PostgreSQL/PGlite and deterministic provider fixtures. They need no live URL, key, upload, or customer account:

```sh
bun test hermes/cockpit-sync/csmProducer.test.ts scripts/native-feed.test.ts
python -m unittest discover -s scripts -p test_import_cockpit_runtime_sources.py
```

`native-feed.test.ts` loads the real canonical schemas, audit triggers, grants and role gates. It exercises actual source publication, expected-state conflicts, complete/empty/missing feeds, duplicate IDs, rollback, original identities, history, retries, lease contention/expiry, provider receipts, bootstrap tombstones, scoped reads, still fences and raw-provider calculations. The unrelated `clients` foreign-key target is the only minimal table fixture.

The temporary SQL smoke was removed after isolated acceptance. For an actual two-session race, run concurrent `cockpit_native_media_claim` calls in a migrated isolated database. Commit the first and confirm exactly one succeeds. PGlite serializes its connection. The migration also uses an advisory transaction lock and a unique live-claim index.

No checks were executed by the worker author. Do not infer a pass from the presence of tests.

## Doctor and source review

```sh
bun hermes/cockpit-sync/worker.ts doctor
```

This checks named environment entries only. It explicitly leaves credential validity, providers, source readiness and storage unverified.

The parent may then run the read-only repository check:

```sh
bun hermes/cockpit-sync/worker.ts doctor --sources
```

`cockpit_native_media_doctor()` checks canonical readiness and the still bucket. A missing source is an error, not zero. Provider validity still requires a dry run. The Supabase storage schema is platform-owned; the migration installs the public image bucket only when that schema exists. Browser writes to this bucket are denied. A plain PostgreSQL fixture has no bucket and doctor must report that fact.

## Finite archive bootstrap

`scripts/import-cockpit-runtime-sources.py` is a separate one-time reconciliation tool. Default planning uses only private files. It does not fetch credentials or contact a service.

1. Supply fresh archives and a manifest with `snapshots`: each item contains `cockpit`, `deployment`, absolute `path`, exact `sha256`, `captured_at`, and the complete `tables` name-to-count map. The importer verifies the ZIP checksum, exact table inventory, each count and stable IDs.
2. Save a fresh service-only `cockpit_native_bootstrap_inventory()` response outside Git. It includes the complete target row inventory and prior import/tombstone ledger. Add verified `files` mappings keyed by `cockpit/storageId`; each mapping has its native Creative Triage public storage `url`, `sha256`, and `verified: true`. File transfer/verification is a separate reviewed prerequisite; this importer cannot bless an unverified URL or upload legacy blobs.
3. List explicit `--scope cockpit/table` entries. Unknown durable tables block the plan even when empty. Auth/session material is invalidated, never imported. Pending outbound jobs remain quarantined; historical source outbox rows have no replay route.
4. Canonical row feeds and statistics have atomic bootstrap operations. Campaign/ad reconciliation reuses `import-snapshot-data.py` rather than another normalized mapping. Other durable financial/EOD/check/member data must already have verified canonical reconciliation; missing or different protected state blocks coverage. The tool never hides financial/EOD history in a generic source JSON cache.
5. A source row can change or disappear only if the prior import ledger still matches its exact current data and client scope. A tombstone cannot resurrect. Complete source rows and ready/count/stamp commit together under the native lease and full target-inventory comparison.

Example command shape (paths refer to private inputs supplied by the parent):

```sh
python scripts/import-cockpit-runtime-sources.py --manifest /private/runtime-manifest.json --inventory /private/runtime-inventory.json --scope media-buyer/inbox --plan /private/runtime-plan.json
```

Review `blockers`, classifications, counts, files, client scope, expected target rows and operations. A scoped plan never claims full migration coverage. Only after that review, explicit `--apply --plan /private/runtime-plan.json --plan-sha256 <printed-file-sha256>` may use the service key. The exact original claim is saved beside the plan before publication. Repeating the same reviewed plan and receipt retries that run; it cannot acquire a new fence to bypass a conflict. A failed/expired run requires a new inventory and newly reviewed plan.

## Dry run and live release

Fathom reads start 24 hours before the last successful full native publication. The worker reads that checkpoint from `cockpit_native_media_runs` through its read-only transport. Failed runs and dry runs cannot advance it. Original CSM `syncRuns` remain unchanged.

Run doctor and a dry run from a new immutable `/home/hermes/.cockpit-native-releases/<sha>` folder, not from `~/mahara-cockpits`. The run wrapper is `/home/hermes/.cockpit-native-state/run-source-ceo-cycle.py`; it writes reports under `/home/hermes/.cockpit-native-state/`. Stage via `scripts/prepare-native-worker-package.py` and include every new runtime file in its REQUIRED list. Keep the prior symlink target for rollback. The live cron line is above and in `hermes/cockpit-guardian/crontab.manifest`. Muhammed owns the native cutover.

Old cycle plans are pruned hourly by `hermes/native-prune` (its own cron line and lock, 2026-10-22). A `sync-plan.json` goes after 48 hours unless its cycle failed: a failure file, a sync step that did not publish, or a missing or unfinished receipt. Those plans stay for reconciliation, as do the 8 newest plans and every receipt and log.

## Client 7 days (ads7d)

Since cost per booking build 2 (2026-10-22) each run computes one 7-day figure per client in `calculator.ts` (`clientWeeks`) and the producers attach the same object as `ads7d` to the media `clientLinks` row, the CSM `clientProfiles` row and the creative `clients` row. It is carried in memory (`SyncResult.clientWeeks`, stripped in `worker.ts`), never as a table: a media table the publish does not know refuses the whole publish.

- Window: `from` and `through` are the run's `since7` and `until7` (`sevenDayWindow`), one end for every client. Overnight, until the sheet fills yesterday, `through` is the day before yesterday.
- Spend and leads: every Mahara campaign on the client's accounts, stopped ones included, each Meta ad once a day, ads on the compromise list never. A campaign is Mahara's when it is on the board now, or was ever written to `cockpit_campaigns`, or is named exactly as a board card (closed cards included), and in every case is not spending off the board now (one read-only query, `publishedCampaigns`, which also gives each stopped campaign its stored ad account). Spend with no card in this publish is `offBoardSpend`.
- Bookings: the client's GoHighLevel bookings made in the window, every campaign's, cancelled and invalid ones out. `showed`, `noShows` and `due` count the same bookings. DWY, no connection, an unreadable read or no booking calendar read null with `bookingsWhy`, never 0. One refused calendar or window request makes the whole client's bookings unknown for the run (log line `GHL events at location ... refused`), never a shorter count.
- Cost per booking: spend / bookings when both are above 0. Bookings with no spend on Mahara's campaigns read null with `costPerBookingWhy`, never $0.00.
- When Meta's fill fails (log line `meta fallback: ...` at error), a client with an account the sheet does not keep up to date gets no `ads7d` that run, and the weeks log line says how many accounts were not read. Its readers fall back; the next run with the fill read brings it back.
- A failure while building the weeks publishes without `ads7d` (log line `client weeks failed`), never a failed cycle.
- Every published daily row carries `accountId` (digits). Two accounts with one name (Khalida's two "منشآت خالدة") are told apart by the campaign's own account; a row that cannot be told apart carries none rather than the wrong one. The first run after the release rewrites about 30 days of daily rows once.
- The CSM `adLeads` history is keyed by the client's accounts the same way, and a row with no account (it predates `accountId` and `cockpit_campaigns`) by the client tag of the board card named after its campaign.
- Check after a release: the log line `client weeks: N client(s), <from> to <through>`; every `clientLinks` row with an account carries `ads7d` with one shared `from` and `through`; compare each client's `bookings` with the board's confirmed bookings for the same days.

## N3: the CEO's decisions of 23 Oct 2026

Release N3 (base `0f85cpb2`; contract `docs/client-performance/CPB-DECISIONS-20261023.md`, sections 2.3 and 4) changes the worker in four ways.

- The compromise list (`excludedAds.ts`) holds 23 ads. SAFAD's two outsider ads join the 21 of `20261010a` and `20261021b`: `120254791600360066` (made 13 Oct by "Mercedes Garcia", Egypt, $375.10 on 13 to 15 Oct, no lead) and `120254896955290066` (made 20 Oct by "Lucas J Ortiz", Saudi Arabia, $0), both on `act_774492648699300`, as `20261023p` lists them in `public.cockpit_excluded_ads`. `excludedAds.test.ts` checks the worker's list equals the migrations'. SAFAD's 14 to 20 Oct `ads7d` reads $15.71 / 2 = $7.86 with `offBoardSpend` 0 (it was $375.09 off board).
- Spend with no lead (decision 4): the line is `NO_LEAD_MULTIPLE` (2, in `constants.ts`, kept equal to the site's `kpi.ts`) x the $15 gate, $30, always computed and judged on the cents shown. `judge` kills a campaign or an ad with no lead on the line or over, and holds it under the line ("not enough data", rank 16). With earlier bookings and no lead on the line or over, only a cost per booking within $60 holds it; $60 to $80 is a kill (it was a hold). `diagnose` names "Landing page or tracking" on the line or over, however early (the old $50 is gone); from $20 to under the line with no lead, its "Too early to call" says to let it run to $30, not to the $45 cost line. The learning override keeps the findings of a campaign with no lead on the line or over; its two $90 parts are unchanged. The checklist counts "Campaigns with no lead after $30 of spend". Tests: `verdicts.test.ts`.
- Market lens (default b): `marketProducer.ts` leaves a listed ad's creative out of its play, takes its spend and leads out of the play's totals (cost per lead worked out again), and skips an ad set with no unlisted spend (SAFAD's outsider ad set `120254791600350066`). Meta leaves deleted and archived ads off an ad set's `/ads` edge while the ad set's insight still counts them, so for the 6 accounts that hold a listed ad (`EXCLUDED_AD_ACCOUNTS`) the account's one ad-level window (now with `adset_id`) also names the listed ads of that ad set; each counts once, and other accounts make no extra read. Tests: `listed-ads-market.test.ts`, `excludedAds.test.ts`.
- Winners archive (default b): `winners.ts` never archives or updates a listed ad. It cannot remove one: `cockpit_native_media_publish` refuses any plan that drops an archived winner ("Winner archive cannot delete history"), and it is not changed. So the 3 listed winners archived on 23 Oct (`120246795745520088`, `120246624477980705`, `120247012327250088`, in `cockpit_creative_sources` with `table_name` `winnersArchive`, 52 rows in all) pass through N3 exactly as read. Taking them out needs a listed-winners migration that this build did not write (a follow-up, not part of the 23 Oct ship): under the publish's lock it would move the 3 rows to an archive table, restate `cockpit_creative_source_state.row_count` (52 to 49) and write one audit row with the rows in `before`. It may run only after N3 is live: the old release would add Khalida's `120246795745520088` back from `marketPlays`. `listed-ads-market.test.ts` runs the plan through the publish's own winners guard, its refreshable keys read from `20261022p`.
- Order: `20261023p` (the database list), then N3, then one published media cycle, then `20261021d`, which archives every listed ad's `cockpit_media_daily_stats` rows under the publish's lock and refuses while the newest plan still carries one.

Checks after N3's first published cycle: the cycle published (no "Winner archive cannot delete history"); the plan's `dailyStats` holds no row of the 23 ads; `marketPlays` holds no ad set `120254791600350066` and no listed creative; `winnersArchive` still holds all its rows, the 3 listed ones unchanged, and gains no listed ad; no table drops to 0; every zero-lead ad under $30 reads hold and every one on $30 or more reads kill (the counts move as leads come in: the builder's replays gave 9 holds and 4 kills at the 13:52 sync of 23 Oct and 8 and 4 at 18:22, once Atlantis 19\10 ad-SC3 had a lead). Once the follow-up listed-winners migration exists and has run: `winnersArchive` holds none of the 3 and the next cycle still publishes. Rollback: point the link back at `0f85cpb2` and run neither `20261021d` nor any listed-winners migration until N3 is live again (the old release's list has 21 ads).

## Preservation and failure behavior

- A publication compares exact table counts/content fingerprints and source stamps after taking write-conflicting locks. A concurrent source, human checklist, decision, profile, or dismissal change rejects the entire plan.
- Campaign/ad matching uses canonical provider-natural keys. Existing SQL IDs, foreign keys and original deployment/source IDs stay stable. Media and creative feeds retain their own imported row IDs; stills attach by provider identity. Unrelated human fields and annotations survive. A human edit to a source-owned normalized field, an ambiguous identity, or unsafe absent-row retirement blocks publication for review rather than hiding the edit behind fresh raw data.
- Daily-grain history is retained. Matching grains update under their existing source IDs rather than adding another deployment cohort. Source-owned booking deletions are limited to the verified collection window.
- Roster days, human churn events, winner annotations, reports, preferences, financial/EOD history and outbound-delivery history are not replace-all caches. The CSM refresh reads the actual bridge's churn sheet (`1p8CAd5pL9zKjc1mZ73Gc_hoj4NSWHfFPs4FoC_WuBUU`, discovered tab prefix `01`, current month row). A blank numerator publishes a missing-data note, not zero. Staff appointments use fixed location `wwG426bwruWWv9W3fazQ` through eight weekly windows from 14 days back to 42 days ahead; history outside that window survives. Report and delivery histories keep their verified source stamps and have no replay route.
- Every upload checks the live SQL fence before each attempt and requires enough lease time for its bounded HTTP request. Content-addressed files are immutable. Publication/release reject stale or expired fences.
- Success and failed release persist sanitized intent/response/failure records in the existing media health ledger. Receipt-only settlement can append diagnostics using the original run token after expiry; it cannot publish, upload, renew or release any lease. A repository outage leaves a protected failure report for reconciliation.
- An uncertain publication must be checked against its saved run/plan SHA. An identical successful retry returns the stored receipt. A changed plan or SHA is refused. Never claim a fresh run solely to bypass this protection.
