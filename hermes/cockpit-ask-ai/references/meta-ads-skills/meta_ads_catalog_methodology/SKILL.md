---
name: catalog_methodology
description: Product catalog and dynamic product ads (DPA) framework for Meta Ads. Covers catalog setup, feed optimization, product set strategies, Advantage+ Catalog Ads, and catalog-driven retargeting. Referenced by analyze-catalog action skill.
---

# Catalog Methodology

## Purpose

This skill defines the complete framework for product catalog management and dynamic product advertising on Meta. Catalogs are the backbone of performance-driven ecommerce advertising. Unlike static creative, catalog ads are assembled dynamically from your feed data, which means feed quality equals ad quality. A poorly optimized feed with great targeting still produces mediocre ads. This framework covers catalog architecture, feed optimization at the field level, product tier classification, Advantage+ Catalog Ads, and retargeting funnel strategy.

## Core Framework: The Catalog Stack

```
Layer 1: Catalog Architecture
  └── Catalog structure, product sets, data sources, feed scheduling

Layer 2: Feed Quality
  └── Field completeness, title optimization, image quality, custom labels

Layer 3: Product Classification
  └── Heroes / Sidekicks / Zombies / Villains tier system

Layer 4: Campaign Strategy
  └── Advantage+ Catalog Ads, retargeting funnels, product set targeting

Layer 5: Ongoing Optimization
  └── Feed health monitoring, tier rebalancing, seasonal adjustments
```

---

## 1. Catalog Structure

### Hierarchy

```
Commerce Manager
└── Catalog
    ├── Data Sources (feeds)
    │   ├── Primary feed (scheduled upload or API)
    │   └── Supplemental feeds (overrides for specific fields)
    ├── Product Sets
    │   ├── All Products
    │   ├── Best Sellers (custom label or rule-based)
    │   ├── Category-specific sets
    │   ├── Price-tier sets
    │   └── Exclusion sets (Villains, out-of-stock)
    └── Products
        └── Individual SKUs with all feed fields
```

### Data Sources

| Source Type | Best For | Update Frequency | Complexity |
|-------------|----------|-----------------|-----------|
| Scheduled feed (CSV/XML/TSV) | Most businesses, batch updates | Every 1-24 hours | Low |
| Direct API (Catalog Batch API) | Real-time inventory, large catalogs | Real-time or near-real-time | High |
| Partner platform (Shopify, WooCommerce, BigCommerce) | Native integrations, automatic sync | Varies (typically hourly) | Low |
| Google Sheets | Small catalogs (<1,000 products) | Manual or scheduled | Very low |

**Feed scheduling best practices:**
- Update at minimum once per day (twice recommended for fast-moving inventory)
- Schedule updates during off-peak hours (avoid feed processing during high-traffic periods)
- Set up feed error alerts in Commerce Manager
- Monitor the "Data Sources" tab for ingestion failures

### Supplemental Feeds

Supplemental feeds override specific fields in the primary feed without replacing the entire catalog. Use them for:

- **Custom labels:** Add segmentation labels (e.g., margin tier, seasonal flag, hero product) without modifying the primary feed
- **Price overrides:** Flash sales or regional pricing
- **Title/description optimization:** A/B test optimized titles without changing your primary product data
- **Image overrides:** Test lifestyle images vs product shots for specific SKUs

**Rules:**
- Supplemental feeds match on `id` field (must match primary feed product IDs exactly)
- Fields in the supplemental feed override the same field in the primary feed
- If a field is blank in the supplemental feed, the primary feed value is retained
- Multiple supplemental feeds are processed in order (last one wins for conflicting fields)

---

## 2. Feed Requirements and Optimization

### Required Fields

Every product in the catalog must have these fields populated:

| Field | Type | Requirements | Example |
|-------|------|-------------|---------|
| `id` | String | Unique per product, stable over time, max 100 chars | `SKU-12345` |
| `title` | String | Max 200 chars, descriptive, searchable | `Nike Dri-FIT Men's Running Shirt - Royal Blue - Large` |
| `description` | String | Max 9999 chars, features and benefits | Detailed product description with key selling points |
| `availability` | Enum | `in stock`, `out of stock`, `preorder`, `available for order` | `in stock` |
| `condition` | Enum | `new`, `refurbished`, `used` | `new` |
| `price` | String | Format: `29.99 USD` (number + ISO 4217 currency code) | `49.99 USD` |
| `image_link` | URL | Min 600x600px, max 8MB, JPEG/PNG/GIF | `https://example.com/imagesproduct_12345.jpg` |
| `link` | URL | Product page URL, must be accessible and match ad domain | `https://example.com/productrunning_shirt_blue` |

