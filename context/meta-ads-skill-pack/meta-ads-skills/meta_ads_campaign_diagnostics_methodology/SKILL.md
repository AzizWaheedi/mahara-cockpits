---
name: campaign_diagnostics_methodology
description: Systematic root-cause analysis framework for diagnosing underperforming Meta Ads campaigns. Provides an 8-branch diagnostic tree covering measurement, delivery, audience, creative, landing page, budget, bidding, and external factors. Each branch specifies diagnostic data to pull and resolution actions. Referenced by investigate-campaign action skill.
---

# Campaign Diagnostics Methodology

## Purpose

This skill provides a structured root-cause analysis framework for diagnosing underperforming Meta Ads campaigns. Instead of guessing or making random changes, media buyers work through an 8-branch diagnostic tree that systematically isolates the problem. Each branch specifies what data to pull, what red flag thresholds to watch for, and what resolution actions to take. The goal is to move from "this campaign isn't working" to "here's exactly why, and here's the fix" in under 30 minutes.

## Core Principle: Diagnose Before You Treat

The most common mistake in campaign management is making changes without understanding the root cause. Raising budget doesn't fix a creative fatigue problem. Changing audiences doesn't fix a measurement problem. This framework ensures you identify the real issue before spending time and budget on fixes.

**Diagnostic order matters.** Always start with Branch 1 (Measurement). If your measurement is broken, every other metric is unreliable. Work through branches in order -- each one assumes the prior branches have been cleared.

---

## The 8-Branch Diagnostic Tree

```
Campaign Underperforming
├── Branch 1: MEASUREMENT -- Is the problem real?
├── Branch 2: DELIVERY -- Is the campaign delivering?
├── Branch 3: AUDIENCE -- Is targeting the issue?
├── Branch 4: CREATIVE -- Is creative the problem?
├── Branch 5: LANDING PAGE -- Is post-click the issue?
├── Branch 6: BUDGET -- Is budget the constraint?
├── Branch 7: BIDDING -- Is bid strategy wrong?
└── Branch 8: EXTERNAL -- Is it outside Meta?
```

---

## Branch 1: Measurement -- Is the Problem Real?

**Why start here:** If your pixel is misfiring, CAPI is down, or your attribution window changed, the "problem" you're seeing in the dashboard may not reflect reality. Fix measurement before diagnosing anything else.

### Data to Pull

| Check | Where to Find It | Tool |
|-------|-------------------|------|
| Pixel firing status | Events Manager > Data Sources > Pixel | Events Manager |
| CAPI connection status | Events Manager > Data Sources > CAPI tab | Events Manager |
| Event match quality (EMQ) | Events Manager > Data Sources > Overview | Events Manager |
| Attribution setting | Ad Set level > Attribution Setting | Ads Manager |
| Event deduplication | Events Manager > Test Events > check for duplicates | Events Manager |
| Delayed attribution | Compare 1-day, 7-day, 28-day windows | Ads Manager columns |

### Red Flag Thresholds

| Signal | Threshold | Severity |
|--------|-----------|----------|
| Pixel not firing on key pages | Any pages missing | Critical |
| CAPI disconnected or erroring | Connection status != Active | Critical |
| EMQ score below 6.0 | <6.0 (scale of 1-10) | High |
| Event deduplication not configured | Duplicate events appearing in test | High |
| Attribution window recently changed | Any change in last 14 days | Medium |
| Delayed attribution gap >20% | 1-day view shows 20%+ fewer conversions than 7-day | Medium |

### Resolution Actions

**Pixel not firing:**
1. Check if the pixel base code is on all pages (use Meta Pixel Helper Chrome extension)
2. Verify event-specific code on conversion pages (Purchase, Lead, AddToCart)
3. Check for ad blockers or consent management tools blocking the pixel
4. Test with Meta's Test Events tool to confirm firing in real-time

