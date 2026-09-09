---
name: analyze_advantage_plus
description: Action skill that deep-analyzes Advantage+ campaigns including ASC performance, audience expansion behavior, existing vs new customer split, creative performance within Advantage+, and catalog performance. Produces Advantage+ optimization report.
triggers:
  - "analyze advantage plus"
  - "ASC performance"
  - "advantage plus review"
  - "advantage shopping analysis"
  - "ASC audit"
  - "advantage plus optimization"
---

# Analyze Advantage+

## Purpose

This skill provides deep analysis of Advantage+ campaigns, which operate fundamentally differently from manual campaigns. Advantage+ Shopping Campaigns (ASC), Advantage+ App Campaigns, and the unified Advantage+ campaign type use Meta's machine learning to make most targeting, placement, and creative decisions autonomously. This means the optimization levers are different, the diagnostic signals are different, and the benchmarking approach is different.

This skill exists because media buyers trained on manual campaigns frequently misinterpret Advantage+ behavior. They see broad delivery as "wasted spend," high new-customer CPAs as "underperformance," or uneven creative distribution as "a bug." This skill provides the correct interpretive framework.

---

## Dependencies

This skill loads the following at Step 0:

| Dependency | Purpose |
|------------|---------|
| `advantage_plus_methodology` | Complete A+ framework: how ASC works, audience signals, creative ranking, catalog behavior |
| `account_maturity_methodology` | Maturity-calibrated expectations (nascent accounts should NOT run A+ campaigns) |
| `account_conventions` | Account config, KPI targets, capability flags (has_advantage_plus, has_catalog) |

---

## Workflow

### Step 0: Load Dependencies

1. Read `advantage_plus_methodology` for the complete Advantage+ framework
2. Read `account_conventions` to confirm:
   - `has_advantage_plus: true` for the target account(s)
   - Which campaign types are active (ASC, Advantage+ App, unified)
   - KPI targets and flag thresholds
   - Existing vs new customer cap settings
3. Read `account_maturity_methodology` to calibrate expectations:
   - Nascent accounts: A+ not recommended (insufficient data)
   - Developing: A+ can work but needs guardrails (customer caps, budget limits)
   - Established/Advanced: A+ typically outperforms manual at scale

**Pre-flight validation:**
- If `has_advantage_plus: false`, inform the user and ask if they want to evaluate whether A+ should be enabled
- If account is nascent maturity, warn that A+ performance may be unreliable with limited conversion data

### Step 1: Identify Advantage+ Campaigns

Pull all campaigns with the following characteristics:
- Campaign objective: Sales (for ASC) or App Installs (for Advantage+ App)
- Special ad category: None (A+ is not available for special categories)
- Campaign type: Advantage+ Shopping, Advantage+ App, or unified Advantage+

For each Advantage+ campaign, collect:
- Campaign name, ID, status, launch date
- Daily/lifetime budget
- Existing customer cap percentage (if set)
- Number of active ads
- Optimization event (purchase, add to cart, etc.)
- Country targeting (the only targeting lever in ASC)

**Distinguish campaign types:**

| Type | Key Characteristics | Available Controls |
|------|--------------------|--------------------|
| ASC (Advantage+ Shopping) | Fully automated, ecommerce-focused | Country, existing customer cap, creative |
| Advantage+ App | App install/event optimization | Country, existing customer definition |
| Unified Advantage+ | Newer format, replaces manual + ASC | More controls, audience suggestions, creative |

### Step 2: Performance Baseline

Compare Advantage+ campaigns against manual campaigns on the same account.

**Comparison table:**

| Metric | Advantage+ | Manual Campaigns | Delta | Winner |
|--------|-----------|-----------------|-------|--------|
| CPA | | | | |
| ROAS | | | | |
| CPM | | | | |
| Reach | | | | |
| Frequency | | | | |
| CTR | | | | |
| Conversion Rate | | | | |
| Spend Efficiency | | | | |

**Important context for comparison:**
- A+ campaigns typically have higher CPMs (they bid more aggressively for high-value users)
- A+ campaigns may show lower CTR but higher conversion rate (targeting quality over quantity)
- A+ CPAs should be compared at the ACCOUNT level, not campaign level, because A+ cannibalizes some manual campaign conversions
- Always check incrementality: is A+ driving net-new conversions or just claiming manual campaign's conversions?

