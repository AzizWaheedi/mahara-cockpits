---
name: investigate_campaign
description: Action skill that performs root-cause analysis on underperforming Meta Ads campaigns. Walks through the 8-branch diagnostic tree (measurement, delivery, audience, creative, landing page, budget, bidding, external) to identify the primary issue and produce a prioritized action plan with evidence chain.
triggers:
  - "investigate campaign"
  - "why is this campaign failing"
  - "campaign not performing"
  - "diagnose campaign"
  - "campaign troubleshooting"
  - "CPA too high"
  - "campaign not spending"
  - "delivery issues"
---

# Investigate Campaign

## Purpose

This skill performs structured root-cause analysis on underperforming Meta Ads campaigns. Rather than guessing at fixes or making one-off tweaks, it walks through an 8-branch diagnostic tree that systematically eliminates potential causes until the root issue is identified. The output is a prioritized action plan backed by an evidence chain, not a list of "things to try."

Most campaign performance issues fall into one of eight categories. The order matters: measurement problems masquerade as performance problems, delivery problems masquerade as audience problems, and so on. This skill checks from the foundation up so you fix the actual cause, not a symptom.

---

## Dependencies

This skill loads the following at Step 0:

| Dependency | Purpose |
|------------|---------|
| `campaign_diagnostics_methodology` | Complete diagnostic framework, branch logic, decision trees |
| `account_conventions` | Account config, KPI targets, flag thresholds, naming conventions |
| `account_maturity_methodology` | Maturity-calibrated expectations for benchmarks |

---

## Diagnostic Tree Overview

The 8 branches are checked in order. Each branch has a pass/fail determination. If a branch fails, it becomes a contributing factor. Multiple branches can fail simultaneously (and often do).

```
Campaign Flagged
    |
    v
[1] Measurement -----> Is the data even accurate?
    |
    v
[2] Delivery --------> Is Meta able to spend the budget?
    |
    v
[3] Audience --------> Is the audience right for this offer?
    |
    v
[4] Creative --------> Is the creative compelling enough?
    |
    v
[5] Landing Page ----> Is the post-click experience converting?
    |
    v
[6] Budget ----------> Is the budget appropriate for the goal?
    |
    v
[7] Bidding ---------> Is the bid strategy helping or hurting?
    |
    v
[8] External --------> Are outside factors driving the change?
    |
    v
Root Cause Report + Action Plan
```

---

## Workflow

### Step 0: Load Dependencies

1. Read `campaign_diagnostics_methodology` for the complete diagnostic framework
2. Read `account_conventions` for this account's config:
   - KPI targets and flag thresholds
   - Attribution window
   - Naming conventions (to parse campaign/ad set/ad metadata)
   - Measurement setup (CAPI, pixel, third-party tool)
3. Read `account_maturity_methodology` to calibrate benchmark expectations
4. Confirm data source method (MCP, CSV, or manual)

### Step 1: Identify Target Campaign

**Input required:** The user specifies the campaign to investigate, or the system flags it from a prior performance_analysis run.

Collect the following:
- Campaign name and ID
- Campaign objective (conversions, traffic, reach, etc.)
- Launch date and current status
- Current period performance vs target (CPA, ROAS, spend, conversions)
- How long the campaign has been underperforming
- Any recent changes made to the campaign (edits within last 7 days)

**Key question:** Is this a campaign that was previously performing well and declined, or one that never performed? The diagnostic path differs:
- **Decline from baseline:** Focus on fatigue, audience saturation, external changes, recent edits
- **Never performed:** Focus on measurement, structure, audience-offer fit, creative quality

### Step 2: Measurement Check (Branch 1)

**Question:** Is the data you're looking at even accurate?

This is always checked first because every other branch depends on reliable data. A broken pixel makes a healthy campaign look dead.

**Check items:**

| Check | How to Verify | Pass Criteria |
|-------|---------------|---------------|
| Pixel firing | Check pixel diagnostics or Events Manager | All key events firing in last 24h |
| CAPI status | Check CAPI integration health | Events received, EMQ score 6+ |
| Event Match Quality (EMQ) | Events Manager or MCP | Score 6.0+ out of 10 |
| Attribution window | Account settings | Matches account-conventions config |
| Delayed attribution | Compare 1-day vs 7-day windows | If 7d_click shows significantly more conversions, attribution lag is normal |
| Conversion event | Campaign setup | Optimizing for the right event (not a micro-conversion) |
| UTM parameters | Check ad URLs | Properly structured per naming conventions |
| Deduplication | Compare Meta-reported vs backend/CRM | Within 20% variance |

