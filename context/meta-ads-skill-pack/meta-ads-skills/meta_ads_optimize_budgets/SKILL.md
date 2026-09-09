---
name: optimize_budgets
description: Action skill that optimizes budget allocation across Meta Ads campaigns. Produces reallocation tables with projected impact, scaling recommendations, and pacing analysis. Uses marginal efficiency modeling to shift budget from diminishing-return campaigns to constrained-efficient ones.
triggers:
  - "optimize budgets"
  - "budget reallocation"
  - "budget optimization"
  - "where should I spend more"
  - "scale budget"
  - "budget review"
  - "pacing analysis"
---

# Optimize Budgets

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

Execute a data-driven budget optimization across all active campaigns in a Meta Ads account. This skill identifies which campaigns deserve more budget (constrained-efficient), which are experiencing diminishing returns (scale back), and which are experiments that should be isolated. It produces a reallocation table with projected impact, a scaling schedule for growth candidates, and a pacing analysis to catch delivery issues.

## When to Use

- Weekly budget review (standalone or as part of weekly review)
- When total budget is increasing and you need to decide where to allocate
- When CPA is rising and you suspect budget misallocation
- When some campaigns are spending easily while others underdeliver
- Before a scaling push (product launch, seasonal peak)
- When the client asks "where should I spend more?"

## Dependencies

| Skill | Why It's Needed |
|-------|----------------|
| `account_conventions` | Account config: KPI targets, monthly spend, reporting period |
| `budget_methodology` | Scaling rules (20% increments), marginal efficiency framework, three-tier classification |
| `account_maturity_methodology` | Maturity determines scaling aggressiveness and budget concentration rules |

---

## Step 0: Load Dependencies

1. **Read `account-conventions/SKILL.md`** and extract for the target account:
   - `ad_account_id`, `currency`, `timezone`
   - `kpi_config` (primary KPI, targets, flag thresholds)
   - `monthly_spend` (total budget context)
   - `naming_conventions` (parse campaign type, audience, geo)
   - `capabilities.campaign_types_active`
   - `maturity_level`
   - `data_source.method`
   - `reporting.period` and `reporting.comparison`

2. **Read `budget-methodology/SKILL.md`** and load:
   - Three-tier classification framework (Core Performer, Growth Candidate, Experiment)
   - Vertical scaling rules (20% every 3-4 days, never >2x in a week)
   - Horizontal scaling guidelines (new ad sets vs new campaigns)
   - Marginal efficiency modeling approach
   - CBO vs ABO budget management differences
   - Budget floor and ceiling guidelines

3. **Read `account-maturity-methodology/SKILL.md`** and determine:
   - Scaling aggressiveness:
     - **Nascent:** Conservative, max 15% increases, focus on learning
     - **Developing:** Moderate, 20% increases, test new campaigns at 10-15% of total
     - **Established:** Aggressive, 20-30% increases on proven campaigns, 15-20% for tests
     - **Advanced:** Aggressive scaling with sophisticated marginal efficiency tracking

**Validation gate:** If no KPI targets are set, budget optimization cannot determine "efficient" vs "inefficient." Prompt the user to set CPA/ROAS targets.

---

## Step 1: Data Acquisition

### Campaign-Level Performance (Primary)

```
SDK call: `meta_ads_get_insights()` (from `sdk/tools/mcp_meta_ads`)
Parameters:
  account_id: {ad_account_id}
  level: "campaign"
  time_range: "last_14d"
  time_increment: "1"  # Daily granularity for pacing and trend analysis
  fields:
    - campaign_id
    - campaign_name
    - impressions
    - reach
    - frequency
    - spend
    - conversions
    - cost_per_action_type
    - actions
    - action_values
    - cpm
    - cpc
    - ctr
```

### Campaign Configuration

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
    - budget_remaining
    - buying_type
  filtering:
    - field: "effective_status"
      operator: "IN"
      value: ["ACTIVE"]
```

### Ad Set-Level Performance (for CBO budget distribution analysis)

```
SDK call: `meta_ads_get_insights()` (from `sdk/tools/mcp_meta_ads`)
Parameters:
  account_id: {ad_account_id}
  level: "adset"
  time_range: "last_7d"
  time_increment: "1"
  fields:
    - adset_id
    - adset_name
    - campaign_id
    - impressions
    - spend
    - conversions
    - cost_per_action_type
    - daily_budget