### Recommended Fields

| Field | Purpose | Impact on Performance |
|-------|---------|----------------------|
| `brand` | Brand name for filtering and display | High for brand-conscious categories |
| `product_type` | Your own categorization | Medium, improves product set rules |
| `google_product_category` | Standardized taxonomy | Medium, improves Meta's categorization |
| `sale_price` | Strikethrough pricing in ads | High, sale price overlay drives 10-20% higher CTR |
| `additional_image_link` | Up to 10 additional images | Medium, carousel and collection ads |
| `custom_label_0` through `custom_label_4` | Freeform labels for segmentation | High, enables Hero/Villain product sets |
| `gender` | Target gender | Medium for apparel |
| `age_group` | Target age range | Medium for age-specific products |
| `color` | Product color | Low-medium, used in variant grouping |
| `size` | Product size | Low-medium, used in variant grouping |
| `item_group_id` | Groups product variants | Medium, prevents variant cannibalization |
| `shipping` | Shipping cost and speed | Medium, free shipping drives conversions |

### Title Optimization

Titles are the single most impactful field for catalog ad performance. Meta uses titles for matching, relevance scoring, and the text overlay on dynamic ads.

**Title formula:** `[Brand] + [Product Type] + [Key Attribute] + [Differentiator]`

| Quality Level | Example | CTR Impact |
|---------------|---------|-----------|
| Poor | "Blue Shirt" | Baseline (lowest) |
| Acceptable | "Nike Running Shirt - Blue" | +10-15% vs poor |
| Good | "Nike Dri-FIT Men's Running Shirt - Royal Blue - Size L" | +20-30% vs poor |
| Excellent | "Nike Dri-FIT Running Shirt | Moisture-Wicking | Royal Blue | Large" | +30-40% vs poor |

**Title rules:**
- Front-load the most important information (brand, product type)
- Include the primary keyword users would search for
- Avoid ALL CAPS, excessive punctuation, or promotional language ("BEST DEAL!!!")
- Keep under 150 characters (titles truncate in most placements)
- Use pipe `|` or dash `-` as separators, not commas
- Include size, color, and material where relevant

### Image Optimization

| Requirement | Specification | Notes |
|-------------|--------------|-------|
| Minimum resolution | 600x600px | 1200x1200px recommended for retina displays |
| Maximum file size | 8MB | Aim for <2MB for fast loading |
| Format | JPEG, PNG, GIF (static only) | JPEG preferred for photos, PNG for graphics |
| Aspect ratio | 1:1 (square) default | 4:5 for Feed placement optimization |
| Background | Clean white or lifestyle context | White for product comparison, lifestyle for consideration |
| Product fill | Product should fill 75%+ of the frame | Small products in large frames get lost in feed |
| Text on image | Avoid text overlays in feed images | Meta may deprioritize images with >20% text |
| Multiple images | Up to 10 via `additional_image_link` | Use for: angles, lifestyle, scale, detail shots |

### Custom Labels Strategy

Custom labels (`custom_label_0` through `custom_label_4`) are the most powerful segmentation tool in catalog management. Use them to create product sets that align with your business strategy.

**Recommended custom label allocation:**

| Label | Purpose | Example Values |
|-------|---------|---------------|
| `custom_label_0` | Performance tier | `hero`, `sidekick`, `zombie`, `villain` |
| `custom_label_1` | Margin tier | `high_margin`, `medium_margin`, `low_margin` |
| `custom_label_2` | Seasonality | `evergreen`, `spring_2026`, `holiday_2026` |
| `custom_label_3` | Promotion status | `full_price`, `on_sale`, `clearance` |
| `custom_label_4` | Strategic priority | `new_launch`, `hero_candidate`, `end_of_life` |

**Update cadence:**
- Performance tier: weekly (based on last 30 days of ad data)
- Margin tier: monthly or when pricing changes
- Seasonality: quarterly
- Promotion status: as promotions change
- Strategic priority: as business priorities shift

---

## 3. Product Tier Classification

The tier system classifies every product based on spend allocation and return, creating a shared language between media buyers and merchandising teams.

### The Four Tiers

```
                    High ROAS
                       |
         Sidekicks     |     Heroes
        (Low spend,    |    (High spend,
         high ROAS)    |     high ROAS)
                       |
    -------------------+-------------------
                       |
         Zombies       |     Villains
        (Low spend,    |    (High spend,
         low ROAS)     |     low ROAS)
                       |
                    Low ROAS
```

