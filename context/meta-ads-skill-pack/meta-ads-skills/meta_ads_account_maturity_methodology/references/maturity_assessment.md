# Meta Ads Account Maturity Assessment

Use this questionnaire to classify a Meta Ads account into the correct maturity stage. Answer each question, then use the scoring guide at the bottom to determine the stage.

---

## Section A: Volume and Spend (Primary Classification)

These two metrics are the primary determinants of maturity stage.

**A1. How many conversion events (purchases, leads, or primary goal) did the account record in the last 30 days?**

| Answer | Points |
|--------|--------|
| Fewer than 30 | 1 |
| 30-100 | 2 |
| 100-300 | 3 |
| 300+ | 4 |

**A2. What was the total ad spend in the last 30 days?**

| Answer | Points |
|--------|--------|
| Under $3,000 | 1 |
| $3,000-$15,000 | 2 |
| $15,000-$50,000 | 3 |
| $50,000+ | 4 |

---

## Section B: Data Infrastructure (Modifier)

These questions assess whether the account's tracking and data foundation support its volume level.

**B1. Is Meta Pixel installed and firing all standard events?**
(PageView, ViewContent, AddToCart, InitiateCheckout, Purchase/Lead)

| Answer | Points |
|--------|--------|
| No pixel or major event gaps | -2 |
| Pixel installed but missing some events | -1 |
| All standard events firing correctly | 0 |
| All events + enhanced matching or parameters | +1 |

**B2. Is Conversions API (CAPI) implemented?**

| Answer | Points |
|--------|--------|
| No | 0 |
| Yes, but Event Match Quality below 6.0 | +0.5 |
| Yes, Event Match Quality 6.0+ | +1 |

**B3. Is there a product catalog connected?** (ecommerce accounts only; skip for lead gen/SaaS)

| Answer | Points |
|--------|--------|
| No catalog | 0 |
| Catalog connected but not used in campaigns | +0.5 |
| Catalog active in DPA/catalog sales campaigns | +1 |

**B4. Are Custom Conversions defined beyond standard events?**

| Answer | Points |
|--------|--------|
| No | 0 |
| Yes, 1-3 custom conversions | +0.5 |
| Yes, 4+ custom conversions with clear funnel mapping | +1 |

---

## Section C: Campaign Sophistication (Modifier)

**C1. How many active campaigns are in the account?**

| Answer | Points |
|--------|--------|
| 1-2 | 0 |
| 3-5 | +0.5 |
| 6-10 | +1 |
| 10+ | +1 (but flag for potential fragmentation review) |

**C2. Which bid strategies are in use?**

| Answer | Points |
|--------|--------|
| Lowest Cost only | 0 |
| Lowest Cost + Cost Cap | +0.5 |
| Cost Cap + Minimum ROAS or Bid Cap | +1 |
| Portfolio approach (different strategies by campaign purpose) | +1.5 |

**C3. Is Advantage+ Shopping Campaign (ASC) active?**

| Answer | Points |
|--------|--------|
| No | 0 |
| Yes, but less than 30 days live | +0.5 |
| Yes, 30+ days live with meaningful spend | +1 |

**C4. What audience strategy is used for prospecting?**

| Answer | Points |
|--------|--------|
| Interest targeting only | 0 |
| Interests + Lookalikes | +0.5 |
| Advantage+ Audience as default | +1 |
| Advantage+ Audience + strategic overrides with audience suggestions | +1.5 |

---

## Section D: Creative Maturity (Modifier)

**D1. How many new creatives are produced per week?**

| Answer | Points |
|--------|--------|
| Fewer than 3 | 0 |
| 3-5 | +0.5 |
| 5-10 | +1 |
| 10+ | +1.5 |

**D2. What creative formats are in rotation?**

| Answer | Points |
|--------|--------|
| Static only | 0 |
| Static + Video | +0.5 |
| Static + Video + UGC or Carousel | +1 |
| 4+ formats (static, video, UGC, carousel, catalog, collection) | +1.5 |

**D3. Is there a structured creative testing framework?**

| Answer | Points |
|--------|--------|
| No testing framework (ad hoc) | 0 |
| Basic A/B testing | +0.5 |
| DCT / Flexible Ads | +1 |
| Multi-track testing (concept + format + hook + iteration) | +1.5 |

---

## Section E: Measurement Maturity (Modifier)

**E1. What attribution window is in use?**