```

### Ad Set Configuration (for ABO budgets)

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
    - daily_budget
    - lifetime_budget
    - optimization_goal
    - bid_strategy
    - bid_amount
  filtering:
    - field: "effective_status"
      operator: "IN"
      value: ["ACTIVE"]
```

### CSV Fallback

If data_source.method = "csv":
1. Campaign-level report, last 14 days, daily breakdown, include Budget and Delivery columns
2. Ad set-level report, last 7 days, daily breakdown, include Budget column
3. Campaign settings export (budget type, daily/lifetime budget, bid strategy)

---

## Step 2: Pacing Analysis

Pacing measures how effectively each campaign is deploying its budget.

### Daily Pacing Calculation

For each campaign, calculate:
- **Daily budget** (from campaign config or sum of ad set budgets for ABO)
- **Average daily spend** (total spend / days in period)
- **Pacing ratio** = average daily spend / daily budget
- **Trend** = last 3-day average vs prior 3-day average

### Pacing Classification

| Pacing Ratio | Classification | Interpretation |
|-------------|---------------|----------------|
| >95% | Constrained | Campaign wants to spend more. If CPA is within target, this is a scale candidate. |
| 80-95% | Healthy | Normal delivery range. Budget is approximately right. |
| 50-80% | Underdelivering | Campaign cannot find enough efficient impressions. Possible causes: targeting too narrow, bid/cap too tight, creative fatigue. |
| <50% | Severely Underdelivering | Something is wrong. Check bid strategy, audience size, creative approval status, learning phase. |
| N/A (lifetime) | Lifetime Budget | Calculate remaining budget / remaining days for effective daily rate. |

### Constrained-Efficient Identification

The most valuable finding: campaigns that are **constrained AND efficient**.
- Pacing ratio >95% (wants more budget)
- CPA within or below target
- These campaigns would generate more conversions with more budget at acceptable CPA
- Flag these prominently as immediate scaling opportunities

### Underdelivery Diagnosis

For underdelivering campaigns, diagnose the cause:

| Signal | Likely Cause | Recommended Action |
|--------|-------------|-------------------|
| Low impressions + high CPA | Audience too small or exhausted | Expand targeting (see audit-audiences) |
| Low impressions + cost cap active | Cost cap too tight | Raise cap by 10-20% |
| Impressions OK but low clicks | Creative not resonating | Run analyze-creative |
| In learning phase | Not enough conversion signal | Increase budget or consolidate ad sets |
| Declining spend trend | Creative fatigue or audience saturation | Check frequency and CTR trends |

---

## Step 3: Marginal Efficiency Analysis

Determine each campaign's marginal efficiency -- the cost of the NEXT conversion, not the average.

### Method: Incremental CPA Estimation

Using daily data, model the relationship between spend and conversions:

1. **Plot daily spend vs daily CPA** for each campaign over the 14-day window
2. **Identify the inflection point** where CPA starts rising with spend (diminishing returns)
3. **Classify efficiency zone:**

| Zone | CPA Behavior as Spend Increases | Implication |
|------|--------------------------------|-------------|
| **Linear** | CPA stays flat or decreases | Safe to scale -- more budget = proportionally more conversions |
| **Inflecting** | CPA starts rising (5-15% above baseline on high-spend days) | Near the efficiency frontier. Scale carefully (10-15% increments) |
| **Diminishing** | CPA rises >15% above baseline on high-spend days | Past the efficiency frontier. Reallocate budget to Linear-zone campaigns |
| **Accelerating** | CPA is declining as spend increases | Rare. Campaign is learning and improving. Scale aggressively. |

### Simplified Approach (if daily variance is too high)

When daily CPA variance makes regression unreliable (common in lower-spend campaigns):
1. Compare 7-day periods: did CPA rise when spend rose?
2. Use conversion volume as a proxy: campaigns with >10 conversions/day are likely in the Linear zone
3. Flag low-volume campaigns (<3 conversions/day) as "insufficient data for marginal analysis"

### Marginal Efficiency Ranking

Rank all campaigns from most efficient marginal dollar to least:

