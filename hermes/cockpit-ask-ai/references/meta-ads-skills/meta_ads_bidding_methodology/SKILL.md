---
name: bidding_methodology
description: Bid strategy selection framework for Meta Ads mapped to account maturity stages. Covers Lowest Cost, Cost Cap, Bid Cap, and Minimum ROAS strategies with decision criteria, warning signals, and migration paths. Referenced by audit-bidding action skill.
---

# Bidding Methodology

## Purpose

This skill provides the complete bid strategy framework for Meta Ads. Bidding strategy is the primary lever for balancing cost efficiency against delivery volume. The wrong bid strategy wastes budget; the right one unlocks scale at your target economics. This framework maps each strategy to account maturity, business model, and campaign objective so media buyers can make confident bid decisions.

## Core Framework: Strategy Selection by Maturity

```
Nascent          --> Lowest Cost (learn, gather data)
Developing       --> Test Cost Cap (control costs while scaling)
Established      --> Cost Cap primary, test Bid Cap for events
Advanced         --> Portfolio approach (multiple strategies by campaign purpose)
```

---

## 1. Bid Strategy Overview

### Lowest Cost (formerly "Auto Bid")

**What it does:** Meta spends your full budget to get the most conversions possible at the lowest cost. No cost controls. Meta optimizes for volume.

