---
name: audit_measurement
description: Action skill that audits measurement infrastructure for Meta Ads accounts. Checks pixel health, Conversions API (CAPI) status, Event Match Quality scores, attribution settings, UTM structure, and third-party tool integration. Produces measurement health report with remediation priorities.
triggers:
  - "audit measurement"
  - "pixel audit"
  - "CAPI check"
  - "tracking audit"
  - "event match quality"
  - "attribution audit"
  - "conversion tracking review"
---

# Audit Measurement

## How to Call Meta Ads Tools

Viktor calls tools by writing Python scripts that use the generated SDK. All Meta Ads MCP functions are available at `sdk/tools/mcp_meta_ads.py`. Read that file for the full list of available functions and their parameters.

**Common pattern:**

```python
import asyncio
from sdk.tools.mcp_meta_ads import meta_ads_get_insights

async def main():
    result = await meta_ads_get_insights(
        account_id="act_XXXXXXXXX",
        date_preset="last_7d",
        fields=["spend", "impressions", "clicks", "actions", "cost_per_action_type"]
    )
    print(result)

asyncio.run(main())
```

Run scripts with: `uv run python script.py`

**Key functions:**
- `meta_ads_get_insights(...)` — performance data for any object (account/campaign/ad set/ad)
- `meta_ads_list_campaigns(account_id, ...)` — list campaigns
- `meta_ads_create_campaign(...)` — create campaign (returns draft for approval)
- `meta_ads_create_ad_set(...)` — create ad set
- `meta_ads_create_ad_creative(...)` — create creative
- `meta_ads_create_ad(...)` — create ad

All write operations create **drafts** requiring human approval via `submit_draft(draft_id)`.

All monetary values are in **cents** (divide by 100 for dollars).

Refer to `sdk/tools/mcp_meta_ads.py` for the complete function list with parameters and docstrings.

## Purpose

Execute a structured audit of measurement infrastructure for a Meta Ads account. Measurement is the foundation of every optimization decision. Bad measurement data leads to bad budget allocation, incorrect creative judgments, and flawed scaling decisions. This skill systematically evaluates every layer of the measurement stack: pixel health, CAPI implementation, Event Match Quality, attribution window configuration, event setup, UTM consistency, and third-party tool integration. The output is a measurement health scorecard with prioritized remediation actions.

## When to Use

- New account onboarding (first thing to audit before any campaign changes)
- Conversion data looks unreliable (spikes, drops, double-counting)
- CPA reported by Meta doesn't match internal data
- EMQ scores are below 6.0
- After implementing or changing CAPI
- After platform changes (iOS updates, Meta attribution model changes)
- Quarterly measurement health check
- When third-party attribution tool and Meta data diverge significantly (>30%)

## Dependencies

| Skill | Why It's Needed |
|-------|----------------|
| `measurement_methodology` | Complete measurement framework: attribution windows, CAPI, UTMs, third-party tools, MER, incrementality |
| `account_conventions` | Account config, data source method, KPI targets, capability flags |
| `account_maturity_methodology` | Maturity-calibrated expectations for measurement sophistication |

---

## Step 0: Load Dependencies

1. **Read `measurement-methodology/SKILL.md`** and load:
   - Attribution window selection matrix (by business type)
   - CAPI implementation requirements and deduplication rules
   - EMQ scoring thresholds (Poor <3.0, Below Average 3.0-5.0, Average 5.0-6.0, Good 6.0-8.0, Excellent 8.0-10.0)
   - UTM structure standards (utm_source=meta, utm_medium=cpc, etc.)
   - Third-party tool selection criteria by spend tier
   - MER calculation methodology
   - AEM current state (no longer 8-event limit)

