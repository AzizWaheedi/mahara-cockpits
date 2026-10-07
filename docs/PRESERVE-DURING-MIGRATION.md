# Keep these working through the Supabase cutover

For the systems manager, from the CEO's request of 2026-10-07: save everything
before the migration, and make sure it is all still there once the migration is
done.

Three pieces of work went live in the days before the native Supabase cutover
(`MIGRATION-TO-100-PERCENT.md`, `HANDOFF-2026-09-24-SUPABASE.md`). Their code is
on main, but parts of them exist only in the production database or on the VPS.
A cutover that deploys from an older branch, re-runs old SQL, reloads tables or
re-clones the VPS checkout would remove them without any error. This page says
what they are, what to leave alone, how to check, and how to put them back.

**Restore point:** git tag `pre-supabase-migration-2026-10-07` (commit
`e166a0b`). Deploy from main at that commit or later, never from an older branch.
The tag holds the code. This page, the two records, the verifier and the restore
helpers came after it and are on main since `1a5eb1b`, so run them from main at
`1a5eb1b` or later.

**Before each step and after it:** run `python3 scripts/verify-preserved.py`
(section 3). Nothing else will tell you in time: the guardian's dead-man
heartbeat is off (`GUARDIAN_BEAT=off`) and the sales watchdog has no Slack
webhook, so a stopped guardian, a stopped rooms worker or a refused minute job
reaches nobody. Section 7 lists what each likely cutover action would break and
which line of the verifier shows it.

**Records:** `docs/preserve/supabase-manifest.json` and
`docs/preserve/vps-manifest.json` describe every object below as it was on
2026-10-07: names, settings, schedules, grants, and a digest of each definition
and file. They hold no secret values and no lead or client data.

## 1. What was built and where it lives

### Live calls, Milestone 1 (shipped switched off on 2026-10-07)

When a sales call over the phone fails, the desk can send the lead a video link
instead. Everything is in place but switched off: rooms run in test mode only.
The plans and specs are in `docs/live-calls/`.

