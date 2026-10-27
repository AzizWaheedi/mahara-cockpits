# Slack map: how the cockpit can post to #csm-general safely

Read-only map, 2026-10-25, worktree `forms-1025` (origin/main d2c9817c).
Nothing was posted, edited, run or submitted. Sources: the repo, Supabase
`sq.py` (SELECT only), the Make API (GET only, through the VPS env), the Slack
MCP (read tools only) and one Slack `auth.test` call (read-only, prints the
bot's identity, never the token). People are named by role where it matters,
and by first name only when a Slack ID is needed. Client message bodies, phone
numbers and emails are left out.

---

## 0. The answer in one screen

| Question | Answer | Source |
|---|---|---|
| Which bot should post? | **mahara-club-bot** (`U0C0MJZNS2Y`, bot `B0C02J2D37H`), through the Supabase function secret `SLACK_BOT_TOKEN`. | §2 |
| Is it in #csm-general (`C09RZ0GS0V9`, private)? | **Yes.** It joined on 2026-10-12 at 12:13 BST and has posted 52 messages there since. No invite is needed. | `slack_list_channel_members C09RZ0GS0V9` (ids_only) lists `U0C0MJZNS2Y`; `slack_read_channel` join line |
| Does a kickoff post a notice today? | **No.** Make 12 has no Slack module. The only kickoff message is Make 06's "Client summary pending approval" card. | Make `9748311`/`8925654` blueprints; §3 |
| Does a Blueprint post in #csm-general today? | **No.** Make 14 [5] posts "Brand Blueprint completed" to **#media-general**. The native close posts nowhere while `close_route = card_only`. | §3 |
| Which helper to reuse? | `supabase/functions/eod-radar/slack.ts` (`slackCall`, `postMessage`, `authTest`, `missingScopes`, `lookupByEmail`) plus the claim, send and record discipline of `cockpit-hours-watch/slack.ts`. **Not** `cockpit-media-api/execute.ts`'s Slack read-back: it compares exact text, and its only production run ended in `reconcile` although Slack had posted. | §4 |
| Plumbing | One table `cockpit_slack_notices`, queued by database triggers, and one sender Edge Function on a one-minute cron. | §5 |
| Who to mention | Kickoff: the creative director (the Blueprint call is next). Blueprint complete: the client card's CSM (the phase 5 WhatsApp and the launch call are next). Today these are `U0B2SHGS1JA` and `U0C5JHUCTPG`, both in the channel. Matched by email, never by name. | §6 |
| Message text | "Kickoff complete: {client}" and "Brand Blueprint complete: {client}", with buttons to the cockpit client page and the ClickUp card. "Offer locked" goes as a thread reply. | §7 |

---

## 1. The channels today

### 1.1 #csm-general (`C09RZ0GS0V9`, private)

Members (8): the CEO `U09305KE2KS`, the systems manager `U0AS90SHMH8`, the
creative director `U0B2SHGS1JA`, the CSM `U0C5JHUCTPG`, **mahara-club-bot**
`U0C0MJZNS2Y`, **Abdulaziz's Second Assistant** `U0BTL0GH79N` (the agents'
bot), Viktor `U0B32DYNLBA`, and **Admin Bot** `U0925Q9RT9C` (the Slack user
"info", which Make posts as). Source: `slack_list_channel_members`, concise
and ids_only.

The last 100 messages (2026-10-11 15:54 BST to 2026-10-25 10:06 GMT):

| Count | Poster | What | Made by | Format |
|---|---|---|---|---|
| 26 | Admin Bot | "*Report reminder pending approval — {client}*", the exact WhatsApp text, a REVIEW link to a Make hook, a sheet link | Make 08 "Report Reminder - Request Approval" `9572554` [3] | bold headline with an em dash, plain lines, `<url\|label>` links |
| 17 | mahara-club-bot | "*Prepare the client review*", task name, CSM mention, one line, buttons | `hermes/video-review-flow/worker.py:191-192` | bold headline, mentions, buttons |
| 16 | mahara-club-bot | ":warning: {client}", state lines, "Open secure review" link | `hermes/ad-billing-guard/transport.ts:250-281` over `cockpit_ad_billing_deliveries` | blocks with URL buttons, `Reference: BG-{id}` in the fallback text |
| 13 | mahara-club-bot | ":pushpin: New task assigned", task, mentions, due date, button, "Client Success" | `hermes/task-assignment-alerts/worker.py:250-290` | header, section, actions and context blocks, `TA-{id}` in the fallback text |
| 11 | Admin Bot | "*Client summary pending approval — {client}*", the AI WhatsApp recap, APPROVE / DENY links | Make 06 `9209179` [24] | as Make 08 |
| 6 | mahara-club-bot | "*Video ready for internal review*", task, CD and CSM mentions, one line | `hermes/video-review-flow/worker.py:186-189` | as above |
| 6 | the CEO | instructions to the CSM | person | |
| 5 | various | joins and leaves (the bot joined 10-12, Sabry joined and two call centre agents left on 10-13, the Second Assistant joined 10-22) | Slack | |

Make also routes "02. Confirm Charge" `9585358` [4] ("Recorded. *{client}*
charged ${amount}.") here; it did not post in this window. Source: Make
blueprint scan (§8).

So the channel already carries about 6 bot posts a day. Kickoffs (6 in
October in the mirror, `cockpit_client_onboarding.forms->'kickoff'->>'submitted_at'`)
and Blueprint closes would add a few a month.

### 1.2 #csm-announcements (`C09SNG5BP53`, private)

Members (5): Admin Bot, the CEO, the Second Assistant, mahara-club-bot
(joined 2026-10-12 15:19 BST), the CSM. It carries the daily "fill out your
eod reminder" (Make 02 "Send - CSM" `8257112`, posted as the CEO through Make
connection `9285542`), and Make's client-lifecycle posts: client review,
referral, upsells, extension given, contract termination survey, lead list
(§8). The last client-lifecycle posts in the 100 read were three INTERNAL TEST
items on 2026-09-14 (extension, cancellation form, termination survey).

### 1.3 #csm-client-notis (`C09TCNBP4L9`, private)

Members (3): Admin Bot, the CEO, the CSM. **mahara-club-bot is not a member.**
All 100 messages (2026-10-18 to 2026-10-25) are Make 05 "Notify CSM When
Client Responds" `8069472` [3] "*Client texted us in ONBOARDING*" cards (name,
phone, email, message, contact link, "React With"). It is a noisy, client-data
channel. Do not put form notices here.

### 1.4 #media-general (`C0AE8G5MT7Y`, private)

mahara-club-bot **is a member** (13 members, ids_only list includes
`U0C0MJZNS2Y`). This matters for the Blueprint: SPEC.md:17 and :820 hold
`close_route = card_only` "until the Slack bot is in #media-general". That
condition is now met. Flipping it is the CEO's or an admin's call
(`cockpit_blueprint_settings_set`, `20261024a_brand_blueprints.sql:1139-1160`),
and it should wait for the read-back fix in §4.3.

---

## 2. Which Slack identity posts where

