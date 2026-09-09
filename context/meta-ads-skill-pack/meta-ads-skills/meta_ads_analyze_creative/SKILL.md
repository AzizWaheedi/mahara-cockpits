---
name: analyze_creative
description: Action skill that executes creative performance analysis for Meta Ads accounts. Produces creative scorecards, fatigue detection reports, refresh priority lists, and creative test plans. Loads creative-strategy-methodology and account-maturity-methodology for calibrated analysis.
triggers:
  - "analyze creative"
  - "creative performance"
  - "creative fatigue"
  - "ad fatigue"
  - "creative audit"
  - "which ads are working"
  - "creative refresh"
  - "ad performance review"
---

# Analyze Creative

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

Execute a structured creative performance analysis for a Meta Ads account. This skill turns raw ad-level data into actionable outputs: a scored creative scorecard, fatigue detection alerts, a prioritized refresh list, and a creative test plan for the next sprint. It loads creative-strategy-methodology for benchmarks and fatigue thresholds, and account-maturity-methodology to calibrate expectations by account stage.

## When to Use

- Weekly creative review (part of the weekly review cadence or standalone)
- When CPA is rising and you suspect creative fatigue
- Before a creative production sprint to know what to brief
- When onboarding a new account and assessing creative health
- When a client asks "which ads are working?"

## Dependencies

| Skill | Why It's Needed |
|-------|----------------|
| `account_conventions` | Account config: KPI targets, flag thresholds, naming conventions, creative config |
| `creative_strategy_methodology` | Fatigue thresholds, hook/hold benchmarks, testing frameworks, volume requirements |
| `account_maturity_methodology` | Calibrates expectations -- nascent accounts get different benchmarks than advanced |

---

## Step 0: Load Dependencies

1. **Read `account-conventions/SKILL.md`** and extract for the target account:
   - `ad_account_id`, `currency`, `timezone`
   - `kpi_config` (primary KPI, targets, flag thresholds)
   - `creative_config` (testing framework, weekly volume target, active creative types)
   - `naming_conventions.ad` (parse creative type, concept, variant, format from ad names)
   - `capabilities.campaign_types_active`
   - `data_source.method` (mcp, csv, or manual)

2. **Read `creative-strategy-methodology/SKILL.md`** and load:
   - Fatigue detection signals and thresholds (Section 2)
   - Hook rate benchmarks by format (Section 3)
   - Hold rate benchmarks (Section 3)
   - Hook-Hold Matrix for classification
   - Creative volume requirements by spend level (Section 4)
   - Win rate benchmarks

3. **Read `account-maturity-methodology/SKILL.md`** and determine:
   - Current maturity level from account-conventions config
   - Adjusted benchmarks for that maturity level
   - Which analysis sections apply (nascent accounts skip advanced analyses)

4. **Determine analysis period:**
   - Default: last 14 days (current 7d vs prior 7d for trend detection)
   - Override if user specifies a different window
   - Set comparison period for fatigue WoW calculations

**Validation gate:** If `ad_account_id` is missing or `kpi_config.targets` are all zero, stop and prompt the user to complete account setup via the setup questionnaire.

---

## Step 1: Data Acquisition

Pull ad-level performance data for the analysis period.

### If data_source.method = "mcp" (Pipeboard Meta Ads MCP)

**Primary data pull -- ad-level insights:**

```
SDK call: `meta_ads_get_insights()` (from `sdk/tools/mcp_meta_ads`)
Parameters:
  account_id: {ad_account_id}
  level: "ad"
  time_range: "last_14d"
  time_increment: "1"  # Daily granularity for trend detection
  fields:
    - ad_id
    - ad_name
    - adset_id
    - adset_name
    - campaign_id
    - campaign_name
    - impressions
    - reach
    - frequency
    - clicks
    - ctr
    - cpc
    - cpm
    - spend
    - conversions
    - cost_per_action_type
    - actions
    - action_values
    - video_p25_watched_actions
    - video_p50_watched_actions
    - video_p75_watched_actions
    - video_p100_watched_actions
    - video_avg_time_watched_actions
    - video_play_actions
  breakdowns: []
```

