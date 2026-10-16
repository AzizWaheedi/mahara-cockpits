# Runbook: when something breaks

Everything here is written for whoever is on duty, not for an engineer. The
admin view (portal, Admin, "Data sources") shows the same table live, with the
last error and this fix next to it.

## How you find out

- Every outside system the cockpits use (Meta, ClickUp, Sheets, Docs,
  Calendar, GHL, Fathom, Slack, WHAPI, Resend, the two other cockpits, Hermes)
  has a health row. Three failures in a row send one Slack DM with the fix
  line below; a recovery sends "working again". Nothing repeats more than
  twice a day.
- Every 15 minutes a smoke check renders each cockpit's main screen without a
  user. A screen that throws sends a Slack DM and files a fix job for Hermes.
- A screen that crashes in someone's browser shows "Try again / Reload" and
  files the same fix job on its own.
- The cockpit guardian (hermes/cockpit-guardian) scans everything every 5
  minutes from the VPS and makes the safe fixes itself (fix mode since
  2026-10-11: a catch-up run of a late copy-only job, stopping a hung run,
  log rotation, env file modes, the radar resend, the editor-stills bucket,
  a prepared crontab restore it never installs); everything else it posts
  as one "[guardian]" message per new incident and one when it clears, in
  #health, Saturday to Thursday 09:00 to 21:00 Kuwait time (Convex or
  Supabase down at any hour), plus a 09:00 summary. Each message says what
  broke, since when, what the guardian tried, and what a person must do. Its
  own rows are in its README; `python3 guardian.py report` on the VPS lists
  everything open.

## What to do, by system

