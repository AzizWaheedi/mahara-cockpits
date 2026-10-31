# forms-door

Typeform's push of each kickoff response (form `tG7dnxBn`) into the forms
tables (`docs/forms/STAGE2B-CONTRACT.md` 4.8, build 8). It runs beside the
csm-calls worker's 15-minute read (`csm-forms-record`, which records every
stored kickoff through `cockpit_form_record_sweep`) and writes through the
same store, so whichever comes first the response is recorded once. Until the
webhook is registered (B3, below), the 15-minute read is the only source and
nothing is missing but a few minutes.

It **records only**. Kickoff keeps its Stage 1 path (Y49, Z21): the notice is
still made by `20261025n`, and no row this door writes is ever a delivery.

Deployed with `verify_jwt` **off**: Typeform sends no JWT, so its signature is
the only door (`../team-onboarding-intake/signature.ts`), checked before
anything of the body is parsed. It needs no secret of its own:
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` come from the platform, the
signing key from the vault (`cockpit_forms_key_get('typeform_kickoff')`).

## One delivery

| Step | What happens | Answer |
| --- | --- | --- |
| 1 | Any path but `/forms-door/typeform/{form}` | 404 `{"ok":false}` |
| 1 | Anything but POST | 405 `{"ok":false}` |
| 1 | `{form}` other than `kickoff`: the checkin row also has a `typeform_id` and provider `typeform`, so in 2b only kickoff has a cockpit webhook (Z58) | 404 `{"ok":false}` |
| 2 | The body is read once; over 1,500,000 bytes | 413 `{"ok":false}` |
| 3 | The registry row (`cockpit_forms`, kept 5 minutes per isolate) no longer has a `typeform_id`, or its provider is not `typeform` | 404 `{"ok":false}` |
| 4 | The signing key from the vault, kept 5 minutes per isolate. None saved: recorded `failed`, `No signing key saved` (at most once in 30 seconds per isolate), and the key read again at most once in 30 seconds per isolate, so a flood before registration costs one read and one write | 503 `{"ok":false}`; Typeform retries |
| 5 | The `Typeform-Signature` header (`sha256=` + base64 HMAC-SHA256 of the raw body) is missing or does not match. When the cached key was read 30 seconds ago or more, the key is read once more and the signature checked again first, so a rotated key (`typeform-secret`, then `register-typeform`) works at once instead of after the 5-minute cache; that read happens at most once in 30 seconds per isolate (a read that fails answers 503, a key no longer saved answers as step 4). Recorded `unsigned` at most once in 30 seconds per isolate, so a flood costs one read and one write | 401 `{"ok":false}`, nothing parsed |
| 6 | A signed request with `x-forms-door-probe: 1` (`forms_key.py probe-typeform`). Recorded `probe` | 200 `{"ok":true,"probe":true}`, nothing stored |
| 7 | Not a `form_response` event, or not of the registry's form. Recorded `ignored` | 202 `{"ignored":true}` |
| 8 | `cockpit_form_record_typeform(p)` with `p = {formKey, token, submittedAt, hidden, answers, recordingUrl, via: 'typeform_webhook'}` (3.9): `answers` built with the worker's own `formAnswers(item, fieldTitles(definition))` and `recordingIn(answers)` (`hermes/csm-calls/match.ts`), so the webhook and the 15-minute read store the same row. New: recorded `recorded`; a token already stored: recorded `repeat` | 200 `{"ok":true,"inserted":true}` or `{"ok":true,"inserted":false}` |
| 9 | The store refuses it | recorded `failed` with the database's code only (`The store refused the response (22023).`); 500 `{"ok":false}`, Typeform retries |

The record RPC keeps the content once, in `cockpit_csm_call_forms`, as the
worker writes it; the `cockpit_form_responses` row holds a pointer
(`{source: 'typeform', formId, token}`) and `hidden = {onboarding_client_id}`
only, because kickoff's hidden fields carry the client's email and phone and
the responses audit trigger copies `hidden`.

Each outcome goes to `cockpit_sync_state` `forms-door:kickoff` through
`cockpit_forms_door_seen` (`detail.lastDelivery`, `detail.outcome`), best
effort: a failed write never changes the answer. The guardian's
`forms-kickoff-webhook` reads it with `detail.registered`.

The row's `ok` follows one rule, because the URL is open to anyone:

- **What sets it true:** the first save or mark of the key writes the row with
  `ok` true. Any later delivery that passes the signature does too: `recorded`,
  `repeat`, `ignored` or `probe`.
- **What fails it:** only a signed delivery the store refused, or a registered
  webhook that has lost its key.
- **What is quiet:** an unsigned POST, or any POST while no key is saved and
  nothing is registered. It updates `detail.lastDelivery` and `detail.outcome`
  but neither fails the row nor clears a real failure, and a failing row keeps
  its note.
- **What clears an old failure without a delivery:** saving a new key or
  unregistering, because no delivery is left to lose. A mark that leaves the
  webhook registered does not clear it; the next signed delivery does.

`cockpit_forms_door_seen` tells the two no-key cases apart by the exact reason
`No signing key saved` in `handler.ts`. If that sentence changes, such a POST
turns the row red: visible, and safe.

Nothing is logged but one line per delivery, `forms-door kickoff {outcome}`:
never a body, an answer, a hidden value, a header value, a token or a key.

## Register, probe, unregister (B3, deploy step D17)

From the Mac, through the read-only ssh pattern of 2a 4.5 (keys by name, values
never printed), with `scripts/dev/forms_key.py`:

```sh
python3 scripts/dev/forms_key.py typeform-secret kickoff     # 32 random bytes, base64url, saved by cockpit_forms_key_put, never printed
python3 scripts/dev/forms_key.py register-typeform kickoff   # PUT /forms/tG7dnxBn/webhooks/cockpit, read back, marked connected
python3 scripts/dev/forms_key.py probe-typeform kickoff      # unsigned POST must get 401, a signed probe 200
python3 scripts/dev/forms_key.py status                      # typeform_kickoff connected, last 4 only
```

Read back: `GET /forms/tG7dnxBn/webhooks` lists `cockpit` enabled beside the
existing `WHTP3992232`, unchanged; `forms-door:kickoff` `detail.registered`
true; every Typeform call receipted in `cockpit_csm_provider_health`. Refused
(the Typeform token may lack the webhooks scope): recorded, and nothing depends
on it, because the 15-minute read records every kickoff. Rollback:
`python3 scripts/dev/forms_key.py unregister-typeform kickoff`.

## Deploy

`verify_jwt` off; the bundle carries six files from outside the folder
(`python3 scripts/dev/fn_extras.py . forms-door`):
`hermes/csm-calls/callMatch.ts`, `hermes/csm-calls/match.ts`,
`supabase/functions/_shared/clickupRetry.ts`,
`supabase/functions/cockpit-ceo-api/tools.ts`,
`supabase/functions/cockpit-hours-sync/db.ts`,
`supabase/functions/team-onboarding-intake/signature.ts`. Read back: an
unsigned POST answers 503 `{"ok":false}` while no key is saved, a GET 405,
`/forms-door/x` 404, and the guardian's `edge-functions` check sees it active.
It deploys at D11, after `20261029y_forms_records.sql` (the record and seen
RPCs): before that a signed delivery would answer 500 and Typeform would retry.

## Tests

`bun test supabase/functions/forms-door`: every route and refusal, a rotated
key accepted at once, the answer mapping of a signed body, the record call's keys, each recorded outcome, and no
body, answer or hidden value in any log line.
