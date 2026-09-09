# Feed Optimization Guide

## Purpose

Field-by-field optimization guide for Meta product catalog feeds. Covers every required and recommended field with character limits, formatting rules, quality benchmarks, and examples. Use this alongside the catalog-methodology SKILL.md for complete context.

---

## Required Fields

### id

| Attribute | Value |
|-----------|-------|
| **Max length** | 100 characters |
| **Type** | String |
| **Required** | Yes |
| **Used in ads** | No (internal identifier) |

**Rules:**
- Must be unique across the entire catalog
- Must be stable (do not change the ID for the same product)
- Use your internal SKU, product ID, or variant ID
- If you use variant-level IDs (e.g., size/color combinations), each variant gets its own ID
- Avoid special characters except hyphens and underscores

**Good examples:** `SKU-12345`, `prod_abc_blue_lg`, `WP-9876`
**Bad examples:** `Blue Shirt`, `product 1`, `new!!item`

---

### title

| Attribute | Value |
|-----------|-------|
| **Max length** | 200 characters (150 recommended for display) |
| **Type** | String |
| **Required** | Yes |
| **Used in ads** | Yes (primary text on dynamic ads) |

**Optimization formula:** `[Brand] + [Product Type] + [Key Attribute] + [Size/Color]`

**Rules:**
- Front-load the most important words (brand, product type)
- Include the keyword a shopper would search for
- No ALL CAPS (Meta may deprioritize)
- No promotional text ("Sale!", "50% off!", "Best seller!")
- No excessive punctuation
- Use pipe `|` or dash `-` as separators
- Include size, color, and material when they differentiate the product

**Quality tiers:**

| Tier | Example | Why |
|------|---------|-----|
| Poor | "Shirt" | No brand, no attributes, not searchable |
| Below average | "Blue Running Shirt" | Missing brand, generic |
| Average | "Nike Running Shirt - Blue" | Has brand and color, but missing details |
| Good | "Nike Dri-FIT Men's Running Shirt - Royal Blue - Large" | Brand, product, material, color, size |
| Excellent | "Nike Dri-FIT Running Shirt | Moisture-Wicking | Royal Blue | Men's Large" | Optimized for scanning, includes benefit |

**Category-specific title patterns:**

| Category | Pattern | Example |
|----------|---------|---------|
| Apparel | Brand + Gender + Product + Material + Color + Size | Nike Women's Air Max 270 Running Shoe - Black/White - Size 8 |
| Electronics | Brand + Product + Key Spec + Model | Samsung Galaxy S24 Ultra 256GB - Titanium Gray |
| Home/Furniture | Brand + Product + Material + Dimensions + Color | West Elm Mid-Century Dining Table - Walnut - 72" |
| Beauty | Brand + Product + Type + Size | Clinique Moisture Surge 72-Hour Auto-Replenishing Hydrator - 50ml |
| Food/Beverage | Brand + Product + Variant + Size | Nespresso Vertuo Coffee Capsules - Stormio Blend - 30 Pack |

---

### description

| Attribute | Value |
|-----------|-------|
| **Max length** | 9,999 characters (first 200 visible in most placements) |
| **Type** | String |
| **Required** | Yes |
| **Used in ads** | Sometimes (dynamic creative, collection ads) |

**Rules:**
- First 200 characters are most important (visible in most ad formats)
- Lead with the primary benefit, not the feature
- Include 2-3 key features after the opening benefit statement
- Avoid HTML tags (stripped in ads)
- Avoid keyword stuffing
- Write for the shopper, not for SEO

**Structure:**
```
[Primary benefit sentence - 50-80 chars]
[Key feature 1] [Key feature 2] [Key feature 3]
[Materials/specs if relevant]
[Social proof or trust signal if available]
```

---

### availability

| Attribute | Value |
|-----------|-------|
| **Values** | `in stock`, `out of stock`, `preorder`, `available for order` |
| **Type** | Enum |
| **Required** | Yes |
| **Used in ads** | Yes (Meta filters out-of-stock by default) |

**Rules:**
- Must accurately reflect real-time inventory
- Out-of-stock products are automatically excluded from delivery (no wasted spend)
- If your inventory changes frequently, update the feed more often (hourly if possible)
- "preorder" allows ads but indicates the product isn't available yet
- "available for order" means in stock but with a shipping delay

