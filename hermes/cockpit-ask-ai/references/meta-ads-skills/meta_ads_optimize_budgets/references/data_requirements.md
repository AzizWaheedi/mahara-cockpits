# Data Requirements: optimize-budgets

## MCP Tool Calls

### Primary: Campaign-Level Insights (14-day, daily)

```
SDK call: `meta_ads_get_insights()` (from `sdk/tools/mcp_meta_ads`)
Parameters:
  account_id: {ad_account_id}
  level: "campaign"
  time_range: "last_14d"
  time_increment: "1"
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

**Purpose:** Daily spend and CPA data for pacing analysis, marginal efficiency modeling, and trend detection.

### Secondary: Campaign Configuration

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

**Purpose:** Budget amounts and types for pacing ratio calculation.

### Tertiary: Ad Set-Level Performance

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

**Purpose:** CBO internal distribution analysis -- how Meta allocates budget across ad sets within CBO campaigns.

### Quaternary: Ad Set Configuration

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

**Purpose:** ABO budget details and bid amounts for budget-per-ad-set analysis.

## CSV Column Mappings

| API Field | Ads Manager Column | Notes |
|-----------|-------------------|-------|
| campaign_name | Campaign Name | |
| spend | Amount Spent | |
| daily_budget | Daily Budget | Campaign or ad set level depending on CBO/ABO |
| budget_remaining | Budget Remaining | Only for lifetime budgets |
| conversions | Results | |
| cost_per_action_type | Cost per Result | |
| impressions | Impressions | |
| cpm | CPM | |
| action_values | Purchase Conversion Value | For ROAS calculation |

### Required CSV Exports

1. **Campaign-level:** Last 14 days, daily breakdown, include Budget, Delivery columns
2. **Ad set-level:** Last 7 days, daily breakdown, include Budget column
3. **Campaign settings export:** Budget type (CBO/ABO), daily/lifetime budget, bid strategy

## Derived Calculations

| Calculation | Formula | Notes |
|------------|---------|-------|
| Pacing ratio | avg_daily_spend / daily_budget | For lifetime budgets: remaining_budget / remaining_days |
| Marginal CPA (simple) | CPA on highest-spend days / CPA on average days | >1.15 = inflecting, >1.30 = diminishing |
| Daily CPA | daily_spend / daily_conversions | Skip days with 0 conversions |
| Budget headroom | daily_budget - avg_daily_spend | Positive = room to grow |
| ROAS | sum(action_values) / spend | Only if conversion values are tracked |

## Minimum Data Requirements

| Metric | Minimum for Analysis |
|--------|---------------------|
| Active campaigns | 2 (reallocation needs source + destination) |
| Days of data | 7 (14 preferred for marginal analysis) |
| Total account spend | $1,000/week |
| Campaigns with conversions | At least 2 |
| Daily conversions per campaign | 3+ for marginal analysis, <3 = insufficient data flag |
