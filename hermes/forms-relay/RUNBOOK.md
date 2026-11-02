# The forms relay (hermes/forms-relay)

The native client onboarding (Stage 4, `docs/forms/WAVE56-CONTRACT.md` 3.8, 4.14.4) has one effect that leaves
Supabase: the **market intel** GitHub dispatch. Make 13 (`8922994`) sends it until the onboarding go-live; after
it, `cockpit_form_stage4_plan` puts one row in `cockpit_form_relay_outbox` and this worker sends it.

The relay writes nothing to the **Client Data** sheet. D-S4.0 read the saved Make 13 blueprint: module [31] only
searches Client Data column C for the card's row (where the phase 3 group is), and no Make scenario writes a
Client Data row. The search still gates the rest of Make's route: [49] (the map at phase 3) to [48] (the phase 3
message) run once for each row it finds, and not at all for a card with none. The client-messages worker reads
the group from that sheet itself. So `20261102l` took the `client_data_row` effect out of the native onboarding,
and the outbox takes only `github_dispatch`. A row of any other effect that reaches the relay is `skipped` with
"This row is not the market intel dispatch, so the relay sent nothing for it. Check why it was queued." and is
sent nowhere.

## The switch and the settings

| What | Where | Off |
| --- | --- | --- |
| `FORMS_RELAY_APPLY=true` | `~/.forms-relay/switches.env` (read only there) | missing, or anything but `true`: a run claims nothing and prints what waits, in counts and keys |
| `DISPATCH_OWNER`, `DISPATCH_REPO`, `DISPATCH_EVENT` (default `market_intel`), `DISPATCH_NAME_KEY`, `DISPATCH_ID_KEY` | `~/.forms-relay/config.env` | the doctor names each missing line; a run claims nothing |

The settings are copied at deploy step D-S4F from the saved Make 13 blueprint (`~/make-backups/`): module [25]'s
repository, event type and payload keys. `CLIENT_DATA_*` lines left in `config.env` by an earlier install are
ignored; delete them when you next edit the file.

Keys, by name only: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the native runtime file, and
`GITHUB_DISPATCH_TOKEN` from `~/.forms-relay/keys.env` (mode 600; a fine-grained token with Contents: write on the
dispatch repository only). The relay needs no Google key. Never paste a key in chat; the systems manager puts it
there, or the cockpit's paste box does.

## Install (D-J2)

1. Native release, file-scoped: `hermes/forms-relay/` into the release tree, linked as
   `/home/hermes/forms-relay-current`.
2. `mkdir -p ~/.forms-relay && chmod 700 ~/.forms-relay`; write `config.env` and `switches.env` with
   `FORMS_RELAY_APPLY=false`.
3. `hermes/forms-relay/run.sh doctor`: ok, or a list of what is missing.
4. Cron, under `flock` (run.sh takes the lock):
   `*/2 * * * * /home/hermes/forms-relay-current/hermes/forms-relay/run.sh run >> /home/hermes/.forms-relay/run.log 2>&1`
5. A run prints `Nothing to relay.` and writes the health row `forms-relay`.

A relay installed before `20261102l` (with the Client Data path) needs this release before `FORMS_RELAY_APPLY` is
ever set to `true`. Apply `20261102l` first: once it is on, the outbox cannot hold a Client Data row, so even the
old release has none to write. Then release these files, run the doctor (it no longer asks for Client Data lines or
the Google key) and keep the switch off until the onboarding go-live.

## A run

1. Off: counts the outbox and prints `Dry run: N rows wait (dispatch keys ...)` or `Nothing to relay.`. Nothing
   is claimed.
2. On: `cockpit_form_relay_claim(5)`. The database hands over only rows whose effect the cockpit owns (the owner
   gate); a row Make owns again is skipped there with the gate's sentence. A claim older than 10 minutes is
   turned `unknown` (a run stopped mid-send) and never sent again.
3. **Market intel dispatch:** the test card `86eywg1cq` is `skipped` (its dispatch would queue real market
   research). GitHub's 204 is `sent`; a 4xx other than 408 or 429 is `failed` (tried again after 10 minutes, three
   tries in all); anything else is `unknown`, never sent again.
4. Any other effect key: `skipped`, nothing sent.
5. `cockpit_form_relay_done` records each outcome and settles the onboarding answer's effect (delivered, failed on
   the last try, unknown or skipped), so the CSM's trail shows it.
6. One health row, `cockpit_sync_state` `forms-relay`; every GitHub call has its intent and response receipts in
   `cockpit_csm_provider_health` (`run_key` `forms-relay:run:<uuid>`). The ledger lets only GitHub calls out.

## An unknown row

Open the dispatch repository's Actions runs and look for a market intel run for the client. Found: nothing to do.
Not found: re-run the dispatch from GitHub. The relay never sends an unknown row again; the guardian's `relay`
check warns on any.

## Switch off and go back

`FORMS_RELAY_APPLY=false` stops every send at the next run; claimed rows finish their one call. Going back to Make
(`cockpit_form_stage4_go_live('onboarding', false, ...)`, Make 13 on from its blueprint) makes the gate skip every
queued row with "Make owns this again."

## Tests

`bun test hermes/forms-relay/relay.test.ts` from the repository root: the config's checks (dispatch lines only; old
Client Data lines ignored), the dispatch body, the test card never dispatched, a stray `client_data_row` row skipped
and written to no sheet, a refused dispatch retried and an unclear one unknown, a dry run that claims nothing and
prints counts and keys only, the ledger's allowed calls (GitHub only) and receipts, and the doctor's reads (no
Google key).
