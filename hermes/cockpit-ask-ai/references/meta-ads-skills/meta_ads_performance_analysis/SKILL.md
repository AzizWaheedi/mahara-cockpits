---
name: performance_analysis
description: Action skill that produces account and campaign-level performance dashboards for Meta Ads with week-over-week and month-over-month comparisons, trend analysis, and automated flag generation. This is typically the first skill run in any review cadence.
triggers:
  - "performance analysis"
  - "weekly report"
  - "how are my ads doing"
  - "performance dashboard"
  - "campaign performance"
  - "account overview"
  - "WoW comparison"
  - "performance review"
---

# Performance Analysis

## Purpose

This skill produces the foundational performance dashboard for any Meta Ads review. It is designed to be the first skill run in every weekly, monthly, or ad-hoc review because every other action skill depends on the performance context it establishes. The dashboard answers the three questions every media buyer asks first: "How much did we spend?", "What did we get for it?", and "Is it getting better or worse?"

The output is a structured markdown dashboard with traffic-light flags (green/yellow/red) that immediately surface what needs attention. This eliminates the manual process of pulling data into spreadsheets, calculating deltas, and eyeballing trends.

---

## Dependencies

This skill loads the following at Step 0:

| Dependency | Purpose |
|------------|---------|
| `account_conventions` | Account config, KPI targets, flag thresholds, reporting period preferences |
| `account_maturity_methodology` | Maturity-calibrated benchmarks and expectations |

---

## Workflow

### Step 0: Load Dependencies

1. Read `account_conventions` for this account's config:
   - KPI targets (CPA, ROAS, CTR, CPM, frequency cap)
   - Flag thresholds (critical and warning levels)
   - Reporting period preference (`last_7_days`, `last_14_days`, etc.)
   - Comparison method (`preceding_period`, `same_period_last_month`, etc.)
   - Naming conventions (for parsing campaign metadata)
   - Currency and timezone
2. Read `account_maturity_methodology` to calibrate benchmark expectations
3. Confirm data source method (MCP, CSV, or manual)
4. Calculate reporting periods:
   - **Current period:** Based on reporting preference (e.g., last 7 days)
   - **Comparison period:** Based on comparison method (e.g., preceding 7 days)
   - **Trend period:** Last 4 weeks (for rolling trend analysis)

### Step 1: Data Acquisition

Pull account-level and campaign-level insights for the current period and comparison period.

**Account-level metrics (required):**

| Metric | Field | Purpose |
|--------|-------|---------|
| Spend | spend | Total investment |
| Impressions | impressions | Delivery volume |
| Reach | reach | Unique people reached |
| Frequency | frequency | Average times each person saw ads |
| Clicks (all) | clicks | Total clicks (includes all click types) |
| Link clicks | outbound_clicks | Clicks to destination URL |
| CTR (link) | outbound_clicks / impressions | Click-through rate to destination |
| CPC (link) | spend / outbound_clicks | Cost per link click |
| CPM | (spend / impressions) * 1000 | Cost per thousand impressions |
| Conversions | actions[action_type=purchase] | Primary conversion events |
| Conversion value | action_values[action_type=purchase] | Revenue from conversions |
| CPA | spend / conversions | Cost per acquisition |
| ROAS | conversion_value / spend | Return on ad spend |
| Conversion rate | conversions / link_clicks | Click-to-conversion rate |

**Campaign-level metrics (same fields, per campaign):**
- All active campaigns
- All campaigns with spend in the current period
- Recently paused campaigns (paused within last 7 days)

**Additional breakdowns (if available):**
- By platform (Facebook, Instagram, Audience Network, Messenger)
- By placement (Feed, Stories, Reels, Search, etc.)
- By device (Mobile, Desktop)

### Step 2: Account-Level Dashboard

Present the top-level account health view with traffic-light flags.

**Flag logic (from account-conventions thresholds):**

| Flag | Color | Condition |
|------|-------|-----------|
| Green | Normal | Metric within target range |
| Yellow | Warning | Metric exceeds warning threshold |
| Red | Critical | Metric exceeds critical threshold |

