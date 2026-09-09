---
name: account_maturity_methodology
description: Four-stage maturity model for Meta Ads accounts based on monthly conversion volume and spend level. Calibrates every recommendation across the entire Meta Ads toolkit so guidance matches the account's sophistication level. Referenced by all action skills during Step 0.
---

# Account Maturity Methodology

## Purpose

This skill defines how the toolkit classifies Meta Ads accounts into four maturity stages and how that classification shapes every recommendation. Every action skill in the toolkit reads the `maturity_level` field from account-conventions at Step 0, then uses this methodology to calibrate its output.

The maturity model prevents the most common Meta Ads consulting mistake: giving advanced recommendations to nascent accounts (wasting budget on strategies that need data volume to work) or giving basic recommendations to advanced accounts (leaving performance on the table).

## How Skills Reference This Methodology

At Step 0, every skill:
1. Reads `maturity_level` from the active account's config
2. Loads the corresponding stage from this methodology
3. Filters its recommendations through the stage's guidance
4. Notes in its output header: "Account maturity: [Stage] -- recommendations calibrated accordingly"

If the skill determines the account may have been mis-classified (e.g., the data suggests more sophistication than the config indicates), it flags this in its output and recommends re-running the maturity assessment.

---

## The Four Stages

### Stage 1: Nascent

**Classification criteria:** fewer than 30 conversions/month OR less than $3,000/month spend

**Account profile:** New ad account, brand new to Meta Ads, or restarting after a long pause. The Meta Pixel/CAPI has limited event history. The algorithm has almost no signal to optimize against. Every dollar spent is an investment in data collection as much as customer acquisition.

