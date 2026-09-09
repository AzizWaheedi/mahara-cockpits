---
name: placement_methodology
description: Placement optimization framework for Meta Ads covering performance benchmarks by placement (Feed, Stories, Reels, Right Column, Audience Network, Messenger), creative specifications per placement, and Advantage+ Placements vs manual selection. Referenced by all action skills evaluating placement performance.
---

# Placement Methodology

## Purpose

This skill defines the complete placement optimization framework for Meta Ads. Placement selection determines where your ads appear across Meta's family of apps and partner networks. The right placement strategy balances reach, cost, creative fit, and conversion quality. Most advertisers should default to Advantage+ Placements (automatic), but understanding placement-level performance is essential for diagnosing issues, optimizing creative, and making informed decisions about when to override automation.

## Core Framework: Placement Hierarchy

```
Meta Placements (by platform)
├── Facebook
│   ├── Feed (largest audience, highest competition)
│   ├── Right Column (desktop only, low cost)
│   ├── Marketplace (shopping intent, limited targeting control)
│   ├── Video Feeds (in-stream and standalone)
│   ├── Stories (full-screen, ephemeral)
│   ├── Reels (full-screen, video-only, growing fast)
│   └── Search Results (intent-based, newer placement)
├── Instagram
│   ├── Feed (balanced performance)
│   ├── Stories (highest CTR)
│   ├── Reels (fastest growing, video-only)
│   ├── Explore (discovery, broader reach)
│   └── Shop (commerce intent)
├── Messenger
│   ├── Inbox (niche, high open rates)
│   └── Stories (limited inventory)
└── Audience Network
    ├── Native, Banner, and Interstitial (third-party apps)
    └── Rewarded Video (gaming apps)
```

---

## 1. Placement Performance Benchmarks

### Performance by Placement (Cross-Industry Averages, Q1 2026)

| Placement | Avg CTR | Avg CPC | Avg CPM | Traffic Share | Conversion Quality | Creative Format |
|-----------|---------|---------|---------|--------------|-------------------|----------------|
| **Instagram Stories** | 1.34% | $1.83 | $8.15 | ~18% | Medium-High | 9:16 vertical |
| **Instagram Feed** | 0.82% | $3.56 | $12.40 | ~22% | High | 1:1 or 4:5 |
| **Instagram Reels** | 1.15% | $2.10 | $7.80 | ~12% | Medium | 9:16 vertical video |
| **Instagram Explore** | 0.68% | $2.85 | $9.50 | ~6% | Medium | 1:1 or 4:5 |
| **Facebook Feed** | 0.90% | $7.47 | $14.20 | ~31% | Highest | 1:1 or 4:5 |
| **Facebook Stories** | 1.10% | $2.40 | $8.90 | ~5% | Medium | 9:16 vertical |
| **Facebook Reels** | 0.95% | $2.30 | $7.50 | ~4% | Medium | 9:16 vertical video |
| **Facebook Right Column** | 0.35% | $1.20 | $3.80 | ~3% | Low-Medium | 1:1 only |
| **Facebook Marketplace** | 0.75% | $3.10 | $10.20 | ~4% | Medium-High | 1:1 |
| **Facebook Video Feeds** | 0.65% | $2.90 | $9.80 | ~3% | Medium | 16:9 or 1:1 video |
| **Facebook Search** | 0.55% | $4.20 | $11.50 | ~2% | Medium-High | 1:1 |
| **Messenger Inbox** | 0.40% | $1.95 | $5.60 | ~1% | Low-Medium | 1:1 |
| **Audience Network** | 1.20% | $0.85 | $3.20 | ~5% | Lowest | Various |

**Notes on benchmarks:**
- These are cross-industry averages and vary significantly by vertical, creative quality, and audience
- Instagram Stories consistently delivers the highest CTR and lowest CPC across most verticals
- Facebook Feed has the largest traffic share but the highest CPC due to competition
- Audience Network has the lowest CPC but also the lowest conversion quality and highest fraud risk
- Reels placements are growing rapidly (inventory up 40% YoY) with competitive CPMs

### Performance Tiers

| Tier | Placements | Characteristics |
|------|-----------|----------------|
| **Tier 1 (Core)** | FB Feed, IG Feed, IG Stories | Highest quality, largest scale, best conversion rates |
| **Tier 2 (Growth)** | IG Reels, FB Reels, FB Stories, IG Explore | Growing inventory, competitive CPMs, good performance |
| **Tier 3 (Supplemental)** | FB Marketplace, FB Search, FB Video Feeds, Messenger | Niche audiences, situational value |
| **Tier 4 (Caution)** | Audience Network | Lowest quality, fraud risk, use only with Advantage+ |