| Part | Where |
| --- | --- |
| Database | Migrations `20261003a_sales_rooms`, `20261003b_sales_hooks`, `20261003c_sales_followup_agent`, `20261003d_live_calls_hardening` and `20261004a_live_calls_hardening_2`, applied by hand to Creative Triage. They created 13 tables (`cockpit_sales_rooms`, `_room_secrets`, `_room_events`, `_room_hosts`, `_room_posts`, `_availability`, `_live`, `_alerts`, `_followup_levels`, `_followup_waves`, `_followup_wave_members`, `_followup_meta`, `_followup_stops`), the view `cockpit_sales_presence` and 40 functions, and changed `cockpit_sales_messages`, `cockpit_sales_followups` and `cockpit_sales_wa_templates`. |
| Edge Functions | `sales-api` v65, JWT check **on**. `sales-live` v2, JWT check **off** on purpose: it is the door that Zoom, Slack, the join page and the minute job reach without a Supabase key, and each of its routes checks its own secret. |
| Function secrets | `CRON_SECRET` (must hold the same value as the vault secret `cockpit_sync_secret`) and `IP_SALT`. |
| Scheduled jobs (pg_cron) | `mahara-sales-rooms-sweep` every minute and `mahara-sales-watchdog` every 5 minutes. |
| Settings | Rows `rooms`, `live` and `followups` in `cockpit_sales_settings`. Now: `rooms` off and test-only, `live` off, `followups` on (for today's drafts) with its agent off. Three guard triggers (`cockpit_sales_settings_guard`, `_guard_delete`, `_guard_truncate`) refuse deletes, truncates and any switch turned on without a manager. |
| WhatsApp templates | Six rows, all inactive: `call_link_en`, `call_link_ar`, `demo_host_en`, `demo_host_ar`, `opener_en`, `opener_ar`. |
| VPS | `~/mahara-cockpits/hermes/sales-desk`, copied by hand, and crontab lines 62 to 64 (`rooms --for 57`, `rooms --check-hosts`, `doctor --cron`). |
| Cockpit | The room screens in `apps/sales-cockpit` (RoomPanel, RoomLine, RoomsHealth, AvailabilityStrip, VideoLink, WavesCard, SalesBanner), live at `cockpit.maharamedia.com/sales`. |

### Proposal generator

| Part | Where |
| --- | --- |
| Worker | `hermes/sales-desk` on the VPS. |
| Settings on the VPS | Six lines in `~/.sales-desk/env`: `SALES_MODEL_PROVIDER=vps`, `SALES_PROPOSAL_MODEL=opus`, `SALES_MODEL_FALLBACK=openai`, `SALES_FALLBACK_MODEL=gpt-5`, `SALES_FALLBACK_JOBS=proposal`, and `CHROME_PATH` pointing at the Playwright headless shell (`~/.cache/ms-playwright/chromium_headless_shell-1193/chrome-linux/headless_shell`). None of them is a secret. |
| Reference deals | `~/.sales-desk/reference/general.json`, `specific.json` and `general-grid.json`, on the VPS only. They are built from client deals, so they never go into git. Without them proposals still draft, but with no reference deal. |
| Call reviews | `~/.sales-desk/vince` (127 files), on the VPS only. Most are named after leads, so they never go into git. |
| Database | Migration `20261004p_sales_ai_usage_provider` (adds `provider` to `cockpit_sales_ai_usage`). |
| Storage | The **private** bucket `sales-proposals`. |

### Cockpit guardian

| Part | Where |
| --- | --- |
| Worker | `hermes/cockpit-guardian` on the VPS, crontab line 59, every 5 minutes, report-only. |
| Settings on the VPS | `~/.cockpit-guardian/env` with one line, `GUARDIAN_BEAT=off`. Its state (open and resolved incidents) is in `~/.cockpit-guardian`. |
| Database | Table `cockpit_guardian_incidents` and function `cockpit_guardian_probe` (migration `20261003e_guardian_incidents`). |
| Hermes | The `cockpit-guardian` entry in `/opt/data/bibi/workspace/reliability/fixer-projects.json` (label "Cockpit guardian", fix policy "pr"). |

## 2. What the cutover must not remove or overwrite

1. **Deploy from main at `e166a0b` or later.** The branch
   `codex/supabase-completion-20261004` (`1bccb34`) is 138 commits behind main.
   It has no live-calls migrations, no `sales-live`, an older `sales-api` and no
   room screens or deck. `scripts/ship.sh` would accept it, because it is on
   main, and cannot tell it is older. Deploying from it would put `sales-api`
   back to old code and remove the room screens and the deck from `/sales`.
2. **Keep the JWT check off where it is off.** There is no
   `supabase/config.toml`, and a plain `supabase functions deploy` turns the
   check on. `sales-live` must stay off, or every call from the minute job is
   refused with 401. These functions are all off today and must stay off:
   `sales-live`, `sales-mirror`, `tap-charges-sync`, `webinar-events`,
   `ghl-appointments-sync`, `ghl-leads-sync`, `ghl-pipelines-sync`,
   `appointment-outcomes-sync`, `client-config-sync`, `provision-client-panels`.
   Use `--no-verify-jwt` for these, or deploy through the management API with
   `verify_jwt` set explicitly (`scripts/dev/deploy_fn.py` does this).
3. **Do not drop, recreate, truncate or reload** the tables, view and functions
   listed above. A reload that deletes or truncates `cockpit_sales_settings` is
   refused by its guard. Do not change any switch; turning live calls on is the
   CEO's decision.
4. **Keep the Supabase jobs.** "Retire legacy writers" means Convex only. Keep
   `mahara-sales-rooms-sweep` and `mahara-sales-watchdog`, and keep
   `mahara-sales-mirror` and `mahara-ghl-appointments`, which feed the
   appointments the rooms read.
5. **Keep the secrets paired.** If `CRON_SECRET` or the vault's
   `cockpit_sync_secret` is rotated, rotate the other to the same value at the
   same time. Do not reset `IP_SALT`.
6. **Apply only SQL that is not applied yet.** Production records none of the
   cockpit migrations, so nothing will tell you what has already run. Re-running
   `20260927a_sales_setter_pay` would undo the newer `cockpit_sales_setter_deals`
   from `20261004a_live_calls_hardening_2`. Re-running the seven files in
   section 4 is safe.
7. **Link the sales staff before the identity migration.**
   `20261004a_cockpit_staff_identity_adoption` is not applied yet. Once it is, a
   seat needs a `cockpit_members` row linked to that person's login. The closer
   and the setter have member rows but neither is linked: the closer is linked
   at their next sign-in, and the setter has no login at all. Until both are
   linked they lose every seat-gated read, including the rooms and follow-ups.
   The three managers are not affected.
8. **Expect a few failed minutes while SQL runs.** SQL that locks
   `cockpit_sales_settings` makes the minute job fail with a lock timeout until
   the lock is released. It recovers by itself; the watchdog may raise an alert.
9. **Keep the bucket `sales-proposals` private.**
10. **On the VPS, do not clean, reset or re-clone `~/mahara-cockpits`.** That
    checkout is on a September commit with 84 uncommitted entries;
    `hermes/sales-desk`, `hermes/cockpit-guardian` and several other workers are
    untracked there. `git clean` or a fresh clone of that commit deletes every
    one of them, the guardian included, and nothing alerts. A plain `git pull`
    refuses instead of overwriting. If the checkout must move, `git reset --hard
    origin/main` at `e166a0b` or later brings both folders back as main has them
    (other workers there are not covered by this page).
11. **On the VPS, keep crontab lines 44 to 53, 59 and 62 to 64**, the six
    `~/.sales-desk/env` lines, `~/.cockpit-guardian/env`, the reference deals,
    `~/.sales-desk/vince`, `~/.cockpit-guardian` and the Playwright shell. The
    guardian's crontab list in git includes lines 62 to 64 since 2026-10-07, but
    the guardian on the VPS reads its own copy, which does not, until its folder
    is copied there again. Until then it raises lost lines 44 to 53 at once
    (urgent), a lost rooms line only when the rooms worker's status row is ten
    minutes old, and lost lines 63 and 64 not at all. Without line 59 it does not
    run, so it says nothing.
12. **If the Supabase keys change**, change the `DESK_`, `COCKPIT_`, `RADAR_` and
    plain `SUPABASE_` keys in the VPS env files together.
13. **Do not restore Hermes from its git mirror.** The mirror's copy of
    `fixer-projects.json` is from 2026-09-27 and has no `cockpit-guardian` entry.
14. **Do not put the crontab back from one of the older copies on the VPS.**
    `~/.crontab.backup` (2026-09-23) has none of our lines; the `~/.crontab.backup.2026092*`
    and `~/.crontab.bak-teamsync-*` copies and
    `~/.cockpit-guardian/backups/crontab.20261003T190937Z` have no guardian or
    live-calls lines; `crontab.20261007T101943Z.before-live-calls` lacks lines 62
    to 64. Use `python3 scripts/verify-preserved.py --print-cron` (section 4).
15. **Keep the folder `~/.cockpit-guardian`.** The guardian's cron line takes its
    lock and writes its log there. Without the folder the line fails before the
    guardian starts (tested in a scratch home on 2026-10-07), so the guardian
    never runs again and never makes the folder again.
16. **A new Supabase project is a move, not a copy.** If the cockpits or the VPS
    workers are pointed at another project, everything in section 1 must exist
    there first: the whole migration history, the vault secrets, the jobs, the
    functions with their JWT settings, the function secrets and the private
    bucket. The verifier says which project the workers and the live cockpit
    use; check the new one with `--project <ref>`.
17. **A database restore to an earlier point takes live calls back with it.**
    Anything written after that point is gone (definitions from `20261004a` and
    `20261004p`, settings, rows). Re-apply the seven files of section 4 and put
    rows back from the private backups (section 5).

## 3. How to check

Run the verifier from the repository root before the cutover starts, for a
baseline, again after each step, and once more after the last one. Run
`git fetch origin` first, so `origin/main` is current.

```sh
python3 scripts/verify-preserved.py              # one line per check, then the verdict
python3 scripts/verify-preserved.py --problems   # only the lines that are not ok
python3 scripts/verify-preserved.py --json       # for machines
```

It compares what is live with the two records in `docs/preserve/` and prints
one line per check: `ok`, `CHANGED`, `MISSING` or `UNKNOWN`. It covers:

- **Database:** every recorded table, view, function (a digest of its
  definition), trigger and pg_cron job; row counts (our tables may lose no row; a
  table they read may lose up to a tenth); the settings switches, and any settings
  row older than the copy recorded at the inventory (put back from an older
  copy); the status rows of the jobs that run every few minutes (the rooms worker,
  its host check, the hourly doctor, the proposal queue, follow-ups, the sweep and
  the watchdog); the WhatsApp template rows; the vault and extension names.
- **Edge Functions:** each one present, `ACTIVE`, version not lower, `verify_jwt`
  as recorded; the deployed source files of `sales-api`, `sales-live` and
  `sales-mirror` against the files at the tag (a deploy from an older branch gets
  a higher version, and only its files give it away); the function secret names;
  `CRON_SECRET` still holding the vault's `cockpit_sync_secret` (two digests
  compared in memory, inside a read-only transaction); our function secrets set
  again after the inventory.
