# Data view: leads and appointments (admin only)

Status: **built 2026-10-11.** Migration applied to Creative Triage; release with `scripts/ship.sh media-buyer` and `scripts/ship.sh client-success`. Demo: [2026-10-11-data-layers-demo.html](2026-10-11-data-layers-demo.html) (sample data only).
Revision 2, 2026-10-11: Muhammed asked for a master-dashboard style page and no changes to the cockpit except one button.
Revision 3, 2026-10-11: the layout was made self-explanatory, based on published table and dashboard guidance (see "Design rules").

## Goal

- See every lead and every appointment with all their fields, like the Master Dashboard "Leads View" and "Appts View" tabs.
- Check that the data is right without SQL: where counts drop, which rows are wrong, and when each source last synced.
- Change nothing in the current cockpit screens except one button.

## Entry points (the only cockpit changes)

Muhammed, 2026-10-11: easy to reach from the media buyer and client success cockpits, admins only.
- Media buyer: "Open data view" in the Admin page header (new tab), and a "Data" item under Admin in the rail, the CEO rail and the phone bar.
- Client success: a "Data" door in the sidebar's portal group, and "See this client's data" on each client page. The link carries the ClickUp id (`/data?task=...`); the page swaps it for the GHL location through `ghl_clients.clickup_id`.
- `/data` sits under the admin `RoleRoute`, outside the cockpit shell. The server gate is admin or founder.
- Every other screen stays as it is.

## Design rules (revision 3, from research on 2026-10-11)

