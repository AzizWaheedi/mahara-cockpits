# cockpit-forms-api: the 1-1 notes window's server

Stage 2a of the forms plan (`docs/forms/STAGE2-CONTRACT.md`, section 6), with
Stage 2b's three additions (`docs/forms/STAGE2B-CONTRACT.md`: the sweep's drafts,
the recap approval and Move it here's flag). Until the cut-over hour the window
runs only as a shadow run beside Typeform `fRokTITH`, which stays the record:
nothing here reaches a client, a ClickUp card or Slack, and nothing here writes a
client onto a recording. `recap.approve` stores an approval only; the WhatsApp
sender (`hermes/client-messages`) sends, behind its own switch.

## Interface

POST with the seat's Supabase bearer token and `{"op": ..., ...}`. Deployed with
the JWT check **on**. The user comes from `auth.getUser`, the seat from
`cockpit_forms_actor`. A service-role token runs `doctor` and nothing else. A
request carrying `x-cron-secret` runs `effects.sweep` and nothing else when the
secret equals `NOTICES_CRON_SECRET` (both sides trimmed as `cockpit-notices`
trims them, then a constant-time compare; any other op 403
`The cron secret runs the 1-1 notes sweep only.`, a wrong secret 401 `Not
allowed.`). Errors answer `{"error": "<one sentence>"}` with 400, 403 or 404, never a stack,
a key or a provider's body.

| Op | Gate | Answer |
|---|---|---|
| `checkin.calls` | `cockpit_csm_client_gate_for_actor` | `{picked, others, fathom, now}`: the calls these notes may be for (`CallView`, 3.4); one that cannot be picked here carries the save's sentence in `blocked` (A7.3) |
| `checkin.drafts`, `checkin.draftAgain` | the response's own gate (`cockpit_form_responses_read` with the seat's token) | `{recordingId, drafts, started, now}` |
| `checkin.transcript` | the same; the recording, the saved call included, passes the save's checks again and the tie rule below for the seat whose response saved it, and one that is not the saved call is a Customer Success recording | `{url}` (60 s, its own `fathom/{id}.txt` only) or `{text}`; 404 when there is none |
| `checkin.typeformSent` | the client gate per item | `{items: [{taskId, sent, at}], now}` |
| `recap.approve` (2b) | the message's gate (`cockpit_client_message_read` with the seat's token), then `cockpit_client_message_approve` (service only: the seat's client gate and the owner gate, 3.1) | `{message, warnings}` (the stored row's `MessageView`, 3.7) or `{needsConfirm: true, warnings}`; a refused text is 400 with the rule's sentence ending `Edit the text, then approve again.` |
| `effects.sweep` (2b) | the cron secret only (`cockpit_form_effects_kick`, 20261029w) | `{ok, begun, skipped}` |
| `keys.save` | the CEO | `{ok, state, text, last4}` |
| `doctor` | the CEO or the service key | the Doctor (6.7) |

## Files

