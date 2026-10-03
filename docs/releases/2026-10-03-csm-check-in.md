# CSM client check-in booking and Client ID

Status: implemented and locally tested, awaiting visual verification and release. No real appointment, invitation or production deployment was made during this work.

## Client journey

Open Clients, open a client, then use the new controls above the existing client details:

- Copy ID copies the ClickUp task ID from the Clients board and confirms that it was copied.
- Book next check-in finds the contact whose Mahara Media Client ID field exactly matches that task ID. It shows the matched name and available times in Kuwait time.
- Confirm booking rechecks identity and availability, books through the existing check-in calendar, and shows a confirmed provider receipt. The calendar's normal confirmations and reminders apply.
- The next upcoming call appears on the client. The existing outbox forwards the next point-of-contact date to ClickUp. An earlier upcoming call takes precedence.

No renewal date or manual CRM contact search is required. Missing, duplicated or mismatched contact IDs stop booking with a clear explanation.

## Provider contract

Live read-only verification on 3 October 2026 confirmed:

| Item | Exact identity |
| --- | --- |
| Mahara client account | `wwG426bwruWWv9W3fazQ` |
| Client ID custom field | `Csj6vsVH3wSRseT3OkMU`, `contact.client_id` |
| Check-in calendar | `SHjlq0UjeR11maltYNyh`, `Maharamedia - Sucess Check In Call` |
| Calendar configuration | Active, 30 minutes, round robin |

An existing client ID returned exactly one matching contact in the correct account through the custom-field search. The free-slots endpoint was exercised and returned no slots for the sampled day; actual bookable production availability and appointment creation remain unverified.

Uses the existing server-side `GHL_MAHARA_PIT` and `GHL_MAHARA_LOCATION` configuration. No credentials enter the browser. Calendar location, contact location, Client ID and receipt identity are checked. The request never overrides availability or calendar date rules. GoHighLevel owns round-robin staff assignment.

Official API references: [contact search](https://marketplace.gohighlevel.com/docs/ghl/contacts/search-contacts-advanced/index.html), [free slots](https://marketplace.gohighlevel.com/docs/ghl/calendars/get-slots/), [appointment creation](https://marketplace.gohighlevel.com/docs/ghl/calendars/create-appointment/).

## Persistence and recovery

GoHighLevel remains the appointment source of truth. This scoped feature reuses the deployed CSM Convex authentication, client roster and ClickUp outbox. It adds `checkInBookings` and its `by_key` index for durable duplicate prevention. This is a bounded extension to the existing CSM backend, not the broader planned Supabase cutover or another source of client identity. Carry these receipts into that cutover.

Booking claims are atomic and keyed by task ID plus canonical UTC start time. A confirmed repeated request returns the stored receipt even after its slot disappears from availability. A definitive provider refusal permits a new checked attempt. A timeout, interrupted action or incomplete receipt blocks another write for that client and time.

For a `pending` or `unknown` record, an operator must inspect the exact contact, calendar and start time in GoHighLevel before any retry. If the appointment exists, reconcile its verified ID through the internal `checkIns.finish` mutation, including the calendar name. If it is verified absent, mark the attempt definitively failed through the internal `checkIns.markUncertain` mutation. Never expire or replay uncertain attempts automatically. These are internal functions, not public client controls. A confirmed result and cockpit updates commit atomically; outbox delivery remains asynchronous.

## Verification

- 13 booking tests pass: exact identity, duplicate/missing/wrong-account contacts, authentication, client scope, revoked access, stale times, concurrent clicks, provider receipts, uncertain results, retries and next-call ordering.
- 20 existing projection tests pass.
- 12 CSM render tests pass, including the real client profile and Copy ID interaction. Updated stale action mocks and DOM globals required by current main.
- Backend TypeScript, frontend production build and PHI authentication scanner pass. Changed-file lint passes with pre-existing unused suppression warnings in the render test.
- Browser preview attempts were blocked by automatic approval timeouts, so desktop/mobile visual acceptance is still pending.

Local fictional preview: from `apps/client-success-cockpit`, run `bun run dev --host 127.0.0.1 --port 4178`, then open `/client-success/scripts/check-in-preview.html`. This uses the actual UI component with fictional provider functions. It is not a production route or build entry and sends no invitations.

## Release and rollback

1. Complete desktop/mobile checks in the fictional preview: copy ID, open booking, change date, select a time, confirm, view the next call and reopen.
2. Review and merge the exact source after release authorization. Keep the existing backend environment values and verify they point at the client account above.
3. Use `scripts/ship.sh client-success` from clean GitHub main. It now includes the booking test gate. The script deploys the additive backend before the frontend and runs the existing smoke check.
4. Verify the authenticated deployed client journey read-only, existing reliability monitor and outbox health. Any appointment acceptance test needs an explicitly selected staff/test contact and agreed time because normal calendar notifications apply.
5. Roll back the frontend to the previous verified release if needed. Retain booking receipts and appointment records; do not delete or replay them. Keep the additive backend schema while receipts exist.