**When to use:**
- New accounts / new campaigns (need data before setting constraints)
- Brand awareness and reach campaigns (efficiency less critical)
- When you don't have a firm CPA target yet
- Testing new audiences where you don't know expected CPA
- Retargeting campaigns with small budgets (don't want delivery constraints)

**When NOT to use:**
- You have a strict CPA/ROAS target that must be met
- You're scaling aggressively (costs can spike unpredictably)
- High-spend campaigns where a 20% CPA swing means thousands of dollars

**How it works in the auction:**
- Meta bids whatever is needed to win, up to the point where your budget is fully spent
- No per-auction guardrails -- some conversions may cost 3-5x your average
- CPA can fluctuate significantly day-to-day

**Expected behavior:**
- Day 1-7: CPA may be volatile as algorithm explores
- Day 7-14: CPA stabilizes as learning completes
- Ongoing: CPA gradually increases as cheapest opportunities are exhausted (especially with budget increases)

**Monitoring protocol:**
- Check CPA daily but evaluate weekly
- If weekly CPA is acceptable, don't intervene
- If CPA is 30%+ above target for 2 consecutive weeks, consider switching to Cost Cap

### Cost Cap

**What it does:** You set a maximum average CPA. Meta tries to get conversions at or below this cost. It may spend less than your full budget if it can't find conversions at your target cost.

**When to use:**
- You have a known target CPA from historical data
- Scaling campaigns where cost control matters
- Primary bid strategy for established accounts (200+ conversions/month)
- When you need predictable unit economics

**When NOT to use:**
- New campaigns with no CPA baseline (you'll set the cap wrong)
- Time-sensitive campaigns where full spend matters (promotions, launches)
- Very small budgets (<5x your CPA) -- delivery may be too restricted

**How to set the cap:**
1. Calculate your target CPA from business economics
2. Set Cost Cap 15-25% ABOVE your target CPA
3. Why above? Cost Cap is an average target, not a hard ceiling. Setting it at your exact target causes under-delivery.

**Example:**
- Target CPA: $50
- Initial Cost Cap: $60-63 (20-25% above)
- If delivering well at $60 cap with $48 actual CPA: lower cap to $55
- If under-delivering at $60 cap: raise to $65-70

**Adjustment protocol:**
- Review every 7-14 days (not daily)
- If spending <70% of budget for 5+ days: raise cap by 10-15%
- If CPA is 20%+ below cap and spending full budget: lower cap by 5-10%
- Never lower cap by more than 10% at once (triggers re-learning)
- Never adjust during learning phase

**Warning signals:**

| Signal | Meaning | Action |
|--------|---------|--------|
| Spending <50% of budget | Cap too restrictive | Raise cap 15-20% |
| Spending 50-70% of budget | Cap slightly tight | Raise cap 10% |
| CPA consistently 30%+ below cap | Cap too generous | Lower cap 5-10% |
| CPA above cap for 2+ weeks | Market cost exceeds target | Raise cap or revisit economics |
| Erratic daily spend | Algorithm struggling | Check if in learning phase |

### Bid Cap

**What it does:** Sets a hard maximum bid per auction. Meta will not bid above this amount for any single conversion opportunity. This is the strictest cost control.

**When to use:**
- Short-duration campaigns (promotions, flash sales, limited-time offers)
- When you need a hard ceiling on cost per conversion
- Advanced accounts testing marginal auction efficiency
- When Cost Cap results in too much CPA variance

**When NOT to use:**
- Ongoing evergreen campaigns (too restrictive for sustained delivery)
- When you don't know your breakeven cost precisely
- New accounts or new audiences (need flexibility to learn)

**How to set:**
1. Start at your target CPA (not above, unlike Cost Cap)
2. Monitor delivery for 24-48 hours
3. If spending <80% of budget: raise by 10-15%
4. If spending 100% with good CPA: you may be leaving conversions on the table at a slightly higher bid

**Key difference from Cost Cap:**
- Cost Cap: "Average CPA around $50" (some conversions at $30, some at $70)
- Bid Cap: "Never pay more than $50 for any single conversion" (passes on $51 opportunities)

**Bid Cap requires daily monitoring.** Auction dynamics change constantly. A bid that delivers well today may under-deliver tomorrow.

**Adjustment protocol:**
- Monitor daily (not weekly like Cost Cap)
- If spending <80% of budget: raise bid 10-15%
- If spending 100% comfortably: test lowering bid 5% to see if delivery holds
- Expect delivery to be less stable than Cost Cap

### Minimum ROAS (Value-Based Bidding)

**What it does:** You set a minimum return on ad spend. Meta optimizes for conversion value (revenue), not just conversion count. It bids more aggressively for high-value conversions and less for low-value ones.

**When to use:**
- Variable transaction values (e-commerce with products ranging from $20 to $500)
- When you can pass accurate conversion values to Meta (via pixel or CAPI)
- Established accounts with value-based optimization (VBO) enabled
- When ROAS matters more than CPA

**When NOT to use:**
- Uniform transaction values (SaaS with one pricing tier) -- use Cost Cap instead
- Inaccurate or missing conversion value data
- New accounts without VBO history
- Lead generation (no transaction value to optimize against)

**How to set:**
1. Calculate your breakeven ROAS: `1 / gross margin %`
   - Example: 60% margin --> breakeven ROAS = 1.67x
2. Set Minimum ROAS at breakeven (conservative) or 10-20% above (moderate)
3. Start conservative -- you can lower the floor to increase volume

**Example:**
- Average order value: $80
- Gross margin: 60%
- Breakeven ROAS: 1.67x
- Starting Minimum ROAS: 1.8x-2.0x
- If delivering well: lower to 1.5x to increase volume
- If ROAS is 3x+ but spend is low: lower floor significantly to unlock scale

**Adjustment protocol:**
- Review weekly
- If spending <60% of budget: lower ROAS floor by 0.2-0.3x
- If ROAS is 2x+ above floor and spending full budget: raise floor by 0.1-0.2x
- Balance ROAS against volume -- a 5x ROAS at $100/day spend is worse than 2.5x ROAS at $1,000/day

---

## 2. Learning Phase Management

The learning phase is the period where Meta's algorithm explores audience and delivery combinations to optimize for your objective. Disrupting it wastes budget and resets progress.

### Learning Phase Mechanics

- **Trigger:** New campaign, new ad set, or significant edit to existing ad set
- **Completion criteria:** ~50 optimization events within 7 days
- **Duration:** Typically 3-7 days for established accounts, up to 14 days for new accounts
- **Performance during learning:** CPA is typically 20-50% higher than post-learning

### What Triggers Re-Learning

| Change | Triggers Re-Learning? | Severity |
|--------|----------------------|----------|
| New campaign/ad set | Yes | Full reset |
| Budget change >20% | Yes | Partial reset |
| Bid strategy change | Yes | Full reset |
| Bid/cap amount change | Yes | Partial reset |
| New creative added | No (usually) | Minor disruption |
| Creative paused | Depends on spend share | Minor to moderate |
| Audience change | Yes | Full reset |
| Targeting expansion/restriction | Yes | Partial reset |
| Optimization event change | Yes | Full reset |

### Learning Phase Protocol

**During learning (days 1-7):**
- Do NOT change budget, bid, audience, or optimization event
- Do NOT pause the campaign if CPA is high (this is expected)
- DO monitor daily but only intervene if spend is wildly off (>5x target CPA per conversion)
- DO let the full 50 events accumulate

**If learning phase is not completing:**
- Budget too low: Increase to at least 5x target CPA per day per ad set
- Audience too small: Broaden targeting
- Conversion event too rare: Switch to an earlier funnel event (e.g., lead instead of purchase)
- Too many ad sets: Consolidate to concentrate spend

**After learning completes:**
- CPA should stabilize within 3-5 days
- If post-learning CPA is 30%+ above target for 2+ weeks: the campaign is not viable at this bid/audience combo
- If post-learning CPA is on target: begin gradual scaling (see budget-methodology)

See `references/learning_phase.md` for detailed learning phase management and recovery protocols.

---

## 3. Strategy Migration Paths

### Moving from Lowest Cost to Cost Cap

**When:** You have 2+ weeks of data on Lowest Cost and want cost predictability.

**Protocol:**
1. Calculate your average CPA from Lowest Cost campaign (last 14 days)
2. Set Cost Cap at that average + 20%
3. Do NOT change anything else (audience, creative, budget)
4. Let the new bid strategy complete learning phase (7 days)
5. Evaluate: Is delivery and CPA acceptable?
6. If under-delivering: raise cap by 10-15%
7. If CPA is too high: lower cap by 5-10%

### Moving from Cost Cap to Bid Cap

**When:** Short campaign (promotion, seasonal), need hard cost ceiling.

**Protocol:**
1. Use your Cost Cap actual CPA as starting Bid Cap
2. Launch as a new campaign (don't change existing campaign's bid strategy)
3. Monitor daily -- Bid Cap requires closer management
4. After the promotion ends, return to Cost Cap campaigns

### Adding Minimum ROAS

**When:** You have value-based optimization enabled and variable transaction values.

**Protocol:**
1. Ensure accurate conversion values are being passed (check Events Manager)
2. Calculate breakeven ROAS from your margins
3. Create a new campaign with Minimum ROAS (don't convert existing)
4. Set floor at breakeven ROAS + 10%
5. Run alongside existing campaigns for 14 days
6. Compare total revenue and ROAS against Cost Cap/Lowest Cost campaigns
7. Shift budget to winning strategy

---

## 4. Advanced: Portfolio Bid Strategy

For advanced accounts ($50K+/month), use multiple bid strategies across campaigns:

| Campaign Purpose | Bid Strategy | Rationale |
|------------------|-------------|-----------|
| Creative testing | Lowest Cost | Need flexible delivery to test creative |
| Core scaling | Cost Cap | Predictable economics at scale |
| Promotions/launches | Bid Cap | Hard cost ceiling for time-limited events |
| High-value products | Minimum ROAS | Optimize for value, not volume |
| Retargeting | Lowest Cost | Small budgets, warm audiences, high conversion rates |
| ASC (Advantage+) | Lowest Cost or Cost Cap | ASC handles most optimization internally |

---

## Quick Reference Tables

### Bid Strategy Selection Matrix

| Scenario | Strategy | Starting Setting |
|----------|----------|-----------------|
| New account, no CPA data | Lowest Cost | N/A |
| Known CPA, want stability | Cost Cap | Target CPA + 20% |
| Flash sale, 48-hour campaign | Bid Cap | Target CPA |
| E-commerce, variable AOV | Minimum ROAS | Breakeven ROAS + 10% |
| Retargeting, small budget | Lowest Cost | N/A |
| Scaling proven campaign | Cost Cap | Current CPA + 15% |
| Testing new audience | Lowest Cost | N/A |

### Warning Signals Summary

| Signal | Duration | Action |
|--------|----------|--------|
| CPA 30%+ above target | 2+ weeks | Raise cap, broaden audience, or accept higher CPA |
| Daily spend <70% of budget | 5+ days | Raise cap 10-15% |
| CPA swinging wildly day-to-day | During learning | Normal. Wait for learning to complete. |
| CPA swinging wildly post-learning | 2+ weeks | Campaign structure issue. Audit creative and audience. |
| Spend is $0 | 2+ days | Cap far too low, policy issue, or audience too small |

### Bid Strategy Comparison

| Feature | Lowest Cost | Cost Cap | Bid Cap | Min ROAS |
|---------|-------------|----------|---------|----------|
| Cost control | None | Average CPA | Hard ceiling | ROAS floor |
| Delivery stability | High | Medium | Low | Medium |
| Budget utilization | 100% | 70-100% | 50-100% | 60-100% |
| Monitoring frequency | Weekly | Weekly | Daily | Weekly |
| Learning phase sensitivity | Low | Medium | High | Medium |
| Best for | New campaigns | Scaling | Promotions | Variable AOV |

---

## Reference Files

- `references/strategy_selection_matrix.md` - Decision matrix with all scenarios and edge cases
- `references/learning_phase.md` - Learning phase triggers, management, and recovery protocols