2. **Read `account-conventions/SKILL.md`** and extract for the target account:
   - `ad_account_id`, `pixel_id`
   - `data_source.method` (pixel_only, pixel_and_capi, capi_gateway)
   - `data_source.capi_status` (active, inactive, unknown)
   - `data_source.third_party_tool` (none, triple_whale, northbeam, hyros)
   - `kpi_config` (primary KPI, conversion events, targets)
   - `attribution_window` (current setting)
   - `business_model` (ecommerce, saas, lead_gen, etc.)
   - `monthly_spend` (for third-party tool recommendations)
   - `maturity_level`

3. **Read `account-maturity-methodology/SKILL.md`** and determine measurement expectations:
   - **Nascent:** Pixel working, basic events, GA4 tracking. CAPI not required. Third-party not needed.
   - **Developing:** Pixel + CAPI implemented, EMQ >5.0, UTMs consistent, GA4 aligned. Third-party optional.
   - **Established:** CAPI with EMQ >6.0, deduplication verified, UTMs dynamic, third-party tool active for accounts >$50K/month.
   - **Advanced:** Full measurement stack, incrementality testing, MER tracking, multi-touch attribution.

**Pre-flight validation:**
- Confirm `pixel_id` is populated in account-conventions. If not, this is a critical finding (no pixel = no measurement).
- Confirm `data_source.method` is documented. If unknown, flag as first item to investigate.

---

## Step 1: Data Acquisition

### 1A: Pixel Health Data

Pull pixel diagnostic data to assess whether the pixel is functioning correctly.

**Required data points:**

| Data Point | Source | What to Check |
|------------|--------|---------------|
| Pixel status | Events Manager | Active / inactive / error state |
| Last event received | Events Manager | Timestamp of most recent event |
| Events firing | Events Manager > Overview | List of all events with 7-day volume |
| Event volume trends | Events Manager > Overview | 7-day and 28-day trends per event |
| Page coverage | Events Manager > Diagnostics | % of site pages with pixel installed |
| Event match rate | Events Manager > Diagnostics | Server vs browser event matching |
| Pixel errors | Events Manager > Diagnostics | Active errors, warnings |

**MCP tools:**

```
SDK call: `meta_ads_get_pixel_stats()` (from `sdk/tools/mcp_meta_ads`)
Parameters:
  pixel_id: {pixel_id}
  fields: [status, last_fired_time, event_count_7d, event_count_28d, diagnostics]
Note: Returns event statistics by event type, device, and count. Use to verify event volume
and identify firing issues without going to Events Manager manually.

SDK call: `meta_ads_get_server_events_setup()` (from `sdk/tools/mcp_meta_ads`)
Parameters:
  pixel_id: {pixel_id}
Note: Returns CAPI setup status and configuration details. Use as first check before
reviewing Events Manager manually.
```

### 1B: CAPI Status Data

| Data Point | Source | What to Check |
|------------|--------|---------------|
| CAPI active | Events Manager > Overview | Server events appearing alongside browser events |
| Deduplication status | Events Manager > Overview | "Deduplicated" count vs "Total" count |
| EMQ scores | Events Manager > Data Sources > CAPI | Per-event EMQ score |
| Server event volume | Events Manager > Overview | Server event count by event type |
| Event parameters sent | Events Manager > Test Events | Which user parameters are included |

### 1C: Attribution Settings

| Data Point | Source | What to Check |
|------------|--------|---------------|
| Current attribution window | Ad Account Settings | 1d click, 7d click, 7d click + 1d view |
| Attribution comparison | Ads Manager columns | Performance under multiple windows |
| Conversion event priority | Events Manager > Custom Conversions | Which events are set as conversion goals |

### 1D: UTM and Analytics Data

| Data Point | Source | What to Check |
|------------|--------|---------------|
| UTM template | Active ad URLs | Consistency, completeness, format |
| GA4 source/medium | Google Analytics | Are Meta campaigns showing correctly |
| UTM parameter values | Ad URLs (sample of 10+ ads) | Naming convention compliance |
| Landing page URLs | Active ads | Functional, correct domain, no broken links |

### 1E: Third-Party Tool Data (if applicable)

