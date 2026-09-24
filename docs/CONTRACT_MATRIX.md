# Mahara Cockpits Convex -> Supabase Complete Contract Matrix

**Date:** 2026-09-24  
**Target Database:** Creative Triage (`bldgtotkfmhoxmlzowdx` / `https://bldgtotkfmhoxmlzowdx.supabase.co`)  
**Upstream Read-Only Source:** Mahara B2B (`flwboeijllbtrufxkhts`)  
**Retirement Target:** 100% decommissioning of all Convex deployments:
- `adorable-seahorse-418` (Media Buyer & Shared Portal)
- `impressive-dinosaur-375` (Client Success)
- `colorful-wombat-644` (Creative Director)

---

## 1. System Architecture & Evidence Baseline

```
[Browser Clients (5 Cockpits)]
  |-- /             -> Media Buyer Cockpit (Portal Home, Cockpit, Admin, CEO Tabs)
  |-- /client-success -> Client Success Cockpit (CSM Workspace, Client Performance)
  |-- /creative     -> Creative Director Cockpit (Dashboard, Social, Ideation, Review)
  |-- /editor       -> Video Editor Cockpit (Swipe & Video Workspace)
  |-- /sales        -> Sales Cockpit (Today, Leads, Dialer, Proposals, Pay, Team)
         |
         | (Direct HTTPS / WSS via @supabase/supabase-js with Bearer JWT)
         v
[Supabase Creative Triage (bldgtotkfmhoxmlzowdx)]
  |-- Auth: supabase.auth (Shared JWT, Session Management, Passwordless/Password Auth)
  |-- Schema: public (Fail-Closed RLS on all domain tables)
  |-- Stored Procedures: Security Definer RPCs with caller identity & role gates
  |-- Background Execution: pg_cron + Edge Functions + Bounded Hermes VPS Workers
```

### Evidence Status Definitions
- **planned**: Proposed contract, schema, or endpoint not yet implemented or tested in code.
- **implemented**: Code written and merged into the migration branch; compiles without error.
- **locally tested**: Automated unit/integration tests or CLI verification executed and passing locally.
- **preview verified**: Verified against staging/preview instance or test runner with Convex access blocked.
- **production verified**: Live verification against Supabase target (`bldgtotkfmhoxmlzowdx`), confirmed in database catalogs (`pg_proc`, `information_schema`, table row counts, and live RLS).

---

## 2. Frontend User Journeys & Routes Inventory