**Account dashboard format:**

```
Account Performance Dashboard
==============================
Account: [Name] | Period: [Date Range] | Currency: [XXX]

| Metric         | Current  | Prior    | Delta   | Flag  |
|----------------|----------|----------|---------|-------|
| Spend          | $X,XXX   | $X,XXX  | +XX%    | --    |
| Conversions    | XXX      | XXX     | +XX%    | Green |
| CPA            | $XX.XX   | $XX.XX  | -XX%    | Green |
| ROAS           | X.Xx     | X.Xx    | +XX%    | Green |
| Revenue        | $XX,XXX  | $XX,XXX | +XX%    | --    |
| CTR (link)     | X.XX%    | X.XX%   | +XX%    | Green |
| CPC (link)     | $X.XX    | $X.XX   | -XX%    | Green |
| CPM            | $XX.XX   | $XX.XX  | +XX%    | Yellow|
| Reach          | XXX,XXX  | XXX,XXX | +XX%    | --    |
| Frequency      | X.X      | X.X     | +XX%    | Green |
| Conv Rate      | X.XX%    | X.XX%   | +XX%    | --    |

Target Reference: CPA target $XX.XX | ROAS target X.Xx
```

**Spend context:**
- Calculate spend pacing: daily spend rate vs monthly budget (if defined)
- Calculate projected monthly spend at current rate
- Flag if pacing is off by >15%

**Efficiency context:**
- Calculate blended efficiency: CPA relative to target
- If ROAS account: revenue per dollar spent
- If CPA account: conversions per dollar spent

### Step 3: Campaign-Level Dashboard

Break down performance by campaign with the same flag system.

**Campaign dashboard format:**

```
Campaign Performance
=====================

| Campaign           | Obj  | Status  | Spend    | Conv | CPA     | ROAS  | WoW   | Flag  |
|--------------------|------|---------|----------|------|---------|-------|-------|-------|
| [Campaign 1]       | CONV | Active  | $X,XXX   | XX   | $XX.XX  | X.Xx  | +XX%  | Green |
| [Campaign 2]       | CONV | Active  | $X,XXX   | XX   | $XX.XX  | X.Xx  | -XX%  | Red   |
| [Campaign 3]       | TRAF | Active  | $XXX     | --   | --      | --    | +XX%  | Green |
| [Campaign 4]       | CONV | Paused  | $0       | 0    | --      | --    | N/A   | --    |
```

**Per-campaign detail (expandable):**

For each campaign with a yellow or red flag, provide additional context:
- Top 3 ad sets by spend with individual performance
- Top 3 ads by spend with individual performance
- Delivery status (Active, Learning, Learning Limited)
- Recent changes (edits in last 7 days)
- Frequency trend (last 4 weeks)

**Campaign type segmentation:**
If naming conventions allow parsing, group campaigns by:
- Objective (CONV, TRAF, REACH, etc.)
- Audience (PROS, RT, ASC, LAL)
- Geo (US, UK, EU, etc.)

### Step 4: Trend Analysis

Analyze 4-week rolling trends for key metrics to identify accelerating or decelerating patterns.

**Trend table format:**

```
4-Week Trend Analysis
======================

| Metric    | Week -4  | Week -3  | Week -2  | Week -1  | Trend     | Signal           |
|-----------|----------|----------|----------|----------|-----------|------------------|
| Spend     | $X,XXX   | $X,XXX   | $X,XXX   | $X,XXX   | +X%/wk    | Scaling          |
| CPA       | $XX.XX   | $XX.XX   | $XX.XX   | $XX.XX   | +X%/wk    | Deteriorating    |
| ROAS      | X.Xx     | X.Xx     | X.Xx     | X.Xx     | -X%/wk    | Deteriorating    |
| CTR       | X.XX%    | X.XX%    | X.XX%    | X.XX%    | -X%/wk    | Creative fatigue |
| CPM       | $XX.XX   | $XX.XX   | $XX.XX   | $XX.XX   | +X%/wk    | Rising costs     |
| Frequency | X.X      | X.X      | X.X      | X.X      | +X%/wk    | Audience saturation |
| Conv Rate | X.XX%    | X.XX%    | X.XX%    | X.XX%    | Flat      | Stable           |
```

