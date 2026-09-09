---
name: audit_structure
description: Action skill that audits campaign structure for Meta Ads accounts. Assesses adherence to the three-campaign model, identifies fragmentation, evaluates CBO vs ABO usage, and checks naming convention compliance. Produces restructuring recommendations.
triggers:
  - "audit structure"
  - "campaign structure review"
  - "account structure audit"
  - "restructure campaigns"
  - "simplify account"
  - "too many campaigns"
  - "naming convention check"
---

# Audit Structure

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

Execute a structured campaign architecture audit for a Meta Ads account. This skill assesses whether the account follows the recommended simplified campaign model, identifies structural fragmentation that impairs Meta's learning algorithm, evaluates CBO vs ABO usage appropriateness, checks naming convention compliance for automated parsing, and evaluates Advantage+ Shopping Campaign (ASC) adoption. The output is a restructuring plan with implementation timeline.

## When to Use

- Account has >10 active campaigns and performance is inconsistent
- CPA rising and audit-bidding and analyze-creative found no clear cause (structure may be the bottleneck)
- Onboarding a new account (first audit to assess baseline structure)
- After a major strategy shift (new product, new market, new creative approach)
- When ad sets are stuck in "Learning Limited" across multiple campaigns
- When the account manager asks "should I consolidate?"

## Dependencies

| Skill | Why It's Needed |
|-------|----------------|
| `account_conventions` | Naming conventions, capability flags, campaign_types_active |
| `campaign_structure_methodology` | Three-campaign model, consolidation rules, ASC guidelines, CBO/ABO decision framework |
| `account_maturity_methodology` | Maturity determines structural complexity tolerance |

---

## Step 0: Load Dependencies

1. **Read `account-conventions/SKILL.md`** and extract for the target account:
   - `ad_account_id`, `currency`, `timezone`
   - `kpi_config` (targets for learning phase viability assessment)
   - `naming_conventions` (campaign, ad_set, ad patterns and tokens)
   - `capabilities` (has_advantage_plus, has_catalog, campaign_types_active)
   - `maturity_level`
   - `monthly_conversion_volume` (critical for learning phase math)
   - `data_source.method`

2. **Read `campaign-structure-methodology/SKILL.md`** and load:
   - Three-campaign model definition (Prospecting, Retargeting, ASC/Testing)
   - Maximum campaign count guidelines by maturity and spend
   - CBO vs ABO decision framework
   - Ad set consolidation rules (50 conversions/week minimum)
   - ASC structure best practices
   - Fragmentation detection criteria

3. **Read `account-maturity-methodology/SKILL.md`** and determine:
   - Recommended structural complexity:
     - **Nascent:** 1-2 campaigns, CBO, broad targeting, minimal ad sets
     - **Developing:** 2-4 campaigns, CBO primary, introduce retargeting
     - **Established:** 3-6 campaigns, mix of CBO/ABO, full funnel
     - **Advanced:** 5-10 campaigns, sophisticated structure, ASC + manual hybrid

**Validation gate:** If `ad_account_id` is missing, stop. If `naming_conventions` are not configured, the naming audit step will be limited (flag this to the user).

---

## Step 1: Data Acquisition

### Full Account Structure

```
SDK call: `meta_ads_list_campaigns()` (from `sdk/tools/mcp_meta_ads`)
Parameters:
  account_id: {ad_account_id}
  fields:
    - id
    - name
    - status
    - effective_status
    - objective
    - bid_strategy
    - daily_budget
    - lifetime_budget
    - buying_type
    - special_ad_categories
    - created_time
  filtering:
    - field: "effective_status"
      operator: "IN"
      value: ["ACTIVE", "PAUSED"]
```

### Ad Set Structure

```
SDK call: `meta_ads_list_ad_sets()` (from `sdk/tools/mcp_meta_ads`)
Parameters:
  account_id: {ad_account_id}
  fields:
    - id
    - name
    - campaign_id
    - status
    - effective_status
    - targeting
    - optimization_goal
    - bid_strategy
    - bid_amount
    - daily_budget
    - lifetime_budget
    - learning_phase_info
    - created_time
  filtering:
    - field: "effective_status"
      operator: "IN"
      value: ["ACTIVE", "PAUSED"]
```

