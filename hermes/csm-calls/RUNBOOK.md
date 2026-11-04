# CSM calls worker runbook

**Owner:** Hermes. **Decision:** no client messages, bookings, ClickUp writes or provider writes. The worker reads GoHighLevel, Fathom, Typeform, Meta and the cockpit's source tables; it publishes only to the private CSM call store. It never edits `hermes/cockpit-sync/worker.ts`, never resumes Convex, and never turns on `CLICKUP_WRITEBACK_APPLY`.

## Where it runs

- Release: `/home/hermes/csm-calls-current` → `/home/hermes/.csm-calls-releases-hermes/<sha8>`, a folder hermes owns (the older `~/.csm-calls-releases` is `root:root 755` and refuses hermes; the releases before Stage 2a stay there). The rollback release sits beside it as `rollback-<sha8>` (Release / rollback, below). Never run from `~/mahara-cockpits`.
- Bun is the tool packaged with `/home/hermes/cockpit-native-current/tools/bun`. Runtime env is `/home/hermes/.cockpit-native-state/runtime-<native-release-name>.json`, with optional `/opt/data/bibi/api-keys.env`. Values must not enter output or Git.
- Cron, under hermes on a UTC VPS clock:
  ```cron
  */15 * * * * flock -n $HOME/.csm-calls/run.lock $HOME/csm-calls-current/hermes/csm-calls/run.sh run --apply --report $HOME/.csm-calls/last-run.json >> $HOME/.csm-calls/cron.log 2>&1
  0 3 * * * flock -n $HOME/.csm-calls/reconcile.lock $HOME/csm-calls-current/hermes/csm-calls/run.sh reconcile --apply --report $HOME/.csm-calls/last-reconcile.json >> $HOME/.csm-calls/reconcile.log 2>&1
  ```
  The release’s `run.sh` resolves the current native release each tick and names its private runtime file. No copied keys or static env path.
- Doctor: `$HOME/csm-calls-current/hermes/csm-calls/run.sh doctor` from the release in use (a staged folder is checked as in Release / rollback, never through its `run.sh`). It checks key names, reads one item per provider, and reads the intake's columns and the 1-1 notes registry with its switch-over time (`intake store`, `forms registry`, which reads `provider_since` since Stage 2b), and asks the kickoff and Blueprint record sweep with `p_apply false`, which writes nothing (`forms record`). It never prints values.
- Dry run: same command with `run --report ~/.csm-calls/dry.json` (without `--apply`). `--apply` only after the doctor and a dry run pass. The doctor passes when it prints `ok` true. A dry run passes when its report shows `ok` true for `csm-ghl-calls`, `csm-checkin-form`, `csm-forms-history` and `csm-fathom` (the sources Stage 2a changes; a later release adds any other source it changes), and every other entry in its `failures` is a failure recorded before the release, with the same cause (Release / rollback). A source that was already failing makes every run exit 1 and print `csm-calls run FAILED: 1 source(s) failed`, dry runs included: since 2026-10-27 one refused Meta ad account fails the whole `csm-meta-activities` source. That exit is expected, and the report is written before it. Reports stay outside Git.

## Sources

