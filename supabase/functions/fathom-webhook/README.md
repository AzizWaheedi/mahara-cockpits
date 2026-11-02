# fathom-webhook

Fathom's push of each finished Customer Success recording into the client
success cockpit's call store (`docs/forms/STAGE2-CONTRACT.md` 4.4). It runs
beside the two other sources of the same recordings, the csm-calls worker's
15-minute read and `cockpit-forms-api`'s pull when the 1-1 notes open, and
writes through the same ingest (`cockpit_fathom_ingest`, migration
`20261027g_fathom_intake.sql`) with the same rules, so whichever source comes
first the call shows once. Until the webhook is registered (below), those two
are the only sources and nothing is missing but a few minutes.

Deployed with `verify_jwt` **off**: Fathom sends no JWT and no custom header,
so its signature is the only door (`verify.ts`).

## One delivery

| Step | What happens | Answer |
| --- | --- | --- |
| 1 | Anything but POST | 405 `{"ok":false}` |
| 1 | A missing `webhook-id`, `webhook-timestamp` or `webhook-signature` header, before the body is read | 401 `{"ok":false}` |
| 1 | The body is read once; over 2,000,000 bytes | 413 `{"ok":false}` |
| 2 | What needs no secret: the timestamp more than 5 minutes from now, or no `v1,` signature in the header. Refused before the secret is read, so such a request costs no vault read | 401 `{"ok":false}`, nothing written |
| 2 | The webhook secret from the vault (`cockpit_forms_key_get('fathom_webhook')`, kept 5 minutes per isolate). None saved, or the database cannot be read. While none is saved, it is read again at most once in 30 seconds per isolate, so a flood before registration costs one vault read in 30 seconds | 503 `{"ok":false}`, nothing written; Fathom retries |
| 3 | The signature: `${webhook-id}.${webhook-timestamp}.${body}`, HMAC-SHA256 keyed with the base64 after `whsec_`, any one `v1,` signature of the header, the timestamp within 5 minutes. It does not hold | 401 `{"ok":false}`, nothing written, nothing echoed |
| 4 | `cockpit_fathom_webhook_seen(webhook-id, timestamp)`. Seen before, unless that delivery failed or was received over 5 minutes ago and never settled | 200 `{"ok":true,"duplicate":true}` |
| 5 | No recording id in the body (not JSON, or not 3 to 20 digits) | settled `ignored`, `Not a meeting.`; 200 `{"ok":true}` |
| 6 | Recorded by another team than Customer Success, or shared with no team. The closer's sales calls and the CEO's recordings stop here: nothing of them is stored | settled `ignored`, `Not a Customer Success recording.`; 200 `{"ok":true}` |
| 7 | The ingest item (below) | |
| 8 | `cockpit_fathom_ingest([item], 'webhook')` | settled `stored` with the recording id; 200 `{"ok":true}` |
| 9 | Any throw from step 4 on | settled `failed` (best effort) with the step and the database's error code only, e.g. `Failed at the ingest step (22023).`; 500 `{"ok":false}`. Fathom's retry keeps the `webhook-id` and passes step 4, because the outcome is `failed` |

## The ingest item

Built with the worker's own rules, so the three sources write the same rows
(contract 3.6):

- `classifyMeeting` with an empty sales set (`fathomRules.ts`); the ingest
  re-checks the sales index itself (4.2, 4.3).
- `meeting` is `meetingRow` without `updated_at`: an `internal` meeting keeps
  metadata only (no summary, action items, highlights or transcript).
