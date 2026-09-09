# Automated Rule Templates

Ready-made rule specifications for each guardian rule category. Replace placeholder values (marked `{REPLACE}`) with account-specific values from `account_conventions`.

These templates show the actual `evaluation_spec` and `execution_spec` JSON structure used by the Meta Ads API via `meta_ads_create_ad_rule`.

---

## Category 1: Kill Switches

Kill switches auto-pause campaigns or ad sets when performance degrades beyond acceptable thresholds. They are the most critical rules -- never launch a campaign without at least one kill switch.

### 1.1 CPA Kill Switch (Ad Set Level)

Pauses an ad set when CPA exceeds 2x the target.

```json
{
  "name": "{ACCOUNT_PREFIX}_CPA_KILL_SWITCH_{DATE}",
  "evaluation_spec": {
    "evaluation_type": "SCHEDULE",
    "filters": [
      {
        "field": "cost_per_action_type",
        "value": ["{TARGET_CPA_CENTS * 2}"],
        "operator": "GREATER_THAN"
      },
      {
        "field": "impressions",
        "value": ["1000"],
        "operator": "GREATER_THAN"
      }
    ],
    "time_range": {
      "key": "LAST_7_DAYS"
    }
  },
  "execution_spec": {
    "execution_type": "PAUSE"
  },
  "schedule_spec": {
    "schedule_type": "SEMI_HOURLY"
  },
  "status": "ENABLED"
}
```

Notes:
- Replace `{TARGET_CPA_CENTS * 2}` with 2x your target CPA in cents. Target $50 CPA = value "10000" (2x = $100 = 10000 cents).
- The impressions filter (>1,000) prevents the rule from firing before the ad set has enough delivery to produce a meaningful CPA.
- `SEMI_HOURLY` means the rule evaluates every 30 minutes -- appropriate for spending campaigns.
- `LAST_7_DAYS` smooths out daily variance. For tighter control, use `LAST_3_DAYS`.

Variant -- tighter window for high-spend campaigns:
```json
"time_range": { "key": "LAST_3_DAYS" }
```

### 1.2 CTR Kill Switch (Ad Level)

Pauses individual ads when CTR falls below 0.3% -- indicating creative is not resonating.

```json
{
  "name": "{ACCOUNT_PREFIX}_CTR_KILL_SWITCH_{DATE}",
  "evaluation_spec": {
    "evaluation_type": "SCHEDULE",
    "filters": [
      {
        "field": "ctr",
        "value": ["0.3"],
        "operator": "LESS_THAN"
      },
      {
        "field": "impressions",
        "value": ["2000"],
        "operator": "GREATER_THAN"
      }
    ],
    "time_range": {
      "key": "LAST_7_DAYS"
    }
  },
  "execution_spec": {
    "execution_type": "PAUSE"
  },
  "schedule_spec": {
    "schedule_type": "DAILY",
    "schedule_day": 1,
    "schedule_time": "08:00"
  },
  "status": "ENABLED"
}
```

Notes:
- CTR thresholds vary by placement. 0.3% is a conservative floor for Feed placements. Reels may run lower CTR but higher VCR -- adjust threshold if placement-specific.
- The impressions floor (>2,000) prevents early pausing of new ads that haven't delivered enough.
- Applied at AD level (not ad set) to surgically remove weak creatives.

### 1.3 Frequency Kill Switch (Ad Set Level)

Pauses an ad set when frequency exceeds 4.0 for prospecting (audience fatigue).

```json
{
  "name": "{ACCOUNT_PREFIX}_FREQ_KILL_SWITCH_{DATE}",
  "evaluation_spec": {
    "evaluation_type": "SCHEDULE",
    "filters": [
      {
        "field": "frequency",
        "value": ["4.0"],
        "operator": "GREATER_THAN"
      },
      {
        "field": "impressions",
        "value": ["5000"],
        "operator": "GREATER_THAN"
      }
    ],
    "time_range": {
      "key": "LAST_7_DAYS"
    }
  },
  "execution_spec": {
    "execution_type": "PAUSE"
  },
  "schedule_spec": {
    "schedule_type": "DAILY",
    "schedule_day": 1,
    "schedule_time": "09:00"
  },
  "status": "ENABLED"
}
```

