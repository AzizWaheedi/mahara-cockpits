# Handover: forms, ticketing, task alerts (2026-10-26)

This is from the Claude session that ran the forms program between 2026-10-25 and 10-26. It is written for the next agent, and it says what is live, what is half-built and what to do next. Read it in full before acting.

## 1. What the CEO asked (Aziz, 2026-10-25/26)

1. **Kickoff and Brand Blueprint submits.** They must "completely work and trigger everything they should". Each completion posts a Slack notice in **#csm-general** (`C09RZ0GS0V9`, private). ClickUp is updated "the same way it used to".
2. **1-1 call summary form.** The CSM's form (Typeform `fRokTITH`) moves into the cockpit, made easy to fill, using Fathom's API. **Not started** (plan section 2).
3. **The other forms move in after that:**
   - client extensions (`gqBcyK6g`);
   - pause requests (`CTUjv6l3`);
   - the team ticketing form;
   - the client-facing forms: cancellation (`knIe4eF3`), NPS (`fuPgs85S`), CSAT onboarding (`KbcbPA73`) and onboarding (`KFRCXPFx`);
   - the New Client Form (`BTzMwXiw`), which is in the sales cockpit.

   All of them sit on one backend, are very easy to fill, and show wherever they are needed. Plan section 3 has the order.
4. **D17. Forms and routing are editable in the cockpit:** who a form assigns to, the channel, who gets tagged and the fields. The systems manager, the CEO or anyone given the right can change them, with no code change.
5. **D18. The ticketing form is "extremely important".** Everyone on the team can use it. Every type routes correctly, and every ticket is "connected to a task with the SOP template". Ticketing comes straight after Stage 1, alongside Stage 2.
6. **D19. Every seat gets task alerts**, the same as the media buyer's. Today gets an easy "Your tasks" section: at most 5 rows, not busy. Clicking a row opens a focus view of that one task.

The standing rules are in the repo `CLAUDE.md`: Supabase first, row security and grants in the same migration, server gates, an audit row per write, a health ledger, "missing is never zero", and a design plan before any new screen. The memory notes stop-asking and do-it-literally also apply.

## 2. Where everything is

| What | Where |
|---|---|
| Plan (decided; D1 to D19; sections 1 to 6) | `docs/forms/PLAN.md` (on main since `22542426`) |
| Eight read-only maps | `docs/forms/maps/*.md`: kickoff-path, blueprint-path, slack, typeform-inventory (43 forms), make-inventory (202 scenarios), clickup-ticketing, fathom, repo-forms |
| Stage 1 contract | `docs/forms/STAGE1-CONTRACT.md` |
| Ticketing contract, maps and review | `docs/requests/CONTRACT.md`, `docs/requests/maps/*.md` (types-and-sops covers all 31 types with SOP drafts; also alerts-and-tasks, today-and-shell, writers), `docs/requests/REVIEW-R1-raw.txt` |
| Ticketing code | branch **`tickets-1026`** in the worktree below: HEAD `58d6b62f` (review round 1 fixes) on main `3f9f5c41`, with review rounds 2 and 3 and integration rounds 3 and 4 **uncommitted** in the worktree (not merged, **not deployed**; checked 2026-10-27) |
| Worktree | `/Users/abdulazizwaheedi/mahara-cockpits/.claude/worktrees/forms-1025` (on branch tickets-1026, with node_modules) |
| Memory | `~/.claude/projects/-Users-abdulazizwaheedi-mahara-cockpits/memory/forms-program.md` (plus native-release, csm-decks, forms-in-cockpits-queue) |
| Shared session note | mahara-context `shared/sessions/20261025T170000Z-claude-forms-program-stage1.md` |
| Test-run before-state | `~/mahara-cockpits/notes/forms-proof-1026/before.json` |

## 3. Stage 1: live on production since 2026-10-26

**Main commits:**
- `22542426`: Stage 1, squashed from forms-1025 and merged with main.
- `86ee4e84`: the card-details link removed from both Links pages.

