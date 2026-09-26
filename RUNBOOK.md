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
| Slack | `channel_not_found` | `ALERT_SLACK_TO` must be Aziz's user id (U…), not a D… channel | Aziz |
| Client success or creative cockpit (bridge) | `HTTP 5xx` or schema error | Redeploy: `scripts/ship.sh client-success` (or `creative`). If 401, `CSM_BRIDGE_TOKEN` / `CREATIVE_BRIDGE_TOKEN` differ from that deployment's `BRIDGE_TOKEN` | Hermes or Aziz |
| Hermes | "jobs waiting, last poll N min ago" | Restart the Hermes poller on its host. Chat answers, reply drafts, call briefs and report narratives resume by themselves | Aziz |
| Resend | sign-up or reset emails not arriving | Set `RESEND_API_KEY` and `AUTH_EMAIL_FROM` on all three deployments; verify the domain in Resend | Aziz |

Set a variable: `cd apps/<app> && bunx convex env set --prod NAME value`.

## Scheduled jobs

Every cron (the sync, the feeds, the outbox drains, the Hermes relay, the
smoke check, the report writer, the board writeback, the tracking audit, the
weekly playbook) runs through one wrapper that records the outcome. The admin
view lists each job with its last run and error. Three failures in a row file
a fix job for Hermes and send one Slack line; a job that has not run for three
times its interval is flagged by the smoke check. "Not running" for every job
at once means the media buyer deployment itself is down: check the Convex
dashboard, then `scripts/ship.sh media-buyer`.

The client comment watch (every 15 minutes, `commentWatch.scan`) reads the
comments on current client cards in Clients - Mahara. Call summaries, kickoff
handoffs, briefs and typed notes go to Hermes as `comment_digest` jobs; the
digest shows as "Latest from the ClickUp card" in all three cockpits and new
rules are added to the card's Do's & Don'ts. Billing and touchpoint logs,
ClickBot, sales handoffs and research reports are skipped. Every sync also puts
Do's & Don'ts into the clean DO / DON'T format and moves notes to a comment.
No digests appearing means Hermes is not polling (see the Hermes row above).

## Previews

Ad previews and pictures in all three cockpits (health row "Ad previews and
saved pictures", owner Hermes or Aziz).

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
| DM: "has not scanned since …" | On the VPS as `hermes`: `cd ~/mahara-cockpits/hermes/ideation-radar && python3 radar.py doctor`, then `crontab -l` must show the two radar lines from the README | Aziz |
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
| A message says "WhatsApp only takes a free message within 24 hours" | Meta's rule, not the cockpit's. Outside the window the box becomes a WhatsApp template with one line for the lead, once a template is live in Follow-ups → WhatsApp library; until then, email | The rep |
| The WhatsApp library says a template is "Waiting for its workflow" | Its approved template and the one-step HighLevel workflow that sends it are not set up yet: the steps are on that page (the two contact fields, Cockpit WhatsApp line and Cockpit rep name, already exist). Pick the workflow, tick Live, Save | Aziz |
| A template send says "The workflow did not send it within half an hour" | In HighLevel the workflow must be published and allow re-entry, and the template still approved at Meta. The send is marked failed; send again once fixed | Aziz |
| "Proof to send" is empty, or an asset is missing | The asset library is B2B's (Muhammed's), copied every hour by `sales-mirror` (the `assets` step in `cockpit_sales_mirror_runs`). An empty read from B2B keeps the old copy and fails the step. What may be sent is B2B's rule (link working, claims not expired, no YouTube video from before 19 July) | Hermes, or Muhammed for the library |
| A lead moved to the wrong stage after a dialer outcome | What each stage means is pinned by id in the setting `pipeline` (`roles`); `auto_moves: false` stops the moves. Every move, and HighLevel's answer, is a row in `cockpit_sales_stage_moves` | Aziz |
| A rep asked for a reference call | Links → Reference calls asked for: arrange it through the client's CSM, then mark it arranged, done or not possible. A client is only called once their reference says they agreed | Aziz or the CSM |
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
| Maqsam's calls and the cockpit's disagree (Team page, 7 days) | The desk reads Maqsam each half hour and adds the calls B2B does not keep (the closers', `origin` maqsam); a gap that stays means neither B2B nor the desk read that agent's calls: check the agent's Maqsam address on their seat | Hermes |

## Sales desk

The worker on the VPS (`hermes/sales-desk`) that drafts the sales cockpit's proposals from the lead's demo call in Fathom, rebuilds them after the closer fills the gaps, indexes every rep's sales calls, copies the Obsidian vault's sales calls and every answered Maqsam phone call in, writes Vince's call reviews, researches leads, and drafts follow-ups. Cron as `hermes`, each job under its own lock: requests and research every two minutes, recordings at :11 and :41, calls-vault at :26 and :56, maqsam-calls at :16 and :46, reviews at :03 and :33 and asked reviews every two minutes, followups at :07 and :37, call notes at :19 and :49, the digest at 03:15 UTC; log `~/.sales-desk.log`. `calls-b2b-fathom --once` (Ahmed's private Fathom calls, which only B2B holds) is a one-off, never on cron. `python3 desk.py doctor` names what is wrong; `python3 desk.py status` shows the queue.