Notes:
- Threshold should differ by audience type. Prospecting: 4.0. Retargeting: 6.0. Adjust per `manage_automated_rules` maturity table.
- Consider SEND_NOTIFICATION instead of PAUSE for retargeting (higher frequency is acceptable; you want awareness, not a hard stop).

---

## Category 2: Budget Pacing Guards

Pacing guards adjust budgets dynamically to keep campaigns on pace or protect against unexpected overspend.

### 2.1 ROAS Increase Trigger (Campaign Level, CBO)

Increases CBO campaign budget by 20% when ROAS is above target for 3+ days -- indicating headroom to scale.

```json
{
  "name": "{ACCOUNT_PREFIX}_ROAS_SCALE_UP_{DATE}",
  "evaluation_spec": {
    "evaluation_type": "SCHEDULE",
    "filters": [
      {
        "field": "purchase_roas",
        "value": ["{TARGET_ROAS * 1.2}"],
        "operator": "GREATER_THAN"
      },
      {
        "field": "spend",
        "value": ["{MIN_SPEND_CENTS}"],
        "operator": "GREATER_THAN"
      }
    ],
    "time_range": {
      "key": "LAST_3_DAYS"
    }
  },
  "execution_spec": {
    "execution_type": "ADJUST_BUDGET",
    "execution_options": {
      "max": "{BUDGET_CAP_CENTS}",
      "value": 20,
      "duration_value": 1,
      "duration_unit": "DAYS"
    }
  },
  "schedule_spec": {
    "schedule_type": "DAILY",
    "schedule_day": 1,
    "schedule_time": "07:00"
  },
  "status": "ENABLED"
}
```

Notes:
- Replace `{TARGET_ROAS * 1.2}` with 1.2x your ROAS target. Target ROAS 2.0 = value "2.4".
- `{MIN_SPEND_CENTS}`: minimum spend in the period before scaling (e.g., $100/3 days = "30000" cents). Prevents scaling campaigns that are barely spending.
- `{BUDGET_CAP_CENTS}`: maximum daily budget to scale to. Prevents runaway increases. Set to 3-5x current daily budget.
- 20% increase per day is a conservative, algorithm-friendly scaling rate. Increases above 20% can reset the learning phase.

### 2.2 CPA Decrease Trigger (Ad Set Level, ABO)

Decreases ad set budget by 25% when CPA exceeds 1.5x target -- before the kill switch fires.

```json
{
  "name": "{ACCOUNT_PREFIX}_CPA_BUDGET_REDUCE_{DATE}",
  "evaluation_spec": {
    "evaluation_type": "SCHEDULE",
    "filters": [
      {
        "field": "cost_per_action_type",
        "value": ["{TARGET_CPA_CENTS * 1.5}"],
        "operator": "GREATER_THAN"
      },
      {
        "field": "impressions",
        "value": ["500"],
        "operator": "GREATER_THAN"
      }
    ],
    "time_range": {
      "key": "LAST_7_DAYS"
    }
  },
  "execution_spec": {
    "execution_type": "ADJUST_BUDGET",
    "execution_options": {
      "min": "{MIN_BUDGET_CENTS}",
      "value": -25,
      "duration_value": 1,
      "duration_unit": "DAYS"
    }
  },
  "schedule_spec": {
    "schedule_type": "DAILY",
    "schedule_day": 1,
    "schedule_time": "09:00"
  },
  "status": "ENABLED"
}
```

Notes:
- This fires before the kill switch (1.5x vs 2x CPA). Reduces budget without pausing -- gives the ad set a chance to recover.
- `{MIN_BUDGET_CENTS}`: floor budget to prevent reducing below viable spend (e.g., $20/day = "2000" cents).
- Pair with the CPA kill switch (1.1). The sequence: CPA 1.5x → reduce budget 25%, CPA 2x → pause.

---

## Category 3: Creative Fatigue Alerts

Fatigue alerts notify (but do not pause) when frequency reaches warning levels -- giving the media buyer time to queue replacement creatives before performance degrades.

