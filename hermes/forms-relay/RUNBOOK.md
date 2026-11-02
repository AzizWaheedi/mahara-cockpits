# The forms relay (hermes/forms-relay)

The native client onboarding (Stage 4, `docs/forms/WAVE56-CONTRACT.md` 3.8, 4.14.4) has two effects that leave
Supabase: the card's row on the **Client Data** sheet and the **market intel** GitHub dispatch. Make 13
(`8922994`) did both until the onboarding go-live; after it, `cockpit_form_stage4_plan` puts one row per effect in
`cockpit_form_relay_outbox` and this worker sends them.

## The switch and the settings

| What | Where | Off |
| --- | --- | --- |
| `FORMS_RELAY_APPLY=true` | `~/.forms-relay/switches.env` (read only there) | missing, or anything but `true`: a run claims nothing and prints what waits, in counts and keys |
| `CLIENT_DATA_SHEET_ID`, `CLIENT_DATA_TAB`, `CLIENT_DATA_CARD_COLUMN`, `CLIENT_DATA_COLUMNS` | `~/.forms-relay/config.env` | the doctor names each missing line; a run claims nothing |
| `DISPATCH_OWNER`, `DISPATCH_REPO`, `DISPATCH_EVENT` (default `market_intel`), `DISPATCH_NAME_KEY`, `DISPATCH_ID_KEY` | `~/.forms-relay/config.env` | the same |

The settings are copied at deploy step D-S4.0 from the saved Make 13 blueprint (`~/make-backups/`): module [31]'s
sheet, tab and column map, and module [25]'s repository, event type and payload keys.
`CLIENT_DATA_COLUMNS` is one JSON line of column letter to source: `task`, `client`, `submittedAt`, `kuwaitDay`,
`answer:<Typeform ref>` or `const:<text>`, for example
`{"A":"client","C":"task","D":"answer:514bfd3f-4ca1-469e-b9e7-87656503f65c"}`. The card column must be `task`.

Keys, by name only: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `GOOGLE_APPLICATION_CREDENTIALS` from the
native runtime file (the same Google service account the client-messages worker reads Client Data with; it needs
edit access to the sheet), and `GITHUB_DISPATCH_TOKEN` from `~/.forms-relay/keys.env` (mode 600; a fine-grained
token with Contents: write on the dispatch repository only). Never paste a key in chat; the systems manager puts it
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

## A run

1. Off: counts the outbox and prints `Dry run: N rows wait (...)` or `Nothing to relay.`. Nothing is claimed.
2. On: `cockpit_form_relay_claim(5)`. The database hands over only rows whose effect the cockpit owns (the owner
   gate); a row Make owns again is skipped there with the gate's sentence. A claim older than 10 minutes is
   turned `unknown` (a run stopped mid-send) and never sent again.
3. **Client Data row:** the sheet is read first. A row with the card in the card column: `sent`, "already there",
   nothing written. The test card `86eywg1cq`: `skipped` (its row is the one people made). Else one row is
   appended and the sheet read again: found, `sent`; not found, `unknown`. Google refusing the write (a 4xx other
   than 408 or 429): `failed`, tried again after 10 minutes, three tries in all. No clear answer: `unknown`.
4. **Market intel dispatch:** the test card is `skipped`. GitHub's 204 is `sent`; a 4xx other than 408 or 429 is
   `failed` (tried again, three tries); anything else is `unknown`, never sent again.
5. `cockpit_form_relay_done` records each outcome and settles the onboarding answer's effect (delivered, failed on
   the last try, unknown or skipped), so the CSM's trail shows it.
6. One health row, `cockpit_sync_state` `forms-relay`; every Google and GitHub call has its intent and response
   receipts in `cockpit_csm_provider_health` (`run_key` `forms-relay:run:<uuid>`).

## An unknown row

Open Client Data and look for the card in the card column, or the dispatch repository's Actions runs for the
client. Found: nothing to do. Not found: add the row by hand (or re-run the dispatch from GitHub). The relay never
sends an unknown row again; the guardian's `relay` check warns on any.

## Switch off and go back

`FORMS_RELAY_APPLY=false` stops every send at the next run; claimed rows finish their one call. Going back to Make
(`cockpit_form_stage4_go_live('onboarding', false, ...)`, Make 13 on from its blueprint) makes the gate skip every
queued row with "Make owns this again."

## Tests

`cd hermes/forms-relay && bun test`: the config's checks, the row and dispatch bodies, the sheet read before any
write, "already there" sent once, the test card never written or dispatched, a refused write retried and an
unclear one unknown, a dry run that claims nothing and prints counts and keys only, the ledger's allowed calls and
receipts, and the doctor's reads.
