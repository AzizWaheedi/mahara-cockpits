---
name: audit_bidding
description: Action skill that audits bidding strategies across Meta Ads campaigns. Assesses strategy-fit per campaign based on maturity level and performance data. Produces migration recommendations with sequenced timing to avoid learning phase disruption.
triggers:
  - "audit bidding"
  - "bidding strategy review"
  - "bid strategy audit"
  - "cost cap review"
  - "bidding optimization"
  - "are my bids right"
---

# Audit Bidding

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

Execute a structured audit of bidding strategies across all active campaigns in a Meta Ads account. This skill assesses whether each campaign is using the right bid strategy for its objective and the account's maturity level, identifies campaigns stuck in the learning phase, evaluates cost control effectiveness, and produces a sequenced migration plan that avoids destabilizing the account.

## When to Use

- CPA volatility across campaigns (some days great, some days terrible)
- Campaigns stuck in the learning phase for >7 days
- Scaling the account and need to transition from lowest cost to cost controls
- Monthly or quarterly bid strategy review
- After significant budget changes that may have disrupted bidding
- When the account has a mix of bid strategies and you need to assess consistency

## Dependencies

| Skill | Why It's Needed |
|-------|----------------|
| `account_conventions` | Account config: KPI targets, flag thresholds, naming conventions |
| `bidding_methodology` | Bid strategy selection framework, cost cap/bid cap guidelines, learning phase rules |
| `account_maturity_methodology` | Maturity determines recommended default bid strategy |

---

## Step 0: Load Dependencies

1. **Read `account-conventions/SKILL.md`** and extract for the target account:
   - `ad_account_id`, `currency`, `timezone`
   - `kpi_config` (primary KPI, targets -- critical for cost cap/bid cap assessment)
   - `naming_conventions.campaign` and `naming_conventions.ad_set` (parse objective, audience, bid strategy)
   - `capabilities.campaign_types_active`
   - `maturity_level`
   - `data_source.method`

2. **Read `bidding-methodology/SKILL.md`** and load:
   - Bid strategy selection matrix by objective and maturity
   - Cost cap setting guidelines (15-25% above target CPA)
   - Bid cap guidelines
   - Minimum ROAS strategy rules
   - Learning phase exit criteria (50 conversions in 7 days per ad set)
   - Learning phase disruption triggers

3. **Read `account-maturity-methodology/SKILL.md`** and determine:
   - Recommended default strategy for account maturity:
     - **Nascent:** Lowest Cost (maximize learning signal)
     - **Developing:** Lowest Cost with Cost Cap on top spenders
     - **Established:** Cost Cap as default, Bid Cap for proven campaigns
     - **Advanced:** Mixed strategies, Minimum ROAS for value optimization

**Validation gate:** If `kpi_config.targets` are not set (all zeros), cost cap and bid cap assessment cannot be performed. Prompt the user to set targets first.

---

## Step 1: Data Acquisition

### Campaign-Level Data

```
SDK call: `meta_ads_get_insights()` (from `sdk/tools/mcp_meta_ads`)
Parameters:
  account_id: {ad_account_id}
  level: "campaign"
  time_range: "last_14d"
  time_increment: "1"  # Daily granularity for learning phase and volatility analysis
  fields:
    - campaign_id
    - campaign_name
    - impressions
    - reach
    - spend
    - conversions
    - cost_per_action_type
    - actions
    - action_values
    - cpm
    - cpc
    - ctr
```

### Campaign Configuration Details

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
    - special_ad_categories
  filtering:
    - field: "effective_status"
      operator: "IN"
      value: ["ACTIVE"]
```

### Ad Set-Level Data (for learning phase analysis)

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
    - impressions
    - spend
    - conversions
    - cost_per_action_type
```

### Ad Set Configuration (for bid strategy details)

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
    - optimization_goal
    - bid_strategy
    - bid_amount
    - daily_budget
    - lifetime_budget
    - learning_phase_info
  filtering:
    - field: "effective_status"
      operator: "IN"
      value: ["ACTIVE"]
