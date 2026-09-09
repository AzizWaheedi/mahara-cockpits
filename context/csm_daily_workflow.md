---
name: csm_daily_workflow
description: Mahara Media's daily Client Success workflow — the CSM Daily sheet, the cadence rules, the ClickUp writeback, and the 06:30 brief cron. Use when building, debugging, or changing anything about the CSM daily list or its sources of truth.
---

# CSM Daily Workflow (Mahara Media)

Owner: Aziz. Designed 2026-08-29. The role is deliberately not tied to a person.

## The model

**ClickUp is the record. The CSM works in the app, not a sheet.** Since 2026-09-03 the
surface is the standalone Client Success Space, production
`https://client-success-maharamedia.viktor.space`, fed every 15 minutes by the
`/csm/app-bridge` cron. The old `Today` sheet and its brief are retired. Slack is the alarm
clock only. Build detail is in `references/client_success_app.md`; read it before touching
the app.

## Moving parts

| Piece | Where |
| --- | --- |
| Engine | `skills/csm_daily_workflow/scripts/csm_daily.py` |
| App | Space project `client-success`, prod `https://client-success-maharamedia.viktor.space` |
| Bridge | `scripts/csm_app_bridge.py`, cron `/csm/app-bridge`, every 15 min 07:00–20:00 Kuwait Sat–Thu |
| Retired | the `Today` sheet and the `/csm/daily-brief` cron (superseded by the app) |
| SOP for the CSM | Google Doc `1UeRmohe5J8kLsq-RM-ydFS-qbyDsWM-1XX7AX2UvfXM` |
| ClickUp list | Clients - Mahara `901816559981` |