**Secondary pull -- placement breakdown (for format analysis):**

```
SDK call: `meta_ads_get_insights()` (from `sdk/tools/mcp_meta_ads`)
Parameters:
  account_id: {ad_account_id}
  level: "ad"
  time_range: "last_7d"
  fields:
    - ad_id
    - ad_name
    - impressions
    - clicks
    - ctr
    - spend
    - conversions
    - cost_per_action_type
  breakdowns:
    - publisher_platform
    - platform_position
```

**Tertiary pull -- ad details for creative metadata:**

```
SDK call: `meta_ads_list_ads()` (from `sdk/tools/mcp_meta_ads`)
Parameters:
  account_id: {ad_account_id}
  fields:
    - id
    - name
    - status
    - effective_status
    - creative
    - created_time
  filtering:
    - field: "effective_status"
      operator: "IN"
      value: ["ACTIVE", "PAUSED"]
```

### If data_source.method = "csv"

Instruct the user to export:
1. **Ads Manager export** at ad level, last 14 days, daily breakdown, with columns: Ad Name, Ad Set Name, Campaign Name, Impressions, Reach, Frequency, Link Clicks, CTR, CPC, CPM, Amount Spent, Results, Cost per Result, Video Plays, Video Average Play Time, ThruPlays
2. **Placement breakdown export** at ad level, last 7 days
3. Save to `{csv_import_path}` and confirm file names

### If data_source.method = "manual"

Present a data entry template:
```
| Ad Name | Impressions | Spend | Clicks | CTR | CPA | Frequency | 3s Views | Avg Watch Time |
|---------|-------------|-------|--------|-----|-----|-----------|----------|----------------|
|         |             |       |        |     |     |           |          |                |
```

---

## Step 2: Creative Scorecard

Score every active ad on six dimensions. Each dimension is scored 1-5 (1 = critical, 5 = excellent).

### Scoring Dimensions

**1. Efficiency Score (CPA/ROAS vs target)**
- 5: CPA <80% of target (or ROAS >120% of target)
- 4: CPA 80-100% of target
- 3: CPA 100-120% of target
- 2: CPA 120-150% of target (warning threshold from flag_thresholds)
- 1: CPA >150% of target (critical threshold)

**2. Click Performance (CTR vs account average)**
- Calculate account average CTR across all active ads
- 5: CTR >150% of account average
- 4: CTR 120-150% of account average
- 3: CTR 80-120% of account average
- 2: CTR 50-80% of account average
- 1: CTR <50% of account average

**3. Frequency Health**
- Reference campaign type from naming conventions (prospecting vs retargeting)
- Prospecting: 5 (<1.5), 4 (1.5-2.0), 3 (2.0-2.5), 2 (2.5-3.0), 1 (>3.0)
- Retargeting: 5 (<3.0), 4 (3.0-5.0), 3 (5.0-7.0), 2 (7.0-10.0), 1 (>10.0)

**4. Spend Capacity**
- Measures whether the ad can absorb more budget without efficiency loss
- 5: Spending >90% of available budget, CPA stable or improving
- 4: Spending 70-90%, CPA stable
- 3: Spending 50-70%, room to grow
- 2: Spending 30-50%, underdelivering
- 1: Spending <30% or declining spend despite available budget

**5. Hook Rate (video ads only; skip for static)**
- Use benchmarks from creative-strategy-methodology Section 3
- 5: >40%, 4: 30-40%, 3: 25-30%, 2: 20-25%, 1: <20%
- Formula: hook_rate = video_play_actions (3s views) / impressions

**6. Hold Rate (video ads only; skip for static)**
- Formula: hold_rate = video_p50_watched_actions / video_play_actions
- 5: >60%, 4: 50-60%, 3: 40-50%, 2: 30-40%, 1: <30%

### Composite Score