**CAPI issues:**
1. Check server-side integration status in Events Manager
2. Verify the access token hasn't expired
3. Check server logs for failed API calls (look for 400/500 responses)
4. Confirm the dataset_id matches your pixel ID
5. For Shopify/WooCommerce: check the native CAPI integration toggle

**Low EMQ score:**
1. Send more customer information parameters (email, phone, IP, user agent, fbc, fbp)
2. Hash PII before sending (SHA-256, lowercase, trimmed)
3. Ensure the external_id parameter is consistent across events
4. Send events within 1 hour of occurrence (fresher = better matching)

**Deduplication problems:**
1. Ensure both browser pixel and CAPI send the same event_id for each event
2. Use a unique transaction ID or session-based ID as the event_id
3. Verify in Test Events that each real-world action generates exactly one event

**Attribution window changes:**
1. Document the change and when it took effect
2. Compare performance using the same attribution window (use the comparison columns in Ads Manager)
3. Wait 7 days before drawing conclusions on the new window
4. If you switched from 7-day click + 1-day view to 7-day click only, expect reported conversions to drop 10-30% (this is a reporting change, not a performance change)

### Branch 1 Decision

- If any critical measurement issues found: Fix measurement first, wait 48-72 hours, then reassess
- If measurement is clean: Proceed to Branch 2

---

## Branch 2: Delivery -- Is the Campaign Delivering?

**Why this matters:** A campaign can't perform if it's not spending. Delivery issues are often silent -- the campaign is "active" but barely delivering impressions.

### Data to Pull

| Check | Where to Find It | What to Look For |
|-------|-------------------|------------------|
| Learning phase status | Ad Set level > Delivery column | "Learning," "Learning Limited," or "Active" |
| Audience size | Ad Set level > Audience Definition | Estimated audience size |
| Daily spend vs budget | Campaign/Ad Set level | Spend as % of daily budget |
| Account spending limit | Billing > Account Spending Limit | Any cap set |
| Ad disapprovals | Ad level > Delivery column | "Rejected" or "With Issues" |
| Delivery estimate | Ad Set level > hover on delivery | "Your ad set may not spend" warnings |

### Red Flag Thresholds

| Signal | Threshold | Severity |
|--------|-----------|----------|
| Learning Limited status | Persists >7 days | High |
| Audience size <1M | Prospecting ad sets | High |
| Spend <50% of daily budget | 3+ consecutive days | High |
| Account spending limit reached | Any | Critical |
| Ad disapproved | Any ad | Medium-Critical |
| "May not spend" delivery estimate | Any ad set | High |
| Learning phase not exiting | >7 days without 50 optimization events | High |

### Resolution Actions

**Stuck in Learning Limited:**
1. Consolidate ad sets (fewer ad sets = more events per ad set = faster learning)
2. Move the optimization event earlier in the funnel (e.g., AddToCart instead of Purchase)
3. Increase budget to generate 50+ optimization events per week per ad set
4. Reduce the number of active ads per ad set to concentrate delivery
5. Avoid making edits during learning phase (each significant edit resets learning)

**Audience too small:**
1. Broaden targeting (remove stacked interest restrictions)
2. Use Advantage+ Audience with suggestions instead of hard restrictions
3. Test broader lookalike percentages (3-5% instead of 1%)
4. Consider geographic expansion if feasible
5. For B2B: audience sizes under 500K are common -- ensure budget is proportional

**Low spend vs budget:**
1. Check if bid/cost cap is too restrictive (try increasing by 20%)
2. Review ad relevance diagnostics for quality signals
3. Check for overlapping audiences across ad sets (auction overlap)
4. Verify billing method and payment status
5. Check if the campaign is scheduled (time-based delivery restrictions)

**Ad disapprovals:**
1. Review the specific policy violation in the Ad level details
2. Common violations: personal attributes ("Are you struggling with..."), before/after images, unsubstantiated claims, special category requirements
3. Edit the ad to comply, or request a review if you believe it's a false positive
4. Appeals: Ad level > select ad > Request Review
5. For repeated disapprovals: review Meta's Advertising Standards before creating new ads