### 3.1 Prospecting Fatigue Alert (Ad Set Level)

Sends notification when prospecting audience frequency exceeds 2.5.

```json
{
  "name": "{ACCOUNT_PREFIX}_PROSP_FATIGUE_ALERT_{DATE}",
  "evaluation_spec": {
    "evaluation_type": "SCHEDULE",
    "filters": [
      {
        "field": "frequency",
        "value": ["2.5"],
        "operator": "GREATER_THAN"
      },
      {
        "field": "impressions",
        "value": ["5000"],
        "operator": "GREATER_THAN"
      }
    ],
    "time_range": {
      "key": "LAST_7_DAYS"
    }
  },
  "execution_spec": {
    "execution_type": "SEND_NOTIFICATION",
    "execution_options": {
      "email_message": "FATIGUE ALERT: Ad set '{adset.name}' in campaign '{campaign.name}' has reached frequency {adset.frequency} on prospecting audience. Queue replacement creatives. CPA: ${adset.cost_per_action_type}. Spend: ${adset.spend}."
    }
  },
  "schedule_spec": {
    "schedule_type": "DAILY",
    "schedule_day": 1,
    "schedule_time": "08:00"
  },
  "status": "ENABLED"
}
```

Notes:
- This is a NOTIFICATION rule, not a pause rule. Prospecting at 2.5 frequency = warning zone, not emergency.
- Pair with the Frequency Kill Switch (1.3) at 4.0 for a two-stage system: alert at 2.5, auto-pause at 4.0.
- Email goes to account admin. Meta does not support Slack/webhook notifications via automated rules.

### 3.2 Retargeting Fatigue Alert (Ad Set Level)

Sends notification when retargeting frequency exceeds 6.0.

```json
{
  "name": "{ACCOUNT_PREFIX}_RETARG_FATIGUE_ALERT_{DATE}",
  "evaluation_spec": {
    "evaluation_type": "SCHEDULE",
    "filters": [
      {
        "field": "frequency",
        "value": ["6.0"],
        "operator": "GREATER_THAN"
      }
    ],
    "time_range": {
      "key": "LAST_7_DAYS"
    }
  },
  "execution_spec": {
    "execution_type": "SEND_NOTIFICATION",
    "execution_options": {
      "email_message": "RETARGETING FATIGUE: Ad set '{adset.name}' has frequency {adset.frequency}. Consider refreshing retargeting creatives or expanding the retargeting window."
    }
  },
  "schedule_spec": {
    "schedule_type": "DAILY",
    "schedule_day": 1,
    "schedule_time": "08:00"
  },
  "status": "ENABLED"
}
```

---

## Category 4: Learning Phase Protection

### 4.1 Learning Phase Drop Alert (Ad Set Level)

Sends notification if an ad set's delivery status changes -- which can indicate exit from learning phase, auction instability, or a policy issue.

```json
{
  "name": "{ACCOUNT_PREFIX}_LEARNING_DROP_ALERT_{DATE}",
  "evaluation_spec": {
    "evaluation_type": "SCHEDULE",
    "filters": [
      {
        "field": "spend",
        "value": ["0"],
        "operator": "GREATER_THAN"
      },
      {
        "field": "impressions",
        "value": ["0"],
        "operator": "EQUAL_TO"
      }
    ],
    "time_range": {
      "key": "YESTERDAY"
    }
  },
  "execution_spec": {
    "execution_type": "SEND_NOTIFICATION",
    "execution_options": {
      "email_message": "DELIVERY ISSUE: Ad set '{adset.name}' in campaign '{campaign.name}' had budget set but 0 impressions yesterday. Check delivery status in Ads Manager -- possible learning phase issue, policy flag, or bid too low."
    }
  },
  "schedule_spec": {
    "schedule_type": "DAILY",
    "schedule_day": 1,
    "schedule_time": "07:00"
  },
  "status": "ENABLED"
}
```

Notes:
- This catches the symptom: budget allocated but no delivery. The cause could be learning phase exit, bid too low, audience too narrow, creative rejected, or account issue.
- Cannot directly detect "learning_limited" status via automated rules -- this is a Meta API limitation. Use this delivery-zero rule as a proxy.
- Check delivery status in Ads Manager or via `meta_ads_get_ad_set` when this fires.