- For video ads: average of all 6 dimensions (max 5.0)
- For static ads: average of dimensions 1-4 (max 5.0)
- Classify: 4.0+ = Star Performer, 3.0-3.9 = Solid, 2.0-2.9 = Underperformer, <2.0 = Kill Candidate

### Minimum Data Requirements

- Skip scoring for ads with <1,000 impressions or <$50 spend (insufficient data)
- Flag these as "Insufficient Data" in the scorecard

---

## Step 3: Fatigue Detection

Apply fatigue signals from creative-strategy-methodology Section 2 to every scored ad.

### For each ad, check:

| Signal | Calculation | Threshold | Flag Level |
|--------|------------|-----------|------------|
| CTR trend | CTR last 7d vs prior 7d | >10% decline | Warning |
| CTR trend | CTR last 7d vs prior 7d | >20% decline | Critical |
| CPA trend | CPA last 7d vs first 14d average | >15% increase | Warning |
| CPA trend | CPA last 7d vs first 14d average | >30% increase | Critical |
| Frequency (prospecting) | Avg frequency last 7d | >2.5 | Warning |
| Frequency (prospecting) | Avg frequency last 7d | >3.0 | Critical |
| Frequency (retargeting) | Avg frequency last 7d | >5.0 | Warning |
| Frequency (retargeting) | Avg frequency last 7d | >7.0 | Critical |
| Spend trend | Spend last 3d vs prior 3d | >25% decline (budget available) | Warning |
| Hook rate decline (video) | Hook rate last 7d vs prior 7d | >15% decline | Warning |

### Fatigue Classification

- **Healthy:** 0 signals triggered
- **Early Warning:** 1-2 warning signals
- **Active Fatigue:** 3+ warning signals OR 1 critical signal
- **Critical Fatigue:** 2+ critical signals

### WoW Calculation Method

Split the 14-day data into two 7-day windows:
- **Prior period:** Days 8-14 (older)
- **Current period:** Days 1-7 (recent)
- Calculate percentage change: ((current - prior) / prior) * 100

---

## Step 4: Format Analysis

Aggregate performance by creative format and placement.

### Format Performance Table

Parse `creative_type` from ad naming convention (`naming_conventions.ad` first token).

Group ads by format and calculate:
- Total spend per format
- Weighted average CPA per format
- Weighted average CTR per format
- Average hook rate per format (video formats only)
- Number of active ads per format
- Win rate per format (% of ads with CPA below target)

### Placement Performance per Creative

Using the placement breakdown data, identify for each ad:
- Which placements deliver best CPA
- Which placements have highest CTR
- Placement-creative mismatches (e.g., 16:9 video running in Stories placement)

### Format Mix Assessment

Compare actual format distribution to the recommended mix from creative-strategy-methodology Section 5:
- Flag if any single format is >50% of spend (concentration risk)
- Flag if recommended formats are missing entirely
- Calculate format diversity score: number of formats with >10% spend share

---

## Step 5: Creative Testing Analysis

Evaluate the creative testing pipeline health.

### Testing Velocity

- Count ads launched in last 7 days (use `created_time` from ad details)
- Compare to `creative_config.weekly_creative_volume_target`
- Calculate % of target achieved

### Test Win Rate

- Of ads launched in the last 30 days, how many are now "Star Performer" or "Solid"?
- Win rate = (Star + Solid ads) / total ads launched in period
- Compare to benchmarks from creative-strategy-methodology Section 4

### Testing Method Assessment

Based on `creative_config.testing_framework`:
- **Faris method:** Are new ads being added to existing scaling campaigns? Check ad count per ad set.
- **3:2:2:** Are test campaigns structured correctly? Look for campaigns with naming convention indicating test.
- **DCT:** Are dynamic creative ad sets active? Check for multiple creative assets per ad.

### Concept Coverage

Parse `concept` token from ad naming convention. Map active concepts:
- Which angles are represented?
- Which angles from the creative-strategy-methodology concept rotation list (Section 6) are missing?
- Are there enough variants per concept (target: 3-5)?

---

## Checkpoint: Present Findings