| Rank | Campaign | Avg CPA | Marginal CPA (est.) | Efficiency Zone | Daily Budget | Recommended Change |
|------|----------|---------|---------------------|-----------------|-------------|-------------------|
| 1    | ...      | $42     | $40                 | Linear          | $200        | +$50 (+25%)       |
| 2    | ...      | $55     | $58                 | Inflecting      | $300        | +$30 (+10%)       |
| ...  | ...      | $78     | $95                 | Diminishing     | $500        | -$100 (-20%)      |

---

## Step 4: Three-Tier Classification

Classify each campaign into one of three tiers (from budget-methodology):

### Core Performer
- CPA within target
- Pacing >80%
- Stable or improving trend
- Has been running 14+ days with consistent results
- **Budget rule:** 60-70% of total account budget across all Core campaigns

### Growth Candidate
- CPA within 130% of target
- Shows potential (improving trend or newly graduated from learning)
- Running 7-14 days with directionally positive signals
- **Budget rule:** 20-30% of total account budget across all Growth campaigns

### Experiment
- New concept, audience, or creative being tested
- Less than 7 days of data OR CPA above 130% of target but intentionally exploring
- **Budget rule:** 10-15% of total account budget, isolated from Core campaigns
- Kill criteria: spend >3x target CPA with zero conversions

### Classification Table

| Campaign | Tier | CPA vs Target | Pacing | Trend | Days Active | Budget Share |
|----------|------|---------------|--------|-------|-------------|-------------|
| ...      | Core | 92% (-8%)    | 97%    | Stable | 45          | 35%         |

### Budget Concentration Check

- If >80% of budget is in Core: account may be under-testing. Recommend shifting 5-10% to Experiments.
- If >30% is in Experiments: too much budget at risk. Graduate or kill experiments faster.
- If Core campaigns represent <50% of budget: account is under-capitalizing proven winners.

---

## Step 5: Scaling Plan

For campaigns identified as scale candidates (Core Performers with constrained pacing), build a scaling schedule.

### Vertical Scaling Rules (from budget-methodology)

- **Maximum single increase:** 20% of current daily budget
- **Frequency:** Every 3-4 days (allow 72h for algorithm adjustment)
- **Never exceed:** 2x original budget in a single week
- **Monitor after each increase:** 48 hours before the next decision

### Scaling Schedule Builder

For each scale candidate:

```
Campaign: {name}
Current daily budget: ${current}
Target daily budget: ${target} (based on marginal efficiency headroom)

Day 0: ${current} (baseline)
Day 3: ${current * 1.20} (+20%)
  - Monitor: CPA within 15% of baseline? Continue.
  - Rollback: CPA >30% above baseline for 48h? Revert.
Day 6: ${current * 1.20 * 1.20} (+44% from baseline)
  - Monitor: Same criteria.
Day 9: ${current * 1.20 * 1.20 * 1.20} (+73% from baseline)
  - Checkpoint: Full assessment. Continue scaling or stabilize?
```

### Horizontal Scaling (When to Use)

Vertical scaling has limits. When a campaign hits diminishing returns at its ceiling:
- **Duplicate the campaign** with a different audience segment
- **Launch new creative** in the existing campaign (Faris method)
- **Split by geo** (if running multi-geo in one campaign)
- **ASC addition** (run an Advantage+ campaign alongside manual campaigns)

---

## Step 6: Reallocation Table

The core deliverable: where to move budget from/to, with projected impact.

### Reallocation Methodology

1. **Identify sources** (campaigns to decrease): Diminishing efficiency zone, high CPA, underdelivering
2. **Identify destinations** (campaigns to increase): Constrained-efficient, Linear zone, proven performers
3. **Calculate projected impact:**
   - Freed budget from source = decrease amount
   - Projected conversions lost = decrease amount / source marginal CPA
   - Projected conversions gained = increase amount / destination marginal CPA
   - Net conversion impact = gained - lost
   - Net CPA impact on total account

### Reallocation Constraints

- Never decrease a campaign's budget by >30% in one move (learning phase risk)
- Never increase a campaign's budget by >20% in one move (performance volatility risk)
- Ensure every Core campaign retains at least a "minimum viable budget" (10x target CPA daily)
- Reallocation should be budget-neutral unless the user is adding new budget