#### Bid Strategy
- **Use:** Lowest Cost (automatic bidding) exclusively
- **Rationale:** Cost Cap, Bid Cap, and Minimum ROAS all require a volume of conversions the algorithm doesn't have yet. Lowest Cost lets Meta's delivery system find conversions wherever they exist without constraining it.
- **Avoid:** Cost Cap (will severely under-deliver with limited data), Bid Cap (requires deep understanding of auction dynamics), Minimum ROAS (needs value data the pixel hasn't accumulated)

#### Campaign Structure
- **Use:** 1-2 campaigns maximum
  - Campaign 1: Prospecting (ABO, 2-3 ad sets testing different audiences)
  - Campaign 2 (optional): Retargeting (only if the site has 1,000+ monthly visitors)
- **Rationale:** Consolidation maximizes learning. Spreading thin budget across many campaigns fragments the signal each campaign receives.
- **Avoid:** CBO (Campaign Budget Optimization) at this stage. ABO gives you manual control over which audiences get budget, critical when you can't rely on the algorithm's judgment yet.

#### Creative Volume
- **Target:** 3-5 new creatives per week
- **Types:** Static images and short-form video (under 30 seconds). Keep it simple.
- **Testing:** Manual A/B testing only. Create 2-3 ads per ad set, let them run for 5-7 days, pick winners manually.
- **Avoid:** Dynamic Creative Testing (DCT/Flexible Ads). With fewer than 30 conversions, Meta can't reliably determine which creative combinations work. You'll get noise, not signal.

#### Audience Approach
- **Use:** Interest-based targeting and broad targeting in parallel
  - Ad Set 1: 3-5 stacked interest categories most relevant to the product
  - Ad Set 2: Broad (no targeting, age/gender/geo only)
  - Ad Set 3 (optional): Lookalike 1-3% from email list or site visitors (if seed is 1,000+)
- **Avoid:** Advantage+ Audience at this stage. The algorithm needs historical conversion data to use Advantage+ effectively. Manual targeting gives you control while the pixel learns.
- **Avoid:** Narrow targeting (single interest, small custom audiences). Budget is too limited to afford slow delivery.

#### Measurement
- **Attribution window:** 7-day click (default). Do not change this.
- **Focus metrics:** Link clicks, landing page views, add-to-cart events, cost per click. Conversion volume is too low for CPA/ROAS to be statistically meaningful on short time horizons.
- **Third-party tools:** Not recommended. The data volume doesn't justify the cost. Focus on Meta's native reporting.
- **Action:** Verify Pixel and CAPI implementation. Run the Events Manager diagnostics. Ensure all standard events fire correctly (PageView, ViewContent, AddToCart, InitiateCheckout, Purchase). This is the most valuable thing you can do at this stage.

#### What to Avoid at This Stage
- Advantage+ Shopping Campaigns (ASC): requires 50+ conversions in the last 7 days to optimize
- Value-Based Optimization (VBO): requires consistent purchase value data
- Broad match / interest expansion: too little data for the algorithm to expand intelligently
- Scaling budget: do not increase daily budget by more than 20% in a single day
- Complex campaign structures: anything beyond 2 campaigns fragments limited signal
- Catalog ads / Dynamic Product Ads: need product feed optimization and retargeting pool size

---

### Stage 2: Developing

**Classification criteria:** 30-100 conversions/month AND $3,000-$15,000/month spend

**Account profile:** The pixel has a meaningful conversion history. The algorithm is starting to understand who converts. You have enough data to begin testing more sophisticated strategies, but not enough to go fully automated. This is the experimentation stage.

#### Bid Strategy
- **Use:** Lowest Cost as default, begin testing Cost Cap on your highest-volume campaign
- **Cost Cap testing protocol:**
  1. Set Cost Cap at 20% above your current average CPA
  2. Run for 7 days minimum (need 30+ conversions on the campaign to evaluate)
  3. If delivery is stable and CPA is within target, lower Cost Cap by 10%
  4. If delivery drops below 70% of Lowest Cost delivery, raise Cost Cap or revert
- **Avoid:** Bid Cap (still too early for auction-level control), Minimum ROAS (need 100+ conversions with value data first)

#### Campaign Structure
- **Use:** 3-campaign structure
  - Campaign 1: Prospecting CBO (2-4 ad sets, let CBO allocate between audiences)
  - Campaign 2: Retargeting ABO (separate budget control for warm audiences)
  - Campaign 3: Testing (ABO, isolated creative or audience tests with controlled budget)
- **Rationale:** CBO is now viable for prospecting because the algorithm has enough conversion data to allocate budget intelligently between ad sets. Retargeting stays ABO because pool sizes vary and you need manual control. A dedicated testing campaign prevents tests from disrupting proven campaigns.
- **Transition:** Start moving from ABO to CBO for prospecting. This is the key structural shift at this stage.

#### Creative Volume
- **Target:** 5-8 new creatives per week
- **Types:** Expand to include UGC and carousel alongside static and video
- **Testing:** Begin DCT (Dynamic Creative Testing via Flexible Ads) in the testing campaign. Run each DCT test with 3 headline variants, 3 image/video variants, and 2 CTA variants. Need 50+ conversions on the ad to identify winning combinations.
- **Introduce:** Concept testing. Run 3 different creative concepts simultaneously (e.g., testimonial vs. product demo vs. lifestyle) to discover what resonates.

#### Audience Approach
- **Use:** Layered approach
  - Prospecting: Broad targeting + 1-3% Lookalikes from purchasers
  - Begin testing Advantage+ Audience on one ad set (let Meta expand beyond your defined targeting)
  - Retargeting: Website visitors (7d, 30d, 180d), cart abandoners, IG/FB engagers
- **Lookalikes:** Now viable because you have 100+ purchasers as a seed audience. Start with 1% and expand to 3%, then 5% as you need more reach.
- **Exclusions:** Implement proper exclusion audiences (30-day purchasers excluded from prospecting, all purchasers excluded from retargeting).

#### Measurement
- **Attribution window:** 7-day click (keep default)
- **Focus metrics:** CPA and ROAS become meaningful. Track both weekly. Also monitor frequency, CTR, and hook rate per creative.
- **Introduce:** Weekly reporting cadence. Compare WoW performance across campaigns.
- **Consider:** Third-party attribution tool if running Meta + Google + other channels. At $10K+/month cross-channel, attribution gaps become material.
- **Action:** Audit conversion event setup. Ensure deduplication between Pixel and CAPI events (check Event Match Quality score in Events Manager, target 6.0+).

#### What to Avoid at This Stage
- ASC (Advantage+ Shopping): still needs more conversion volume (target 50+/week)
- Full Advantage+ Audience on all campaigns: keep some manual targeting for control
- Rapid scaling: budget increases above 20%/day still risk resetting learning
- Ignoring creative refresh: at this spend level, creative fatigue is the number one performance killer
- Over-segmenting retargeting: don't create 10 retargeting ad sets with $5/day each

---

### Stage 3: Established

**Classification criteria:** 100-300 conversions/month AND $15,000-$50,000/month spend

**Account profile:** The algorithm has strong signal. You have enough conversion volume for Meta's machine learning to work well across most optimization types. This is where you shift from manual control to algorithmic leverage. Your job transitions from "telling Meta what to do" to "giving Meta the best inputs and getting out of the way."

#### Bid Strategy
- **Use:** Cost Cap as default on prospecting, Lowest Cost on retargeting, test Minimum ROAS on your highest-value campaign
- **Cost Cap:** Should now be your primary bid strategy for prospecting. You have enough data to know your true target CPA. Set it there.
- **Minimum ROAS testing:** If you have purchase value data and 100+ value-tracked conversions, begin testing Minimum ROAS on one campaign. Set floor at 50% of your target ROAS. Evaluate after 50+ conversions.
- **Advanced:** Begin A/B testing bid strategies using Meta's Experiments tool. Run Cost Cap vs. Lowest Cost as a controlled split test.

#### Campaign Structure
- **Use:** Portfolio approach (4-6 campaigns)
  - Campaign 1: ASC (Advantage+ Shopping) -- primary scaling vehicle, CBO
  - Campaign 2: Prospecting CBO -- broad + LAL targeting for audiences ASC doesn't reach
  - Campaign 3: Retargeting CBO -- consolidated warm audiences
  - Campaign 4: Catalog Sales -- dynamic product ads for retargeting
  - Campaign 5: Testing -- isolated creative and audience experiments
  - Campaign 6 (optional): Seasonal / Promotional -- time-bound campaigns
- **ASC transition:** This is the stage where Advantage+ Shopping Campaigns become viable and often become the top-performing campaign type. Feed it your best 5-10 creatives and let the algorithm do the work.
- **Consolidation principle:** Fewer, larger campaigns outperform many small ones. If any campaign has fewer than 20 conversions/week, consider merging it into another.

#### Creative Volume
- **Target:** 8-15 new creatives per week
- **Types:** Full diversification: static, video, UGC, carousel, catalog, collection ads
- **Testing:** DCT is now the default testing method. Run Flexible Ads with systematic variant isolation (change one element at a time to identify what drives performance).
- **Introduce:** Creative performance scoring. Categorize every ad by concept, format, and hook type. Track performance by category to build a creative playbook.
- **Scale:** This is where creative volume becomes the primary lever. The algorithm can optimize delivery, but it can only optimize within the creative options you give it. More good creative = more optimization surface area.

#### Audience Approach
- **Use:** Advantage+ Audience as default targeting method on prospecting
- **Manual targeting:** Keep 1-2 ad sets with manual targeting (broad, LAL) as a control, but Advantage+ Audience should be handling the majority of prospecting budget.
- **Retargeting:** Consolidate into 2-3 audiences maximum (website visitors, engagers, customer list). Over-segmentation reduces the algorithm's ability to optimize.
- **Lookalikes:** 3-10% ranges now viable as the pixel has deep purchase data. Use Value-Based Lookalikes if VBO is active.
- **ASC audience controls:** Use the "existing customer budget cap" in ASC to control retargeting vs. prospecting split. Start at 25-30% existing customer cap.

#### Measurement
- **Attribution window:** 7-day click, 1-day view (broaden the window to capture full impact)
- **Focus metrics:** Blended ROAS/CPA across the full account (not just per-campaign). Also track incrementality indicators: new customer rate, branded search lift.
- **Third-party tool:** Strongly recommended at this spend level. Triple Whale, Northbeam, or Hyros for cross-channel attribution.
- **Introduce:** Meta's Conversion Lift studies (if eligible, requires $50K+ spend in the test period). The gold standard for measuring true incremental impact.
- **Action:** Implement value tracking if not already done. Send purchase value with every conversion event. This unlocks VBO and Value-Based Lookalikes.

#### What to Avoid at This Stage
- Micro-managing individual ad sets: trust the algorithm, manage at the campaign level
- Manual bid adjustments without data: use Experiments tool, not gut feel
- Ignoring ASC: at this volume, not testing ASC is leaving money on the table
- Static audience strategy: audiences should evolve monthly as the pixel learns
- Creative stagnation: even 8 creatives/week may not be enough if accounts scale fast

---

### Stage 4: Advanced

**Classification criteria:** 300+ conversions/month AND $50,000+/month spend

**Account profile:** This is a scaled, sophisticated Meta Ads operation. The algorithm has deep signal across all funnel stages. Every Meta Ads feature is potentially valuable. The focus shifts from "growing into features" to "optimizing the machine" and measuring true incremental impact.

#### Bid Strategy
- **Use:** Portfolio bid strategy approach
  - ASC campaigns: Lowest Cost or Cost Cap (Meta's algorithm handles allocation)
  - High-value prospecting: Minimum ROAS (optimize for value, not volume)
  - Retargeting: Lowest Cost (warm audiences convert efficiently, no need to constrain)
  - Testing: Lowest Cost (maximize learning speed)
- **Advanced:** Bid strategy should vary by campaign purpose, audience temperature, and seasonal demand. During peak periods (BFCM, launches), shift to Lowest Cost with higher budgets to maximize volume. During steady state, use Cost Cap and Minimum ROAS to maintain efficiency.
- **Experiments:** Run continuous bid strategy A/B tests. Always have one experiment active comparing strategies.

#### Campaign Structure
- **Use:** Tiered portfolio (6-10+ campaigns)
  - Tier 1 (Scale): ASC x1-2 (primary revenue driver, 40-50% of budget)
  - Tier 2 (Growth): Prospecting CBO x2-3 (new audiences, geo expansion, 25-30%)
  - Tier 3 (Efficiency): Retargeting CBO x1-2 (warm audiences, catalog, 15-20%)
  - Tier 4 (Testing): Creative + audience experiments x1-2 (5-10%)
  - Tier 5 (Conditional): Seasonal, promotional, or product-specific campaigns
- **Multi-market:** If running multiple geos, each major market may have its own ASC + Prospecting + Retargeting stack. Use geo-specific naming conventions.
- **Budget allocation:** Use the 70/20/10 principle: 70% to proven campaigns, 20% to scaling experiments, 10% to pure tests. Review allocation weekly.

#### Creative Volume
- **Target:** 15-30+ new creatives per week (100+ per month)
- **Types:** All formats, with emphasis on variety. At this spend level, creative diversity is the primary performance lever.
- **Testing:** Multiple testing tracks running simultaneously:
  - Track 1: Concept testing (which story/angle resonates)
  - Track 2: Format testing (static vs. video vs. UGC vs. carousel)
  - Track 3: Hook testing (first 3 seconds of video)
  - Track 4: Iteration on proven winners (new variants of top performers)
- **Creative analytics:** Build a creative performance database. Track metrics by concept, creator, format, hook type, CTA, and product featured. Use this data to brief new creative.
- **Production:** At this volume, you need a creative production system: in-house team, agency, or a platform like Foreplay + creative partners. Ad hoc creative production cannot sustain 100+/month.

#### Audience Approach
- **Use:** Fully algorithmic targeting with strategic overrides
  - ASC: Advantage+ Audience with existing customer budget cap (15-25%)
  - Prospecting: Advantage+ Audience with audience suggestions (provide LAL seeds and interest signals as "suggestions" rather than hard constraints)
  - Retargeting: Broad retargeting audiences (180d visitors, all engagers) consolidated into single ad sets
- **Advanced audiences:** Value-Based Lookalikes from top 10% LTV customers. International expansion LALs using domestic customer data as seeds.
- **Incrementality testing:** Use Meta's A/B test tool to measure the incremental lift of different audience strategies. Run holdout tests (expose vs. don't expose) quarterly.
- **Audience refresh:** Automate audience refreshes on a monthly cadence. Customer lists should sync via integration (not manual upload).

#### Measurement
- **Attribution:** Multi-touch attribution via third-party tool is essential. Do not rely solely on Meta's reported ROAS at this spend level.
- **Incrementality:** Run Conversion Lift studies quarterly. This is the only way to know Meta's true incremental impact beyond what would have happened organically.
- **Custom attribution models:** Build a blended model that weights Meta's reported data, third-party attribution, and incrementality test results. Common formula: `True ROAS = (Meta reported ROAS * 0.4) + (Third-party ROAS * 0.35) + (Incremental ROAS * 0.25)`
- **Media Mix Modeling:** At $600K+/year Meta spend, invest in MMM (Robyn, Meridian, or paid tools) to understand Meta's role in the overall marketing mix.
- **Dashboarding:** Automated daily dashboards pulling from Meta API, third-party tool, and revenue source. Manual reporting at this scale is a liability.

#### What to Avoid at This Stage
- Over-reliance on single campaigns: diversification protects against algorithmic shifts
- Ignoring incrementality: Meta's reported ROAS overestimates true impact at scale
- Creative complacency: "good enough" creative at $50K+/month is a massive opportunity cost
- Manual processes: anything that can be automated should be (audience syncs, reporting, alerts)
- Platform tunnel vision: at this spend level, Meta's performance is intertwined with Google, email, organic, and brand investment. Analyze holistically.
- Assuming past performance guarantees future results: algorithm behavior changes with Meta product updates, iOS changes, and competitive dynamics. Stay adaptive.

---

## Maturity Progression Triggers

Accounts should be re-assessed monthly. An account is ready to advance when:

| From | To | Trigger |
|------|----|---------|
| Nascent | Developing | 30+ conversions in a single 30-day period AND $3K+ monthly spend sustained for 2+ months |
| Developing | Established | 100+ conversions/month sustained for 3+ months AND $15K+ monthly spend AND CAPI verified |
| Established | Advanced | 300+ conversions/month sustained for 3+ months AND $50K+ monthly spend AND third-party attribution in place |

An account can also regress. Common causes:
- Seasonal dips dropping conversion volume below stage thresholds for 2+ months
- Budget cuts reducing spend below stage minimums
- Pixel/CAPI issues degrading data quality (treat as Nascent until resolved)
- Major platform changes requiring strategy reset (rare, but happens with large iOS-type shifts)

## Cross-Stage Principles

These principles apply regardless of maturity level:

1. **Consolidation over fragmentation.** Fewer, larger campaigns always outperform many small ones on Meta. The algorithm needs data density to optimize.
2. **Creative is the primary lever.** At every stage, the biggest performance improvement comes from better creative, not better targeting. Meta's algorithm can find your audience; it can only work with the creative you give it.
3. **Measurement accuracy scales with spend.** At $3K/month, Meta's native reporting is "good enough." At $50K/month, it's dangerously misleading without third-party verification.
4. **Learning phase is sacred.** Every significant edit to a campaign resets the learning phase (~50 conversions to exit). Batch changes. Don't tinker daily.
5. **Budget changes should be gradual.** Never increase daily budget by more than 20% in a single change. The algorithm recalibrates delivery with each budget change, and large jumps cause instability.