- **VPS:** our crontab lines, byte for byte; the desk and guardian files against
  `origin/main` and the copy recorded at the inventory; the env setting lines;
  which Supabase project the workers use; the reference deals; the call reviews;
  the Playwright shell; `desk.py doctor --offline`; `deploy-check`; the guardian's
  last scan and its folder; the Hermes fixer entry; the backup folder.
- **Cockpit:** the room screens' and the proposal screens' words in the live
  `/sales` bundle, and the Supabase project it talks to.
- **Git:** `origin/main` still contains the restore point, and the tag on origin
  still points at `e166a0b`.
- **Backups:** every file in both private backups against its `SHA256SUMS`
  (the main set and the supplement of section 5).

It changes nothing. SQL goes with `read_only` true; the one read that needs the
owner role (the vault digest) runs inside a read-only transaction. It never
prints or saves a secret.

A `CHANGED` line says whether it is explained: a migration added after
`e166a0b`, in this checkout or on `--ref` (`origin/main` by default; pass the
cutover branch if it is not merged yet), redefines the object; the VPS still has
the copy recorded on 2026-10-07; the object is not part of this work; or a
function was redeployed from a ref that contains the restore point. For a
function, the live body must be the body that migration writes; a migration that
only mentions it explains nothing, so a later hand edit is not explained. A later
migration that puts back a definition the older migrations had already replaced
(an old file copied into a new one) is not explained either: the line names both
files. For tables, triggers, jobs and settings, "explained by a later migration"
means: read that migration, it is the one that changed the object.
`20261007b_cockpit_auth_contract.sql` (on main since 2026-10-07) was applied
before the inventory, so the records already hold its `cockpit_get_my_access()`.
Exit code 0 means nothing is missing, every change is explained and every check
could be made; 1 means something is missing or a change is not explained; 2 means
some checks could not be made.