| Cockpit | Route Path | Component | User Journey / Purpose | Permitted Roles | Convex Dependencies to Remove | Evidence Status |
|---|---|---|---|---|---|---|
| **Portal / Media Buyer** | `/` | `PortalHome` / `CockpitPage` | Front door navigation, daily snapshot, ad campaign optimization, budget adjustments | `admin`, `media_buyer` | `cockpit.snapshot`, `cockpit.toggleCheck`, `cockpit.setDecision`, `roles.me` | **implemented** |
| **Portal / Media Buyer** | `/admin` | `AdminPage` | Team directory, seat assignment, system health, audit logs | Founder CEO, `admin` | `portal.members`, `portal.upsertMember`, `portal.adminHealth`, `portal.adminActivity` | **implemented** |
| **Portal / Media Buyer** | `/ceo/*` | `CeoTabs` | CEO high-level dashboards: Today, Management, Hiring, Ideation, Goals, Transactions, Calls, Team | Founder CEO, `admin` | `ceo.overview`, `ceo.metric`, `ceo.today`, `ceo.money*`, `ceo.calls*`, `ceo.goals*` | **implemented** |
| **Portal / Media Buyer** | `/go/:cockpit` | `GoPage` | Inter-cockpit redirector & token handover | Authenticated staff | `portal.mintToken` | **production verified** |
| **Portal / Media Buyer** | `/team` | `TeamPage`, `MeetingPage` | Weekly L10/team meeting agendas, issues, rock tracking | `admin`, `media_buyer` | `team.meeting`, `team.saveDoc`, `team.addItem`, `team.closeItem` | **implemented** |
| **Portal / Media Buyer** | `/playbook` | `PlaybookPage` | Ad hooks, angles, market intelligence | `admin`, `media_buyer` | `market.playbook`, `market.dimensions`, `market.winners` | **planned** |
| **Client Success** | `/` | `CsmPage` | CSM daily checks, client health roster, appointment tracking, EOD reports | `admin`, `csm` | `csm.snapshot`, `csm.toggleCheck`, `csm.submitEod`, `csm.act`, `roles.me` | **implemented** |
| **Client Success** | `/performance` | `ClientPerformancePage` | Client KPI tracking, Meta ad performance review | `admin`, `csm` | `csm.snapshot`, `stats.range`, `previews.fresh` | **implemented** |
| **Creative Director** | `/` | `DashboardPage` | Creative requests backlog, active design pipeline | `admin`, `creative` | `sync.freshness`, `creativeRequests.review`, `roles.me` | **implemented** |
| **Creative Director** | `/social` | `SocialPage` | Social media post scheduler, GHL publishing, AI generation | `admin`, `creative` | `social.roster`, `social.batch`, `social.generatePost`, `social.approvePlan` | **implemented** |
| **Creative Director** | `/social/calendar`| `SocialCalendarPage`| Monthly calendar view of planned client social posts | `admin`, `creative` | `social.fillMonth`, `social.schedulePost`, `social.updatePost` | **implemented** |
| **Creative Director** | `/ideation` | `IdeationPage` | Creative angle curation, Foreplay scrapes, watchlist | `admin`, `creative` | `ideation.list`, `ideation.keep`, `ideation.dismiss`, `ideation.requestScrape` | **production verified** |
| **Creative Director** | `/review` | `SendForReview` | Client approval portal and Frame.io video review links | `admin`, `creative` | `review.create`, `review.importFolder`, `review.sent` | **implemented** |
| **Video Editor** | `/` | `SwipePage` | Ad swipe file inspiration, board collections | `admin`, `editor` | `foreplay.ads`, `foreplay.boards`, `foreplay.toIdeation` | **production verified** |
| **Video Editor** | `/ideation` | `IdeationPage` | Editor video briefs, storyboards, and assets | `admin`, `editor` | `ideation.list`, `ideation.detail`, `ideation.paste` | **production verified** |
| **Sales** | `/` | `TodayPage` | Lead dial queue, scheduled intro calls, demo schedule | `admin`, `sales` | *None (Native Supabase)* | **production verified** |
| **Sales** | `/leads` | `LeadsPage`, `LeadPage` | Pipeline contacts, lead timeline, call recordings | `admin`, `sales` | *None (Native Supabase)* | **production verified** |
| **Sales** | `/dialer` | `DialerPage` | Click-to-call dialer interface with Maqsam integration | `admin`, `sales` | *None (Native Supabase)* | **production verified** |
| **Sales** | `/proposals` | `ProposalsPage` | AI-drafted deal proposals and contract generation | `admin`, `sales` | *None (Native Supabase)* | **production verified** |
| **Sales** | `/numbers` | `NumbersPage` | Rep dials, talk time, close rates, commissions | `admin`, `sales` | *None (Native Supabase)* | **production verified** |
| **Sales** | `/team` | `TeamPage` | Sales rep seats, commission rules, quota targets | `admin`, `sales` (manager)| *None (Native Supabase)* | **production verified** |

---

## 3. Comprehensive Contract Mapping Table

### Module A: Core Cockpit Identity, Access & Portal