```

### CSV Fallback

If data_source.method = "csv", instruct the user to export:
1. Campaign-level report, last 14 days, daily breakdown, include Delivery column (shows learning phase status)
2. Ad set-level report, last 7 days, include bid strategy and bid amount columns
3. Campaign settings export (objective, budget type, bid strategy)

---

## Step 2: Strategy-Fit Assessment

For each active campaign, compare the current bid strategy to the recommended strategy based on maturity level and campaign objective.

### Strategy-Fit Matrix

Build a row per campaign:

| Campaign | Objective | Current Strategy | Current Bid/Cap | Recommended Strategy | Fit |
|----------|-----------|-----------------|-----------------|---------------------|-----|
| ...      | ...       | Lowest Cost     | N/A             | Cost Cap            | Mismatch |

### Fit Classification

- **Optimal:** Current strategy matches recommended strategy for this maturity + objective
- **Acceptable:** Strategy is one tier off but performance is within targets
- **Mismatch:** Strategy is inappropriate for maturity level or significantly underperforming
- **Legacy:** Strategy was correct at a previous maturity level but account has outgrown it

### Strategy Appropriateness Rules

**Lowest Cost (Auto-bid):**
- Appropriate for: Nascent accounts, new campaign types, testing phases
- Red flag if: Account is Established+ and all campaigns use Lowest Cost (leaving money on the table or overpaying during peak auction times)
- Red flag if: CPA variance >40% day-to-day (no cost control = wild swings)

**Cost Cap:**
- Appropriate for: Developing+ accounts with proven CPA baselines
- Cap should be: 15-25% above proven CPA to allow optimization flexibility
- Red flag if: Cap is set too tight (<10% above average CPA) -- causes underdelivery
- Red flag if: Cap is set too loose (>50% above average CPA) -- provides no real control
- Red flag if: Spending <70% of budget (cap is likely too tight)

**Bid Cap:**
- Appropriate for: Established+ accounts with high volume, competitive auctions
- More aggressive than Cost Cap (hard ceiling vs average target)
- Red flag if: Daily delivery is inconsistent (spends budget early, then stops)
- Red flag if: Used on campaigns with <100 weekly conversions (insufficient volume for hard ceiling)

**Minimum ROAS:**
- Appropriate for: E-commerce accounts with revenue tracking and value optimization
- Requires: Accurate conversion value data flowing to Meta
- Red flag if: Used without verified revenue data (ROAS calculation will be wrong)
- Red flag if: ROAS floor set above actual account average (guaranteed underdelivery)

---

## Step 3: Performance vs Strategy

For each campaign, assess whether the current strategy is achieving its goals.

### Key Performance Indicators per Strategy

**Lowest Cost campaigns:**
- Is CPA within target? (Some variability is expected)
- Is daily CPA variance acceptable? (StdDev / Mean < 0.3 = acceptable)
- Is the campaign spending its full budget? (Should be, with Lowest Cost)

**Cost Cap campaigns:**
- Is average CPA within 10% of the cap? (Healthy: just under the cap)
- Is the campaign spending >70% of budget? (If not, cap is too tight)
- Is CPA trending up toward the cap? (May need cap adjustment)
- Day-to-day CPA variance (should be lower than Lowest Cost equivalent)

**Bid Cap campaigns:**
- Is daily delivery consistent? (Not front-loaded and stopping mid-day)
- Total daily conversions vs budget-implied target
- Is the bid cap competitive enough? (Check vs average CPM in the auction)

**Minimum ROAS campaigns:**
- Is achieved ROAS meeting the floor?
- Is the campaign spending its budget? (Underdelivery = floor too high)
- Are conversion values accurate? (Check revenue data vs actual)

### Performance Scoring

For each campaign, assign a performance grade:
- **A:** Hitting or exceeding target, spending budget, low variance
- **B:** Within 20% of target, spending >70% of budget
- **C:** 20-50% off target or spending <70% of budget
- **D:** >50% off target, significant underdelivery, or CPA wildly volatile
- **F:** Not delivering at all or CPA >2x target

---

## Step 4: Learning Phase Audit

### Learning Phase Status

For each ad set, determine learning phase status:
- **Active Learning:** <50 conversions in last 7 days, recently launched or edited
- **Learning Limited:** Cannot reach 50 conversions/week at current budget/targeting
- **Graduated:** >50 conversions in 7 days, stable performance
- **Re-entered Learning:** Was graduated, then a significant edit triggered re-entry

### Learning Phase Duration Tracking

For ad sets in learning:
- Days in learning phase
- Current conversion velocity (conversions/day)
- Projected days to reach 50 (if current velocity continues)
- If projected >14 days: flag as likely to become "Learning Limited"

### Learning Phase Disruption Check

Review recent changes that may have triggered learning phase re-entry:
- Budget changes >20% in a single edit
- Bid strategy changes
- Targeting changes
- Creative changes (adding/removing >50% of ads)
- Conversion event changes

**Common pattern:** Account manager makes a bid strategy change AND a budget change simultaneously. Each alone is manageable; together they create learning phase chaos. Flag any campaign with multiple significant edits within 72 hours.

### Learning Limited Resolution

For "Learning Limited" ad sets, diagnose the cause:

| Cause | Signal | Resolution |
|-------|--------|------------|
| Budget too low | Daily budget < 10x target CPA | Increase budget or consolidate ad sets |
| Audience too small | Estimated reach <100K | Broaden targeting or merge with similar ad set |
| Too many ad sets | Campaign has 5+ ad sets splitting budget | Consolidate to 2-3 ad sets |
| Conversion event too rare | Purchase event with <10/week per ad set | Consider optimizing for higher-funnel event (ATC, IC) |
| Bid/cap too restrictive | Spending <50% of budget | Raise cap by 20% |

---

## Step 5: Cost Control Analysis

### Cost Cap Assessment

For each campaign using Cost Cap:

| Metric | Healthy Range | Action if Outside |
|--------|--------------|-------------------|
| Cap vs actual CPA | Cap = actual CPA + 15-25% | Tighten if >25% gap, loosen if <10% gap |
| Budget utilization | >70% | If <70%, cap is too tight -- raise by 10-15% |
| CPA stability | Day-to-day variance <25% | High variance suggests cap is near the efficiency frontier |
| Delivery consistency | Even spend across hours | Front-loaded = cap too high, back-loaded = cap too low |

### Bid Cap Assessment

For each campaign using Bid Cap:

| Metric | Healthy Range | Action if Outside |
|--------|--------------|-------------------|
| Daily delivery pattern | Even distribution | Spikes early then stops = bid too high. No spend early = bid too low |
| Conversion volume vs expectation | Within 20% of projected | Far below = bid not competitive. Far above = bid is generous |
| CPM vs bid | Bid > average CPM by 2x+ | Healthy ratio for conversion campaigns |

### Cost Control Recommendations

For each campaign, provide:
- Current cap/bid amount
- Recommended cap/bid amount (with calculation showing how it was derived)
- Expected impact of the change
- When to implement (not during high-traffic hours)

---

## Checkpoint: Present Strategy-Fit Matrix

```
Bidding Audit Summary for {account_name}
Period: {date_range}
Account Maturity: {maturity_level}