| Identity | How it is reached | What it is | Use for #csm-general? | Source |
|---|---|---|---|---|
| **mahara-club-bot** `U0C0MJZNS2Y` | Supabase function secret `SLACK_BOT_TOKEN` (project `bldgtotkfmhoxmlzowdx`; secrets are project-wide, so every function reads the same one). The VPS hermes workers carry it in their private runtime credentials. | The cockpit bot. Posts EOD Radar and Hubstaff watch in #team-management, ad billing, task and video notices in #csm-general. | **Yes** | `eod-radar/index.ts:39`, `cockpit-hours-watch/index.ts:26`, `cockpit-media-api/tools.ts:24`; poster name in `slack_read_channel C0B5TL9H370` and `C09RZ0GS0V9` |
| Abdulaziz's Second Assistant `U0BTL0GH79N` (bot `B0BSPLUNH9U`) | **`SLACK_BOT_TOKEN` in the shared VPS env `/opt/data/bibi/api-keys.env`** | The agents' assistant bot, with very broad scopes. | **No.** A worker that loads the shared env posts as the assistant, not the cockpit. This is the same trap that broke EOD delivery on 12-14 Oct. | `auth.test` with that env on 2026-10-25 returned `user_id U0BTL0GH79N`; memory `eod-slack-delivery.md` |
| Admin Bot / "info" `U0925Q9RT9C` | Make connections `12932135` "Real Bot", `12932051` "BOT", `9286244` (Slack **user** tokens of the info account) | A person account Make posts as. Scopes on `12932135`: chat:write, chat:write.public, chat:write.customize, channels/groups/im/mpim read, users:read. | No. Outside the health ledger, and on the Make path the team is retiring. | Make `GET /connections/12932135` and `/connections?teamId=2108984` |
| The CEO `U09305KE2KS` | Make connections `9285542` "Admin Bot", `12757286`, `12931897` | Make posts the EOD reminders as the CEO. | No | same |

What mahara-club-bot can do, shown by what it already does:
- **Post in a private channel it is in**: 112 accepted ad billing posts to
  `C09RZ0GS0V9` (`cockpit_ad_billing_deliveries`, state `accepted`, last
  2026-10-25 11:10).
- **Post in a public channel without joining** (chat:write.public):
  #team-management `C0B5TL9H370` is public (`slack_search_channels`) and the
  bot is not a member (ids_only lists `U09305KE2KS`, `U0BTL0GH79N`,
  `U0C0XFZLD1D`), yet 7 EOD Radar digests and 28 Hubstaff alerts are `posted`
  there (`cockpit_eod_radar_digests`, `cockpit_hours_watch_incidents`).
- **Read private channel history** (groups:history): 700 `conversations.history`
  calls answered 200 with no error in 3 days (`cockpit_eod_radar_receipts`).
- **Look people up by email** (users:read.email): 8 `users.lookupByEmail`
  calls answered 200 on 2026-10-23 (same table).

---

## 3. Kickoff and Blueprint in Slack today

| Event | What posts | Where | Source |
|---|---|---|---|
| Kickoff `tG7dnxBn` submitted | Make 12 `8925654`: **nothing in Slack** (14 modules, none `slack:*`) | none | Make blueprint scan |
| Kickoff `tG7dnxBn` submitted | Make 06 `9209179` [24]: "*Client summary pending approval — {Client Data col 1}*" + GPT recap + the Blueprint booking line + APPROVE / DENY links (Make 07 `9523861` sends the WhatsApp) | #csm-general, as Admin Bot | Make 06 blueprint, module 24 mapper |
| Blueprint `oYZKtogO` completed (Typeform) | Make 14 `9748311` [5]: "*Brand Blueprint completed*\n\nClient: {legal_name}\nService focus: {service_focus}\nClient task: https://app.clickup.com/t/{id}\n\nThe blueprint call is done and the full form is in. Scripts and custom creative can start." | **#media-general** `C0AE8G5MT7Y`, as Admin Bot | Make 14 module 5 mapper; last seen live for ARDON on 2026-09-13 (`slack_search_public_and_private "Brand Blueprint"`) |
| Blueprint, native "Close the call" (part 2) | `close_route = card_only`: no Slack. `slack`: "Brand Blueprint completed: {card}. Scripts and custom creative can start. {launch link}" to #media-general through the outbox. | #media-general only | `cockpit-creative-api/blueprint.ts:129-130`; `blueprintBrief.ts:677-682`; `cockpit_blueprint_settings` row `close_route = card_only` (SQL) |

State of the native Blueprint in production: one `cockpit_blueprints` row
(Smmim studio, `parts = {}`), and `cockpit_creative_outbox` is empty, so no
press has run yet. Make 14's log API returns no runs in its retention window.

The check-in `fRokTITH` also feeds Make 06 route 1, which posts a call grade to
`C09SVG6FHGU` (Make 06 [15]). That channel's name was not read here.

---

## 4. How cockpit Slack posts are made reliable today

### 4.1 The five patterns in the repo

| Pattern | Where | Ledger | Duplicate guard | Unknown outcome | Read-back | Fit for form notices |
|---|---|---|---|---|---|---|
| Hubstaff watch | `cockpit-hours-watch/slack.ts:33-139`; states and the transition trigger in `20261013d_cockpit_hours_watch.sql:212, 221, 290-293`; sweep at `:621-623` | `cockpit_hours_provider_health` (intent, response, unknown) | a claim RPC moves `pending → sending` before the send | "may have arrived", never sent again; a `sending` left 10 minutes becomes `unknown` | none (trusts `ts`) | **Yes, the discipline to copy** |
| EOD Radar | `eod-radar/slack.ts:41-177`; `20261015210000_eod_radar.sql:121-155` | `cockpit_eod_radar_receipts` | one digest per day, claimed | `onSend` marks the moment the request leaves; after that a break is `unknown` | none; validates `ts` shape | **Yes, the HTTP helper to copy**: it also reads `retry-after` on 429, the `x-oauth-scopes` header, and has `authTest`, `missingScopes`, `lookupByEmail` |
| Ad billing guard (VPS) | `hermes/ad-billing-guard/transport.ts:238-389`; table `20261011174920_ad_billing_guard.sql:40-51` | Supabase outbox `cockpit_ad_billing_deliveries` | `UNIQUE(event_id, channel, destination)`; `client_msg_id`; marker `Reference: BG-{id}` | reconcile reads `conversations.history` and matches the marker; a miss is never a resend | marker search | Good model for reconcile. Runs on the VPS. |
| Task assignment alerts (VPS) | `hermes/task-assignment-alerts/worker.py:166-190, 250-330` | private SQLite ledger + `cockpit_sync_state` health row | stable uuid5 per event; `TA-{id}` in the fallback text | `unknown` is reconciled by history search, never replayed | marker search | Good model for format and reconcile |
| Outbox plan step | `cockpit-media-api/execute.ts:20` with `providerTools` (`tools.ts:24-53`) | `cockpit_media_provider_health` | the outbox row | throws; the row goes to `reconcile` | **exact text equality** with `conversations.history` | **No** (4.3) |

The ad billing watchdog (`ad-billing-watchdog/handler.ts:39-56`) is a small
fifth variant: claim RPC, one POST with `client_msg_id`, record RPC, no retry.

### 4.2 Slack facts the sender must respect

- Slack answers **200 with `ok:false`** on a refusal. Check both. (`eod-radar/slack.ts:13, 75`)
- A 5xx, a timeout or an unreadable 200 after the request left **may have posted**. Record `unknown`, never resend. (`cockpit-hours-watch/slack.ts:65-66`)
- `chat.postMessage` has **no documented idempotency key**. The repo sends `client_msg_id` (`transport.ts:272`, `ad-billing-watchdog/handler.ts:44`) but every reconcile also matches a text marker, which is the dependable key.
- With blocks, `text` is the notification and search fallback. Put the reference marker there (`worker.py:282`).
- Escape `&`, `<`, `>` in anything that came from a client (`transport.ts:269-271`, `worker.py:79-80`). Client names contain `&` today (one report reminder card in §1.1 names such a client).
- Links are `<url|label>`, mentions `<@U…>`, bold `*…*` (single stars). Make 06 rewrites GPT's `**` to `*` for this reason (module 24 mapper).
- Space posts about a second apart (`worker.py:182-184`).

### 4.3 The read-back that does not work

