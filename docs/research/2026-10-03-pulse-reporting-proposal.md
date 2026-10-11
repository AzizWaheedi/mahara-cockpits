# PULSE replacement: reporting-agent proposal

Status: proposed design for user review. The old PULSE runtime is retired. This document does not enable a replacement or a schedule.

## 1. Goal and scope

Build a reporting agent that understands what Mahara delivers to each client: ad spend, cost per lead, cost per booking, meetings, pipeline outcomes, creative output, lead notes, conversations, and call activity. It must answer internal questions and prepare accurate client-facing reports from the same verified evidence.

User requirements: remove the old daily task and old agent; recreate it for internal and external reporting; use the data already stored in Supabase. Conservative defaults proposed here: on-demand first, draft-only client reports, human approval before external delivery, no automatic daily task creation. These defaults are not an instruction to build now.

Out of scope: resurrecting the old health-score rubric, automatic CRM/ad changes, automatic task creation, a new CRM, a second copy of all warehouse records, unrestricted client access to internal notes.

## 2. Retirement completed and boundaries

Removed on the live VPS:
- `pulse-daily-digest` (`acd8a3372bc3`) and `pulse-board-selfcheck` (`ce3b8d5bebf4`). The scheduler reported no jobs before profile deletion.
- PULSE's system watchdog cron and `/home/muhammed/watchdog-pulse.py`.
- Both reboot/five-minute autostart arguments for `client-watcher`; shared launcher now defaults to Scout only.
- PULSE gateway, sidecar on port 3461, profile, profile credentials/sessions/scripts, PULSE-specific skills, and deployed sidecar identity.
- Local profile/skills/manifests/watchdog and source canary identity. The shared sidecar registry now accepts only Scout.
- Six agent-only SQL helpers: `pulse_sql_dump`, `pulse_ads`, `pulse_client_detail`, `pulse_client_health`, `pulse_freshness`, `pulse_roster`.

Preserved intentionally:
- All client source tables, warehouse sync jobs, panel views, the client portal, and Scout runtime/authentication.
- `public.pulse_client_credential(text)`: despite its name, it is a shared dependency of the client portal migration reader and rehearsal script. Dropping it would break those consumers. It is not a scheduled agent.
- 39 existing business report artifacts, copied outside the deleted profile to `/home/muhammed/report-artifacts/pulse-retired-20261003`. Executable report-generation scripts were not copied.
- Historical system documentation and frozen migration/deployment evidence, not active deployment identities. System references now mark PULSE retired.

Remaining external cleanup: Slack app `A0B607EH78W` has not been uninstalled. No PULSE gateway remains behind it. No stored Slack owner browser session was found in the local project directories. App-owner access is required to delete its registration; runtime deletion is not Slack-app deletion. Owner page: https://api.slack.com/apps/A0B607EH78W.

Migration: `supabase/migrations/20261003_retire_pulse_agent.sql`. Uses non-cascading drops and writes a retirement audit row in `cockpit_audit_log`.

Verified by running the real launcher: Scout remained running with sidecar health `ok`; PULSE did not return; profile absent; port 3461 closed; no PULSE process; live cron has no PULSE restart/watchdog row. Panel views remain readable. No client message or report was sent during retirement.

## 3. What the live warehouse actually contains

Read-only SQL inspection on 2026-10-03, not historical documentation. Counts describe stored rows, not complete business totals.