**Trend signals and their meanings:**

| Signal | Pattern | Implication | Follow-Up Skill |
|--------|---------|-------------|----------------|
| CPA accelerating upward | CPA increasing each week | Performance degrading, investigate cause | investigate_campaign |
| CTR declining 3+ weeks | CTR dropping consecutively | Creative fatigue likely | analyze_creative |
| CPM rising, conversions flat | Costs up, volume flat | Auction competition increasing | optimize_budgets |
| Frequency climbing | Frequency increasing weekly | Audience saturation | audit_audiences |
| ROAS declining while spend increases | Efficiency decreasing at scale | Scaling too fast or audience exhaustion | optimize_budgets |
| CPA stable, spend increasing | Efficiency maintained while scaling | Healthy scaling, continue | None (good news) |

**Month-over-month comparison (if reporting period allows):**
- Same metrics, current month vs prior month
- Useful for detecting seasonal patterns vs performance changes
- Flag any MoM changes >25% for investigation

### Step 5: Flag Generation

Auto-generate flags based on account-conventions thresholds. Flags are the bridge between this skill and other action skills.

**Flag types:**

| Flag ID | Condition | Severity | Recommended Skill |
|---------|-----------|----------|-------------------|
| CPA_WARN | CPA exceeds target by warning % | Yellow | investigate_campaign |
| CPA_CRIT | CPA exceeds target by critical % | Red | investigate_campaign |
| ROAS_WARN | ROAS below target by warning % | Yellow | investigate_campaign |
| ROAS_CRIT | ROAS below target by critical % | Red | investigate_campaign |
| SPEND_PACE | Spend pacing off by >15% | Yellow | optimize_budgets |
| FREQ_WARN | Frequency exceeds warning level | Yellow | audit_audiences |
| FREQ_CRIT | Frequency exceeds critical level | Red | audit_audiences |
| CTR_DECLINE | CTR declining 3+ consecutive weeks | Yellow | analyze_creative |
| CTR_CRIT | CTR below critical threshold | Red | analyze_creative |
| NO_CONV | Campaign spending for 24h+ with zero conversions | Red | investigate_campaign |
| LEARNING | Campaign stuck in learning limited | Yellow | audit_structure |
| CPA_SPIKE | CPA >50% above 4-week average (sudden) | Red | investigate_campaign |

**Flag output format:**

```
Active Flags
=============

| Flag         | Campaign/Account | Value    | Threshold | Severity | Action              |
|-------------|-----------------|----------|-----------|----------|---------------------|
| CPA_CRIT    | [Campaign X]     | $45.00   | $30.00    | Red      | investigate_campaign |
| CTR_DECLINE | [Campaign Y]     | 3 weeks  | 3 weeks   | Yellow   | analyze_creative    |
| FREQ_WARN   | [Campaign Z]     | 3.2      | 2.5       | Yellow   | audit_audiences     |
```

---

## Checkpoint: Present Dashboard and Confirm Flags

Present the complete dashboard to the user before any output file is generated:

```
Performance Analysis Complete
==============================

Account: [Name]
Period: [Date Range]
Overall Status: [Healthy / Warning / Critical]

Summary:
- Spend: $X,XXX ([+/-]XX% WoW)
- Conversions: XXX ([+/-]XX% WoW)
- CPA: $XX.XX ([+/-]XX% WoW) [Flag color]
- ROAS: X.Xx ([+/-]XX% WoW) [Flag color]

Active Flags: [X] (Red: [X], Yellow: [X])
Campaigns Flagged: [list]

Recommended follow-up skills: [list based on flags]
```

**Wait for user confirmation before generating the full report file.**

---

### Step 6: Output