| System | Symptom | Fix | Who |
| --- | --- | --- | --- |
| Meta Ads | `Meta 190` invalid token | New system-user token in Business Settings, set `META_SYSTEM_TOKEN` (media buyer deployment) | Aziz |
| Meta Ads | `Meta 10/200` permission | The client has not shared the ad account with Mahara's business | Media buyer |
| Meta Ads | `Meta 4/17/32/613` rate limit | Clears on the next run; nothing to do | nobody |
| ClickUp | `HTTP 401` | New API token (ClickUp Settings, Apps), set `CLICKUP_API_TOKEN` | Aziz |
| ClickUp | `HTTP 404` on a list | The list or task was deleted or moved; check ids in SOURCES.md | Client success |
| Google Sheets | `HTTP 403` | Share the sheet with `claude@studied-handler-508106-m5.iam.gserviceaccount.com` | Client success |
| Google Sheets | `HTTP 429` "Quota exceeded ... Read requests" | The service account is allowed 60 reads a minute and everything (the cockpits, Hermes's morning sheet, Make) shares it. The cockpits now pace their reads (one every 1.3 s) and cache each client sheet for 25 minutes, so a 429 from them should be rare; it clears on the next run. If it keeps happening, raise the quota once: Google Cloud console, project 195153154932, APIs & Services, Google Sheets API, Quotas, "Read requests per minute per user", edit to 300. | Aziz (quota) |
| Google Docs / Calendar | "API has not been used" | Enable that API on the service account's Google project | Aziz |
| GHL (CRM) | `401` for one client | Their token in Client Data, GHL API column, is wrong; make a new private integration token in that sub-account | Client success |
| GHL (CRM) | `401` for Mahara's own | Set `MAHARA_GHL_TOKEN` again | Aziz |
| Fathom | `401` | New API key, set `FATHOM_API_KEY` | Aziz |
| Slack | `channel_not_found` | `ALERT_SLACK_TO` must be Aziz's user id (Uâ€¦), not a Dâ€¦ channel | Aziz |
| Client success or creative cockpit (bridge) | `HTTP 5xx` or schema error | Redeploy: `scripts/ship.sh client-success` (or `creative`). If 401, `CSM_BRIDGE_TOKEN` / `CREATIVE_BRIDGE_TOKEN` differ from that deployment's `BRIDGE_TOKEN` | Hermes or Aziz |
| Media buyer dev deployment | Saved winners, clients or boards in the creative or client success cockpit revert minutes after a sync | A dev deployment was running the crons with production's bridge links (2026-09-27: it wiped the saved winners). `cd apps/media-buyer-cockpit && bunx convex run health:whereJobsRun` must say `jobsRun: false` (`--prod` says true); never set `CREATIVE_BRIDGE_*` / `CSM_BRIDGE_*` on a dev deployment; `RUN_SCHEDULED_JOBS=1` only to test one job on purpose | Whoever deployed |
| Claude on the VPS | "Failed to authenticate ... OAuth access token has expired" (as an error, or as the text of a streamed answer) | Since 2026-09-27 Salma (captions, words on pictures, read-backs) and the sales desk (drafts, follow-ups, call notes, Vince) write through Aziz's proxy to Claude Code, `openclaw-claude-proxy` on 127.0.0.1:3456, user aziz. SSH in as aziz, run `claude`, then `/login`; both resume by themselves and Salma's health line turns green within ten minutes. `curl -s 127.0.0.1:3456/health` says whether the proxy itself is up | Aziz |
| OpenAI | `429` credit_balance_exhausted | Only the sales desk's researcher (web search) and anything switched back by `SALMA_TEXT=openai` or `SALES_MODEL_PROVIDER=openai` use it now. Top up at platform.openai.com (Settings, Billing) | Aziz |
| Hermes / Ask AI (`hermes/cockpit-ask-ai`) | "jobs waiting" or worker error | Run `python3 scripts/askai.py doctor` on the host to check config without revealing secrets. Ask AI jobs live in `cockpit_ask_ai_jobs` (never creative requests); the worker defaults to DRY_RUN=true (use `--apply` to execute). Claims use atomic leases and bounded retries. | Aziz |
| Team meeting projections (Supabase candidate; not released) | Projection read/save fails, or client performance facts are missing | The candidate uses `cockpit_csm_projection_read` / `cockpit_csm_projection_edit` with the meeting ID. Release the verified native schema and client together; confirm active membership, current meeting participation, and verified source counts. Performance facts come from `cockpit_client_profiles.kpi`; do not add a fake `performance` column. Booking remains a separate audited `cockpit-csm-api` action. | Hermes |
| Native identity and personal EOD (Supabase candidate; not released) | Sign-in loses access, revoked Sales seat still opens, or an editor sees someone else's filing | Apply `20261004a_cockpit_staff_identity_adoption.sql` only in the coordinated release. Native admission requires the exact confirmed Auth UID/email linked to an active directory member; stale portal profiles and Auth role metadata cannot admit a seat. Preserve Sales manager subroles separately. Personal editor EOD is filtered by directory author and Kuwait UTC+3 day, independent of the browser's timezone. Same-actor token refresh keeps unsaved drafts mounted while directory access revalidates. | Hermes |
| Native source bootstrap (Supabase candidate; not released) | Import rejects an export, a provider feed is missing, or history coverage is incomplete | Use the finite importer in default dry-run mode with exact archive checksums, catalog/table counts, complete target inventory and verified file mappings. `_tables` is a validated archive catalog, not business rows. Unsupported tables remain blocked even when empty; do not drop financial, chat, preference or worker history to produce a green readiness claim. A bootstrapped feed is not a successful native provider refresh. | Hermes |
| Native CEO refresh (Supabase candidate; not released) | Finance sections are stale, a source is missing, or refresh refuses publication | Run `bun run doctor` in `hermes/ceo-refresh` to list missing named credentials and reconciliation prerequisites without external calls. `bun run refresh` remains dry-run by default. The `run.sh` launcher uses `flock`; live execution requires the coordinated release and explicit `--apply`. Stage `20261005b_cockpit_ceo_refresh_worker.sql` with the native worker. Local smoke proves atomic money/expenses publication, exact source amounts, repeat preservation and outage rollback against canonical SQL with synthetic external transport. Other sections and production schedules remain unverified. | Hermes |
| Original business history (Supabase candidate; not released) | Staff choices, plan dates, metrics or recorded audits disappear during cutover | The finite importer preserves original authors and source records in canonical staffing, plan, metric and immutable audit tables. Resolve legacy `tomorrow` plan dates from the original plan day, never the import day. Original audits are append-only and never retired. Fresh archives and storage checksums are recorded privately in `D:/secure/cockpit-fresh-source-manifest-20261005.json`; they are not a write freeze or release proof. | Hermes |
| Native admin monitoring (Supabase candidate; not released) | Monitoring is blank, access is denied, or counts are unavailable | Release `20261005e_cockpit_native_admin.sql` with the validated admin client and page. Access requires current confirmed active directory admin or founder identity, including after revocation. Missing ledgers and unknown live status are unavailable, never zero or healthy. Worker freshness does not verify installed cron schedules. Run `bun test scripts/native-admin.test.ts` for canonical SQL regression coverage. The temporary SDK/browser smoke was removed after its evidence was recorded. Keep native membership writes under their existing server gates and audits. | Hermes |
| Data view (`/data`, admin only) | "Only admins can open the data view", a card or count looks wrong, or the page is slow | Only confirmed admins and the founder pass (`cockpit_get_my_access`). To check a count, run `python scripts/dev/sq.py triage --write < scripts/dev/verify-data-view.sql`: each fn_* column must equal its direct_* neighbour. Rules and mappings are in `supabase/migrations/20261011b_cockpit_data_view.sql`. Every record opened and every CSV export leaves a `data_view.*` row in `cockpit_audit_log` | Muhammed |
| Resend | sign-up or reset emails not arriving | Set `RESEND_API_KEY` and `AUTH_EMAIL_FROM` on all three deployments; verify the domain in Resend | Aziz |

Set a variable: `cd apps/<app> && bunx convex env set --prod NAME value`.

## Database size and audit noise (Creative Triage)

Since 2026-10-09 the audit triggers skip re-saves that change nothing, or
change only a sync time or a rotating Facebook image link
(`cockpit_audit_is_noise`). Source-mirror updates store only the changed keys
(`metadata.audit_format = 'changed_keys'`). A daily pg_cron job,
`cockpit-backend-retention` (01:17 UTC), trims the provider receipt ledgers,
old media plans and cron history, and writes one `retention.applied` audit row
with its counts. `select public.cockpit_backend_retention(false)` is a dry run.

| Symptom | Fix | Who |
| --- | --- | --- |
| Database grows by hundreds of MB a day again | Group `cockpit_audit_log` rows of the last hour by `entity_type, action`. A worker re-saving rows will show thousands of `update` rows. Add the key that changes to `cockpit_audit_strip_noise`; never turn off the audit trigger | Technical operations |
| No `retention.applied` row for today | `select * from cron.job_run_details where jobid=(select jobid from cron.job where jobname='cockpit-backend-retention') order by start_time desc limit 3` | Technical operations |
| Native monitor returns 500 again | `explain analyze select public.cockpit_native_monitor()` should take under 1 s. Check that the `*_provider_health_latest_idx` indexes exist and that the producer check does not read whole `cockpit_native_media_runs` rows | Technical operations |
| Database restarts with "not properly shut down" | The server ran out of memory. Do not run queries that read many `cockpit_native_media_runs.plan` values (2 to 9 MB each) at once | Technical operations |

## PULSE retirement

PULSE (`client-watcher`) was retired on 2026-10-03 at the user's request.
Its daily digest `acd8a3372bc3`, self-check `ce3b8d5bebf4`, system watchdog,
profile, and sidecar identity were removed. The shared launcher and its reboot
and five-minute cron entries now start Scout only.

Do not restore the old PULSE cron or deployment bundle. Replacement design:
[`docs/research/2026-10-03-pulse-reporting-proposal.md`](docs/research/2026-10-03-pulse-reporting-proposal.md).
No replacement agent or schedule is enabled.

Client data, panel views, and Scout remain intact. The portal migration reader
still uses `pulse_client_credential(text)`; this shared credential helper was
not dropped. Existing report artifacts are preserved on the VPS at
`/home/muhammed/report-artifacts/pulse-retired-20261003`.
The Slack app registration has not been uninstalled; removing it requires an
authenticated app-owner session. No PULSE gateway remains behind that app.

## Scheduled jobs

Every cron (the sync, the feeds, the outbox drains, the Hermes relay, the
smoke check, the report writer, the board writeback, the tracking audit, the
weekly playbook) runs through one wrapper that records the outcome. The admin
view lists each job with its last run and error. Three failures in a row file
a fix job for Hermes and send one Slack line; a job that has not run for three
times its interval is flagged by the smoke check. "Not running" for every job
at once means the media buyer deployment itself is down: check the Convex
dashboard, then `scripts/ship.sh media-buyer`.

The client comment watch runs natively since the Convex pause (migration
`20261009i_ai_comment_watch_call_briefs.sql`). The Edge Function
`comment-watch` (pg_cron at minute 7, 22, 37 and 52) reads the comments on
current client cards in Clients - Mahara. Call summaries, kickoff handoffs,
briefs and typed notes go to Hermes as `comment_digest` jobs. The tick
(`cockpit_ai_watch_tick`, every 5 minutes) puts each digest in the
clientComments feed, so it shows as "Latest from the ClickUp card" in all three
cockpits. The same tick queues `call_brief` jobs from the calls on each
published CSM profile and writes the briefs to `cockpit_media_call_briefs`.
New rules reach the card's Do's & Don'ts only when the function secret
`COMMENT_WATCH_APPLY` is exactly `true`; otherwise each planned write is kept
in `cockpit_comment_watch_runs.planned`. At most 5 background jobs are open at
a time; the rest wait for a later run. Billing and touchpoint logs, ClickBot,
cockpit comments, sales handoffs and research reports are skipped. To check:
`select public.cockpit_ai_watch_doctor();` and the `comment-watch` and
`ai-watch-tick` rows in `cockpit_sync_state`. No digests means Hermes does not
claim the new kinds (copy the current `askai.py`, see the Hermes row above) or
a native feed run holds its lease.

The CEO automatic extension pass (Convex `ceoExtensions.applyAuto`) runs
natively through the Edge Function `ceo-extensions-sync`, pg_cron
`mahara-ceo-extensions-auto` at minute 47 (migration
`20261009k_ceo_extensions_auto_cron.sql`). It keeps the ClickUp field "Current
extension (weeks)" in line with the Client Extension Form. It is a cron-only
door, deployed with `--verify-jwt=false`, so `cockpit-ceo-api` keeps the
gateway check. ClickUp is written only when the function secret
`CEO_EXTENSIONS_APPLY` is exactly `true`; otherwise the plan is in the
`ceo-extensions-auto` row of `cockpit_sync_state`. Keys by name:
`CRON_SECRET` (same value as vault `cockpit_sync_secret`), `CLICKUP_API_TOKEN`,
`TYPEFORM_TOKEN`. To check: POST `{"doctor":true}` with `x-cron-secret`, then
read that row.

## Previews

Ad previews and pictures in all three cockpits (health row "Ad previews and
saved pictures", owner Hermes or Aziz).
Native candidate, not released: `previews.fresh` now uses `cockpit-media-api`
with current confirmed directory identity and canonical client/ad ownership.
All three cockpits use the same actor-bound client protocol. The protected
Supabase cache lasts at most 20 hours. Every opening checks authorization.
Apply `20261005c_cockpit_ad_previews.sql` only with the coordinated release.
Run `bun test scripts/native-preview.test.ts supabase/functions/cockpit-media-api/preview.test.ts` for canonical preview regression coverage.
The temporary gateway/browser smoke used synthetic external Auth and Meta transport. Its evidence remains outside Git.
Cache audits record actor, ad identity and expiry, never bearer preview URLs.
Local browser checks cover all three actual components and account switching.

The production behavior below remains legacy until that release is verified.


How they work. Meta's links do not last: a live preview link dies after a
day and a Meta image link after a few days. So nothing keeps them:

- The live preview is fetched from Meta when someone opens an ad, and the
  answer is reused for 20 hours by all three cockpits. The creative and
  client success cockpits ask the media buyer backend for it
  (`/bridge/preview`, with the bridge tokens they already have).
- One small picture per creative is saved in the media buyer's own file
  storage, the first time the sync sees it, when a winner is archived, or
  when someone saves a winner. It is never fetched again, so a winner keeps
  its picture after the ad is deleted in Meta. The other two cockpits copy
  those pictures into their own storage, so pictures still show while the
  media buyer backend is down.
- When nothing else works, the cockpit shows a grey box that says why, with
  an "Open in Ads Manager" link.

Every day at 03:07 UTC the smoke check also checks the pictures. What its
lines mean:

| Check | Means | Fix | Who |
| --- | --- | --- | --- |
| `previews saved pictures load` fails | Saved pictures are not served | Open the media buyer deployment's File Storage page in the Convex dashboard and check the storage limit; a disabled deployment serves nothing | Aziz |
| `previews winners with a picture` fails ("N of M winners have no saved picture") | Pictures could not be saved | Check the Meta Ads row first (a broken token stops every save). Failed ones are retried by themselves: up to five tries, then once a week. Winners deleted in Meta before a picture was saved are only reported and cannot be recovered | Hermes or Aziz |
| `previews live ads with a picture` fails | Under 90% of running ads have a picture | Usually the Meta token or a Meta outage; the next syncs save the missing ones | Hermes or Aziz |
| `previews storage` fails | Saved pictures use over 500 MB | Check the Convex plan's storage limit before it fills; nothing is deleted automatically | Aziz |

The live preview says "Meta no longer has this ad" for a deleted ad or an
unshared ad account, and "Mahara's Meta access does not cover this ad
account" when the client has not shared the account; both show the saved
picture instead. "The media buyer system is offline" in the creative or
client success cockpit means the media buyer deployment is not answering.

## Ideation radar

The Ideation board (creative director and media buyer cockpits, `/ideation`)
reads and writes one Supabase table, `ideation_posts` in the Creative Triage
project. A script on the VPS, the ideation radar (`hermes/ideation-radar`),
scans the watchlist weekly and fetches links people paste every five minutes
under the `hermes` user's cron. The creative cockpit's 15-minute smoke check
watches both: a scan older than eight days, or a pasted link waiting over an
hour, sends the Slack DM and files the fix job like any other broken screen.

| Symptom | Fix | Who |
| --- | --- | --- |
| Board says "Ideation is not connected" | `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are missing on that deployment: `cd apps/<app> && bunx convex env set --prod NAME value` | Aziz |
| Board says the show rate looks off | Since 2026-09-18 it is shows divided by appointments that came due (date passed, Show column filled). Future bookings and unmarked past ones are out; the cell text says "of N that came due" | Aziz |
| DM: "has not scanned since â€¦" | On the VPS as `hermes`: `cd ~/mahara-cockpits/hermes/ideation-radar && python3 radar.py doctor`, then `crontab -l` must show the two radar lines from the README | Aziz |
| DM: "pasted links have waited over an hour" | Same `doctor`; then `python3 radar.py pending` by hand once. If `doctor` shows an Apify or Gemini line failing, see below | Aziz |
| `doctor`: Apify refuses the token or credit is used up | Apify console: check the token and the monthly credit (Starter, USD 29). The old Content Radar daemon shares the key | Aziz |
| `doctor`: Gemini "no longer available to new users" | Set `RADAR_GEMINI_MODEL` in `~/.ideation-radar/env` to the model Google names in the message | Aziz |
| `doctor` or the log: Gemini "exceeded your current quota" (429) or "high demand" (503) | The key's daily quota is used up (seen 2026-09-18 after a burst of test calls). Captures fall back to Scribe plus OpenAI frames plus DeepSeek and say so in `method`; trend descriptors fall back to OpenAI. To stop hitting it: enable billing on the Google AI Studio project behind `GOOGLE_AI_API_KEY`, or wait for the daily reset | Aziz |
| Proposals or ideas missing after a Supabase outage | `python3 radar.py resend` pushes the last scan's proposals and every captured idea from the local files again; nothing is lost, every write is an upsert | Aziz |
| A capture shows "Failed" on the board | Read the reason on the row. "private or removed" and "returned nothing" are the platform's answer; "Try again" queues it once more; four failures stop it for good | Creative director |
| Trends tab stays empty for weeks | `doctor` must show the `embeddings` line OK; then `python3 radar.py trends` on the VPS prints how many rows were described and clustered and any model errors. A trend needs the same format on three accounts inside 14 days, so an empty tab on a quiet fortnight is correct | Aziz |
| Transcripts read worse than before | `method.transcribe` on the idea says who listened. Scribe failing (plan, 402, 429) drops to Whisper by itself; `python3 radar.py speechtest <url>...` compares Scribe, Whisper and Gemini on real clips; `RADAR_SPEECH_PROVIDER` in `~/.ideation-radar/env` sets the order | Aziz |
| The digest reaches Aziz but not Sabry (or the other way) | `RADAR_SLACK_CHANNEL` in `~/.ideation-radar/env` is a comma separated list of Slack ids; the scan log names the recipient that failed | Aziz |
| A scrape on the board stays "Queued" for more than five minutes | The pending cron (every two minutes) runs requests after captures. On the VPS: `python3 radar.py doctor` (the `SCRAPECREATORS_API_KEY` and `scrapecreators credits` lines), then `python3 radar.py requests` by hand; the row's error says what stopped it | Aziz |
| `doctor`: "scrapecreators credits" low | Top up at app.scrapecreators.com (USD 47 for 25,000 credits, never expire). A page scrape costs about five, an ad pull about three | Aziz |
| Scripts we made shows a script with "no text on the task" | The ClickUp task's description is empty, or the media buyer sync has not run since the field was added. Put the script in the task description in ClickUp; it syncs within 15 minutes | Creative director |
| "Send to the editors" on Scripts we made says the task has no client tag | The ClickUp script task carries no client tag, so the video request cannot be tagged. Add the tag in ClickUp, or use the embedded form | Creative director |
| Keyword search added an account nobody wants | `python3 radar.py watchlist remove instagram <handle>`; rows the search added carry source `search` in `ideation_watchlist` | Creative director or Aziz |

Every scan writes a row to `ideation_scans` with its cost; a Slack digest goes
to `RADAR_SLACK_CHANNEL` even when nothing was found, so silence is never
ambiguous. Pictures come from the private `ideation-stills` bucket, signed for
six hours when the page loads.

## Editor desk

The worker on the VPS (`hermes/editor-desk`) that reads the ClickUp Video
Pipeline, finds each job's footage in Drive, transcribes it, maps the shots and
checks the cuts that come back. It builds no timeline and generates nothing:
the cut is the editor's. Cron as the `hermes` user: sync and prepare every half
hour, notes hourly, each under its own lock; log `~/.editor-desk/out/cron.log`.

| Symptom | Fix | Who |
| --- | --- | --- |
| A job says "The footage folder has no video in it yet" | The Client Footage Folder on the ClickUp card is empty or not shared with us. Put the footage in it; the desk reads it again within half an hour | Whoever films it |
| A job says "No brief and no script on the card" | The card has no description and no References doc. Add one; a video request made from the creative cockpit carries it automatically | Creative director |
| A job says "the footage link could not be opened" | The Google refresh token on the VPS was revoked, or the folder is not shared. `python3 desk.py doctor` names which, on the `google token` line | Aziz |
| Transcripts come back empty | Usually correct: most of our footage is silent CGI and b-roll over music. `desk.py doctor` shows the ElevenLabs line; the card's comment says "No speech was found in any file" when that is what happened | Nobody, unless someone is talking in the clip |
| The desk stopped posting to cards | `DESK_CLICKUP_WRITEBACK` in `~/.editor-desk/env`. Aziz turned it on 2026-09-18; `0` switches it off again | Aziz |
| A job says the tag matches no company | The tag on the video card is the client and has to match a card on Clients - Mahara. Fix the tag; the brand rules appear within half an hour | Whoever made the card |
| "Send to client review" did nothing | `desk.py requests` drains the cockpit's queue every three minutes. The row's `error` in `editor_requests` says why; four failures park it as `failed` | Aziz |
| Somebody cannot sign in to the editor cockpit | Their address has to be on `editor_people` and active, and have an auth user. Aziz adds both in the Supabase dashboard | Aziz |
| The editor cockpit says "The desk could not be opened" and names a role | That account's Supabase `role` is not `authenticated`, so PostgREST refuses everything it asks. Four accounts made by another project carried `mahara_dialer_identity`, which is not a Postgres role here (2026-09-19). Signing in through the portal repairs it; otherwise set `role` to `authenticated` on the user in the Supabase dashboard. Sign out and in afterwards: the old role is baked into the session until then | Aziz |
| `doctor`: "Bucket not found" on stills | The private `editor-stills` bucket is missing; the one-line curl to create it is in the README | Aziz |

## Webinar pull

The worker on the VPS (`hermes/webinar-pull`) that reads the live training's
Zoom sessions (who was in the room and when, the chat, polls) and the gift
survey into Creative Triage every hour. The CEO cockpit's webinar funnel says
when each was last read. Log `~/.webinar-pull.log`; `python3 pull.py doctor`
names what is wrong.

| Symptom | Fix | Who |
| --- | --- | --- |
| "Zoom was last read N hours ago" | The cron stopped or the clone moved. `crontab -l` as `hermes` must show the minute-23 line (README); run `python3 pull.py` by hand and read the error | Aziz |
| Zoom "could not be read": `Composio refused` or `4711` | Composio's Zoom connection lapsed or lost a scope. Reconnect Zoom in Composio; the Zoom app keys carry the run meanwhile | Aziz |
| Zoom "could not be read": "the Zoom app's credentials were refused" | The server-to-server app's secret changed. Set `ZOOM_CLIENT_SECRET` in `/opt/data/bibi/api-keys.env` | Aziz |
| No chat or "drop a 1" count after a session | Chat comes from the cloud recording. Recording was off, or Zoom is still processing it (read again every hour for 48 hours) | Whoever hosts |
| Polls and Q&A show n/a | The Zoom app keys are missing on the VPS; Composio cannot read polls | Aziz |
| Attendees are counted but not tied to registrants | Zoom registration is off, so guests join with a name only. Turn registration on and send each registrant their own join link | Aziz |
| The note says `webinar.maharamedia.com/live` does not lead to Zoom | The reminders' join link is broken. Point `/live` at the meeting's join link in the webinar site (Vercel project `mahara-webinar`) | Aziz |
| A survey response "matches no registrant" | The person typed a different email and phone than they registered with. Nothing to fix per response | nobody |
| "HighLevel's messages could not be read": `HighLevel 401` | The webinar sub-account's key changed. Set `GHL_B2B_API_KEY` in `/opt/data/bibi/api-keys.env` | Aziz |
| "HighLevel's messages could not be read": `HighLevel 403` with "1010" | Cloudflare refused the caller; the worker must send a browser user agent (`BROWSER_UA` in pull.py) | Hermes or Aziz |
| "Fathom's calls could not be read": `Fathom 401` or `DeepSeek 402` | New `FATHOM_API_KEY`, or top up the DeepSeek balance (`GET https://api.deepseek.com/user/balance`) | Aziz |
| No objection categories though registrants had sales calls | The call's invitee email is not the registrant's, or the title reads like a client call (launch, check-in, onboarding). `python3 pull.py objections` prints what it matched | Aziz |
| Landing page numbers stop moving | `webinar.maharamedia.com` must still load `/mm-track.js` (sites/webinar); the Edge Function `webinar-events` must be ACTIVE in Creative Triage | Aziz |

## Team meetings

The portal's Team meetings (`/team`) write every change to Google Calendar
through `convex/teamCalendar.ts`: Supabase first, then a row in
`team_calendar_ops`, then Google in the same action; the minute drain
retries a change up to ten times and then shows it on the meeting's page
with Retry. The VPS worker `hermes/team-sync` reads Google back every five
minutes (cron as `hermes`, lock `~/.teamsync.lock`, log `~/.teamsync.log`;
`python3 sync.py doctor`, `python3 sync.py --dry-run`).

| Symptom | Fix | Who |
| --- | --- | --- |
| A meeting page says "Waiting for Google Calendar" | The calendar sign-in is not on the deployment yet. Nothing is lost: the changes wait untouched (no tries used) and go out within a minute of the sign-in being set (next row) | CEO |
| A meeting page says "changes waiting to reach Google Calendar" and the calendar sign-in is not set | Set `GOOGLE_CAL_CLIENT_ID`, `GOOGLE_CAL_CLIENT_SECRET` and `GOOGLE_CAL_REFRESH_TOKEN` on the media buyer's Convex deployment (`bunx convex env set NAME` with the value, prod) and in `~/.team-sync/env` on the VPS. The CEO account's OAuth client with the calendar scope; never pasted in chat or committed | CEO |
| "Google refused the cockpit's calendar sign-in" | The refresh token was revoked or expired (a Testing-mode OAuth app lasts seven days). Sign the CEO account in again and replace `GOOGLE_CAL_REFRESH_TOKEN` in both places, then press Retry on the meeting | CEO |
| "Google Calendar refused the change (403)" on one meeting | The series is organised on a calendar the CEO account cannot edit. Take over from the meeting's page, or ask its organiser to share the calendar with edit rights | Host or CEO |
| A change made in Google does not show within five minutes | `crontab -l` as `hermes` must show the `*/5` team-sync line (README). `tail ~/.teamsync.log`; a meeting with a change still waiting for Google is skipped on purpose until it lands | Hermes or CEO |
| A meeting appeared twice | Two different Google series with the same title that no meeting owned. Link the right one from its page; the other is marked inactive after three quiet weeks | Host |
| The editor cockpit's Meetings page is empty | Fathom recordings are in `team_recordings` since 2026-09-27; the editor desk's `meetings` job fills it hourly and each person sees the ones they were invited to | Hermes |

## Projections (client success)

The client success cockpit's Projections tab (`/client-success/projections`)
and the Sunday "Renewals & Re-sell Projections" meeting page show the same
data: `convex/projections.ts` in the client success app, read and changed
from the media buyer through the bridge (`convex/teamProjections.ts`).
Re-sells, reviews and referrals count wins logged in the cockpit (hot-list
rows marked Closed, renewal plans marked re-sold); renewals count plans marked
renewed; cash is back-end payments in `cockpit_client_payments`, read every
half hour into `billingFeed` (cron `projections billing ledger`, freshness
`okAt`, `failures`; the smoke check fails at six failures in a row). A source
that cannot answer shows "Manual entry", never zero. A won renewal or re-sell
queues one line for `#eods-csms` in `eod_outbox` (role `csm-win`).

| Symptom | Fix | Who |
| --- | --- | --- |
| "Renewal date unknown" and an empty renewal window | Add a Date field named `Contract end date` to Clients - Mahara in ClickUp and fill it per client; the media buyer sync reads it by name and the window fills on the next feed (ten minutes) | CEO or CSM |
| Cash says "Manual entry" | The billing ledger has not been refreshed in two days, or Supabase could not be read (the note says which). Refresh billing in the CEO cockpit, or press "Read billing again" on the Projections tab | CSM or CEO |
| "Book call" says no GoHighLevel contact is linked | The client has no WhatsApp thread or past appointment in the client account. Book it in GoHighLevel and put the day in "Booked another way?" | CSM |
| The gold-standard switch is missing for the CEO | The flag comes with the portal's pass: open the client success cockpit from the portal once | CEO |
| Proving the rules on production | `cd apps/client-success-cockpit && bunx convex run --prod projections:selfTest` runs every rule on sentinel rows (week of 2000-01-02) in one transaction and deletes them before it returns | Anyone shipping |

## Sales cockpit

cockpit.maharamedia.com/sales/, for the setters and closers (plan:
`SALES_COCKPIT_PLAN.md`). Three moving parts: the copy of B2B (the Edge
Function `sales-mirror`, every three minutes), the server that makes every
change (`sales-api`), and the proposal writer on the VPS (`hermes/sales-desk`).
Today shows when the CRM copy was last read; the Team page shows the last
copy run and the writer's status.

| Symptom | Fix | Who |
| --- | --- | --- |
| Today says "The CRM copy is late" or the last read had a problem | Read the newest row of `cockpit_sales_mirror_runs` (its `error` names the step). `B2B 401`: the function secret `SALES_B2B_MGMT_TOKEN` (a Supabase management token) was revoked; set a new one. `HighLevel 401`: set `SALES_GHL_TOKEN`. Nothing at all: the pg_cron job `mahara-sales-mirror` is gone or the vault secret `cockpit_sync_secret` changed | Aziz or Hermes |
| Numbers look a day behind the CRM | B2B itself syncs HighLevel every 15 minutes; if B2B's own sync stopped, its `b2b_sync_health` says so. That is Muhammed's | Muhammed |
| A mark says "HighLevel refused it" | The row shows HighLevel's own words. A `401` means `SALES_GHL_TOKEN` changed; anything else, press Send again on the call. The mark is kept in the cockpit either way | Aziz |
| "Your seat is not linked to your HighLevel user yet" | A manager picks the rep's HighLevel user on the Team page (it also links their B2B numbers) | Aziz |
| Someone cannot open the cockpit | Give them the Sales seat on the portal's Admin page, with Setter, Closer, Both or Manager | Aziz |
| A proposal sits on "Drafting" for more than 20 minutes | On the VPS as `hermes`: `tail ~/.sales-desk.log`, then `python3 desk.py doctor` in `hermes/sales-desk`. A request that failed four times says why on the proposal page, with Try again | Hermes or Aziz |
| A proposal failed with "No Fathom recording" | The demo was not recorded or not shared with the team in Fathom. Share it, then Try again | The closer |
| The page is blank, or says "The sales cockpit did not start" | The startup message names the cause. A bad Supabase address or key now stops the build itself (`src/lib/env.ts`), and `ship.sh` reads the live bundle for its address. If a build still shipped wrong: set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` on the Vercel project `mahara-sales` (read one back with `GET /v1/projects/mahara-sales/env/{id}`; the list call returns ciphertext) and ship again | Aziz or Hermes |
| The dialer says "Away in Maqsam" or "Maqsam seat off" | The rep opens the Maqsam softphone and sets Available; a seat that is off or cannot call out is switched on in Maqsam. The seat's Maqsam address comes from B2B's rep list unless the Team page sets one | The rep, or Aziz |
| A call in the dialer stays on "Ringing you in Maqsam" after it ended | The dialer reads Maqsam's call history every 4 to 8 seconds and matches the call by number, seat and time. No record means Maqsam has not written one yet, or its history API is down (the band then says Maqsam's record could not be read). The rep saves how it went by hand; nothing is lost. Only a call Maqsam records as not answered, with 0 seconds, saves itself (`dial.auto_save` in the audit log) | The rep |
| "Book a time" shows no times, or says "That time was just taken" | The free times are HighLevel's own for that calendar (intro: two hours' notice, three days out; demo: one hour, three days). A rep with no free time of their own sees the team's. If a booking says HighLevel took it but reading it back did not match, find the row in `cockpit_sales_bookings` (state `unverified`) and check the lead's calendar in HighLevel before booking again | The rep, or Aziz |
| Booking past the booking page: "Another day" shows no far days, says "Times past … could not be checked just now", or a custom time says "calendar could not be read" (`far_unread`) | Since 2026-10-11 the picker books up to `booking.reach_days` days out (setting `cockpit_sales_settings` key `booking`, a whole number 15 to 120; no row means 60; migration 20261011f_sales_booking_reach seeds it) on the same HighLevel calendars, with the public windows untouched (intros 2 days, demos 3). Past the window sales-api works the free times out from the host's HighLevel "Work Hours" schedule (or the calendar's open hours when no schedule lists the calendar), the call's length, step and buffers, and the host's calls and blocked time, and keeps only the times HighLevel's own extended answer (`free-slots` with `ignoreDateRange=true`) also has. "Could not be checked" means one of those reads failed: the sales-api function's logs (Supabase, Edge Functions, sales-api, Logs) say "schedules unread", "host's calendar unread", "booking setting unread" or "extended free slots unread" with HighLevel's own answer for `/calendars/schedules/search`, `/calendars/events`, `/calendars/blocked-slots` or `free-slots`; a 401 means `SALES_GHL_TOKEN`. The booking page's own days keep working meanwhile. "<name> has no working hours on this calendar" means that person's schedule is not linked to the calendar in HighLevel (Calendars, Availability): link it there. Aziz gets no far-out times while his Google calendar sends its free "Bookable" windows and all-day reminders to HighLevel as events (the API cannot tell them from busy time). Every far-out or custom booking and move says how it was placed in its `book.create` / `book.move` row in `cockpit_audit_log` (`metadata.placement`, `flags`, `window_until`, `reach_days`, `agreed_by_highlevel`, `outside_hours`, `host_checked_at`). The lead's own reschedule link is `https://link.maharamedia.com/widget/booking/<calendarId>?event_id=<appointmentId>` (verified 2026-10-11), shown only where the calendar has "allow reschedule" on (intros and Follow up call; demos have it off in HighLevel) | Hermes, or Aziz for the schedules |
| A message says "WhatsApp only takes a free message within 24 hours" | Meta's rule, not the cockpit's. Outside the window the box becomes a WhatsApp template with one line for the lead, once a template is live in Follow-ups â†’ WhatsApp library; until then, email | The rep |
| The WhatsApp library says a template is "Waiting for its workflow" | Its approved template and the one-step HighLevel workflow that sends it are not set up yet: the steps are on that page (the two contact fields, Cockpit WhatsApp line and Cockpit rep name, already exist). Pick the workflow, tick Live, Save | Aziz |
| A template send says "The workflow did not send it within half an hour" | In HighLevel the workflow must be published and allow re-entry, and the template still approved at Meta. The send is marked failed; send again once fixed | Aziz |
| "Proof to send" is empty, or an asset is missing | The asset library is B2B's (Muhammed's), copied every hour by `sales-mirror` (the `assets` step in `cockpit_sales_mirror_runs`). An empty read from B2B keeps the old copy and fails the step. What may be sent is B2B's rule (link working, claims not expired, no YouTube video from before 19 July) | Hermes, or Muhammed for the library |
| A lead moved to the wrong stage after a dialer outcome | What each stage means is pinned by id in the setting `pipeline` (`roles`); `auto_moves: false` stops the moves. Every move, and HighLevel's answer, is a row in `cockpit_sales_stage_moves` | Aziz |
| A rep asked for a reference call | Links â†’ Reference calls asked for: arrange it through the client's CSM, then mark it arranged, done or not possible. A client is only called once their reference says they agreed | Aziz or the CSM |
| A message shows "Did not send" with a reason | The reason is Meta's or HighLevel's own: 131049 is Meta's cap on marketing messages to one person; "insufficient funds" is the HighLevel wallet. The send is kept in `cockpit_sales_messages` either way | Aziz |
| An end of day shows "Slack refused it" | The cockpit's Slack bot (@abdulazizs_second_ass) is not in #eods-salesreps: invite it, then press Post again. The sheet row goes in regardless | Aziz |
| An end of day says "no Slack id" | Put the rep's Slack member id on their seat on the Team page, so EOD Radar credits them | Aziz |
| The copy's leads step says "nothing was dropped" | A full pass (every six hours, carried over as many runs as it takes) drops only leads B2B no longer has, and refuses when more than a fifth of what it read would go: that is B2B answering oddly, or a clean-up in B2B. If B2B really deleted them, drop them by hand: `delete from cockpit_sales_leads where mirrored_at < '<the pass start in the run's counts>'`. Deals, reps, appointments and assets follow the same rule | Aziz or Hermes |
| Two copy runs at once, or the copy seems stuck | One run at a time: `cockpit_sales_locks` holds the lock, and it lapses by itself after five minutes. A run that finds it held answers "the last run is still going" and writes no run row | Hermes |
| A call shows on the wrong lead, or on none | Calls link to leads by the last nine digits when both numbers have them (`cockpit_sales_link_dials`, every copy run); eight digits alone link only when one lead has them. Two leads with the same number (a duplicate contact) get the one that existed at the call | Hermes |
| A seat is paused but the person still opens the cockpit, or an admin opens it | A seat row decides: paused is no seat. With no seat row, only the portal's explicit Sales role opens it, never Admin alone (`cockpit_sales_seat`, migration 20260926m) | Aziz |
| A rep asks why a lead's deal shows no money | A rep reads the money only on deals they closed or set (row security on `cockpit_sales_deals`); every seat still sees that the lead signed. Managers see all | Aziz |
| A recording is missing from the list | Hidden ones are a second recording of a meeting already there (kept: the longest) or a phone call whose transcript is only the network's message. "Show hidden recordings" on the Recordings page lists them; `cockpit_sales_mark_recordings()` decides, after every import | Hermes |
| The Team page says a B2B source is failing | B2B reads Fathom, Maqsam, HighLevel, Typeform and Whop itself (copied each run into the setting `b2b_sources`). A failing source is Muhammed's to fix; what it should have brought is missing here until then | Muhammed |
| The dialer's "Saved work" says saves are not in HighLevel yet | A save is stored first; its HighLevel note, tags and stage move follow in the background. One still pending after two minutes, or failed, is listed for the rep with Send again (`dial.resync`), and the desk's requests job sends it again by itself every two minutes (`dial.resync_stuck`, five tries, ten minutes apart; `crm_tries`, `crm_error` on `cockpit_sales_attempts`) | Hermes |
| Saves or the queue feel slow again | The cockpit asks Supabase to run sales-api beside the database with the header `x-region: eu-west-1` (a save ~0.5 s, the queue ~0.5 s; without it 2â€“3 s). Check `src/lib/api.ts` still sends it and the function's CORS still allows it | Hermes |
| "Maqsam may still be placing the last call to this lead" | A call Maqsam did not confirm (a timeout or server error, not a refusal) keeps that lead from being called again for two minutes, so a delayed call cannot ring them twice. Check the softphone; the outcome can be saved meanwhile | The rep |
| A lead who called us is at the top of the queue | Their call went unanswered (Maqsam's "abandoned"): called first within ten minutes, today's work until someone calls them back; it also reopens a closed lead | The rep |
| Give someone a sales seat without the Admin page | In `apps/media-buyer-cockpit`: `bunx convex run --prod portal:grantSalesSeat '{"email":"â€¦","name":"â€¦","salesRole":"setter"}'` (setter, closer, both or manager). It adds the Sales cockpit to what they already have; then link the seat on the Team page (HighLevel user, Arabic name, pay) | Aziz or Claude |
| A setter's deal says "Waiting on a manager" | Setter pay counts a deal once it fully closed: paid in full at signing, or a manager presses Fully closed on the setter's pay card (Numbers, their view) once the client paid past the onboarding fee. Not fully closed is the onboarding fee and then nothing (`cockpit_sales_deal_status`, audited) | Aziz |
| A setter cannot see a lead in the queue | Another working rep owns it: HighLevel's owner is set to the setter who booked the intro, and to the closer from the demo. A manager sees every lead; pausing a seat hands its leads back to the queue | Aziz |
| A stage move failed with "duplicate opportunity" | Fixed on 2026-09-27: a new lead's opportunity is read from HighLevel before moving. A row in `cockpit_sales_stage_moves` still failing names HighLevel's own reason | Hermes |
| Maqsam's calls and the cockpit's disagree (Team page, 7 days) | The desk reads Maqsam each half hour and adds the calls B2B does not keep (the closers', `origin` maqsam); a gap that stays means neither B2B nor the desk read that agent's calls: check the agent's Maqsam address on their seat | Hermes |
| Change a call script's words | The four scripts (intro and demo, English and Arabic) are the Google Docs plus the cockpit's own revisions in `hermes/sales-desk/scripts_import/revise.py`, applied on every import. Edit the Doc, export and parse as before, then run `load.py`: a changed script becomes the next version. If the Doc changed a line a revision edits, the import stops and names the line; bring `revise.py` in line and run it again. Arabic lines follow the Kuwaiti voice skill | Aziz |
| A numbers line in the script shows a dashed blank | The notes do not have that number yet (the blank says which). Type it in the Answers panel; the funnel ladder and every [NUMBER] line fill in as it is typed. "Reads as" under a field shows how a typed amount was read; "No number in this" means the math leaves it out | Rep |
| The demo's gap looks too big | The ladder says so when it is more than twice what they sign a year now; the one thing is always a step inside their funnel (booking, show-up, closing) worked out from their own numbers. A step they gave no number for is counted at ours, and the ladder says that too | Closer |
| An intro that rang out does not come back at once | By design since 2026-09-27: it waits five minutes and returns while its twenty-minute window is open, so Next lead moves on | Aziz |

### Zoom links and WhatsApp groups (2026-10-10)

"Zoom link" (the dialer's action row, the step after a missed call, the lead
page's and the guided call's headers) makes a Zoom meeting at once through
sales-api (`zoom.link`), with no rooms machine behind it: no worker, sweep,
wait, webhook or automatic send. The rep sends the link from their own
WhatsApp or copies it. A licensed rep hosts on their own Zoom user (they
press Start the meeting); anyone else is hosted on the shared host
`zoom_links.fallback_host` (the CEO's licensed user) with join before host
on, so both sides just join. The switch is the setting `zoom_links`
(`enabled`), shipped off; its guard (20261010s) lets only a sales manager
named in the same transaction turn it on or change the shared host, and
audits every change. The health line is `cockpit_sales_worker_status`
`sales-api` / `zoom-links`, written on every press (a quiet day is not an
outage, so the watchdog does not watch it). The WhatsApp group for a booked
demo is made from the setter's own phone; the cockpit keeps one row per lead
in `cockpit_sales_groups` (`group.made`) and writes a HighLevel note without
the link. Neither ever sends anything by itself.

| Symptom | Fix | Who |
| --- | --- | --- |
| Turn Zoom links on (after the three Zoom secrets are set on sales-api) | One SQL call as postgres: `begin; set local mahara.actor = 'aziz@maharamedia.com'; update public.cockpit_sales_settings set value = value \|\| '{"enabled": true}'::jsonb, updated_by = 'aziz@maharamedia.com', updated_at = now() where key = 'zoom_links'; commit;` Then the newest `cockpit_audit_log` row for `entity_id = 'zoom_links'` says `settings.switch` by that manager. Turning it off needs no one: the same update with `false`, or delete the row | Aziz |
| No "Zoom link" button anywhere | The switch is off, or the setting could not be read (the button hides either way, as the room menu does). Read `cockpit_sales_settings` where `key = 'zoom_links'` | Aziz |
| "Zoom is not connected on the server yet (its keys are missing)", and `zoom-links` is red with "Zoom keys are missing on sales-api" | Set `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID` and `ZOOM_CLIENT_SECRET` as sales-api secrets, copied from `/opt/data/bibi/api-keys.env` on the VPS (the same server-to-server app the room worker uses; it needs `meeting:write:meeting:admin` and the user and meeting reads). Never paste them in chat | Aziz or Hermes |
| "The shared Zoom account is not available. Ask Aziz." | Zoom no longer says the shared host is licensed and active (its licence moved, or `fallback_host` names someone else). Licence that user again, or a manager points `fallback_host` at a licensed user (guarded like turning it on) | Aziz |
| "Zoom did not make the meeting: ..." | Zoom's own words follow. A token refused means the app's keys changed (set the three secrets again); a scope message means the app lost `meeting:write:meeting:admin`. Nothing was saved, so pressing again is safe | Aziz |
| "Zoom did not answer within 25 seconds" | Zoom was slow; no link was saved. Press again | The rep |
| The card warns that the shared Zoom is in another meeting | The shared host is in a meeting now and Zoom lets one user host one meeting at a time, so the lead may see "waiting for the host" until it ends. A Zoom licence for that rep moves their links to their own user with no change in the cockpit (accepting a Basic invite does not) | Aziz |
| The lead waits for the host on a rep's own link | The rep hosts it: press Start the meeting on the card (a fresh start link from Zoom each time; it is never stored) | The rep |
| "You made 20 Zoom links in the last hour" | The per-seat cap (`per_seat_hour`). Pressing again for the same lead gives the same link for 12 hours, so the cap only stops runaway presses | The rep |
| Old cockpit meetings pile up in a host's Zoom list | After each new link, sales-api deletes up to five of that host's cockpit meetings older than a day that were never held: Zoom says `waiting` and has no past meeting for it (a held, ended meeting reads `waiting` again, so `waiting` alone is not enough). `deleted_why` on the row says what happened. A meeting that was held stays in Zoom and gets `started_at` from Zoom's record (audit `zoom.link.held`) | Nobody |
| The group's invite link is refused | It must be the link WhatsApp's Invite via link copies: `https://chat.whatsapp.com/...` (a tracking `?mode=...` on the end is removed by itself) | The setter |
| A group row says `crm_note` failed | HighLevel did not take the note that the group was made (the row and the audit row stand). The next press on the group (Send the invite again) tries the note once more | The setter |

## Sales desk

The worker on the VPS (`hermes/sales-desk`) that drafts the sales cockpit's proposals from the lead's demo call in Fathom, rebuilds them after the closer fills the gaps, indexes every rep's sales calls, copies the Obsidian vault's sales calls and every answered Maqsam phone call in, writes Vince's call reviews, researches leads, drafts follow-ups, runs the backlog waves, makes the live-call video rooms and sends the Slack replies the door keeps. Cron as `hermes`, each job under its own lock: requests and research every two minutes, recordings at :11 and :41, calls-vault at :26 and :56, maqsam-calls at :16 and :46, reviews at :03 and :33 and asked reviews every two minutes, followups at :07 and :37, call notes at :19 and :49, the digest at 03:15 UTC, the room worker every minute (`flock -w 10`, a 57 s run that also sends Slack replies), the room host check every 10 minutes, the doctor hourly at :05, waves every 5 minutes (the exact lines are in `hermes/sales-desk/README.md`, Cron); log `~/.sales-desk.log`. `calls-b2b-fathom --once` (Ahmed's private Fathom calls, which only B2B holds) is a one-off, never on cron. `python3 desk.py doctor` names what is wrong; `python3 desk.py status` shows the queue; `python3 desk.py deploy-check` says whether the box is ready for live calls with every switch off, and changes nothing.