| Requirement | Existing source | Observed coverage and limits |
| --- | --- | --- |
| Client identity | `public.ghl_clients`, `ghl_client_ad_accounts`; `portal_data.workspaces` | Public roster has 64 rows: 16 Active, 6 Launching, 3 Paused, plus other statuses. Portal workspace snapshot has 63 rows. Reconcile identity/membership; do not join by display name. |
| Spend and efficiency | `public.v_panel_spend`; raw `ads_daily_snapshots` plus `clients.currency`; `portal_data.ad_metrics` | Public Meta spend reaches 2026-10-02. TikTok reaches only 2026-07-23. Portal ad metrics have 19,322 rows but latest capture is 2026-09-19. Missing platforms are unavailable, never zero. |
| Leads/CPL | `public.v_panel_leads`, `client_leads`; `portal_data.contacts` | 12,355 public lead rows, latest sync on 2026-10-03. Portal contacts: 6,836 rows over 40 locations, latest capture 2026-09-19. Public view exposes deleted contacts; report must explicitly exclude them. |
| Bookings/CPB and meetings | `public.v_panel_appointments`, `appointments`; `portal_data.appointment_outcomes` | 3,196 public appointment rows, updated 2026-10-03. Attendance recorded on 345 rows, including 144 attended. Portal outcomes: 329 revisions over 24 locations, latest capture 2026-09-22. These stores overlap; never add their counts. |
| Pipeline/output | `public.client_opportunities`, pipeline definitions; `portal_data.opportunities`; review/social/creative tables | `review_links`: 3 rows; `review_items`: 10; `social_posts`: 5. `team_creative_rows` and `cockpit_creative_requests`: 0 rows. This is partial evidence, not proof of no delivered creative work. |
| Lead notes | `portal_data.contact_notes`; `mahara_console.attempts` for dialer dispositions | 19,030 CRM notes across 37 locations, latest capture 2026-09-19. Need per-client coverage and ongoing sync before current-context claims. Dialer note extraction must follow the existing attempt/disposition contract. |
| CRM conversations | `portal_data.conversations`, `portal_data.messages` | 4,667 conversations and 57,885 messages across 35 locations. All stored conversation rows mark pagination complete, but latest capture is 2026-09-19. Pagination completeness does not establish current freshness. |
| Agency/client communications | `public.wa_threads`, `wa_messages` | 3,213 WhatsApp messages; latest message on 2026-10-03. Distinguish agency-client group discussions from lead conversations by thread/client/contact mapping. |
| Calls and recordings | `mahara_reporting.facts` (`source=maqsam`, `kind=call`), existing call-centre report; `portal_data.call_assets` | 14,696 stored Maqsam call facts, captured on 2026-10-03. Fact payloads contain call metadata, not transcript text. Portal has 53 recording assets, latest checked 2026-09-19, no transcript text in those assets. Recording existence is not transcription coverage. |

Source priorities: fresh public feeds for core delivery metrics; normalized portal records for notes/conversations/outcomes after their ingestion is restored and parity proven. Do not switch all metrics to the older portal snapshots just because their schema is newer.

Creative Triage (`bldgtotkfmhoxmlzowdx`) owns client delivery/reporting and any new `cockpit_` tables. B2B (`flwboeijllbtrufxkhts`) remains a read-only source for Mahara's own sales reporting only. Never mix Mahara's sales funnel into a client's performance report.

## 4. Options and recommendation

1. **Recommended: one deterministic reporting backend with a thin PULSE conversation layer.** Supabase/code owns measures, permissions, evidence and report states. The model selects relevant evidence and explains it. Fits existing cockpits and portal without another datastore.
2. **Prompt-heavy autonomous Hermes agent.** Fast to configure but lets the model improvise joins, definitions and verification. Old PULSE's documented currency, boundary and fabricated-cross-check incidents make this unsuitable.
3. **Reports without an agent.** Lowest narrative risk, but weak for questions across notes, conversations and results. Reuse its deterministic rendering discipline inside option 1.

Do not carry forward the old five-signal health score. Reporting is the requested purpose. A score can obscure partial data and adds an unrequested decision layer.

## 5. Proposed flow

```text
Authorized request: client + period + audience
                  |
                  v
Client identity + permissions + source coverage
                  |
                  v
Deterministic metrics and scoped evidence retrieval
                  |
                  v
Freshness / completeness / independent validation
        | missing or disputed          | verified
        v                              v
Internal partial answer          Structured narrative draft
with explicit limits                   |
                                  Client-safe rendering
                                       |
                               Human approval + delivery
                                       |
                               Read-back + audit evidence
```

