# Native media queue

This worker owns native `chat.deliver`, `assist.run`, and `calendar.refresh` jobs in Creative Triage (`bldgtotkfmhoxmlzowdx`). It does not write to B2B, publish ads, or contact clients. The existing provider API still owns its synchronous Meta actions.

## Operations and source contracts

| Job | Actual work | Result |
|---|---|---|
| `chat.deliver` | Send the human question and stored campaign context to the internal destination from legacy `chat.ts` (`ALERT_SLACK_TO`, otherwise Aziz `U09305KE2KS`). | A validated Slack channel and message timestamp. A durable intent alone is not delivery. |
| `assist.run`, kind `copy` | Anthropic Messages structured JSON, using the canonical house rules, client board rules, preferences, campaign facts, and eligible saved/automatic winner examples. | Five validated variants. No ad creation. |
| `assist.run`, kind `creative` | Read shared Drive file/folder metadata and full folder pagination; upload images or resumable video chunks into the verified client's Meta creative library. | Real `media` entries with image hashes/video IDs, progress and receipt-backed completion. No campaign, ad set or ad creation. |
| `assist.run`, kind `launch` | Draft copy, import explicitly supplied assets, and derive onboarding/launch checklist steps from actual source facts. | `variants`, optional `media`, and honest `steps`; missing access/billing/task facts remain blocked/waiting. |
| `calendar.refresh` | Authenticate the configured service account with Calendar read-only scope. Read every page from seven days back through twenty-one days ahead. | Original event dates and end times, plus today's overlapping events. Missing sharing, ownership, credentials or invalid responses are errors, never successful empty calendars. |

Canonical references are `apps/media-buyer-cockpit/convex/{assist,assistWorker,chat,personalCalendars,tools,cockpit,metaMedia}.ts`. Runtime code imports only the pure winner-eligibility helper, not the Convex runtime. Native storage is the canonical SQL schema, not a parallel queue.

`onboardings`, `launchWatch`, `clientPrefs`, and `boardCards` must have verified per-table media source state and exact row counts. Copy/launch also require the creative `winnersArchive` source to be verified. An explicitly verified zero-row archive means no comparable examples; an absent archive is an error. The existing native producer publishes creative source `campaigns`/`ads` coverage with their canonical domain mirrors. `cockpit.winners` uses those verified facts, client scope and saved still fields. It returns `{sameLine,rest}`, not `winner_ads`.

Winner reads require one active campaign mapping per candidate ad, one verified ad owner, a matching verified campaign owner, and a consistent account identity. Both ad and campaign ownership are authorized. Duplicate campaign names or conflicting ownership make the read fail with a source-refresh instruction; they never relabel, silently hide or skip an ambiguous creative.

## Fencing and outcomes

Apply `20261004d_media_native_surface.sql` and the reviewed additive `20261004e_media_native_worker_contracts.sql`, after the canonical identity, domain, source and statistics prerequisites. The base claim/context/finish/reply RPCs remain authoritative. The additive guard locks the current job, requesting identity and campaign, rechecks access and source readiness, and captures a provider-account/identity fingerprint. Changes to membership, confirmation, account mapping or calendar ownership cannot publish a stale result.

The additive migration also replaces the claim body to correct the historical `r.id` PL/pgSQL alias collision. It does not change the historical migration or disable ambiguity checks. Periodic refreshes join the current calendar binding and its revision; claims capture `calendar_revision`, and the worker guard rechecks it. Unlink tombstones cannot schedule a new refresh. Expired claims still become `reconcile`, never queued.

The durable intent contract returns one of:

- `new`: this execution may call the provider once.
- `pending`: a prior call has no confirmed receipt. Stop and reconcile; do not call the provider again.
- `confirmed`: use the actual recorded response; do not repeat the provider call.

Each asset upload phase has its own durable intent and confirmed receipt. The job has a separate end-to-end completion receipt. A database trigger refuses `ready` without that receipt. Provider failures after an intent, lost receipts, timeouts and bounded-run expiry become reconciliation, not automatic retries. Expired base claims remain reconciliation. A failed calendar fetch is never finished as `ready`.

Every provider transport is guarded and records a sanitized health row through `tools.ts`. Handler/parser/configuration failures also record health. Health data contains only bounded codes, numeric counts/status/duration/bytes; it contains no tokens, prompts, provider error bodies or conversation text. Private service-only durable receipts retain the result needed for idempotence. Health recording failure stops the run rather than silently losing evidence.

Human replies are polled on every applied run, including when there are no new jobs. Each run processes at most one page per claimed thread. Persisted cursors continue pagination on later runs; completion returns to the first page for later human replies. Polls use a two-minute lease, recheck current role/client/campaign scope and derive deterministic UUIDs from channel/timestamp. Bot messages and the parent question are excluded. Re-reading a reply does not duplicate it.

## Calendar binding revisions