`execute.ts:20` posts, then reads the message back and requires
`actual.text === expected.text`. Slack does not store text as sent: it wraps
a bare URL in angle brackets and turns an email into a `mailto` link. Proof:
- Make 14 sent `Client task: https://app.clickup.com/t/{id}` (module 5
  mapper); Slack returns it as `Client task: <https://app.clickup.com/t/86eyurepc>`
  (`slack_search_public_and_private`, ARDON, 2026-09-13).
- The only production run of this read-back, media action
  `f70b71ec-8a28-42fc-9413-7260a98d4486` (`edit.askViktorFor`, 2026-10-14),
  shows `chat.postMessage` 200 with a `ts` and `conversations.history` 200
  (`cockpit_media_provider_health`), yet the action ended
  `state = reconcile`, "Slack message read-back could not be confirmed;
  reconcile before sending again" (`cockpit_media_actions`). Its text carries
  the requester's email (`cockpit-media-api/slack.ts:6`), the likely cause.

`blueprintBrief.slackCloseText` (`blueprintBrief.ts:681`) ends with a bare
ClickUp URL, so **`close_route = slack` would post and then mark the close
for reconcile every time.** The unit test does not catch it because its fake
echoes the text back unchanged (`blueprint.test.ts:197`). Fix before flipping
the route: confirm by `ok`, `channel` and `ts` from `chat.postMessage`, and
reconcile unknowns by a reference marker, as the VPS workers do. This also
means the #csm-general notice should **not** be added as one more step in the
Blueprint close plan: a Slack hiccup would put the whole close into
reconcile.

---

## 5. Recommended plumbing: one outbox, one sender

### 5.1 The table (one migration, Supabase-first)

`cockpit_slack_notices`:

| Column | Notes |
|---|---|
| `id uuid` PK | also the reference marker, `Ref CN-{first 8}` |
| `kind text` | `kickoff.complete`, `blueprint.complete`, `blueprint.offer_locked`; later `extension.given`, `pause.requested`, `cancellation.received`, `ticket.created`, … (CHECK list) |
| `dedupe_key text UNIQUE` | `kickoff:{response_id}`, `blueprint:{task_id}:close`, `blueprint:{task_id}:offer` |
| `task_id`, `client_name` | the ClickUp client card |
| `channel text` | CHECK against an allowlist (`C09RZ0GS0V9` first) |
| `parent_id uuid` | the notice this one replies to (offer locked → close); the sender reads the parent's `slack_ts` |
| `facts jsonb` | names, first names, ids, dates, links. Never answers, phones, emails or message bodies. |
| `text text`, `blocks jsonb` | written at claim time from `facts`, kept for the audit |
| `state text` | `queued → sending → posted \| failed \| unknown`; `queued → skipped \| muted`; `unknown → posted` (reconcile only). A trigger refuses any other move, as `20261013d_cockpit_hours_watch.sql:290-293` does. CHECK `state <> 'posted' OR slack_ts IS NOT NULL`. |
| `attempts`, `next_attempt_at`, `claimed_at`, `finished_at`, `slack_ts`, `error` | `error` is a plain sentence of at most 240 characters |

RLS on, `REVOKE ALL FROM PUBLIC, anon, authenticated`, `GRANT` to
`service_role` in the same migration. Every state change writes one
`cockpit_audit_log` row through a trigger. Browsers read through one gated
`SECURITY DEFINER` function (the client's CSM, creative seats, admins, the
CEO) that returns the state, the time and a Slack permalink, never the text
of another client. A small settings row per kind holds `on` and the channel;
`off` turns a queued notice into `muted` at claim, like the Hubstaff switch.

### 5.2 Who queues (database triggers, so no path forgets)

| Notice | Trigger | Why there |
|---|---|---|
| Kickoff complete | AFTER INSERT OR UPDATE on `cockpit_client_onboarding` when `forms->'kickoff'->>'response_id'` is new or changed **and** `submitted_at` is within 48 hours | Both publish paths write this row (`cockpit_csm_onboarding_publish` and `_cron_publish`), so a kickoff filled in the cockpit **or** straight in Typeform is caught, and only once Typeform lists it. The cockpit's own one-card refreshes at 45 s, 2 and 5 minutes (KICKOFF.md §4.2) make it land within about a minute. The 48-hour window stops a resync from posting old kickoffs (30 rows already have one). |
| Second kickoff | the same trigger, when `cockpit_csm_form_sends.second` is true for that response, or the row already had another kickoff response | KICKOFF.md §4.4: a second kickoff reruns Make 12 |
| Brand Blueprint complete (native) | AFTER UPDATE on `cockpit_creative_outbox` when `kind = 'blueprintClose'` and `state` becomes `done`, first press only (SPEC.md:363) | the close's ClickUp writes are finished and read back; posted on every `close_route` |
| Brand Blueprint complete (Typeform, while `oYZKtogO` lives) | the onboarding trigger, when `forms->'blueprint'->>'response_id'` is new | `dedupe_key blueprint:{task}:close` keeps it to one post whichever path comes first |
| Offer locked | AFTER UPDATE on `cockpit_creative_outbox`, `kind = 'blueprintOffer'`, `done`, first press | a thread reply under the close notice |

Nothing is queued for "Send to media" (part 1). The media team already gets
the launch task, and an assigned task posts to #client-ads-general through
the task assignment worker (SPEC.md:324).

### 5.3 The sender

A new Edge Function, for example `cockpit-notices`, JWT check off,
`x-cron-secret` from the vault's `cockpit_sync_secret` (the eod-radar and
hours-watch pattern), on pg_cron every minute (`mahara-slack-notices`). Each
run, under one lock:

1. Sweep: `sending` older than 10 minutes becomes `unknown`.
2. Reconcile up to 10 `unknown` rows: `conversations.history` on the channel
   from `claimed_at - 60 s`, match the `CN-` marker in `text`; found means
   `posted` with that `ts`. Not found stays `unknown` for a person to check
   (`worker.py:166-180`, `transport.ts:318-355`). Never resend.
3. Claim up to 10 `queued` rows whose `next_attempt_at` has passed (one RPC,
   `queued → sending`, `attempts + 1`).
4. Build the text from `facts` (a pure, tested `noticeText(kind, facts)`),
   resolve mentions (§6), store `text` and `blocks`.
5. `chat.postMessage` with `channel`, `text`, `blocks`, `unfurl_links:false`,
   `unfurl_media:false`, and `thread_ts` for a reply, through a `slackTools`
   helper added to `cockpit-csm-api/tools.ts`, written like
   `eod-radar/slack.ts:41-87` and `:145-162`, writing intent and response
   receipts to `cockpit_csm_provider_health` (provider `slack`, `run_key` =
   the notice id). That table already takes Slack receipts (2,270 in 7 days
   from the CSM call sync) and is the CSM cockpit's ledger. The project rule
   is "every external call goes through the helpers in tools.ts", and
   `cockpit-csm-api/tools.ts` has no Slack helper yet.
6. Record: `ok` with `ts` and the same `channel` is `posted`; `ratelimited`
   is `queued` again after `retry-after` (3 attempts at most); any other
   refusal (`not_in_channel`, `channel_not_found`, `is_archived`,
   `invalid_blocks`, `missing_scope`) is `failed` with a plain sentence;
   anything after the request left is `unknown`.

`doctor` (POST `{"job":"doctor"}`): `auth.test` must return `U0C0MJZNS2Y`
(refuse to post as any other bot); `conversations.info C09RZ0GS0V9` must say
`is_private` and `is_member`; `x-oauth-scopes` must include `chat:write`,
`groups:history`, `users:read.email` (`eod-radar/slack.ts:165-177`,
`cockpit-hours-watch/slack.ts:142-152`). `dryRun` builds the next five
notices and posts nothing.