**Common issues:**
- Feed shows "in stock" but product page shows "sold out" = ad disapproval risk
- Never set everything to "in stock" to bypass the filter; this wastes budget and frustrates users

---

### price

| Attribute | Value |
|-----------|-------|
| **Format** | `[number] [ISO 4217 currency code]` (e.g., `29.99 USD`) |
| **Type** | String |
| **Required** | Yes |
| **Used in ads** | Yes (displayed on dynamic ads) |

**Rules:**
- Must match the price on your landing page (Meta checks for price discrepancies)
- Use period `.` as decimal separator (not comma)
- Currency code must be ISO 4217 (USD, EUR, GBP, etc.)
- Do not include currency symbols ($, EUR, etc.) -- use the code only
- For free products, use `0.00 USD`
- Update whenever prices change (stale prices = ad disapprovals)

---

### image_link

| Attribute | Value |
|-----------|-------|
| **Min resolution** | 600x600px |
| **Recommended resolution** | 1200x1200px |
| **Max file size** | 8MB |
| **Formats** | JPEG, PNG, GIF (static only) |
| **Type** | URL |
| **Required** | Yes |
| **Used in ads** | Yes (primary visual) |

**Quality checklist:**
- [ ] Resolution at least 1200x1200px (for retina/high-DPI screens)
- [ ] Product fills 75%+ of the frame
- [ ] Clean, consistent background (white for product shots, contextual for lifestyle)
- [ ] No text overlays, watermarks, or promotional badges
- [ ] No placeholder images ("image coming soon")
- [ ] URL is accessible (no authentication required, no 404s)
- [ ] HTTPS URL (required)
- [ ] File loads within 3 seconds

---

### link

| Attribute | Value |
|-----------|-------|
| **Type** | URL |
| **Required** | Yes |
| **Used in ads** | Yes (click destination) |

**Rules:**
- Must point to the specific product page (not a category page or homepage)
- Must be accessible (no 404, no login required, no geoblock)
- Domain must match the domain verified in Business Manager
- HTTPS required
- Include UTM parameters in the URL template at the campaign level (not in the feed link)
- Product shown on the landing page must match the product in the feed

---

## Recommended Fields

### sale_price

| Attribute | Value |
|-----------|-------|
| **Format** | Same as price: `[number] [currency code]` |
| **Type** | String |
| **Required** | No |
| **Used in ads** | Yes (strikethrough pricing overlay) |

When `sale_price` is set and lower than `price`, Meta displays a strikethrough on the original price with the sale price highlighted. This drives 10-20% higher CTR in catalog ads.

**Rules:**
- Must be lower than `price` (otherwise ignored)
- Remove `sale_price` when the sale ends (stale sale prices = price discrepancy disapprovals)
- Use `sale_price_effective_date` to auto-schedule sale periods (format: `2026-03-01T00:00:00-05:00/2026-03-31T23:59:59-05:00`)

### additional_image_link

| Attribute | Value |
|-----------|-------|
| **Max images** | 10 per product |
| **Format** | Same as image_link |
| **Type** | URL (comma-separated for multiple) |
| **Required** | No |
| **Used in ads** | Yes (carousel, collection, dynamic creative) |

**Recommended image sequence:**
1. Primary product shot (clean, front-facing)
2. Product in use (lifestyle shot)
3. Detailclose_up (material, texture, features)
4. Scale shot (product in context, showing size)
5. Alternative angle (side, back, or open view)

### custom_label_0 through custom_label_4

| Attribute | Value |
|-----------|-------|
| **Max length** | 100 characters each |
| **Type** | String |
| **Required** | No |
| **Used in ads** | No (used for product set rules and reporting) |

Custom labels are freeform text fields used to segment products into product sets. They are the most powerful tool for catalog optimization because they let you apply business logic to your ad targeting.

**Recommended allocation:**