A missing conversation feed need not hide verified CPL in an internal answer. It must block a claim of complete current context. Client publication must not silently omit a requested section or publish a disputed metric.

### Interfaces and responsibilities

- Request envelope: `location_id`, local date range, audience (`internal` or `client`), requested sections, authenticated requester. Resolve names to IDs first; ambiguous matches require choosing an identity.
- Report evidence envelope: metric values, units, numerator/denominator, source IDs, definition version, period, per-source watermark/status, coverage, exclusions and validation results. Evidence is scoped to the authorized client before model access.
- Deterministic metric service: computes totals and comparisons; model cannot query arbitrary SQL, access Vault, change formulas, or mark validation passed.
- Evidence retrieval: fetch the requested client's lead notes, conversations, appointment outcomes and delivery records with bounded date windows and pagination. Offer drill-down to source records. Start with SQL filters/indexes; no vector database is needed to establish correctness.
- Narrative step: produces findings, supporting evidence IDs, confidence/limits and suggested actions. Separate measured facts from hypotheses. Fetch targeted additional context when needed; do not stuff every client's history into each prompt.
- Renderer: fixed report sections and metrics from the evidence envelope, not model-written numbers. Internal and client-safe projections are distinct before model/render access. Reuse existing portal/report surfaces; do not start with a new dashboard.
- Persistence: proposed `cockpit_report_runs` for requests, evidence snapshot/definition version, draft/approval/publication state, source coverage and artifact reference. Append every state change to existing `cockpit_audit_log`. Store large sensitive artifacts privately, not duplicate all source messages in each run.

Report states: `requested -> collecting -> draft -> approved -> published`; collection/validation can produce `blocked` or `failed`. A material source or report change invalidates approval. Approval applies to the exact report revision and intended recipients.

## 6. Definitions that must be fixed before model access

- Date ranges: Asia/Kuwait calendar dates; translate to `[start, next-day-after-end)` timestamps. Define prior comparison windows explicitly and compare equal lengths.
- Spend: preserve native currency and publish a named reporting currency. Reuse the panel's verified USD conversion; do not assume an unknown currency is USD. Check raw account currencies separately because the existing view falls back to a divisor of 1 for unrecognized values.
- Leads: distinct client-scoped contact IDs, creation date, excluding deleted contacts. Separate paid-channel leads from organic/manual/unattributed contacts. Paid CPL is matching channel spend / matching attributed paid leads; blended spend/all-leads is labelled separately, never called paid CPL.
- Bookings: distinct eligible appointment IDs on booking creation date, including future meetings booked in the period. Exclude callback/provisional calendars and cancelled/invalid records using the agreed panel/report rules. The appointment view itself does not apply all these filters; do not count every view row blindly.
- Meetings: due on meeting date, separate from booking date. Show attended, no-show, cancelled and unrecorded separately. Client attendance must not inherit B2B's rule treating past confirmed demos as shown. Publish the denominator and attendance coverage.
- CPB: matching spend / eligible matching bookings. All-channel blended CPB and attributed paid-channel CPB are separate. Zero denominators return unavailable, not zero or infinity.
- Outcomes: distinguish pipeline state, quotation, attended meeting, won deal and recorded revenue. Opportunity monetary values are not proof of cash collected. Select latest outcome revision, never count each revision as a new meeting/deal.
- Delivery output: distinguish requested, produced, approved, launched and published items. Deduplicate cross-surface copies and keep the source/status beside counts.
- Conversations and notes: client + contact + conversation/note ID and actual event time. Exclude deleted records; preserve direction/author. Quotes need source attribution; summaries must not convert an objection or a guess into a confirmed outcome.
- Freshness: evaluate successful sync checkpoints per client/provider/dataset, not the timestamp of the latest unrelated message or row. Use existing source cadences; a 6-hour threshold is proposed for hourly core CRM feeds, not all historical datasets. Show failed attempts and date coverage separately.

## 7. Internal and external report contracts

**Internal:** spend/CPL/CPB; booked versus due versus attended meetings; conversion and pipeline outcomes; delivered creative output; lead-quality themes and lost reasons; call/contact activity; client concerns; coverage gaps; evidence-backed recommended actions. Include comparisons with equivalent prior periods.

