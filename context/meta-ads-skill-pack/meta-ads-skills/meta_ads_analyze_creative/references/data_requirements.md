# Data Requirements: analyze-creative

## MCP Tool Calls

### Primary: Ad-Level Insights (14-day, daily granularity)

```
SDK call: `meta_ads_get_insights()` (from `sdk/tools/mcp_meta_ads`)
Parameters:
  account_id: {ad_account_id}
  level: "ad"
  time_range: "last_14d"
  time_increment: "1"
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

**Purpose:** Core data for scorecard, fatigue detection, and trend analysis. Daily granularity enables WoW comparison (days 1-7 vs days 8-14).

### Secondary: Placement Breakdown (7-day)

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

**Purpose:** Format analysis (Step 4). Identifies which placements perform best per creative and detects creative-placement mismatches.

### Tertiary: Ad Configuration Details

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

**Purpose:** Creative metadata for format classification and testing velocity (Step 5). `created_time` determines which ads are new (launched in last 7 days).

## CSV Column Mappings

If using CSV exports instead of MCP, the following Ads Manager columns map to the required fields:

| API Field | Ads Manager Column | Notes |
|-----------|-------------------|-------|
| ad_name | Ad Name | |
| adset_name | Ad Set Name | |
| campaign_name | Campaign Name | |
| impressions | Impressions | |
| reach | Reach | |
| frequency | Frequency | |
| clicks | Link Clicks | Use "Link Clicks" not "All Clicks" |
| ctr | CTR (Link Click-Through Rate) | Use link CTR, not all CTR |
| cpc | CPC (Cost per Link Click) | |
| cpm | CPM (Cost per 1,000 Impressions) | |
| spend | Amount Spent | |
| conversions | Results | Depends on campaign objective |
| cost_per_action_type | Cost per Result | |
| video_play_actions | 3-Second Video Plays | |
| video_p50_watched_actions | Video Plays at 50% | |
| video_p75_watched_actions | Video Plays at 75% | |
| video_p100_watched_actions | Video Plays at 100% | |
| video_avg_time_watched_actions | Video Average Play Time | |

### Required CSV Export Settings

1. **Level:** Ad
2. **Date range:** Last 14 days
3. **Breakdown:** Day (for trend detection)
4. **Columns:** All columns listed above
5. **File format:** CSV

For placement breakdown, export a separate file:
1. **Level:** Ad
2. **Date range:** Last 7 days
3. **Breakdown:** Placement
4. **Columns:** Ad Name, Impressions, Clicks, CTR, Amount Spent, Results, Cost per Result

## Data Validation Rules

Before processing, validate:

| Field | Validation | Error Behavior |
|-------|-----------|----------------|
| impressions | Must be >= 0 integer | Skip row if negative |
| spend | Must be >= 0 decimal | Skip row if negative |
| ctr | Must be 0-1 decimal (or 0-100%) | Normalize to decimal if percentage |
| frequency | Must be >= 1.0 | Flag if < 1.0 (data error) |
| video_play_actions | Must be <= impressions | Flag if exceeds impressions |
| cost_per_action_type | Array of {action_type, value} | Extract value for primary KPI action type |

## Minimum Data Requirements

| Metric | Minimum for Analysis | Minimum for Fatigue Detection |
|--------|---------------------|------------------------------|
| Impressions per ad | 1,000 | 5,000 |
| Spend per ad | $50 | $200 |
| Days of data | 7 | 14 |
| Active ads | 3 | 3 |
| Account total spend | $500 | $2,000 |
