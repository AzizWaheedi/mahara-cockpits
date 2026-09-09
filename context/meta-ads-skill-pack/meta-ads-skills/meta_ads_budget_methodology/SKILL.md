---
name: budget_methodology
description: Budget allocation, scaling methodology, and pacing framework for Meta Ads. Covers the three-tier allocation model, vertical and horizontal scaling protocols, learning phase management, and budget scheduling. Referenced by optimize-budgets action skill.
---

# Budget Methodology

## Purpose

This skill defines the complete budget allocation and scaling framework for Meta Ads. Budget management is where strategy meets execution -- the wrong scaling move can destroy a profitable campaign, and the wrong allocation starves your best performers. This framework provides precise protocols for allocation, vertical scaling, horizontal scaling, and pacing diagnostics.

## Core Framework: Three-Tier Allocation Model

Every Meta Ads budget should be divided into three tiers based on campaign performance and purpose:

```
Total Budget
├── Core Performers (60-70%) -- Proven campaigns delivering at target CPA/ROAS
├── Growth Candidates (20-30%) -- Promising campaigns being scaled or tested
└── Experiments (10-20%)      -- New creative, audiences, strategies being tested
```

### Tier Definitions

**Tier 1: Core Performers (60-70% of budget)**
- Campaigns that have been profitable for 2+ weeks
- CPA/ROAS within target range
- Post-learning phase, stable delivery
- These campaigns generate the majority of revenue
- Goal: Maximize volume while maintaining efficiency

**Tier 2: Growth Candidates (20-30% of budget)**
- Campaigns showing early promise (1-2 weeks of data)
- CPA within 20% of target
- Being scaled from testing to core
- Recent winners being graduated from Tier 3
- Goal: Prove scalability, graduate to Tier 1

**Tier 3: Experiments (10-20% of budget)**
- New creative tests
- New audience tests
- New bid strategies or campaign structures
- Completely new concepts
- Goal: Find the next Tier 1 campaign

### Allocation by Monthly Spend

| Monthly Budget | Core (%) | Growth (%) | Experiments (%) | Experiment $ |
|----------------|----------|------------|-----------------|-------------|
| $5K-15K | 65% | 20% | 15% | $750-2,250 |
| $15K-50K | 65% | 25% | 10% | $1,500-5,000 |
| $50K-150K | 70% | 20% | 10% | $5,000-15,000 |
| $150K-500K | 70% | 20% | 10% | $15,000-50,000 |
| $500K+ | 70% | 20% | 10% | $50,000+ |

### Reallocation Triggers

**Promote Tier 3 to Tier 2 when:**
- CPA within 20% of target for 7+ days
- Completed learning phase
- 20+ conversions accumulated

**Promote Tier 2 to Tier 1 when:**
- CPA at or below target for 14+ days
- Consistent daily delivery (spend within 20% of budget daily)
- 50+ conversions accumulated
- Scalable (performance holds as budget increases)

**Demote Tier 1 to Tier 2 when:**
- CPA 20-30% above target for 7+ days
- Frequency rising above 3.0
- Creative fatigue signals appearing

**Kill (remove from all tiers) when:**
- CPA 50%+ above target for 14+ days
- No improvement after creative refresh
- Audience fully saturated

---

## 1. Minimum Viable Budget

Before launching any campaign, ensure sufficient budget for Meta's algorithm to function.

### Per Ad Set Minimums

| Bid Strategy | Minimum Daily Budget | Recommended Daily Budget |
|-------------|---------------------|------------------------|
| Lowest Cost | 1x target CPA | 3-5x target CPA |
| Cost Cap | 3x target CPA | 5-10x target CPA |
| Bid Cap | 3x target CPA | 5-10x target CPA |
| Minimum ROAS | 3x target CPA | 5-10x target CPA |

**Why 5x target CPA?**
- Meta needs ~50 optimization events in 7 days to exit learning
- At 5x CPA daily budget, you'd get ~5 conversions/day = ~35/week
- This puts you close to the 50-event threshold
- Below this, learning takes longer and performance is less stable

**The "too small to learn" trap:**
- A $50/day budget with a $40 target CPA = 1.25x ratio
- This ad set will barely exit learning (if ever)
- Either increase budget to $200+/day or consolidate with other ad sets

### Campaign Budget Minimums (CBO)

For CBO campaigns, the total campaign budget must support all ad sets:
- Minimum: Sum of (minimum per ad set x number of ad sets)
- Recommended: 5x target CPA x number of ad sets
- Example: 3 ad sets, $50 target CPA --> minimum $750/day campaign budget

---

## 2. Vertical Scaling (Increasing Budget on Existing Campaigns)

Vertical scaling means increasing budget on a campaign that's already working. It's the fastest path to more volume but must be done carefully to avoid disrupting performance.

### The 20% Rule

**Never increase budget by more than 20% in a single adjustment.**

Increases above 20% frequently trigger Meta's learning phase reset, causing 2-7 days of elevated CPA.

### Vertical Scaling Protocol

**Step 1: Confirm readiness**
- Campaign is post-learning phase
- CPA has been at or below target for 7+ days
- Delivery is consistent (daily spend within 20% of budget)
- No fatigue signals (frequency <3, stable CTR)

