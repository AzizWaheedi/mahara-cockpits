---
name: advantage_plus_methodology
description: Comprehensive framework for Meta's Advantage+ suite including Advantage+ Shopping Campaigns (ASC), Advantage+ Audience, Advantage+ Creative, and the unified Advantage+ campaigns migration (v25.0). Covers when to use each feature, optimization strategies, and the May 2026 migration deadline. Referenced by analyze-advantage-plus action skill.
---

# Advantage+ Methodology

## Purpose

This skill encodes the complete framework for Meta's Advantage+ product suite as of March 2026. Advantage+ represents Meta's shift toward AI-driven campaign management, where the advertiser supplies creative and business constraints while Meta's algorithms handle targeting, placement, and optimization. Understanding when to leverage, constrain, or avoid these features is critical for modern Meta Ads management.

## The Advantage+ Landscape (March 2026)

Meta's Advantage+ suite has evolved significantly. The key development is the v25.0 API migration, which unifies legacy campaign types into a single Advantage+ framework. Media buyers need to understand both the current state and the migration path.

### Product Matrix

| Feature | What It Does | Replaces | Status |
|---------|-------------|----------|--------|
| Advantage+ Shopping Campaigns (ASC) | Fully automated shopping campaigns | Manual shopping campaigns | Active, migrating to unified |
| Advantage+ App Campaigns | Fully automated app install campaigns | Manual app campaigns | Active, migrating to unified |
| Advantage+ Audience | AI-powered audience expansion using "suggestions" | Detailed Targeting (interests, behaviors) | Active, recommended default |
| Advantage+ Creative | Auto-enhancements to ad creative | Manual creative optimization | Active |
| Advantage+ Placements | Algorithmic placement selection | Manual placement selection | Active, default on |
| Advantage+ Catalog Ads | Dynamic product selection from catalog | Dynamic Product Ads (DPA) | Active |
| Unified Advantage+ Campaigns | Single campaign type replacing ASC + App | ASC and App campaigns separately | Rolling out, mandatory by May 19, 2026 |

---

## 1. Advantage+ Shopping Campaigns (ASC)

### How ASC Works

ASC is Meta's fully automated campaign type for performance advertisers. You provide:
- Creative (minimum 5, recommended 10-20)
- Budget
- Geographic targeting (country-level)
- Existing customer definition
- Optimization event (Purchase, Lead, etc.)

Meta handles everything else: audience selection, placement, bid optimization, budget allocation across audiences.

### ASC Architecture

```
ASC Campaign
├── Budget (campaign level only, no ad set budgets)
├── Existing Customer Cap (0-100%)
├── Country Targeting
├── Optimization Event
└── Ad Set (single, auto-managed)
    ├── Creative 1
    ├── Creative 2
    ├── ...
    └── Creative N (minimum 5, recommend 10-20)
```

### When to Use ASC

**Best suited for:**
- E-commerce with product catalog (the original use case)
- High-volume conversion campaigns (50+ conversions/week)
- Accounts with 20+ proven creative assets
- Advertisers comfortable ceding targeting control
- Mature accounts with sufficient pixel data (1,000+ pixel events in 30 days)

**Performance benchmarks:**
- ASC typically delivers 15-20% lower CPA vs manual campaigns for mature accounts
- First 7 days may show higher CPA as the system learns (normal)
- Accounts with strong creative libraries see the best results
- At $10K+/day spend, ASC often becomes the primary campaign type

### ASC Setup Best Practices