| Data Point | Source | What to Check |
|------------|--------|---------------|
| Tool connected | Third-party dashboard | Active connection to Meta Ads |
| Data freshness | Third-party dashboard | Last sync timestamp |
| Attribution model | Third-party settings | Which model is active |
| Conversion discrepancy | Compare Meta vs third-party | % difference in reported conversions |

---

## Step 2: Pixel Health Assessment

### 2A: Pixel Status Check

| Check | Pass | Warning | Fail |
|-------|------|---------|------|
| Pixel status | Active, events received in last 24 hours | Active but last event >24 hours ago | Inactive or error state |
| Standard events firing | All key events present (VC, ATC, IC, Purchase or equivalent) | Some events missing | No standard events |
| Event volume trend | Stable or growing (within 20% of 28d average) | Declining 20-40% from 28d average | Declining >40% or zero |
| Page coverage | Pixel on all key pages (landing, product, cart, checkout, thank you) | Missing on 1-2 non-critical pages | Missing on conversion pages |
| Pixel errors | Zero active errors | Warnings present (non-blocking) | Errors present (blocking conversion tracking) |

### 2B: Event Inventory

Document all events firing and classify them:

| Event | Type | 7-Day Volume | 28-Day Volume | Trend | Used for Optimization? | Status |
|-------|------|-------------|--------------|-------|----------------------|--------|
| PageView | Standard | | | | No (baseline) | |
| ViewContent | Standard | | | | | |
| AddToCart | Standard | | | | | |
| InitiateCheckout | Standard | | | | | |
| Purchase | Standard | | | | | |
| Lead | Standard | | | | | |
| CompleteRegistration | Standard | | | | | |
| [Custom events] | Custom | | | | | |

### 2C: Event Quality Assessment

| Check | What to Evaluate |
|-------|-----------------|
| Event parameters | Are value, currency, content_ids populated on Purchase events? |
| Parameter consistency | Are the same parameters sent every time for each event? |
| Value accuracy | Does reported Purchase value match actual transaction values? |
| Event deduplication (browser) | Are multiple PageView/VC events firing on single page loads? |
| Custom events | Are custom events named clearly and documented? |
| Test events | Run Events Manager > Test Events to verify real-time firing |

---

## Step 3: CAPI Status Assessment

### 3A: CAPI Implementation Check

| Check | Pass | Warning | Fail |
|-------|------|---------|------|
| CAPI active | Server events visible in Events Manager | CAPI configured but no events received | No CAPI implementation |
| Implementation method | Partner integration or CAPI Gateway (reliable) | Direct API (requires monitoring) | Manual/batch (not real-time) |
| Events covered | All key conversion events sent via CAPI | Only some events (e.g., Purchase only) | No server events |
| Real-time delivery | Events received within minutes of conversion | Events delayed >1 hour | Events delayed >24 hours or batched |

### 3B: Deduplication Verification

| Check | Pass | Warning | Fail |
|-------|------|---------|------|
| Deduplication active | 5-20% of events are deduplicated | <5% or >30% deduplication rate | 0% deduplication (event_id not matching) |
| Event ID matching | event_id parameter present in both pixel and CAPI events | event_id present but inconsistent format | event_id missing from one or both sources |
| Conversion count accuracy | Meta-reported conversions within 10% of backend data | 10-25% discrepancy | >25% discrepancy (likely double-counting or missing events) |

**Deduplication rate interpretation:**
- 0%: Either pixel or CAPI isn't firing, or event_id doesn't match. Investigate immediately.
- 1-5%: Low overlap. One system may be unreliable. Check both are firing for the same events.
- 5-20%: Healthy. Both systems are firing and Meta is correctly deduplicating.
- 20-30%: High but acceptable. Both systems are working well; high overlap means redundancy is strong.
- 30%+: Unusually high. May indicate configuration issues (e.g., CAPI firing twice per event).
- 50%+: Misconfiguration. Investigate whether CAPI or pixel is double-firing.

### 3C: Event Match Quality (EMQ) Assessment