| Health key | Reads | Named key | Rerun | History |
|---|---|---|---|---|
| `csm-ghl-calls` | The client GHL location's appointment calendars, plus each appointment's contact Client ID. A full window marks absent appointments `gone` only after every calendar succeeds. Each booking also stores the room its link opens (`room`: a Zoom meeting id or a Meet code), which the Fathom source matches recordings by. | `GHL_CLIENT_PIT` | `run --apply --only ghl` | `backfill --source ghl --apply` from 1 Jun 2026 in windows |
| `csm-checkin-form` | Typeform fRokTITH, every response, every answer. The client is the hidden `task_id` the client page's form link carries (`hidden_field`), else the typed Client ID (`typed_task_id`); the typed answer is always kept, and the note counts links that differ from the typed id. A response with neither on the board goes to the unmatched queue. A form whose Fathom link is a stored recording of the same client goes under that recording (its booking when the booking is on the card and not gone, else the recording's row), and its own held call is retired; else under the client's check-in booking within 48 hours; else it is a held call of its own. A run reads the forms before the Fathom source and links them after it, so a form whose link places an impromptu recording goes under it on that same run. | `TYPEFORM_TOKEN` | `run --apply --only typeform` | Full responses on rerun |
| `csm-forms-history` | The onboarding, current and retired kickoff, and Blueprint Typeforms, all answers even if the question ref was deleted. | `TYPEFORM_TOKEN` | same | Full responses on rerun |
| `csm-forms-record` | Since Stage 2b (`docs/forms/STAGE2B-CONTRACT.md` 4.8): one call of `cockpit_form_record_sweep` after the EODs. Every stored kickoff (`tG7dnxBn`) gets its `cockpit_form_responses` row (a pointer to the stored answers, never the client's email or phone) and every Brand Blueprint press with no response gets one; each effect the cockpit owns is recorded from its Stage 1 row's outcome (`delivered` when Stage 1 sent it, `skipped` with Stage 1's reason, nothing while Stage 1 is in flight; a `failed` notice waits until 48 hours after the response). Records only: no delivery row, no Slack post, no ClickUp write. The note reads `Forms tables: 8 kickoffs recorded (0 new this read), 0 new Brand Blueprint presses, 0 Stage 1 deliveries linked this read, 0 waiting for Stage 1.`: the first figure is every stored kickoff with its row (a kickoff the door recorded counts once the read has stored it, and one past the 200 a call does not count until its call), the presses and deliveries count this read only, so a healthy later read reads 0 there, and waiting is the state now; a row the sweep could not record is left for the next call and counted (`detail.errors`), and the note then ends `{n} rows could not be recorded; the next read tries again.` A dry run asks the sweep with `p_apply false`. | Supabase service role key | `run --apply --only forms` | The sweep catches up on every stored response, 200 inserts a call |
| `csm-fathom` | Fathom meetings since 7 days before the latest good read, with their summaries and action items. Each meeting is `client` (an external invitee), `candidate` (a Customer Success impromptu call flagged external, shared, 5 minutes or longer or with a summary), `internal` or `sales` (in the sales desk's index, not marked `client service`, not recorded by Customer Success), by `fathomRules.ts` (docs/forms/STAGE2-CONTRACT.md 4.2). Client and candidate meetings get a call row with their summary; internal and sales meetings keep metadata only, and the meetings privacy trigger of `20261027g` keeps them that way whoever writes. A candidate gets a client only by an exact match (the same room within 90 minutes of one client's booking, or its Fathom link in a stored 1-1 form); until then it is `candidate`, carries up to 3 hints (business names only) and sits in the recorder's queue. Transcripts come from `/recordings/{id}/transcript`, 8 a run, newest first, client and candidate rows only. **Gone pass:** a stored meeting of the window that Fathom no longer returns is marked missing, and gone when still missing an hour later (summary, content and transcript object removed, call row `gone`); it comes back with its content when Fathom returns it. **Store pass:** every run re-classes a recording the sales desk indexed since, at any age, clears the summary and transcript text of every internal or sales call row, and removes their transcript objects, 20 a run. The note counts candidates, gone, stripped and transcript objects removed. A recording that is private to its host cannot be read with this key. | `FATHOM_API_KEY` | `run --apply --only fathom` | `backfill --source fathom --apply` from 1 Jul 2026 |
| `csm-fathom-actions` | One light read of Fathom's meetings with their action items: each stored meeting gets its class, room and recorder team, a client or candidate meeting its action items, and an internal or sales one is stripped, then the store pass runs with no cap. It creates no call row and changes no match. Not watched by the guardian: a one-off. | `FATHOM_API_KEY` | | `backfill --source fathom-actions [--since YYYY-MM-DD] --apply` (default 2026-09-25), under the run lock |
| `csm-meta-activities` | Ad account `/activities` for clients; only person-made changes. Each account failure is named. | `META_SYSTEM_TOKEN` | `run --apply --only meta` | `backfill --source meta --apply` 90 days |
| `csm-media-changes` | The cockpit's media buyer decisions, actions, campaign messages and manual changes, plus the separate Meta activity table. | Supabase service role key | `run --apply --only changes` | Rerun rebuilds 90 days |
| `csm-reconcile` | Yesterday's counts/IDs in GHL, Fathom, Typeform and Meta compared with the store. | The same read keys | `reconcile --apply` | Daily at 03:00 UTC, 06:00 Kuwait |

Every provider read goes through `lib.ts` transport. Receipts land in `cockpit_csm_provider_health`, keyed by run. Health is in `cockpit_sync_state`; a failure in one source keeps its last good rows while others run. Guardian sends its own incidents to Slack `#health`, never Telegram. It checks seven source keys, 21-day live-client call coverage, 7-day unmatched share, latest 1-1 note, linked recording/form coverage, and changes for spending clients. An HTTP 200 with a body of errors is failure, not a successful sync.

## Alerts

- `csm-*-stale` or `-failing`: inspect the health row's `note`/`detail`, private `~/.csm-calls/cron.log`, and provider receipts; rerun only the affected source. No key in the log.
- A GoHighLevel unmatched call: check the contact's Client ID against ClickUp list `901816559981`. The CSM can use the client's unmatched queue; the match is audited and survives reruns, with the client's name (the clients list's, else the one stored with the match). Do not edit real GHL contacts just to test.
- Fathom low coverage: recordings belong to the recorder. Shared team recordings only are visible with this key. CSM sharing or a per-user key is Aziz's decision. Internal and sales meetings never become client calls.
- `csm-fathom` red with `Fathom returned {n} fewer recordings than stored; nothing was marked gone.`: more than 3 recordings of the window (or more than 10% of it) vanished in one read. Nothing was marked, so no client lost a call. Check in Fathom whether they were deleted or unshared, or whether the key lost access, before anything else. The other rows of the run were written; the next run marks them one by one once the count is back under the cap.
- Candidates in the queue (`Impromptu recording with no client yet. ...`): an impromptu Customer Success call with no client. The recorder puts it on its client with "This is {client}", or pastes its Fathom link in the 1-1 form and the next run attaches it. "Not a 1-1 call" sets it aside (`settled_reason`): the worker then keeps it on no client, writes `candidate` false and no hints, and adds no queue entry; "This is {client}" later clears it. Only an unplaced, unsettled candidate carries hints: a matched, client-class, manual or set-aside row carries none (docs/forms/STAGE2-CONTRACT.md A7 item 12), as the webhook and the pull write it. The guardian's unmatched share leaves candidate and settled rows out (docs/forms/STAGE2-CONTRACT.md 9).
- A transcript read answers 404: Fathom no longer has that recording. The row is skipped (`detail.transcriptsUnavailable`) and the gone pass decides. The receipt turns the native monitor's `api.fathom.ai/external/v1/recordings/:id/transcript` source red until the next good transcript read.
- Blueprint missing: the bare creative Key Links form does not carry `onboarding_client_id`. Send the client-specific link from their card. Adding a hidden field to the Typeform is Aziz's decision.
- Meta stale: the creative dashboard's Meta API may still be blocked even if this independent activity read works. Check per-account errors. Do not claim a change-free client while the source is stale.
- Reconciliation mismatch: inspect the named source and missing IDs in the `csm-reconcile` row. Never replay old outbox rows or switch ClickUp writeback on as a recovery step.
- Late 1-1 forms (since Stage 2b, `docs/forms/STAGE2B-CONTRACT.md` 4.9): once the registry says the 1-1 notes are native, a Typeform `fRokTITH` response submitted at or after `cockpit_forms.provider_since` (else the row's `updated_at`, as the database reads it) is stored `checkin_late`, and a form already stored late stays late. A late form never places a recording (no share link), is never linked to a call, gets no call of its own and retires nothing; the late trigger of `20261029x` holds the same rule whoever writes, an older release included. `csm-checkin-form` stays ok and its note ends `{n} 1-1 notes arrived in Typeform after the switch-over (newest {day}).`; the report's `plan.cutover` holds the switch-over time and `plan.typeform.fRokTITH.late` the counts. A late form with no client waits in the queue as `1-1 notes sent in Typeform after the switch-over, with no client on the board.` The CSM re-enters each late form's notes in the cockpit; check that `fRokTITH` is closed (the guardian's `csm-checkin-form` names the clients).
- `csm-forms-record` red: read its note. `Supabase POST /rest/v1/rpc/cockpit_form_record_sweep failed (404)` means `20261029y_forms_records.sql` is not applied: ship nothing that calls it. `The forms record sweep answered without ...` means the sweep's answer changed shape: compare it with the contract (3.9) before rerunning. The sweep never sends anything, so rerunning is safe. An ok note that ends `{n} rows could not be recorded; the next read tries again.` stays ok on purpose (as `csm-checkin-form` does with late forms, Z15), and the guardian's `csm-calls-sync` warns while it holds; if the count is still above 0 an hour later, a stored kickoff or a Blueprint press is refused every time: see the root RUNBOOK's Kickoff and Blueprint records section for the two queries that find it.

## Release / rollback

Releases live in `/home/hermes/.csm-calls-releases-hermes/<sha8>`. Stage a fresh immutable folder from a commit on GitHub `main` that holds only `hermes/csm-calls/` (with `callMatch.ts`, `fathomRules.ts`, `rooms.cases.json` and `rollback/` inside it): `git archive <sha> hermes/csm-calls` to a tarball, copy it to the VPS, check its sha256, unpack it into the folder. Stage the rollback release beside it in the same step (below).

**Failures from before the release.** Before the dry runs, read `cockpit_sync_state` for `key LIKE 'csm-%'` (read only) and record every key with `ok` false, with its note. On 2026-10-28 these were `csm-meta-activities` (`1 accounts failed: …: meta 403`: one refused ad account fails the whole source) and `csm-reconcile`, which a run does not write. The dry runs, the first run and the next cron tick below are read against this record: a failure that is not in it, or that has another cause, stops the release.

Run the doctor and a dry run from the staged folder with the native bun directly. Never through the staged folder's `run.sh`: it always changes into `/home/hermes/csm-calls-current` and would test the release in use.

Each block below sets everything it uses, so it can be pasted alone into a fresh shell (every ssh call is one); only `<sha8>` and the holder's `<pid>` are filled in by hand. The swap and rollback lines name the full folder, check that it holds `run.sh` before they move the link (a missing folder moves nothing), and are followed by a read-back of the link.

```sh
R=/home/hermes/.csm-calls-releases-hermes
N=$(readlink -f ~/cockpit-native-current)
E=/home/hermes/.cockpit-native-state/runtime-$(basename "$N").json:/opt/data/bibi/api-keys.env
cd $R/<sha8> && CSM_CALLS_ENV_FILES=$E $N/tools/bun hermes/csm-calls/worker.ts doctor
cd $R/<sha8> && CSM_CALLS_ENV_FILES=$E $N/tools/bun hermes/csm-calls/worker.ts run --report ~/.csm-calls/dry-<sha8>.json
```

The doctor fails while migrations `20261027f_forms_core` and `20261027g_fathom_intake` are not applied (`intake store`, `forms registry`), and since Stage 2b while `20261029s_forms_registry` (`forms registry`, its `provider_since`) or `20261029y_forms_records` (`forms record`) is not applied: the Stage 2b release goes out at deploy step D13, after both. Its dry run also shows `csm-forms-record` ok, counting the kickoffs it would record, `plan.cutover` null and `plan.typeform.fRokTITH.late.sinceCutover` 0. Rollback target for Stage 2b: `93bbd2d4` (safe: the late trigger keeps late forms late and unlinked whoever writes). Both pass as in Where it runs: the doctor prints `ok` true, and the dry run's report shows `ok` true for `csm-ghl-calls`, `csm-checkin-form`, `csm-forms-history` and `csm-fathom`, with nothing in its `failures` but the recorded failures with the same cause. A dry run whose only failures are the recorded ones exits 1 and prints `csm-calls run FAILED: 1 source(s) failed`; that is expected, and the report is written before the exit. The rollback folder's doctor and dry run (below) are read the same way. `--apply` only after both pass for both folders. Any other failure stops the release here, before the swap.

Then hold the run lock, check the holder right before the swap, swap the link while it holds, let it go, and start the first run at once, detached from the shell, keeping the previous release and the rollback folder. While the holder holds, cron's `flock -n` skips its ticks, so no run starts and none is in progress while the link moves.

1. **Hold the run lock.** In the Stage 2a deploy the holder was started at contract section 12 step 3, before the migrations were applied, and still holds: run the read-back below with its pid (if `pgrep` prints nothing now, the holder has let go after its 90 minutes; start a new one). Otherwise start it here:

   ```sh
   nohup flock -o ~/.csm-calls/run.lock sleep 5400 >/dev/null 2>&1 & echo $!
   ```

   Record the pid it prints. With `-o`, flock closes the lock before it starts `sleep`, so only the holder's flock process holds the lock and killing that pid frees it (without `-o`, `sleep` inherits the lock and keeps it after the pid is killed). The holder lets go by itself after 90 minutes. flock starts `sleep` only once it holds the lock, so read back:

   ```sh
   pgrep -P <pid> -x sleep
   flock -n ~/.csm-calls/run.lock true; echo $?
   ```

   One pid from `pgrep` and `1` from `flock -n`: the lock is held. No pid: the holder is still queued behind a cron run in progress; wait a minute and read again. A live holder pid proves nothing on its own, since a holder queued behind a cron run is alive too.

2. **Check the holder, then swap while it holds.** Right before the swap, read back that the holder still holds the lock:

   ```sh
   pgrep -P <pid> -x sleep
   flock -n ~/.csm-calls/run.lock true; echo $?
   ```

   One pid from `pgrep` and `1` from `flock -n`: the holder holds, so swap. If either fails (its 90 minutes ran out, or a stop or a rollback released it), take a new holder with step 1's command and both its read-backs, and use the new pid from here on. In the Stage 2a deploy that is the holder command of contract section 12 step 3 alone, never the apply. Never swap without a holder: a cron tick of the old release could start just before the link moves.

   No flock on the swap itself: the holder has the lock, so a `flock -w` would only wait for it and time out.

   ```sh
   D=/home/hermes/.csm-calls-releases-hermes/<sha8> && test -f "$D/hermes/csm-calls/run.sh" && ln -sfn "$D" ~/csm-calls-current.next && mv -T ~/csm-calls-current.next ~/csm-calls-current
   readlink -f ~/csm-calls-current
   ```

   The read-back prints `/home/hermes/.csm-calls-releases-hermes/<sha8>`. If it prints the old release, the folder check stopped the swap (the staged folder has no `run.sh`) and nothing moved. Stage the folder again and repeat this step while the holder still holds, or release the holder (3) so cron runs the old release as before. In the Stage 2a deploy, contract section 12's stop rule then holds everything after step 6 until this read-back prints the new release.

3. **Release the holder.** First check that the pid is still the holder: `pgrep` must print its `sleep`.

   ```sh
   pgrep -P <pid> -x sleep
   ```

   One pid: kill the holder, then read back the lock:

   ```sh
   kill <pid>
   flock -n ~/.csm-calls/run.lock true; echo $?
   ```

   A pid with no `sleep` child is never killed: the holder is gone, and the pid may now belong to another process. If `pgrep` prints nothing, the holder has already let go: kill nothing and run only the `flock -n` line. `0`: the lock is free (with `-o` the kill frees it; the holder's `sleep` holds nothing and ends by itself). `1` only if a cron tick of the new release has just started.

4. **The first run, at once, detached.** The lock wait alone can take 10 minutes and the run comes after it, and the worker writes its health rows and receipts only at the end. A run tied to the shell dies with it (an ssh call that stops, a closed terminal) and leaves half its upserts and no health row, which reads as a failed release. So it starts under `nohup` with its own log and exit-code file:

   ```sh
   rm -f ~/.csm-calls/first-<sha8>.rc; nohup sh -c "flock -w 600 -E 75 ~/.csm-calls/run.lock ~/csm-calls-current/hermes/csm-calls/run.sh run --apply --report ~/.csm-calls/first-<sha8>.json > ~/.csm-calls/first-<sha8>.log 2>&1; echo \$? > ~/.csm-calls/first-<sha8>.rc" >/dev/null 2>&1 </dev/null & echo started
   ```

   Over ssh, the whole line goes in single quotes as one call (contract section 12 step 6). The `rm -f` clears an exit code left by an earlier try, so the read below waits for this run's. Read the exit code with short calls, a minute apart, until the file exists:

   ```sh
   cat ~/.csm-calls/first-<sha8>.rc
   ```

   Then the last lines of the log, which hold the run's `failures` and `health` (the same as the report's) and end with `csm-calls run OK` or `csm-calls run FAILED: …`, and the report itself:

   ```sh
   tail -n 60 ~/.csm-calls/first-<sha8>.log
   ls -l ~/.csm-calls/first-<sha8>.json
   ```

   An `.rc` of `0`, or `1` with nothing in `failures` but the recorded failures: the first run passed. `75`: the lock was not free within 10 minutes because a cron tick of the new release holds it; wait for that tick and read its `~/.csm-calls/last-run.json` as the first run. `1` with any other failure on a source the release changes: roll back (below) and stop the release there. A new failure on a source the release does not change: read its note (Alerts) before going on. In the Stage 2a deploy, the rest of step 6's read-backs (candidates, receipts) are in contract section 12. Then the next quarter-hour cron tick runs the new release: `~/.csm-calls/last-run.json` is newer than the first run's report, its `failures` hold only the recorded ones, and `cron.log` ends with `csm-calls run OK`, or with `csm-calls run FAILED` and only those failures in the JSON just above it.

The two flock cron lines stay as they are; any change to them goes in `hermes/cockpit-guardian/crontab.manifest` too. The worker is not the guardian and must never open or close incidents.

After the first Stage 2a run, the fathom-actions backfill. It reads, merges and writes each meeting's raw, so it runs under the lock, and it starts detached as step 4's first run does (over ssh, the line in single quotes as one call; contract section 12 step 7):

```sh
rm -f ~/.csm-calls/actions-<sha8>.rc; nohup sh -c "flock -w 600 -E 75 ~/.csm-calls/run.lock ~/csm-calls-current/hermes/csm-calls/run.sh backfill --source fathom-actions --apply --report ~/.csm-calls/actions-<sha8>.json > ~/.csm-calls/actions-<sha8>.log 2>&1; echo \$? > ~/.csm-calls/actions-<sha8>.rc" >/dev/null 2>&1 </dev/null & echo started
```

Read `cat ~/.csm-calls/actions-<sha8>.rc` with short calls, a minute apart, until it exists, then `tail -n 30 ~/.csm-calls/actions-<sha8>.log`. `0`: `csm-fathom-actions` is ok in the log's `health`. `75`: a cron tick held the lock for 10 minutes; start the line again (its `rm -f` clears the old exit code). `1`: the log names the failure (Alerts).

**The rollback release** (docs/forms/STAGE2-CONTRACT.md 4.7). Never point the link back at the bare `2cacdca5`: its re-match loop would attach a candidate by a client named in its title, and its transcript loop would download the stripped sales transcripts again. The rollback release is `2cacdca5` plus `rollback/2cacdca5.patch`, three reviewed guards (no re-match of a row without an external invitee; transcripts only for `client` and `candidate` meetings; a Fathom row placed by hand keeps the booking link, the kind and the client name its manual match wrote, where the bare release rewrote the link as none and the kind afresh on every run, so the card showed the recording and its booking as two calls), tested by `rollback.test.ts`. Stage and check it beside the new release:

```sh
R=/home/hermes/.csm-calls-releases-hermes
N=$(readlink -f ~/cockpit-native-current)
E=/home/hermes/.cockpit-native-state/runtime-$(basename "$N").json:/opt/data/bibi/api-keys.env
mkdir -p $R/rollback-<sha8> && tar -x -C $R/rollback-<sha8> -f <the tarball of git archive 2cacdca5 hermes/csm-calls>
cd $R/rollback-<sha8> && patch -p1 < $R/<sha8>/hermes/csm-calls/rollback/2cacdca5.patch
cd $R/rollback-<sha8> && CSM_CALLS_ENV_FILES=$E $N/tools/bun hermes/csm-calls/worker.ts doctor
cd $R/rollback-<sha8> && CSM_CALLS_ENV_FILES=$E $N/tools/bun hermes/csm-calls/worker.ts run --report ~/.csm-calls/dry-rollback-<sha8>.json
```

Rollback, then the link read back (it prints `/home/hermes/.csm-calls-releases-hermes/rollback-<sha8>`) and its doctor:

```sh
flock -w 600 -E 75 ~/.csm-calls/run.lock sh -c 'D=/home/hermes/.csm-calls-releases-hermes/rollback-<sha8> && test -f "$D/hermes/csm-calls/run.sh" && ln -sfn "$D" ~/csm-calls-current.next && mv -T ~/csm-calls-current.next ~/csm-calls-current'; echo $?
readlink -f ~/csm-calls-current
~/csm-calls-current/hermes/csm-calls/run.sh doctor
```

The swap waits for a run in progress to end, then moves the link while it holds the lock. If the read-back does not print the rollback folder, the exit code says why. `75`: the lock was not free within 10 minutes (a run, or a holder from step 1 that is still alive), and nothing moved; once it is free, run the line again. `1`: the folder check stopped the swap (the rollback folder has no `run.sh`), and nothing moved; stage the rollback folder again.

Rows are upserted, not deleted. What a person placed stays: a Fathom row placed by hand keeps its client, name, booking link and kind. The rollback release still writes summaries for the external meetings of its window (the meetings privacy trigger strips the internal and sales ones), runs no store pass and no gone pass, and makes no candidate rows. Like `2cacdca5`, it writes every meeting of its window without action items and every meeting with no external invitee, candidates included, without its summary. Rolling forward restores the new worker's 7-day window on its first run; for older candidates, run `backfill --source fathom-actions --since <7 days before the rollback> --apply` for their action items and `backfill --source fathom --apply` (heavy, since 1 Jul) for their summaries. If a store migration is not applied, ship **nothing** that calls its RPCs.

## Team EODs (csm-eod-mentions)
- Reads the cockpit EODs (`cockpit_eod_reports`), every tab of the EOD Reports sheet (read-only service account) and all five Slack EOD channels (`#eods-csms`, `#eods-salesreps`, `#media-eods`, `#tech-eods`, `#eods-csr`) as @maharaclubbot. A new channel: invite the bot and add its id to `EOD_CHANNELS` in `eods.ts`.
- Stores only the lines that name a client (whole-word name or alias, 4+ letters), never energy, stress or focus answers, in `cockpit_csm_eod_mentions`. A copy of the same EOD in the sheet and Slack is kept once.
- Each tick re-reads the last 3 days (EODs get edited). Backfill: `run.sh backfill --source eods --apply` (90 days).
