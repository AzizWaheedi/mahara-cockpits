# Session Handoff: Convex to Supabase completion sweep (Mahara cockpits)

**Every job and screen that still depended on Convex now has a Supabase replacement; the three changed cockpits are shipped, and the remaining work is Muhammed's go-live switches plus committing and deploying the last uncommitted batch (billing write-back to ClickUp, em-dash fix, comment watch code).**
Date: 2026-10-09 · Working dir: `D:/MaharaMedia/worktrees/mahara-cockpits-convex-sweep` (branch `claude/convex-sweep-20261009`)

## Update 2026-10-09 18:30 UTC (follow-up session; this section supersedes TODO 2, 3, 5, 8 and 9 below)
- **Done:** TODO 2 committed (`02cb4440`). `clickup-writeback` v3 and `billing-sync` v3 deployed. `20261009j` applied and verified. `ceo-extensions-sync` v1 deployed (`verify_jwt=false`), doctor OK, dry run. Package list fix `66840883`. Merge of origin/main `fa9ed042`. 249 targeted tests pass.
- **Done by Muhammed 18:19 UTC:** `20261009k` applied (cron `mahara-ceo-extensions-auto`, minute 47, verified) and `fa9ed042` pushed to `main` and the branch. `supabase secrets set` failed: his CLI login lacks secret rights; use the management token from `.env.local` or the dashboard.
- **DB crash 18:15 UTC (4th today):** host kill ("not properly shut down"), about 1 min after a media-run claim, like 09:45 and 12:31. Compute is Small (2 GB). Recommended: upgrade to Medium (Muhammed's cost decision) and have the reliability session profile the media worker's first minute.
- **Billing live (verified):** `BILLING_SYNC_APPLY=true` set by Muhammed. 18:37 UTC run ok, 2 card changes, 67 fresh snapshots, audit row. CEO `clients` section computed again at 18:55 UTC (it had failed since 8 Oct 16:10 on stale snapshots). Still failing: money and expenses, because the newest bank statement ends 21 Sep (needs a statement upload).
- **CEO extensions cron (verified):** first dry run 18:47 UTC ok, "every card already says what the form says". `CEO_EXTENSIONS_APPLY` not set.
- **Comment watch:** dry run plans 0 card changes. Go-live proves nothing yet.
- **Portal monitor:** already runs no Convex checks. A dead-code patch is staged in `D:/secure/.../convex-sweep-20261009/portal-monitor/`.
- **Producer release plan:** `D:/secure/.../convex-sweep-20261009/cockpit-sync-release-plan.md` (overlay 3 files on `c3a95af9`; coordinate with Faris).
- Session note: `mahara-context/shared/sessions/2026-10-09T174500Z-claude-convex-sweep-billing-writeback.md` (local, not synced).

## Context
Mahara runs five React cockpits (media buyer with the CEO cockpit inside it, client success, creative director, video editor, sales). Convex was paused on 2026-10-07 22:47 UTC after a "core data first" migration. Muhammed asked for the migration to be finished 100%, so every Convex job, HTTP route and stubbed screen gets a native owner on Supabase Creative Triage (`bldgtotkfmhoxmlzowdx`). Runtime independence is the goal. Deleting Convex is out of scope unless he says so. A separate session ("Cockpit backend reliability audit") is cleaning the Supabase database in parallel.

## What we did this session
- **Gap sweep.** Four read-only sweeps mapped every Convex cron, HTTP route, worker caller and frontend stub to its native status. All 105 RPCs the cockpits call exist live. **LIVE**
- **Sales mirror outage.** `SALES_B2B_MGMT_TOKEN` was revoked at about 07:15 UTC. Muhammed set the new token from `.env.local` (`supabase_token`). Runs since 11:21 UTC succeed. **LIVE**
- **Sales dials.** These are not a migration fault. B2B `maqsam-calls-sync` runs fine but finds no new setter calls after 2026-10-07 18:37 UTC. **UNCONFIRMED** (business question)
- **Onboarding Kit auto-sync.** New Edge Function `onboarding-sync` with pg_cron `mahara-onboarding-sync` every 10 min. First run 433 read 67 cards and wrote 8. **LIVE**
- **EOD to Slack and the sheet.** Migration `20261009g` makes a submit queue one `eod_outbox` row. Reports imported from Convex are never re-queued. VPS cron now runs `out.py --apply`. **LIVE** (queue was empty at switch-on)
- **Hala WhatsApp inbox resumed.** The exact crontab line was restored from its backup. First run at 11:45 UTC handled 220 messages and wrote 16 drafts. It never sends. **LIVE**
- **Ask AI resumed.** Hermes job `e4601df61803` enabled, `*/5`. The new `askai.py` adds the `comment_digest` and `call_brief` kinds. Doctor is healthy. **LIVE**
- **Media worker scheduled.** Launcher `run-media-native.py`, cron `*/2`, `flock`. Doctor passed 12/12. First live run OK. **LIVE**
- **Guardian without Convex.** Deployed to the VPS after a backup. 282 tests pass on the host. All open `convex-*` incidents closed by themselves. **LIVE**
- **CEO gateway.** `cockpit-ceo-api` now serves the Posting tab, webinar pitch times and ClickUp extensions (`20261009d`). It boots and refuses anonymous callers. **LIVE**
- **Billing sync.** Edge Function `billing-sync` plus `20261009a` (RPCs and cron), and `20261009h`, which closes direct browser writes. The dry run read 65 cards with 2 real changes and 67 day snapshots. **BUILT** (dry run until `BILLING_SYNC_APPLY`)
- **ClickUp writeback.** `clickup-writeback` (jobs `kpi`, `log`, `dosdonts`) plus `20261009f`. The KPI dry run plans 60 writes on 20 cards. **BUILT** (dry run until `CLICKUP_WRITEBACK_APPLY`)
- **Tracking audit.** `tracking-audit`, daily 02:30 UTC. 431 "No URL parameters" plus 2 missing lead forms. This matches Convex's 352 + 2; Convex read fewer ads. **LIVE**
- **Hiring.** `hiring-sync` (cron function) and `hiring-api` (browser, CEO-gated) are deployed. They fail closed until the GHL hiring keys exist. Migration `20261009c` is deliberately NOT applied yet. **BLOCKED**
- **Creative Social.** Stub buttons now queue real Salma jobs. Writes need the creative role or the CEO and are audited (`20261009e`). **LIVE** (shipped)
- **Comment watch and call briefs.** Migration `20261009i` applied, function `comment-watch` v1 deployed, `askai.py` installed on the host. ClickUp writes are dry run until `COMMENT_WATCH_APPLY`. **BUILT** (code uncommitted; see TODO 2)
- **Billing write-back to ClickUp.** Muhammed approved this. Code and `20261009j` written, 88/89 tests pass. **BUILT, not deployed, uncommitted**
- **Release.** Commits `48339a6c`, `f36d76ca` (merge of main) and `4fb487e7` (lint fix for another session's files) were pushed to `main` and shipped with `scripts/ship.sh`. **LIVE**
- **Viktor-side scripts.** Marked archived, and the hard-coded bridge token was removed from the file. The token is still in git history. **LIVE**
- **Database crashes at 12:10, 12:15 and 12:31 UTC.** Cause confirmed: the audit session's audit-log copy pulled huge media-run rows. That session finished safely: the DB went from 6.4 GB to 1.47 GB, with no loss of protected rows. **LIVE** (resolved)

Decisions and why:
- **Ports run as Supabase Edge Functions plus pg_cron where possible.** This matches the existing syncs (`tap-charges-sync`). It avoids VPS ownership conflicts and keeps the service key server-side.
- **Every outward write sits behind an `*_APPLY` flag.** This follows Muhammed's rule that each live outward automation needs approval.
- **`20261009h` was split from `20261009a`.** The live frontends wrote billing tables directly until the new release shipped.
- **Em dashes become hyphens; the marker stays.** Muhammed chose this. Comment watch uses the marker (🎯) to skip the cockpit's own comments.

## Current state: you are here
- **Live and verified:**
  - Production `cockpit.maharamedia.com` serves the release. The deploys were verified by `ship.sh` (IDs in the table below).
  - pg_cron jobs present: `mahara-onboarding-sync`, `mahara-billing-sync`, `mahara-billing-sync-overnight`, `mahara-clickup-writeback-kpi|log|dosdonts`, `mahara-tracking-audit`, `mahara-comment-watch`, `mahara-ai-watch-tick` (checked 2026-10-09 17:27 UTC).
  - Latest run states (`cockpit_sync_state`) are OK for onboarding, ClickUp writeback, comment-watch and ai-watch-tick.
  - `billing-sync` shows `ok=false` only because it is a dry run. This also opened the guardian incident `native-jobs`.
  - Open `convex-*` guardian incidents: 0.
- **Built, not yet verified:**
  - The first live ClickUp writes.
  - The first live billing write.
  - The comment-watch dry-run content. Nobody has read the planned items yet.
  - A real Ask AI chat claim through the new overloaded claim. Tests cover it; it is not checked live.
  - The hiring mirror (needs keys).
- **Not started:**
  - Updating the cockpit-sync producer on the VPS, so CSM and creative pages show digests.
  - Removing the Convex checks from the portal monitor.
  - Team calendar on Vercel.
  - A mahara-context session note.
  - Deleting Convex (out of scope).

## Still open / TODO
1. **Muhammed's switches** (I cannot set secrets; the permission system blocks it). **TODO**
   - Run `powershell -NoProfile -ExecutionPolicy Bypass -File D:\MaharaMedia\worktrees\mahara-cockpits-convex-sweep\scripts\dev\sync-hiring-secrets.ps1`.
   - Set Edge secrets `BILLING_SYNC_APPLY=true`, `CLICKUP_WRITEBACK_APPLY=true` and `CLICKUP_WRITEBACK_ONLY_TASKS=86eyn6c1f` (the Safad card, for the first live check).
   - Then verify that card in ClickUp and remove `CLICKUP_WRITEBACK_ONLY_TASKS`.
   - None of these secrets were set as of 17:27 UTC.
2. **Finish and commit the uncommitted batch.** **IN PROGRESS**
   - **Fix the one failing test:** in `supabase/functions/clickup-writeback/queue.test.ts`, line 46, the expected comment still contains `CHANGE MADE — Raised budget`. Change it to ` - `.
   - **Run tests:** `bun test supabase/functions/clickup-writeback supabase/functions/billing-sync supabase/functions/comment-watch`, then `cd apps/media-buyer-cockpit && bun test scripts/billing-native-sync-supabase.test.ts scripts/ai-watch-supabase.test.ts`.
   - **Then commit** (all files under `git status`).
3. **Deploy the billing write-back, in this order:** **TODO**
   - Redeploy `clickup-writeback`. Its extras are the 5 `cockpit-media-api` files from `fn_extras.py`. This also deploys the em-dash fix.
   - Redeploy `billing-sync` (extra: `cockpit-csm-api/tools.ts`).
   - Then `apply_migration.py .../20261009j_billing_clickup_writeback.sql`.
   - **Warning:** while the apply flag is off, billing edits are held over ClickUp for up to 60 days. After going live, move billing `dry_run` items back to `queued`.
4. **Hiring.** **BLOCKED** on TODO 1
   - After the keys exist: apply `20261009c_hiring_native.sql`.
   - POST `{"job":"doctor"}`, then review the mirror and intake dry runs.
   - Hiring GHL writes (`HIRING_APPLY`) were NOT approved for live. Candidate sends stay off (`HIRING_SEND_ENABLED`).
5. **Comment watch go-live.** **TODO**
   - Read the dry run in `cockpit_comment_watch_runs` and `cockpit_comment_watch_items`.
   - Confirm one real Ask AI chat still completes.
   - Then set `COMMENT_WATCH_ONLY_TASKS=<one card>` with `COMMENT_WATCH_APPLY=true`.
   - Needs Muhammed's approval for that live run.
6. **cockpit-sync producer update on the VPS.** **TODO**
   - Ship `hermes/cockpit-sync/clientUpdates.ts`, `csmProducer.ts` and `creativeProducer.ts` into a new native release.
   - The current link is `/home/hermes/cockpit-native-current` → `c3a95af9`.
   - The release package and runtime env are `runtime-<release>.json`.
7. **Team calendar invites (approved).** **BLOCKED**
   - Vercel project `mahara-media-buyer` has no server env: `CRON_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `TEAM_CALENDAR_WRITES_ENABLED`.
   - The 15-minute watchdog (`api/watchdog.ts`) lacks the same keys.
   - Also remove the leftover `VITE_CONVEX_URL` from that project.
   - Needs a decision on which Google account sends invites.
8. **Portal monitor.** `/docker/hermes-agent-ff5p/data/portal-monitor/monitor.py` still has Convex checks. **TODO**
9. **CEO extensions automatic pass.** Ported in `cockpit-ceo-api`, but not scheduled. Needs an hourly pg_cron call with `{"operation":"ceo.extensions.applyAuto"}`, plus `CEO_EXTENSIONS_APPLY` for live writes. **TODO**
10. **Record the session** in `D:/MaharaMedia/mahara-context/shared/sessions/`. Context sync is blocked by 60 dirty files at `398a4ed`; write the note locally and do not claim sync. **TODO**

## Key files, IDs and locations
| What | Value |
|------|-------|
| Sweep worktree / branch | `D:/MaharaMedia/worktrees/mahara-cockpits-convex-sweep` / `claude/convex-sweep-20261009` (HEAD `4fb487e7`) |
| Clean ship worktree | `D:/MaharaMedia/worktrees/mahara-cockpits-ship` (detached `4fb487e7`; has `.vercel` links and `node_modules`) |
| GitHub main | was `4fb487e7` at push; now `0bdbdc5a` (other sessions pushed after) |
| Root checkout | `D:/MaharaMedia/mahara-cockpits` is stale (500+ commits behind, dirty); do not build from it |
| Cockpit DB / B2B (read-only) | `bldgtotkfmhoxmlzowdx` / `flwboeijllbtrufxkhts` |
| Production deploys | media buyer `dpl_2GR2cXjnbjQRwGKFuRAueUkxUaAh`, client success `dpl_2w7h6EQu5cG2EKSzpHwDPiGNiM72`, creative `dpl_BABsC4uU4FcC9rquJmwWyJQnnLhg` |
| Edge functions (versions at 17:27 UTC) | `onboarding-sync` v2, `billing-sync` v2, `clickup-writeback` v2, `tracking-audit` v2, `hiring-sync` v2, `hiring-api` v2, `comment-watch` v1, `cockpit-ceo-api` v9 (higher than my v8; likely secret-change bumps, **UNCONFIRMED**) |
| Migrations applied today (mine) | `20261009a,b,d,e,f,g,h,i`; NOT applied: `20261009c` (hiring), `20261009j` (billing write-back) |
| Deploy / migrate helpers | `scripts/dev/deploy_tree.py <root> <slug> <extras> --verify-jwt=true|false`, `scripts/dev/apply_migration.py <file>`, `scripts/dev/fn_extras.py <root> <slug>` |
| Management token | `supabase_token` in `D:/MaharaMedia/mahara-cockpits/.env.local` (path only) |
| Ship env | `COCKPIT_MANAGEMENT_TOKEN` (from the token above), `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from `D:/MaharaMedia/worktrees/mahara-cockpits-supabase-completion/apps/<app>/.env.local` |
| Hermes VPS | `wsl -d Ubuntu -- ssh root@187.77.156.166`; pipe Python scripts via stdin (shell variables get mangled) |
| VPS receipts | `/home/hermes/.cockpit-native-state/`: `optional-workers-resume-20261009.json`, `media-native-activation-20261009.json`, `eod-out-apply-20261009.json`, `crontab-before-*-20261009T*.txt`, `guardian-before-convex-removal-.tgz`, `askai-before-comment-watch-20261009/` |
| Ask AI job / live copies | `e4601df61803`; `/docker/hermes-agent-ff5p/data/skills/mahara/cockpit-ask-ai/scripts/askai.py` and `/home/hermes/mahara-cockpits/hermes/cockpit-ask-ai/scripts/askai.py` (sha `e826fcb5dd71cae6`) |
| Ship logs | `D:/secure/cockpit-retirement-prep-20261007/convex-sweep-20261009/` |
| ClickUp test card | Safad `86eyn6c1f` |

## Constraints and conventions to carry forward
- **Do not use the scratchpad or `/tmp` for logs.** Another Claude process cleaned both mid-session; use `D:/secure/.../convex-sweep-20261009/`.
- **Permission allow-rules match only the command prefix.** Start commands with `python D:/.../deploy_tree.py` or `apply_migration.py`; never start with `cd`, a variable or `export`. The classifier blocks secret writes and VPS AI-agent edits (labelled "self-modification").
- **`ship.sh` requirements.**
  - It needs `convex/_generated` copied into media buyer and creative (gitignored), `.vercel/project.json` per app, and clean app folders.
  - Its final readiness check always reports "NOT READY" (old Convex evidence file); judge success by its "Production verified" line.
- **Migration filename clash.** Another session also used the prefixes `20261009a` and `20261009b` (winner identity). The DB history stores names, so there is no collision, but the repo order is shared.
- **Missing is never zero; every external write is behind an `*_APPLY` flag.** Run dry first, verify one record, then expand.
- **The audit session owns `cockpit_audit_log` hygiene and retention (`cockpit-backend-retention`, 01:17 UTC).** Do not run large copies or deletes concurrently; they crashed the DB three times today.
- **Faris (a root Claude session on the VPS) also deploys native releases.** Coordinate before replacing `cockpit-native-current`.

## Open questions / decisions for next session
- **Which Google account should send team calendar invites, and may we add the Vercel server env?** Blocks TODO 7.
- **Hiring GHL writes go-live** (`HIRING_APPLY`): not approved yet; review the intake dry run first.
- **Comment watch ClickUp writes go-live** (`COMMENT_WATCH_APPLY`): needs approval after the dry-run review.
- **Rotate the old Viktor bridge token** on the Convex side, since it stays in git history.
- **Convex deletion:** out of scope; deployments `adorable-seahorse-418`, `impressive-dinosaur-375` and `colorful-wombat-644` stay paused.

## How to resume
- Saved at `D:/MaharaMedia/mahara-cockpits/HANDOFF.md` (untracked change in a stale checkout; it replaced the 2026-10-06 handoff, whose text is preserved in `D:/secure/local-main-backup-20261008/`).
- Start the next session in `D:/MaharaMedia/worktrees/mahara-cockpits-convex-sweep` and paste this file, or point the agent at it. Begin with TODO 2, then 3.
- Durable memory updated this session: none.