---

## Checkpoint: Present Reallocation Plan

```
Budget Optimization Summary for {account_name}
Period: {date_range}
Total Daily Budget: ${total}
Total Daily Spend: ${actual} ({utilization}% utilization)

Tier Distribution:
- Core Performers: {count} campaigns, ${amount}/day ({pct}%)
- Growth Candidates: {count} campaigns, ${amount}/day ({pct}%)
- Experiments: {count} campaigns, ${amount}/day ({pct}%)

Key Findings:
- Constrained-efficient campaigns (scale candidates): {count}
  Combined daily budget headroom: ~${amount}
- Diminishing-return campaigns (reallocation sources): {count}
  Recoverable daily budget: ~${amount}
- Underdelivering campaigns: {count}

Proposed Reallocation:
| From | Amount | To | Amount | Net CPA Impact |
|------|--------|-----|--------|----------------|
| ... | -$X | ... | +$X | -${improvement} |

Projected total impact:
- Conversions: +{count} per day (+{pct}%)
- Blended CPA: from ${current} to ${projected} ({change}%)
- Daily spend: ${current} to ${projected}

Shall I generate the full reallocation table and scaling schedule?
```

---

## Step 7: Output Generation

### Deliverable 1: Reallocation Table

```markdown
# Budget Reallocation Plan: {account_name}
Generated: {date} | Period: {date_range}
Budget Constraint: {budget-neutral / adding ${amount} / reducing ${amount}}

## Reallocation Summary
| # | From Campaign | Decrease | To Campaign | Increase | Rationale |
|---|--------------|----------|-------------|----------|-----------|
| 1 | CONV_PROS_EU | -$100/day | CONV_PROS_US | +$100/day | EU hitting diminishing returns (marginal CPA $95), US constrained at $45 CPA |
| 2 | ... | ... | ... | ... | ... |

## Projected Impact
| Metric | Current (7d avg) | Projected | Change |
|--------|-----------------|-----------|--------|
| Daily conversions | {current} | {projected} | +{pct}% |
| Blended CPA | ${current} | ${projected} | {change}% |
| Daily spend | ${current} | ${projected} | {change}% |
| ROAS | {current}x | {projected}x | {change}% |

## Implementation Notes
- Execute reallocations in the order listed (lowest risk first)
- Make changes between 6-9 AM account timezone (low-traffic hours)
- Wait 24 hours between each reallocation to observe impact
- Do not change bid strategy simultaneously (one variable at a time)
```

### Deliverable 2: Scaling Schedule

```markdown
## Scaling Schedule
For campaigns receiving budget increases.

### {Campaign Name}
| Date | Daily Budget | Change | Cumulative | Monitor |
|------|-------------|--------|-----------|---------|
| Mar 28 | $200 | Baseline | -- | Record CPA: $__ |
| Mar 31 | $240 | +$40 (+20%) | +20% | CPA within 15% of baseline? |
| Apr 3 | $290 | +$50 (+21%) | +45% | CPA check, conversion volume check |
| Apr 6 | $350 | +$60 (+21%) | +75% | Full assessment: continue or stabilize |

**Rollback trigger:** CPA >30% above baseline for 48 consecutive hours
**Success criteria:** CPA within 20% of baseline at new spend level for 5+ days
```

### Deliverable 3: Before/After Projections

```markdown
## Before/After Budget Allocation

### Current State
| Campaign | Tier | Daily Budget | Daily Spend | CPA | Conversions/Day | Pacing |
|----------|------|-------------|-------------|-----|----------------|--------|
| ... | Core | $500 | $480 | $48 | 10 | 96% |

### Projected State (After Reallocation)
| Campaign | Tier | New Budget | Proj. Spend | Proj. CPA | Proj. Conv/Day | Change |
|----------|------|-----------|-------------|-----------|---------------|--------|
| ... | Core | $600 | $570 | $50 | 11.4 | +14% conv |

### Account-Level Before/After
| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Total daily budget | ${total} | ${total} | $0 (neutral) |
| Total daily conversions | {conv} | {conv} | +{delta} |
| Blended CPA | ${cpa} | ${cpa} | {delta}% |
| Total daily revenue (if ROAS tracked) | ${rev} | ${rev} | +{delta}% |
```