Strategy Distribution:
- Lowest Cost: {count} campaigns ({pct}% of spend)
- Cost Cap: {count} campaigns ({pct}% of spend)
- Bid Cap: {count} campaigns ({pct}% of spend)
- Minimum ROAS: {count} campaigns ({pct}% of spend)

Strategy-Fit Assessment:
- Optimal fit: {count} campaigns
- Acceptable fit: {count} campaigns
- Mismatch: {count} campaigns
- Legacy (needs upgrade): {count} campaigns

Learning Phase Status:
- Graduated: {count} ad sets
- Active Learning: {count} ad sets (avg {days} days in learning)
- Learning Limited: {count} ad sets
- Re-entered Learning: {count} ad sets

Cost Control Health:
- Campaigns with cap set correctly: {count}
- Campaigns with cap too tight: {count} (underdelivering)
- Campaigns with cap too loose: {count} (no real control)

Key Flags:
- {critical findings}

Shall I generate the migration plan?
```

---

## Step 6: Migration Plan

### Sequencing Rules

Bid strategy changes are high-impact. Follow these rules to avoid account-wide disruption:

1. **One change at a time.** Never change bid strategy on more than one campaign in the same 48-hour window.
2. **Start with the smallest campaign.** If a change goes wrong on a $50/day campaign, impact is limited.
3. **Wait for learning phase exit** before making the next change. Minimum 7 days between changes, ideally 14 days.
4. **Don't change bid strategy during peak periods** (Black Friday, product launches, etc.).
5. **Document the pre-change baseline** (7-day average CPA, ROAS, daily spend) so you can measure impact.

### Migration Plan Format

```markdown
# Bidding Migration Plan: {account_name}
Generated: {date}
Account Maturity: {maturity_level}
Target State: {recommended strategy distribution}

## Phase 1: Week of {date}
| Campaign | Current Strategy | New Strategy | New Cap/Bid | Rationale | Risk |
|----------|-----------------|-------------|-------------|-----------|------|
| CONV_PROS_US | Lowest Cost | Cost Cap | $65 (target $52 + 25%) | Highest spend campaign, CPA variance 45% | Medium - may underdeliver initially |

**Pre-change baseline to record:**
- 7-day avg CPA: $__
- 7-day avg daily spend: $__
- 7-day conversion volume: __

**Success criteria:** CPA within 20% of baseline, spending >70% of budget within 5 days
**Rollback trigger:** CPA >50% above baseline for 3 consecutive days, or spend drops below 40% of budget

## Phase 2: Week of {date} (only proceed if Phase 1 successful)
| ... |

## Phase 3: Week of {date}
| ... |