Pull EMQ scores for each event sent via CAPI:

| Event | EMQ Score | Rating | User Parameters Sent | Missing Parameters | Action |
|-------|-----------|--------|---------------------|-------------------|--------|
| Purchase | | | | | |
| Lead | | | | | |
| AddToCart | | | | | |
| ViewContent | | | | | |
| [Others] | | | | | |

**EMQ improvement priority:**
1. Add hashed email (em) -- single biggest EMQ improvement
2. Add hashed phone (ph)
3. Pass fbclid from URL to server event
4. Include external_id (your user ID, hashed)
5. Send client IP address and user agent
6. Ensure all hashing is SHA-256, lowercase, trimmed whitespace

**EMQ impact on performance:**
- EMQ <3.0: Meta cannot reliably match events to users. Optimization is severely degraded.
- EMQ 3.0-5.0: Partial matching. You're losing optimization signal. CPA is likely 15-30% higher than it needs to be.
- EMQ 5.0-6.0: Acceptable. Most events are matched. Marginal improvement available.
- EMQ 6.0-8.0: Strong. Optimization is working well.
- EMQ 8.0+: Excellent. Maximum signal quality.

---

## Step 4: Attribution Settings Assessment

### 4A: Current Attribution Window

| Setting | Current Value | Recommended Value | Match? |
|---------|-------------|-------------------|--------|
| Attribution window | | (per business type from measurement-methodology) | |
| Click attribution | | 7-day click (standard) | |
| View attribution | | Depends on business model | |

### 4B: Attribution Window Analysis

Compare performance under different attribution windows:

| Window | Conversions | CPA | ROAS | % of 7d Click Conversions |
|--------|------------|-----|------|--------------------------|
| 1-day click | | | | |
| 7-day click | | | | 100% (baseline) |
| 7-day click + 1-day view | | | | |

**Interpretation (from measurement-methodology):**
- 7d/1d ratio 1.0-1.2x: Tight attribution, most conversions same-day
- 7d/1d ratio 1.2-1.5x: Normal delayed attribution
- 7d/1d ratio 1.5-2.0x: Significant delayed conversions, consider longer window
- 7d/1d ratio 2.0x+: Investigate. Meta may be getting credit for organic conversions.

### 4C: Attribution vs Business Type Assessment

| Business Type | Recommended Window | Current Window | Status |
|--------------|-------------------|---------------|--------|
| E-commerce (impulse) | 7-day click | | |
| E-commerce (high AOV) | 7-day click + 1-day view | | |
| SaaS / Free trial | 7-day click | | |
| Lead generation | 7-day click | | |
| B2B | 7-day click | | |
| App installs | 7-day click + 1-day view | | |

---

## Step 5: Event Configuration Assessment

### 5A: Conversion Events

| Check | What to Evaluate |
|-------|-----------------|
| Primary conversion event | Is the right event used for campaign optimization? (Purchase for ecom, Lead for lead gen, etc.) |
| Event hierarchy | Are funnel events properly sequenced? (VC > ATC > IC > Purchase) |
| Custom conversions | Are custom conversions set up where needed? (e.g., qualified lead vs any lead) |
| Conversion values | Are Purchase values accurate? Are dynamic values implemented? |
| Value optimization | For value-based campaigns: is conversion value data flowing correctly? |

### 5B: Event Funnel Health

| Funnel Stage | Events (7d) | Drop-off % | Expected Drop-off | Status |
|-------------|-------------|-----------|-------------------|--------|
| PageView | | -- | -- | |
| ViewContent | | | 40-60% from PV | |
| AddToCart | | | 70-85% from VC | |
| InitiateCheckout | | | 40-60% from ATC | |
| Purchase | | | 30-50% from IC | |

**Anomalies to flag:**
- ATC > VC: Cart events firing without ViewContent (pixel on cart page but not product page)
- Purchase > IC: Checkout step not tracked (missing InitiateCheckout event)
- Sudden volume drops: Pixel broke on specific page type
- Sudden volume spikes: Duplicate events, bot traffic, or misconfigured triggers

