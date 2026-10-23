# Client appointment feedback, 23 October 2026

## Approved outcome
Client reports are saved in Supabase and appear for the exact client and appointment in CSM Results, Media Buyer Ads and Creative Director client detail. A report is visible while provider delivery retries. Sheets are a temporary compatibility projection, not the feedback authority.

## Implementation
1. Add a bounded, seat-checked feedback read RPC over the existing outcome history. Reconstruct sparse fields without replacing portal edits with later imported captures. Match location, appointment and accepted command revision. Resolve ClickUp IDs exactly, never by client names.
2. Add one shared feedback panel with ratings and all client comment fields, report time, delivery state, pagination and visible-tab refresh. Preserve internal call-centre notes and omit no-show ratings.
3. Capture new portal reports before any Sheets or CRM dependency. Preserve durable request identifiers and recovery for existing commands.
4. Replace only the post-booking dependency after parity and duplicate prevention are proven. Keep reminders and callback routes intact. Historical uncertain writes are not replayed.
5. Test database isolation, idempotency, sparse revisions, changed client selection, outages and mobile layouts. Release exact tested source and verify hosted reads.

## Design
Reuse Geist, existing rounded cards, neutral borders and Mahara teal accents. Put the client's words next to the appointment date and result. Show separate blocks for general feedback, consultation and why the project did not close. No raw selects or new navigation. Empty and failed reads are distinct.

## Not in scope
Billing, ad account changes, internal call notes, historical message replay, unrelated Make routes, provider-owned CRM identity or a new database project.

## How we know it works
A fictional transaction proves exact-tenant and exact-appointment reads, sparse edits, pending delivery visibility, no-show score suppression, anonymous denial and duplicate handling. The three frontend builds and targeted regression tests pass. Production readback confirms existing feedback is visible with no legacy report-Sheet link in the replacement panel. Cutover requires original follow-up behaviour plus proof that mirrors cannot emit duplicate alerts.