### Ad Count per Ad Set

```
SDK call: `meta_ads_list_ads()` (from `sdk/tools/mcp_meta_ads`)
Parameters:
  account_id: {ad_account_id}
  fields:
    - id
    - name
    - adset_id
    - status
    - effective_status
    - created_time
  filtering:
    - field: "effective_status"
      operator: "IN"
      value: ["ACTIVE"]
```

### Performance Data (for learning phase and conversion volume)

```
SDK call: `meta_ads_get_insights()` (from `sdk/tools/mcp_meta_ads`)
Parameters:
  account_id: {ad_account_id}
  level: "adset"
  time_range: "last_7d"
  fields:
    - adset_id
    - adset_name
    - campaign_id
    - campaign_name
    - impressions
    - spend
    - conversions
    - cost_per_action_type
```

### CSV Fallback

If data_source.method = "csv":
1. Campaign list export with all settings (objective, budget type, bid strategy, status)
2. Ad set list export with targeting, budget, learning phase status
3. Ad list with ad set mapping
4. Ad set-level performance, last 7 days

---

## Step 2: Structure Assessment

### Account Inventory

Build a complete structural map:

```
Account: {name} ({ad_account_id})
Active Campaigns: {count}
Paused Campaigns: {count}
Active Ad Sets: {count} (across all campaigns)
Active Ads: {count} (across all ad sets)

Campaign Breakdown by Objective:
- Conversions: {count} campaigns
- Traffic: {count}
- Reach/Awareness: {count}
- Video Views: {count}
- Lead Gen: {count}
- Catalog Sales: {count}
- App Install: {count}
```

### Fragmentation Detection

**Campaign-level fragmentation:**

| Signal | Threshold | Classification |
|--------|-----------|---------------|
| >5 active campaigns with same objective | Any | Heavy fragmentation |
| >3 active campaigns with same objective | Nascent/Developing | Moderate fragmentation |
| >8 total active campaigns | Developing or below | Overly complex |
| >15 total active campaigns | Any maturity | Excessive -- likely needs major restructure |

**Ad set-level fragmentation:**

| Signal | Threshold | Classification |
|--------|-----------|---------------|
| >5 ad sets per campaign (CBO) | Any | Budget dilution risk |
| >8 ad sets per campaign (ABO) | Any | Management overhead |
| <50 weekly conversions per ad set | Any | Learning Limited risk |
| Ad sets with <$10/day effective budget | Any | Too small to learn |

**Ad-level issues:**