### 5C: Custom Conversion Assessment

| Custom Conversion | Based On | URL/Event Rule | 7d Volume | Used In Campaigns? |
|-------------------|----------|---------------|-----------|-------------------|
| | | | | |

**Assessment criteria:**
- Are custom conversions still relevant? (old campaigns may have orphaned custom conversions)
- Are rules accurate? (URL-based rules can break when site structure changes)
- Should any custom conversions be replaced with standard events?

**Critical requirement -- custom conversions for pixel event visibility:**
Meta groups all custom pixel events under `offsite_conversion.fb_pixel_custom` in insights unless a Custom Conversion is created for each event individually. This means:
- If you fire a custom pixel event (e.g., `TrialStarted`, `WorkspaceCreated`) without a Custom Conversion, you cannot see it as a distinct column in Ads Manager.
- For every custom event you want to track and optimize for in campaigns, a corresponding Custom Conversion must exist.
- Flag any custom pixel events in the account that do not have a matching Custom Conversion -- these are invisible in performance reporting.

---

## Step 6: UTM and Third-Party Tool Audit

### 6A: UTM Structure Assessment

Sample 10+ active ads and evaluate UTM consistency:

| Parameter | Expected Format | Sample 1 | Sample 2 | Sample 3 | Consistent? |
|-----------|----------------|----------|----------|----------|------------|
| utm_source | `meta` | | | | |
| utm_medium | `cpc` | | | | |
| utm_campaign | `{{campaign.name}}` or manual | | | | |
| utm_content | `{{ad.name}}` or manual | | | | |
| utm_term | `{{adset.name}}` or manual | | | | |

**UTM issues to flag:**
- Missing UTMs entirely (no attribution in GA4)
- Inconsistent source naming (some ads use "facebook", others use "meta", others use "fb")
- Uppercase characters (UTMs are case-sensitive in most analytics tools)
- Spaces in parameters (causes parsing errors)
- Static UTMs that don't match actual campaign/ad names (stale after renaming)
- No dynamic parameters used (manual UTMs are error-prone at scale)

### 6B: GA4 Alignment Check

| Check | Pass | Fail |
|-------|------|------|
| Meta traffic showing in GA4 | Source/medium = meta/cpc (or facebook/cpc) | No Meta traffic in GA4 or attributed to (direct) / (none) |
| Conversion events aligned | GA4 purchase/lead events match Meta's reported conversions (within 20%) | >30% discrepancy between GA4 and Meta |
| Landing page tracking | Landing pages from Meta ads show in GA4 | Landing pages not tracked or miscategorized |

### 6C: Third-Party Tool Assessment

| Check | Criteria |
|-------|---------|
| Tool appropriateness | Monthly spend vs tool tier (from measurement-methodology: <$10K = no tool, $10-50K = consider, $50K+ = implement) |
| Connection status | Active connection to Meta Ads API? Last sync within 24 hours? |
| Attribution model | Which model is active? Is it appropriate for the business? |
| Conversion discrepancy | Meta-reported conversions vs third-party. Expected: third-party reports 60-90% of Meta's numbers |
| Cross-platform view | Is the tool also connected to Google, TikTok, email, etc.? |

**Discrepancy benchmarks:**
- Third-party reports 80-100% of Meta conversions: Healthy, minimal over-attribution by Meta
- Third-party reports 60-80% of Meta conversions: Normal, Meta has moderate self-attribution bias
- Third-party reports 40-60% of Meta conversions: Significant gap. Investigate view-through attribution, long windows, or Meta counting assisted conversions
- Third-party reports <40% of Meta conversions: Major discrepancy. Possible CAPI issues, deduplication problems, or Meta attribution settings too broad

---

## Checkpoint: Present Measurement Health Summary

Before generating the full report, present the scorecard:

