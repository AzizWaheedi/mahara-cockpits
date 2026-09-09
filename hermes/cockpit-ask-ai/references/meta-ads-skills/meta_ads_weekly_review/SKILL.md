---
name: meta_ads_weekly_review
description: Orchestration skill that coordinates all 28 Meta Ads action skills into a structured weekly review workflow. Determines which skills to run for which accounts based on campaign types, maturity level, and cadence (weekly/monthly/quarterly). Includes 4 mandatory human checkpoints for recommendation review before output.
triggers:
  - "meta ads weekly review"
  - "weekly review"
  - "meta ads review"
  - "account review"
  - "weekly ads check"
  - "run weekly review"
  - "meta ads audit"
---

# Meta Ads Weekly Review (Orchestration)

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

This is the master orchestration skill for the Meta Ads Toolkit. It coordinates all action skills into a structured weekly review workflow, replacing the manual process of logging into Ads Manager, pulling data, eyeballing metrics, and reacting to whatever looks wrong. Instead, it runs a systematic diagnostic across every dimension of account health -- performance, creative, bidding, audiences, structure, budgets, measurement, compliance -- and produces a unified report with prioritized recommendations.

The orchestrator determines which skills to run for which accounts based on campaign types, maturity level, and review cadence. It includes 4 mandatory human checkpoints to ensure recommendations are reviewed before being finalized. This is not an autopilot; it is a co-pilot.

## When to Use

- **Weekly:** Every Monday or Tuesday as the standard review cadence
- **Monthly:** First run of the month includes deeper audits (audiences, structure, measurement, budgets)
- **Quarterly:** First run of the quarter adds compliance audit and maturity reassessment
- **Ad-hoc:** When something feels off and you want a full diagnostic
- **Onboarding:** First run for a new account (runs all skills regardless of cadence)

## Dependencies

This skill orchestrates all other action skills. It does not perform analysis itself -- it routes, sequences, and synthesizes.

| Skill Category | Skills |
|---------------|--------|
| **Always loaded** | `account_conventions`, `account_maturity_methodology` |
| **Action skills (weekly)** | `performance_analysis`, `analyze_creative` (with execution), `performance_analysis` follow-up |
| **Action skills (bi-weekly)** | `audit_audiences` (with execution), `audit_bidding` (with execution), `manage_automated_rules` |
| **Action skills (monthly)** | `optimize_budgets` (with execution), `audit_measurement` (with execution), `audit_structure` |
| **Action skills (quarterly)** | `audit_compliance`, `analyze_advantage_plus`, `analyze_catalog` (with execution) |
| **Action skills (on-demand)** | `launch_campaign`, `investigate_campaign` (triggered by flags), `generate_creative_brief`, `manage_ab_tests` |

---

## Step 0: Load Configuration and Determine Scope

### Read Account Config

Read `account-conventions/SKILL.md` and extract the full account roster:

For each account:
- `account_name`, `ad_account_id`
- `status` (active, paused, onboarding)
- `maturity_level` (nascent, developing, established, advanced)
- `monthly_spend` (for context and prioritization)
- `capabilities` (has_advantage_plus, has_catalog, campaign_types_active)
- `kpi_config` (targets, thresholds)
- `creative_config` (testing framework, volume targets)
- `reporting` (period, comparison, output_path, output_naming)

### Present Account Roster

```
Meta Ads Weekly Review -- Pre-Flight
=====================================
Date: {today}
Review type: {Weekly / Monthly / Quarterly} (auto-detected from date)

Account Roster:
| # | Account | Status | Maturity | Monthly Spend | Last Reviewed |
|---|---------|--------|----------|---------------|---------------|
| 1 | {name}  | Active | Established | $30K | {date} |
| 2 | {name}  | Active | Developing | $8K | {date} |

Reporting Period: {calculated from config}
Comparison: {comparison method from config}
```

### Calculate Review Cadence

Determine what type of review this is:

```python
# Pseudocode for cadence detection
today = current_date()
is_first_run_of_month = today.day <= 7 or last_review_date.month != today.month
is_first_run_of_quarter = is_first_run_of_month and today.month in [1, 4, 7, 10]
is_onboarding = account.last_review_date is None

if is_onboarding:
    cadence = "onboarding"  # Run everything
elif is_first_run_of_quarter:
    cadence = "quarterly"
elif is_first_run_of_month:
    cadence = "monthly"
else:
    cadence = "weekly"
```

### Ask About Special Circumstances

Before proceeding, ask:
- Were any campaigns paused, launched, or significantly changed since last review?
- Any upcoming events (promotions, seasonal peaks, product launches)?
- Budget changes (increases, decreases, new budget allocated)?
- Known issues or areas of concern?

**Checkpoint 1: Confirm accounts, date range, cadence, and special circumstances before proceeding.**

---

## Step 1: Authentication Check

### Verify MCP Connection

Test the Meta Ads integration by running:

```python
import asyncio
from sdk.tools.mcp_meta_ads import meta_ads_list_ad_accounts

async def main():
    result = await meta_ads_list_ad_accounts()
    print(result)

asyncio.run(main())
```

- Confirm the MCP server is connected and responding
- Verify each account in the config roster is accessible
- If connection fails, the user needs to connect Meta Ads via Viktor integrations. Use `get_integration_connect_url("meta_ads")` (see `skills/integrations/SKILL.md`)
- If any account returns an error, flag it and exclude from the review (do not block other accounts)

### Access Verification

For each account, confirm:
- Account ID is valid and accessible
- User has sufficient permissions (at minimum: read access to campaigns, ad sets, ads, insights)
- API rate limits are not already exhausted

**Do NOT proceed past this step until authentication is confirmed for at least one account.** If all accounts fail auth, stop and troubleshoot.

---

## Step 2: Skill Routing

Based on each account's capabilities, cadence, and maturity, determine which skills to run.

### Routing Matrix

| Condition | Skill | Cadence | Notes |
|-----------|-------|---------|-------|
| All active accounts | performance_analysis | Every run | Always first. Establishes baseline and generates flags. |
| All active accounts | analyze_creative | Weekly (with execution) | Creative fatigue, scorecard, pause/refresh actions. |
| All active accounts | audit_bidding | Bi-weekly (with execution) | Bid strategy health check and bid updates. |
| All active accounts | audit_audiences | Bi-weekly (with execution) | Audience overlap, saturation, expansion. |
| All active accounts | manage_automated_rules | Bi-weekly | Rule coverage audit, gap fill, execution history check. |
| All active accounts | optimize_budgets | Monthly (with execution) | Budget reallocation and scaling. |
| All active accounts | audit_measurement | Monthly (with execution) | Pixel, CAPI, attribution settings. |
| All active accounts | audit_structure | Monthly | Campaign architecture and consolidation. |
| All active accounts | audit_compliance | Quarterly | Policy, ad disapprovals, account health. |
| has_advantage_plus = true | analyze_advantage_plus | Quarterly | ASC-specific analysis. Skip if no ASC campaigns. |
| has_catalog = true | analyze_catalog | Quarterly (with execution) | Catalog/DPA analysis and feed quality fixes. |
| On-demand | launch_campaign | As needed | New campaign creation from brief. Triggered by user request. |
| Flagged campaigns | investigate_campaign | As needed | Triggered by red flags from performance-analysis. |
| All active accounts | generate_creative_brief | Per config | Weekly or monthly depending on creative_config. |
| All active accounts | manage_ab_tests | On-demand | Triggered by user request for experiment setup or review. |

### Onboarding Override

For accounts with `cadence = "onboarding"`, run ALL skills regardless of cadence rules. This establishes the baseline for future reviews.

### Present Routing Matrix