Before generating final outputs, present a summary to the user:

```
Creative Analysis Summary for {account_name}
Period: {date_range}

Top-Line Metrics:
- Active ads analyzed: {count}
- Account average CPA: {cpa} (target: {target})
- Account average CTR: {ctr}

Scorecard Summary:
- Star Performers (4.0+): {count} ({pct}%)
- Solid (3.0-3.9): {count} ({pct}%)
- Underperformers (2.0-2.9): {count} ({pct}%)
- Kill Candidates (<2.0): {count} ({pct}%)

Fatigue Summary:
- Healthy: {count}
- Early Warning: {count}
- Active Fatigue: {count}
- Critical Fatigue: {count}

Testing Velocity: {actual}/week vs {target}/week target ({pct}%)
Test Win Rate: {rate}% (benchmark: 15-20%)

Key flags:
- {list of critical findings}

Shall I generate the full deliverables (scorecard, fatigue alerts, refresh list, test plan)?
```

Wait for user confirmation before proceeding to Step 6.

---

## Step 6: Output Generation

Produce four deliverables. Save to `{reporting.output_path}` using `{reporting.output_naming}` convention.

### Deliverable 1: Creative Scorecard

See `references/output_specs.md` for exact format. Summary:

```markdown
# Creative Scorecard: {account_name}
Generated: {date} | Period: {date_range}

## Star Performers (Scale These)
| Ad Name | Format | Concept | CPA | CTR | Freq | Hook | Hold | Score | Action |
|---------|--------|---------|-----|-----|------|------|------|-------|--------|
| ...     | ...    | ...     | ... | ... | ...  | ...  | ...  | ...   | Scale  |

## Solid Performers (Maintain)
| ... same columns ... |

## Underperformers (Optimize or Replace)
| ... same columns ... |

## Kill Candidates (Pause Immediately)
| ... same columns ... |

## Insufficient Data (Monitor)
| ... same columns ... |
```

### Deliverable 2: Fatigue Alert List

```markdown
# Fatigue Alerts: {account_name}
Generated: {date}

## Critical Fatigue (Action Required Today)
| Ad Name | Days Active | Signals Triggered | Frequency | CPA Trend | Recommended Action |
|---------|-------------|-------------------|-----------|-----------|-------------------|
| ...     | ...         | CTR -22%, Freq 3.8| 3.8       | +28%      | Pause, replace     |

## Active Fatigue (Action Required This Week)
| ... same format ... |

## Early Warning (Monitor, Prepare Replacements)
| ... same format ... |
```

### Deliverable 3: Refresh Priority List

Ranked list of creative production priorities based on:
1. Fatiguing ads that need direct replacements (same angle, new execution)
2. Format gaps (underrepresented formats that should be tested)
3. Concept gaps (missing angles from the rotation list)
4. High-performing concepts that need more variants

```markdown
# Creative Refresh Priorities: {account_name}
Generated: {date}

## Priority 1: Fatiguing Replacements (This Week)
| Current Ad | Concept | Why | Brief |
|-----------|---------|-----|-------|
| VID_TESTIMON_V2 | Testimonial | Critical fatigue, freq 4.2 | New testimonial, different customer, same angle |

## Priority 2: Format Gaps
| Missing Format | Recommended % | Current % | Brief |
|---------------|---------------|-----------|-------|
| UGC video | 30% | 5% | Need 3-5 UGC concepts |

## Priority 3: Concept Gaps
| Missing Angle | Why It Matters | Brief |
|--------------|----------------|-------|
| Comparison | No us-vs-them creative running | Compare to top 3 alternatives |

## Priority 4: Variant Expansion
| Winning Concept | Current Variants | Target | Brief |
|----------------|------------------|--------|-------|
| FOUNDER_V1 | 1 variant | 3-5 | New hooks on same founder script |
```

### Deliverable 4: Creative Test Plan (Next Sprint)

