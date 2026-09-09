# Product Tier Classification Methodology

## Overview

Product tier classification segments your catalog into performance-based groups that receive differentiated advertising strategies. This prevents the common mistake of treating all products equally, which leads to top performers being underfunded and poor performers wasting budget.

---

## The Four-Tier System

### Tier 1: Heroes (Top 20%)

**Definition:** Products that generate the most revenue and/or the highest ROAS from advertising.

**Identification criteria (meet 2 or more):**
- Revenue in top 20% of catalog over trailing 30 days
- ROAS above 3x (or your profitability threshold)
- Conversion rate from ad click >2x catalog average
- Product page conversion rate in top quartile
- Customer review rating >4.0 stars (for e-commerce)
- Consistent month-over-month revenue (not just a single spike)

**Advertising strategy:**
- Allocate 50-60% of catalog ad budget to Heroes
- Feature in ASC campaigns as priority creative
- Use in broad audience Advantage+ Catalog Ads (first impression matters)
- Create Hero-specific product sets for retargeting
- Use as the seed for product recommendations in cross-sell campaigns
- Monitor closely for fatigue (Heroes get the most impressions, so they fatigue faster)

**Bid strategy:** Cost Cap at target ROAS (protect efficiency while maximizing volume)

### Tier 2: Sidekicks (Moderate Performers)

**Definition:** Products with positive ROAS but below Hero-level performance. These are the steady contributors that round out the catalog.

**Identification criteria (meet 2 or more):**
- Revenue in 21st-50th percentile
- ROAS between 1.5x and 3x
- Moderate conversion volume (not high, not zero)
- Acceptable product page conversion rate (within 1 standard deviation of average)
- Potential to become Heroes with better creative or seasonal demand

**Advertising strategy:**
- Allocate 25-30% of catalog ad budget to Sidekicks
- Include in retargeting campaigns alongside Heroes
- Test Sidekicks in prospecting campaigns periodically (some may surprise you)
- Create "Heroes + Sidekicks" product set as the default for most campaigns
- Evaluate monthly for potential promotion to Hero tier

**Bid strategy:** Lowest Cost or Cost Cap (slightly more generous than Hero campaigns)

### Tier 3: Zombies (Low/Zero Sales)

**Definition:** Products with minimal or no advertising data. They haven't been given a fair chance, or they've been tested and performed below average.

**Two sub-categories:**

**Untested Zombies:**
- New products not yet advertised
- Products with <100 impressions (insufficient data to judge)
- Seasonal products outside their peak season

**Tested Zombies:**
- Products with 500+ impressions and zero or near-zero conversions
- Products with CPA 3x+ above catalog average
- Products with high click volume but no conversion (product/page problem, not ad problem)