```
Skill Routing for This Review
===============================
Cadence: {Weekly / Monthly / Quarterly / Onboarding}

| Account | performance | creative | bidding | A+ | catalog | audiences | structure | measurement | budgets | compliance | brief | investigate |
|---------|------------|---------|---------|----|---------|-----------|-----------|----|---------|------------|-------|-------------|
| {name}  | Yes | Yes | Yes | Yes | No | {Monthly?} | {Monthly?} | {Monthly?} | {Monthly?} | {Quarterly?} | {Config} | {If flagged} |

Total skill invocations: {count}
Estimated duration: {minutes} (based on account count and skill count)
```

**Checkpoint 2: Confirm routing matrix. User can add/remove skills for specific accounts.**

---

## Step 3: Execute Per Account

Process each account sequentially. Within each account, skills are executed in a specific order due to dependencies.

### Phase 3a: Performance Baseline (Sequential, First)

Run `performance_analysis` for the account.

This must complete first because:
- It establishes the performance context all other skills reference
- It generates the flag list that triggers investigate_campaign
- It identifies campaigns that need deeper analysis

**Capture from performance-analysis:**
- Account health status (healthy/warning/critical)
- Active flags list (with severity and recommended skill)
- Campaign-level performance summary
- 4-week trend data

### Phase 3b: Independent Skills (Parallel Where Possible)

These skills can run independently of each other (but all depend on Phase 3a):

- `analyze_creative` -- creative scorecard, fatigue detection
- `audit_bidding` -- bid strategy assessment, strategy recommendations
- `analyze_advantage_plus` (if applicable) -- ASC performance, manual vs ASC comparison
- `analyze_catalog` (if applicable) -- catalog health, feed quality, DPA performance

**Capture from each:**
- Key findings list
- Flagged items
- Recommendations with priority

### Phase 3c: Dependent Skills (Sequential, After 3b)

These skills depend on findings from Phase 3b:

- `optimize_budgets` -- needs bidding context from audit-bidding, pacing from performance-analysis
- `investigate_campaign` -- triggered for any campaign with red flags from 3a or 3b

**Capture from each:**
- Budget reallocation table (from optimize-budgets)
- Root cause analysis (from investigate-campaign)

### Phase 3d: Monthly/Quarterly Skills (If Cadence Applies)

Only run if the cadence trigger is met:

- `audit_audiences` (monthly) -- overlap analysis, saturation, expansion
- `audit_structure` (monthly) -- campaign architecture, consolidation opportunities
- `audit_measurement` (monthly) -- pixel health, CAPI, attribution
- `audit_compliance` (quarterly) -- policy compliance, ad disapprovals

### Phase 3e: Creative Brief Generation (If Configured)

Run `generate_creative_brief` based on:
- Fatigue alerts from analyze_creative
- Format and concept gaps identified
- Config setting for creative brief cadence

### Phase 3f: Collect All Findings

Aggregate all findings into a unified structure:

```
Account: {name}
Health Status: {Healthy / Warning / Critical}
Skills Run: {list}
Total Flags: {count} (Red: {count}, Yellow: {count})

Findings by Skill:
- performance-analysis: {summary}
- analyze-creative: {summary}
- audit-bidding: {summary}
- analyze-advantage-plus: {summary or "N/A"}
- analyze-catalog: {summary or "N/A"}
- optimize-budgets: {summary or "Not run this cadence"}
- investigate-campaign: {summary or "No campaigns investigated"}
- audit-audiences: {summary or "Not run this cadence"}
- audit-structure: {summary or "Not run this cadence"}
- audit-measurement: {summary or "Not run this cadence"}
- audit-compliance: {summary or "Not run this cadence"}
- generate-creative-brief: {summary or "Not run this cadence"}

Top Recommendations (ranked by impact):
1. {recommendation}
2. {recommendation}
3. {recommendation}
```

---

## Step 4: Recommendations Checkpoint (Mandatory)

**This is Checkpoint 3. It is NEVER skipped, even if the user says "skip checkpoints."**

Recommendations require human sign-off because they involve budget changes, campaign modifications, and strategic direction. Autonomous execution of ad account changes creates real financial risk.

### Consolidated Recommendations View