Health and operations, per the radar's discipline:
- one guardian Queue row in `hermes/cockpit-guardian/checks/queues.py:48-70`
  (states `queued`, `sending`, `unknown`; 15 minutes; `failed_col = finished_at`);
- a RUNBOOK row (doctor, dry run, how to check an `unknown` in Slack, how to
  requeue a `failed` one);
- the kickoff window's trail and the Blueprint close summary gain one stop:
  "Posted in #csm-general at 14:03", or "Not posted: {reason}. Tell the tech
  lead." Missing is never shown as done.

---

## 6. Who to mention

**Rule:** match by email, never by name (`task-assignment-alerts/README.md`
"Slack identities match exact, unique active email addresses"). If there is
no match, write the first name in plain text and add a health warning.

Resolution order for a person:
1. ClickUp user on the client card's CSM field `68ff84db-6c66-4e70-8e72-15d70828fda6`
   (`blueprintBrief.ts:17`, read as in `blueprint.ts:34`) gives an email;
2. `cockpit_people.email` (active) → `cockpit_eod_radar_slack_ids.slack_user_id`
   with `state = 'ok'` (refreshed weekly by `users.lookupByEmail`,
   `20261015210000_eod_radar.sql:121-131`);
3. otherwise one live `users.lookupByEmail` (`eod-radar/slack.ts:129-137`).

The creative director: the active `cockpit_members` seat with role
`creative`, not `admin`, scoped to the client or to all clients (the
`roles()` rule in `hermes/video-review-flow/worker.py:77-83`).

Today (SQL over `cockpit_members`, `cockpit_people`, `cockpit_eod_radar_slack_ids`):

| Seat | Slack ID | In #csm-general |
|---|---|---|
| the creative director (only non-admin creative seat, all clients) | `U0B2SHGS1JA` | yes |
| the CSM (only non-admin CSM seat, all clients) | `U0C5JHUCTPG` | yes |
| the CEO | `U09305KE2KS` (no row in `cockpit_eod_radar_slack_ids`; found by lookup) | yes |

The card's CSM today (`cockpit_client_onboarding.csm`): the CSM on 26 cards,
none on 20, a former CSM no longer on the roster on 13, the CEO on 11. A card
whose CSM is inactive or empty gets "No active CSM on the card." in place of a
mention.

| Notice | Mention | Why |
|---|---|---|
| Kickoff complete | the creative director | the Brand Blueprint call is next, and it is theirs |
| Kickoff complete, filled by someone other than the card's CSM | also the card's CSM | so the owner knows |
| Second kickoff | the card's CSM | duplicates to clean up |
| Brand Blueprint complete | the card's CSM | the phase 5 WhatsApp (pasted by the CSM while `card_only`) and the launch call are next |
| Offer locked (thread reply) | nobody | quiet update |

No `@channel` or `@here`.

---

## 7. The message text

House copy rules apply (`blueprintBrief.ts:8-10`): plain lines, sentence
case, no exclamation marks, no em dashes, no promise of results. So the
headline uses a colon, not "—" as the ask wrote it. Times are Kuwait time.
`{client}` is the card name, escaped.

### 7.1 Kickoff complete

Fallback `text` (the push notification, and what reconcile searches):

```
Kickoff complete: {client}. Next is the Brand Blueprint call. Ref CN-{id8}
```

Blocks:

```
*Kickoff complete: {client}*
Filled by {first name | "in Typeform"} on {Sun 25 Oct, 14:02}.
Next is the Brand Blueprint call. <@{creative director}>
[Open in the cockpit]  [Open the ClickUp card]
Client success · Ref CN-{id8}
```

- Open in the cockpit: `https://cockpit.maharamedia.com/client-success/clients/{taskId}?tab=onboarding`
  (route `/clients/:key`, `AuthenticatedAppRoutes.tsx:143`; base
  `/client-success/`, `vite.config.ts:8`; the `?tab=onboarding` form is used
  in `scripts/blueprint-host.test.tsx:187`).
- Open the ClickUp card: `https://app.clickup.com/t/{taskId}` (`blueprintBrief.ts:242`).
- Leave out the Blueprint booking date until it has a verified source
  (Not verified, §9).

Second kickoff, one line added under the headline:

```
This is the second kickoff for this client. Make ran again: check the card for a second Technical and Creative task, and do not send it a third time. <@{card CSM}>
```

### 7.2 Brand Blueprint complete (native close, first press)

```
text: Brand Blueprint complete: {client}. Next is the launch call. Ref CN-{id8}

*Brand Blueprint complete: {client}*
Closed by {CD first name} on {Mon 26 Oct, 15:40}. Scripts and custom creative can start.
<@{card CSM}> next: {route line}
{launch call line}
[Open in the cockpit]  [Read the Blueprint]  [Open the ClickUp card]
Client success · Ref CN-{id8}
```

- `{route line}`: `card_only` or `slack`: "send the phase 5 WhatsApp from your
  comment on the card, then book the launch call." `make`: "Make sent the
  phase 5 WhatsApp. Book the launch call." (the close comment carries the
  WhatsApp text, `blueprint.ts:125-128`).
- `{launch call line}`: "Launch call booked for {date}." when the close
  payload's `launchCall.startsAt` is set (SPEC.md:300), else "Launch call not
  booked yet."
- Read the Blueprint: `https://cockpit.maharamedia.com/client-success/clients/{taskId}/present/blueprint?view=prep`
  (`AuthenticatedAppRoutes.tsx:78`; CSM seats can read it, SPEC.md §0).
- The media launch task link is for #media-general, not here.

From the Typeform path (while `oYZKtogO` is still live) the second line reads
"The Blueprint form is in." and there is no route line.

### 7.3 Offer locked (thread reply under 7.2)

```
Offer locked by {CD first name}. Brand DNA is {complete | still missing}. Ref CN-{id8}
```

### 7.4 What never goes in

Answers, prices, budgets, phone numbers, emails, WhatsApp text, AI
summaries. The client recap stays in Make 06's approval card while that runs.

---

## 8. Every Make scenario that posts to Slack (active ones)

To fold into the same outbox later, one form at a time. Channel names are
given only where read. All post as Admin Bot (`12932135`/`12932051`) unless
the connection says the CEO (`9285542`). Source: `GET /scenarios/{id}/blueprint`
for every active scenario, 2026-10-25.