### Branch 2 Decision

- If delivery issues found: Fix delivery, wait 48 hours for re-stabilization
- If delivery is healthy: Proceed to Branch 3

---

## Branch 3: Audience -- Is Targeting the Issue?

**Why this matters:** Even with good creative and measurement, targeting the wrong people or oversaturating an audience will tank performance.

### Data to Pull

| Check | Where to Find It | What to Look For |
|-------|-------------------|------------------|
| Frequency | Ad Set or Ad level > Frequency column | Rolling 7-day frequency |
| Audience overlap | Audiences tool > select 2+ audiences > Show Overlap | Percentage overlap between ad sets |
| Audience size | Ad Set level > Audience Definition | Estimated reach |
| Advantage+ expansion | Ad Set level > Detailed Targeting > Advantage+ toggle | How much budget is going to expanded audience |
| Demographic breakdowns | Ad Set level > Breakdown > By Demographics | Age, gender, region performance |
| Placement breakdown | Ad Set level > Breakdown > By Placement | Which placements are consuming budget |

### Red Flag Thresholds

| Signal | Threshold | Severity |
|--------|-----------|----------|
| Prospecting frequency >3.0 | Rolling 7-day | High |
| Retargeting frequency >7.0 | Rolling 7-day | Medium |
| Audience overlap >30% | Between active ad sets | High |
| Audience size <500K | Prospecting (non-B2B) | Medium |
| Audience size >50M | With budget <$500/day | Low-Medium |
| Advantage+ expansion >50% of spend | Check delivery insights | Medium |
| Single demo segment >60% of spend | Without intentional skew | Medium |

### Resolution Actions

**High frequency (audience saturation):**
1. Expand audience size (broader interests, larger lookalikes)
2. Add new seed audiences for lookalikes
3. Move to Advantage+ Audience with broad suggestions
4. Increase creative rotation (new ads reduce perceived frequency)
5. If retargeting: reduce window (14-day instead of 30-day) to shrink pool to more engaged users