```
Meta Ads Weekly Review -- Recommendations
===========================================
Date: {today}
Period: {date_range}

Account Health Summary:
| Account | Status | Spend | CPA | ROAS | WoW CPA | Flags |
|---------|--------|-------|-----|------|---------|-------|
| {name}  | Warning | $X,XXX | $XX | X.Xx | +15% | 3 (1 red, 2 yellow) |

Top 3 Recommendations per Account:

### {Account Name 1}
1. **[HIGH] Reallocate $200/day from {Campaign A} to {Campaign B}**
   Source: optimize_budgets
   Rationale: Campaign A at diminishing returns (marginal CPA $95), Campaign B constrained-efficient (CPA $42)
   Projected impact: +4 conversions/day, blended CPA improvement from $52 to $47

2. **[HIGH] Pause 3 fatigued creatives, launch 5 replacements**
   Source: analyze_creative
   Rationale: 3 ads in critical fatigue (CTR down 25%+, frequency >3.0)
   Action: Pause VID_TESTIMON_V2, STAT_DEMO_V4, UGC_PAIN_V1. Briefs generated.

3. **[MEDIUM] Switch Campaign C from LCAP to CBO auto-bid**
   Source: audit_bidding
   Rationale: Cost cap too tight, campaign underdelivering at 45% pacing
   Risk: CPA may spike 20% short-term during learning. Monitor 72h.

Cross-Account Patterns:
- {pattern, e.g., "CPM rising across all accounts -- likely seasonal auction pressure"}
- {pattern}

Critical Flags Requiring Immediate Action:
- {flag description and recommended response}
```

**Wait for user to confirm, modify, or reject recommendations before generating output.**

If the user modifies recommendations, update the output accordingly.

---

## Step 5: Output Generation

### Per-Account Reports

For each account, write a comprehensive markdown report.

**File path:** `{reporting.output_path}/{account_name}-weekly-review-{date}.md`

```markdown
# Meta Ads Weekly Review: {account_name}
Generated: {date} | Period: {date_range}
Review Type: {Weekly / Monthly / Quarterly}
Account Maturity: {maturity_level}

## Executive Summary

### Account Health: {Healthy / Warning / Critical}

| Metric | Current | Prior | Delta | Target | Flag |
|--------|---------|-------|-------|--------|------|
| Spend | $X,XXX | $X,XXX | +XX% | $XX,XXX/mo | -- |
| Conversions | XXX | XXX | +XX% | -- | Green |
| CPA | $XX.XX | $XX.XX | +XX% | $XX.XX | Yellow |
| ROAS | X.Xx | X.Xx | -XX% | X.Xx | Yellow |

### Top 3 Action Items
1. {Action} -- {Source skill} -- {Expected impact}
2. {Action} -- {Source skill} -- {Expected impact}
3. {Action} -- {Source skill} -- {Expected impact}

## Performance Dashboard
{Full output from performance_analysis}

## Creative Analysis
{Summary from analyze_creative}
- Star performers: {count}
- Fatigued: {count}
- Kill candidates: {count}
- Testing velocity: {actual} vs {target}/week

## Bidding Assessment
{Summary from audit_bidding}
- Campaigns with optimal bid strategy: {count}/{total}
- Recommended changes: {list}

## Advantage+ Analysis
{Summary from analyze_advantage_plus, or "N/A -- no ASC campaigns"}

## Catalog Analysis
{Summary from analyze_catalog, or "N/A -- no catalog campaigns"}

## Budget Optimization
{Summary from optimize_budgets, if run}
- Reallocation table: {included if generated}
- Scaling schedule: {included if generated}

## Campaign Investigations
{Summary from investigate_campaign for each investigated campaign}

## Audience Audit
{Summary from audit_audiences, if run this cadence, or "Next scheduled: {date}"}

## Structure Audit
{Summary from audit_structure, if run this cadence, or "Next scheduled: {date}"}

## Measurement Audit
{Summary from audit_measurement, if run this cadence, or "Next scheduled: {date}"}

## Compliance Audit
{Summary from audit_compliance, if run this cadence, or "Next scheduled: {date}"}

## Creative Briefs
{Summary from generate_creative_brief, if run}
- Concepts generated: {count}
- Briefs ready for production: {count}

## Active Flags

| # | Flag | Scope | Value | Threshold | Severity | Action | Owner |
|---|------|-------|-------|-----------|----------|--------|-------|
| 1 | CPA_CRIT | {Campaign} | $45 | $30 | Red | Investigate | {owner} |
| 2 | CTR_DECLINE | {Campaign} | 3 weeks | 3 weeks | Yellow | Creative refresh | {owner} |

## Recommendations (Approved)

| # | Priority | Recommendation | Source | Projected Impact | Timeline | Status |
|---|----------|---------------|--------|-----------------|----------|--------|
| 1 | High | {recommendation} | /skill | {impact} | This week | Approved |
| 2 | High | {recommendation} | /skill | {impact} | This week | Approved |
| 3 | Medium | {recommendation} | /skill | {impact} | Next week | Approved |

## Follow-Up Items

| Item | Owner | Deadline | Status |
|------|-------|----------|--------|
| {follow-up} | {owner} | {date} | Pending |

## Notes
- {Any caveats, data gaps, or context}
- Next review: {date}
- Next monthly review: {date}
- Next quarterly review: {date}
```

