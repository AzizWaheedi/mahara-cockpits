---
name: audience_methodology
description: Audience strategy framework for Meta Ads covering broad targeting, interest targeting, lookalike audiences, custom audiences, Advantage+ audience, and exclusion strategies. Includes decision trees for when to use each approach based on account maturity and business model. Referenced by audit-audiences action skill.
---

# Audience Methodology

## Purpose

This skill defines the complete audience targeting framework for Meta Ads. It covers every audience type, when to use each, how they interact, and how to evolve your targeting as your account matures. The core principle: as Meta's algorithm gets smarter and your pixel accumulates data, you should progressively simplify your targeting -- not make it more complex.

## Core Framework: The Targeting Hierarchy

From most to least scalable (and generally most to least effective in mature accounts):

```
Broad (no targeting) --> Advantage+ Audience --> Lookalike --> Interest --> Custom (warm)
```

This is not a quality ranking. It's a maturity-dependent hierarchy. The right approach depends on your account's data maturity and business model.

---

## 1. Targeting Strategy by Account Maturity

### Nascent (0-50 conversions/month)

**Problem:** The pixel has insufficient data to optimize. Meta doesn't know who your customer is.

**Strategy:**
- Primary: Interest targeting (3-5 well-researched interest stacks)
- Secondary: Lookalike audiences (from customer list if available)
- Warm audiences: Custom audiences from email list, website visitors
- Avoid: Broad targeting (algorithm needs signals), Advantage+ (same issue)

**Setup:**
- 3-5 ad sets, each targeting a distinct interest cluster
- Separate warm retargeting campaign
- Budget weighted toward interests (70%) and warm (30%)

### Developing (50-200 conversions/month)

**Problem:** Growing data, but not enough for full algorithmic optimization.

**Strategy:**
- Primary: Lookalike audiences (1-3% from purchasers/leads)
- Secondary: Interest targeting (refined based on data)
- Test: Advantage+ Audience with interest suggestions
- Warm audiences: Expanding retargeting pools

**Key action:** Start testing broader approaches. Run a broad or Advantage+ ad set alongside your interest/LAL targeting. Compare CPA over 14 days.

### Established (200-500 conversions/month)

**Problem:** Strong data foundation, risk of over-segmentation limiting scale.

**Strategy:**
- Primary: Broad targeting OR Advantage+ Audience
- Secondary: Lookalike (3-5% for scale)
- Reduced: Interest targeting (only for specific campaigns like launches)
- Warm audiences: Full-funnel retargeting

**Key action:** Consolidate ad sets. If you have 10 interest-targeted ad sets, test combining them into 2-3 broader groups. The algorithm often outperforms manual segmentation at this stage.

### Advanced (500+ conversions/month)

**Problem:** Maximizing efficiency at scale. Every targeting restriction costs potential reach.

**Strategy:**
- Primary: Broad targeting (prospecting), Advantage+ Shopping (if e-commerce)
- Minimal: Audience restrictions only for specific business reasons
- Warm audiences: Streamlined retargeting (often just one campaign)
- Testing: New market expansion, international audiences

**Key action:** Trust the algorithm. Your pixel data and conversion history are your targeting. Manual audience restrictions at this scale often hurt more than help.

---

## 2. Audience Types Deep Dive

### Broad Targeting (Open Targeting)

**What it is:** No audience targeting whatsoever. Only age, gender, and location restrictions. Meta's algorithm finds your customers using pixel data, ad engagement signals, and conversion patterns.

**When to use:**
- Established accounts with 200+ monthly conversions
- When interest/LAL audiences are fatiguing or plateauing
- As a control test against any audience strategy
- Advantage+ Shopping campaigns

**When NOT to use:**
- New accounts with <50 conversions (algorithm has no data)
- Hyper-niche B2B products (total addressable audience is too small)
- Geographic restrictions are critical (broad may leak into non-target geos)

