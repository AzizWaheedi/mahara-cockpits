# Output Specifications: optimize-budgets

## Deliverable 1: Reallocation Table

### File Naming
`{account_slug}_budget-reallocation_{YYYY-MM-DD}.md`

### Template

```markdown
# Budget Reallocation Plan: {account_name}
Generated: {YYYY-MM-DD} | Period: {start_date} to {end_date}
Budget Constraint: {budget-neutral / adding ${amount} / reducing ${amount}}
Total Daily Budget: ${total}

---

## Reallocation Summary

| # | Direction | Campaign | Current Budget | Change | New Budget | Rationale |
|---|-----------|----------|---------------|--------|-----------|-----------|
| 1 | Decrease | {name} | ${current}/day | -${amount} | ${new}/day | Diminishing returns, marginal CPA $95 vs avg $65 |
| 2 | Increase | {name} | ${current}/day | +${amount} | ${new}/day | Constrained at 97% pacing, CPA $42 (below target) |
| 3 | No change | {name} | ${current}/day | $0 | ${current}/day | Healthy pacing, CPA at target |

**Net budget change:** ${amount} ({neutral/increase/decrease})

---

## Projected Impact

| Metric | Current (7d avg) | Projected | Delta | Confidence |
|--------|-----------------|-----------|-------|-----------|
| Daily conversions | {count} | {count} | +{count} (+{pct}%) | Medium |
| Blended CPA | ${cpa} | ${cpa} | ${delta} ({pct}%) | Medium |
| Daily spend | ${spend} | ${spend} | ${delta} | High |
| Daily revenue | ${rev} | ${rev} | +${delta} | Medium |
| ROAS | {roas}x | {roas}x | +{delta}x | Medium |

### Projection Methodology
Conversions gained/lost = budget change / marginal CPA of receiving/losing campaign.
Confidence is "Medium" because marginal CPA is estimated from historical data and may shift with budget changes.

---

## Implementation Instructions

1. Execute changes in the order listed above (decreases before increases to maintain budget neutrality)
2. Make changes between 6-9 AM {timezone} (lower auction activity)
3. Wait 24 hours between each line item to observe impact
4. Do not change bid strategy or targeting simultaneously
5. Record pre-change metrics for comparison
```

---

## Deliverable 2: Scaling Schedule

### Template

```markdown
## Scaling Schedule

### {Campaign Name}
Current daily budget: ${current}
Target daily budget: ${target}
Scaling method: Vertical (20% increments every 3-4 days)

| Date | Budget | Change | Cumulative | CPA Check | Action |
|------|--------|--------|-----------|-----------|--------|
| {date} | ${amount} | Baseline | -- | Record: $____ | Start monitoring |
| {date+3} | ${amount} | +${delta} (+20%) | +20% | If CPA < ${threshold}: continue | Increase budget |
| {date+6} | ${amount} | +${delta} (+20%) | +44% | If CPA < ${threshold}: continue | Increase budget |
| {date+9} | ${amount} | +${delta} (+20%) | +73% | Full assessment | Decide: continue or stabilize |
| {date+12} | ${amount} | +${delta} (+20%) | +107% | Full assessment | If at target, stabilize |

**Rollback trigger:** CPA >30% above pre-scaling baseline for 48 consecutive hours
**Stabilization criteria:** CPA within 20% of baseline at new budget level for 5+ days
**Maximum weekly increase:** 2x original budget (never exceed in one week)

### {Next Campaign}
{same format}
```

---

## Deliverable 3: Before/After Projections

### Template

```markdown
## Budget Allocation: Before/After

### Current State
| Campaign | Tier | Budget | Avg Spend | Pacing | CPA | Conv/Day | Eff. Zone |
|----------|------|--------|-----------|--------|-----|----------|-----------|
| {name} | Core | ${budget} | ${spend} | {pct}% | ${cpa} | {count} | Linear |
| {name} | Growth | ${budget} | ${spend} | {pct}% | ${cpa} | {count} | Inflecting |
| {name} | Experiment | ${budget} | ${spend} | {pct}% | ${cpa} | {count} | N/A |

### Projected State (Post-Reallocation)
| Campaign | Tier | New Budget | Proj Spend | Proj CPA | Proj Conv/Day | Delta |
|----------|------|-----------|-----------|----------|--------------|-------|
| {name} | Core | ${budget} | ${spend} | ${cpa} | {count} | +{pct}% |

### Account Summary
| Metric | Before | After | Impact |
|--------|--------|-------|--------|
| Total daily budget | ${amount} | ${amount} | ${delta} |
| Total daily conversions | {count} | {count} | +{delta} ({pct}%) |
| Blended CPA | ${cpa} | ${cpa} | ${delta} ({pct}%) |
| Revenue (if tracked) | ${rev} | ${rev} | +${delta} ({pct}%) |
| Budget in Core tier | {pct}% | {pct}% | {delta}pp |
| Budget in Experiments | {pct}% | {pct}% | {delta}pp |

### Three-Tier Distribution
| Tier | Before (%) | After (%) | Target (%) | On Target? |
|------|-----------|----------|-----------|------------|
| Core | {pct}% | {pct}% | 60-70% | {yes/no} |
| Growth | {pct}% | {pct}% | 20-30% | {yes/no} |
| Experiment | {pct}% | {pct}% | 10-15% | {yes/no} |
```
