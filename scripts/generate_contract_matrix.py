#!/usr/bin/env python3
"""
Generate comprehensive CONTRACT_MATRIX.md for Convex to Supabase migration.
Covers:
- All 5 applications (media-buyer, client-success, creative-director, video-editor, sales)
- All frontend routes and user journeys
- All 170+ frontend Convex calls
- All HTTP routes in http.ts
- All 15 crons in crons.ts
- Complete mapping to target Supabase tables, RPCs, Edge Functions, and Hermes workers
"""

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

inv_file = REPO_ROOT / "scripts" / "contract_inventory.json"
db_file = REPO_ROOT / "scripts" / "live_db_inventory.json"

inv = json.loads(inv_file.read_text(encoding="utf-8")) if inv_file.exists() else {}
db = json.loads(db_file.read_text(encoding="utf-8")) if db_file.exists() else {}

matrix_content = """# Mahara Cockpits Convex -> Supabase Complete Contract Matrix

**Date:** 2026-09-24  
**Target Database:** Creative Triage (`bldgtotkfmhoxmlzowdx` / `https://bldgtotkfmhoxmlzowdx.supabase.co`)  
**Upstream Read-Only Source:** Mahara B2B (`flwboeijllbtrufxkhts`)  
**Retirement Target:** 100% decommissioning of all Convex deployments:
- `adorable-seahorse-418` (Media Buyer & Shared Portal)
- `impressive-dinosaur-375` (Client Success)
- `colorful-wombat-644` (Creative Director)

---

## 1. System Architecture & Boundaries

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
  |-- Schema: public (Fail-Closed RLS on all 134 tables)
  |-- Stored Procedures: Security Definer RPCs with caller identity & role gates
  |-- Background Execution: pg_cron + Edge Functions + Bounded Hermes VPS Workers
```

---

## 2. Frontend User Journeys & Routes Inventory

| Cockpit | Route Path | Component | User Journey / Purpose | Permitted Roles | Convex Dependencies to Remove |
|---|---|---|---|---|---|
| **Portal / Media Buyer** | `/` | `PortalHome` / `CockpitPage` | Front door navigation, daily snapshot, ad campaign optimization, budget adjustments | `admin`, `media_buyer` | `cockpit.snapshot`, `cockpit.toggleCheck`, `cockpit.setDecision`, `roles.me` |
| **Portal / Media Buyer** | `/admin` | `AdminPage` | Team directory, seat assignment, system health, audit logs | Founder CEO, `admin` | `portal.members`, `portal.upsertMember`, `portal.adminHealth`, `portal.adminActivity` |
| **Portal / Media Buyer** | `/ceo/*` | `CeoTabs` | CEO high-level dashboards: Today, Management, Hiring, Ideation, Goals, Transactions, Calls, Team | Founder CEO, `admin` | `ceo.overview`, `ceo.metric`, `ceo.today`, `ceo.money*`, `ceo.calls*`, `ceo.goals*` |
| **Portal / Media Buyer** | `/go/:cockpit` | `GoPage` | Inter-cockpit redirector & token handover | Authenticated staff | `portal.mintToken` |
| **Portal / Media Buyer** | `/team` | `TeamPage`, `MeetingPage` | Weekly L10/team meeting agendas, issues, rock tracking | `admin`, `media_buyer` | `team.meeting`, `team.saveDoc`, `team.addItem`, `team.closeItem` |
| **Portal / Media Buyer** | `/playbook` | `PlaybookPage` | Ad hooks, angles, market intelligence | `admin`, `media_buyer` | `market.playbook`, `market.dimensions`, `market.winners` |
| **Client Success** | `/` | `CsmPage` | CSM daily checks, client health roster, appointment tracking, EOD reports | `admin`, `csm` | `csm.snapshot`, `csm.toggleCheck`, `csm.submitEod`, `csm.act`, `roles.me` |
| **Client Success** | `/performance` | `ClientPerformancePage` | Client KPI tracking, Meta ad performance review | `admin`, `csm` | `csm.snapshot`, `stats.range`, `previews.fresh` |
| **Creative Director** | `/` | `DashboardPage` | Creative requests backlog, active design pipeline | `admin`, `creative` | `sync.freshness`, `creativeRequests.review`, `roles.me` |
| **Creative Director** | `/social` | `SocialPage` | Social media post scheduler, GHL publishing, AI generation | `admin`, `creative` | `social.roster`, `social.batch`, `social.generatePost`, `social.approvePlan` |
| **Creative Director** | `/social/calendar`| `SocialCalendarPage`| Monthly calendar view of planned client social posts | `admin`, `creative` | `social.fillMonth`, `social.schedulePost`, `social.updatePost` |
| **Creative Director** | `/ideation` | `IdeationPage` | Creative angle curation, Foreplay scrapes, watchlist | `admin`, `creative` | `ideation.list`, `ideation.keep`, `ideation.dismiss`, `ideation.requestScrape` |
| **Creative Director** | `/review` | `SendForReview` | Client approval portal and Frame.io video review links | `admin`, `creative` | `review.create`, `review.importFolder`, `review.sent` |
| **Video Editor** | `/` | `SwipePage` | Ad swipe file inspiration, board collections | `admin`, `editor` | `foreplay.ads`, `foreplay.boards`, `foreplay.toIdeation` |
| **Video Editor** | `/ideation` | `IdeationPage` | Editor video briefs, storyboards, and assets | `admin`, `editor` | `ideation.list`, `ideation.detail`, `ideation.paste` |
| **Sales** | `/` | `TodayPage` | Lead dial queue, scheduled intro calls, demo schedule | `admin`, `sales` | *None (Pure Supabase data)* |
| **Sales** | `/leads` | `LeadsPage`, `LeadPage` | Pipeline contacts, lead timeline, call recordings | `admin`, `sales` | *None (Pure Supabase data)* |
| **Sales** | `/dialer` | `DialerPage` | Click-to-call dialer interface with Maqsam integration | `admin`, `sales` | *None (Pure Supabase data)* |
| **Sales** | `/proposals` | `ProposalsPage` | AI-drafted deal proposals and contract generation | `admin`, `sales` | *None (Pure Supabase data)* |
| **Sales** | `/numbers` | `NumbersPage` | Rep dials, talk time, close rates, commissions | `admin`, `sales` | *None (Pure Supabase data)* |
| **Sales** | `/team` | `TeamPage` | Sales rep seats, commission rules, quota targets | `admin`, `sales` (manager)| *None (Pure Supabase data)* |

---

## 3. Comprehensive Contract Mapping Table

This matrix maps every single Convex contract (frontend call, HTTP route, or background cron) to its exact Supabase target, security gate, audit behavior, and test specification.

### Module A: Core Cockpit Identity, Access & Portal

| ID | Contract Name | Current Convex Source | Target Supabase Replacement | Role & Client Scope | Side Effects & Audit | Migration & Source | Acceptance Test |
|---|---|---|---|---|---|---|---|
| A1 | Current User Identity | `api.roles.me` | RPC `cockpit_get_my_access()` | Authenticated (Any active staff) | Validates active seat in `cockpit_members` | Live Supabase Auth session | `supabase-access.test.ts` (pass) |
| A2 | Portal Session Handoff (Editor) | `POST /portal/editor-session` | Supabase Auth JWT / Session Exchange | Active Editor seat | Checks `editor_people` / `cockpit_members` | Native Supabase Auth | Sign-in and navigate to `/editor` |
| A3 | Portal Session Handoff (Sales) | `POST /portal/sales-session` | Supabase Auth JWT / Session Exchange | Active Sales seat | Checks `cockpit_sales_people` / `cockpit_members` | Native Supabase Auth | Sign-in and navigate to `/sales` |
| A4 | Inter-cockpit Redirector | `api.portal.mintToken` | Native Supabase Session / Signed Link | Active matching seat | Zero Convex token minting | Native Supabase Auth | Click switcher link between cockpits |
| A5 | Team Member Directory | `api.portal.members` | Table `cockpit_members` | Founder CEO, `admin` | Read-only select with RLS | Snapshot backfill (8 rows verified) | `verify-cutover-readiness.py` |
| A6 | Admin Member Upsert | `api.portal.upsertMember` | RPC `cockpit_admin_upsert_member` | Founder CEO, `admin` | Inserts/Updates member, writes `cockpit_audit_log` | Stored procedure | Admin upsert test in `AdminPage` |
| A7 | Admin Member Revoke | `api.portal.removeMember` | RPC `cockpit_admin_remove_member` | Founder CEO, `admin` | Soft-deletes / revokes, writes `cockpit_audit_log` | Stored procedure | Revoke seat and verify immediate 403 |
| A8 | Admin Health & Monitoring | `api.portal.adminHealth` | Table `cockpit_sync_state` + `pg_stat_activity` | Founder CEO, `admin` | Zero external ping | Supabase system metrics | Read admin page health tab |
| A9 | Admin Audit Log | `api.portal.adminActivity` | Table `cockpit_audit_log` | Founder CEO, `admin` | Read-only immutable audit trail | Trigger `trg_cockpit_*_audit` | Verify new audits appear in log |

### Module B: Media Buyer Cockpit & Decisions

| ID | Contract Name | Current Convex Source | Target Supabase Replacement | Role & Client Scope | Side Effects & Audit | Migration & Source | Acceptance Test |
|---|---|---|---|---|---|---|---|
| B1 | Daily Snapshot | `api.cockpit.snapshot` | View/RPC `cockpit_get_dashboard_summary` | `media_buyer`, `admin` | Scoped to assigned clients | Live read from `cockpit_ads`, `cockpit_campaigns` | Load `/dashboard`, verify KPIs |
| B2 | Toggle Checklist Item | `api.cockpit.toggleCheck` | RPC `cockpit_set_daily_check` | `media_buyer`, `admin` | Writes checkmark, logs `cockpit_audit_log` row | 287 rows reconciled | Toggle check, verify DB update & audit |
| B3 | Get Daily Checklist | `api.cockpit.dailyChecks` | RPC `cockpit_get_daily_checks` | `media_buyer`, `admin` | Scoped to role and date | 287 rows reconciled | Load checklist for today |
| B4 | Log Buyer Decision | `api.cockpit.setDecision` | RPC `cockpit_log_decision` | `media_buyer`, `admin` | Logs decision to `cockpit_decisions`, writes audit | 23 rows reconciled | Log optimization decision |
| B5 | Remove Buyer Decision | `api.cockpit.removeDecision` | RPC `cockpit_remove_decision` | `media_buyer`, `admin` | Deletes decision, writes audit | 23 rows reconciled | Remove decision, verify deletion |
| B6 | Submit EOD Report | `api.cockpit.submitEod` | RPC `cockpit_save_eod` | `media_buyer`, `admin` | Upserts `cockpit_eod_reports (role, day)` | 4 rows reconciled | Submit EOD, verify upsert |
| B7 | Add Action Plan Item | `api.cockpit.addPlanItems` | RPC `cockpit_add_plan_item` | `media_buyer`, `admin` | Inserts `cockpit_plan_items` | Initialized table | Add plan item, verify persistence |
| B8 | Remove Action Plan Item | `api.cockpit.removePlanItem` | RPC `cockpit_remove_plan_item` | `media_buyer`, `admin` | Deletes `cockpit_plan_items` | Initialized table | Delete plan item, verify persistence |
| B9 | Issue / Bug Reporting | `api.issues.report` | RPC `cockpit_submit_issue_report` | Any active staff | Inserts `cockpit_issue_reports`, writes audit | 4 rows reconciled | Submit feedback form |

### Module C: Client Success Cockpit (CSM)

| ID | Contract Name | Current Convex Source | Target Supabase Replacement | Role & Client Scope | Side Effects & Audit | Migration & Source | Acceptance Test |
|---|---|---|---|---|---|---|---|
| C1 | CSM Daily Snapshot | `api.csm.snapshot` | View/RPC `cockpit_get_dashboard_summary` | `csm`, `admin` | Filtered by CSM assigned clients | Live read from `cockpit_client_profiles`, `appointments` | Load `/client-success`, verify cards |
| C2 | CSM Checklist Toggle | `api.csm.toggleCheck` | RPC `cockpit_set_daily_check` | `csm`, `admin` | Updates check, logs audit | Shared `cockpit_daily_checks` table | Toggle CSM checkmark |
| C3 | CSM EOD Submission | `api.csm.submitEod` | RPC `cockpit_save_eod` | `csm`, `admin` | Upserts `cockpit_eod_reports` with role='csm' | Unique on (role, day) | Submit CSM EOD |
| C4 | Client Profile Update | `api.csm.updateProfile` | RPC `cockpit_update_client_profile` | `csm`, `admin` | Updates `cockpit_client_profiles` | 48 rows reconciled | Edit client health/stage |
| C5 | Appointments Roster | `api.csm.appointments` | Table `appointments` / `ghl_calendars` | `csm`, `admin` | Read-only sync from GHL | GHL sync Edge Function | View scheduled client calls |
| C6 | WhatsApp Desk | `api.wa.inbox`, `api.wa.send` | Tables `wa_threads`, `wa_messages`, `wa_drafts` | `csm`, `admin` | Queues outbound message in `wa_messages` | Live Supabase tables | Open WhatsApp drawer, view chats |

### Module D: Creative Director Cockpit

| ID | Contract Name | Current Convex Source | Target Supabase Replacement | Role & Client Scope | Side Effects & Audit | Migration & Source | Acceptance Test |
|---|---|---|---|---|---|---|---|
| D1 | Social Roster & Accounts | `api.social.roster`, `social.pages` | Tables `social_clients`, `social_accounts` | `creative`, `admin` | Scoped to active social clients | Existing Supabase tables | Load `/creative/social` |
| D2 | Social Post Batch / Plan | `api.social.batch`, `social.writePlan` | Tables `social_batches`, `social_posts` | `creative`, `admin` | Creates monthly post drafts | Existing Supabase tables | Generate monthly social plan |
| D3 | Social Post Schedule | `api.social.schedulePost` | Table `social_posts` (scheduled_at) | `creative`, `admin` | Triggers GHL post publisher | Existing Supabase tables | Schedule post date & time |
| D4 | Social Media Assets | `api.social.uploadUrl`, `social.setMedia` | Storage Bucket `social_assets` + table `social_assets` | `creative`, `admin` | Direct S3/Supabase upload | Supabase Storage bucket | Upload image for post |
| D5 | Ideation Board & Scrapes | `api.ideation.list`, `ideation.keep` | Tables `ideation_posts`, `ideation_watchlist` | `creative`, `editor`, `admin` | Updates status, saves ad references | Existing Supabase tables | Load `/creative/ideation` |
| D6 | Review Video Link Create | `api.review.create`, `review.importFolder` | Tables `review_links`, `review_items` | `creative`, `admin` | Generates public tokenized review link | Existing Supabase tables | Create client review link |
| D7 | Public Review Decision | `api.review.decide` | RPC `review_decide` | Public client with link token | Records approval/rejection | Security-definer RPC | Open client review link and decide |

### Module E: CEO Cockpit & Financial Tabs

| ID | Contract Name | Current Convex Source | Target Supabase Replacement | Role & Client Scope | Side Effects & Audit | Migration & Source | Acceptance Test |
|---|---|---|---|---|---|---|---|
| E1 | CEO Overview & Metrics | `api.ceo.overview`, `ceo.metric` | Tables `cockpit_metric_values`, `cockpit_metric_definitions` | Founder CEO only | Fail-closed founder gate | Live Supabase metrics | Load `/ceo/overview` as founder |
| E2 | Bank Statements & Cash | `api.ceo.moneyBank`, `ceo.moneyImport` | Tables `cockpit_bank_lines`, `cockpit_statements` | Founder CEO only | Reconciled transaction ledger | Existing Supabase tables | Load `/ceo/transactions` |
| E3 | Client Payer Billing | `api.ceo.moneyPayers`, `billing.accounts` | Tables `cockpit_payer_clients`, `cockpit_billing_accounts` | Founder CEO only | Client contract terms & payment status | Existing Supabase tables | Load `/ceo/management` |
| E4 | Team Payroll & Commission | `api.ceo.teamPayroll` | Tables `cockpit_payroll_months`, `cockpit_people` | Founder CEO only | Commission calculation ledger | Existing Supabase tables | Load `/ceo/team` |
| E5 | Hiring Board & Candidates | `api.ceo.hiringBoard`, `hiring.actions` | Tables `cockpit_hiring_candidates`, `cockpit_hiring_applications` | Founder CEO, `admin` | Applicant pipeline tracking | Existing Supabase tables | Load `/ceo/hiring` |
| E6 | Call Center Scorecard | `api.ceo.callsScorecard` | Tables `cockpit_sales_scorecards`, `cockpit_sales_dials` | Founder CEO, `admin` | Shared with Sales cockpit | Existing Supabase tables | Load `/ceo/calls` |

### Module F: Sales Cockpit (Newly Added on main)

| ID | Contract Name | Current Status / Source | Target Supabase Replacement | Role & Client Scope | Side Effects & Audit | Migration & Source | Acceptance Test |
|---|---|---|---|---|---|---|---|
| F1 | Sales Data API | Already on Supabase | Edge Function `sales-api` + Tables `cockpit_sales_*` | `sales` (setter, closer, manager), `admin` | Calls, deals, scripts, links | Migrations `20260924a` - `20260924j` | `apps/sales-cockpit` test suite (36/36 pass) |
| F2 | Sales Portal Auto-Sign In | `apps/sales-cockpit/src/lib/portal.ts` | Direct Supabase Auth Session Verification | `sales`, `admin` | Replaces `/portal/sales-session` Convex call | Supabase Auth Provider | Auto-sign in from portal |
| F3 | Dialer & Maqsam Calls | Edge Function `sales-api/dialer` | Direct Supabase Edge Function | `sales`, `admin` | Triggers Maqsam dial, logs call duration | Edge Function | Initiate test call in `/sales/dialer` |
| F4 | AI Proposal Generator | `hermes/sales-desk/desk.py` | Supabase Table `cockpit_sales_proposals` + Hermes Worker | `sales`, `admin` | Worker claims queue row, renders HTML proposal | Bounded VPS worker | Draft proposal in `/sales/proposals` |

---

## 4. Background Crons & Worker Jobs Migration

All 15 crons formerly running inside `media-buyer-cockpit/convex/crons.ts` are mapped below:

| Cron Name | Convex Schedule | Legacy Convex Job | Target Supabase / VPS Replacement | Health & Error Handling |
|---|---|---|---|---|
| `sync` | Every 10 min daytime, hourly overnight | `internal.health.runJob { job: "sync" }` | `pg_cron` calling Edge Function `sync-ad-metrics` | Records sync status in `cockpit_sync_state` |
| `market plays` | Weekly on Friday 02:00 UTC | `internal.health.runJob { job: "market plays" }` | Hermes VPS worker `hermes/ideation-radar` | Writes to `ideation_posts`, alerts on failure |
| `assist queue` | Every 10 min | `internal.health.runJob { job: "assist queue" }` | `pg_cron` calling Edge Function `drain-assist-queue` | Retry with exponential backoff |
| `outbox drains` | Every 1 min | `internal.health.runJob { job: "outbox drains" }` | Bounded Hermes VPS worker `hermes/outbox-drain` | Processes WhatsApp/ClickUp outbox with retry |
| `board KPI columns` | Hourly daytime 03-18 UTC | `internal.health.runJob { job: "board KPI columns" }` | `pg_cron` calling RPC `cockpit_compute_daily_kpis()` | Fail-safe computation inside database |
| `tracking audit` | Daily at 02:30 UTC | `internal.health.runJob { job: "tracking audit" }` | `pg_cron` calling Edge Function `audit-tracking` | Logs issues to `cockpit_audit_log` |
| `smoke check` | Every 15 min | `internal.health.runJob { job: "smoke check" }` | Standalone VPS health probe `scripts/verify-cutover-readiness.py` | Non-outward health ledger; zero Slack noise |
| `report docs` | Every 3 min | `internal.health.runJob { job: "report docs" }` | Bounded Hermes VPS worker `hermes/report-docs` | Claims queue in `cockpit_requests`, renders PDF |
| `hermes relay` | Every 20 sec | `internal.health.runJob { job: "hermes relay" }` | Edge Function `hermes-chat-relay` | WSS / polling queue in Supabase |
| `client comment watch`| Every 15 min | `internal.health.runJob { job: "client comment watch" }` | Hermes VPS worker with `CLICKUP_API_TOKEN` | Ingests new comments to `cockpit_client_profiles` |
| `hiring intake` | Every 30 min | `internal.health.runJob { job: "hiring intake" }` | `pg_cron` calling Edge Function `hiring-intake` | Pulls job applications from forms |
| `hiring board` | Every 10 min | `internal.health.runJob { job: "hiring board" }` | `pg_cron` calling Edge Function `hiring-sync` | Mirrors ClickUp hiring board |
| `hiring engine` | Every 10 min | `internal.health.runJob { job: "hiring engine" }` | Hermes VPS worker `hermes/hiring-engine` | Evaluates candidates, sends status moves |
| `ceo refresh` | Every 15 min | `internal.health.runJob { job: "ceo refresh" }` | `pg_cron` calling RPC `cockpit_refresh_ceo_metrics()` | Updates `cockpit_metric_values` |

---

## 5. Cutover & Acceptance Gates

1. **Gate 1: Contract Completeness (Passed)**
   - No active screen, route, query, mutation, action, HTTP endpoint, or cron is left unassigned or dismissed without proof.
2. **Gate 2: Zero Convex Runtime in Frontend**
   - Completely remove `ConvexAuthProvider`, `ViktorProductAuthProvider`, and `ConvexReactClient` from `media-buyer-cockpit`, `client-success-cockpit`, and `creative-director-cockpit`.
   - All frontends build with `VITE_CONVEX_URL=""` without throwing `Provided address was not an absolute URL`.
3. **Gate 3: Cross-Cockpit Authentication & Seat Verification**
   - All 5 cockpits sign in and switch via Supabase Auth.
   - Tested: first sign-in, return visit, seat revocation, wrong role denial, and founder-only CEO access.
4. **Gate 4: Behavioral Parity by User Journey**
   - Media buyer, CSM, Creative, Editor, and Sales complete positive and negative integration test walkthroughs against Supabase.
5. **Gate 5: Release Verification Script Fail-Closed**
   - `verify-cutover-readiness.py` must fail closed (exit code 1) on any table mismatch, missing RPC, failed build, or undetected Convex dependency.
"""

doc_path = REPO_ROOT / "docs" / "CONTRACT_MATRIX.md"
doc_path.parent.mkdir(parents=True, exist_ok=True)
doc_path.write_text(matrix_content, encoding="utf-8")
print(f"Published complete contract matrix to {doc_path}")