```
Measurement Health Scorecard
================================

Account: [Account Name]
Audit Date: [Date]
Maturity Level: [Nascent / Developing / Established / Advanced]

Layer 1: Pixel Health          [PASS / WARNING / FAIL]
  - Status: [Active / Issues]
  - Events firing: [X standard, Y custom]
  - Errors: [None / List]

Layer 2: CAPI                  [PASS / WARNING / FAIL / N/A]
  - Status: [Active / Inactive / Not Implemented]
  - Deduplication: [Working / Not Working / N/A]
  - EMQ: [Score for primary event]

Layer 3: Attribution           [PASS / WARNING / FAIL]
  - Window: [Current setting]
  - Recommendation: [Change / Keep]

Layer 4: Events                [PASS / WARNING / FAIL]
  - Primary conversion: [Event name]
  - Funnel completeness: [Complete / Gaps]
  - Value tracking: [Active / Missing]

Layer 5: UTMs / Third-Party    [PASS / WARNING / FAIL]
  - UTM consistency: [Consistent / Issues]
  - Third-party tool: [Name / None / Not needed]

Overall Health: [Healthy / Needs Attention / Critical]
Priority Actions: [X items]
```

**Wait for user confirmation before generating the full report.**

---

## Step 7: Output

```markdown
# Measurement Infrastructure Audit

**Account:** [Name] | **Pixel ID:** [ID]
**Audit Date:** [Date] | **Maturity Level:** [Level]
**Monthly Spend:** [Amount]

## Executive Summary

[2-3 sentences: overall measurement health, biggest risk, most impactful fix]

## Measurement Health Scorecard

| Layer | Component | Status | Score | Priority Actions |
|-------|-----------|--------|-------|-----------------|
| 1 | Pixel Health | | /10 | |
| 2 | CAPI Implementation | | /10 | |
| 2 | Deduplication | | /10 | |
| 2 | Event Match Quality | | /10 | |
| 3 | Attribution Settings | | /10 | |
| 4 | Event Configuration | | /10 | |
| 4 | Conversion Values | | /10 | |
| 5 | UTM Structure | | /10 | |
| 5 | GA4 Alignment | | /10 | |
| 5 | Third-Party Attribution | | /10 | |
| -- | **Overall** | | **/100** | |

## Layer 1: Pixel Health

### Status
[Active/Issues/Critical]

### Events Inventory
[Table from Step 2B]

### Issues Found
[List of pixel issues with severity]

### Recommendations
[Ordered list of pixel fixes]

## Layer 2: CAPI and Event Match Quality

### CAPI Status
[Implementation method, active/inactive, coverage]

### Deduplication Status
[Rate, interpretation, issues]

### EMQ Scores
[Table from Step 3C]

### EMQ Improvement Plan
[Ordered steps to improve EMQ, with expected score lift per step]

## Layer 3: Attribution Settings

### Current Configuration
[Current window, comparison analysis]

### Recommendation
[Keep or change window, with rationale based on business type]

### Attribution Window Comparison
[Table from Step 4B]

## Layer 4: Event Configuration

### Conversion Events
[Assessment from Step 5A]

### Funnel Health
[Table from Step 5B, anomalies flagged]

### Custom Conversions
[Assessment from Step 5C]

## Layer 5: UTMs and Third-Party Tools

### UTM Audit
[Consistency assessment from Step 6A]

### GA4 Alignment
[Status from Step 6B]

### Third-Party Attribution
[Assessment from Step 6C, or recommendation to implement]

## Action Plan

### P0: Fix Immediately (Data at Risk)
1. [Action] - [Component] - [Expected impact] - [Estimated effort]
2. ...

### P1: Fix This Week (Optimization Degraded)
1. [Action] - [Component] - [Expected impact] - [Estimated effort]
2. ...

### P2: Fix This Month (Improvement Opportunity)
1. [Action] - [Component] - [Expected impact] - [Estimated effort]
2. ...

### P3: Quarterly Review Items
1. [Action] - [Cadence] - [Expected impact]
2. ...

## Measurement Maturity Roadmap

### Current State: [Level]
### Target State: [Next Level]
### Steps to Advance:
1. [Requirement] - [Status: Done / In Progress / Not Started]
2. ...
```

