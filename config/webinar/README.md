# Tell the LLM the date; update one source

Aziz, 26 September: the date is normally changed by asking an LLM or editing the
repository. `current.json` is the desired schedule. Vercel environment variables,
page copy and month tags are not independent schedule editors.

**Current state: draft.** No next date was provided. This configuration has not
changed the live website, API, Zoom or GHL. The source recovery and generated
files do not mean those projects have been released. Registration occurrence
integration and the remaining API release gates must be completed first.

## Routine change for an LLM

Read current.json and the latest shared webinar checkpoint first. Distinguish
rescheduling the same training from starting a new training. Ask only if Aziz's
request does not make that distinction or the date/time clear.

For the **same training**, use its current revision. Example only:

```bash
node scripts/webinar-schedule.mjs set \
  --at '2099-10-01T20:00:00+03:00' --expected-revision 1
```

The example is intentionally far in the future and must never be published.
The command preserves event_key, increments revision, saves the prior immutable
revision, generates Arabic/English date and time labels, the calendar event,
countdown config and the API's bundled settings. Whole-hour Arabic reads
`٨ مساءً`, not `8:00 PM`. Dates use the Gregorian calendar and Arabic digits.

For a **new training**, use `new` with a never-used `--key`, the new `--at` and
the current `--expected-revision`. Two trainings in one month have distinct keys.
The generated legacy month label is compatibility only, not an identity.

Direct repository edits are allowed: increment revision for the same event,
keep event_key, then run `generate`. Never edit or delete history. A reused
revision with different content fails. Secrets never go in this directory.

```bash
node scripts/webinar-schedule.mjs generate
node scripts/webinar-schedule.mjs check
node --test scripts/webinar-schedule.test.mjs
```

## Apply and verify the matching occurrence

Generating files does **not** call providers. The implementing LLM must:

1. Write the same stable event and schedule revision through the Supabase event
   ledger. Freeze target values on event creation. A reschedule keeps registration
   identity and must reconcile already-booked GHL appointments/reminder waits;
   changing a global custom value does not reschedule those appointments.
2. Update the exact configured Zoom meeting and matching GHL occurrence through
   their authenticated connections, with a receipt and read-back. Keep unbound
   or ambiguous records for review. Do not enroll contacts or activate workflows
   merely to test the date. Existing public native GHL form registration still
   needs this binding; the recovered standalone API is a separate entrypoint.
3. Capture fresh provider evidence in an untracked file such as
   `/private/tmp/webinar-schedule-evidence.json`. Include no credentials or lead
   records. Shape below; replace every placeholder with actual read-back.
4. Run `release-check`, then deploy both public projects from GitHub main using
   their normal release process. Old conflicting Vercel schedule settings must
   be removed or reconciled; the API reports a conflict and refuses registration.
5. Run `probe` and `audit` after both deployments. A partial deployment or stale
   asset must not be reported as success. Record the exact source/deployment
   receipts in the shared context. Keep traffic/reminders held if checks fail.

```json
{
  "zoom": {
    "captured_at": "ACTUAL_READ_TIME",
    "starts_at": "ACTUAL_START_WITH_OFFSET",
    "timezone": "Asia/Kuwait",
    "duration_minutes": 90,
    "meeting_id": "ACTUAL_MEETING_ID"
  },
  "ghl": {
    "captured_at": "ACTUAL_READ_TIME",
    "starts_at": "ACTUAL_START_WITH_OFFSET",
    "timezone": "Asia/Kuwait",
    "duration_minutes": 90,
    "location_id": "ACTUAL_LOCATION_ID",
    "calendar_id": "ACTUAL_CALENDAR_ID",
    "event_key": "ACTUAL_BOUND_EVENT_KEY",
    "revision": 1
  }
}
```

Evidence expires after 15 minutes. Do not copy desired values into the evidence
and call them verified. Missing GHL occurrence binding is a blocker, not a reason
to omit that check. Meeting end/session attendance remain provider facts, not
derived from the planned start/duration.

```bash
node scripts/webinar-schedule.mjs release-check --evidence /private/tmp/webinar-schedule-evidence.json
WEBINAR_SCHEDULE_EVIDENCE=/private/tmp/webinar-schedule-evidence.json scripts/vercel-deploy-composio.sh sites/webinar
# Registration API has separate gates; do not deploy until RELEASE-GATES.md passes.
node scripts/webinar-schedule.mjs probe --evidence /private/tmp/webinar-schedule-evidence.json
node scripts/webinar-schedule.mjs audit --evidence /private/tmp/webinar-schedule-evidence.json
```

`probe` reads the fixed public page/API endpoints, checks both rendered pages
and their calendar content, and appends sanitized results. `audit` checks all
four sources, exact provider/event identity, revision, duration and timezone.
The known old live deployment cannot pass until the cutover is completed.

The cockpit's reporting release is independent. Its ship script checks config
generation and regressions but does not require a future public training date.
