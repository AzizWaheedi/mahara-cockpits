# Sales desk

Proposals drafted from demo calls, and the calls themselves, for the sales
cockpit.

Aziz, 2026-09-24: proposals are drafted *"in the CEO cockpit here instead of
on Muhammed's account"*. So the engine in Mahara-B2B's `proposals/` (main
`89e7ee0`) now lives here and runs under our keys, our tables and our bucket.
The rules it drafts by, the variant gate, the tightening rounds and every
check in the validator came over unchanged in substance; what changed is
listed at the end.

The desk never contacts a client and never decides whether a proposal is
sent. It writes the draft, checks it and says what is left for the closer.

## What it does

| Command | What happens |
|---|---|
| `doctor` | every key by name (never its value), the tables, the bucket, a one-token call to the model, the model list, Fathom, Playwright, the reference deals; each blocker named in one sentence |
| `requests` | drafts, or rebuilds, the proposals the cockpit asked for; quiet when nothing is queued |
| `recordings` | indexes Fathom's sales calls for every rep and matches each to a lead |
| `calls-vault` | copies every sales call in the Obsidian vault in, summary and transcript too; `--fathom-days N` asks Fathom about the calls whose note cannot say whether the lead joined |
| `maqsam-calls` | copies every answered phone call with a transcript from Maqsam, for every seat with a Maqsam address, matched to a lead by phone; `--dry-run`, `--days N`, `--limit N` |
| `calls-b2b-fathom --once` | copies, once, Ahmed's private Fathom calls that only B2B's `fathom_calls` holds (`SALES_B2B_MGMT_TOKEN`, read only); `--dry-run`, `--limit N` |
| `status` | the open requests, the last proposals, the last runs |
| `offer-sync` | writes `offer.json` into the cockpit's proposal form (`requests` does it too) |
| `form-sync` | writes the New Client Form's questions from Typeform into the cockpit setting `client_form` (`requests` does it too, every ten minutes; `TYPEFORM_API_TOKEN`) |
| `validate DEAL.json` | the validator on a deal file by hand, `--transcript` for the evidence, `--send` for the send gate |
| `build DEAL.json` | the HTML (and `--pdf`) from a deal file by hand |
| `draft` | the whole engine on one call by hand (`--transcript FILE` or `--recording ID`), writing only into `--out` |

The last three write nothing to the database.

## How a proposal is made

The cockpit's server creates the proposal row (status `drafting`) and a
request of kind `proposal` together. Every two minutes `requests`:

1. Puts back any request left running for more than 30 minutes with no sign
   of life (a live draft touches its row between stages); after four tries it
   is parked as failed.
2. Claims a request with a conditional update that only one run can win.
3. Finds the call: the recording the closer named, or else the newest
   recording matched to the lead whose transcript has at least 5,000
   characters. If the index has nothing yet, it reads Fathom again once,
   because a closer can ask straight after the call. With nothing to draft
   from, the request fails once, with a sentence the closer can act on: *No
   Fathom recording of this lead's demo was found. Share the recording with
   the team in Fathom, then draft again.*
4. **Triage** (temperature 0): the model answers two questions of fact, the
   average project value and a genuinely net margin, quoting where each was
   said.
5. **The gate, in code**: both given, the specific proposal; a value and no
   margin, the general one (the ordinary case); an unreadable call, the blind
   one. The model never picks the variant.
6. **The draft** (temperature 0.3): SKILL.md and PATTERNS.md, with this
   proposal's offer written in, and the reference deal for the variant.
7. **Tightening**: the document is built and rendered, and while a sheet
   overflows A4 and each round helps, the drafter gets its own document back
   and is asked for shorter copy on the sheets named, up to three rounds.
8. **The validator**: schema, evidence against the transcript, fee band or
   break-even table, every figure in the copy, the brand, one language, the
   offer the closer chose, the guarantee, dates, echoes, one currency, the
   page count, placeholders. Every check has a verdict for the closer's
   draft and one for the send gate.
9. **The files**: the HTML goes to `sales-proposals/proposals/<id>/v<n>.html`
   and, once the proposal passes the send gate, the PDF beside it as
   `v<n>.pdf`.

The proposal row then says one of three things:

| Status | Meaning |
|---|---|
| `ready` | passes the send gate: nothing to fill, date not passed, PDF made |
| `needs_input` | a good draft with `FILL` gaps the closer supplies (a missing company name is one of them) |
| `failed` | the draft itself is wrong, and `error` says how in a sentence; the HTML is still saved |

`validation` carries `ok`, `errors`, `warnings`, `fills` (the fields still
to fill), `variant` and `offer`, then the full record: every check's row,
the triage answer, the reference used, the tightening rounds, the notes.

### The rebuild

