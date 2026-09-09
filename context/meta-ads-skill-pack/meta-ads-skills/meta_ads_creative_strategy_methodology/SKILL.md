---
name: creative_strategy_methodology
description: Comprehensive creative strategy framework for Meta Ads. Covers testing methodologies (DCT, 3:2:2, Faris method), creative fatigue detection, hook/hold rate benchmarks, creative diversification strategy, and volume requirements by spend level. Use when evaluating creative performance, planning creative tests, diagnosing fatigue, or calibrating benchmarks. Referenced by analyze-creative and generate-creative-brief action skills.
---

# Creative Strategy Methodology

## Purpose

This skill encodes the complete creative strategy framework for Meta Ads. It provides testing methodologies, fatigue detection systems, performance benchmarks, and volume planning so media buyers can systematically produce, test, and scale winning creative. Creative is the single largest lever in Meta Ads performance -- this framework ensures you treat it as a system, not a guessing game.

## Core Framework: The Creative Engine

Creative strategy operates as a continuous loop:

```
Produce --> Test --> Analyze --> Scale Winners --> Detect Fatigue --> Produce
```

Every component below maps to a stage of this loop.

---

## 1. Testing Methodologies

Three battle-tested methods, each suited to different situations:

### Andrew Faris Method (Recommended Default)

**Philosophy:** No dedicated test campaigns. All ads compete in the same environment they'll scale in. This eliminates the "test vs scale" gap where ads perform differently in testing than production.

**Setup:**
- Use your existing scaling campaigns
- Add 15-20 new ads per ad set (Meta will allocate spend to winners)
- Use cost controls (Cost Cap or Bid Cap) to enforce efficiency
- Let ads run for 7 days minimum before judging
- Kill ads that spend 2x CPA with zero conversions

**When to use:**
- Accounts spending $5K+/day with established campaigns
- When you have high creative volume (10+ new concepts/week)
- When you want the most realistic performance signal

**Advantages:**
- No wasted "test budget" -- every dollar drives revenue
- Winning ads are already scaled
- Eliminates the transfer problem (test campaign performance != scaling performance)

**Disadvantages:**
- Requires high creative volume to feed 15-20 ads
- Hard to isolate variables (hook vs body vs CTA)
- New ads may get starved if existing winners are strong

### 3:2:2 Testing Method

**Philosophy:** Structured isolation testing. Control the variables so you know exactly what won and why.

**Setup:**
- 3 creatives (visual concepts) x 2 primary texts x 2 headlines = 12 ad variants
- One ad set per test theme
- Budget: 3x target CPA per day, per ad set
- Run for 48-72 hours
- Winner criteria: lowest CPA with statistical confidence (at least 5 conversions)

**When to use:**
- You need to understand WHY something works (hook, angle, format)
- Testing a fundamentally new concept or positioning
- Lower spend accounts ($1K-5K/day) where every dollar matters

**Workflow:**
1. Create 3 distinct visual concepts (not minor variations)
2. Write 2 primary text variations (different angles, not just word swaps)
3. Write 2 headline variations
4. Launch in a dedicated testing campaign (ABO, one ad set per theme)
5. After 48-72 hours: identify the winning creative + text + headline combo
6. Graduate winner to scaling campaign using Post ID method

### DCT (Dynamic Creative Testing)

**Philosophy:** Supply the building blocks, let Meta's algorithm find the best combinations.

**Setup:**
- Create one ad with multiple elements:
  - Up to 10 images/videos
  - Up to 5 primary text options
  - Up to 5 headlines
  - Up to 5 descriptions
  - Up to 5 CTA buttons
- Meta assembles and tests combinations dynamically
- Budget: 2-3x target CPA per day

**When to use:**
- Rapid iteration on elements within a proven concept
- When you have many copy variations to test
- As a complement to structured testing (not a replacement)

**Limitations:**
- You cannot see exactly which combination performed best (only per-element breakdowns)
- Not recommended as your only testing method
- Being deprecated in favor of Flexible Ads in some accounts

**When NOT to use:**
- Video creative (each video is a self-contained concept)
- When you need to understand the complete winning combination
- When creative elements are interdependent (e.g., headline references the image)

---

## 2. Creative Fatigue Detection

Creative fatigue is the gradual performance decline of an ad as your target audience sees it repeatedly. Detecting it early prevents wasted spend.

### Primary Fatigue Signals

| Signal | Threshold | Timeframe | Action |
|--------|-----------|-----------|--------|
| CTR decline | >10% drop from peak | Rolling 7-day vs prior 7-day | Prepare replacement creative |
| CPA increase | >15% above baseline | Rolling 7-day vs first 14-day average | Reduce budget or replace |
| Frequency (prospecting) | >3.0 | Last 7 days | Audience saturation, expand or replace |
| Frequency (retargeting) | >7.0 | Last 7 days | Rotate creative |
| CPM increase | >20% above baseline | Rolling 7-day | May indicate auction fatigue |
| Thumb-stop rate decline | >15% drop from peak | Rolling 7-day | Hook is wearing out |

### Secondary Fatigue Signals

