# Convex retirement: verified checkpoint

Updated 8 October 2026, 02:34 UTC. All five requested worker-cutover gates passed. Source and CEO operate through Supabase. The steady native schedule is enabled. Convex deletion and full retirement remain open. Earlier checkpoint detail remains in Git and protected receipts.

## Ownership and active release

Muhammed authorized this five-gate cutover. The previous migration session stopped. This session owns production writes.

Workspace: `D:/MaharaMedia/worktrees/mahara-cockpits-supabase-completion`. Branch: `codex/supabase-completion-20261004`.

Active worker commit: `5da4c4c12321266446f1efa1836bfaca7a821540`.
Release: `/home/hermes/.cockpit-native-releases/5da4c4c1`.
Current link: `/home/hermes/cockpit-native-current`.
Archive SHA256: `34f0cef327abff5b468c654770930064f42d9484492c73611bf7de59fb59a161`.

Write only Creative Triage `bldgtotkfmhoxmlzowdx`. B2B `flwboeijllbtrufxkhts` remains read-only. Preserve unrelated root edits and 84 dirty host paths. Do not replay historical messages, notifications, reports, or invitations.

Evidence root: `D:/secure/cockpit-retirement-prep-20261007/consolidation-20261007/`.
Host state: `/home/hermes/.cockpit-native-state`.

## Gates and receipts

1. **Local fixes passed.** All 27 required tests pass with 228 assertions. Both CEO regressions failed before their fixes. All 18 targeted CEO tests pass with 157 assertions. Earlier transport, creative render, and creative build checks also passed. Receipts: `gate1-ceo-contract-candidate-tests.log`, `ceo-live-contract-fixes-tests.log`.
2. **Candidate staged.** All 136 files passed hash verification. Three frozen dependency installs passed. Receipt: `candidate-5da4c4c1-stage.log`.
3. **Server dry runs passed.** Source exited 0. CEO computed eleven sections, including delivery and validated daily metric definitions. Its exit 1 reflects only expected stale bank and portal inputs. No crash or unhandled rejection occurred. Receipts: `completion-dry-runs-5da4c4c1-sync.log`, `completion-dry-runs-5da4c4c1-ceo.log`.
4. **Controlled cutover passed.** Actual Hermes cron dispatched cycle `25d69f59-d6c3-4438-aed7-fa5917e902ec` at 02:23:01 UTC. Source published at 02:32:03 UTC. CEO finished at 02:33:04 UTC. Source has one clean published audit row. CEO published eleven sections with only three expected stale sections. Both ledgers have no error. Receipt: `native-cutover-audit-verification.json`.
5. **Completion recorded.** The steady schedule was enabled and read back at 02:33:49 UTC. The active link resolves to the verified release. All three legacy production deployments remain paused. Receipts: `activation-5da4c4c1-steady.log`, `convex-freeze-hold-verification.json`.

Final source run: `fb7fa077-cbec-4ca1-8947-f5af5a9df2f0`, status `published`, 3,134 provider receipts.
Final CEO run: `d92e3516-c784-4223-b2e6-ba6dd35fec5a`, status `partial`, 124 provider receipts. Published sections: growth, webinar, b2bAds, delivery, calls, clients, team, hiring, assets, organic, machine. Money and expenses retain stale bank warnings. Portal retains its unconfirmed-input warning.

Host cycle receipt: `/home/hermes/.cockpit-native-state/cycle-25d69f59-d6c3-4438-aed7-fa5917e902ec/receipt.json`. Cron dispatch is verified from the actual CRON journal, not a manual launcher call.

Earlier scheduled source run `578bffda-bacd-4d48-abae-a3f5090f328f` published at 01:35:43 UTC. Its ledger has no error and one matching published audit row. Receipt: `sixth-canary-source-audit-verification.json`. Its CEO run failed before acceptance. The successful source publication remains intact.

## Legacy freeze and native schedule

These verified production deployments were paused at 22:46:58 to 22:47:02 UTC on 7 October:

| Cockpit | Deployment | Project ID |
| --- | --- | --- |
| Media buyer | `adorable-seahorse-418` | `2961454` |
| Client success | `impressive-dinosaur-375` | `2961475` |
| Creative director | `colorful-wombat-644` | `2961477` |

Normal function probes confirm the freeze. Pausing stops their normal functions and cron writers. Other deployments remain untouched. Receipts: `convex-freeze-receipt.json`, `convex-freeze-hold-verification.json`.

Active Hermes job:

```cron
*/15 * * * * /usr/bin/flock -n /home/hermes/.cockpit-native-state/native-source-ceo.lock /usr/bin/python3 /home/hermes/.cockpit-native-state/run-source-ceo-cycle.py >> /home/hermes/.cockpit-native-state/native-cron.log 2>&1
```

The launcher runs source publication first and CEO refresh second. One shared lock prevents overlapping cycles. The cron runs as `hermes`. The scheduled canary passed before steady activation. Its protected marker and receipt remain as evidence.

