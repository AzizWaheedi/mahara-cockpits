# Native cockpit feed worker

## Status and boundaries

Install paused. Do not add an active cron until the parent has run the isolated tests, reviewed a fresh private dry-run plan, and checked source coverage. This task does not activate, import, deploy, or call providers.

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

## Dry run and paused deployment

```sh
bun hermes/cockpit-sync/worker.ts --report /private/cockpit-sync/dry-run.json
```

A dry run reads providers and may download still bytes into memory, but does not claim, upload, release, write health rows, or publish. The report excludes still binary content. Store it outside Git with restricted file and directory access.

After parent verification and explicit deployment approval, the command to place in a **disabled** cron entry is:

```sh
flock -n /var/lock/cockpit-sync.lock bun /srv/mahara-cockpits/hermes/cockpit-sync/worker.ts --apply --report /private/cockpit-sync/run-$(date +%s).json
```

Activation is a separate action. Keep the previous scheduler paused rather than running two writers. The SQL lease remains authoritative even when `flock` is absent or two hosts race.

## Preservation and failure behavior

- A publication compares exact table counts/content fingerprints and source stamps after taking write-conflicting locks. A concurrent source, human checklist, decision, profile, or dismissal change rejects the entire plan.
- Campaign/ad matching uses canonical provider-natural keys. Existing SQL IDs, foreign keys and original deployment/source IDs stay stable. Media and creative feeds retain their own imported row IDs; stills attach by provider identity. Unrelated human fields and annotations survive. A human edit to a source-owned normalized field, an ambiguous identity, or unsafe absent-row retirement blocks publication for review rather than hiding the edit behind fresh raw data.
- Daily-grain history is retained. Matching grains update under their existing source IDs rather than adding another deployment cohort. Source-owned booking deletions are limited to the verified collection window.
- Roster days, human churn events, winner annotations, reports, preferences, financial/EOD history and outbound-delivery history are not replace-all caches. The CSM refresh reads the actual bridge's churn sheet (`1p8CAd5pL9zKjc1mZ73Gc_hoj4NSWHfFPs4FoC_WuBUU`, discovered tab prefix `01`, current month row). A blank numerator publishes a missing-data note, not zero. Staff appointments use fixed location `wwG426bwruWWv9W3fazQ` through eight weekly windows from 14 days back to 42 days ahead; history outside that window survives. Report and delivery histories keep their verified source stamps and have no replay route.
- Every upload checks the live SQL fence before each attempt and requires enough lease time for its bounded HTTP request. Content-addressed files are immutable. Publication/release reject stale or expired fences.
- Success and failed release persist sanitized intent/response/failure records in the existing media health ledger. Receipt-only settlement can append diagnostics using the original run token after expiry; it cannot publish, upload, renew or release any lease. A repository outage leaves a protected failure report for reconciliation.
- An uncertain publication must be checked against its saved run/plan SHA. An identical successful retry returns the stored receipt. A changed plan or SHA is refused. Never claim a fresh run solely to bypass this protection.