**Incrementality check:**
1. Compare total account conversions before and after A+ launch
2. If total account conversions stayed flat but shifted from manual to A+, A+ may not be incremental
3. Best practice: run a conversion lift study if budget allows

### Step 3: Customer Split Analysis

Advantage+ campaigns serve both existing and new customers. The existing customer cap is the primary control lever.

**Analysis points:**

| Metric | Existing Customers | New Customers | Benchmark |
|--------|-------------------|---------------|-----------|
| % of Spend | | | Cap setting vs actual |
| CPA | | | New should be 1.5-3x existing |
| ROAS | | | Existing typically 2-5x higher |
| Conversion Rate | | | Existing typically 3-5x higher |
| Frequency | | | Existing can be higher |

**Customer cap evaluation:**

| Cap Setting | When Appropriate | Risk |
|-------------|-----------------|------|
| No cap (0%) | Never recommended | A+ will over-index on existing customers (easy conversions) |
| 10-20% | Default recommendation | Allows retargeting efficiency while forcing prospecting |
| 25-40% | High-value repeat purchase business | Acceptable if repeat purchase rate justifies it |
| 50%+ | Rarely appropriate | Essentially a retargeting campaign disguised as A+ |

**Red flags:**
- Existing customer spend significantly exceeding the cap (Meta sometimes overspends on existing)
- New customer CPA more than 5x existing customer CPA (audience quality issue)
- Existing customer cap not set at all (most common mistake)

**Recommendation logic:**
- If existing customers are eating >30% of spend with no cap: set cap at 15-20%
- If new customer CPA is reasonable but existing customer CPA is cannibalizing manual retargeting: reduce cap or consolidate retargeting into A+
- If existing customer ROAS is dramatically higher: this is expected, do not chase this by raising the cap

### Step 4: Audience Expansion Analysis

Unlike manual campaigns, you cannot see exactly who A+ targets. But you can infer audience behavior from delivery signals.

**Analysis approach:**

1. **Geographic distribution:** Where is A+ spending? Compare to your target market expectations
2. **Age/gender breakdown:** Pull demographic performance to see if A+ is finding unexpected segments
3. **Placement distribution:** Where are ads being shown? Feed vs Stories vs Reels vs Audience Network
4. **Time-of-day delivery:** When is A+ choosing to deliver? Concentration patterns
5. **Device breakdown:** iOS vs Android performance differences

**Audience signal interpretation:**

| Signal | Meaning | Action |
|--------|---------|--------|
| Spend concentrated in unexpected demographics | A+ found a pocket of efficiency | Investigate, potentially create manual campaigns targeting this segment |
| Audience Network getting significant spend | A+ filling reach via partner apps | Check conversion quality from AN, consider AN exclusion if CPA is 2x+ |
| One placement dominating (>70% spend) | A+ strongly prefers this format | Ensure creative is optimized for this placement, test more creative for underserved placements |
| Very broad geographic spread | A+ exploring broadly | Check if non-target geos are converting at acceptable CPA |

**Advantage+ Audience (non-ASC campaigns):**
For campaigns using Advantage+ Audience (the targeting expansion feature, not ASC), also check:
- What percentage of spend goes to the "original audience" vs "expanded audience"
- CPA comparison between original and expanded
- If expanded audience is outperforming, the original targeting suggestion may be too narrow

### Step 5: Creative Performance Within Advantage+

A+ campaigns handle creative allocation differently than manual campaigns. Meta dynamically allocates impressions to winning creative, which means:
- Spend concentration in 1-2 ads is normal (not a problem)
- Low-performing ads get very little spend (working as intended)
- Creative diversity still matters (more inputs = better optimization)

**Creative analysis within A+:**

| Ad | Format | Spend | % of Total | CPA | ROAS | CTR | Status |
|----|--------|-------|------------|-----|------|-----|--------|
| | | | | | | | |

**Key questions:**
1. How many ads are receiving meaningful spend (>5% of campaign budget)?
2. Is there a clear winner or is spend evenly distributed (even distribution often means no standout creative)?
3. Are different formats winning for different placements?
4. What is the creative age of the top-spending ads? (fatigue risk)
5. Are recently added ads getting any spend or being starved by established winners?