| Scenario | Trigger | Slack module, channel | Headline |
|---|---|---|---|
| 06 Post Call Summary `9209179` | Typeform (kickoff, Blueprint, check-in) | [24] #csm-general; [15] `C09SVG6FHGU` | "Client summary pending approval — {client}"; `{{4.result}}` call grade |
| 08 Report Reminder `9572554` | webhook | [3] #csm-general | "Report reminder pending approval — {client}" |
| 02 Confirm Charge `9585358` | webhook | [4] #csm-general | "Recorded. *{client}* charged ${amount}." |
| 14 Brand Blueprint Form Submitted `9748311` | webhook | [5] #media-general | "Brand Blueprint completed" |
| 14 Client Extension Given `9000763` | Typeform | [5] #csm-announcements | "{client} has been given a {duration} extension" |
| 03 Client Extension Given (OLD) `8069181` | webhook | [5] #csm-announcements | same |
| Client Lifecycle - Contract Termination Survey submitted `9805538` | Typeform | [5] #csm-announcements | "Contract Termination Survey submitted" |
| 12 NPS Survey `8962328` | Typeform | [2] `C09TTGBRQ0G` | "NPS Anonymous Survey Feedback" |
| 11 CSAT - Onboarding `8962387` | Typeform | [2] `C09TTGBRQ0G` | "CSAT Onboarding Process Feedback" |
| 07 NPS and CSAT (OLD) `8068892` | webhook | [2], [4] `C09TTGBRQ0G` | same two |
| 01 Client Review `9169735` | Typeform | [3] #csm-announcements | "New Client Review Received" |
| 02 Client Referral `9188441` | Typeform | [4] #csm-announcements | "New Referral Received" |
| 03 Backend Upsell `9190294`, 04 Website Upsell `9195843`, 05 SMM Upsell `9205789` | Typeform | #csm-announcements | "New Backend Upgrade", "New Website Upsell", "New Social Media Management Upsell" |
| 15 Client Lead List `9122691` | Typeform | [3] #csm-announcements | "New Lead List Submitted — Reactivation Campaign" |
| 10 Client Resume Due `9686154` | ClickUp list | [3] #media-general | "{client} — pause ends {date}" |
| 10 Closer Form to Onboarding (MAIN) `8979157` | Typeform (New Client Form) | [53] `C09MNHBAY1Y` | "Pew Pew" |
| 16 ClickUp Launch Campaigns `9356423` | ClickUp | `C0AE4GKQKS7`, `C0ATR7Y6HQ9`, `C09MNHBAY1Y` | first and later campaign launched, billing scheduled |
| 17 Client Card Info `9018535` | Typeform | a DM `D09SHBK5G8H`, as the CEO | "New Payment Info Received" |
| 05 Notify CSM When Client Responds `8069472` | webhook | #csm-client-notis | "Client texted us in ONBOARDING / LIVE / Churned" |

No active scenario has a Slack module for the Pause Request Form
`CTUjv6l3` or the 1-1 call notes beyond Make 06. Team EOD and lead alerts are
left out here.

---

## 9. Not verified

- **That the Supabase secret `SLACK_BOT_TOKEN` is mahara-club-bot.** Inferred
  from the poster name on the Edge Functions' posts in #team-management;
  `auth.test` cannot be run against a function secret from outside. The
  doctor in §5.3 settles it.
- **mahara-club-bot's full scope list.** Shown by use: chat:write,
  chat:write.public, groups:history, users:read.email. `metadata.message:read`
  and the rest are unknown, so the plan does not rely on message metadata.
- **Whether Slack keeps `client_msg_id` on bot posts.** Undocumented for
  `chat.postMessage`; the plan relies on the text marker.
- **The exact cause of the 2026-10-14 read-back failure.** The email
  auto-link is the likely cause; the message text was not read back here.
- **Who posted "NEW CANCELLATION FORM SUBMITTED" on 2026-09-14** in
  #csm-announcements: no active scenario has that headline. It may be an
  inactive scenario; inactive ones were not scanned.
- **A verified Blueprint booking date for the kickoff notice.** The GHL
  calendar to ClickUp POC sync was described in Slack (#csm-general,
  2026-10-22) but its field was not read here.
- **The names of `C09TTGBRQ0G`, `C09SVG6FHGU`, `C09MNHBAY1Y`, `C0AE4GKQKS7`,
  `C0ATR7Y6HQ9`.** Not looked up.

## 10. Actions for later (not taken)

1. None is needed for access: mahara-club-bot is already in #csm-general.
2. Fix the exact-text read-back (§4.3) before anyone sets `close_route = slack`.
3. Keep VPS workers off the shared env's `SLACK_BOT_TOKEN` (it is the
   assistant bot), or have them refuse any `auth.test` user other than
   `U0C0MJZNS2Y`.
4. When a Make form moves into the cockpit, retire its Slack module in the
   same release, so a notice is never posted twice by two posters.

---

## Follow-up 2026-10-25

This section settles the sender for step 2 of the CEO's ask: the
#csm-general notices for the kickoff and the Brand Blueprint. It is read-only
like the rest. Nothing was posted, reacted to or scheduled. Sources: SQL
through `sq.py` (SELECT only), the Slack MCP read tools, the worktree code, and
one Make blueprint GET. Emails, phone numbers and message bodies are left out.
People are named by role.

### F1. The Edge secret posts as mahara-club-bot (proven)

The Edge Functions `eod-radar` and `cockpit-hours-watch` saved these Slack
timestamps. I read each message in Slack.

| Saved in | Channel | `ts` | Poster | Bot ID |
|---|---|---|---|---|
| `cockpit_eod_radar_digests`, day 2026-10-24 | #team-management `C0B5TL9H370` | `1792872070.187739` | mahara-club-bot `U0C0MJZNS2Y` | `B0C02J2D37H` |
| same, day 2026-10-22 | same | `1792699271.301169` | `U0C0MJZNS2Y` | `B0C02J2D37H` |
| same, day 2026-10-21 | same | `1792612871.641659` | `U0C0MJZNS2Y` | `B0C02J2D37H` |
| `cockpit_hours_watch_incidents`, opened 2026-10-25 10:30 | same | `1792913412.949169` | `U0C0MJZNS2Y` | `B0C02J2D37H` |
| same | same | `1792913412.711119` | `U0C0MJZNS2Y` | `B0C02J2D37H` |
| same | same | `1792913412.467669` | `U0C0MJZNS2Y` | `B0C02J2D37H` |

Sources: `SELECT channel, slack_ts, day FROM cockpit_eod_radar_digests WHERE slack_ts IS NOT NULL ORDER BY day DESC LIMIT 3`;
`SELECT slack_channel, slack_ts, opened_at FROM cockpit_hours_watch_incidents WHERE slack_ts IS NOT NULL ORDER BY opened_at DESC LIMIT 3`
(the table has no `created_at`); `slack_read_channel C0B5TL9H370` at each `ts`.
The bot ID is the one Slack shows for the poster's bot user.

Why this proves the secret:
- Only two functions write those timestamps.
  - `cockpit_eod_radar_digest_result` (`20261015210000_eod_radar.sql:527-538`)
    is executable by `service_role` only (`:671-672`). It is called from
    `eod-radar/run.ts:345`.
  - `cockpit_hours_watch_slack_result` (`20261013d_cockpit_hours_watch.sql:785-801`)
    is executable by `service_role` only (`:1248-1249`). It is called from
    `cockpit-hours-watch/slack.ts:99`.
- Both functions read `Deno.env.get("SLACK_BOT_TOKEN")`
  (`eod-radar/index.ts:39`, `cockpit-hours-watch/index.ts:26`).
- A third proof covers the media and creative APIs. The only Slack post
  `cockpit-media-api` ever made (action `f70b71ec…`, `ts 1791986176.215829`)
  sits in the DM `D0C0KSKSSQZ`, and `U0C0MJZNS2Y` posted it
  (`slack_read_channel U0C0MJZNS2Y`). That function reads `SLACK_BOT_TOKEN` at
  `cockpit-media-api/tools.ts:24`. `cockpit-creative-api` uses the same
  `providerTools` (`blueprint.ts:2`, `outbox.ts:2`).

So the first "Not verified" item in §9 is now settled. Every Edge Function
that reads `SLACK_BOT_TOKEN` posts as mahara-club-bot, including the Blueprint
close.

The three #csm-general workers on the VPS, from the code:

| Worker | Env var | Where the code loads it | Posts in #csm-general as | Proof in Slack |
|---|---|---|---|---|
| `hermes/ad-billing-guard` | `SLACK_BOT_TOKEN` | `{...process.env, ...config}`, where `config` is the private JSON at `$AD_BILLING_CONFIG` (`main.ts:14-18`, `run.sh:4`). Used at `transport.ts:240, 263, 343`. Channel `CSM_SLACK_CHANNEL` (`core.ts:7`). | mahara-club-bot | `ts 1791863740.151259` in `C09RZ0GS0V9` (`cockpit_ad_billing_deliveries.provider_id`, state `accepted`) |
| `hermes/task-assignment-alerts` | `SLACK_BOT_TOKEN` | The `credentials_file` named in the private config (`worker.py:385, 398-400`; `README.md:55`). Used at `worker.py:98`. Route `901816723211 → C09RZ0GS0V9` (`worker.py:25`). | mahara-club-bot | `ts 1792250525.411229` and `1792056252.316769` ("New task assigned", search) |
| `hermes/video-review-flow` | `SLACK_BOT_TOKEN`, through the parent class it loads from `task-assignment-alerts/worker.py` (`worker.py:7-8, 42`) | Its own `credentials_file` (`worker.py:249`). Sends at `:234`. `CSM = 'C09RZ0GS0V9'` (`:11`). | mahara-club-bot | `ts 1792452367.905479` and `1791822975.908529` ("Prepare the client review", search) |

The code alone does not name the bot. None of the three calls `auth.test`
before it posts. They use the same variable name as the shared VPS env, whose
token is the assistant bot `U0BTL0GH79N` (§2, `auth.test` of 2026-10-25). So
their private files must hold a different value, and production shows they
do. One weak spot: `ad-billing-guard` spreads `process.env` first. A run whose
config lacked `SLACK_BOT_TOKEN`, started from a shell that had loaded the
shared env, would post as the assistant bot. Not verified: how each cron
starts on the VPS (the VPS was not touched).

### F2. The exact-text read-back fails in production (settled)

Media action `f70b71ec-8a28-42fc-9413-7260a98d4486` (`edit.askViktorFor`,
2026-10-14 16:56 Kuwait time):
- `state = reconcile`. The error is "Slack message read-back could not be
  confirmed; reconcile before sending again"
  (`SELECT state, result->>'error' FROM cockpit_media_actions WHERE id = …`).
- Receipts: `chat.postMessage` 200 with `ts 1791986176.215829`, then
  `conversations.history` 200 (`cockpit_media_provider_health` by `action_id`).
- The plan sent to channel `U09305KE2KS` (a DM). Its 214-character text held
  an email and a URL, and no `&`, `<` or `>` (regex tests on
  `request->'plan'->'body'->>'text'`; the text was not printed).

What Slack stored at that `ts` in `D0C0KSKSSQZ`:

| Sent | Stored |
|---|---|
| the requester's email as plain text | `<mailto:{email}\|{email}>` |
| a bare Google Drive URL | the same URL wrapped in `<` and `>` |
| the Arabic request and the campaign name | unchanged, as far as the read shows |

The `&` case is also seen in production. Slack stores `&amp;`. An Admin Bot
card in #csm-general (Make 06 [24], 2026-10-07 12:58 BST) is stored as
"…Shades Interior Design &amp; General Contracting"
(`slack_search_public_and_private in:#csm-general is:thread from:U0925Q9RT9C`).
Not verified: whether Make sent `&` or `&amp;`. Either way, an exact compare
against a raw `&` fails.

Why the action failed. `execute.ts:20` checks the receipt's `ok`, `ts` and a
`C`/`D`/`G` channel. It then reads the one message back by `ts` and throws
unless `actual.text === expected.text`. If Slack had refused the history read,
`tools.ts:47-52` would have thrown "slack rejected the request" instead. The
saved error is the read-back sentence, so the read worked and the text
differed. The cause is the `mailto` and URL rewriting shown above.

A native close on `close_route = 'slack'`:
- `prepareClose` adds the #media-general step on the first press, after the
  ClickUp steps (`cockpit-creative-api/blueprint.ts:129-130`). The step uses
  `expected:{text}` and `slackMessage:true`.
- The text comes from `slackCloseText` (`blueprintBrief.ts:677-682`). It ends
  with ` https://app.clickup.com/t/{launch task}` whenever a launch task is
  found (`cardUrl`, `:242`). The card name is not escaped.
- Any throw marks the outbox row and the media action `reconcile`
  (`outbox.ts:68`), after the ClickUp writes and the Slack post have already
  happened. A new run then needs reconciliation first (`outbox.ts:53`).

**Answer: yes, it would end in `reconcile`** whenever a launch task is found
(the normal case after part 1), or when the card name holds `&`, `<` or `>`
(1 of 70 mirror cards today: `SELECT count(*) FILTER (WHERE client_name ~ '[&<>]') FROM cockpit_client_onboarding`).
It passes only with no launch task and a plain name. The unit test misses this
because its fake echoes the text back (`blueprint.test.ts:197`, §4.3).

Ruling on the contradiction: this map is right. These designs must not reuse
the exact-text read-back for Slack:
- blueprint-path.md §6 build step 2 (`verifyPath conversations.history`, `expected:{text}`);
- repo-forms.md §8.2 ("the Slack read-back of `cockpit-media-api/execute.ts:20`");
- kickoff-path.md §8.3 step 2 ("read the post back").

The rule for every new Slack sender:
- `posted` means `ok: true`, the same channel ID back, and a `ts` of the right
  shape (`task-assignment-alerts/worker.py:182-189`);
- anything after the request left is `unknown`, reconciled by a marker in
  history and never sent again (`worker.py:166-180`).

Fix `execute.ts:20` the same way before anyone sets `close_route = 'slack'` or
adds another `slackMessage` plan. Confirm on the receipt, and at most check
that the `ts` exists in history.

### F3. One design, with the facts that decide it

#### F3a. How the kickoff record is written

| Function | Rewrites the row? | Forms | Runs in production |
|---|---|---|---|
| `cockpit_csm_onboarding_publish` (one card) | **Every call rewrites every column.** `ON CONFLICT … DO UPDATE SET` has no `WHERE`, so an `AFTER UPDATE` trigger fires on every call, even when nothing changed. | Incoming forms when `p_forms_verified`, else the old forms kept | One run ever (`trigger = 'one'`, 2026-10-05 12:55) |
| `cockpit_csm_onboarding_cron_publish` (every 10 minutes) | Only rows whose tracked columns differ, or whose forms differ when verified (`DO UPDATE … WHERE (…) IS DISTINCT FROM (…) OR (p_forms_verified AND t.forms IS DISTINCT FROM excluded.forms)`). A written row gets every column rewritten. | Verified: the fresh forms. Unverified: `t.forms` kept; a new card gets `{}`. | 143 runs in the last 24 hours, all `ok`. The last four (13:44-14:14 on 10-25) wrote 0 of 70 cards. |

Source: `SELECT prosrc FROM pg_proc WHERE proname IN (…)`;
`cockpit_client_onboarding_runs` (SQL). Example of the unverified case: the run
at 2026-10-14 01:34 says "Typeform could not be verified. Existing submitted
forms are retained."

Does `forms->'kickoff'->>'response_id'` change only on a new response? Yes, in
practice:
- `formsFor` keeps the newest completed kickoff across `tG7dnxBn` and
  `BbJy6xg4`, by `submitted_at` (`onboardingCore.ts:489-513`).
- The read asks for `completed=true` responses and pages through all of them
  (`cockpit-csm-api/onboarding.ts`, `readFormData`, `page_size 1000`).
- So the ID moves only when a newer kickoff arrives for that card, which is a
  second kickoff.
- A label edit in Typeform changes `forms` on many rows but leaves the
  response ID alone. That is why a trigger must compare the ID, not `forms`.
- Not verified: a deleted newest response would move the ID back to an older
  one. No such case appeared in 14 days. The kickoff count went 27 → 29 on
  10-15 and 29 → 30 on 10-20, and never fell (daily min/max of
  `counts->>'kickoff_forms'`).

