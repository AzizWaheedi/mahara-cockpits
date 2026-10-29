# Client messages (hermes/client-messages)

The only sender of WhatsApp recaps to a client's group
(`docs/forms/STAGE2B-CONTRACT.md` 4.3, build 3b). A person approves the exact
text on the client's Messages card in the cockpit; this worker claims it,
checks the group, waits 30 to 120 seconds, asks the database once more, sends
it once, records WhatsApp's answer and reads it back. Built and deployed dark:
nothing is sent until both switches are on.

## The two switches

| Switch | Where | Off (at deploy) | On |
|---|---|---|---|
| The recap's owner in the checkin registry | `cockpit_forms`, the cut-over function | `shadow`: the database refuses every approval and claim | `cockpit`, at the cut-over hour (section 11) |
| `CLIENT_MESSAGES_APPLY` | `~/.client-messages/switches.env` on the VPS, and only there | `false` (also a missing or unreadable file) | exactly `true` |

`switches.env` holds the three switches and no secret:

```
CLIENT_MESSAGES_APPLY=false
CLIENT_MESSAGES_KINDS=recap_checkin
CLIENT_MESSAGES_ONLY_CARDS=
```

`CLIENT_MESSAGES_ONLY_CARDS` (comma-separated card ids) limits sending to those
cards (the canary, `86eywg1cq`); empty means every card. A switch written in a
key file is never read, and neither is `AD_BILLING_APPLY` (Z60).

**Edit the line, never append.** Change a switch by editing its one line in
place. A switch written on two lines is not read at all: the run stops with
sending off and the health row says `CLIENT_MESSAGES_APPLY is written more
than once in switches.env, so nothing is sent.`, until one line is left. The
same stop, off, comes from anything else the worker cannot read for certain:
a kind other than `recap_checkin`, a card list holding anything but card ids
(an inline `# comment`, a `;` between ids), or any line that is not one of the
three switches (a misspelt `CLIENT_MESSAGES_ONLY_CARD=86x`). That last one
reads `Line 2 of switches.env is not one of the three switches, so nothing is
sent.`: open that line, correct it or delete it. A card list is never widened
to every client. A line starting `#` is a comment and is ignored, as is a blank
line. A stopped run still runs the database sweep (it sends nothing), so a stopped send still
becomes `unknown` for a person to read.

Kill switch: edit the line to `CLIENT_MESSAGES_APPLY=false` (takes effect at
the next minute) or move the recap's owner back off `cockpit` (the owner gate
refuses at claim and again just before the POST).

## Keys

Read by name, first file wins, from `CLIENT_MESSAGES_ENV_FILES` (set by
`run.sh`): the guard's `/home/hermes/.ad-billing-guard/runtime.json`
(`AD_BILLING_WHAPI_TOKEN`, `CLICKUP_API_TOKEN`, `GOOGLE_APPLICATION_CREDENTIALS`),
the native release's runtime file (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`TYPEFORM_TOKEN`), then `/opt/data/bibi/api-keys.env` (`MAKE_API_KEY`,
`MAKE_ZONE`; its `SUPABASE_URL` names another project and never wins). Never
print a file or a value.

`MAKE_ZONE` may be a bare zone (`eu2`, the shape the VPS holds), a host
(`eu2.make.com`) or a full origin; the worker reads Make at
`https://<zone>.make.com/api/v2`. Anything else is not a make.com host: both
scenarios read `unread`, every recap is held, and the doctor's old senders
check fails.

## Doctor

```
~/client-messages-current/hermes/client-messages/run.sh doctor
~/client-messages-current/hermes/client-messages/run.sh doctor --task <card>
```

It prints every key and switch with the file it came from (never a value), the
mode, and read-only checks: the database, WhatsApp (the channel's number as its
last four digits), Client Data's WA GROUP ID still in column F, and the old
senders (the 1-1 Typeform's webhooks to Make, Make scenarios 9209179 and
9523861; on is expected before the switch-over and holds the recaps, a read
that fails is a failed check). It fails unless `SUPABASE_URL` is exactly
`https://bldgtotkfmhoxmlzowdx.supabase.co`. With `--task` it prints that card's
Client Data group (`none` or `present, <last 4>`) and whether the card's own
group field is the same, empty or differs. Every call writes an intent receipt
in `cockpit_csm_provider_health` first (`run_key client-messages:doctor`).

## A run

Cron, one line:

```
* * * * * flock -n $HOME/.client-messages/worker.lock timeout 300 $HOME/client-messages-current/hermes/client-messages/run.sh run >> $HOME/.client-messages/cron.log 2>&1
```