**Database:**
- Migration `20261025n_slack_notices` adds:
  - the `cockpit_slack_notices` outbox, never deleted, with triggers on the onboarding mirror and the creative outbox;
  - a sweep, as the second source;
  - a seed: the 30 old kickoffs as `skipped`;
  - `cockpit_slack_notice_settings` (8 rows) and `cockpit_slack_channels` (#csm-general and #media-general, both ok);
  - `cockpit_forms_editors` and the `cockpit_forms_editor_gate`;
  - the cron job `mahara-slack-notices`, every minute.
- Migration `20261025o_blueprint_close_drain`:
  - `close_route` is fixed at card_only;
  - drain RPCs, with `attempts` and `drain_until` on `cockpit_creative_outbox`;
  - `blueprintCall` in `cockpit_blueprint_sources`;
  - the cron job `mahara-creative-drain`, every 2 minutes.

**Edge Functions:**
- `cockpit-notices` v1, with `verify_jwt` off. Its door checks `x-cron-secret` against `NOTICES_CRON_SECRET`. It posts as mahara-club-bot `U0C0MJZNS2Y`.
- `cockpit-creative-api` v25.
- `cockpit-media-api` v39, with the receipt-based Slack read-back.

**Secrets (names only):**
- function secrets: `NOTICES_CRON_SECRET`, `CREATIVE_CRON_SECRET`;
- vault: `cockpit_notices_cron_secret`, `cockpit_creative_cron_secret`, `cockpit_anon_key`.

**Sites:**
- client-success and creative are shipped. The live bundles were checked: new copy present, old copy and the `Uju17Z13` link gone.
- The CSM Settings page has **Notices and routing**: on/off, channel and tags per notice kind, plus "Send a test to me".

**VPS:**
- The guardian folder was rsynced from main and its 406 tests pass. The backup is `~/.cockpit-guardian/backups/guardian-folder-before-forms-*`.
- Native release **`86eebpf1`** has been live since 14:36 UTC (S6, the Blueprint card fields in the creative sync). The cycles at 15:15, 15:30 and 15:45 were ok. 26 of 69 creative client rows carry the fields.

**Verified on production:**
- the doctor: right bot, both channels member, scopes, every tag resolved;
- dry runs of the SMART INTERIOR kickoff and a Smmim close;
- a rehearsal posted to the CEO's DM and found again by its Ref;
- the creative drain dry run: 200, with a wrong secret refused (401).

**How the notices behave:**
- **Kickoff complete:** waits for Make's "KICKOFF HANDOFF" card comment, then tags the creative director seat.
- **Kickoff late:** posts after 20 minutes with no comment, and tags the CSM and the systems manager.
- **Second kickoff:** gets an extra line.
- **Blueprint closed:** tags the CSM, and the #media-general "Brand Blueprint completed" post goes out too.
- **Offer locked:** posts a thread reply.
- The RUNBOOK section "Slack notices (kickoff and Brand Blueprint)" has every recipe: doctor, dry run, rehearse, unknown, requeue.

## 4. The CEO's yes ("ok lets do it", 2026-10-26): what was applied

| Item | State | How it was checked |
|---|---|---|
| A4: `fRokTITH` autosave and partials off | **Done**, published | Typeform API read-back |
| A3: kickoff `tG7dnxBn` `postcallsummary` webhook off, ending changed | **Done.** The new ending: "Make updates the client card within a minute, and the team hears in #csm-general." | API read-back: 23 hidden fields, Make's `WHTP3992232` still on |
| Retire the Client Card Info form `Uju17Z13` (card numbers and CVVs) | **Done.** Not public, webhook off, Make `9018535` and `8069605` stopped, links removed | Read-backs |
| A2: Make `8925654` (kickoff) module [21] | **Partial.** The Brand Blueprint Form Link `1b7a4a74` = `https://cockpit.maharamedia.com/creative/blueprint/{{1.hidden.onboarding_client_id}}`; Service Advertised now uses `first()` on the multi-select | GET read-back. Backup at VPS `~/make-backups/8925654-before-20261026.json` |
| A2, still open | **Not done:** an error handler on [21], and Client Status moving forward only | Needs a "Resume" handler (not "Ignore", which stops the route) and a new getATask before [21]. The plan text said Ignore and "card read in [16]"; both are wrong |
| A6: proof run on the internal test card `86eywg1cq` | **Blocked.** The auto-mode classifier refused to let the agent submit the live kickoff Typeform | The safety check passed: the card has no Client Data row (934 rows checked), so the phase 4 WhatsApp [25] skips. Before-state saved. The CEO submits one test kickoff from `https://maharamedia.typeform.com/to/tG7dnxBn#onboarding_client_id=86eywg1cq&legal_name=%5BINTERNAL%20TEST%5D%20Client%20lifecycle%20automation`, or allows it. Afterwards check Make's run, the mirror pick-up, the #csm-general notice and the trail stop, then restore the card from before.json and cancel the Technical and Creative tasks Make made |
| A1: old Blueprint Typeform `oYZKtogO` and Make `9748311` off | **Waits** until the first native Blueprint close settles `done` | |
| A5: rotate the GitHub token held in plain text in Make `8922994` [25] | **The CEO's** (his login). Create the new one first and revoke the old one last | |
| A7 / S4: launch media buyer in creative director Settings | **The creative director's** one click (evidence: media buyer B `113428468`) | |
| Card data | **The CEO's:** clear the Google Sheet and the Slack DM `D09SHBK5G8H` that hold old card details (the agent does not delete data) | |
| Built-in browser | **Not signed in to the cockpit.** The Blueprint presses on the test card and a look at the Settings screen need the CEO to sign in once | |

## 5. Ticketing, task alerts and Your tasks: built, reviewed and fixed through round 3, NOT deployed

Branch `tickets-1026`: HEAD `58d6b62f` on main `3f9f5c41` (rebased from `86ee4e84`), with review rounds 2 and 3 and integration round 4 uncommitted in the worktree. Main has moved on since (`ef2262a1`, the upsell studio, read 2026-10-27): rebase before the commit (deploy step 0 below). Every confirmed finding of rounds 1 to 3 is fixed; `docs/requests/CONTRACT.md` sections 14 to 20 list each with its proof.

**Build run:** wf_b0bbcac2-199.
- Maps, contract and all five builders (db, writer, mirror-alerts, portal-screens, cockpit-screens) finished.
- Integration was **green**:
  - PGlite: requests 65, task alerts 37;
  - writer 234; cockpit-tasks 35; screens 50 + 23;
  - check-shared ok.
- Review round 1 found about 16 major and 30 minor issues. Verifiers confirmed 109 verdicts and refuted 13.
- **The session limit stopped it** before the remaining verifies, the fixes, the retest and round 2.
- Every finding and verdict is in `docs/requests/REVIEW-R1-raw.txt`.

**What was built** (per `docs/requests/CONTRACT.md`):

*Migrations:*
- `20261026r_requests`: request types, versions, field catalog, templates, `cockpit_requests`, request parts, ClickUp member links; RPCs gated through `cockpit_forms_editor_gate`.
- `20261026s_request_types_seed`: 31 types, 34 templates, 24 fields.
- `20261026t_task_alerts`: task mirror, alerts and per-seat alert rules; cron jobs `mahara-task-mirror` (every 2 minutes) and `mahara-task-mirror-seats` (at :11).

*Functions:*
- `clickup-writeback` gains `request` and `task_action` kinds, under its own switch `CLICKUP_WRITEBACK_APPLY_REQUESTS`. It defaults off and does not turn on the billing writebacks. A canary limit, `CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS=86eywg1cq`, keeps the first writes on the test card.
- A new Edge Function `cockpit-tasks` (delta every 2 minutes, a seats run every hour, doctor).

*Screens:*
- portal `/requests` (file, mine, assigned, queue) and `/requests/settings` (type editor, people in ClickUp);
- a shared, byte-identical set pinned in check-shared: AlertsBell, the Your tasks card, the focus view, RequestForm;
- wired into every cockpit's Today page and sidebar ("Ask a team").

**Round 1's confirmed major findings** (all fixed; details in REVIEW-R1-raw.txt and CONTRACT sections 14 to 20):

*Security:*
- **SEC-1:** the team queue ignores the team-only client limit.
- **SEC-2:** submit accepts any `p_replaces_task_id` of an imported ticket without a route check.

*The ask:*
- **F1:** `cockpit_task_hidden` for editor seats.
- **F2:** client-card exclusion by list id hides real subtasks.
- **F3, F4, F5:** behaviour while the switch is off. Non-editors are refused, so the team is told "Use the ClickUp form". Decide the dry-run UX so the team is never stuck.
- **F6:** the CSM client page's live "Ask a team" path is replaced. Ship client-success last.
- **F7:** a failed comment read makes the whole delta ok=false.

*Routing:*
- **RT-1:** rows claimed while the switch is off are saved as `dry_run` and never re-sent.
- **RT-2:** a failure after the task exists fails the whole part, which can lead to duplicates on retry.

*Contract:*
- **F1/F2:** alert sources and the due_today scope.

*Design:*
- **D1:** status chips have no colour in the portal: missing `--ceo-*` tokens.
- **D2:** a failed request is a dead end.
- **D3:** the empty sentence is false where the mirror is not linked.

**Next steps:**
1. Review rounds 1 to 3 are fixed and integration round 4 is green (CONTRACT section 20). The workflow that built it is finished; nothing is left to resume.
2. Deploy in the order of CONTRACT section 12, steps 0 to 10, each with the read-back that proves it there. In short:
   0. Rebase the branch onto the current `origin/main` (`ef2262a1` on 2026-10-27; `CsmPage.tsx` and `scripts/check-shared.sh` changed on both sides and merge cleanly), run `requests-ownership.test.ts` (3 pass) and the section 9 suites again, commit and push to main. Every later step deploys from that commit.
   1. Deploy `clickup-writeback` first, `verify_jwt` off, both request switches (`CLICKUP_WRITEBACK_APPLY_REQUESTS`, `CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS`) unset. It must be live before migration t.
   2. Deploy `comment-watch`, `verify_jwt` off, before any request reaches ClickUp (the writer's link comments on the test card are never digested).
   3. Migrations r, then s, then t: dry-run each inside `BEGIN; ... ROLLBACK;` with the file's own BEGIN and COMMIT stripped, then apply it with its migration name through Composio `SUPABASE_APPLY_A_MIGRATION`.
   4. Deploy `cockpit-tasks` (new), `verify_jwt` off; the function secret `TASKS_CRON_SECRET` and the same value in the vault as `cockpit_tasks_cron_secret`; then its doctor.
   5. The first seats run (`cockpit_task_mirror_kick('seats')`, or wait for :11): baseline, members, seat links, fields, templates, old form tickets.
   6. The requests doctor (`{"job":"requests_doctor"}`).
   7. `scripts/ship.sh media-buyer` ("People in ClickUp" lives only in its `/requests/settings`).
   8. Link the unmatched seats (2 call centre, 1 sales) in People in ClickUp; each link starts a seats read at once.
   9. `scripts/ship.sh creative`, `video-editor`, `sales`, then `client-success` **last**.
   10. Release the guardian on the VPS (its rows need steps 1 to 6).
3. The CEO's C3 batch, on his yes (CONTRACT section 12, after step 10):
   - `CLICKUP_WRITEBACK_APPLY_REQUESTS=true` with `CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS=86eywg1cq`; Set Request Type on for the five types; five `[TEST]` requests on the test card (`general_tech`, `general_marketing`, `general_csm`, `low_show_rate`, `new_script`): five tasks with owners, five link comments on the card, five channel posts, each 2-minute check read; a tick, a comment and Mark done from one task's focus view (three `task_action` rows `delivered`); then the five tasks set to cancelled, never deleted.
   - Read `GET list/901816559981` once for a done status (Mark done on a card's subtask).
   - Then clear `CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS`. Read back `clickup-writeback:requests` mode `apply` and no request left held (the held ones, routing requests whose old ticket is not on the test card included, go on the next runs by themselves).
   - The systems manager checks the draft SOP steps and re-saves the drifted templates; the media buyer of record is named on the eight media buyer types, both in Requests settings.
3. Plan 3.3 corrections found by the types map:
   - row 8's Media template is `t-86exj3g1a`, not `t-86exj3h8f`;
   - row 21's template sends the retired card form, so it is withheld and safe SOP steps were drafted instead.

## 6. Not started

- **Stage 2: 1-1 notes from Fathom** (plan section 2). Facts:
  - The VPS `FATHOM_API_KEY` is the CEO's admin key with all-teams access, so no new key is needed.
  - `hermes/csm-calls` drops 19 of the CSM's 27 recent client calls (impromptu rooms) and never asks for action items.
  - The best match is the meeting_url equal to the GHL booking's join_url, then a recording within ±60 minutes of the booking.
  - Make `9209179` (route 0: GPT to-dos, grade to #client-call-feedback `C09SVG6FHGU`, Happiness and Last POC; route 1: recap approval, then Make `9523861` sends by WHAPI) must keep parity until the cut-over.
  - The bot is **not** in #client-call-feedback, so the CEO invites it (item B0).
- **Stage 3:** the rest, per plan section 3. Extension, pause and termination have almost no real responses. NPS and CSAT have 1 each, ever.

## 7. Access and tools that work (names only, never print a secret)

- **Supabase** (project `bldgtotkfmhoxmlzowdx`):
  - SELECT: `~/.cache/mahara-ship/pybin/python ~/.cache/mahara-ship/sq.py "<select>"`. It is a read-only role, so it cannot decrypt the vault or run some service functions.
  - Writes: Composio `SUPABASE_BETA_RUN_SQL_QUERY` with `read_only:false`, or `SUPABASE_APPLY_A_MIGRATION` `{ref,name,query}`. Run from `~` with `< /dev/null`.
  - Function deploys: `python3 scripts/dev/deploy_composio.py <fn> --rev <sha> --extra ${=X} --verify-jwt on|off [--dry]`, with `X=$(python3 scripts/dev/fn_extras.py . <fn> | tail -1)`.
  - Secrets: `SUPABASE_CREATE_BULK_SECRETS`.
  - Calling a cron-protected function: `net.http_post` from SQL with `x-cron-secret` read from `vault.decrypted_secrets`, then read `net._http_response`.
- **Ship:** `COCKPIT_AUTH_USE_COMPOSIO=1 VITE_SUPABASE_URL=https://bldgtotkfmhoxmlzowdx.supabase.co VITE_SUPABASE_ANON_KEY=$(cat ~/.cache/mahara-ship/anon.key) scripts/ship.sh <app>`, with `~/.cache/mahara-ship/pybin` and `~/.bun/bin` on PATH. Ship from a tree whose commit is on origin/main. `hermes/media-native/test/client.test.ts` can time out under load: re-run it alone.
- **Make API (eu2, team 2108984):** GET, and stop/PATCH on the CEO's yes. Run `ssh 187.77.156.166 'set -a; . /opt/data/bibi/api-keys.env; set +a; python3 -' < script.py` with `MAKE_API_KEY` and a browser User-Agent (Cloudflare 1010 otherwise). Composio's Make connection is expired.
- **Typeform:** the MCP (account `01JSVJ80K4HRMCR67NAFP1DPZ2`) does validate_patch, patch_form and publish_form. It cannot close forms (403). Webhooks and closing go through the API with `TYPEFORM_API_TOKEN` from the same VPS env file.
- **Other services:**
  - ClickUp: MCP `mcp__d91d47f1…`;
  - Slack: MCP `mcp__00991890…` (read tools);
  - Fathom: MCP `mcp__bfb0031e…`, as aziz@maharamedia.com;
  - Google Drive: Composio (aziz@maharamedia.com; the export tool reads Sheets).
- **VPS:** `ssh 187.77.156.166` as hermes.
  - Too many SSH connections get the Mac blocked for a while, so batch commands and use ControlMaster.
  - Never `git pull` the VPS checkout. Never touch `/home/aziz`.
  - Native releases follow the memory note native-release. The live release is `86eebpf1`.

## 8. Traps hit in this session

- **Disk:** the Mac hovers between 1 and 4 GB free. A new worktree's full install fails (ENOSPC), so reuse the forms-1025 worktree. macOS clears `/private/tmp` scratch folders, so keep notes in `~/mahara-cockpits/notes/`.
- **zsh:**
  - `$C:refs` is read as a filename modifier; write `"${C}:refs/heads/main"`.
  - A glob that matches nothing aborts the whole command line.
- **Network:** drops (ENOTFOUND) kill agents. Wrap builders in retry loops, as the edited tickets script does.
- **Review-round fixers** once reverted an intended edit outside the contract (the card link). Diff after each fix round.
- **Never submit a live Typeform.** Kickoff and onboarding fire Make, which messages clients. The classifier also blocks it.
- **Shared checkout:** never move its HEAD. Push from a worktree with `git push origin <sha>:refs/heads/main` after checking that the merge-base equals origin/main.
