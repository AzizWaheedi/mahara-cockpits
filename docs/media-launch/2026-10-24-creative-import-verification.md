# Client launch follow-up, 24 October 2026

Buyers can import up to six approved Drive file links from New from the brief. The native worker uploads to the explicitly linked account, with progress, saved jobs and durable provider receipts. Its existing two-minute VPS schedule and exact worker source were checked. Imports also appear in the client activity history. Library refresh preserves the draft. Late copy/city responses cannot overwrite a changed draft.

Task matching now uses a unique exact client across the full registry and only current, complete supporting sources. Ambiguous tasks remain in the unrestricted team inbox; they do not appear under an arbitrary client or leak to a restricted seat.

Not in scope: executing a client campaign, provider writes during tests, changing campaign budgets, changing other cockpits, or replaying legacy failed jobs.

How we know it works: 32 focused DB/model/screen tests and 150 API/native-worker tests pass. The actual native worker is exercised against PostgreSQL and fake Google/Meta transports, including duplicate requests and account revocation before a provider write. Browser checks cover file import, Page/form/country/city choices, creative selection, copy suggestions, preview, and invalidation after editing. No production campaign or import was used as a test.

Deployment order: apply 20261024131543_launch_creative_imports.sql, deploy cockpit-media-api with JWT on, then ship media-buyer through the full release guard. LAUNCH_APPLY remains on as approved. The native worker code and scheduler are unchanged. A pre-existing copy-draft job from 14 October remains in reconciliation; it does not block uploads and was not replayed.

The database migration preserves the existing native guard as cockpit_media_native_guard_before_launch_import. Each launch import rechecks requesting membership, current client/account links, competing mappings, kept-out accounts and account blocks on every worker guard. Existing non-launch jobs keep the old guard behavior. The enqueue RPC is service-only; user reads check client scope. Repeated identical file sets reuse their existing job, including uncertain outcomes, rather than silently retrying uploads.