```markdown
# Creative Test Plan: {account_name}
Sprint: {next_week_dates}
Testing Method: {testing_framework}
Budget Allocation: {testing_budget}

## Tests to Launch
| # | Concept | Format | Angle | Variants | Hypothesis | Success Metric |
|---|---------|--------|-------|----------|------------|----------------|
| 1 | ...     | Video  | ...   | 3        | ...        | CPA < ${target}|

## Graduating from Last Sprint
| Ad Name | Test Result | Action |
|---------|------------|--------|
| ...     | Winner (CPA $X) | Move to scaling campaign via Post ID |

## Kill from Last Sprint
| Ad Name | Why | Replacement Planned? |
|---------|-----|---------------------|
| ...     | CPA 2x target after 7d | Yes, in test #2 above |
```

---

## Error Handling

| Issue | Detection | Resolution |
|-------|----------|------------|
| No ad-level data returned | Empty response from MCP or no CSV | Verify ad_account_id, check account access permissions, confirm ads are active |
| All ads have <$50 spend | Every ad flagged "Insufficient Data" | Account may be paused or just launched. Recommend waiting for more data (minimum 7 days, $500+ total spend) |
| Naming conventions don't match | Cannot parse creative_type/concept tokens | Fall back to manual classification. Recommend implementing naming conventions. |
| No video metrics | video_play_actions is null for all ads | Account may only run static. Skip hook/hold analysis, score on 4 dimensions only |
| Conversion data missing | CPA/ROAS cannot be calculated | Check pixel firing, attribution window. May need measurement audit first (run audit-measurement) |
| API rate limits | MCP tool returns rate limit error | Wait 60 seconds, retry. If persistent, switch to CSV export method |
| Date range mismatch | Less than 14 days of data available | Narrow to available range, note reduced confidence in WoW fatigue calculations |

---

## Execution Capability

After generating the creative scorecard and fatigue alert list, this skill can queue draft status changes for human approval. No ad status changes execute automatically.

### Execution vs Analysis

| Action | Execution Method | Requires Human Approval? |
|--------|-----------------|--------------------------|
| Pause fatigued ads | `update_ad` (status: PAUSED) via MCP | Yes -- shows draft before executing |
| Activate backup/replacement ads | `update_ad` (status: ACTIVE) via MCP | Yes -- shows draft before executing |
| Pull creative performance data | `get_insights` via MCP | No approval needed (read-only) |
| Creating new ads | Must upload creative first via UI; ad creation is handled in the launch-campaign skill | Cannot execute via MCP |

### Step 7 Addition: Proposed Changes Queue

After generating the fatigue alert list (Deliverable 2), and if the user wants to act on it, produce a draft change queue. Present for approval before making any changes.

```
Proposed Changes -- Creative Analysis
======================================
Review each change below. Confirm to execute, skip, or modify.

[ ] Pause: VID_TESTIMON_V2 (Ad ID: 123456789)
    Tool: update_ad -- status: PAUSED
    Evidence: CTR -24% WoW, frequency 4.2 (critical), CPA +31% WoW
    Fatigue classification: Critical
    Status: DRAFT -- awaiting approval

[ ] Pause: STATIC_BENEFIT_V1 (Ad ID: 987654321)
    Tool: update_ad -- status: PAUSED
    Evidence: CTR -18% WoW, frequency 3.1, CPA +22% WoW
    Fatigue classification: Active Fatigue
    Status: DRAFT -- awaiting approval

[ ] Activate: VID_TESTIMON_V3 (Ad ID: 111222333)
    Tool: update_ad -- status: ACTIVE
    Evidence: Backup creative prepared, same concept, new execution
    Note: Intended replacement for VID_TESTIMON_V2 above
    Status: DRAFT -- awaiting approval
```

**Only proceed with each change after explicit user confirmation per item.**

---

## Reference Files

- `references/data_requirements.md` -- Complete list of MCP tool calls, API fields, CSV column mappings, and data validation rules
- `references/output_specs.md` -- Exact markdown templates for all four deliverables with field definitions and formatting rules
- `references/worked_example.md` -- End-to-end walkthrough using sample data from a $50K/month e-commerce account