**Client-facing:** the same verified performance totals, meaningful outcomes, delivered work, approved explanation and next steps. Exclude internal staff assessments, private agency-client notes, credentials, unrelated leads/clients and raw personal data. Client-owned lead details require the appropriate client permission; external audience is not blanket permission to disclose every note. Private, authenticated artifacts; never use the old anyone-with-link edit permissions.

Cockpit screens, if needed later, extend Geist, `--mahara-teal` and the existing CEO kit. Load the required frontend-design skill before any screen work. Client-facing documents use the existing Mahara report system; Arabic copy follows aziz-kuwaiti-voice. No agent branding on client documents.

## 8. Setup sequence and acceptance gates

### A. Restore and reconcile data coverage

Find the current owners of portal note/conversation ingestion and restore continuous imports using existing sync contracts. Compare per-client public roster/mappings with portal workspaces. Fix stale TikTok ingestion when that channel is in scope. Establish per-client note/message/recording coverage and required joins to creative output. Reuse existing helpers; do not create a competing sync pipeline merely to serve PULSE.

Acceptance: successful checkpoints and representative new source records reach Supabase for each enabled dataset. Unconnected/unverified datasets remain explicitly unavailable. Core/client data is unchanged by reporting reads.

### B. Build the deterministic report/evidence service

Implement versioned definitions above and client-scoped evidence retrieval. Reuse existing panel views, call-centre functions and portal readers. Put new store migrations in this repo; RLS and service-role grants ship together. All actions are server-gated by role/CEO or client membership. Reporting has no write access to client CRM/ad records.

Acceptance: one report returns measures, source IDs, coverage and exclusions for the same client/period. Regression cases cover currency conversion, zero denominators, deleted leads, future bookings, month-end boundaries, unknown attendance, outcome revisions and multi-client isolation.

### C. Prove numbers against independent evidence

For representative clients/periods, compare reports against the panel and read-only upstream provider exports/API reads. A second query over the same snapshot is not an independent source check. Require exact matching event counts under aligned definitions; document any known rounding difference for spend. Unexplained discrepancies block publishing the affected section. Validation result is persisted by code, never supplied by the model.

Acceptance: verify a single-channel client, a multi-channel client, a paused/new client, and a client with missing attendance/notes. Current and historical windows must both work. Unknown/stale feeds cannot become zeros or healthy outcomes.

### D. Add the reporting agent and client-safe rendering

Create a fresh identity with a small reporting-only tool allowlist. No inherited sessions, huge skill registry or old fallback scripts. Add verified narrative and client-safe rendering through the same evidence contract. External calls pass through existing `tools.ts` helpers/health ledger; worker uses the existing backend bridge rather than bypassing it. Add `doctor`, named-key lookups and a runbook row following the ideation-radar discipline.

Acceptance: internal Q&A traces each claim to evidence; external output cannot leak internal-only notes or another client's data. Unsupported model numbers/claims fail validation. A generated document URL is only returned after creation and authorized read-back succeed. No placeholder or guessed URL.

### E. Pilot on demand; add approved reporting schedules last

Use a small live-client pilot and review internal and client drafts. Only after acceptance enable optional weekly internal summaries and monthly client report drafts. No daily ClickUp/Hermes task generation by default. Scheduling timezone, recipients and approval rules must be explicit. Scheduled worker runs under `flock`, records success/failure and verifies actual delivery, not just a successful exit.

Acceptance: scheduled replay does not duplicate the same report/delivery; failed/stale collection produces a clear status; client delivery requires approval. Deploy changed cockpit surfaces with `scripts/ship.sh <app>`, verify in production and record the session in mahara-context.

## 9. Decision requested

Approve or revise the reporting-first design and the defaults: on-demand first, one shared evidence backend, internal/client-safe projections, human-approved external delivery, and no daily task generation. Then turn this proposal into a reviewed implementation specification/plan before building the replacement.