**Creative strategy for A+:**
- A+ needs more creative volume than manual campaigns (aim for 10-15 active ads minimum)
- Variety in format matters more than variety in messaging (Meta optimizes format to placement)
- Add new creative weekly to prevent stagnation
- Do not pause ads that are getting low spend -- they serve as fallback options and removing them reduces Meta's optimization surface
- If a new ad is not getting spend after 7 days, it is likely not competitive. Focus on producing better creative rather than forcing distribution.

**Format distribution analysis:**

| Format | # of Ads | Spend Share | CPA | Recommendation |
|--------|----------|-------------|-----|----------------|
| Static | | | | |
| Video (short) | | | | |
| Video (long) | | | | |
| Carousel | | | | |
| Catalog/DPA | | | | |

### Step 6: Catalog Performance (If Applicable)

Only runs if `has_catalog: true` in account-conventions.

**Product-level analysis within A+ Catalog:**

1. **Top products by spend:** Are the highest-spend products also the highest-ROAS products?
2. **Product set performance:** Compare product sets/categories
3. **Feed quality within A+:** Are products with better titles/images getting more delivery?
4. **Catalog creative vs uploaded creative:** Compare DPA templates to custom creative performance

**Catalog-specific checks:**

| Check | Pass Criteria | Action if Fail |
|-------|---------------|----------------|
| Top 20 products by spend have positive ROAS | All above target ROAS | Exclude underperformers via product set |
| Feed completeness | >95% of fields populated | Fix feed gaps (title, description, custom labels) |
| Product freshness | Feed updated in last 24h | Check feed schedule |
| Catalog size utilized | >50% of products getting impressions | Check for feed errors, improve underperforming product data |

---

## Checkpoint: Present Findings

Before generating the final report, present a summary:

```
Advantage+ Analysis Summary
============================

Account: [Account Name]
A+ Campaigns Analyzed: [Count]
Period: [Date Range]

Key Findings:
1. [Most important finding]
2. [Second finding]
3. [Third finding]

A+ vs Manual Performance: [A+ wins / Manual wins / Mixed]
Customer Split Health: [Healthy / Needs adjustment]
Creative Pipeline Status: [Sufficient / Needs more volume]
```

**Wait for user confirmation before generating the full report.**

---

### Step 7: Output

```markdown
# Advantage+ Performance Report

**Account:** [Name] | **Period:** [Date Range]
**Report Date:** [Today]

## Executive Summary

[2-3 sentences: Is A+ performing well? What's the single biggest optimization opportunity?]

## Campaign Overview

| Campaign | Type | Status | Budget | Spend | CPA | ROAS | Customer Cap |
|----------|------|--------|--------|-------|-----|------|-------------|
| | | | | | | | |

## A+ vs Manual Comparison

[Comparison table from Step 2]

### Incrementality Assessment
[Is A+ driving net-new conversions? Evidence.]

## Customer Split Analysis

[Table from Step 3]

### Customer Cap Recommendation
[Current cap] -> [Recommended cap] because [reason]

## Audience Expansion Insights

### Demographic Performance
[Age/gender breakdown with CPA by segment]

### Placement Distribution
[Spend and performance by placement]

### Geographic Distribution
[If multi-geo, performance by location]

## Creative Performance

### Top Performing Ads
[Top 5 ads by ROAS with key metrics]

### Format Distribution
[Format table from Step 5]

### Creative Pipeline Assessment
- Active ads: [count]
- Ads receiving meaningful spend: [count]
- Average creative age (top spenders): [days]
- Creative refresh needed by: [date]

## Catalog Performance (if applicable)
[Catalog findings from Step 6]

## Optimization Recommendations

### Immediate Actions
1. [Action] - [Expected impact]

### This Week
1. [Action] - [Expected impact]
2. [Action] - [Expected impact]

### This Month
1. [Action] - [Expected impact]

## Monitoring Plan

| Metric | Current | Target | Check Frequency |
|--------|---------|--------|----------------|
| New customer CPA | | | Daily |
| Existing customer spend % | | | Weekly |
| Creative winner count | | | Weekly |
| A+ vs manual CPA gap | | | Bi-weekly |
```

---

## Reference Files

- `references/data_requirements.md` - MCP calls for A+ campaign data, customer split breakdowns, catalog insights
- `references/output_specs.md` - Report format specifications
- `references/worked_example.md` - Complete A+ analysis for a $50K/month ecommerce account showing customer cap optimization from 0% to 20% reducing blended CPA by 18%