**Critical rule:** Before concluding a campaign is underperforming, always check for delayed attribution. Campaigns optimizing for purchase events with longer consideration cycles (SaaS trials, high-ticket items) may show weak 1-day numbers but strong 7-day numbers. This is not underperformance -- it is expected attribution delay.

**Branch verdict:**
- **Pass:** Measurement is healthy, proceed to Branch 2
- **Fail:** Document specific measurement issues. These must be fixed before any other optimization. Flag as P0.

### Step 3: Delivery Check (Branch 2)

**Question:** Is Meta actually able to deliver your ads to people?

A campaign can have perfect creative and targeting but fail because Meta cannot physically deliver the ads.

**Check items:**

| Check | How to Verify | Pass Criteria |
|-------|---------------|---------------|
| Learning phase status | Campaign/ad set level | Exited learning phase (50+ conversions in 7 days) |
| Ad set delivery status | Delivery column | "Active" not "Learning Limited" or "Not Delivering" |
| Ad disapprovals | Ad review status | No rejected ads |
| Audience size vs budget | Estimated audience size | Audience large enough for daily budget (minimum 100K for $50+/day) |
| Delivery estimate | Meta delivery estimate | "Likely" or above, not "May not spend" |
| Account-level spending limit | Account settings | No spending limit hit |
| Payment method | Billing | Active payment method, no billing issues |
| Campaign spending limit | Campaign settings | No campaign spend cap reached |
| Frequency capping | Reach and frequency data | Not capped too aggressively |

**Learning phase deep dive:**
- Learning phase requires ~50 conversion events in 7 days per ad set
- "Learning Limited" means the ad set cannot exit learning phase given current settings
- Common causes: budget too low, audience too small, optimization event too rare, too many ad sets splitting volume
- Solution hierarchy: consolidate ad sets > raise budget > broaden audience > change optimization event

**Branch verdict:**
- **Pass:** Delivery is healthy, proceed to Branch 3
- **Fail:** Document delivery blockers. Learning Limited is the most common issue. Flag as P0 or P1 depending on severity.

### Step 4: Audience Check (Branch 3)

**Question:** Is the audience appropriate for this campaign's offer and budget?

**Check items:**

| Check | How to Verify | Pass Criteria |
|-------|---------------|---------------|
| Frequency (prospecting) | Ad set metrics | Below 3.0 in last 7 days |
| Frequency (retargeting) | Ad set metrics | Below 7.0 in last 7 days |
| Audience overlap | Audience Overlap tool or manual review | <30% overlap between active ad sets |
| Audience size | Estimated reach | Appropriate for budget (see sizing table below) |
| Advantage+ expansion | Delivery insights | Expansion spending efficiently vs core audience |
| Audience exhaustion | Frequency trend over 4 weeks | Not consistently rising |
| Exclusions | Ad set targeting | Proper exclusions in place (purchasers, existing customers) |
| Lookalike quality | Source audience size and recency | Source >1,000 people, updated within 90 days |

**Audience size guidelines:**

| Daily Budget | Minimum Audience Size | Recommended Audience Size |
|-------------|----------------------|--------------------------|
| $10-50/day | 100K | 500K-2M |
| $50-200/day | 500K | 2M-10M |
| $200-1K/day | 1M | 5M-20M |
| $1K+/day | 5M | 10M+ or Broad/Advantage+ |

**Advantage+ Audience analysis:**
- Check what percentage of spend goes to Advantage+ expanded audience vs original/custom audience
- If expansion is spending 80%+ of budget, your original targeting suggestion is being largely ignored
- Compare CPA of expanded vs original segments
- If expanded outperforms original, your targeting hypothesis may be wrong

**Branch verdict:**
- **Pass:** Audience is healthy, proceed to Branch 4
- **Fail:** Document audience issues (saturation, overlap, sizing). Flag as P1.

### Step 5: Creative Check (Branch 4)

**Question:** Is the creative compelling enough to drive the desired action?

**Check items:**

| Check | How to Verify | Pass Criteria |
|-------|---------------|---------------|
| Hook rate (video) | 3-second video views / impressions | Above 25% (see creative-strategy-methodology benchmarks) |
| Hold rate (video) | ThruPlay / 3-second views | Above 40% |
| CTR (all traffic) | Click metrics | Above account-conventions warning threshold |
| CTR trend | 4-week rolling | Not declining for 3+ consecutive weeks |
| Creative age | Launch date | Top-spending ads less than 6 weeks old |
| Format diversity | Ad-level breakdown | At least 2 formats active (static + video minimum) |
| Ad count | Active ads per ad set | 3-6 active ads (not 1, not 20) |
| Social proof | Engagement metrics | Positive comment sentiment, reasonable engagement rate |
| Fatigue signals | Frequency + CTR + CPA trend | See creative-strategy-methodology fatigue detection |