- Comment sentiment shifts negative ("I've seen this ad 100 times")
- Share rate drops to near zero
- Outbound click rate declines while impressions stay flat
- Video completion rate declining (people are skipping sooner)

### Fatigue Response Protocol

1. **Early warning** (1-2 signals triggered): Monitor daily, prepare replacement concepts
2. **Active fatigue** (3+ signals triggered): Reduce ad spend by 30-50%, launch replacements
3. **Critical fatigue** (CPA 2x+ baseline): Pause the ad, launch fresh creative immediately

### Proactive Fatigue Prevention

- Maintain a creative pipeline of 2-3 weeks of ready concepts
- Rotate hooks every 2-3 weeks on high-spend ads
- Use multiple formats of the same concept (static version, video version, carousel version)
- Stagger launch dates so ads fatigue at different times

See `references/fatigue_detection.md` for complete signal thresholds and frequency tables.

---

## 3. Hook Rate and Hold Rate Benchmarks

### Hook Rate (Thumb-Stop Rate)

Percentage of impressions where the user watches at least 3 seconds of video (or stops scrolling on a static ad).

| Rating | Hook Rate | Interpretation |
|--------|-----------|---------------|
| Poor | <20% | Hook is not stopping the scroll. Rework immediately. |
| Below Average | 20-25% | Functional but leaves performance on the table. |
| Average | 25-30% | Acceptable for most categories. |
| Good | 30-40% | Strong hook. Worth scaling. |
| Excellent | 40-50% | Exceptional. Protect this ad and iterate on the hook pattern. |
| Viral | 50%+ | Rare. Usually UGC or highly disruptive format. Maximize spend. |

**Hook Rate by Format (typical ranges):**
- UGC testimonial: 30-45%
- Text overlay static: 20-30%
- Product demo video: 25-35%
- Founder/talking head: 35-50%
- "Ugly ad" iPhone-shot: 35-55%
- Polished brand video: 15-25%

### Hold Rate (Video Retention)

Percentage of 3-second viewers who watch to the halfway point of the video.

| Rating | Hold Rate | Interpretation |
|--------|-----------|---------------|
| Poor | <30% | Content fails to deliver on hook's promise. |
| Below Average | 30-40% | Losing attention mid-video. Tighten the script. |
| Average | 40-50% | Acceptable. Room for improvement in pacing. |
| Strong | 50-60% | Good content-to-hook alignment. |
| Excellent | 60-70% | Highly engaging. Scale confidently. |
| Exceptional | 70%+ | Content is magnetic. Study this ad's structure. |

**The Hook-Hold Matrix:**

| | Low Hold (<40%) | High Hold (>50%) |
|---|---|---|
| **Low Hook (<25%)** | Bad ad. Kill it. | Good content, bad hook. Test new hooks on same body. |
| **High Hook (>35%)** | Clickbait problem. Hook overpromises. Fix body content. | Winner. Scale and protect. |

See `references/hook_strategies.md` for 10 hook types with examples and benchmarks.

---

## 4. Creative Volume Requirements

The number of new creative concepts you need scales with spend. This is not optional -- high-spend accounts that under-produce creative will hit fatigue walls.

### Volume by Spend Level

| Monthly Ad Spend | New Concepts/Week | New Ads/Week | Testing Budget |
|------------------|-------------------|--------------|----------------|
| <$10K/month | 1-2 concepts | 3-5 ads | 20-25% of budget |
| $10K-50K/month | 2-4 concepts | 5-10 ads | 20% of budget |
| $50K-150K/month | 4-6 concepts | 10-20 ads | 15-20% of budget |
| $150K-500K/month | 6-10 concepts | 20-40 ads | 15% of budget |
| $500K+/month | 10-15 concepts | 40-60 ads | 10-15% of budget |

**Concept vs Ad:**
- A "concept" is a distinct creative idea (angle, story, format)
- An "ad" is a specific execution (one concept can yield 3-5 ad variants through hook swaps, text changes, format adaptations)

### Creative Win Rate Benchmarks

- Average accounts: 10-15% of tested ads become winners
- Good accounts: 20-25% win rate
- Exceptional accounts: 30%+ win rate

At a 15% win rate, you need to test 20 ads to find 3 winners. Plan accordingly.

---

## 5. Format Diversification Strategy

Meta rewards format diversity in the auction. Accounts that run only one format (e.g., all static) leave performance on the table.

### Core Formats

| Format | Best For | Typical Hook Rate | Production Cost | Shelf Life |
|--------|----------|-------------------|-----------------|------------|
| Static image | Direct response, retargeting | 20-30% | Low | 2-4 weeks |
| UGC video | Social proof, cold audiences | 30-45% | Medium | 3-6 weeks |
| Polished video | Brand awareness, consideration | 15-25% | High | 4-8 weeks |
| Founder/talking head | Trust building, SaaS/B2B | 35-50% | Low-Medium | 4-8 weeks |
| Carousel | Product showcase, storytelling | 25-35% | Low-Medium | 3-5 weeks |
| Collection | E-commerce catalog browsing | N/A | Low (automated) | Ongoing |
| Catalog/DPA | Retargeting, broad prospecting | N/A | Low (automated) | Ongoing |
| Reels/Stories native | Mobile-first audiences | 30-40% | Medium | 2-4 weeks |

