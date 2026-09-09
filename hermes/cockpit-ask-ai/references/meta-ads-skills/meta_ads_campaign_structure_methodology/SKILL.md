---
name: campaign_structure_methodology
description: Campaign architecture framework for Meta Ads. Covers CBO vs ABO decision criteria, the three-campaign model (Testing, Winners, ASC), Consolidated Account Structure principles, and naming conventions. Referenced by audit-structure action skill.
---

# Campaign Structure Methodology

## Purpose

This skill defines the campaign architecture framework for Meta Ads. Structure determines how the algorithm allocates budget, how creative gets tested, and how winners get scaled. Poor structure is one of the most common reasons Meta Ads accounts underperform -- too many campaigns fragment budget, too few reduce control. This framework provides a proven architecture that balances algorithmic freedom with strategic control.

## Core Framework: The Three-Campaign Model

The foundation of a well-structured Meta Ads account:

```
Account
├── Campaign 1: Creative Testing (25% of budget)
│   └── ABO -- structured testing environment
├── Campaign 2: Winners / Scaling (60-70% of budget)
│   └── CBO -- proven creative, broad audiences
└── Campaign 3: Advantage+ Shopping (remaining budget)
    └── Fully automated -- broad, catalog-enabled
```

This structure separates the three functions of a Meta account: **testing**, **scaling**, and **automation**.

---

## 1. Campaign 1: Creative Testing

**Purpose:** A sandbox for testing new creative concepts without affecting your scaling campaigns.

**Structure:**
- Campaign type: Manual Sales / Manual Leads
- Budget type: ABO (Ad Set Budget Optimization)
- Budget per ad set: 3x target CPA per day (minimum)
- Duration: 48-72 hours per test round

**Ad set organization:**
- One ad set per test theme or concept
- Group related creative variants in the same ad set
- Maximum 6-8 active ad sets at any time (to avoid budget fragmentation)

**Audience:**
- Use your best-performing audience from the Winners campaign
- Keep audience consistent across test ad sets (so creative is the only variable)
- Broad or Advantage+ Audience is fine if your account is mature

**Creative per ad set:**
- 3:2:2 method: 3 creatives x 2 primary texts x 2 headlines = 12 variants
- Or Faris method: 10-15 ads per ad set if you have the volume

**Graduation criteria (move to Winners campaign):**
- CPA at or below target for 48-72 hours
- At least 5 conversions (minimum for statistical confidence)
- CTR above account average
- Hook rate above 25% (video)

**Graduation method:**
1. Note the Post ID of the winning ad
2. Create a new ad in the Winners campaign using "Use Existing Post"
3. Enter the Post ID (preserves all social proof)
4. Pause the original ad in the Testing campaign

---

## 2. Campaign 2: Winners / Scaling

**Purpose:** Your primary revenue-generating campaign. Only proven creative runs here.

**Structure:**
- Campaign type: Manual Sales / Manual Leads
- Budget type: CBO (Campaign Budget Optimization)
- Budget: 60-70% of total account budget
- Bid strategy: Cost Cap (set at target CPA + 15-20%)

**Ad set organization:**

**Option A: Single ad set (recommended for most accounts)**
- One ad set with broad or Advantage+ Audience targeting
- All winning creative in this single ad set
- Let Meta allocate budget across ads
- Simplest structure, maximum data concentration

**Option B: Multiple ad sets by audience (for large accounts)**
- Ad set 1: Broad targeting
- Ad set 2: LAL 1-3% (if distinctly different performance)
- Ad set 3: Retargeting (if not in a separate campaign)
- Set CBO minimum spend per ad set to prevent starvation

**Creative management:**
- Only add Post ID winners from the Testing campaign
- Remove (pause) ads when they show fatigue signals
- Maintain 5-10 active ads per ad set
- Refresh creative every 2-4 weeks

**Scaling protocol:**
- This campaign is your primary vertical scaling target
- Follow the 20% rule (see budget-methodology)
- Monitor campaign-level CPA, not individual ad set CPA

---

## 3. Campaign 3: Advantage+ Shopping Campaign (ASC)

**Purpose:** Meta's fully automated campaign type. Best for e-commerce but increasingly effective for lead gen and SaaS.

