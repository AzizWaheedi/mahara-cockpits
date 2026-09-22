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
- Run the smallest meaningful tests for the change, then review `git status`,
  `git diff` and the exact staged files.
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

## Repository boundaries

- This monorepo contains the media buyer, client success, creative director and
  CEO cockpit work. A single task may touch several of these folders when the
  change is one shared outcome.
- The client portal, dialer and shared context are separate projects. Do not
  place their code or branches in this repository.
- Production deployment is a separate action from commit, push and PR merge.
