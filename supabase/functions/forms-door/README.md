# forms-door

Typeform's push of each response of five forms into the forms tables:
kickoff (`tG7dnxBn`, `docs/forms/STAGE2B-CONTRACT.md` 4.8, build 8), since
waves 1-2 (`docs/forms/WAVE12-CONTRACT.md` 4.4) the termination survey
(`knIe4eF3`, form key `exit_survey`) and the client's pause request
(`CTUjv6l3`, form key `pause_request`), and since waves 3-4
(`docs/forms/WAVE34-CONTRACT.md` 4.7, 4.8) the client's onboarding form
(`KFRCXPFx`, form key `onboarding`) and the New Client Form (`BTzMwXiw`, form
key `new_client`). Each form has its own signing key, its own registry row and
its own health row; the sections below describe kickoff first, then what
differs for the other forms.

## Kickoff

The kickoff door runs beside the csm-calls worker's 15-minute read (`csm-forms-record`, which records every
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
| 1 | `{form}` not one of `FORM_KEYS` (`kickoff`, `exit_survey`, `pause_request`): the checkin row also has a `typeform_id` and provider `typeform`, so the door names its forms itself (Z58) | 404 `{"ok":false}` |
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

## The termination survey and the pause request (waves 1-2)

Both are client forms that stay live in Typeform until wave 3. The door takes
the same steps 1 to 7 as kickoff, each form with its own key
(`cockpit_forms_key_get('typeform_exit_survey')`,
`cockpit_forms_key_get('typeform_pause_request')`), registry row, limiters and
health row (`forms-door:exit_survey`, `forms-door:pause_request`). Step 8
differs: `cockpit_form_record_legacy(p)` with
`p = {formKey, externalId (the token), submittedAt, answers: {fields: [{ref,
title, type, value}]}, hidden, taskId, clientName, backfill: false}`
(`legacyInput` in `handler.ts`).

- **What is stored:** the answers with the worker's own mapping, less every
  answer whose type is `email`, `phone_number` or `contact_info` (both forms
  ask for contact details the card already holds, inventory 3.3 and 3.4), and
  only the two hidden fields the forms set, `client_name` and
  `onboarding_client_id`. A legacy response (`state 'legacy'`), never a card
  change (D11).
- **The card:** the form's own hidden `onboarding_client_id`, written by the
  card's Termination Form Link (`24a77b61`) or Pause Form Link (`3a04c8a1`)
  field, inventory 3.3 and 3.4. The database keeps it only when that card is
  on the billing sheet. No card id, no match: the client name is kept as the
  form gave it and never matched (W12); a CSM picks the card in the cockpit
  (`cockpit_form_legacy_match`).
- **What it queues:** a new termination survey queues one "Termination notice
  in" (`termination.notice`, #csm-general, tags the CSM) in the database; a
  pause request queues nothing, because its row on Today is the signal (W18).
  A backfilled row queues nothing at all.

The old answers come in once with
`scripts/dev/forms_legacy_backfill.py {exit_survey|pause_request}` (`--dry`
first): the same `legacyInput` rules, `backfill: true`, counts only.

## Client onboarding and the New Client Form (waves 3-4)

Make owns every effect of both forms (card fields, the Client Data sheet, the
phase 3 WhatsApp, the Brand DNA task and the GitHub dispatch for onboarding;
the sub-account, Mahara OS, the welcome, the card, the CSM post, HighLevel,
Cortana and the B2B closed deals for the New Client Form). The door **records
only**, through `cockpit_form_record_make`: one `submitted` response per
Typeform token, no notice (V23), and nothing ever submits either form; tests
use the recorded-shape payloads in `fixtures/`.

- `onboarding`: the answers are shaped by the onboarding sync's own mapping,
  `formsFor` in `apps/client-success-cockpit/src/lib/onboardingCore.ts`
  (imported, never copied; one response and its definition, no Typeform API
  call), so the database can fill `cockpit_client_onboarding.forms.onboarding`
  with exactly the entry the 10-minute read writes, when that key is empty or
  older. The card is the hidden `onboarding_client_id` when the cockpit mirrors
  it (`hidden_id_unverified`).
- `new_client`: the legacy mapping (no email or phone answer) and the form's
  three hidden ids (`contact_id`, `closer`, `setter`); no card (Make makes it).