**Step 2: Increase by 15-20%**
- Apply the increase
- Do NOT change anything else (creative, audience, bid)
- Note the date and pre-increase CPA

**Step 3: Monitor for 3-4 days**
- Expect CPA to increase 5-15% temporarily
- If CPA returns to baseline within 3-4 days: proceed to next increase
- If CPA stays elevated after 4 days: hold at current budget for another 7 days before trying again

**Step 4: Repeat every 3-4 days**
- Continue 15-20% increases if each step stabilizes
- Patience is critical -- rushing kills the campaign

### Scaling Timeline Examples

**$500/day to $1,000/day:**

| Day | Budget | Change | Expected CPA Impact |
|-----|--------|--------|-------------------|
| 0 | $500 | Baseline | Baseline |
| 1-4 | $600 | +20% | +5-15% temporarily |
| 5-8 | $720 | +20% | +5-10% temporarily |
| 9-12 | $860 | +19% | +5-10% temporarily |
| 13-16 | $1,000 | +16% | Stabilize at new baseline |

Total time: 12-16 days. This is correct pacing.

**$1,000/day to $5,000/day:**

| Week | Budget | Running Total Change |
|------|--------|---------------------|
| 1 | $1,200 | +20% |
| 2 | $1,440 | +44% |
| 3 | $1,730 | +73% |
| 4 | $2,075 | +108% |
| 5 | $2,490 | +149% |
| 6 | $2,990 | +199% |
| 7 | $3,590 | +259% |
| 8 | $4,310 | +331% |
| 9 | $5,000 | +400% |

Total time: ~9 weeks. There are no shortcuts.

### When Vertical Scaling Fails

If CPA doesn't stabilize after 2 consecutive increases:
1. Roll back to the last stable budget (not the original budget)
2. Hold for 7-14 days
3. Investigate: audience saturation? Creative fatigue? Seasonal shift?
4. Address the root cause before attempting more scaling
5. Consider horizontal scaling instead

---

## 3. Horizontal Scaling (New Campaigns/Ad Sets)

Horizontal scaling means creating new campaigns or ad sets to reach additional audiences or test new angles. It's how you grow beyond the ceiling of a single campaign.

### When to Use Horizontal Scaling

- Vertical scaling has plateaued (CPA rises with each budget increase)
- Frequency is above 3.0 on your core audiences
- You want to test new markets, audiences, or geos
- You're launching new creative concepts
- You've maxed out a single campaign structure

### Horizontal Scaling Methods

**Method 1: New audiences in existing campaign structure**
- Add a new ad set targeting a different audience
- Same creative, different audience
- Budget: Start at your proven ad set's daily budget

**Method 2: New campaign for new market/geo**
- Duplicate your proven campaign structure
- Change geo targeting
- Adjust language/creative for the new market
- Budget: Start at 50% of your proven campaign's budget

**Method 3: New campaign for new funnel stage**
- Add retargeting if only running prospecting (or vice versa)
- Different creative appropriate for the funnel stage
- Budget: 15-25% of prospecting budget for retargeting

**Method 4: Advantage+ Shopping Campaign (ASC)**
- Create an ASC campaign alongside your manual campaigns
- Broad targeting, Meta optimizes fully
- Budget: Start at 20-30% of total budget, scale if performance justifies

### Horizontal Scaling CPA Expectations

Expect new campaigns to run 10-20% higher CPA than your proven campaigns for the first 2-4 weeks. This is the cost of expanding your reach. If CPA is within this range after learning phase, the campaign is a valid growth candidate.

---

## 4. When to Stop Scaling

Scaling is not infinite. Recognize the signals that you've reached your current ceiling.

| Signal | Threshold | Interpretation |
|--------|-----------|---------------|
| Frequency | >3-4 (prospecting) | Audience is getting saturated |
| CPA trend | Increasing faster than budget | Diminishing returns |
| Inconsistent delivery | Daily spend swings >40% | Algorithm struggling |
| Conversion volume plateau | Flat despite budget increases | Market cap reached |
| CPM spiking | >30% above baseline | Auction competition or audience exhaustion |

### What to Do When Scaling Hits the Wall

1. **Hold** at current budget. Do not increase further.
2. **Diagnose** the bottleneck (creative fatigue, audience saturation, seasonal)
3. **Fix the bottleneck** before resuming scaling
4. If creative: launch new concepts, new hooks, new formats
5. If audience: horizontal expansion to new audiences or geos
6. If seasonal: accept the ceiling and wait for the cycle to shift
7. If market: you may have saturated your addressable market at this price point

---

## 5. Budget Scheduling and Pacing

### Daily Pacing Analysis

Meta aims to spend your budget evenly throughout the day but may front-load or back-load depending on auction conditions.

**Healthy pacing indicators:**
- Daily spend within 80-100% of budget
- Even spend distribution across hours (check hourly breakdown)
- Consistent day-over-day delivery