How a trigger tells a new kickoff from a re-publish:
1. It fires only when `NEW.forms->'kickoff'->>'response_id'` is not null.
2. It checks that the row is an INSERT, or that the ID differs from OLD's.
   This test goes in the function body. A `WHEN` clause on an
   `INSERT OR UPDATE` trigger cannot read `OLD`.
3. It inserts `dedupe_key = 'kickoff:' || response_id` with
   `ON CONFLICT DO NOTHING`. The unique key, not the OLD/NEW compare, is what
   makes it once only.
4. The state is `queued` only if `submitted_at` is within 48 hours, else
   `skipped`. `second` is true when OLD had another ID.
5. It must never raise. It runs inside the cron publish, so an error would
   roll back the batch and stop the mirror.

The 30 rows that hold a kickoff today:
- 30 distinct response IDs, none null;
- 23 on `BbJy6xg4` and 7 on `tG7dnxBn`;
- submitted from 2026-04-05 to 2026-10-20 11:55 UTC;
- 0 within 48 hours and 1 within 7 days.

So switching the trigger on posts nothing old. To be safe, the same migration
should also seed those 30 IDs as `skipped`.

#### F3b. How a Blueprint close is settled

- No SQL function settles a close. `cockpit-creative-api` updates the table
  directly:
  - claim `pending → sending` (`outbox.ts:60`);
  - then `state:'done', result, settled_at`, only from `sending` (`outbox.ts:62`);
  - or `reconcile` on any error (`outbox.ts:68`).
- The migration's `cockpit_blueprint_outbox_settled`
  (`20261024a_brand_blueprints.sql:1205-1222`) is for `blueprintLaunch` only.
- A database trigger can see a close become done:
  `AFTER UPDATE OF state ON cockpit_creative_outbox`, with
  `WHEN (OLD.state = 'sending' AND NEW.state = 'done' AND NEW.kind = 'blueprintClose')`.
  - The table already has an `AFTER INSERT OR UPDATE` audit trigger
    (`cockpit_creative_outbox_audit`, `pg_trigger`).
  - The pattern exists: `cockpit_media_confirmed_effects` is
    `AFTER UPDATE OF state ON cockpit_media_actions` (`pg_get_triggerdef`).

Telling the first close from a later one:
- `payload->'previous'` is JSON null on the first close.
  `cockpit_blueprint_payload` fills it from the latest close that started,
  with `reconcile` counted (migration `:557-568`, `:596`).
- That is the wrong key for the notice. If the first close ends in
  `reconcile` and a later press succeeds, the later press has a `previous`,
  and no notice would ever post.
- Key the notice on `dedupe_key = 'blueprint:' || task_id || ':close'` with
  `ON CONFLICT DO NOTHING`. The first close that reaches `done` posts, once.
  Later presses hit the key and post nothing.
- Use `previous` only to word the message. `result->>'closeRoute'` and
  `result->>'launchTaskId'` (`blueprint.ts:133`) give the route line and the
  launch link.
- `payload->>'press'` counts every press, including superseded ones
  (migration `:1067-1086`), so it is not a first-press test either.

Today `cockpit_creative_outbox` has no rows and `close_route = 'card_only'`
(SQL).

#### F3c. The Slack helpers that exist

| File | Slack helper | Ledger it writes | Notes |
|---|---|---|---|
| `cockpit-csm-api/tools.ts` | **none**. It has `providerTools` (ClickUp only, `:3-14`), `ghlTools` (`:16`), `storageTools` (`:41`), `typeformTools` (`:60`). | `cockpit_csm_provider_health`, written by each caller's `health` callback (`index.ts:71`, `onboarding.ts:45`, …) | The ledger's 2,310 Slack rows in 7 days are all `GET conversations.history`, written by the VPS `hermes/csm-calls/lib.ts:167`, not by an Edge helper (SQL by provider and resource). |
| `cockpit-media-api/tools.ts` | `providerTools`, provider `slack` (`:24-27`): any Web API path, Bearer `SLACK_BOT_TOKEN` | `cockpit_media_provider_health`, through the caller's callback (creative: `outbox.ts:56`) | Every `ok:false` becomes one thrown sentence (`:47-52`). No `retry-after`, no scope header. One Slack post ever. |
| `eod-radar/slack.ts` (not a tools.ts) | `slackCall` `:41-87`, `readChannel` `:97`, `lookupByEmail` `:129`, `postMessage` `:145` (text only), `authTest` `:165`, `missingScopes` `:173` | `cockpit_eod_radar_receipts` | Reads `x-oauth-scopes` (`:73`) and `retry-after` (`:79`). `onSend` marks the request as left (`:47, 54`). |
| `cockpit-hours-watch/slack.ts` | `slackApi` `:33`, `sendPost` `:79` (claim and result RPCs), `checkChannel` `:142`; thread replies at `:132` | `cockpit_hours_provider_health` | The claim, send and record discipline. `cockpit-hours-sync/nudge.ts:112` writes the same ledger. |
| `ad-billing-watchdog/handler.ts` | inline `chat.postMessage` `:41` | `cockpit_ad_billing_watchdog_claim` and `_result` RPCs | One send, no retry |

#### F3d. The default (decided)

**One Slack outbox, `cockpit_slack_notices`.** Two database triggers queue
it. One Edge Function, `cockpit-notices`, sends it through a new `slackTools`
helper in `cockpit-csm-api/tools.ts`. A post counts as sent on Slack's own
receipt. An unknown is checked against a `Ref CN-` marker and is never sent
again.

| Piece | Default | Taken from | Dropped |
|---|---|---|---|
| Outbox | `cockpit_slack_notices`, columns as in §5.1 | this map §5.1 | `cockpit_form_notices` (kickoff-path §8.3); an extra step in the close plan (blueprint-path §6) |
| Kickoff queue | the trigger in F3a | kickoff-path option C; §5.2 | the cockpit's `onSubmit` |
| Blueprint queue | `AFTER UPDATE OF state` on `cockpit_creative_outbox`, F3b; `blueprintOffer` done gives the thread reply (`…:offer`, `parent_id` = the close notice) | §5.2 | a Slack step in `prepareClose` |
| Typeform Blueprint (while `oYZKtogO` lives) | the onboarding trigger on `forms->'blueprint'->>'response_id'`, the same key `blueprint:{task}:close` | §5.2 | |
| Sender | `cockpit-notices`: `verify_jwt` off, `x-cron-secret`, pg_cron every minute under one lock. It sweeps, reconciles, claims, sends and records (§5.3). | §5.3 | a Slack drain in `forms-door` |
| Helper | `slackTools` in `cockpit-csm-api/tools.ts`, written on `eod-radar/slack.ts:41-87`, plus `blocks` and `thread_ts` | §5.3 | Slack through `cockpit-media-api/tools.ts` |
| Ledger | `cockpit_csm_provider_health`, provider `slack`, `run_key` = the notice ID, `action_id` null (the FK points to `cockpit_csm_actions`) | | `cockpit_media_provider_health` |
| Confirmation | the receipt rule in F2; reconcile by marker | `task-assignment-alerts/worker.py:166-189` | the exact-text read-back |
| Identity | the doctor refuses unless `auth.test` returns `U0C0MJZNS2Y` | §5.3 | |
| Forms backend, later | a `slack.post` effect in `cockpit_form_effects` inserts a `cockpit_slack_notices` row with the same `dedupe_key` and is settled when that row posts. `forms-door` never posts to Slack itself. | repo-forms.md §8, reconciled | a second Slack sender |

Why this default:
1. **It catches every way in.** The cron writes the kickoff record from
   Typeform whatever path the client took. The cockpit-side paths are
   unproven: `cockpit_csm_form_sends` has 0 rows, and the 45 s, 2 min and
   5 min checks (`forms/kickoff.ts:54`) have never run in production (one
   `'one'` run ever). A notice that waits on them would miss kickoffs.