| Tier | Spend | ROAS | Typical % of Catalog | Strategic Action |
|------|-------|------|---------------------|-----------------|
| **Heroes** | Top 20% | Above target | ~20% | Protect and scale. Ensure stock. Increase bids. Feature in static ads. |
| **Sidekicks** | Bottom 80% | Above target | ~30% | Promote more. Test in dedicated product sets. Improve feed data to unlock more impressions. |
| **Zombies** | Bottom 80% | Below target or zero | ~40% | Investigate feed quality. Improve titles and images. If no improvement after 30 days, suppress from broad sets. |
| **Villains** | Top 20% | Below target | ~10% | Reduce spend immediately. Exclude from broad product sets. Diagnose root cause (price? image? landing page? wrong audience?). |

### Classification Thresholds

- **"High spend"** = above median spend per product in the analysis period
- **"High ROAS"** = above the account's target ROAS (from account-conventions)
- **Zero spend products** = default to Zombies (they may have feed issues preventing delivery)
- **Low confidence flag** = fewer than 5 conversions in the analysis period (classification is directional only)

### Tier Actions in Detail

**Heroes (protect and scale):**
1. Ensure always in stock (coordinate with inventory/merchandising)
2. Dedicate budget via a "Best Sellers" product set
3. Use as creative in static campaigns (not just DPA)
4. Monitor for fatigue (declining CTR or ROAS over 4+ weeks)
5. Test price elasticity (can you increase price without losing volume?)

**Sidekicks (promote):**
1. Move into a "Rising Stars" product set with dedicated budget
2. Improve feed data (better titles, more images, sale price if applicable)
3. Test with higher bids to see if more spend unlocks proportional returns
4. Some Sidekicks are Heroes waiting for more budget

**Zombies (fix or suppress):**
1. Audit feed quality: are titles descriptive? Images high quality? Price competitive?
2. Check availability: are they out of stock or showing as unavailable?
3. Look for category issues: is the product miscategorized, causing poor matching?
4. Give 30 days after feed fixes to reassess
5. If still zero/low performance after fixes, suppress from broad sets

**Villains (reduce and diagnose):**
1. Exclude from broad product sets immediately (stop the bleeding)
2. Diagnose why ROAS is low:
   - Price too high vs competitors?
   - Poor landing page experience?
   - Wrong audience seeing the product?
   - Low product-market fit?
3. If product is strategic (new launch, anchor product), fix the underlying issue before re-enabling
4. If product is not strategic, permanently suppress

---

## 4. Advantage+ Catalog Ads

### What They Are

Advantage+ Catalog Ads (formerly Dynamic Product Ads / DPA) automatically show the right products to the right people based on their behavior and Meta's machine learning. The creative is assembled dynamically from your catalog feed.

### How They Work

```
User browses your site --> Pixel/CAPI captures ViewContent, AddToCart events
                           |
                           v
Meta matches user to their Meta profile
                           |
                           v
Advantage+ selects products from your catalog
  - Products the user viewed (retargeting)
  - Products similar to what the user viewed (prospecting)
  - Products Meta predicts will convert based on similar users
                           |
                           v
Ad is assembled: product image + title + price + CTA from your feed
                           |
                           v
Delivered across all placements (Feed, Stories, Reels, AN, etc.)
```

### Campaign Types

| Type | Audience | Product Selection | Best For |
|------|----------|------------------|----------|
| Retargeting (DABA) | Users who visited your site | Products they viewed or added to cart | Bottom-funnel conversion, highest ROAS |
| Broad Audience (DABA) | Users who haven't visited your site | Products Meta predicts they'll buy | Prospecting, catalog-driven acquisition |
| Advantage+ Shopping (ASC) | Automated (mix of retargeting + prospecting) | Fully automated | Simplicity, Meta controls audience split |

### Advantage+ Catalog Creative Options

| Feature | Description | When to Use |
|---------|------------|-------------|
| Single image | One product per ad impression | Default for most placements |
| Carousel | Multiple products in swipeable format | Large catalogs, cross-sell |
| Collection | Cover image + product grid | Brand storytelling + product discovery |
| Dynamic creative | Meta tests combinations of images, titles, descriptions | When you have multiple images per product |
| Catalog video | Auto-generated video from product images | Stories and Reels placements |

### Optimization Signals

Advantage+ Catalog Ads optimize based on:
1. **User behavior:** ViewContent, AddToCart, Purchase history
2. **Product performance:** Historical CTR, conversion rate, ROAS per product
3. **Audience signals:** Demographics, interests, lookalike patterns
4. **Catalog freshness:** Recently updated products may get a boost
5. **Price signals:** Products with sale_price overlay tend to get higher engagement

---

## 5. Catalog Retargeting Strategy

### The Retargeting Funnel