Muhammed found revision 2 too condensed and not self-explanatory. These rules fix that:
1. **Summary first, then filters, then details on request** (Shneiderman's mantra). The page opens with one plain sentence and the problem cards, not the grid.
2. **Every problem says why it matters and links to its rows.** Mismatches carry a likely reason, for example "Lead form stopped on Fri 9 Oct".
3. **The first column is a person, not an ID** (NN/g). IDs move to "Technical details".
4. **Few columns by default** (Pencil & Paper). "Key columns" shows 7. "All 22/25 sheet columns" is one click away.
5. **Plain values, not system codes.** "Result not recorded", not `confirmed`. "Booked on the booking page", not `booking_widget`.
6. **One verdict per row.** The "Check" column says "Looks right" or names the first problem.
7. **Column help on request.** An "i" next to each column name shows what it means, where it comes from, and what an empty cell means. Field names are no longer printed under every header.
8. **Roomy rows by default** (56 px, two lines), with a Compact option (38 px).
9. **One meaning per empty marker,** explained once: "—" means GHL has no value. Striped cells mean the field is not synced.
10. **Non-modal side panel** (NN/g). The table stays usable while the panel is open. The panel order is: verdict, story in sentences, where they came from, then technical details collapsed.

## The data view (`cockpit.maharamedia.com/data`)

- **Top bar:** back to cockpit, client, range (7, 30, 90 days), search (name, phone or campaign), Export CSV.
- **Overview:** a headline sentence ("In the last 30 days, for all clients: 587 leads came in and 98 appointments were booked. 5 things need a look."), a freshness sentence, "How to read this page", the problem cards, and one line of checks that passed.
- **Tab "Leads":** Key columns are Lead, Client, Came in, Came from, Campaign, Meeting and Check. All columns follow the Master Dashboard "Leads View" order.
- **Tab "Appointments":** Key columns are Lead, Client, Meeting time, Result, Booked, Deal (portal) and Check. All columns follow the "Appts View" order.
- **Tab "Compare with Meta and the cockpit":** the lineage strip with plain labels, the days where leads went missing, and a client-by-client table with a likely reason.
- **Filters:** named as questions, for example "Ad unknown", "Cockpit did not count" and "Result not recorded". An active filter shows a clear "Filtered to ..." line with "Show all".
- **Row click:** the side panel described in rule 10, with "Copy debug bundle" (IDs only) and "Open in GHL".
- **CSV export:** always all sheet columns, in sheet order.

## Column coverage (checked 2026-10-11 against Creative Triage `bldgtotkfmhoxmlzowdx`)

| Master Dashboard column | Database field | Status |
|---|---|---|
| Lead ID, Created, Lead Name, Phone, Date, Source | `client_leads` columns | Stored |
| Client Name / Project Name | `ghl_clients.client_name` by location | Stored |
| AD ID, ADSET ID, CAMPAIGN ID | `client_leads.ad_id`, `adset_id`, `campaign_id` | Stored |
| AD NAME, ADSET NAME, CAMPAIGN NAME | `cockpit_media_daily_stats.data` by ad id | Stored for ads with spend rows |
| FIRST_UTM source, content, medium | `client_leads.attribution_raw` (`utmSource`, `utmContent`, `utmMedium`) | Stored for about 1,500 of 1,900 recent leads |
| LAST_UTM source, content, medium; LAST_URL | none | **Not synced** (2 rows have a last-touch flag) |
| FIRST_URL | `attribution_raw.url` | Rare (9 recent rows) |
| Appointment dates, requested time, status, calendar | `appointments` plus `ghl_calendars.name` | Stored |
| Showed?, Confirmed?, Cancelled? | `appointments.status`, `attended` | Stored |
| Closed?, Project Value, Deal Status, Quotation, Client Feedback | `portal_data.appointment_outcomes` | Stored when the portal captured an outcome |
| Contact Link | Built from location ID and contact ID | Stored |
| Additional Notes, Agent, Agent Number, PRE-PAY | none | **Not synced** |

Adding the missing fields is a sync change. It is out of scope for v1. The page shows those columns as "not synced", so the gap stays visible.

## Build

Work in a fresh worktree from `origin/main`. Local `main` is 581 commits behind and holds other sessions' uncommitted edits.

### 1. Database (one migration, no new tables)

`supabase/migrations/20261011b_cockpit_data_view.sql` (applied 2026-10-11):
- `cockpit_data_view_summary(p_location text, p_days int)`: freshness, both lineage pipes, checks with counts, per-client table, quick-filter counts.
- `cockpit_data_view_rows(p_kind text, p_location text, p_days int, p_filter text, p_search text, p_before timestamptz, p_limit int)`: one page of rows with every mapped column. Keyset paging.
- `cockpit_data_view_record(p_contact_id text)`: the trail and raw JSON. It writes one `cockpit_audit_log` row.
- `cockpit_data_view_export(...)`: the same as rows, up to 5,000 rows. It writes one audit row with the filter and the row count.
- Every function: the existing admin or founder gate (`cockpit_get_my_access()`), `SET search_path = ''`, `SET statement_timeout = '4s'`, days clamped to 1-92. `REVOKE` from `public` and `anon`. `GRANT EXECUTE` to `authenticated`.
- One new index: `appointments (ghl_contact_id)`.
- Rules:
  - Join clients by GHL location through `ghl_clients`, never by `client_id` or name.
  - Days use Riyadh time.
  - A source with no ledger returns `null`, and the page shows "Not available".
  - Convex-era booking events have no contact ID. Before the first native day (8 Sep) they match by client and day, labeled "matched by day".
  - Each appointment gets one cockpit state: counted, twice, by_day, missing, missing_old, other_booking, not_tracked or not_ad. "Twice" means a native event has a Convex-era copy (same campaign, day and start date).
  - Meta numbers compare only up to the last day with Meta stats, and only for clients with a Meta campaign tied to them. Unmapped campaigns are reported, never dropped.
  - Internal helpers (`cockpit_data_view_leads`, `_appointments`, `_args`, `_from`, `_campaign_locations`, `_actor`) are revoked from every client role.

### 2. Page

- `src/pages/data/DataViewPage.tsx`: its own full-width layout, no cockpit shell.
- `src/lib/dataViewClient.ts`: RPC calls and types.
- `src/components/data/SheetGrid.tsx`, `LineageStrip.tsx`, `RecordDrawer.tsx`.
- The page reuses the cockpit tokens and the CEO kit (`StatusChip`, `EmptyState`, `Na`, `format.ts`). No new palette.
- The grid renders 150 rows at a time and loads more on request.

## Verification (done 2026-10-11)

- Migration and every function tested in a rolled-back transaction as an admin, then applied. Non-admin, anonymous and direct internal calls all get `42501`.
- `scripts/dev/verify-data-view.sql`: leads, appointments and native-counted bookings match direct counts for all clients and Ocean Home, 7 and 30 days.
- Meta leads reconcile: 792 in 30 days = 730 tied to a client + 62 from the unmapped campaign `Ardon_mahar-22\9`.
- Speed: summary 100 to 260 ms, one page of rows about 110 ms, a 4,464-row export about 265 ms.
- Unit tests: `apps/media-buyer-cockpit/scripts/data-view.test.ts` (columns, CSV escaping and formula guard, verdicts, story, debug bundle).
- Layout checked in a local harness with made-up rows: dark and light, desktop and 375 px, no horizontal scroll.

## Findings the page now shows (30 days to 11 Oct)

- 57 bookings from 8 to 27 Sep are counted twice in the media buyer's booked calls: the Convex import and the native sync both stored them, and `cockpit_media_statistics` adds both. Fixing the count is a separate change.
- 36 Facebook-lead bookings are not in the cockpit's booking events. Castello Industries, Liwan and Marble and more have Meta campaigns but no booking events at all.
- 26 appointments are Google Calendar events; the cockpit counts 16 of them as bookings.
- 141 of 194 past meetings have no result recorded.
- 62 Meta leads come from a campaign whose ad account is not tied to one client.

## Original verification plan

1. Unit tests for column mapping, CSV escaping and formatting (bun).
2. `scripts/dev/verify-data-view.sql`: compare function totals with direct counts for two clients and two ranges.
3. Second source: compare one client's 7-day leads with the Master Dashboard "Leads View" tab and with GHL (read-only). Compare Meta counts with the media buyer card.
4. A non-admin session gets error `42501`. An anonymous call is refused.
5. "All clients, 90 days" loads in under 1 second.
6. Confirm that no existing screen changed: diff the cockpit source and check that only `AdminPage.tsx` (one button) and the routes file (one line) changed.
7. Ship with `scripts/ship.sh media-buyer-cockpit`. Check the button and `/data` on production as admin.
8. Add a RUNBOOK row and a session note in `mahara-context/shared/sessions/`.

## Live writes that need your go-ahead

- Applying the migration to Creative Triage production. It adds functions and one index. It changes no data.
- Deploying the cockpit release.

## Decisions (approved by Muhammed, 2026-10-11)

1. Phones: full numbers on this admin-only page.
2. CSV export: allowed for admins, with one audit row per export.
3. Build approved, revision 3 layout confirmed, migration and release approved.
4. Admins only (CEO passes the same gate). Entry points in both cockpits and on each client page.

## Not in v1

Syncing the missing fields (notes, agent, last touch), Mahara's own sales leads, opportunities, contact notes and fix buttons.

## Effort

One working session, about 4 hours, including verification.
