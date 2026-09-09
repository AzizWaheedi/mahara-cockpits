# Worked Example: optimize-budgets

## Scenario

**Account:** TechGear Direct (e-commerce, consumer electronics)
**Maturity:** Established
**Daily budget:** $5,000 across 6 campaigns
**Target CPA:** $38 (Purchase)
**Target ROAS:** 4.5x
**Primary KPI:** CPA

---

## Step 0: Dependencies Loaded

From budget-methodology:
- Established account: aggressive scaling (20-30% increases), target 60-70% in Core
- Vertical scaling: 20% every 3-4 days
- Never >2x in one week

---

## Step 1: Data Retrieved

### Campaign Performance (7-day averages)

| Campaign | Daily Budget | Avg Daily Spend | Pacing | Avg CPA | Conv/Day | ROAS |
|----------|-------------|----------------|--------|---------|----------|------|
| CONV_PROS_US | $1,500 CBO | $1,470 | 98% | $32 | 46 | 5.2x |
| CONV_PROS_EU | $1,000 CBO | $680 | 68% | $48 | 14 | 3.8x |
| CONV_LAL_US | $800 CBO | $780 | 98% | $35 | 22 | 4.8x |
| CONV_RT_US | $600 CBO | $540 | 90% | $22 | 25 | 7.1x |
| CONV_TEST | $600 ABO | $420 | 70% | $55 | 8 | 3.2x |
| ASC_US | $500 CBO | $490 | 98% | $36 | 14 | 4.6x |

**Total:** $5,000 budget, $4,380 spend (87.6% utilization), 129 conv/day, blended CPA $33.95

---

## Step 2: Pacing Analysis

| Campaign | Pacing | Classification | Efficient? | Status |
|----------|--------|---------------|-----------|--------|
| CONV_PROS_US | 98% | Constrained | Yes (CPA $32 < $38 target) | Scale candidate |
| CONV_PROS_EU | 68% | Underdelivering | No (CPA $48 > $38 target) | Investigate |
| CONV_LAL_US | 98% | Constrained | Yes (CPA $35 < $38) | Scale candidate |
| CONV_RT_US | 90% | Healthy | Yes (CPA $22) | Maintain |
| CONV_TEST | 70% | Underdelivering | No (CPA $55, expected for test) | Monitor |
| ASC_US | 98% | Constrained | Yes (CPA $36 < $38) | Scale candidate |

**Constrained-efficient campaigns:** 3 (CONV_PROS_US, CONV_LAL_US, ASC_US)
**Underdelivering:** 2 (CONV_PROS_EU, CONV_TEST)

---

## Step 3: Marginal Efficiency Analysis

### CONV_PROS_US (daily data analysis)

| Spend Level | Days at Level | Avg CPA | vs Baseline |
|-------------|--------------|---------|-------------|
| <$1,400 | 3 | $30 | -6% baseline |
| $1,400-1,500 | 8 | $32 | Baseline |
| $1,500+ (capped) | 3 | $32 | Stable |

**Zone: Linear** -- CPA flat even at budget ceiling. Strong candidate for scaling.

### CONV_PROS_EU (daily data analysis)

| Spend Level | Days at Level | Avg CPA | vs Baseline |
|-------------|--------------|---------|-------------|
| <$600 | 4 | $42 | Baseline |
| $600-800 | 6 | $49 | +17% |
| >$800 | 4 | $58 | +38% |

**Zone: Diminishing** -- CPA rises significantly with spend. Not a scale candidate. Possible reallocation source.

### CONV_LAL_US

**Zone: Linear** -- CPA stable across all spend levels. Scale candidate.

### ASC_US

**Zone: Linear** -- CPA stable. Scale candidate. Meta's algorithm is finding efficient pockets.

---

## Step 4: Three-Tier Classification

