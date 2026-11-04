# Mahara Cockpits

This repository contains the Mahara internal role cockpits. Treat `main` as the
clean, reviewable production history. Do implementation work on a focused side
branch in an isolated worktree.

## Start every substantive task

1. Sync and read the shared Mahara context at
   `D:\MaharaMedia\mahara-context\AGENTS.md`, then read
   `context/projects/mahara-cockpits.md` there.
2. Read this repository's `HANDOFF.md` and the task-relevant parts of
   `HOSTING.md`, `SOURCES.md`, `RUNBOOK.md`, release notes and app-level files.
3. Confirm the repository before changing anything:
   - the Git root belongs to `AzizWaheedi/mahara-cockpits`;
   - the current branch and worktree match the task;
   - existing uncommitted changes belong to this task.
4. Fetch `origin` and start new work from the latest `origin/main`. Never reset,
   force-push, auto-stash or overwrite another task's work to update.
5. Follow the shared context repository's ClickUp tracking and handoff workflow.

## Manage worktrees for the user

The user should not need to choose branches or folders for each task. Decide the
worktree structure from the requested outcome and state the choice briefly.

- Use one worktree and one `codex/<short-task-name>` branch for one independently
  reviewable outcome.
- Keep backend logic, frontend changes, design, tests and documentation together
  when they are all required for the same feature.
- Use separate worktrees for unrelated outcomes that could be reviewed, merged,
  reverted or delayed independently.
- Reuse the current worktree for follow-up work on the same unfinished outcome.
- Use a separate worktree for an urgent fix while another feature remains open.
- When one task depends on another, finish and merge the first task, update
  `main`, then create the dependent worktree from the updated `origin/main`.
- Do not create nested worktrees when the current task already runs in the
  correct clean task worktree.
- Never create a cockpit branch or worktree from `mahara-context`,
  `mahara-google-service-account` or another repository.
- Before removing any worktree, verify its exact repository, branch, commits and
  dirty files. Preserve unique work and remove it only when the user requested
  cleanup or the branch is confirmed merged.

Examples:

- `Add client-risk detection and design its warning card` is one worktree.
- `Fix the calendar timezone` and `redesign the navigation` are separate
  worktrees.
- A visual adjustment to an unfinished feature stays in that feature's
  worktree.

## Plan, implement and deliver

- For new work, give a short plan and wait for approval unless the user already
  said to build, edit, fix or go.
- Preserve existing behavior and human-entered data unless the approved task
  explicitly changes them.
- Read the actual implementation and current live evidence before diagnosing or
  changing cross-system behavior.
- Run only the test files for the change (see "Tests: run only the files for
  your change" below), then review `git status`, `git diff` and the exact
  staged files.
- Commit only the intended task files. Never commit credentials, `.env` files,
  private raw chats, sessions or unsupported claims.
- Push the side branch and prepare a PR when completing an approved
  implementation. Report the branch, checks and remaining decisions.
- Never merge into `main`, deploy, publish externally or delete an unfinished
  worktree without explicit user approval.
- After a verified merge, update local `main`, confirm the remote commit, then
  remove the clean finished worktree and local task branch.
- Record meaningful verified changes in the shared Mahara context during the
  same session.

## Tests: run only the files for your change (26 October 2026)

Several agent sessions share one laptop. On 26 October 2026, `bun test scripts`
in `apps/media-buyer-cockpit` ran 2,863 tests from 194 files in one process for
16.5 minutes and held about 11 GB of memory. The laptop ran out of memory and
crashed.

- Run only the test files that cover the files you changed. Name each file in
  the command, for example `bun test scripts/launch-screen.test.tsx`.
- To find those files, search the test files for the changed file's name.
- Never run a whole app, folder or repository suite. That means no bare
  `bun test`, no folder such as `bun test scripts`, `bun test src` or
  `bun test supabase/functions`, no `bun run test:unit` in the media buyer
  cockpit and no `bun run test` in the sales cockpit. A word after `bun test`
  matches every test file whose path contains it, so one word can start
  hundreds of files.
- `scripts/ship.sh` already runs a fixed list of named test files. Run it as
  usual.
- Run a full suite only when Muhammed or Aziz asks for one in the session. Run
  it alone, with the other sessions idle.

## Assistant guides: update them with every screen change (4 November 2026)

The cockpit chat assistants (Signal in the media buyer cockpit, Anchor in
client success, Lens in creative director) answer "how do I" questions from
one guide per cockpit: `apps/media-buyer-cockpit/assistant-guide.md`,
`apps/client-success-cockpit/assistant-guide.md` and
`apps/creative-director-cockpit/assistant-guide.md`. They read the guide from
`main` every 10 minutes, so a stale guide sends the team to the wrong place.

This rule applies to every commit by any person or agent, including Aziz's
and Muhammed's sessions and the unattended fixer.

- When you add, rename, move or remove a menu item, page, tab or button in one
  of these three cockpits, update that cockpit's guide in the same commit.
- Put interface text in double quotes exactly as it appears on screen.
  Describe only what the code does. Plain English, no em dashes.
- Run `python scripts/check-assistant-guides.py` before you push.
  `scripts/ship.sh` runs it too. It stops the release when a guide misses a
  menu item or page address, or quotes button text that no longer exists.
- When the check prints a NOTE that screen files changed since the guide was
  last updated, read those changes. Update the guide if anything a person sees
  has changed.

## Repository boundaries

- This monorepo contains the media buyer, client success, creative director and
  CEO cockpit work. A single task may touch several of these folders when the
  change is one shared outcome.
- The client portal, dialer and shared context are separate projects. Do not
  place their code or branches in this repository.
- Production deployment is a separate action from commit, push and PR merge.

## Decisions and plans

- Before you decide a design, stack, data rule or scope, search `context/DECISIONS.md` in the shared `mahara-context` repository (local: `D:/MaharaMedia/mahara-context`). Log each new durable decision there in the same session.
- Every build plan includes two fields: "Not in scope" and "How we know it works".
