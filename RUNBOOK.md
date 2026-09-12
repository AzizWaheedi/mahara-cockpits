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
| Google Sheets | `HTTP 429` | Quota; clears within a minute | nobody |
| Google Docs / Calendar | "API has not been used" | Enable that API on the service account's Google project | Aziz |
| GHL (CRM) | `401` for one client | Their token in Client Data, GHL API column, is wrong; make a new private integration token in that sub-account | Client success |
| GHL (CRM) | `401` for Mahara's own | Set `MAHARA_GHL_TOKEN` again | Aziz |
| Fathom | `401` | New API key, set `FATHOM_API_KEY` | Aziz |
| Slack | `channel_not_found` | `ALERT_SLACK_TO` must be Aziz's user id (U…), not a D… channel | Aziz |
| Client success or creative cockpit (bridge) | `HTTP 5xx` or schema error | Redeploy: `scripts/ship.sh client-success` (or `creative`). If 401, `CSM_BRIDGE_TOKEN` / `CREATIVE_BRIDGE_TOKEN` differ from that deployment's `BRIDGE_TOKEN` | Hermes or Aziz |
| Hermes | "jobs waiting, last poll N min ago" | Restart the Hermes poller on its host. Chat answers, reply drafts, call briefs and report narratives resume by themselves | Aziz |
| Resend | sign-up or reset emails not arriving | Set `RESEND_API_KEY` and `AUTH_EMAIL_FROM` on all three deployments; verify the domain in Resend | Aziz |

Set a variable: `cd apps/<app> && bunx convex env set --prod NAME value`.

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