| ID | Contract Name | Current Convex Source | Target Supabase Replacement | Caller & Scope | Permission Gate & Audit | Data Ownership | Acceptance Test | Evidence Status |
|---|---|---|---|---|---|---|---|---|
| A1 | Current User Identity | `api.roles.me` | RPC `cockpit_get_my_access()` | All cockpits; authenticated staff | Validates active seat in `cockpit_members`; fail-closed | Table `cockpit_members` | `supabase-access.test.ts` | **production verified** |
| A2 | Portal Session Handoff (Editor) | `POST /portal/editor-session` | Supabase Auth JWT / Session Exchange | `video-editor-cockpit/src/lib/portal.ts` | Active Editor seat in `editor_people` / `cockpit_members` | Supabase Auth | Sign-in and navigate to `/editor` | **production verified** |
| A3 | Portal Session Handoff (Sales) | `POST /portal/sales-session` | Supabase Auth JWT / Session Exchange | `sales-cockpit/src/lib/portal.ts` | Active Sales seat in `cockpit_sales_people` | Supabase Auth | Sign-in and navigate to `/sales` | **production verified** |
| A4 | Inter-cockpit Redirector | `api.portal.mintToken` | Native Supabase Session (`localStorage`) | `GoPage.tsx` | Same-origin JWT share on `cockpit.maharamedia.com` | Client storage | GoPage redirect without hash | **production verified** |
| A5 | Team Member Directory | `api.portal.members` | Table `cockpit_members` | `AdminPage.tsx` | Founder CEO (`aziz@maharamedia.com`, `awaheedi2008@gmail.com`), `admin` | Table `cockpit_members` | `verify-cutover-readiness.py` | **production verified** |
| A6 | Admin Member Upsert | `api.portal.upsertMember` | RPC `cockpit_admin_upsert_member` | `AdminPage.tsx` | Founder CEO, `admin`; writes `cockpit_audit_log` | Table `cockpit_members` | Admin upsert in UI | **production verified** |
| A7 | Admin Member Revoke | `api.portal.removeMember` | RPC `cockpit_admin_remove_member` | `AdminPage.tsx` | Founder CEO, `admin`; soft-deletes and audits | Table `cockpit_members` | Revoke seat, verify immediate 403 | **production verified** |
| A8 | Admin Health & Monitoring | `api.portal.adminHealth` | Table `cockpit_sync_state` + `pg_stat_activity` | `AdminPage.tsx` | Founder CEO, `admin` | Internal DB stats | Load admin health panel | **implemented** |
| A9 | Admin Audit Log | `api.portal.adminActivity` | Table `cockpit_audit_log` | `AdminPage.tsx` | Founder CEO, `admin`; immutable audit trail | Table `cockpit_audit_log` | Verify new audits appear in log | **production verified** |

### Module B: Media Buyer Cockpit & Decisions