| Label | Recommended Use | Example Values | Update Frequency |
|-------|----------------|---------------|-----------------|
| `custom_label_0` | Performance tier | `hero`, `sidekick`, `zombie`, `villain` | Weekly |
| `custom_label_1` | Margin tier | `high_margin`, `medium_margin`, `low_margin` | Monthly |
| `custom_label_2` | Seasonality | `evergreen`, `spring`, `summer`, `holiday` | Quarterly |
| `custom_label_3` | Promotion status | `full_price`, `on_sale`, `clearance` | As needed |
| `custom_label_4` | Strategic tag | `new_launch`, `best_seller`, `end_of_life` | As needed |

### brand

| Attribute | Value |
|-----------|-------|
| **Max length** | 100 characters |
| **Type** | String |
| **Required** | No (strongly recommended) |
| **Used in ads** | Sometimes (brand overlay in some formats) |

Essential for multi-brand retailers. Enables brand-specific product sets and filtering.

### product_type

| Attribute | Value |
|-----------|-------|
| **Max length** | 750 characters |
| **Type** | String (hierarchical, separated by ` > `) |
| **Required** | No (recommended) |
| **Used in ads** | No (used for product set rules) |

Your own categorization taxonomy. Example: `Apparel > Men's > Shirts > Running`.

### google_product_category

| Attribute | Value |
|-----------|-------|
| **Type** | String or numeric ID from Google's taxonomy |
| **Required** | No (recommended) |
| **Used in ads** | No (used by Meta for categorization) |

Use Google's product taxonomy for standardized categorization. Full list: google.com/basepages/producttype/taxonomy.

---

## Feed Health Scoring

### Field Completeness Score

Calculate the percentage of products with each field populated:

| Field | Weight | Target | Score Formula |
|-------|--------|--------|--------------|
| id | 10% | 100% | (populated / total) x weight |
| title | 15% | 100% | |
| description | 10% | 100% | |
| availability | 10% | 100% | |
| price | 10% | 100% | |
| image_link | 15% | 100% | |
| link | 10% | 100% | |
| brand | 5% | >90% | |
| sale_price | 5% | Where applicable | |
| custom_label_0 | 5% | >80% | |
| additional_image_link | 5% | >50% | |

### Title Quality Score

Sample 50+ product titles and score each on:

| Criterion | Points | Evaluation |
|-----------|--------|-----------|
| Includes brand name | 2 | Yes/No |
| Includes product type | 2 | Yes/No |
| Includes key differentiator (material, feature) | 2 | Yes/No |
| Includes size/color/variant | 1 | Yes/No |
| Under 150 characters | 1 | Yes/No |
| No ALL CAPS or excessive punctuation | 1 | Yes/No |
| Uses clean separators (pipe or dash) | 1 | Yes/No |
| **Total** | **10** | |

Average the scores across the sample for an overall title quality score.

### Image Quality Score

Sample 50+ product images and score each on:

| Criterion | Points | Evaluation |
|-----------|--------|-----------|
| Resolution >= 1200x1200px | 2 | Yes/No |
| Product fills 75%+ of frame | 2 | Yes/No |
| Clean, consistent background | 2 | Yes/No |
| No text overlays or watermarks | 2 | Yes/No |
| No placeholder images | 1 | Yes/No |
| Loads within 3 seconds | 1 | Yes/No |
| **Total** | **10** | |

---

## Common Feed Issues and Fixes

| Issue | Impact | Frequency | Fix |
|-------|--------|-----------|-----|
| Truncated titles | Key info cut off in ads | Common | Restructure titles to front-load important info |
| Missing brand in title | Lower relevance matching | Common | Add brand as first word in title |
| Low-res images | Lower CTR, higher CPC | Common | Replace with 1200x1200px minimum |
| Stale sale_price | Price discrepancy disapproval | Moderate | Automate sale_price removal when promotions end |
| Out-of-stock not updated | Wasted ad spend, poor UX | Moderate | Increase feed refresh frequency to hourly |
| Missing custom labels | Cannot segment product sets | Common | Implement custom label strategy from catalog-methodology |
| Inconsistent formatting | Unprofessional appearance in ads | Common | Standardize title patterns per category |
| Broken image URLs | Product shows no image in ad | Rare but critical | Monitor feed diagnostics daily, fix 404s immediately |
| Price format errors | Products rejected from catalog | Moderate | Validate: number + space + ISO 4217 code |
| HTML in descriptions | Raw tags visible in ads | Moderate | Strip HTML before feed submission |
