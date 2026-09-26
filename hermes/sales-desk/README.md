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
`{"lang": "ar"|"en", "recording_id"?, "proposal_id", "offer": {"guarantee": true|false, "payment": "pif"|"two_payments"|"monthly", "price"?: number, "months"?: number}}`.
An option that is not in the file fails the request with a sentence naming
the ones that are. The drafter is told exactly the chosen figures, the
instalments and where each goes; it may not invent a schedule, and the
guarantee appears only when it was chosen. The validator checks the document
against the same choice: the price and term in `roi`, the deposit, the
advertising on a line of its own, the instalments printed and adding up to
the price, no split printed for a payment in full, and no promise of free
work when no guarantee was chosen.

**Aziz to confirm** (defaults written by the engineer, marked `confirm` in
the file): the `two_payments` plan (half at the start, half 45 days in), the
`monthly` plan (one equal payment a month, the first at the start), and the
guarantee wording, taken from the closer framework's stage 13 with its em
dash made a comma: *30 qualified appointments in 90 days, or we work for free
until we deliver.* A request that does not say whether the guarantee is
included is taken as no guarantee.

## The model

`SALES_MODEL_PROVIDER` picks the provider; `SALES_PROPOSAL_MODEL` the model.

| Provider | Key | Default model |
|---|---|---|
| `openai` (the default) | `OPENAI_API_KEY`, already on the VPS | `gpt-5` |
| `anthropic` | `ANTHROPIC_API_KEY`, empty on the VPS today | `claude-opus-5` |
| `openrouter` | `OPENROUTER_API_KEY` | `openai/gpt-5` |

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

## Install on the VPS

As `hermes`, from the repo clone at `~/mahara-cockpits`. The Supabase pair is
the editor desk's (`~/.editor-desk/env`, Creative Triage); `OPENAI_API_KEY` and
`FATHOM_API_KEY` are in `/opt/data/bibi/api-keys.env`. The desk's own env file
holds settings only, never a key:

```bash
cd ~/mahara-cockpits && git pull -q --ff-only
mkdir -p ~/.sales-desk/reference && chmod 700 ~/.sales-desk
cat > ~/.sales-desk/env <<'EOF'
SALES_MODEL_PROVIDER=openai
SALES_PROPOSAL_MODEL=gpt-5
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
```

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

## Settings (environment, all optional)

| Name | Default |
|---|---|
| `SALES_MODEL_PROVIDER` | `openai` |
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
