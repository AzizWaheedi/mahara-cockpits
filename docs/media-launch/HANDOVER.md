# Handover: the media buyer Launch section

From the Claude session that mapped and specified it (2026-10-24), to the agent that builds it.

## The ask (Aziz, CEO, 2026-10-24, verbatim)

> I need it to be easier for media buyers to launch campaigns for clients who don't have a card on ClickUp and be able to see all active clients and can choose any active client on ClickUp and launch from their ad account. What I mean is, I need to have some sort of section where it's easier for him to launch new clients and clients who have been paused. For example, Arcone and Liwan: there's no easy way for him to relaunch those clients if their cards have been removed for some reason, because they have no active campaigns or something. They should be able to see clients in onboarding, but in a really clean way, in the cockpit, with a really designed pass that makes it extremely solid. They can just relaunch and launch campaigns from any client they pick, and it shows in the ad section, not just the clients who have ads running, but even the guys who are paused and stuff. They can go, and as soon as they're live, they go to the main ad section where the ads management is.

"Arcone" is ARCWANI.

## Where things stand

| Done | Where |
|---|---|
| Three read-only maps: the code, every client's real state, launch mechanics | `docs/media-launch/maps/` |
| The build spec and design plan, decided | `docs/media-launch/SPEC.md` (start with section 0) |
| Backend, screen, tests, harness, ship | **Not started.** You build all of it. |

Why ARCWANI and Liwan vanished (SPEC 0 and 0.1): their cards were not removed. The Ads list keeps only campaigns that spent at least $0.50 in the last 7 days (`hermes/cockpit-sync/calculator.ts:2614`). Both accounts owe Meta, so nothing spends and they drop off. Outsiders have campaigns on those accounts, so the desk refuses a relaunch there and offers the clean-account route (SPEC 2.6).

## Setup

1. The repository is `/Users/abdulazizwaheedi/mahara-cockpits` (GitHub `AzizWaheedi/mahara-cockpits`). Read its `CLAUDE.md`.
2. The spec and maps are on branch `origin/launch-desk-1024`. Make your **own** worktree:
   ```bash
   git -C /Users/abdulazizwaheedi/mahara-cockpits fetch origin
   git -C /Users/abdulazizwaheedi/mahara-cockpits worktree add .claude/worktrees/launch-desk-b -b launch-desk-b origin/launch-desk-1024
   cd /Users/abdulazizwaheedi/mahara-cockpits/.claude/worktrees/launch-desk-b/apps/media-buyer-cockpit && ~/.bun/bin/bun install --frozen-lockfile
   ```
3. **Do not touch:**
   - `.claude/worktrees/deck-answers-1020`: another session records team videos from its dev servers on :5183 and :5185.
   - `.claude/worktrees/bp-embed-1024`: the Brand Blueprint going inside the creative director cockpit.
   - The shared checkout's HEAD: never reset, rebase or switch it, and push from your worktree.
   - `apps/creative-director-cockpit`, `apps/client-success-cockpit`, `src/present`, `src/forms`.

   If you need a dev server, use port 5193 or above with `--strictPort`.
4. Read these memory notes in `~/.claude/projects/-Users-abdulazizwaheedi-mahara-cockpits/memory/`:
   - `MEMORY.md` (the index)
   - `media-launch-desk.md`
   - `meta-ads-writes.md`
   - `meta-budget-currency.md`
   - `media-buyer-change-sync.md`
   - `ads-account-page.md`
   - `deploys-keep-others-work.md`
   - `shared-checkout-git.md`
   - `supabase-via-composio.md`
   - `vercel-deploys.md`

## Build order (SPEC 6.1)

1. The migration `supabase/migrations/20261024b_media_launch_desk.sql` and its PGlite test. Follow `apps/media-buyer-cockpit/scripts/csm-form-sends-supabase.test.ts` and apply it twice.
2. The `cockpit-media-api` launch operations, with `LAUNCH_APPLY` unset (plan only). Add the deno tests with a fake for every provider.
3. `launchClient.ts` and `launchModel.ts`, with tests.
4. The Launch page (`/launch`), the client page (`/launch?client=<clickup id>`) and the launch line. Add a harness page with every fixture state in SPEC 5.2, and shoot it.
5. The Ads changes: the Just launched group, the Nothing running tab, the account page action, the nav and the Today link.
6. The `clickup-writeback` fallback.
7. Verify as SPEC 5.3 says: from different angles (correctness, Meta safety, client truth, design), then fix, then score the screens until each is at least 4/5.

