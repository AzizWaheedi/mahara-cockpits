---
name: cockpit-feedback-scan
description: Reads Aziz's changes-and-bugs queue (cockpit_feedback in Creative Triage) through Composio SQL, fixes bugs, builds dispatched changes in a fresh worktree, ships, and writes each state change back with an audit row.
---

<!--
Reviewed copy of ~/.claude/scheduled-tasks/cockpit-feedback-scan/SKILL.md
(scripts/ops/cockpit-feedback-scan.SKILL.md in mahara-cockpits). Copy it over
the scheduled task's prompt, then turn the task on (cron 0 9,13,17 * * *).
2026-10-11: moved off Convex, which is retired: the queue is read and written
with Composio SQL, every state change leaves a cockpit_audit_log row
(feedback.scan), builds happen in a fresh worktree from origin/main, and the
Convex typecheck is gone.
-->

You are Claude Code working for Aziz (CEO, Mahara Media). This is the scheduled scan of his changes-and-bugs queue for the CEO cockpit (apps/media-buyer-cockpit, route /ceo, production https://cockpit.maharamedia.com; the queue card is "Changes and bugs" on the Machine tab). His words when he asked for it (2026-09-21): "a feedback part … changes or bugs … a button to deploy them whenever I want, but it also scans for anything I put in the log."

Work autonomously; Aziz is not watching and has said "stop asking": decide with sensible defaults and say what you chose on the row. Follow the repo CLAUDE.md (solid backend, brand-aligned design, notes beside numbers, plain copy) and the memory files under /Users/abdulazizwaheedi/.claude/projects/-Users-abdulazizwaheedi-mahara-cockpits/memory/. Take his words literally: "the end" means last, "every" means every, and never ship an alternative instead of what he wrote.

## The queue

The table is public.cockpit_feedback on the Creative Triage Supabase project (bldgtotkfmhoxmlzowdx): id, kind ('change' | 'bug'), text, status ('queued' | 'dispatched' | 'in_progress' | 'done' | 'dismissed'), batch, note, created_by, created_at, dispatched_at, done_at, updated_at. Aziz adds rows from the card; his Deploy button moves every queued row to 'dispatched' with a batch id.

Convex is retired. Never run `npx convex`, never read or write the queue through Convex, and never typecheck the convex folder.

## How to read and write it

Every SQL call goes through Aziz's Composio Supabase connection. The Mac's management token is dead; do not look for another key. Write the request body to a file in your session scratchpad with Python (so quoting is exact), pass it with `-d @file`, and always close stdin, or the CLI waits forever:

```
python3 -c 'import json,sys; json.dump({"ref":"bldgtotkfmhoxmlzowdx","query":sys.argv[1]}, open(sys.argv[2],"w"))' "<SQL>" "$SCRATCH/q.json"
composio execute SUPABASE_BETA_RUN_SQL_QUERY -d @"$SCRATCH/q.json" < /dev/null
```

The rows are in `data.result`. A large answer comes back as `"storedInFile": true` with an `outputFilePath`: read that JSON file, then delete it.

Read the open rows:

```sql
select id, kind, text, status, batch, note, created_at, dispatched_at
from public.cockpit_feedback
where status in ('queued','dispatched','in_progress')
order by created_at
```

Every state change is ONE statement that changes the row and writes its audit row together (replace ID, NEW_STATUS and NOTE; double any single quote inside NOTE):

```sql
with old as (select id, status, note from public.cockpit_feedback where id = ID for update),
changed as (
  update public.cockpit_feedback f
  set status = 'NEW_STATUS', note = 'NOTE', updated_at = now(),
      done_at = case when 'NEW_STATUS' = 'done' then now() else f.done_at end
  from old where f.id = old.id
  returning f.id, f.status, f.note)
insert into public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, "before", "after")
select 'feedback.scan', 'cockpit_feedback', changed.id::text, 'claude:cockpit-feedback-scan', 'ceo', 'composio-sql',
       jsonb_build_object('status', old.status, 'note', old.note), jsonb_build_object('status', changed.status, 'note', changed.note)
from changed join old using (id)
```

Read the row back after each change. Never delete a row and never change kind, text or created_by: those are Aziz's.

## Rules

1. Bugs (kind 'bug') that are queued or dispatched: fix them now. Changes (kind 'change') that are dispatched: build them now. Changes that are only queued: do NOT build them; at most write a short note on the row saying what you would do and how long it would take, and leave the status as it is.
2. Mark a row in_progress (with a note saying what you are doing) before starting it. At the end of the run no row is ever left in_progress: it is done, or back to its previous status with a note saying what blocked it or what question needs Aziz.
3. Build in a fresh worktree, never in the shared checkout /Users/abdulazizwaheedi/mahara-cockpits (several sessions commit there at once; never reset, rebase or check out anything in it):
   - `git -C /Users/abdulazizwaheedi/mahara-cockpits fetch origin main`
   - `git -C /Users/abdulazizwaheedi/mahara-cockpits worktree add -b feedback-scan-$(date +%Y%m%d-%H%M) /Users/abdulazizwaheedi/mahara-worktrees/feedback-scan-$(date +%Y%m%d-%H%M) origin/main` (not under /private/tmp: macOS deletes files there after about three days)
   - `bun install` where the change needs it (disk is short: check `df -h /` first and remove the worktree when done).
4. Check before shipping: `npx tsc -b` in apps/media-buyer-cockpit (`bun run typecheck` skips src), the relevant `bun test scripts/<suite>.test.ts`, and for a screen change the CEO harness (`bun run harness`) at 375, 768, 1024 and 1440 wide with no horizontal scroll. New screens follow the frontend-design skill and the CEO kit (SectionCard, StatTile, StatusChip, EmptyState, format.ts, Geist, --mahara-teal).
5. Ship: commit in the worktree, bring it up to date with `git pull --rebase origin main` inside the worktree, `git push origin HEAD:main`, then `bash scripts/ship.sh media-buyer` from the worktree. If ship.sh names production functions or files that main does not have, stop: another agent's work is live; leave the row with a note, never force it.
6. Verify on production: the live bundle at https://cockpit.maharamedia.com contains the change, and any number it touches is checked against a second source with a note on screen saying where it comes from. Then mark the row done with one sentence and the commit hash.
7. Supabase Edge Functions deploy through Composio `SUPABASE_DEPLOY_FUNCTION` (bundled to one file, see the memory note supabase-via-composio). Migrations are applied only through Composio SQL, each new table with row security and its grant in the same file, and every statement safe to run twice. Code in hermes/ceo-refresh runs on the VPS only in the systems manager's next native release: commit it, then leave the row with a note saying it waits on that release.
   - Other agents, the systems manager among them, deploy to the same project. Before deploying a function, read the live one's version and update time; if it was updated after main's last commit to that function, live code is not on main: stop, leave the row with a note, and never overwrite it. Before a migration replaces a database function, compare the live `pg_get_functiondef` with its newest definition on main and stop the same way when they differ.
   - The B2B project (flwboeijllbtrufxkhts) is read-only: never write to it. Never set a secret, never change the native worker on the VPS, and never write production data except through the change itself (its migration or the cockpit's own gated, audited doors).
8. Never handle credentials: if an item needs a key or a token, write on the row exactly which variable to set and where (a cockpit paste box where one exists), and stop that item. Never send a message to anyone.
9. Commit messages are plain and active and end with the attribution lines your session's instructions give. Update apps/media-buyer-cockpit/src/pages/ceo/SOURCES.md when a number's definition changes.
10. Remove your worktree at the end (`git -C /Users/abdulazizwaheedi/mahara-cockpits worktree remove <dir>`), and record the run in the mahara-context clone if one is in the session scratchpad (otherwise skip).
11. At the end, print a short report: each row touched, its new status, and what shipped. If nothing was open, say so in one line and stop.
