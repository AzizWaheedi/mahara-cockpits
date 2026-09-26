# Recovered registration API: release gates

Recovered from the currently deployed Vercel source on 26 September. The nine
files listed in RECOVERY.json were byte-identical at recovery commit `7c735cd`,
verified against Vercel's source-file hashes. Later changes are reviewed Git
diffs from that baseline. No credentials or environment files were recovered.
This recovery itself does not deploy or connect Git to Vercel.

This application is NOT part of `scripts/ship.sh media-buyer`. Do not deploy it
just because the dashboard release is ready.

Before replacing the current API:

1. Use a stable event UUID and schedule revisions from the new occurrence ledger.
   The authoritative schedule is now `config/webinar/current.json`, per Aziz.
   Propagate that same version to
   the public page/calendar, registration handler, Zoom and reminder enrollment.
   A reschedule retains the event; a new training gets a new event. Month tags
   alone cannot distinguish them.
2. Add durable request receipts and a recoverable outbox before GHL side effects.
   Preserve exact event/contact/appointment identities. On an uncertain booking
   response, reconcile before retrying. A failed duplicate lookup must fail
   closed, not create another appointment. Store the full datetime in GHL.
3. Record each occurrence via `cockpit_record_webinar_registration`, then thread
   its id through the thank-you survey, unique Zoom registration/join link,
   reminders, booking links, and actual payment/refund receipts. Invalid or
   ambiguous identities need a visible review queue.
4. Require Typeform signatures, cap raw request size, validate the exact form
   id, deduplicate response ids, and keep raw provider errors out of browser
   responses. The recovered source's optional signature gate is not sufficient.
5. Wire CEO cohort reporting to occurrence records and exact session bindings.
   Preserve unbound historical records as unknown instead of deriving old
   registrations from mutable contact tags.
6. Run the isolated test recipient through registration, join/rejoin, survey,
   pitch booking and source-count reconciliation; do not activate client
   workflows or overwrite the public date as part of an unscoped smoke test.

The generated source now starts in draft and refuses registrations until the
schedule is ready. Old conflicting environment settings also fail closed. The
deployed API still has its historical defaults until a separately verified
cutover. The next date is undecided. Follow `config/webinar/README.md`; do not
infer approval to roll out from the existence of this copy.