| ID | Contract Name | Current Convex Source | Target Supabase Replacement | Caller & Scope | Permission Gate & Audit | Data Ownership | Acceptance Test | Evidence Status |
|---|---|---|---|---|---|---|---|---|
| B1 | Daily Dashboard Snapshot | `api.cockpit.snapshot` | RPC `cockpit_get_dashboard_summary('media_buyer')` | `CockpitPage.tsx` | `media_buyer`, `admin`; filtered by assigned clients | `cockpit_ads`, `cockpit_campaigns` | Load `/dashboard`, verify KPIs | **production verified** |
| B2 | Toggle Checklist Item | `api.cockpit.toggleCheck` | RPC `cockpit_set_daily_check` | `CockpitPage.tsx` | `media_buyer`, `admin`; writes audit log | `cockpit_daily_checks` | Toggle check, verify DB update | **production verified** |
| B3 | Get Daily Checklist | `api.cockpit.dailyChecks` | RPC `cockpit_get_daily_checks` | `CockpitPage.tsx` | `media_buyer`, `admin`; role & date scoped | `cockpit_daily_checks` | Load checklist for today | **production verified** |
| B4 | Log Buyer Decision | `api.cockpit.setDecision` | RPC `cockpit_log_decision` | `CockpitPage.tsx` | `media_buyer`, `admin`; writes audit log | `cockpit_decisions` | Log optimization decision | **production verified** |
| B5 | Remove Buyer Decision | `api.cockpit.removeDecision` | RPC `cockpit_remove_decision` | `CockpitPage.tsx` | `media_buyer`, `admin`; writes audit log | `cockpit_decisions` | Remove decision, verify deletion | **production verified** |
| B6 | Submit EOD Report | `api.cockpit.submitEod` | RPC `cockpit_save_eod` | `CockpitPage.tsx` | `media_buyer`, `admin`; upserts (role, day) | `cockpit_eod_reports` | Submit EOD, verify row upsert | **production verified** |
| B7 | Add Action Plan Item | `api.cockpit.addPlanItems` | RPC `cockpit_add_plan_item` | `CockpitPage.tsx` | `media_buyer`, `admin` | `cockpit_plan_items` | Add plan item, verify persistence | **production verified** |
| B8 | Remove Action Plan Item | `api.cockpit.removePlanItem` | RPC `cockpit_remove_plan_item` | `CockpitPage.tsx` | `media_buyer`, `admin` | `cockpit_plan_items` | Delete plan item, verify persistence | **production verified** |
| B9 | Issue / Bug Reporting | `api.issues.report` | RPC `cockpit_submit_issue_report` | All cockpits | Authenticated staff; writes audit log | `cockpit_issue_reports` | Submit issue report in drawer | **production verified** |
| B10 | Swipe Ads & Boards | `api.foreplay.ads`, `foreplay.boards` | Direct Supabase Queries (`swipe.ts`) | `SwipePage.tsx` | `media_buyer`, `admin` | `foreplay_ads`, `foreplay_boards` | Load swipe page, view cards | **production verified** |
| B11 | Ideation Feed & Actions | `api.ideation.list`, `ideation.keep` | Direct Supabase Queries (`ideation.ts`) | `IdeationPage.tsx` | `media_buyer`, `admin` | `ideation_posts` | Filter proposed/saved ideas | **production verified** |
| B12 | Ad Preview Fetch | `api.previews.fresh` | Table `cockpit_ads` (select preview_url) | `CreativePreviewModal.tsx` | `media_buyer`, `admin` | `cockpit_ads` | Open ad creative preview modal | **production verified** |
| B13 | Market Playbook | `api.market.playbook` | Table `cockpit_market_playbook` | `PlaybookPage.tsx` | `media_buyer`, `admin` | Supabase table | Load playbook page | **planned** |
| B14 | City Picker / GEO Targeting | `api.market.cities` | Table `cockpit_geo_cities` | `CityPicker.tsx` | `media_buyer`, `admin` | Supabase table | Search and pick city | **planned** |
| B15 | Buyer Assist Queue | `api.assist.queue` | Table `cockpit_assist_queue` | `useAssist.ts` | `media_buyer`, `admin` | Supabase table | Enqueue AI assistant task | **planned** |

### Module C: Client Success Cockpit (CSM)

| ID | Contract Name | Current Convex Source | Target Supabase Replacement | Caller & Scope | Permission Gate & Audit | Data Ownership | Acceptance Test | Evidence Status |
|---|---|---|---|---|---|---|---|---|
| C1 | CSM Daily Snapshot | `api.csm.snapshot` | RPC `cockpit_get_dashboard_summary('csm')` | `CsmPage.tsx` | `csm`, `admin`; filtered by assigned clients | `cockpit_client_profiles` | Load `/client-success` | **production verified** |
| C2 | CSM Checklist Toggle | `api.csm.toggleCheck` | RPC `cockpit_set_daily_check` | `CsmPage.tsx` | `csm`, `admin`; writes audit log | `cockpit_daily_checks` | Toggle CSM checkmark | **production verified** |
| C3 | CSM EOD Submission | `api.csm.submitEod` | RPC `cockpit_save_eod` | `CsmPage.tsx` | `csm`, `admin`; unique on ('csm', day) | `cockpit_eod_reports` | Submit CSM EOD | **production verified** |
| C4 | Client Profile Update | `api.csm.updateProfile` | RPC `cockpit_update_client_profile` | `CsmPage.tsx` | `csm`, `admin`; updates health/stage | `cockpit_client_profiles` | Update client tier/status | **production verified** |
| C5 | Appointments Roster | `api.csm.appointments` | Table `appointments` | `CsmPage.tsx` | `csm`, `admin` | Table `appointments` | View client scheduled calls | **implemented** |
| C6 | WhatsApp Desk Inbox & Send | `api.wa.inbox`, `api.wa.send` | Tables `wa_threads`, `wa_messages`, `wa_drafts` | `WhatsAppDesk.tsx` | `csm`, `admin`; writes outbound message | Tables `wa_*` | View threads and draft reply | **implemented** |
| C7 | Client Gaps & Issues | `api.gaps.list`, `api.gaps.save` | Table `cockpit_client_gaps` | `CsmPage.tsx` | `csm`, `admin` | Table `cockpit_client_gaps` | View gap alerts for client | **planned** |
| C8 | Client Billing Accounts | `api.billing.accounts` | Table `cockpit_billing_accounts` | `ClientPerformancePage.tsx` | `csm`, `admin` | Table `cockpit_billing_accounts` | View client payment status | **implemented** |
| C9 | Client Video Reviews | `api.review.sent` | Tables `review_links`, `review_items` | `CsmPage.tsx` | `csm`, `admin` | Tables `review_*` | View client pending reviews | **implemented** |
| C10 | Client Performance Stats | `api.stats.range` | View `v_client_performance_daily` | `ClientPerformancePage.tsx` | `csm`, `admin` | Table `cockpit_ads` aggregations | View Meta 7d/30d trend graph | **implemented** |