## Hard rules

- **No writes to Meta, ClickUp or GoHighLevel** while building or testing. Use reads only, and fakes in tests.
- **`LAUNCH_APPLY` stays unset** until Aziz says to switch it on. `?rehearse=1` forces plan-only in the browser.
- **Every Meta write** goes through `cockpit-media-api`'s existing gated path:
  - the scope re-check, an intent row and a read-back;
  - the `cockpit_finish_media_action` audit row and the health ledger;
  - created PAUSED first;
  - budgets through `currency.ts`.
- **Unsettled, disabled, closed or no-access accounts** are refused before any intent row, with a plain sentence that names who fixes it.
- **Database:** row security and grants go in the same migration. Functions are `SECURITY DEFINER` with `search_path=''` and gated on the media buyer seat (or admin and CEO).
- **Design:**
  - `~/.cache/mahara-ship/mc/skills/frontend-design/SKILL.md` and the Hallmark slop test (`~/.cache/mahara-ship/skills/hallmark`);
  - the cockpit's own system: Geist, `--mahara-teal`, and the kit's SectionCard, StatTile, StatusChip, EmptyState and `format.ts`;
  - plain, active copy, where missing is never zero.
- **Never print a token.** Client money stays out of reports.

## Ship (SPEC 6.3)

- **Supabase**, through Composio:
  - reads with `~/.cache/mahara-ship/pybin/python ~/.cache/mahara-ship/sq.py "<select>"`;
  - migrations with `composio execute SUPABASE_APPLY_A_MIGRATION -d @file.json < /dev/null` and `{ref: "bldgtotkfmhoxmlzowdx", name, query}`, with BEGIN and COMMIT stripped;
  - then read back the grants and row security.
- **Edge Functions.** Before deploying, check that the live version matches main for that function. On 2026-10-23, `cockpit-media-api` v23 equalled main at `f0f2dc6c`. Then run:
  ```bash
  python3 scripts/dev/deploy_composio.py <fn> --rev <main sha> --extra ${=X} --verify-jwt on
  ```
  with `X` from `python3 scripts/dev/fn_extras.py . <fn> | tail -1`. Run it with `--dry` first.
- **App.** Squash the work into one commit on top of origin/main, push it to main, then ship from that commit:
  ```bash
  COCKPIT_AUTH_USE_COMPOSIO=1 VITE_SUPABASE_URL=https://bldgtotkfmhoxmlzowdx.supabase.co VITE_SUPABASE_ANON_KEY=$(cat ~/.cache/mahara-ship/anon.key) scripts/ship.sh media-buyer
  ```
  Put `~/.cache/mahara-ship/pybin` and `~/.bun/bin` on PATH.
  - The media buyer ship also carries main's other unshipped media buyer work. List it from `git log` before you ship. It includes `frame-ancestors 'self'` in `apps/media-buyer-cockpit/vercel.json` from the kickoff release `396aee7d`.
  - Then verify on production in rehearsal only.
- **Record it:**
  - a session note in mahara-context `shared/sessions/` (repo at `~/.cache/mahara-ship/mc`; run `scripts/build-context-index.py`, then push);
  - the SPEC 6.4 defaults in `context/DECISIONS.md`;
  - an update to `media-launch-desk.md` in memory.

## For the other session

When it ships, put the harness URL and the ship commit in the session note. The other session makes the media buyer how-to video from that harness.

## Open decisions for Aziz (SPEC 6.4)

- Switch `LAUNCH_APPLY` on. The first real launch is SAFAD's switch-on.
- The clean-account route for ARCWANI.
- Launch as its own place in the rail (`/launch`), not a tab inside Ads.
- Ready to launch needs Blueprint part 1 or an open launch task.
