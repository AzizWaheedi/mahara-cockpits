# Gate 1: core data reconciliation

8 October 2026, about 11:30 UTC. Claude Code session, read-only except where noted.
Source of truth for history: frozen Convex exports (`frozen-final-source/*.zip`, frozen 7 Oct 22:47 UTC).
Target: Creative Triage `bldgtotkfmhoxmlzowdx`. Method: record-by-record match on the original Convex `_id`, or on the business key where Supabase stores one.

## Result per dataset

| Dataset | Status | Evidence |
| --- | --- | --- |
| Checklists | Verified | The 21 "missing" keys from `final-checklist-native-matches.json` now exist for 2026-10-08 (10 CSM, 11 media buyer). None were ticked in Convex, so no human state was lost. |
| Manual payments | Verified | 3 of 3 match by identity, date, amount and currency (23 Sep 1,333 USD; 6 Oct 2,300 and 5,608.8 USD). |
| Billing snapshots, aliases | Verified (count and key) | 67 billing rows, 52 client and 66 link aliases present. Supabase keys these by business key, not Convex `_id`. |
| Decisions, call briefs, churn, report docs, outbox, tracking issues, campaign chat, manual changes, client prefs, feedback, market plays, Meta tree | Verified | Every frozen `_id` is present. |
| Appointments (bookingEvents) | Verified with one exclusion | Convex holds 75,966 rows but only 220 unique bookings (a Convex sync bug re-inserted rows). 209 are in Supabase, 4 of them under the spelling "Acturus". The other 11 are one phantom SAFAD row (lead date 2026-01-15) that Convex re-created for each day from 28 Sep to 8 Oct. Excluded on purpose. |
| Daily ad performance | **Needs repair (fix committed, not deployed)** | All 836 frozen ad-days are present. 29 Ardon rows from 27 Sep to 7 Oct hold exactly double Convex's spend, leads, impressions and clicks. 2 Liwan rows differ by under 5 percent (normal Meta late adjustment). |
| EOD reports | **Needs repair (dry run passed, not applied)** | 4 media-buyer reports (27 Sep, 30 Sep, 4 Oct, 6 Oct) were written to Convex after the 23 Sep EOD import and never reached Supabase. |
| Client comment digests | Open (small) | 3 AI digests of ClickUp notes from 7 Oct (Smmim Studio, Shades x2) are missing from the runtime import. The ClickUp comments themselves still exist in ClickUp. |
| Roster | Verified | 29 of 30 imported. The 8 Oct roster day is regenerated natively. |
| Staff and access, files | Not rechecked | Staff: 10 Convex members, 10 Supabase members. Files: earlier receipt (224 objects, byte match) reused. Role and file journeys belong to Gate 3. |

## Ardon double count: root cause

`hermes/cockpit-sync/calculator.ts` is a generated copy of `apps/media-buyer-cockpit/convex/sync.ts`, taken before commit `e4229c5f` (6 Oct). That commit stopped the Meta fallback from re-adding ad-days the tracker sheet already has. The sheet labels Ardon's account "718146936708597, SAR" and Meta calls it "Ardon", so the native copy treated the account as missing and added Meta's rows on top of the sheet's.

Fix: commit `19f13a7e` on `codex/supabase-completion-20261004` ports the row-level match. New test `hermes/cockpit-sync/meta-fallback-dedupe.test.ts` failed before and passes after. All 80 worker tests pass.

Repair path: deploy the worker. Each cycle rewrites the 30-day window, so the next cycle corrects the 29 rows. A direct database edit would be overwritten in 15 minutes.

Second-source check: the local Meta token returns "API access blocked", so Meta was not read directly. Convex's values are taken as correct because they come from the fixed code.

## EOD repair

Script: `D:/secure/cockpit-retirement-prep-20261007/consolidation-20261007/repair-eod-gap.py`. Insert-only, `ON CONFLICT DO NOTHING`, original document kept in `source_row`. Dry run with rollback: count went 4 to 8 inside the transaction and stayed 4 after rollback. Receipt: `eod-gap-repair-dry-run.json`. Apply with `--apply`.

## Not done in this session

Gate 3 (role, save, file journeys) and Gate 4 (deploy) were not started.