### Module D: Creative Director Cockpit

| ID | Contract Name | Current Convex Source | Target Supabase Replacement | Caller & Scope | Permission Gate & Audit | Data Ownership | Acceptance Test | Evidence Status |
|---|---|---|---|---|---|---|---|---|
| D1 | Social Roster & Accounts | `api.social.roster`, `social.pages` | Tables `social_clients`, `social_accounts` | `SocialPage.tsx` | `creative`, `admin` | Tables `social_*` | Load `/creative/social` | **production verified** |
| D2 | Social Post Batch / Plan | `api.social.batch`, `social.writePlan` | Tables `social_batches`, `social_posts` | `SocialPage.tsx` | `creative`, `admin` | Tables `social_*` | Generate monthly post drafts | **production verified** |
| D3 | Social Post Schedule | `api.social.schedulePost` | Table `social_posts` (update scheduled_at) | `SocialPage.tsx` | `creative`, `admin` | Table `social_posts` | Set post date and time | **production verified** |
| D4 | Social Media Assets | `api.social.uploadUrl`, `social.setMedia` | Storage Bucket `social_assets` + table `social_assets` | `SocialPage.tsx` | `creative`, `admin` | Bucket `social_assets` | Upload asset for post | **production verified** |
| D5 | Ideation Board & Watchlist | `api.ideation.list`, `ideation.keep` | Direct Supabase Queries (`ideation.ts`) | `IdeationPage.tsx` | `creative`, `editor`, `admin` | `ideation_posts`, `ideation_watchlist` | Filter and keep ideas | **production verified** |
| D6 | Review Link Creation | `api.review.create`, `review.importFolder` | Tables `review_links`, `review_items` | `SendForReview.tsx` | `creative`, `admin` | Tables `review_*` | Create Frame.io review link | **production verified** |
| D7 | Public Review Decision | `api.review.decide` | RPC `review_decide` | Public client link | Public token bearer; writes approval/feedback | Table `review_items` | Decide on video link | **production verified** |
| D8 | Creative Requests Pipeline | `api.creativeRequests.review` | Table `cockpit_creative_requests` | `DashboardPage.tsx` | `creative`, `admin` | `cockpit_creative_requests` | View new creative requests | **production verified** |
| D9 | Creative Ad Scripts | `api.scripts.list`, `api.scripts.save` | Table `cockpit_creative_scripts` | `ScriptsPage.tsx` | `creative`, `admin` | `cockpit_creative_scripts` | Draft video script | **implemented** |
| D10 | Feed Sync Freshness | `api.sync.freshness` | Table `cockpit_sync_state` | `DashboardPage.tsx` | `creative`, `admin` | `cockpit_sync_state` | View data last-synced badge | **implemented** |

### Module E: CEO Cockpit & Financial Tabs