**Creative fatigue assessment:**
- Compare current 7-day CTR to the ad's first 14-day CTR (baseline)
- If CTR has dropped >10% from baseline, creative fatigue is likely
- Cross-reference with frequency: high frequency + declining CTR = confirmed fatigue
- Check if CPA increase correlates with CTR decline (usually does)

**Branch verdict:**
- **Pass:** Creative is healthy, proceed to Branch 5
- **Fail:** Document creative issues (fatigue, low hook rate, format gaps). Flag as P1. Recommend generate_creative_brief.

### Step 6: Landing Page Check (Branch 5)

**Question:** Is the post-click experience converting visitors into customers?

**Check items:**

| Check | How to Verify | Pass Criteria |
|-------|---------------|---------------|
| Bounce rate | GA4 or analytics tool | Below 60% for cold traffic, below 40% for retargeting |
| Page load time | PageSpeed Insights or WebPageTest | Under 3 seconds (mobile) |
| Mobile experience | Mobile preview or Lighthouse | Mobile-friendly, no horizontal scroll, readable text |
| Conversion rate | Landing page analytics | Above account baseline (check 4-week average) |
| Message match | Visual comparison: ad vs LP | Headline, imagery, and offer match the ad's promise |
| Form/checkout friction | User flow analysis | Minimal steps, clear CTA, no unnecessary fields |
| Trust signals | Page review | Reviews, testimonials, security badges, guarantees present |
| CTA visibility | Above-the-fold check | Primary CTA visible without scrolling on mobile |

**Message match assessment:**
The most common landing page issue is a disconnect between what the ad promises and what the landing page delivers. Check:
- Does the LP headline reinforce the ad's hook?
- Is the primary offer/benefit the same?
- Do visuals match (product shown in ad is prominent on LP)?
- Is the CTA action the same (ad says "Get Started Free" but LP says "Request Demo")?

**Branch verdict:**
- **Pass:** Landing page is healthy, proceed to Branch 6
- **Fail:** Document LP issues. Flag as P1 or P2 depending on severity. Note that LP fixes are outside Meta Ads Manager.

### Step 7: Budget and Bidding Check (Branch 6 and 7)

These two branches are checked together as they are deeply interrelated.

**Budget checks:**

| Check | How to Verify | Pass Criteria |
|-------|---------------|---------------|
| Spend vs budget | Delivery metrics | Spending 80-100% of daily budget |
| Budget sufficiency | Budget vs target CPA | Daily budget >= 3x target CPA per ad set |
| CBO distribution | Campaign budget allocation | No ad set getting <10% of campaign budget |
| Budget changes | Edit history | No budget change >20% in last 3 days (triggers re-learning) |
| Pacing | Spend curve intraday | Even distribution, not front-loaded or back-loaded |

**Bidding checks:**

| Check | How to Verify | Pass Criteria |
|-------|---------------|---------------|
| Bid strategy fit | Campaign settings vs account-maturity | Appropriate for maturity level |
| Cost cap level | Cost cap vs actual CPA | Cost cap not more than 20% below actual CPA (restricts delivery) |
| Bid cap level | Bid cap vs auction dynamics | Not so low that winning rate drops below 20% |
| ROAS floor | Minimum ROAS setting | Not set unrealistically high |
| Learning phase triggers | Recent edits | No significant edits in last 7 days that reset learning |

**Significant edits that reset learning phase:**
- Budget change >20% in a single edit
- Bid/cost cap change
- Targeting change
- Optimization event change
- Adding/pausing ads (sometimes)
- Creative swap (sometimes)

**Branch verdict:**
- **Pass:** Budget and bidding are healthy, proceed to Branch 8
- **Fail:** Document budget/bidding issues. Flag as P1 (budget) or P0 (bidding restricting delivery).

### Step 8: External Check (Branch 8)

**Question:** Are factors outside your control driving the performance change?

**Check items:**

| Check | How to Verify | Pass Criteria |
|-------|---------------|---------------|
| Seasonality | Historical data, industry calendar | Not in a known seasonal dip |
| Competitor activity | Meta Ad Library search | No major new competitor campaigns |
| Platform-wide CPM changes | CPM trend vs prior month | CPM change within 15% |
| iOS/privacy changes | Industry news, platform updates | No recent tracking degradation |
| Product/offer changes | Internal check | No price changes, stock issues, or offer modifications |
| Market events | News, economic indicators | No macro events affecting demand |
| Platform outages | Meta status page, industry forums | No reported delivery issues |

**Meta Ad Library competitor check:**
1. Search Meta Ad Library for top 3-5 competitors
2. Check for new campaigns launched in the last 2 weeks
3. Note if competitors are running aggressive promotions (can increase auction competition)
4. Check if competitors are targeting similar audiences (increases CPMs)

