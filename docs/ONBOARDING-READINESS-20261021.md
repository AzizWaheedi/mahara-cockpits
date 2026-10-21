# Onboarding readiness check, 21 October 2026

## What is ready

All seven clients currently in onboarding have their exact ClickUp task in the
onboarding store, CSM client list, creative client list, media client links and
editor records.
Their portal directory and access records agree on the exact task and location.
All seven have enabled Google calendar enrollment and managed CRM connections
recorded in the portal. None has an unfinished portal access-provisioning job.
These are configuration checks, not provider consent or a test booking.

The native onboarding job completed at 13:44 UTC with 70 cards, seven onboarding
clients, zero unreadable cards and zero skipped identities. A row's `synced_at`
changes only when its data changes; use the completed run receipt for freshness.

The live CSM opened Smmim studio's own onboarding deck (seven slides) and launch
deck (12 visible slides, optional form slide absent). The welcome video loaded
its Wistia player; English and Arabic onboarding covers showed the same client.

## What still prevents an all-ready claim

- The seven onboarding clients have no completed launch creative uploads. The
  deck's Meta read also returns zero ads and funnels for those exact clients.
  Smmim's live ads slide shows the unfinished-ads message. CSM and Creative must
  attach reviewed client assets in the existing preparation tray; do not borrow
  another client's ad or mark an empty slide complete.
- None of the seven has a Google connection record in the portal. Enrollment
  makes connection available; the client must still authorize Google and choose
  the intended calendar. Existing native synchronization must be checked first.
- Some onboarding/kickoff/Blueprint forms are unfinished. The seven names are
  Alalia.co, Ghazzawi.sa, Makers, Qatar Technology, Render, Smmim studio and
  شركة مصنع المعادن الهندسية للصناعة. The existing source cards remain authoritative.
- The shared source feed stalled after 12:25 UTC, then its existing schedule
  recovered and published at 13:56 UTC. The CEO client list refreshed at 13:57.
  Earlier receipts include a Meta 403, a Google Sheets 403, an uncertain
  publication 500 and an expired run. This recovery does not clear every
  historical resource error. Preserve the last good data and reconcile exact
  receipts; do not remove the full-publication guard or replay uncertain writes.
- CEO delivery failed when two ad accounts mapped to the same ClickUp client.
  A concurrent worker repair restored it at 15:31 UTC. PR 62 preserves that
  grouping and adds guards for repeated joins, invalid counts and conflicting
  account ownership, plus complete worker packaging. Aziz approved merge and
  deployment. Verify the final release separately from this earlier recovery.
- The broader intake audit still holds one incomplete Make execution and a
  WhatsApp resolver that returned `manual_required`. A green Make execution is
  not proof of calendar completion, QR retrieval or client group membership.

## Verification

- CSM deck/presentation suite: 261 tests, 2,505 assertions passed.
- Onboarding database/sync/deck storage suite: 77 tests, 1,129 assertions passed.
- Delivery fix: nine tests, 24 assertions passed. The integration fixture runs
  the database-result parser, delivery adapter and metric extractor together.
- Worker package: 11 tests passed. The check also found four imported Guardian
  modules missing from the package list; this branch includes them.
- Current triage SQL tests: six tests, 40 assertions passed after merging main's
  concurrent multi-account source change. These are separate from the live
  worker's source mapping rules, which the narrow PR 62 deployment preserves.
- Portal production origin checks: 17/17 passed. The exact portal source
  `42a7a026e47c5d11f0f3103e7cc9fbd850cdead5` passed tests, type checks and build in
  [GitHub CI](https://github.com/AzizWaheedi/mahara-client-portal/actions/runs/39605653115).
  Local portal dependency installation ran out of disk space, so no local full
  portal-suite result is claimed.

No new intake, client invitation, message, booking, permission grant or ad
activation was performed in these checks. The initial audit did not replace a
worker. The approved release must retain the current collector and mapping fixes;
record the activated release and fresh database receipt in shared context.
The shared operating checklist remains in the mahara-context repository's
`systems/Mahara OS V2/Make Scenarios/Processes/Client Onboarding Flow.md`.
