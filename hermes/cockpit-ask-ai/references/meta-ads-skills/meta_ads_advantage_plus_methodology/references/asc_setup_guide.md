# Advantage+ Shopping Campaign Setup Guide

## Overview

This guide walks through the complete setup and optimization process for Advantage+ Shopping Campaigns (ASC), from initial configuration through scaling.

---

## Pre-Launch Checklist

Before creating an ASC campaign, confirm:

- [ ] Pixel is installed and firing correctly on all conversion pages
- [ ] CAPI is implemented with EMQ score >6.0
- [ ] At least 100 optimization events in the last 30 days (500+ recommended)
- [ ] Customer list uploaded as Custom Audience (for existing customer definition)
- [ ] 5+ creative assets ready (10-20 recommended)
- [ ] Mix of creative formats prepared (static, video, carousel, UGC)
- [ ] Landing pages tested for speed (<3s mobile) and conversion
- [ ] Budget calculated: enough for 50+ optimization events per week

---

## Step-by-Step Setup

### Step 1: Create Campaign

1. Ads Manager > Create > Choose "Sales" objective
2. Select "Advantage+ Shopping Campaign" (or unified Advantage+ post-v25.0)
3. Name the campaign with a clear convention: `[Product] - ASC - [Date] - [Version]`

### Step 2: Configure Campaign Settings

**Country targeting:**
- Select the country or countries where you want to advertise
- ASC supports country-level targeting only (no state, city, or ZIP)
- For multi-country: separate ASC campaigns per country or region recommended

**Optimization event:**
- Select your primary conversion event (typically "Purchase" or "Lead")
- Only one optimization event per ASC campaign
- For SaaS: "StartTrial" or "Subscribe" may be more appropriate than "Purchase"

**Budget:**
- Set a daily budget (no lifetime budget option for ASC)
- Minimum: enough for 50 optimization events per week at your target CPA
- Example: $100 CPA target = $5,000/week minimum = $714/day
- Start with your combined prospecting + retargeting budget (ASC handles both)

### Step 3: Define Existing Customers

**Why this matters:** Without defining existing customers, Meta cannot distinguish new vs returning customers, and you lose the ability to cap existing customer spend.

**How to define:**
1. In the ASC settings, click "Existing Customer Definition"
2. Select Custom Audiences that represent your existing customers:
   - Customer list (email + phone) -- update monthly minimum
   - Website Custom Audience (Purchase event, 180-day window)
   - App Custom Audience (if applicable)
3. Include ALL purchasers/subscribers, not just recent ones

**Existing customer cap:**
- Set the maximum percentage of budget that can go to existing customers
- Recommended starting point: 15% (primarily prospecting)
- Range: 0% (pure prospecting, may limit volume) to 100% (fully algorithmic)
- Adjust based on business model:
  - Single-purchase products: 5-10% cap
  - Subscription/repeat purchase: 15-25% cap
  - High LTV with strong repeat rates: 25-40% cap

### Step 4: Add Creative