## No Change Recommended
| Campaign | Current Strategy | Why No Change |
|----------|-----------------|---------------|
| ... | Cost Cap | Already optimal, CPA at target, spending budget |

## Risk Assessment
- Overall risk level: {Low/Medium/High}
- Estimated CPA impact during migration: +/- {range}%
- Estimated duration: {weeks} weeks
- Rollback plan: Revert to previous strategy, wait 7 days for re-stabilization
```

### Post-Migration Monitoring Checklist

For each changed campaign, monitor daily for 14 days:
- [ ] CPA vs pre-change baseline
- [ ] Daily spend vs budget (utilization %)
- [ ] Learning phase status
- [ ] Conversion volume
- [ ] CPM trends (auction competitiveness signal)

---

## Error Handling

| Issue | Detection | Resolution |
|-------|----------|------------|
| Bid strategy field not returned | MCP returns null for bid_strategy | Check at ad set level (bid strategy can be set at ad set level when using ABO). If still null, ask user to confirm strategy in Ads Manager. |
| Learning phase info unavailable | learning_phase_info field not returned | Estimate from conversion velocity: <50 conversions in last 7 days = likely still learning. |
| Mixed strategies within campaign | CBO campaign has ad sets with different bid strategies | Flag as configuration error. CBO campaigns should have uniform strategy across ad sets. |
| Account uses only ASC | Advantage+ campaigns have limited bid strategy options | Note that ASC uses its own bidding logic. Focus on cost cap setting and ROAS floor for ASC campaigns. |
| No conversion data | conversions field is zero or null across all campaigns | Cannot assess bid strategy effectiveness without conversion data. Recommend running audit-measurement first. |
| Very new account (<30 days) | Limited historical data | Flag that strategy-fit assessment has low confidence. Recommend keeping Lowest Cost for now and re-auditing after 30 days of data. |

---

## Execution Capability

After generating the migration plan, this skill can queue draft bid strategy changes for human approval. No changes execute automatically.

### Execution vs Analysis

| Action | Execution Method | Requires Human Approval? |
|--------|-----------------|--------------------------|
| Update ad set bid amount or optimization goal | `update_ad_set` (bid_amount, optimization_goal, billing_event) via MCP | Yes -- shows draft before executing |
| Update campaign bid strategy | `update_campaign` (bid_strategy) via MCP | Yes -- shows draft before executing |
| Read campaign/ad set performance data | `get_insights`, `get_campaigns`, `get_adsets` via MCP | No approval needed (read-only) |

### Learning Phase Flag

Before proposing any bid strategy change, check whether the ad set is currently in learning phase (< 50 conversions in the last 7 days, or `learning_phase_info` indicates active learning).

- If in learning: flag prominently. Any edit will reset the learning phase clock. Recommend waiting until graduation unless the current strategy is critically broken.
- If learning-limited: bid strategy changes may be part of the fix -- document the tradeoff explicitly.

### Step 6 Addition: Proposed Changes Queue

After the migration plan is generated and confirmed by the user, produce a draft change queue for Phase 1. Present for approval before executing.

```
Proposed Changes -- Bidding Audit (Phase 1)
=============================================
Review each change below. Confirm to execute, skip, or modify.
Implement in sequence. Wait 48h between changes.

[ ] Change 1: CONV_PROS_US -- Update campaign bid strategy
    Tool: update_campaign -- bid_strategy: COST_CAP
    Current: LOWEST_COST
    Recommended: COST_CAP at $65 (target $52 + 25%)
    Learning phase status: Graduated (127 conversions/7d)
    Pre-change baseline to record: 7d avg CPA $52, daily spend $420, 8 conv/day
    Rollback trigger: CPA >$78 for 3 consecutive days
    Status: DRAFT -- awaiting approval

[ ] Change 2: CONV_PROS_EU -- Update ad set bid amount
    Tool: update_ad_set -- bid_amount: 7000 (in cents = $70)
    Current bid_amount: null (Lowest Cost)
    Recommended: Cost Cap $70 (target CPA $58 + 20%)
    Learning phase status: Active Learning (32 conversions/7d) -- CAUTION: edit will reset learning
    Recommendation: Wait until this ad set graduates before making this change
    Status: DRAFT -- flagged, recommend deferring to Phase 2
```

**Only proceed with each change after explicit user confirmation per item.**

---

## Reference Files

- `references/data_requirements.md` -- MCP tool calls, API fields, CSV column mappings for bidding data
- `references/output_specs.md` -- Migration plan template, strategy-fit matrix format, learning phase report
- `references/worked_example.md` -- End-to-end walkthrough migrating a Developing account from all-Lowest-Cost to a Cost Cap structure over 4 weeks