2. **A Slack failure never touches ClickUp or the close.** The close plan
   stays as it is, and the trigger only fires after `done`.
3. **Once only, by construction.** A unique `dedupe_key` with `ON CONFLICT DO
   NOTHING`, and no resend of an unknown.
4. **It ships now.** Step 2 does not wait for the three-table forms backend,
   and that backend later reuses this sender.
5. **Right ledger, better helper.** The CSM ledger is the CSM cockpit's and
   already takes Slack receipts. The eod-radar call handles rate limits and
   scopes; the media `providerTools` does not. Importing a sibling function's
   `tools.ts` is already the pattern (`cockpit-creative-api/blueprint.ts:2`).

The kickoff notice can add the card's state from the same mirror row at send
time (`client_status`, `links`), with no ClickUp call. That gives kickoff-path
§8.3's "Make has not updated the card" alarm. Make 12 books nothing: it has no
calendar module (F6). So the copy says "Next is the Brand Blueprint call",
never "booked".

### F4. Who to tag

| Role | Seat rule | Slack ID | Source |
|---|---|---|---|
| the CEO | admin and `ceo` seat | `U09305KE2KS` | the Slack MCP's own user. No `cockpit_eod_radar_slack_ids` row for the CEO's person (SQL). |
| the systems manager | admin seat | `U0AS90SHMH8` | `cockpit_eod_radar_slack_ids`, state `ok` |
| the creative seat (people role "Creative strategist"; §6 calls it the creative director) | the only active non-admin `creative` seat; `clients = {}`, which means all clients | `U0B2SHGS1JA` | `cockpit_members` → `cockpit_people` by email → `cockpit_eod_radar_slack_ids`, state `ok` |
| the CSM | the only active non-admin `csm` seat; `clients = {}` | `U0C5JHUCTPG` | same |

Source: one SQL join of the three tables. Emails were used for the join only
and not printed.

The card's CSM field (`68ff84db-…`, mirrored as `cockpit_client_onboarding.csm`):

| CSM field names | Cards | In onboarding |
|---|---|---|
| the CSM (active) | 26 | 7 |
| the CEO (active, not a CSM seat) | 11 | 0 |
| a person who is no longer active | 13 | 0 |
| nobody | 20 | 1 |

So **33 of 70 cards name an inactive person or nobody**. Every non-empty value
matched a `cockpit_people` name, and no card names two people (SQL).

The mirror stores the ClickUp username, not an email
(`onboardingCore.ts:316-319`). The Blueprint payload carries only that name
too (`cockpit_blueprint_payload`, `o.csm`), and `csmOf` gives a ClickUp ID and
username (`blueprint.ts:34`). So the rule "match by email, never by name"
cannot run from the record. The default is to tag by seat, with the
`roles()` rule of `hermes/video-review-flow/worker.py:77-83`: active, not
admin, the role, and the client in `clients` or `clients` empty.
- Kickoff complete: tag the creative seat.
- Brand Blueprint complete and second kickoff: tag the CSM seat.
- Offer locked: tag nobody.
- When the card's CSM is not the CSM seat's person, add the name in plain
  text. When the field is empty or inactive, add "No active CSM on the card."

The mention format of `hermes/task-assignment-alerts/worker.py`:
- `<@{id}>`, only when the ID matches `[UW][A-Z0-9]+` (`:262-263`). The ID
  comes from an exact, unique email match among users who are not deleted
  and not bots (`users.list`, `:151-164`).
- Otherwise the escaped name (`escape`, `:79-80`), plus one line: "Slack
  mention unavailable for an assignee; check the ClickUp name." (`:264-266`,
  `:278-279`).
- No `@channel` or `@here`.
- The Edge sender looks up `cockpit_eod_radar_slack_ids` (state `ok`) first,
  then calls `users.lookupByEmail` (`eod-radar/slack.ts:129`).

### F5. Membership and thread replies

- `U0C0MJZNS2Y` is a member of #csm-general `C09RZ0GS0V9` (8 members) and of
  #media-general `C0AE8G5MT7Y` (13 members), from `slack_list_channel_members`
  (ids_only, 2026-10-25).
- Bots already post thread replies in #csm-general. The assistant bot
  `U0BTL0GH79N` replied at `ts 1792668106.651289` in thread
  `1792667385.671249` on 2026-10-22, and in more of that thread
  (`in:#csm-general is:thread`).
- mahara-club-bot has posted **no** thread reply in #csm-general
  (`in:#csm-general is:thread from:U0C0MJZNS2Y` returns nothing).
- It does post thread replies elsewhere:
  - #team-management: "Shift ended" at `ts 1792854021.130039` in thread
    `1792827007.269779`, from `cockpit-hours-watch/slack.ts:132`;
  - #tech-general: `ts 1792840530.373209` in thread `1792835126.961729`, from
    `hermes/lead-sync-watch/worker.ts:295`.
- So "Offer locked" as a thread reply works with this bot. It needs the parent
  notice's `slack_ts`. If the parent is not `posted`, post at the top level.

### F6. Contradictions settled here

| Contradiction | Ruling | Evidence |
|---|---|---|
| Exact-text read-back: this map against blueprint-path §6, repo-forms §8.2 and kickoff-path §8.3 | It fails on URLs, emails and `&`. Do not reuse it. | F2 |
| Four outboxes and two homes for the helper | One outbox, `cockpit_slack_notices`; `slackTools` in `cockpit-csm-api/tools.ts`; the forms backend feeds it | F3d |
| The Edge identity was "inferred" (§9); blueprint-path §8 "not verified" | Proven: mahara-club-bot `U0C0MJZNS2Y` / `B0C02J2D37H`, including `cockpit-media-api` and so the creative API | F1 |
| Is the Edge bot in #media-general? (blueprint-path) | Yes | F5 |
| Names of `C09SVG6FHGU`, `C09TTGBRQ0G` (§9 here) | #client-call-feedback and #nps-survey-feedback, both private, as fathom.md and typeform-inventory.md say | `slack_search_channels "feedback"` |
| Make 12 has 13 or 14 modules | Both counts are right. There are 14 modules, including router [14], so 13 do work. | `GET /scenarios/8925654/blueprint`: [1, 11, 20, 14, 17, 18, 21, 22, 23, 26, 27, 24, 28, 25] |
| "Make 12 books the Brand Blueprint" (memory note, cockpit copy) | It books nothing. Its modules are Typeform, ClickUp (10), a router, Sheets, sleep and Whapi [25]. The notice copy must not say "booked". | same blueprint |
| Make 06's routes "1 and 2" against "0 and 1" | The same routes. Router [30] index 0 is [3, 17, 4, 21, 15] (call grade to #client-call-feedback). Index 1 is [22, 23, 24] (the summary card in #csm-general). §3's "route 1" means index 0. Use module IDs. | `GET /scenarios/9209179/blueprint` |

The other contradictions in the brief (partial routes, Make 06's errors and
run count, extension fields, the pause filler, survey hosting, Make 7908153,
the Typeform scenario counts) are outside the Slack sender. They were not
re-checked here.

### F7. Not verified in this follow-up

- How each VPS worker's cron sets its environment, so whether
  `ad-billing-guard` could ever inherit the shared env's token. The VPS was
  not touched.
- Whether Make sent `&` or `&amp;` in the 2026-10-07 card. Only the stored
  text was read.
- That `conversations.history` on #csm-general with `oldest = claimed_at - 60 s`
  always finds a marker within one page. The VPS workers page up to 20 times
  (`worker.py:167-180`), and the sender should too.
- Whether Slack keeps `client_msg_id` on bot posts (§9, unchanged). The
  default still relies on the text marker.