**Structure:**
- Campaign type: Advantage+ Shopping (or Advantage+ App for mobile)
- Budget type: Campaign-level (no ad set control)
- Audience: Fully automated (broad), optionally add existing customer lists for segmentation
- Creative: Supply your best-performing ads + new concepts

**How ASC works:**
- Meta controls targeting, placement, and creative selection entirely
- You provide creative assets and a budget
- The algorithm tests combinations of creative x audience x placement
- You can set an "existing customer budget cap" (e.g., 10%) to limit retargeting spend

**When to use ASC:**
- E-commerce accounts with catalogs
- Accounts with strong pixel data (500+ conversions/month)
- When manual campaigns are mature and you want incremental scale
- As a complement to (not replacement for) manual campaigns

**When NOT to use ASC:**
- New accounts with limited conversion data
- When you need strict audience control
- B2B with very narrow targeting requirements
- When you can't tolerate any retargeting spend (ASC will retarget)

**ASC setup for SaaS/B2B (Viktor):**
- Existing customer budget cap: 0-10% (minimize retargeting)
- Creative: Your top 5-10 performing ads
- Country targeting: Your core markets only
- Monitor: If CPA is within 20% of manual campaigns, maintain. If not, reduce budget.

**ASC best practices:**
- Don't duplicate creative between ASC and manual campaigns (auction overlap)
- Use ASC for your proven creative, manual campaigns for testing
- ASC and manual campaigns will compete in auctions -- this is expected and Meta handles it
- Check the "existing vs new customer" breakdown regularly

---

## 4. Consolidated Account Structure (CAS)

**Principle:** Fewer campaigns with broader targeting and more budget per ad set outperform fragmented structures with many narrow campaigns.

### Why Consolidation Works

- More data per ad set = faster learning = better optimization
- Less internal auction competition (you stop bidding against yourself)
- Meta's algorithm performs better with more signal (conversions per ad set)
- Easier to manage and analyze

### Signs You Need to Consolidate

| Signal | Threshold | Action |
|--------|-----------|--------|
| Campaign count | >5-6 active campaigns | Merge similar campaigns |
| Ad sets per campaign | >8-10 | Combine similar audiences |
| Budget per ad set | <3x CPA | Merge ad sets to concentrate budget |
| Audience overlap | >30% between ad sets | Consolidate into one ad set |
| Multiple campaigns same objective + audience | Any | Merge into one campaign |
| "Learning Limited" status on most ad sets | Widespread | Consolidate to exit learning |

### Consolidation Protocol

1. **Audit:** List all active campaigns, their objectives, audiences, and performance
2. **Group:** Identify campaigns with the same objective and similar audiences
3. **Merge plan:** Design the consolidated structure (usually arrives at the Three-Campaign Model)
4. **Execute gradually:**
   - Create the new consolidated campaign
   - Move winning ads via Post ID
   - Run old and new in parallel for 7 days
   - If new campaign matches or beats old: pause old campaigns
   - If not: investigate before fully migrating

### Common Anti-Patterns to Fix

**Anti-pattern: One campaign per audience**
- "LAL 1% Campaign," "LAL 2% Campaign," "Interest A Campaign," "Interest B Campaign"
- Fix: Merge into one CBO campaign with audiences as ad sets (or one broad ad set)

**Anti-pattern: One campaign per creative concept**
- "UGC Campaign," "Static Campaign," "Video Campaign"
- Fix: Merge all creative into one campaign. Creative competes within ad sets, not across campaigns.

**Anti-pattern: Duplicating campaigns to "restart"**
- Performance dips, so you duplicate the campaign hoping the new one performs better
- Fix: This rarely works. Diagnose the actual problem (fatigue, audience, bid).

**Anti-pattern: Too many retargeting segments**
- "Retarget 3-day visitors," "Retarget 7-day visitors," "Retarget 14-day visitors," "Retarget cart abandoners"
- Fix: Merge into one retargeting ad set (or two at most: high-intent + general). Small segments can't exit learning.

---

## 5. The Breakdown Effect

**Critical concept:** When you pause a high-spending ad or ad set, the remaining ads/ad sets may not absorb that budget efficiently. Performance of the entire campaign can degrade.

### Why It Happens

- Meta's algorithm optimized the entire campaign as a system
- The "bad" ad was serving a purpose: winning certain auctions, reaching certain users, maintaining delivery velocity
- Removing it disrupts the system equilibrium