**Branch verdict:**
- **Pass:** No significant external factors identified
- **Fail:** Document external factors. These are typically uncontrollable but inform strategy (e.g., wait out seasonality, adjust budget during high-CPM periods, counter competitor offers).

---

## Checkpoint: Evidence Chain Review

Before producing the final output, present the evidence chain to the user:

```
Evidence Chain Summary
======================

Campaign: [Campaign Name] ([Campaign ID])
Period: [Date Range]
Performance: CPA $XX.XX (target: $XX.XX, +XX% over target)

Branch Results:
[1] Measurement:  PASS / FAIL - [brief finding]
[2] Delivery:     PASS / FAIL - [brief finding]
[3] Audience:     PASS / FAIL - [brief finding]
[4] Creative:     PASS / FAIL - [brief finding]
[5] Landing Page: PASS / FAIL - [brief finding]
[6] Budget:       PASS / FAIL - [brief finding]
[7] Bidding:      PASS / FAIL - [brief finding]
[8] External:     PASS / FAIL - [brief finding]

Root Cause(s): [Primary cause] + [Contributing factors]
```

**Wait for user confirmation before generating the full report.**

---

## Step 9: Output

### Root Cause Report

```markdown
# Campaign Investigation Report

**Campaign:** [Name] | **ID:** [ID]
**Account:** [Account Name]
**Period Analyzed:** [Date Range]
**Investigation Date:** [Today]

## Executive Summary

[2-3 sentence summary: what's wrong, why, and the single most impactful fix]

## Performance Context

| Metric | Current | Target | Delta | Trend |
|--------|---------|--------|-------|-------|
| CPA | $XX.XX | $XX.XX | +XX% | [direction] |
| ROAS | X.Xx | X.Xx | -XX% | [direction] |
| Spend | $X,XXX | $X,XXX | XX% | [direction] |
| Conversions | XX | XX | -XX% | [direction] |
| CTR | X.XX% | X.XX% | -XX% | [direction] |
| Frequency | X.X | <X.X | +XX% | [direction] |

## Diagnostic Results

### Branch 1: Measurement [PASS/FAIL]
[Findings, evidence, data points]

### Branch 2: Delivery [PASS/FAIL]
[Findings, evidence, data points]

[...repeat for all 8 branches...]

## Root Cause Analysis

**Primary root cause:** [Specific issue with evidence]

**Contributing factors:**
1. [Factor with evidence]
2. [Factor with evidence]

**Ruled out:**
- [Branches that passed and why]

## Action Plan

### P0: Fix Immediately (this prevents recovery)
1. [Action] - [Expected impact] - [Timeline]

### P1: Fix This Week (significant performance impact)
1. [Action] - [Expected impact] - [Timeline]
2. [Action] - [Expected impact] - [Timeline]

### P2: Fix This Month (optimization opportunity)
1. [Action] - [Expected impact] - [Timeline]

## Recovery Timeline

**Expected recovery:** [X days/weeks after implementing P0 fixes]
**Rationale:** [Why this timeline -- learning phase, creative ramp, etc.]
**Monitoring plan:** [What to check daily during recovery]

## Follow-Up Skills

| Skill | Reason |
|-------|--------|
| generate_creative_brief | If creative fatigue identified |
| audit_audiences | If audience saturation identified |
| audit_measurement | If measurement gaps found |
| optimize_budgets | If budget/pacing issues identified |
```

---

## Common Root Cause Patterns

These are the most frequently observed root cause combinations, in order of prevalence:

| Pattern | Branches Failed | Typical Fix |
|---------|----------------|-------------|
| Creative fatigue | Creative + Audience (frequency) | New creative + audience expansion |
| Learning phase loop | Delivery + Budget | Consolidate ad sets, raise budget, simplify structure |
| Measurement gap | Measurement | Fix pixel/CAPI, wait 7 days, re-evaluate |
| Audience saturation | Audience + Creative | Broaden targeting, launch new concepts |
| Post-click disconnect | Landing Page + Creative (high CTR, low CVR) | Message match fix on LP |
| Budget constraint | Budget + Delivery | Increase budget or consolidate campaigns |
| Seasonal headwind | External + Budget | Adjust targets, ride it out, or pause and reallocate |
| Over-optimization | Bidding + Delivery | Remove cost cap, let Meta optimize freely |

---

## Reference Files

- `references/data_requirements.md` - MCP calls and data fields needed for each diagnostic branch
- `references/output_specs.md` - Report format specifications and templates
- `references/worked_example.md` - End-to-end diagnosis of a real-world campaign: "Apex Athletics CONV_PROS_US campaign with 3x CPA spike traced to CAPI misconfiguration + creative fatigue"