---

## Category 5: Spend Anomaly Alerts

### 5.1 Overspend Anomaly Alert (Campaign Level)

Sends notification if daily spend is more than 30% above the expected daily pacing.

```json
{
  "name": "{ACCOUNT_PREFIX}_OVERSPEND_ALERT_{DATE}",
  "evaluation_spec": {
    "evaluation_type": "SCHEDULE",
    "filters": [
      {
        "field": "spend",
        "value": ["{EXPECTED_DAILY_SPEND_CENTS * 1.3}"],
        "operator": "GREATER_THAN"
      }
    ],
    "time_range": {
      "key": "TODAY"
    }
  },
  "execution_spec": {
    "execution_type": "SEND_NOTIFICATION",
    "execution_options": {
      "email_message": "OVERSPEND ALERT: Campaign '{campaign.name}' has spent ${campaign.spend} today -- more than 30% above expected daily pace of ${EXPECTED_DAILY_SPEND}. Investigate in Ads Manager."
    }
  },
  "schedule_spec": {
    "schedule_type": "SEMI_HOURLY"
  },
  "status": "ENABLED"
}
```

Notes:
- Replace `{EXPECTED_DAILY_SPEND_CENTS * 1.3}` with 130% of expected daily spend in cents. Example: $100/day expected, alert at $130 = "13000".
- `SEMI_HOURLY` schedule catches anomalies intraday before significant budget is wasted.
- Useful for accounts where a misconfigured budget or duplicate campaign could cause unexpected spend.

### 5.2 Underspend Anomaly Alert (Campaign Level)

Sends notification if daily spend is more than 30% below expected -- indicating delivery issues.

```json
{
  "name": "{ACCOUNT_PREFIX}_UNDERSPEND_ALERT_{DATE}",
  "evaluation_spec": {
    "evaluation_type": "SCHEDULE",
    "filters": [
      {
        "field": "spend",
        "value": ["{EXPECTED_DAILY_SPEND_CENTS * 0.7}"],
        "operator": "LESS_THAN"
      },
      {
        "field": "spend",
        "value": ["100"],
        "operator": "GREATER_THAN"
      }
    ],
    "time_range": {
      "key": "YESTERDAY"
    }
  },
  "execution_spec": {
    "execution_type": "SEND_NOTIFICATION",
    "execution_options": {
      "email_message": "UNDERSPEND ALERT: Campaign '{campaign.name}' spent ${campaign.spend} yesterday -- more than 30% below expected daily pace. Check for delivery issues: audience too narrow, bid too low, creative rejected, or ad set in limited learning."
    }
  },
  "schedule_spec": {
    "schedule_type": "DAILY",
    "schedule_day": 1,
    "schedule_time": "08:00"
  },
  "status": "ENABLED"
}
```

Notes:
- The second filter (`spend > 100`) prevents the rule from firing when a campaign simply wasn't running yesterday (e.g., scheduled pause, new campaign not yet live).
- Use YESTERDAY time range so the full day's spend is available for comparison.

---

## Category 6: Scale Triggers

Scale triggers increase budgets when campaigns are performing significantly above target -- capturing opportunity before competitors.

### 6.1 CPA Scale Trigger (Ad Set Level, ABO)

Increases ad set budget by 20% when CPA is 20%+ below target for 3+ consecutive days.

```json
{
  "name": "{ACCOUNT_PREFIX}_CPA_SCALE_TRIGGER_{DATE}",
  "evaluation_spec": {
    "evaluation_type": "SCHEDULE",
    "filters": [
      {
        "field": "cost_per_action_type",
        "value": ["{TARGET_CPA_CENTS * 0.8}"],
        "operator": "LESS_THAN"
      },
      {
        "field": "spend",
        "value": ["{MIN_DAILY_SPEND_CENTS * 3}"],
        "operator": "GREATER_THAN"
      },
      {
        "field": "actions_results_count",
        "value": ["5"],
        "operator": "GREATER_THAN"
      }
    ],
    "time_range": {
      "key": "LAST_3_DAYS"
    }
  },
  "execution_spec": {
    "execution_type": "ADJUST_BUDGET",
    "execution_options": {
      "max": "{BUDGET_CAP_CENTS}",
      "value": 20,
      "duration_value": 1,
      "duration_unit": "DAYS"
    }
  },
  "schedule_spec": {
    "schedule_type": "DAILY",
    "schedule_day": 1,
    "schedule_time": "07:00"
  },
  "status": "ENABLED"
}
```