| Symptom | Fix | Who |
| --- | --- | --- |
| A proposal says "No Fathom recording of this lead's demo was found" | The demo was not recorded, or was recorded by a rep whose calls the key cannot see. Share the recording with the team in Fathom (and put the rep's Fathom email on their seat), then draft again | The closer |
| Requests wait with "OPENAI_API_KEY is not set" or "refused the key" | Set OPENAI_API_KEY in /opt/data/bibi/api-keys.env; waiting requests go ahead on the next run | Aziz |
| "The model â€¦ is not available to this openai key" | `desk.py doctor` lists the models the key can use; set SALES_PROPOSAL_MODEL in ~/.sales-desk/env | Aziz |
| "Fathom refused the key" or FATHOM_API_KEY not set | New FATHOM_API_KEY in /opt/data/bibi/api-keys.env | Aziz |
| A proposal failed with "The draft did not pass the checks: ..." | The draft broke a rule the validator enforces (a figure never said on the call, an em dash, the fee band, a sheet overflowing A4). Open the saved version, then draft again | The closer |
| Proposals say "The PDF was skipped" | Playwright or its Chrome is missing on the VPS (`doctor`'s playwright and render lines). The HTML is complete meanwhile | Aziz |
| Recordings stop growing | `calls-vault` (cron :26 and :56) copies the Obsidian vault's sales calls (`/opt/data/obsidian-sync-vault/Calls`, written by the vault's own Fathom sync); if the vault stopped, the vault's sync job is the fault. `python3 desk.py calls-vault --dry` shows what it would copy | Hermes |
| A sales call the lead joined from the link is missing (often an "Impromptu Zoom Meeting") | `calls-vault` keeps a call with nobody from outside on the invite when someone from outside was on the call: the vault's note shows it, the cockpit already has it, or Fathom's flag says so (asked for the last 14 days each run; its line says "Fathom could not be asked" when the key is refused). For older calls: `python3 desk.py calls-vault --fathom-days 700` once | Hermes |
| Phone calls stop coming in | `maqsam-calls` (cron :16 and :46) reads Maqsam for every seat with a Maqsam address. Its line in the worker status names a seat Maqsam refused; `401` or `403` means MAQSAM_ACCESS_KEY or MAQSAM_SECRET changed in /opt/data/bibi/api-keys.env. A refused seat is read again from the same point next run (the mark is the setting `maqsam_calls`). `python3 desk.py maqsam-calls --dry-run` shows what it would copy | Hermes or Aziz |
| One rep's phone calls are missing | Their seat has no Maqsam address: set it on the Team page (or it comes from B2B's rep list), then run `python3 desk.py maqsam-calls --days 270` once for the calls before the mark | Aziz |
| An asked review failed with "under the 1,500 a review needs" | The call was too short to score (a greeting and a callback time). Nothing to fix; ask for a longer call | The rep |
| Calls are not reviewed | `reviews` (cron :03 and :33, two calls a run) is Vince on the desk's OpenAI key; its knowledge files are in `~/.sales-desk/vince` (copied from the OpenClaw sales-coach). "knowledge files are missing" means that folder was emptied: copy them back from `/home/aziz/.openclaw/agents/sales-coach/knowledge` | Hermes |
| Research sits on "Researching" | `research` runs every two minutes; `tail ~/.sales-desk.log`. It needs OPENAI_API_KEY; without APIFY_API_KEY it still runs on the model's own web search and says so | Hermes |
| No follow-up drafts appear | `followups` runs at :07 and :37 outside quiet hours (setting `followups` in `cockpit_sales_settings`, on the Follow-ups page for managers). A run's line in the worker status says how many leads were due and how many had no open channel (no WhatsApp window and no email) | Hermes or Aziz |
| A follow-up kind sends by itself when it should not | A manager switches it off on Follow-ups â†’ How it works; the desk can only send kinds switched on, through `followup.autosend`, the one action its service key opens | Aziz |
| Follow-ups go out as email where WhatsApp was wanted | Outside the lead's 24-hour window WhatsApp needs a live template (Follow-ups â†’ WhatsApp library). Until one is live the agent writes email where that kind allows it (the email boxes under How it works) | Aziz |
| No drafts for no-shows, cancellations or new leads while HighLevel's automations run | By design: the agent waits 20 hours after an automation's message (`automation_gap_hours`), so nobody gets both. Switch that kind's "Replaces HighLevel's" on (How it works) and each lead the cockpit messages is taken out of the old automation at the send; the answer per workflow is kept on the follow-up | Aziz |
| Call notes or the digest stop updating | `notes` at :19 and :49 (four calls a run) and `digest` at 03:15 UTC, on the desk's OpenAI key (never DeepSeek). The Intelligence page says when the digest was written | Hermes |
| An asked review stays on "Review asked" | `reviews --asked` runs every two minutes; a failure says why on the call's page | Hermes |
| Every proposal's notes say "No reference deal on this machine" | Put a finished proposal per variant in ~/.sales-desk/reference with extract_reference.py (README) | Aziz |
| A request stays "running" for over half an hour | The run died. It goes back in the queue by itself and is parked as failed, with the reason, after four tries | nobody |
| The cockpit's payment choices differ from offer.json | `python3 desk.py offer-sync` (requests does it every run) | Aziz |

### Live calls: video rooms and the Slack poster

The room worker (`desk.py rooms`, every minute) makes the video rooms the cockpit asks for on Zoom or Meet, and the same run sends the Slack replies the door (`sales-live`) keeps for App Home presses. The SQL sweep (`mahara-sales-rooms-sweep`, every minute) owns every room timer; the watchdog (`mahara-sales-watchdog`, every 5 minutes) posts alerts to #sales-alerts. Everything ships switched off (`rooms.enabled`, `live.enabled`, `live.slack` false). Status rows: `sales-desk` / `rooms` (red on the health line at 90 s, alert at 10 minutes), `room-hosts` (20 minutes), `slack` (10 minutes, watched while `live.enabled` and `live.slack` are on), and `sales-api` / `sweep` (5 minutes).