### How to Handle It

**Before pausing a high-spend ad:**
1. Check what % of campaign spend it represents
2. If >30%: Do NOT pause abruptly. Gradually reduce budget first.
3. Have a replacement ad ready before pausing
4. Add the replacement, wait 24-48 hours, then pause the underperformer
5. Monitor campaign-level metrics for 3-5 days after

**The "it's spending but CPA is bad" trap:**
- An ad with high CPA may be contributing to overall campaign performance
- Check: What happens to campaign CPA when you pause it? (Test with a 24-48 hour pause)
- If campaign CPA improves: keep it paused
- If campaign CPA worsens or delivery drops: reactivate it

---

## 6. Campaign Objective Mapping

Choosing the right campaign objective affects which auctions Meta enters and how it optimizes.

### Objective Selection

| Business Goal | Campaign Objective | Optimization Event |
|--------------|-------------------|-------------------|
| Online purchases | Sales | Purchase |
| Lead generation (form) | Leads | Lead (on-platform) |
| Lead generation (website) | Leads or Sales | Lead (website) |
| SaaS signups | Sales | Complete Registration or Purchase |
| App installs | App Promotion | App Install or App Event |
| Website traffic | Traffic | Link Click or Landing Page View |
| Video views | Engagement | ThruPlay |
| Brand awareness | Awareness | Reach or Ad Recall Lift |

**For Viktor (SaaS):**
- Primary: Sales objective, optimize for Complete Registration (signup)
- If volume allows: Optimize for Purchase (paid conversion) for higher-quality leads
- Testing: Traffic objective for landing page tests (cheaper, faster data)

### Optimization Event Selection

Always optimize for the event closest to revenue that still generates 50+ events per week per ad set.

**The funnel trade-off:**
- Optimize for Purchase: Highest quality, lowest volume, highest CPA
- Optimize for Add to Cart: Medium quality, medium volume
- Optimize for Page View: Lowest quality, highest volume, lowest CPA

**Rule of thumb:** Start with the deepest event that can generate 50+ events/week. If it can't, move one step up the funnel.

---

## 7. Naming Conventions

Consistent naming enables faster analysis, easier filtering, and clearer team communication.

### Campaign Naming

Format: `[Objective]_[Type]_[Audience]_[Date]`

Examples:
- `SALES_TESTING_BROAD_2026-03`
- `SALES_WINNERS_CBO_2026-03`
- `SALES_ASC_2026-03`
- `LEADS_TESTING_US-INTERESTS_2026-03`
- `LEADS_RETARGET_WEB-30D_2026-03`

### Ad Set Naming

Format: `[Audience]_[Targeting Detail]_[Placement]`

Examples:
- `BROAD_US-18-65_ALLPLACEMENTS`
- `LAL-1PCT_PURCHASERS_ALLPLACEMENTS`
- `INTEREST_AI-TOOLS-SAAS_ALLPLACEMENTS`
- `RETARGET_WEB-7D_ALLPLACEMENTS`
- `ADVANTAGE-PLUS_SUGGESTIONS-AI_ALLPLACEMENTS`

### Ad Naming

Format: `[Format]_[Concept]_[Hook]_[Version]`

Examples:
- `UGC_TESTIMONIAL_SLACK-CHAOS_V1`
- `STATIC_COMPARISON_VS-COMPETITORS_V2`
- `VIDEO_FOUNDER_WHY-I-BUILT_V1`
- `CAROUSEL_FEATURES_5-REASONS_V1`
- `VIDEO_DEMO_30SEC-WALKTHROUGH_V3`

### Naming Convention Tokens

| Token | Values | Notes |
|-------|--------|-------|
| Objective | SALES, LEADS, TRAFFIC, AWARENESS, ENGAGEMENT | Maps to Meta objective |
| Type | TESTING, WINNERS, ASC, RETARGET, RETENTION | Campaign purpose |
| Audience | BROAD, LAL-X%, INTEREST, RETARGET, ADVANTAGE-PLUS | Targeting approach |
| Format | UGC, STATIC, VIDEO, CAROUSEL, COLLECTION, CATALOG | Creative format |
| Placement | ALLPLACEMENTS, FEED, STORIES, REELS | Delivery placement |
| Date | YYYY-MM | Launch month |