| File | Holds |
|---|---|
| `index.ts` | `Deno.serve` of the door, deps from env (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TYPEFORM_TOKEN`) |
| `door.ts` | auth, the seat, the routes, the error sentences |
| `calls.ts` | `checkin.calls`: the pasted link, the pull when due, the matcher, the views |
| `fathom.ts` | the light pull and its ingest items, the drafts' summary and transcript reads, `checkin.transcript` |
| `drafts.ts` | `checkin.drafts` and the runner: begin, the input hash, the model calls, the checks, finish |
| `todos.ts` | We owe / They owe from Fathom's action items (the one copy of the rule; the shadow replay imports it) |
| `transcript.ts` | the numbered, role-labelled lines and the quote check |
| `recapRules.ts` | the 14 recap checks, Make [23]'s booking block and `splitRecap` |
| `messages.ts` | `recap.approve` (2b): the read through the seat's gate, the checks on the exact text, the sha256 of its bytes, the service approval as the verified seat |
| `effects.ts` | `effects.sweep` (2b): the waiting grade and recap effects' drafts, begun as the response's own seat with no seat token |
| `prompts/*.ts` | the client notes (DeepSeek), DEFCON and priority, the grade and the recap (Anthropic), each with its `VERSION` |
| `typeform.ts` | `checkin.typeformSent` |
| `keys.ts`, `doctor.ts` | `keys.save` and its key tests; the doctor |
| `testkit.ts` | fakes for the tests (database, Fathom, Typeform, models, storage) |

Outside this folder it imports `../cockpit-csm-api/tools.ts` (`fathomTools`,
`typeformTools`), `../cockpit-media-api/model.ts` (`structuredJsonDetailed`),
`../cockpit-hours-sync/db.ts` (`restRpc`) and
`../../../hermes/csm-calls/{callMatch,fathomRules}.ts`. Deploy them as extras:
`python3 scripts/dev/fn_extras.py . cockpit-forms-api` lists them.

## Which recordings a client's notes can use

Every op reads a recording the same way, in the save's order (`fathom.ts`
`checksOf`, then the tie rule): Fathom still has it, it is a `client` or
`candidate` call, it is on no other client, and the tie rule (A7.14) lets it
stand for this client. A Customer Success recording (its recorder's team, or
one of the CSM's own seats) always may, and so may one whose call row is on
this client and was placed by an exact sign or a person (`same_room`,
`appointment_time`, `form_task_id`, `manual`, `client_id_field`, or
`invitee_email` at 0.9 or more: the store item's `onTaskMethod` and
`onTaskConfidence`, `callMatch.ts` `placedExactly`). A row the worker's
`matchMeeting` wrote on this client from a likely sign (a client's name in the
title, the meeting title or an invitee's name, `name` at 0.6; a company domain,
`invitee_email` at 0.8), or a row with no confidence, settles nothing: the
recording is held to the rest of the rule like one on no client (A7.14 rule 2,
round 3), so a closer's prospect call whose title names a client is never
listed usable, picked, drafted or transcribed on that client's notes for the
CSM. For any other recording made outside Customer Success, the CEO's
or the closer's, the answer is the database's `cockpit_form_recordings_tied`,
the one SQL rule the save holds too: an exact sign over every live booking of
this client, each clause on its own (the same room that no other client's
booking there shares; an external invitee on this client's booking, even when
another client's booking holds the same address, so it ties for each; its link
in a stored 1-1 form of this client), or a seat that may place the
recording itself, as the queue lets it (an admin, the CEO, its recorder). A
likely sign (the title, the company domain) never ties a recording made outside
Customer Success on its own, and neither does a pasted link: it only finds the
recording. A sales call reads `client` until the sales desk indexes it, a day or
more later, so this rule keeps a prospect's call off every client's notes.

`checkin.calls` asks the database once, for the viewer, about the recordings
made outside Customer Success that it would list (an exact or likely sign names
this client, every sign counted, not only the best three a candidate's hints
keep, or its call row on this client was placed by a likely sign) or that were
pasted; with no such sign and no paste, one is not listed at all, for any seat. One the rule does not let the viewer use is ranked out, so it
never takes the pick a usable call would get, and is listed disabled with the
tie rule's sentence (A7.14's sentences, A7.18; `fathom.ts` `outsideOf` and
`tieSentence`). A recording whose call row is on no client, or that has none,
reads `OUTSIDE_CS`: `That recording is from outside Customer Success and is not
on this client. If it is this client's call, ask an admin to match it.` One
whose call row is on this client but was put there only by a likely sign (rule
2 did not settle it) reads `OUTSIDE_CS_LIKELY`, because the client's Calls card
lists that call on this client and no admin tool matches a row already on a
card:
`That recording is from outside Customer Success and was put on this client only
by a name or email domain in it. If it is this client's call, ask an admin to
send the 1-1 notes with it.`
So the CSM sees the CEO's unmatched call whose title names this client, with
`OUTSIDE_CS`, and the CEO picks it; a closer's call the worker put on this client
by a name (`name` 0.6) or a company domain (`invitee_email` 0.8) reads
`OUTSIDE_CS_LIKELY` for her, a closer's call on no client keeps `OUTSIDE_CS`, and
the CEO, an admin and its recorder may still use both. The drafts and the
transcript ask about the response's saved call for the seat whose response it
is, never the seat asking, before any content is read, so a call that turned
sales, internal or gone, moved to another client, or that no rule ties for her,
is never drafted or read, even when the CEO opens the CSM's notes; the drafts'
skip and the transcript's 400 give the same two sentences, chosen the same way. Another client's recording names that client, its title and
its link only to a seat that may see that client (admins and the CEO see every
client; any other seat passes the client gate). With no Fathom key in the vault
only the pull is skipped: the store the worker fills with its own key still
answers, and a pasted link is still looked up.

## The pull's ingest items

`checkin.calls` pulls Fathom's light list when it is due and sends each meeting to
`cockpit_fathom_ingest` as 3.6's item, written the same way the worker and the
webhook write it (A7.2, A7.12). Only `exactMatch` names a client: the same room,
the client on the invite, or the link in a stored 1-1 form, never the link pasted
in the window. The client's name comes from the clients list, else from the
booking the match names. Hints ride only on a candidate that nothing places; a
matched call and a client-class call carry `[]`. The matcher reads the edited
title only, never Fathom's `meeting_title` (in the store, `editedTitle`, A7.13),
and the client on the invite names only a client on the clients list unless its
booking is within 30 minutes (`clientIds`, A7.13). A person's match and a call
set aside as not a 1-1 call are kept by the ingest.

## The 1-1 notes sweep (2b build 0)

A live check-in's grade and recap effects wait for their drafts. When a planned
grade or recap effect younger than 30 minutes has no drafting or ready draft,
`cockpit_form_effects_kick` (every minute, from the notices kick) posts
`{"op":"effects.sweep"}` here with `x-cron-secret` (the vault's
`cockpit_notices_cron_secret`, equal to the project-wide `NOTICES_CRON_SECRET`;
Z11) and the anon key as its bearer, at most once every two minutes.
`sweepEffects` reads `cockpit_form_effects_waiting()`, takes at most four rows
inside a 100-second budget, gets each response's own seat from
`cockpit_forms_actor` (a refused seat skips its row with a log line naming only
the effect and the kind) and calls `draftsForResponse` (`drafts.ts`) with that
response, its one kind and a drafts reader over the service RPC
`cockpit_form_drafts_service`, because `cockpit_form_drafts_read` gates on the
seat's own token, which a cron request does not have (Z42, Z56). No seat RPC is
ever called on that path. The drafts' own guards keep one grade per recording
and one recap per response, and a missing key still writes one `off` row only.
The doctor names `NOTICES_CRON_SECRET` as a boolean (`secrets`), read trimmed
as the door compares it, so a value of only whitespace reads `false`.

## Move it here (2b build 11)

`CallView.movable` is true only for an admin or the CEO, with
`cockpit_forms_switch('move_recording')` reading exactly true (one service read
per `checkin.calls`; off, refused or not live yet reads false), when the view's
one refusal is "on another client" and no 1-1 notes stand for the recording.
Then `blocked` reads `fathom.ts` `onOtherMovable`: `On {other}. If this is
{client}'s call, move it here.` Every other view keeps the A7.3 sentence. The move
itself is the browser RPC `cockpit_csm_move_recording` (20261029z), not an op here.

## Keys and receipts

No new function secret. The Fathom, DeepSeek and Anthropic keys come from the
vault through `cockpit_forms_key_get` on each call; a missing key turns its part
off with a plain sentence. Every Fathom, Typeform, DeepSeek and Anthropic call
writes an intent row before it leaves and a response or unknown row after into
`cockpit_csm_provider_health` (`run_key` `pull:{uuid}`, `draft:{draft id}`,
`drafts:{response id}` for the reads a draft needs before it exists,
`transcript:{response id}`, `typeform:{uuid}` or `doctor`). The tests of a pasted
key write theirs into `cockpit_forms_key_checks` (`keys:{uuid}`), which the
native monitor does not scan. A row that cannot be saved stops its call.

Transcripts are heavy reads (10 a minute on a key shared with three other
services). A text read from Fathom is kept in the isolate for ten minutes; a
read that gave no text (refused, busy, a 5xx, a timeout, or none yet) is not
repeated for that recording until Fathom's `retry-after`, else its
`ratelimit-reset` on a 429, else two minutes (at most ten). Meanwhile the drafts
answer that they wait for the transcript and `checkin.transcript` its 404, with
no call, so the window's 60-second polls spend about one read every two minutes
per call, not one a minute.

## Tests

```
bun test supabase/functions/cockpit-forms-api/door.test.ts supabase/functions/cockpit-forms-api/effects.test.ts supabase/functions/cockpit-forms-api/messages.test.ts supabase/functions/cockpit-forms-api/calls.test.ts supabase/functions/cockpit-forms-api/drafts.test.ts supabase/functions/cockpit-forms-api/prompts.test.ts supabase/functions/cockpit-forms-api/recapRules.test.ts supabase/functions/cockpit-forms-api/transcript.test.ts supabase/functions/cockpit-forms-api/doctor.test.ts supabase/functions/cockpit-forms-api/typeform.test.ts
```

then the bundle check of section 11, which rebuilds the deploy outside the repo.