When the closer fills the gaps in the cockpit (sales-api `proposal.fill`),
the cockpit queues a request with `{"proposal_id", "rebuild": true}`. A
rebuild calls neither the model nor Fathom: it builds the deal on the
proposal row again, renders it, runs the same validator and stores the next
version. The call's figures were checked when the proposal was drafted, and
what the closer filled in is the closer's own, so the evidence rows say that
rather than warn. The offer comes from the stamp in the deal (or
`validation.offer`, or the first request's choice).

## The offer

Aziz, 2026-09-24: USD 6,000 for three months, ads separate, a USD 500
deposit, 30 qualified meetings, *"but could change, should be flexible and
depends if we're giving a guarantee or not or payment plans"*.

`offer.json` holds the program and the named options, and it is the one
place the offer is edited. The drafter's prompt and the validator both read
it on every draft, and `offer-sync` writes its options into the cockpit's
setting `cockpit_sales_settings.offer`, so the form a closer picks from is
always the file's.

The closer's choice rides on the request:
`{"lang": "ar"|"en", "recording_id"?, "proposal_id", "offer": {"guarantee": true|false, "payment": "pif"|"two_payments", "price"?: number, "months"?: number}}`.
An option that is not in the file fails the request with a sentence naming
the ones that are. The drafter is told exactly the chosen figures, the
instalments and where each goes; it may not invent a schedule, and the
guarantee appears only when it was chosen. The validator checks the document
against the same choice: the price and term in `roi`, the deposit, the
advertising on a line of its own, the instalments printed and adding up to
the price, no split printed for a payment in full, no refund when no
guarantee was chosen, and never a promise of results.

**The guarantee** (Aziz, 2026-10-02) is a 7-day satisfaction guarantee,
worded as its contract has it (section 3 of HighLevel's "90 Day Agreement (7
Day Satisfaction Guarantee)"): *if you are unhappy with the process for any
reason within 7 days of paying in full, tell us by email or WhatsApp and we
refund the program fee in full, once onboarding is done. Advertising paid to
the platforms is not refunded.* It replaced *30 qualified appointments in 90 days, or
we work for free until we deliver*, because "we legally can't give them a
result guarantee because everybody's different". The closer offers it only
to a prospect who asked for certainty, so a proposal prints it only when the
closer ticked it, and a request that does not say is taken as no guarantee.
Results are never promised: free work, or meetings, leads or projects
guaranteed, fails the validator whatever was chosen, while a line saying
results cannot be guaranteed passes. The cockpit's form shows the file's
`label`.

**The payment plans** (Aziz, 2026-10-03: "we only have 2 options for newer
clients $3k $3k after 30 days or $6k pif"): `pif`, the price paid in full at
the start, and `two_payments`, half at the start and half 30 days later
($3,000 and $3,000 at the program price). The monthly plan is gone. The New
Client Form and HighLevel's Payment Structure For Program carry the same two
as "Paid in full ($6,000)" and "Split pay ($3,000 + $3,000 after 30 days)".

## The model

`SALES_MODEL_PROVIDER` picks the provider; `SALES_PROPOSAL_MODEL` the model.

| Provider | Key | Default model |
|---|---|---|
| `vps` (the default) | none: Claude Code's sign-in on the VPS | `opus` |
| `openai` | `OPENAI_API_KEY`, already on the VPS | `gpt-5` |
| `anthropic` | `ANTHROPIC_API_KEY`, empty on the VPS today | `claude-opus-5` |
| `openrouter` | `OPENROUTER_API_KEY` | `openai/gpt-5` |

`vps` since 2026-09-27 (Aziz: "I want to use my VPS, not OpenAI"): Aziz's
own proxy to Claude Code, `openclaw-claude-proxy` on 127.0.0.1:3456
(`SALES_VPS_URL` if it moves), on his Claude plan, so there is no key and no
API credit to run out. When Claude Code's sign-in lapses, the proxy answers
with the error as the text of a reply; the desk takes that as the outage it
is ("sign Claude Code in again on the VPS as aziz: `claude`, then `/login`")
and never as a draft. The proxy reports no usage, so the day's ceiling counts
an estimate of three characters a token. The researcher stays on OpenAI: it
needs OpenAI's web search.

gpt-5 because the drafter follows a long rulebook over a transcript that can
pass 60,000 tokens and returns a 20,000 character document with every figure
copied out exactly; that is reasoning-model work, and the original ran on the
strongest model its proxy had. `doctor` lists the models the key can use and
says plainly when the configured one is not among them; `gpt-4.1`, which the
key already writes captions with, is the fallback to set by hand.

Lead data never goes to DeepSeek: there is no DeepSeek provider, and a
DeepSeek model named through OpenRouter is refused.

Every call streams, so the timeout (`SALES_MODEL_TIMEOUT`, 900 seconds) is
the longest the answer may stay silent rather than a budget for the whole
answer: a draft takes six to eleven minutes. If OpenAI will not stream the
model to an unverified organisation, the desk asks once more without
streaming. Reasoning models get no sampling temperature (they refuse it), the
answer is read from `content`, and an empty `content` is searched in the
reasoning before the try counts as failed. The JSON is taken strictly first,
then from inside whatever the model wrapped around it, and a fragment of an
answer that was cut short is never taken for a whole deal.

A missing or refused key, or a model the key cannot use, is an outage, not
a failed try: nothing is claimed, the requests wait with the reason on them,
and `doctor` names the fix.

## Fathom and the recordings

The B2B copy of Fathom (`fathom_calls`) has been refused with a 403 since
12 September, so the desk reads Fathom directly with `FATHOM_API_KEY`. The key
is Aziz's: on its own it sees his recordings plus what the team shares, so
`recordings` asks once for his and once for every seat in
`cockpit_sales_people` that has a `fathom_email`, with `recorded_by[]`.
Calls are paced a second apart and a 429 or 5xx is asked again.

A recording belongs to a lead when an outside address on the invite is the
lead's email, any case (`matched_by = email`). With nobody from outside on the
invite, it belongs to the lead whose intro or demo started within 30 minutes
of the recording, if exactly one lead had one then, preferring the rep's own
appointments (`appointment`). Anything less certain stays `none`. Client
calls (launch, check-in, onboarding, review, pulse: the same title filter as
webinar-pull) are left out, and a meeting with nobody from outside and no
appointment beside it is a team meeting, unless Fathom says someone from
outside was on the call (`calendar_invitees_domains_type`): a lead who joins
from the link is on no invite. A match found once is never overwritten by a
later `none`, and a match somebody made by hand is never overwritten at all.
Transcripts stay in Fathom.

`calls-vault` applies the same rules to the vault's notes, which carry no
Fathom flag. A note shows an outsider joined when the vault filed an
"Impromptu" meeting with no sales word as `sales` (its writer does that only
for a meeting Fathom flagged; 84 of 84 checked against Fathom on 2026-09-26);
a call already in the cockpit shows it; and for the rest Fathom is asked once
per run, for the calls of the last `--fathom-days` (default 14), with
Fathom's own filter. Before this, 111 sales calls had been dropped as team
meetings; 103 of them had someone from outside on the call. A note the vault
files as `external` (someone outside it could not place) whose invitee is a
lead is a sales call too: 163 of them, 139 not yet in the cockpit.
Client-service titles stay out, as always.

## Phone calls

`maqsam-calls` reads Maqsam's v3 API (`MAQSAM_ACCESS_KEY` and
`MAQSAM_SECRET`, Basic auth) for every seat with a Maqsam address in
`cockpit_sales_reps` or `cockpit_sales_people`, setters and closers alike:
B2B keeps the setters' calls only, and its call ids do not open a call in v3.
Each answered call with a transcript becomes the row `maqsam:<v3 id>`
(source `maqsam`, kind `phone`, title "Phone call, outbound" or "inbound",
Maqsam's English summary), matched to a lead by the rule
`cockpit_sales_link_dials` links the dialer's calls by: when both numbers have
nine digits or more they must agree on the last nine; among leads with the
same number, the one that existed at the call wins (an hour's grace); eight
digits alone match only when one lead could be meant, and an ambiguous call
stays unmatched. The transcript goes to `maqsam/<id>.md` in `sales-calls`, one
"[mm:ss] Rep: ..." or "[mm:ss] Lead: ..." line per turn. A run reads from the
last successful run less seven days (Maqsam writes a transcript minutes after
the call); the mark is the setting `maqsam_calls`, written only when every
seat was read. The first run starts on 2026-01-01: 1,256 calls from eight
seats on 2026-09-26, the five setters' counts identical to B2B's
`maqsam_calls`.

The same read fills the dial log for the calls B2B does not keep (the
closers', B2B role `rep`): every call, answered or not, goes into
`cockpit_sales_dials` with `origin` `maqsam` under Maqsam's `referenceId`,
insert-only, never for an agent B2B copies itself (its setters and "both"),
and sales-mirror drops a twin once B2B copies the call too
(`cockpit_sales_dedupe_dials`: same second, same agent or number). For the
last seven Kuwait days it writes Maqsam's count against the log's per agent
and day into `cockpit_sales_dial_checks` (the Team page shows it). After every
import `cockpit_sales_mark_recordings()` hides a meeting recorded twice and a
phone call whose transcript is only the network's message.

A phone call is never drafted from and never reviewed on its own: a rep asks
for its review, and it is scored on the intro card (a setter's call). An asked
review needs a transcript of at least 1,500 characters and says so when it is
shorter.

`calls-b2b-fathom --once` copies the calls of Ahmed's that B2B's
`fathom_calls` holds and neither the cockpit nor the vault does (he records
privately, so Aziz's key never sees them): 59 on 2026-09-26, in the vault
import's shape with source `b2b_fathom` and B2B's own lead match. B2B is read
the way `sales-mirror` reads it, through the management API with
`read_only: true`. The drafter reads these calls from the cockpit's copy,
since Fathom would refuse them.

## The reference deal

The drafter copies the shape of one finished proposal of the variant it is
writing, as in the original. A reference is a real client's proposal, so it
lives on the VPS only, in `~/.sales-desk/reference/`, mode 600, and never in
git. The desk takes `<variant>.json` first, then any file of that variant,
then whatever there is (and says which in the proposal's notes). Its identity
fields become instructions, and its `quotes` block and embedded images are
dropped before the drafter sees it. Without one, the drafter works from the
rules and an outline of every key the template reads, and every proposal's
notes say so.

To make one from a finished proposal's HTML:

```bash
python3 extract_reference.py 2026-09-05-client.html ~/.sales-desk/reference/general.json
```

## The New Client Form

Aziz, 2026-10-02: the closer fills the New Client Form (Typeform
`BTzMwXiw`) on the lead's page, as easily as possible, and it starts the
same Make scenario as before. The form stays Typeform's own, embedded with
its hidden fields (`contact_id`, `closer`, `setter`) set from the lead:
B2B's `closed_deals` is read from the responses Typeform stores (its
`typeform-sync`, every 15 minutes), and the form's webhook feeds Make's
"10. Closer Form to Onboarding (MAIN)", a HighLevel workflow and Cortana, so
nothing may imitate a submission (Typeform's terms forbid it too). Typeform
cannot fill a visible question in advance, so the page lists what the
cockpit already knows beside the form, by question ref, ready to copy.
`desk/clientform.py` keeps that list in step with the live form: it copies
the form's screens, questions, refs and choices into the setting
`client_form`, at most every ten minutes. When Typeform says it saved the
response, sales-api `client_form.sent` writes `cockpit_sales_client_forms`
and an audit row; the deal then reaches the cockpit through B2B by its
response id.

## Install on the VPS

As `hermes`, from the repo clone at `~/mahara-cockpits`. The Supabase pair is
the editor desk's (`~/.editor-desk/env`, Creative Triage); `OPENAI_API_KEY` and
`FATHOM_API_KEY` are in `/opt/data/bibi/api-keys.env`. The desk's own env file
holds settings only, never a key:

```bash
cd ~/mahara-cockpits && git pull -q --ff-only
mkdir -p ~/.sales-desk/reference && chmod 700 ~/.sales-desk
cat > ~/.sales-desk/env <<'EOF'
SALES_MODEL_PROVIDER=vps
SALES_PROPOSAL_MODEL=opus
EOF
chmod 600 ~/.sales-desk/env
cd hermes/sales-desk
set -a; . ~/.editor-desk/env; . /opt/data/bibi/api-keys.env; . ~/.sales-desk/env; set +a
python3 desk.py doctor
python3 desk.py offer-sync
python3 desk.py recordings --days 60   # once, to fill the index
```

The PDF and the overflow measurement need Playwright and a Chrome the
`hermes` user can run: `python3 -m pip install --user playwright`, then
either `python3 -m playwright install chromium` or `CHROME_PATH` pointing at
an existing Chrome. `doctor`'s playwright and render lines say whether it
works. Without it the HTML is still made, and the proposal's notes say the PDF
was skipped. Chrome's one-shot flags were measured hanging on this box
(render.py's note, from the B2B account); the fallback now takes Chrome's
answer as soon as it is complete, which is what makes it usable on a laptop,
but Playwright is the path to rely on here.

### Cron

```
*/2 * * * *  flock -n $HOME/.sales-desk/requests.lock bash -c "cd $HOME/mahara-cockpits/hermes/sales-desk && set -a; . $HOME/.editor-desk/env; . /opt/data/bibi/api-keys.env; . $HOME/.sales-desk/env; set +a; python3 desk.py --quiet requests" >> $HOME/.sales-desk.log 2>&1
11,41 * * * * flock -n $HOME/.sales-desk/recordings.lock bash -c "cd $HOME/mahara-cockpits/hermes/sales-desk && set -a; . $HOME/.editor-desk/env; . /opt/data/bibi/api-keys.env; . $HOME/.sales-desk/env; set +a; python3 desk.py --quiet recordings" >> $HOME/.sales-desk.log 2>&1
16,46 * * * * flock -n $HOME/.sales-desk/maqsam-calls.lock bash -c "cd $HOME/mahara-cockpits/hermes/sales-desk && set -a; . $HOME/.editor-desk/env; . /opt/data/bibi/api-keys.env; . $HOME/.sales-desk/env; set +a; ulimit -v 1500000; python3 desk.py --quiet maqsam-calls" >> $HOME/.sales-desk.log 2>&1
* * * * *    flock -w 10 $HOME/.sales-desk/rooms.lock bash -c "cd $HOME/mahara-cockpits/hermes/sales-desk && set -a; . $HOME/.editor-desk/env; . /opt/data/bibi/api-keys.env; . $HOME/.sales-desk/env; set +a; python3 desk.py --quiet rooms --for 57" >> $HOME/.sales-desk.log 2>&1
*/10 * * * * flock -n $HOME/.sales-desk/room-hosts.lock bash -c "cd $HOME/mahara-cockpits/hermes/sales-desk && set -a; . $HOME/.editor-desk/env; . /opt/data/bibi/api-keys.env; . $HOME/.sales-desk/env; set +a; python3 desk.py --quiet rooms --check-hosts" >> $HOME/.sales-desk.log 2>&1
5 * * * *    flock -n $HOME/.sales-desk/doctor.lock bash -c "cd $HOME/mahara-cockpits/hermes/sales-desk && set -a; . $HOME/.editor-desk/env; . /opt/data/bibi/api-keys.env; . $HOME/.sales-desk/env; set +a; python3 desk.py --quiet doctor --cron" >> $HOME/.sales-desk.log 2>&1
7,37 * * * * flock -n $HOME/.sales-desk/followups.lock bash -c "cd $HOME/mahara-cockpits/hermes/sales-desk && set -a; . $HOME/.editor-desk/env; . /opt/data/bibi/api-keys.env; . $HOME/.sales-desk/env; set +a; python3 desk.py --quiet followups" >> $HOME/.sales-desk.log 2>&1
*/5 * * * *  flock -n $HOME/.sales-desk/waves.lock bash -c "cd $HOME/mahara-cockpits/hermes/sales-desk && set -a; . $HOME/.editor-desk/env; . /opt/data/bibi/api-keys.env; . $HOME/.sales-desk/env; set +a; python3 desk.py --quiet waves" >> $HOME/.sales-desk.log 2>&1
```

These are the lines for live calls and the follow-up agent (contract-v2
section 13, item 2): the room worker every minute, the room host check every
10 minutes, the doctor hourly at :05, follow-ups at :07 and :37 as they run
today, and the waves every 5 minutes. The other jobs the runbook lists
(calls-vault, reviews, research, notes, the digest) keep the lines they have
on the VPS; they are not repeated here, so never install this block alone
over the crontab.

The `doctor --cron` line is the hourly doctor of the follow-up agent: one
model token, no render, and its status rows written whatever happens. The
`waves` line runs the backlog waves; a run is bounded to 270 s, so `flock -n`
never stacks runs, and a manual run uses the same lock
(`flock -n $HOME/.sales-desk/waves.lock python3 desk.py waves`).
`NOTES-followup-agent.md` section 6 holds their runbook rows.

The `rooms` line is the video room worker (below): every minute, a run of
57 s that polls every second and never runs more than 2 s past its end. It
waits up to 10 s for the lock (`-w 10`) rather than skipping a minute when the
last run is a little late, which would leave the rooms asked for in that
minute waiting. The same run sends the Slack replies the door keeps (the
Slack poster, below), so Slack needs no line of its own. The
`--check-hosts` line is the room host check, on its own line and lock so it
never holds a new room up.

Before the first switch is turned on, and after every deploy, run
`python3 desk.py deploy-check` on the VPS (below): it changes nothing.

The first `maqsam-calls` (since 2026-01-01) and `calls-vault --fathom-days 700`
(the vault's history against Fathom's flag) are run once by hand before the
cron takes over; `calls-b2b-fathom --once` is never on cron.

The queue every two minutes, so a closer is not kept waiting for the run to
start; a draft takes longer than that, and the lock means the next run simply
skips while one is working. The index every half hour. Every run writes its
line in `cockpit_sales_worker_status` (`worker = sales-desk`, one row per
job), which is how the cockpit knows the desk is alive.

**Editing the crontab:** `crontab -l > f`, edit `f`, `crontab f`, as the
editor desk's README says. Never pipe a stale copy.

## Video rooms

`python3 desk.py rooms` makes the video rooms the sales cockpit asks for
(`desk/rooms.py`). sales-api inserts a room in `cockpit_sales_rooms` as
`requested` after its own checks; this worker:

1. claims it with a conditional update (`state=eq.requested`), so a room is
   made once however many runs see it, up to 3 rooms a second, and only while
   `rooms.enabled` and that provider's `rooms.providers` switch are on (a
   setting that is missing or cannot be read is off: such a run claims
   nothing, and reads the setting again the next second);
2. makes it on the host's own **Zoom** user (the one the Team page linked in
   `cockpit_sales_room_hosts.zoom_user_id`, else the seat's email), after
   checking the host has no live meeting (the meetings of their own finished
   cockpit rooms do not count, so a standby room replaced at 35 minutes is
   not "another meeting") and that a demo is not on a Basic seat; type 2 with
   no start time, topic "Mahara call {code}", a waiting room for anyone
   outside the account, nobody in before the host, no recording, the passcode
   in the link. Or on **Meet**, as an event on the "Sales rooms" Google
   calendar (made once if missing, or the one in `SALES_ROOMS_CALENDAR_ID`)
   with the room's id as the event id, read every second until Google fills
   in the link, for up to 30 s;
3. puts the host link in `cockpit_sales_room_secrets` (service role only),
   stores a `worker.ready` event, then saves `join_url` and
   `provider_meeting_id` and sets the room `open` (with `opened_at`, and
   `host_by` and `ends_at` only where sales-api left them empty; never
   `lead_by`), then calls sales-api `room.event` once (4 s, no retry). The
   stored event is the guarantee: the sweep replays it if sales-api did not
   mark it handled, so a slow or lost call costs about 20 seconds, never the
   link, and never a second send;
4. on a refusal or a provider failure stores `worker.failed`, sets the room
   `failed` with a sentence the rep can act on ("Your Zoom is in another
   meeting. End it or use Meet."), and calls `room.event` the same way. A
   room asked for while `rooms.enabled` or its provider is off is never
   claimed: it fails from `requested` with the switch's sentence.

**The handshake with sales-api (contract-v2 sections 5 to 7).** The worker
opens the room, and sales-api sends the link. The call is exactly
`{action: 'room.event', kind, room_id, request_id, dedupe_key, payload}`:
`request_id` is uuid5 (URL namespace) of `mahara-room/{kind}/{room_id}`,
`dedupe_key` is `{kind}:{room_id}`, and `payload` is `{provider,
provider_meeting_id, worker_run, seconds}` for `worker.ready` and `{error,
worker_run}` for `worker.failed`. sales-api leases the stored event by that
dedupe key (`cockpit_sales_room_event_lease`), never by stamping
`handled_at` first, and the worker never sets `lease_until` on what it
stores. The answer is read this way: `{ok: true, handled}` is delivered
(`handled: false` means the sweep replays it); a 4xx or `ok: false` is a
refusal, said on the status row, unless it carries `retry: true` (sales-api
released the event and the sweep replays it); a 5xx, a 429, a timeout or no
answer is unclear, left to the sweep. A `worker.ready` refused with
`cleanup: true` closes the meeting only when the room carries another one;
the room's own meeting is never closed on that word alone.

**Every stored event has `text`**, a plain sentence for the room's timeline
("Room made on Zoom in 4.2 s.", "The room was not made. Your Zoom invite is
not accepted yet..."), with no link, address or key. When the open or fail
write misses because the room went another way, the event stored for that
write is closed by the worker with the lease (`detail.closed_by: worker`),
so the sweep does not replay it: a `worker.ready` once the room is final, a
`worker.failed` once the room is gone, open, or final other than `failed`
(a failed room's event stays for sales-api).

**Timers belong to the SQL sweep (contract-v2 S1).** It fails a room still
`requested` at 60 s and one still `creating` at claim + 120 s. Until then
the worker keeps looking for a lost Zoom meeting by its code (never sending
a second create) and makes a room no create was ever sent for. It fails a
room itself only once the room is ten minutes old (the sweep is not
running), and a Meet link Google left pending for 30 s.

**A meeting an overlapping run may adopt (contract-v2 section 7, step 5).**
When a run's open write misses because another run holds the room (it
adopted it while this one was slow), or the database failed mid-make, the
Zoom meeting this run made is watched and noted as `worker.stray`: kept when
the room opens with it (the other run finds a lost meeting by its code),
closed otherwise, and, when the room opened with another meeting, the room's
host link is put back first if this run's had overwritten it. A later run
picks up the notes of the last six hours, so nothing is left behind when the
first run ends. A running extra meeting with someone in it is never ended:
it is left open with an alert (`room_stray_held`).

**One provider never stops the other.** Every call has a short timeout (4 s
a read, 8 s a create, 3 s a close). Two calls to one provider that time out
within a minute and that provider is skipped for 30 s: its new rooms fail at
once ("Zoom did not answer. Try again in a minute, or use Meet.") and the
other provider's rooms are made as usual. A tick claims new rooms first,
then reads Meet rooms waiting on Google, then picks up at most one room
another run left behind and closes at most one finished room's Zoom meeting.
Database calls get the time the run has left as their timeout and are never
retried inside the HTTP layer (the next tick is the retry), so a run, and
its lock, never outlive the minute.

**The end of a run.** No new Zoom room is claimed in a run's last 12 s (3 s
for Meet). A Meet room still waiting on Google is adopted by the next run at
once. A Zoom room whose make the end cut short is marked
(`worker_run = handover:{run}`) and the next run makes it at once; if a
create was already sent (`worker.create_sent`, stored before every first
create), the meeting is only ever looked for by its code, never made a
second time. A run's id ends in the second it stops (`-e{epoch}`), so the
rooms of a run that died are picked up at once too. Rooms the worker could
not save before they ended (cancelled mid-make, a crash, a database outage,
or failed by the sweep) are found in Zoom by their code and closed.

**Finished rooms (H7: never end a room with a lead in it).** The host link
is always deleted. A Zoom meeting that never started is deleted. A started
one is ended only when Zoom's live participant list shows nobody outside the
team (every room host and every seat); with someone else inside, or when
that list cannot be read, the meeting is left open, an alert goes to
`cockpit_sales_alerts` ("Room K7Q2MB has ended, but 1 person outside the team
is still in its Zoom meeting...") and the room is looked at again every
minute for three hours. The meeting's uuid is stored in `room_events`
(`worker.closing`) before it is deleted. Never anything for a room that
reached `lead_in`, nor for a booked call's own meeting.

**The host check** (`rooms --check-hosts`, every 10 minutes on its own cron
line) writes each seat's Zoom status (licensed, basic, pending, missing) into
`cockpit_sales_room_hosts` for seats that can sign in (`via_portal` and
`active`). What the Team page sets is never overwritten: its Zoom user is the
one checked and is never cleared, and the default room is never written (an
empty one means the role's default in `cockpit_sales_presence`); the line
says when that default cannot work ("Zoom rooms will fail for this seat: set
Meet on the Team page."). It checks the Google sign-in live (a token, a
Calendar permission, the calendar), and checks every Zoom room that ended in
the last day against Zoom's participant report: someone outside the team
joined exactly when the room reached `lead_in`. A mismatch raises an alert;
a report that cannot be read is said, never taken as nobody. Its status row
is `sales-desk` / `room-hosts`; the worker's is `sales-desk` / `rooms`,
written at least every 30 s.

Keys, by name, from `/opt/data/bibi/api-keys.env`: `ZOOM_ACCOUNT_ID`,
`ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` (the server-to-server app webinar-pull
uses); `GOOGLE_CAL_CLIENT_ID`, `GOOGLE_CAL_CLIENT_SECRET`,
`GOOGLE_CAL_REFRESH_TOKEN` (the CEO's calendar sign-in), else `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`. That second sign-in may have
been given for Drive only: `python3 desk.py doctor` checks it live and says
so, and a Meet room then fails with "The room worker's Google sign-in cannot
use Calendar." Optional: `SALES_ROOMS_CALENDAR` (default "Sales rooms") and
`SALES_ROOMS_CALENDAR_ID` (use this calendar and never list or make one;
recommended, because it needs only the events permission);
`SLACK_SALES_BOT_TOKEN` (the Mahara Sales app's bot token, for the Slack
poster; needed before `live.slack` is switched on). Rooms ship switched off
(`rooms.enabled=false` in `cockpit_sales_settings`); the worker also fails a
waiting room while the switch is off.

By hand: `python3 desk.py rooms --once` (one tick), `python3 desk.py rooms
--check-hosts`, `python3 desk.py doctor` (the "rooms: zoom" and "rooms:
google" lines check the keys live; `--offline` only names them).

**What sales-api does with the worker's events** (contract-v2 section 7,
step 7; the API lane builds it): lease `worker.ready` by its dedupe key;
release it and answer `handled: false` while the room is `creating`; on an
`open` or `host_in` room fill in only the missing deadlines and claim the
link (`link_claimed_at`) in the same guarded write, set `handled_at`, and
send inside `waitUntil`, answering in under 2 s; on a final room set
`handled_at`. `worker.failed` is acted on only when the room is `failed`.
`worker.create_sent`, `worker.closing`, `worker.held`, `worker.stray` and
`report.checked` are notes (stored handled).

### The Slack poster

A Slack button on App Home comes with no `response_url`, so the door
(sales-live) keeps its answer as a room event: kind `slack.reply`, source
`door`, `room_id` null, `text` the sentence, `detail.slack_user_id` the
person who pressed, `handled_at` null. The sweep never replays a `door`
event; the poster (`desk/slackpost.py`) is its only reader, inside the
`rooms` run, every 2 seconds:

- only while `live.enabled` and `live.slack` are both true (a setting it
  cannot read is off), and only with `SLACK_SALES_BOT_TOKEN` set;
- it takes each reply with the database's lease, posts `chat.postMessage` to
  the person's Slack user id (the app's DM) as the Mahara Sales bot, and
  sets `handled_at` with Slack's `ts`, or with Slack's refusal
  (`detail.refused`, such as `channel_not_found`);
- Slack down or busy: the lease is released and the reply tried again, at
  most three times, ten seconds apart; "slow down" (`ratelimited`, a 429)
  pauses the poster for 30 s without spending a try; a call that timed out
  is never repeated (Slack may have posted it) and is said as not
  confirmed; a reply over ten minutes old is closed unsent
  (`detail.dropped`; never `gave_up`, which the watchdog counts as a lost
  room signal); a mark that did not land is tried again, never the send;
- a refused token (`invalid_auth`, `token_revoked` ...) stops the sends at
  once and turns the row red.

Its status row is `sales-desk` / `slack`, written once a run with a plain
sentence: green when switched off (it says whether the token is set and how
many replies wait), red when switched on and it cannot send ("SLACK_SALES_BOT_TOKEN
is not set on the VPS, so Slack replies to App Home presses cannot be
sent...", or Slack refused the token). The watchdog reads it while
`live.enabled` and `live.slack` are on (10 minutes stale).

### Deploy check

`python3 desk.py deploy-check` (or `deploy check`), run on the VPS as
`hermes` after the migrations and before anything is switched on. It
changes nothing: no row, no status row, no folder, and no call to Zoom,
Google, Slack or HighLevel; keys are read by name and never printed. It
checks, and says what each missing piece means:

- the keys: the database pair (required), Zoom, Google Calendar,
  `SALES_ROOMS_CALENDAR_ID`, `SLACK_SALES_BOT_TOKEN` and the HighLevel key
  (each needed only before its switch is turned on, and a blocker once that
  switch is on);
- the tables and the columns the code uses (20261003a and 20261003c), the
  contract-v2 room columns (`link_claimed_at`, `count_undo_at`,
  `link_unconfirmed_at`), the lease function (asked with a read-only GET),
  and the settings `rooms`, `live`, `followups` and `whatsapp_guard`;
- every switch off as it ships: `rooms.enabled`, `rooms.test_only` (on),
  both providers, the three `rooms.send` channels, `count_on_join`,
  `fallback.auto_on_miss`, `short_link`, `live.enabled`, `live.slack`, both
  `live.kinds`, `threads.enabled`, `followups.autosend.reactivate`, and no
  backlog wave running; the WhatsApp gate is reported;
- the status rows (each against its own threshold) and the crontab lines.

`OK` is ready, `--` is missing or switched on (exit 1), `??` is not known or
only needed before a switch is turned on. `--json` gives the same as data.

### Runbook: video rooms

| Symptom | Fix | Who |
| --- | --- | --- |
| The cockpit says "Rooms are down" (status row `rooms` older than 90 s) | On the VPS as `hermes`: `crontab -l` has the `rooms` line; `tail ~/.sales-desk.log`; `python3 desk.py rooms --once` shows what one tick does. A run that cannot reach the database says so in the log | Hermes |
| Rooms fail with "The room worker did not start this room within a minute" | The worker was not running when the room was asked for (same checks as above). The rep makes a new room | Hermes |
| The status row says "The video room tables are not in the database yet" | Apply `supabase/migrations/20261003a_sales_rooms.sql` | Hermes |
| The status row says "The rooms setting could not be read" | The worker claims nothing until it can read `rooms` in `cockpit_sales_settings`; check the database answers (`python3 desk.py doctor`) | Hermes |
| "Zoom is not connected on the room worker" | Set `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID` and `ZOOM_CLIENT_SECRET` in /opt/data/bibi/api-keys.env; the next minute's run uses them | The CEO |
| "Zoom is not answering" or "Google is not answering" in the status row | The provider timed out twice in a minute; its rooms fail at once for 30 s, then one call tests it again. Reps use the other provider meanwhile; check the provider's status page | Hermes |
| "Google is not connected on the room worker", "cannot use Calendar", or the doctor says the sign-in has no Calendar permission | Connect Google Calendar for the CEO's account and put the `GOOGLE_CAL_*` trio in /opt/data/bibi/api-keys.env; set `SALES_ROOMS_CALENDAR_ID` | The CEO |
| "Google refused the room worker's sign-in" | The Calendar sign-in lapsed or was revoked: connect Google Calendar again | The CEO |
| "Google would not make the Sales rooms calendar" | Create a calendar named "Sales rooms" in the CEO's Google Calendar, or set `SALES_ROOMS_CALENDAR_ID` in ~/.sales-desk/env | The CEO |
| "Google did not make the Meet link. Try Zoom." more than now and then | Google left the Meet link pending for 30 s. Use Zoom meanwhile; check Google Workspace status | The rep, then Hermes |
| "Your Zoom invite is not accepted yet" or "Your email has no Zoom user" | The rep accepts Zoom's invite, or the CEO adds them in Zoom, or the manager links their Zoom user on the Team page | The rep, the CEO or the manager |
| The host check says a seat's default room "will fail" | Set the other room as the seat's default on the Team page until the seat's Zoom or Google works | The manager |
| "The closer's Zoom is Basic and ends at 40 minutes" | The closer's seat lost its licence: set it to Licensed in Zoom, or run the demo on Meet | The CEO |
| "Your Zoom is in another meeting" | The host ends the other meeting, or picks Meet | The rep |
| Alert "Room ... has ended, but ... is still in its Zoom meeting" | The lead may be in a room the cockpit thinks is over (a lost join). The host checks the meeting in Zoom; the worker closes it once nobody outside the team is left, and stops checking after three hours | The rep, then the manager |
| The host check says participant reports "could not be read" | The Zoom app lacks the report permission (past meeting participants): the CEO adds it to the server-to-server app | The CEO |
| A participant report does not match the cockpit (alert `room_report`) | A join was lost or marked by hand wrongly: check the room's events and correct the call's outcome | The manager |
| A cancelled room's Zoom meeting is still there | The worker deletes it within a minute (found by its code if it was never saved) and drops its host link after ten minutes even if Zoom refuses; `tail ~/.sales-desk.log` names Zoom's answer | Hermes |
| "sales-api refused the room message for N rooms" | sales-api does not take `room.event` (not deployed yet, or the key is refused). Links wait for the sweep or are not sent: deploy the rooms hooks or check the service key | Hermes |
| "sales-api did not answer for N room messages" | The sweep replays the stored events about 20 s later. If it lasts, check sales-api answers `room.event` in under 2 s | Hermes |
| A room stays "being made" for about two minutes, then fails with the sweep's sentence | A create went to Zoom and its answer never came, and Zoom's list never showed the meeting. The worker only looks for it (it never sends a second create); the sweep fails the room at claim + 120 s, and the worker closes the meeting if it shows up later. The rep makes a new room; check Zoom's status page if it repeats | The rep, then Hermes |
| The status row says "N extra Zoom meetings from overlapping runs closed" | Two runs worked on one room (most often a run by hand during the cron run, or a run slower than its minute); the extra meeting was closed. If it repeats, run by hand only under the lock: `flock -w 10 $HOME/.sales-desk/rooms.lock python3 desk.py rooms --once` | Hermes |
| Alert `room_stray_held` ("An extra Zoom meeting made for room ... is running with someone outside the team in it") | Someone joined a meeting the room does not use. The host checks it in Zoom; the worker closes it once nobody outside the team is left | The rep, then the manager |
| The log says "an event could not be taken with the lease" | The lease function is missing or refused: run `python3 desk.py deploy-check`; apply `20261003a_sales_rooms.sql` if it says so. Meanwhile the sweep replays the events, only slower | Hermes |
| The `slack` status row says "SLACK_SALES_BOT_TOKEN is not set on the VPS" | Put the Mahara Sales app's Bot User OAuth Token in /opt/data/bibi/api-keys.env as `SLACK_SALES_BOT_TOKEN` (never in chat); the next minute's run uses it | The CEO |
| The `slack` status row says "Slack refused the Mahara Sales bot token" | The app was uninstalled or the token revoked: reinstall the app in Slack and put its new bot token in /opt/data/bibi/api-keys.env | The CEO |
| The `slack` status row says replies were "refused by Slack (channel_not_found)" or `user_not_found` | The seat's Slack ID on the Team page is not that person's member id; the manager fixes it. The refused reply is closed, not retried | The manager |
| The `slack` status row says replies "Slack did not confirm in time" | Slack took longer than 4 s; each such reply is not sent again (it may have arrived). If it repeats, check Slack's status page | Hermes |
| `deploy-check` shows a `--` line | The line says what is missing and what it means: apply the named migration, set the named key in /opt/data/bibi/api-keys.env, or set the named switch back off in Settings | Hermes, or the CEO for keys and switches |

## Settings (environment, all optional)

| Name | Default |
|---|---|
| `SALES_MODEL_PROVIDER` | `vps` |
| `SALES_PROPOSAL_MODEL` | per provider, above |
| `SALES_MODEL_TIMEOUT` | `900` seconds of silence per try |
| `SALES_MODEL_ATTEMPTS` | `3` tries per model call |
| `SALES_MAX_TOKENS` | unset (the model's own limit); Anthropic uses 64,000 |
| `SALES_REASONING_EFFORT` | unset (the model's default) |
| `SALES_TIGHTEN_ROUNDS` | `3` |
| `SALES_RENDER_TIMEOUT` | `120` seconds for a browser |
| `SALES_REQUESTS_PER_RUN` | `3` |
| `SALES_STUCK_MINUTES` | `30` |
| `SALES_RECORDINGS_DAYS` | `14` |
| `SALES_MIN_TRANSCRIPT_CHARS` | `5000` |
| `SALES_FATHOM_PACE` | `1.1` seconds between Fathom calls |
| `SALES_VAULT_FATHOM_DAYS` | `14`: how far back `calls-vault` asks Fathom about calls whose note cannot say whether the lead joined |
| `SALES_DESK_HOME` | `~/.sales-desk` (working files in `out/`, references in `reference/`) |
| `SALES_BUCKET` | `sales-proposals` |

Keys are read by name from the environment, then from `~/.sales-desk/env`,
`~/.editor-desk/env`, `/opt/data/bibi/api-keys.env` and `/opt/data/.env`, and
never printed. Every error is scrubbed of anything that looks like a key
before it is logged or stored.

## What it writes

In Creative Triage (`supabase/migrations/20260924a_sales_cockpit.sql` and
`20260924b_sales_proposal_files.sql`), with the service key:

- `cockpit_sales_requests`: status, attempts, claimed_at, claimed_by,
  finished_at, error, result. Only rows of kind `proposal` are touched.
- `cockpit_sales_proposals`: deal, validation, fill_count, variant, model,
  html_path, pdf_path, recording_id, lang, status, error, updated_at.
- `cockpit_sales_recordings`: one row per sales call, upserted by recording
  (source `vault`, `maqsam`, `b2b_fathom`, or none for the Fathom step's).
- `cockpit_sales_settings`: the `offer` setting, only when it differs, and
  `maqsam_calls`, the phone calls' high-water mark.
- Storage `sales-calls` (private): each call's transcript, `<recording id>.md`
  and `maqsam/<id>.md`.
- `cockpit_sales_worker_status`: one row per job.
- `cockpit_sales_rooms` (video rooms): the claim (`state`, `claimed_at`,
  `worker_run`, `version`), then `join_url`, `provider_meeting_id`,
  `opened_at` and the deadlines sales-api left empty, or `failed` with
  `error`; `cockpit_sales_room_secrets` (the host link, dropped at the end);
  `cockpit_sales_room_events` (`worker.ready`, `worker.failed`, and the
  notes `worker.create_sent`, `worker.closing`, `worker.held`,
  `worker.stray`, `report.checked`, each with a `text` sentence; the
  worker's own `worker.ready` or `worker.failed` marked handled, with the
  lease, when its room went another way; the `slack.reply` events the
  poster sent or closed, with `handled_at`, `tries` and what Slack said);
  `cockpit_sales_room_hosts` (the host check, never over the Team page's
  `zoom_user_id` or `default_provider`); `cockpit_sales_alerts` (a meeting
  left open with someone in it, an extra meeting with someone in it, a
  participant report that does not match).
- `cockpit_sales_worker_status` rows `rooms`, `room-hosts` and `slack`.
- Storage `sales-proposals` (private): `proposals/<id>/v<n>.html` and `.pdf`.

On the VPS, `~/.sales-desk/out/<proposal id>/` keeps the working files of
each draft (the transcript it was checked against, the deal, each rendered
draft), owner only, so a document can be checked again by hand.

## What changed from the B2B engine

- The model is ours: a provider layer instead of Muhammed's proxy.
- Fathom is read directly, per rep; the B2B tables are not read at all.
- The offer comes from `offer.json` and the closer's choice, and the
  validator checks the chosen option instead of one fixed offer.
- Slack delivery is gone; the cockpit shows the proposal.
- Real client names and figures are out of SKILL.md and PATTERNS.md, and the
  reference deals are off git.
- A proposal missing only its company name is `needs_input`, not `failed`:
  the fix is the closer's, not the engine's.
- Two faults fixed on the way: the validator's "path" pattern never matched a
  path, and one-shot Chrome's finished output was thrown away when it did not
  exit.

## Tests

```bash
cd hermes/sales-desk && python3 -m unittest discover -s tests -t .
```

No network. Every call, company and figure in them is invented. The HTTP
layer is replaced by an in-memory PostgREST that reads the real query strings
(eq, lt, in, is, ilike, or, a JSON arrow, order, limit, on_conflict, Prefer),
so the queue is tested against the filters it actually sends: the variant
gate, JSON out of every shape of model answer, streaming, the providers, the
offer and its plans, the validator on good and bad deals of all three
variants, the guarantee, FILL and the status it leads to, the build, the
reference extractor, the recording matcher and index, the tightening rounds,
the claim, the reaper, a draft that needs input, a clean draft with its PDF,
the rebuild, and the commands.

`tests/test_rooms.py` covers the video room worker against fakes of Zoom,
Google Calendar and sales-api behind the same HTTP layer (never the real
ones): the claim race (two runs, fifty threads), the Zoom create body, a busy
host, a Basic host on a demo, pending and missing seats, retries that never
make a meeting twice, Meet pending then ready and never ready, the hand-over
of a pending Meet room to the next run, crash recovery both ways, closing
final rooms (never one a lead reached, never a booked call), the 57-second
loop and its hard stop, the status row and the host check's sentences, and a
busy three minutes with failing providers that leaves nothing stuck or
doubled. `tests/test_rooms_adversarial.py` is the review's attack on it (one
test per finding), and `tests/test_rooms_hardening.py` the fixes: provider
breakers, the one-call `room.event`, lost answers, never ending a meeting
with a lead in it, the participant report, the Team page's values, the
switches, the end of a run, no real sleeps, Google's permission, scrubbed
secrets, and a harsher four-minute stress run (every provider and the
database failing and hanging, sales-api slow and refusing, cancels and
expiries, a run by hand in the middle of a cron run) that leaves nothing
stuck, doubled or leaked (the sweep's 60 s and 120 s rules run inside it,
since the sweep owns those timers). `tests/test_ops_contract.py` holds the
worker and the Slack poster to contract-v2: the `room.event` body and how
each answer is read, the stored event before the room write and the call
after it, `text` on every event, the lease (never over a hold, nothing
closed without it), claims only while switched on, the meeting an
overlapping run may adopt, every path of the Slack poster, and a stress run
of overlapping runs, the sweep, flaky sales-api, Slack and database together
that leaves no meeting behind, no reply sent twice and no event without
text. `tests/test_deploy_check.py` covers `deploy-check`: GETs only, no
folder made, no key value printed, and each missing piece said.
