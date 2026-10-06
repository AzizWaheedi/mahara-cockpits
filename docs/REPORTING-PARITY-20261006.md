# Client reporting parity — 6 October 2026

Shades' GHL account was hidden because account discovery accepted only legacy `pit-` credentials. Commit `7d89295` adds exact-task matching for managed OAuth credentials and keeps a known location visible while credentials renew. The live refreshed CSM profile has its subaccount URL; missing-GHL warning cleared. Its Meta account remains genuinely unmapped in current source records and requires the correct account identity/access.

Client reporting uses two real worksheet layouts. Hidden Appointments has Ad O/Source P; month tabs have feedback O/P and Ad Q/Source R. The portal writes to month tabs. Fixed A:P parsing and legacy-tab precedence could therefore hide fresh reporting or attribute feedback as an ad. Creative's separate A3:L400 read also skipped row 2 and later records.

The shared parser discovers bounded actual tabs, validates headers, includes all rows within those bounds, and prefers the month tab for that month. It supports shifted templates without quotation, uses appointment dates if Date Added is absent, and preserves original read time through cache. Failed reads retain last-good data only for the exact task and sheet, with a visible failure signal.

CEO reporting joins outcome history on both location and appointment IDs. It reconstructs sparse attendance/deal revisions independently, and counts a portal revision only after its exact outbox command succeeds. Pending commands and another client's colliding appointment ID cannot change the report.

41 focused tests and both backend TypeScript checks pass. Full app builds and lint also pass (existing warnings remain). Ship creative first, then media-buyer, with the normal function-removal guard. Existing schedules remain unchanged. Live acceptance and deployment receipts are recorded in the shared session handoff.

Scope: campaign cards retain their CRM attribution logic; CSM/creative/CEO Delivery do not gain new project-value or feedback display fields. CEO explicit CRM attendance remains authoritative. A quotation-only row is not proof that attendance was completed. Call-center reporting has a separate provider/RPC source and must be audited independently.