---

## Quick Reference: Common Measurement Issues and Fixes

| Issue | Symptom | Root Cause | Fix | Priority |
|-------|---------|-----------|-----|----------|
| Double-counted conversions | CPA appears too low vs reality | CAPI event_id not matching pixel event_id | Align event_id generation across pixel and CAPI | P0 |
| Missing conversions | CPA appears too high, Meta under-reports | Pixel not on all conversion pages, or CAPI inactive | Verify pixel coverage, implement/fix CAPI | P0 |
| Low EMQ | Optimization underperforming, high CPA | Missing user parameters in CAPI events | Add hashed email, phone, fbclid, external_id | P1 |
| Attribution inflation | Meta claims more conversions than actually occurred | Attribution window too broad, or view-through included | Compare 1d click vs 7d click, evaluate view-through contribution | P1 |
| GA4 / Meta discrepancy | Different conversion counts across platforms | UTM inconsistency, different attribution models | Standardize UTMs, compare apples-to-apples windows | P2 |
| Stale Custom Audiences | Retargeting performance declining | Pixel events not firing for audience source | Audit pixel on audience-source pages (e.g., product pages for VC audiences) | P1 |
| Modeled conversion noise | EU/iOS conversion data appears volatile | Low consent rate or low CAPI data volume | Improve consent UX, strengthen CAPI implementation | P2 |

---

## Execution Capability

After generating the measurement health report, this skill can queue draft actions for human approval. No changes execute automatically.

### Execution vs Analysis

| Action | Execution Method | Requires Human Approval? |
|--------|-----------------|--------------------------|
| Check pixel event stats | `get_pixel_stats` via MCP | No approval needed (read-only) |
| Check CAPI setup status | `get_server_events_setup` via MCP | No approval needed (read-only) |
| Create a Custom Conversion for a specific pixel event | `create_custom_conversion` via MCP | Yes -- shows draft before executing |
| Send a test CAPI event to verify implementation | `send_server_event` via MCP | Yes -- shows draft before executing |
| Configure pixel settings, update event rules | Manual in Events Manager | Cannot execute via MCP |

### Step 7 Addition: Proposed Actions Queue

After the measurement health report is generated and confirmed by the user, produce a draft action queue for any executable remediation items.

```
Proposed Actions -- Measurement Audit
=======================================
Review each action below. Confirm to execute, skip, or modify.

[ ] Action 1: Create Custom Conversion -- "Viktor -- Trial Started"
    Tool: create_custom_conversion
    Pixel ID: {pixel_id}
    Event: TrialStarted (custom pixel event)
    Rule: pixel event name = "TrialStarted"
    Reason: Custom event is firing but not visible as a distinct metric in Ads Manager
    without a Custom Conversion. Required for optimization and reporting.
    Status: DRAFT -- awaiting approval

[ ] Action 2: Create Custom Conversion -- "Viktor -- Workspace Created"
    Tool: create_custom_conversion
    Pixel ID: {pixel_id}
    Event: WorkspaceCreated (custom pixel event)
    Rule: pixel event name = "WorkspaceCreated"
    Reason: Same as above -- currently grouped under offsite_conversion.fb_pixel_custom
    Status: DRAFT -- awaiting approval

[ ] Action 3: Send test CAPI event -- verify Purchase event delivery
    Tool: send_server_event
    Event: Purchase
    Test mode: true
    User data: {test_hashed_email}
    Reason: CAPI deduplication rate is 0% -- verify server events are actually reaching Meta
    Status: DRAFT -- awaiting approval (sends test data only, does not affect live campaigns)
```

**Only proceed with each action after explicit user confirmation per item.**

---

## Reference Files

- `references/data_requirements.md` - MCP tools, API calls, and manual data pull instructions for each data point in this audit