---

## 8. Structure Templates by Business Model

### SaaS / B2B (Viktor)

```
Account Structure
├── SALES_TESTING_BROAD_2026-03 (25% budget, ABO)
│   ├── AS: BROAD_US_ALLPLACEMENTS ($100/day)
│   │   └── 6-12 test ads
│   └── AS: INTEREST_AI-SLACK-SAAS_ALLPLACEMENTS ($100/day)
│       └── 6-12 test ads
├── SALES_WINNERS_CBO_2026-03 (65% budget, CBO, Cost Cap)
│   ├── AS: BROAD_US_ALLPLACEMENTS
│   │   └── 5-8 proven winners (Post ID)
│   └── AS: LAL-1PCT_SIGNUPS_ALLPLACEMENTS
│       └── 5-8 proven winners (Post ID)
└── LEADS_RETARGET_WEB-30D_2026-03 (10% budget, ABO)
    └── AS: RETARGET_WEB-30D-EXCLUDEPURCHASE_ALLPLACEMENTS
        └── 3-5 retargeting-specific ads
```

### E-Commerce

```
Account Structure
├── SALES_TESTING_BROAD_2026-03 (20% budget, ABO)
│   ├── AS: BROAD_US_ALLPLACEMENTS
│   │   └── 8-15 test ads
│   └── AS: INTEREST_CATEGORY_ALLPLACEMENTS
│       └── 8-15 test ads
├── SALES_WINNERS_CBO_2026-03 (50% budget, CBO, Cost Cap)
│   └── AS: BROAD_US_ALLPLACEMENTS
│       └── 8-12 proven winners (Post ID)
├── SALES_ASC_2026-03 (20% budget)
│   └── Advantage+ Shopping, existing customer cap 10%
│       └── 5-10 top performers + catalog
└── SALES_RETARGET_CBO_2026-03 (10% budget)
    ├── AS: RETARGET_WEB-7D-CART_ALLPLACEMENTS
    └── AS: RETARGET_WEB-30D-GENERAL_ALLPLACEMENTS
```

### Lead Generation

```
Account Structure
├── LEADS_TESTING_BROAD_2026-03 (25% budget, ABO)
│   └── AS: BROAD_US_ALLPLACEMENTS
│       └── 6-12 test ads
├── LEADS_WINNERS_CBO_2026-03 (60% budget, CBO, Cost Cap)
│   ├── AS: BROAD_US_ALLPLACEMENTS
│   └── AS: LAL-1PCT_CUSTOMERS_ALLPLACEMENTS
└── LEADS_RETARGET_WEB-30D_2026-03 (15% budget, ABO)
    └── AS: RETARGET_WEB-30D_ALLPLACEMENTS
```

---

## Quick Reference Tables

### CBO vs ABO Decision

| Situation | Use CBO | Use ABO |
|-----------|---------|---------|
| Scaling proven winners | Yes | No |
| Creative testing with equal budget | No | Yes |
| 3+ ad sets, want Meta to optimize | Yes | No |
| A/B test with controlled variables | No | Yes |
| Retargeting with small budgets | Either | Preferred |
| ASC campaigns | N/A (auto) | N/A (auto) |

### Campaign Count Guidelines

| Monthly Spend | Max Active Campaigns | Max Ad Sets (total) |
|--------------|---------------------|-------------------|
| <$10K | 2-3 | 4-6 |
| $10K-50K | 3-4 | 6-12 |
| $50K-150K | 4-6 | 10-20 |
| $150K-500K | 5-8 | 15-30 |
| $500K+ | 6-10 | 20-40 |

### Campaign Health Checklist

- [ ] Each campaign has a clear, distinct purpose
- [ ] No two campaigns target the same audience with the same objective
- [ ] Every ad set has budget >= 5x target CPA
- [ ] Audience overlap between ad sets is <30%
- [ ] Naming conventions are consistent
- [ ] Winners campaign contains only Post ID graduates
- [ ] Testing campaign has fresh creative rotating every 1-2 weeks
- [ ] All campaigns are out of learning phase (or have a plan to exit)

---

## Reference Files

- `references/structure_templates.md` - Template structures by business model (e-commerce, lead gen, SaaS, app)
- `references/naming_conventions.md` - Complete naming convention guide with examples, tokens, and UTM alignment
