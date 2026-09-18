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