- A termination survey through the old link after the exit survey turned
  native (C4b) is still stored: the registry row keeps its Typeform id, so the
  door accepts a native `exit_survey` or `pause_request` row and the database
  posts "Old form link used" (V16). Kickoff still needs its Typeform row.

`fixtures/onboarding-expected.json` and `fixtures/new-client-expected.json`
are the golden inputs: the handler test holds `makeInput` to them, and
`scripts/dev/test_forms_legacy_backfill.py` holds the backfill's Python port
to the same files.

## Stage 4: the old links once kickoff and onboarding are native (waves 5-6)

`cockpit_form_stage4_go_live` (`20261102j_stage4_native.sql`) turns the kickoff
or the onboarding native and keeps the registry row's Typeform id, so the old
link still reaches this door (`docs/forms/WAVE56-CONTRACT.md` 4.14.2, 4.15.3, X26):

- **kickoff, native:** stored through `cockpit_form_record_legacy` with the
  legacy mapping (no email or phone answer, only `client_name` and
  `onboarding_client_id`), state `legacy`, and "Old form link used"
  (`legacy.received`). Nothing runs: the native kickoff is the cockpit's sheet.
- **onboarding, native:** sent to `cockpit_form_onboarding_typeform` as
  `{p_payload: makeInput('onboarding', response)}`; the database maps it by
  Typeform ref into version-2 answers and runs the same planner as a portal
  answer, once per card. A card that already holds an onboarding answer or a
  kickoff, or no card, is stored `legacy` with the notice and runs nothing.
  `KFRCXPFx` stays open and Make `8979157` [40] keeps sending its link.

Before the go-live both keep their stores above. A registry row with no
Typeform id is still a 404.

## Register, probe, unregister (B3, deploy step D17)

From the Mac, through the read-only ssh pattern of 2a 4.5 (keys by name, values
never printed), with `scripts/dev/forms_key.py`:

```sh
python3 scripts/dev/forms_key.py typeform-secret kickoff     # 32 random bytes, base64url, saved by cockpit_forms_key_put, never printed
python3 scripts/dev/forms_key.py register-typeform kickoff   # PUT /forms/tG7dnxBn/webhooks/cockpit, read back, marked connected
python3 scripts/dev/forms_key.py probe-typeform kickoff      # unsigned POST must get 401, a signed probe 200
python3 scripts/dev/forms_key.py status                      # typeform_kickoff connected, last 4 only
```

The two client forms register the same way with their own form key, at their
own deploy steps: `exit_survey` at D-F4, `pause_request` at D-C2 (before Make
9805613 goes off, W18):

```sh
python3 scripts/dev/forms_key.py typeform-secret exit_survey
python3 scripts/dev/forms_key.py register-typeform exit_survey    # PUT /forms/knIe4eF3/webhooks/cockpit
python3 scripts/dev/forms_key.py probe-typeform exit_survey       # 401, then 200
python3 scripts/dev/forms_legacy_backfill.py exit_survey --dry    # counts only, nothing written
python3 scripts/dev/forms_legacy_backfill.py exit_survey          # the old answers, no notice
```

Read back: `GET /forms/tG7dnxBn/webhooks` lists `cockpit` enabled beside the
existing `WHTP3992232`, unchanged; `forms-door:kickoff` `detail.registered`
true; every Typeform call receipted in `cockpit_csm_provider_health`. Refused
(the Typeform token may lack the webhooks scope): recorded, and nothing depends
on it, because the 15-minute read records every kickoff. Rollback:
`python3 scripts/dev/forms_key.py unregister-typeform kickoff`.

## Deploy

`verify_jwt` off; the bundle carries seven files from outside the folder
(`python3 scripts/dev/fn_extras.py . forms-door`):
`apps/client-success-cockpit/src/lib/onboardingCore.ts` (since waves 3-4, D-C2),
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
body, answer or hidden value in any log line; for the two client forms, their own keys, the legacy record's
input with no email or phone, an unmatched survey, and a pause request on the same path; for the two Make forms,
their own keys, `formsFor`'s entry on the recorded payload, the New Client Form's hidden ids with no contact
details, the native exit survey's old link, and the golden inputs the backfill shares.