| Symptom | Fix | Who |
| --- | --- | --- |
| A proposal says "No Fathom recording of this lead's demo was found" | The demo was not recorded, or was recorded by a rep whose calls the key cannot see. Share the recording with the team in Fathom (and put the rep's Fathom email on their seat), then draft again | The closer |
| Requests wait with "OPENAI_API_KEY is not set" or "refused the key" | Set OPENAI_API_KEY in /opt/data/bibi/api-keys.env; waiting requests go ahead on the next run | Aziz |
| "The model … is not available to this openai key" | `desk.py doctor` lists the models the key can use; set SALES_PROPOSAL_MODEL in ~/.sales-desk/env | Aziz |
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
| A follow-up kind sends by itself when it should not | A manager switches it off on Follow-ups → How it works; the desk can only send kinds switched on, through `followup.autosend`, the one action its service key opens | Aziz |
| Follow-ups go out as email where WhatsApp was wanted | Outside the lead's 24-hour window WhatsApp needs a live template (Follow-ups → WhatsApp library). Until one is live the agent writes email where that kind allows it (the email boxes under How it works) | Aziz |
| No drafts for no-shows, cancellations or new leads while HighLevel's automations run | By design: the agent waits 20 hours after an automation's message (`automation_gap_hours`), so nobody gets both. Switch that kind's "Replaces HighLevel's" on (How it works) and each lead the cockpit messages is taken out of the old automation at the send; the answer per workflow is kept on the follow-up | Aziz |
| Call notes or the digest stop updating | `notes` at :19 and :49 (four calls a run) and `digest` at 03:15 UTC, on the desk's OpenAI key (never DeepSeek). The Intelligence page says when the digest was written | Hermes |
| An asked review stays on "Review asked" | `reviews --asked` runs every two minutes; a failure says why on the call's page | Hermes |
| Every proposal's notes say "No reference deal on this machine" | Put a finished proposal per variant in ~/.sales-desk/reference with extract_reference.py (README) | Aziz |
| A request stays "running" for over half an hour | The run died. It goes back in the queue by itself and is parked as failed, with the reason, after four tries | nobody |
| The cockpit's payment choices differ from offer.json | `python3 desk.py offer-sync` (requests does it every run) | Aziz |

## What never needs a person

- Rate limits: every Google, ClickUp and Meta call waits and retries.
- A cockpit action that fails (ClickUp task, WhatsApp reply) is retried after
  1, 5, 15, 60 and 240 minutes, then left with its error visible. It is never
  sent twice: a drain claims a row before acting on it.
- A refresh never wipes what a person added: Hermes drafts and replies in
  flight survive the WhatsApp refresh; an empty read never empties a table.
- A Hermes job that was taken but not answered goes back in the queue after
  20 minutes and fails, with a message to the person, after four tries.
- A calendar that was not shared yet is retried every minute until it is.
- A removed team member loses every cockpit within a minute, sessions
  included.

## Shipping a fix

`scripts/ship.sh <app>` lints, typechecks, deploys the backend, builds and
deploys the site, then runs the smoke check. It stops at the first failure,
so a broken change never replaces a working deployment. Ship the receiving
cockpits before the media buyer when a bridge payload gains a field
(`scripts/ship.sh all` does this in the right order).

Production is a CLI upload (`vercel deploy --prod`, or the Composio path when
the CLI is logged out). The CLI stamps the local commit and does not ask
GitHub whether that commit exists. `scripts/require-github-main.sh` runs
first and refuses the ship unless all three are true:

1. `HEAD` is already on `origin/main` (fetched during the check).
2. The app directory matches that commit. A dirty tree is uploaded under the
   last commit's name.
3. The commit named in the live page's bundle is in this clone and is an
   ancestor of `HEAD`. If production is a commit this clone does not have,
   shipping main would replace it with an older tree.

`ALLOW_UNPUSHED_SHIP=yes` skips the refusal and says so. That is the hole.

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
