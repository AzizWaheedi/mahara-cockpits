# Webinar registration boundary

Standalone Node/Vercel API. The CEO cockpit and reporting collector are separate deployments. Current implementation status: [27 September checkpoint](../../docs/WEBINAR-TRACKING-IMPLEMENTATION-2026-09-27.md). Public cutover is held by [release gates](RELEASE-GATES.md).

## Inbound contracts

- `POST /api/register`: same-origin JSON with `request_id` (stable UUIDv4 for retries), `first_name`, optional `last_name`, `email`, full international `phone` (eight-digit Kuwait accepted), optional allowlisted `attribution`. Returns `{ok:true,status:"processing"}` with HTTP 202 after durable storage, never a fabricated booking confirmation.
- `POST /api/ghl-registration`: server-side bearer authorization. Body: `receipt_id` (real immutable form submission ID, not contact ID or month tag), `event_key`, integer `revision`, `location_id`, `contact_id`, `submitted_at` with timezone. Uses the same receipt/registration contract. The worker verifies the contact under the saved location before binding it.
- `POST /api/survey`: Typeform raw body and `Typeform-Signature`; allowlisted form `P1xP4r24`. Missing/bad signature never writes. Valid unmatched answers are durably retained with a match reason. Declare `webinar_ref` on the form before relying on it. It must be an issued purpose-scoped reference, not a contact ID.

The public request ID identifies a retry, not an authenticated person. Never expose contact IDs, private join URLs, service keys or raw provider errors in responses. Tokens in personalized links must be opaque; only their SHA-256 hash is stored. Forwarding a link is possible and does not establish identity.

## Secrets and holds

Names only; values belong in existing Vercel/VPS private secret storage:

| Variable | Purpose |
| --- | --- |
| `WEBINAR_SUPABASE_URL`, `WEBINAR_SUPABASE_SERVICE_KEY` | Server-only Creative Triage store |
| `WEBINAR_PUBLIC_ORIGIN` | Exact origin of the standalone form |
| `WEBINAR_GHL_HANDOFF_SECRET` | Native workflow server handoff |
| `TYPEFORM_SECRET` | Required webhook HMAC secret |
| `GHL_TOKEN` | Scoped HighLevel integration |
| `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` | Existing server-to-server Zoom application |
| `WEBINAR_INTAKE_ENABLED` | Defaults off |
| `WEBINAR_DISPATCH_ENABLED` | Defaults off |
| `WEBINAR_ALLOW_CONTACT_CREATION`, `WEBINAR_ALLOW_ZOOM_REGISTRATION`, `WEBINAR_ALLOW_TRAINING_BOOKING` | Independent mutation switches, each defaults off |

The database also requires the exact event/config hash, current future revision and `registration_open=true`. Merely setting a date does not open the form. Runtime permissions cannot edit a published provider scope or replace a link identity. No cron or message is installed by these source files.

`node scripts/work.mjs` processes at most one leased job. Run only under the existing process lock after scoped provider acceptance. It logs state/code only. A timeout after mutation intent is not retried automatically. An operator must inspect the exact provider resource and record reconciliation before clearing the hold; do not reset an uncertain job to ready. The operator reconciliation command is not implemented yet.

Zoom meeting identity is strict: scheduled single-instance meeting, same start, automatic registration approval, no provider confirmation email. The existing recurring/event configuration must be checked rather than assumed compatible. The HighLevel read adapters require complete responses/counts; a changed API shape is an error, not an empty result.

## Tests

From here: `node --test test/*.test.mjs`.

From `apps/media-buyer-cockpit`: `bun test scripts/webinar-intake.test.ts scripts/webinar-collection-health.test.ts scripts/webinar-ingestion.test.ts`.

The normal cockpit ship helper includes these checks but does not deploy this API. Never interpret a passing synthetic suite as the live registration/join/rejoin acceptance.

## GHL pipeline projection

[Pipeline runbook](../../docs/WEBINAR-GHL-PIPELINE-2026-09-27.md) covers the live new board, draft-only installer, occurrence-scoped projection, native form ingestion, provider failure recovery and remaining release gates. New server variables are `WEBINAR_PIPELINE_SIGNAL_SECRET` (private inbound hint), `WEBINAR_PIPELINE_SYNC_ENABLED` (off by default), and the existing store/GHL credentials. The database mapping is also disabled. No automatic sales booking attribution or messaging is implied by installing this schema.