The source worker replaces media `health.runJob {job: "sync"}` and its downstream cockpit feeds. Legacy names: `refresh every 10 minutes through the working day`, `refresh hourly overnight`. The CEO worker replaces `refresh the CEO cockpit`, `health.runJob {job: "ceo refresh"}`. These names come from `apps/media-buyer-cockpit/convex/crons.ts`. The deployment freeze also stops its remaining legacy crons. Those other jobs were not claimed as replaced by this source/CEO pipeline.

The unrelated 64-line Hermes crontab has SHA256 `16970f8e50d1eebabf042de29c97ed7f3796586247eb46df4c4c2e1805d9c331`. Root crontab stayed unchanged. Editor, sales, and personal jobs were preserved. Message, report, and invitation workers were not activated.

Paused scheduled functions can queue. Do not resume legacy deployments blindly. Reconcile pending outward jobs before rollback.

## Preserved history and bounded updates

The final candidate plan preserves 52 profiles, 30 original calls, 59 human call fields, and 17 unchanged history tables. Receipt: `dry-plan-history-5da4c4c1.json`.

Retained performance never borrows the current profile refresh date. Zero or negative timestamps remain unknown. Stopped clients retain original performance and dates. Sheet 403/404 failures retain old values or show an error. Creative stats follow the same date rule.

Unavailable churn and Meta form inputs retain original history with explicit stale warnings. Unknown provider failures remain fatal. All 66 original client links retain their verified ClickUp identities.

Fathom uses a 24-hour overlap from the latest successful native publication. Failed publication and dry runs cannot advance its checkpoint. Initial protected seed: `2026-10-06T16:01:16.602220+00:00`.

Booking publication is limited to the declared inclusive complete window. Earlier imported bookings remain intact. No narrow source read replaces full history.

Protected final exports contain 148 tables and 116,842 rows, including storage exports. ZIP integrity and SHA256 are recorded in `frozen-final-exports-receipt.json`. Archives reside under `frozen-final-source/`. This proves preservation, not full restore.

Fourteen selected history tables had no changed or removed rows. Thirty-one added open checklist records represent 21 current-day duties matching native proposals. Eleven carry archived shadow metadata. No human completion needed importing. Receipts: `final-human-history-deltas.json`, `final-checklist-native-matches.json`, `final-checklist-delta-verification.json`.

Completed imports stay closed: 11,829 reviewed records, 67 billing snapshots, three manual payments, 118 aliases, and 803 original checklist versions reconciled into 561 canonical rows. All 224 earlier unique file objects matched original bytes. Do not repeat those imports. The integrated baseline passed 66 suites, ten typechecks, and five builds.

## Live defects corrected

Failed canaries preserved their ledgers and protected reports. Failed source attempts published no feed data. Their schedules were removed before retry.

- Duplicate still uploads returned HTTP 400 with duplicate status 409. The uploader now verifies exact existing bytes before reuse. It never overwrites mismatched content. Receipt: `still-idempotency-71271f15-verification.log`.
- Source publication and state reads inherited an eight-second timeout. Commits `93e17272` and `eae00611` apply scoped 50-second function limits. Bodies, grants, role limits, and business data stayed unchanged. Receipts: `native-publisher-timeout-receipt.json`, `native-state-timeout-receipt.json`.
- Older bookings fell outside the declared complete window. Commit `98ab6b92` filters publication rows to that window. SQL history guards remain unchanged. Receipt: `canary-statistics-window-diagnostic.json`.
- Booking lookups repeatedly scanned 43,158 retained rows. Commit `fc4e14e3` adds exact booking and daily-stat grain indexes. Verified lookups take approximately 3 ms and 2 ms. Planned rows have no ambiguous grains. Receipt: `native-grain-index-receipt.json`.
- Modern showed/noshow bookings needed the same classification as legacy events. Failed finance needed an actionable error without JSON null output. Commit `6989dfcc` fixes both contracts without weakening publication rules.
- Original daily-series names lacked catalogue definitions. Commit `5da4c4c1` registers their existing semantics without changing historical keys or values. Dry runs now reject unregistered daily metrics. All 51 checked names have definitions. Receipt: `ceo-daily-definition-contract-verification.json`.

## Remaining retirement gates

Bank statements end on 21 September. Portal appointments remain unconfirmed. One Meta form and the churn Sheet remain inaccessible. Preserve these source gaps as warnings.

The creative stale-warning UI is committed and builds but is not published. The normal ship guard refused the candidate outside `origin/main`. No guard was overridden or main branch changed. Receipt: `creative-release-main-preflight.log`.

Public entry bundles contain Supabase addresses and no targeted legacy addresses. This does not prove complete browser, save, or file journeys. Receipt: `public-backend-bindings.json`.

Full restore, browser journeys, late-file reconciliation, hidden callers, and deletion gates remain open. `healthy-cobra-488` is not an approved deletion target. No Convex deletion occurred.

Canonical context sync stopped on dirty work at `398a4ed`. Preserve it. Update the existing session note locally. Do not claim remote synchronization.

The requested source/CEO cutover is complete. Next retirement work requires the remaining browser, recovery, caller, file, and deletion gates. Keep existing history imports closed. Do not resume legacy writers or activate historical outward jobs.
