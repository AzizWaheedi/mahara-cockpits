# Native plan prune

Keeps the Hermes VPS disk free. The native cycle runner
(`~/.cockpit-native-state/run-source-ceo-cycle.py`, cron every 15 minutes) writes a
`sync-plan.json` of about 10 MB into a new `cycle-<uuid>/` folder each run, about
0.8 GB a day. Only the runner reads a plan, and only the one it just wrote.
`cycle-status.py` reads receipts, not plans.

## What it deletes

Only files named exactly `sync-plan.json` directly inside a `cycle-*` folder.
`receipt.json`, `sync.log`, `ceo.log`, failure files, `latest-native-cycle.json` and
every other folder stay. A plan stays when:

- it is younger than 48 hours (`--keep-hours`, at least 24),
- it is one of the 8 newest plans, whatever its age (`--keep-newest`),
- its cycle failed: a `sync-plan.json.failure.json`, a sync step that did not publish
  (`exit_code` not 0 or `status` not `media-core-published`), or a receipt that is
  missing, unreadable or unfinished.

A cycle whose sync published but whose CEO refresh failed is not a failed sync. Its
plan goes after 48 hours, and its receipt and `ceo.log` stay. On 22 October 2026 these
were 42 of the 182 cycles in 48 hours. Keeping them would grow the disk 0.2 GB a day.

## Run

```bash
python3 prune.py            # report only
python3 prune.py --apply    # delete, then write native-prune-last.json
python3 -m unittest test_prune
```

Cron, in `hermes/cockpit-guardian/crontab.manifest`:

```
40 * * * *   flock -n $HOME/.cockpit-native-state/native-prune.lock bash -c "cd $HOME/.native-prune/app && python3 prune.py --apply" >> $HOME/.cockpit-native-state/native-prune.log 2>&1
```

It has its own lock. Deleting old plans does not touch the cycle in progress, so it
never waits for or blocks the native lock.

## Signals

- One line per run in `native-prune.log`:
  `native-prune ok: deleted N plans, X MB; kept F failed, R recent, K newest; unreadable folders U; free G GB`
  or `native-prune FAILED: <reason>` with exit code 1.
- `~/.cockpit-native-state/native-prune-last.json`: `at`, `ok`, counts, the first 5
  errors, `last_success_at` and `failed_runs_in_a_row`. A `last_success_at` older than
  2 hours means the prune is stuck.
- The reliability monitor's `vps-disk` check warns at 90% used. It is the backstop
  if the prune stops.

## Install

Copy `prune.py`, `test_prune.py` and this file to `~/.native-prune/app` (owned by hermes;
`~/mahara-cockpits/hermes` belongs to root, so hermes cannot add a folder there). Compare
sha256 with the commit, run the tests and a dry run, then add the cron line. The release
bundle, stage and backups live under `~/.native-prune` too.
