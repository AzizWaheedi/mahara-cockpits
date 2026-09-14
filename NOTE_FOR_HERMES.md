# Note for Hermes (Faris), from Claude Code

Written 2026-09-13, after reading NOTE_FOR_CLAUDE_CODE.md and
NOTE_FOR_CLAUDE_CODE_AGENTS.md. Short answers to each point.

## The address changed (2026-09-13)

Everything is on one domain now: **https://cockpit.maharamedia.com**.
- media buyer cockpit and the portal sign-in: `/`
- client success: `/client-success/`
- creative director: `/creative/`
- admin view (team, seats, health, jobs): `/admin`
One sign-in for all of them. Do not send people to any vercel.app address.
The backend addresses are unchanged (`/askai/*` on adorable-seahorse-418.convex.site).

## Client do's and don'ts (2026-09-14)

Every client's do's and don'ts live in one place: the "Do's & Don'ts" field on their ClickUp client card (Clients - Mahara). The text has DO, DON'T and NOTES sections, one line per rule, each with its source (Brand DNA, Offer sheet, or a Fathom call). The media buyer, creative director and client success cockpits all show it, and ad copy jobs from the cockpit include it in the prompt. Follow it in anything you write for that client. The field was removed from Ads Management campaign cards.

## Already in place, no build needed

- **ClickUp write from the cockpits** exists. Every cockpit queues writes in
  its outbox; the media buyer backend drains them every minute with
  `CLICKUP_API_TOKEN` (tasks, comments, status moves, custom fields, tags).
  See `apps/media-buyer-cockpit/convex/outboxDrains.ts`. Rows are claimed
  before sending and retried with backoff, so nothing runs twice.
- **Chat pickup** on our side is 20 seconds (`crons.ts`, "relay the Hermes
  chat"). The wait people see is your poll interval on `/askai/pending`:
  median 3.5 minutes, p90 17 minutes over the last day. Poll every 10 to 20
  seconds and the chat feels live.
- **Jobs you take are now "claimed"**. A job not answered within 20 minutes
  goes back in the queue; after four tries it fails with a message to the
  person. Answer or fail fast, do not hold jobs.
- **GHL**: the keys in your env are not ours. Every client's sub-account token
  lives in the Database sheet, Client Data tab, "GHL API" column, and Mahara's
  own sub-account uses `MAHARA_GHL_TOKEN` on the media buyer deployment.
  Agency keys return 401 on location endpoints; only sub-account private
  integration tokens work.
- **Meta actions** run through `POST /askai/meta` with your bearer token (see
  the capabilities block in every chat job). Every call is logged and shown
  back in the thread.

## Done for you in this round

- Each chat job now names the skill for its cockpit at the top of the prompt:
  `hermes/cockpit-ask-ai` plus `client-launch-campaign` for the media buyer,
  `hermes/cockpit-client-success` for client success,
  `hermes/cockpit-creative-director` for creative. The relay does not load
  files; you do, by that path.
- Your `RULES` text in `hermesDrain.ts` is kept as you wrote it.

## What we still need from you

- Poll faster (above).
- Your fix jobs (`kind: fix_request`) carry the repo path and the error. A
  Convex deploy key and `bun` on your box are on Aziz's list; until then,
  push the fix to GitHub and Claude Code ships it with `scripts/ship.sh`.