| Answer | Points |
|--------|--------|
| 1-day click | 0 |
| 7-day click | +0.5 |
| 7-day click, 1-day view | +1 |

**E2. Is a third-party attribution tool in use?**

| Answer | Points |
|--------|--------|
| No | 0 |
| Yes, but not regularly reviewed | +0.5 |
| Yes, actively used for decisions | +1 |

**E3. Has the account run Conversion Lift studies or incrementality tests?**

| Answer | Points |
|--------|--------|
| Never | 0 |
| Once | +0.5 |
| Regularly (quarterly+) | +1 |

---

## Scoring Guide

### Step 1: Determine Base Stage from Section A

Take the lower of your two Section A scores (conservative classification):

| Lower Score | Base Stage |
|-------------|-----------|
| 1 | Nascent |
| 2 | Developing |
| 3 | Established |
| 4 | Advanced |

### Step 2: Calculate Modifier Score

Sum all points from Sections B through E.

| Modifier Total | Adjustment |
|----------------|-----------|
| Below 0 | Downgrade one stage (data infrastructure gaps undermine volume) |
| 0-4 | No adjustment |
| 5-8 | No adjustment (confirms base stage) |
| 9-12 | Upgrade one stage (sophistication exceeds typical for this volume) |
| 13+ | Upgrade one stage (cap at Advanced) |

### Step 3: Apply Override Rules

These override the calculated stage regardless of score:

| Condition | Override |
|-----------|---------|
| Pixel/CAPI has critical gaps (B1 = -2) | Cap at Nascent until resolved |
| Zero conversions in last 30 days | Nascent regardless of spend |
| Account paused for 60+ days | Nascent (algorithm has lost signal) |
| Spend > $100K/month but < 100 conversions | Developing (spend alone doesn't equal maturity) |

### Step 4: Record the Classification

```
Account: [name]
Assessment date: [YYYY-MM-DD]
Section A base stage: [Nascent/Developing/Established/Advanced]
Modifier score: [total]
Adjustment: [none/upgrade/downgrade]
Override applied: [yes/no, reason]
Final classification: [Nascent/Developing/Established/Advanced]
```

Update the `maturity_level` field in account-conventions to match.

---

## Reassessment Schedule

| Current Stage | Reassess Every |
|---------------|---------------|
| Nascent | Monthly |
| Developing | Monthly |
| Established | Quarterly |
| Advanced | Quarterly |

Also reassess when:
- Monthly conversion volume changes by more than 30%
- Monthly spend changes by more than 40%
- Major tracking changes (new pixel, CAPI implementation, iOS policy shifts)
- Account has been paused and restarted
- Significant campaign restructure (e.g., consolidation or expansion)

---

## Example Assessment

**Account:** Apex Athletics US
**Date:** 2026-03-27

| Question | Answer | Points |
|----------|--------|--------|
| A1: Monthly conversions | 180 | 3 |
| A2: Monthly spend | $35,000 | 3 |
| B1: Pixel status | All events + enhanced matching | +1 |
| B2: CAPI | Yes, EMQ 7.2 | +1 |
| B3: Catalog | Active in DPA campaigns | +1 |
| B4: Custom conversions | 2 custom conversions | +0.5 |
| C1: Active campaigns | 5 | +0.5 |
| C2: Bid strategies | Cost Cap + testing Min ROAS | +1 |
| C3: ASC | Active 60+ days | +1 |
| C4: Audience strategy | Advantage+ Audience default | +1 |
| D1: Weekly creatives | 8 | +1 |
| D2: Creative formats | Static, video, UGC, carousel, catalog | +1.5 |
| D3: Testing framework | DCT + concept testing | +1 |
| E1: Attribution window | 7d click, 1d view | +1 |
| E2: Third-party tool | Triple Whale, actively used | +1 |
| E3: Lift studies | Never | 0 |

**Base stage (Section A):** min(3, 3) = 3 = Established
**Modifier total:** 12.5
**Adjustment:** Upgrade one stage (13+ threshold nearly met, round up given strength across all areas)
**Override:** None
**Final classification:** Advanced (borderline; would solidify with incrementality testing)

**Recommendation:** Classified as Established-to-Advanced transitional. Begin Conversion Lift studies to confirm Advanced status. All Advanced-stage recommendations apply, with the caveat that incrementality data is not yet available to validate true ROAS.