It needs the management API token in a file (`SUPABASE_MGMT_TOKEN_FILE`,
default `~/.config/mahara/sb_mgmt_token`), the Creative Triage service key in a
file to read the private bucket (`SUPABASE_SERVICE_KEY_FILE`, default
`~/.config/mahara/sb_service_key`) and ssh access as `hermes` to the VPS
(`--ssh`, `--ssh-key`).

The baseline on 2026-10-07, after this review: PASS, every check ok but the
three explained ones recorded at the inventory (two sales-desk import files older
on the VPS, two never copied there, seven Mac metadata files).

**Dry simulations.** `python3 scripts/preserve_scenarios.py` replays the
verifier against copies of the records changed the way 24 cutover actions would
change them (section 7) and says which lines each one fails; with
`--tape <file>` it starts from a live recording made with
`python3 scripts/verify-preserved.py --record <file>` (names, digests, counts and
true/false only). Nothing live is touched.

Without the keys, these read-only checks cover the essentials.

Database (`scripts/dev/sq.py` is read-only unless `--write` is passed):

```sh
python3 scripts/dev/sq.py triage "select jobname, schedule, active from cron.job where jobname in ('mahara-sales-rooms-sweep','mahara-sales-watchdog','mahara-sales-mirror','mahara-ghl-appointments') order by 1"
python3 scripts/dev/sq.py triage "select key, value->>'enabled' as enabled, value->>'test_only' as test_only, value->>'agent' as agent from public.cockpit_sales_settings where key in ('rooms','live','followups') order by key"
python3 scripts/dev/sq.py triage "select tgname from pg_trigger where tgrelid = 'public.cockpit_sales_settings'::regclass and tgname like 'cockpit_sales_settings_guard%' order by 1"
python3 scripts/dev/sq.py triage "select id, public from storage.buckets where id = 'sales-proposals'"
python3 scripts/dev/sq.py triage "select to_regclass('public.cockpit_sales_rooms') is not null as rooms, to_regclass('public.cockpit_sales_presence') is not null as presence, to_regclass('public.cockpit_guardian_incidents') is not null as guardian, to_regprocedure('public.cockpit_guardian_probe()') is not null as probe"
```