### Cross-Account Summary (if multiple accounts)

Only generate if `include_cross_account_summary: true` in config or if reviewing 2+ accounts.

```markdown
# Meta Ads Cross-Account Summary
Generated: {date} | Period: {date_range}

## Portfolio Overview

| Account | Status | Spend | Conv | CPA | ROAS | WoW CPA | Top Flag |
|---------|--------|-------|------|-----|------|---------|----------|
| {name} | Warning | $X,XXX | XX | $XX | X.Xx | +15% | CPA_CRIT |
| {name} | Healthy | $X,XXX | XX | $XX | X.Xx | -5% | None |

## Portfolio Totals

| Metric | Total | WoW Change |
|--------|-------|------------|
| Spend | $XX,XXX | +XX% |
| Conversions | XXX | +XX% |
| Blended CPA | $XX.XX | +XX% |
| Weighted ROAS | X.Xx | +XX% |

## Cross-Account Patterns
1. {pattern and implication}
2. {pattern and implication}

## Portfolio Recommendations
1. {recommendation affecting multiple accounts}

## Account-Level Summaries
{One-paragraph summary per account with link to full report}
```

---

## Step 6: Memory and Follow-Up

### Record Review Metadata

Ask the user if they want to save review findings for next week's comparison:

- Account health status (for trend tracking across reviews)
- Key metrics snapshot (for WoW review-over-review comparison)
- Open flags (for carry-forward tracking)
- Recommendations status (approved/rejected/deferred)

### Compile Follow-Up Items

From all skills, extract items that require action before next review:

| Item | Source Skill | Owner | Deadline | Priority |
|------|-------------|-------|----------|----------|
| Reallocate $200/day from Campaign A to B | optimize_budgets | {owner} | By {date} | High |
| Launch 5 replacement creatives | generate_creative_brief | {owner} | By {date} | High |
| Switch Campaign C to auto-bid | audit_bidding | {owner} | By {date} | Medium |
| Set up CAPI for website events | audit_measurement | {owner} | By {date} | Medium |

### Prompt Config Updates

Based on review findings, check if any config values need updating:

- **Maturity level:** Has the account graduated (e.g., from Developing to Established)?
- **KPI targets:** Are targets still realistic based on 4-week trends?
- **Flag thresholds:** Are warning/critical thresholds generating too many or too few flags?
- **Creative config:** Does the testing framework or volume target need adjustment?
- **Capabilities:** Has ASC been launched or a catalog been added since last config update?

### Note Campaigns for Next Review

Flag campaigns that should get extra attention next week:
- Campaigns that just received budget changes (monitor stability)
- Campaigns with new creatives launching (track initial performance)
- Campaigns that were flagged but not investigated this week
- Any experiments approaching their kill date