- `call` only for a `client` or `candidate` recording: `callRowBase`, then the
  matcher (`callMatch.ts`) over `cockpit_fathom_match_inputs` for the
  recording's start ± 2 hours. Only `exactMatch` writes a client, in the
  worker's words: `same_room` (confidence 1), the client's email on a booking
  within 30 minutes (`appointment_time`, 1) or, for a client on the clients
  list only (as the worker's contacts index), on that client's bookings
  (`invitee_email`, 0.9, contract A7.13), and the recording's link in a stored 1-1 form
  (`form_task_id`, 0.95). A match that names a booking sets `linked_call_id`
  and the booking's `kind`; else `kind` comes from `titleKind`. `client_name`
  is the clients list's name, else the named booking's (a client that has left
  the list). `candidate` is true for a candidate with no client. `hints` are
  `suggestionsFor` (at most 3, business names only; the speakers come from the
  delivery's transcript, which is never stored) only on that unplaced
  candidate: a matched call and a `client` one carry none, as the worker and
  the pull write them (contract A7 items 2 and 12). The matcher reads the
  edited `title` only, never `meeting_title`; the row's `title` and `kind`
  still fall back to it. `raw_hash` is the worker's hash of the same
  recording, so its next run changes nothing.
- The ingest keeps a matched call's match block, never clears a booking link,
  keeps a settled candidate settled and keeps the transcript the worker
  stored.

## The log

One line per delivery, nothing else: `fathom-webhook {first 8 of webhook-id}
{outcome}`, where the outcome is one of `method`, `missing`, `too_large`,
`no_database`, `key_unreadable`, `no_secret`, `stale`, `bad_signature`,
`bad_secret`, `duplicate`, `ignored`, `stored`, `failed`. Never a body, a
header value, a title, a name or a secret.

## Registration and the secret

`scripts/dev/forms_key.py` on the VPS, run by the CEO or with his permission
(contract A3):

- `register-webhook` registers this function with Fathom
  (`triggered_for: ["shared_team_recordings"]`, transcript, summary and action
  items, no CRM matches) and saves the answer's secret through
  `cockpit_forms_key_put`, which also writes `cockpit_sync_state`
  `fathom-webhook` `detail.registered` true. A save that fails deletes the
  webhook at once.
- `probe-webhook` sends one delivery with a wrong signature (expects 401) and
  one signed for a `Probe` team meeting (expects 200 and a delivery row
  `ignored`), then marks the webhook key `connected`.
- `unregister-webhook` removes it from Fathom and marks the registration off,
  so the guardian stops expecting deliveries.

A secret saved anew reaches a warm isolate within 5 minutes; a delivery signed
with it before then is refused with 401 and Fathom retries it. The first secret
reaches an isolate that found none within 30 seconds; a delivery in between is
answered 503 and Fathom retries it. If `probe-webhook` reads HTTP 503 right after
`register-webhook`, run it again in a minute.

Until the webhook is registered, the guardian's `csm-fathom-webhook` reads
"Not registered yet" as a note, not a failure.

## Reading a delivery

`cockpit_fathom_webhook_deliveries` (service role SELECT): `webhook_id`,
`msg_timestamp`, `first_at`, `last_at`, `receipts`, `recording_id`, `outcome`
(`received`, `stored`, `ignored`, `failed`) and `reason`. The latest outcome
is also the note of `cockpit_sync_state` `fathom-webhook`
(`Last delivery {outcome} at {Kuwait time}`). A `received` row older than 5
minutes was cut off before it settled; Fathom's next retry processes it.

## Secrets (read by name, never printed)

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (the platform sets them). The
webhook secret lives in the vault, so this function has no secret of its own.
Without the two, every delivery with its three headers, a fresh timestamp and a
`v1,` signature answers 503 before its signature is checked (the log says
`no_database`), and Fathom retries.

## Imports

`../../../hermes/csm-calls/fathomRules.ts`, `callMatch.ts` and `match.ts`
(`hashOf`, `titleKind`), and `../cockpit-hours-sync/db.ts` (`restRpc`). No
bare import, so `deno.json` maps nothing.

## Run, check, deploy

```bash
bun test supabase/functions/fathom-webhook/verify.test.ts    # no network
bun test supabase/functions/fathom-webhook/handler.test.ts   # no network
```

The bundle check of the contract's section 11 builds it as the deploy does,
from the extras `python3 scripts/dev/fn_extras.py . fathom-webhook` lists. The
deploy is the main session's (section 12, step 11): `deploy_composio.py
fathom-webhook --rev <sha> --extra <those files> --verify-jwt off`, then an
unsigned POST must answer 401.
