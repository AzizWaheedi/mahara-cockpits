# Client proposals

## Design plan

The audience is an account manager preparing a proposal with an existing client. The job is to adjust the offer, review the exact client page and copy a verified link.

Use the existing cockpit shell, Geist, IBM Plex Sans Arabic, Deep Space #091333, Panel #0e1a42, Ink #f2f6fa and Mahara Teal #00cfc8. Keep editing controls quiet and use one primary action. The builder has a compact status header, a narrow editing column and a large page preview. On a phone, the preview follows the form. The signature is the client's video above a proposal written for their company, followed by dated evidence and a clear bill.

The public page uses the same navy and teal palette. It is a single document with generous spacing, not a dashboard. The video loads only when selected. Arabic mirrors the page. Motion is limited to short opacity transitions and respects reduced motion.

New files are limited to contract 3.6: the proposal folder, ProposalPage, public site files, proposal harness and tests. Shared edits are the named route, client page, Money and Vite insertions. No existing files are removed. ART and STRINGS have separate owners.

## Data and save behavior

All changes use the signed-in Supabase client and the existing gated proposal RPCs. The preview reads the server's PublicProposal and passes it through an explicit allowlist. It never receives a complete internal row. Saves use a 600 ms queue, one request at a time. Tick changes flush immediately. Conflicts keep pending changes visible and require a reload before another write.

Copy link waits for queued saves, requires the current warning acknowledgements and uses the server's send checks. Editing a sent proposal does not update the public link until Update link succeeds. Preview links use the server's expiring token and do not count as client activity.

## Not in scope

Sales AI drafting, payment collection, sending WhatsApp messages, new offer decks beyond Website and approval of Arabic copy or media licences.

## How we know it works

Verification on the VPS, 27 October 2026:

- 113 database tests passed across seven SQL suites, including repeat migration application, schema parity, permissions, frozen sent proposals, expiry and capture limits.
- 157 API/public-page tests passed across nine files, including dedicated salt isolation and closed DNS failure paths.
- 23 proposal browser checks passed: English/Arabic, 390/1280 px public pages, five page states, desktop/phone preview viewports, save failure/retry, item selection and language change. No page overflow or browser errors.
- Focused proposal tests cover ordered saves, conflicts, warning acknowledgement, image-signing failures and capture refresh after pending saves. The exact packaged preview matches public page assets through byte-parity checks.

The fixture correction and full app typecheck/production build passed. Post-main integration verification remains pending. No production deployment or client delivery is claimed. Public upload excludes development fixtures, server stubs and tests through `.vercelignore`. Arabic approval and video delivery gates remain separate.