The additive migration replaces only the existing native-write implementation; it does not create a legacy alias. Other operation semantics remain intact. Calendar request receipts and per-actor binding revisions survive calendar replacement and unlink. Every first calendar intent captures `bindingRevision` and keeps it with its request ID across uncertain retries. The server locks the binding and checks that revision atomically. A committed old request returns its old receipt without changing the current calendar. A never-arrived old request fails the revision comparison. Reusing an ID with another actor, operation or exact JSON args fails.

`cockpit_media_calendar_mine(p_app)` returns the existing personal-calendar payload plus numeric `bindingRevision` in one database snapshot. Each cockpit has its own actor/app binding. The browser captures that value internally. Existing UI `{calendarId}` / `{}` arguments remain unchanged. On receipt it reloads the current binding, discards account changes and reports superseded receipts without restoring old state. Without durable browser storage, callers must provide both `requestId` and the originally captured `bindingRevision`. Retry-time rebasing is forbidden.

A definitive revision conflict is recorded as an audited request outcome: `{ok:false, applied:false, code:"CALENDAR_CAS_NOT_APPLIED", id, expectedRevision, currentRevision}`. The browser validates the matching ID/revision, retires only that rejected intent, and throws `NativeCalendarNotAppliedError` with the same machine-readable code. It does not retry or rebase. A later deliberate action can reload and capture a fresh revision under a new ID. Lost rejection receipts remain uncertain until the original request gets its recorded outcome; reusing that old ID with changed args is rejected.

All successful and not-applied acknowledgements retire only their own preparation and matching storage request ID. A delayed second acknowledgement for A cannot delete a newer pending B.

## Named configuration

| Name | Purpose |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Creative Triage only; service credentials remain server-side. |
| `SLACK_BOT_TOKEN` | Internal message posting and reading the approved DM/thread. Install the corresponding Slack history scopes. |
| `ALERT_SLACK_TO` | Optional approved internal Slack destination. Never take a destination from browser args. |
| `ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL` | Structured copy generation. Model default matches canonical `tools.ts`: `claude-opus-5`. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Service-account identity must exactly match the database's configured email. Calendar and Drive use separate read-only scopes. |
| `META_SYSTEM_TOKEN` | Asset-library imports only. The account must match current scoped campaign/onboarding/launch sources. |

## Run commands

Install the worker's own pinned SDK dependency before scheduling it:

```sh
bun install --cwd hermes/media-native --frozen-lockfile --ignore-scripts
```

The worker does not rely on a frontend `node_modules` junction.
Offline regression fixtures use the repository's installed media-buyer test dependencies.

Read-only doctor (no provider calls, token exchange, claims or writes):

```sh
bun hermes/media-native/doctor.ts
```

Read-only queue inspection:

```sh
bun hermes/media-native/worker.ts
```

Applied processing uses actual OS `flock`, not a PID-file approximation:

```sh
bash hermes/media-native/run.sh --apply --once
bash hermes/media-native/run.sh --apply --limit 20
```

The bound is 1–50 jobs plus 1–50 reply pages and a twenty-minute total run deadline. Before each provider call the deadline and SQL fence are rechecked. Use the launcher from the worker host's scheduler; for example, every two minutes:

```cron
*/2 * * * * /bin/bash /opt/mahara-cockpits/hermes/media-native/run.sh --apply --limit 20
```

Configure named keys in the scheduler's secret environment. Do not put secret values in command lines or logs. Doctor checks availability and identity, but does not claim that configured keys prove live provider permissions.

## Offline acceptance

Run the canonical offline regression suite after integration:

```sh
bun test --timeout 60000 --preload ./hermes/media-native/test/offline.ts ./hermes/media-native/test
```

The temporary standalone runtime driver was removed after its proof was recorded. It used canonical PostgreSQL and the installed Supabase SDK. External Auth and provider HTTP were synthetic. It observed dry-run audit deltas, receipt reuse, human replies and ambiguous-outcome protection. This local proof does not certify production providers or schedules.

The regression suite separately covers actual role/client/confirmation/founder permissions; explicit apply; idempotent enqueue; claim exclusivity; stale tokens; pending versus confirmed intents; no false `sent`; revocation, expiry and reconciliation; repeated-send prevention; health and audit rows; real model parsing; Drive folders/images/chunked videos; later human reply ingestion; calendar pagination/all-day/cancellation/sharing; current-binding periodic refresh and unlink tombstones; calendar CAS/lost-receipt scenarios; browser account changes and interleaved acknowledgements; onboarding/winner consumer shapes and ownership ambiguity; scoped before/after statistics calculations and missing-source errors. The application compiler and the parent's shared smoke remain separate integration checks.

## Reconciliation

Keep uncertain jobs in `reconcile`. Inspect their service-only intent/receipt rows, sanitized health, audit history, and the provider's actual state. Do not delete intents, reset claims or blindly change a job back to queued. A confirmed receipt can be reused within a still-current claim; an expired/revoked claim cannot finish. Recovering an uncertain external side effect requires operator-reviewed provider evidence and a separately authorized decision, not an automatic retry. Partial asset progress and confirmed phase receipts remain available for that review. No production activation or live-provider acceptance is implied by offline tests.