**Pacing problems and causes:**

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Spending 100% by noon | Budget too low for audience size | Increase budget or narrow audience |
| Spending only 40-60% of budget | Bid too restrictive or audience too small | Raise bid cap/cost cap, broaden audience |
| Spending $0 | Bid way too low, policy rejection, audience size 0 | Check ad review status, raise bid, check audience |
| Huge day-to-day swings | Bid Cap strategy, small audience, low budget | Switch to Cost Cap, broaden audience |
| Weekend dips | Natural behavior pattern | Normal for B2B; set lower weekend budgets if needed |

### Promotional Budget Scheduling

For time-limited promotions (sales, launches, seasonal):

**Pre-promotion (1-2 weeks before):**
- Increase budgets gradually (20% increments) to warm up delivery
- Do not wait until launch day to spike budget
- Pre-load creative and let ads exit learning phase

**During promotion:**
- Use Bid Cap if strict cost control is needed
- Budget can be 2-3x normal (since you pre-warmed)
- Monitor hourly -- high-traffic days can exhaust budget early

**Post-promotion:**
- Scale budgets back down in 2-3 steps (not a cliff drop)
- Cliff drops can shock the algorithm and degrade future performance
- Example: $5,000/day promotion --> $3,500 (day 1 post) --> $2,500 (day 3 post) --> $1,500 normal (day 5 post)

### Day-of-Week Budgeting

Some businesses have strong day-of-week patterns. Use campaign budget adjustments:

**B2B (Viktor):**
- Monday-Thursday: Full budget (peak business engagement)
- Friday: 80% budget
- Saturday-Sunday: 50-60% budget
- Adjust based on your actual conversion data by day

**E-commerce:**
- Thursday-Sunday: Full budget (shopping peak)
- Monday-Wednesday: 80% budget
- Adjust for your specific category

### Seasonal Adjustments

| Period | Adjustment | Reason |
|--------|-----------|--------|
| Q1 (Jan-Mar) | -10-20% from Q4 | Post-holiday normalization, lower CPMs |
| Q4 (Oct-Dec) | +20-40% | Holiday shopping, higher CPMs require more budget |
| Black Friday/Cyber Monday | +50-100% | Peak competition, must pre-warm 2 weeks out |
| January | -20-30% | Lowest CPMs of year, good for testing |
| Industry conferences/events | +20% | If relevant to your audience |

---

## 6. CBO vs ABO Budget Decisions

### Campaign Budget Optimization (CBO)

Meta distributes budget across ad sets based on performance.

**Use CBO when:**
- You have 3+ ad sets in one campaign
- You trust Meta to allocate between audiences
- Your ad sets have similar audience sizes
- You want to maximize total campaign performance

**CBO budget distribution behavior:**
- Meta will heavily favor the best-performing ad set (70-80% of budget possible)
- Underperforming ad sets may get starved
- This is usually correct -- Meta is allocating to the best opportunities

**If CBO over-concentrates on one ad set:**
- Set minimum spend limits on ad sets (10-20% of campaign budget per ad set)
- Or switch to ABO for controlled testing

### Ad Set Budget Optimization (ABO)

You set a fixed budget per ad set. Each gets exactly what you assign.

**Use ABO when:**
- Controlled A/B testing (equal budget per test cell)
- You want each audience to get guaranteed spend
- Creative testing campaigns (ensure each creative gets tested)
- You have a specific budget allocation plan

**ABO to CBO migration:**
When graduating from testing to scaling, move from ABO (controlled testing) to CBO (optimized scaling). Take your winning ad sets from ABO and put them in a single CBO campaign with the combined budget.

---

## Quick Reference Tables

### Budget Decision Flowchart

```
Is the campaign profitable?
├── Yes --> Is CPA at target?
│   ├── Yes --> Scale (20% vertical increase every 3-4 days)
│   └── No (but close) --> Hold budget, optimize creative/audience
└── No --> Has it completed learning?
    ├── Yes --> Has it run 14+ days?
    │   ├── Yes --> Kill it or restructure
    │   └── No --> Give it 7 more days
    └── No --> Wait (don't change anything)
```

### Scaling Speed Reference

| Current Daily Budget | Time to 2x | Time to 5x |
|---------------------|-----------|-----------|
| $100 | 12-16 days | 9-10 weeks |
| $500 | 12-16 days | 9-10 weeks |
| $1,000 | 12-16 days | 9-10 weeks |
| $5,000 | 12-16 days | 9-10 weeks |
| $10,000 | 12-16 days | 9-10 weeks |

The ratio is constant regardless of absolute budget. 20% every 3-4 days.

### Minimum Budget by Objective

| Campaign Objective | Minimum Daily Budget | Recommended |
|-------------------|---------------------|-------------|
| Conversions (Purchase) | 5x CPA | 10x CPA |
| Conversions (Lead) | 3x CPA | 5x CPA |
| Traffic | $20/day | $50+/day |
| Video Views | $10/day | $30+/day |
| Reach | $5/day | $20+/day |
| App Installs | 5x CPI | 10x CPI |

---

## Reference Files

- `references/scaling_protocols.md` - Step-by-step vertical and horizontal scaling guides with worked examples
- `references/pacing_diagnostics.md` - Delivery issues diagnosis, resolution steps, and pacing optimization
