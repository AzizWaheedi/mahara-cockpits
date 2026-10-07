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
    untracked there. `git clean`, `git reset --hard` or a fresh clone deletes
    every one of them. A plain `git pull` refuses instead of overwriting.
11. **On the VPS, keep crontab lines 59 and 62 to 64**, the six
    `~/.sales-desk/env` lines, `~/.cockpit-guardian/env`, the reference deals,
    `~/.sales-desk/vince`, `~/.cockpit-guardian` and the Playwright shell. The
    guardian's own crontab list does not include lines 62 to 64, so it will not
    report them missing.
12. **If the Supabase keys change**, change the `DESK_`, `COCKPIT_`, `RADAR_` and
    plain `SUPABASE_` keys in the VPS env files together.
13. **Do not restore Hermes from its git mirror.** The mirror's copy of
    `fixer-projects.json` is from 2026-09-27 and has no `cockpit-guardian` entry.

## 3. How to check

Run the verifier from the repository root before the cutover starts, for a
baseline, and again after the last step:

```sh
python3 scripts/verify-preserved.py
```

It compares what is live with the two manifests in `docs/preserve/` and lists
every difference. It changes nothing. Version numbers of Edge Functions will go
up after a redeploy; what matters is that the code comes from main at `e166a0b`
or later and the JWT setting matches.

If the verifier is not in your checkout yet, these read-only checks cover the
essentials.

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

Work from a separate checkout of the tag, never in a shared checkout:

```sh
git worktree add ../restore pre-supabase-migration-2026-10-07
```

**Database.** Apply these files from the tag, in this order. Each can be re-run
safely (create or replace, settings seeds that skip existing rows, jobs
unscheduled and scheduled again):

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
prefix but is a different file. Their sha256 values are under
`source.migrations` in the Supabase manifest. A missing settings row comes back
with every switch off; compare it with `cockpit_sales_settings` in the manifest.
Turning `followups` back on needs a manager, because of the guard.

**Edge Functions.** From the restore checkout:

```sh
python3 scripts/dev/deploy_fn.py sales-api supabase/functions/sales-api
python3 scripts/dev/deploy_fn.py sales-live supabase/functions/sales-live --no-verify-jwt
```

Then run both `--info` checks from section 3.

**Secrets.** Set `CRON_SECRET` to the value of the vault secret
`cockpit_sync_secret`. If `IP_SALT` is lost, set a new random value; the only
effect is that stored join-page IP hashes no longer match. Never paste a secret
into a chat, a file or a commit.

**The cockpit.** `scripts/ship.sh sales` from main at `e166a0b` or later, then
open `/sales` and check that the room screens and the deck are there.

**VPS workers.** The VPS copies of `hermes/sales-desk` and
`hermes/cockpit-guardian` matched the tag on 2026-10-07; the VPS had nothing
newer. Copy both folders from the tag into `~/mahara-cockpits/hermes/` by hand,
the way they were installed.

**VPS crontab.** Save the current one first
(`crontab -l > ~/.crontab.backup.$(date +%Y%m%d%H%M%S)`). The exact text of all
65 lines is under `crontab.lines` in `docs/preserve/vps-manifest.json`, with a
sha256 for each line and for the whole file. Add back any missing line; lines
59 and 62 to 64 are the ones this work added. They are also in
`hermes/sales-desk/README.md` (Cron section).

**VPS settings.** Write back the six `~/.sales-desk/env` lines from section 1
and `GUARDIAN_BEAT=off` in `~/.cockpit-guardian/env`. The other env files hold
keys and are recorded by name only; re-enter their values from where the keys
are kept today.

**Reference deals and call reviews.** Copy them back from the private backups
below into `~/.sales-desk/reference/` (mode 0600) and `~/.sales-desk/vince/`.
Their sha256 values are in the VPS manifest.

**Playwright.** Nothing to save; reinstall with
`cd ~/.sales-desk/browser && npm ci && npx playwright install chromium-headless-shell`
and point `CHROME_PATH` at the new `headless_shell`.

**Hermes fixer entry.** Add `cockpit-guardian` back to
`fixer-projects.json` with label "Cockpit guardian" and fix policy "pr"; the
exact entry is under `fixer_projects` in the VPS manifest.

## 5. Private backups

Lead and client data never goes into git. Private copies are kept in two places:

- Supabase Storage, the private bucket `sales-proposals`, folder
  `backups/2026-10-07-pre-migration/`.
- The VPS, folder `~/backups/2026-10-07-pre-migration/`.

List both folders before the cutover starts; if one is empty, the backup has
not been made yet, so stop and ask the CEO. Neither holds secret values: those
stay in the vault, the Supabase function secrets and the VPS env files. Older
copies of the worker code are in `~/.sales-desk/backup-*` on the VPS.

## 6. What else is in the repository

- `docs/live-calls/`: the live-calls plans, specs and reviews (see its README).
- `scripts/dev/`: `sq.py` (SQL), `deploy_fn.py` (Edge Function deploys and
  `--info`) and `matrix.sh` (the live-calls test matrix).
- `docs/preserve/`: the two manifests. The Supabase one also has
  `cutover_findings`, the risks in section 2 with the evidence behind them.
