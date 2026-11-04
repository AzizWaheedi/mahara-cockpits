# Forms deploy helpers

The small scripts the forms waves 1-6 deploys used (2026-11-01/02). None holds a secret: each reads keys by name from
the Composio connection or the VPS. See `docs/forms/HANDOFF-2026-11-02.md` for how they fit the deploy.

| Script | What it does |
|---|---|
| `wsql.py "<sql>"` | One owner-level SQL statement on Creative Triage through Composio (`SUPABASE_BETA_RUN_SQL_QUERY`, read_only false). Prints the result rows. Use a read-only `select` unless the deploy step says otherwise. |
| `mig.py dry <files…>` / `mig.py apply <file>` | Dry-runs a chain of migrations in one rolled-back transaction, then applies one migration by name (`SUPABASE_APPLY_A_MIGRATION`). Always dry-run the whole chain on live first. |
| `guard_check.py [dir] [glob]` | Compares every drift-guard md5 in the matched migrations with the live function bodies. Run before applying. |
| `fdeploy.sh <slug> <rev> [--dry] --verify-jwt on\|off` | Deploys an Edge Function from a pushed revision with its outside imports. Always pass the `--verify-jwt` value the "live before" line prints. |
| `secrets.py NAME=value …` | Sets Edge Function secrets (names only are printed). `NAME=` sets an empty value. |
| `native-hotfix-release.example.sh` | The file-scoped native worker release used for w56monx2: copy the live release, swap named files with hash checks, doctors, sync and CEO dry runs, then a canary that switches the link only on an ok cycle. Copy it, change `ID` (exactly 8 characters), `BASE`, `FILES`, the `BASES` md5s and the note. |

Run `wsql.py` and `mig.py` from this folder (`cd scripts/dev/forms-deploy`), or call them by path.