**Setup best practices:**
- Age/gender: Only restrict if genuinely irrelevant (e.g., women's clothing can exclude men)
- Location: Set to target countries/regions
- Language: Only restrict if your landing page is single-language
- Everything else: Leave open

**Performance expectations:**
- First 7 days: CPA may be 20-40% higher than targeted campaigns
- Days 7-21: Algorithm learns, CPA should approach or beat targeted
- Day 21+: If CPA hasn't reached parity, broad may not suit your account yet

### Advantage+ Audience

**What it is:** Meta's AI-powered targeting. You provide "audience suggestions" (interests, demographics, custom audiences) as signals, but Meta can and will expand beyond them to find converters.

**How it actually works:**
1. You set audience suggestions (formerly "targeting expansion")
2. Meta uses these as starting signals, not hard limits
3. The algorithm progressively expands to broader audiences that show conversion potential
4. Over time, it may largely ignore your suggestions if it finds better audiences elsewhere

**When to use:**
- Developing to established accounts (50+ conversions/month)
- When you want algorithmic optimization but with directional guidance
- For prospecting campaigns where you have a hypothesis about your audience
- As a middle ground between interest targeting and full broad

**When NOT to use:**
- When you need strict audience control (compliance, geographic, age restrictions)
- A/B testing where audience purity matters
- Retargeting campaigns (use custom audiences directly)

**Setup:**
- Audience suggestions: Add your best-performing interests and LALs as suggestions
- Custom audience suggestions: Add your purchaser LAL or high-value customer list
- Age/gender: Set if relevant, but keep broad
- Expect Meta to serve 40-70% of impressions outside your suggested audiences

**Advantage+ Audience vs Broad:**
- Advantage+ converges faster (suggestions accelerate learning)
- Broad may reach lower CPMs long-term (no algorithmic overhead)
- Test both; the winner varies by account

### Lookalike Audiences

**What it is:** Meta finds users similar to a source audience you provide. Percentage controls how similar (1% = most similar, 10% = broadest).

**Percentage strategy:**

| LAL % | Audience Size | Best For | Expected CPA |
|-------|---------------|----------|--------------|
| 1% | ~2.1M (US) | Precision prospecting, limited budgets | Lowest |
| 1-2% | ~4.2M (US) | Primary scaling audience | Low |
| 2-3% | ~6.3M (US) | Scale when 1% saturates | Low-Medium |
| 3-5% | ~10.5M (US) | High-spend scale | Medium |
| 5-10% | ~21M (US) | Maximum reach, approaches broad | Medium-High |

**Source audience quality matters most.** A 1% LAL from your top 100 customers will outperform a 1% LAL from all website visitors.

**Best source audiences (ranked):**
1. Top 25% customers by LTV (if you have the data)
2. All purchasers/converters (last 180 days)
3. High-intent website visitors (add to cart, pricing page, signup started)
4. Email subscriber list (engaged segment)
5. Video viewers (75%+ completion)
6. All website visitors (weakest signal)

**Source audience size:**
- Minimum: 100 people (Meta's hard minimum)
- Recommended minimum: 1,000 people (for statistical quality)
- Optimal: 5,000-50,000 people
- Above 50K: Quality dilutes, consider using a more selective source

**Refresh cadence:**
- Update source audiences monthly (new customers, latest engagement data)
- LALs are snapshots -- they don't auto-update when the source changes
- Stale LALs (3+ months old) should be rebuilt

### Interest Targeting

**What it is:** Targeting based on Meta's categorization of user interests, behaviors, and demographics.

**When to use:**
- Nascent accounts (primary targeting method)
- Launching into new markets or verticals
- Specific campaign goals (e.g., targeting users interested in a competitor)
- When algorithmic targeting isn't performing

**Interest stacking strategy:**

**Narrow stacks (AND logic):** Interest A AND Interest B
- Smaller, more qualified audience
- Use when: Your product serves a specific intersection (e.g., "small business owners" AND "email marketing")
- Risk: Too small to scale

**Broad stacks (OR logic):** Interest A OR Interest B OR Interest C
- Larger audience, more room to scale
- Use when: Multiple interests describe your customer
- Group thematically (e.g., all competitor interests in one ad set, all job-title interests in another)

**Interest research sources:**
- Audience Insights tool (Meta's built-in research)
- Competitor brand names and products
- Industry publications and thought leaders
- Related software/tools your audience uses
- Job titles and professional behaviors

**Interest targeting for Viktor (SaaS/B2B):**
- Competitor interests: Slack, Asana, Monday.com, ClickUp, Notion
- Role interests: Small business owners, entrepreneurs, startup founders, marketing managers
- Tech interests: AI, automation, productivity tools, SaaS
- Publication interests: TechCrunch, Product Hunt, Hacker News

### Custom Audiences (Warm/Retargeting)

**What it is:** Audiences built from your own data -- website visitors, customer lists, app users, and platform engagement.

**Types and use cases:**

| Source | Lookback Window | Best For | Typical Size |
|--------|----------------|----------|--------------|
| Website - All visitors | 30-180 days | General retargeting | Large |
| Website - Specific pages | 7-30 days | High-intent retargeting | Small-Medium |
| Website - Add to cart | 7-14 days | Cart abandonment | Small |
| Customer list | N/A | Upsell, cross-sell, exclusions | Varies |
| Video viewers (25%+) | 30-365 days | Mid-funnel nurture | Medium-Large |
| Video viewers (75%+) | 30-365 days | High-intent warm audience | Medium |
| Lead form openers | 30-90 days | Lead nurture | Small-Medium |
| Instagram/FB engagers | 30-365 days | Social proof warm audience | Medium-Large |
| App activity | 30-180 days | Re-engagement | Varies |

**Retargeting window strategy:**
- 0-3 days: Hottest intent. Highest conversion rate. Smallest audience.
- 3-7 days: Strong intent. Good balance of size and quality.
- 7-14 days: Moderate intent. Primary retargeting window.
- 14-30 days: Cooling intent. Broader messaging needed.
- 30-180 days: Cold retargeting. Use for re-engagement campaigns only.

---

## 3. Exclusion Strategy

Exclusions prevent wasted spend and ensure clean funnel segmentation.

### Must-Have Exclusions

| Campaign Type | Exclude | Why |
|---------------|---------|-----|
| Prospecting | Purchasers (180 days) | Don't pay to acquire existing customers |
| Prospecting | Active subscribers/users | Same reason |
| Retargeting | Purchasers (if not selling repeat) | Already converted |
| Upsell | Non-purchasers | Wrong funnel stage |
| Free trial | Current paid users | Waste of budget |

### Exclusion Limitations

**Match rates are imperfect:**
- Customer list match rates: 20-70% depending on data quality
- Email-only lists: 30-50% match rate typical
- Phone + email lists: 50-70% match rate
- This means 30-80% of your exclusion list is NOT being excluded

**Workarounds for low match rates:**
- Use website pixel events as exclusion source (100% match for pixel-tracked users)
- Layer exclusions: customer list AND purchase pixel event AND thank-you page visitors
- Accept some overlap in prospecting and plan for it in CPA targets

### Exclusion Architecture by Campaign Type

**Prospecting campaigns:**
- Exclude: All purchasers (customer list + pixel, 180 days)
- Exclude: All leads/signups (customer list + pixel, 90 days)
- Exclude: Website visitors (optional, only if running separate retargeting)

**Retargeting campaigns:**
- Exclude: Purchasers (customer list + pixel)
- Include: Website visitors (7-30 days), video viewers, engagers
- Segment by intent level if budget allows

**Retention/upsell campaigns:**
- Include: Existing customers only (customer list + pixel)
- Exclude: Churned customers (if you have this data)
- Exclude: Recently purchased (7-14 days, avoid buyer's remorse period)

See `references/exclusion_architecture.md` for multi-layer exclusion setup guides.

---

## 4. Audience Overlap and Consolidation

### Detecting Overlap

Use Meta's Audience Overlap tool (Audiences > select 2+ audiences > Actions > Show Audience Overlap).

**Overlap thresholds:**

| Overlap % | Interpretation | Action |
|-----------|---------------|--------|
| <10% | Distinct audiences | Run separately, no issue |
| 10-20% | Minor overlap | Monitor, generally acceptable |
| 20-30% | Moderate overlap | Consider consolidating if similar performance |
| 30-50% | Significant overlap | Consolidate into one ad set |
| 50%+ | Essentially the same audience | Merge immediately, you're bidding against yourself |

### Why Overlap Hurts

- You compete against yourself in the auction (drives up CPM)
- Meta's algorithm gets confused (inconsistent signals from same users)
- Budget fragments across redundant ad sets
- Reporting becomes misleading (same person counted in multiple audiences)

### Consolidation Protocol

1. Identify overlapping ad sets using the Overlap tool
2. Compare performance (CPA, ROAS) of overlapping ad sets
3. Keep the better performer, pause the other
4. If both perform similarly, merge into one broader ad set
5. Increase budget on the surviving ad set by the combined previous budget
6. Monitor for 7 days -- consolidated ad sets often outperform the sum of parts

---

## 5. Audience Saturation Signals

Even the best audience eventually saturates. Watch for these signals:

| Signal | Threshold | What's Happening |
|--------|-----------|-----------------|
| Rising frequency | >3 (prospecting), >7 (retargeting) | You've reached most of the audience |
| Declining CTR | >15% drop over 14 days | Audience has seen your ads, stopped engaging |
| Increasing CPM | >20% above baseline | Meta is struggling to find new users in this audience |
| Flattening conversions | Daily conversions plateau despite budget increase | You've tapped out the audience |
| Increasing CPA | Gradual upward trend over 2+ weeks | Diminishing returns |

### Saturation Response

1. **Expand the audience:** Increase LAL %, broaden interests, test Advantage+ or broad
2. **Refresh creative:** New creative can re-engage a "saturated" audience
3. **Change the offer:** Different angle, different landing page, different CTA
4. **Expand geography:** New countries, new languages
5. **Accept it:** Some audiences have natural ceilings. Shift budget elsewhere.

---

## Quick Reference Tables

### Targeting Decision Matrix

| Monthly Conversions | Primary | Secondary | Avoid |
|---------------------|---------|-----------|-------|
| <50 | Interest stacks | Customer list LALs | Broad, Advantage+ |
| 50-200 | LAL 1-3% | Advantage+ Audience | Over-segmented interests |
| 200-500 | Broad / Advantage+ | LAL 3-5% | Narrow interests |
| 500+ | Broad | ASC | Manual restrictions |

### Audience Type Comparison

| Type | Scale | Precision | Setup Effort | Best Maturity |
|------|-------|-----------|--------------|---------------|
| Broad | Highest | Lowest (initially) | None | Advanced |
| Advantage+ | High | Medium | Low | Developing+ |
| LAL 1-2% | Medium | High | Medium | All stages |
| LAL 3-5% | High | Medium | Medium | Developing+ |
| Interest | Medium | Variable | High | Nascent |
| Custom (warm) | Low | Highest | Medium | All stages |

### SaaS/B2B Audience Starter Kit (Viktor)

| Ad Set | Targeting | Budget Share |
|--------|-----------|-------------|
| Competitors | Interest: Slack, Asana, Monday.com, ClickUp, Notion | 25% |
| Tech Founders | Interest: Startup, Entrepreneurship, SaaS + Behavior: Small Biz Owner | 25% |
| AI Enthusiasts | Interest: Artificial Intelligence, Automation, Product Hunt | 20% |
| LAL - Signups | 1% LAL from signup list | 15% |
| Retargeting | Website visitors 30d, video viewers 50%+ | 15% |

---

## 6. Audience Lifecycle Automation

The Meta Ads MCP now supports programmatic audience management. The following capabilities are available for automating the audience lifecycle.

### What the MCP Can Execute

| Capability | MCP Tool | Notes |
|------------|----------|-------|
| Create website custom audience | `create_custom_audience` (type: WEBSITE) | Set retention days, URL rules |
| Create CRM/email list audience | `create_custom_audience` (type: CRM/EMAIL) | Upload hashed email/phone lists |
| Upload contacts to existing audience | `add_users_to_audience` | Accepts hashed email, phone, external_id |
| Create lookalike audience | `create_lookalike_audience` | Specify source audience ID, country, ratio 1-10% |
| Check overlap between audiences | `get_audience_overlap` | Compare 2-5 audiences; returns overlap % |
| Estimate audience reach | `get_reach_estimate` | Validate size before launching a new ad set |
| Update audience retention or name | `update_custom_audience` | Adjust lookback window, rename for hygiene |

All write operations create drafts requiring human approval before execution.

### Full Audience Lifecycle: Awareness to Churned

The complete funnel requires four audience layers, each with an exclusion chain to prevent overlap:

```
AWARENESS (Prospecting)
  └── Broad / Advantage+ / LAL audiences
  └── Exclude: Trial users, paid subscribers, churned (if re-engagement is separate)

TRIAL (Activation)
  └── Custom audience: CompleteRegistration or TrialStarted pixel event (30d)
  └── Exclude: Paid subscribers

PURCHASER (Retention/Upsell)
  └── Custom audience: Purchase pixel event OR customer list (180d)
  └── Exclude: Churned users (if you have churn signal)
  └── Include: Cross-sell if separate SKU or plan

CHURNED (Re-engagement)
  └── Custom audience: Customer list segment -- churned users (subscription cancelled)
  └── Exclude: Active subscribers
  └── Exclude: Recently churned (<14 days, avoid buyer's remorse period)
```

Each stage should exclude all lower-funnel audiences from higher-funnel campaigns. Example: Awareness campaigns should exclude Trial + Purchaser + Churned audiences to avoid paying to prospect users already in the funnel.

### Quarterly Audience Refresh Cadence

Audiences degrade over time. Custom audiences are snapshots; LALs built from stale sources lose quality. Run this refresh quarterly:

| Audience Type | Action | Frequency |
|--------------|--------|-----------|
| Customer list audiences | Re-upload latest CRM export via `add_users_to_audience` | Monthly (or whenever cohort size grows >20%) |
| LAL source audiences | Re-create source audience with updated pixel data, then rebuild LAL | Quarterly |
| Website retargeting audiences | These auto-update (pixel-based) -- verify lookback window is correct | Quarterly review |
| Exclusion audiences | Re-upload purchaser/churned lists | Monthly |
| Overlap check | Run `get_audience_overlap` across all active audiences | Quarterly (or before any new audience launch) |

### Automation Pattern: New Market Entry

When launching into a new geo or segment:

1. `get_reach_estimate` -- validate audience size before creating ad sets
2. `create_custom_audience` (WEBSITE) -- new geo-specific retargeting pool
3. `create_lookalike_audience` -- LAL from existing purchasers, new country
4. `get_audience_overlap` -- confirm new LAL doesn't heavily overlap with existing targeting
5. Launch ad sets using new audiences, with purchaser exclusion applied

---

## Reference Files

- `references/targeting_decision_tree.md` - Decision tree by business model and maturity stage
- `references/audience_types.md` - Complete guide to each audience type with setup requirements
- `references/exclusion_architecture.md` - Multi-layer exclusion strategy with implementation guides