| ID | Contract Name | Current Convex Source | Target Supabase Replacement | Caller & Scope | Permission Gate & Audit | Data Ownership | Acceptance Test | Evidence Status |
|---|---|---|---|---|---|---|---|---|
| E1 | CEO Overview & KPI Metrics | `api.ceo.overview`, `ceo.metric` | Tables `cockpit_metric_values`, `cockpit_metric_definitions` | `CeoTabs.tsx` | Founder CEO only (`aziz@maharamedia.com`, `awaheedi2008@gmail.com`) | Tables `cockpit_metric_*` | Load `/ceo/overview` as founder | **production verified** |
| E2 | Bank Statements & Transactions | `api.ceo.moneyBank`, `ceo.moneyImport` | Tables `cockpit_bank_lines`, `cockpit_statements` | `moneyBank.tsx` | Founder CEO only | Tables `cockpit_bank_*` | View cash ledger | **production verified** |
| E3 | Client Payer Billing & Balances| `api.ceo.moneyPayers`, `billing.accounts`| Tables `cockpit_payer_clients`, `cockpit_billing_accounts` | `moneyPayers.tsx` | Founder CEO only | Tables `cockpit_payer_*` | View payer balances | **production verified** |
| E4 | Team Payroll & Commission | `api.ceo.teamPayroll` | Tables `cockpit_payroll_months`, `cockpit_people` | `TeamTab.tsx` | Founder CEO only | Tables `cockpit_payroll_*` | View payroll estimates | **production verified** |
| E5 | Hiring Board & Candidates | `api.ceo.hiringBoard`, `hiring.actions` | Tables `cockpit_hiring_candidates`, `cockpit_hiring_applications`| `HiringTab.tsx` | Founder CEO, `admin` | Tables `cockpit_hiring_*` | Move candidate to interview | **production verified** |
| E6 | Call Center Scorecard | `api.ceo.callsScorecard` | Tables `cockpit_sales_scorecards`, `cockpit_sales_dials` | `CallsTab.tsx` | Founder CEO, `admin` | Tables `cockpit_sales_*` | View call conversion rate | **production verified** |
| E7 | Goal Tracking & Rocks | `api.ceo.goals*` | Tables `cockpit_goals`, `cockpit_goal_updates` | `GoalsTab.tsx` | Founder CEO, `admin` | Tables `cockpit_goals` | Update quarter goal status | **production verified** |
| E8 | L10 Weekly Team Meetings | `api.team.meeting`, `team.saveDoc` | Tables `team_meetings`, `team_meeting_items` | `MeetingPage.tsx` | Founder CEO, `admin` | Tables `team_meetings` | Run L10 meeting agenda | **production verified** |

### Module F: Video Editor Cockpit

| ID | Contract Name | Current Status / Source | Target Supabase Replacement | Caller & Scope | Permission Gate & Audit | Data Ownership | Acceptance Test | Evidence Status |
|---|---|---|---|---|---|---|---|---|
| F1 | Editor Auth & Seat Check | `apps/video-editor-cockpit/src/lib/portal.ts` | Direct Supabase Auth + `editor_people` | `video-editor-cockpit` | Active Editor seat | `editor_people` / `cockpit_members` | Auto-sign in from portal | **production verified** |
| F2 | Foreplay Saved Ads | `foreplay_ads` query | Direct Supabase Query (`swipe.ts`) | `SwipePage.tsx` | `editor`, `admin` | `foreplay_ads` | View ad cards sorted by airtime | **production verified** |
| F3 | Foreplay Boards | `foreplay_boards` query | Direct Supabase Query (`swipe.ts`) | `SwipePage.tsx` | `editor`, `admin` | `foreplay_boards` | Filter ads by board | **production verified** |
| F4 | Save Ad to Ideation | `ideation_posts` upsert | Direct Supabase Upsert (`swipe.ts:toIdeation`) | `SwipePage.tsx` | `editor`, `admin` | `ideation_posts` | Send swipe ad to ideation board | **production verified** |
| F5 | Ideation Board Post Management | `ideation_posts` CRUD | Direct Supabase Query/Mutation (`ideation.ts`) | `IdeationPage.tsx` | `editor`, `admin` | `ideation_posts` | Update ideation status/tags | **production verified** |