**Minimum:** 5 creatives (Meta's hard minimum)
**Recommended:** 10-20 creatives for optimal algorithm performance

**Creative mix strategy:**
- 3-5 static images (product shots, feature callouts, social proof)
- 3-5 videos (UGC, product demo, founder/talking head)
- 2-3 carousels (feature walkthrough, testimonials, product collection)
- Each creative should represent a distinct concept, not minor variations

**Creative naming convention:** `[Concept]-[Format]-[Version]-[Date]`
Example: `UGC-Testimonial-Video-V2-Mar2026`

**Primary text, headline, description:**
- Write 3-5 variations of primary text
- Write 2-3 headline variations
- Meta will dynamically pair text with creative
- Ensure text works with any creative in the set (don't reference specific visuals in text)

### Step 5: Launch

- Review all settings
- Submit for ad review
- Expected review time: <24 hours for established accounts
- Do not make changes during the first 7 days

---

## Optimization Timeline

### Week 1 (Days 1-7): Learning Phase

**What to expect:**
- Volatile CPA (swings of 50%+ day to day are normal)
- Budget may not fully spend on all days
- Meta is exploring which audiences and placements work best
- Reported conversions may be lower than actual (delayed attribution)

**What to do:**
- Monitor but do not act
- Do not change budget, creative, or settings
- Track backend conversions alongside Meta's reported numbers
- Expect CPA to be 30-50% above your target during this period

**What NOT to do:**
- Don't panic and pause the campaign
- Don't add or remove creative
- Don't change the existing customer cap
- Don't compare to mature campaign performance

### Week 2 (Days 8-14): Stabilization

**What to expect:**
- CPA should be trending downward
- Delivery becomes more consistent
- Meta begins concentrating on winning creative and audiences

**What to do:**
- Evaluate CPA trend (is it declining?)
- Check which creative is spending (identify early winners)
- Compare to your manual campaigns (if running in parallel)
- If CPA is >50% above target after 50+ conversions: check creative quality

**Decision point at Day 14:**
- CPA at or near target: proceed to scaling
- CPA 20-50% above target: add 3-5 new creatives, monitor 7 more days
- CPA >50% above target: evaluate whether creative or offer needs rework

### Week 3-4 (Days 15-28): Early Optimization

**What to do:**
- Add 3-5 new creatives to replace underperformers
- Review existing vs new customer split in Delivery Insights
- Adjust existing customer cap if needed (up if not spending enough, down if over-indexing)
- Begin gradual budget scaling if CPA is stable (20% increase every 3-5 days)

### Month 2+ : Ongoing Management

**Weekly cadence:**
1. Review CPA trend (7-day rolling)
2. Check creative performance (pause ads spending 2x CPA with zero conversions after 7 days)
3. Add 3-5 new creatives
4. Review existing vs new customer split
5. Gradual budget scaling if CPA allows

**Monthly cadence:**
1. Full creative audit (which concepts are winning? what angles are fatiguing?)
2. Refresh existing customer list
3. Evaluate whether to expand to new countries
4. Compare ASC performance vs manual campaigns

---

## Scaling ASC Campaigns

### Vertical Scaling (Increasing Budget)

- Increase by 20% every 3-5 days (not more than 20% at once)
- After each increase, wait for 50+ new optimization events before increasing again
- Watch for CPA spike after scaling -- if CPA increases >30%, hold budget for 7 days
- If CPA doesn't stabilize after 7 days at new budget, reduce back

### Horizontal Scaling (New ASC Campaigns)

When to create a new ASC rather than scaling the existing one:
- Entering a new country
- Testing a fundamentally different product or offer
- Running a seasonal promotion alongside an evergreen campaign
- Budget exceeds $50K/day (multiple ASC campaigns can sometimes outperform a single massive one)

### Creative Scaling Within ASC

- Top-performing creative concepts should be iterated (same concept, new hook/format/angle)
- Aim to have 3-5 iterations of each winning concept live at any time
- Kill ads that have spent 2x CPA with zero conversions (after 7-day evaluation)
- Never remove a winning ad to "make room" for new ones -- add new ones alongside winners

---

## ASC vs Manual Campaign: When to Run Both

**Run both when:**
- Transitioning from manual to ASC (parallel testing for 14-30 days)
- ASC handles broad prospecting, manual handles specific retargeting audiences
- Testing new creative in manual before graduating to ASC
- Budget is large enough to support both without splitting data

**Audience overlap concern:**
- ASC and manual campaigns will compete in the same auctions
- Meta's auction system prevents you from bidding against yourself for the same impression
- However, splitting budget between ASC and manual means each has less data
- Long-term: most advertisers consolidate into ASC once performance is proven

---

## Troubleshooting ASC

| Issue | Likely Cause | Fix |
|-------|-------------|-----|
| ASC not spending | Existing customer cap too low (0%) or audience too small in selected country | Increase cap to 15%, verify country has sufficient audience |
| CPA much higher than manual campaigns | Learning phase (wait 14 days), or creative not suited for broad audience | Wait for learning, then refresh creative with broader appeal |
| All spend going to existing customers | Existing customer cap too high | Lower cap to 15-20% |
| Creative not getting impressions | Too many creatives competing (algorithm concentrating on top 2-3) | Reduce to 10-15 creatives, ensure diversity |
| Performance declined after 30+ days | Creative fatigue | Refresh 30-50% of creative with new concepts |