### Recommended Format Mix

**SaaS/B2B (Viktor):**
- 30% UGC testimonial/demo videos
- 25% Founder/talking head
- 20% Static (feature callouts, comparison charts, social proof)
- 15% Screen recording/product demo
- 10% Carousel (workflow walkthrough, before/after)

**E-commerce:**
- 30% UGC (unboxing, review, lifestyle)
- 25% Product-focused video (polished)
- 20% Static (product shots, offer callouts)
- 15% Carousel (product collection, benefits)
- 10% Catalog/Collection ads

### Barry Hott "Ugly Ads" Approach

**Philosophy:** The best-performing ads often look like organic content, not advertisements. Over-produced creative triggers ad blindness.

**Characteristics:**
- Shot on iPhone (not a RED camera)
- Natural lighting, real environments
- Minimal or no branding overlays
- Text overlays using native app fonts (CapCut, Instagram Stories style)
- Raw, unscripted feel (even if actually scripted)
- Imperfect framing, casual tone

**When to deploy:**
- Cold prospecting audiences (blends with organic feed)
- UGC-style testimonials
- "Problem-solution" narratives
- Behind-the-scenes content
- Any time polished creative is underperforming

**Quality threshold test:** "Could this ad profitably spend $10K?" Ugly doesn't mean lazy. The ad must still have a clear hook, value proposition, and CTA. The production quality is deliberately low -- the strategic quality is high.

---

## 6. Post ID Method for Scaling Winners

When you find a winning ad, never duplicate it into a new campaign. Use the Post ID method to preserve social proof (likes, comments, shares).

### How It Works

1. Find the winning ad's Post ID in Ads Manager (Ad level > select ad > "Facebook Post with Comments" under Ad Preview)
2. In your scaling campaign, create a new ad using "Use Existing Post"
3. Enter the Post ID
4. The new ad instance shares the same post -- all social proof carries over

### Why It Matters

- Social proof (thousands of likes/comments) significantly improves CTR
- Starting fresh loses all accumulated engagement
- Meta's algorithm considers engagement signals in auction decisions
- Comments act as additional social proof (especially "just bought this" type comments)

### Post ID Best Practices

- Always use Post ID when moving ads between campaigns
- Monitor comments for negative sentiment (one viral negative comment can tank performance)
- Pin positive comments to the top
- Respond to questions in comments (improves engagement signals)

---

## 7. Creative Quality Threshold

Before launching any ad, apply this filter:

**"Could this ad profitably spend $10K?"**

If the answer is no, don't launch it. Bad creative wastes budget, pollutes your data, and teaches Meta's algorithm the wrong lessons about your audience.

### Pre-Launch Checklist

- [ ] Clear hook in first 3 seconds (video) or first visual scan (static)
- [ ] Single, focused value proposition (not trying to say everything)
- [ ] Speaks to a specific pain point or desire
- [ ] CTA is clear and compelling
- [ ] Passes the "scroll test" -- would YOU stop scrolling?
- [ ] Passes the "sound off test" -- comprehensible without audio
- [ ] Landing page matches the ad's promise (message match)
- [ ] Correct specs for target placements (see `references/creative_formats.md`)
- [ ] No policy violations (claims, before/after, personal attributes)

---

## Quick Reference Tables

### Testing Method Selection

| Situation | Recommended Method |
|-----------|--------------------|
| High-spend account, high creative volume | Andrew Faris Method |
| Need to isolate variables | 3:2:2 Method |
| Many copy variations to test | DCT |
| New account, limited data | 3:2:2 Method |
| Scaling proven concept with new angles | Andrew Faris Method |
| Quick element-level optimization | DCT |

### Fatigue Response Quick Reference

| Fatigue Stage | Frequency | CPA Trend | Action |
|---------------|-----------|-----------|--------|
| Healthy | <2.0 | Stable or declining | Scale budget |
| Early warning | 2.0-3.0 | Stable | Prepare replacements |
| Active fatigue | 3.0-4.0 | +15-30% | Reduce spend, launch replacements |
| Critical | 4.0+ | +30%+ | Pause, full creative refresh |

### Creative Concept Angles to Rotate

1. Problem-agitation-solution
2. Social proof / testimonial
3. Comparison (us vs alternatives)
4. Before/after transformation
5. Behind-the-scenes / how it works
6. Founder story / mission
7. Urgency / scarcity
8. Listicle / "X reasons why"
9. Myth-busting / contrarian take
10. User-generated demonstration

---

## Reference Files

- `references/testing_frameworks.md` - Deep dive on each testing methodology with worked examples
- `references/fatigue_detection.md` - Signal thresholds, frequency tables, refresh triggers
- `references/creative_formats.md` - Specs, best practices per format (static, video, carousel, UGC, catalog)
- `references/hook_strategies.md` - 10 hook types with examples, benchmarks, and when to use each