| Signal | Threshold | Classification |
|--------|-----------|---------------|
| >20 active ads per ad set | Any | Creative noise (Meta can't test efficiently) |
| 1 ad per ad set | Any | No testing or optimization happening |
| Mix of very old + very new ads | Age gap >90 days | Creative hodgepodge |

### Ideal Structure Comparison

Compare actual structure to the recommended model for the account's maturity:

```
Recommended (Developing Account, $3K/day):
├── Campaign 1: Prospecting (CBO, $2,000/day)
│   ├── Ad Set: Broad (2-3 ads)
│   └── Ad Set: LAL 1-3% LTV (2-3 ads)
├── Campaign 2: Retargeting (CBO, $500/day)
│   ├── Ad Set: Website Visitors 30d (2-3 ads)
│   └── Ad Set: Engaged Users (2-3 ads)
└── Campaign 3: Testing (ABO, $500/day)
    ├── Ad Set: Test Theme A ($150/day, 3-5 ads)
    ├── Ad Set: Test Theme B ($150/day, 3-5 ads)
    └── Ad Set: Test Theme C ($200/day, 3-5 ads)

Actual:
├── {actual structure map}
```

Highlight deviations: missing campaigns, excess campaigns, misallocated budgets.

---

## Step 3: CBO vs ABO Audit

### Current Usage

| Campaign | Budget Type | Daily Budget | Ad Set Count | Conversions/Week |
|----------|-----------|-------------|-------------|-----------------|
| ...      | CBO       | $500        | 4           | 120             |
| ...      | ABO       | N/A (ad set level) | 3    | 45              |

### CBO Appropriateness

CBO (Campaign Budget Optimization) is recommended when:
- Campaign has 2-5 ad sets with similar optimization goals
- Total campaign conversions >50/week (algorithm has enough signal to distribute)
- You trust Meta to allocate between ad sets

CBO is NOT recommended when:
- Ad sets have very different audience sizes (Meta will over-index on the largest)
- You need precise per-audience budget control (e.g., retargeting must stay at exactly $200/day)
- Campaign has only 1 ad set (CBO adds no value)

### ABO Appropriateness

ABO (Ad Set Budget Optimization) is recommended when:
- Testing campaigns (need equal budget distribution across tests)
- Retargeting with specific budget requirements per funnel stage
- Campaign has ad sets with very different audience sizes or value

### Misfit Detection

| Scenario | Issue | Recommendation |
|----------|-------|---------------|
| CBO with 1 ad set | Unnecessary complexity | Convert to ABO or add ad sets |
| CBO with >5 ad sets | Budget too diluted | Consolidate to 2-4 ad sets |
| ABO on a scaling campaign with 3 similar ad sets | Missing algorithmic optimization | Test CBO conversion |
| CBO where one ad set gets >80% of spend | Audience size imbalance | Move small ad set to separate campaign or switch to ABO |

---

## Step 4: Ad Set Consolidation Analysis

### Learning Phase Viability

For each ad set, calculate:
- Weekly conversions (last 7 days)
- Projected weekly conversions at current velocity
- Budget per ad set (ABO: direct, CBO: estimated from spend share)
- Minimum viable budget = target CPA * 50 / 7 (daily budget needed for 50 weekly conversions)

### Consolidation Candidates

Flag ad sets that should be merged:

| Reason | Detection | Action |
|--------|----------|--------|
| <50 weekly conversions | Performance data | Merge with closest audience ad set |
| Overlapping audiences (>50%) | Targeting comparison | Merge into single broader ad set |
| Same targeting, different creative | Targeting identical | Merge (Meta will test creative within one ad set) |
| Budget too low (<10x CPA) | Budget / CPA calculation | Merge or increase budget |

### Consolidation Impact Estimate

For each proposed merge:
- Combined audience size
- Combined budget
- Projected weekly conversions at combined budget
- Will the combined ad set exit learning? (>50/week?)
- Estimated CPA impact (consolidation usually improves CPA by 10-20%)

---

## Step 5: Naming Convention Audit

### Compliance Check

Parse every campaign, ad set, and ad name against the naming convention templates from account-conventions.

**Campaign names:** `{objective}_{audience}_{geo}_{launch_date}`
- Check each token is present and valid
- Check token values match the allowed set

**Ad set names:** `{targeting}_{placement}_{bid_strategy}_{budget}`
- Verify targeting token accurately describes actual targeting
- Verify bid strategy token matches actual bid strategy

**Ad names:** `{creative_type}_{concept}_{variant}_{format}`
- Verify creative type token is accurate
- Check variant numbering is sequential

### Violations Report

| Entity | Name | Expected Pattern | Violation | Severity |
|--------|------|-----------------|-----------|----------|
| Campaign | "Test Campaign 2" | {obj}_{aud}_{geo}_{date} | Missing all tokens | High |
| Ad Set | "LAL_AUTO_LCAP_D50" | Pattern match | None | Compliant |
| Ad | "video 1" | {type}_{concept}_{var}_{format} | Missing tokens | High |

### Compliance Score

- **Full compliance:** 100% of entities follow the convention
- **High compliance:** >80% follow the convention
- **Partial compliance:** 50-80% follow the convention
- **Non-compliant:** <50% follow the convention

Naming conventions enable automated parsing across the toolkit. Non-compliant names break segmentation in analyze-creative, audit-audiences, and other action skills.

---

## Step 6: Advantage+ Assessment

**Skip if `capabilities.has_advantage_plus` is false and no ASC campaigns exist.**

### ASC Status Check

- Is ASC running? If yes, how many ASC campaigns?
- ASC budget as % of total account budget
- ASC performance vs manual campaigns (CPA, ROAS, conversion volume)

### Should ASC Be Running?

| Maturity | Monthly Conversions | Recommendation |
|----------|-------------------|---------------|
| Nascent | <100 | No -- insufficient data for ASC |
| Developing | 100-500 | Test with 10-20% of budget |
| Established | 500-2000 | Run alongside manual, 20-40% of budget |
| Advanced | 2000+ | Primary scaling vehicle, 40-60% of budget |

### ASC Structure Check

If ASC is active:
- Only 1 ASC campaign per product/market (Meta recommendation)
- Country targeting set correctly
- Existing customer budget cap configured
- Creative variety sufficient (6-10+ ads recommended)
- Performance vs manual campaigns CPA

### ASC Recommendation

Based on account maturity, conversion volume, and current ASC status:
- **Launch ASC:** If Established+ and not running ASC
- **Scale ASC:** If running with good results but budget share is low
- **Fix ASC:** If running but misconfigured (wrong customer cap, insufficient creative)
- **Keep Manual:** If Nascent/early Developing or insufficient conversion volume

---

## Checkpoint: Present Findings

```
Structure Audit Summary for {account_name}
Account Maturity: {maturity_level}
Monthly Conversion Volume: {volume}

Structure Snapshot:
- Active campaigns: {count} (recommended: {recommended})
- Active ad sets: {count} (across {campaign_count} campaigns)
- Active ads: {count}
- Budget type: {CBO_count} CBO / {ABO_count} ABO

Fragmentation Score: {Low/Moderate/Heavy/Excessive}
- Same-objective duplicates: {count} campaigns
- Ad sets below learning threshold: {count}
- Ad sets recommended for consolidation: {count}

CBO/ABO Assessment:
- Correct usage: {count} campaigns
- Misfit: {count} campaigns

Naming Compliance: {score}% ({classification})
- Campaign violations: {count}
- Ad set violations: {count}
- Ad violations: {count}

Advantage+ Status: {running/not running/should be running}

Key Flags:
- {critical findings}

Shall I generate the restructuring plan?
```

---

## Step 7: Output Generation

### Deliverable 1: Structure Assessment Report

```markdown
# Structure Audit Report: {account_name}
Generated: {date}
Account Maturity: {maturity_level}

## Current Structure Map
{visual tree of all campaigns > ad sets > ad counts}

## Recommended Structure
{visual tree of ideal structure for this maturity and spend level}

## Fragmentation Analysis
| Objective | Active Campaigns | Recommended | Action |
|-----------|-----------------|-------------|--------|
| Conversions | 7 | 2-3 | Consolidate |
| Traffic | 2 | 0-1 | Review necessity |

## Ad Set Health
| Ad Set | Campaign | Weekly Conv | Learning Status | Viable? | Action |
|--------|----------|------------|----------------|---------|--------|
| ... | ... | 12 | Learning Limited | No | Merge with {other} |
```

### Deliverable 2: Consolidation Plan

```markdown
## Consolidation Plan

### Phase 1: Campaign Consolidation (Week 1)
| Action | From | To | Rationale | Risk |
|--------|------|----|-----------|------|
| Merge | CONV_PROS_US_2025-11, CONV_PROS_US_2025-12 | CONV_PROS_US_2026-01 (new) | Same objective, same audience, same geo | Low -- preserving best ad sets from each |

### Phase 2: Ad Set Consolidation (Week 2)
| Action | From Ad Sets | To Ad Set | Campaign | Projected Weekly Conv |
|--------|-------------|-----------|----------|----------------------|
| Merge | LAL_1_LTV, LAL_1_PURCH | LAL_1_COMBINED | CONV_PROS_US | 65 (above threshold) |

### Phase 3: CBO/ABO Migration (Week 3)
| Campaign | Current | Recommended | Rationale |
|----------|---------|-------------|-----------|
| ... | ABO | CBO | 3 similar ad sets, 150 weekly conv |

### Phase 4: ASC Introduction (Week 4, if applicable)
| Action | Budget | Creative Count | Customer Cap |
|--------|--------|---------------|-------------|
| Launch ASC | $200/day (15% of total) | 8 existing winners | 20% existing customers |

**Implementation rules:**
- One phase per week (allow stabilization between phases)
- Use Post ID to transfer winning ads to new campaigns
- Pause old campaigns, don't delete (retain historical data)
- Monitor learning phase status after each change
```

### Deliverable 3: Naming Violations List

```markdown
## Naming Convention Violations

### Campaigns
| Current Name | Expected Pattern | Suggested Name | Priority |
|-------------|-----------------|----------------|----------|
| "Test Campaign 2" | {obj}_{aud}_{geo}_{date} | CONV_PROS_US_2026-03 | High |

### Ad Sets
| Current Name | Expected Pattern | Suggested Name | Priority |
|-------------|-----------------|----------------|----------|
| "broad - USA" | {targeting}_{placement}_{bid}_{budget} | BROAD_AUTO_LCAP60_CBO | High |

### Ads
| Current Name | Expected Pattern | Suggested Name | Priority |
|-------------|-----------------|----------------|----------|
| "video 1" | {type}_{concept}_{var}_{format} | VID_TESTIMON_V1_9x16 | High |

**Total violations:** {count} / {total entities} ({pct}%)
**Recommendation:** {Rename all at once vs phase in with new entities only}
```

### Deliverable 4: Restructure Timeline

```markdown
## Restructure Timeline
Total duration: {weeks} weeks

| Week | Phase | Changes | Risk Level | Success Criteria |
|------|-------|---------|-----------|-----------------|
| 1 | Campaign consolidation | Merge {count} campaigns | Medium | No CPA increase >15% |
| 2 | Ad set consolidation | Merge {count} ad sets | Low | Learning phase exits within 7d |
| 3 | CBO migration | Convert {count} campaigns | Medium | Budget utilization >80% |
| 4 | ASC launch | Launch 1 ASC campaign | Low | CPA within 130% of manual |
| 5 | Naming cleanup | Rename {count} entities | None | 100% compliance |

**Rollback plan:** At each phase, if CPA rises >25% for 72h, revert changes and reassess.
```

---

## Error Handling

| Issue | Detection | Resolution |
|-------|----------|------------|
| Cannot access campaign settings | MCP returns partial data | Fall back to insights data to infer structure. Ask user to confirm campaign objectives and budget types manually. |
| Naming conventions not configured | naming_conventions fields are defaults | Skip naming audit entirely. Note in report that naming conventions should be set up. Focus on structural and learning phase analysis. |
| Very large account (>50 campaigns) | Campaign count | Tier the analysis: audit active campaigns first, then paused. May need multiple MCP calls with pagination. |
| All campaigns are ASC | No manual structure to audit | Pivot to ASC-specific analysis: creative count, customer cap settings, budget distribution. Assess if manual campaigns should be added for testing. |
| Mixed objectives in one campaign | Campaign has ad sets with different optimization goals | Flag as structural error (this actually shouldn't be possible in Meta, but configurations can be confusing). Clarify with user. |
| Account just launched (<7 days) | Very few campaigns, minimal data | Skip consolidation analysis (too early). Focus on initial structure assessment vs recommended starting structure. |

---

## Reference Files

- `references/data_requirements.md` -- MCP tool calls for account structure data, campaign and ad set fields, filtering parameters
- `references/output_specs.md` -- Structure map format, consolidation plan template, naming violation report format
- `references/worked_example.md` -- End-to-end walkthrough restructuring a 12-campaign account down to 4 campaigns over 4 weeks