---

## 2. Advantage+ Placements vs Manual Selection

### Advantage+ Placements (Recommended Default)

Advantage+ Placements (formerly Automatic Placements) allows Meta to distribute your budget across all available placements to maximize your optimization goal at the lowest cost.

**How it works:**
- Meta's algorithm evaluates each auction opportunity across all placements
- Budget flows to whichever placement offers the best cost-per-outcome at any given moment
- Placement distribution shifts dynamically based on competition, inventory, and user behavior
- You get access to all available inventory, maximizing reach at target efficiency

**Why it's the default recommendation:**
1. Meta's algorithm processes millions of signals per auction that humans cannot replicate
2. Restricting placements reduces available inventory and increases costs (10-30% higher CPA on average)
3. Advantage+ adapts to inventory changes in real-time (e.g., if Stories inventory spikes, your ads take advantage)
4. It's harder to make a mistake with Advantage+ than with manual selection
5. Meta's own data shows Advantage+ outperforms manual selection in 85%+ of A/B tests

**When Advantage+ is the wrong choice:**
- You have creative that only works in one format (e.g., long-form video that doesn't work in Stories)
- You need to exclude Audience Network for brand safety reasons
- You're running a placement-specific test (e.g., Reels-only campaign)
- Your product/service requires full-screen vertical creative only
- You've identified specific placements with consistently poor conversion quality for your business

### Manual Placement Selection

When overriding Advantage+ Placements, follow these guidelines:

| Scenario | Recommended Manual Selection | Rationale |
|----------|------------------------------|-----------|
| Video-only creative (no static) | Stories + Reels only | Static placements won't serve video-only creative well |
| Brand safety priority | Exclude Audience Network | AN has limited brand safety controls |
| Stories-first creative | Stories + Reels across FB + IG | Creative designed for 9:16 vertical |
| Desktop-focused B2B | FB Feed + FB Right Column | B2B audiences over-index on desktop |
| Ecommerce with catalog | All placements except AN | Catalog ads render differently per placement; AN quality is low |
| App installs | All placements including AN | AN has high app install volume (especially rewarded video) |
| Local business | FB Feed + IG Feed + FB Marketplace | Marketplace drives local discovery |

### Minimum Placements Rule

If using manual selection, never select fewer than 3 placements. Fewer than 3 restricts Meta's auction flexibility too much and typically results in:
- 20-40% higher CPMs
- Slower learning phase exit
- Reduced audience reach
- Inconsistent delivery

---

## 3. Creative Specifications by Placement

### Feed Placements (Facebook Feed, Instagram Feed)

| Spec | Requirement | Recommendation |
|------|------------|----------------|
| **Image ratio** | 1.91:1 to 1:1 | 1:1 (square) for most; 4:5 for maximum Feed real estate |
| **Image resolution** | Min 1080x1080px | 1200x1200px (1:1) or 1080x1350px (4:5) |
| **Video ratio** | 1:1, 4:5, 16:9 | 4:5 for Feed (takes up more screen) |
| **Video length** | Up to 240 minutes | 15-30 seconds optimal for Feed |
| **Primary text** | Max 125 characters visible | Front-load the hook in first 125 chars |
| **Headline** | Max 40 characters visible | Clear, benefit-driven |
| **Description** | Max 30 characters visible | Secondary info or CTA reinforcement |
| **CTA button** | Select from Meta's options | Match to objective (Learn More, Shop Now, Sign Up) |

**Feed-specific notes:**
- 4:5 ratio takes up 20% more screen space than 1:1 in mobile Feed, increasing stopping power
- Primary text truncates after ~125 characters (expandable with "See More")
- Headline truncates after ~40 characters on mobile
- Carousel format: up to 10 cards, each with its own image/video, headline, and link
- Collection format: cover image/video + product grid below

### Stories and Reels Placements

| Spec | Stories | Reels |
|------|---------|-------|
| **Ratio** | 9:16 (full-screen vertical) | 9:16 (full-screen vertical) |
| **Resolution** | Min 1080x1920px | Min 1080x1920px |
| **Format** | Image or video | Video only |
| **Video length** | Up to 120 seconds (15s recommended) | Up to 90 seconds (15-30s recommended) |
| **Sound** | On by default (design for sound-on) | On by default (music/voice expected) |
| **Safe zones** | Top 14% (username), bottom 20% (CTA/swipe) | Top 14% (username), bottom 35% (CTA/caption/music) |
| **Text overlay** | Keep within center 60% of frame | Keep within center 50% of frame |
| **CTA** | Swipe-up or button overlay | Button overlay at bottom |

**Safe zone detail:**

```
┌─────────────────────┐
│  ▓▓▓ UNSAFE ▓▓▓▓▓▓  │  <- Top 14%: profile pic, username, "Sponsored"
│                     │
│                     │
│   ███ SAFE ZONE ███ │  <- Center: primary content area
│   ███ FOR TEXT  ███ │
│                     │
│                     │
│  ▓▓▓ UNSAFE ▓▓▓▓▓▓  │  <- Bottom 20-35%: CTA, swipe, captions
└─────────────────────┘
```

**Stories/Reels creative best practices:**
- First 3 seconds must hook attention (80% of viewers decide to skip in first 3 seconds)
- Native-feeling content outperforms polished ads (use phone-shot aesthetic)
- Include sound/music (60% of Stories are viewed with sound on)
- Use text overlays for key messages (30-40% of viewers have sound off)
- Match the cadence of organic Stories/Reels content (quick cuts, dynamic movement)
- Avoid letterboxing (black bars from non-9:16 content), which reduces CTR by 20-30%

### Right Column (Facebook Desktop Only)

| Spec | Requirement |
|------|------------|
| **Ratio** | 1:1 only |
| **Resolution** | Min 254x254px (1200x1200px recommended) |
| **Format** | Image only (no video) |
| **Headline** | Max 40 characters |
| **No primary text** | Not displayed |
| **No description** | Not displayed |

**Right Column notes:**
- Desktop-only placement (not shown on mobile)
- Very small ad unit; image must be simple and readable at small size
- Lowest CPM but also lowest engagement
- Best used as a supplemental placement within Advantage+ (not standalone)
- Can be effective for retargeting (recognition-based, not discovery)

### Audience Network

| Spec | Native/Banner | Interstitial | Rewarded Video |
|------|-------------|-------------|---------------|
| **Ratio** | 9:16 or 1:1 | 9:16 | 9:16 or 16:9 |
| **Format** | Image or video | Image or video | Video only |
| **Video length** | Up to 120s | Up to 120s | 15-30s |
| **Resolution** | Min 398x208px | Min 1080x1920px | Min 1080x1920px |

**Audience Network considerations:**
- Ads appear in third-party apps and websites (not on Meta properties)
- Limited brand safety controls (you cannot choose which apps/sites)
- Higher risk of accidental clicks and bot traffic
- Rewarded Video is the highest-quality AN format (users opt in to watch for in-app rewards)
- For brand advertisers: consider excluding AN entirely
- For performance advertisers: include AN only within Advantage+ (let Meta decide when it's efficient)

### Messenger

| Spec | Inbox | Stories |
|------|-------|---------|
| **Ratio** | 1:1 | 9:16 |
| **Format** | Image | Image or video |
| **Headline** | Max 40 chars | N/A |
| **Primary text** | Shown | N/A |

**Messenger notes:**
- Very limited inventory
- Best for Messenger-destination campaigns (click-to-message ads)
- Inbox ads appear between conversations
- Not recommended as a standalone placement

---

## 4. Placement-Level Analysis Methodology

### How to Evaluate Placement Performance

When analyzing placement breakdown data, follow this framework:

**Step 1: Pull placement-level data**
- Delivery metrics: impressions, reach, frequency by placement
- Engagement: CTR, video views (ThruPlay), engagement rate by placement
- Conversion: conversions, CPA, ROAS by placement
- Cost: CPM, CPC by placement

**Step 2: Compare against benchmarks**
- Use the benchmark table in Section 1 as a starting point
- Compare each placement's CPA to the campaign's blended CPA
- Identify placements where CPA is >2x the campaign average

**Step 3: Assess volume and significance**
- Placements with <100 impressions are not statistically meaningful
- Placements with <5 conversions should not be used for CPA-based decisions
- Focus analysis on placements with >10% of total campaign spend

**Step 4: Diagnose underperformance**

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| High CTR but low conversion rate | Creative drives clicks but landing page or offer doesn't convert | Check landing page experience for that device/format |
| Low CTR across all placements | Creative is not compelling | Test new creative concepts |
| Low CTR on specific placement | Creative doesn't fit the placement format | Create placement-specific creative |
| High CPM on one placement | Competition for that placement is intense | Let Advantage+ handle allocation, or reduce bid |
| Good performance on AN only | Likely low-quality traffic inflating metrics | Check for bot traffic, verify conversions are real |
| Reels CPA much higher than Stories | Video hook isn't working for Reels context | Adapt creative for Reels (faster hook, music, native feel) |

### Cross-Placement Creative Assessment

| Question | Why It Matters |
|----------|---------------|
| Do you have 9:16 vertical creative for Stories/Reels? | Non-9:16 creative letterboxes and underperforms by 20-30% |
| Do you have square (1:1) and portrait (4:5) for Feed? | 4:5 takes up more screen space; 1:1 is universally compatible |
| Is your video under 15 seconds for Stories/Reels? | Longer videos get skipped more in ephemeral placements |
| Does your creative have a hook in the first 3 seconds? | Critical for all placements but especially Stories/Reels |
| Are text overlays within safe zones? | Text obscured by UI elements wastes the message |
| Do you have static alternatives for placements that don't support video? | Right Column, some Messenger placements are image-only |

---

## 5. Placement Strategy by Objective

### Awareness / Reach

| Recommended | Avoid |
|-------------|-------|
| All placements (Advantage+) | None, maximize reach |
| Stories + Reels for video awareness | Restricting to Feed only (limits reach) |

### Traffic / Clicks

| Recommended | Avoid |
|-------------|-------|
| FB Feed + IG Feed + IG Stories | Audience Network (click fraud risk) |
| Advantage+ minus AN if concerned | Right Column only (too small for traffic-driving) |

### Conversions / Sales

| Recommended | Avoid |
|-------------|-------|
| Advantage+ Placements (let Meta optimize for conversions) | Audience Network standalone |
| If manual: FB Feed + IG Feed + IG Stories + IG Reels | Messenger standalone |

### App Installs

| Recommended | Avoid |
|-------------|-------|
| All placements including Audience Network | Restricting placements (AN has high install volume) |
| Rewarded Video on AN performs well | N/A |

### Lead Generation

| Recommended | Avoid |
|-------------|-------|
| FB Feed + IG Feed + IG Stories | Audience Network (low-quality leads) |
| Messenger (for click-to-message lead capture) | Right Column (low engagement) |

---

## 6. Placement Fatigue and Rotation

### Fatigue Indicators by Placement

| Placement | Fatigue Signal | Typical Onset | Action |
|-----------|---------------|--------------|--------|
| Feed (FB/IG) | CTR declines 20%+ over 2 weeks | 3-6 weeks | Refresh creative, change format |
| Stories | CTR declines 15%+ over 1 week | 2-4 weeks (faster fatigue) | Rotate creative more frequently |
| Reels | CTR declines 15%+ over 1 week | 2-3 weeks (fastest fatigue) | Reels audiences expect novelty |
| Right Column | Minimal fatigue (low attention) | N/A | Rarely needs rotation |
| Audience Network | Minimal fatigue | N/A | Rarely needs rotation |

### Rotation Strategy

1. **Batch creative refreshes** by placement type (Feed creative has different fatigue rate than Stories)
2. **Monitor CTR trends** at the placement level weekly
3. **Maintain a creative pipeline** with at least 2 weeks of fresh creative ready for Stories/Reels
4. **Use dynamic creative** (Advantage+ Creative or DCO) to extend creative lifespan by auto-testing combinations
5. **Reels creative** should refresh every 2-3 weeks at high spend levels

---

## Quick Reference: Placement Decision Tree

```
Starting a new campaign?
├── Do you have 9:16 vertical creative?
│   ├── Yes --> Use Advantage+ Placements (all placements)
│   └── No --> Use Feed-only placements until you have vertical creative
│
├── Do you need to exclude Audience Network?
│   ├── Yes (brand safety) --> Advantage+ minus AN
│   └── No --> Keep AN in Advantage+
│
├── Is this a video-only campaign?
│   ├── Yes --> Stories + Reels (FB + IG)
│   └── No --> All placements
│
├── Is this B2B / desktop-heavy?
│   ├── Yes --> Consider including Right Column, prioritize Feed
│   └── No --> Standard Advantage+
│
└── Is this retargeting?
    ├── Yes --> All placements (recognition-based, even small formats work)
    └── No (prospecting) --> Advantage+ (maximize discovery reach)
```

---

## Reference Files

- `references/placement_specs.md` - Complete creative specifications for every Meta placement with pixel dimensions, file sizes, and character limits