Dry mode (the default) runs the database sweep (a stopped send becomes
unknown, a stale claim goes back, an old approval returns to a draft) and
writes only the health row `client-messages`: `Nothing approved to send.
Sending is off until the switch-over.`, `detail.mode = 'dry'`. With
`--report <path>` it also writes a plan per approved recap (group last 4, the
card's field, the old senders, would send and why). Dry mode reads at most one
ClickUp card a run: a card's verdict is kept 10 minutes in
`~/.client-messages/card-verdicts.json` (the card and a fingerprint of the
group, never a group id), and the cards not read yet show `read on a later
run`. So after the kill switch, while approved recaps wait for their 24 hours
to run out, dry mode makes one ClickUp read a minute at most, and none while
every planned card is cached.

Apply mode, at most one message a run: the sweep; up to 5 unknowns looked for
in the group by their fingerprint (found: `reconciled`; not found: left for a
person, never sent again); up to 5 sent recaps read back (by WhatsApp's id,
else the fingerprint; for 24 hours); then, if a recap is approved and the old
senders are all off and Client Data's column F is where it was: claim one (only
while 200 of the run's 300 seconds remain), Client Data's group (none:
refused), the card's group field (different: refused; ClickUp unreadable: the
claim is released, never sent unchecked), the wait, the owner gate again (Z66),
one POST (`{to, body}`, the approved text byte for byte, no reference line),
the result, a read-back 10 seconds later. ClickUp is read at most once a run.

The owner gate and the POST start only while at least 80 of the run's 300 seconds
remain (the intent's 30, the POST's 20 and the result's 30, each at its own
limit), so the cron's kill never lands mid-send or before the answer is stored. The 30 to 120 second wait is cut to fit; with too
little left for even 30 seconds, or a wait that ran late, the claim is
released and the run ends `Too little of this run was left to send safely;
the next run sends it.`

| WhatsApp answered | The message |
|---|---|
| 2xx, `sent: true` and a message id | `sent` |
| 5xx, 408, 429, a timeout, a break, an unreadable answer, any other 2xx | `unknown` (never sent again) |
| another 4xx | `failed`, with its status |
| nothing: the ledger could not write the send's intent receipt first | `failed`: `The send could not be recorded first, so nothing was sent. Press Try again.` |

Every run writes the health row, one that throws part way included: its note
starts `The run stopped early:` with the reason, and it writes no result for
the message, so the next run's sweep puts a claimed recap back or marks a
started send `unknown`.

`detail.receiptsMissing` counts the provider calls of the run (WhatsApp,
Sheets, ClickUp, Typeform, Make) that left but whose answer the health ledger
could not save; the call is never repeated for it. Above 0, the note ends
`The health ledger is missing the answer to N provider calls that had already
left.` and the doctor fails its `ledger` check: check that the database takes
rows in `cockpit_csm_provider_health` (the doctor's `supabase` check, the
service key), then look for the call's intent row with no answer under the
run's `run_key`. G5's row carries the same count in its detail. The guardian's client-messages check warns while the last run's count is above 0. Only a run that cannot reach the database writes no
row (it prints `The run could not reach the database` to `cron.log`); the
guardian reads `client-messages` as stale after 10 minutes, so run the doctor.

## Reading an unknown

An `unknown` recap may be in the group. The cockpit never sends it twice; the
CEO and the admins see it on Today as `Recap not confirmed`.

1. Look in the client's WhatsApp group for the recap (sent a few minutes after
   its `claimed_at`). A later run reconciles it by its fingerprint if it is
   there and was sent from the cockpit's number.
2. Not there: record what you saw, through the service key:
   `select public.cockpit_client_message_fix('<message id>', 'not_sent', 'Checked the group at 14:20.');`
   It becomes `failed` with `Checked by a person: not in the group. ...`.
3. Then, if the client still needs it, the CSM presses `Try again` on the
   Messages card (reopen), edits if needed and approves it again. A recap
   WhatsApp refused three times is refused at the fourth try: send it by hand
   in the group and skip it on the card.

## The release

Copied, never edited on the VPS: `git archive <sha> hermes/client-messages
hermes/ad-billing-guard/transport.ts hermes/ad-billing-guard/core.ts`, check
its sha256, unpack to `/home/hermes/.client-messages-releases/<sha8>`, run the
doctor and a dry run with the native bun, then point
`~/client-messages-current` at it and install the cron line. `~/.client-messages`
is mode 700 and holds `switches.env`, the lock, `cron.log`, the old senders'
10-minute cache (`old-senders.json`) and dry mode's 10-minute card verdicts
(`card-verdicts.json`). Roll back by pointing the link at the
previous release.

## G5, the phone check

```
run.sh g5 --task <card> --at <iso> [--task <card> --at <iso> ...]
```

Read only (`run_key client-messages:g5`): for each pair, Make 07's recap in the
card's group within 3 minutes of the time, read through the guard's token.
`same number` when every pair is found and `from_me`; `different number` with
both numbers' last four digits (for the CEO's B5); anything not found is `not
proven`, which counts as failed. It writes `client-messages-g5`, ok only for
`same number`.

## Tests

```
bun test hermes/client-messages
```

Fakes only (WhatsApp, Client Data, ClickUp, Typeform, Make, the database);
nothing touches a network. The database side is
`apps/media-buyer-cockpit/scripts/client-messages-supabase.test.ts`.
