# cockpit-notices

The cockpit's Slack notices for the kickoff and the Brand Blueprint
(`docs/forms/PLAN.md` 1.3, `docs/forms/STAGE1-CONTRACT.md` section 4). One
outbox, `cockpit_slack_notices` (migration `20261025n_slack_notices.sql`),
queued by database triggers and a sweep, sent by this function only, as
mahara-club-bot.

| Notice | Posts in | Tags (default, changed in Settings) |
|---|---|---|
| Kickoff complete | #csm-general | the creative director |
| Kickoff in, card not updated (20 minutes without the Kickoff Handoff comment and the card at Brand Blueprint Booked, both) | #csm-general | the CSM, the systems manager |
| Second kickoff (a line in either) | | the CSM |
| Kickoff card updated (a reply under a late notice, once the card looks done and has the Kickoff Handoff comment) | its thread | nobody |
| Brand Blueprint complete, or closed with a card update to check | #csm-general | the CSM |
| Brand Blueprint completed, for media | #media-general | nobody |
| Blueprint card confirmed (a reply) | its thread | nobody |
| Offer locked (a reply) | its thread | nobody |

Where each posts, whether it is on and who it tags are rows in
`cockpit_slack_notice_settings`, changed on the client success cockpit's
Settings page, Notices and routing. The sender reads them when it claims a
notice, so a change applies to the next one without a deploy.

## Jobs

POST only, with `x-cron-secret: <NOTICES_CRON_SECRET>`. The secret is checked
in constant time before the body is read; anything else is 401. A body that is
not exactly one of these is 400 with the sentence saying what to send.

| Body | What happens |
|---|---|
| `{"job":"run"}` | 202 at once; in the background: sweep, check new channels and newly tagged people, reconcile unknowns, claim up to 3, post (none started after a minute of work; the rest go back to the queue), record |
| `{"job":"doctor"}` | the bot, its scopes, every channel (recorded), every tag; `ok` only when all pass |
| `{"job":"dryRun","responseId":"..."}` | a kickoff from the mirror: one ClickUp read, the text and tags; posts nothing, writes no notice |
| `{"job":"dryRun","kind":"blueprint.close","taskId":"...","facts":{...},"variant":"done"}` | the same from given facts (`variant` optional) |
| `{"job":"rehearse","kind":"kickoff","to":"U..."}` | one test to a person's direct messages (`to` defaults to `ALERT_SLACK_TO`), then found again by its Ref |

pg_cron `mahara-slack-notices` calls `{"job":"run"}` every minute, only when
there is work (`cockpit_slack_notices_kick()`).

## How a notice is sent

1. The claim hands out a due row with its facts, what the card shows now, the
   target and the tags (`cockpit_slack_notice_claim`). A kickoff is claimed
   once the card looks done or 20 minutes after the submit.
2. `auth.test` once per run: the token must be `NOTICES_BOT_USER`
   (mahara-club-bot, `U0C0MJZNS2Y`). Otherwise every claimed row goes back to
   the queue for 5 minutes and nothing is posted or checked.
3. A kickoff reads the card's comments: a `KICKOFF HANDOFF` comment at or after
   the submit **and** the card looking done (`live.looksDone`: the Brand
   Blueprint stage, changed since the submit) give Kickoff complete. Make
   writes the comment first (module [11]) and the stage later ([21]), so a
   comment alone is not enough. Either half missing within 20 minutes waits a
   minute (not an attempt); after 20 minutes it is the late notice, whose line
   says which half is missing. The sent facts keep `commentCheck`,
   `looksDone` and `cardUpdatedAt` (what it saw).
   A late kickoff's reply (`kickoff.updated`, queued by the sweep once the card
   looks done, from what the late notice saw, never the post time) reads the comments too:
   it posts only once the comment is there, else it waits 10 minutes (not an
   attempt); the claim lets it go 48 hours after the kickoff.
4. Tags resolve to `<@U...>`; a seat without a Slack id is looked up by email,
   and Slack's answer is kept in `cockpit_slack_people` for the Settings card;
   anything still missing is the role label in plain text, plus a
   `notices/mentions` warning row in the ledger. People an editor tags are
   checked the same way within a minute of the save
   (`cockpit_slack_person_pending`, `cockpit_slack_person_checked`).
5. `text.ts` builds the words (`text` always ends with `Ref CN-xxxxxxxx`). One
   `chat.postMessage`, `unfurl_links` and `unfurl_media` false.
6. It counts as posted only on Slack's receipt: `ok`, a `ts`, and the channel
   rule of `_shared/slackReceipt.ts` (a channel must come back as itself, a
   person as a direct message). The returned channel is stored for threads and
   the reconcile.

| Slack answered | Outcome |
|---|---|
| ok, the right channel | `posted`, with the permalink |
| ok, another channel, or no ts | `unknown` (it posted somewhere; never resent) |
| rate limited | `retry` after Slack's wait, 3 tries at most |
| a refusal | `failed`, with a sentence for the tech lead |
| `internal_error` or `fatal_error` (Slack: it may have gone through) | `unknown` |
| no answer, a 5xx, an unreadable answer, a break after the request left | `unknown` |
| a break before the request left | `retry` |

An `unknown` is never sent again. Each run looks for its Ref where the claim
sent it (the thread stored in `thread_ts`, else the channel) from a minute
before it was claimed; found, it becomes `posted`. Not found, it stays for a
person (RUNBOOK, Slack notices).

## Secrets and receipts

Function secrets, read by name: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SLACK_BOT_TOKEN`, `CLICKUP_API_TOKEN`, `NOTICES_CRON_SECRET` (the same value as
the vault's `cockpit_notices_cron_secret`); optional `ALERT_SLACK_TO` (default
`U09305KE2KS`) and `NOTICES_BOT_USER` (default `U0C0MJZNS2Y`).

Deploy with the JWT check off. If the deploy cannot turn it off, pg_cron's
optional anon `Authorization` header gets past the gateway and the door still
checks the secret.

Every Slack and ClickUp call goes through `cockpit-csm-api/tools.ts`
(`slackTools`, `providerTools`) and writes an intent row before it leaves and
a response or unknown row after, in `cockpit_csm_provider_health`, with
`run_key` = the notice id (or `run`, `doctor`, `dry-run`). The resource is the
method only (`slack.com/api/chat.postMessage`): never a channel, a person, an
email or the text. A receipt that cannot be saved throws, so no call goes out
without one.

The bot needs `chat:write`, `groups:history` and `users:read.email`
(`channels:history` too if a public channel is listed). The rehearsal's
read-back of a direct message needs `im:history`.

## Tests

```
bun test supabase/functions/cockpit-notices
```

`testkit.ts` fakes Slack (it stores text the way Slack does), ClickUp and the
database RPCs; nothing touches a network. The database side is tested in
`apps/media-buyer-cockpit/scripts/slack-notices-supabase.test.ts`.