| Symptom | Fix | Who |
| --- | --- | --- |
| Before switching anything on, or after a deploy | On the VPS as `hermes`, in `hermes/sales-desk`: `python3 desk.py deploy-check`. It changes nothing; every `--` line says what is missing (a migration, a column, the lease function, a key) or which switch is on, and what that means. Ready means every table, column, function and setting is there and every switch is off | Hermes |
| Before deploying the sales-api of 3 October (stress round 1) | Apply `supabase/migrations/20261003d_live_calls_hardening.sql` first: sales-api writes the room's intro start (`appointment_start_at`) and when the room first showed the lead in (`lead_in_seen_at`, fix round 3), finds the handover room the claim reserves, the new count results and the `unclear` message state, and takes the send ceilings through `cockpit_sales_message_slot`. `desk.py deploy-check` says "20261003d hardening: not applied" until it is. `python3 supabase/migrations/tests/run_checks.py` proves a, b, c and d in one rolled-back run | Hermes |
| Before deploying the sales-api of 4 and 5 October (second stress series) | Apply `supabase/migrations/20261004a_live_calls_hardening_2.sql` first. sales-api falls back where a 20261004a piece is missing (the room's `meeting_ended_at`, `standby_error`, `cockpit_sales_disposition_replace`, `cockpit_sales_live_claim` p_at, the message slot's same words, and the event lease's token, `lease_token`), but until it is applied a host who closes Zoom before the lead comes loses the late-join guard, and a run whose event lease ran out can still give back the lease of the run that took it over. `desk.py deploy-check` names the migration while it is missing. `python3 supabase/migrations/tests/run_checks.py` proves a, b, c, d and 20261004a in one rolled-back run | Hermes |
| Turning a switch on (Milestone 1 pilot and after) | Only a sales manager turns a switch on. The database's settings guard (20261004a) refuses any write that turns a switch on (`rooms.*`, `live.*`, `threads.enabled`, `followups.agent`, `followups.enabled`, `followups.autosend.*`) or widens who the rooms reach (`test_contacts`, `test_only`, `fallback.pilot_emails`, the test and live calendars) unless the write names an active manager in `cockpit_sales_people` as its actor in its own transaction (`set local mahara.actor = '<manager email>'`, or the `x-mahara-actor` header sales-api sends) and its `updated_by` is that same manager; a later write never borrows the name left on the row. A guarded row (`rooms`, `live`, `threads`, `followups`) is never renamed, a new `rooms` row is compared with the shipped one, and deleting one (or a truncate) is every switch turned off, allowed for anyone and audited. Every switch change, on or off, leaves a `settings.switch` audit row naming the actor or "not named". The follow-up agent's own sends are turned on by a manager under Follow-ups, How it works (`followup.settings`, audited); the room and live switches by SQL as a manager, in one transaction: `begin; set local mahara.actor = '<manager email>'; update public.cockpit_sales_settings set value = value \|\| '{...}'::jsonb, updated_by = '<manager email>', updated_at = now() where key = 'rooms'; commit;`. Turning a switch off needs no manager | A manager |
| What Milestone 1 leaves off, and how it stays off | Milestone 1 is the video link when a call fails. While their switches are off, the server refuses or does nothing for: live handover (`live.enabled`: Available, Take, Not now, ask, Slack presses, handover and standby rooms; the sweep ends open offers and empty standby rooms and makes no fresh one, the database's claim claims nothing, and the worker refuses standby and handover rooms), counting a join (`rooms.count_on_join`, also held in the count's claim), settling no-shows (`rooms.settle`: no settle event made, posted or marked), rooms for booked calls (`rooms.wrap`), automatic mode (`rooms.fallback.auto_on_miss`) and the follow-up agent's own sends (`followups.agent`: waves, openers, the paced send, levels above Approve, autosend and confirmation drafts). The drafts reps approve keep `followups.enabled`. Proved by `m1_fence.test.ts`, `m1_fence_router.test.ts`, `tests/test_m1_fence.py` and run_checks.py section M | Hermes |
| Before switching `rooms.count_on_join` on | Make a calendar in HighLevel that only live calls use, outside B2B's show-rate map (`calendar_call_type_map`), and set its id as `rooms.live_calendar_id`; `rooms.test_calendar_id` must not be an intro or demo calendar either. deploy-check blocks both until they are (D25, C34). Live calls then never move the 60% and 75% show-rate targets | The CEO, then Hermes |
| The `rooms` row or the doctor says "The VPS clock is N seconds behind the database's" | The sweep compares every deadline with the database's clock. Past 10 s the worker corrects its times and says so; past 60 s it makes no room. Fix the clock: `timedatectl status`, then `sudo timedatectl set-ntp true` (or restart chrony) | Hermes |
| Alert `room_event_lost` ("Zoom's word that someone joined was never read") | room.event took the event 10 times and never handled it, or it is a day old. The room may have closed as if nobody came (it closes `events_lost`, never a no-show). The host checks the call and marks the intro by hand | The rep, then Hermes |
| Alert `room_mark_intro` ("the booked intro was not marked a no-show because ...") | A no-show is written only on evidence that nobody came. Here there was a sign the lead came (the link opened, a knock, a join after the close, another room for the call) or none could be had (Meet, unread Zoom events): the rep marks the intro shown or a no-show | The rep |
| A room says "HighLevel may have booked it. Check the lead's calendar before booking by hand." (alert `room_count_stuck`) | The live booking's answer was lost and no booking could be found. Look at the lead's calendar in HighLevel: if a "Live ·" booking is there, nothing more is needed; if not, book and mark it by hand | The rep |
| A room says "Not booked yet: a join marked by hand waits for a manager to count it." (alert `room_count_confirm`) | Only a hand press said the lead came in (nothing from the lead: no link opened, no knock, no Zoom join), so nothing was booked or marked. A manager checks with the rep and, if the call happened, presses Count this join on the room panel (`room.count_confirm`, audited): it is booked and marked shown as if the lead's own join had been seen | A manager |
| Alert `room_mark_intro` saying "the no-show could not be written" | sales-api, the cron door or HighLevel did not answer for ten real tries of the settle (an outage alone never uses them up). The room says `settled_mark` none and the intro is still open: the rep marks it shown or a no-show, never left "confirmed" (a show for B2B) | The rep |
| Alert `room_mark_intro` saying "HighLevel did not take the no-show, so it still says the intro is booked" | The settle wrote its no-show in the cockpit and HighLevel refused it five times (or the write was cut off half way). B2B reads HighLevel, where the intro still counts as shown: the rep marks it in HighLevel, or presses Send again on the call's mark in the dialer (it also takes a mark stuck "sending to HighLevel" for two minutes) | The rep |
| Alert `room_mark_intro` saying "their call is booked with another rep" (key `room:{id}:count_other_rep`) | The lead joined a room, and their intro or demo is booked with another rep: the count never moves or marks another rep's call. That rep or a manager marks it | The rep the call is booked with, or a manager |
| Alert `sweep_door` ("N of the sweep's calls to sales-live/cron were not taken") and the `sales-api/sweep` row red | The door refused the sweep's posts or never answered: replays, settles and re-checks are not reaching sales-api. Check sales-live is deployed with verify_jwt off (`desk.py deploy-check` says so) and that its `CRON_SECRET` equals the vault's `cockpit_sync_secret`; the alert clears on the first post the door takes | Hermes |
| A Take answers "You already have a live call or room open." | The closer was offered the lead while Ready, then opened a room for another lead: the claim refuses before anything moves, so the setter's room with the lead stays open. End the other room first, or let another closer take it | The closer |
| Hold answers "This opener is already going out, so it cannot be held now." | The desk's paced send had already claimed the opener. Read the conversation in HighLevel after it goes | The setter or the closer |
| The panel says "The link may have gone on WhatsApp" (or by email) | HighLevel's answer to the send was lost: the lead may have it. Read the conversation in HighLevel before sending again, or read the link out | The rep |
| Before switching Zoom rooms on (once) | Read the two Zoom endpoints on Mahara's plan: the live participant list (`/metrics/meetings/{id}/participants?type=live`) and the past-meeting participant report (`/past_meetings/{uuid}/participants`). If either is refused, the worker says so: a finished meeting is then left open with an alert rather than ended, which is safe but noisy, and the host check's report line turns red. The CEO adds the missing permission to the server-to-server app | Hermes, then the CEO |
| Before switching Zoom rooms on (once): the Zoom app's events | In the Zoom app's Event Subscriptions (the one that posts to `sales-live/zoom`), tick `meeting.deleted` beside the seven meeting events. A room whose meeting the host deletes in Zoom then fails with "The Zoom meeting was deleted in Zoom ... Make a new room." instead of waiting on a dead link | The CEO |
| A room says "The Zoom meeting was deleted in Zoom, so its link no longer works. Make a new room." | The host deleted the room's meeting in Zoom (its link answers "invalid meeting ID"). The rep makes a new room; the lead gets its link. The room is never settled as a no-show | The rep |
| Before switching Zoom rooms on (once, the phase-0 test) | On the test contact: open a Zoom room, join as host, leave as host, and see whether `meeting.ended` reaches `sales-live/zoom` and what its fields say (lc-logic F9). Write the answer into the room plan; the end rules assume it | Hermes |
| The cockpit says "Video rooms are not being made" (status row `rooms` older than 90 s) | On the VPS as `hermes`: `crontab -l` has the `rooms` line; `tail ~/.sales-desk.log`; `python3 desk.py rooms --once` shows what one tick does. A run that cannot reach the database says so in the log | Hermes |
| Rooms fail with the sweep's "did not start this room within a minute" | The worker was not running when the room was asked for (same checks as above). The rep makes a new room | Hermes |
| A room stays "being made" for about two minutes, then fails | A create went to Zoom and its answer never came, and Zoom's list never showed the meeting. The worker only looks for it (never a second create); the sweep fails the room at claim + 120 s and the worker closes the meeting if it shows up later. The rep makes a new room; check Zoom's status page if it repeats | The rep, then Hermes |
| The status row says "The video room tables are not in the database yet" | Apply `supabase/migrations/20261003a_sales_rooms.sql` | Hermes |
| The status row says "The rooms setting could not be read" | The worker claims nothing until it can read `rooms` in `cockpit_sales_settings`; check the database answers (`python3 desk.py doctor`) | Hermes |
| "Zoom is not connected on the room worker" | Set `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID` and `ZOOM_CLIENT_SECRET` in /opt/data/bibi/api-keys.env; the next minute's run uses them | The CEO |
| "Zoom is not answering" or "Google is not answering" in the status row | The provider timed out twice in a minute; its rooms fail at once for 30 s, then one call tests it again. Reps use the other provider meanwhile; check the provider's status page | Hermes |
| "Google is not connected on the room worker", "cannot use Calendar", or the doctor says the sign-in has no Calendar permission | Connect Google Calendar for the CEO's account and put the `GOOGLE_CAL_*` trio in /opt/data/bibi/api-keys.env; set `SALES_ROOMS_CALENDAR_ID` | The CEO |
| "Google refused the room worker's sign-in" | The Calendar sign-in lapsed or was revoked: connect Google Calendar again | The CEO |
| "Google would not make the Sales rooms calendar" | Create a calendar named "Sales rooms" in the CEO's Google Calendar, or set `SALES_ROOMS_CALENDAR_ID` in ~/.sales-desk/env | The CEO |
| "Google did not make the Meet link. Try Zoom." more than now and then | Google left the Meet link pending for 30 s. Use Zoom meanwhile; check Google Workspace status | The rep, then Hermes |
| "Your Zoom invite is not accepted yet" or "Your email has no Zoom user on Mahara's account" | The rep accepts Zoom's invite, or the CEO adds them in Zoom (no Team page control links a Zoom user yet) | The rep or the CEO |
| "Zoom (or Meet) is not checked for your seat yet" | The host check runs every 10 minutes (`desk.py rooms --check-hosts`); a new seat is checked on its next run. If it lasts, read the `room-hosts` status row | Hermes |
| "Meet rooms are down until the CEO reconnects Google on the room worker" | The one Google sign-in the room worker uses has lapsed: the CEO signs in again on the VPS (GOOGLE_* in `/opt/data/bibi/api-keys.env`), then `python3 desk.py doctor` | The CEO |
| "The room worker is running but making no rooms: ..." (the panel's health line; room.create says "Video rooms are down right now") | The worker writes its status every minute and claims nothing: the VPS clock is a minute off (fix it with timedatectl or chrony), the rooms setting cannot be read, or the rooms tables are missing (apply the latest sales migration). Then `python3 desk.py doctor` | Hermes |
| `desk.py deploy-check` says "lead messages in Arabic: not written yet" | Every room link a lead gets is English until `ROOM_COPY.lead_ar` is written under aziz-kuwaiti-voice and picked by `leadLanguage`; then set `LEAD_ARABIC_READY` in `desk/deploycheck.py`. It blocks the deploy check once `rooms.test_only` is off | The CEO, then Claude |
| The host check says a seat's default room "will fail" | The rep uses the other room until the seat's Zoom or Google works. A default chosen by hand is `cockpit_sales_room_hosts.default_provider` (no Team page control yet) | The rep, or the CEO |
| "The closer's Zoom is Basic and ends at 40 minutes" | The closer's seat lost its licence: set it to Licensed in Zoom, or run the demo on Meet | The CEO |
| "Your Zoom is in another meeting" | The host ends the other meeting, or picks Meet | The rep |
| Alert "Room ... has ended, but ... is still in its Zoom meeting" | The lead may be in a room the cockpit thinks is over (a lost join). The host checks the meeting in Zoom; the worker closes it once nobody outside the team is left, and stops checking after three hours | The rep, then a manager |
| Alert `room_stray_held` ("An extra Zoom meeting made for room ... is running with someone outside the team in it") | Two runs worked on one room and someone joined the meeting the room does not use. The host checks it in Zoom; the worker closes it once nobody outside the team is left | The rep, then a manager |
| The status row says "N extra Zoom meetings from overlapping runs closed" | Two runs worked on one room (most often a run by hand during the cron run); the extra meeting was closed. Run by hand only under the lock: `flock -w 10 $HOME/.sales-desk/rooms.lock python3 desk.py rooms --once` | Hermes |
| The host check says participant reports "could not be read" | The Zoom app lacks the report permission (past meeting participants): the CEO adds it to the server-to-server app | The CEO |
| A participant report does not match the cockpit (alert `room_report`) | A join was lost or marked by hand wrongly: check the room's events and correct the call's outcome | A manager |
| A cancelled room's Zoom meeting is still there | The worker deletes it within a minute (found by its code if it was never saved) and drops its host link after ten minutes even if Zoom refuses; `tail ~/.sales-desk.log` names Zoom's answer | Hermes |
| "sales-api refused the room message for N rooms" | sales-api does not take `room.event` (not deployed yet, or the key is refused). Links wait for the sweep or are not sent: deploy the rooms actions or check the service key | Hermes |
| "sales-api did not answer for N room messages" | The sweep replays the stored events about 20 s later. If it lasts, check sales-api answers `room.event` in under 2 s | Hermes |
| The log says "an event could not be taken with the lease" | The lease function is missing or refused: run `python3 desk.py deploy-check` and apply `20261003a_sales_rooms.sql` if it says so. Meanwhile the sweep replays the events, only slower | Hermes |
| Alert "N room events were given up today" | A Zoom, Slack, worker or claim event no room acted on (10 tries by room.event, or a day old; an outage alone never gives one up): open the room's events (`cockpit_sales_room_events` with `detail.gave_up`) and check sales-live and sales-api were up | Hermes |
| Daily: a "Live ·" booking in HighLevel that the cockpit never counted | A count that crashed between its own result write and deleting its booking leaves an orphan booking (contract-v2 section 16). Once a day while `rooms.count_on_join` is on: list HighLevel's appointments titled "Live ·" for the day and compare with `select code, count_appointment_id, count_result from cockpit_sales_rooms where count_claimed_at > now() - interval '1 day'`; any booking whose room's `count_result` is not `booked` is cancelled in HighLevel by hand | A manager |
| The `slack` status row says "SLACK_SALES_BOT_TOKEN is not set on the VPS" | Put the Mahara Sales app's Bot User OAuth Token in /opt/data/bibi/api-keys.env as `SLACK_SALES_BOT_TOKEN` (never in chat); the next minute's run uses it | The CEO |
| The `slack` status row says "Slack refused the Mahara Sales bot token" | The app was uninstalled or the token revoked: reinstall the Mahara Sales app and put its new bot token in /opt/data/bibi/api-keys.env | The CEO |
| The `slack` status row says replies were "refused by Slack (channel_not_found)" or `user_not_found` | The seat's Slack ID on the Team page is not that person's member id; a manager fixes it. A refused reply is closed, not retried | A manager |
| The `slack` status row says a reply "Slack did not confirm in time" | Slack took longer than 4 s; such a reply is not sent again (it may have arrived). If it repeats, check Slack's status page | Hermes |
| Slack replies wait while Slack is switched off | By design: the poster sends only while `live.enabled` and `live.slack` are on, and closes a reply older than ten minutes unsent | Nobody |

### Follow-up agent and backlog waves

`desk.py followups` (at :07 and :37) drafts follow-ups for approval; `desk.py waves` (every 5 minutes) runs the backlog waves a manager starts: it enrols, writes the day's openers and sends the approved ones paced. `followups.enabled` is the agent's off switch for both; the waves, openers, confirmation drafts and anything sent without a rep's approval also need `followups.agent` (ships off, Milestone 1). Status rows `sales-desk` / `followups`, `waves`, `model` and `doctor` (the hourly `doctor --cron`). Details: `hermes/sales-desk/NOTES-followup-agent.md`.

| Symptom | Fix | Who |
| --- | --- | --- |
| Before any wave copy shows a number | Count the pools read only: `python3 desk.py waves --pools` on the VPS (it writes nothing). The 24-hour wait and the demo-calendar rule lower the earlier counts (179 good intros, 227 unclosed demos), so the old numbers are never shown | Hermes |
| "No drafts can be written: The Claude sign-in on the VPS has lapsed" | SSH to the VPS as the CEO, run `claude`, then `/login`. Drafting resumes at the next :07 or :37 | The CEO |
| Waves row says "WhatsApp sends from the desk are off until the WA Connector is off and the single-copy test passes." | Uninstall the WA Connector. Send one template to the second test contact and see exactly one message. A manager then marks both in the cockpit | The CEO |
| Waves row says the opener templates are not set up | Create `opener_ar` and `opener_en` in HighLevel, each with a one-step workflow with "Allow re-entry". A manager saves the routes under Follow-ups, WhatsApp library | The CEO, then a manager |
| Waves row says "The database refuses the reactivate kind" | Apply migration `20261003b` (the follow-ups segment check) | Hermes |
| Waves row says an earlier day's openers still wait for approval | Approve, hold or skip them on the Follow-ups page | The setter or the closer |
| Waves row says the template budget is spent | A manager raises `whatsapp_guard.template_budget_usd_month`, after checking the wallet | The CEO |
| Waves row says sending stopped: HighLevel did not send it, or sales-api answered 5xx | Check HighLevel's status and the sales-api logs. The run tries again in 5 minutes, one send at a time | Hermes |
| Waves row says "The follow-up agent is switched off" or "The follow-up agent's own sends are switched off (followups.agent)" | Intended while `followups.enabled` is false, or `followups.agent` is not true (Milestone 1). Turn it on under Follow-ups settings, or pause the running waves | A manager |
| Openers set aside for a person | Follow-ups page: the draft shows the refusal. Fix it, release the hold, or skip it | The setter or the closer |
| The waves line says "The wave run is held: ..." or the waves row is red with a template or `wa_fields` sentence | A setup fault holds every opener of that template (it is never set aside lead by lead): set up the opener template's workflow under Follow-ups, WhatsApp library, or the `wa_fields` setting; the batch then goes from the queue | A manager |
| Openers wait with "This kind of opener is switched off" | `followup.level` Off for `reactivate.{ar,en}.whatsapp_template`: nothing of that kind is written or sent. Set it back to Approve, or pause the wave instead | A manager |
| A stop word left a lead waiting | Follow-ups page, stop task: "Yes, stop WhatsApp" or "No, pause the agent for 30 days" | The setter or the closer |
| Testing the agent | `python3 desk.py followups --contact <cockpit-test id> --segment no_show`. The draft says when do-not-disturb is on. Approving it must be refused | Hermes |
| A run by hand next to the cron | Use the same lock: `flock -n $HOME/.sales-desk/waves.lock python3 desk.py waves`. Without it, two runs still never send a draft twice or inside one gap, and only one writes the day's batch (leases on the `waves-draft-lease` and `waves-send-lease` status rows) | Hermes |
| A backlog opener says "The lead wrote in after this opener was written" or "The lead has a call booked now" | Taken back on purpose: the lead's own message is answered by a person (the reply draft comes at the next :07 or :37), and a booked lead gets no "How are you?" | Nobody |
| The Follow-ups page says "Backlog openers and automatic follow-ups are paused: N of the last M follow-up WhatsApp messages failed" (the waves row: sending stopped, paused) | Meta failed too many of the last day's follow-up WhatsApp messages (an empty wallet, the marketing limit). Fix the cause (top up the wallet), then a manager presses Clear the pause on that line; only sends from then on count. It also clears by itself once the failures are a day old | The CEO, then a manager |
| An opener in the batch says "Stopped mid-send" (the waves row: "asked for again") | Its send stopped half way (the function's time limit, a crash) and left its sending mark. After five minutes the desk's next run sends it again and Approve all approves it again; nothing to do unless it repeats | Nobody, then Hermes |
| A rep's Hold, then Release, on an approved opener | Release takes the approval back with the hold: the opener waits for the next Approve all, as the page says | The setter or the closer |
| An opener says "The send may have gone; read the conversation in HighLevel before writing to the lead again" | HighLevel's answer was lost after the template may have gone. It is kept as sent, so no second opener is written; a person checks the conversation | The setter or the closer |
| A lead outside the Gulf gets no opener | A first message goes 9 to 18 on the lead's own zone (every zone of a country that spans several); a country the desk does not know (`LEAD_ZONES` in sendrules.ts and followups.py) waits for a person | The setter or the closer |

## Hours, leave and pay

CEO cockpit, Team & payroll: Connections, then Hours and pay. Hubstaff (hours,
for people whose tracking is required) and Timetastic (leave and public
holidays, for everyone) are read by the Edge Function `cockpit-hours-sync` on
two pg_cron jobs, `mahara-hours-sync` (every hour at :17) and
`mahara-hours-deep` (02:40 Kuwait; Saturdays re-read back to Hubstaff's
earliest 10-minute records, 175 days: it never asks for older ones, so those
days are never swept or re-stamped). Each run is a
row in `cockpit_hours_sync_runs`; every provider call leaves receipts in
`cockpit_hours_provider_health` (its own ledger, so the guardian's urgent check
never turns red on it). Keys are pasted by the CEO in Connections and kept in
`cockpit_hours_keys`, which no role can read. Nothing here moves money, sends
a message or invites anyone.

| Symptom | Fix | Who |
| --- | --- | --- |
| Hours show "no data" | The day has no complete Hubstaff read, the person isn't linked, or Hubstaff isn't connected. Connections says which. Press Sync now; if a person is "Not linked", link them in Link accounts. No data is never counted as 0. | CEO |
| A key was refused, or expires soon | Make a new key (Hubstaff: Settings, Organization, API tokens; Timetastic: app.timetastic.co.uk/api as an admin) and paste it in Connections. The old key keeps working until the new one passes its test call. An organisation token (`hsoat_`) has no expiry unless one was set in Hubstaff; "Add an expiry date" on the card records one, and the card warns two weeks before. A personal token renews itself on every read, so the card offers no date for it. | CEO |
| Connections says "Firewall blocked" (Hubstaff, error 1010) | Cloudflare in front of Hubstaff stopped the request before Hubstaff saw it, so nothing new was read; the key is fine and is never marked refused for it. Cloudflare refuses requests without a User-Agent: every Hubstaff call sends `User-Agent: mahara-cockpit/1.0` (`HUBSTAFF_USER_AGENT` in `cockpit-ceo-api/tools.ts`). If it persists, check the deployed functions carry that `tools.ts` and redeploy both hours functions. The next good read marks the key connected again. | Systems manager |
| Hubstaff's personal key needs replacing ("needs a new key") | A personal token's exchange did not finish, so it may be spent. Make a new personal token in Hubstaff and paste it. An organisation token (`hsoat_`) avoids this. | CEO |
| After a database restore or a project move | Paste both keys again in Connections (a stored refresh token may already be used) and switch the old project's `mahara-hours-*` jobs off. | Systems manager, then CEO |
| Days are unverified | Hubstaff's daily totals and its 10-minute records differ by more than a minute. The next read usually settles it; approval of people paid by hours waits for it. If it persists, compare the day in Hubstaff's Time & Activity report. | CEO |
| A leave type has no pay rule | Leave types view: pick Paid, Unpaid, Part paid or Not time off. The suggestion is pre-selected; one click saves it. | CEO |
| A person is "Not linked" | Link accounts view: pick the person, or "Not on the roster". Timetastic links itself by payroll id (the roster id) and both link by email. | CEO |
| Hours changed after a month was approved | Nothing to do: the difference is carried into the next approval automatically and listed in the approve dialog. | nobody |
| The hourly read stopped | Check `cockpit_hours_sync_runs` (latest `started_at`) and that the jobs `mahara-hours-sync` and `mahara-hours-deep` are in `cron.job`. The kick needs the vault secret `cockpit_sync_secret` (state row `hours-kick` in `cockpit_sync_state` says when it is missing) and `cockpit-hours-sync` must be deployed with the JWT check OFF. | Systems manager |

Deploying (the lead session, never a builder). The Mac's management token is
dead since 2026-10-09, so `deploy_tree.py`, `sq.py`, `verify-preserved.py`
and ship.sh's auth preflight can't run as they are: SQL goes through the CEO's
Composio Supabase connection (`SUPABASE_BETA_RUN_SQL_QUERY`, as `postgres`),
and each function goes as one bun-built file (`SUPABASE_DEPLOY_FUNCTION` with
`file_content`; `bundleOnly` is the dry run). Build the web app and both
functions from the same commit: approval recomputes pay on the server with the
browser's rule (`hours-1`), and a different `hoursModel.ts` refuses every
approval as changed. In order:

1. Preflight, read only: `cockpit_people`, `cockpit_audit_log`,
   `cockpit_members`, `cockpit_sync_state` (with `rows_seen`),
   `cockpit_is_ceo()`, `cockpit_ceo_verified_actor_email(uuid)`,
   `cockpit_ceo_people_save(jsonb)`, `cockpit_ceo_people_set_pay(jsonb)` and
   `cockpit_people_schedule_check(jsonb)` exist; pg_cron, pg_net and the vault
   are on; the vault holds `cockpit_sync_secret` and the function secrets
   include `CRON_SECRET` (names only, never values). None of the 18 hours
   tables exists yet: `CREATE TABLE IF NOT EXISTS` would keep another table of
   the same name as it is.
2. Apply `20261009a_cockpit_team_hours.sql` (it carries its own BEGIN and
   COMMIT). Check: 18 tables with row security, `cockpit_hours_keys` with no
   grant at all, `cockpit_ceo_hours_*` granted to authenticated only.
3. Deploy `cockpit-hours-sync` with the JWT check OFF: the bundle of
   `supabase/functions/cockpit-hours-sync` plus
   `supabase/functions/cockpit-ceo-api/tools.ts`. A new function gets the
   platform's JWT default, so set `verify_jwt` false with a PATCH on the
   function and read it back. A POST with no `x-cron-secret` must answer 401.
4. Deploy `cockpit-hours-api` with the JWT check ON: the bundle of
   `supabase/functions/cockpit-hours-api` plus `cockpit-ceo-api/tools.ts`,
   `supabase/functions/cockpit-hours-sync` and, from
   `apps/media-buyer-cockpit/src/types/ceo/`, `hoursContract.ts`,
   `hoursModel.ts` and `schedule.ts`. Read `verify_jwt` back as true.
5. Seed both keys with `cockpit_hours_key_put`, from a script that reads
   `~/.config/mahara/hubstaff_token` and `timetastic_token` and prints neither
   the token nor the request: one `DO` block that first runs
   `set_config('request.jwt.claims','{"role":"service_role"}',true)` (the
   function refuses anyone but the service role), then puts
   `{provider:'hubstaff', kind:'hubstaff_org', accountId:'705266'}` and
   `{provider:'timetastic', kind:'timetastic', accountId:'101643'}`, each with
   `savedBy:'aziz@maharamedia.com'` and `state:'connected'` (both were checked
   read-only on 2026-10-09; `unchecked` would tell the CEO the provider
   couldn't be reached). Each put leaves one `hours.keySaved` audit row.
6. Apply `20261009b_cockpit_team_hours_jobs.sql`; `cron.job` then holds
   `mahara-hours-sync` and `mahara-hours-deep`, both active.
7. Start the first read: `SELECT public.cockpit_hours_kick('deep');`. Deep,
   not recent: only a deep read loads Timetastic's people (so the payroll-id
   links) and its leave types. Within a few minutes the newest
   `cockpit_hours_sync_runs` row is `ok`, `cockpit_sync_state` rows
   `hubstaff-sync` and `timetastic-sync` are ok, and Timetastic accounts are
   linked in `cockpit_time_accounts`.
8. Set `team_hours.state` to `deployed` in
   `docs/preserve/supabase-manifest.json`, and run
   `scripts/verify-preserved.py` with its management calls sent through
   Composio, so a lost object is MISSING from then on.
9. Ship the cockpit (`scripts/ship.sh media-buyer`, its auth preflight
   through Composio too), then open Team & payroll on production as the CEO:
   both connections say Connected.

## Hubstaff watch

CEO cockpit, Management tab: the "Hubstaff watch" card. Every 5 minutes the
pg_cron job `mahara-hours-watch` posts `{"job":"watch"}` to the Edge Function
`cockpit-hours-watch` (JWT check off, `x-cron-secret` from the vault's
`cockpit_sync_secret`). For each person who must track time and is on shift
now, it reads Hubstaff (`last_activities`, `activities`, `screenshots`,
`tool_usages`, `screenshot_settings`) with the key from Hours and pay, has each
new screenshot taken inside the shift judged once by a vision model (OpenAI
first, Google AI only when no usable OpenAI key is saved), and keeps at most one
open alert per person and kind in `cockpit_hours_watch_incidents`:
`not_tracking`, `not_work`, `idle`, and `source` (no person) when Hubstaff
cannot be read. Each alert is posted once to Slack #team-management
(`C0B5TL9H370`) and answered once in its thread when it clears. The opening
post starts with a mention of the CEO (`<@U09305KE2KS>`, settings `mention`
and `mentionUser`; the card's "Mention me in each alert" switch) so his phone
gets a push; thread replies never mention anyone. Screenshots never go to
Slack; a not-work one is copied into the private bucket
`cockpit-hours-watch`, which only the CEO can read. The model key is pasted in
the card's Settings and kept in `cockpit_hours_watch_keys`, which no role can
read. Each run is a row in `cockpit_hours_watch_runs` and writes the freshness
row `hours-watch` in `cockpit_sync_state` (the kick has its own row,
`hours-watch-kick`); every Hubstaff, model, Slack and storage call is receipted
in `cockpit_hours_provider_health`. The settings are the `cockpit_settings` row
`hours.watch`. Nothing here messages the person watched. The contract is
`docs/hours-watch/SPEC.md`.

| Symptom | Fix | Who |
| --- | --- | --- |
| No alerts arrive in #team-management, or they arrive but the CEO's phone gets no push | A push needs two things: the CEO is a member of #team-management (the bot posts there without joining, and nobody else is in it, so an alert in a channel he has not joined reaches no one; a mention of a non-member notifies nobody), and Settings, "Mention me in each alert" is on. Join the channel in Slack, then check the switch. For no alerts at all, first the card's header: the Slack alerts switch must be on. An alert that opened while it was off is recorded as muted and is never posted later; it is still on the card. With the switch on, the card says when the last check ran: "not scheduled" or "more than 15 minutes ago" is the run-stopped row below. Nobody on shift, or nobody past a threshold, also means no alert: Check now shows each person's state. | CEO, then Systems manager |
| Slack refused an alert ("Slack refused: ..." under the alert, "Slack refused the last alert" on the card) | The code says which. `not_in_channel` or `channel_not_found`: the channel id in Settings is wrong, or the channel is private and the bot must be invited (`chat:write.public` covers public channels only). `missing_scope`: the bot needs `chat:write.public`, and `channels:read` for the doctor's channel check. `invalid_auth`, `token_revoked` or `account_inactive`: `SLACK_BOT_TOKEN` was rotated; set it again as a function secret. Run the doctor (step 6 below) to confirm. A refused post, or one Slack never answered ("Slack did not answer"), is never sent again because it may have arrived; the alert stays on the card. | Systems manager (token, scopes), CEO (channel) |
| "Hubstaff cannot be read: ..." | One `source` alert opens and nobody is watched until Hubstaff can be read: no person's alert opens or closes on missing data (only the end of a shift closes one). The fix is the Hours, leave and pay one: paste a new key in Team & payroll, Connections, when it was refused; "Firewall blocked" is the Cloudflare row above. On the next good read the alert closes and replies "Hubstaff can be read again."; Check now runs one at once. `tool_usages` and `screenshot_settings` need an owner or manager key: when they are refused, the run carries on without app names or settings and says so in its notes. | CEO (key), Systems manager |
| "The screenshot check needs an AI key", "The saved ... key was refused", "The screenshot check is failing: ..." or "The screenshot check is off" | Settings on the card, Screenshot check key: paste an OpenAI key (the box preselects OpenAI; OpenAI does not train on API data, and the screenshots show leads' details). A Google AI key works too, only from a billed project. The key is tested with one model list call before it saves and is never shown again; the save message names the provider the next run will use. The run uses the first saved key that is not refused, OpenAI first, then Google AI. A key the model refuses mid-run (401, OpenAI 403 that is not about a model, Google `API_KEY_INVALID` or `PERMISSION_DENIED`) is marked refused, and the rest of that run's screenshots are `skipped`; a key pasted during the run is never marked by the old key's failure. Without a key, screenshots are recorded as `skipped`; when the model fails, the screenshot is marked `error` and tried again on later runs, up to 3 attempts; neither ever counts as not work. "Failing" means the last 3 model checks in the last hour all failed: paste a new key. A screenshot that could not be downloaded (an expired Hubstaff link) is an error too, but never makes the check read failing. "The screenshot check is off" is the Screenshot check switch in Settings. The systems manager can store the key from the VPS instead (step 5 below). | CEO, or Systems manager |
| A false alarm | Open the alert on the card, look at its screenshots and press Mark reviewed. A note is optional and is kept on the alert only: the audit row (`hours.watch.review`) records whether there was one (`hasNote`), never its text. Reviewing neither closes the alert nor recalls the Slack post: the alert closes itself when the condition clears. If one kind keeps misfiring, raise its threshold in Settings, When to alert. Not work: "Only when the check is at least" (50 to 99%), "Screenshots off work" (1 to 6) and "Screenshots looked at over" (20 to 120 minutes). Not tracking: "Alert after Hubstaff is off for" (10 to 240 minutes) and "Grace after the shift starts" (0 to 120). Idle: "Keyboard and mouse below" (1 to 50%) and "Keyboard and mouse measured over" (20 to 240 minutes). Each save is one `hours.watch.set` audit row with the values before and after, and the next check uses it. An alert outside the person's real hours means their schedule is wrong: fix it in Team & payroll. What the watch already allows for, so an alert in these cases is a real one or a wrong record: **Lunch break**: when the shift is longer than the Hours rules' "break when longer than" (6 hours by default), the first stop of the day after the person has tracked waits the break plus the grace (60 + 15 minutes by default, never less than "Alert after Hubstaff is off for") before it alerts, and the card shows "On a break since 13:00" meanwhile, not needing a look; every later stop waits "Alert after Hubstaff is off for". With that setting under 30 minutes, Hubstaff's 20-minute delay can give a stop soon after the break the long wait again. **Leave**: Timetastic leave, approved or pending, that covers the whole shift takes the person off all day ("On leave"). Part-day leave (Morning = shift start to its midpoint, Afternoon = midpoint to shift end, an hours booking = its times on the schedule's clock) is off time only inside its window: no not-tracking alert opens while it lasts, the off time counts from its end, and the idle and not-work checks skip it; the shift line draws it as off time. **No schedule**: someone paid by the hour with no schedule at all is not watched ("No schedule set", set one in Team & payroll); someone on fixed pay with no schedule is watched on the default Saturday to Thursday 10:00 to 18:00. **Screenshots** taken before the shift starts or after it ends are not checked, stored or shown. | CEO |
| The run stopped (guardian: `hours-watch` late or failing; card: "more than 15 minutes ago" or "not scheduled") | Read the `cockpit_sync_state` rows `hours-watch` (its note says why the last run failed) and `hours-watch-kick` (it names a missing vault `cockpit_sync_secret` or a missing pg_net). Check that `mahara-hours-watch` is in `cron.job` and active, that `cockpit-hours-watch` is deployed with the JWT check OFF (a POST with no `x-cron-secret` must answer 401), and that `CRON_SECRET` equals the vault's `cockpit_sync_secret`. In the newest `cockpit_hours_watch_runs` rows, `abandoned` means a run outlived its 6-minute lease (a cron tick that lands while a run holds it simply finds it busy); the next one starts normally. A run that cannot read Hubstaff ends `failed` on purpose, so fix that row first. Check now runs one at once. | Systems manager |
| A person is missing from the watch | The watch looks at people who are active, not a bot, and required to track: their Tracking in Team & payroll, Hours and pay, People and rules, else the role default (call centre agents and the media buyer). Set their Tracking to Required. Listed as "Not on the team": no employment period covers today, or their end date has passed; "Paused": a pause covers today; "Off today": today is not a working day on their schedule; "No schedule set": paid by the hour with no schedule (set one in Team & payroll). "Not in Hubstaff": link their account in Link accounts (an invite not yet accepted counts as no account). That alert is posted once and stays open across shifts until the account is linked, or the person is no longer watched, not employed or paused (it then closes as no longer watched). Settings, Who is watched, lists everyone the watch sees. | CEO |

Deploying (the lead session, never a builder). As for Hours, leave and pay:
SQL goes through the CEO's Composio Supabase connection
(`SUPABASE_BETA_RUN_SQL_QUERY`, as `postgres`), and each function goes as one
bun bundle through `scripts/dev/deploy_composio.py`, run from a throwaway
worktree at merged main (it deploys a git revision, never the working tree).
`20261009a`, `20261009b` and `20261011e` must already be applied. The function
secrets `CRON_SECRET` (equal to the vault's `cockpit_sync_secret`) and
`SLACK_BOT_TOKEN` are project-wide and already set for the hours functions; the
Slack bot needs `chat:write.public` and `channels:read`. In order:

1. Apply `20261013d_cockpit_hours_watch.sql` with Composio
   `SUPABASE_APPLY_A_MIGRATION`, its BEGIN and COMMIT lines stripped:

   ```sh
   python3 - <<'PY' > /tmp/hours-watch-migration.json
   import json, re
   sql = open("supabase/migrations/20261013d_cockpit_hours_watch.sql").read()
   sql = re.sub(r"(?im)^\s*begin;\s*$", "", sql); sql = re.sub(r"(?im)^\s*commit;\s*$", "", sql)
   print(json.dumps({"ref": "bldgtotkfmhoxmlzowdx", "name": "20261013d_cockpit_hours_watch", "query": sql}))
   PY
   composio execute SUPABASE_APPLY_A_MIGRATION -d @/tmp/hours-watch-migration.json < /dev/null | head -c 400; rm -f /tmp/hours-watch-migration.json
   ```

   Check: six `cockpit_hours_watch_*` tables with row security,
   `cockpit_hours_watch_keys` with no grant at all, the three
   `cockpit_ceo_hours_watch_*` functions and `cockpit_hours_watch_object_allowed`
   granted to authenticated only, and `mahara-hours-watch` in `cron.job`. The
   job starts at once; until step 3 each kick gets a 404, which does no harm.
2. Switch the Slack alerts off before anything can run: the migration seeds
   them on. As the CEO, that is `cockpit_ceo_hours_watch_set('{"on":false}')`
   (the card's Slack alerts switch, once the cockpit is shipped). Before that,
   directly in `cockpit_settings`, with the audit row the function would write:

   ```sql
   with b as (select value from public.cockpit_settings where key = 'hours.watch'),
        a as (update public.cockpit_settings set value = value || '{"on":false}'::jsonb,
                updated_by = 'aziz@maharamedia.com', updated_at = now()
              where key = 'hours.watch' returning value)
   insert into public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, "before", "after")
   select 'hours.watch.set', 'cockpit_settings', 'hours.watch', 'aziz@maharamedia.com', 'ceo', 'supabase', b.value, a.value from b, a;
   ```

   `select value->'on' from public.cockpit_settings where key = 'hours.watch'`
   must read `false`.
3. Deploy `cockpit-hours-watch` with the JWT check OFF:

   ```sh
   python3 scripts/dev/deploy_composio.py cockpit-hours-watch --extra supabase/functions/cockpit-ceo-api/tools.ts supabase/functions/cockpit-hours-sync/db.ts supabase/functions/cockpit-hours-sync/keys.ts supabase/functions/cockpit-hours-sync/normalise.ts --verify-jwt off
   ```

   Read `verify_jwt` back as false. A POST with no `x-cron-secret` must answer
   401.
4. Deploy `cockpit-hours-api` with the JWT check ON (it gains the ops
   `watchNow`, which uses `CRON_SECRET`, and `watchKey`):

   ```sh
   python3 scripts/dev/deploy_composio.py cockpit-hours-api --extra apps/media-buyer-cockpit/src/types/ceo/hoursContract.ts apps/media-buyer-cockpit/src/types/ceo/hoursModel.ts apps/media-buyer-cockpit/src/types/ceo/schedule.ts supabase/functions/cockpit-ceo-api/tools.ts supabase/functions/cockpit-hours-sync/db.ts supabase/functions/cockpit-hours-sync/keys.ts supabase/functions/cockpit-hours-sync/lease.ts supabase/functions/cockpit-hours-sync/normalise.ts supabase/functions/cockpit-hours-sync/sync.ts supabase/functions/cockpit-hours-watch/classify.ts supabase/functions/cockpit-hours-watch/inputs.ts supabase/functions/cockpit-hours-watch/keys.ts supabase/functions/cockpit-hours-watch/ledger.ts --verify-jwt on
   ```

   Read `verify_jwt` back as true. Build it from the same commit as the web
   app (Hours and pay approval compares `hoursModel.ts`).
5. Store the OpenAI key first (OpenAI does not train on API data; the
   screenshots show leads' details). From the repository root, run
   `scripts/dev/hours_watch_key.py` on the VPS:

   ```sh
   ssh -i ~/.ssh/faris-key hermes@187.77.156.166 'python3 - openai' < scripts/dev/hours_watch_key.py
   ```

   It reads `OPENAI_API_KEY` from `/opt/data/bibi/api-keys.env` and the
   service key from the native runtime file, tests the key with one model list
   call, saves it through `cockpit_hours_watch_key_put` and prints no secret.
   `'python3 - google_ai'` stores `GOOGLE_AI_API_KEY` the same way; use it only
   with a billed Google project, and only as a second key (OpenAI is used
   whenever its key is saved and not refused). Or, once the cockpit is shipped,
   the CEO pastes it in the card's Settings, Screenshot check key.
   `select provider, state, saved_at from public.cockpit_hours_watch_keys`
   must show `openai` `connected`, and one `hours.watch.keySaved` audit row is
   written (never the key).
6. Run the doctor. It writes nothing but receipts, and the secret stays in the
   vault:

   ```sql
   select net.http_post(url := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/cockpit-hours-watch',
     headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cockpit_sync_secret')),
     body := '{"job":"doctor"}'::jsonb, timeout_milliseconds := 60000);
   -- a few seconds later, with the id it returned:
   select status_code, left(content::text, 2000) from net._http_response where id = <id>;
   ```

   It must answer 200 with `"ok": true`: secrets set, Hubstaff connected
   ("screenshots are on for N people"), the AI key connected, the Slack
   channel ok. Anything else is named in its `note`: fix it from the table
   above before going on.
7. A dry run: the same call with body `'{"job":"watch","dryRun":true}'::jsonb`
   and `timeout_milliseconds := 120000`. It reads Hubstaff and answers the plan
   ("Dry run: nothing written."): `onShift`, each person's status, and the
   alerts it would open or close. It checks no screenshots, writes, posts,
   stores or prunes nothing, and leaves no freshness row. The people and
   states must match who is really on shift.
8. Add the CEO to #team-management in Slack (nobody else is in it, and the
   bot posts without joining, so until he is a member no alert reaches anyone)
   and check that `select value->'mention', value->'mentionUser' from
   public.cockpit_settings where key = 'hours.watch'` reads `true` and
   `"U09305KE2KS"`. Then switch the Slack alerts on: the card's switch if the
   cockpit is shipped, else the SQL of step 2 with `'{"on":true}'`. Alerts that
   opened while they were off stay muted; only new ones are posted. The first
   real alert must push to the CEO's phone.
9. The guardian already watches `hours-watch` (`"hours-watch": 15` in the
   `run_jobs` keys of `hermes/cockpit-guardian/checks/sections.py`, tested in
   `tests/test_checks_data.py`; `python3.11 -m unittest` there). Update the
   guardian on the VPS only once a real run has written the `hours-watch` row
   (any run since step 3 that was not a dry run), or it reports it late.
10. Set `hours_watch.state` to `deployed` in
    `docs/preserve/supabase-manifest.json` and run
    `scripts/verify-preserved.py --via composio --problems`, so a lost object
    is MISSING from then on.
11. Ship the cockpit (`scripts/ship.sh media-buyer`, its auth preflight
    through Composio; it refuses until step 1 is live), then open the
    Management tab on production as the CEO: the card lists each watched
    person, Hubstaff and the screenshot check read connected, and Slack alerts
    are on.

To stop it: switch the alerts off (step 2) to stop the Slack posts while the
card keeps working; to stop the runs too,
`select cron.unschedule(jobid) from cron.job where jobname = 'mahara-hours-watch';`
and take `hours-watch` out of the guardian's keys. The alerts are kept.

## EOD Radar

CEO cockpit, Management tab: the "EOD Radar" card (built 2026-10-15; it
replaces the OpenClaw daemon on the VPS, whose Slack bot "Aziz's Assistant" was
deleted, so it has marked everyone missed since 3 August). At minutes 1 and 31
the pg_cron job `mahara-eod-radar` posts `{"job":"run"}` to the Edge Function
`eod-radar` (JWT check off, `x-cron-secret` from the vault's
`cockpit_sync_secret`). It reads the five EOD channels (`#tech-eods`,
`#media-eods`, `#eods-csms`, `#eods-salesreps`, `#eods-csr`, all private) as
mahara-club-bot with `SLACK_BOT_TOKEN`, credits each post to a person (the
cockpit outbox row Slack has under that ts, else "Submitted by: <@id>", else
the "*Name - X*" line, else who posted it; a name that fits two people credits
nobody and is listed as unmatched; "[TEST SUBMISSION]" posts are skipped; a
message with no Date, Name or Submitted by line counts only in the poster's own
EOD channel, only with 40 words, or an "EOD" first line and 20 words or 3 lines
under it, and never when it opens with an @mention) and
writes one row per person per working day to `cockpit_eod_radar`: on time
(by 22:00 Kuwait on the EOD day), late (with the minutes), missed (only after
23:00 and only when every channel was read), pending, leave (a full-day
Timetastic booking, approved or pending), off (Friday, before the roster, after
the last day, paused, public holiday) or not read (Slack refused a channel, or
the person has no Slack id). The EOD day is the post's Date line, else Kuwait
time minus 4 hours. The window is today's working day and the `lookback_days`
before it (2), so a post that arrives late is credited. After 23:00 it posts
one closeout line in #team-management ("EOD Radar, Wed 14 Oct: 6 on time, 1
late, 2 missed (...), 1 on leave."), once per day (`cockpit_eod_radar_digests`).
While a channel cannot be read the post waits for the next runs, until 03:00
Kuwait the next morning, and then goes with a "Could not read" line. A run that
cannot read a channel never undoes a credit already written: an on-time or late
row stays until a new credit, or a missed day once every channel was read,
replaces it (`cockpit_eod_radar_apply`, `kept` in the run's detail).
Nobody is ever messaged directly; reminders and strikes are not built and the
settings row cannot switch them on. Who files where is `cockpit_eod_channels`
(a regex on the roster role). Slack ids are `cockpit_eod_radar_slack_ids`,
looked up by email weekly (seeded 2026-10-15). Each run writes the freshness
row `eod-radar` (the kick has `eod-radar-kick`); every Slack call is receipted
in `cockpit_eod_radar_receipts` (30 days). The settings are the single row of
`cockpit_eod_radar_settings`.

| Symptom | Fix | Who |
| --- | --- | --- |
| "Could not read #x: the Slack app needs the groups:history scope" | The five EOD channels are private. In api.slack.com/apps, mahara-club-bot, OAuth & Permissions, add the bot scope `groups:history` (and `users:read`, `users:read.email` for the email lookup), reinstall the app, and keep `SLACK_BOT_TOKEN` (reinstalling does not change a bot token; if Slack issues a new one, set it as a function secret). The people of that channel read "not read" until then, never missed. | CEO (Slack admin) |
| "Could not read #x: the bot is not in it" | Invite @mahara-club-bot to the channel (`/invite @mahara-club-bot`). A new EOD channel also needs a row in `cockpit_eod_channels`. | CEO or Systems manager |
| Someone reads missed but filed | Open the person on the card: the day says what was looked for. Their post named someone else or nobody (the card's "named nobody on the radar" line), or it was posted with a Date line more than 14 days back or in the future (counted for the day it was posted). A Make form whose "Submitted by" carries a person who has left still credits the Name line. A plain message (no Date, Name or Submitted by line) counts only in their own EOD channel and only when it reads like an EOD (40 words, or an "EOD" first line with 20 words or 3 lines under it, not opening with an @mention): a one-line "EOD done" or a reply in another team's channel is not credited. A post that only lives in the EOD sheet or Typeform is not read: the radar reads Slack and the cockpit's sent EODs. Run a backfill once the cause is fixed. | Systems manager |
| "No Slack id for X" | The roster has no email for them, or Slack has no member with it. Add their work email on Team & payroll; the next run looks it up. Until then only posts that carry their Name line credit them, and a day with none reads "not read". | CEO |
| "Not on the radar: X (role)" | Their role matches no row of `cockpit_eod_channels`. Add a row (`role_pattern` regex, `channel_id`, `channel_name`) if the role files EODs. | Systems manager |
| The closeout post did not arrive | `select * from cockpit_eod_radar_digests order by day desc limit 3`. `failed` names Slack's refusal (it is tried again up to 3 times while the day is current); `unknown` may have arrived and is never sent again; no row means the digest is off, nobody owed an EOD, no run reached 23:00, or a channel could not be read and the post is waiting for the 03:01 and 03:31 runs. | Systems manager |
| The run stopped (card: "The last run was ...") | Read the `cockpit_sync_state` rows `eod-radar` and `eod-radar-kick` (a missing vault secret or pg_net is named there). Check `mahara-eod-radar` is in `cron.job` and active, `eod-radar` is deployed with the JWT check OFF (a POST with no `x-cron-secret` answers 401), and `CRON_SECRET` equals the vault's `cockpit_sync_secret`. | Systems manager |

Deploying (the lead session). In order:

1. Deploy `eod-radar` with the JWT check OFF, from a throwaway worktree at
   merged main:

   ```sh
   python3 scripts/dev/deploy_composio.py eod-radar --extra supabase/functions/cockpit-hours-sync/db.ts supabase/functions/cockpit-ceo-api/tools.ts --verify-jwt off
   ```

   Secrets by name, already set project-wide for the hours functions:
   `CRON_SECRET`, `SLACK_BOT_TOKEN`.
2. Apply `20261015210000_eod_radar.sql` (Composio `SUPABASE_APPLY_A_MIGRATION`,
   BEGIN and COMMIT stripped, as for the Hubstaff watch). It needs
   `20261009a` and `20260922a`. The job starts at once.
3. Doctor: `net.http_post` to the function with body `'{"job":"doctor"}'::jsonb`
   (as step 6 of the Hubstaff watch). It names any missing scope and each
   channel it cannot read.
4. A dry run with body `'{"job":"backfill","days":14,"dryRun":true}'::jsonb`:
   compare its rows with what the channels show, then a real backfill without
   `dryRun` to fill the card.
5. Ship the cockpit (`scripts/ship.sh media-buyer`) and open Management.

To stop the closeout post: `update cockpit_eod_radar_settings set digest_on = false`.
To stop the runs: `select cron.unschedule(jobid) from cron.job where jobname = 'mahara-eod-radar';`.
The old daemon on the VPS is separate: stop it there (both copies) so
#team-management does not get its false lines.

## Meta ad-days (the Client Performance board's ad numbers)

Built 2026-10-16 for the shared Client Performance board. The Edge Function
`meta-ad-days` (JWT check off, `x-cron-secret` from the vault's
`cockpit_sync_secret`) reads Meta, GET only, Graph v25.0 pinned in
`graph.ts`, with `META_SYSTEM_TOKEN`. Each run first asks Mahara's business
(767701513092162, `owned_ad_accounts` and `client_ad_accounts`, one call
each) which ad accounts spent, leaves out Mahara's own account
(746108264865897), then reads every spending account's ad-level insights a
day at a time (`time_increment=1`, `use_unified_attribution_setting=true`)
in pieces of up to 7 days. Rows go to `cockpit_meta_ad_days`, one per ad per
ad-account day, upserted by (ad_id, day): a later read replaces a row, an
earlier one never does, and nothing is deleted because an ad stopped. Days
are each ad account's own calendar (`account_timezone`); the CRM is on
Kuwait time. NULL means Meta did not return it, never 0: an image ad has no
video numbers, and `leads` (lead-form leads) is filled only on lead
campaigns (`OUTCOME_LEADS`, `LEAD_GENERATION`), and never on a lead ad set
whose destination is a chat (WhatsApp, Messenger, Instagram Direct). Those
report Meta's `lead` for leads marked in the chat
(`onsite_conversion.lead`), which are not form leads, so their `leads` is
NULL and their spend stays out of cost per lead (Pidco's two WhatsApp lead
ad sets, 2026-10-16). Each days read looks up its lead ad sets' destination
(`act_<id>/adsets`, one call per 50, none for an account without a lead
campaign) into `destination_type`; a deleted ad set Meta no longer lists
keeps NULL there, its messaging leads are taken out by action type, and the
task's note names it. `lead_actions` keeps Meta's `lead` action on every
objective, messaging leads included, so it matches the account-level count.
Spend is kept in the account currency and in USD at the cockpit's fixed
rates (`cockpit_meta_ad_days_usd_per`, the same table as `tap.js` USD_PER
and `calculator.ts` FX); a currency without a rate leaves `spend_usd` NULL
and the run's note names it. Reach over the five windows (last 7, 14 and 30
days, this month, last month, on Kuwait's calendar) is in
`cockpit_meta_reach` per account, campaign, ad set and ad, read from Meta's
own `time_ranges`, and per client (GoHighLevel location) as the sum of its
accounts through `cockpit_board_clients`; frequency over a window is that
row's impressions / reach. A client's reach is empty, with the account
named, while one of its accounts could not be read or still holds an earlier
day's windows: after Kuwait midnight the hourly run re-reads only the
accounts that spent in the last two days, so until the nightly run an
account that spent earlier in the window would otherwise drop out of the
client's sum. While the client spine is missing or empty, reach stays at
account level and the note says so.

The jobs (pg_cron, migration `20261016121700_meta_ad_days.sql`):
`mahara-meta-ad-days-hourly` at minute 7 (yesterday and today of every
spending account, and account-level reach), `mahara-meta-ad-days-nightly` at
00:20 UTC, 03:20 Kuwait (the 28 days before today again, because attribution
settles, and reach at every level), and `mahara-meta-ad-days-drain` every 2
minutes, which posts `{"job":"continue"}` only while a task waits. A backfill
of up to 90 days runs only on request. Each run is a row in
`cockpit_meta_ad_day_runs` with a plain note (accounts read, ad-days written,
accounts that could not be read and why, accounts "not linked to a client",
currencies without a rate); its work is `cockpit_meta_ad_day_tasks` (leased 5
minutes, 4 tries, a rate limit waits 3, 6, 9 minutes). Freshness rows in
`cockpit_sync_state`: `meta-ad-days-hourly`, `-nightly`, `-backfill`,
`-doctor` and `-kick` (a missing vault secret or pg_net is named there).
Every Graph call is receipted in `cockpit_meta_ad_day_receipts` (30 days),
every run leaves one audit row (`meta_ad_days.run`). One look at all of it:
`select public.cockpit_meta_ad_days_status();` in the SQL editor.

| Symptom | Fix | Who |
| --- | --- | --- |
| Note: "META_SYSTEM_TOKEN is not set" or "Meta refused ... (code 190 ...)" | Make a new system-user token in Business Settings (ads_read on the client accounts) and set it as the function secret `META_SYSTEM_TOKEN`. The other cockpit functions read the same secret. | CEO |
| Note: "Could not read <account>: ... not shared with Mahara's business" (code 10, 200s or 100/33) | In Business Settings, share the ad account with the business and give the system user access to it. Until then that account's rows stop at the last good day, and `cockpit_meta_ad_days_status()` names it as failing with Meta's reason. | CEO |
| Note: "Meta's rate limit; a later run reads it again" | Nothing, unless it repeats for hours: then read the receipts (`select * from cockpit_meta_ad_day_receipts where error is not null order by id desc limit 20`). | Systems manager |
| Note: "Not linked to a client: X (id, currency, spend)" | The account spends but no client row carries it. Add the tie (`clients.meta_ad_account_id` / `ghl_location_id`, or a `ghl_client_ad_accounts` row); the board's facts refresh picks it up and the next run ties it. The account's ad-days are kept meanwhile. | Client success or systems manager |
| Note: "No USD rate for EUR on X" | Add the currency to `USD_PER` in `hermes/ceo-refresh/native/data/tap.js`, `FX` in `hermes/cockpit-sync/calculator.ts` and `cockpit_meta_ad_days_usd_per` in a new migration (the migration test pins the three together). The nightly rewrite fills the last 28 days; run a backfill for older ones. | Systems manager |
| The board says the ad numbers are behind | Read `meta-ad-days-hourly` and `meta-ad-days-kick` in `cockpit_sync_state`. Check the three `mahara-meta-ad-days-*` jobs are in `cron.job` and active, `meta-ad-days` is deployed with the JWT check OFF (a POST without `x-cron-secret` answers 401), and `CRON_SECRET` equals the vault's `cockpit_sync_secret`. A run stuck "running" is closed by itself after 50 minutes (hourly), 6 hours (nightly) or 12 hours (backfill). | Systems manager |
| A client's reach and frequency are empty with "Ad account X not re-read since <day>; this client's reach waits for the nightly run" | Normal between Kuwait midnight and the end of the nightly run (03:20 Kuwait and a few minutes): the account delivered earlier in the window but not in the last two days, so the hourly run did not re-read it. If it is still there after 04:00 Kuwait, read `meta-ad-days-nightly` in `cockpit_sync_state`. | Nobody, or the systems manager after 04:00 |
| Frequency over a window is empty for a campaign, ad set or ad | Those rows are written by the nightly run only (03:20 Kuwait); account and client rows are refreshed hourly. Before the first nightly there are none. | Nobody |
| A client's reach is empty with "Ad account X has not been read for this window yet" | The account delivered inside the window but has no reach row for it (the backfill reads no reach; the hourly run reads only accounts that spent in the last two days). The nightly run reads it. Before 2026-10-16 such an account was left out of the client's sum with no note (Marble and more). | Nobody, or the systems manager after 04:00 |
| Note: "Hidden on purpose: X" | A clients row hides the account (`hidden_from_dashboard`), it is Mahara's own (Mass Design), or a hand row keeps it out of its client's figures (`cockpit_board_account_ties.kept_out`: Alkhalil's own post-boost account 640644143620696 since 16 Oct). Its ad-days are kept. If it belongs on a client, add a hand tie (`cockpit_board_account_ties`, in a migration with the evidence), or set `kept_out` to false once the media buyer confirms Mahara runs it. | Client success, media buyer |
| Note: "Spent for a cancelled or stopped client: X", or `status()->'cancelledDelivering'` | The account delivered in the last two days for a client whose card says Stopped or the registry Cancelled (Pidco, AEA, Ideal Elite on 16 Oct). Switch its ads off, or fix the client's card if the client is back. | Media buyer, client success |
| Doctor: "Meta stops delivery on: X (unsettled, last spend ...)", or `status()->'billingStopped'` | Meta's `account_status` is not active for an account tied to a live client (3 = unsettled billing: ARCWANI since 9 Oct, Liwan since 12 Oct). Ask the client to settle billing; `mahara-ad-billing-watchdog` already alerts. | Client success |
| Note: "Lead ids read for N accounts (X: Meta gives no lead access for N of M ads ...)" | The nightly run reads each lead ad's lead ids and times (never `field_data`) for `cockpit_meta_leads_not_in_crm`. An ad whose Page gives Mahara no lead access is skipped (Ardon on 16 Oct). Ask the client to give Mahara's business lead access on the Page (Page settings, Leads access). | CEO |
| "Meta leads not in the CRM" is empty for a client, with "Meta's lead ids ... have not been read yet", "... are held from <day>" or "Meta does not show this client's form leads" | `cockpit_meta_leads_not_in_crm` gives NULL, never 0, when it cannot know: an account no nightly run has read yet, a window before the lead ids held (`cockpit_meta_lead_id_cover`), or no lead access on the Page. The first two fill by themselves after the nightly run; the third needs the client to give Mahara's business lead access on the Page. | Nobody, or the CEO for lead access |

Deploying (the lead session). In order:

1. Deploy `meta-ad-days` with the JWT check OFF, from a throwaway worktree at
   merged main (it imports nothing outside its folder):

   ```sh
   python3 scripts/dev/deploy_composio.py meta-ad-days --verify-jwt off
   ```

   Secrets by name, already set project-wide: `META_SYSTEM_TOKEN`,
   `CRON_SECRET` (the platform gives `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY`).
2. Apply `20261016121700_meta_ad_days.sql` (`scripts/dev/apply_migration.py`,
   or Composio `SUPABASE_APPLY_A_MIGRATION` with BEGIN and COMMIT stripped).
   It needs the cockpit core (`cockpit_sync_state`, `cockpit_audit_log`); it
   loads before or after the board's facts migration. The hourly job starts at
   once.
3. Doctor, reads only:

   ```sql
   select net.http_post(url := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/meta-ad-days',
     body := '{"job":"doctor"}'::jsonb,
     headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',
       (select decrypted_secret from vault.decrypted_secrets where name = 'cockpit_sync_secret')));
   -- then: select status_code, content from net._http_response order by id desc limit 1;
   ```

   It names a missing secret, the system user, the accounts that spend and
   the ones not linked to a client.
4. A dry run of the backfill (same call, body
   `'{"job":"backfill","days":90,"dryRun":true}'::jsonb`) lists the accounts
   and the reads; then the real one without `dryRun`. The drain finishes it
   over a few minutes.
5. Second source: compare 30 days of the store with Meta's own numbers
   (Ads Manager, same days, unified attribution): spend and Meta's leads at
   the account row; form leads at the ad set rows of lead campaigns whose
   conversion location is an instant form or a website, not WhatsApp,
   Messenger or Instagram Direct:

   ```sql
   select account_id, account_name, account_currency, sum(spend) spend, sum(lead_actions) meta_leads, sum(leads) form_leads,
          sum(spend) filter (where leads is not null) form_spend,
          sum(lead_actions) filter (where destination_type ~ '^(WHATSAPP|MESSENGER|INSTAGRAM_DIRECT|LEAD_FROM_|MESSAGING_)') chat_leads
   from cockpit_meta_ad_days where day between current_date - 30 and current_date - 1 group by 1, 2, 3 order by 4 desc;
   ```

   On 2026-10-16, after the WhatsApp fix, all 27 spending client accounts
   read this way over 30 days (16 Sep to 15 Oct) matched Meta: spend to the
   cent, impressions, link clicks, Meta's leads, and form leads (841) and form
   spend from Meta's ad set rows by destination. Pidco: 12 Meta leads = 8 form
   leads + 4 WhatsApp leads, so $60.31 / 8 = $7.54 a lead, not $553.00 / 12.
   One account's impressions moved between two reads nine minutes apart (Meta
   still settling; equal on the re-read), which is why the nightly run reads
   the last 28 days again.

Corrections of 2026-10-16 (after the second-source check, `docs/client-performance/SOURCES.md`):
apply `20261016210100_meta_ad_days_checked.sql` and deploy `meta-ad-days` (either order: an older function
sends no lead-ids ask and reads only the five windows' spans; a newer function on an older database gets
no lead-ids tasks). The next hourly run reads the seven windows; the next nightly run reads the lead ids.

To stop the runs: `select cron.unschedule(jobid) from cron.job where jobname like 'mahara-meta-ad-days-%';`.
The stored rows stay, and `cockpit_meta_ad_days_status()` gives each account's last day and last read.

## Client facts (the Client Performance board's business numbers)

Built 2026-10-16 for the shared Client Performance board. The plpgsql
function `cockpit_board_facts_refresh(from, to)` (migration
`20261016111157_board_facts.sql`) runs inside the database as `postgres`, by
pg_cron: `mahara-board-facts` at minutes 10 and 40 rebuilds today and the two
days before, `mahara-board-facts-nightly` at 00:50 UTC (03:50 Kuwait) the last
120 days. It calls nothing outside the database. It writes three tables, none
readable by a browser (the board's own read functions are the only door):

- `cockpit_board_clients`: one row per GoHighLevel location with its ClickUp
  card, status, service mode, TikTok flag and every Meta ad account tied to it
  (digits only), tied the way the lead sync watch ties them:
  `clients.ghl_location_id`, then `ghl_client_ad_accounts`, then the client
  name. `ad_account_ties` says how each one was tied.
- `cockpit_client_days`: one row per client per Kuwait day. CRM leads by
  creation day (WhatsApp chats tagged "inbound whatsapp" with no ad left out);
  confirmed bookings by the day they were made (main and online calendars,
  cancelled, invalid and Google Calendar copies left out); provisional
  bookings (the not-confirmed calendar, the dialer's way, less Google copies by
  id or by contact and start time); meetings due, shows, no-shows and no
  outcome by meeting day (CRM status, then the client sheet's mark, then the
  portal; unmarked is never a no-show); quotations (the sheet copy's Y or the
  portal's yes, the larger per day); closes and revenue (the sheet's first
  closed meeting per contact, the portal's won deals, one deal counted once,
  USD only); lead quality (the portal's latest score, 1 to 10); the dialer's
  official dials; leads called (WhatsApp chats left out). Quotations and
  closes count a source only when the client fills it: a sheet with at least
  one Closed mark, a sheet copy with at least one quotation Y, a portal with
  at least one deal marked won, lost or pending (its "unknown" is a blank)
  or one quotation answered. A client who fills none of them has those
  columns empty, never 0, and the day's notes say which column is blank.
- `cockpit_client_now`: per client, leads waiting for a first touch, the
  oldest of them, the share of the last 30 days' leads touched
  (`touched_share_30d`, 0.9 is 90%: the waiting-list rule), the leads with a
  Maqsam call (`verified_called_30d`: the 90% line), and the median first
  call in working seconds, the same rules as the client page's call centre
  (`cockpit_client_calls` waiting `touched` and `called`).

Every day row carries `sources`: per source `{ok, state, as_of, note, from}`;
on a day with closed deals whose value is in no known currency,
`sources.sheet.unpricedCloses` says how many (and `closes` is above
`closes_with_value`): the board should call that day's revenue incomplete.
NULL means no source covered the figure (a failed read, a client who does not
fill it, a day after a stale sync's last read, any day of a sync with no
record of a run for the client, a month the sheet has no tab for, a day
before the client's first portal report); 0 means a source read the day and
found nothing. What a source does hold for an uncovered day still counts. A
stale source never lowers a closed day; a complete read may, and the run's
audit row (`board_facts.refresh`) lists each drop. Leads called (and who is
waiting on `cockpit_client_now`) rest on the dialer's Maqsam call sync, one
`mahara_reporting.sync_jobs` row of kind `calls` per caller: a client is as
current as the oldest job of the active callers assigned to it, behind after
3 hours or on an error. Each run writes the state row `board-facts` in
`cockpit_sync_state` (`detail`: clients, rows, each source's states,
failures, drops, and the last 120-day fill: when, whether it read every
source, which it could not). One look at all of it, with the problems in
plain words: `select public.cockpit_board_facts_doctor();` (service key or
SQL editor). The doctor checks the 120-day fill on its own: older than 26
hours, a source it could not read, or a stop since its last good run.

| Symptom | Fix | Who |
| --- | --- | --- |
| A note on a day: "The lead sync last ran ..." or "The appointments sync last ran ..." | The GoHighLevel sync for that client is behind (`lead_sync_state`, `appointment_sync_state`). Fix the sync (`mahara-ghl-leads` at :35, `mahara-ghl-appointments` at :20); the next refresh fills the days. | Systems manager |
| "The client sheet copy ... last read" or "The sheet was last read ..." | The CSM profile sync or the dialer's sheet reader is behind or the sheet errored (`mahara_reporting.sheet_snapshots.error`). Shows, quotations and closes for later days stay empty until it reads again. | Systems manager |
| Quotations or closes are empty for a client | The client does not fill them: no Closed mark in its sheet, no quotation Y in the sheet copy, no deal or quotation marked in the portal (the day's `sources` notes say which), or the day is before its first portal report or in a month its sheet has no tab for. Ask the client success manager to get the sheet or the portal filled; nothing to fix in the database. Read live on 16 Oct: 7 of 17 active clients fill neither closes source (Ardon, Castello Industries, Marble and more, mergestudio.kw, Professional Touch Company, شركة العلا, نهوض نجد), and 6 fill no quotation source (the same less شركة العلا, whose portal answers one). | Client success |
| Leads called are empty on recent days, or `cockpit_client_now.note` says "The Maqsam call sync last ran ..." | The dialer's call sync for a caller assigned to the client is behind or erroring (`select id, last_success, error from mahara_reporting.sync_jobs where kind = 'calls';`). Fix it in the dialer; the next refresh fills the days. A caller who left keeps an old job harmlessly once their dialer access is switched off. | Systems manager |
| A day says "has no record of a run for this client" | The GoHighLevel lead or appointments sync, or the dialer's appointment sync, has never read that client (no `lead_sync_state`, `appointment_sync_state` or `sync_jobs` `appointments_recent` row). Only what was found counts; add the client to that sync. | Systems manager |
| A client is missing an ad account | `select public.cockpit_board_facts_doctor()->'spine';` lists active clients with none. Add the tie (`clients.ghl_location_id` or a `ghl_client_ad_accounts` row); the next refresh picks it up. Today Professional Touch has none (its account is not shared with Mahara's business). | Client success or systems manager |
| The state row `board-facts` says a source "could not be read" | Its figures stored before are kept. Run `select public.cockpit_board_facts_refresh(current_date - 2, current_date);` in the SQL editor to see the error, fix the view it names, and the next run fills the days. | Systems manager |
| The refresh stopped (doctor: "last ran ...") | Check both jobs are in `cron.job` and active: `select jobname, schedule, active from cron.job where jobname like 'mahara-board-facts%';`. Re-apply the migration to schedule them again. | Systems manager |
| Doctor: "The 120-day fill stopped at ..." or "could not read ..." | The nightly run failed (its `board_facts.refresh_failed` or `board_facts.refresh` audit row has the error). Fix what it names and run `select public.cockpit_board_facts_run('nightly');` once. A 30-minute run that finds a source reading again that the last fill wrote while it was behind fills the 120 days again by itself (at most every 3 hours; `detail.lastHealAt`, `detail.healed`). | Systems manager |
| `doctor()->'spine'->'registryDisagrees'` lists a client | Status and service come from the ClickUp card since 2026-10-16; the client registry (`ghl_clients`) says otherwise. Fix whichever is wrong (a card left Active, a registry row not updated after a client was lost). `noCard` lists clients that use the registry because no card has their task id. | Client success |
| Doctor: "A hand tie in cockpit_board_account_ties names a location the client registry does not hold" | A hand tie points at no client. Fix the location id in a new migration (ties are added only in migrations, each with its evidence). | Systems manager |
| A day's appointments note: "N bookings the contact replaced before their time, with no mark, are left out of meetings due" | The contact (or the call centre) booked again before the first meeting's time and nothing marks the first one: GoHighLevel left it confirmed. If the client says it did happen, mark it on the sheet; it then counts. | Client success |
| A day's leads note: "N contacts arrived within one hour this day: an upload in bulk" | Leads were uploaded to GoHighLevel in a batch (Ardon on 28 Sep and 13 Oct), so their creation day is the upload's. Use Meta's form leads for that day's cost per lead. | Media buyer |
| The sheet note: "Its Oct 26 tab has no rows yet" | The client has not filled the month's tab, so the month's shows, quotations and closes are not covered. Ask the client to fill it. | Client success |
| `cockpit_client_now.outcome_only_30d` above 0, or the note "... had a dialer outcome saved but no Maqsam call to the number" | Leads counted as touched only by a saved outcome. The 90% line reads `verified_called_30d / callable_30d` on the board and `called / callable` on the client pages (since `20261016230000_client_calls_maqsam_line.sql`); the outcome-only count is said beside it. Ask the caller whether they dial from a line Maqsam does not see. | Call-centre lead |

Deploying (the lead session). In order:

1. Apply `20261016111157_board_facts.sql` (`scripts/dev/apply_migration.py`,
   or Composio `SUPABASE_APPLY_A_MIGRATION` with BEGIN and COMMIT stripped).
   It needs the cockpit core, the dialer's reporting views, and
   `20261013180000_cockpit_client_calls.sql`. The 30-minute job starts at once.
2. Fill the 120 days once: `select public.cockpit_board_facts_run('nightly');`.
3. Doctor: `select public.cockpit_board_facts_doctor();` should list no
   problems.
4. Second source, the 30 full days before today, three clients:

   ```sql
   select b.client_name, sum(d.confirmed_bookings) confirmed, sum(d.shows) shows, sum(d.no_shows) no_shows,
          sum(d.no_outcome) no_outcome, sum(d.dials) dials
   from cockpit_client_days d join cockpit_board_clients b using (location_id)
   where d.day between current_date - 30 and current_date - 1
     and b.client_name in ('Atlantis Contracting', 'Arcturus Construction', 'Ocean Home')
   group by 1;
   ```

   Compare with the CEO Delivery card (`cockpit_sections` key `delivery`,
   `rates30`) and the dialer's report (key `calls`, `report.clients`). On
   2026-10-16 (16 Sep to 15 Oct) the same rules read live gave: Atlantis 11
   confirmed by booking day (Delivery 28 by meeting day: 16 of them Google
   Calendar copies), 5 shows, 3 no-shows, 4 no outcome (Delivery 20: the same
   16 copies); Arcturus 29 (Delivery 30: one cancelled meeting it counts), 17
   shows (Delivery 16: one meeting the sheet marked that the CRM copy missed),
   9 no-shows; Ocean Home 30 (Delivery 31 by meeting day), 1 show, 30 with no
   outcome. Dials, 17 Sep to 16 Oct, equal the dialer's report exactly:
   Atlantis 62, Arcturus 165, Ocean Home 203.

Corrections of 2026-10-16 (after the second-source check, `docs/client-performance/SOURCES.md`): apply
`20261016210000_board_facts_checked.sql`, then `20261016210200_board_account_ties.sql`, then run
`select public.cockpit_board_facts_run('nightly');` once and `select public.cockpit_board_facts_doctor();`.
Then apply `20261016230000_client_calls_maqsam_line.sql` and ship client success and media buyer, so the
client pages judge the 90% line on Maqsam calls as the board does.
The CSM sheet copy keeps quotation N after the next native feed release (`hermes/cockpit-sync`); until
then `quotation_answers` stays empty where the copy is the source.

To stop the refresh: `select cron.unschedule(jobid) from cron.job where jobname like 'mahara-board-facts%';`.
The stored days stay, and the board shows them with the time of the last run.

## Hiring

The careers Typeforms into the MaharaMedia Hiring boards, the boards into the
CEO Hiring tab, and the tab's buttons. On Supabase (built 2026-10-09, switched on by the steps in SWITCH-ON.md): Edge
Functions `hiring-sync` (pg_cron `mahara-hiring-mirror` every 10 minutes,
`mahara-hiring-engine` every 10, `mahara-hiring-intake` at :08 and :38) and
`hiring-api` (the tab). How it was switched on, and how to switch it off, is in
`docs/hiring/SWITCH-ON.md`.

| Symptom | Fix | Who |
| --- | --- | --- |
| Tab or `cockpit_sync_state` says "The hiring sub-account is not connected" | Set `GHL_HIRING_PIT` and `GHL_HIRING_LOCATION` as Edge Function secrets from the VPS runtime file (SWITCH-ON step 2) | Lead session |
| A grade or the track switch says "Dry run: GoHighLevel writes are off" | `HIRING_APPLY` is not `true`; set it | Lead session |
| `hiring-sync:intake` note starts "Dry run on purpose, the first intake run" | Nothing: the first run after the switch-on files nothing on purpose; the next one (30 minutes) files. Read the plan in `cockpit_hiring_runs.result` meanwhile | nobody |
| `hiring-sync:intake` says "left to the other importer" | PR #31's importer files that form live. Only one importer may run on a form: switch one of them off for it | Lead session |
| Intake `ok` false with "Typeform … answered 401" | `TYPEFORM_TOKEN` was rotated; set it again | Aziz |
| Intake or mirror "GoHighLevel … answered 401" | The hiring private integration token was rotated; make a new one in MaharaMedia Hiring and set `GHL_HIRING_PIT` (and the VPS runtime file) | Aziz |
| "The careers form import is already running" | A run holds the lock; it frees itself after 7 minutes if the run died | nobody |
| "Find people for this role" stays at "Asked at …" past 10 minutes | The VPS `pending` cron answers it. `tail ~/.ideation-radar/out/cron.log` on the VPS for `headhunt`; a model failure retries three times, then the tab says why with Ask again | Hermes |
| Candidate messages | GoHighLevel's 36 workflows send them once the CEO publishes them; the cockpit only drafts and never sends on a schedule. `HIRING_SEND_ENABLED` stays unset | Aziz |

## What never needs a person

- Rate limits: every Google, ClickUp and Meta call waits and retries.
- A cockpit action that fails (ClickUp task, WhatsApp reply) is retried after
  1, 5, 15, 60 and 240 minutes, then left with its error visible. It is never
  sent twice: a drain claims a row before acting on it.
- A refresh never wipes what a person added: Hermes drafts and replies in
  flight survive the WhatsApp refresh; an empty read never empties a table.
- An Ask AI job (in cockpit_ask_ai_jobs) is leased atomically with a token; an uncompleted lease expires after its window and is reclaimed, failing after bounded retries (3). Stale worker finishes are rejected.
- A calendar that was not shared yet is retried every minute until it is.
- A removed team member loses every cockpit within a minute, sessions
  included.

## Shipping a fix

`scripts/ship.sh <app>` checks its setup first (`scripts/ship-preflight.sh`
lists everything missing at once, in seconds), runs the guard tests and the
local readiness checks, then lints, typechecks, builds and deploys the site,
then runs the smoke check. It stops at the first failure, so a broken change
never replaces a working deployment. Ship the receiving cockpits before the
media buyer when a bridge payload gains a field (`scripts/ship.sh all` does
this in the right order).

### From a fresh worktree (Windows)

A new worktree has none of the git-ignored files a ship needs. This adds
them: dependencies in the root, the five apps and `hermes/media-native`,
`convex/_generated` for the media buyer and creative director apps (copied
from the main checkout), and each `.vercel/project.json` (written from
`config/vercel-projects.json`). Without `--apply` it only reports.

```bash
scripts/prepare-worktree.sh --apply
```

Then a person ships from PowerShell, because loading a secret into a deploy
is a person's step. `ship.ps1` reads `supabase_token` from the main
checkout's `.env.local` and `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
from an app `.env.local`, by name and without printing them, and runs
`ship.sh` in Git Bash. `-CheckOnly` runs only the preflight.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\ship.ps1 client-success
```

On a Mac with the existing authorized Composio Supabase connection, set
`COCKPIT_AUTH_USE_COMPOSIO=1` instead of supplying a management token. The same
live authentication/RPC verification still runs before deployment; this selects
the already-supported connection and does not skip any check.

The cutover evidence check (`evidence/cutover-acceptance.json`) runs after
the deploy only when that file exists. Only the coordinated cutover
procedure writes it (`docs/CUTOVER-ACCEPTANCE.md`).

Production is a CLI upload (`vercel deploy --prod`, or the Composio path when
the CLI is logged out). The CLI stamps the local commit and does not ask
GitHub whether that commit exists. `scripts/require-github-main.sh` runs
first and refuses the ship unless all three are true:

1. `HEAD` is already on `origin/main` (fetched during the check).
2. The app directory matches that commit. A dirty tree is uploaded under the
   last commit's name.
3. The commit production serves, read from Vercel's record of the live
   deployment (`scripts/check-vercel-project.py <app dir>
   --production-in-head`), is in this clone and in `HEAD`, by name or as the
   same patch after a rebase. If production is a commit this clone does not
   have, or has commits `HEAD` lacks, shipping would take it backwards.
   `scripts/ship-preflight.sh` runs the same check, so a stale worktree stops
   in seconds. Until 2026-10-13 this read a commit stamp in the live bundle.
   No cockpit bundle carries that stamp any more, so the comparison was
   skipped on every ship with only a note.

`ALLOW_UNPUSHED_SHIP=yes` skips the refusal and says so. That is the hole.
If production's commit cannot be read (CLI signed out, no commit on the
deployment), the ship stops. `ALLOW_UNKNOWN_PRODUCTION=yes` lets it continue
after someone has checked production another way. It never covers a
production that has commits `HEAD` lacks. To go back on purpose, promote an
earlier deployment in Vercel.

On 2026-09-22 the media buyer project (`mahara-media-buyer`, source `cli`,
user `aziz-6097`) promoted two commits that GitHub has never had. There was
no force-push on `main`. The live site is the second of them.

| Production deployment | When (UTC) | SHA | Message |
|---|---|---|---|
| `dpl_6v95UXNQdCgs2UBXCFT6f2isRqvE` | 2026-09-22 12:37 | `db78d278dfafaccc3cadbad4c7bdea62ccd988bf` | Goals for a period, and a real file on every person |
| `dpl_2udZfKFVrJcYHd8cCY4LMqS6adnK` (aliased to cockpit.maharamedia.com) | 2026-09-22 13:27 | `7efca15fb6631c767489ffb343d858fa703186b8` | A person is a page, not a panel, and next month is one screen |

The deploy before those, `dpl_GWpJVt8aNBez3qyNETNptUQTFSzW`, is
`43ec8eeb1c0f1e897f1652a56a66099c67d73935`, which is on GitHub main. The
missing commits were made after it, on a checkout of this repo, and shipped
without a push. The tables for the same work are already on main, inside
that commit, as `supabase/migrations/20260922e_goals_and_people.sql`. The
screens and the Convex modules (`convex/ceo/goals.ts`, `goalsSeed.ts`,
`profiles.ts`, `scoreboard.ts`, `scorecardSeed.ts`, and the page that calls
`ceo.goals.savePlan`) are only in the uploaded source.

Do not run `scripts/ship.sh media-buyer` from current main to "get back in
sync". The check above will refuse it, because this clone does not contain
`7efca15f`. Push that commit from the machine that shipped it (the reflog
there, author Aziz Waheedi, 22 September) and then ship the descendant.
`ship.sh` also deploys Convex before the site, from the same tree, so treat
the production Convex deployment as possibly ahead of GitHub until that
push is on main.

## Watchdog (the outside check)

Everything above runs inside Convex, on the media buyer deployment. If Convex
itself stalls, or its scheduled jobs stop, none of those alerts can go out.
The watchdog closes that gap from outside: every 15 minutes Vercel runs
`api/watchdog.ts` in the media buyer app (the schedule is in `vercel.json`;
a cron every 15 minutes needs the Vercel Pro plan the team is on, since Hobby
runs crons at most once a day).
It calls the Convex address `/watchdog` with a secret token. That address
only answers with how old things are, whether they pass, and the names of
what is failing. It never sends client data, money figures or personal data.

It sends Aziz a Slack DM from the same bot when:

- Convex does not answer, refuses the token, or answers with an error;
- the CEO cockpit numbers are more than 45 minutes old (they refresh every 15);
- the smoke check has not run for 45 minutes, or its last run failed;
- a CEO section is failing;
- Convex cannot send Slack messages, so its own alerts are not arriving.

The same problem is sent at most once every 6 hours. When everything is fine
again it sends one "all clear". A problem that comes back within 6 hours of
its alert is not sent again until the 6 hours are up, even after an all clear
(otherwise a section that fails every other run would send an alert and an
all clear every half hour); a new problem in that window is sent at once and
lists the held ones. Each alert ends with a line such as
`(ref watchdog:ceo-stale)`: the watchdog has no database, so it reads its own
recent messages in the DM to remember what it already sent. Leave those lines
alone.

| Alert (ref) | What it means | What to do |
| --- | --- | --- |
| `convex-down` | Convex did not answer within 20 seconds. The portal, the scheduled jobs, the smoke check for all three cockpits and every other alert live there, so nothing else will tell you. | Check status.convex.dev, then the Convex dashboard (project mahara-media-buyer, production): Health, Logs, Schedules. If the last deploy failed, `scripts/ship.sh media-buyer`. |
| `convex-token` | Convex is up but refused the watchdog's token. | `WATCHDOG_TOKEN` is missing on Convex, or different on Convex and on Vercel. Set both again with the commands below. |
| `convex-route` | Convex is up but does not know `/watchdog`. | The backend is older than the watchdog: `scripts/ship.sh media-buyer`. |
| `convex-error` | Convex answered with an error. | Convex dashboard, Logs, look for `/watchdog`; then `scripts/ship.sh media-buyer`. |
| `setup-token` | `WATCHDOG_TOKEN` is missing on Vercel. | Set it (below) and ship the site again. |
| `ceo-stale` | The CEO numbers, or the CEO refresh job, are more than 45 minutes old. The scheduled jobs have probably stopped. | Convex dashboard, Schedules and Logs, look for `ceo/refresh:refreshAll`. If nothing is running, `scripts/ship.sh media-buyer`. |
| `ceo-section:<name>` | One CEO section keeps failing. The screen still shows its last good numbers. | The Machine tab names the slow or broken source. It retries every 15 minutes; if it is still failing after a few hours, fix that source (the table at the top). |
| `smoke-stale` | The smoke check has not run for 45 minutes. It is a Convex job, so the sync, the feeds and Convex's own alerts have probably stopped too. | Same as `ceo-stale`. |
| `smoke:<cockpit-check>` | The smoke check found a screen that throws. Convex has already sent its own alert and filed a fix job for Hermes. | Follow that alert (see "How you find out"). |
| `convex-slack` | Convex's Slack messages fail, so its alerts are not reaching you. | The Slack row in the table at the top. |
| all clear | Everything the watchdog checks is fine again. | Nothing. |

"Repeats are not held back" at the bottom of an alert means Slack would not
let the bot read the DM. The Slack app needs the `im:history` and `im:write`
scopes (Slack app settings, OAuth & Permissions, then reinstall and set the
new bot token on Convex and on Vercel). Until then every 15-minute run that
finds a problem sends it again, and no all clear is sent. Whether the bot has
these scopes was not checked when the watchdog was built: the `?test=1` reply
in step 6 below tells you. Vercel keeps its own copy of the bot token: whenever the token changes on
Convex, run step 4 below again with `--force`, or the watchdog goes quiet.

If Convex is clearly down and no watchdog message arrives, the watchdog
itself is broken: Vercel dashboard, project mahara-media-buyer, Cron Jobs and
Logs for `/api/watchdog`. A 401 there means `CRON_SECRET` is missing on
Vercel (the log says so) or the caller sent the wrong one; a 500 means
`SLACK_BOT_TOKEN` is missing on Vercel; a 502 means Slack refused the
message (the error is in the log). The watchdog and Convex post with the same
Slack bot, so if that bot's token is revoked neither can reach you: the only
sign is those 502s in the Vercel log and `slack` failing on the Machine tab.

### Setting it up (once, Aziz)

All in one terminal, in this order. The secrets are made with `openssl`,
passed along through pipes and never printed. Add `--force` to a
`vercel env add` line if that variable already exists.

```bash
cd ~/mahara-cockpits/apps/media-buyer-cockpit

# 1. Make the two secrets (they live only in this terminal)
WATCHDOG_TOKEN="$(openssl rand -hex 32)"
CRON_SECRET="$(openssl rand -hex 32)"

# 2. WATCHDOG_TOKEN, the same value on Convex production and on Vercel production
printf %s "$WATCHDOG_TOKEN" | bunx convex env set --prod WATCHDOG_TOKEN
printf %s "$WATCHDOG_TOKEN" | bunx vercel env add WATCHDOG_TOKEN production --sensitive

# 3. CRON_SECRET on Vercel production (Vercel sends it with every cron call)
printf %s "$CRON_SECRET" | bunx vercel env add CRON_SECRET production --sensitive

# 4. SLACK_BOT_TOKEN on Vercel production: the bot token Convex already uses
#    (copied through a variable so an empty value is never stored)
SLACK_BOT_TOKEN="$(bunx convex env get --prod SLACK_BOT_TOKEN | tr -d '\r\n')"
if [ -n "$SLACK_BOT_TOKEN" ]; then printf %s "$SLACK_BOT_TOKEN" | bunx vercel env add SLACK_BOT_TOKEN production --sensitive; else echo "SLACK_BOT_TOKEN is not set on Convex prod: stop here"; fi

# 5. Ship backend and site (new Vercel variables only reach a new deployment)
(cd ../.. && scripts/ship.sh media-buyer)

# 6. Check it: the Convex answer, a dry run, then a test DM
curl -s -H "Authorization: Bearer $WATCHDOG_TOKEN" https://adorable-seahorse-418.convex.site/watchdog; echo
curl -s -H "Authorization: Bearer $CRON_SECRET" "https://cockpit.maharamedia.com/api/watchdog?dry=1"; echo
curl -s -H "Authorization: Bearer $CRON_SECRET" "https://cockpit.maharamedia.com/api/watchdog?test=1"; echo

# 7. Forget the secrets in this terminal
unset WATCHDOG_TOKEN CRON_SECRET SLACK_BOT_TOKEN
```

The test run answers with `"memory":"slack"` when repeats can be held back,
or `"memory":"unavailable (...)"` with Slack's reason when the scopes above
are missing. `?dry=1` checks without sending anything; `?test=1` also sends a
test DM that does not count as an alert.

## Invoice desk

Invoices issued from the client success cockpit (Money, Invoices). The worker on the VPS (`hermes/invoice-desk`) numbers each one from the invoice register, prints it, files it locked in the client's Drive folder and adds the register row. Cron as `hermes` every minute under `flock` (the line is in `hermes/invoice-desk/README.md`); log `~/.invoice-desk/run.log`. `python3 desk.py doctor` names what is wrong and changes nothing.

| Symptom | Fix | Who |
| --- | --- | --- |
| The Invoices tab says the invoice worker has not started, or last checked in minutes ago | On the VPS as `hermes`: `crontab -l` has the invoice-desk line; `tail ~/.invoice-desk/run.log`; `cd ~/mahara-cockpits/hermes/invoice-desk && python3 desk.py doctor`. Waiting invoices go ahead on the next run | Muhammed |
| An invoice failed with "No Drive folder named ..." or "2 Drive folders are named ..." | An admin pastes the client's folder link under the client on the Invoices tab, then presses Try again | Admin |
| An invoice failed with "must fit on one" | Cancel it and issue it again with a shorter description, line under it or note | The person who asked |
| "The invoice fonts did not load" | Google Fonts did not answer the worker. Try again in a few minutes; if it repeats, run `doctor` | Muhammed |
| "The user does not have sufficient permissions" | The service account lost access to the client's shared drive or to the Churn Tracker. Give it edit access again, then Try again | Muhammed |
| An issued invoice is wrong | Issued invoices are locked and on the register, so the cockpit cannot change one. Tell Muhammed: correcting it is a hand change to the register row and the Drive file | Muhammed |
