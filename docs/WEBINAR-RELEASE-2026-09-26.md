# Webinar internal release acceptance, 26 September 2026

This supersedes the application, collector and login/backup blockers in the earlier hardening notes. Public webinar registration and a real-event journey are not released or accepted by this checkpoint.

## Production cockpit and targets

- PR21 merged as `af01995486ba19ac2b599368c692ec3c0043c76d`. Production Convex `adorable-seahorse-418` deployed through the existing ship procedure. TypeScript/Vite/PWA build and read-only smoke passed.
- Correct frontend deployment: `dpl_AGHNCTDLghXgTFUEbyM2McWyDy48`, project `mahara-media-buyer` (`prj_nGp3RuoIVqlZOrpfGMdEsx2nvUZb`), aliased to `https://cockpit.maharamedia.com`. The prior live source `db2926a` was verified as an ancestor before deployment. Direct public HTTP and the authenticated browser both serve the new target editor.
- The initial local Vercel link pointed to the similarly named `media-buyer-cockpit`, which does not own the custom domain. That upload did not update the public cockpit. Corrected the ignored link after reading actual alias ownership. The duplicate project has since received newer concurrent releases; do not roll it back. `config/vercel-projects.json` plus `check-vercel-project.py` now guard the canonical project/team identity before the shared ship gate.
- At 10:02:29 UTC the real CEO account saved the existing defaults unchanged. Supabase holds exactly one immutable `defaults` revision, with the server-derived CEO email, valid values and request receipt. A full browser reload, reopening the editor and expanding history showed revision 1 and the same values. No campaign budget or workflow changed.
- Live anonymous target get returned an error and no data. Role-gate tests cover missing identity and a non-founder admin; a separately signed-in non-CEO browser test is not claimed.

## VPS collector

- Installed only `hermes/webinar-pull/{pull.py,test_pull.py,README.md}` at 10:07:48 UTC under the existing process lock. The old worker matched known Git source `6d5dba9`; the new files match `af01995`. Unrelated dirty server work was preserved.
- Backup: `~/.webinar-backup-20260926T100748Z/`, including old files and cron. Cron SHA256 before/after: `fb2018bf003cce62c4c433d92bfa9abf940e6bf376f55aa5c857b0dc4152b5fb`. Hourly minute-23 scheduling is unchanged. New worker SHA256: `8c20c2ee19b7315990a3a87462838a32d3a3a12ee0357f5b7a8c576c2339c9db`.
- All 47 collector tests passed on the VPS. Doctor, `zoom --again` and `survey --full-backfill` each exited 0. Private logs: `~/.webinar-verification-20260926T100910Z/`. Transcript-provider approval remained absent, so no lead transcripts were sent to DeepSeek.
- Independent Supabase readback: Zoom completed at 10:09:25 UTC, zero discovered sessions; survey at 10:09:28, `complete=true`, full backfill, source total 0 and received 0. Stored sessions/attendance/engagement/forms are all 0. This proves the empty-source replay path, not real-event retention.
- Fresh provider settings: the public page/Zoom still use 17 September, the API uses 24 September, the API lacks its HighLevel credential, six WEBBY workflows remain draft, Zoom registration remains off, cloud recording is on and the join link reaches Zoom. Collection health must not be presented as launch readiness.

## Recovery and remaining acceptance

Signed-in Supabase confirms eight completed daily backups, latest 26 September 00:20:01 UTC. PITR is off. No restore or paid resource was started. See [the recovery record](WEBINAR-RECOVERY-2026-09-26.md): the source has 12 active jobs, so a one-click binary clone is not an inert test.

Still required: registration API and native-form occurrence wiring; durable outbox/provider receipts; strict webhook verification; occurrence-based cohorts; exact survey/attendance/booking/payment attribution; a real joined/rejoined test event and source reconciliation; and an isolated restore drill. The repo-owned next schedule remains draft with no invented date. Public registration, Zoom settings, campaigns and reminder workflows were not changed, and no messages were sent.

Validation carried into this release: 67 TS/PostgreSQL tests (211 assertions), 47 Python tests, 11 canonical-schedule tests, full app build and shared checks. The follow-up project-identity guard adds three targeted tests. Existing synthetic mobile checks are not physical-device acceptance.