Expected: four jobs, all active; `followups` enabled with agent `false`, `live`
not enabled, `rooms` not enabled and `test_only` `true`; three guard triggers;
`sales-proposals` with `public` false; every check `true`.

Edge Functions:

```sh
python3 scripts/dev/deploy_fn.py --info sales-api    # verify_jwt True
python3 scripts/dev/deploy_fn.py --info sales-live   # verify_jwt False
```

VPS (names only; never print an env file's values):

```sh
crontab -l | grep -c 'desk.py --quiet rooms --for 57\|desk.py --quiet rooms --check-hosts\|desk.py --quiet doctor --cron\|guardian.py --mode report-only'   # 4
cut -d= -f1 ~/.sales-desk/env          # the six names in section 1
cat ~/.cockpit-guardian/env            # GUARDIAN_BEAT=off
ls -l ~/.sales-desk/reference          # general.json, specific.json, general-grid.json
ls ~/mahara-cockpits/hermes/sales-desk/desk.py ~/mahara-cockpits/hermes/cockpit-guardian/guardian.py
```

`docs/preserve/vps-manifest.json` has a sha256 for each crontab line, each
worker file and each reference deal, so any change can be pinned to a line or
file.

## 4. How to put things back

Make a separate checkout of the tag for the code, never in a shared checkout,
and run the helpers from the checkout that carries this page:

```sh
git worktree add ../restore pre-supabase-migration-2026-10-07
```

**Database.** Apply these files from the tag, in this order. Each can be re-run
safely (create or replace, settings seeds that skip existing rows, jobs
unscheduled and scheduled again). Their sha256 values are under
`source.migrations` in the Supabase record and were checked against the tag on
2026-10-07.

1. `supabase/migrations/20261003a_sales_rooms.sql` (also schedules the two jobs)
2. `supabase/migrations/20261003b_sales_hooks.sql`
3. `supabase/migrations/20261003c_sales_followup_agent.sql`
4. `supabase/migrations/20261003d_live_calls_hardening.sql`
5. `supabase/migrations/20261003e_guardian_incidents.sql`
6. `supabase/migrations/20261004a_live_calls_hardening_2.sql`
7. `supabase/migrations/20261004p_sales_ai_usage_provider.sql`

Run all seven, in this order. The earlier files replace functions and the
`cockpit_sales_presence` view with their first versions, and the later files
bring back the current ones; stopping part way leaves older code live. Do not
include `20261004a_cockpit_staff_identity_adoption.sql`; it shares the date
prefix but is a different file. In a new project, apply the whole history in
`supabase/migrations/` first: these seven change tables older files make.

**Settings rows.** A missing row comes back with every switch off. A row put
back from an older copy keeps that copy's values: compare it with
`db/cockpit_sales_settings.json` in the private backups (section 5) and write
back the values. Turning a switch on needs a sales manager, because of the
guard: in one transaction, `set local mahara.actor = '<manager email>';` and
write `updated_by` as that email. Turning switches off needs no one.

**Rows.** Tables reloaded or restored to an earlier point lose rows. The rows of
2026-10-07 are in `db/*.json` and `supplement/db/*.json` in the private backups
(each file: `table`, `row_count`, `rows`). Insert them with
`on conflict do nothing`, so newer rows stay as they are.

**Edge Functions.** From the checkout that carries this page, pointing at the
restore checkout (the helper is not at the tag):

```sh
python3 scripts/dev/deploy_fn.py sales-api ../restore/supabase/functions/sales-api
python3 scripts/dev/deploy_fn.py sales-live ../restore/supabase/functions/sales-live --no-verify-jwt
python3 scripts/dev/deploy_fn.py sales-mirror ../restore/supabase/functions/sales-mirror --no-verify-jwt
```

The deployed sources of all three were byte for byte the files at the tag on
2026-10-07. Then run the verifier: the three source lines must read ok.

**Secrets.** `CRON_SECRET` must hold the vault's `cockpit_sync_secret`. In the
Supabase dashboard, read it in the SQL editor
(`select decrypted_secret from vault.decrypted_secrets where name = 'cockpit_sync_secret';`)
and paste it as `CRON_SECRET` under Edge Functions, Secrets. Never paste it
into a chat, a file or a commit. If `IP_SALT` is lost, set a new random value;
the only effect is that stored join-page IP hashes no longer match. The verifier's
pairing line says when they match again.

**The cockpit.** `scripts/ship.sh sales` from main at `e166a0b` or later (since
`7d303f8` it needs the Vercel CLI signed in; it no longer falls back to
Composio), then open `/sales` and check that the room screens and the deck are
there; the verifier's two bundle lines must read ok.

**VPS workers.** Either `git reset --hard origin/main` in `~/mahara-cockpits` at
`e166a0b` or later (both folders are on main; other untracked workers there are
not), or unpack the exact copies from the backup folder, which were checked to
restore every recorded file byte for byte (150 and 52 files):

```sh
cd ~/mahara-cockpits/hermes
tar xzf ~/backups/2026-10-07-pre-migration/files/code/hermes-sales-desk.tar.gz
tar xzf ~/backups/2026-10-07-pre-migration/files/code/hermes-cockpit-guardian.tar.gz
```

**VPS crontab.** Save the current one first
(`crontab -l > ~/.crontab.backup.$(date +%Y%m%d%H%M%S)`). Print our lines,
exactly, and add back the ones the verifier says are missing:

```sh
python3 scripts/verify-preserved.py --print-cron         # lines 44 to 53, 59 and 62 to 64
python3 scripts/verify-preserved.py --print-cron all     # all 65 lines, byte for byte the recorded crontab
```

Install the whole recorded crontab (`--print-cron all`) only if nothing was
added to it on purpose since 2026-10-07; its sha256 is `crontab.sha256` in the
VPS record. The same text is `files/cron/crontab.txt` in the backups.

**VPS settings.** The six `~/.sales-desk/env` lines are exactly
`files/env-redacted/sales-desk.env` in the backup folder (checked; it holds no
secret): `install -m 600 ~/backups/2026-10-07-pre-migration/files/env-redacted/sales-desk.env ~/.sales-desk/env`.
The other env files hold keys and are recorded by name only; re-enter their
values from where the keys are kept today.

**The guardian's folder.** `mkdir -m 700 ~/.cockpit-guardian` first; without
it the guardian never starts (section 2, item 15). Then
`printf 'GUARDIAN_BEAT=off\n' > ~/.cockpit-guardian/env && chmod 600 ~/.cockpit-guardian/env`
and, to keep its open incidents and what it has seen deployed, unpack
`files/state/cockpit-guardian-state.tar.gz` from the backup folder into it.

**Reference deals and call reviews.** Copy them back from the private backups
below into `~/.sales-desk/reference/` (mode 0600) and `~/.sales-desk/vince/`.
Their sha256 values are in the VPS record and in both `SHA256SUMS`.

**Playwright.** Nothing to save; reinstall with
`cd ~/.sales-desk/browser && npm ci && npx playwright install chromium-headless-shell`
and point `CHROME_PATH` at the new `headless_shell`.

**Hermes fixer entry.** Add `cockpit-guardian` back to
`fixer-projects.json` with label "Cockpit guardian" and fix policy "pr"; the
exact entry is under `fixer_projects` in the VPS record and in
`files/state/hermes-fixer-projects.json`.

**From the bucket.** If the VPS folder is gone too, every file is in the bucket
under the same path. Files that are not JSON are stored as `<name>.json`
wrappers; the `restore` field of each wrapper is the one line that unwraps it
(checked on 2026-10-07 with the crontab copy: it came back byte for byte).

## 5. Private backups

Lead and client data never goes into git. Private copies are kept in two places:

- Supabase Storage, the private bucket `sales-proposals`, folder
  `backups/2026-10-07-pre-migration/`.
- The VPS, folder `~/backups/2026-10-07-pre-migration/`.

Both were filled on 2026-10-07 and read back: 35 files with a `SHA256SUMS`
(37 objects in the bucket). The adversarial review added `supplement/` in both
places, with its own `SHA256SUMS`: the rows of `cockpit_sales_followups` (the
desk's follow-up drafts, a table the live-calls migrations changed) and
`cockpit_sales_references` (the reference library the proposal screens read),
which the first set did not hold, and a git bundle of the branch that carries
this page (`git clone` it if the branch is lost). The verifier checks every file
in both sets. If either folder is empty or the verifier says a backup file is
missing, stop and ask the CEO before the cutover. Neither holds secret values:
those stay in the vault, the Supabase function secrets and the VPS env files.
`cockpit_sales_room_secrets` is left out on purpose (it holds Zoom host links).
Older copies of the worker code are in `~/.sales-desk/backup-*` on the VPS.

## 6. What else is in the repository

- `docs/live-calls/`: the live-calls plans, specs and reviews (see its README).
- `scripts/verify-preserved.py`: the verifier in section 3.
- `scripts/preserve_scenarios.py`: the dry simulations in sections 3 and 7.
- `scripts/dev/`: `sq.py` (SQL), `deploy_fn.py` (Edge Function deploys and
  `--info`) and `matrix.sh` (the live-calls test matrix).
- `docs/preserve/`: the two records. The Supabase one also has
  `cutover_findings`, the risks in section 2 with the evidence behind them.
- `hermes/cockpit-guardian`: since this review it remembers the live-calls
  pieces deployed by 2026-10-07 (a lost state no longer reads "not deployed
  yet") and checks the code `sales-api` and `sales-live` were deployed with
  (`live-code`). The VPS runs its older copy until the folder is copied there.

## 7. What each cutover action would do

Each row was simulated with `scripts/preserve_scenarios.py` (against the records
and against a live recording of 2026-10-07) or, for the restores, tried on
copies in a scratch folder. "Verifier" is what its next run says; "guardian now"
is the copy running on the VPS today; "guardian updated" is this branch's copy
once its folder is on the VPS. A guardian failure posts to #health (report-only
mode alerts, it only fixes nothing). A guardian that has stopped posts nothing,
because its heartbeat is off, and the sales watchdog's own alerts reach no one,
because the vault has no Slack webhook for it.

| Action | What breaks | Verifier | Guardian now | Guardian updated | Put back with |
| --- | --- | --- | --- | --- | --- |
| VPS checkout cleaned or re-cloned at its September commit | The desk (proposals, rooms worker, follow-ups) and the guardian stop | MISSING both folders' files; stale status rows; the doctor and deploy-check cannot run; last scan old | Nothing: it is deleted with its folder | The same | Reset to current `origin/main` (simulated: passes) or the two code tarballs |
| Crontab put back from the copy taken before live calls | Rooms worker, host check and hourly doctor stop | MISSING lines 62 to 64; stale rooms and host rows | `live-rooms-worker` fails about 10 minutes later; lines 63 and 64 unseen | `vps-crontab` fails urgent on the next scan | `--print-cron` |
| Crontab put back from `~/.crontab.backup` (2026-09-23) | Every desk job and the guardian stop | MISSING lines 44 to 53, 59, 62 to 64; stale rows; last scan old | Nothing: its own line is gone | The same | `--print-cron` or `--print-cron all` |
| `sales-api` deployed from `codex/supabase-completion-20261004` | Rooms, follow-up agent and send rules gone from the server; the version goes up | MISSING `sales-api source`: deployed without rooms.ts, roomlogic.ts, liveio.ts, followupAgent.ts, sendrules.ts | Nothing (still ACTIVE, still 401) | `live-code` fails urgent | `deploy_fn.py` from the tag |
| The sales cockpit shipped from that branch | Room and proposal screens gone from `/sales` | MISSING both bundle lines | Nothing | Nothing | `scripts/ship.sh sales` from main |
| `sales-live` deployed with a plain `supabase functions deploy` | The minute job's calls are refused (401) | CHANGED `verify_jwt True`; deploy-check not ready | `live-function` fails | `live-function` and `edge-functions` fail | `deploy_fn.py ... --no-verify-jwt` |
| An old migration re-run (`20260927a`) | `cockpit_sales_setter_deals` goes back to its old version | CHANGED, not explained | Nothing | Nothing | The seven files in order |
| The same old SQL copied into a new migration of the cutover branch | The same | CHANGED, not explained: names the new file and the old one | Nothing | Nothing | The seven files in order |
| A migration drops the settings guard trigger | Any writer can turn live calls on | CHANGED: trigger gone | Nothing | Nothing | The seven files in order |
| `cockpit_sales_settings` reloaded from an older export | Switches and worker settings go back (follow-ups off) | CHANGED: each row older than recorded; switches changed | Nothing while rooms and live stay off | The same | Section 4, settings rows |
| A table dropped and made again, empty | Its rows are gone (alerts, drafts, usage) | CHANGED: fewer rows than recorded | Nothing | Nothing | Section 4, rows |
| `CRON_SECRET` and `IP_SALT` set to new values | Once rooms have work, sales-live refuses the minute job | CHANGED: pairing differs; IP_SALT set again | Nothing while rooms are off | The same | Section 4, secrets |
| Function secrets wiped | sales-api and sales-live fail on their first real call | MISSING names; pairing MISSING | Nothing until a call fails | The same | Re-enter them; section 4, secrets |
| `~/.sales-desk/env` rewritten from `env.bak-20260927` | Proposals lose their fallback model | MISSING the three fallback lines | Nothing | Nothing | `install` the env-redacted copy |
| Reference deals deleted | Proposals draft with no reference deal | MISSING reference deals | Nothing | Nothing | The backups |
| `hermes/cockpit-guardian` removed | The guardian stops | MISSING its files; last scan old | Nothing: it is gone | The same | Tarball or main |
| `~/.cockpit-guardian` removed | The guardian never starts again | MISSING its env; the last-scan line says to make the folder | Nothing | Nothing | `mkdir -m 700`, env line, state tarball |
| Cockpits and workers moved to a new project, the old one left | Everything in section 1 is missing in the new one | CHANGED: workers' and cockpit's project differ; `--project <new>` lists what is missing | Its live-calls checks fail there (it remembers them deployed) | The same, even with its state lost | Section 2, item 16 |
| Database restored to 2026-10-04 | Definitions from `20261004a`, the `provider` column and newer rows go back | CHANGED: functions, columns, older settings rows, fewer rows | Nothing (the tables and jobs still exist) | Nothing | The seven files, then rows |
| Database restored to 2026-10-02 | Live calls gone from the database | MISSING tables, functions, jobs, settings rows | `live-tables`, `live-cron` fail | The same, even with its state lost | The seven files, then rows |
| Checkout reset to current `origin/main` | Nothing | Passes | Passes | Passes | Nothing to do |
| A function changed on purpose by a new migration on the cutover branch | The intended change | CHANGED, explained by that migration (its body is the live one) | Nothing | Nothing | Read that migration |
| A cutover migration merged to main redefines a function the rooms use (as `20261007b` does `cockpit_get_my_access()`) | The intended change | CHANGED, explained by the file on `origin/main` | Nothing | Nothing | Read that migration |
| That function then edited by hand | A definition no file in the repo holds | CHANGED, not explained: the file defines it, but the live body is not its | Nothing | Nothing | Re-apply the migration that should hold it |