**Advertising strategy:**
- Allocate 10-15% of catalog ad budget to Zombies (the "discovery budget")
- Test untested Zombies in small-budget campaigns periodically
- For tested Zombies: fix the product page or offer before re-testing
- Review monthly: promote promising Zombies to Sidekick tier, demote unresponsive ones to Villain tier
- Use broad targeting for Zombie tests (you don't know who will buy these)

**Bid strategy:** Lowest Cost (no cap, gather data efficiently)

### Tier 4: Villains (High Spend, Negative Return)

**Definition:** Products that actively lose money when advertised. They attract clicks but don't convert profitably.

**Identification criteria (meet 1 or more):**
- Negative ROAS after 500+ impressions and meaningful spend
- CPA exceeds product margin (advertising cost > profit per unit)
- High click volume with near-zero conversion rate (CTR > 1% but CVR < 0.1%)
- High return rate that negates apparent revenue
- Products generating customer complaints or negative ad comments

**Advertising strategy:**
- Allocate 0-5% of budget (or exclude entirely)
- Create a "Villains" exclusion product set to remove from all active campaigns
- Investigate root cause before re-testing:
  - Is the product page the problem? (high clicks = demand exists, but page doesn't convert)
  - Is pricing the problem? (competitive product at wrong price point)
  - Is the product itself the problem? (poor reviews, quality issues)
- Re-test only after fixing the identified root cause
- If a Villain can't be fixed: permanently exclude from advertising

**Bid strategy:** Excluded (no spend)

---

## Classification Process

### Initial Classification (New Catalog)

For catalogs without advertising history, use proxy data:

| Data Source | How to Use |
|-------------|-----------|
| Website analytics | Sort by page revenue (or transaction count) to identify natural Heroes |
| Historical sales data | Top sellers by revenue = likely Heroes |
| Margin data | High-margin products get priority (can afford higher CPA) |
| Review/rating data | Highly rated products convert better from ads |
| Inventory levels | Deep stock = safe to advertise aggressively |

**Quick classification without ad data:**
1. Sort all products by trailing 90-day revenue
2. Top 20% = Heroes (provisional)
3. Next 30% = Sidekicks (provisional)
4. Bottom 50% = Zombies (need testing)
5. No Villains yet (need ad performance data to identify)

### Ongoing Classification (Monthly)

**Data needed:**
- Product-level ad spend (from Ads Manager or reporting API)
- Product-level revenue attributed to ads
- Product-level click volume and conversion rate
- Return/refund data (if available)

**Process:**
1. Export product-level performance data for the trailing 30 days
2. Calculate ROAS per product: (Revenue from ads) / (Ad spend on that product)
3. Calculate CPA per product: (Ad spend) / (Conversions)
4. Rank all products by ROAS and revenue
5. Apply tier criteria (see identification sections above)
6. Compare to last month's classification -- note promotions and demotions
7. Update `custom_label_0` in supplemental feed with new tier assignments
8. Update product sets in Commerce Manager if rules are based on custom labels

### Automation Approach

For catalogs with 100+ products, automate the classification:

```
Monthly automation script (pseudocode):

1. Pull product-level performance data from Meta Marketing API
2. Pull product-level revenue from your analytics/backend
3. For each product:
   a. Calculate 30-day ROAS
   b. Calculate 30-day conversion rate
   c. Count impressions
4. Classify:
   - If ROAS > 3x AND revenue in top 20%: Hero
   - If ROAS 1.5-3x AND revenue in top 50%: Sidekick
   - If impressions < 100: Untested Zombie
   - If ROAS < 1x AND spend > $50: Villain
   - Else: Tested Zombie
5. Generate supplemental feed CSV with updated custom_label_0
6. Upload to Commerce Manager
7. Log changes for review
```

---

## Product Set Configuration

### Recommended Product Sets

| Product Set Name | Rule | Campaign Use |
|------------------|------|-------------|
| `All Active Products` | availability = "in stock" | Retargeting (show what they viewed) |
| `Heroes` | custom_label_0 = "hero" | Broad prospecting, ASC priority |
| `Heroes + Sidekicks` | custom_label_0 IN ("hero", "sidekick") | Standard DPA, primary retargeting |
| `New Products` | custom_label_4 = "new_launch" | Launch campaigns, discovery |
| `On Sale` | custom_label_3 = "on_sale" | Promotional campaigns |
| `High Margin` | custom_label_1 = "high_margin" | Efficiency-focused campaigns |
| `Seasonal Current` | custom_label_2 = current season | Seasonal promotions |
| `Exclude Villains` | custom_label_0 != "villain" | Applied as filter on other sets |

### Product Set Rules in Commerce Manager

Product sets can be defined by:
- **Custom label filters:** e.g., custom_label_0 = "hero"
- **Price range:** e.g., price > 50 AND price < 200
- **Availability:** e.g., availability = "in stock"
- **Category:** e.g., product_type contains "running shoes"
- **Brand:** e.g., brand = "Nike"
- **Combinations:** Multiple rules combined with AND/OR logic

---

## Tier Mobility

Products should move between tiers based on performance data. Track these transitions monthly:

### Promotion Paths

| From | To | Trigger |
|------|-----|---------|
| Zombie | Sidekick | First 30-day period with ROAS > 1.5x after testing |
| Sidekick | Hero | ROAS exceeds 3x for 2 consecutive months |
| Villain | Zombie | After fixing root cause, reset to testing phase |

### Demotion Paths

| From | To | Trigger |
|------|-----|---------|
| Hero | Sidekick | ROAS drops below 3x for 2 consecutive months |
| Sidekick | Zombie | ROAS drops below 1.5x OR conversion volume drops to near-zero |
| Zombie | Villain | After testing (500+ impressions), ROAS < 1x |

### Seasonal Adjustments

- Some products are seasonal Heroes (winter coats in Q4, swimwear in Q2)
- Tag seasonal products with `custom_label_2` for seasonality
- During off-season: reclassify seasonal Heroes as Zombies (reduce spend, not eliminate)
- During peak season: promote seasonal products aggressively
- Maintain an evergreen vs seasonal distinction to avoid false demotions

---

## Budget Allocation by Tier

### Standard Allocation

| Tier | % of Catalog Budget | CPA Target | Monitoring Frequency |
|------|--------------------|-----------|--------------------|
| Heroes | 50-60% | At or below account average | Daily |
| Sidekicks | 25-30% | At account average | Weekly |
| Zombies (testing) | 10-15% | 1.5x account average (testing premium) | Weekly |
| Villains | 0-5% | Excluded or strict cap | Monthly (review for re-entry) |

### Adjusting Allocation

**Increase Hero allocation when:**
- CPA is well below target (headroom to scale)
- New Hero products identified (expand the set)
- Seasonal demand surge for Hero products

**Increase Zombie allocation when:**
- Large batch of new products launched (need testing)
- Heroes are showing fatigue (need to find replacements)
- Seasonal shift creates opportunity for previously dormant products

**Decrease overall allocation when:**
- High percentage of Villains (fix product/page issues first)
- Account-wide CPA is above target (tighten to Heroes only)
- Budget constrained (concentrate on proven winners)