```
ViewContent --> AddToCart --> InitiateCheckout --> Purchase
   |               |               |                |
   |               |               |                └── Exclude (already purchased)
   |               |               └── Retarget within 3 days (urgency)
   |               └── Retarget within 7 days (reminder + incentive)
   └── Retarget within 14 days (discovery reinforcement)
```

### Retargeting Windows

| Audience | Window | Creative Strategy | Expected ROAS |
|----------|--------|------------------|---------------|
| Viewed product, no cart | 1-14 days | Show viewed products + similar items | 3-5x |
| Added to cart, no purchase | 1-7 days | Show carted products, urgency messaging | 5-10x |
| Initiated checkout, no purchase | 1-3 days | Show exact products, strong CTA, offer if needed | 8-15x |
| Purchased | Exclude from retargeting OR cross-sell after 14+ days | Cross-sell complementary products | 2-4x |

### Retargeting Best Practices

1. **Frequency control:** Cap retargeting frequency at 3-5 impressions per 7 days. Beyond this, you're annoying users, not converting them.
2. **Window overlap:** Ensure retargeting windows don't overlap (e.g., 0-7 day ATC retargeting and 0-14 day VC retargeting will overlap for ATC users). Use exclusions.
3. **Creative rotation:** Even in DPA, creative fatigue is real. Use catalog video, carousel, and collection formats to vary the experience.
4. **Incentive ladder:** No discount for VC retargeting -> small incentive (free shipping) for ATC -> stronger incentive (% off) for abandoned checkout.
5. **Cross-sell:** After purchase, wait 14+ days, then retarget with complementary products (not the same product they already bought).

---

## 6. Feed Health Metrics

### Key Health Indicators

| Metric | Healthy | Warning | Critical |
|--------|---------|---------|----------|
| Field completeness (required) | 100% | 95-99% | <95% |
| Field completeness (recommended) | >80% | 50-80% | <50% |
| Product disapproval rate | <2% | 2-5% | >5% |
| Out-of-stock rate | <10% | 10-20% | >20% |
| Feed update freshness | <24 hours | 24-48 hours | >48 hours |
| Image quality pass rate | >90% | 70-90% | <70% |
| Title quality score | >7/10 | 5-7/10 | <5/10 |
| Price accuracy | 100% match to site | 95-99% match | <95% match |

### Monitoring Cadence

| Check | Frequency | Tool |
|-------|-----------|------|
| Feed ingestion success | Daily (automated alert) | Commerce Manager |
| Product disapprovals | Weekly | Commerce Manager > Diagnostics |
| Field completeness | Monthly | Feed audit (manual or automated) |
| Title and image quality | Monthly | Sample review of 50+ products |
| Tier rebalancing | Bi-weekly | Performance data + custom label update |
| Competitive price check | Monthly | Manual or price intelligence tool |

---

## 7. Cross-Border Catalogs

### Multi-Country Setup

For advertisers selling in multiple markets:

| Approach | How It Works | Best For |
|----------|-------------|----------|
| Single catalog, multi-currency | One feed with prices in multiple currencies via `price` and `override` columns | Small catalog, few markets |
| Multiple catalogs | Separate catalog per market with localized data | Large catalogs, significant localization needs |
| Feed rules | Transform a single feed using Commerce Manager rules (currency conversion, language) | Medium complexity, moderate localization |

### Localization Requirements

- **Currency:** Prices must match the currency of the target market
- **Language:** Titles and descriptions should be in the target market's language
- **Availability:** Inventory must reflect actual availability in the target market
- **Shipping:** Shipping information must be accurate for the target market
- **Compliance:** Product availability may vary by market (regulatory restrictions)

---

## Quick Reference: Catalog Optimization Priorities

| Priority | Action | Expected Impact | Effort |
|----------|--------|----------------|--------|
| P0 | Fix disapproved products | Recover lost impressions immediately | Low |
| P0 | Update out-of-stock products | Stop wasting spend on unavailable items | Low |
| P1 | Optimize titles (top 100 products first) | +15-25% CTR improvement | Medium |
| P1 | Add custom labels for tier segmentation | Enable Hero/Villain product sets | Medium |
| P1 | Implement sale_price for promotional items | +10-20% CTR from price overlay | Low |
| P2 | Add additional images (3+ per product) | +5-10% engagement in carousels | High |
| P2 | Optimize descriptions | Marginal CTR impact, better landing page alignment | Medium |
| P2 | Set up supplemental feed for A/B testing | Test title and image variations | Medium |
| P3 | Cross-border catalog setup | New market expansion | High |

---

## Reference Files

- `references/feed_optimization.md` - Field-by-field optimization guide with examples and character limits