### Module G: Sales Cockpit

| ID | Contract Name | Current Status / Source | Target Supabase Replacement | Caller & Scope | Permission Gate & Audit | Data Ownership | Acceptance Test | Evidence Status |
|---|---|---|---|---|---|---|---|---|
| G1 | Sales Auth & Role Gate | `apps/sales-cockpit/src/lib/portal.ts` | Direct Supabase Auth + `cockpit_sales_people` | `sales-cockpit` | Active Sales seat (closer, setter, manager) | `cockpit_sales_people` | Auto-sign in from portal | **production verified** |
| G2 | Today Dial Queue & Meetings | Edge Function `sales-api` + Tables `cockpit_sales_*` | Edge Function `sales-api/today` | `TodayPage.tsx` | `sales`, `admin` | `cockpit_sales_calls` | Load today's call list | **production verified** |
| G3 | Leads Pipeline & Detail | Edge Function `sales-api` + Tables `cockpit_sales_leads` | Edge Function `sales-api/leads` | `LeadsPage.tsx`, `LeadPage.tsx` | `sales`, `admin` | `cockpit_sales_leads` | View and edit lead status | **production verified** |
| G4 | Click-to-Call Dialer | Edge Function `sales-api/dialer` | Maqsam Direct Webhook / Edge Function | `DialerPage.tsx` | `sales`, `admin` | `cockpit_sales_calls` | Initiate Maqsam call | **production verified** |
| G5 | Proposal Generator | Table `cockpit_sales_proposals` + Hermes `sales-desk` | Supabase Table + Bounded Worker | `ProposalsPage.tsx` | `sales`, `admin` | `cockpit_sales_proposals` | Draft deal proposal | **production verified** |
| G6 | Rep Numbers & Commissions | Table `cockpit_sales_pay` | Direct Supabase Query | `NumbersPage.tsx` | `sales`, `admin` | `cockpit_sales_pay` | View commission ledger | **production verified** |

### Module H: Background Crons & Hermes Workers

| ID | Cron / Worker Name | Legacy Convex Schedule / Source | Target Replacement Runtime | Implementation Path | Health & Error Handling | Evidence Status |
|---|---|---|---|---|---|---|
| H1 | `sync` (Ad Metrics Sync) | Every 10 min daytime | Bounded Hermes VPS worker `hermes/team-sync` | `hermes/team-sync/sync.py` | Sync state logged in `cockpit_sync_state` | **locally tested** |
| H2 | `market plays` (Ideation Radar) | Weekly on Friday 02:00 UTC | Hermes VPS worker `hermes/ideation-radar` | `hermes/ideation-radar/radar.py` | Sinks directly to `ideation_posts` | **locally tested** |
| H3 | `assist queue` (AI Tasks) | Every 10 min | Supabase Edge Function `askai` or Hermes worker | `hermes/cockpit-ask-ai` | Claims `cockpit_ai_jobs` | **planned** |
| H4 | `outbox drains` (EOD & WhatsApp) | Every 1 min | Hermes VPS worker `hermes/eod-out` | `hermes/eod-out/out.py` | Posts EOD outbox rows; zero live Slack in tests | **locally tested** |
| H5 | `board KPI columns` | Hourly daytime 03-18 UTC | `pg_cron` calling Stored Procedure | RPC `cockpit_compute_daily_kpis()` | Runs within database engine | **planned** |
| H6 | `tracking audit` | Daily at 02:30 UTC | Hermes VPS watchdog | `scripts/verify-cutover-readiness.py` | Audits tracking parameters | **locally tested** |
| H7 | `smoke check` | Every 15 min | Standalone VPS health probe | `scripts/verify-cutover-readiness.py` | Non-outward health ledger; zero Slack alerts | **production verified** |
| H8 | `report docs` | Every 3 min | Bounded Hermes VPS worker `hermes/review-watch` | `hermes/review-watch/watch.py` | Claims queue, renders PDF | **locally tested** |
| H9 | `hermes relay` | Every 20 sec | Supabase Realtime / direct polling | Supabase Realtime subscriptions | Direct WSS channels | **planned** |
| H10 | `client comment watch` | Every 15 min | Hermes VPS worker with ClickUp API | `hermes/cockpit-client-success` | Writes to `cockpit_client_profiles` | **locally tested** |
| H11 | `hiring intake` | Every 30 min | Webhook directly into Supabase Table | Table `cockpit_hiring_applications` | Direct insert webhook | **implemented** |
| H12 | `hiring board` | Every 10 min | Hermes VPS worker | `hermes/salma` | Syncs candidate statuses | **locally tested** |
| H13 | `hiring engine` | Every 10 min | Hermes VPS worker | `hermes/salma` | Evaluates candidates | **locally tested** |
| H14 | `ceo refresh` | Every 15 min | `pg_cron` calling Stored Procedure | RPC `cockpit_refresh_ceo_metrics()` | Updates `cockpit_metric_values` | **planned** |