| Campaign | Tier | CPA vs Target | Pacing | Trend | Days Active | Budget Share |
|----------|------|---------------|--------|-------|-------------|-------------|
| CONV_PROS_US | Core | -16% | 98% | Stable | 90+ | 30% |
| CONV_LAL_US | Core | -8% | 98% | Stable | 60 | 16% |
| CONV_RT_US | Core | -42% | 90% | Stable | 120+ | 12% |
| ASC_US | Core | -5% | 98% | Improving | 30 | 10% |
| CONV_PROS_EU | Growth | +26% | 68% | Declining | 45 | 20% |
| CONV_TEST | Experiment | +45% | 70% | Mixed | 14 | 12% |

**Current distribution:** Core 68%, Growth 20%, Experiment 12%
**Target distribution:** Core 60-70%, Growth 20-30%, Experiment 10-15%
**Assessment:** Core is at target. Growth (EU) is underperforming. Experiment is within range.

---

## Step 5: Scaling Plan

### CONV_PROS_US (Scale from $1,500 to $2,000)

| Date | Budget | Change | Cumulative | Monitor |
|------|--------|--------|-----------|---------|
| Mar 28 | $1,500 | Baseline | -- | CPA: $32 |
| Mar 31 | $1,800 | +$300 (+20%) | +20% | CPA < $38? |
| Apr 3 | $2,000 | +$200 (+11%) | +33% | CPA < $38? Stabilize here. |

### CONV_LAL_US (Scale from $800 to $1,000)

| Date | Budget | Change | Cumulative | Monitor |
|------|--------|--------|-----------|---------|
| Mar 28 | $800 | Baseline | -- | CPA: $35 |
| Mar 31 | $960 | +$160 (+20%) | +20% | CPA < $42? |
| Apr 3 | $1,000 | +$40 (+4%) | +25% | Stabilize here. |

### ASC_US (Scale from $500 to $700)

| Date | Budget | Change | Cumulative | Monitor |
|------|--------|--------|-----------|---------|
| Apr 1 | $500 | Baseline | -- | CPA: $36 |
| Apr 4 | $600 | +$100 (+20%) | +20% | CPA < $43? |
| Apr 7 | $700 | +$100 (+17%) | +40% | Stabilize. |

---

## Step 6: Reallocation Table

| # | Direction | Campaign | Current | Change | New | Rationale |
|---|-----------|----------|---------|--------|-----|-----------|
| 1 | Decrease | CONV_PROS_EU | $1,000 | -$400 | $600 | Diminishing returns, CPA $48 above target, 68% pacing. Reduce to efficient spend level. |
| 2 | Increase | CONV_PROS_US | $1,500 | +$500 | $2,000 | Constrained-efficient, Linear zone, CPA $32 |
| 3 | Increase | CONV_LAL_US | $800 | +$200 | $1,000 | Constrained-efficient, Linear zone, CPA $35 |
| 4 | Increase | ASC_US | $500 | +$200 | $700 | Constrained-efficient, Linear zone, CPA $36 |
| 5 | Decrease | CONV_TEST | $600 | -$100 | $500 | Reduce experiment allocation slightly to fund Core |
| 6 | No change | CONV_RT_US | $600 | $0 | $600 | Healthy pacing, excellent CPA, no change needed |

**Net change:** +$400/day ($5,000 -> $5,400 if budget available, or reallocate $400 from EU + Test = budget neutral at $5,000 -> $5,400 with $400 net new)

If budget-neutral required: reduce EU by -$400, reduce Test by -$100, increase PROS_US +$300, LAL_US +$100, ASC +$100.

---

## Projected Impact

| Metric | Current | Projected | Delta |
|--------|---------|-----------|-------|
| Daily conversions | 129 | 142 | +13 (+10%) |
| Blended CPA | $33.95 | $34.50 | +$0.55 (+1.6%) |
| Daily spend | $4,380 | $4,800 | +$420 |
| Daily revenue | ~$19,700 | ~$21,800 | +$2,100 (+11%) |
| ROAS | 4.5x | 4.5x | Maintained |

**Key insight:** By moving $500/day from diminishing-return campaigns (EU, Test) to linear-zone campaigns (PROS_US, LAL_US, ASC), the account gains ~13 additional conversions per day at essentially the same blended CPA. That's ~390 additional conversions per month.