**Checkpoint 4: Confirm files written, memory items saved, follow-up list complete, and config updates (if any).**

---

## Checkpoint Protocol Summary

| # | When | What to Confirm | Can User Skip? |
|---|------|-----------------|----------------|
| 1 | Pre-flight (Step 0-1) | Accounts, date range, auth status, special circumstances | Yes (proceed with defaults) |
| 2 | Post-routing (Step 2) | Skill routing matrix per account, cadence detection | Yes (proceed with auto-routing) |
| 3 | Post-analysis (Step 4) | Top 3 recommendations per account, cross-account patterns, critical flags | **No. Never skip.** |
| 4 | Post-output (Step 5-6) | Files written, memory items, follow-up list, config updates | Yes (proceed with defaults) |

If the user says "skip checkpoints" or "run automatically," Checkpoints 1, 2, and 4 can be streamlined (present briefly, proceed unless user objects). Checkpoint 3 must always pause for explicit confirmation.

---

## Cadence Guide

| Cadence | Scope | Skills Run | When |
|---------|-------|-----------|------|
| **Weekly** | Performance baseline, creative fatigue + execution, pacing flags | performance-analysis, analyze-creative (with execution), investigate-campaign (if flagged), generate-creative-brief (per config) | Every run |
| **Bi-weekly** | + Audience health, bidding strategy updates, automated rule coverage | + audit-audiences (with execution), audit-bidding (with execution), manage-automated-rules | Every other week |
| **Monthly** | + Budget optimization, measurement audit, structure review | + optimize-budgets (with execution), audit-measurement (with execution), audit-structure | First run of the month |
| **Quarterly** | + Compliance audit, A+ analysis, catalog analysis, maturity reassessment | + audit-compliance, analyze-advantage-plus, analyze-catalog (with execution), maturity reassessment | First run of the quarter |
| **On-demand** | New campaigns, investigations, experiment management, rule setup | launch-campaign, investigate-campaign, generate-creative-brief, manage-ab-tests, manage-automated-rules | Triggered by user request |
| **Onboarding** | All skills, full baseline | All skills regardless of cadence | First ever run for an account |

---

## Error Handling

| Issue | Detection | Resolution |
|-------|----------|------------|
| MCP authentication failure | meta_ads_list_ad_accounts returns error | Stop at Step 1. Instruct user to verify MCP connection and API credentials. Do not attempt to run any skills. |
| Partial account access | Some accounts accessible, others not | Proceed with accessible accounts. Flag inaccessible ones in the report. Include troubleshooting notes. |
| Skill execution failure | An action skill returns an error mid-run | Log the error, skip that skill for the affected account, continue with remaining skills. Note the gap in the final report. |
| Excessive flags (>20 per account) | Flag count from performance-analysis | Prioritize flags by severity and spend impact. Present top 10, note remaining count. Likely indicates a structural or measurement issue. |
| Very large account (>50 campaigns) | Campaign count from performance-analysis | May hit API rate limits. Batch skills and add delays between calls. Focus on active, spending campaigns first. Deprioritize paused campaigns. |
| First-time run with no config | account-conventions not configured | Run the setup questionnaire from account-conventions before proceeding. Cannot run review without at minimum: ad_account_id, primary KPI, and KPI targets. |
| Conflicting recommendations | Different skills suggest opposite actions | Flag the conflict in Checkpoint 3. Example: optimize-budgets says scale Campaign A, but audit-audiences says audience is saturated. Present both perspectives and let user decide. |
| Review takes too long | Total execution exceeds 30 minutes | Batch accounts: complete one account fully before starting the next. Provide interim updates after each account. User can stop early and resume later. |

---

## Reference Files

- `references/routing_matrix.md` -- Complete routing logic with decision trees, cadence calculation, and capability-based routing
- `references/output_templates.md` -- Full report templates for per-account and cross-account summaries, with field definitions and formatting rules
