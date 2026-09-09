# Complete Advantage+ Feature Matrix

## Overview

This reference covers every Advantage+ feature in Meta's advertising platform as of March 2026, organized by category with applicability guidance.

---

## Campaign-Level Features

### Advantage+ Shopping Campaign (ASC) / Unified Advantage+

| Attribute | Details |
|-----------|---------|
| **What it does** | Fully automated campaign type: Meta controls targeting, placement, bidding, and budget allocation |
| **Available for** | Sales, App Installs (unified in v25.0) |
| **Budget level** | Campaign only (no ad set budgets) |
| **Minimum creative** | 5 (legacy ASC), 3 (unified A+) |
| **Targeting control** | Country-level geo only + existing customer cap |
| **Best for** | E-commerce, high-volume conversion campaigns, accounts with 50+ weekly conversions |
| **Not recommended for** | Special ad categories, niche B2B, geo-restricted, nascent accounts |
| **Typical performance** | 15-20% lower CPA vs manual campaigns for mature accounts |

### Advantage+ App Campaign

| Attribute | Details |
|-----------|---------|
| **What it does** | Fully automated campaign for app install and in-app events |
| **Status** | Being unified into Advantage+ campaigns in v25.0 |
| **Migration deadline** | May 19, 2026 |
| **Best for** | App developers with sufficient install volume (50+ installs/week) |

---

## Ad Set-Level Features

### Advantage+ Audience

| Attribute | Details |
|-----------|---------|
| **What it does** | Replaces traditional detailed targeting. Your targeting inputs become "suggestions" the algorithm uses as starting signals, not restrictions |
| **How it differs from legacy** | Legacy: interests/behaviors are hard restrictions. A+ Audience: they're directional suggestions the algorithm may expand beyond |
| **Inputs you can provide** | Custom Audiences, Lookalike seeds, interests, demographics, locations |
| **How expansion works** | Meta uses your suggestions to understand the type of user you want, then finds additional users who match the pattern |
| **Control level** | Low-Medium (you influence direction, Meta decides reach) |
| **Best for** | Most campaigns, especially with 200+ monthly conversions |
| **Not recommended for** | Very narrow B2B (<100K TAM), special ad categories requiring strict targeting |
| **Location handling** | Geographic targeting is respected more strictly than other suggestions |

### Advantage+ Placements

| Attribute | Details |
|-----------|---------|
| **What it does** | Automatically distributes ads across all available placements (Feed, Stories, Reels, Right Column, Audience Network, etc.) |
| **Default** | ON by default for new ad sets |
| **How it works** | Meta's algorithm bids across all placements and allocates budget to where it finds the cheapest effective impressions |
| **Performance benefit** | 10-15% lower CPA on average vs manual placement selection |
| **When to override** | Video-only campaigns, Stories-specific creative, Audience Network exclusion, desktop-only products |
| **Creative requirement** | Provide multiple aspect ratios (1:1, 4:5, 9:16) for best results |

### Advantage Detailed Targeting

| Attribute | Details |
|-----------|---------|
| **What it does** | Expands your detailed targeting (interests/behaviors) beyond your selections to reach additional users likely to convert |
| **Status** | Being replaced by Advantage+ Audience in most new ad sets |
| **Default** | ON by default for conversion-optimized campaigns |
| **How it differs from A+ Audience** | A+ Detailed Targeting is a toggle on existing targeting; A+ Audience is a full replacement of the targeting system |
| **When to disable** | If expansion CPA is significantly worse than core audience CPA (check Delivery Insights) |

### Advantage Lookalike

| Attribute | Details |
|-----------|---------|
| **What it does** | Allows Meta to expand beyond your selected lookalike percentage to find additional convertible users |
| **Example** | You select 1% lookalike; Meta may expand to 3-5% if it finds efficient conversions there |
| **Default** | ON for most new ad sets |
| **When to disable** | If you need strict audience control or are testing lookalike sizes specifically |

---

## Ad-Level Features

### Advantage+ Creative

A suite of automatic enhancements applied at the ad level:

