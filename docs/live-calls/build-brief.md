# Build brief: live calls, Milestone 1 (stage 1, parallel lanes)

The CEO said: "lets start building this all out i want it to look really nice be user friendly and stress tested to not break on us at all".

## Sources of truth, in order (read them)
1. `updates.md` in this folder. It wins over everything.
2. `final_consistency.md` (in this folder): the one glossary of names, the waits, the settled conflicts (C1 to C43) and the build order. Use these names exactly.
3. `final_spec_foundation.md`, `final_spec_p1.md`, `final_spec_p2.md` and `final_spec_p3.md`: the specs.
4. `r1.md`: the code integration map. Line numbers are from an older main, so re-find them in your worktree.
5. `contract.md`: the shared action and payload contract between lanes.

## Standing rules (repo CLAUDE.md)
- **Supabase project.** Creative Triage `bldgtotkfmhoxmlzowdx`, tables prefixed `cockpit_sales_`.
- **Every new table** comes with RLS on and its grant in the same migration. Copy the pattern of `supabase/migrations/20261002e_sales_client_forms.sql`.
- **Every action** is gated on the server (seat or role) and every write leaves an audit row (`cockpit_audit_log`).
- **Workers** follow the radar discipline:
  - keys read by name;
  - a `doctor`;
  - tests;
  - cron under `flock`;
  - a runbook row;
  - a plain sentence in the UI when something is missing ("missing is never zero").
- **Secrets.** Never print, log or commit one. They stay in `/opt/data/bibi/api-keys.env` on the VPS.
- **No messages.** Never send a message to any real lead or person. Never write to HighLevel, Zoom, Google or Slack in this stage.
- **Copy.** Plain, active, sentence case, no em dashes, roles not names. Errors say what to do next.
- **Another cloud session builds the sales cockpit in parallel.** Touch only the files your lane owns (below). Shared files (`index.ts`, `lib.ts`, `dialer.ts`, `App.tsx`, `DialerPage.tsx`, `LeadPage.tsx`, `FollowupsPage.tsx`, `followups.py` only for the desk lane, `ship.sh`) are touched only by the lanes named.

## Decisions already made (do not reopen)
- Rooms are made on the VPS by a room worker:
  - a cron line every minute with `flock -n`, running a loop of about 57 s, polling every second (systemd user services do not persist; linger is off);
  - keys stay on the VPS.
- Providers:
  - Meet through the Calendar API on the CEO's Google connection (GOOGLE_* in `/opt/data/bibi/api-keys.env`), on a separate calendar named "Sales rooms" that the worker creates if missing;
  - Zoom through the S2S app, with the host being the rep's own Zoom user on Mahara's account (closer licensed, setter Basic and pending).
- Meet joins are the rep's press (no Meet API scope). Zoom joins come from the webhook, with manual buttons after 30 s.
- Live calls are booked and marked shown on join only behind `rooms.count_on_join` (off). Test contacts book only on `rooms.test_calendar_id`.
- Everything ships switched off (`rooms.enabled=false`, `test_only=true`).

## Quality bar
- Unit tests for every pure function and every state transition, including the refusals.
- **Stress:**
  - concurrency (two or fifty claims at once);
  - retries (the same `request_id`);
  - duplicate and late webhooks;
  - a crash in the middle of a step;
  - provider failure and timeouts.
- Every external call has a timeout, a bounded retry and a recorded failure.
- Your lane's tests must pass before you finish: `bun test <path>` for TypeScript, `python3 -m unittest` for the desk.
- Commit to your lane's branch in your worktree with clear messages. End each message with "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>". Do not push.