**High audience overlap:**
1. Consolidate overlapping ad sets into a single ad set (Meta's recommended approach)
2. Use exclusions to carve distinct audiences (exclude Custom Audience A from Ad Set B)
3. Switch to Advantage+ Audience and let Meta deduplicate
4. Different ad sets should target meaningfully different audiences, not minor interest variations

**Audience too narrow (<500K):**
1. Remove stacked interest restrictions
2. Broaden lookalike percentage (1% = ~2.5M in US, 5% = ~12.5M)
3. Use Advantage+ Audience with narrow interests as "suggestions" rather than restrictions
4. Test going fully broad (no targeting) with strong creative -- Meta's algorithm often outperforms manual targeting

**Audience too broad for budget:**
1. Not inherently a problem -- Meta will find the best users within the audience
2. If CPA is high with broad audience: the issue is likely creative, not audience size
3. Consider whether broad + cost cap is a better approach than narrow targeting
4. Only narrow if you have strong evidence that your product serves a specific demo

**Advantage+ expansion eating budget:**
1. Check Delivery Insights for expansion vs core audience performance
2. If expansion CPA is significantly higher: disable Advantage+ Detailed Targeting
3. If expansion CPA is similar or better: let it run (Meta found convertible users outside your targeting)
4. Use Advantage+ Audience instead, where your targeting inputs are "suggestions" with more transparent control

### Branch 3 Decision

- If audience issues found: Implement targeting changes, allow 3-5 days for re-learning
- If audience is healthy: Proceed to Branch 4

---

## Branch 4: Creative -- Is Creative the Problem?

**Why this matters:** Creative is the single largest performance lever in Meta Ads. In a world of broad targeting and algorithmic optimization, the ad itself determines who sees it and whether they convert.

### Data to Pull

| Check | Where to Find It | What to Look For |
|-------|-------------------|------------------|
| CTR trend | Ad level > CTR column > compare 7-day periods | Decline from peak |
| Hook rate (ThruPlay or 3-sec video views / impressions) | Ad level > Video metrics | <25% = weak hook |
| Ad Relevance Diagnostics | Ad level > columns > Quality, Engagement, Conversion | Below Average on any dimension |
| Creative age | Ad level > check launch date | Days since launch |
| Format distribution | Ad level > sort by format | Over-reliance on single format |
| Text-to-image ratio | Visual inspection of ad | >20% text on image can reduce delivery |

### Red Flag Thresholds

| Signal | Threshold | Severity |
|--------|-----------|----------|
| CTR decline >10% from peak | Rolling 7-day vs peak 7-day | High (creative fatigue) |
| Hook rate <25% | 3-sec video view rate | High |
| Quality ranking: Below Average | Ad Relevance Diagnostics | High |
| Engagement ranking: Below Average | Ad Relevance Diagnostics | Medium-High |
| Conversion ranking: Below Average | Ad Relevance Diagnostics | Medium (often a landing page issue) |
| All ads >30 days old | No fresh creative in pipeline | High |
| Single format >80% of spend | Format diversification check | Medium |

### Resolution Actions

**Creative fatigue (CTR declining):**
1. Do not raise budget on fatigued creative -- it accelerates decay
2. Launch 3-5 new concepts immediately (not minor variations of the fatigued ad)
3. Test new hooks on the same body content (hook swap method)
4. Introduce a new format (if fatigued ad is static, test video; if video, test UGC)
5. Reduce spend on fatigued ads by 30-50% while new creative ramps
6. See `creative_strategy_methodology` for full fatigue detection protocol

**Weak hooks (<25% hook rate):**
1. Test pattern-interrupt hooks (unexpected visuals, bold text overlays, movement)
2. Open with the result/transformation, not the problem
3. Use "native" formats that blend with organic content
4. Test UGC-style openings ("I can't believe this actually worked...")
5. For video: the first frame matters most -- make it visually arresting even as a still

**Poor Ad Relevance Diagnostics:**
1. Quality Ranking below average: Ad is perceived as low quality. Improve visual quality, reduce clickbait elements, check for policy-adjacent content
2. Engagement Ranking below average: People aren't interacting. Improve hook, make the ad more thumb-stopping, test different formats
3. Conversion Ranking below average: Post-click experience is the issue. Check landing page (Branch 5)

**Text-to-image ratio issues:**
1. Meta no longer hard-blocks >20% text, but heavy text reduces delivery and increases CPM
2. Use Meta's Text Overlay tool to check
3. Move text to primary text field instead of overlaying on the image
4. If text is essential (comparison charts, statistics): test with and without to measure delivery impact

### Branch 4 Decision

- If creative issues found: Launch new creative, monitor for 5-7 days
- If creative is healthy: Proceed to Branch 5

---

## Branch 5: Landing Page -- Is Post-Click the Issue?

**Why this matters:** A campaign can generate efficient clicks but still fail if the landing page doesn't convert. Post-click issues are invisible in Ads Manager unless you actively look.

### Data to Pull

| Check | Where to Find It | What to Look For |
|-------|-------------------|------------------|
| Bounce rate | Google Analytics / PostHog | Landing page bounce rate by traffic source |
| Page load time | Google PageSpeed Insights / WebPageTest | Mobile load time |
| Conversion rate | Analytics platform | Landing page CVR vs site average |
| Mobile experience | Manual testing or BrowserStack | Usability on mobile devices |
| Redirect chains | Browser DevTools > Network tab | Redirects between click and landing |
| Message match | Compare ad copy to landing page headline | Consistency of promise |

### Red Flag Thresholds

| Signal | Threshold | Severity |
|--------|-----------|----------|
| Bounce rate >70% | From paid traffic | High |
| Mobile load time >3 seconds | Measured on 4G connection | High |
| Conversion rate <50% of site average | Paid traffic vs organic | High |
| Redirect chain >2 hops | Click to final landing page | Medium |
| No message match | Ad promise != landing page headline | High |
| Form >5 fields | Lead gen landing pages | Medium |
| No mobile optimization | Non-responsive design | Critical |

### Resolution Actions

**High bounce rate (>70%):**
1. Check page load time first -- slow pages cause bounces before content is even seen
2. Verify message match: does the landing page immediately reinforce the ad's promise?
3. Check for intrusive popups or cookie banners blocking content
4. Ensure above-the-fold content answers "Am I in the right place?" within 2 seconds
5. Test with a simpler, more focused landing page (remove navigation, reduce choices)

**Slow mobile load time (>3 seconds):**
1. Compress images (WebP format, lazy loading)
2. Minimize JavaScript and CSS (defer non-critical scripts)
3. Use a CDN for static assets
4. Eliminate render-blocking resources
5. Target <2 seconds for mobile on a 4G connection
6. Consider AMP pages or lightweight landing page builders for high-traffic campaigns

**Low conversion rate:**
1. Ensure CTA is visible above the fold on mobile
2. Reduce friction (fewer form fields, clearer next step)
3. Add social proof near the CTA (testimonials, user count, trust badges)
4. Test different offers (free trial vs demo vs content download)
5. Run a session recording analysis (Hotjar, FullStory) to see where users drop off
6. A/B test the landing page independently from ad changes

**Redirect chains:**
1. Update ad URLs to point directly to the final destination
2. Remove unnecessary tracking redirects (consolidate into UTM parameters)
3. Each redirect adds 100-500ms of load time and risks breaking on mobile
4. Check that HTTPS redirects are not creating HTTP > HTTPS chains

**Message mismatch:**
1. The landing page headline should echo or extend the ad's core promise
2. If the ad says "Save 3 hours per day on email," the landing page should lead with time savings
3. Visual continuity: similar colors, imagery, and tone between ad and page
4. Create dedicated landing pages for major ad themes rather than sending all traffic to the homepage

### Branch 5 Decision

- If landing page issues found: Fix and monitor for 7-14 days (landing page changes need more data)
- If landing page is healthy: Proceed to Branch 6

---

## Branch 6: Budget -- Is Budget the Constraint?

**Why this matters:** Budget constraints can silently cap performance. An ad set that's limited by budget can't reach its potential -- Meta stops serving ads once the budget is exhausted, even if there are more profitable impressions available.

### Data to Pull

| Check | Where to Find It | What to Look For |
|-------|-------------------|------------------|
| Daily spend vs budget | Campaign/Ad Set level | Spend as % of budget |
| Learning phase status | Ad Set level > Delivery | Need 50 events/week to exit |
| Number of active ad sets | Campaign level | Budget fragmentation |
| CBO vs ABO | Campaign level | Budget allocation method |
| Budget changes in last 7 days | Activity log | Recent scaling or cuts |

### Red Flag Thresholds

| Signal | Threshold | Severity |
|--------|-----------|----------|
| Spend >95% of budget | Consistently hitting cap | High (budget-constrained) |
| Learning Limited due to budget | Not enough events to exit learning | High |
| >5 ad sets splitting CBO budget | Budget spread too thin | Medium-High |
| Budget changed >20% in 7 days | Multiple changes | Medium (learning phase resets) |
| ABO with uneven spend | Some ad sets spending <20% of budget | Medium |

### Resolution Actions

**Budget-constrained (spending >95%):**
1. Increase budget by 20% every 48-72 hours (gradual scaling preserves learning)
2. Do not double budget overnight -- this resets learning phase and spikes CPAs
3. If CPA is efficient at current budget, scale is justified
4. Consider campaign budget optimization (CBO) to auto-allocate to best performers
5. Set up automated rules: if CPA < target AND spend > 90% of budget, increase by 20%

**Learning Limited due to insufficient events:**
1. Each ad set needs ~50 optimization events per week to exit learning
2. At a $100 CPA target, that means $5,000/week minimum per ad set ($714/day)
3. Options: increase budget, consolidate ad sets, optimize for an earlier-funnel event
4. Consolidation is usually the best first move -- fewer ad sets with more budget each
5. Consider switching from Purchase to AddToCart optimization if volume is too low

**Too many ad sets fragmenting budget:**
1. Audit which ad sets are actually differentiated (different audiences, different creative)
2. Merge similar ad sets -- Meta's algorithm performs better with consolidated structure
3. For CBO: 3-5 ad sets per campaign is the sweet spot
4. For ABO: ensure each ad set has enough budget for 50+ weekly events at your target CPA

**Frequent budget changes disrupting learning:**
1. Each significant budget change (>20%) can reset the learning phase
2. Plan budget changes in advance, make them less frequent
3. Use automated rules for gradual scaling instead of manual jumps
4. If you need to cut budget: reduce by 20% max at a time, wait 48 hours between cuts

### Branch 6 Decision

- If budget issues found: Restructure and wait 3-5 days for learning to stabilize
- If budget is healthy: Proceed to Branch 7

---

## Branch 7: Bidding -- Is Bid Strategy Wrong?

**Why this matters:** The wrong bid strategy for your campaign's maturity level can either cap scale (too restrictive) or waste budget (too loose). Bid strategy should evolve as campaigns mature.

### Data to Pull

| Check | Where to Find It | What to Look For |
|-------|-------------------|------------------|
| Current bid strategy | Campaign level > Bid Strategy | Lowest Cost, Cost Cap, Bid Cap, ROAS Target |
| CPA vs target | Ad Set level | Actual CPA relative to cost/bid cap |
| Spend vs budget | Campaign/Ad Set level | Under-delivery due to restrictive caps |
| Campaign age | Activity log | Days since launch or last major change |
| Conversion volume | Ad Set level | Weekly conversion count |

### Red Flag Thresholds

| Signal | Threshold | Severity |
|--------|-----------|----------|
| CPA >30% above target | With Cost Cap or Bid Cap set | High |
| Spending <50% of budget | With Cost Cap set | High (cap too restrictive) |
| Lowest Cost with volatile CPA | CPA swings >30% day-to-day | Medium |
| Bid Cap with zero conversions | Bid too low for the auction | Critical |
| ROAS Target with low volume | <10 conversions/week | High |
| Strategy mismatch for stage | New campaign using Bid Cap | Medium-High |

### Resolution Actions

**Bid strategy selection by maturity:**

| Campaign Stage | Recommended Strategy | Why |
|----------------|---------------------|-----|
| Launch (week 1-2) | Lowest Cost (no cap) | Let Meta explore the auction, gather data |
| Learning (week 2-4) | Lowest Cost or Cost Cap (generous) | Set cost cap at 1.5x your target CPA |
| Stable (month 2+) | Cost Cap (at target) | Control efficiency while maintaining scale |
| Scaling (proven campaigns) | Cost Cap or Bid Cap | Bid Cap for maximum control at high spend |
| Efficiency-first | Bid Cap | Hard ceiling on cost, but limits scale |
| Value optimization | ROAS Target | Requires sufficient purchase value data |

**Cost Cap too restrictive (spending <50%):**
1. Increase cost cap by 10-20% and monitor for 48 hours
2. If still under-delivering: your target CPA may be unrealistic for this audience
3. Test removing the cost cap temporarily to see what Meta's natural CPA is
4. The natural CPA tells you the floor -- your cost cap should be near this, not far below it
5. Cost cap = average target, not a hard ceiling. Expect some conversions above the cap.

**CPA significantly above target:**
1. With Cost Cap: Meta will try to average to the cap, but individual conversions will vary. Give it 50+ conversions to evaluate.
2. If CPA remains high after 50+ conversions: the issue is likely creative or audience, not bidding
3. With Lowest Cost: CPA is uncapped, so spikes are expected. Add a cost cap to stabilize.
4. Check if competition has increased (CPM rising across the account = market-level change)

**Bid Cap yielding zero conversions:**
1. Your bid is below the clearing price for your audience
2. Increase bid by 20-30% or switch to Cost Cap temporarily
3. Bid Cap is a hard ceiling -- if the auction price exceeds your bid, you get zero delivery
4. Only use Bid Cap when you have strong data on your viable CPA range

**ROAS Target with low volume:**
1. ROAS optimization needs significant purchase value data to work
2. Minimum: 30-50 purchases per week with value data
3. If volume is too low: switch to purchase count optimization (Lowest Cost or Cost Cap)
4. Ensure the Pixel/CAPI is passing purchase value accurately

### Branch 7 Decision

- If bidding issues found: Adjust strategy, wait 3-5 days for re-learning
- If bidding is healthy: Proceed to Branch 8

---

## Branch 8: External -- Is It Outside Meta?

**Why this matters:** Sometimes the problem isn't your campaigns at all. Seasonality, competitive shifts, platform changes, and privacy updates can all impact performance without anything being "wrong" in your account.

### Data to Pull

| Check | Where to Find It | What to Look For |
|-------|-------------------|------------------|
| CPM trends (account-wide) | Account level > CPM column > last 30 days | Rising CPMs across all campaigns |
| Competitor activity | Meta Ad Library (facebook.com/ads/library) | New competitors, increased spend |
| Platform announcements | Meta Business Blog, Ads Manager notifications | API changes, feature deprecations |
| Seasonal patterns | Year-over-year data, industry calendars | Holiday peaks, Q1 dips, election cycles |
| Industry CPM benchmarks | Industry reports, peer networks | Whether CPM changes are market-wide |
| iOS/privacy changes | Meta documentation, industry news | New privacy restrictions or OS updates |

### Red Flag Thresholds

| Signal | Threshold | Severity |
|--------|-----------|----------|
| Account-wide CPM increase >20% | Last 14 days vs prior 14 days | Medium-High |
| New major competitor in Ad Library | Running >50 ads in your category | Medium |
| Platform policy change affecting your vertical | Any announced change | High |
| Seasonal period known to affect your vertical | Election season, holidays, Q1 | Medium |
| iOS update recently released | Major version (e.g., iOS 19) | Medium |

### Resolution Actions

**Rising CPMs (market-wide):**
1. Confirm it's market-wide, not account-specific (check industry benchmarks, peer accounts)
2. If market-wide: adjust CPA targets temporarily, focus on creative efficiency
3. Typical CPM spikes: Black Friday week (+40-80%), Q4 (+20-40%), election season (+15-30% in US), Q1 dip (-10-20%)
4. During high-CPM periods: focus on highest-intent audiences, tighten retargeting, pause marginal prospecting
5. Plan creative sprints before known CPM peaks (you need your best creative when costs are highest)

**Competitor escalation:**
1. Monitor competitors in Meta Ad Library monthly
2. If a competitor is running 100+ ads: they're likely scaling aggressively, expect higher CPMs in shared audiences
3. Differentiate on creative (your audience is seeing their ads too -- stand out, don't blend in)
4. Consider shifting budget to audiences your competitor isn't targeting
5. Review their landing pages and offers to ensure your value proposition is competitive

**Platform changes:**
1. Stay current with Meta's quarterly API updates and feature changes
2. Subscribe to Meta Business Blog and the Meta for Developers changelog
3. Major changes to monitor: attribution model updates, pixel/CAPI requirements, Advantage+ feature changes, audience targeting deprecations
4. When Meta announces a change: test early, don't wait for forced migration

**Seasonality:**
1. Build a seasonality calendar for your vertical (document CPM and CVR patterns by month)
2. Q1 (January-March): typically lowest CPMs, good time to test and prospect
3. Q4 (October-December): highest CPMs, focus on proven winners and retargeting
4. Plan budget allocation around seasonal patterns (not flat monthly budgets)

**Privacy/iOS changes:**
1. Ensure CAPI is implemented and healthy (this is your hedge against browser-side tracking loss)
2. Monitor EMQ scores after any iOS update
3. Use broad targeting + strong creative rather than relying on granular audience data
4. Conversion API is no longer optional -- it's the primary measurement signal for post-iOS14.5 advertising

### Branch 8 Decision

- If external factors identified: Adapt strategy to the macro environment, communicate realistic expectations to stakeholders
- If no external factors: Revisit Branches 1-7 with fresh eyes or escalate to a peer review

---

## Diagnostic Workflow Quick Reference

### Step-by-Step Protocol

1. **Identify the symptom**: What metric is underperforming? (CPA, ROAS, volume, CPC, CTR)
2. **Establish baselines**: Compare against the campaign's own historical performance, not arbitrary benchmarks
3. **Set a timeframe**: Use rolling 7-day windows, never judge on a single day
4. **Work through branches**: Start at Branch 1, proceed sequentially
5. **Stop at the first root cause**: Don't make changes to multiple branches simultaneously
6. **Implement one fix**: Make a single change, then monitor for 48-72 hours
7. **Re-diagnose**: If the fix didn't work, proceed to the next branch

### Common Symptom-to-Branch Mapping

| Symptom | Start With Branch |
|---------|-------------------|
| CPA suddenly spiked (all campaigns) | Branch 1 (Measurement) then Branch 8 (External) |
| CPA gradually increasing | Branch 4 (Creative fatigue) then Branch 3 (Audience saturation) |
| Spending way under budget | Branch 2 (Delivery) then Branch 7 (Bidding) |
| Good clicks but no conversions | Branch 5 (Landing Page) then Branch 1 (Measurement) |
| Conversions dropped suddenly | Branch 1 (Measurement) then Branch 8 (External) |
| CPM spiked | Branch 3 (Audience) then Branch 8 (External) |
| CTR declining | Branch 4 (Creative) then Branch 3 (Audience) |
| New campaign not exiting learning | Branch 6 (Budget) then Branch 2 (Delivery) |
| ROAS below target | Branch 7 (Bidding) then Branch 5 (Landing Page) |

### Time-to-Resolution Expectations

| Issue Type | Expected Fix Time | Monitoring Period |
|------------|-------------------|-------------------|
| Measurement fix | 24-48 hours | 72 hours |
| Delivery fix | 24-48 hours | 48 hours |
| Audience restructure | 3-5 days | 7 days |
| Creative refresh | 5-7 days | 7-14 days |
| Landing page fix | 1-3 days | 7-14 days |
| Budget restructure | 3-5 days | 7 days |
| Bid strategy change | 3-5 days | 7 days |
| External factors | Ongoing adaptation | Continuous |

---

## Multi-Branch Issues

In practice, many problems span multiple branches. Here's how to handle compound issues:

### Creative Fatigue + Audience Saturation (Most Common Combo)
**Signals:** CTR declining AND frequency >3.0
**Fix order:** Launch new creative first (Branch 4), then expand audience (Branch 3). New creative buys you time while audience changes take effect.

### Measurement + Landing Page (Silent Killer)
**Signals:** Conversions dropped but clicks are stable
**Fix order:** Verify measurement first (Branch 1). If measurement is clean, it's a landing page issue (Branch 5). Don't waste time on Branches 2-4 when clicks are healthy.

### Budget + Bidding (Scaling Bottleneck)
**Signals:** Spending <70% of budget with cost cap enabled
**Fix order:** Evaluate if cost cap is realistic (Branch 7). If competitive CPA data supports the cap, it's a budget allocation issue (Branch 6). If you're new to the audience, remove the cap temporarily.

---

## Reference Files

- `references/diagnostic_tree.md` - Full visual decision tree with all branches
- `references/common_issues.md` - Top 20 most common Meta Ads issues with solutions
- `references/delivery_troubleshooting.md` - Deep dive on delivery issues