### Module I: External HTTP & Bridge Endpoints

| ID | Endpoint | Legacy Convex Route | Target Supabase Replacement | Status / Implementation | Evidence Status |
|---|---|---|---|---|---|
| I1 | Editor Session Handoff | `/portal/editor-session` | Supabase Auth JWT direct sign-in | Deprecated; native Supabase Auth in `video-editor-cockpit` | **production verified** |
| I2 | Editor Creative Preview | `/portal/editor-preview` | Direct select from `cockpit_ads` | Deprecated; direct DB query in `video-editor-cockpit` | **production verified** |
| I3 | Sales Session Handoff | `/portal/sales-session` | Supabase Auth JWT direct sign-in | Deprecated; native Supabase Auth in `sales-cockpit` | **production verified** |
| I4 | Sales Creative Preview | `/portal/sales-preview` | Direct select from `cockpit_ads` | Deprecated; direct DB query in `sales-cockpit` | **production verified** |
| I5 | Ask AI Job Pending Queue | `/askai/pending` | Supabase Table `cockpit_ai_jobs` / Edge Function | Worker claims open row via Supabase service key | **planned** |
| I6 | Ask AI Job Result Post | `/askai/result` | Supabase Table `cockpit_ai_jobs` / Edge Function | Worker updates result column via Supabase service key | **planned** |
| I7 | Client Success Bridge | `/bridge` (CSM) | Direct Supabase Database Connection | Worker reads/writes directly to `cockpit_client_profiles` | **implemented** |
| I8 | Creative Director Bridge | `/bridge` (Creative) | Direct Supabase Database Connection | Shared database tables eliminate inter-silo HTTP pushes | **production verified** |

---

## 4. Cutover & Acceptance Gates

1. **Gate 1: Contract Completeness (Passed)**
   - Every active screen, route, query, mutation, action, HTTP endpoint, and cron is mapped with an evidence-based status.
2. **Gate 2: Zero Convex Runtime in Frontend (In Progress)**
   - All 5 cockpits must eliminate `ConvexAuthProvider`, `ViktorProductAuthProvider`, and `NullConvexClient`.
   - All frontends build with `VITE_CONVEX_URL=""` without throwing `Provided address was not an absolute URL`.
3. **Gate 3: Cross-Cockpit Authentication & Seat Verification (Passed)**
   - All 5 cockpits sign in and switch via Supabase Auth without passing tokens in URL hashes.
   - Founder CEO email gate strictly limited to `aziz@maharamedia.com` and `awaheedi2008@gmail.com`.
4. **Gate 4: Behavioral Parity by User Journey (In Progress)**
   - Media buyer, CSM, Creative, Editor, and Sales complete positive and negative integration test walkthroughs against Supabase.
5. **Gate 5: Release Verification Script Fail-Closed (Passed)**
   - `verify-cutover-readiness.py` enforces 20s network timeouts, fail-closed `sys.exit(1)`, includes all 5 cockpit builds, and runs automated unit test suites.