| Enhancement | What It Does | Default | When to Disable |
|-------------|-------------|---------|-----------------|
| **Standard enhancements** | Adjusts brightness, contrast, aspect ratio, and adds minor design improvements | ON | Strict brand guidelines |
| **Image templates** | Adds colored borders, backgrounds, or frames to product images | OFF (opt-in) | Brand-sensitive campaigns |
| **Text improvements** | Optimizes text placement, emphasis, and formatting | ON | Legally reviewed copy |
| **Music** | Adds background music to videos in Stories/Reels | ON for Stories/Reels | Custom audio content |
| **3D animation** | Adds subtle motion effects to static images | OFF (opt-in) | Minimalist design |
| **Image cropping** | Auto-crops images to fit different placement aspect ratios | ON | Carefully composed imagery |
| **Relevant comments** | Shows high-engagement comments on the ad | ON | Risk of negative comments |
| **Visual touchups** | Minor retouching (lighting, sharpness) | ON | Specific visual style |

**How to check what's being applied:**
- Ad level > Preview > "See variations" or "Creative variations"
- Ad level > Breakdown > By Dynamic Creative Element

### Flexible Ads (Replacing DCT)

| Attribute | Details |
|-----------|---------|
| **What it does** | Replaces Dynamic Creative Testing (DCT). Supply multiple images, videos, text variants, and CTAs. Meta assembles optimal combinations per user. |
| **Capacity** | Up to 10 images/videos, 5 primary texts, 5 headlines, 5 descriptions, 5 CTAs |
| **Reporting** | Per-element performance available (which image performed best, which text, etc.) |
| **Best for** | Rapid element-level testing when you have many variants |
| **Limitations** | Cannot see exact winning combinations, only element-level data |

---

## Catalog-Level Features

### Advantage+ Catalog Ads

| Attribute | Details |
|-----------|---------|
| **What it does** | Automatically selects and displays products from your catalog based on user behavior and predicted interest |
| **Modes** | Retargeting (show viewed/carted products) and Broad Audience (algorithmic product selection) |
| **Creative** | Auto-generated from catalog data (image, title, price, description) |
| **Enhancements** | Advantage+ Creative applies to catalog ads (borders, price overlays, etc.) |
| **Best for** | E-commerce with 50+ products, retargeting, broad prospecting |
| **Minimum catalog** | 4 products (50+ recommended for broad audience) |

---

## Feature Interaction Matrix

Some Advantage+ features work well together; others can conflict or create redundancy.

| Feature Combo | Compatibility | Notes |
|---------------|---------------|-------|
| ASC + A+ Audience | Built-in | ASC uses A+ Audience by default (no separate toggle) |
| ASC + A+ Placements | Built-in | ASC uses A+ Placements by default |
| ASC + A+ Creative | Recommended | Enable for best catalog and creative performance |
| A+ Audience + A+ Placements | Recommended | Standard combination for most campaigns |
| A+ Audience + Manual Placements | Works | Use when you need placement control with algorithmic targeting |
| A+ Creative + Strict Brand | Not recommended | Auto-enhancements may violate brand guidelines |
| A+ Catalog + ASC | Recommended | Hybrid approach: standard creative + catalog in same ASC |
| A+ Catalog + Manual Targeting | Works | Use for retargeting with specific audience control |

---

## Feature Availability by Campaign Objective

| Feature | Sales | Leads | Traffic | Awareness | App Installs | Engagement |
|---------|-------|-------|---------|-----------|-------------|------------|
| ASC / Unified A+ | Yes | Limited | No | No | Yes (unified) | No |
| A+ Audience | Yes | Yes | Yes | Yes | Yes | Yes |
| A+ Placements | Yes | Yes | Yes | Yes | Yes | Yes |
| A+ Creative | Yes | Yes | Yes | Yes | Yes | Yes |
| A+ Catalog | Yes | No | Yes | No | No | No |
| Flexible Ads | Yes | Yes | Yes | Yes | Yes | Yes |

---

## Performance Benchmarks by Feature

| Feature | Typical Performance Impact | Confidence Level |
|---------|---------------------------|-----------------|
| ASC vs Manual (Sales) | -15-20% CPA | High (large sample) |
| A+ Audience vs Manual Targeting | -10-15% CPA | Medium-High |
| A+ Placements vs Manual | -10-15% CPA | High |
| A+ Creative (standard) | -5-10% CPA | Medium |
| A+ Catalog (retargeting) | -10-20% CPA vs static retargeting | High |
| A+ Catalog (broad) | -5-15% CPA vs manual prospecting | Medium |
| Flexible Ads vs Single Ad | -5-15% CPA (when sufficient variants provided) | Medium |

**Note:** These benchmarks represent averages across Meta's advertiser base. Individual results vary significantly based on account maturity, creative quality, and vertical.