---

## Error Handling

| Issue | Detection | Resolution |
|-------|----------|------------|
| Mix of CBO and ABO campaigns | Budget set at different levels | Analyze CBO at campaign level, ABO at ad set level. Present both views. |
| Lifetime budgets present | Some campaigns use lifetime budget, not daily | Convert to effective daily rate: remaining_budget / remaining_days. Note reduced flexibility for scaling. |
| Very few campaigns (<3) | Limited reallocation options | Focus on vertical scaling and pacing analysis. Recommend adding new campaigns for diversification. |
| All campaigns underdelivering | Nothing to reallocate from | Root cause is not budget allocation -- likely bid strategy, audience, or creative issue. Recommend running audit-bidding and analyze-creative first. |
| No conversion data | CPA cannot be calculated | Fall back to CPM/CPC efficiency for budget allocation. Note that this is a weaker signal. Recommend running audit-measurement. |
| Huge CPA variance | Daily CPA swings make marginal analysis unreliable | Use weekly aggregates instead of daily. Note reduced precision in marginal efficiency estimates. |
| Single campaign accounts | Nothing to reallocate between | Focus on ad set-level budget distribution within the campaign. Recommend launching additional campaigns for testing. |

---

## Execution Capability

After generating the reallocation table and scaling schedule, this skill can queue draft budget changes for human approval. No budget changes execute automatically.

### Execution vs Analysis

| Action | Execution Method | Requires Human Approval? |
|--------|-----------------|--------------------------|
| Update campaign daily or lifetime budget | `update_campaign` (daily_budget, lifetime_budget) via MCP | Yes -- shows draft before executing |
| Update ad set daily or lifetime budget | `update_ad_set` (daily_budget, lifetime_budget, bid_amount) via MCP | Yes -- shows draft before executing |
| Read campaign/ad set performance data | `get_insights`, `get_campaigns`, `get_adsets` via MCP | No approval needed (read-only) |

### Scaling Safety Rule

Never increase a budget by more than 20% in a single change. Changes larger than 20% signal a significant shift to Meta's algorithm and can reset the learning phase, causing CPA to spike for 3-7 days.

- If the scaling schedule calls for a large increase, break it into 20% increments spaced 3-4 days apart.
- This rule applies to both campaign-level (CBO) and ad set-level (ABO) budgets.
- Decreases: similarly, never decrease by more than 30% in one move.

### Step 7 Addition: Proposed Budget Changes Queue

After the reallocation table is generated and confirmed by the user, produce a draft change queue in implementation order. Present for approval before executing.

```
Proposed Budget Changes
=======================
Review each change below. Confirm to execute, skip, or modify.
Execute in order. Wait 24h between changes.

[ ] Change 1: CONV_PROS_US -- Decrease campaign daily budget
    Tool: update_campaign -- daily_budget: 30000 (in cents = $300/day)
    Current: $400/day
    Change: -$100/day (-25%) -- NOTE: exceeds 20% rule
    Adjusted recommendation: decrease to $320/day first (-20%), then $300/day in 3 days
    Reason: Diminishing efficiency zone, marginal CPA $95 vs target $52
    Learning phase status: Graduated -- safe to change
    Status: DRAFT -- awaiting approval

[ ] Change 2: CONV_PROS_EU -- Increase ad set daily budget (ABO)
    Tool: update_ad_set -- daily_budget: 24000 (in cents = $240/day)
    Current: $200/day
    Change: +$40/day (+20%) -- within scaling rule
    Reason: Constrained-efficient (pacing 97%, CPA $48 vs $52 target)
    Status: DRAFT -- awaiting approval

[ ] Change 3: CONV_RETARG_US -- No change
    Current: $150/day
    Reason: Healthy pacing, CPA within target. Hold steady.
    Status: No action needed
```

**Only proceed with each change after explicit user confirmation per item.**

---

## Reference Files

- `references/data_requirements.md` -- MCP tool calls, API fields, CSV column mappings for budget data
- `references/output_specs.md` -- Reallocation table template, scaling schedule format, projection models
- `references/worked_example.md` -- End-to-end walkthrough reallocating $5K/day across 6 campaigns with before/after results