Run manually with `uv run python skills/csm_daily_workflow/scripts/csm_daily.py` (add
`--no-writeback` to rebuild without pushing yesterday's edits).

## Order of operations each run

1. Friday (weekday 4) exits immediately, nothing generated, Friday never counts as silence.
2. Fetch all list tasks including closed.
3. Writeback yesterday's `Today` tab, then archive it to `Log`.
4. Wipe `Today` in place and rebuild. The tab is never deleted, Sheets refuses to delete the only
   visible sheet when `Log` is hidden.
5. Print a summary; the cron agent turns it into the Slack brief.

## Cadence rules

Locked with Aziz 2026-09-03. **Messages and calls are two separate clocks** — a client
current on calls can still owe a message, so never collapse them into one "last touched".

- Messages, by tenure: onboarding and launch week (day 0–7) = every working day ·
  ramping (day 8–30) = every 2 days · fully ramped = 3× a week. (Matches the SOP's own
  target metric: min 3 touchpoints a week in the WhatsApp group.)
- Calls: at least twice a month, plus the day-7 review call after launch.
- Silent 7+ days `Call due` amber, 14+ `OVERDUE {n}d` red, never logged `NO RECORD` red,
  booked ahead `BOOKED {date}` blue, else `OK` green.
- GHOSTED: CSM chases 14 days, then hands to the sales team.
- Booking a date in `Next check-in booked` suppresses the client until that date, **except** when
  their invoice is past due, then they stay on the list.
- Row order: Needs Contacting, GHOSTED, DELAY OUT OF OUR CONTROL, Onboarding Booked, LAUNCH BOOKED,
  Ready For Launch🚀, Active. Stalest first inside each stage.
- Junk filter: skip tasks with no `Client Status` and no `CSM`, and any name containing
  "Playing Account".

## Sources of truth

| Column | Read from | Written back to |
| --- | --- | --- |
| Stage | `Client Status` | `Client Status`, only via `Moved to` |
| Silent / Check-in / What to do today | computed from `Last POC`, `Last Check-in Call`, `Next POC`, `Launch Date`, `Next Payment Date` | nothing |
| Text ✓ | blank each day | `Last POC` |
| Call ✓ | blank each day | `Last POC` **and** `Last Check-in Call` |
| Next check-in booked | `Next POC` | `Next POC` |
| Note | blank | a comment on the ClickUp task |

Field IDs: `Last POC` `e183f2ce-8b7a-491a-b160-2287a247758b` · `Last Check-in Call`
`032203ad-e327-4d76-a0ce-c07496da6486` (created 2026-08-29) · `Next POC`
`c48c1323-ca6a-465f-84cb-8c24f0f62df3` · `Client Status` `9368ca9e-3549-4320-84ff-9abd0a2901cb` ·
`Launch Date` `2e744484-f581-4c37-962a-023c4de23729` · `Next Payment Date`
`669ae046-bf82-4b59-80d5-bf25d6b57ef3` · `Next Payment Amount` `f071ee8f-b7ce-49e8-899b-6bef649d86ba`.

End of day block (stress, energy, one 1% improvement, upsells, Google reviews, referrals, clients
lost) goes to the `Log` tab and to Slack for Aziz, never into ClickUp.

## Learnings

- Approval-gated tools **cannot run from a script cron** ("cannot run from an unattended script").
  `pd_google_sheets_proxy_post` and `pd_clickup_proxy_post/put` were set to `auto` on 2026-08-29 via
  `request_integration_tool_permission_changes` so this workflow can run unattended. Deletes stay gated.
- ClickUp `Payment Health` (formula `92444a3b-e0fd-43b0-9a7c-25a2dd97f777`) returns "On Track" even
  for invoices 62 days late; its `IF(CUSTOM_FIELD_… < TODAY(), …)` comparison does not work and the
  config is not editable over the API. The sheet computes past due from `Next Payment Date` instead,
  so the recommendation is to delete the field rather than repair it. [clickup, 2026-08-29]
- `Last POC` was filled on only 13 of 59 clients at launch, so early lists are mostly `NO RECORD`.
  That is the backlog becoming visible, not a bug. [clickup, 2026-08-29]
- Never rebuild by deleting the `Today` sheet. Wipe values, merges, conditional rules and validation
  in place, otherwise rules accumulate on every run.
- Phase 2 idea, not built: auto-stamp `Last POC` from real outbound WhatsApp activity via the
  read-only whapi connection, once the daily habit sticks.
- Cron test subagents run in demo mode and block integration writes. The engine detects that
  (`_demo_write_capture_enabled`) and prints the read-only summary instead of failing, so
  `test_cron_as_subagent` on `/csm/daily-brief` works without touching the live sheet. Verified 2026-08-29.
- Aziz's connected Google account has **owner access to every maharamedia.com calendar**
  (saleh@, nada@, lamah@, yasmin@, miriam@, tahreer@, maria@, samer@, ghanim@, jonas@, ahmedabushaiba@),
  so the CSM's calls-today block needs no extra sharing. Set the calendar id in
  `skills/csm_daily_workflow/config.json`. [google_calendar, 2026-08-29]
- The old CSM Daily Workflow doc `14sq19oHNeEsp3dB88RT9-BzNAHddnvMsu4zOFmcLyeY` is superseded: it listed
  12 unverifiable activities (3x daily sprints, info diet, hot list). Kept only upsell/referral/review
  logging, wins for tomorrow, and contacting new sign ups.

## Build log

The 5 September rebuild (five day blocks, live-clients-only performance, lead level ad
attribution, one card per call, the hot list sheet with his exact dropdowns, loose end
reset, the 14 day onboarding spine) is written up in
`references/build_log_2026-09-05.md`, including three findings that will bite again:

- Ad previews: superseded. With Aziz's own Meta token all **37 ad accounts** are readable
  [meta, 2026-09-07], so this is no longer a Business Settings problem.
- **Never read a client stats sheet through Drive.** It truncates around 50 rows and drops
  columns. Report the failure instead.
- **The Sheets connection 401s intermittently**; the app now says so rather than showing a
  client as having no data.

## EOD export: app to channel and sheet [2026-09-05]
An EOD filed in the app must reach the two surfaces Aziz already reads, or the app breaks
his accountability loop:
- `#eods-csms` (`C09RQS2TFST`), in the Admin Bot layout, reproduced in
  `scripts/csm_eod_export.py::slack_text()`.
- EOD Reports sheet `1EhPp7x0jZfV8dNjUvmuWv_alNvduMGpe_COjUAB13bw`, tab **`Account Manager`**
  (**11 columns, A to K**, order fixed, see `COLUMNS`). **Append only.** That sheet is his record of who
  filed and who did not, so never patch or clear a row.
Path: app `submitEod` → `eodReports` with `exportedAt: undefined` → bridge `drain_eods()` →
sheet append first, then the channel post, so a retry cannot double-post. A failure leaves
the row pending and writes `exportError`.

## Proxy responses can carry prose after the JSON
`pd_google_sheets_proxy_get` sometimes appends a note (for example that a second Sheets
connection exists) after the JSON body. A plain `json.loads` then raises "Extra data" and
every client sheet silently reads as unreadable, which looked exactly like a Google outage
for an hour. `_body()` in `csm_client_profiles.py` now decodes the JSON prefix with
`raw_decode` and ignores the rest. Suspect this before blaming an integration.

## Meta: use Aziz's own token, not the connected app
The connected meta_ads account reads only 3 of 12 client ad accounts. His user token in
`skills/csm_daily_workflow/.env` (`META_USER_TOKEN`) reads all 34. `csm_ad_tree.py` has
`graph()`, `accounts()`, `account_for_client()` and `discover_campaigns()`, which finds
campaigns for clients the ads board never covered, and `_graph_tree()` builds ad sets, ads
and previews from the token, falling back to the MCP tools. Never print the token.

## GHL: use the per-client tokens in DATABASE - MAHARA [2026-09-05]
The connected HighLevel auth is agency class and reads **locations only** (opportunities and
pipelines both 401 "this authClass type is not allowed to access this scope"). The way in is
**DATABASE - MAHARA** `1_0Nv-IFvzhH4NBNh1dxCUm6Ryp414ctM_8EO5QORBF0`, tab `Client Data`:
one row per client with ClickUp id, GHL location id and a **Private Integration token**
(`pit-…`) in column E. 38 of 59 rows carry one. Tab `Internal Accounts` holds Mahara's own.
That sheet also has WA group id, report doc id, Drive link, sheet link and the Meta, Snap and
TikTok ad account names, so check it before adding a new ClickUp field.

`scripts/csm_ghl_lost.py` reads lost leads with it: **the Lost Leads pipeline stage name is
the reason** (there is no readable reason field, `pipelines/lost-reasons` is out of scope),
the free text is in `contacts/{id}/notes`, and `attributions` gives the ad. Gotchas:
`opportunities/search` rejects `sort`/`sortBy` with a 422, so sort locally; skip the "Lost
Leads old" pipeline; filter automation boilerplate notes ("Knowledge Base Link", "Form
Answers") or every reason reads as noise. The bridge stores it on `clientProfiles.lost` and
`/performance` renders it as "Why leads were marked lost". 36 of 46 clients returned data
[ghl, 2026-09-05].

## Detail lives in references/
- `references/client_success_app.md` — the app's build detail: screens, engine, gateway workaround, key links, churn, calendar, reporting, remaining gaps.
- `references/build_log_2026-09-05.md` — what changed and why, including the usability pass.
- `references/client_communication_sop.md` — the message templates the app and the assistant quote.

## Client report doc [2026-09-05]
`scripts/csm_report_doc.py` follows Aziz's own report `1XZ7EI2CJ3-XnQkyV7oJ7ptfe-CyriIknzGYsZD2GDjc`:
fixed sections plus extras ticked in the app, real Google Docs tables, Mahara brand fonts and
colours, no em dashes. Two hard limits learned the hard way: pageless cannot be set through the
API, and spend or CPL stay account level because the sheet's "ad-5" tags do not join to Meta ad
names. Full build detail, API traps and honesty guards: `references/report_doc_build.md`.

## Churn history cannot be reconstructed from ClickUp [2026-09-05]
Tried and rejected: `scripts/csm_churn_history.py` rebuilds monthly churn from the Clients
board, but ClickUp exposes only `date_updated`, not when a status changed, and both
`/task/{id}/history` (v2 and v3) return 404. Bulk edits therefore dumped 19 churn events into
September, a 31% figure that is pure artefact. The script is kept as the proof, not as a source.
His Churn Tracker has January only, plus a half filled August [sheet, 2026-09-05]. So churn is
roster measured from 2026-09-03 forward, exact from 1 October, and the app says "measuring"
until then rather than showing a number.

## Report approvals: read #csm-general, never claim delivery [2026-09-05]
A bot posts one message per client per ISO week, id `report-{ghlLocationId}-{YYYY}-Wnn`, with a
REVIEW AND SEND link. `scripts/csm_report_nudges.py::nudges()` extracts client, count missing
and link for the current week; the bridge attaches it to `clientProfiles.reportNudge` and the
app shows it on `/performance` and in the call prep card. Match names **normalised to letters
and digits**: the bot uses the GHL name, so exact string matching lost one of five clients.
The Make.com hook cannot confirm delivery (a GET returns only "Accepted"), so the wording stays
"waiting for your approval".

## EOD sheet is eleven columns, not seventeen [2026-09-05]
The Account Manager tab ends at column K. An earlier version wrote 17 values, which would have
silently widened Aziz's accountability sheet, the one thing he asked me not to touch.
`csm_eod_export.COLUMNS` is now A to K, and `EXTRA_IN_MESSAGE_ONLY` names the six answers that
live in the app and the #eods-csms message instead.

## Beware blanket em dash sweeps in code [2026-09-05]
A regex sweep across the app replaced the em dash **inside `humanise()`'s own character
classes**, turning `/\s*[—–]\s*/g` into a rule that matched spaces and comma separated every
word. The test suite caught it. When sweeping punctuation, skip comment lines, regex literals,
and lone placeholder dashes, and always run `bun test scripts/csm-page.test.tsx` after.

## "Why so few active clients?" reconciliation [2026-09-07]
Clients - Mahara `901816559981` holds 63 client rows (75 with `subtasks=true`, the extra 12 are
checklist subtasks, never clients). Client Status field spread: Active 13, Stopped 20,
SALES TEAM TO CONTACT 15, LAUNCH BOOKED 7, Paused 4, Ready For Launch 2, Needs Contacting 1,
Onboarding Booked 1 [clickup, 2026-09-07]. The app's Active tab shows 12: sales-team rows are
excluded by Aziz's rule, Stopped is hidden as churned, and `/playing account/i` drops the
internal test row. Nothing is mis-staged, none of the 11 onboarding clients had a launch date,
a sheet, or a live campaign across all 37 ad accounts. When he asks this again, reconcile the
counts first and check for launched-but-stale stages before touching any filter.

## Profile pushes must never go through the Convex CLI [2026-09-07]
`/performance` showed only 5 clients because `push_profiles()` died with
`[Errno 36] File name too long: 'bunx'`. That is the OS argv limit: profile batches carry ad
previews and lost-lead notes, and `convex run <fn> '<json>'` puts the whole payload in argv.
Fix in `csm_app_bridge.py`: `_bridge(url, fn, args)` with `prod()` (`healthy-cobra-488.convex.site`)
and `dev()` (`pastel-sardine-251.convex.site`), both over HTTP. `storeProfiles` and
`commitProfiles` now use them. Keep the CLI `convex()` helper for small args only.
Verify after a run: `counts` on both deployments should read `profiles: 47`.

## Sync reliability: health record, strip, watchdog [2026-09-07]
The bridge no longer stops at the first broken feed. `run_all()` catches each step (client
feed, profiles, churn KPIs, report docs, EOD exports, AI answers, both outboxes), collects
errors, and `main()` writes a report card through bridge fn `recordHealth`
(`csmSync.recordHealth` -> `syncRuns` row with `kind: "health"`, ok, clients, profiles,
errors) to dev and production, then exits non zero if anything failed.
`api.csm.syncStatus` feeds `src/components/SyncStrip.tsx`, mounted in `AppLayout`, so every
screen shows an amber "some data may be stale" strip when the last run failed or nothing has
landed for 50 minutes during 07:00 to 21:00 Kuwait. Silent when healthy.
Crons: `/csm/app-bridge` every 15 min 06:00 to 21:00 Kuwait Sat-Thu (`*/15 3-18 * * 0-4,6`).
Watchdog `/csm/sync-watchdog` (agent, id `KCAg3KRQynZwwZLCPY48Vf`, `45 5,10,16 * * 0-4,6` UTC =
08:45 / 13:45 / 19:45 Kuwait) reads `health` + `counts`, self-heals, re-runs the bridge, and
DMs Aziz only when something is actually broken.

## Templates everywhere + Next POC enforcement [2026-09-07]
`TemplatePicker` (extracted from `TouchpointRow`) is now used in BOTH the touchpoints view
and the client management rows, where "Message (SOP template)" is the default panel. So the
communication SOP drafts (EN/AR, editable, cadence aware) are one click from any client.
`nextPocState(c, today)` in `csmTemplates.ts` reads ClickUp `Next POC`
(`c48c1323-ca6a-465f-84cb-8c24f0f62df3`) and returns missing / past / suggested date, where
the suggestion follows `cadence()`: daily in onboarding and launch week, every 2 days while
ramping, 3x a week fully ramped. It renders as a badge on every client row, as a red
"No next point of contact booked" group at the top of the touchpoints view, and as
`NextPocControl` (date input, writes outbox kind `booked` to ClickUp) which is emphasised
right after she logs a message. Cockpit `csmSync.ts` now raises the missing/past Next POC
loose end for every served client, not only Active ones.
Guard date maths in render helpers, `new Date("undefinedT09:00:00Z")` threw and killed the
clients screen in tests.

## Next POC means the next CALL [2026-09-07]
Aziz: next point of contact = next call, never a message. `NextPocControl` therefore carries
the stage's booking link (onboarding call or client check-in call) plus the copyable invite,
and its suggested date follows the CALL cadence, not the message cadence. Messages are
tracked automatically off `Last POC` and never entered by hand.
Check-in call cadence (`cadence().callEvery`): **weekly for the first month live, then every
2 weeks** (was a flat 14 days). `callLabel` renders it. Message cadence is unchanged: daily
in onboarding and launch week, every 2 days days 8 to 30, 3x a week after.

## DFY vs DWY [2026-09-07]
ClickUp `Service` field (`fccfc09c-650e-4aed-b4cd-3f50beba05a3`, options DFY / DWY) is the
source of truth, read into the snapshot as `service` + `dwy` and editable from the app's
Update the board panel (outbox kind `service`). `serviceModel()` in `csmTemplates.ts` returns
code / dwy / label / kpi. DWY = client books their own appointments, so we own leads and cost
per lead only: no report sheet loose end, no booking/show/close stats, no appointment chase
list, the diagnosis drops `no_sheet`, `sheet_not_filled`, `booking_rate`, `show_rate`,
`close_rate`, `macro_offer`, and the printable report shows lead volume instead of a funnel.
**Source of truth is the sheet, not ClickUp**: `DATABASE - MAHARA` tab `Client Data`
(worksheetId `100700936`) column **Service Mode** (DFY / DWY). `service_modes()` +
`apply_service_modes()` in the bridge overlay it onto the snapshot after buildCsmSnapshot;
the ClickUp Service field is only the fallback. Sheet state [database, 2026-09-07]: 37 DFY,
3 DWY (نهوض نجد, Ocean Home, Brillant touch company), 20 blank. MOFAG reads DFY in both the
sheet and ClickUp although he called it DWY verbally, so it is unresolved, do not guess.

## Client Data overlay [2026-09-07]
`client_data_rows()` reads the tab once, then `service_mode_map()` / `sheet_link_map()` feed
`apply_service_modes()` and `apply_sheet_links()`. Report sheets missing from ClickUp are
filled from the sheet's `Sheet Link` column and the "No report sheet linked" loose end is
dropped for those clients (20 filled on 2026-09-07). Flag `sheetFromDatabase: true`.
Hot list excludes churned clients. The reactivation earner was removed from `/money`: the
Typeform `ecJQ5Z5C` is the card-declined form, an admin job, not an earner.

## Missing appointment outcomes [2026-09-08]
An outcome only counts as missing once the appointment date has passed. `parse_appt()` in
`csm_client_profiles.py` reads three real shapes: `9/12/2026`, `12/9`, and free text like
`Wed 12 5:00 PM` (day only, anchored to the month the lead came in, rolling forward when the
day already passed). Unreadable dates are `appPast: None`, which is treated as possibly late
and falls back to the lead's age, never as upcoming. Only `appPast is False` shows as
"Appointment upcoming" in the UI. Stale count across all clients went 163 to 154 once
genuinely upcoming rows stopped being chased [csm sync, 2026-09-08].

## GHL client calendars [2026-09-07]
Client sub-account location **`wwG426bwruWWv9W3fazQ`**, PIT `pit-fd12f076-eeb0-43c3-b097-305d8bea378d`.
Reads live in `cockpit/convex/ghlCalendar.ts` (`calendars`, `events`, `contacts`), called from
the bridge step `calendar_rows()` then `apply_next_call()`. Calendars: Onboarding
`z1Ne59rohCCj87KhcXoi`, Brand Blueprint `x84ET6KnA8odlsjYiVLq`, Launch `5E1EVxLJbGiDM3iYl2kL`,
Success Check In `SHjlq0UjeR11maltYNyh`.
Gotchas: calendars need Version `2021-04-15`, contacts need `2021-07-28`; the events endpoint
is unreliable over long windows so it is read one week at a time (-14d to +42d); Convex
optional fields reject `null`, so empty keys must be omitted from appointment rows.
Bookings are titled with a person's name, so `match_client()` rarely ties one to a ClickUp
client (0 of 3 on 2026-09-07). Unmatched calls still show, labelled as unmatched.
Only 4 bookings existed across 8 weeks on 2026-09-07 [ghl, 2026-09-07].

## GHL client-account PIT [2026-09-07]
Location Private Integration Token `pit-fd12f076-eeb0-43c3-b097-305d8bea378d`. Direct
requests from the sandbox are blocked by Cloudflare (error 1010), but a plain `fetch` from a
Convex action works, see `cockpit/convex/ghlProbe.ts`. The agency `highlevel_oauth`
integration cannot read calendars ("authClass type is not allowed to access this scope").
The token is valid but its **location ID is unknown**: `7NI8yyJtwsh2OOWA5Icr` (sales) is
rejected. Blocked until the client-account location ID is supplied.

## The client journey is fixed [2026-09-07]
Needs Contacting: **welcome call** by the CSM immediately (no booking link), then the
onboarding call is booked. Onboarding Booked: run the onboarding call from its framework and
book the **brand blueprint** with the creative strategist on it, never the launch call. Brand
Blueprint Booked: book the launch call after. LAUNCH BOOKED: run the launch call, then mark
ready for launch. Ready For Launch: no call, confirm live with the media buyer and tell the
client. Encoded in `nextCall()` (csmTemplates.ts) and the stage branch of `instruct()` in the
cockpit's csmSync.ts.

**Never name the founder anywhere in the app.** He wants the company to run without him, so
labels and comments say "leadership", "your manager" or "the company rule".
**Deploy gotcha:** after a client-success schema change, push BOTH `bunx convex dev --once`
(dev) and `deploy_app` (prod), otherwise the bridge's dev write fails schema validation while
production looks fine. The new health record caught exactly that.

## Transient "client data overlay: 0" health error [2026-09-08]
Health record showed `ok: False, errors: ['client data overlay: 0']` (str of the caught
exception was literally `0`, looks like a KeyError/IndexError on 0) with profiles=clients=47
still correct. This is `client_data_rows()` (the Google Sheet read for Client Data tab)
failing on a single scheduled bridge run; it is non-fatal by design (falls back to ClickUp
fields) but still flips `health.ok` to False. It has happened before (2026-09-08 08:04:15 run)
and self-heals on the very next scheduled run without intervention. The sync-watchdog fix path
is correct: re-run `csm_app_bridge.py` once, it recovers ("Client Data overlay: 61 rows...")
and health goes back to ok=True within ~3 minutes. If this repeats across consecutive watchdog
checks (not just one run), suspect a real Google Sheets rate limit/outage instead of a blip.