**Creative requirements:**
- Minimum 5 creatives per ASC (Meta's hard minimum)
- Recommended 10-20 creatives for optimal performance
- Mix of formats: static images, videos, carousels, UGC
- Include both prospecting-oriented and retargeting-oriented creative
- Refresh 20-30% of creative every 2 weeks

**Existing Customer Cap:**
- This is the maximum percentage of budget Meta can allocate to existing customers
- Set 0% for pure new customer acquisition (rare -- typically too restrictive)
- Set 10-20% for primarily prospecting campaigns (recommended default)
- Set 50%+ for balanced prospecting/retention
- Set 100% to let Meta fully optimize (not recommended -- will over-index on easy re-conversions)
- Define "existing customers" using: purchase pixel data, customer list, app activity

**Existing customer definition:**
- Upload your customer list (email + phone) as a Custom Audience
- Include all purchasers from the last 180 days minimum
- Update the list at least monthly (weekly for high-volume)
- Without a proper existing customer definition, Meta cannot distinguish new vs returning customers

**Budget:**
- Start with your total prospecting + retargeting budget (ASC handles both)
- ASC uses campaign-level budget only (no ad set budgets)
- Minimum recommended: enough for 50 optimization events per week
- Scale by 20% every 3-5 days once CPA stabilizes

**Geographic targeting:**
- Country-level targeting only (no state, city, or ZIP)
- For multi-country: create separate ASC campaigns per country or region
- Cannot exclude specific regions within a country

### ASC Optimization

**Week 1-2 (Learning):**
- Do not make changes during the first 7 days
- CPA will likely be elevated -- this is normal exploration
- Monitor but don't judge until you have 50+ conversions

**Week 2-4 (Stabilization):**
- Evaluate CPA trend (should be declining)
- If CPA is above target after 50+ conversions: check creative quality first
- Add 3-5 new creatives if initial set is fatiguing
- Adjust existing customer cap if needed

**Month 2+ (Optimization):**
- Rotate creative regularly (20-30% new every 2 weeks)
- Monitor existing vs new customer split in Delivery Insights
- If CPA creeps up: creative fatigue is the most likely cause
- Test lowering existing customer cap if new customer acquisition costs are rising

### ASC Limitations

- Cannot use Custom Audiences for targeting (only for existing customer definition)
- No lookalike audiences
- No interest or behavior targeting
- Country-level geo only
- Single optimization event per campaign
- Cannot set ad set-level budgets
- Limited breakdown data compared to manual campaigns

---

## 2. v25.0 Migration: Unified Advantage+ Campaigns

### What's Changing

Meta is consolidating campaign types under the Advantage+ umbrella. Starting with API v25.0:

- Legacy ASC campaigns and Advantage+ App campaigns are being unified into a single "Advantage+ Campaign" type
- The new unified type combines the automation of ASC with more flexible controls
- **Deadline: May 19, 2026** -- legacy ASC and App campaigns can no longer be created after this date
- Existing legacy campaigns will continue to deliver but cannot be duplicated or significantly edited

### Migration Timeline

| Date | Action Required |
|------|----------------|
| January 2026 | v25.0 API released with unified campaign type |
| March 2026 (now) | Begin testing unified Advantage+ alongside legacy ASC |
| April 2026 | Migrate high-performing ASC campaigns to unified format |
| May 19, 2026 | Legacy ASC and App campaign creation disabled |
| Q3 2026 (expected) | Legacy campaigns deprecated entirely (deliver only) |

### Key Differences: Unified vs Legacy ASC

| Feature | Legacy ASC | Unified Advantage+ |
|---------|-----------|-------------------|
| Audience inputs | None (fully automated) | "Audience suggestions" (optional signals) |
| Geo targeting | Country only | Country, with regional suggestions possible |
| Existing customer cap | Yes (0-100%) | Yes, enhanced controls |
| Ad format support | All standard formats | All formats + Advantage+ Catalog |
| Optimization events | Single event | Multiple events with priority ordering |
| Creative enhancements | Basic | Full Advantage+ Creative suite |
| Reporting | Limited breakdowns | Enhanced delivery insights |
| Minimum creative | 5 | 3 (lowered threshold) |

### Migration Playbook

1. **Audit current ASC campaigns** -- list all active ASC campaigns, their budgets, CPA, and creative counts
2. **Create parallel unified campaigns** -- mirror each ASC campaign in the unified format with the same creative and budget
3. **Run both simultaneously for 14 days** -- split budget 50/50 or use a holdout test
4. **Compare performance** -- evaluate CPA, conversion volume, and new customer acquisition
5. **Shift budget to the winner** -- in most cases, unified campaigns perform equal to or better than legacy
6. **Decommission legacy campaigns** -- pause legacy ASC campaigns before the May 19 deadline
7. **Document learnings** -- record any performance differences for future optimization

### Migration Risks

- Learning phase reset: new campaigns will re-enter learning (plan for 50+ conversion ramp)
- Creative reset: winning ads lose accumulated optimization data (use Post ID method to preserve social proof)
- Reporting disruption: historical data remains in legacy campaigns, new campaigns start fresh
- Automation differences: unified campaigns may allocate budget differently than legacy ASC

---

## 3. Advantage+ Audience

### How It Works

Advantage+ Audience replaced the traditional detailed targeting system. Instead of selecting interests and behaviors as hard restrictions, you provide "audience suggestions" that Meta's algorithm uses as starting signals. The algorithm then expands beyond your suggestions to find additional high-probability converters.

**Key shift in mental model:**
- Old model: "Show my ads to people who like X, Y, Z" (restrictions)
- New model: "People who like X, Y, Z are a good starting point" (suggestions)

### Suggestion Types

| Suggestion Type | What to Provide | How Meta Uses It |
|----------------|-----------------|------------------|
| Custom Audiences | Existing customer lists, website visitors, app users | Seeds the algorithm with known converters |
| Lookalike seeds | Source audience for expansion | Finds statistically similar users |
| Interests | Relevant interest categories | Starting signal, not a boundary |
| Demographics | Age, gender preferences | Suggestion, may expand if beneficial |
| Locations | Geographic targeting | More firm than other suggestions (respected more strictly) |

### Best Practices for Suggestions

**Do provide:**
- Your best-performing Custom Audiences (purchasers, high-value users)
- 2-3 broad interest categories relevant to your product
- Age ranges where your product converts best (as a suggestion, not restriction)
- Lookalike seeds from your highest-quality source audiences

**Don't provide:**
- Dozens of narrow interests (overloads the signal, doesn't help)
- Conflicting suggestions (e.g., ages 18-24 and a Custom Audience of 35-55 year olds)
- Competitor brand names as interests (these are unreliable and Meta may deprecate them)
- No suggestions at all (works for mature accounts with strong pixel data, but gives Meta less to work with)

### When Advantage+ Audience Outperforms Manual Targeting

| Scenario | A+ Audience Performance |
|----------|------------------------|
| Mature account (1,000+ monthly conversions) | Almost always better |
| Strong creative library (10+ proven ads) | Usually better |
| Broad TAM product (mass market) | Usually better |
| New account (<100 monthly conversions) | Mixed results, test both |
| Niche B2B (TAM <100K) | Often worse, manual targeting may be better |
| Special Ad Categories | Required in some cases, but limited |

### Advantage+ Audience vs Broad Targeting (No Targeting)

Going fully broad (no suggestions at all) works well for:
- Accounts with 500+ monthly conversions
- Very strong creative that self-selects the right audience
- Products with broad appeal (consumer SaaS, e-commerce)

Adding suggestions helps when:
- Account is newer (<6 months of data)
- Monthly conversions are <200
- Product has a specific niche audience
- You're launching a new campaign type or optimization event

---

## 4. Advantage+ Creative

### Auto-Enhancements

Advantage+ Creative applies automatic modifications to your ads to potentially improve performance. These run as variants alongside your original creative.

| Enhancement | What It Does | When to Enable | When to Disable |
|-------------|-------------|----------------|-----------------|
| Brightness/contrast | Adjusts image lighting | Generally safe | If brand colors are critical |
| Image templates | Adds colored borders or backgrounds | E-commerce, catalog ads | Brand-sensitive campaigns |
| Text improvements | Optimizes text placement and emphasis | Testing phase | Final approved copy |
| Music | Adds background music to videos | Story/Reels placements | Ads with custom audio |
| 3D animation | Adds subtle motion to static images | Feed placements | Minimal/clean brand aesthetics |
| Image cropping | Adjusts aspect ratio per placement | Multi-placement campaigns | Carefully composed images |
| Relevant comments | Shows relevant comments on the ad | High-engagement ads | Negative comment risk |

### Enable vs Disable Decision Framework

**Enable Advantage+ Creative when:**
- Testing new creative concepts (let Meta optimize presentation)
- Running catalog/DPA ads (auto-enhancements significantly improve catalog creative)
- Advertising across many placements (auto-cropping and formatting helps)
- Creative team is resource-constrained (auto-enhancements extend creative shelf life)

**Disable Advantage+ Creative when:**
- Brand guidelines are strict (colors, spacing, typography must be exact)
- Running regulated industry ads (financial, healthcare -- unintended changes could cause compliance issues)
- Ad copy has been legally reviewed (auto text changes could introduce unapproved claims)
- A/B testing creative elements (auto-enhancements confound your test variables)
- Using heavily designed static ads where cropping or borders would degrade quality

### Advantage+ Creative Reporting

- View which enhancements were applied: Ad level > Breakdown > By Dynamic Creative Element
- Compare enhanced vs original performance using the breakdown data
- If an enhancement consistently outperforms: incorporate that learning into your base creative

---

## 5. Advantage+ Placements

### How It Works

Advantage+ Placements (formerly Automatic Placements) allows Meta to distribute your ad across all available placements based on where it's most likely to achieve your optimization goal at the lowest cost.

**Available placements (2026):**
- Facebook: Feed, Marketplace, Video Feeds, Right Column, Stories, Reels, In-Stream Video, Search Results
- Instagram: Feed, Explore, Stories, Reels, Profile Feed, Search Results
- Messenger: Inbox, Stories, Sponsored Messages
- Audience Network: Native, Banner, Interstitial, Rewarded Video

### Recommendation: Use Advantage+ Placements by Default

Meta's algorithm is better at allocating across placements than manual selection in the vast majority of cases. Advantages:

- Lower overall CPM (Meta buys the cheapest effective impression)
- Broader reach (accesses inventory you might not have selected)
- Automatic format adaptation (if you provide multiple aspect ratios)
- More data for the algorithm to optimize

### When to Override with Manual Placement Selection

| Situation | Manual Placement Strategy |
|-----------|--------------------------|
| Video-only campaign (no static) | Exclude Right Column, include only video-capable placements |
| Stories/Reels-specific creative | Select only Stories and Reels placements |
| Exclude Audience Network | Deselect Audience Network (common for quality-sensitive brands) |
| Desktop-only product | Select Facebook Feed + Right Column only |
| Messenger-specific campaign | Select Messenger placements only |
| Testing placement-level creative | Manual selection for A/B testing purposes |

### Creative Adaptation for Advantage+ Placements

When using Advantage+ Placements, provide creative in multiple aspect ratios so Meta can serve the optimal format per placement:

| Aspect Ratio | Primary Placements |
|--------------|-------------------|
| 1:1 (square) | Facebook Feed, Instagram Feed, Marketplace |
| 4:5 (vertical) | Facebook Feed (mobile), Instagram Feed |
| 9:16 (full vertical) | Stories, Reels (FB + IG) |
| 16:9 (landscape) | In-Stream Video, Audience Network, Right Column |
| 1.91:1 (wide) | Right Column, Search Results |

See `placement_methodology` for complete placement specs and benchmarks.

---

## 6. When NOT to Use Advantage+

Advantage+ is not universally superior. These situations warrant manual campaign management:

### Special Ad Categories
- Housing, credit, and employment ads have legal targeting restrictions
- Advantage+ Audience may expand beyond compliant audiences
- Use manual targeting with verified compliant settings
- In some markets, Advantage+ is available for special categories but with automatic restrictions applied

### Very Niche B2B
- Total addressable audience <100K users
- Algorithm doesn't have enough data density to optimize effectively
- Manual targeting with account lists, job title targeting, and narrow interests often outperforms
- Exception: if you have a strong customer list for lookalike seeding, Advantage+ Audience with that seed can work

### Geo-Restricted Campaigns
- Campaigns restricted to a small geographic area (single city, small region)
- ASC only supports country-level targeting
- Manual campaigns with precise geographic targeting are necessary
- Unified Advantage+ may improve this with regional suggestions

### Nascent Accounts
- Accounts with <30 monthly conversions on the optimization event
- Algorithm doesn't have enough learning data
- Start with manual campaigns to build pixel data, then transition to Advantage+
- Threshold: once you consistently achieve 50+ optimization events per week per campaign, test Advantage+

### Heavy Regulatory Requirements
- Financial services, healthcare, political advertising
- Auto-enhancements could introduce non-compliant creative modifications
- Audience expansion could target restricted groups
- Use manual campaigns with all Advantage+ features disabled

### Budget-Constrained Small Accounts
- Monthly budget <$3K
- Not enough budget to feed the algorithm's exploration phase
- Manual campaigns with tight targeting and proven creative perform better
- Transition to Advantage+ once budget supports 50+ weekly events per ad set

---

## 7. Advantage+ Catalog Ads

### Overview

Advantage+ Catalog Ads (formerly Dynamic Product Ads / DPA) automatically select and display products from your catalog based on user behavior and intent signals.

**Two modes:**
1. **Retargeting:** Show users the specific products they viewed, added to cart, or browsed
2. **Broad audience (prospecting):** Meta selects products from your catalog likely to appeal to each user

### Best Practices

- Ensure product feed is complete and optimized (see `catalog_methodology`)
- Use Custom Labels to segment products (e.g., bestsellers, high-margin, seasonal)
- Set up product sets for different strategies (retargeting top sellers vs prospecting full catalog)
- Enable Advantage+ Creative for catalog ads (auto-enhancements work particularly well here)
- Minimum catalog size: 4+ products (Meta recommends 50+ for broad audience)

### Catalog + ASC Integration

ASC campaigns can incorporate catalog creative alongside standard ads:
- Add catalog product sets as creative within ASC
- Meta dynamically selects between standard creative and catalog ads based on the user
- Particularly effective for e-commerce advertisers running both brand and product-level ads

---

## Quick Reference Tables

### Advantage+ Feature Decision Matrix

| Feature | Enable When | Disable When |
|---------|------------|-------------|
| ASC / Unified A+ Campaign | 50+ weekly conversions, 10+ creatives | Niche B2B, geo-restricted, <30 monthly conversions |
| Advantage+ Audience | Most campaigns, especially 200+ monthly conversions | Very narrow B2B TAM, special ad categories |
| Advantage+ Creative | Testing phase, catalog ads, multi-placement | Strict brand guidelines, regulated copy, A/B testing |
| Advantage+ Placements | Default for all campaigns | Video-only, Stories-specific, Audience Network exclusion |
| Advantage+ Catalog | E-commerce with 50+ products | Service businesses, single-product companies |

### Migration Priority Matrix

| Campaign Type | Migration Urgency | Action |
|---------------|-------------------|--------|
| High-performing ASC (CPA at target) | Medium | Test unified in parallel, migrate by April |
| Underperforming ASC | High | Migrate now, use as reset opportunity |
| Legacy App campaigns | High | Migrate to unified immediately |
| Manual campaigns performing well | Low | No migration needed, manual remains supported |
| Manual campaigns underperforming | Medium | Test unified Advantage+ as alternative |

### Existing Customer Cap Quick Guide

| Goal | Cap Setting | Rationale |
|------|------------|-----------|
| Maximum new customer acquisition | 10-15% | Small existing customer budget for re-engagement |
| Balanced growth | 20-30% | Standard split |
| Revenue maximization | 40-50% | Includes easy wins from existing customers |
| Fully algorithmic | 100% (no cap) | Let Meta decide (not recommended for most) |
| Pure prospecting test | 0% | Zero existing customer budget (may limit total volume) |

---

## Reference Files

- `references/asc_setup_guide.md` - Step-by-step ASC setup and optimization
- `references/v25_migration.md` - Migration guide from legacy to unified Advantage+
- `references/advantage_features.md` - Complete Advantage+ feature matrix