Notes:
- `{TARGET_CPA_CENTS * 0.8}` = 80% of target CPA (20% below). Target $50 CPA = value "4000" (0.8 * 50 = $40 = 4000 cents).
- `{MIN_DAILY_SPEND_CENTS * 3}` = minimum spend over 3-day window. Prevents scaling ad sets that delivered 1-2 conversions by chance.
- `actions_results_count > 5` = minimum 5 conversions in the period. Statistical floor before triggering scale.
- `{BUDGET_CAP_CENTS}` = maximum daily budget. Set to 3-5x current budget to cap runaway scaling.
- 20% increase is the Meta-recommended maximum single increase to avoid learning phase reset.

### 6.2 ROAS Scale Trigger (Campaign Level, CBO)

Increases CBO campaign budget by 20% when ROAS is 20%+ above target.

```json
{
  "name": "{ACCOUNT_PREFIX}_ROAS_SCALE_TRIGGER_{DATE}",
  "evaluation_spec": {
    "evaluation_type": "SCHEDULE",
    "filters": [
      {
        "field": "purchase_roas",
        "value": ["{TARGET_ROAS * 1.2}"],
        "operator": "GREATER_THAN"
      },
      {
        "field": "spend",
        "value": ["{MIN_CAMPAIGN_SPEND_CENTS}"],
        "operator": "GREATER_THAN"
      }
    ],
    "time_range": {
      "key": "LAST_3_DAYS"
    }
  },
  "execution_spec": {
    "execution_type": "ADJUST_BUDGET",
    "execution_options": {
      "max": "{BUDGET_CAP_CENTS}",
      "value": 20,
      "duration_value": 1,
      "duration_unit": "DAYS"
    }
  },
  "schedule_spec": {
    "schedule_type": "DAILY",
    "schedule_day": 1,
    "schedule_time": "07:00"
  },
  "status": "ENABLED"
}
```

---

## Standard Placeholder Reference

| Placeholder | What to Replace With | Example |
|-------------|---------------------|---------|
| `{ACCOUNT_PREFIX}` | Short account code from account-conventions | VIK, JAC, ACME |
| `{DATE}` | Rule creation date YYYY-MM-DD | 2026-03-31 |
| `{TARGET_CPA_CENTS}` | Target CPA in cents | $50 CPA = 5000 |
| `{TARGET_ROAS}` | Target ROAS as decimal | 2.0, 3.5 |
| `{MIN_SPEND_CENTS}` | Minimum spend floor in cents | $30 = 3000 |
| `{BUDGET_CAP_CENTS}` | Maximum budget ceiling in cents | $500/day = 50000 |
| `{MIN_DAILY_SPEND_CENTS}` | Minimum daily budget for the ad set | $50 = 5000 |
| `{EXPECTED_DAILY_SPEND_CENTS}` | Expected daily spend for anomaly detection | $100/day = 10000 |

---

## Automated Rules Limitations Recap

These are hard limits of the Meta Ads automated rules API. No workaround via MCP:

| Cannot Do | Notes |
|-----------|-------|
| Trigger on EMQ (Estimated Match Quality) score | Check manually in Events Manager |
| Trigger on incrementality / iROAS | Check manually via Meta Experiments |
| Send Slack or webhook notifications | Email only (account admin address) |
| Create new ads or creatives | Use launch-campaign skill |
| Target rules to named audiences | Use campaign/ad set IDs |
| React to policy flags or ad disapprovals | Monitor in Ads Manager |
| Pause and launch an alternative in one atomic action | Two separate rules required |
| Use custom attribution windows per rule | Account default attribution window only |