```markdown
# Meta Ads Performance Dashboard

**Account:** [Name] | **Account ID:** [act_XXXXX]
**Period:** [Start Date] - [End Date]
**Comparison:** [Comparison Period Description]
**Report Generated:** [Today, Time]

## Account Health: [Healthy / Warning / Critical]

### Account Summary

| Metric | Current | Prior | Delta | vs Target | Flag |
|--------|---------|-------|-------|-----------|------|
| Spend | $X,XXX | $X,XXX | +XX% | -- | -- |
| Conversions | XXX | XXX | +XX% | -- | Green |
| CPA | $XX.XX | $XX.XX | +XX% | +XX% over | Yellow |
| ROAS | X.Xx | X.Xx | -XX% | -XX% under | Yellow |
| Revenue | $XX,XXX | $XX,XXX | +XX% | -- | -- |
| CTR (link) | X.XX% | X.XX% | +XX% | -- | Green |
| CPC (link) | $X.XX | $X.XX | -XX% | -- | Green |
| CPM | $XX.XX | $XX.XX | +XX% | -- | -- |
| Reach | XXX,XXX | XXX,XXX | +XX% | -- | -- |
| Frequency | X.X | X.X | +XX% | -- | Green |

### Spend Pacing

| Budget | Daily Rate | Projected Monthly | Pacing |
|--------|-----------|-------------------|--------|
| $XX,XXX/month | $X,XXX/day | $XX,XXX | On track / Over / Under |

## Campaign Performance

| Campaign | Objective | Status | Spend | Conv | CPA | ROAS | WoW CPA | Flag |
|----------|----------|--------|-------|------|-----|------|---------|------|
| | | | | | | | | |

### Flagged Campaigns Detail

#### [Campaign Name] - [Flag Type]
- **Issue:** [Description]
- **Evidence:** [Data points]
- **Trend:** [4-week context]
- **Recommended action:** [Specific next step]
- **Follow-up skill:** [skill_name]

## 4-Week Trend Analysis

| Metric | Wk -4 | Wk -3 | Wk -2 | Wk -1 (current) | Trend | Signal |
|--------|-------|-------|-------|-----------------|-------|--------|
| | | | | | | |

## Active Flags

| # | Flag | Scope | Value | Threshold | Severity | Recommended Action |
|---|------|-------|-------|-----------|----------|--------------------|
| | | | | | | |

## Breakdown by Platform (if available)

| Platform | Spend | Conv | CPA | CTR | CPM |
|----------|-------|------|-----|-----|-----|
| Facebook | | | | | |
| Instagram | | | | | |
| Audience Network | | | | | |
| Messenger | | | | | |

## Breakdown by Placement (if available)

| Placement | Spend | Conv | CPA | CTR | CPM |
|-----------|-------|------|-----|-----|-----|
| Feed | | | | | |
| Stories | | | | | |
| Reels | | | | | |
| Search | | | | | |
| Other | | | | | |

## Recommendations

### Immediate Actions (from flags)
1. [Action] - [Campaign] - [Expected impact]

### Optimization Opportunities (from trends)
1. [Action] - [Campaign] - [Expected impact]

### Skills to Run Next
| Skill | Reason | Priority |
|-------|--------|----------|
| investigate_campaign | [Campaign X] flagged red for CPA | High |
| analyze_creative | CTR declining across account | Medium |
| audit_audiences | Frequency approaching threshold | Low |

## Notes

[Any caveats: attribution lag, recent account changes, seasonality, data gaps]
```

---

## Flag Threshold Quick Reference

Default thresholds (override with account-conventions):

| Metric | Warning | Critical |
|--------|---------|----------|
| CPA over target | +20% | +50% |
| ROAS under target | -20% | -40% |
| Frequency (prospecting) | 2.5 | 4.0 |
| CTR | <0.01 | <0.005 |
| Spend without conversions | 24 hours | 48 hours |
| CPA sudden spike | +30% vs 4-week avg | +50% vs 4-week avg |
| CTR decline | 2 consecutive weeks | 3 consecutive weeks |

---

## Reference Files

- `references/data_requirements.md` - Exact MCP calls, API fields, and CSV column mappings for all metrics
- `references/output_specs.md` - Dashboard format specification with pixel-perfect template
- `references/worked_example.md` - Complete example dashboard for a $30K/month ecommerce account with 3 active campaigns, showing WoW comparison, flag generation, and trend analysis
